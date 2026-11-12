import { getStore } from "@netlify/blobs";
import * as webpush from "web-push";

export const KINDS = {
  eval: { label: "Évaluation", article: "l'évaluation", deadline: true },
  examen: { label: "Examen blanc", article: "l'examen blanc", deadline: true },
  devoir: { label: "Devoir", article: "le devoir", deadline: true },
  exercice: { label: "Exercice", article: "l'exercice", deadline: true },
  cours: { label: "Cours", article: "le cours", deadline: false },
  revision: { label: "Révision", article: "la révision", deadline: false },
  autre: { label: "Autre", article: "l'événement", deadline: false },
};

export const events = () => getStore({ name: "events", consistency: "strong" });
export const profiles = () => getStore({ name: "profiles", consistency: "strong" });
export const trash = () => getStore({ name: "trash", consistency: "strong" });
/** Efface pour de bon ce qui est dans la corbeille depuis plus de 7 jours. */
export async function purgeTrash(deleteFile) {
  for (const e of await listAll(trash())) {
    if (Date.now() - Date.parse(e.deletedAt || 0) < 7 * 864e5) continue;
    await Promise.all((e.attachments || []).map((f) => deleteFile(f.key).catch(() => {})));
    await trash().delete(e.id);
  }
}
export const pushLog = () => getStore({ name: "push-log", consistency: "strong" });

export async function listAll(store) {
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}

export const profileId = (name) =>
  String(name || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export const pushReady = () => !!(Netlify.env.get("PUSH_PUBLIC_KEY") && Netlify.env.get("PUSH_PRIVATE_KEY"));

/** Compteurs pour le tableau de bord (totaux depuis le début + détail par jour sur 60 jours). */
export async function bump(updates) {
  try {
    const store = getStore({ name: "config", consistency: "strong" });
    const c = (await store.get("counters", { type: "json" })) || { since: new Date().toISOString(), totals: {}, days: {} };
    const day = parisNow().iso;
    c.days[day] ||= {};
    for (const [k, n] of Object.entries(updates)) {
      if (!n) continue;
      c.totals[k] = (c.totals[k] || 0) + n;
      c.days[day][k] = (c.days[day][k] || 0) + n;
    }
    for (const d of Object.keys(c.days).sort().slice(0, -60)) delete c.days[d];
    await store.setJSON("counters", c);
  } catch { /* les stats ne doivent jamais bloquer l'appli */ }
}

export async function sendPush(profile, payload) {
  if (!pushReady() || !profile.subs?.length) return 0;
  webpush.setVapidDetails("https://agendadcg.netlify.app", Netlify.env.get("PUSH_PUBLIC_KEY"), Netlify.env.get("PUSH_PRIVATE_KEY"));
  const dead = new Set();
  let sent = 0;
  for (const sub of profile.subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 12 * 3600, urgency: "normal" });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) dead.add(sub.endpoint);
    }
  }
  if (sent) {
    const type = { new: "push_new", daily: "push_daily", before: "push_before", weekly: "push_weekly" }[String(payload.tag || "").split("-")[0]] || "push_other";
    await bump({ push: sent, [type]: sent });
  }
  if (dead.size) {
    const fresh = await profiles().get(profile.id, { type: "json" });
    if (fresh) {
      fresh.subs = (fresh.subs || []).filter((s) => !dead.has(s.endpoint));
      await profiles().setJSON(fresh.id, fresh);
    }
  }
  return sent;
}

export function parisNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export function frDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
export const describe = (e) => `${KINDS[e.kind]?.label || "Évaluation"} : ${e.title}${e.subject ? ` (${e.subject})` : ""}${e.time ? ` à ${e.time}` : ""}`;
