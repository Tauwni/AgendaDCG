// Agenda DCG — Emploi du temps, connexion, onglets, statut « fait », carte d'un événement.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

/* ---------- Emploi du temps fixe (public/schedule.json) ---------- */
function inTerm(key) {
  const s = state.schedule;
  return !!s && (!s.from || key >= s.from) && (!s.to || key <= s.to) && !(s.skip || []).includes(key) && !holiday(key);
}
function classesOn(key) {
  if (!inTerm(key)) return [];
  const wd = parse(key).getDay();
  return (state.schedule.classes || []).filter((c) => c.day === wd).map((c, i) => ({
    id: `edt:${key}:${i}`, virtual: true, kind: "cours", revision: c.kind === "revision", title: c.title, subject: c.subject, date: key, time: c.start, end: c.end, color: c.color, chapters: [], history: [],
  }));
}
const companyDay = (key) => inTerm(key) && (state.schedule.companyDays || []).includes(parse(key).getDay());
/** Le cours de la matière ce jour-là (pour ranger un devoir dans son créneau). */
const classFor = (key, subject) => subject ? classesOn(key).find((c) => sameSubject(c.subject, subject)) : null;
const nextClasses = (subject, from = iso(new Date()), n = 4) => {
  const out = [];
  for (let i = 0; i < 120 && out.length < n; i++) { const key = iso(addDays(parse(from), i)); const c = classFor(key, subject); if (c) out.push(c); }
  return out;
};
/** Devoir / éval rangé dans le créneau d'un cours (même jour, même matière). */
const inClass = (e) => !e.virtual && !!classFor(e.date, e.subject);
const dayNote = (key) => holiday(key) || (companyDay(key) ? "Entreprise" : "");
const dayEvents = (key) => [...classesOn(key), ...state.events.filter((e) => e.date === key)].sort((a, b) => (a.time || "").localeCompare(b.time || ""));

function getName() { return state.profile?.name || (() => { try { return localStorage.getItem("agenda_name") || ""; } catch { return ""; } })(); }

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-listen]");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  try { await window.Lecteur.read(`/api/files/${encodeURIComponent(b.dataset.listen)}`, b.dataset.title || "Cours", toast); }
  catch (err) { toast(err.message); }
}, true);

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  const motion = !reducedMotion();
  if (motion) t.animate([{ transform: "translate(-50%, 20px) scale(.96)", opacity: 0 }, { transform: "translate(-50%, 0)", opacity: 1 }], { duration: 420, easing: EASE });
  setTimeout(() => {
    if (!motion) return t.remove();
    t.animate([{ opacity: 1 }, { transform: "translate(-50%, 10px)", opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" });
    setTimeout(() => t.remove(), 240);
  }, Math.max(2600, msg.length * 70));
}

async function api(path, opts = {}) {
  const res = await fetch("/api/" + path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("profile/")) { showLogin(); throw new Error("Session expirée"); }
  if (!res.ok) { const err = new Error(data.error || "Erreur"); err.status = res.status; throw err; }
  return data;
}
const send = (path, method, body) => api(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/* ---------- Login ---------- */
const login = { mode: null, needPass: false };

async function showLogin() {
  const now = new Date();
  $("#iconDay").textContent = DAYS[now.getDay()];
  $("#iconNum").textContent = now.getDate();
  login.needPass = (await fetch("/api/me").catch(() => ({ status: 401 }))).status === 401;
  login.mode = null;
  $("#loginName").value = getName();
  $("#loginName").disabled = false;
  $("#loginPass").classList.toggle("hidden", !login.needPass);
  $("#pinStep").classList.add("hidden");
  $("#loginBack").classList.add("hidden");
  $("#loginBtn").textContent = "Continuer";
  $("#loginErr").textContent = "";
  $("#app").classList.add("hidden");
  $("#tabbar").classList.add("hidden");
  $("#login").classList.remove("hidden");
}

$("#loginBack").onclick = () => showLogin();

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#loginName").value.trim();
  const err = $("#loginErr");
  err.textContent = "";
  if (!name) { err.textContent = "Écris ton prénom"; return; }
  if (login.needPass && !$("#loginPass").value) { err.textContent = "Entre le mot de passe de la classe"; return; }
  $("#loginBtn").disabled = true;
  try {
    if (!login.mode) {
      const { exists } = await send("profile/check", "POST", { name });
      login.mode = exists ? "existing" : "new";
      $("#loginName").disabled = true;
      $("#pinStep").classList.remove("hidden");
      $("#loginPin2").classList.toggle("hidden", exists);
      $("#pinHint").innerHTML = exists
        ? `Content de te revoir, <b>${esc(name)}</b>. Entre ton code perso.`
        : `Première connexion : crée ton <b>code perso à 6 chiffres</b>. Il te servira à te connecter sur tous tes appareils.`;
      $("#loginBtn").textContent = exists ? "Entrer" : "Créer mon compte";
      $("#loginBack").classList.remove("hidden");
      $("#loginPin").value = ""; $("#loginPin2").value = "";
      $("#loginPin").focus();
      return;
    }
    const pin = $("#loginPin").value.trim();
    if (!/^\d{6}$/.test(pin)) { err.textContent = "Le code perso fait 6 chiffres"; return; }
    if (login.mode === "new" && pin !== $("#loginPin2").value.trim()) { err.textContent = "Les deux codes ne sont pas identiques"; return; }
    const profile = await send("profile/login", "POST", { name, pin, password: $("#loginPass").value, create: login.mode === "new" });
    try { localStorage.setItem("agenda_name", profile.name); } catch {}
    $("#loginPass").value = ""; $("#loginPin").value = ""; $("#loginPin2").value = "";
    state.profile = profile;
    await start();
    if (login.mode === "new") toast("Compte créé. Retiens bien ton code perso.");
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    $("#loginBtn").disabled = false;
  }
});

async function start() {
  if (!state.profile) state.profile = await api("profile");
  [state.events, state.chapters, state.schedule] = await Promise.all([api("events"), api("chapters"), fetch("/schedule.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => null)]);
  const wasHidden = $("#app").classList.contains("hidden");
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#tabbar").classList.remove("hidden");
  if (wasHidden) { $("#app").classList.remove("enter"); void $("#app").offsetWidth; $("#app").classList.add("enter"); }
  renderAll();
  handleDeepLink(location.href);
  registerServiceWorker();
}

function handleDeepLink(href) {
  const url = new URL(href, location.origin);
  const tab = url.searchParams.get("tab");
  const ev = url.searchParams.get("event");
  if (tab && document.getElementById(`page-${tab}`)) showTab(tab);
  if (ev && state.events.some((e) => e.id === ev)) openDetail(ev);
  if (tab || ev) history.replaceState(null, "", "/");
}

/* ---------- Tabs ---------- */
function showTab(tab) {
  if (!document.getElementById(`page-${tab}`)) return;
  state.tab = tab;
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("hidden", p.id !== `page-${tab}`));
  document.querySelectorAll("#tabbar [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  renderTab(tab);
  window.scrollTo({ top: 0 });
}
$("#tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  if (b.dataset.tab === state.tab && b.dataset.tab === "agenda") return goToday();
  showTab(b.dataset.tab);
});

function renderTab(tab) {
  if (tab === "today") renderToday();
  if (tab === "agenda") renderAgenda(false);
  if (tab === "cours") renderCours();
  if (tab === "reviser") renderReviser();
  if (tab === "settings") { renderSettings(); renderPastHomework(); }
}
function renderAll() {
  renderBadge();
  showTab(state.tab);
}

/* ---------- Done status ---------- */
const isDone = (id) => (state.profile?.done || []).includes(id);
async function toggleDone(id) {
  const done = !isDone(id);
  const set = new Set(state.profile.done);
  if (done) set.add(id); else set.delete(id);
  state.profile.done = [...set];
  document.querySelectorAll(`.ev[data-id="${id}"]`).forEach((el) => el.classList.toggle("done", done));
  renderBadge();
  try {
    state.profile = await send("profile/done", "PUT", { event: id, done });
  } catch (err) {
    toast(err.message);
    if (done) set.delete(id); else set.add(id);
    state.profile.done = [...set];
    renderTab(state.tab);
  }
  if (state.tab === "today") setTimeout(() => state.tab === "today" && renderToday(), 450);
}

function lateItems() {
  const today = iso(new Date());
  const from = iso(addDays(new Date(), -30));
  return state.events.filter((e) => DEADLINE.has(e.kind || "eval") && e.date < today && e.date >= from && !isDone(e.id));
}
function renderBadge() {
  const today = iso(new Date());
  const n = state.events.filter((e) => e.date === today && !isDone(e.id)).length + lateItems().length;
  const btn = $('#tabbar [data-tab="today"]');
  btn.querySelector(".tab-badge")?.remove();
  if (n) btn.querySelector("svg").insertAdjacentHTML("afterend", `<span class="tab-badge">${n}</span>`);
}

/* ---------- Event card ---------- */
const clip = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5"/></svg>`;
const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
function evCard(e, opts = {}) {
  const kind = e.kind || "eval";
  const today = iso(new Date());
  const late = opts.late || (DEADLINE.has(kind) && e.date < today && !isDone(e.id));
  const parts = [opts.withDate && shortDate(e.date), e.time && (e.end ? `${e.time}–${e.end}` : e.time)].filter(Boolean).join(" · ");
  const n = (e.chapters || []).length;
  const j = opts.countdown ? daysBetween(today, e.date) : null;
  return `<div class="ev ${isDone(e.id) ? "done" : ""} ${late ? "late" : ""}" data-id="${e.id}" role="button" tabindex="0" style="--c:${col(e.color)}">
    <span class="bar"></span>
    <span class="body">
      <div class="t">${esc(e.title)}</div>
      ${e.subject && !opts.compact ? `<div class="s">${esc(e.subject)}</div>` : ""}
      <div class="meta"><span>${kindIcon(kind)}${kindLabel(kind)}${parts ? " · " + esc(parts) : ""}</span>${late && opts.showLate ? `<span class="late-tag">En retard</span>` : ""}${opts.fresh && !isDone(e.id) ? `<span class="late-tag" style="--c:var(--blue)">Nouveau</span>` : ""}${n && !opts.compact ? `<span>${clip} ${plural(n, "chapitre")}</span>` : ""}</div>
    </span>
    ${j !== null && j >= 0 ? `<span class="jtag" style="align-self:center">${j === 0 ? "Aujourd'hui" : j === 1 ? "Demain" : "J-" + j}</span>` : ""}
    ${e.virtual ? "" : `<button class="check" data-done="${e.id}" aria-label="${isDone(e.id) ? "Marquer à faire" : "Marquer comme fait"}">${checkSvg}</button>`}
  </div>`;
}

document.addEventListener("click", (e) => {
  const check = e.target.closest("[data-done]");
  if (check) { e.stopPropagation(); toggleDone(check.dataset.done); return; }
  const card = e.target.closest(".ev, .tt-ev");
  if (card) openDetail(card.dataset.id);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList?.contains("ev")) openDetail(e.target.dataset.id);
});
