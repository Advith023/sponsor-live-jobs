#!/usr/bin/env python3
"""
SponsorLive data refresh.

1. Downloads the latest UK Register of Licensed Sponsors (Workers) from gov.uk.
2. For each Skilled Worker sponsor, looks for a public job board on common
   applicant tracking systems (Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
   Recruitee, Personio, Breezy, Teamtailor, Pinpoint, BambooHR).
3. Adds boards given as links (data/seed_boards.json, GitHub issues labelled
   "board-suggestion", or a suggestions CSV): any of the above plus Workday and
   ordinary careers pages that publish schema.org JobPosting data.
4. Pulls live UK roles straight from those boards, tags each with skills and UK
   region, and writes site/data/jobs.json.

Discovery results are cached in data/ats_cache.json so each run only probes a
rotating batch of sponsors; coverage grows every day.

Standard library only.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import skills  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = ROOT / "data" / "ats_cache.json"
SEED_PATH = ROOT / "data" / "seed_boards.json"
OUT_PATH = ROOT / "site" / "data" / "jobs.json"
STATS_PATH = ROOT / "site" / "data" / "stats.json"
SKILLS_PATH = ROOT / "site" / "data" / "skills.json"
MAX_DESC = 20000

REGISTER_API = "https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers"
REGISTER_PAGE = "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers"

UA = "SponsorLiveBot/1.0 (+https://github.com/Advith023/sponsor-live-jobs)"
TIMEOUT = 20
WORKERS = int(os.environ.get("WORKERS", "32"))
DISCOVERY_BATCH = int(os.environ.get("DISCOVERY_BATCH", "8000"))
DISCOVERY_MINUTES = float(os.environ.get("DISCOVERY_MINUTES", "100"))  # stop probing new sponsors after this
SUGGESTIONS_CSV_URL = os.environ.get("SUGGESTIONS_CSV_URL", "")
GITHUB_REPOSITORY = os.environ.get("GITHUB_REPOSITORY", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
RECHECK_NEGATIVE_DAYS = int(os.environ.get("RECHECK_NEGATIVE_DAYS", "90"))
NOW = datetime.now(timezone.utc)

# ---------------------------------------------------------------- HTTP

def http_get(url: str, *, as_json: bool = True, retries: int = 2, body: dict | None = None):
    """Return parsed JSON / text, or None on 404/410. Raises on repeated other errors."""
    last = None
    for attempt in range(retries + 1):
        try:
            headers = {"User-Agent": UA, "Accept": "application/json, text/csv, text/html, application/xml, */*"}
            data = None
            if body is not None:
                data = json.dumps(body).encode()
                headers["Content-Type"] = "application/json"
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                body = r.read()
            text = body.decode("utf-8-sig", errors="replace")
            return json.loads(text) if as_json else text
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404, 410, 422):
                return None
            last = e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as e:
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def safe_get(url: str, **kw):
    try:
        return http_get(url, **kw)
    except Exception:
        return None


def safe_text(url: str):
    return safe_get(url, as_json=False)

# ---------------------------------------------------------------- Sponsor register

def find_register_csv_url() -> str:
    data = http_get(REGISTER_API)
    urls: list[str] = []

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif (isinstance(o, str) and o.lower().split("?")[0].endswith(".csv")
              and (o.startswith("http") or o.startswith("/"))):  # skip bare filenames
            urls.append(o)

    if data:
        walk(data)
    if not urls:
        html = http_get(REGISTER_PAGE, as_json=False) or ""
        urls = re.findall(r'href="([^"]+\.csv)"', html)
    if not urls:
        raise RuntimeError("Could not locate sponsor register CSV on gov.uk")
    urls.sort(key=lambda u: ("assets.publishing.service.gov.uk" not in u, not u.startswith("http")))
    url = urls[0]
    return url if url.startswith("http") else "https://www.gov.uk" + url


def load_sponsors() -> dict[str, dict]:
    url = find_register_csv_url()
    print(f"Register: {url}")
    text = http_get(url, as_json=False)
    reader = csv.DictReader(io.StringIO(text))
    sponsors: dict[str, dict] = {}
    for row in reader:
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        name = row.get("organisation name", "")
        route = row.get("route", "")
        if not name or "skilled worker" not in route.lower():
            continue
        key = norm_name(name)
        if len(key) < 3:
            continue
        s = sponsors.setdefault(key, {"name": name, "town": row.get("town/city", ""),
                                      "rating": row.get("type & rating", ""), "routes": set()})
        s["routes"].add(route)
    for s in sponsors.values():
        s["routes"] = sorted(s["routes"])
    print(f"Skilled Worker sponsors: {len(sponsors):,}")
    return sponsors, url

# ---------------------------------------------------------------- Name handling

SUFFIXES = r"\b(limited|ltd|plc|llp|lp|inc|incorporated|corp|corporation|co|company|uk|u\.k\.|gb|group|holdings|holding|international|intl|europe|emea|services|the)\b"


def norm_name(name: str) -> str:
    n = name.lower()
    n = re.split(r"\s+(t/a|trading as|t\\a)\s+", n)[0]
    n = n.replace("&", " and ")
    n = re.sub(r"\(.*?\)", " ", n)
    n = re.sub(SUFFIXES, " ", n)
    n = re.sub(r"[^a-z0-9 ]+", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def trading_name(name: str) -> str | None:
    m = re.split(r"\s+(?:t/a|trading as|t\\a)\s+", name, flags=re.I)
    return m[1] if len(m) > 1 else None


def display_name(name: str) -> str:
    n = trading_name(name) or name
    n = re.sub(r"\s+(ltd|limited|plc|llp|uk ltd|uk limited)\.?$", "", n.strip(), flags=re.I).strip()
    return n.title() if n.isupper() else n


def candidates(name: str) -> list[str]:
    out: list[str] = []
    for n in filter(None, [name, trading_name(name)]):
        base = norm_name(n)
        if len(base.replace(" ", "")) < 4:
            continue
        out += [base.replace(" ", ""), base.replace(" ", "-")]
    seen, res = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            res.append(c)
    return res[:4]


def name_match(sponsor: str, board_name: str | None) -> bool:
    """True if the ATS-reported company name plausibly matches the sponsor."""
    if not board_name:
        return True  # ATS gives no name; rely on specific token + UK location filter
    a, b = set(norm_name(sponsor).split()), set(norm_name(board_name).split())
    if not a or not b:
        return False
    return len(a & b) / max(len(a), len(b)) >= 0.5

# ---------------------------------------------------------------- UK location filter

UK_RE = re.compile(
    r"\b(united kingdom|uk|u\.k\.|gb|great britain|britain|england|scotland|wales|northern ireland|"
    r"london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|sheffield|newcastle|"
    r"nottingham|leicester|cardiff|belfast|cambridge|oxford|reading|brighton|southampton|"
    r"portsmouth|milton keynes|coventry|aberdeen|dundee|york|bath|exeter|norwich|swindon|"
    r"guildford|slough|watford|luton|stockport|salford|bournemouth|plymouth|derby|"
    r"wolverhampton|sunderland|hull|stoke|warrington|chester|crawley|basingstoke|"
    r"canary wharf|city of london|stevenage|harlow|ipswich|peterborough|gloucester|"
    r"cheltenham|swansea|inverness|stirling|lancaster|preston|bolton|wigan|huddersfield|"
    r"bradford|middlesbrough|durham|northampton|bedford|chelmsford|colchester|maidstone|"
    r"canterbury|woking|farnborough|bracknell|high wycombe|st albans|hemel hempstead|"
    r"egham|staines|uxbridge|heathrow|hammersmith|shoreditch|croydon|wimbledon|"
    r"remote\s*[-–(,]?\s*uk)\b", re.I)
UK_COUNTRY = re.compile(r"\b(united kingdom|uk|u\.k\.|gb|gbr|great britain|england|scotland|wales|northern ireland)\b", re.I)
# Places that share names with UK cities
FALSE_FRIENDS = re.compile(r"\b(new york|new england|new south wales|new london|new hampshire|york,?\s*pa|"
                           r"london,?\s*(on|ontario|ky|oh|canada)|birmingham,?\s*(al|alabama)|"
                           r"cambridge,?\s*(ma|massachusetts)|manchester,?\s*(nh|ct)|reading,?\s*pa|"
                           r"bristol,?\s*(ct|tn|va)|richmond,?\s*va|perth,?\s*(wa|australia))\b", re.I)


def is_uk(loc: str) -> bool:
    if not loc:
        return False
    return any(UK_COUNTRY.search(p) or (UK_RE.search(p) and not FALSE_FRIENDS.search(p))
               for p in re.split(r"\s*[/;|]\s*", loc))

# ---------------------------------------------------------------- UK regions

REGIONS = [
    ("London", r"london|canary wharf|shoreditch|croydon|wimbledon|hammersmith|uxbridge|heathrow|stratford|kingston upon thames|camden|islington"),
    ("South East", r"reading|brighton|southampton|portsmouth|milton keynes|oxford|guildford|slough|crawley|basingstoke|woking|farnborough|bracknell|high wycombe|maidstone|canterbury|egham|staines|surrey|kent|sussex|hampshire|berkshire|buckinghamshire|oxfordshire|south east"),
    ("East of England", r"cambridge|norwich|ipswich|peterborough|luton|watford|stevenage|harlow|st albans|hemel hempstead|chelmsford|colchester|bedford|hertfordshire|essex|norfolk|suffolk|east of england"),
    ("South West", r"bristol|bath|exeter|plymouth|swindon|bournemouth|gloucester|cheltenham|poole|devon|cornwall|dorset|somerset|wiltshire|south west"),
    ("Midlands", r"birmingham|coventry|leicester|nottingham|derby|wolverhampton|stoke|northampton|lincoln|worcester|warwick|solihull|loughborough|midlands"),
    ("North West", r"manchester|liverpool|salford|stockport|warrington|chester|preston|bolton|wigan|lancaster|blackpool|cheshire|lancashire|north west"),
    ("Yorkshire & North East", r"leeds|sheffield|bradford|york|hull|huddersfield|wakefield|harrogate|newcastle|sunderland|middlesbrough|durham|gateshead|yorkshire|north east"),
    ("Scotland", r"scotland|edinburgh|glasgow|aberdeen|dundee|inverness|stirling|perth(?!,?\s*(wa|australia))"),
    ("Wales", r"wales|cardiff|swansea|newport|wrexham|bangor"),
    ("Northern Ireland", r"northern ireland|belfast|derry|londonderry"),
]
REGION_RE = [(r, re.compile(r"\b(" + p + r")\b", re.I)) for r, p in REGIONS]


def regions(loc: str, remote: bool) -> list[str]:
    uk_parts = [p for p in re.split(r"\s*[/;|]\s*", loc or "") if is_uk(p) or not p.strip()]
    text = " / ".join(uk_parts) if uk_parts else (loc or "")
    out = [r for r, rx in REGION_RE if rx.search(text) and not FALSE_FRIENDS.search(text)]
    if remote or re.search(r"remote", text, re.I):
        out.append("Remote")
    return out or ["UK (other / unspecified)"]

# ---------------------------------------------------------------- Categories

CATS = [
    ("Data & Analytics", r"data|analyt|insight|bi\b|business intelligence|machine learning|\bml\b|\bai\b|statistic|forecast|quant|scientist"),
    ("Software Engineering", r"engineer|developer|devops|sre\b|software|frontend|front-end|backend|back-end|full[- ]?stack|platform|infrastructure|security|cloud|architect|qa\b|test"),
    ("Product", r"product (manager|owner|lead|director)|\bpm\b|product ops"),
    ("Design", r"design|ux|ui\b|research(er)?\b|creative"),
    ("Sales", r"sales|account (executive|manager)|business development|\bbdr\b|\bsdr\b|partnership"),
    ("Marketing", r"marketing|growth|brand|content|seo|social media|communications|pr\b|copywrit"),
    ("Finance", r"financ|accountant|accounting|audit|tax|treasury|fp&a|controller|actuar|payroll|credit|risk"),
    ("Legal & Compliance", r"legal|lawyer|solicitor|counsel|compliance|paralegal|regulat|aml|kyc|fraud"),
    ("People & HR", r"people|hr\b|human resources|talent|recruit|learning|l&d"),
    ("Customer & Support", r"customer|support|success|service|client|helpdesk"),
    ("Healthcare", r"nurse|doctor|clinical|care|pharmac|health|medical|therap|physio|dentist|gp\b"),
    ("Operations", r"operations|ops\b|logistics|supply chain|procure|project manager|programme|delivery|planner|planning|coordinator|administrat"),
    ("Engineering (non-software)", r"mechanical|electrical|civil|structural|manufactur|hardware|chemical|aerospace"),
    ("Education & Research", r"teacher|lecturer|tutor|professor|researcher|scientist|education"),
]
CAT_RE = [(c, re.compile(p, re.I)) for c, p in CATS]


def categorise(title: str) -> str:
    for c, r in CAT_RE:
        if r.search(title):
            return c
    return "Other"

# ---------------------------------------------------------------- ATS adapters
# Each adapter: probe(token) -> (board_name or None) if board exists else False
#               jobs(token)  -> list of normalised job dicts


def _iso(v) -> str | None:
    if v is None or v == "":
        return None
    try:
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, timezone.utc).isoformat()
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except Exception:
        return None


def _job(title, loc, url, posted=None, remote=False, type=None, dept=None, salary=None, desc=None):
    return dict(title=(title or "").strip(), loc=loc or "", url=url, posted=posted, remote=bool(remote),
                type=type, dept=dept, salary=salary, desc=skills.strip_html(desc)[:MAX_DESC] if desc else "")


def gh_probe(t):
    d = safe_get(f"https://boards-api.greenhouse.io/v1/boards/{t}")
    return (d.get("name") or None) if isinstance(d, dict) and "name" in d else False


def gh_jobs(t):
    d = safe_get(f"https://boards-api.greenhouse.io/v1/boards/{t}/jobs?content=true") or {}
    out = []
    for j in d.get("jobs", []):
        loc = (j.get("location") or {}).get("name", "")
        out.append(_job(j.get("title"), loc, j.get("absolute_url"), _iso(j.get("first_published") or j.get("updated_at")),
                        "remote" in loc.lower(), desc=j.get("content")))
    return out


def lever_probe_base(base):
    def probe(t):
        d = safe_get(f"{base}/v0/postings/{t}?mode=json&limit=1")
        return None if isinstance(d, list) and d else False
    return probe


def lever_jobs_base(base):
    def jobs(t):
        d = safe_get(f"{base}/v0/postings/{t}?mode=json") or []
        out = []
        for j in d if isinstance(d, list) else []:
            c = j.get("categories") or {}
            locs = [c.get("location") or ""] + (c.get("allLocations") or [])
            loc = " / ".join(dict.fromkeys(x for x in locs if x))
            desc = " ".join([j.get("descriptionPlain") or ""] + [(x.get("text") or "") + " " + (x.get("content") or "")
                                                                for x in j.get("lists") or []] + [j.get("additionalPlain") or ""])
            out.append(_job(j.get("text"), loc, j.get("hostedUrl"), _iso(j.get("createdAt")),
                            (j.get("workplaceType") == "remote") or "remote" in loc.lower(),
                            c.get("commitment"), c.get("team") or c.get("department"), desc=desc))
        return out
    return jobs


def ashby_probe(t):
    d = safe_get(f"https://api.ashbyhq.com/posting-api/job-board/{t}")
    return None if isinstance(d, dict) and d.get("jobs") else False


def ashby_jobs(t):
    d = safe_get(f"https://api.ashbyhq.com/posting-api/job-board/{t}?includeCompensation=true") or {}
    out = []
    for j in d.get("jobs", []):
        if j.get("isListed") is False:
            continue
        locs = [j.get("location") or ""] + [x.get("location", "") for x in j.get("secondaryLocations") or []]
        addr = ((j.get("address") or {}).get("postalAddress") or {}).get("addressCountry") or ""
        loc = " / ".join(dict.fromkeys(x for x in locs + [addr] if x))
        comp = (j.get("compensation") or {}).get("compensationTierSummary")
        out.append(_job(j.get("title"), loc, j.get("jobUrl") or j.get("applyUrl"), _iso(j.get("publishedAt")),
                        bool(j.get("isRemote")) or j.get("workplaceType") == "Remote",
                        j.get("employmentType"), j.get("department") or j.get("team"), comp,
                        desc=j.get("descriptionPlain") or j.get("descriptionHtml")))
    return out


def workable_probe(t):
    d = safe_get(f"https://apply.workable.com/api/v1/widget/accounts/{t}")
    return (d.get("name") or None) if isinstance(d, dict) and d.get("jobs") else False


def workable_jobs(t):
    d = safe_get(f"https://apply.workable.com/api/v1/widget/accounts/{t}?details=true") or {}
    out = []
    for j in d.get("jobs", []):
        locs = j.get("locations") or [{"city": j.get("city"), "country": j.get("country")}]
        loc = " / ".join(dict.fromkeys(", ".join(x for x in [l.get("city"), l.get("region"), l.get("country")] if x) for l in locs))
        out.append(_job(j.get("title"), loc, j.get("url") or j.get("application_url"),
                        _iso(j.get("published_on") or j.get("created_at")), bool(j.get("telecommuting")),
                        j.get("employment_type"), j.get("department"),
                        desc=" ".join(filter(None, [j.get("description"), j.get("requirements"), j.get("benefits")]))))
    return out


def sr_probe(t):
    d = safe_get(f"https://api.smartrecruiters.com/v1/companies/{t}/postings?limit=1")
    if isinstance(d, dict) and d.get("totalFound", 0) > 0:
        return ((d.get("content") or [{}])[0].get("company") or {}).get("name") or None
    return False


def sr_jobs(t):
    out, offset = [], 0
    while offset < 1000:
        d = safe_get(f"https://api.smartrecruiters.com/v1/companies/{t}/postings?limit=100&offset={offset}&country=gb") or {}
        content = d.get("content") or []
        for j in content:
            l = j.get("location") or {}
            loc = ", ".join(x for x in [l.get("city"), l.get("region"), {"gb": "United Kingdom"}.get((l.get("country") or "").lower(), l.get("country"))] if x)
            out.append(_job(j.get("name"), loc, f"https://jobs.smartrecruiters.com/{t}/{j.get('id')}",
                            _iso(j.get("releasedDate")), bool(l.get("remote")),
                            (j.get("typeOfEmployment") or {}).get("label"), (j.get("department") or {}).get("label")))
        offset += 100
        if offset >= d.get("totalFound", 0) or not content:
            break
    return out


def recruitee_probe(t):
    d = safe_get(f"https://{t}.recruitee.com/api/offers/")
    if isinstance(d, dict) and d.get("offers"):
        return d["offers"][0].get("company_name") or None
    return False


def recruitee_jobs(t):
    d = safe_get(f"https://{t}.recruitee.com/api/offers/") or {}
    out = []
    for j in d.get("offers", []):
        locs = j.get("locations") or [{"city": j.get("city"), "country": j.get("country")}]
        loc = " / ".join(dict.fromkeys(", ".join(x for x in [l.get("city"), l.get("country")] if x) for l in locs))
        if j.get("remote") and "remote" not in loc.lower():
            loc = (loc + " (Remote)").strip()
        out.append(_job(j.get("title"), loc, j.get("careers_url"), _iso((j.get("published_at") or "").replace(" UTC", "+00:00")),
                        j.get("remote"), (j.get("employment_type_code") or "").replace("_", " ").title() or None,
                        j.get("department"), desc=(j.get("description") or "") + " " + (j.get("requirements") or "")))
    return out


def _personio_xml(t):
    for host in (f"https://{t}.jobs.personio.de", f"https://{t}.jobs.personio.com"):
        x = safe_text(f"{host}/xml?language=en")
        if x and "<workzag-jobs" in x:
            try:
                return host, ET.fromstring(x.encode())
            except ET.ParseError:
                return None, None
    return None, None


def personio_probe(t):
    host, root = _personio_xml(t)
    return None if root is not None and root.find("position") is not None else False


def personio_jobs(t):
    host, root = _personio_xml(t)
    out = []
    for p in (root.findall("position") if root is not None else []):
        g = lambda k: (p.findtext(k) or "").strip()  # noqa: E731
        offices = [g("office")] + [o.text or "" for o in p.findall("additionalOffices/office")]
        desc = " ".join((d.findtext("name") or "") + " " + (d.findtext("value") or "") for d in p.findall("jobDescriptions/jobDescription"))
        out.append(_job(g("name"), " / ".join(x for x in offices if x), f"{host}/job/{g('id')}", _iso(g("createdAt")),
                        "remote" in " ".join(offices).lower(), g("schedule").title() or None, g("department") or None, desc=desc))
    return out


def breezy_probe(t):
    d = safe_get(f"https://{t}.breezy.hr/json")
    if isinstance(d, list) and d:
        return (d[0].get("company") or {}).get("name") or None
    return False


def breezy_jobs(t):
    d = safe_get(f"https://{t}.breezy.hr/json") or []
    out = []
    for j in d if isinstance(d, list) else []:
        locs = j.get("locations") or [j.get("location") or {}]
        loc = " / ".join(dict.fromkeys(", ".join(x for x in [l.get("city"), (l.get("country") or {}).get("name")] if x) or l.get("name", "") for l in locs))
        out.append(_job(j.get("name"), loc, j.get("url"), _iso(j.get("published_date")),
                        any(l.get("is_remote") for l in locs), (j.get("type") or {}).get("name"), j.get("department"), j.get("salary")))
    return out


TT_NS = "{https://teamtailor.com/locations}"


def _teamtailor_rss(t):
    base = t if t.startswith("http") else f"https://{t}.teamtailor.com"
    x = safe_text(base.rstrip("/") + "/jobs.rss")
    if not x or "<rss" not in x:
        return None
    try:
        return ET.fromstring(x.encode())
    except ET.ParseError:
        return None


def teamtailor_probe(t):
    root = _teamtailor_rss(t)
    if root is None or root.find("channel/item") is None:
        return False
    return root.findtext("channel/title") or None


def teamtailor_jobs(t):
    root = _teamtailor_rss(t)
    out = []
    for it in (root.findall("channel/item") if root is not None else []):
        locs = [", ".join(x for x in [l.findtext(TT_NS + "city"), l.findtext(TT_NS + "country")] if x)
                for l in it.findall(f"{TT_NS}locations/{TT_NS}location")]
        remote = (it.findtext("remoteStatus") or "").lower()
        pub = it.findtext("pubDate")
        try:
            from email.utils import parsedate_to_datetime
            pub = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat() if pub else None
        except Exception:
            pub = None
        out.append(_job(it.findtext("title"), " / ".join(x for x in locs if x), it.findtext("link"), pub,
                        remote in ("fully", "remote"), dept=it.findtext(TT_NS + "department"), desc=it.findtext("description")))
    return out


def pinpoint_probe(t):
    d = safe_get(f"https://{t}.pinpointhq.com/postings.json")
    return None if isinstance(d, dict) and d.get("data") else False


def pinpoint_jobs(t):
    d = safe_get(f"https://{t}.pinpointhq.com/postings.json") or {}
    out = []
    for j in d.get("data", []):
        l = j.get("location") or {}
        loc = ", ".join(x for x in [l.get("city"), l.get("province"), l.get("country")] if x) or l.get("name", "")
        out.append(_job(j.get("title"), loc, j.get("url"), None, (j.get("workplace_type") or "").lower() == "remote",
                        j.get("employment_type_text") or j.get("employment_type"), (j.get("department") or {}).get("name") if isinstance(j.get("department"), dict) else None,
                        desc=" ".join(str(j.get(k) or "") for k in ("description", "key_responsibilities", "skills_knowledge_expertise"))))
    return out


def bamboo_probe(t):
    d = safe_get(f"https://{t}.bamboohr.com/careers/list")
    return None if isinstance(d, dict) and d.get("result") else False


def bamboo_jobs(t):
    d = safe_get(f"https://{t}.bamboohr.com/careers/list") or {}
    out = []
    for j in d.get("result", []):
        l = j.get("location") or {}
        loc = ", ".join(x for x in [l.get("city"), l.get("state"), l.get("country")] if x)
        out.append(_job(j.get("jobOpeningName"), loc, f"https://{t}.bamboohr.com/careers/{j.get('id')}", None,
                        bool(j.get("isRemote")), j.get("employmentStatusLabel"), j.get("departmentLabel")))
    return out

# ---- Link-only sources (cannot be discovered from a company name)

WD_RE = re.compile(r"https://([\w-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([\w-]+)", re.I)
WD_MAX_DETAILS = 200


def _wd_parse_posted(s):
    s = (s or "").lower()
    if "today" in s:
        return NOW.isoformat()
    if "yesterday" in s:
        return (NOW - timedelta(days=1)).isoformat()
    m = re.search(r"(\d+)\+?\s*day", s)
    return (NOW - timedelta(days=int(m.group(1)))).isoformat() if m else None


def _wd_uk_facets(facets):
    """Find facet values naming the UK, wherever they sit in Workday's nested facet tree."""
    hits = {}

    def walk(param, values):
        for v in values or []:
            if v.get("values"):
                walk(v.get("facetParameter") or param, v["values"])
            elif UK_COUNTRY.search(v.get("descriptor", "")) and param:
                hits.setdefault(param, []).append(v["id"])
    for f in facets or []:
        walk(f.get("facetParameter"), f.get("values"))
    # prefer a country-level facet over site-level ones
    for p in sorted(hits, key=lambda p: ("hierarchy" not in p.lower() and "country" not in p.lower(), p)):
        return {p: hits[p]}
    return {}


def workday_probe(t):
    m = WD_RE.match(t)
    if not m:
        return False
    tenant, wd, site = m.groups()
    d = safe_get(f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs",
                 body={"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": ""})
    return None if isinstance(d, dict) and "jobPostings" in d else False


def workday_jobs(t):
    m = WD_RE.match(t)
    if not m:
        return []
    tenant, wd, site = m.groups()
    api = f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"
    first = safe_get(api + "/jobs", body={"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""}) or {}
    facets = _wd_uk_facets(first.get("facets"))
    postings, offset, total = [], 0, None
    while offset < 1000:
        d = safe_get(api + "/jobs", body={"appliedFacets": facets, "limit": 20, "offset": offset, "searchText": "" if facets else "United Kingdom"}) or {}
        page = d.get("jobPostings") or []
        total = d.get("total", total) or 0
        postings += page
        offset += 20
        if not page or offset >= total:
            break
    out = []
    for p in postings[:WD_MAX_DETAILS]:
        info = (safe_get(api + p.get("externalPath", "")) or {}).get("jobPostingInfo") or {}
        locs = [info.get("location") or p.get("locationsText") or ""] + (info.get("additionalLocations") or [])
        loc = " / ".join(x for x in locs if x)
        if facets and not is_uk(loc):
            loc = (loc + " / United Kingdom").strip(" /")  # listed under the UK facet
        out.append(_job(info.get("title") or p.get("title"), loc,
                        info.get("externalUrl") or f"https://{tenant}.{wd}.myworkdayjobs.com/{site}{p.get('externalPath', '')}",
                        _iso(info.get("startDate")) or _wd_parse_posted(p.get("postedOn")),
                        "remote" in loc.lower(), info.get("timeType"), desc=info.get("jobDescription")))
    return out


LD_RE = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)
JOBLINK_RE = re.compile(r'href=["\']([^"\'#]+)["\']', re.I)
JOBISH = re.compile(r"/(jobs?|careers?|vacanc(y|ies)|positions?|openings?|roles?|opportunit(y|ies))/[^/?]+", re.I)
_robots: dict = {}


def allowed(url):
    p = urllib.parse.urlsplit(url)
    root = f"{p.scheme}://{p.netloc}"
    if root not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        txt = safe_text(root + "/robots.txt")
        rp.parse((txt or "").splitlines())
        _robots[root] = rp
    return _robots[root].can_fetch(UA, url)


def _ld_postings(html):
    out = []

    def walk(o):
        if isinstance(o, list):
            for x in o:
                walk(x)
        elif isinstance(o, dict):
            t = o.get("@type")
            if t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t):
                out.append(o)
            for k in ("@graph", "itemListElement", "item", "mainEntity"):
                if k in o:
                    walk(o[k])
    for block in LD_RE.findall(html or ""):
        try:
            walk(json.loads(block.strip()))
        except Exception:
            continue
    return out


def _ld_to_job(p, page_url):
    locs = p.get("jobLocation") or []
    locs = locs if isinstance(locs, list) else [locs]
    parts = []
    for l in locs:
        a = (l or {}).get("address") or {}
        if isinstance(a, str):
            parts.append(a)
        else:
            c = a.get("addressCountry")
            c = c.get("name") if isinstance(c, dict) else c
            parts.append(", ".join(x for x in [a.get("addressLocality"), a.get("addressRegion"), c] if x))
    remote = "TELECOMMUTE" in str(p.get("jobLocationType", "")).upper()
    for r in (p.get("applicantLocationRequirements") or []) if remote else []:
        parts.append((r or {}).get("name", "") + " (Remote)")
    org = p.get("hiringOrganization") or {}
    et = p.get("employmentType")
    return _job(p.get("title"), " / ".join(x for x in parts if x), p.get("url") or page_url, _iso(p.get("datePosted")),
                remote, ", ".join(et) if isinstance(et, list) else et, desc=p.get("description")), (org.get("name") if isinstance(org, dict) else None)


def jsonld_probe(t):
    return None if t.startswith("http") else False


def jsonld_jobs(t, max_pages=40):
    if not allowed(t):
        return []
    html = safe_text(t) or ""
    jobs = [_ld_to_job(p, t)[0] for p in _ld_postings(html)]
    if not jobs:  # listing page: follow links that look like individual job pages on the same site
        host = urllib.parse.urlsplit(t).netloc
        links = []
        for h in JOBLINK_RE.findall(html):
            u = urllib.parse.urljoin(t, h)
            if urllib.parse.urlsplit(u).netloc == host and JOBISH.search(urllib.parse.urlsplit(u).path) and u not in links and u != t:
                links.append(u)
        for u in links[:max_pages]:
            if allowed(u):
                jobs += [_ld_to_job(p, u)[0] for p in _ld_postings(safe_text(u) or "")]
                time.sleep(0.5)
    return jobs


ATS = {
    "greenhouse": (gh_probe, gh_jobs, "Greenhouse"),
    "lever": (lever_probe_base("https://api.lever.co"), lever_jobs_base("https://api.lever.co"), "Lever"),
    "lever_eu": (lever_probe_base("https://api.eu.lever.co"), lever_jobs_base("https://api.eu.lever.co"), "Lever"),
    "ashby": (ashby_probe, ashby_jobs, "Ashby"),
    "workable": (workable_probe, workable_jobs, "Workable"),
    "smartrecruiters": (sr_probe, sr_jobs, "SmartRecruiters"),
    "recruitee": (recruitee_probe, recruitee_jobs, "Recruitee"),
    "personio": (personio_probe, personio_jobs, "Personio"),
    "breezy": (breezy_probe, breezy_jobs, "Breezy"),
    "teamtailor": (teamtailor_probe, teamtailor_jobs, "Teamtailor"),
    "pinpoint": (pinpoint_probe, pinpoint_jobs, "Pinpoint"),
    "bamboohr": (bamboo_probe, bamboo_jobs, "BambooHR"),
    # link-only
    "workday": (workday_probe, workday_jobs, "Workday"),
    "jsonld": (jsonld_probe, jsonld_jobs, "Company careers site"),
}
LINK_ONLY = {"workday", "jsonld"}

# Recognise a pasted careers link -> (ats, token)
LINK_PATTERNS = [
    ("greenhouse", r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?([\w-]+)"),
    ("lever_eu", r"jobs\.eu\.lever\.co/([\w.-]+)"),
    ("lever", r"jobs\.lever\.co/([\w.-]+)"),
    ("ashby", r"jobs\.ashbyhq\.com/([\w.%-]+)"),
    ("workable", r"apply\.workable\.com/([\w-]+)"),
    ("smartrecruiters", r"(?:careers|jobs)\.smartrecruiters\.com/([\w-]+)"),
    ("recruitee", r"([\w-]+)\.recruitee\.com"),
    ("personio", r"([\w-]+)\.jobs\.personio\.(?:de|com)"),
    ("breezy", r"([\w-]+)\.breezy\.hr"),
    ("teamtailor", r"([\w-]+)\.teamtailor\.com"),
    ("pinpoint", r"([\w-]+)\.pinpointhq\.com"),
    ("bamboohr", r"([\w-]+)\.bamboohr\.com"),
]


def board_from_link(url: str) -> dict | None:
    url = (url or "").strip()
    if not re.match(r"https?://", url):
        return None
    m = WD_RE.match(url)
    if m:
        return {"ats": "workday", "token": m.group(0)}
    for ats, pat in LINK_PATTERNS:
        m = re.search(pat, url, re.I)
        if m and m.group(1).lower() not in ("www", "api", "app", "jobs", "careers"):
            return {"ats": ats, "token": urllib.parse.unquote(m.group(1))}
    return {"ats": "jsonld", "token": url.split("#")[0]}

# ---------------------------------------------------------------- Discovery


def discover(sponsor_name: str, extra_tokens: list[tuple[str, str]] | None = None) -> list[dict]:
    found = []
    tries = list(extra_tokens or [])
    for tok in candidates(sponsor_name):
        for ats in ATS:
            if ats not in LINK_ONLY:
                tries.append((ats, tok))
    seen_ats = set()
    for ats, tok in tries:
        if ats in seen_ats or (ats == "lever_eu" and "lever" in seen_ats):
            continue
        res = ATS[ats][0](tok)
        if res is False:
            continue
        if not name_match(sponsor_name, res) and (ats, tok) not in (extra_tokens or []):
            continue
        found.append({"ats": ats, "token": tok})
        seen_ats.add(ats)
    return found


HUB_TOWNS = re.compile(r"london|manchester|edinburgh|cambridge|oxford|bristol|leeds|glasgow|birmingham|reading|brighton", re.I)
LIKELY = re.compile(r"tech|software|digital|data|ai\b|labs?\b|analytics|cloud|fintech|capital|bank|pay|energy|health|bio|"
                    r"therapeutics|games|studio|media|robotics|security|systems|platform|ventures|markets|io\b", re.I)
UNLIKELY = re.compile(r"care|nursing|home|restaurant|takeaway|cafe|kebab|pizza|curry|grill|food|pharmacy|dental|"
                      r"church|mosque|temple|school|academy|trust|construction|builders|cleaning|garage|motors|"
                      r"farm|salon|barber|hotel|spice|tandoori|supermarket|stores?\b|trading", re.I)


def priority(s: dict) -> int:
    n = s["name"]
    return (2 if HUB_TOWNS.search(s.get("town", "")) else 0) + (2 if LIKELY.search(n) else 0) - (3 if UNLIKELY.search(n) else 0)


def norm_type(t):
    if not t:
        return None
    k = re.sub(r"[^a-z]", "", str(t).lower())
    for pat, label in (("intern", "Internship"), ("apprentic", "Apprenticeship"), ("parttime", "Part-time"),
                       ("fulltime", "Full-time"), ("permanent", "Full-time"), ("contract", "Contract"),
                       ("fixedterm", "Fixed term"), ("temp", "Temporary"), ("freelance", "Contract")):
        if pat in k:
            return label
    return str(t)


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def load_suggestions() -> list[tuple[str, str]]:
    """(company, link) pairs from GitHub issues labelled board-suggestion and an optional CSV."""
    out = []
    if GITHUB_REPOSITORY and GITHUB_TOKEN:
        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{GITHUB_REPOSITORY}/issues?labels=board-suggestion&state=open&per_page=100",
                headers={"Authorization": f"Bearer {GITHUB_TOKEN}", "Accept": "application/vnd.github+json", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                for issue in json.loads(r.read()):
                    body = issue.get("body") or ""
                    links = re.findall(r"https?://[^\s)>\]]+", body)
                    m = re.search(r"###\s*Company name\s*\n+(.+)", body)
                    company = (m.group(1).strip() if m else re.sub(r"^\s*\[?suggest(ion)?\]?:?\s*", "", issue.get("title", ""), flags=re.I)).strip()
                    out += [(company, l) for l in links[:3]]
        except Exception as e:
            print(f"  could not read suggestion issues: {e}", file=sys.stderr)
    if SUGGESTIONS_CSV_URL:
        text = safe_text(SUGGESTIONS_CSV_URL) or ""
        for row in csv.reader(io.StringIO(text)):
            links = [c for c in row if re.match(r"https?://", c.strip())]
            names = [c for c in row if c.strip() and not re.match(r"https?://", c.strip()) and not re.match(r"\d{1,2}/\d{1,2}/\d{2,4}", c.strip())]
            if links and names:
                out.append((names[-1].strip(), links[0].strip()))
    return out


def match_sponsor(name: str, sponsors: dict) -> str | None:
    key = norm_name(name)
    if not key:
        return None
    if key in sponsors:
        return key
    pref = sorted((k for k in sponsors if k.startswith(key + " ")), key=len)
    if pref:
        return pref[0]
    for k, s in sponsors.items():
        tn = trading_name(s["name"])
        if tn and norm_name(tn) == key:
            return k
    return None


def run():
    t0 = time.time()
    sponsors, register_url = load_sponsors()
    cache: dict = load_json(CACHE_PATH, {})
    seeds: dict = load_json(SEED_PATH, {})  # {"Sponsor name as on register": [{"ats":..,"token":..}]}

    # Seeds: map to register keys and probe explicitly
    seed_jobs: dict[str, list] = {}
    unmatched = []
    pairs = [(n, b) for n, bs in seeds.items() if not n.startswith("_") for b in bs] + \
            [(n, {"url": l}) for n, l in load_suggestions()]
    for sname, b in pairs:
        board = board_from_link(b["url"]) if "url" in b else b
        key = match_sponsor(sname, sponsors)  # allow "Monzo" to match "Monzo Bank Limited"
        if key and board:
            seed_jobs.setdefault(key, [])
            if (board["ats"], board["token"]) not in seed_jobs[key]:
                seed_jobs[key].append((board["ats"], board["token"]))
        else:
            unmatched.append(sname)
    if unmatched:
        print(f"Suggestions not on the sponsor register (skipped): {', '.join(sorted(set(unmatched))[:50])}")

    def needs_check(key):
        c = cache.get(key)
        if key in seed_jobs:
            return True
        if not c:
            return True
        if c.get("boards"):
            return False
        checked = datetime.fromisoformat(c["checked"])
        return NOW - checked > timedelta(days=RECHECK_NEGATIVE_DAYS)

    todo = [k for k in sponsors if needs_check(k)]
    # never-checked first, likeliest to use a modern job board first, then oldest negative
    todo.sort(key=lambda k: (k in cache, -priority(sponsors[k]), cache.get(k, {}).get("checked", "")))
    todo = [k for k in todo if k in seed_jobs] + [k for k in todo if k not in seed_jobs]
    batch = todo[:DISCOVERY_BATCH]
    print(f"Discovery batch: {len(batch):,} of {len(todo):,} pending")

    deadline = t0 + DISCOVERY_MINUTES * 60

    def discover_timed(k):
        if time.time() > deadline and k not in seed_jobs:
            return None  # out of time; try again next run
        return discover(sponsors[k]["name"], seed_jobs.get(k))

    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(discover_timed, k): k for k in batch}
        for i, f in enumerate(as_completed(futs), 1):
            k = futs[f]
            try:
                res = f.result()
                if res is not None:
                    prev = [b for b in cache.get(k, {}).get("boards", []) if b["ats"] in LINK_ONLY]
                    cache[k] = {"checked": NOW.isoformat(), "boards": res + [b for b in prev if b not in res]}
            except Exception as e:
                print(f"  discover error {k}: {e}", file=sys.stderr)
            if i % 500 == 0:
                print(f"  probed {i:,} ({(time.time() - t0) / 60:.0f} min)")

    # drop sponsors no longer on the register
    for k in list(cache):
        if k not in sponsors:
            del cache[k]

    # Fetch jobs from every known board
    boards = [(k, b) for k, c in cache.items() for b in c.get("boards", [])]
    print(f"Boards to fetch: {len(boards):,}")
    jobs, dead = [], set()

    def fetch(k, b):
        return k, b, ATS[b["ats"]][1](b["token"])

    with ThreadPoolExecutor(WORKERS) as ex:
        for f in as_completed([ex.submit(fetch, k, b) for k, b in boards]):
            try:
                k, b, js = f.result()
            except Exception as e:
                print(f"  fetch error: {e}", file=sys.stderr)
                continue
            if not js:
                dead.add((k, b["ats"], b["token"]))
                continue
            s = sponsors[k]
            for j in js:
                if not j.get("url") or not j.get("title") or not is_uk(j.get("loc", "")):
                    continue
                kw = skills.extract(j["title"] + "\n" + (j.get("desc") or ""))
                jobs.append({
                    "t": j["title"].strip(),
                    "c": display_name(s["name"]),
                    "sp": s["name"],
                    "town": s["town"],
                    "rt": s["rating"],
                    "l": j["loc"],
                    "cat": categorise(j["title"]),
                    "src": ATS[b["ats"]][2],
                    "u": j["url"],
                    "p": j.get("posted"),
                    "r": bool(j.get("remote")),
                    "ty": norm_type(j.get("type")),
                    "d": j.get("dept"),
                    "s": j.get("salary"),
                    "rg": regions(j["loc"], bool(j.get("remote"))),
                    "k": kw,
                    "kd": bool(j.get("desc")),
                    "y": skills.min_years(j.get("desc") or ""),
                    "lv": skills.level(j["title"]),
                })

    # Boards that returned nothing twice in a row get rechecked later
    for k, ats, tok in dead:
        c = cache.get(k)
        if not c:
            continue
        for b in c["boards"]:
            if b["ats"] == ats and b["token"] == tok:
                b["empty"] = b.get("empty", 0) + 1
        c["boards"] = [b for b in c["boards"] if b.get("empty", 0) < 3]
    dead_keys = {(ats, tok) for _, ats, tok in dead}
    for c in cache.values():
        for b in c.get("boards", []):
            if (b["ats"], b["token"]) not in dead_keys:
                b.pop("empty", None)

    # de-duplicate by URL
    uniq = {}
    for j in jobs:
        uniq.setdefault(j["u"], j)
    jobs = sorted(uniq.values(), key=lambda j: j["p"] or "", reverse=True)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": NOW.isoformat(),
        "register": register_url,
        "count": len(jobs),
        "companies": len({j["sp"] for j in jobs}),
        "jobs": jobs,
    }
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    checked = sum(1 for k in sponsors if k in cache)
    STATS_PATH.write_text(json.dumps({
        "generated": NOW.isoformat(), "sponsors": len(sponsors), "sponsors_checked": checked,
        "boards": len(boards), "jobs": len(jobs), "companies": payload["companies"],
        "sources": dict(sorted({src: sum(1 for j in jobs if j["src"] == src) for src in {j["src"] for j in jobs}}.items())),
        "suggestions_unmatched": sorted(set(unmatched))[:200],
    }, indent=1))
    skills.export(SKILLS_PATH)
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, separators=(",", ":"), sort_keys=True))
    print(f"Done: {len(jobs):,} UK jobs from {payload['companies']:,} sponsors "
          f"({checked:,}/{len(sponsors):,} sponsors checked so far)")


if __name__ == "__main__":
    run()
