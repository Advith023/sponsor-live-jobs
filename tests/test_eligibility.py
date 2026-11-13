# SponsorLive by Advith Ashok (github.com/Advith023/sponsor-live-jobs). Copyright (c) 2026 Advith Ashok. All rights reserved. Not licensed for reuse; see LICENSE.
"""Offline tests for the eligibility labels. The HTML below copies the layout
of the gov.uk pages (heading per table, code and name in the first cell,
bulleted example titles, a leading <br> in Table 6 cells)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import eligibility as el  # noqa: E402

APPENDIX = """
<h2 id="table-1-occupations">Table 1: Eligible occupations and going rates</h2>
<table><thead><tr><th>Occupation code</th><th>Examples of related job titles</th><th>Going rate</th></tr></thead>
<tbody>
<tr><td>2134 Programmers and software development professionals</td><td>• Computer games designers<br> • Software developers<br> • Programmers and software development professionals not elsewhere classified</td><td>£49,400</td></tr>
<tr><td>2237 Other registered nursing professionals</td><td>• Nurse<br> • Staff nurse<br> • Team leader (nursing)</td><td>£31,300</td></tr>
<tr><td>2431 Management consultants and business analysts</td><td>• Business analysts and consultants<br> • Risk analysts</td><td>£52,000</td></tr>
</tbody></table>
<h2 id="table-2a-transitional">Table 2a: Transitional occupations</h2>
<table><tbody>
<tr><td>3544 Data analysts</td><td>• Data analysts</td><td>£35,000</td></tr>
<tr><td>1150 Managers and directors in retail and wholesale</td><td>• Managers and directors in retail and wholesale</td><td>£40,000</td></tr>
<tr><td>5434 Chefs</td><td>• Chefs</td><td>£30,000</td></tr>
</tbody></table>
<h2 id="table-4-pay">Table 4: Pay scales</h2>
<table><tbody><tr><td>1111 Not an occupation table</td><td>• Ignore me</td></tr></tbody></table>
<h2 id="table-6-ineligible">Table 6: Occupations not eligible</h2>
<table><tbody>
<tr><td>7111 Sales and retail assistants</td><td>
<br>• Retail assistant<br> • Sales assistant<br> • Shop assistant</td></tr>
<tr><td>8214 Delivery drivers and couriers</td><td>
<br>• Delivery driver<br> • Van driver<br> • Courier-driver</td></tr>
<tr><td>8120 Metal working machine operatives</td><td>
<br>• Engineer (nos)<br> • Machinist (metal trades)</td></tr>
<tr><td>9223 Cleaners and domestics</td><td>
<br>• Cleaner<br> • Domestic</td></tr>
</tbody></table>
"""

TSL = """
<table><thead><tr><th>Occupation code</th><th>Occupation</th><th>Going rate</th></tr></thead>
<tbody>
<tr><th scope="row">1243</th><td>Managers in logistics</td><td>£44,900</td></tr>
<tr><th scope="row">3544</th><td>Data analysts</td><td>£35,000</td></tr>
</tbody></table>
"""


def data():
    return {"occupations": el.parse_appendix(APPENDIX), "tsl": el.parse_tsl(TSL)}


def test_parse_tables():
    d = data()
    occ = d["occupations"]
    assert set(occ) == {"2134", "2237", "2431", "3544", "1150", "5434", "7111", "8214", "8120", "9223"}
    assert occ["2134"]["g"] == ["eligible"] and "Software developers" in occ["2134"]["t"]
    assert occ["7111"]["g"] == ["not_eligible"] and occ["7111"]["t"][0] == "Retail assistant"
    assert occ["3544"]["n"] == "Data analysts"
    assert d["tsl"] == ["1243", "3544"]


def test_labels():
    idx = el.build_index(data())
    cases = {
        "Senior Software Developer": "e",
        "Software Engineer II - Payments": "e",
        "Registered Nurse - Nights": "e",
        "Business Analyst": "e",
        "Data Analyst (12 month FTC)": "s",
        "Customer Assistant": "u",
        "Sainsbury's - Customer Assistant - Camden": "u",
        "Retail Assistant, Part Time": "u",
        "Delivery Driver": "u",
        "Chef de Partie": "u",
        "Sous Chef": "u",
        "Cleaner": "u",
        "Picker / Packer": "u",
        "Store Manager": "u",
        "Graduate Software Engineering Apprentice": "u",
        "Summer Internship 2026": "u",
        "Engineer": None,                # too vague on its own
        "Domestic Gas Engineer": None,
        "Sales Assistant Manager": None, # role is a manager, not an assistant
        "Head of Customer Assistants Programme": None,
        "Software Developer in Test": "e",
        "Front-End Engineer": "e",
        "Nursery Nurse": "u",
        "Chief Information Security Officer (CISO)": "e",
    }
    for title, want in cases.items():
        assert el.classify(title, idx)[0] == want, title


def test_codes_never_in_labels():
    idx = el.build_index(data())
    assert set(idx.values()) <= {"e", "s", "u"}


def test_refresh_keeps_old_on_bad_page(tmp_path):
    p = tmp_path / "occ.json"
    p.write_text('{"occupations": {"2134": {"n": "x", "t": [], "g": ["eligible"]}}, "tsl": []}')
    out = el.refresh(lambda url, as_json=False: "<html>changed layout</html>", p)
    assert "2134" in out["occupations"]


def test_no_data_means_no_labels():
    assert el.classify("Customer Assistant", el.build_index({})) == (None, None)
