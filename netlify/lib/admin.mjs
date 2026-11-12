// Tableau de bord privé (/admin). Le mot de passe n'est nulle part dans le code :
// seule son empreinte scrypt est rangée dans la variable Netlify ADMIN_HASH ("sel:empreinte").
import { getStore } from "@netlify/blobs";
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import { events, profiles, listAll, KINDS, trash } from "./shared.mjs";

const COOKIE = "agenda_admin";
const MAX_FAILS = 5;
const LOCK_MS = 30 * 60 * 1000;
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export const config = () => getStore({ name: "config", consistency: "strong" });

const secret = () => (Netlify.env.get("PROFILE_SECRET") || "") + ":admin";
const sign = (exp) => createHmac("sha256", secret()).update(`admin:${exp}`).digest("hex");
const readCookie = (req) => (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1] || "";
const cookie = (v, age) => `${COOKIE}=${v}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const json = (data, status = 200, cookies = []) => {
  const h = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(JSON.stringify(data), { status, headers: h });
};
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

function isAdmin(req) {
  const [exp, sig] = readCookie(req).split(".");
  return !!exp && Number(exp) > Date.now() && !!sig && same(sig, sign(exp));
}

function checkPassword(pw) {
  const [salt, hash] = (Netlify.env.get("ADMIN_HASH") || "").split(":");
  if (!salt || !hash) return false;
  return same(scryptSync(String(pw), salt, 32).toString("hex"), hash);
}

/* ---------- Emploi du temps (modifiable depuis /admin, lu par le site et les apps) ---------- */
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => /^\d{2}:\d{2}$/.test(s);
const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "brown"];

export async function readSchedule(origin) {
  const saved = await config().get("schedule", { type: "json" });
  if (saved) return saved;
  const res = await fetch(new URL("/schedule-default.json", origin));
  return res.ok ? res.json() : { classes: [], companyDays: [] };
}

function cleanSchedule(b) {
  const text = (s, n) => String(s || "").trim().replace(/\s+/g, " ").slice(0, n);
  const classes = (Array.isArray(b.classes) ? b.classes : []).slice(0, 40).map((c) => ({
    day: Number(c.day), start: String(c.start), end: String(c.end), subject: text(c.subject, 60), title: text(c.title, 60),
    color: COLORS.includes(c.color) ? c.color : "blue",
    ...(c.kind === "revision" ? { kind: "revision" } : {}),
  }));
  for (const c of classes) {
    if (!(c.day >= 0 && c.day <= 6) || !isTime(c.start) || !isTime(c.end) || c.start >= c.end) return { error: "Créneau invalide (jour ou heures)" };
    if (!c.title) return { error: "Chaque cours doit avoir un nom" };
  }
  const companyDays = [...new Set((Array.isArray(b.companyDays) ? b.companyDays : []).map(Number).filter((d) => d >= 0 && d <= 6))];
  const skip = [...new Set((Array.isArray(b.skip) ? b.skip : []).map(String).filter(isDate))].sort().slice(0, 200);
  const out = { classes, companyDays, skip };
  if (isDate(b.from)) out.from = b.from;
  if (isDate(b.to)) out.to = b.to;
  return { schedule: out };
}

/* ---------- Statistiques ---------- */
function weekKey(iso) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function stats() {
  const chapterStore = getStore({ name: "chapters", consistency: "strong" });
  const [ps, evs, chs, counters] = await Promise.all([listAll(profiles()), listAll(events()), listAll(chapterStore), config().get("counters", { type: "json" })]);
  const c = counters || { since: null, totals: {}, days: {} };
  const now = Date.now();
  const since = (t, days) => t && now - Date.parse(t) < days * 864e5;
  const today = new Date().toISOString().slice(0, 10);
  const byKind = {};
  for (const e of evs) byKind[e.kind || "eval"] = (byKind[e.kind || "eval"] || 0) + 1;
  const weeks = {};
  for (let i = 7; i >= 0; i--) weeks[weekKey(new Date(now - i * 7 * 864e5).toISOString())] = 0;
  for (const e of evs) { const k = weekKey(e.createdAt || e.updatedAt || new Date().toISOString()); if (k in weeks) weeks[k]++; }
  const authors = {};
  for (const e of evs) if (e.createdBy) authors[e.createdBy] = (authors[e.createdBy] || 0) + 1;
  // Taux de « fait » sur les devoirs/évals passés depuis 60 jours (part des comptes qui les ont cochés)
  const deadlineKinds = new Set(["eval", "examen", "devoir", "exercice"]);
  const deadlines = evs.filter((e) => deadlineKinds.has(e.kind || "eval"));
  const past = deadlines.filter((e) => e.date < today && Date.parse(e.date) > now - 60 * 864e5);
  const doneSets = ps.map((p) => new Set(p.done || []));
  const completion = past.length && ps.length ? Math.round(100 * past.reduce((sum, e) => sum + doneSets.filter((d) => d.has(e.id)).length / ps.length, 0) / past.length) : null;
  const bySubject = {};
  for (const e of evs) { const k = (e.subject || "Sans matière").split(" · ")[0]; bySubject[k] = (bySubject[k] || 0) + 1; }
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const e of deadlines) byWeekday[new Date(e.date + "T12:00Z").getUTCDay()]++;
  const upcomingWeeks = {};
  for (const e of deadlines.filter((e) => e.date >= today)) { const k = weekKey(e.date + "T12:00Z"); upcomingWeeks[k] = (upcomingWeeks[k] || 0) + 1; }
  const busiest = Object.entries(upcomingWeeks).sort((a, b) => b[1] - a[1])[0];
  const files = chs.flatMap((ch) => Object.values(ch.files || {}).filter(Boolean));
  const days14 = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(now - i * 864e5).toISOString().slice(0, 10); days14.push({ day: d, ...(c.days[d] || {}) }); }
  const top = Object.entries(authors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, n }));
  return {
    since: c.since,
    totals: c.totals,
    days14,
    completion,
    doneTotal: ps.reduce((n, p) => n + (p.done || []).length, 0),
    deadlines: deadlines.length,
    bySubject: Object.entries(bySubject).map(([subject, n]) => ({ subject, n })).sort((a, b) => b.n - a.n),
    byWeekday,
    busiestWeek: busiest ? { week: busiest[0], n: busiest[1] } : null,
    library: { chapters: chs.length, files: files.length, bytes: files.reduce((n, f) => n + (f.size || 0), 0) },
    top,
    accounts: ps.length,
    active1: ps.filter((p) => since(p.lastSeenAt, 1)).length,
    active7: ps.filter((p) => since(p.lastSeenAt, 7)).length,
    pushDevices: ps.reduce((n, p) => n + (p.subs?.length || 0), 0),
    events: evs.length,
    upcoming: evs.filter((e) => e.date >= today).length,
    attachments: evs.reduce((n, e) => n + (e.attachments?.length || 0), 0),
    byKind: Object.entries(byKind).map(([k, n]) => ({ kind: KINDS[k]?.label || k, n })).sort((a, b) => b.n - a.n),
    weeks: Object.entries(weeks).map(([week, n]) => ({ week, n })),
    people: ps.map((p) => ({
      id: p.id, name: p.name, createdAt: p.createdAt, lastSeenAt: p.lastSeenAt || null, platforms: p.platforms || {},
      events: authors[p.name] || 0, grades: (p.grades || []).length, push: (p.subs || []).length,
      locked: (p.lockedUntil || 0) > now,
    })).sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || "")),
  };
}

/* ---------- Routeur /api/admin/* ---------- */
export async function handleAdmin(req, url, id) {
  const method = req.method;

  if (id === "login" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const lock = (await config().get("admin-lock", { type: "json" })) || { fails: 0, until: 0 };
    if (lock.until > Date.now()) return json({ error: `Trop d'essais : réessaie dans ${Math.ceil((lock.until - Date.now()) / 60000)} min` }, 429);
    if (!checkPassword(body.password)) {
      lock.fails = (lock.fails || 0) + 1;
      if (lock.fails >= MAX_FAILS) { lock.fails = 0; lock.until = Date.now() + LOCK_MS; }
      await config().setJSON("admin-lock", lock);
      return json({ error: "Mot de passe incorrect" }, 401);
    }
    await config().setJSON("admin-lock", { fails: 0, until: 0 });
    const exp = String(Date.now() + 12 * 3600 * 1000);
    return json({ ok: true }, 200, [cookie(`${exp}.${sign(exp)}`, 12 * 3600)]);
  }
  if (id === "logout") return json({ ok: true }, 200, [cookie("", 0)]);
  if (!isAdmin(req)) return json({ error: "Accès réservé" }, 401);

  if (id === "stats" && method === "GET") return json(await stats());

  if (id === "schedule" && method === "GET") return json(await readSchedule(url.origin));
  if (id === "schedule" && method === "PUT") {
    const { schedule, error } = cleanSchedule(await req.json().catch(() => ({})));
    if (error) return json({ error }, 400);
    await config().setJSON("schedule", schedule);
    return json(schedule);
  }
  if (id === "schedule" && method === "DELETE") {
    await config().delete("schedule");
    return json(await readSchedule(url.origin));
  }

  // Corbeille : devoirs supprimés depuis moins de 7 jours
  if (id === "trash" && method === "GET") {
    const all = await listAll(trash());
    return json(all.map((e) => ({ id: e.id, title: e.title, kind: KINDS[e.kind]?.label || e.kind, subject: e.subject, date: e.date, deletedBy: e.deletedBy, deletedAt: e.deletedAt })).sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || "")));
  }
  if (id === "restore" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const e = await trash().get(String(body.id || ""), { type: "json" });
    if (!e) return json({ error: "Introuvable dans la corbeille" }, 404);
    const { deletedBy, deletedAt, ...ev } = e;
    ev.history = [...(ev.history || []), { by: "Admin", at: new Date().toISOString(), action: "a restauré depuis la corbeille" }].slice(-30);
    await events().setJSON(ev.id, ev);
    await trash().delete(ev.id);
    return json({ ok: true });
  }

  // Réinitialiser le code perso d'un camarade qui l'a oublié (nouveau code donné par l'admin)
  if (id === "reset-pin" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const p = await profiles().get(String(body.id || ""), { type: "json" });
    if (!p) return json({ error: "Compte introuvable" }, 404);
    if (!/^\d{6}$/.test(String(body.pin || ""))) return json({ error: "Le code fait 6 chiffres" }, 400);
    p.salt = randomBytes(16).toString("hex");
    p.pinHash = scryptSync(String(body.pin), p.salt, 32).toString("hex");
    p.failed = 0; p.lockedUntil = 0;
    await profiles().setJSON(p.id, p);
    return json({ ok: true });
  }

  return json({ error: "Introuvable" }, 404);
}

export const dayName = (d) => DAYS[d];
