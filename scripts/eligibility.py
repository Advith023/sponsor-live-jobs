"""Skilled Worker eligibility check for job titles.

SponsorLive by Advith Ashok. All rights reserved.

Licensed sponsors also post roles that cannot be sponsored on the Skilled
Worker route (customer assistants, drivers, cleaners and so on). This module
reads the official occupation tables published by the Home Office and gives
each job title one of four labels:

  "e"  the title matches an occupation in the eligible tables
  "s"  the occupation is only eligible because it is on the Temporary
       Shortage List
  "u"  the occupation is below the skill level or in the not eligible table,
       so the role is unlikely to qualify
  None no confident match, so the job is shown as normal

Occupation codes stay inside this module and data/occupations.json. They are
never written to the site. Matching is deliberately cautious: a job is only
marked "u" when the end of its title (the part that names the role) matches
an official job title or one of the curated phrases below. Anything else is
left unlabelled and stays visible.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

APPENDIX_URL = ("https://www.gov.uk/guidance/immigration-rules/"
                "immigration-rules-appendix-skilled-occupations")
TSL_URL = ("https://www.gov.uk/government/publications/"
           "skilled-worker-visa-temporary-shortage-list/"
           "skilled-worker-visa-temporary-shortage-list")
SNAPSHOT = Path(__file__).resolve().parent.parent / "data" / "occupations.json"

# Appendix Skilled Occupations table numbers and what they mean for a new
# Skilled Worker application. Tables 4 and 5 are pay scales, not occupations.
TABLE_GROUPS = {
    "1": "eligible", "2": "eligible", "3": "eligible",
    "1a": "transitional", "2aa": "transitional", "2a": "transitional",
    "2b": "transitional", "3a": "transitional",
    "6": "not_eligible",
}
MIN_CODES = 300      # sanity checks before a fresh parse replaces the snapshot
MIN_TSL = 30


# --------------------------------------------------------------------------
# Reading the gov.uk pages
# --------------------------------------------------------------------------
class _Tables(HTMLParser):
    """Collects every table on the page with the 'Table N:' heading above it."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.label = None
        self.heading = None
        self.tables = []      # (label, rows)
        self.rows = None
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag in ("h2", "h3"):
            self.heading = []
        elif tag == "table":
            self.rows = []
        elif tag == "tr" and self.rows is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
        elif tag == "br" and self.cell is not None:
            self.cell.append("\n")

    def handle_endtag(self, tag):
        if tag in ("h2", "h3") and self.heading is not None:
            text = " ".join("".join(self.heading).split())
            m = re.match(r"Table\s+([0-9]+[a-z]*)\s*:", text, re.I)
            if m:
                self.label = m.group(1).lower()
            self.heading = None
        elif tag in ("td", "th") and self.cell is not None:
            self.row.append("".join(self.cell))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None
        elif tag == "table" and self.rows is not None:
            self.tables.append((self.label, self.rows))
            self.rows = None

    def handle_data(self, data):
        if self.heading is not None:
            self.heading.append(data)
        if self.cell is not None:
            self.cell.append(data)


def _clean(s: str) -> str:
    return " ".join(s.split())


def parse_appendix(html: str) -> dict:
    """{code: {"n": name, "t": [related titles], "g": [groups]}}"""
    p = _Tables()
    p.feed(html)
    occ: dict = {}
    for label, rows in p.tables:
        group = TABLE_GROUPS.get(label or "")
        if not group:
            continue
        for row in rows:
            m = re.match(r"\s*(\d{4})\s+(.+)", row[0], re.S)
            if not m:
                continue
            code = m.group(1)
            name = _clean(m.group(2)).split("Note:")[0]
            name = re.sub(r"\s*[–-]\s*(Jobs with|ONLY)\b.*$", "", name).strip()
            cell = next((c for c in row[1:] if "•" in c), "")
            titles = [_clean(t) for t in cell.split("•") if _clean(t)]
            o = occ.setdefault(code, {"n": name, "t": [], "g": []})
            if group not in o["g"]:
                o["g"].append(group)
            for t in titles:
                if t not in o["t"]:
                    o["t"].append(t)
    return occ


def parse_tsl(html: str) -> list:
    p = _Tables()
    p.feed(html)
    codes = set()
    for _, rows in p.tables:
        for row in rows:
            if re.fullmatch(r"\s*\d{4}\s*", row[0]):
                codes.add(row[0].strip())
    return sorted(codes)


def refresh(http_get, path: Path = SNAPSHOT) -> dict:
    """Fetch both pages and update the snapshot. Keeps the old one on failure."""
    old = load(path)
    try:
        occ = parse_appendix(http_get(APPENDIX_URL, as_json=False) or "")
        tsl = parse_tsl(http_get(TSL_URL, as_json=False) or "")
        groups = [g for o in occ.values() for g in o["g"]]
        if (len(occ) < MIN_CODES or len(tsl) < MIN_TSL
                or groups.count("eligible") < 100 or groups.count("not_eligible") < 50):
            raise ValueError(f"parse looks wrong: {len(occ)} codes, {len(tsl)} shortage codes")
    except Exception as e:  # network or layout change: keep the last good copy
        print(f"  occupations: keeping previous list ({e})")
        return old
    data = {
        "note": "Parsed from the Home Office pages below. Used only to label job titles.",
        "sources": [APPENDIX_URL, TSL_URL],
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "tsl": tsl,
        "occupations": occ,
    }
    if {k: v for k, v in data.items() if k != "fetched"} != {k: v for k, v in old.items() if k != "fetched"}:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=1, ensure_ascii=False))
        print(f"  occupations: {len(occ)} codes, {len(tsl)} on the shortage list (updated)")
    else:
        print(f"  occupations: {len(occ)} codes, {len(tsl)} on the shortage list (unchanged)")
    return data


def load(path: Path = SNAPSHOT) -> dict:
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


# --------------------------------------------------------------------------
# Matching job titles
# --------------------------------------------------------------------------
# Single words too vague to decide anything on their own.
GENERIC = {
    "engineer", "manager", "director", "officer", "assistant", "worker", "operator",
    "technician", "analyst", "consultant", "adviser", "advisor", "administrator",
    "specialist", "executive", "agent", "supervisor", "coordinator", "controller",
    "therapist", "domestic", "escort", "messenger", "dispenser", "model", "associate",
    "lead", "leader", "partner", "member", "representative", "designer", "developer",
    "scientist", "practitioner", "professional", "trainer", "inspector", "clerk",
}
# Official example titles that are too ambiguous outside their original context.
IGNORE_OFFICIAL = {
    "communications officer", "production assistant", "transport supervisor",
    "lifestyle manager", "guest service manager", "operations assistant",
    "data administrator", "general assistant", "team member", "supply chain coordinator",
    "material controller", "hire controller", "laser operator", "plant operator",
}

# Curated phrases for common job-board titles that the official lists do not
# spell out. These take priority over the official titles.
EXTRA = {
    "u": [
        # retail and grocery
        "customer assistant", "customer service assistant", "retail assistant",
        "store assistant", "shop assistant", "shop floor assistant", "sales floor assistant",
        "sales associate", "retail associate", "store associate", "retail colleague",
        "store colleague", "shop colleague", "night colleague", "customer colleague",
        "retail team member", "store team member", "customer team member",
        "cashier", "checkout assistant", "checkout operator", "checkout colleague",
        "till operator", "shelf stacker", "replenishment assistant", "replenishment colleague",
        "stock assistant", "stock colleague", "stockroom assistant", "night shift assistant",
        "personal shopper", "online shopper", "online personal shopper", "trading assistant",
        "bakery assistant", "bakery colleague", "counter assistant", "deli assistant",
        "pharmacy assistant", "pharmacy colleague", "optical assistant",
        "store manager", "assistant store manager", "deputy store manager", "shop manager",
        "retail manager", "store supervisor", "retail supervisor",
        "shift manager", "shift leader", "shift supervisor", "duty manager",
        # warehouse and driving
        "picker", "packer", "picker packer", "order picker", "warehouse operative",
        "warehouse associate", "warehouse assistant", "warehouse colleague",
        "warehouse team member", "warehouse operator", "fulfilment associate",
        "fulfilment assistant", "fulfilment colleague", "warehouse picker",
        "delivery driver", "home delivery driver", "van driver", "hgv driver", "lgv driver",
        "class 1 driver", "class 2 driver", "tonne driver", "driver", "courier",
        "delivery assistant", "forklift driver", "forklift operator", "reach truck driver",
        # hospitality and cleaning
        "cleaner", "housekeeper", "room attendant", "kitchen porter", "kitchen assistant",
        "kitchen team member", "catering assistant", "food and beverage assistant",
        "barista", "waiter", "waitress", "bartender", "bar staff", "bar team member",
        "crew member", "team member", "front of house", "front of house team member",
        "server", "host", "hostess", "runner", "food runner", "chef", "chef de partie", "cook",
        "restaurant manager", "assistant restaurant manager", "bar manager", "kitchen manager",
        "catering manager", "cafe manager", "hotel manager",
        # care, support and education
        "care assistant", "care worker", "carer", "support worker", "healthcare assistant",
        "health care assistant", "senior care assistant", "senior carer",
        "teaching assistant", "learning support assistant", "nursery nurse",
        "nursery practitioner", "early years practitioner", "early years educator",
        "nursery assistant", "home manager", "registered manager",
        # contact centre and admin
        "customer service advisor", "customer service adviser", "customer service representative",
        "customer service agent", "customer service executive", "customer service associate",
        "customer service specialist", "customer service colleague", "customer advisor",
        "customer adviser", "customer support advisor", "customer support adviser",
        "customer support agent", "customer support representative", "contact centre advisor",
        "contact centre adviser", "contact centre agent", "call centre agent", "call handler",
        "receptionist", "administrative assistant", "admin assistant", "office administrator",
        "administration assistant", "security officer", "security guard", "door supervisor",
    ],
    "s": [
        "data analyst", "business intelligence analyst", "bi analyst", "insight analyst",
        "insights analyst", "reporting analyst", "mi analyst", "recruiter",
        "talent acquisition partner", "talent acquisition specialist",
        "talent acquisition advisor", "recruitment consultant", "recruitment advisor",
        "hr advisor", "hr adviser", "human resources advisor", "people advisor",
        "sales executive", "underwriter", "copywriter", "translator", "interpreter",
    ],
    "e": [
        "software engineer", "software developer", "backend engineer", "back end engineer",
        "frontend engineer", "front end engineer", "fullstack engineer", "full stack engineer",
        "backend developer", "back end developer", "frontend developer", "front end developer",
        "fullstack developer", "full stack developer", "web developer", "mobile engineer",
        "mobile developer", "ios engineer", "ios developer", "android engineer",
        "android developer", "data scientist", "machine learning engineer", "ml engineer",
        "ai engineer", "research scientist", "applied scientist", "research engineer",
        "data engineer", "analytics engineer", "platform engineer", "cloud engineer",
        "infrastructure engineer", "site reliability engineer", "sre", "devops engineer",
        "security engineer", "network engineer", "systems engineer", "solutions architect",
        "software architect", "data architect", "cloud architect", "enterprise architect",
        "engineering manager", "product manager", "product owner", "product designer",
        "ux designer", "ui designer", "ux researcher", "user researcher", "qa engineer",
        "test engineer", "quality engineer", "automation engineer", "quantitative analyst",
        "quantitative researcher", "quantitative developer", "quant", "actuary",
        "actuarial analyst", "solicitor", "associate solicitor", "lawyer", "accountant",
        "chartered accountant", "auditor", "economist", "statistician", "mechanical engineer",
        "electrical engineer", "civil engineer", "structural engineer", "chemical engineer",
        "process engineer", "manufacturing engineer", "design engineer", "project engineer",
        "validation engineer", "controls engineer", "project manager", "programme manager",
        "program manager", "scrum master", "delivery manager", "business analyst",
        "financial analyst", "finance manager", "marketing manager", "risk analyst",
        "credit analyst", "investment analyst",
    ],
}

NOISE = {
    "i", "ii", "iii", "iv", "v", "1", "2", "3", "level", "grade", "nights", "night",
    "days", "weekend", "weekends", "evening", "evenings", "part", "time", "full",
    "temporary", "temp", "seasonal", "fixed", "term", "contract", "permanent", "ftc",
    "maternity", "cover", "uk", "london", "remote", "hybrid",
}
ANYWHERE_U = re.compile(
    r"\b(apprentice(ship)?s?|intern(ship)?s?|work experience|industrial placement|"
    r"placement student|summer placement|volunteer)\b", re.I)
CONNECTORS = {"in", "for", "at", "with", "within", "on", "to"}


def _sing(w: str) -> str:
    if len(w) > 3 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def tokens(text: str) -> list:
    text = text.lower().replace("’", "'").replace("healthcare", "health care")
    text = re.sub(r"\bhr\b", "human resources", text)
    text = re.sub(r"\bq\.?a\b", "quality assurance", text)
    return [_sing(w) for w in re.findall(r"[a-z0-9]+", text.replace("'", ""))]


def _variants(title: str) -> list:
    """Official example titles to plain phrases ("Sales and retail assistants"
    gives "sales assistants" and "retail assistants")."""
    t = re.sub(r"\bnot elsewhere classified\b", "", title, flags=re.I)
    t = re.sub(r"\(excludes[^)]*\)", "", t, flags=re.I)
    m = re.search(r"\(([^)]*)\)", t)
    if m:
        if m.group(1).strip().lower() not in ("professional", "qualified"):
            return []
        t = t.replace(m.group(0), "")
    out = set()
    for alt in _slash_alts(t):
        words = alt.split()
        if not words:
            continue
        head = words[-1]
        parts = [p.strip() for p in re.split(r",|\band\b", alt) if p.strip()]
        out.add(alt.strip())
        if len(parts) > 1:
            for p in parts:
                if len(p.split()) > 1:
                    out.add(p)
                if not p.endswith(head):
                    out.add(p + " " + head)
    return [v for v in out if v]


def _slash_alts(t: str) -> list:
    m = re.search(r"(\w+)/(\w+)", t)
    if not m:
        return [t]
    return [t.replace(m.group(0), m.group(1)), t.replace(m.group(0), m.group(2))]


_RANK = {"e": 3, "s": 2, "u": 1}


def build_index(data: dict) -> dict:
    """phrase tuple -> label"""
    occ = data.get("occupations") or {}
    tsl = set(data.get("tsl") or [])
    index: dict = {}
    for code, o in occ.items():
        g = o.get("g") or []
        label = "e" if "eligible" in g else ("s" if code in tsl and "transitional" in g else "u")
        for title in list(o.get("t") or []) + [o.get("n") or ""]:
            for v in _variants(title):
                key = tuple(tokens(v))
                if not key or " ".join(key) in IGNORE_OFFICIAL:
                    continue
                if len(key) == 1 and key[0] in GENERIC:
                    continue
                if key not in index or _RANK[label] > _RANK[index[key]]:
                    index[key] = label
    if not occ:
        return index
    for label, phrases in EXTRA.items():   # curated phrases win over official ones
        for p in phrases:
            index[tuple(tokens(p))] = label
    return index


def _segments(title: str) -> list:
    t = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", title)
    segs = re.split(r"\s[-–—|]\s|[|,:;]|\s[-–—]|[-–—]\s", t)
    out = []
    for s in segs:
        for alt in s.split("/"):
            if alt.strip():
                out.append(alt.strip())
    return out


def _core(seg: str) -> list:
    toks = tokens(seg)
    for i, w in enumerate(toks):          # "Developer in Test" -> "developer"
        if w in CONNECTORS and i > 0:
            toks = toks[:i]
            break
    while toks and (toks[-1] in NOISE or toks[-1].isdigit()):
        toks.pop()
    return toks


def classify(title: str, index: dict):
    """Return (label, matched phrase) or (None, None)."""
    if not index or not title:
        return None, None
    if ANYWHERE_U.search(title):
        return "u", "apprentice/intern"
    found = []
    for seg in _segments(title):
        toks = _core(seg)
        # Only the end of the title names the role, so match suffixes only,
        # longest first. "Sainsbury's - Customer Assistant" is tried segment
        # by segment until one matches.
        for i in range(len(toks)):
            key = tuple(toks[i:])
            if key in index:
                found.append((index[key], " ".join(key)))
                break
        if found:
            break
    return found[0] if found else (None, None)


if __name__ == "__main__":   # python scripts/eligibility.py  -> update the snapshot only
    import fetch_jobs
    refresh(fetch_jobs.http_get)
