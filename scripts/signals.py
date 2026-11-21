# Sponsor Scout by Advith Ashok (github.com/Advith023/sponsor-live-jobs). Copyright (c) 2026 Advith Ashok. All rights reserved. Not licensed for reuse; see LICENSE.
"""Warning signs that a live role probably can't be sponsored.

Each job gets short codes in "f". Nothing is hidden because of a code unless the
owner turns on "Always hide" for it in the control centre (title_rules.json →
"auto_hide"). The control centre's "Needs a look" panel lists them with advice.

  ns   the advert says it can't sponsor, or asks for existing right to work
  pt   part-time
  tmp  seasonal, Christmas temp, casual, freelance, zero-hours or bank shifts
  hr   pay quoted per hour, below what a full-time sponsored role needs
"""
from __future__ import annotations

import re

# £41,700 a year over 37.5 hours a week, 52 weeks
HOURLY_NEEDED = 21.38

_NO_SPONSOR = re.compile(
    r"(unable|not able|cannot|can't|can not|do not|don't|does not|doesn't|will not|won't|are not|aren't|is not|isn't|not)"
    r"\s+(?:currently\s+|presently\s+)?(?:in a position\s+)?(?:to\s+)?(?:able\s+to\s+)?(?:offer|provide|support|sponsor|consider)\w*"
    r"(?:\s+(?:any|visa|work|employment|uk|candidates?|applicants?|for|with|a|the))*\s+(?:visa\s+)?sponsor"
    r"|\bno\s+(?:visa\s+|work\s+permit\s+)?sponsorship"
    r"|sponsorship\s+(?:is\s+)?(?:not|un)\s*(?:available|offered|provided|possible)"
    r"|\b(?:not|never)\s+(?:currently\s+)?(?:require|need)\s+(?:visa\s+|work\s+)?sponsorship"
    r"|without\s+(?:the\s+need\s+for\s+|requiring\s+)?(?:visa\s+)?sponsorship"
    r"|must\s+(?:already\s+)?(?:have|hold|possess)\s+(?:the\s+|an?\s+)?(?:full\s+|existing\s+|current\s+|valid\s+|unrestricted\s+)*right\s+to\s+work\s+in\s+the\s+uk\s+without",
    re.I)
_PART_TIME = re.compile(r"\bpart[- ]?time\b|\bp/t\b|\b\d{1,2}\s*(?:hrs?|hours)\s*(?:per|a|/)?\s*(?:week|wk|pw)?\b", re.I)
_TEMP = re.compile(r"\bfreelance\b|\bseasonal\b|\bchristmas\b|\bfestive\b|\bxmas\b|\btemp\b|\bzero[- ]hours?\b|\bcasual\b"
                   r"|\bbank\s+(?:staff|nurse|worker|shifts?|colleague|support)\b|\bholiday\s+(?:cover|season)\b", re.I)
_HOURLY = re.compile(r"£\s?(\d{1,2}(?:\.\d{1,2})?)\s*(?:per hour|an hour|p/?h\b|/\s?h(?:ou)?r\b|ph\b|hourly)", re.I)


def flags(title: str, job_type: str = "", desc: str = "", salary: str = "") -> list[str]:
    title, job_type, desc, salary = title or "", job_type or "", desc or "", salary or ""
    out = []
    if _NO_SPONSOR.search(desc) or _NO_SPONSOR.search(title):
        out.append("ns")
    if _PART_TIME.search(title) or re.search(r"part", job_type, re.I):
        if not re.search(r"full[- ]?time", title, re.I):
            out.append("pt")
    if _TEMP.search(title) or re.search(r"seasonal|casual|freelance", job_type, re.I):
        out.append("tmp")
    rates = [float(x) for x in _HOURLY.findall(f"{salary} {desc}")]
    if rates and max(rates) < HOURLY_NEEDED:
        out.append("hr")
    return out
