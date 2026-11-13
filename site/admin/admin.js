// SponsorLive by Advith Ashok (github.com/Advith023/sponsor-live-jobs). Copyright (c) 2026 Advith Ashok. All rights reserved. Not licensed for reuse; see LICENSE.
// SponsorLive control centre. Talks straight to the GitHub API with the owner's own token.
// The token stays in this browser (localStorage or sessionStorage) and is only ever sent to api.github.com.
(() => {
  const REPO = "Advith023/sponsor-live-jobs";
  const API = "https://api.github.com/repos/" + REPO;
  const SEED_PATH = "data/seed_boards.json";
  const KEY = "sponsorlive-admin-token";
  const $ = (id) => document.getElementById(id);
  let token = localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || "";
  let stats = null, seedFile = null, pollTimer = null;

  // ---------- helpers
  async function gh(path, opts = {}) {
    const r = await fetch(path.startsWith("http") ? path : API + path, {
      ...opts,
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (r.status === 401) { signOut("Your token was rejected or has expired. Please sign in again."); throw new Error("Unauthorised"); }
    if (!r.ok) {
      let msg = r.status + "";
      try { msg = (await r.json()).message || msg; } catch {}
      throw new Error(r.status === 403 || r.status === 404 ? `GitHub said no (${msg}). Check the token has Actions, Contents and Issues set to Read and write.` : msg);
    }
    return r.status === 204 ? null : r.json();
  }
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const b64encode = (str) => { let bin = ""; new TextEncoder().encode(str).forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const tag = (text, cls) => el("span", text, "tag " + cls);
  const btn = (text, onClick, cls) => { const b = el("button", text, cls); b.type = "button"; b.onclick = onClick; return b; };
  const fmt = (n) => (n ?? 0).toLocaleString("en-GB");
  const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const row = (cells) => { const tr = document.createElement("tr"); cells.forEach((c) => { const td = document.createElement("td"); c instanceof Node ? td.append(c) : (td.textContent = c ?? ""); tr.append(td); }); return tr; };

  const PLATFORMS = [
    ["Workday", /\.wd\d+\.myworkdayjobs\.com/i], ["Oracle", /oraclecloud\.com\/hcmUI/i], ["Greenhouse", /greenhouse\.io/i], ["Lever", /lever\.co/i], ["Ashby", /ashbyhq\.com/i],
    ["Workable", /workable\.com/i], ["SmartRecruiters", /smartrecruiters\.com/i], ["Recruitee", /recruitee\.com/i],
    ["Personio", /jobs\.personio\./i], ["Breezy", /breezy\.hr/i], ["Teamtailor", /teamtailor\.com/i], ["Pinpoint", /pinpointhq\.com/i],
    ["BambooHR", /bamboohr\.com/i],
  ];
  const platformOf = (url) => (PLATFORMS.find(([, rx]) => rx.test(url)) || ["Company careers site"])[0];
  const ATS_NAMES = { greenhouse: "Greenhouse", lever: "Lever", lever_eu: "Lever", ashby: "Ashby", workable: "Workable", smartrecruiters: "SmartRecruiters",
    recruitee: "Recruitee", personio: "Personio", breezy: "Breezy", teamtailor: "Teamtailor", pinpoint: "Pinpoint", bamboohr: "BambooHR", workday: "Workday", oracle: "Oracle", jsonld: "Careers site" };

  function refreshStatus(name) {
    const s = stats && stats.seeds && stats.seeds[name];
    if (!s) return tag("Waiting for next refresh", "warn");
    if (!s.sponsor) {
      const near = (stats.suggestions_closest || {})[name] || [];
      const wrap = el("span");
      wrap.append(tag("Not on sponsor register", "bad"));
      if (near.length) wrap.append(el("div", "Closest register names: " + near.join(", ") + ". Re-add it under one of these if it's the same company.", "muted small"));
      return wrap;
    }
    return s.jobs ? tag(fmt(s.jobs) + " UK jobs", "ok") : tag("Sponsor, 0 UK jobs found", "warn");
  }

  // ---------- sign in / out
  function signOut(msg) {
    token = ""; localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
    clearInterval(pollTimer);
    $("app").hidden = true; $("signout").hidden = true; $("login").hidden = false;
    $("loginMsg").textContent = msg || "";
  }
  $("signout").onclick = () => signOut("Signed out.");
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    token = $("token").value.trim();
    $("loginMsg").textContent = "Checking…";
    try {
      const repo = await gh("");
      if (!repo.permissions || !repo.permissions.push) throw new Error("This token can't make changes to " + REPO + ".");
      ($("remember").checked ? localStorage : sessionStorage).setItem(KEY, token);
      $("token").value = ""; $("loginMsg").textContent = "";
      start();
    } catch (err) { if (token) $("loginMsg").textContent = err.message; }
  };

  // ---------- overview
  async function loadStats() {
    const f = await gh("/contents/site/data/stats.json?ref=main");
    stats = JSON.parse(b64decode(f.content));
    const box = $("stats"); box.replaceChildren();
    [["Live UK jobs", fmt(stats.jobs)], ["Companies with jobs", fmt(stats.companies)], ["Job boards found", fmt(stats.boards)],
     ["Sponsors checked", fmt(stats.sponsors_checked) + " of " + fmt(stats.sponsors)], ["Last refresh", when(stats.generated)]]
      .forEach(([label, v]) => { const d = el("div", null, "stat"); d.append(el("b", v), el("span", label)); box.append(d); });
    const src = $("sources"); src.replaceChildren();
    Object.entries(stats.sources || {}).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => src.append(el("span", `${k}: ${fmt(v)}`, "chip")));
    const fit = stats.eligibility;
    if (fit) src.append(el("span", `Visa fit: ${fmt(fit.eligible)} eligible, ${fmt(fit.shortage_list)} shortage list, ${fmt(fit.unlikely)} hidden as unlikely, ${fmt(fit.unlabelled)} unlabelled`, "chip"));
  }

  // ---------- runs
  async function loadRuns() {
    const d = await gh("/actions/workflows/update.yml/runs?per_page=8");
    const body = $("runs"); body.replaceChildren();
    let active = false;
    for (const r of d.workflow_runs) {
      const type = { schedule: "Daily", workflow_dispatch: "Manual", push: "Site update" }[r.event] || r.event;
      let status;
      if (r.status !== "completed") { status = tag(r.status === "queued" ? "Queued" : "Running", "run"); active = true; }
      else status = tag({ success: "Done", failure: "Failed", cancelled: "Cancelled" }[r.conclusion] || r.conclusion, r.conclusion === "success" ? "ok" : r.conclusion === "failure" ? "bad" : "warn");
      const mins = Math.round((new Date(r.status === "completed" ? r.updated_at : Date.now()) - new Date(r.run_started_at || r.created_at)) / 60000);
      const actions = el("span");
      const logs = el("a", "Details"); logs.href = r.html_url; logs.target = "_blank"; logs.rel = "noopener";
      actions.append(logs);
      if (r.status !== "completed") actions.append(" ", btn("Stop", async () => { if (confirm("Stop this run?")) { await gh(`/actions/runs/${r.id}/cancel`, { method: "POST" }); setTimeout(loadRuns, 3000); } }, "danger"));
      body.append(row([when(r.created_at), type, status, mins + " min", actions]));
    }
    $("runNow").disabled = active;
    $("runNow").title = active ? "A refresh is already running" : "";
    clearInterval(pollTimer);
    if (active) pollTimer = setInterval(() => loadRuns().catch(() => {}), 30000);
    else if (pollTimer) loadStats().catch(() => {});
  }
  $("runNow").onclick = async () => {
    $("runNow").disabled = true; $("runMsg").textContent = "Starting…";
    try {
      await gh("/actions/workflows/update.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main", inputs: { batch: $("batch").value } }) });
      $("runMsg").textContent = "Started. The site updates by itself when it finishes.";
      setTimeout(loadRuns, 4000);
    } catch (err) { $("runMsg").textContent = err.message; $("runNow").disabled = false; }
  };

  // ---------- seeds file
  async function readSeeds() {
    const f = await gh(`/contents/${SEED_PATH}?ref=main`);
    seedFile = { sha: f.sha, data: JSON.parse(b64decode(f.content)) };
    return seedFile.data;
  }
  async function writeSeeds(data, message) {
    const text = "{\n" + Object.entries(data).map(([k, v]) => "  " + JSON.stringify(k) + ": " + JSON.stringify(v)).join(",\n") + "\n}\n";
    const r = await gh(`/contents/${SEED_PATH}`, { method: "PUT", body: JSON.stringify({ message, content: b64encode(text), sha: seedFile.sha, branch: "main" }) });
    seedFile.sha = r.content.sha;
  }
  async function addSeed(company, link) {
    const data = await readSeeds();
    const name = Object.keys(data).find((k) => k.toLowerCase() === company.toLowerCase()) || company;
    const boards = data[name] || [];
    if (!boards.some((b) => b.url === link)) boards.push({ url: link });
    data[name] = boards;
    await writeSeeds(data, `Add ${name} job board`);
  }
  async function loadSeeds() {
    const data = await readSeeds();
    const body = $("seeds"); body.replaceChildren();
    const names = Object.keys(data).filter((k) => !k.startsWith("_"));
    $("seedCount").textContent = names.length + " companies";
    for (const name of names) {
      for (const b of data[name]) {
        let board;
        if (b.url) { board = el("a", platformOf(b.url)); board.href = b.url; board.target = "_blank"; board.rel = "noopener"; }
        else board = el("span", `${ATS_NAMES[b.ats] || b.ats}: ${b.token}`);
        const remove = btn("Remove", async () => {
          if (!confirm(`Remove this board for ${name}? Jobs already found stay until the board is rechecked.`)) return;
          const d = await readSeeds();
          d[name] = (d[name] || []).filter((x) => JSON.stringify(x) !== JSON.stringify(b));
          if (!d[name].length) delete d[name];
          await writeSeeds(d, `Remove ${name} job board`);
          loadSeeds();
        }, "danger");
        body.append(row([name, board, refreshStatus(name), remove]));
      }
    }
  }
  $("addSeed").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, company = f.company.value.trim(), link = f.link.value.trim();
    $("seedMsg").textContent = "Saving…";
    try { await addSeed(company, link); f.reset(); $("seedMsg").textContent = `Added ${company}. Run a quick refresh to see its jobs now, or wait for tomorrow's.`; loadSeeds(); }
    catch (err) { $("seedMsg").textContent = err.message; }
  };

  async function addRejected(link) {
    const data = await readSeeds();
    const list = data._rejected || [];
    if (!list.includes(link)) list.push(link);
    data._rejected = list;
    await writeSeeds(data, "Reject a suggested job board");
  }

  // Suggestions: from the Google Form sheet and from GitHub issues. Everything stays listed with its status.
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  const sheetCsvUrl = (url) => {
    if (!url || !/docs\.google\.com\/spreadsheets/.test(url)) return url;
    url = url.replace(/\/pubhtml(\?|$)/, "/pub$1");
    if (!/output=csv/.test(url)) url = url.replace(/[?&]output=\w+/, "") + (url.includes("?") ? "&" : "?") + "output=csv";
    return url;
  };
  const isLink = (c) => /^https?:\/\//i.test((c || "").trim());
  const isDate = (c) => /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test((c || "").trim());

  async function sheetRows() {
    const url = configData && configData.suggestionsCsvUrl;
    if (!url) return null;
    const text = await (await fetch(sheetCsvUrl(url), { cache: "no-store" })).text();
    if (/^\s*</.test(text)) throw new Error("The sheet link gives a web page, not CSV. Re-publish it as Comma-separated values (.csv).");
    const rows = parseCsv(text);
    const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    return { rows, head };
  }

  function renderFeedback(sheet) {
    const body = $("fbs"); body.replaceChildren();
    if (!sheet) { $("fbCount").textContent = "Set up the form in Site settings"; return; }
    const fi = sheet.head.findIndex((h) => /feedback/.test(h));
    const ri = sheet.head.findIndex((h) => /rating/.test(h));
    const hidden = new Set(JSON.parse(localStorage.getItem("sponsorlive-hidden-feedback") || "[]"));
    const items = [];
    for (const r of sheet.rows) {
      const text = fi >= 0 ? (r[fi] || "").trim() : "";
      const rating = ri >= 0 ? parseInt(r[ri], 10) || 0 : 0;
      const date = (r.find(isDate) || "").trim();
      if ((text || rating) && !hidden.has(date + text + rating)) items.push({ date, text, rating });
    }
    const rated = items.filter((x) => x.rating);
    const avg = rated.length ? (rated.reduce((s, x) => s + x.rating, 0) / rated.length).toFixed(1) : null;
    $("fbCount").textContent = items.length ? items.length + " notes" + (avg ? ` · average rating ${avg} / 5 from ${rated.length}` : "") : "None yet";
    if (!items.length) { body.append(row(["", "Nothing yet.", ""])); return; }
    for (const it of items.reverse()) {
      body.append(row([it.date, (it.rating ? "★".repeat(it.rating) + "☆".repeat(5 - it.rating) + "  " : "") + (it.text || ""), btn("Hide", (ev) => {
        hidden.add(it.date + it.text + it.rating);
        localStorage.setItem("sponsorlive-hidden-feedback", JSON.stringify([...hidden]));
        ev.target.closest("tr").remove();
      })]));
    }
  }

  function parseIssue(i) {
    const body = i.body || "";
    const m = body.match(/###\s*Company name\s*\n+([^\n]+)/i);
    const company = (m ? m[1] : i.title.replace(/^\s*suggest(ion)?:?\s*/i, "")).trim();
    const link = (body.match(/https?:\/\/[^\s)>\]]+/) || [""])[0];
    return { company, link };
  }

  async function removeSeedLink(company, link) {
    const d = await readSeeds();
    for (const k of Object.keys(d)) {
      if (k.startsWith("_") || !Array.isArray(d[k])) continue;
      d[k] = d[k].filter((b) => (b.url || "").toLowerCase() !== link.toLowerCase());
      if (!d[k].length) delete d[k];
    }
    await writeSeeds(d, `Undo approval for ${company}`);
  }
  async function removeRejected(link) {
    const d = await readSeeds();
    d._rejected = (d._rejected || []).filter((x) => x.toLowerCase() !== link.toLowerCase());
    await writeSeeds(d, "Undo a rejected suggestion");
  }

  async function loadSuggestions() {
    const body = $("sugs"); body.replaceChildren();
    const data = await readSeeds();
    const approved = new Set(Object.entries(data).filter(([k]) => !k.startsWith("_")).flatMap(([, v]) => v).map((b) => (b.url || "").toLowerCase()).filter(Boolean));
    const rejected = new Set((data._rejected || []).map((x) => x.toLowerCase()));
    const items = [];

    let sheet = null;
    try { sheet = await sheetRows(); } catch (err) { body.append(row([err.message, "", "", "", ""])); }
    renderFeedback(sheet);
    if (sheet) {
      const ci = sheet.head.findIndex((h) => /company/.test(h)), li = sheet.head.findIndex((h) => /link|url|careers/.test(h));
      for (const r of sheet.rows) {
        const link = ((li >= 0 ? r[li] : r.find(isLink)) || "").trim();
        const company = ((ci >= 0 ? r[ci] : "") || "").trim();
        if (company && link) items.push({ company, link, source: "form", date: (r.find(isDate) || "").trim() });
      }
    }
    const issues = await gh("/issues?labels=board-suggestion&state=all&per_page=100");
    for (const i of issues) {
      const { company, link } = parseIssue(i);
      if (link) items.push({ company, link, source: "GitHub", issue: i });
    }

    const seen = new Set();
    let waiting = 0;
    for (const it of items.reverse()) {
      const key = it.link.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const status = approved.has(key) ? "approved" : rejected.has(key) ? "rejected" : "new";
      if (status === "new") waiting++;
      const a = el("a", (() => { try { return new URL(it.link).hostname; } catch { return it.link; } })());
      if (isLink(it.link)) { a.href = it.link; a.target = "_blank"; a.rel = "noopener"; }
      const statusCell = el("span");
      statusCell.append(status === "approved" ? tag("Approved", "ok") : status === "rejected" ? tag("Rejected", "bad") : tag("New", "run"), " ", refreshStatus(it.company));
      const actions = el("span");
      const act = (label, fn, cls) => btn(label, async (ev) => {
        ev.target.disabled = true;
        try { await fn(); await loadSuggestions(); loadSeeds(); } catch (err) { alert(err.message); ev.target.disabled = false; }
      }, cls);
      if (status === "new") {
        actions.append(
          act("Approve", async () => {
            await addSeed(it.company, it.link);
            if (it.issue) await gh(`/issues/${it.issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: "Thanks! Added. Its jobs will appear after the next refresh if it's a licensed sponsor and its careers site can be read." }) });
          }, "primary"), " ",
          act("Reject", async () => {
            await addRejected(it.link);
            if (it.issue && it.issue.state === "open") await gh(`/issues/${it.issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned" }) });
          }, "danger"));
      } else if (status === "approved") {
        actions.append(act("Undo", () => removeSeedLink(it.company, it.link)));
      } else {
        actions.append(act("Undo", async () => {
          await removeRejected(it.link);
          if (it.issue && it.issue.state === "closed") await gh(`/issues/${it.issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "open" }) });
        }));
      }
      body.append(row([`${it.company} (${it.source})`, a, platformOf(it.link), statusCell, actions]));
    }
    $("sugCount").textContent = waiting ? waiting + " waiting" : "None waiting";
    if (!seen.size) body.append(row(["Nothing yet.", "", "", "", ""]));
  }

  // ---------- site settings (site/config.js)
  const CONFIG_PATH = "site/config.js";
  let configSha = null, configData = null;
  async function loadSettings() {
    const f = await gh(`/contents/${CONFIG_PATH}?ref=main`);
    configSha = f.sha;
    const text = b64decode(f.content);
    configData = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const form = $("settings");
    for (const el2 of form.elements) if (el2.name && el2.name in configData) el2.value = configData[el2.name] || (el2.type === "color" ? "#16a34a" : "");
  }
  $("settings").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target, msg = $("setMsg");
    const next = { ...configData };
    for (const el2 of form.elements) if (el2.name) next[el2.name] = el2.value.trim();
    next.suggestionsCsvUrl = sheetCsvUrl(next.suggestionsCsvUrl);
    for (const k of ["alertFormAction", "featureContactUrl", "suggestEndpoint", "suggestGoogleFormPrefill", "suggestionsCsvUrl"])
      if (next[k] && !/^(https:\/\/|mailto:)/i.test(next[k])) { msg.textContent = "Links must start with https:// (or mailto: for the contact link)."; return; }
    msg.textContent = "Publishing…";
    try {
      // fetch the latest copy first, so a change made elsewhere never blocks the save
      const latest = await gh(`/contents/${CONFIG_PATH}?ref=main`);
      configSha = latest.sha;
      const text = "// Site settings. Easiest to change from the control centre (/admin), which keeps this file valid.\nwindow.SPONSORLIVE_CONFIG = " + JSON.stringify(next, null, 2) + ";\n";
      const r = await gh(`/contents/${CONFIG_PATH}`, { method: "PUT", body: JSON.stringify({ message: "Update site settings", content: b64encode(text), sha: configSha, branch: "main" }) });
      configSha = r.content.sha; configData = next;
      msg.textContent = "Saved. Live in about a minute (refresh the site to see it).";
      setTimeout(loadRuns, 5000);
    } catch (err) { msg.textContent = err.message; }
  };

  // ---------- start
  async function start() {
    $("login").hidden = true; $("app").hidden = false; $("signout").hidden = false;
    try {
      const me = await gh("https://api.github.com/user").catch(() => null);
      $("who").textContent = me ? `Signed in as ${me.login}` : "Signed in";
      await loadStats();
      await Promise.all([loadRuns(), loadSeeds(), loadSettings()]);
      await loadSuggestions();
    } catch (err) { if (token) $("who").textContent = "Something went wrong: " + err.message; }
  }
  $("reloadAll").onclick = start;
  token ? start() : signOut();
})();
