// Agenda DCG — Notifications, mise à jour de l'app, Réglages, puis démarrage.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

function pushSupport() {
  const ua = navigator.userAgent;
  if (/Electron/.test(ua)) return { ok: false, why: "electron" };
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (ios && !standalone) return { ok: false, why: "ios-home" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { ok: false, why: "unsupported" };
  if (Notification.permission === "denied") return { ok: false, why: "denied" };
  return { ok: true };
}

/* Mises à jour sur iPhone (appli ajoutée à l'écran d'accueil) : l'appli reste ouverte en mémoire,
   donc on vérifie au retour au premier plan si une nouvelle version du site est en ligne, et on recharge. */
let siteVersion = null;
async function currentVersion() {
  // La version du site = l'empreinte de la page ET de chacun de ses fichiers (css, js)
  try {
    const files = ["/", ...[...document.querySelectorAll('script[src^="/"], link[rel=stylesheet][href^="/"]')].map((n) => n.getAttribute("src") || n.getAttribute("href"))];
    const tags = await Promise.all(files.map(async (f) => { const r = await fetch(f, { method: "HEAD", cache: "no-store" }); return r.headers.get("etag") || r.headers.get("last-modified") || ""; }));
    return tags.join("|") || null;
  } catch { return null; }
}
async function checkForUpdate() {
  const v = await currentVersion();
  if (!v) return;
  if (siteVersion === null) { siteVersion = v; return; }
  if (v !== siteVersion && !document.querySelector("#sheetRoot .backdrop")) location.reload();
}
checkForUpdate();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });
setInterval(checkForUpdate, 30 * 60 * 1000);

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || /Electron/.test(navigator.userAgent)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  if (!registerServiceWorker.bound) {
    registerServiceWorker.bound = true;
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "open") handleDeepLink(e.data.url); });
  }
}

function urlB64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupport().ok) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications refusées : autorise-les dans les réglages du navigateur");
  await navigator.serviceWorker.register("/sw.js");
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api("push-key");
  if (!key) throw new Error("Les notifications ne sont pas encore configurées sur le serveur");
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) });
  state.profile = await send("profile/push", "POST", { subscription: sub.toJSON() });
  const p = state.profile.prefs;
  if (!p.onNew && !p.daily && !p.weekly && !p.before.length) {
    state.profile = await send("profile/prefs", "PUT", { prefs: { onNew: true, daily: false, weekly: true, before: [1] } });
  }
}

async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    state.profile = await send("profile/push", "DELETE", { endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
  }
}

const REMINDER_LABEL = { 1: "1 jour avant", 2: "2 jours avant", 7: "1 semaine avant" };
const switchHtml = (name, on, label, sub) => `<label class="set-row"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><span class="switch"><input type="checkbox" data-pref="${name}" ${on ? "checked" : ""}><i></i></span></label>`;

/** Réglages > Devoirs passés : les sujets joints restent disponibles une fois la date passée. */
function renderPastHomework() {
  const today = iso(new Date());
  const past = state.events.filter((e) => e.date < today && (e.attachments || []).length).sort((a, b) => b.date.localeCompare(a.date));
  $("#page-settings").insertAdjacentHTML("beforeend", `<div class="section"><h2>Devoirs passés</h2>
    ${past.length ? past.map((e) => `<div class="label" style="margin-top:12px">${esc(e.title)} · ${esc(shortDate(e.date))}${e.subject ? " · " + esc(e.subject.split(" · ")[0]) : ""}</div><div class="group">${attachmentRows(e)}</div>`).join("")
      : `<div class="group"><div class="hint">Les sujets joints aux devoirs apparaîtront ici une fois la date passée.</div></div>`}</div>`);
}

function renderSettings() {
  const p = state.profile;
  const prefs = p.prefs;
  const support = pushSupport();
  const page = $("#page-settings");
  page.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Réglages</h1></div></div>

    <div class="group profile-card">
      <span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>
      <span style="flex:1"><b>${esc(p.name)}</b><br><small style="color:var(--text2)">Compte privé, protégé par ton code perso</small></span>
    </div>

    <div class="section">
      <h2>Notifications</h2>
      <div class="group" id="pushDevice"><div class="notice"><span class="spinner"></span></div></div>
    </div>

    <div class="section">
      <h2>Quand me prévenir</h2>
      <div class="group">
        ${switchHtml("onNew", prefs.onNew, "À chaque nouvelle évaluation", "Quand quelqu'un ajoute une évaluation, un examen blanc, un devoir ou un exercice")}
        ${switchHtml("daily", prefs.daily, "Chaque matin", "À 7 h, ton programme du jour s'il y a quelque chose")}
        ${switchHtml("weekly", prefs.weekly, "Chaque dimanche", "À 18 h, le résumé de ta semaine")}
        <div class="set-row"><span>Rappels avant les évaluations<small>À 19 h, pour celles que tu n'as pas encore cochées</small></span></div>
        <div class="chip-toggles" style="border-top:0">${Object.entries(REMINDER_LABEL).map(([d, l]) => `<button type="button" data-before="${d}" class="${prefs.before.includes(Number(d)) ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="label" style="margin-top:8px">Ces réglages valent pour tous les appareils où tu as activé les notifications.</div>
    </div>

    ${announceAdmin()}
    <div class="section">
      <h2>Révisions</h2>
      <button class="btn-row blue" data-act="levels">${hasLevels() ? "Modifier mon niveau par matière" : "Personnaliser mes révisions (1 min)"}</button>
    </div>

    <div class="section">
      <h2>Exporter vers ton calendrier</h2>
      <div class="group" id="calBox">
        <div class="hint">Importe les devoirs, évaluations et examens à venir dans le Calendrier iPhone/Mac ou Google Agenda (ceux que tu as cochés sont marqués ✓). C'est une copie : pas de mise à jour automatique, refais l'import si l'agenda change.</div>
        <a class="btn-row blue" id="calApple" href="#">Ajouter au Calendrier Apple</a>
        <a class="btn-row" id="calCopy" href="#" download="agenda-dcg.ics">Télécharger le fichier (Google Agenda, Outlook…)</a>
      </div>
    </div>

    <div class="section">
      <h2>Stockage des cours</h2>
      <div class="group usage" id="usageBox"><div class="usage-text">Chargement…</div></div>
    </div>

    <div class="section">
      <button class="btn-row" data-act="logout">Se déconnecter</button>
    </div>`;

  page.querySelector("[data-act=levels]").onclick = () => openLevels(() => renderSettings());
  api("calendar-link").then(({ url }) => {
    $("#calApple").href = url;
    $("#calCopy").href = url;
    $("#calCopy").onclick = () => toast("Puis dans Google Agenda : Paramètres › Importer et exporter › Importer");
  }).catch(() => { $("#calBox").innerHTML = `<div class="hint">Lien indisponible pour le moment.</div>`; });

  const savePrefs = async (next) => {
    try { state.profile = await send("profile/prefs", "PUT", { prefs: next }); }
    catch (err) { toast(err.message); renderSettings(); }
  };
  page.querySelectorAll("[data-pref]").forEach((input) => input.onchange = () => savePrefs({ ...state.profile.prefs, [input.dataset.pref]: input.checked }));
  page.querySelectorAll("[data-before]").forEach((b) => b.onclick = () => {
    const d = Number(b.dataset.before);
    const set = new Set(state.profile.prefs.before);
    if (set.has(d)) set.delete(d); else set.add(d);
    b.classList.toggle("on", set.has(d));
    savePrefs({ ...state.profile.prefs, before: [...set] });
  });
  page.querySelector("[data-act=logout]").onclick = async () => {
    try { await Promise.all(["agenda-data-v1", "agenda-pdf-v1"].map((c) => caches.delete(c))); } catch {}
    if (!confirm("Te déconnecter de ton compte sur cet appareil ?")) return;
    await disablePush().catch(() => {});
    await api("profile/logout", { method: "POST" }).catch(() => {});
    state.profile = null;
    showLogin();
  };

  const device = page.querySelector("#pushDevice");
  const notices = {
    electron: `Les notifications ne sont pas disponibles dans l'app Mac ou Windows. Active-les sur ton iPhone, ou en ouvrant l'agenda dans Safari ou Chrome.`,
    "ios-home": `Sur iPhone, Apple n'envoie les notifications qu'aux sites ajoutés à l'écran d'accueil :<br>1. Touche <b>Partager</b> puis <b>Sur l'écran d'accueil</b>.<br>2. Ouvre l'agenda depuis la nouvelle icône.<br>3. Reviens ici pour activer les notifications.`,
    unsupported: `Ce navigateur ne gère pas les notifications. Essaie avec Safari, Chrome ou Edge à jour.`,
    denied: `Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du navigateur, puis recharge la page.`,
  };
  if (!support.ok) {
    device.innerHTML = `<div class="notice">${notices[support.why]}</div>`;
  } else {
    currentSubscription().then((sub) => {
      if (!page.isConnected) return;
      device.innerHTML = sub
        ? `<div class="set-row"><span>Activées sur cet appareil<small>${plural(state.profile.pushDevices, "appareil")} au total sur ton compte</small></span></div>
           <div class="chip-toggles"><button type="button" data-act="test">Envoyer un test</button><button type="button" data-act="off">Désactiver ici</button></div>`
        : `<button class="btn-row blue" data-act="on">Activer les notifications sur cet appareil</button>`;
      device.querySelector("[data-act=on]")?.addEventListener("click", async (e) => {
        e.target.innerHTML = `<span class="spinner"></span>`;
        try { await enablePush(); toast("Notifications activées"); } catch (err) { toast(err.message); }
        renderSettings();
      });
      device.querySelector("[data-act=test]")?.addEventListener("click", async () => {
        try { const r = await api("profile/push-test", { method: "POST" }); toast(r.sent ? "Notification envoyée" : "Aucun appareil n'a pu être prévenu"); }
        catch (err) { toast(err.message); }
      });
      device.querySelector("[data-act=off]")?.addEventListener("click", async () => {
        try { await disablePush(); toast("Notifications désactivées sur cet appareil"); } catch (err) { toast(err.message); }
        renderSettings();
      });
    });
  }

  api("usage").then((u) => {
    const box = page.querySelector("#usageBox");
    if (!box) return;
    const gb = (n) => (n / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
    const pct = Math.min(100, (u.bytes / u.limits.bytes) * 100);
    box.innerHTML = `
      <div class="usage-text"><b>${gb(u.bytes)} Go</b> utilisés sur ${gb(u.limits.bytes)} Go</div>
      <div class="usage-bar"><span style="width:${pct.toFixed(1)}%;${pct > 85 ? "background:var(--accent)" : ""}"></span></div>
      <div class="usage-sub">Ce mois-ci : ${u.classA.toLocaleString("fr-FR")} envois et ${u.classB.toLocaleString("fr-FR")} lectures. Les envois sont bloqués avant de dépasser le forfait gratuit.</div>`;
  }).catch(() => { const box = page.querySelector("#usageBox"); if (box) box.innerHTML = `<div class="usage-text">Indisponible</div>`; });
}

api("me").then(() => start()).catch(() => showLogin());
