import { getStore } from "@netlify/blobs";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { KINDS, events, profiles, listAll, profileId, pushReady, sendPush, frDate, describe } from "../lib/shared.mjs";

const COOKIE = "agenda_session";
const PROFILE_COOKIE = "agenda_profile";
const COOKIE_AGE = 60 * 60 * 24 * 365;
const password = () => Netlify.env.get("AGENDA_PASSWORD") || "";
const profileSecret = () => Netlify.env.get("PROFILE_SECRET") || "";
const token = () => createHmac("sha256", password()).update("agenda-v1").digest("hex");
const profileToken = (id) => createHmac("sha256", profileSecret()).update(`profile:${id}`).digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

const readCookie = (req, name) => (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || "";

function isAuthed(req) {
  if (!password()) return false;
  const v = readCookie(req, COOKIE);
  return !!v && safeEqual(v, token());
}

function currentProfileId(req) {
  if (!profileSecret()) return null;
  const [id, sig] = decodeURIComponent(readCookie(req, PROFILE_COOKIE)).split(".");
  return id && sig && safeEqual(sig, profileToken(id)) ? id : null;
}

const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const hashPin = (pin, salt) => scryptSync(String(pin), salt, 32).toString("hex");

const MAX_PDF = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLOTS = { cours: "la fiche de cours", sujet: "le sujet type", corrige: "le corrigé" };
const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "brown"];
const CATEGORIES = ["controle", "devoir", "examen", "entrainement"];
const REMINDERS = [1, 2, 7];
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const workerUrl = () => (Netlify.env.get("PDF_WORKER_URL") || "").replace(/\/$/, "");
const signingSecret = () => Netlify.env.get("PDF_SIGNING_SECRET") || "";
const r2Enabled = () => !!(workerUrl() && signingSecret());

function signedUrl(method, key, ttlSeconds, name) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", signingSecret()).update(`${method}\n${key}\n${exp}`).digest("hex");
  const q = new URLSearchParams({ exp: String(exp), sig });
  if (name) q.set("name", name);
  return `${workerUrl()}/f/${key}?${q}`;
}

function json(data, status = 200, cookies = []) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(data), { status, headers });
}

const cleanName = (s) => String(s || "").trim().replace(/\s+/g, " ").slice(0, 40);
const cleanText = (s, n) => String(s || "").trim().replace(/\s+/g, " ").slice(0, n);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => s === "" || /^\d{2}:\d{2}$/.test(s);

const chapters = () => getStore({ name: "chapters", consistency: "strong" });
const pdfs = () => getStore({ name: "pdfs", consistency: "strong" });

async function deleteR2(key) {
  await fetch(signedUrl("DELETE", key, 300), { method: "DELETE" });
  await pdfs().delete(`r2:${key}`);
}

const stamp = (obj, by, action) => {
  const at = new Date().toISOString();
  return { ...obj, updatedBy: by, updatedAt: at, history: [...(obj.history || []), { by, at, action }].slice(-50) };
};

async function readEventFields(body) {
  const ev = {
    kind: body.kind in KINDS ? body.kind : "eval",
    title: cleanText(body.title, 120),
    subject: cleanText(body.subject, 60),
    date: String(body.date || ""),
    time: String(body.time || ""),
    color: COLORS.includes(body.color) ? body.color : "blue",
    notes: String(body.notes || "").trim().slice(0, 2000),
  };
  if (!ev.title) return { error: "Titre obligatoire" };
  if (!isDate(ev.date)) return { error: "Date invalide" };
  if (!isTime(ev.time)) return { error: "Heure invalide" };
  const wanted = Array.isArray(body.chapters) ? [...new Set(body.chapters.map(String))].slice(0, 30) : [];
  const { blobs } = await chapters().list();
  const known = new Set(blobs.map((b) => b.key));
  ev.chapters = wanted.filter((c) => known.has(c));
  return { ev };
}

function readChapterFields(body) {
  const ch = { subject: cleanText(body.subject, 60), title: cleanText(body.title, 120) };
  if (!ch.subject) return { error: "Matière obligatoire" };
  if (!ch.title) return { error: "Nom du chapitre obligatoire" };
  return { ch };
}

function readGrades(list) {
  if (!Array.isArray(list) || list.length > 1000) return { error: "Liste de notes invalide" };
  const out = [];
  for (const g of list) {
    const outOf = Number(g.outOf);
    const value = Number(g.value);
    const coef = Number(g.coef);
    const grade = {
      id: UUID.test(String(g.id)) ? String(g.id) : randomUUID(),
      subject: cleanText(g.subject, 60),
      title: cleanText(g.title, 120),
      date: String(g.date || ""),
      category: CATEGORIES.includes(g.category) ? g.category : "controle",
      value, outOf, coef,
    };
    if (!grade.subject) return { error: "Chaque note doit avoir une matière" };
    if (!isDate(grade.date)) return { error: "Date de note invalide" };
    if (!(outOf > 0 && outOf <= 100)) return { error: "Barème invalide" };
    if (!(value >= 0 && value <= outOf)) return { error: `Note invalide (entre 0 et ${outOf})` };
    if (!(coef > 0 && coef <= 20)) return { error: "Coefficient invalide (entre 0,1 et 20)" };
    out.push(grade);
  }
  return { grades: out };
}

function readPrefs(p) {
  return {
    onNew: !!p?.onNew,
    daily: !!p?.daily,
    weekly: !!p?.weekly,
    before: Array.isArray(p?.before) ? REMINDERS.filter((d) => p.before.map(Number).includes(d)) : [],
  };
}

const publicProfile = (p) => ({
  id: p.id, name: p.name, done: p.done || [], grades: p.grades || [], prefs: p.prefs || readPrefs({}),
  pushDevices: (p.subs || []).length,
});

async function notifyNewEvent(ev, authorId) {
  if (!pushReady()) return;
  const all = await listAll(profiles());
  await Promise.all(all
    .filter((p) => p.id !== authorId && p.prefs?.onNew && p.subs?.length)
    .map((p) => sendPush(p, { title: `Nouveau : ${KINDS[ev.kind].label.toLowerCase()}`, body: `${describe(ev)} · ${frDate(ev.date)}`, url: `/?event=${ev.id}`, tag: `new-${ev.id}` })));
}

async function handleProfile(req, url, id, method) {
  if (id === "check" && method === "POST") {
    const { name } = await req.json().catch(() => ({}));
    const pid = profileId(name);
    if (!pid) return json({ error: "Écris ton prénom" }, 400);
    return json({ exists: !!(await profiles().get(pid, { type: "json" })) });
  }

  if (id === "login" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const cookies = [];
    if (!isAuthed(req)) {
      if (!password() || !safeEqual(String(body.password || ""), password())) return json({ error: "Mot de passe de la classe incorrect" }, 401);
      cookies.push(cookie(COOKIE, token(), COOKIE_AGE));
    }
    if (!profileSecret()) return json({ error: "Comptes non configurés" }, 501);
    const name = cleanName(body.name);
    const pid = profileId(name);
    const pin = String(body.pin || "");
    if (!pid) return json({ error: "Écris ton prénom" }, 400);
    if (!/^\d{6}$/.test(pin)) return json({ error: "Le code perso fait 6 chiffres" }, 400);

    let profile = await profiles().get(pid, { type: "json" });
    if (!profile) {
      if (!body.create) return json({ error: "Aucun compte à ce prénom" }, 404);
      const salt = randomBytes(16).toString("hex");
      profile = {
        id: pid, name, salt, pinHash: hashPin(pin, salt), createdAt: new Date().toISOString(),
        failed: 0, lockedUntil: 0, done: [], grades: [], prefs: readPrefs({}), subs: [],
      };
      await profiles().setJSON(pid, profile);
    } else {
      if (profile.lockedUntil > Date.now()) {
        const min = Math.ceil((profile.lockedUntil - Date.now()) / 60000);
        return json({ error: `Trop d'essais : réessaie dans ${min} min` }, 429);
      }
      if (!safeEqual(hashPin(pin, profile.salt), profile.pinHash)) {
        profile.failed = (profile.failed || 0) + 1;
        if (profile.failed >= MAX_FAILS) { profile.failed = 0; profile.lockedUntil = Date.now() + LOCK_MS; }
        await profiles().setJSON(pid, profile);
        const left = MAX_FAILS - profile.failed;
        return json({ error: profile.lockedUntil > Date.now() ? "Trop d'essais : compte bloqué 15 min" : `Code incorrect (encore ${left} essai${left > 1 ? "s" : ""})` }, 401);
      }
      if (profile.failed) { profile.failed = 0; await profiles().setJSON(pid, profile); }
    }
    cookies.push(cookie(PROFILE_COOKIE, encodeURIComponent(`${pid}.${profileToken(pid)}`), COOKIE_AGE));
    return json(publicProfile(profile), 200, cookies);
  }

  if (id === "logout" && method === "POST") {
    return json({ ok: true }, 200, [cookie(PROFILE_COOKIE, "", 0)]);
  }

  const pid = currentProfileId(req);
  if (!pid) return json({ error: "Connecte-toi à ton compte" }, 401);
  const profile = await profiles().get(pid, { type: "json" });
  if (!profile) return json({ error: "Compte introuvable" }, 401, [cookie(PROFILE_COOKIE, "", 0)]);

  if (!id && method === "GET") return json(publicProfile(profile));

  const body = method === "GET" ? {} : await req.json().catch(() => ({}));
  if (id === "done" && method === "PUT") {
    const eid = String(body.event || "");
    const done = new Set(profile.done || []);
    if (body.done) done.add(eid); else done.delete(eid);
    profile.done = [...done].slice(-3000);
  } else if (id === "grades" && method === "PUT") {
    const { grades, error } = readGrades(body.grades);
    if (error) return json({ error }, 400);
    profile.grades = grades;
  } else if (id === "prefs" && method === "PUT") {
    profile.prefs = readPrefs(body.prefs);
  } else if (id === "push" && method === "POST") {
    const sub = body.subscription;
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: "Abonnement invalide" }, 400);
    profile.subs = [...(profile.subs || []).filter((s) => s.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }].slice(-10);
  } else if (id === "push" && method === "DELETE") {
    profile.subs = (profile.subs || []).filter((s) => s.endpoint !== body.endpoint);
  } else if (id === "push-test" && method === "POST") {
    const sent = await sendPush(profile, { title: "Agenda DCG", body: "Les notifications fonctionnent sur cet appareil.", url: "/" });
    return json({ sent });
  } else {
    return json({ error: "Introuvable" }, 404);
  }
  await profiles().setJSON(pid, profile);
  return json(publicProfile(profile));
}

export default async (req) => {
  const url = new URL(req.url);
  const [resource, id] = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  if (resource === "push-key" && method === "GET") {
    return json({ key: pushReady() ? Netlify.env.get("PUSH_PUBLIC_KEY") : null });
  }

  if (resource === "profile" && (id === "check" || id === "login" || id === "logout")) {
    return handleProfile(req, url, id, method);
  }

  if (resource === "logout" && method === "POST") {
    return json({ ok: true }, 200, [cookie(COOKIE, "", 0), cookie(PROFILE_COOKIE, "", 0)]);
  }

  if (!isAuthed(req)) return json({ error: "Non connecté" }, 401);

  if (resource === "me") return json({ ok: true });

  if (resource === "profile") return handleProfile(req, url, id, method);

  if (resource === "usage" && method === "GET") {
    if (!r2Enabled()) return json({ error: "Stockage R2 non configuré" }, 501);
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = createHmac("sha256", signingSecret()).update(`USAGE\nusage\n${exp}`).digest("hex");
    const res = await fetch(`${workerUrl()}/usage?exp=${exp}&sig=${sig}`);
    if (!res.ok) return json({ error: "Usage indisponible" }, 502);
    return json(await res.json());
  }

  if (resource === "events") {
    if (method === "GET" && !id) {
      const all = await listAll(events());
      return json(all.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
    }

    if (method === "POST" && !id) {
      const body = await req.json().catch(() => ({}));
      const by = cleanName(body.by);
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      const { ev, error } = await readEventFields(body);
      if (error) return json({ error }, 400);
      const now = new Date().toISOString();
      const full = {
        id: randomUUID(), ...ev, createdBy: by, createdAt: now, updatedBy: by, updatedAt: now,
        history: [{ by, at: now, action: `a créé ${KINDS[ev.kind].article}` }],
      };
      await events().setJSON(full.id, full);
      if (KINDS[full.kind].deadline) await notifyNewEvent(full, currentProfileId(req)).catch(() => {});
      return json(full, 201);
    }

    if (!id) return json({ error: "Introuvable" }, 404);
    const existing = await events().get(id, { type: "json" });
    if (!existing) return json({ error: "Événement introuvable" }, 404);

    if (method === "GET") return json(existing);

    if (method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const by = cleanName(body.by);
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      const { ev, error } = await readEventFields(body);
      if (error) return json({ error }, 400);
      const updated = stamp({ ...existing, ...ev }, by, `a modifié ${KINDS[ev.kind].article}`);
      await events().setJSON(id, updated);
      return json(updated);
    }

    if (method === "DELETE") {
      if (!cleanName(url.searchParams.get("by"))) return json({ error: "Ton nom est obligatoire" }, 400);
      await events().delete(id);
      return json({ ok: true });
    }
  }

  if (resource === "chapters") {
    if (method === "GET" && !id) return json(await listAll(chapters()));

    if (method === "POST" && !id) {
      const body = await req.json().catch(() => ({}));
      const by = cleanName(body.by);
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      const { ch, error } = readChapterFields(body);
      if (error) return json({ error }, 400);
      const now = new Date().toISOString();
      const full = {
        id: randomUUID(), ...ch, files: { cours: null, sujet: null, corrige: null },
        createdBy: by, createdAt: now, updatedBy: by, updatedAt: now,
        history: [{ by, at: now, action: "a créé le chapitre" }],
      };
      await chapters().setJSON(full.id, full);
      return json(full, 201);
    }

    if (!id) return json({ error: "Introuvable" }, 404);
    const existing = await chapters().get(id, { type: "json" });
    if (!existing) return json({ error: "Chapitre introuvable" }, 404);

    if (method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const by = cleanName(body.by);
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      const { ch, error } = readChapterFields(body);
      if (error) return json({ error }, 400);
      const updated = stamp({ ...existing, ...ch }, by, "a renommé le chapitre");
      await chapters().setJSON(id, updated);
      return json(updated);
    }

    if (method === "DELETE") {
      const by = cleanName(url.searchParams.get("by"));
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      await Promise.all(Object.values(existing.files).filter(Boolean).map((f) => deleteR2(f.key)));
      for (const ev of await listAll(events())) {
        if (!ev.chapters?.includes(id)) continue;
        const updated = stamp({ ...ev, chapters: ev.chapters.filter((c) => c !== id) }, by, `a supprimé le chapitre « ${existing.title} » de la bibliothèque`);
        await events().setJSON(ev.id, updated);
      }
      await chapters().delete(id);
      return json({ ok: true });
    }
  }

  if (resource === "files") {
    if (method === "GET" && id) {
      const meta = UUID.test(id) && (await pdfs().get(`r2:${id}`, { type: "json" }));
      if (!meta) return new Response("PDF introuvable", { status: 404 });
      return new Response(null, {
        status: 302,
        headers: { location: signedUrl("GET", id, 2 * 60 * 60, meta.name), "cache-control": "no-store" },
      });
    }

    if (method === "POST" && (id === "start" || id === "finish")) {
      if (!r2Enabled()) return json({ error: "Stockage R2 non configuré" }, 501);
      const body = await req.json().catch(() => ({}));
      const by = cleanName(body.by);
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      if (!(body.slot in SLOTS)) return json({ error: "Type de PDF inconnu" }, 400);
      const ch = await chapters().get(String(body.chapter || ""), { type: "json" });
      if (!ch) return json({ error: "Chapitre introuvable" }, 404);

      if (id === "start") {
        const size = Number(body.size) || 0;
        if (size <= 0) return json({ error: "Fichier vide" }, 400);
        if (size > MAX_PDF) return json({ error: "PDF trop lourd (max 100 Mo)" }, 413);
        const key = randomUUID();
        return json({ key, uploadUrl: signedUrl("PUT", key, 30 * 60) });
      }

      const key = String(body.key || "");
      if (!UUID.test(key)) return json({ error: "Fichier invalide" }, 400);
      if (ch.files[body.slot]?.key === key) return json(ch);
      const head = await fetch(signedUrl("GET", key, 300), { method: "HEAD" });
      if (!head.ok) return json({ error: head.status === 404 ? "Le PDF n'a pas été reçu" : "Vérification du PDF impossible, réessaie" }, 400);
      let name = cleanText(body.name, 120) || "cours.pdf";
      if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
      await pdfs().setJSON(`r2:${key}`, { name, chapterId: ch.id, slot: body.slot });
      const previous = ch.files[body.slot];
      const file = { key, name, size: Number(head.headers.get("content-length")) || 0, uploadedBy: by, uploadedAt: new Date().toISOString() };
      const updated = stamp({ ...ch, files: { ...ch.files, [body.slot]: file } }, by, `a ${previous ? "remplacé" : "ajouté"} ${SLOTS[body.slot]}`);
      await chapters().setJSON(ch.id, updated);
      if (previous) await deleteR2(previous.key);
      return json(updated, 201);
    }

    if (method === "DELETE" && id) {
      const by = cleanName(url.searchParams.get("by"));
      const slot = url.searchParams.get("slot") || "";
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      if (!(slot in SLOTS)) return json({ error: "Type de PDF inconnu" }, 400);
      const ch = await chapters().get(url.searchParams.get("chapter") || "", { type: "json" });
      if (!ch || ch.files[slot]?.key !== id) return json({ error: "PDF introuvable" }, 404);
      await deleteR2(id);
      const updated = stamp({ ...ch, files: { ...ch.files, [slot]: null } }, by, `a supprimé ${SLOTS[slot]}`);
      await chapters().setJSON(ch.id, updated);
      return json(updated);
    }
  }

  return json({ error: "Introuvable" }, 404);
};

export const config = { path: "/api/*" };
