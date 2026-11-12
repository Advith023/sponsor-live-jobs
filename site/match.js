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
    vocab = d.skills.map((s) => ({ n: s.n, cs: s.cs ? new RegExp(s.cs) : null, ci: s.ci ? new RegExp(s.ci) : null }));
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

  function profile(text) {
    return { skills: skillsIn(text), words: new Set(words(text)), chars: text.length };
  }

  // Keyword overlap only: share of the job's listed skills found on the CV, plus job-title words found on the CV.
  function score(job, cv) {
    const J = job.k || [];
    const have = J.filter((i) => cv.skills.has(i));
    const missing = J.filter((i) => !cv.skills.has(i));
    const tw = [...new Set(words(job.t))];
    const tScore = tw.length ? tw.filter((w) => cv.words.has(w)).length / tw.length : 0;
    let pct, basis;
    if (J.length >= 3) { pct = 0.75 * (have.length / J.length) + 0.25 * tScore; basis = "full"; }
    else if (J.length) { pct = Math.min(0.69, 0.5 * (have.length / J.length) + 0.5 * tScore); basis = "limited"; }
    else { pct = tScore * 0.6; basis = "title"; } // without a description we can't call it a strong fit
    pct = Math.round(pct * 100);
    const band = pct >= 70 ? "Strong keyword fit" : pct >= 50 ? "Good keyword fit" : pct >= 30 ? "Partial fit" : "Low fit";
    return { pct, band, basis, have: have.map((i) => vocab[i].n), missing: missing.map((i) => vocab[i].n) };
  }

  return { loadSkills, readFile, profile, score, skillName: (i) => vocab[i].n };
})();
