import { getStore } from "@netlify/blobs";
import { createHmac, randomUUID } from "node:crypto";

const MAX_PDF = 5.5 * 1024 * 1024;
const MAX_R2_PDF = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

async function deleteFile(file) {
  if (file.storage === "r2") {
    await fetch(signedUrl("DELETE", file.key, 300), { method: "DELETE" });
    await pdfs().delete(`r2:${file.key}`);
  } else {
    await pdfs().delete(file.key);
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const cleanName = (s) => String(s || "").trim().slice(0, 40);
const cleanText = (s, n) => String(s || "").trim().slice(0, n);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => s === "" || /^\d{2}:\d{2}$/.test(s);
const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "brown"];

const events = () => getStore({ name: "events", consistency: "strong" });
const pdfs = () => getStore({ name: "pdfs", consistency: "strong" });

async function listEvents() {
  const store = events();
  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return all.filter(Boolean).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

function readEventFields(body) {
  const ev = {
    title: cleanText(body.title, 120),
    subject: cleanText(body.subject, 60),
    date: String(body.date || ""),
    time: String(body.time || ""),
    color: COLORS.includes(body.color) ? body.color : "blue",
    notes: cleanText(body.notes, 2000),
  };
  if (!ev.title) return { error: "Titre obligatoire" };
  if (!isDate(ev.date)) return { error: "Date invalide" };
  if (!isTime(ev.time)) return { error: "Heure invalide" };
  return { ev };
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, id] = parts;
  const method = req.method;

  if (resource === "events") {
    if (method === "GET" && !id) return json(await listEvents());

    if (method === "POST" && !id) {
      const body = await req.json().catch(() => ({}));
      const by = cleanName(body.by);
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      const { ev, error } = readEventFields(body);
      if (error) return json({ error }, 400);
      const now = new Date().toISOString();
      const full = {
        id: randomUUID(), ...ev, files: [],
        createdBy: by, createdAt: now, updatedBy: by, updatedAt: now,
        history: [{ by, at: now, action: "a créé l'éval" }],
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
      const { ev, error } = readEventFields(body);
      if (error) return json({ error }, 400);
      const now = new Date().toISOString();
      const updated = {
        ...existing, ...ev, updatedBy: by, updatedAt: now,
        history: [...existing.history, { by, at: now, action: "a modifié l'éval" }].slice(-50),
      };
      await events().setJSON(id, updated);
      return json(updated);
    }

    if (method === "DELETE") {
      const by = cleanName(url.searchParams.get("by"));
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      await Promise.all(existing.files.map(deleteFile));
      await events().delete(id);
      return json({ ok: true });
    }
  }

  if (resource === "files") {
    if (method === "GET" && id) {
      const r2meta = UUID.test(id) && (await pdfs().get(`r2:${id}`, { type: "json" }));
      if (r2meta) {
        return new Response(null, {
          status: 302,
          headers: { location: signedUrl("GET", id, 2 * 60 * 60, r2meta.name), "cache-control": "no-store" },
        });
      }
      const res = await pdfs().getWithMetadata(id, { type: "arrayBuffer" });
      if (!res) return new Response("PDF introuvable", { status: 404 });
      const name = encodeURIComponent(res.metadata?.name || "cours.pdf");
      return new Response(res.data, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename*=UTF-8''${name}`,
          "cache-control": "private, max-age=3600",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (method === "POST" && id === "start") {
      if (!r2Enabled()) return json({ error: "Stockage R2 non configuré" }, 501);
      const body = await req.json().catch(() => ({}));
      if (!cleanName(body.by)) return json({ error: "Ton nom est obligatoire" }, 400);
      const ev = await events().get(String(body.event || ""), { type: "json" });
      if (!ev) return json({ error: "Éval introuvable" }, 404);
      const size = Number(body.size) || 0;
      if (size <= 0) return json({ error: "Fichier vide" }, 400);
      if (size > MAX_R2_PDF) return json({ error: "PDF trop lourd (max 100 Mo)" }, 413);
      const key = randomUUID();
      return json({ key, uploadUrl: signedUrl("PUT", key, 30 * 60) });
    }

    if (method === "POST" && id === "finish") {
      if (!r2Enabled()) return json({ error: "Stockage R2 non configuré" }, 501);
      const body = await req.json().catch(() => ({}));
      const by = cleanName(body.by);
      const key = String(body.key || "");
      let name = cleanText(body.name, 120) || "cours.pdf";
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      if (!UUID.test(key)) return json({ error: "Fichier invalide" }, 400);
      const ev = await events().get(String(body.event || ""), { type: "json" });
      if (!ev) return json({ error: "Éval introuvable" }, 404);
      if (ev.files.some((f) => f.key === key)) return json(ev);
      const head = await fetch(signedUrl("GET", key, 300), { method: "HEAD" });
      if (!head.ok) return json({ error: "Le PDF n'a pas été reçu" }, 400);
      const size = Number(head.headers.get("content-length")) || 0;
      if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
      await pdfs().setJSON(`r2:${key}`, { name, eventId: ev.id });
      const now = new Date().toISOString();
      const file = { key, name, size, uploadedBy: by, uploadedAt: now, storage: "r2" };
      const updated = {
        ...ev, files: [...ev.files, file], updatedBy: by, updatedAt: now,
        history: [...ev.history, { by, at: now, action: `a ajouté « ${name} »` }].slice(-50),
      };
      await events().setJSON(ev.id, updated);
      return json(updated, 201);
    }

    if (method === "POST" && !id) {
      const eventId = url.searchParams.get("event") || "";
      const by = cleanName(url.searchParams.get("by"));
      let name = cleanText(url.searchParams.get("name"), 120) || "cours.pdf";
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      const ev = await events().get(eventId, { type: "json" });
      if (!ev) return json({ error: "Éval introuvable" }, 404);
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length === 0) return json({ error: "Fichier vide" }, 400);
      if (buf.length > MAX_PDF) return json({ error: "PDF trop lourd (max 5,5 Mo)" }, 413);
      if (String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") return json({ error: "Ce n'est pas un PDF" }, 400);
      if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
      const key = randomUUID();
      await pdfs().set(key, buf, { metadata: { name, eventId } });
      const now = new Date().toISOString();
      const file = { key, name, size: buf.length, uploadedBy: by, uploadedAt: now };
      const updated = {
        ...ev, files: [...ev.files, file], updatedBy: by, updatedAt: now,
        history: [...ev.history, { by, at: now, action: `a ajouté « ${name} »` }].slice(-50),
      };
      await events().setJSON(ev.id, updated);
      return json(updated, 201);
    }

    if (method === "DELETE" && id) {
      const eventId = url.searchParams.get("event") || "";
      const by = cleanName(url.searchParams.get("by"));
      if (!by) return json({ error: "Ton nom est obligatoire" }, 400);
      const ev = await events().get(eventId, { type: "json" });
      if (!ev) return json({ error: "Éval introuvable" }, 404);
      const file = ev.files.find((f) => f.key === id);
      if (!file) return json({ error: "PDF introuvable" }, 404);
      await deleteFile(file);
      const now = new Date().toISOString();
      const updated = {
        ...ev, files: ev.files.filter((f) => f.key !== id), updatedBy: by, updatedAt: now,
        history: [...ev.history, { by, at: now, action: `a supprimé « ${file.name} »` }].slice(-50),
      };
      await events().setJSON(ev.id, updated);
      return json(updated);
    }
  }

  return json({ error: "Introuvable" }, 404);
};

export const config = { path: "/api/*" };
