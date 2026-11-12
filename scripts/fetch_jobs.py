#!/usr/bin/env python3
"""
SponsorLive data refresh.

1. Downloads the latest UK Register of Licensed Sponsors (Workers) from gov.uk.
2. For each Skilled Worker sponsor, looks for a public job board on common
   applicant tracking systems (Greenhouse, Lever, Ashby, Workable, SmartRecruiters).
3. Pulls live UK roles straight from those boards and writes site/data/jobs.json.

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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = ROOT / "data" / "ats_cache.json"
SEED_PATH = ROOT / "data" / "seed_boards.json"
OUT_PATH = ROOT / "site" / "data" / "jobs.json"
STATS_PATH = ROOT / "site" / "data" / "stats.json"

REGISTER_API = "https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers"
REGISTER_PAGE = "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers"

UA = "SponsorLiveBot/1.0 (+https://github.com/advith23/sponsor-live-jobs)"
TIMEOUT = 20
WORKERS = int(os.environ.get("WORKERS", "32"))
DISCOVERY_BATCH = int(os.environ.get("DISCOVERY_BATCH", "4000"))
RECHECK_NEGATIVE_DAYS = int(os.environ.get("RECHECK_NEGATIVE_DAYS", "90"))
NOW = datetime.now(timezone.utc)

# ---------------------------------------------------------------- HTTP

def http_get(url: str, *, as_json: bool = True, retries: int = 2):
    """Return parsed JSON / text, or None on 404/410. Raises on repeated other errors."""
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/csv, */*"})
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


def safe_get(url: str):
    try:
        return http_get(url)
    except Exception:
        return None

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
        elif isinstance(o, str) and o.lower().split("?")[0].endswith(".csv"):
            urls.append(o)

    if data:
        walk(data)
    if not urls:
        html = http_get(REGISTER_PAGE, as_json=False) or ""
        urls = re.findall(r'href="([^"]+\.csv)"', html)
    if not urls:
        raise RuntimeError("Could not locate sponsor register CSV on gov.uk")
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


def gh_probe(t):
    d = safe_get(f"https://boards-api.greenhouse.io/v1/boards/{t}")
    return (d.get("name") or None) if isinstance(d, dict) and "name" in d else False


def gh_jobs(t):
    d = safe_get(f"https://boards-api.greenhouse.io/v1/boards/{t}/jobs") or {}
    out = []
    for j in d.get("jobs", []):
        loc = (j.get("location") or {}).get("name", "")
        out.append(dict(title=j.get("title", ""), loc=loc, url=j.get("absolute_url"),
                        posted=_iso(j.get("first_published") or j.get("updated_at")),
                        remote="remote" in loc.lower(), type=None, dept=None, salary=None))
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
            out.append(dict(title=j.get("text", ""), loc=loc, url=j.get("hostedUrl"),
                            posted=_iso(j.get("createdAt")),
                            remote=(j.get("workplaceType") == "remote") or "remote" in loc.lower(),
                            type=c.get("commitment"), dept=c.get("team") or c.get("department"),
                            salary=None))
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
        out.append(dict(title=j.get("title", ""), loc=loc, url=j.get("jobUrl") or j.get("applyUrl"),
                        posted=_iso(j.get("publishedAt")),
                        remote=bool(j.get("isRemote")) or j.get("workplaceType") == "Remote",
                        type=j.get("employmentType"), dept=j.get("department") or j.get("team"),
                        salary=comp))
    return out


def workable_probe(t):
    d = safe_get(f"https://apply.workable.com/api/v1/widget/accounts/{t}")
    return (d.get("name") or None) if isinstance(d, dict) and d.get("jobs") else False


def workable_jobs(t):
    d = safe_get(f"https://apply.workable.com/api/v1/widget/accounts/{t}") or {}
    out = []
    for j in d.get("jobs", []):
        locs = j.get("locations") or [{"city": j.get("city"), "country": j.get("country")}]
        loc = " / ".join(dict.fromkeys(", ".join(x for x in [l.get("city"), l.get("region"), l.get("country")] if x) for l in locs))
        out.append(dict(title=j.get("title", ""), loc=loc, url=j.get("url") or j.get("application_url"),
                        posted=_iso(j.get("published_on") or j.get("created_at")),
                        remote=bool(j.get("telecommuting")), type=j.get("employment_type"),
                        dept=j.get("department"), salary=None))
    return out


def sr_probe(t):
    d = safe_get(f"https://api.smartrecruiters.com/v1/companies/{t}/postings?limit=1")
    if isinstance(d, dict) and d.get("totalFound", 0) > 0:
        return ((d.get("content") or [{}])[0].get("company") or {}).get("name") or None
    return False


def sr_jobs(t):
    out, offset = [], 0
    while offset < 1000:
        d = safe_get(f"https://api.smartrecruiters.com/v1/companies/{t}/postings?limit=100&offset={offset}") or {}
        content = d.get("content") or []
        for j in content:
            l = j.get("location") or {}
            loc = ", ".join(x for x in [l.get("city"), l.get("region"), {"gb": "United Kingdom"}.get((l.get("country") or "").lower(), l.get("country"))] if x)
            out.append(dict(title=j.get("name", ""), loc=loc,
                            url=f"https://jobs.smartrecruiters.com/{t}/{j.get('id')}",
                            posted=_iso(j.get("releasedDate")), remote=bool(l.get("remote")),
                            type=(j.get("typeOfEmployment") or {}).get("label"),
                            dept=(j.get("department") or {}).get("label"), salary=None))
        offset += 100
        if offset >= d.get("totalFound", 0) or not content:
            break
    return out


ATS = {
    "greenhouse": (gh_probe, gh_jobs, "Greenhouse"),
    "lever": (lever_probe_base("https://api.lever.co"), lever_jobs_base("https://api.lever.co"), "Lever"),
    "lever_eu": (lever_probe_base("https://api.eu.lever.co"), lever_jobs_base("https://api.eu.lever.co"), "Lever"),
    "ashby": (ashby_probe, ashby_jobs, "Ashby"),
    "workable": (workable_probe, workable_jobs, "Workable"),
    "smartrecruiters": (sr_probe, sr_jobs, "SmartRecruiters"),
}

# ---------------------------------------------------------------- Discovery


def discover(sponsor_name: str, extra_tokens: list[tuple[str, str]] | None = None) -> list[dict]:
    found = []
    tries = list(extra_tokens or [])
    for tok in candidates(sponsor_name):
        for ats in ATS:
            tries.append((ats, tok))
    seen_ats = set()
    for ats, tok in tries:
        if ats in seen_ats or (ats == "lever_eu" and "lever" in seen_ats):
            continue
        res = ATS[ats][0](tok)
        if res is False:
            continue
        if not name_match(sponsor_name, res):
            continue
        found.append({"ats": ats, "token": tok})
        seen_ats.add(ats)
    return found


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def run():
    sponsors, register_url = load_sponsors()
    cache: dict = load_json(CACHE_PATH, {})
    seeds: dict = load_json(SEED_PATH, {})  # {"Sponsor name as on register": [{"ats":..,"token":..}]}

    # Seeds: map to register keys and probe explicitly
    seed_jobs = {}
    for sname, boards in seeds.items():
        if sname.startswith("_"):
            continue
        key = norm_name(sname)
        if key not in sponsors:  # allow "Monzo" to match "Monzo Bank Limited"
            pref = sorted((k for k in sponsors if k.startswith(key + " ")), key=len)
            key = pref[0] if pref else None
        if key:
            seed_jobs[key] = [(b["ats"], b["token"]) for b in boards]

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
    # never-checked first, then oldest negative
    todo.sort(key=lambda k: (k in cache, cache.get(k, {}).get("checked", "")))
    todo = [k for k in todo if k in seed_jobs] + [k for k in todo if k not in seed_jobs]
    batch = todo[:DISCOVERY_BATCH]
    print(f"Discovery batch: {len(batch):,} of {len(todo):,} pending")

    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(discover, sponsors[k]["name"], seed_jobs.get(k)): k for k in batch}
        for i, f in enumerate(as_completed(futs), 1):
            k = futs[f]
            try:
                cache[k] = {"checked": NOW.isoformat(), "boards": f.result()}
            except Exception as e:
                print(f"  discover error {k}: {e}", file=sys.stderr)
            if i % 500 == 0:
                print(f"  probed {i:,}")

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
                    "ty": j.get("type"),
                    "d": j.get("dept"),
                    "s": j.get("salary"),
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
    }, indent=1))
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, separators=(",", ":"), sort_keys=True))
    print(f"Done: {len(jobs):,} UK jobs from {payload['companies']:,} sponsors "
          f"({checked:,}/{len(sponsors):,} sponsors checked so far)")


if __name__ == "__main__":
    run()
