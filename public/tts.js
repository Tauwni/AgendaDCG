// Lecture à voix haute des PDF de cours avec la voix intégrée de l'appareil (gratuit, sans limite).
(() => {
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  let lib, chunks = [], pos = 0, playing = false, rate = Number(localStorage.getItem("tts-rate")) || 1, bar, token = 0, current = "";
  const save = () => { try { if (current) localStorage.setItem("tts-pos:" + current, pos); } catch {} };
  const synth = window.speechSynthesis;

  function loadLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    lib ||= new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = PDFJS + "pdf.min.js";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(window.pdfjsLib); };
      s.onerror = () => { lib = null; ko(new Error("Lecteur PDF indisponible (connexion ?)")); };
      document.head.appendChild(s);
    });
    return lib;
  }

  async function extract(url) {
    const pdfjs = await loadLib();
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error("PDF introuvable");
    const doc = await pdfjs.getDocument({ data: await res.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      let line = "", out = [];
      for (const it of c.items) { line += it.str; if (it.hasEOL) { out.push(line); line = ""; } else if (it.str && !/[\s-]$/.test(it.str)) line += " "; }
      out.push(line);
      pages.push(out.join("\n"));
    }
    return pages.join("\n\n")
      .replace(/(\w)-\n(\w)/g, "$1$2")            // mots coupés en fin de ligne
      .replace(/[•▪●◦■□►➢✓]/g, " ")
      .replace(/([^.!?:;\n])\n(?=[a-zà-ÿ])/g, "$1 ") // lignes d'une même phrase
      .replace(/[ \t]+/g, " ").trim();
  }

  function split(text) {
    const out = [];
    for (const para of text.split(/\n+/)) {
      const p = para.trim(); if (!p) continue;
      for (const s of p.match(/[^.!?]+[.!?]*\s*/g) || [p]) {
        let t = s.trim();
        while (t.length > 220) { const k = t.lastIndexOf(" ", 220) > 80 ? t.lastIndexOf(" ", 220) : 220; out.push(t.slice(0, k)); t = t.slice(k).trim(); }
        if (/[\p{L}\d]/u.test(t)) out.push(t);
      }
    }
    return out;
  }

  function voice() {
    const fr = synth.getVoices().filter((v) => /^fr/i.test(v.lang));
    const score = (v) => (/premium|enhanced|améliorée|natural|neural|siri/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (/fr-FR/i.test(v.lang) ? 1 : 0) + (v.localService ? 0.5 : 0);
    return fr.sort((a, b) => score(b) - score(a))[0];
  }

  function speak() {
    if (pos >= chunks.length) { pos = 0; stop(); return; }
    const my = token, u = new SpeechSynthesisUtterance(chunks[pos]);
    const v = voice(); if (v) u.voice = v;
    u.lang = v?.lang || "fr-FR"; u.rate = rate;
    u.onend = () => { if (my !== token || !playing) return; pos++; render(); speak(); };
    u.onerror = (e) => { if (my === token && e.error !== "interrupted" && e.error !== "canceled") { pos++; speak(); } };
    synth.speak(u);
  }

  function play() { playing = true; token++; synth.cancel(); speak(); render(); }
  function pause() { playing = false; token++; synth.cancel(); render(); }
  function stop() { save(); playing = false; token++; synth.cancel(); bar?.remove(); bar = null; }
  function jump(d) { pos = Math.max(0, Math.min(chunks.length - 1, pos + d)); if (playing) play(); else render(); }

  function render() {
    if (!bar) return;
    bar.querySelector("[data-t=play]").textContent = playing ? "⏸" : "▶︎";
    bar.querySelector("[data-t=prog]").textContent = chunks.length ? `${Math.round((100 * pos) / chunks.length)} %` : "";
    bar.querySelector("[data-t=rate]").textContent = `×${rate}`;
    bar.querySelector("[data-t=line]").textContent = chunks[pos] || "";
    save();
  }

  function makeBar(title) {
    bar?.remove();
    bar = document.createElement("div");
    bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Lecture à voix haute");
    bar.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(76px + env(safe-area-inset-bottom));z-index:60;display:flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:calc(100% - 24px);width:520px;padding:8px 10px;border-radius:16px;background:var(--bg2,#222);color:var(--text,#fff);box-shadow:0 8px 30px rgba(0,0,0,.25);font-size:14px";
    const b = (t, label, s = "") => `<button data-t="${t}" aria-label="${label}" style="min-width:36px;height:36px;border-radius:10px;font-size:16px;${s}">${t === "rate" ? "" : label}</button>`;
    bar.innerHTML = `<span style="font-size:18px">🎧</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-t="title"></span><span data-t="prog" style="color:var(--text2,#aaa);font-size:12px"></span>
      ${b("back", "⏪")}${b("play", "▶︎", "background:var(--accent,#e33);color:#fff")}${b("next", "⏩")}${b("rate", "Vitesse", "font-size:13px;font-weight:600")}${b("close", "✕")}
      <div data-t="line" style="flex-basis:100%;font-size:13px;line-height:1.35;color:var(--text2,#aaa);max-height:3.9em;overflow:hidden"></div>`;
    bar.querySelector("[data-t=title]").textContent = title;
    bar.querySelector("[data-t=back]").onclick = () => jump(-3);
    bar.querySelector("[data-t=next]").onclick = () => jump(3);
    bar.querySelector("[data-t=play]").onclick = () => (playing ? pause() : play());
    bar.querySelector("[data-t=close]").onclick = stop;
    bar.querySelector("[data-t=rate]").onclick = () => {
      const steps = [0.8, 1, 1.25, 1.5, 1.75, 2]; rate = steps[(steps.indexOf(rate) + 1) % steps.length];
      try { localStorage.setItem("tts-rate", rate); } catch {}
      if (playing) play(); else render();
    };
    document.body.appendChild(bar);
    if (window.matchMedia("(min-width: 900px)").matches) bar.style.bottom = "20px";
  }

  window.Lecteur = {
    supported: !!synth,
    async read(url, title, onStatus) {
      if (!synth) throw new Error("La lecture à voix haute n'est pas disponible sur ce navigateur");
      onStatus?.("Préparation de la lecture…");
      const text = await extract(url);
      chunks = split(text); pos = 0; current = url;
      if (chunks.join(" ").length < 80) throw new Error("Ce PDF est une image (scan) : pas de texte à lire");
      let saved = 0; try { saved = Number(localStorage.getItem("tts-pos:" + url)) || 0; } catch {}
      if (saved > 0 && saved < chunks.length - 1) pos = saved; // reprise là où on s'était arrêté
      makeBar(title);
      play();
    },
    stop, extract,
  };
  if (synth) synth.onvoiceschanged = () => {};
})();
