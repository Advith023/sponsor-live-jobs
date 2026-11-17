# Sponsor Scout by Advith Ashok (github.com/Advith023/sponsor-live-jobs). Copyright (c) 2026 Advith Ashok. All rights reserved. Not licensed for reuse; see LICENSE.
"""Apply the control centre's Hide decisions to the published jobs straight away.

The full refresh applies data/title_rules.json too, but it only runs twice a day.
This runs in seconds whenever the rules change, so a Hide shows on the site
within a couple of minutes. It only hides; Keep and Undo take effect on the
next full refresh, because the original reason a job was hidden isn't stored.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import eligibility

JOBS = Path(__file__).resolve().parent.parent / "site" / "data" / "jobs.json"


def main() -> int:
    data = json.loads(JOBS.read_text())
    index = eligibility.apply_rules({}, eligibility.load_rules())
    changed = 0
    for j in data.get("jobs", []):
        if j.get("el") == "u":
            continue
        el, _ = eligibility.classify(j.get("t", ""), index)
        if el == "u":
            j["el"] = "u"
            changed += 1
    if changed:
        JOBS.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"Hidden by owner rules: {changed} more jobs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
