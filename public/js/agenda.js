// Agenda DCG — Écran Agenda : mois, semaine, cahier de texte.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

/* ---------- Agenda ---------- */
function byDate() {
  const m = {};
  for (const e of state.events) (m[e.date] ||= []).push(e);
  if (state.schedule) {
    const from = state.view === "month" ? state.month : state.weekStart;
    for (let i = -7; i < 45; i++) {
      const key = iso(addDays(from, i));
      const c = classesOn(key);
      if (c.length) m[key] = [...c, ...(m[key] || [])].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    }
    const sel = state.selected, c = classesOn(sel);
    if (c.length && !(m[sel] || []).some((e) => e.virtual)) m[sel] = [...c, ...(m[sel] || [])].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }
  return m;
}

function agendaTitleHtml() {
  const caret = `<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
  if (state.view === "month") {
    const m = state.month;
    return `${MONTHS[m.getMonth()]} <span>${m.getFullYear()}</span>${caret}`;
  }
  const a = state.weekStart, b = addDays(a, 6);
  const label = a.getMonth() === b.getMonth()
    ? `${MONTHS[a.getMonth()]} <span>${a.getFullYear()}</span>`
    : `${MONTHS_SHORT[a.getMonth()]} – ${MONTHS_SHORT[b.getMonth()]} <span>${b.getFullYear()}</span>`;
  return `${label}${caret}<small>Semaine ${weekNumber(a)}</small>`;
}

function monthHtml() {
  const map = byDate();
  const m = state.month;
  const lead = (m.getDay() + 6) % 7;
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  const today = iso(new Date());
  let html = "";
  for (let i = 0; i < cells; i++) {
    const n = i - lead + 1;
    if (n < 1 || n > days) { html += `<div class="day blank" aria-hidden="true"></div>`; continue; }
    const d = new Date(m.getFullYear(), m.getMonth(), n);
    const key = iso(d);
    const evs = map[key] || [];
    const fer = dayNote(key);
    const cls = ["day", key === today && "today", key === state.selected && "selected", d.getDay() % 6 === 0 && "weekend", fer && "holiday"].filter(Boolean).join(" ");
    const pills = (fer ? `<div class="pill holiday-pill">${esc(fer)}</div>` : "") + evs.slice(0, fer ? 2 : 3).map((e) => `<div class="pill" style="--c:${col(e.color)}${isDone(e.id) ? ";opacity:.45;text-decoration:line-through" : ""}">${esc(e.title)}</div>`).join("");
    const shown = fer ? 2 : 3;
    const more = evs.length > shown ? `<div class="more">+${evs.length - shown} autre${evs.length - shown > 1 ? "s" : ""}</div>` : "";
    const dots = (fer ? `<span class="dot holiday-dot"></span>` : "") + evs.slice(0, 3).map((e) => `<span class="dot" style="--c:${col(e.color)}"></span>`).join("");
    html += `<button class="${cls}" data-date="${key}" aria-label="${longDate(key)}${fer ? ", " + fer : ""}, ${plural(evs.length, "élément")}"><span class="num">${n}</span>${pills}${more}<span class="dots">${dots}</span></button>`;
  }
  return `<div class="grid" id="grid">${html}</div>`;
}

/* Semaine façon emploi du temps (ENT) : grille horaire 8 h – 19 h */
const TT_START = 8, TT_END = 19;
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
function weekHtml() {
  const map = byDate();
  const today = iso(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const key = iso(addDays(state.weekStart, i));
    if (i < 5 || (map[key] || []).length || classesOn(key).length) days.push(key);
  }
  const hours = Array.from({ length: TT_END - TT_START }, (_, i) => TT_START + i);
  const allDay = days.map((key) => {
    const evs = (map[key] || []).filter((e) => !e.time && !inClass(e));
    return `<div class="tt-allday">${evs.map((e) => `<button class="tt-chip" data-id="${e.id}" style="--c:${col(e.color)}">${kindIcon(e.kind || "eval")}${esc(e.title)}</button>`.replace('class="tt-chip"', `class="tt-chip tt-ev ${isDone(e.id) ? "done" : ""}"`)).join("")}</div>`;
  }).join("");
  const cols = days.map((key) => {
    const d = parse(key);
    const fer = holiday(key), work = companyDay(key);
    const inside = (map[key] || []).filter(inClass);
    const timed = (map[key] || []).filter((e) => e.time && !inside.includes(e)).map((e) => {
      const a = Math.max(toMin(e.time), TT_START * 60), b = Math.min(e.end ? toMin(e.end) : toMin(e.time) + 60, TT_END * 60);
      return { e, a, b: Math.max(b, a + 30) };
    }).sort((x, y) => x.a - y.a);
    const lanes = [];
    for (const t of timed) { let l = lanes.findIndex((end) => end <= t.a); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = t.b; t.lane = l; }
    const n = Math.max(1, lanes.length);
    const blocks = timed.map(({ e, a, b, lane }) => {
      const top = ((a - TT_START * 60) / 60) * 100 / (TT_END - TT_START), h = ((b - a) / 60) * 100 / (TT_END - TT_START);
      return `<button class="tt-block tt-ev ${isDone(e.id) ? "done" : ""} ${e.virtual ? "class" : ""}" data-id="${e.id}" style="--c:${col(e.color)};top:${top}%;height:${h}%;left:calc(${(lane / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)">
        <b>${esc(revTitle(e))}</b><span>${esc(e.time)}${e.end ? "–" + esc(e.end) : ""}${!e.virtual ? " · " + kindLabel(e.kind || "eval") : ""}</span>
        ${e.virtual ? inside.filter((x) => sameSubject(x.subject, e.subject)).map((x) => `<span class="tt-task tt-ev ${isDone(x.id) ? "done" : ""}" data-id="${x.id}">${kindIcon(x.kind || "eval")}${esc(x.title)}${(x.chapters || []).length ? ` · ${plural(x.chapters.length, "chap.")}` : ""}${(x.attachments || []).length ? " 📎" : ""}</span>`).join("") : ""}${e.revision && !hasLevels() ? `<span class="tt-task">✨ Clique pour personnaliser</span>` : ""}${e.revision ? revisionFor(e).map((p) => `<span class="tt-task">${isSujetSlot(e) ? "✏️" : "📖"} ${esc(pickLabel(p))}</span>`).join("") : ""}</button>`;
    }).join("");
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const line = key === today && nowMin > TT_START * 60 && nowMin < TT_END * 60 ? `<div class="tt-now" style="top:${((nowMin - TT_START * 60) / 60) * 100 / (TT_END - TT_START)}%"></div>` : "";
    return `<div class="tt-col ${work && !timed.length ? "work" : ""} ${fer ? "off" : ""} ${key === state.selected ? "selected" : ""}" data-date="${key}">
      ${hours.map(() => `<div class="tt-cell"></div>`).join("")}
      ${fer ? `<div class="tt-note">${esc(fer)}</div>` : work && !timed.length ? `<div class="tt-note">Entreprise</div>` : ""}
      ${blocks}${line}</div>`;
  }).join("");
  const heads = days.map((key) => {
    const d = parse(key);
    return `<button class="tt-head ${key === today ? "today" : ""}" data-date="${key}"><span>${DAYS[d.getDay()].slice(0, 3)}.</span><b>${d.getDate()}</b></button>`;
  }).join("");
  return `<div class="tt" style="--days:${days.length}">
    <div></div>${heads}
    <div class="tt-gut small">Journée</div>${allDay}
    <div class="tt-hours">${hours.map((h) => `<div>${h} h</div>`).join("")}</div>${cols}
  </div>`;
}

/* Cahier de texte : devoirs et évaluations à venir, regroupés par date de rendu */
function cahierHtml() {
  const today = iso(new Date());
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const work = state.events.filter((e) => DEADLINE.has(e.kind || "eval"));
  const todo = work.filter((e) => e.date >= today && !isDone(e.id));
  const fresh = work.filter((e) => e.date >= today && (e.createdAt || "") >= weekAgo).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const late = work.filter((e) => e.date < today && !isDone(e.id) && daysBetween(e.date, today) <= 30);
  const groups = {};
  for (const e of todo) (groups[e.date] ||= []).push(e);
  const label = (d) => { const n = daysBetween(today, d); return n === 0 ? "Pour aujourd'hui" : n === 1 ? "Pour demain" : `Pour ${dayMonth(d)}`; };
  const item = (e, opts = {}) => evCard(e, { ...opts, fresh: (e.createdAt || "") >= weekAgo });
  return `<div class="cahier">
    <div class="cahier-top"><p class="page-sub">${todo.length ? `${todo.length} ${todo.length > 1 ? "travaux" : "travail"} à faire${fresh.length ? ` · ${fresh.length} nouveau${fresh.length > 1 ? "x" : ""} cette semaine` : ""}` : "Tout est fait 🎉"}</p><button class="btn-row blue cahier-add" data-cahier-add>+ Nouveau devoir</button></div>
    ${late.length ? `<div class="section"><h2>En retard</h2><div class="list">${late.map((e) => item(e, { withDate: true, showLate: true })).join("")}</div></div>` : ""}
    ${Object.keys(groups).sort().map((d) => `<div class="section"><h2>${label(d)}</h2><div class="list">${groups[d].map((e) => item(e)).join("")}</div></div>`).join("") || `<div class="invite">Aucun devoir à venir.</div>`}
  </div>`;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-cahier-add]")) { const d = iso(addDays(new Date(), 1)); openEdit(null, d, { kind: "devoir", title: "", subject: "", date: d, time: "", color: "blue", notes: "", chapters: [] }); }
});

function renderPanel(animate) {
  const map = byDate();
  const today = iso(new Date());
  const sel = map[state.selected] || [];
  const fer = holiday(state.selected);
  $("#dayTitle").innerHTML = `<small>${state.selected === today ? "Aujourd'hui" : DAYS[parse(state.selected).getDay()]}</small>${parse(state.selected).getDate()} ${MONTHS[parse(state.selected).getMonth()]}`;
  $("#dayList").innerHTML = (fer ? `<div class="holiday-row">Jour férié · ${esc(fer)}</div>` : companyDay(state.selected) ? `<div class="holiday-row">Journée en entreprise</div>` : "") + (sel.length ? sel.map((e) => evCard(e)).join("") : `<div class="empty">Rien ce jour-là</div>`);
  const upcoming = state.events.filter((e) => e.date >= today && !isDone(e.id)).slice(0, 6);
  $("#upcomingList").innerHTML = upcoming.length ? upcoming.map((e) => evCard(e, { withDate: true })).join("") : `<div class="empty">Rien de prévu</div>`;
  for (const list of [$("#dayList"), $("#upcomingList")]) [...list.children].forEach((c, i) => c.style.setProperty("--i", i));
  if (animate) for (const el of [$("#dayTitle"), $("#dayList")]) { el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
}

function renderAgenda(animatePanel) {
  $("#agendaTitle").innerHTML = state.view === "cahier" ? "Cahier de texte" : agendaTitleHtml();
  $("#viewport").innerHTML = state.view === "month" ? monthHtml() : state.view === "week" ? weekHtml() : cahierHtml();
  $("#agendaLayout").classList.toggle("week-mode", state.view !== "month");
  $("#page-agenda").classList.toggle("cahier-mode", state.view === "cahier");
  document.querySelectorAll(".view-toggle [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
  $("#prev").setAttribute("aria-label", state.view === "month" ? "Mois précédent" : "Semaine précédente");
  $("#next").setAttribute("aria-label", state.view === "month" ? "Mois suivant" : "Semaine suivante");
  if (state.view === "month") renderPanel(animatePanel);
}

function render() {
  renderBadge();
  renderTab(state.tab);
}

function selectDay(date) {
  if (date === state.selected) return;
  document.querySelectorAll("#viewport .selected").forEach((el) => el.classList.remove("selected", "pop"));
  state.selected = date;
  const cell = $(`#viewport .day[data-date="${date}"], #viewport .wday[data-date="${date}"]`);
  if (cell) cell.classList.add("selected", "pop");
  if (state.view === "month") renderPanel(true);
}

let navAnim = 0;
let pendingMonth = null;
let pendingWeek = null;
function slideView(dir, apply, fromX = 0) {
  const id = ++navAnim;
  const vp = $("#viewport"), title = $("#agendaTitle"), wrap = $("#viewportWrap");
  const stopAll = () => [vp, title, wrap].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  stopAll();
  if (reducedMotion()) { apply(); return; }
  const w = vp.offsetWidth || 1;
  const sd = Math.sign(dir);
  const h0 = wrap.offsetHeight;
  vp.animate([{ transform: `translateX(${fromX}px)`, opacity: 1 - Math.min(Math.abs(fromX) / w, .6) }, { transform: `translateX(${-sd * w * .35}px)`, opacity: 0 }], { duration: 170, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
  title.animate([{ opacity: 1 }, { opacity: 0, transform: `translateX(${-sd * 16}px)` }], { duration: 170, easing: "ease-in", fill: "forwards" });
  setTimeout(() => {
    if (id !== navAnim) return;
    stopAll();
    apply();
    const h1 = wrap.offsetHeight;
    if (h0 !== h1) wrap.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 380, easing: EASE });
    vp.animate([{ transform: `translateX(${sd * w * .35}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: EASE });
    title.animate([{ opacity: 0, transform: `translateX(${sd * 16}px)` }, { opacity: 1, transform: "none" }], { duration: 420, easing: EASE });
  }, 170);
}

function changeMonth(dir, opts = {}) {
  const base = pendingMonth || state.month;
  const target = new Date(base.getFullYear(), base.getMonth() + dir, 1);
  pendingMonth = target;
  slideView(dir, () => {
    pendingMonth = null;
    state.month = target;
    const now = new Date();
    const current = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth();
    state.selected = opts.select || (current ? iso(now) : iso(target));
    state.weekStart = mondayOf(parse(state.selected));
    renderAgenda(true);
  }, opts.fromX);
}

function changeWeek(dir, opts = {}) {
  const base = pendingWeek || state.weekStart;
  const target = addDays(base, 7 * dir);
  pendingWeek = target;
  slideView(dir, () => {
    pendingWeek = null;
    state.weekStart = target;
    const today = new Date();
    const inWeek = iso(today) >= iso(target) && iso(today) <= iso(addDays(target, 6));
    state.selected = opts.select || (inWeek ? iso(today) : iso(target));
    state.month = firstOfMonth(parse(state.selected));
    renderAgenda(true);
  }, opts.fromX);
}

const nav = (dir, opts) => (state.view === "cahier" ? null : state.view === "week" ? changeWeek(dir, opts) : changeMonth(dir, opts));

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  try { localStorage.setItem("agenda_view", view); } catch {}
  if (view === "cahier") { renderAgenda(false); return; }
  if (view === "week") state.weekStart = mondayOf(parse(state.selected));
  else state.month = firstOfMonth(parse(state.selected));
  renderAgenda(false);
  if (!reducedMotion()) {
    $("#viewport").animate(view === "week"
      ? [{ transform: "scale(.94)", opacity: 0 }, { transform: "none", opacity: 1 }]
      : [{ transform: "scale(1.05)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: EASE });
    $("#agendaTitle").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
  }
}

function goToday() {
  const now = new Date();
  if (state.view === "week") {
    const diff = Math.round((mondayOf(now) - state.weekStart) / (7 * 864e5));
    if (diff === 0) return selectDay(iso(now));
    return changeWeek(diff, { select: iso(now) });
  }
  const diff = (now.getFullYear() - state.month.getFullYear()) * 12 + now.getMonth() - state.month.getMonth();
  if (diff === 0) return selectDay(iso(now));
  changeMonth(diff, { select: iso(now) });
}

$("#viewport").addEventListener("click", (e) => {
  if (e.target.closest(".ev, .tt-ev")) return;
  const b = e.target.closest("[data-date]");
  if (b && !b.classList.contains("blank")) selectDay(b.dataset.date);
});
$("#viewport").addEventListener("dblclick", (e) => {
  if (e.target.closest(".ev, .tt-ev")) return;
  const b = e.target.closest("[data-date]");
  if (b) openEdit(null, b.dataset.date);
});
$("#prev").onclick = () => nav(-1);
$("#next").onclick = () => nav(1);
$("#todayBtn").onclick = goToday;
$("#addBtn").onclick = () => openEdit(null, state.selected);
document.querySelectorAll(".view-toggle [data-view]").forEach((b) => b.onclick = () => setView(b.dataset.view));
$("#agendaTitle").onclick = () => openMonthPicker();
$("#agendaTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") openMonthPicker(); });

const gesture = { x: 0, y: 0, dx: 0, active: false, locked: null, pinch: null };
const wrapEl = $("#viewportWrap");
const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
wrapEl.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    gesture.active = false;
    gesture.pinch = { d0: dist(e.touches), scale: 1 };
    return;
  }
  Object.assign(gesture, { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, active: true, locked: null, pinch: null });
}, { passive: true });
wrapEl.addEventListener("touchmove", (e) => {
  const vp = $("#viewport");
  if (gesture.pinch && e.touches.length === 2) {
    e.preventDefault();
    const s = dist(e.touches) / gesture.pinch.d0;
    gesture.pinch.scale = s;
    vp.style.transform = `scale(${Math.min(1.12, Math.max(.9, 1 + (s - 1) * .35))})`;
    return;
  }
  if (!gesture.active) return;
  const dx = e.touches[0].clientX - gesture.x;
  const dy = e.touches[0].clientY - gesture.y;
  if (gesture.locked === null && Math.hypot(dx, dy) > 8) gesture.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
  if (gesture.locked !== "x") return;
  gesture.dx = dx;
  vp.style.transform = `translateX(${dx}px)`;
  vp.style.opacity = String(1 - Math.min(Math.abs(dx) / vp.offsetWidth, .5));
}, { passive: false });
wrapEl.addEventListener("touchend", (e) => {
  const vp = $("#viewport");
  if (gesture.pinch) {
    if (e.touches.length) return;
    const s = gesture.pinch.scale;
    gesture.pinch = null;
    vp.style.transform = "";
    if (s > 1.18 && state.view === "month") setView("week");
    else if (s < .85 && state.view === "week") setView("month");
    else if (!reducedMotion()) vp.animate([{ transform: `scale(${Math.min(1.12, Math.max(.9, 1 + (s - 1) * .35))})` }, { transform: "none" }], { duration: 320, easing: EASE });
    return;
  }
  if (!gesture.active) return;
  gesture.active = false;
  if (gesture.locked !== "x") return;
  const dx = gesture.dx;
  vp.style.transform = ""; vp.style.opacity = "";
  if (Math.abs(dx) > Math.min(80, vp.offsetWidth * .2)) nav(dx < 0 ? 1 : -1, { fromX: dx });
  else if (!reducedMotion()) vp.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 380, easing: EASE });
});
let wheelZoom = 0, wheelTimer;
// After a switch, macOS keeps sending momentum wheel events: ignore them until they stop.
const trackpad = { dx: 0, active: false, committed: false, timer: null };
const TRACKPAD_COMMIT = 120;
function endTrackpadSwipe() {
  const vp = $("#viewport");
  const dx = trackpad.dx;
  const committed = trackpad.committed;
  Object.assign(trackpad, { dx: 0, active: false, committed: false, timer: null });
  if (committed) return;
  vp.style.transform = ""; vp.style.opacity = "";
  if (dx && !reducedMotion()) vp.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 380, easing: EASE });
}
wrapEl.addEventListener("wheel", (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    wheelZoom += e.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelZoom = 0; }, 250);
    if (wheelZoom < -40 && state.view === "month") { wheelZoom = 0; setView("week"); }
    if (wheelZoom > 40 && state.view === "week") { wheelZoom = 0; setView("month"); }
    return;
  }
  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (!trackpad.active && !horizontal) return;
  e.preventDefault();
  clearTimeout(trackpad.timer);
  trackpad.timer = setTimeout(endTrackpadSwipe, 160);
  trackpad.active = true;
  if (trackpad.committed) return;
  const unit = e.deltaMode === 1 ? 16 : 1;
  trackpad.dx -= e.deltaX * unit;
  const vp = $("#viewport");
  const shown = trackpad.dx * 0.7;
  if (Math.abs(trackpad.dx) >= TRACKPAD_COMMIT) {
    trackpad.committed = true;
    vp.style.transform = ""; vp.style.opacity = "";
    nav(trackpad.dx < 0 ? 1 : -1, { fromX: shown });
    return;
  }
  vp.style.transform = `translateX(${shown}px)`;
  vp.style.opacity = String(1 - Math.min(Math.abs(shown) / (vp.offsetWidth || 1), .5));
}, { passive: false });

function openMonthPicker() {
  let year = (state.view === "week" ? parse(state.selected) : state.month).getFullYear();
  const now = new Date();
  const bd = openSheet(`
    <div class="sheet-head">
      <button class="link" data-act="close">Fermer</button>
      <h3>Aller à</h3>
      <button class="link" data-act="today">Aujourd'hui</button>
    </div>
    <div class="sheet-body">
      <div class="mp-year">
        <button class="icon-btn" data-y="-1" aria-label="Année précédente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
        <b id="mpYear"></b>
        <button class="icon-btn" data-y="1" aria-label="Année suivante"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
      </div>
      <div class="mp-grid" id="mpGrid"></div>
    </div>`);
  const draw = () => {
    bd.querySelector("#mpYear").textContent = year;
    const shown = state.view === "week" ? parse(state.selected) : state.month;
    bd.querySelector("#mpGrid").innerHTML = MONTHS.map((m, i) => {
      const count = state.events.filter((e) => e.date.startsWith(`${year}-${String(i + 1).padStart(2, "0")}`)).length;
      const cls = [year === shown.getFullYear() && i === shown.getMonth() && "on", year === now.getFullYear() && i === now.getMonth() && "cur"].filter(Boolean).join(" ");
      return `<button class="${cls}" data-m="${i}">${m}${count ? `<small>${plural(count, "élément")}</small>` : ""}</button>`;
    }).join("");
    bd.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => jumpTo(new Date(year, Number(b.dataset.m), 1)));
  };
  const jumpTo = (target) => {
    closeSheet();
    const now2 = new Date();
    const sel = target.getFullYear() === now2.getFullYear() && target.getMonth() === now2.getMonth() ? iso(now2) : iso(target);
    if (state.view === "week") {
      const diff = Math.round((mondayOf(parse(sel)) - state.weekStart) / (7 * 864e5));
      if (diff) changeWeek(diff, { select: sel });
      return;
    }
    const diff = (target.getFullYear() - state.month.getFullYear()) * 12 + target.getMonth() - state.month.getMonth();
    if (diff) changeMonth(diff, { select: sel });
  };
  bd.querySelectorAll("[data-y]").forEach((b) => b.onclick = () => {
    year += Number(b.dataset.y);
    draw();
    if (!reducedMotion()) bd.querySelector("#mpGrid").animate([{ opacity: 0, transform: `translateX(${Number(b.dataset.y) * 20}px)` }, { opacity: 1, transform: "none" }], { duration: 300, easing: EASE });
  });
  bd.querySelector("[data-act=close]").onclick = closeSheet;
  bd.querySelector("[data-act=today]").onclick = () => { closeSheet(); goToday(); };
  draw();
}

const MAX_PDF_MB = 100;
const MAX_INPUT_MB = 300;
const SLOTS = [["cours", "Fiche de cours"], ["sujet", "Sujet type"], ["corrige", "Corrigé du sujet"], ["topexo", "TOP EXO du prof"]];
const OPTIONAL_SLOTS = new Set(["topexo"]);
const DCG_UES = [
  "UE1 · Fondamentaux du droit", "UE2 · Droit des sociétés", "UE3 · Droit social", "UE4 · Droit fiscal",
  "UE5 · Économie contemporaine", "UE6 · Finance d'entreprise", "UE7 · Management", "UE8 · Systèmes d'information de gestion",
  "UE9 · Introduction à la comptabilité", "UE10 · Comptabilité approfondie", "UE11 · Contrôle de gestion",
  "UE12 · Anglais appliqué aux affaires", "UE13 · Communication professionnelle",
];
const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const sameSubject = (a, b) => norm(a) === norm(b);

function allSubjects() {
  const seen = new Map();
  for (const s of [...DCG_UES, ...state.chapters.map((c) => c.subject), ...state.events.map((e) => e.subject)]) {
    if (s && !seen.has(norm(s))) seen.set(norm(s), s);
  }
  return [...seen.values()];
}
const canonicalSubject = (s) => allSubjects().find((x) => sameSubject(x, s)) || String(s || "").trim();
function courseSubjects(extra = []) {
  const seen = new Map();
  for (const s of [...state.chapters.map((c) => c.subject), ...extra]) if (s && !seen.has(norm(s))) seen.set(norm(s), canonicalSubject(s));
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
}
const subjectDatalist = (list = allSubjects()) => `<datalist id="subjectList">${list.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>`;
const chaptersOf = (subject) => state.chapters.filter((c) => sameSubject(c.subject, subject)).sort((a, b) => a.title.localeCompare(b.title, "fr", { numeric: true }));
const chapterById = (id) => state.chapters.find((c) => c.id === id);
const usedBy = (chapterId) => state.events.filter((e) => e.chapters?.includes(chapterId));

function upsertChapter(ch) {
  const i = state.chapters.findIndex((x) => x.id === ch.id);
  if (i >= 0) state.chapters[i] = ch; else state.chapters.push(ch);
}
