# Sponsor Scout by Advith Ashok (github.com/Advith023/sponsor-live-jobs). Copyright (c) 2026 Advith Ashok. All rights reserved. Not licensed for reuse; see LICENSE.
"""Apply the control centre's Hide decisions to the published jobs straight away.

Two kinds of hide, both from data/title_rules.json:
- "hide_jobs": roles visitors reported. Only that exact job is hidden (matched by
  its apply link), never other jobs with a similar title.
- "hide": title wording hidden from the Quality check panel.

The full refresh applies both too, but it only runs twice a day. This runs in
seconds whenever the rules change, so a Hide shows on the site within a couple
of minutes. It only hides; Keep and Undo take effect on the next full refresh.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import eligibility

ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "site" / "data" / "jobs.json"
RULES = ROOT / "data" / "title_rules.json"


def _key(s: str) -> str:
    return " ".join((s or "").lower().split())


def load_reported(path: Path = RULES) -> list[dict]:
    try:
        return json.loads(path.read_text()).get("hide_jobs", []) or []
    except Exception:
        return []


def is_reported(job: dict, reported: list[dict]) -> bool:
    """True if this exact job was reported and hidden. Matched by apply link;
    reports without a link fall back to the exact title at the same company."""
    u = (job.get("u") or "").rstrip("/")
    for r in reported:
        ru = (r.get("u") or "").rstrip("/")
        if ru:
            if ru == u:
                return True
        elif r.get("t") and _key(job.get("t")).startswith(_key(r["t"])) \
                and _key(r.get("c")) in _key(f'{job.get("c")} {job.get("sp")}'):
            return True
    return False


def main() -> int:
    data = json.loads(JOBS.read_text())
    index = eligibility.apply_rules({}, eligibility.load_rules())
    reported = load_reported()
    changed = 0
    for j in data.get("jobs", []):
        if j.get("el") == "u":
            continue
        el, _ = eligibility.classify(j.get("t", ""), index)
        if el == "u" or is_reported(j, reported):
            j["el"] = "u"
            changed += 1
    if changed:
        JOBS.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"Hidden by owner rules: {changed} more jobs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
