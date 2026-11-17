// Sponsor Scout by Advith Ashok (github.com/Advith023/sponsor-live-jobs). Copyright (c) 2026 Advith Ashok. All rights reserved. Not licensed for reuse; see LICENSE.
(() => {
  const cfg = window.SPONSORLIVE_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const PAGE = 40;
  const state = { q: "", loc: "", age: 0, remote: false, all: false, lv: "", cats: new Set(), rg: new Set(), src: new Set(), sort: "new", shown: PAGE };
  let cv = null; // in-memory only, never stored
  let jobs = [], filtered = [];

  // ---------- setup
  $("#siteName").textContent = cfg.siteName || "Sponsor Scout";
  if (cfg.siteName) document.title = document.title.replace("Sponsor Scout", cfg.siteName);
  if (cfg.headline) $("#headline").textContent = cfg.headline;
  if (cfg.intro) $("#intro").textContent = cfg.intro;
  if (cfg.notice) $("#noticeText").textContent = cfg.notice;
  if (cfg.ownerName) $("#owner").textContent = cfg.ownerName;
  if (/^#[0-9a-f]{6}$/i.test(cfg.brandColor || "")) document.documentElement.style.setProperty("--brand", cfg.brandColor);
  $("#yr").textContent = new Date().getFullYear();
  if (cfg.alertFormAction) { $("#alertBox").hidden = false; $("#alertForm").action = cfg.alertFormAction; }
  if (cfg.featureContactUrl) { $("#featureBox").hidden = false; $("#featureLink").href = cfg.featureContactUrl; }

  const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  // ---------- plain-English search
  // "data analyst jobs in London" -> role words "data analyst", place "London".
  // Filler words are dropped, plurals and everyday job names are understood,
  // and a place at the end (or after "in"/"near") becomes the location.
  const words = (s) => " " + norm(s).replace(/[^a-z0-9+#]+/g, " ").trim() + " ";
  const STOP = new Set("job jobs role roles position positions vacancy vacancies opening openings opportunity opportunities career careers work working hiring find show me give looking look search want need get for a an the i im my any some all in near around at within based from to and or with please uk united kingdom britain england anywhere nearby".split(" "));
  const SYN = [
    ["lawyer lawyers solicitor solicitors legal attorney counsel barrister paralegal law", ["lawyer", "solicitor", "legal", "=counsel", "paralegal", "attorney", "barrister"]],
    ["developer developers programmer programmers coder coders", ["developer", "engineer", "programmer", "software"]],
    ["accountant accountants accounting accounts bookkeeper bookkeeping", ["accountant", "accounting", "accounts", "bookkeep", "finance"]],
    ["hr", ["hr", "human resources", "people partner", "people operations", "people advisor"]],
    ["recruiter recruiters recruitment", ["recruit", "talent acquisition", "talent partner"]],
    ["admin administrator secretary receptionist pa", ["admin", "administrator", "administrative", "secretary", "receptionist", "office"]],
    ["teacher teachers teaching tutor lecturer", ["teacher", "teaching", "tutor", "lecturer"]],
    ["nurse nurses nursing", ["=nurse", "nursing"]],
    ["doctor doctors physician gp", ["doctor", "physician", "gp", "clinical fellow", "consultant"]],
    ["designer designers", ["designer", "design", "ux", "ui"]],
    ["marketer marketing", ["marketing", "marketer", "brand", "growth"]],
    ["it", ["it", "technology", "service desk", "infrastructure", "support engineer"]],
  ];
  // A word matches the start of a word ("analyst" finds "analysts"); short words
  // and ones marked "=" must match the whole word ("hr" never finds "hrs").
  const has = (field, a) => a[0] === "=" ? field.includes(` ${a.slice(1)} `) || field.includes(` ${a.slice(1)}s `)
    : a.length <= 3 ? field.includes(` ${a} `) : field.includes(" " + a);
  const synOf = (w) => { for (const [keys, alts] of SYN) if (keys.split(" ").includes(w)) return alts; return null; };
  let PLACES = new Set();
  function parseQuery(q) {
    let toks = norm(q).replace(/[^a-z0-9+#&]+/g, " ").trim().split(" ").filter(Boolean);
    let place = "", remote = false;
    // explicit "in X" / "near X": take X if it is a known place
    const at = toks.findLastIndex((t) => ["in", "near", "around", "within"].includes(t));
    if (at >= 0 && at < toks.length - 1) {
      const rest = toks.slice(at + 1).filter((t) => !STOP.has(t)).join(" ");
      if (PLACES.has(rest) || rest === "remote") { place = rest; toks = toks.slice(0, at); }
    }
    // otherwise a known place at the end, up to 3 words ("milton keynes")
    if (!place) for (let n = 3; n >= 1 && !place; n--) {
      const tail = toks.slice(-n).join(" ");
      if (toks.length > n && PLACES.has(tail)) { place = tail; toks = toks.slice(0, -n); }
    }
    if (place === "remote" || toks.includes("remote")) { remote = true; if (place === "remote") place = ""; toks = toks.filter((t) => t !== "remote"); }
    const groups = toks.filter((t) => !STOP.has(t)).map((t) => {
      const syn = synOf(t);
      if (syn) return syn;
      const alts = [t];
      if (t.length > 3 && t.endsWith("ies")) alts.push(t.slice(0, -3) + "y");
      else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) alts.push(t.slice(0, -1));
      return alts;
    });
    return { groups, place, remote };
  }
  let parsed = { groups: [], place: "", remote: false };

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
    state.age = +p.get("age") || 0; state.remote = p.get("remote") === "1"; state.all = p.get("all") === "1";
    state.sort = p.get("sort") || "new";
    state.lv = p.get("lv") || "";
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
    if (state.all) p.set("all", "1");
    if (state.sort !== "new") p.set("sort", state.sort);
    if (state.lv) p.set("lv", state.lv);
    if (state.cats.size) p.set("cat", [...state.cats].join("|"));
    if (state.rg.size) p.set("rg", [...state.rg].join("|"));
    if (state.src.size) p.set("src", [...state.src].join("|"));
    history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  }

  // ---------- filtering
  // skip: name of one filter to ignore (used for the counts shown on that filter's chips)
  function passes(j, skip) {
    const lterms = norm(state.loc || parsed.place).split(/[\s,]+/).filter(Boolean);
    const cutoff = state.age ? Date.now() - state.age * 864e5 : 0;
    if (!state.all && j.el === "u") return false;  // below the Skilled Worker skill level, see scripts/eligibility.py
    if (state.lv === "entry" && j.lv !== "Entry") return false;
    if (state.lv === "exp" && !j.lv) return false;  // "exp" = any role with a level (Senior/Lead/Director)
    if (state.lv === "exp" && j.lv === "Entry") return false;
    if ((state.remote || parsed.remote) && !j.r) return false;
    if (skip !== "cat" && state.cats.size && !state.cats.has(j.cat)) return false;
    if (skip !== "rg" && state.rg.size && !j._rg.some((r) => state.rg.has(r))) return false;
    if (skip !== "src" && state.src.size && !state.src.has(j.src)) return false;
    if (cutoff && (!j._t || j._t < cutoff)) return false;
    if (parsed.groups.length && !parsed.groups.every((alts) => alts.some((a) => has(parsed.titleOnly ? j._tw : j._hay, a)))) return false;
    if (lterms.length && !lterms.every((t) => j._loc.includes(" " + t)) && !(parsed.place && !state.loc && j._rg.some((r) => norm(r) === parsed.place))) return false;
    return true;
  }
  function apply() {
    parsed = parseQuery(state.q);
    // Prefer job titles and company names: "data scientist" means the title, not "Data" in a
    // department name. Only if nothing fits are category, team and job type searched too.
    parsed.titleOnly = parsed.groups.length > 0 && jobs.some((j) => parsed.groups.every((alts) => alts.some((a) => has(j._tw, a))));
    const hint = $("#qHint");
    if (hint) {
      const role = parsed.groups.map((g) => g[0].replace("=", "")).join(" ");
      const where = state.loc ? "" : parsed.place ? parsed.place.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
      const changed = state.q.trim() && norm(state.q).trim() !== role;
      hint.hidden = !changed;
      if (changed) hint.textContent = `Showing ${role ? `"${role}" roles` : "all roles"}${where ? ` in ${where}` : ""}${parsed.remote ? ", remote" : ""}`;
    }
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
  const REP_KEY = "sponsorlive-reported";
  const reported = () => { try { return JSON.parse(localStorage.getItem(REP_KEY) || "[]"); } catch { return []; } };
  const TIP_S = "This type of role is on the Temporary Shortage List, which has its own conditions and runs until 31 December 2026. Check GOV.UK and ask the employer.";
  const TIP_U = "The job title matches an occupation that is below the Skilled Worker skill level, so this role is unlikely to be sponsored. This is a guide, not advice: the employer decides.";
  function card(j) {
    const n = tpl.cloneNode(true);
    const li = n.querySelector(".job"); if (li) { li.dataset.co = j.c; li.dataset.title = j.t; }
    const a = n.querySelector(".title");
    a.textContent = j.t; a.href = j.u;
    n.querySelector(".apply").href = j.u;
    n.querySelector(".co").textContent = j.c;
    const shareBtn = n.querySelector(".share");
    if (shareBtn) shareBtn.onclick = async () => {
      const text = `${j.t} at ${j.c} - visa sponsorship available`;
      const url = j.u;
      gc("share-click");
      try {
        if (navigator.share) await navigator.share({ title: text, text, url });
        else if (navigator.clipboard) { await navigator.clipboard.writeText(text + "\n" + url); shareBtn.textContent = "Copied!"; setTimeout(() => { shareBtn.textContent = "Share"; }, 2000); }
        else prompt("Copy this link:", text + "\n" + url);
      } catch (e) { if (e.name !== "AbortError") prompt("Copy this link:", text + "\n" + url); }
    };
    const m = n.querySelector(".meta");
    const add = (txt, cls) => { if (!txt) return; const s = document.createElement("span"); s.textContent = txt; if (cls) s.className = cls; m.appendChild(s); };
    add("📍 " + j.l);
    const when = ago(j.p);
    add(when, when === "Today" || when === "Yesterday" ? "new" : "");
    if (j.r) add("Remote-friendly", "tag");
    if (j.ty) add(j.ty, "tag");
    if (j.s) add(j.s, "tag");
    add(j.cat, "tag");
    if (j.lv === "Entry") add("Entry level", "tag");
    else if (j.lv) add(j.lv + " level", "tag");
    if (j.el === "s") add("Shortage list role", "tag info");
    if (j.el === "u") add("Unlikely to qualify", "tag warn");
    add("via " + j.src);
    const tr = new URLSearchParams({ add: "1", employer: j.c, title: j.t, location: j.l, url: j.u });
    if (j._m) tr.set("fit", j._m.pct);
    n.querySelector(".track").href = "tracker/?" + tr;
    const rep = n.querySelector(".report");
    if (gfb && gfb.feedback) {
      rep.hidden = false;
      if (reported().includes(j.u)) { rep.textContent = "Reported, thank you"; rep.disabled = true; }
      rep.onclick = async () => {
        if (!rep.dataset.armed) { rep.dataset.armed = "1"; rep.textContent = "Tap again to report this role as not visa-eligible"; return; }
        rep.disabled = true;
        try {
          await fetch(gfb.action, { method: "POST", mode: "no-cors", body: new URLSearchParams({ [gfb.feedback]: `Report role: ${j.t} | ${j.c} | ${j.u}` }) });
          try { localStorage.setItem(REP_KEY, JSON.stringify([...reported(), j.u].slice(-200))); } catch {}
          gc("role-reported");
          rep.textContent = "Reported, thank you. We'll check it.";
        } catch { rep.textContent = "Couldn't send. Please try again later."; rep.disabled = false; }
      };
    }
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
    const tags = m.querySelectorAll(".info, .warn");
    tags.forEach((t) => (t.title = t.classList.contains("info") ? TIP_S : TIP_U));
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
    const hid = state.all ? 0 : jobs.filter((j) => j.el === "u").length;
    $("#hiddenNote").hidden = !hid;
    $("#hiddenNote").textContent = hid ? `${hid.toLocaleString("en-GB")} roles unlikely to qualify are hidden` : "";
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
  // Anonymous usage counts (GoatCounter, no cookies, no personal data)
  const gc = (path) => { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path, event: true }); } catch {} };
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a"); if (!a) return;
    if (a.matches(".apply, .title")) { gc("apply-click"); const li = a.closest(".job"); if (li) gc("apply/" + (li.dataset.co || "unknown") + "/" + (li.dataset.title || "unknown")); }
    else if (a.matches(".track")) gc("track-click");
  });

  async function useCv(text) {
    gc("cv-match");
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
    // A quiet, one-off rating nudge: only after someone has opened a job and come back
    const NUDGE = "sponsorlive-rate-nudge";
    let openedJob = false;
    document.addEventListener("click", (e) => { if (e.target.closest("a.apply, a.title")) openedJob = true; });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !openedJob) return;
      try { if (localStorage.getItem(NUDGE)) return; localStorage.setItem(NUDGE, String(Date.now())); } catch { return; }
      const card = $("#rateNudge"); card.hidden = false;
      card.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => {
        card.hidden = true;
        const target = document.querySelector(`#fbStars button[data-v="${b.dataset.v}"]`);
        $("#fbMsg").textContent = ""; $("#fbDialog").showModal();
        if (target) target.click();
      }));
      $("#rateClose").onclick = () => (card.hidden = true);
    });
    $("#fbForm").addEventListener("submit", async (e) => {
      gc("feedback-sent");
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
    gc("company-suggested");
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
  $("#showAll").addEventListener("change", (e) => { state.all = e.target.checked; apply(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); });
  $("#age").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.age = +b.dataset.v; syncControls(); apply();
  });
  $("#lvl").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.lv = b.dataset.v; syncControls(); apply();
  });
  $("#moreBtn").addEventListener("click", () => { state.shown += PAGE; render(); });
  $("#reset").addEventListener("click", () => {
    Object.assign(state, { q: "", loc: "", age: 0, remote: false, all: false, sort: cv ? "match" : "new", lv: "" }); state.cats.clear(); state.rg.clear(); state.src.clear();
    syncControls(); apply();
  });
  $("#share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); $("#share").textContent = "Link copied ✓"; }
    catch { $("#share").textContent = location.href; }
    setTimeout(() => ($("#share").textContent = "Copy link to this search"), 2000);
  });

  function syncControls() {
    $("#q").value = state.q; $("#loc").value = state.loc;
    $("#remote").checked = state.remote; $("#showAll").checked = state.all; $("#sort").value = state.sort;
    document.querySelectorAll("#age button").forEach((b) => b.classList.toggle("on", +b.dataset.v === state.age));
    document.querySelectorAll("#lvl button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.lv));
  }

  // ---------- load
  function loadJobs() {
    $("#stats").textContent = "Loading live jobs…";
    const btn = $("#refreshBtn"); if (btn) { btn.hidden = true; btn.disabled = true; }
    fetch("data/jobs.json", { cache: "no-cache" })
      .then((r) => r.json())
      .then((d) => {
        jobs = (d.jobs || []).map((j) => ({
          ...j,
          _t: j.p ? Date.parse(j.p) : 0,
          _tw: words(`${j.t} ${j.c} ${j.sp}`),  // title and company
          _hay: words(`${j.t} ${j.c} ${j.sp} ${j.cat} ${j.d || ""} ${j.ty || ""}`),
          _loc: words(`${j.l} ${j.r ? "remote" : ""}`),
          _rg: j.rg && j.rg.length ? j.rg : ["UK (other / unspecified)"],
        }));
        if (cv) jobs.forEach((j) => (j._m = CVMatch.score(j, cv)));
        PLACES = new Set(REGION_ORDER.map(norm));
        jobs.forEach((j) => j.l.split(/\s*[,\/;|]\s*/).forEach((x) => { const k = words(x).trim(); if (k && !["united kingdom", "uk", "england", "gb"].includes(k)) PLACES.add(k); }));
        const cities = {};
        jobs.forEach((j) => j.l.split(/\s*[\/;|]\s*/).forEach((x) => { const c = x.split(",")[0].trim(); if (c) cities[c] = (cities[c] || 0) + 1; }));
        $("#locList").innerHTML = Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([c]) => `<option value="${c.replace(/"/g, "&quot;")}">`).join("");
        const upd = d.generated ? new Date(d.generated).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "pending";
        $("#stats").textContent = `${jobs.filter((j) => j.el !== "u").length.toLocaleString("en-GB")} live roles · ${(d.companies || 0).toLocaleString("en-GB")} licensed sponsors · updated ${upd}`;
        if (btn) { btn.hidden = false; btn.disabled = false; }
        // --- ticker: companies that posted in the last 24h
        const day = Date.now() - 864e5;
        const recent = {};
        jobs.forEach((j) => { if (j._t >= day && j.el !== "u") recent[j.c] = (recent[j.c] || 0) + 1; });
        const tk = $("#ticker"), tt = $("#tickerText");
        if (tk && tt && Object.keys(recent).length) {
          const items = Object.entries(recent).sort((a, b) => b[1] - a[1]).slice(0, 15);
          tt.textContent = "Hiring now: " + items.map(([c, n]) => `${c} (${n})`).join("  ·  ");
          tk.hidden = false;
        }
        apply();
      })
      .catch(() => { $("#stats").textContent = "Couldn't load jobs right now. Please refresh."; if (btn) { btn.hidden = false; btn.disabled = false; } apply(); });
  }
  let _lastRefresh = 0;
  const refreshBtn = $("#refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => {
    if (Date.now() - _lastRefresh < 30000) return;  // rate-limit: 30s cooldown
    _lastRefresh = Date.now();
    loadJobs();
  });
  readUrl(); syncControls(); loadJobs();
})();
