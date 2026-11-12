// Agenda DCG — Onglet Réviser et révisions personnalisées (niveaux, méthodes, créneaux du week-end).
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

/* ---------- Réviser : Objectif DCG ---------- */
const REVISE_URL = "https://objectif-dcg.netlify.app/";
const REVISE_UES = ["UE2", "UE4", "UE6"];
function renderReviser() {
  const today = iso(new Date());
  const next = state.events.filter((e) => DEADLINE.has(e.kind || "eval") && e.date >= today && !isDone(e.id)).slice(0, 4);
  const covered = (e) => REVISE_UES.includes((e.subject || "").split(" · ")[0]);
  $("#page-reviser").innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Réviser</h1><div class="page-sub">Flash cards, fiches et quiz avec Objectif DCG</div></div></div>
    ${revisionProgram()}
    <div class="section">
      <div class="group revise-card">
        <img src="https://objectif-dcg.netlify.app/icon-192.png" alt="" width="64" height="64">
        <div>
          <b>Objectif DCG</b>
          <p>Plus de 3 500 flash cards, des quiz, une pile du jour et une ligue pour réviser le droit fiscal (UE4), le droit des sociétés (UE2) et la finance (UE6).</p>
          <a class="btn-row blue" href="${REVISE_URL}" target="_blank" rel="noopener">Ouvrir Objectif DCG</a>
        </div>
      </div>
    </div>
    ${next.length ? `<div class="section"><h2>À réviser en priorité</h2><div class="list">${next.map((e) => evCard(e, { withDate: true, countdown: true })).join("")}</div>
      <p class="page-sub" style="margin-top:8px">${next.some(covered) ? "Les matières UE2, UE4 et UE6 sont dans Objectif DCG : lance une révision express avant le contrôle." : "Ces matières ne sont pas encore dans Objectif DCG : appuie-toi sur les fiches de l'onglet Cours."}</p></div>` : ""}
    <div class="section"><p class="page-sub">Objectif DCG est une appli créée par un camarade de la classe. Ta progression y est gardée sur son site, avec ton propre compte.</p></div>`;
}

function revisionProgram() {
  const slots = nextRevisionSlots(4);
  if (!slots.length) return "";
  const mode = revMode() === "sujets" ? "révision le matin, sujets le soir" : "révision seule";
  return `<div class="section"><h2>Mon programme de révision</h2>
    ${hasLevels() ? `<p class="page-sub" style="margin:0 0 8px">Ma méthode : <b>${mode}</b>${revMode() === advisedMode() ? " (conseillée pour toi)" : ""}.</p>` : ""}
    <div class="group">${slots.map(revRow).join("")}</div>
    <div style="margin-top:8px">${examButton()}</div>
    <button class="btn-row ${hasLevels() ? "" : "blue"}" style="margin-top:8px" data-open-levels>${hasLevels() ? "Modifier ma méthode et mon niveau" : "Personnaliser mes révisions (1 min)"}</button></div>`;
}

function openClass(id) {
  const key = id.split(":")[1];
  const c = classesOn(key).find((x) => x.id === id);
  if (!c) return;
  const chs = state.chapters.filter((x) => x.subject === c.subject);
  const bd = openSheet(`
    <div class="sheet-head"><button class="link" data-act="close">Fermer</button><h3></h3><span></span></div>
    <div class="sheet-body">
      <div>
        <span class="kind-badge" style="--c:${col(c.color)}">${kindIcon("cours")}${c.revision ? "Révision · créneau conseillé" : "Cours · emploi du temps"}</span>
        <h2 class="detail-title" style="--c:${col(c.color)}"><span class="bar"></span><span>${esc(revTitle(c))}</span></h2>
        <div class="detail-sub">${esc(c.subject)} · ${longDate(key)} · ${esc(c.time)}–${esc(c.end)}</div>
      </div>
      ${c.revision ? (hasLevels() ? `<div class="label">Au programme de ce créneau</div>${revisionDetail(c)}<button class="btn-row" data-act="levels">Modifier mon niveau par matière</button>`
        : `<button class="btn-row blue" data-act="levels">Personnaliser mes révisions (1 min)</button>`) : ""}
      ${chs.length ? `<button class="btn-row blue" data-act="cours">Voir les cours de ${esc(c.subject.split(" · ")[0])} (${plural(chs.length, "chapitre")})</button>` : ""}
      <button class="btn-row" data-act="revise">Réviser avec Objectif DCG</button>
      <div class="detail-sub">${c.revision ? "Créneau de révision conseillé : le matin pour la mémorisation, des séances de 1 h 30 à 2 h 30 avec pauses, et une reprise des cours de jeudi et vendredi dans les 48 h." : "Cours fixe de l'emploi du temps : il revient chaque semaine."}</div>
    </div>`);
  bd.querySelector("[data-act=close]").onclick = () => closeSheet();
  const go = bd.querySelector("[data-act=cours]");
  if (go) go.onclick = () => { closeSheet(); showTab("cours"); };
  bd.querySelectorAll("[data-corr]").forEach((b) => b.onclick = () => { if (confirm("Tu es sûr de vouloir voir la correction ? Essaie d'abord de finir le sujet seul.")) window.open(`/api/files/${encodeURIComponent(b.dataset.corr)}`, "_blank", "noopener"); });
  const lv = bd.querySelector("[data-act=levels]");
  if (lv) lv.onclick = () => { closeSheet(); setTimeout(() => openLevels(() => openClass(id)), 250); };
  bd.querySelector("[data-act=revise]").onclick = () => window.open(REVISE_URL, "_blank", "noopener");
}

/* ---------- Révisions personnalisées (niveau 1–10 par matière) ---------- */
const revSubjects = () => [...new Map((state.schedule?.classes || []).filter((c) => c.kind !== "revision").map((c) => [norm(c.subject), c.subject])).values()];
const levelOf = (s) => { const l = state.profile?.levels || {}; const k = Object.keys(l).find((x) => sameSubject(x, s)); return k ? l[k] : null; };
const hasLevels = () => Object.keys(state.profile?.levels || {}).some((k) => k !== "__mode");
const LEVEL_WORD = (n) => n <= 3 ? "à reprendre" : n <= 5 ? "fragile" : n <= 7 ? "correct" : "solide";
/** Suggestions pour le week-end qui contient `key` : liste ordonnée, répartie sur les créneaux. */
function revisionPicks(key) {
  const d = parse(key), sat = iso(addDays(d, d.getDay() === 0 ? -1 : 6 - d.getDay()));
  const weekN = Math.floor(parse(sat).getTime() / (7 * 864e5));
  const items = [], seen = new Set();
  const deadlines = state.events.filter((e) => ["eval", "examen", "devoir", "exercice"].includes(e.kind || "eval") && e.date > sat && !isDone(e.id));
  for (const s of revSubjects()) {
    const lvl = levelOf(s) ?? 5, weak = (11 - lvl) / 10;
    const all = chaptersOf(s), fresh = all.filter((c) => !recentlyRevised(c.id));
    const chs = fresh.length ? fresh : all; // tout est révisé : on repart pour un tour
    for (const e of deadlines.filter((x) => sameSubject(x.subject, s))) {
      const days = Math.round((parse(e.date) - parse(sat)) / 864e5);
      if (days > 14) continue;
      const linked = (e.chapters || []).map(chapterById).filter(Boolean);
      for (const ch of linked.length ? linked : [null]) {
        const id = ch ? ch.id : "s:" + s + e.id; if (seen.has(id)) continue; seen.add(id);
        items.push({ subject: s, chapter: ch, score: 4 + 3 * (1 - days / 14) + 2 * weak, why: `${kindLabel(e.kind || "eval")} dans ${plural(days, "jour")}` });
      }
    }
    // Rotation des chapitres (révision espacée) : plus la matière est faible, plus elle revient souvent
    const n = lvl <= 3 ? 3 : lvl <= 6 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const ch = chs.length ? chs[(weekN * n + i) % chs.length] : null;
      const id = ch ? ch.id : "s:" + s + i; if (seen.has(id) || (!ch && i)) continue; seen.add(id);
      items.push({ subject: s, chapter: ch, score: 3 * weak - i * 0.3, why: `Niveau ${lvl}/10 · ${LEVEL_WORD(lvl)}` });
    }
  }
  return items.sort((a, b) => b.score - a.score);
}
/* Deux méthodes (choisies dans « Mon niveau ») :
   - "sujets" : le matin on révise 2 chapitres, en fin d'après-midi on fait les sujets de CES chapitres ;
   - "revision" : chaque créneau révise ses propres chapitres, sans exercice. */
const MODE_KEY = "__mode";
const revMode = () => (state.profile?.levels || {})[MODE_KEY] === 2 ? "sujets" : (state.profile?.levels || {})[MODE_KEY] === 1 ? "revision" : advisedMode();
/** Conseil : peu de bases (moyenne < 5) → d'abord réviser ; sinon s'entraîner sur sujets. */
function advisedMode() {
  const ls = revSubjects().map((s) => levelOf(s) ?? 5);
  const avg = ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : 5;
  return avg < 5 ? "revision" : "sujets";
}
function revSlot(c) { // position du créneau dans le week-end : jour (0 = samedi, 1 = dimanche) et moment (0 = matin, 1 = fin d'après-midi)
  const d = parse(c.date), day = d.getDay() === 0 ? 1 : 0;
  const same = classesOn(c.date).filter((x) => x.revision);
  return { day, part: Math.max(0, same.findIndex((x) => x.id === c.id)) };
}
const isSujetSlot = (c) => c.revision && revMode() === "sujets" && revSlot(c).part === 1;
function revisionFor(c) {
  if (!c.revision || !hasLevels()) return [];
  let all = revisionPicks(c.date);
  if (revMode() === "sujets") all = [...all.filter((p) => fileOf(p.chapter, "sujet")), ...all.filter((p) => !fileOf(p.chapter, "sujet"))];
  const { day, part } = revSlot(c);
  const block = revMode() === "sujets" ? day : day * 2 + part; // en mode sujets, matin et soir partagent les mêmes chapitres
  return all.slice(block * 2, block * 2 + 2);
}
const revTitle = (c) => !c.revision ? c.title : isSujetSlot(c) ? "Sujets d'entraînement" : "Révision des chapitres";
const fileOf = (ch, slot) => ch?.files?.[slot] || null;
const fileLink = (f, label) => `<a class="nav-row" href="/api/files/${encodeURIComponent(f.key)}" target="_blank" rel="noopener"><span class="nav-body"><b>${esc(label)}</b><small>${esc(f.name)}</small></span>${ICON.chevron}</a>`;
function revisionDetail(c) {
  const picks = revisionFor(c);
  const modeLine = `<div class="detail-sub" style="margin-bottom:8px">Ta méthode : <b>${revMode() === "sujets" ? "révision le matin, sujets le soir" : "révision seule"}</b>${revMode() === advisedMode() ? " (conseillée pour toi)" : ""}.</div>`;
  if (!picks.length) return modeLine + `<div class="group"><div class="hint">Rien de prioritaire : reprends librement un chapitre.</div></div>`;
  const list = (ps) => `<div class="group">${ps.map((p) => `<div class="set-row"><span><b>${esc(pickLabel(p))}</b><small>${esc(p.why)}</small></span></div>`).join("")}</div>`;
  if (!isSujetSlot(c)) {
    const after = revMode() === "sujets" ? " En fin d'après-midi, tu feras les sujets de ces chapitres." : "";
    return modeLine + `<div class="detail-sub" style="margin-bottom:8px">Relis le cours, fais-toi une fiche et récite sans regarder.${after}</div>`
      + picks.map((p) => `<div class="label">${esc(pickLabel(p))} · ${esc(p.why)}</div><div class="group">${fileOf(p.chapter, "cours") ? fileLink(fileOf(p.chapter, "cours"), "Fiche de cours") + `<button class="btn-row" data-listen="${esc(fileOf(p.chapter, "cours").key)}" data-title="${esc(pickLabel(p))}">🎧 Écouter la fiche</button>` + revisedButton(p.chapter) : `<div class="hint">Pas de fiche de cours en ligne : reprends ton cours.</div>`}</div>`).join("");
  }
  const withSujet = picks.filter((p) => fileOf(p.chapter, "sujet")), without = picks.filter((p) => !fileOf(p.chapter, "sujet"));
  return modeLine + `<div class="detail-sub" style="margin-bottom:8px">Les sujets des chapitres révisés ce matin. Fais-les sans regarder la correction.</div>`
    + withSujet.map((p) => `<div class="label">${esc(pickLabel(p))}</div><div class="group">${fileLink(fileOf(p.chapter, "sujet"), "Sujet")}${fileOf(p.chapter, "corrige") ? `<button class="btn-row" data-corr="${esc(fileOf(p.chapter, "corrige").key)}">Voir la correction</button>` : `<div class="hint">Pas de correction en ligne pour ce sujet.</div>`}</div>`).join("")
    + (without.length ? `<div class="label" style="margin-top:12px">${withSujet.length ? "Pas de sujet pour l'autre chapitre." : "Pas de sujet en ligne pour ces chapitres."} Sinon voici des chapitres à réviser :</div>${list(without)}` : "");
}
const revisedButton = (ch) => ch ? `<button class="btn-row ${isRevised(ch.id) ? "" : "blue"}" data-revised="${ch.id}">${isRevised(ch.id) ? "✓ Révisé · annuler" : "Marquer comme révisé"}</button>` : "";
const pickLabel = (p) => p.chapter ? `${p.subject.split(" · ")[0]} · ${p.chapter.title}` : `${p.subject.split(" · ")[0]} · reprendre le cours`;
function openLevels(after) {
  const subs = revSubjects();
  const bd = openSheet(`
    <div class="sheet-head"><button class="link" data-act="close">Annuler</button><h3>Mon niveau</h3><button class="link" data-act="save"><b>Enregistrer</b></button></div>
    <div class="sheet-body">
      <div class="detail-sub">Note de 1 à 10 ton niveau dans chaque matière. Les créneaux de révision du week-end te proposeront plus souvent tes matières faibles, en plus des chapitres de tes prochaines évals. Personne d'autre ne voit tes réponses.</div>
      <div class="label">Ma méthode de révision le week-end</div>
      <div class="group">
        <label class="set-row"><span><b>Révision le matin, sujets en fin d'après-midi</b><small>Tu révises 2 chapitres le matin puis tu fais leurs sujets (correction sur demande). Idéal quand les bases sont là ou qu'une éval approche.</small></span><input type="radio" name="revmode" value="2"></label>
        <label class="set-row"><span><b>Révision seule</b><small>Chaque créneau révise ses propres chapitres, sans exercice. Idéal pour reconstruire les bases quand plusieurs matières sont fragiles.</small></span><input type="radio" name="revmode" value="1"></label>
      </div>
      <div class="detail-sub" data-advice></div>
      <div class="label">Mon niveau par matière</div>
      ${subs.map((s, i) => { const v = levelOf(s) ?? 5; return `<div class="group" style="padding:12px 14px"><div style="display:flex;justify-content:space-between"><b>${esc(s)}</b><span data-out="${i}">${v}/10 · ${LEVEL_WORD(v)}</span></div><input type="range" min="1" max="10" step="1" value="${v}" data-lvl="${i}" style="width:100%;accent-color:var(--accent)"></div>`; }).join("")}
    </div>`);
  const advise = () => {
    const vals = [...bd.querySelectorAll("[data-lvl]")].map((r) => Number(r.value)), avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    bd.querySelector("[data-advice]").textContent = avg < 5 ? "Conseil pour toi : la révision seule, le temps de consolider tes bases (moyenne de tes niveaux sous 5/10)." : "Conseil pour toi : révision le matin et sujets le soir, pour t'entraîner comme le jour de l'éval.";
  };
  const cur = (state.profile?.levels || {})[MODE_KEY] || (advisedMode() === "sujets" ? 2 : 1);
  bd.querySelector(`[name=revmode][value="${cur}"]`).checked = true;
  advise();
  bd.querySelectorAll("[data-lvl]").forEach((r) => r.oninput = () => { bd.querySelector(`[data-out="${r.dataset.lvl}"]`).textContent = `${r.value}/10 · ${LEVEL_WORD(Number(r.value))}`; advise(); });
  bd.querySelector("[data-act=close]").onclick = () => closeSheet();
  bd.querySelector("[data-act=save]").onclick = async () => {
    const levels = {}; bd.querySelectorAll("[data-lvl]").forEach((r) => levels[subs[r.dataset.lvl]] = Number(r.value));
    levels[MODE_KEY] = Number(bd.querySelector("[name=revmode]:checked")?.value || 2);
    try { state.profile = await send("profile/levels", "PUT", { levels }); closeSheet(); toast("Révisions personnalisées ✓"); renderAll(); after?.(); }
    catch (err) { toast(err.message); }
  };
}
