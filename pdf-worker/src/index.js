import { DurableObject } from "cloudflare:workers";

const ORIGINS = ["https://agenda-evals-0885.netlify.app", "http://localhost:8888"];
const MAX_PDF = 100 * 1024 * 1024;

// Stay under R2's free tier (10 GB, 1M class A ops, 10M class B ops per month) so nothing is ever billed.
const LIMITS = { bytes: 9.5e9, classA: 950_000, classB: 9_500_000 };
// [class A, class B] per request. A put also pays for its PDF check and for the HEAD the API does to confirm it,
// so an upload that is accepted can always be completed.
const COST = { put: [1, 2], get: [0, 2], head: [0, 0], delete: [0, 1] };

const enc = new TextEncoder();
const monthKey = () => new Date().toISOString().slice(0, 7);

export class Usage extends DurableObject {
  async load() {
    if (!this.s) {
      this.s = await this.ctx.storage.get("s");
      if (!this.s) {
        let bytes = 0;
        let lists = 0;
        let cursor;
        do {
          const page = await this.env.PDFS.list({ cursor, limit: 1000 });
          lists++;
          for (const o of page.objects) bytes += o.size;
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        this.s = { bytes, month: monthKey(), classA: lists, classB: 0 };
      }
    }
    if (this.s.month !== monthKey()) Object.assign(this.s, { month: monthKey(), classA: 0, classB: 0 });
    return this.s;
  }

  async reserve(op, bytes = 0) {
    const s = await this.load();
    const [a, b] = COST[op];
    if (op === "put" && s.bytes + bytes > LIMITS.bytes) {
      return { ok: false, error: "Stockage presque plein (9,5 Go sur 10 Go gratuits) : supprime d'anciens PDF pour en envoyer de nouveaux" };
    }
    if (s.classA + a > LIMITS.classA) return { ok: false, error: "Limite gratuite d'envois du mois atteinte : réessaie le 1er du mois prochain" };
    if (s.classB + b > LIMITS.classB) return { ok: false, error: "Limite gratuite de lectures du mois atteinte : réessaie le 1er du mois prochain" };
    s.classA += a;
    s.classB += b;
    if (op === "put") s.bytes += bytes;
    await this.ctx.storage.put("s", s);
    return { ok: true };
  }

  async release(bytes) {
    const s = await this.load();
    s.bytes = Math.max(0, s.bytes - bytes);
    await this.ctx.storage.put("s", s);
  }

  async stats() {
    const s = await this.load();
    return { ...s, limits: LIMITS };
  }
}

async function sign(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameSig(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

function parseRange(header, size) {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
}

function corsHeaders(req) {
  const origin = req.headers.get("origin");
  if (!ORIGINS.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, PUT, DELETE",
    "access-control-allow-headers": "content-type, range",
    "access-control-expose-headers": "content-length, content-range, accept-ranges",
    "access-control-max-age": "3600",
    vary: "origin",
  };
}

const reply = (req, body, status, headers = {}) =>
  new Response(body, { status, headers: { ...corsHeaders(req), ...headers } });
const json = (req, data, status = 200) => reply(req, JSON.stringify(data), status, { "content-type": "application/json" });

const blockedPage = (message) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenda DCG</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;background:Canvas;color:CanvasText}
h1{font-size:22px;margin:0 0 8px}p{opacity:.65;margin:0;max-width:420px;line-height:1.4}</style></head>
<body><div><h1>PDF momentanément indisponible</h1><p>${message.replace(/[<>&]/g, "")}</p></div></body></html>`;

async function verify(env, url, op, key) {
  const exp = url.searchParams.get("exp") || "";
  const sig = url.searchParams.get("sig") || "";
  if (!/^\d+$/.test(exp) || Date.now() / 1000 > Number(exp)) return "Lien expiré";
  if (!sameSig(sig, await sign(env.SIGNING_SECRET, `${op}\n${key}\n${exp}`))) return "Signature invalide";
  return null;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return reply(req, null, 204);
    const url = new URL(req.url);
    const usage = env.USAGE.get(env.USAGE.idFromName("global"));

    if (url.pathname === "/usage" && req.method === "GET") {
      const bad = await verify(env, url, "USAGE", "usage");
      if (bad) return json(req, { error: bad }, 403);
      return json(req, await usage.stats());
    }

    const m = url.pathname.match(/^\/f\/([0-9a-f-]{36})$/);
    if (!m) return json(req, { error: "Introuvable" }, 404);
    const key = m[1];

    const bad = await verify(env, url, req.method === "HEAD" ? "GET" : req.method, key);
    if (bad) return json(req, { error: bad }, 403);

    const op = { PUT: "put", GET: "get", HEAD: "head", DELETE: "delete" }[req.method];
    if (!op) return json(req, { error: "Méthode non autorisée" }, 405);

    if (op === "put") {
      const len = Number(req.headers.get("content-length") || 0);
      if (!len) return json(req, { error: "Fichier vide" }, 400);
      if (len > MAX_PDF) return json(req, { error: "PDF trop lourd (max 100 Mo)" }, 413);
      const quota = await usage.reserve("put", len);
      if (!quota.ok) return json(req, { error: quota.error }, 507);
      try {
        await env.PDFS.put(key, req.body, { httpMetadata: { contentType: "application/pdf" } });
      } catch (err) {
        await usage.release(len);
        throw err;
      }
      const head = await env.PDFS.get(key, { range: { offset: 0, length: 5 } });
      const magic = head ? await head.text() : "";
      if (magic !== "%PDF-") {
        await env.PDFS.delete(key);
        await usage.release(len);
        return json(req, { error: "Ce n'est pas un PDF" }, 400);
      }
      return json(req, { ok: true, size: len }, 201);
    }

    const quota = await usage.reserve(op);
    if (!quota.ok) {
      if (op === "get" && (req.headers.get("accept") || "").includes("text/html")) {
        return reply(req, blockedPage(quota.error), 429, { "content-type": "text/html; charset=utf-8" });
      }
      return json(req, { error: quota.error }, 429);
    }

    if (op === "delete") {
      const meta = await env.PDFS.head(key);
      if (meta) {
        await env.PDFS.delete(key);
        await usage.release(meta.size);
      }
      return reply(req, null, 204);
    }

    const meta = await env.PDFS.head(key);
    if (!meta) return json(req, { error: "PDF introuvable" }, 404);

    if (op === "head") {
      return reply(req, null, 200, { "content-type": "application/pdf", "content-length": String(meta.size), "accept-ranges": "bytes" });
    }

    const range = parseRange(req.headers.get("range"), meta.size);
    if (range === "invalid") return reply(req, null, 416, { "content-range": `bytes */${meta.size}` });
    const obj = await env.PDFS.get(key, range ? { range } : {});
    if (!obj) return json(req, { error: "PDF introuvable" }, 404);
    const name = (url.searchParams.get("name") || "cours.pdf").slice(0, 150);
    const headers = {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      etag: obj.httpEtag,
    };
    if (range) {
      headers["content-range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`;
      headers["content-length"] = String(range.length);
      return reply(req, obj.body, 206, headers);
    }
    headers["content-length"] = String(meta.size);
    return reply(req, obj.body, 200, headers);
  },
};
