# SponsorLive

**Live UK jobs at companies that can sponsor visas, taken straight from each company's careers page.**

LinkedIn and other job boards are full of reposted or "ghost" jobs that are already closed when you click Apply. SponsorLive only shows roles that are **live right now on the employer's own job board** (Greenhouse, Lever, Ashby, Workable, SmartRecruiters), and only at employers on the **Home Office register of licensed Skilled Worker sponsors**.

What the site states, and nothing more:
> The role is live on the company's site and the company holds a Skilled Worker sponsor licence. Sponsorship for a specific role is the employer's decision, so ask the recruiter.

It is **not immigration advice**. It links to gov.uk for eligibility.

---

## How it works

```
gov.uk sponsor register (CSV, daily)
        │  Skilled Worker sponsors only
        ▼
Discovery: find each sponsor's public job board  ──► data/ats_cache.json
        │  (Greenhouse · Lever · Ashby · Workable · SmartRecruiters)
        ▼
Fetch live roles → keep UK locations → categorise
        ▼
site/data/jobs.json  ──►  static site on GitHub Pages
```

- **`scripts/fetch_jobs.py`**: the whole data pipeline, written in Python using only the standard library.
  - Downloads the latest sponsor register from gov.uk.
  - Tries likely board names for each sponsor and checks the company name where the job board reports it.
  - Probes a rotating batch of sponsors each day (`DISCOVERY_BATCH`, default 8,000; likeliest tech, finance and London-area sponsors first), caching the results, so coverage grows daily. Sponsors with no board found are rechecked after 90 days.
  - Keeps only UK-based roles and de-duplicates them by apply link.
- **`data/seed_boards.json`**: optional hints of the form "sponsor name → job board". Add a company here to get it listed faster; wrong hints are ignored automatically.
- **`site/`**: the website, in plain HTML, CSS and JS with no build step.
  - Search, location, "posted within", remote-only, category chips and sort.
  - The current search is saved in the page link, so it can be shared.
  - Light and dark mode, and works on mobile.
- **`site/config.js`**: site settings. Paste a form endpoint into `alertFormAction` to turn on email job alerts, and a link into `featureContactUrl` to turn on "Feature a role".
- **`180869546+Advith023@users.noreply.github.com`**: runs every day at 05:17 UTC, commits the new data and deploys the site to GitHub Pages. It can also be run by hand from the Actions tab.

## Run locally

```bash
python3 scripts/fetch_jobs.py          # needs internet; DISCOVERY_BATCH=200 for a quick run
python3 -m http.server -d site 8000    # open http://localhost:8000
```

## Monetisation (planned)

1. **Now:** free listings, email-alert sign-up and a "Feature a role" button.
2. **Next:**
   - Paid featured slots for employers and recruiters
   - A paid weekly digest of sponsored roles matched to a subscriber's profile
   - Affiliate links (CV and interview tools)
3. **Guardrail:** the site must never tell users whether they qualify for a visa, because that is regulated immigration advice in the UK.

## Known limits

- Companies that use other hiring systems (Workday, Taleo, iCIMS or in-house career sites) aren't covered yet.
- Board discovery is name-based. It could occasionally link a sponsor to the wrong company with the same name; the UK-location filter and company-name checks reduce this.
- Salary only appears where the job board publishes it.

## Progress log

| Date | Work |
|---|---|
| 2026-11-12 | Went live at https://advith023.github.io/sponsor-live-jobs/. First run: 267 roles from 10 sponsors (1,500 of 120,259 sponsors checked). Discovery now does the likeliest sponsors first, with a batch of 8,000 a day. |
| 2026-11-12 | First version: gov.uk register parser; five job-board integrations (Greenhouse, Lever (US and EU), Ashby, Workable, SmartRecruiters); UK location filter; categories; daily GitHub Action; GitHub Pages site with search and filters; slots for alert sign-up and featured roles. |

**Next steps**
- Watch the first runs and tune the discovery batch size and match rules.
- Add Workday and other job-board integrations.
- Set up the alert form provider and a custom domain.
- Add "report wrong match" and job-closed feedback.

---

Sponsor data: [Register of licensed sponsors: workers](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers). Contains public sector information licensed under the Open Government Licence v3.0.

© Advith Ashok
