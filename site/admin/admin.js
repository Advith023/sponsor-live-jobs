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
    ["Workday", /\.wd\d+\.myworkdayjobs\.com/i], ["Greenhouse", /greenhouse\.io/i], ["Lever", /lever\.co/i], ["Ashby", /ashbyhq\.com/i],
    ["Workable", /workable\.com/i], ["SmartRecruiters", /smartrecruiters\.com/i], ["Recruitee", /recruitee\.com/i],
    ["Personio", /jobs\.personio\./i], ["Breezy", /breezy\.hr/i], ["Teamtailor", /teamtailor\.com/i], ["Pinpoint", /pinpointhq\.com/i],
    ["BambooHR", /bamboohr\.com/i],
  ];
  const platformOf = (url) => (PLATFORMS.find(([, rx]) => rx.test(url)) || ["Company careers site"])[0];
  const ATS_NAMES = { greenhouse: "Greenhouse", lever: "Lever", lever_eu: "Lever", ashby: "Ashby", workable: "Workable", smartrecruiters: "SmartRecruiters",
    recruitee: "Recruitee", personio: "Personio", breezy: "Breezy", teamtailor: "Teamtailor", pinpoint: "Pinpoint", bamboohr: "BambooHR", workday: "Workday", jsonld: "Careers site" };

  function refreshStatus(name) {
    const s = stats && stats.seeds && stats.seeds[name];
    if (!s) return tag("Waiting for next refresh", "warn");
    if (!s.sponsor) return tag("Not on sponsor register", "bad");
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

  // ---------- suggestions
  function parseIssue(i) {
    const body = i.body || "";
    const m = body.match(/###\s*Company name\s*\n+([^\n]+)/i);
    const company = (m ? m[1] : i.title.replace(/^\s*suggest(ion)?:?\s*/i, "")).trim();
    const link = (body.match(/https?:\/\/[^\s)>\]]+/) || [""])[0];
    return { company, link };
  }
  // Suggestions sent through the Google Form (published sheet). Already-added or rejected links are hidden.
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
  // Feedback rows: no link, just free text (the longest non-date cell)
  function renderFeedback(rows) {
    const body = $("fbs"); body.replaceChildren();
    const hidden = new Set(JSON.parse(localStorage.getItem("sponsorlive-hidden-feedback") || "[]"));
    const items = [];
    for (const r of rows) {
      if (r.some((c) => /^https?:\/\//i.test(c.trim()))) continue;
      const cells = r.map((c) => c.trim()).filter(Boolean);
      const date = cells.find((c) => /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c)) || "";
      const text = cells.filter((c) => c !== date).sort((a, b) => b.length - a.length)[0];
      if (text && text.length > 2 && !hidden.has(date + text)) items.push({ date, text });
    }
    $("fbCount").textContent = items.length ? items.length + " notes" : "None yet";
    if (!items.length) { body.append(row(["", "Nothing yet.", ""])); return; }
    for (const it of items.reverse()) {
      body.append(row([it.date, it.text, btn("Hide", (ev) => {
        hidden.add(it.date + it.text);
        localStorage.setItem("sponsorlive-hidden-feedback", JSON.stringify([...hidden]));
        ev.target.closest("tr").remove();
      })]));
    }
  }

  async function loadSheetSuggestions(body) {
    const url = configData && configData.suggestionsCsvUrl;
    if (!url) { $("fbCount").textContent = "Set up the form in Site settings"; return 0; }
    let rows;
    try { rows = parseCsv(await (await fetch(url, { cache: "no-store" })).text()).slice(1); }
    catch { body.append(row(["Couldn't read the suggestions sheet from here. Each refresh still reads it.", "", "", "", ""])); return 0; }
    const data = seedFile ? seedFile.data : await readSeeds();
    const known = new Set([...(data._rejected || []), ...Object.values(data).flat().map((b) => b && b.url).filter(Boolean)].map((x) => String(x).toLowerCase()));
    let n = 0;
    renderFeedback(rows);
    for (const r of rows) {
      const link = r.find((c) => /^https?:\/\//i.test(c.trim())), company = (r.filter((c) => c.trim() && !/^https?:\/\//i.test(c.trim()) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c.trim()))[0] || "").trim();
      if (!link || !company || known.has(link.trim().toLowerCase())) continue;
      known.add(link.trim().toLowerCase()); n++;
      const a = el("a", new URL(link.trim()).hostname); a.href = link.trim(); a.target = "_blank"; a.rel = "noopener";
      const actions = el("span");
      actions.append(
        btn("Approve", async (ev) => { ev.target.disabled = true; try { await addSeed(company, link.trim()); loadSuggestions(); loadSeeds(); } catch (err) { alert(err.message); ev.target.disabled = false; } }, "primary"), " ",
        btn("Reject", async (ev) => { if (!confirm(`Reject the suggestion for ${company}?`)) return; ev.target.disabled = true; try { await addRejected(link.trim()); loadSuggestions(); } catch (err) { alert(err.message); ev.target.disabled = false; } }, "danger"));
      body.append(row([company + " (form)", a, platformOf(link), refreshStatus(company), actions]));
    }
    return n;
  }

  async function loadSuggestions() {
    const list = await gh("/issues?labels=board-suggestion&state=open&per_page=100");
    const body = $("sugs"); body.replaceChildren();
    const sheet = await loadSheetSuggestions(body);
    const total = list.length + sheet;
    $("sugCount").textContent = total ? total + " waiting" : "None waiting";
    if (!total) { body.append(row(["Nothing to review.", "", "", "", ""])); return; }
    for (const i of list) {
      const { company, link } = parseIssue(i);
      const a = el("a", link ? new URL(link).hostname : "(no link)"); if (link) { a.href = link; a.target = "_blank"; a.rel = "noopener"; }
      const close = async (reason, comment) => {
        await gh(`/issues/${i.number}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) });
        await gh(`/issues/${i.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: reason }) });
      };
      const actions = el("span");
      actions.append(
        btn("Approve", async (ev) => {
          ev.target.disabled = true;
          try {
            if (!link) throw new Error("This suggestion has no link.");
            await addSeed(company, link);
            await close("completed", "Thanks! Added. Its jobs will appear after the next refresh if it's a licensed sponsor.");
            loadSuggestions(); loadSeeds();
          } catch (err) { alert(err.message); ev.target.disabled = false; }
        }, "primary"),
        " ",
        btn("Reject", async (ev) => {
          if (!confirm(`Reject the suggestion for ${company}?`)) return;
          ev.target.disabled = true;
          try { if (link) await addRejected(link); await close("not_planned", "Thanks for the suggestion. We won't be adding this one."); loadSuggestions(); }
          catch (err) { alert(err.message); ev.target.disabled = false; }
        }, "danger"));
      body.append(row([company, a, link ? platformOf(link) : "", refreshStatus(company), actions]));
    }
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
    for (const k of ["alertFormAction", "featureContactUrl", "suggestEndpoint", "suggestGoogleFormPrefill", "suggestionsCsvUrl"])
      if (next[k] && !/^(https:\/\/|mailto:)/i.test(next[k])) { msg.textContent = "Links must start with https:// (or mailto: for the contact link)."; return; }
    msg.textContent = "Publishing…";
    try {
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
