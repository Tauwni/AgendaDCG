// Agenda DCG — Écran Aujourd'hui.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

/* ---------- Today ---------- */
function renderToday() {
  const today = iso(new Date());
  const name = state.profile?.name || "";
  const h = new Date().getHours();
  const hello = h < 5 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
  const todays = dayEvents(today);
  const atWork = companyDay(today);
  const late = lateItems();
  const horizon = iso(addDays(new Date(), 21));
  const next = state.events.filter((e) => DEADLINE.has(e.kind || "eval") && e.date > today && e.date <= horizon && !isDone(e.id)).slice(0, 6);
  const fer = holiday(today);
  const monday = mondayOf(new Date()), sunday = addDays(monday, 6);
  const weekItems = state.events.filter((e) => DEADLINE.has(e.kind || "eval") && e.date >= iso(monday) && e.date <= iso(sunday));
  const weekDone = weekItems.filter((e) => isDone(e.id)).length;
  const pushOff = pushSupport().ok && !state.profile?.pushDevices;

  $("#page-today").innerHTML = `
    <div class="page-head"><div>
      <div class="today-date">${esc(dayMonth(today))}</div>
      <h1 class="page-title">${hello}${name ? ", " + esc(name) : ""}</h1>
      ${fer ? `<div class="page-sub">Jour férié : <b>${esc(fer)}</b></div>` : atWork ? `<div class="page-sub">Journée en <b>entreprise</b></div>` : ""}
    </div></div>

    <div class="section">
      <h2>Au programme aujourd'hui <button data-go-add>Ajouter</button></h2>
      <div class="list">${todays.length ? todays.map((e) => evCard(e)).join("") : `<div class="invite">${atWork ? "Journée en entreprise, pas de cours." : "Rien de prévu aujourd'hui."}</div>`}</div>
    </div>

    ${late.length ? `<div class="section">
      <h2>En retard</h2>
      <div class="list">${late.map((e) => evCard(e, { withDate: true, showLate: true })).join("")}</div>
    </div>` : ""}

    <div class="section">
      <h2>Prochaines échéances <button data-go="agenda">Agenda</button></h2>
      <div class="list">${next.length ? next.map((e) => evCard(e, { withDate: true, countdown: true })).join("") : `<div class="invite">Aucune évaluation ni devoir dans les 3 prochaines semaines.</div>`}</div>
    </div>

    ${todayRevision()}
    ${tomorrowBlock(today)}

    <div class="section">
      <div class="stats-line">
        <button class="stat" data-go="agenda"><b>${weekItems.length ? `${weekDone}/${weekItems.length}` : "—"}</b><span>${weekItems.length ? "faits cette semaine" : "rien à rendre cette semaine"}</span></button>
      </div>
    </div>

    ${pushOff ? `<div class="section"><button class="invite" data-go="settings">${bellSvg}<span>Active les rappels pour ne rien oublier. <b>Activer</b></span></button></div>` : ""}`;
  $("#page-today").querySelectorAll(".list").forEach((l) => { [...l.children].forEach((c, i) => c.style.setProperty("--i", i)); l.classList.add("enter"); });
}
/** Prochains créneaux de révision (aujourd'hui compris, pas encore terminés), sur 8 jours. */
function nextRevisionSlots(max = 4) {
  const now = new Date(), hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, out = [];
  for (let i = 0; i < 8 && out.length < max; i++) {
    const key = iso(addDays(now, i));
    for (const c of classesOn(key)) if (c.revision && (i > 0 || c.end > hm) && out.length < max) out.push(c);
  }
  return out;
}
const revLines = (c) => revisionFor(c).map((p) => `<small>${isSujetSlot(c) ? "✏️" : "📖"} ${esc(pickLabel(p))}</small>`).join("");
const revRow = (c) => `<button class="nav-row" data-event="${c.id}"><span class="nav-body"><b>${esc(revTitle(c))}</b><small>${esc(c.date === iso(new Date()) ? "Aujourd'hui" : dayMonth(c.date))} · ${esc(c.time)}–${esc(c.end)}</small>${hasLevels() ? revLines(c) : "<small>✨ Touche pour personnaliser</small>"}</span>${ICON.chevron}</button>`;
function todayRevision() {
  const c = nextRevisionSlots(1)[0];
  if (!c) return "";
  const fiche = !isSujetSlot(c) && revisionFor(c).map((p) => ({ p, f: fileOf(p.chapter, "cours") })).find((x) => x.f);
  return `<div class="section"><h2>${c.date === iso(new Date()) ? "Ta révision du jour" : "Ta prochaine révision"} <button data-go="reviser">Programme</button></h2>
    <div class="group">${revRow(c)}${fiche ? `<button class="btn-row" data-listen="${esc(fiche.f.key)}" data-title="${esc(pickLabel(fiche.p))}">🎧 Écouter la fiche · ${esc(fiche.p.chapter.title)}</button>` : ""}</div></div>`;
}
function tomorrowBlock(today) {
  const key = iso(addDays(parse(today), 1)), list = dayEvents(key).filter((e) => !e.revision);
  if (!list.length) return "";
  return `<div class="section"><h2>Demain</h2><div class="list">${list.map((e) => evCard(e)).join("")}</div></div>`;
}
const bellSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.5a6 6 0 0112 0c0 7 3 8.5 3 8.5H3s3-1.5 3-8.5M10 20.5a2 2 0 004 0"/></svg>`;
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) { showTab(go.dataset.go); return; }
  if (e.target.closest("[data-go-add]")) { openEdit(null, iso(new Date())); return; }
  const row = e.target.closest("#page-today .nav-row[data-event], #page-reviser .nav-row[data-event]");
  if (row) { openDetail(row.dataset.event); return; }
  if (e.target.closest("[data-open-levels]")) openLevels();
});
