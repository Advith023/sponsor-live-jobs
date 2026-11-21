# Sponsor Scout by Advith Ashok (github.com/Advith023/sponsor-live-jobs). Copyright (c) 2026 Advith Ashok. All rights reserved. Not licensed for reuse; see LICENSE.
"""Apply the control centre's Hide decisions to the published jobs straight away.

Three kinds of hide, both from data/title_rules.json:
- "hide_jobs": roles visitors reported. Only that exact job is hidden (matched by
  its apply link), never other jobs with a similar title.
- "hide": title wording hidden from the Quality check panel.
- "auto_hide": warning signs (scripts/signals.py) the owner chose to always hide.

The full refresh applies both too, but it only runs twice a day. This runs in
seconds whenever the rules change, so a Hide shows on the site within a couple
of minutes. Undo of a report and turning Always hide off apply here too; Keep takes
effect on the next full refresh.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import eligibility
import signals

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


def load_auto_hide(path: Path = RULES) -> set[str]:
    """Warning signs (scripts/signals.py codes) the owner chose to always hide."""
    try:
        return set(json.loads(path.read_text()).get("auto_hide", []) or [])
    except Exception:
        return set()


def auto_codes(job: dict, auto: set[str]) -> list[str]:
    """Warning signs on this job that the owner set to Always hide."""
    if not auto:
        return []
    # Signs found in the description at the last refresh, plus any visible in the title or job type now
    found = set(job.get("f") or []) | set(signals.flags(job.get("t", ""), job.get("ty") or ""))
    return sorted(auto & found)


def decide(job: dict, reported: list[dict], auto: set[str]) -> None:
    """Apply the owner's decisions to one job, in place.
    Reported or individually hidden: "x", never shown on the site.
    Warning sign set to Always hide: "u", shown only under "Include roles unlikely to
    qualify", with the reasons in "uw" (a job with no "uw" is below the skill level)."""
    if is_reported(job, reported):
        job["el"] = "x"
        job.pop("uw", None)
        return
    codes = auto_codes(job, auto)
    if not codes:
        return
    if job.get("el") == "u":
        job["uw"] = sorted(set(job.get("uw") or ["skill"]) | set(codes))
    else:
        job["el"], job["uw"] = "u", codes


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
    auto = load_auto_hide()
    changed = 0
    for j in data.get("jobs", []):
        before = (j.get("el"), j.get("uw"))
        if j.get("el") == "x" and not is_reported(j, reported):
            j.pop("el")  # an Undo: back on the site (its visa-fit label returns at the next refresh)
        if j.get("uw"):  # start from the visa-fit result, so turning Always hide off works straight away
            if "skill" not in j["uw"]:
                j.pop("el", None)
            j.pop("uw")
        decide(j, reported, auto)
        if j.get("el") not in ("u", "x") and eligibility.classify(j.get("t", ""), index)[0] == "u":
            j["el"] = "u"
        if (j.get("el"), j.get("uw")) != before:
            changed += 1
    if changed:
        JOBS.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"Jobs changed by owner rules: {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
