"""Offline tests for the scraper: parsing uses response shapes captured from the live platforms."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import fetch_jobs as fj  # noqa: E402
import skills  # noqa: E402


def names(idx):
    return [skills.SKILLS[i][0] for i in idx]


def test_board_from_link():
    cases = {
        "https://job-boards.greenhouse.io/monzo/jobs/8378844": ("greenhouse", "monzo"),
        "https://boards.greenhouse.io/embed/job_board?for=deliveroo": ("greenhouse", "deliveroo"),
        "https://jobs.lever.co/spotify/123": ("lever", "spotify"),
        "https://jobs.eu.lever.co/kpler": ("lever_eu", "kpler"),
        "https://jobs.ashbyhq.com/synthesia": ("ashby", "synthesia"),
        "https://apply.workable.com/acme-ltd/": ("workable", "acme-ltd"),
        "https://bunq.recruitee.com/o/some-role": ("recruitee", "bunq"),
        "https://personio.jobs.personio.de/job/1": ("personio", "personio"),
        "https://acme.teamtailor.com/jobs": ("teamtailor", "acme"),
        "https://acme.breezy.hr/": ("breezy", "acme"),
        "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x": ("workday", "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite"),
        "https://www.example.co.uk/careers": ("jsonld", "https://www.example.co.uk/careers"),
    }
    for url, (ats, tok) in cases.items():
        b = fj.board_from_link(url)
        assert (b["ats"], b["token"]) == (ats, tok), url
    assert fj.board_from_link("not a link") is None


def test_regions():
    assert fj.regions("London / United Kingdom", False) == ["London"]
    assert fj.regions("Cardiff, London or Remote (UK)", False) == ["London", "Wales", "Remote"]
    assert fj.regions("Manchester, England", True) == ["North West", "Remote"]
    assert fj.regions("London / Stockholm", False) == ["London"]
    assert fj.regions("United Kingdom", False) == ["UK (other / unspecified)"]
    assert "Scotland" in fj.regions("Edinburgh", False)


def test_skills_extract():
    t = "Senior Data Analyst. You'll use SQL, Python and R; experience with Power BI and A/B testing. Go-getter attitude."
    got = names(skills.extract(t))
    assert {"SQL", "Python", "R", "Power BI", "A/B testing"} <= set(got)
    assert "Go" not in got


def test_jsonld_parsing():
    html = """<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"JobPosting","title":"Data Engineer","datePosted":"2026-11-01","url":"https://x.co.uk/jobs/1",
       "employmentType":["FULL_TIME"],"description":"<p>Spark and AWS</p>",
       "hiringOrganization":{"name":"X Ltd"},
       "jobLocation":{"address":{"addressLocality":"Leeds","addressCountry":"GB"}}}]}</script></html>"""
    posts = fj._ld_postings(html)
    assert len(posts) == 1
    job, org = fj._ld_to_job(posts[0], "https://x.co.uk/careers")
    assert job["title"] == "Data Engineer" and job["loc"] == "Leeds, GB" and org == "X Ltd"
    assert fj.is_uk(job["loc"]) and "Spark" in job["desc"]


def test_workday_uk_facet():
    facets = [{"facetParameter": "locationMainGroup", "values": [
        {"facetParameter": "locationHierarchy2", "descriptor": "Location Type", "values": [{"descriptor": "Office", "id": "o"}]},
        {"facetParameter": "locationHierarchy1", "descriptor": "Locations", "values": [
            {"descriptor": "Armenia", "id": "a"}, {"descriptor": "United Kingdom", "id": "uk1"}]},
        {"facetParameter": "locations", "descriptor": "Sites", "values": [{"descriptor": "UK, Reading", "id": "s1"}]}]}]
    assert fj._wd_uk_facets(facets) == {"locationHierarchy1": ["uk1"]}


def test_personio_teamtailor_recruitee(monkeypatch):
    personio = """<workzag-jobs><position><id>2885178</id><office>London</office><department>Data</department>
      <name>Analytics Engineer</name><jobDescriptions><jobDescription><name>Skills</name><value>&lt;p&gt;dbt, SQL&lt;/p&gt;</value></jobDescription></jobDescriptions>
      <employmentType>permanent</employmentType><schedule>full-time</schedule><createdAt>2026-11-11T17:43:42+00:00</createdAt></position></workzag-jobs>"""
    rss = """<?xml version="1.0"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>Acme</title>
      <item><title>Product Designer</title><description>&lt;p&gt;Figma&lt;/p&gt;</description><pubDate>Wed, 11 Nov 2026 17:34:36 +0100</pubDate>
      <link>https://acme.teamtailor.com/jobs/1-product-designer</link><remoteStatus>hybrid</remoteStatus>
      <tt:locations><tt:location><tt:city>Bristol</tt:city><tt:country>United Kingdom</tt:country></tt:location></tt:locations>
      <tt:department>Design</tt:department></item></channel></rss>"""
    recruitee = {"offers": [{"title": "Fraud Analyst", "careers_url": "https://careers.acme.com/o/fraud", "company_name": "Acme",
                             "published_at": "2026-11-10 07:45:05 UTC", "remote": False, "department": "Risk",
                             "employment_type_code": "fulltime_permanent", "description": "<p>AML and SQL</p>", "requirements": "",
                             "locations": [{"city": "London", "country": "United Kingdom"}]}]}
    monkeypatch.setattr(fj, "safe_text", lambda url: personio if "personio" in url else rss if "rss" in url else None)
    monkeypatch.setattr(fj, "safe_get", lambda url, **kw: recruitee if "recruitee" in url else None)

    p = fj.personio_jobs("acme")
    assert p[0]["title"] == "Analytics Engineer" and p[0]["url"].endswith("/job/2885178") and "dbt" in p[0]["desc"]
    assert fj.personio_probe("acme") is None
    t = fj.teamtailor_jobs("acme")
    assert t[0]["loc"] == "Bristol, United Kingdom" and t[0]["posted"].startswith("2026-11-11T16:34")
    assert fj.teamtailor_probe("acme") == "Acme"
    r = fj.recruitee_jobs("acme")
    assert r[0]["loc"] == "London, United Kingdom" and r[0]["posted"].startswith("2026-11-10T07:45") and "AML" in r[0]["desc"]
    assert fj.recruitee_probe("acme") == "Acme"


def test_skills_export_is_valid_json(tmp_path):
    p = tmp_path / "skills.json"
    skills.export(p)
    data = json.loads(p.read_text())
    assert len(data["skills"]) == len(skills.SKILLS)
    assert all(s.get("ci") or s.get("cs") for s in data["skills"])
