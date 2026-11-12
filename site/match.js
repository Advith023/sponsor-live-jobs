// CV matching, done entirely in the browser. The CV file is read locally and never sent anywhere.
// PDF/Word reading uses pdf.js and mammoth, loaded from a CDN only as code; the CV itself stays on the device.
window.CVMatch = (() => {
  const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
  const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  const MAMMOTH = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js";
  const STOP = new Set(("a an and or of the to in for with at on by from senior junior lead principal staff head chief associate " +
    "assistant graduate intern trainee mid level i ii iii iv manager director officer specialist executive uk london remote " +
    "hybrid contract permanent fixed term month months part full time team").split(" "));

  let vocab = null;

  async function loadSkills(url = "data/skills.json") {
    if (vocab) return vocab;
    const d = await fetch(url, { cache: "no-cache" }).then((r) => r.json());
    vocab = d.skills.map((s) => ({ n: s.n, g: !!s.g, cs: s.cs ? new RegExp(s.cs) : null, ci: s.ci ? new RegExp(s.ci) : null }));
    return vocab;
  }

  function skillsIn(text) {
    const low = text.toLowerCase();
    const found = new Set();
    vocab.forEach((s, i) => {
      if ((s.cs && s.cs.test(text)) || (s.ci && s.ci.test(low))) found.add(i);
    });
    return found;
  }

  const words = (t) => (t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9+#]+/).filter((w) => w.length > 1 && !STOP.has(w));

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Could not load the Word reader"));
      document.head.appendChild(s);
    });
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (file.size > 15e6) throw new Error("That file is over 15 MB.");
    if (name.endsWith(".pdf")) {
      const pdfjs = await import(PDFJS);
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      let text = "";
      for (let p = 1; p <= Math.min(doc.numPages, 15); p++) {
        const c = await (await doc.getPage(p)).getTextContent();
        text += c.items.map((i) => i.str + (i.hasEOL ? "\n" : " ")).join("") + "\n";
      }
      if (text.trim().length < 50) throw new Error("No text found in that PDF. If it's a scanned image, paste the text instead.");
      return text;
    }
    if (name.endsWith(".docx")) {
      if (!window.mammoth) await loadScript(MAMMOTH);
      return (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    }
    if (/\.(txt|md)$/.test(name)) return file.text();
    throw new Error("Please choose a PDF, Word (.docx) or text file.");
  }

  // ---- years of experience (rough estimate; the person can correct it)
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const DATE = "(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?\\s*|(\\d{1,2})\\s*[/.-]\\s*)?((?:19|20)\\d{2})";
  const RANGE = new RegExp(DATE + "\\s*(?:-|\u2013|\u2014|to|until|till)\\s*(?:" + DATE + "|(present|current|now|today|to date|ongoing))", "gi");
  const EDU = /universit|college|school|academy|bsc|msc|\bba\b|\bma\b|\bmba\b|phd|degree|bachelor|master|a[- ]levels?|gcse|diploma|education|coursework|thesis|module/i;
  const CLAIM = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:['\u2019])?\s*(?:of\s+)?(?:[a-z&/-]+\s+){0,4}?experience/i;

  function estimateYears(text) {
    const now = new Date(), nowM = now.getFullYear() * 12 + now.getMonth();
    const spans = [];
    let m;
    RANGE.lastIndex = 0;
    while ((m = RANGE.exec(text))) {
      // the line holding the dates, plus the line above it (job title or degree usually sits there)
      const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
      const prevStart = text.lastIndexOf("\n", Math.max(0, lineStart - 2)) + 1;
      const lineEnd = (text.indexOf("\n", m.index + m[0].length) + 1 || text.length + 1) - 1;
      const ctx = text.slice(prevStart, lineEnd).slice(-220);
      if (EDU.test(ctx)) continue; // skip education dates
      const sMonth = m[1] ? MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)] : (+m[2] || 1);
      const start = +m[3] * 12 + (Math.min(Math.max(sMonth, 1), 12) - 1);
      let end;
      if (m[7]) end = nowM;
      else {
        const eMonth = m[4] ? MONTHS[m[4].toLowerCase().slice(0, 4)] || MONTHS[m[4].toLowerCase().slice(0, 3)] : (+m[5] || 12);
        end = +m[6] * 12 + (Math.min(Math.max(eMonth, 1), 12) - 1);
      }
      end = Math.min(end, nowM);
      if (end >= start && start <= nowM && end - start < 50 * 12) spans.push([start, end + 1]);
    }
    let months = 0;
    if (spans.length) {
      spans.sort((a, b) => a[0] - b[0]);
      let [cs, ce] = spans[0];
      for (const [s2, e2] of spans.slice(1)) {
        if (s2 <= ce) ce = Math.max(ce, e2); else { months += ce - cs; [cs, ce] = [s2, e2]; }
      }
      months += ce - cs;
    }
    if (months >= 3) return { years: Math.round((months / 12) * 2) / 2, from: "dates" };
    const c = text.match(CLAIM);
    if (c && +c[1] <= 45) return { years: +c[1], from: "statement" };
    return { years: null, from: null };
  }

  function profile(text) {
    const exp = estimateYears(text);
    return { skills: skillsIn(text), words: new Set(words(text)), chars: text.length, years: exp.years, yearsFrom: exp.from };
  }

  const LEVEL_YEARS = { Senior: 4, Lead: 6, Director: 8 };

  // Keyword overlap only: share of the job's listed skills found on the CV, plus job-title words found on the CV.
  function score(job, cv) {
    // generic skills (often from company boilerplate) count when you have them, never against you
    const J = (job.k || []).filter((i) => vocab[i] && (!vocab[i].g || cv.skills.has(i)));
    const have = J.filter((i) => cv.skills.has(i));
    const missing = J.filter((i) => !cv.skills.has(i));
    const tw = [...new Set(words(job.t))];
    const tScore = tw.length ? tw.filter((w) => cv.words.has(w)).length / tw.length : 0;
    let pct, basis;
    if (J.length >= 3) { pct = 0.75 * (have.length / J.length) + 0.25 * tScore; basis = "full"; }
    else if (J.length) { pct = Math.min(0.69, 0.5 * (have.length / J.length) + 0.5 * tScore); basis = "limited"; }
    else { pct = tScore * 0.6; basis = "title"; } // without a description we can't call it a strong fit
    // Experience: only lowers the score when the CV clearly falls short
    let exp = null;
    if (cv.years != null) {
      const need = job.y || LEVEL_YEARS[job.lv] || null;
      if (need) {
        const gap = need - cv.years;
        if (gap > 0) pct *= Math.max(0.4, 1 - (job.y ? 0.15 : 0.08) * gap);
        exp = { need, fromTitle: !job.y, short: gap > 0.5 };
      } else if (job.lv === "Entry" && cv.years >= 5) {
        exp = { entry: true };
      }
    }
    pct = Math.round(pct * 100);
    const band = pct >= 70 ? "Strong keyword fit" : pct >= 50 ? "Good keyword fit" : pct >= 30 ? "Partial fit" : "Low fit";
    return { pct, band, basis, exp, have: have.map((i) => vocab[i].n), missing: missing.map((i) => vocab[i].n) };
  }

  return { loadSkills, readFile, profile, score, estimateYears, skillName: (i) => vocab[i].n };
})();
