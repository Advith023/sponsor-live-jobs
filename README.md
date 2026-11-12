# SponsorLive

**Live UK jobs at companies that can sponsor visas, taken straight from each company's careers page.**

LinkedIn and other job boards are full of reposted or "ghost" jobs that are already closed when you click Apply. SponsorLive only shows roles that are **live right now on the employer's own job board or careers site**, and only at employers on the **Home Office register of licensed Skilled Worker sponsors**.

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
        │  by name: Greenhouse · Lever · Ashby · Workable · SmartRecruiters ·
        │           Recruitee · Personio · Breezy · Teamtailor · Pinpoint · BambooHR
        │  by link: all of the above + Workday + any careers page with
        │           schema.org JobPosting data (seed file, GitHub suggestions, CSV)
        ▼
Fetch live roles → keep UK locations → categorise → UK region → skills from description
        ▼
site/data/jobs.json  ──►  static site on GitHub Pages
```

- **`scripts/fetch_jobs.py`**: the whole data pipeline, written in Python using only the standard library.
  - Downloads the latest sponsor register from gov.uk.
  - Tries likely board names for each sponsor and checks the company name where the job board reports it.
  - Probes a rotating batch of sponsors each day (`DISCOVERY_BATCH`, default 8,000; likeliest tech, finance and London-area sponsors first), caching the results, so coverage grows daily. Sponsors with no board found are rechecked after 90 days.
  - Keeps only UK-based roles and de-duplicates them by apply link.
  - Tags each role with UK regions (`rg`) and skills found in its description (`k`, indices into `site/data/skills.json`). Descriptions themselves aren't stored.
  - Stops probing new sponsors after `DISCOVERY_MINUTES` (default 100) so the daily run always finishes.
  - Respects `robots.txt` on ordinary careers sites and fetches them slowly.
- **`scripts/skills.py`**: the skills vocabulary (~160 skills with aliases), used for job descriptions and exported for CV matching so both sides match the same way.
- **`data/seed_boards.json`**: hints of the form `"Sponsor name": [{"url": "https://..."}]` (or `{"ats": ..., "token": ...}`). Any job-board or careers link works; the platform is detected from the link.
- **Suggestions**: the site's "Missing a company?" box opens a pre-filled GitHub issue (label `board-suggestion`). Open issues with that label are read on every run. Companies not on the sponsor register are skipped and listed in `stats.json` → `suggestions_unmatched`. Optional: set a repo variable `SUGGESTIONS_CSV_URL` (e.g. a Google Form's response sheet published as CSV) or `suggestEndpoint` in `site/config.js` (e.g. Formspree) for people without a GitHub account.
- **`site/`**: the website, in plain HTML, CSS and JS with no build step.
  - Search, location, "posted within", remote-only, UK region chips, category chips and sort.
  - **CV matcher** (`site/match.js`): reads a PDF, Word or pasted CV **in the browser only** (never uploaded or stored), finds skills and scores each job by keyword overlap with its description plus job-title words. Shows the %, the skills found and missing, and a caution that it's a keyword match, not a hiring prediction. Title-only matches are capped below "strong".
  - **"+ Track"** on every job opens the application tracker with the role pre-filled (and the match % as the fit score).
- **`site/tracker/`**: the application tracker (originally Career Pipeline). Records live in the browser's local storage; JSON export/import for backups.
  - Each role can hold the exact CV and cover letter sent. In Chrome/Edge on a computer you can pick a folder: files are saved to `<folder>/<Company - Role>/<original name>`, so every application keeps its own copy without renaming. Elsewhere (phones, Safari, Firefox) files stay in the browser's own storage. Nothing is uploaded.
  - The current search is saved in the page link, so it can be shared.
  - Light and dark mode, and works on mobile.
- **`site/config.js`**: site settings. Paste a form endpoint into `alertFormAction` to turn on email job alerts, and a link into `featureContactUrl` to turn on "Feature a role".
- **`.github/workflows/update.yml`**: runs every day at 05:17 UTC, commits the new data and deploys the site to GitHub Pages. It can also be run by hand from the Actions tab.

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

- Workday and in-house careers sites can't be found from a company name, so they only appear once someone suggests the link. Taleo, iCIMS and SuccessFactors aren't supported yet.
- Recruitee, Personio, Breezy, Teamtailor and Workday were checked against live responses. Pinpoint and BambooHR are built from their documented formats and should be watched in the first runs.
- The CV match is keyword-based. It doesn't understand seniority or years of experience.
- Board discovery is name-based. It could occasionally link a sponsor to the wrong company with the same name; the UK-location filter and company-name checks reduce this.
- Salary only appears where the job board publishes it.

## Progress log

| Date | Work |
|---|---|
| 2026-11-12 | Added six more job platforms (Recruitee, Personio, Breezy, Teamtailor, Pinpoint, BambooHR), Workday and general careers-page reading via links; "Missing a company?" suggestions; UK region filter; skills tagging; in-browser CV matcher; application tracker with save-to-folder for CVs and cover letters; tests run before each refresh. |
| 2026-11-12 | Fixed repo links and workflow commit email to the Advith023 account. |
| 2026-11-12 | Went live at https://advith023.github.io/sponsor-live-jobs/. First run: 267 roles from 10 sponsors (1,500 of 120,259 sponsors checked). Discovery now does the likeliest sponsors first, with a batch of 8,000 a day. |
| 2026-11-12 | First version: gov.uk register parser; five job-board integrations (Greenhouse, Lever (US and EU), Ashby, Workable, SmartRecruiters); UK location filter; categories; daily GitHub Action; GitHub Pages site with search and filters; slots for alert sign-up and featured roles. |

**Next steps**
- Watch the first runs and tune the discovery batch size and match rules.
- Check the first run's `sources` counts in `stats.json`, especially Pinpoint and BambooHR.
- Other countries' sponsor lists (US H-1B data, Netherlands IND register, Canada LMIA list, Ireland permits): on hold until the UK baseline is strong.
- Set up the alert form provider and a custom domain.
- Add "report wrong match" and job-closed feedback.

---

Sponsor data: [Register of licensed sponsors: workers](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers). Contains public sector information licensed under the Open Government Licence v3.0.

© Advith Ashok
