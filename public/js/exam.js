// Agenda DCG — Suivi des chapitres révisés et examen blanc chronométré.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

/* ---------- Chapitres révisés (perso) ---------- */
const revisedOn = (id) => (state.profile?.revised || {})[id] || null;
const isRevised = (id) => !!revisedOn(id);
/** Révisé récemment : on ne le repropose pas dans la rotation pendant 30 jours. */
const recentlyRevised = (id) => { const d = revisedOn(id); return !!d && (Date.now() - parse(d).getTime()) < 30 * 864e5; };
async function setRevised(id, on) {
  state.profile = await send("profile/revised", "PUT", { chapter: id, revised: on });
  render();
}
function subjectProgress(subject) {
  const list = chaptersOf(subject), done = list.filter((c) => isRevised(c.id)).length;
  return { done, total: list.length, pct: list.length ? Math.round((100 * done) / list.length) : 0 };
}
const progressBar = (pct) => `<span style="display:block;height:4px;border-radius:2px;background:var(--line);margin-top:6px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:var(--green,#34c759)"></span></span>`;
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-revised]");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  try {
    const on = !isRevised(b.dataset.revised);
    await setRevised(b.dataset.revised, on);
    toast(on ? "Chapitre révisé ✓" : "Remis à réviser");
    b.textContent = on ? "✓ Révisé · annuler" : "Marquer comme révisé";
    b.classList.toggle("blue", !on);
  } catch (err) { toast(err.message); }
}, true);

/* ---------- Examen blanc chronométré ---------- */
let exam = null; // { chapter, minutes, end, pausedLeft, started, timer }
const examFmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0"); };
const examDur = (min) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? " " + String(min % 60).padStart(2, "0") : ""}`;

function openExam(chapterId) {
  if (exam) return showExam();
  const withSujet = state.chapters.filter((c) => c.files?.sujet).sort((a, b) => (a.subject + a.title).localeCompare(b.subject + b.title, "fr", { numeric: true }));
  if (!withSujet.length) { toast("Aucun sujet en ligne pour l'instant"); return; }
  let minutes = 120;
  const bd = openSheet(`
    <div class="sheet-head"><button class="link" data-act="close">Annuler</button><h3>Examen blanc</h3><span></span></div>
    <div class="sheet-body">
      <div class="detail-sub">Choisis un sujet et ta durée. Le chrono tourne pendant que tu composes, tu peux l'arrêter quand tu veux, et la correction s'affiche toute seule à la fin.</div>
      <div class="label">Sujet</div>
      <div class="group" style="padding:10px 14px"><select class="search" data-exam="chapter">${withSujet.map((c) => `<option value="${c.id}"${c.id === chapterId ? " selected" : ""}>${esc(c.subject.split(" · ")[0])} · ${esc(c.title)}${c.files.corrige ? "" : " (sans corrigé)"}</option>`).join("")}</select></div>
      <div class="label">Durée</div>
      <div class="group" style="padding:12px 14px">
        <div style="display:flex;justify-content:space-between"><b data-exam="out">${examDur(minutes)}</b><span style="color:var(--text2)">de 15 min à 4 h</span></div>
        <input type="range" min="15" max="240" step="15" value="${minutes}" data-exam="range" style="width:100%">
      </div>
      <button class="btn-row blue" data-act="start">Commencer</button>
    </div>`);
  bd.querySelector("[data-act=close]").onclick = () => closeSheet();
  bd.querySelector("[data-exam=range]").oninput = (ev) => { minutes = Number(ev.target.value); bd.querySelector("[data-exam=out]").textContent = examDur(minutes); };
  bd.querySelector("[data-act=start]").onclick = () => {
    exam = { chapter: bd.querySelector("[data-exam=chapter]").value, minutes, end: Date.now() + minutes * 60000, pausedLeft: null, started: Date.now(), worked: 0, last: Date.now() };
    exam.timer = setInterval(examTick, 500);
    showExam();
  };
}

function examTick() {
  if (!exam) return;
  const left = exam.pausedLeft ?? exam.end - Date.now();
  if (exam.pausedLeft == null) { exam.worked += Date.now() - exam.last; }
  exam.last = Date.now();
  const total = exam.minutes * 60000;
  const t = document.querySelector("[data-exam=time]"), bar = document.querySelector("[data-exam=bar]");
  if (t) { t.textContent = examFmt(left); t.style.color = left < 5 * 60000 ? "var(--accent)" : ""; }
  if (bar) bar.style.width = Math.min(100, 100 * (1 - left / total)) + "%";
  if (left <= 0) finishExam(true);
}

function showExam() {
  const c = chapterById(exam.chapter);
  const bd = openSheet(`
    <div class="sheet-head"><button class="link" data-act="hide">Réduire</button><h3>Examen blanc</h3><span></span></div>
    <div class="sheet-body">
      <div class="detail-sub">${esc(c ? c.subject.split(" · ")[0] + " · " + c.title : "")}</div>
      <div class="group" style="padding:22px 16px;text-align:center">
        <div data-exam="time" style="font-size:56px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em">${examFmt(exam.pausedLeft ?? exam.end - Date.now())}</div>
        <div style="height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:12px"><div data-exam="bar" style="height:100%;width:0;background:var(--accent);transition:width .5s linear"></div></div>
        <div class="detail-sub" style="margin-top:10px">Durée prévue : ${examDur(exam.minutes)}</div>
      </div>
      ${c?.files?.sujet ? `<a class="btn-row blue" style="text-decoration:none;text-align:center" href="/api/files/${encodeURIComponent(c.files.sujet.key)}" target="_blank" rel="noopener">Ouvrir le sujet</a>` : ""}
      <div style="display:flex;gap:8px">
        <button class="btn-row" style="flex:1" data-act="pause">${exam.pausedLeft == null ? "Pause" : "Reprendre"}</button>
        <button class="btn-row" style="flex:1" data-act="more">+ 15 min</button>
      </div>
      <button class="btn-row" data-act="stop">Terminer maintenant</button>
    </div>`);
  bd.querySelector("[data-act=hide]").onclick = () => { closeSheet(); toast("Le chrono continue : onglet Réviser pour y revenir"); render(); };
  bd.querySelector("[data-act=pause]").onclick = (ev) => {
    if (exam.pausedLeft == null) { exam.pausedLeft = exam.end - Date.now(); ev.target.textContent = "Reprendre"; }
    else { exam.end = Date.now() + exam.pausedLeft; exam.pausedLeft = null; ev.target.textContent = "Pause"; }
  };
  bd.querySelector("[data-act=more]").onclick = () => { exam.minutes += 15; if (exam.pausedLeft == null) exam.end += 15 * 60000; else exam.pausedLeft += 15 * 60000; examTick(); toast("15 minutes ajoutées"); };
  bd.querySelector("[data-act=stop]").onclick = () => { if (confirm("Terminer l'examen blanc maintenant ?")) finishExam(false); };
  examTick();
}

function finishExam(timeUp) {
  if (!exam) return;
  clearInterval(exam.timer);
  const c = chapterById(exam.chapter), worked = Math.max(1, Math.round(exam.worked / 60000));
  exam = null;
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  const bd = openSheet(`
    <div class="sheet-head"><button class="link" data-act="close">Fermer</button><h3>Examen blanc terminé</h3><span></span></div>
    <div class="sheet-body">
      <div class="group" style="padding:18px 16px;text-align:center"><div style="font-size:22px;font-weight:700">${timeUp ? "Temps écoulé ⏱" : "Terminé"}</div><div class="detail-sub" style="margin-top:6px">Tu as composé ${examDur(worked)}${c ? " sur « " + esc(c.title) + " »" : ""}.</div></div>
      <div class="label">Correction</div>
      <div class="group">${c?.files?.corrige ? fileLink(c.files.corrige, "Corrigé") : `<div class="hint">Pas de correction en ligne pour ce sujet.</div>`}${c?.files?.sujet ? fileLink(c.files.sujet, "Revoir le sujet") : ""}</div>
      ${c ? `<button class="btn-row ${isRevised(c.id) ? "" : "blue"}" data-revised="${c.id}">${isRevised(c.id) ? "✓ Révisé · annuler" : "Marquer comme révisé"}</button>` : ""}
    </div>`);
  bd.querySelector("[data-act=close]").onclick = () => closeSheet();
  toast(timeUp ? "Temps écoulé : voici la correction" : "Examen blanc terminé");
  render();
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-open-exam]"); if (b) openExam(b.dataset.openExam || undefined); });
const examButton = () => `<button class="btn-row ${exam ? "blue" : ""}" data-open-exam>${exam ? "⏱ Examen blanc en cours · revenir au chrono" : "⏱ Examen blanc chronométré"}</button>`;
