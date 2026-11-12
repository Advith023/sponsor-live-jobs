(() => {
  const cfg = window.SPONSORLIVE_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const PAGE = 40;
  const state = { q: "", loc: "", age: 0, remote: false, cats: new Set(), rg: new Set(), src: new Set(), sort: "new", shown: PAGE };
  let cv = null; // in-memory only, never stored
  let jobs = [], filtered = [];

  // ---------- setup
  $("#siteName").textContent = cfg.siteName || "SponsorLive";
  if (cfg.siteName) document.title = document.title.replace("SponsorLive", cfg.siteName);
  if (cfg.headline) $("#headline").textContent = cfg.headline;
  if (cfg.intro) $("#intro").textContent = cfg.intro;
  if (cfg.notice) $("#noticeText").textContent = cfg.notice;
  if (cfg.ownerName) $("#owner").textContent = cfg.ownerName;
  if (/^#[0-9a-f]{6}$/i.test(cfg.brandColor || "")) document.documentElement.style.setProperty("--brand", cfg.brandColor);
  $("#yr").textContent = new Date().getFullYear();
  if (cfg.alertFormAction) { $("#alertBox").hidden = false; $("#alertForm").action = cfg.alertFormAction; }
  if (cfg.featureContactUrl) { $("#featureBox").hidden = false; $("#featureLink").href = cfg.featureContactUrl; }

  const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const ago = (iso) => {
    if (!iso) return null;
    const d = (Date.now() - new Date(iso)) / 864e5;
    if (d < 1) return "Today";
    if (d < 2) return "Yesterday";
    if (d < 30) return `${Math.floor(d)} days ago`;
    if (d < 365) return `${Math.floor(d / 30)} mo ago`;
    return `${Math.floor(d / 365)} yr ago`;
  };

  // ---------- URL state
  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = p.get("q") || ""; state.loc = p.get("loc") || "";
    state.age = +p.get("age") || 0; state.remote = p.get("remote") === "1";
    state.sort = p.get("sort") || "new";
    state.cats = new Set((p.get("cat") || "").split("|").filter(Boolean));
    state.rg = new Set((p.get("rg") || "").split("|").filter(Boolean));
    state.src = new Set((p.get("src") || "").split("|").filter(Boolean));
    if (state.sort === "match") state.sort = "new";
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.loc) p.set("loc", state.loc);
    if (state.age) p.set("age", state.age);
    if (state.remote) p.set("remote", "1");
    if (state.sort !== "new") p.set("sort", state.sort);
    if (state.cats.size) p.set("cat", [...state.cats].join("|"));
    if (state.rg.size) p.set("rg", [...state.rg].join("|"));
    if (state.src.size) p.set("src", [...state.src].join("|"));
    history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  }

  // ---------- filtering
  // skip: name of one filter to ignore (used for the counts shown on that filter's chips)
  function passes(j, skip) {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    const lterms = norm(state.loc).split(/[\s,]+/).filter(Boolean);
    const cutoff = state.age ? Date.now() - state.age * 864e5 : 0;
    if (state.remote && !j.r) return false;
    if (skip !== "cat" && state.cats.size && !state.cats.has(j.cat)) return false;
    if (skip !== "rg" && state.rg.size && !j._rg.some((r) => state.rg.has(r))) return false;
    if (skip !== "src" && state.src.size && !state.src.has(j.src)) return false;
    if (cutoff && (!j._t || j._t < cutoff)) return false;
    if (terms.length && !terms.every((t) => j._hay.includes(t))) return false;
    if (lterms.length && !lterms.every((t) => j._loc.includes(t))) return false;
    return true;
  }
  function apply() {
    filtered = jobs.filter((j) => passes(j));
    const by = {
      new: (a, b) => (b._t || 0) - (a._t || 0),
      company: (a, b) => a.c.localeCompare(b.c) || (b._t || 0) - (a._t || 0),
      title: (a, b) => a.t.localeCompare(b.t),
      match: (a, b) => ((b._m && b._m.pct) || 0) - ((a._m && a._m.pct) || 0) || (b._t || 0) - (a._t || 0),
    }[state.sort] || ((a, b) => (b._t || 0) - (a._t || 0));
    filtered.sort(by);
    state.shown = PAGE;
    writeUrl();
    render();
    renderChips("#cats", "cat", (j) => [j.cat], state.cats);
    renderChips("#regions", "rg", (j) => j._rg, state.rg, REGION_ORDER);
    renderChips("#srcs", "src", (j) => [j.src], state.src);
  }
  const REGION_ORDER = ["London", "South East", "East of England", "South West", "Midlands", "North West",
    "Yorkshire & North East", "Scotland", "Wales", "Northern Ireland", "Remote", "UK (other / unspecified)"];

  // ---------- rendering
  const tpl = $("#tpl").content;
  function card(j) {
    const n = tpl.cloneNode(true);
    const a = n.querySelector(".title");
    a.textContent = j.t; a.href = j.u;
    n.querySelector(".apply").href = j.u;
    n.querySelector(".co").textContent = j.c;
    const m = n.querySelector(".meta");
    const add = (txt, cls) => { if (!txt) return; const s = document.createElement("span"); s.textContent = txt; if (cls) s.className = cls; m.appendChild(s); };
    add("📍 " + j.l);
    const when = ago(j.p);
    add(when, when === "Today" || when === "Yesterday" ? "new" : "");
    if (j.r) add("Remote-friendly", "tag");
    if (j.ty) add(j.ty, "tag");
    if (j.s) add(j.s, "tag");
    add(j.cat, "tag");
    add("via " + j.src);
    const tr = new URLSearchParams({ add: "1", employer: j.c, title: j.t, location: j.l, url: j.u });
    if (j._m) tr.set("fit", j._m.pct);
    n.querySelector(".track").href = "tracker/?" + tr;
    if (j._m) {
      const box = n.querySelector(".match");
      box.hidden = false;
      const m = j._m;
      box.className = "match " + (m.pct >= 70 ? "hi" : m.pct >= 50 ? "mid" : "lo");
      const b = document.createElement("strong");
      b.textContent = `${m.pct}% · ${m.band}`;
      box.appendChild(b);
      const det = document.createElement("div");
      det.className = "why";
      const parts = [];
      if (m.have.length) parts.push("On your CV: " + m.have.slice(0, 8).join(", "));
      if (m.missing.length) parts.push("Not found on your CV: " + m.missing.slice(0, 6).join(", "));
      if (m.exp && m.exp.short) parts.push(m.exp.fromTitle ? `${j.lv} role, usually ${m.exp.need}+ years. Your CV: about ${cv.years}` : `Asks for ${m.exp.need}+ years. Your CV: about ${cv.years}`);
      else if (m.exp && m.exp.need) parts.push(`Experience fits (${m.exp.fromTitle ? "typical for a " + j.lv.toLowerCase() + " role" : m.exp.need + "+ years asked"})`);
      else if (m.exp && m.exp.entry) parts.push("Entry-level role, you may be over-qualified");
      if (m.basis === "title") parts.push("Based on the job title only");
      else if (m.basis === "limited") parts.push("Limited job details");
      det.textContent = parts.join(" · ");
      box.appendChild(det);
    }
    n.querySelector(".badge").title = `${j.sp} is on the Home Office register (Skilled Worker${j.rt ? ", " + j.rt : ""}). Sponsorship for this role is the employer's decision: ask the recruiter.`;
    return n;
  }

  function render() {
    const list = $("#list");
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    filtered.slice(0, state.shown).forEach((j) => frag.appendChild(card(j)));
    list.appendChild(frag);
    $("#count").textContent = `${filtered.length.toLocaleString("en-GB")} live ${filtered.length === 1 ? "job" : "jobs"}`;
    $("#moreBtn").hidden = filtered.length <= state.shown;
    const empty = $("#empty");
    empty.hidden = filtered.length > 0;
    if (!filtered.length) empty.textContent = jobs.length ? "No jobs match those filters. Try a broader search." : "The first daily refresh hasn't finished yet. Check back soon.";
    $("#alertSearch").value = location.search;
  }

  function renderChips(sel, key, valuesOf, chosen, order) {
    const counts = {};
    for (const j of jobs) {
      if (!passes(j, key)) continue;
      for (const v of valuesOf(j)) counts[v] = (counts[v] || 0) + 1;
    }
    for (const v of chosen) counts[v] = counts[v] || 0;
    const box = $(sel);
    box.replaceChildren();
    const entries = Object.entries(counts);
    entries.sort(order ? (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) : (a, b) => b[1] - a[1]);
    entries.forEach(([c, n]) => {
      const b = document.createElement("button");
      b.className = "chip" + (chosen.has(c) ? " on" : "");
      const s = document.createElement("small");
      s.textContent = n.toLocaleString("en-GB");
      b.append(c, s);
      b.onclick = () => { chosen.has(c) ? chosen.delete(c) : chosen.add(c); apply(); };
      box.appendChild(b);
    });
  }

  // ---------- CV matching (in memory only)
  async function useCv(text) {
    const out = $("#cvResult");
    try {
      await CVMatch.loadSkills();
      cv = CVMatch.profile(text);
      jobs.forEach((j) => (j._m = CVMatch.score(j, cv)));
      const names = [...cv.skills].map(CVMatch.skillName);
      const strong = jobs.filter((j) => j._m.pct >= 70).length;
      out.innerHTML = "";
      const yrs = document.createElement("p");
      yrs.className = "yrs";
      const lab = document.createElement("label");
      lab.append(cv.years == null ? "We couldn't work out your years of experience. Enter them to factor it in: " :
        `Experience on your CV: about ${cv.years} years (estimated from your ${cv.yearsFrom === "dates" ? "job dates, not counting education" : "summary"}). Not right? Change it: `);
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = "0"; inp.max = "50"; inp.step = "0.5"; inp.value = cv.years ?? ""; inp.ariaLabel = "Years of experience";
      inp.addEventListener("change", () => {
        const v = inp.value === "" ? null : Math.max(0, Math.min(50, +inp.value));
        cv.years = v; jobs.forEach((j) => (j._m = CVMatch.score(j, cv))); apply();
      });
      lab.append(inp);
      yrs.append(lab);
      const p = document.createElement("p");
      p.textContent = names.length
        ? `Found ${names.length} skills on your CV: ${names.slice(0, 25).join(", ")}${names.length > 25 ? "…" : ""}. ${strong} jobs look like a strong keyword fit.`
        : "We couldn't spot any skills we recognise. Try pasting the text of your CV instead.";
      const warn = document.createElement("p");
      warn.className = "caution";
      warn.textContent = "The match % compares keywords and a rough estimate of experience. It is not a hiring prediction. For strong fits, read the full requirements and ask the recruiter about visa sponsorship before you apply.";
      const clear = document.createElement("button");
      clear.className = "link"; clear.type = "button"; clear.textContent = "Clear my CV";
      clear.onclick = () => { cv = null; jobs.forEach((j) => delete j._m); out.textContent = ""; $("#sortMatch").disabled = true;
        if (state.sort === "match") state.sort = "new"; $("#cvFile").value = ""; $("#cvText").value = ""; syncControls(); apply(); };
      out.append(p, yrs, warn, clear);
      $("#sortMatch").disabled = false;
      state.sort = "match";
      syncControls();
      apply();
    } catch (e) {
      out.textContent = "Sorry, that didn't work: " + (e.message || e);
    }
  }
  $("#cvFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $("#cvResult").textContent = "Reading your CV on this device…";
    try { await useCv(await CVMatch.readFile(f)); }
    catch (err) { $("#cvResult").textContent = err.message || "Couldn't read that file. Try pasting the text instead."; }
  });
  $("#cvPasteBtn").addEventListener("click", () => { $("#cvPaste").hidden = !$("#cvPaste").hidden; });
  $("#cvUseText").addEventListener("click", () => { const t = $("#cvText").value.trim(); if (t) useCv(t); });

  // ---------- suggest a company
  // Google Form "pre-filled link" made with COMPANY and LINK as the answers -> where to post and which fields
  function googleForm(prefill) {
    try {
      if (!prefill) return null;
      const u = new URL(prefill);
      if (!/docs\.google\.com$/.test(u.hostname) || !/\/forms\//.test(u.pathname)) return null;
      let company, link, feedback, rating;
      for (const [k, v] of u.searchParams) {
        if (/^COMPANY$/i.test(v)) company = k; if (/^LINK$/i.test(v)) link = k; if (/^FEEDBACK$/i.test(v)) feedback = k; if (/^RATING$/i.test(v)) rating = k;
      }
      if (!company || !link) return null;
      return { action: u.origin + u.pathname.replace(/\/viewform.*$/, "/formResponse"), company, link, feedback, rating };
    } catch { return null; }
  }
  // ---------- anonymous feedback (only shown once the Google Form has a FEEDBACK question)
  const gfb = googleForm(cfg.suggestGoogleFormPrefill);
  if (gfb && gfb.feedback) {
    $("#fbOpen").hidden = false;
    let stars = 0;
    const paint = () => document.querySelectorAll("#fbStars button").forEach((b) => b.classList.toggle("on", +b.dataset.v <= stars));
    if (gfb.rating) {
      $("#fbStarsRow").hidden = false;
      document.querySelectorAll("#fbStars button").forEach((b) => (b.onclick = () => { stars = stars === +b.dataset.v ? 0 : +b.dataset.v; paint(); }));
    }
    $("#fbText").required = false;
    $("#fbOpen").onclick = () => { $("#fbMsg").textContent = ""; $("#fbDialog").showModal(); };
    $("#fbCancel").onclick = () => $("#fbDialog").close();
    $("#fbForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("#fbText").value.trim();
      if (!text && !stars) { $("#fbMsg").textContent = "Add a rating or a comment first."; return; }
      $("#fbSend").disabled = true;
      try {
        const fields = {};
        if (text) fields[gfb.feedback] = text;
        if (stars && gfb.rating) fields[gfb.rating] = String(stars);
        await fetch(gfb.action, { method: "POST", mode: "no-cors", body: new URLSearchParams(fields) });
        $("#fbText").value = ""; stars = 0; paint(); $("#fbMsg").textContent = "Thank you! Sent.";
        setTimeout(() => $("#fbDialog").close(), 1200);
      } catch { $("#fbMsg").textContent = "Couldn't send that just now. Please try again later."; }
      finally { $("#fbSend").disabled = false; }
    });
  }
  if (!googleForm(cfg.suggestGoogleFormPrefill) && !cfg.suggestEndpoint) {
    $("#suggestBtn").textContent = "Suggest via GitHub";
    $("#suggestNote").textContent = "Needs a free GitHub account for now.";
  }
  $("#suggestForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, company = f.company.value.trim(), link = f.link.value.trim(), msg = $("#suggestMsg");
    const gf = googleForm(cfg.suggestGoogleFormPrefill);
    if (gf) {
      try {
        const body = new URLSearchParams({ [gf.company]: company, [gf.link]: link });
        await fetch(gf.action, { method: "POST", mode: "no-cors", body });
        msg.textContent = "Thanks! We'll check it on the next daily refresh."; f.reset();
      } catch { msg.textContent = "Couldn't send that just now. Please try again later."; }
      return;
    }
    if (cfg.suggestEndpoint) {
      try {
        const r = await fetch(cfg.suggestEndpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ company, link }) });
        if (!r.ok) throw new Error();
        msg.textContent = "Thanks! We'll check it on the next daily refresh."; f.reset();
      } catch { msg.textContent = "Couldn't send that just now. Please try again later."; }
      return;
    }
    const q = new URLSearchParams({ template: "suggest-board.yml", title: "Suggest: " + company, company, link });
    window.open(`https://github.com/${cfg.githubRepo || "Advith023/sponsor-live-jobs"}/issues/new?${q}`, "_blank", "noopener");
    msg.textContent = "Opened a pre-filled suggestion on GitHub. Press \"Create\" there to send it.";
  });

  // ---------- events
  let timer;
  const debounce = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 160); };
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; debounce(apply); });
  $("#loc").addEventListener("input", (e) => { state.loc = e.target.value; debounce(apply); });
  $("#remote").addEventListener("change", (e) => { state.remote = e.target.checked; apply(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); });
  $("#age").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.age = +b.dataset.v; syncControls(); apply();
  });
  $("#moreBtn").addEventListener("click", () => { state.shown += PAGE; render(); });
  $("#reset").addEventListener("click", () => {
    Object.assign(state, { q: "", loc: "", age: 0, remote: false, sort: cv ? "match" : "new" }); state.cats.clear(); state.rg.clear(); state.src.clear();
    syncControls(); apply();
  });
  $("#share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); $("#share").textContent = "Link copied ✓"; }
    catch { $("#share").textContent = location.href; }
    setTimeout(() => ($("#share").textContent = "Copy link to this search"), 2000);
  });

  function syncControls() {
    $("#q").value = state.q; $("#loc").value = state.loc;
    $("#remote").checked = state.remote; $("#sort").value = state.sort;
    document.querySelectorAll("#age button").forEach((b) => b.classList.toggle("on", +b.dataset.v === state.age));
  }

  // ---------- load
  readUrl(); syncControls();
  fetch("data/jobs.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => {
      jobs = (d.jobs || []).map((j) => ({
        ...j,
        _t: j.p ? Date.parse(j.p) : 0,
        _hay: norm(`${j.t} ${j.c} ${j.sp} ${j.cat} ${j.d || ""} ${j.ty || ""}`),
        _loc: norm(`${j.l} ${j.r ? "remote" : ""}`),
        _rg: j.rg && j.rg.length ? j.rg : ["UK (other / unspecified)"],
      }));
      if (cv) jobs.forEach((j) => (j._m = CVMatch.score(j, cv)));
      const cities = {};
      jobs.forEach((j) => j.l.split(/\s*[\/;|]\s*/).forEach((x) => { const c = x.split(",")[0].trim(); if (c) cities[c] = (cities[c] || 0) + 1; }));
      $("#locList").innerHTML = Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([c]) => `<option value="${c.replace(/"/g, "&quot;")}">`).join("");
      const upd = d.generated ? new Date(d.generated).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "pending";
      $("#stats").textContent = `${(d.count || 0).toLocaleString("en-GB")} live roles · ${(d.companies || 0).toLocaleString("en-GB")} licensed sponsors · updated ${upd}`;
      apply();
    })
    .catch(() => { $("#stats").textContent = "Couldn't load jobs right now. Please refresh."; apply(); });
})();
