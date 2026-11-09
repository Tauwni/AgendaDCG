import { getStore } from "@netlify/blobs";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE = "agenda_session";
const password = () => Netlify.env.get("AGENDA_PASSWORD") || "";
const token = () => createHmac("sha256", password()).update("agenda-v1").digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isAuthed(req) {
  if (!password()) return false;
  const m = (req.headers.get("cookie") || "").match(new RegExp(`${COOKIE}=([a-f0-9]+)`));
  return !!m && safeEqual(m[1], token());
}

const MAX_PDF = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLOTS = { cours: "la fiche de cours", sujet: "le sujet type", corrige: "le corrigé" };
const KINDS = { eval: "l'éval", exercice: "l'exercice" };
const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "brown"];

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

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

const cleanName = (s) => String(s || "").trim().slice(0, 40);
const cleanText = (s, n) => String(s || "").trim().replace(/\s+/g, " ").slice(0, n);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => s === "" || /^\d{2}:\d{2}$/.test(s);

const events = () => getStore({ name: "events", consistency: "strong" });
const chapters = () => getStore({ name: "chapters", consistency: "strong" });
const pdfs = () => getStore({ name: "pdfs", consistency: "strong" });

async function listAll(store) {
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}

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

export default async (req) => {
  const url = new URL(req.url);
  const [resource, id] = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  if (resource === "login" && method === "POST") {
    const { password: pw } = await req.json().catch(() => ({}));
    if (!password() || !safeEqual(String(pw || ""), password())) return json({ error: "Mot de passe incorrect" }, 401);
    return json({ ok: true }, 200, {
      "set-cookie": `${COOKIE}=${token()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}`,
    });
  }

  if (resource === "logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  if (!isAuthed(req)) return json({ error: "Non connecté" }, 401);

  if (resource === "me") return json({ ok: true });

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
        history: [{ by, at: now, action: `a créé ${KINDS[ev.kind]}` }],
      };
      await events().setJSON(full.id, full);
      return json(full, 201);
    }

    if (!id) return json({ error: "Introuvable" }, 404);
    const existing = await events().get(id, { type: "json" });
    if (!existing) return json({ error: "Éval introuvable" }, 404);

    if (method === "GET") return json(existing);

    if (method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const by = cleanName(body.by);
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      const { ev, error } = await readEventFields(body);
      if (error) return json({ error }, 400);
      const updated = stamp({ ...existing, ...ev }, by, `a modifié ${KINDS[ev.kind]}`);
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
