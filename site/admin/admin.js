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

  // ---------- suggestions
  function parseIssue(i) {
    const body = i.body || "";
    const m = body.match(/###\s*Company name\s*\n+([^\n]+)/i);
    const company = (m ? m[1] : i.title.replace(/^\s*suggest(ion)?:?\s*/i, "")).trim();
    const link = (body.match(/https?:\/\/[^\s)>\]]+/) || [""])[0];
    return { company, link };
  }
  async function loadSuggestions() {
    const list = await gh("/issues?labels=board-suggestion&state=open&per_page=100");
    const body = $("sugs"); body.replaceChildren();
    $("sugCount").textContent = list.length ? list.length + " waiting" : "None waiting";
    if (!list.length) { body.append(row(["Nothing to review.", "", "", "", ""])); return; }
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
          try { await close("not_planned", "Thanks for the suggestion. We won't be adding this one."); loadSuggestions(); }
          catch (err) { alert(err.message); ev.target.disabled = false; }
        }, "danger"));
      body.append(row([company, a, link ? platformOf(link) : "", refreshStatus(company), actions]));
    }
  }

  // ---------- start
  async function start() {
    $("login").hidden = true; $("app").hidden = false; $("signout").hidden = false;
    try {
      const me = await gh("https://api.github.com/user").catch(() => null);
      $("who").textContent = me ? `Signed in as ${me.login}` : "Signed in";
      await loadStats();
      await Promise.all([loadRuns(), loadSuggestions(), loadSeeds()]);
    } catch (err) { if (token) $("who").textContent = "Something went wrong: " + err.message; }
  }
  $("reloadAll").onclick = start;
  token ? start() : signOut();
})();
