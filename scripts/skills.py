# SponsorLive by Advith Ashok (github.com/Advith023/sponsor-live-jobs). Copyright (c) 2026 Advith Ashok. All rights reserved. Not licensed for reuse; see LICENSE.
"""Skills vocabulary shared by the scraper (job descriptions) and the website (CVs).

Each entry: canonical name, then optional aliases. Matching is case-insensitive
and requires the term not to be glued to other letters/digits, so "R" or "Go"
only match as whole words. The same patterns are exported to
site/data/skills.json so the browser matches CVs exactly the same way.
"""
import json
import re
from pathlib import Path

SKILLS = [
    # Data & analytics
    ("SQL", "postgresql", "postgres", "mysql", "t-sql", "tsql", "pl/sql", "sql server"), ("Python",), ("R", "rstudio", "tidyverse"),
    ("Excel", "microsoft excel", "vba"), ("Power BI", "powerbi"), ("Tableau",), ("Looker", "lookml"), ("Looker Studio", "data studio"),
    ("Qlik", "qlikview", "qlik sense"), ("dbt",), ("Snowflake",), ("BigQuery", "big query"), ("Redshift",), ("Databricks",),
    ("Spark", "pyspark", "apache spark"), ("Hadoop",), ("Airflow", "apache airflow"), ("Kafka", "apache kafka"),
    ("pandas",), ("NumPy",), ("scikit-learn", "sklearn"), ("TensorFlow",), ("PyTorch",), ("Keras",), ("XGBoost", "lightgbm", "catboost"),
    ("Machine learning", "ml models", "machine-learning"), ("Deep learning",), ("NLP", "natural language processing"),
    ("Computer vision",), ("LLMs", "large language models", "llm", "generative ai", "genai", "rag"),
    ("Statistics", "statistical", "statistical modelling", "statistical modeling"), ("A/B testing", "ab testing", "experimentation", "split testing"),
    ("Forecasting", "time series", "time-series"), ("Econometrics",), ("Data visualisation", "data visualization", "dashboards", "dashboarding"),
    ("Data modelling", "data modeling", "dimensional modelling", "star schema"), ("ETL", "elt", "data pipelines", "data pipeline"),
    ("Data warehousing", "data warehouse"), ("Data governance", "data quality"), ("SAS",), ("SPSS",), ("Stata",), ("MATLAB",),
    ("Alteryx",), ("Google Analytics", "ga4"), ("Mixpanel", "amplitude"), ("Jupyter",),
    # Software
    ("Java",), ("JavaScript", "js", "ecmascript"), ("TypeScript",), ("Go", "golang"), ("Rust",), ("C++", "cpp"), ("C#", ".net", "dotnet", "asp.net"),
    ("Kotlin",), ("Swift",), ("Scala",), ("Ruby", "ruby on rails", "rails"), ("PHP", "laravel"), ("Elixir",),
    ("React", "react.js", "reactjs"), ("Vue", "vue.js"), ("Angular",), ("Node.js", "nodejs", "node"), ("Django",), ("Flask",), ("FastAPI",),
    ("Spring", "spring boot"), ("GraphQL",), ("REST APIs", "rest api", "restful", "apis"), ("Microservices",),
    ("AWS", "amazon web services", "ec2", "s3", "lambda"), ("Azure", "microsoft azure"), ("GCP", "google cloud"),
    ("Docker",), ("Kubernetes", "k8s"), ("Terraform",), ("CI/CD", "ci cd", "github actions", "jenkins", "gitlab ci"), ("Git", "github", "gitlab"),
    ("Linux", "unix", "bash"), ("MongoDB",), ("Redis",), ("Elasticsearch",), ("iOS",), ("Android",), ("HTML", "css"),
    ("Cybersecurity", "information security", "infosec", "security engineering"), ("Penetration testing", "pen testing"),
    ("SRE", "site reliability"), ("DevOps",), ("Test automation", "automated testing", "selenium", "cypress", "playwright"),
    # Product, design, delivery
    ("Product management", "product manager", "roadmap", "roadmapping"), ("Agile", "scrum", "kanban"), ("Jira", "confluence"),
    ("User research", "usability testing"), ("Figma",), ("UX design", "ux", "user experience"), ("UI design", "ui", "interaction design"),
    ("Project management", "prince2", "pmp"), ("Stakeholder management", "stakeholders"), ("Programme management", "program management"),
    # Finance & risk
    ("Financial modelling", "financial modeling", "financial models"), ("FP&A", "fp and a", "financial planning"), ("Budgeting",),
    ("Accounting", "ifrs", "gaap", "reconciliations", "month-end", "month end"), ("ACA", "acca", "cima", "chartered accountant"),
    ("Audit",), ("Tax",), ("Treasury",), ("Credit risk",), ("Market risk",), ("Risk management",), ("Valuation", "dcf"),
    ("Investment banking", "m&a"), ("Payments", "card payments"), ("Fraud", "fraud prevention"), ("AML", "anti-money laundering", "kyc", "financial crime"),
    ("Regulatory compliance", "fca", "pra", "regulatory reporting"), ("Actuarial",), ("Bloomberg",),
    # Business
    ("Sales", "business development", "new business"), ("Account management",), ("Salesforce",), ("HubSpot",), ("CRM",),
    ("SaaS",), ("Negotiation",), ("Customer success",), ("Marketing", "digital marketing"), ("SEO",), ("PPC", "paid search", "google ads"),
    ("Content marketing", "copywriting"), ("Social media",), ("Operations", "operational excellence"), ("Supply chain", "logistics", "procurement"),
    ("Demand planning", "s&op", "sales and operations planning", "capacity planning"), ("Lean", "six sigma", "continuous improvement"),
    ("Recruitment", "talent acquisition"), ("HR", "human resources", "employee relations"), ("Legal", "contract law", "commercial contracts"),
    ("Customer service", "customer support"), ("Leadership", "people management", "line management", "team lead"),
    ("Communication", "presentation skills", "communication skills"), ("Consulting", "management consulting"),
    # Engineering / health / education
    ("CAD", "autocad", "solidworks"), ("Mechanical engineering",), ("Electrical engineering",), ("Civil engineering",),
    ("Embedded systems", "firmware", "embedded software", "embedded c"), ("Nursing", "nmc", "registered nurse"), ("Clinical", "nhs"), ("Pharmacy",),
    ("Teaching", "qts"), ("Research", "phd"),
    # Languages
    ("French",), ("German",), ("Spanish",), ("Italian",), ("Dutch",), ("Portuguese",), ("Mandarin", "chinese"), ("Arabic",), ("Hindi",), ("Japanese",),
]


def _term(t: str) -> str:
    return r"(?<![a-z0-9])" + re.escape(t.lower()).replace(r"\ ", r"[\s\-]+") + r"(?![a-z0-9+#])"


PATTERNS = [(names[0], "(?:" + "|".join(_term(n) for n in sorted(names, key=len, reverse=True)) + ")") for names in SKILLS]
COMPILED = [re.compile(p) for _, p in PATTERNS]
# Short or ambiguous terms: (case-sensitive pattern, case-insensitive pattern), either may match.
SPECIAL = {
    "R": (r"(?<![A-Za-z0-9])R(?![A-Za-z0-9+#&])", r"(?<![a-z0-9])(?:rstudio|tidyverse)(?![a-z0-9])"),
    "Go": (r"(?<![A-Za-z0-9-])Go(?![A-Za-z0-9-])(?!\s+(?:[Tt]o|[Ll]ive|[Ff]urther|[Bb]eyond|[Aa]head)\b)", r"(?<![a-z0-9])golang(?![a-z0-9])"),
    "UI design": (r"(?<![A-Za-z0-9])UI(?![A-Za-z0-9])", r"(?<![a-z0-9])(?:ui design|interaction design)(?![a-z0-9])"),
    "Swift": (r"(?<![A-Za-z0-9])Swift(?![A-Za-z0-9])", None),
    "Node.js": (r"(?<![A-Za-z0-9])Node(?![A-Za-z0-9])", r"(?<![a-z0-9])(?:node\.js|nodejs)(?![a-z0-9])"),
    "HR": (r"(?<![A-Za-z0-9])HR(?![A-Za-z0-9])", r"(?<![a-z0-9])(?:human resources|employee relations)(?![a-z0-9])"),
    "UX design": (r"(?<![A-Za-z0-9])UX(?![A-Za-z0-9])", r"(?<![a-z0-9])(?:ux design|user experience)(?![a-z0-9])"),
    "Legal": (None, r"(?<![a-z0-9])(?:legal counsel|lawyer|solicitor|contract law|commercial contracts)(?![a-z0-9])"),
    "Research": (None, r"(?<![a-z0-9])(?:phd|research methods|qualitative research|quantitative research)(?![a-z0-9])"),
    "Communication": (None, r"(?<![a-z0-9])(?:presentation skills|communication skills|written and verbal)(?![a-z0-9])"),
    "Leadership": (None, r"(?<![a-z0-9])(?:people management|line management|team leadership|managing a team|leadership)(?![a-z0-9])"),
}
_SPECIAL_RX = {k: (re.compile(a) if a else None, re.compile(b) if b else None) for k, (a, b) in SPECIAL.items()}


def extract(text: str) -> list[int]:
    """Return sorted indices of SKILLS found in text."""
    if not text:
        return []
    low = text.lower()
    found = []
    for i, (name, _) in enumerate(PATTERNS):
        if name in _SPECIAL_RX:
            cs, ci = _SPECIAL_RX[name]
            hit = (cs and cs.search(text)) or (ci and ci.search(low))
        else:
            hit = COMPILED[i].search(low)
        if hit:
            found.append(i)
    return found


GENERIC = {"Recruitment", "Customer service", "Social media", "Leadership", "Communication", "HR", "Legal", "Research",
           "Operations", "Sales", "Marketing", "Consulting", "Account management", "CRM", "Negotiation", "Customer success",
           "Agile", "Jira", "Stakeholder management", "Project management", "Teaching", "Clinical"}


def export(path: Path):
    """Write the vocabulary for the browser. Patterns are JS RegExp-compatible."""
    out = []
    for name, p in PATTERNS:
        if name in SPECIAL:
            cs, ci = SPECIAL[name]
            out.append({"n": name, "cs": cs, "ci": ci})
        else:
            out.append({"n": name, "ci": p})
        if name in GENERIC:
            out[-1]["g"] = 1
    path.write_text(json.dumps({"v": 1, "skills": out}, separators=(",", ":")))


def strip_html(html: str) -> str:
    import html as h
    return h.unescape(re.sub(r"<[^>]+>", " ", h.unescape(html or "")))


# ---------------------------------------------------------------- Experience

_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_YEARS_RE = re.compile(
    r"(?:at\s+least|minimum(?:\s+of)?|min\.?|over|more\s+than|\b)\s*"
    r"(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+|plus)?\s*"
    r"(?:(?:-|to|–|—)\s*\d{1,2}\s*\+?\s*)?"
    r"(?:\(\d{1,2}\)\s*)?(?:years?|yrs?)['’]?\s*(?:of\s+)?(?:[\w&/+#-]+\s+){0,6}?(?:experience|exp\b|in\s+a\s+similar)", re.I)
_YEARS_AFTER_RE = re.compile(r"experience[^.;\n]{0,40}?\(?\s*(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|to|\u2013)\s*\d{1,2}\s*)?(?:years?|yrs?)\b", re.I)
_YEARS_NOT = re.compile(r"years?\s+old|anniversar|founded|in business|been around", re.I)


def min_years(text: str) -> int | None:
    """Smallest 'N+ years ... experience' requirement found in a job description, or None."""
    found = []
    for m in _YEARS_RE.finditer(text or ""):
        if _YEARS_NOT.search(text[max(0, m.start() - 25):m.end() + 30]) and not re.search(r"experience", text[m.start():m.end()], re.I):
            continue
        raw = m.group(1).lower()
        n = _NUM.get(raw) or (int(raw) if raw.isdigit() else 0)
        if 1 <= n <= 20:
            found.append(n)
    for m in _YEARS_AFTER_RE.finditer(text or ""):
        n = int(m.group(1))
        if 1 <= n <= 20:
            found.append(n)
    return min(found) if found else None


_LEVELS = [
    ("Entry", r"\b(intern(ship)?|graduate|grad|junior|jnr|entry[- ]level|apprentice|trainee|placement|associate)\b"),
    ("Director", r"\b(director|vp|vice president|head of|chief|cto|cfo|ceo|coo)\b"),
    ("Lead", r"\b(staff|principal|lead)\b"),
    ("Senior", r"\b(senior|snr|sr\.?)\b"),
]


def level(title: str) -> str | None:
    for name, pat in _LEVELS:
        if re.search(pat, title or "", re.I):
            return name
    return None
