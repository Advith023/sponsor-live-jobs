(() => {
  const cfg = window.SPONSORLIVE_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const PAGE = 40;
  const state = { q: "", loc: "", age: 0, remote: false, cats: new Set(), sort: "new", shown: PAGE };
  let jobs = [], filtered = [];

  // ---------- setup
  $("#siteName").textContent = cfg.siteName || "SponsorLive";
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
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.loc) p.set("loc", state.loc);
    if (state.age) p.set("age", state.age);
    if (state.remote) p.set("remote", "1");
    if (state.sort !== "new") p.set("sort", state.sort);
    if (state.cats.size) p.set("cat", [...state.cats].join("|"));
    history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  }

  // ---------- filtering
  function apply() {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    const lterms = norm(state.loc).split(/[\s,]+/).filter(Boolean);
    const cutoff = state.age ? Date.now() - state.age * 864e5 : 0;
    filtered = jobs.filter((j) => {
      if (state.remote && !j.r) return false;
      if (state.cats.size && !state.cats.has(j.cat)) return false;
      if (cutoff && (!j._t || j._t < cutoff)) return false;
      if (terms.length && !terms.every((t) => j._hay.includes(t))) return false;
      if (lterms.length && !lterms.every((t) => j._loc.includes(t))) return false;
      return true;
    });
    const by = {
      new: (a, b) => (b._t || 0) - (a._t || 0),
      company: (a, b) => a.c.localeCompare(b.c) || (b._t || 0) - (a._t || 0),
      title: (a, b) => a.t.localeCompare(b.t),
    }[state.sort];
    filtered.sort(by);
    state.shown = PAGE;
    writeUrl();
    render();
    renderCats();
  }

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
    n.querySelector(".badge").title = `${j.sp} — on the Home Office register (Skilled Worker${j.rt ? ", " + j.rt : ""}). Sponsorship for this role is the employer's decision: ask the recruiter.`;
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
    if (!filtered.length) empty.textContent = jobs.length ? "No jobs match those filters. Try a broader search." : "The first daily refresh hasn't finished yet — check back soon.";
    $("#alertSearch").value = location.search;
  }

  function renderCats() {
    const counts = {};
    // counts reflect every filter except category
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    const lterms = norm(state.loc).split(/[\s,]+/).filter(Boolean);
    const cutoff = state.age ? Date.now() - state.age * 864e5 : 0;
    for (const j of jobs) {
      if (state.remote && !j.r) continue;
      if (cutoff && (!j._t || j._t < cutoff)) continue;
      if (terms.length && !terms.every((t) => j._hay.includes(t))) continue;
      if (lterms.length && !lterms.every((t) => j._loc.includes(t))) continue;
      counts[j.cat] = (counts[j.cat] || 0) + 1;
    }
    const box = $("#cats");
    box.replaceChildren();
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
      const b = document.createElement("button");
      b.className = "chip" + (state.cats.has(c) ? " on" : "");
      const s = document.createElement("small");
      s.textContent = n.toLocaleString("en-GB");
      b.append(c, s);
      b.onclick = () => { state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c); apply(); };
      box.appendChild(b);
    });
  }

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
    Object.assign(state, { q: "", loc: "", age: 0, remote: false, sort: "new" }); state.cats.clear();
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
      }));
      const cities = {};
      jobs.forEach((j) => j.l.split(/\s*[\/;|]\s*/).forEach((x) => { const c = x.split(",")[0].trim(); if (c) cities[c] = (cities[c] || 0) + 1; }));
      $("#locList").innerHTML = Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([c]) => `<option value="${c.replace(/"/g, "&quot;")}">`).join("");
      const upd = d.generated ? new Date(d.generated).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "pending";
      $("#stats").textContent = `${(d.count || 0).toLocaleString("en-GB")} live roles · ${(d.companies || 0).toLocaleString("en-GB")} licensed sponsors · updated ${upd}`;
      apply();
    })
    .catch(() => { $("#stats").textContent = "Couldn't load jobs right now — please refresh."; apply(); });
})();
