const ORIGINS = ["https://agenda-evals-0885.netlify.app", "http://localhost:8888"];
const MAX_PDF = 100 * 1024 * 1024;
const enc = new TextEncoder();

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

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return reply(req, null, 204);

    const url = new URL(req.url);
    const m = url.pathname.match(/^\/f\/([0-9a-f-]{36})$/);
    if (!m) return json(req, { error: "Introuvable" }, 404);
    const key = m[1];

    const op = req.method === "HEAD" ? "GET" : req.method;
    const exp = url.searchParams.get("exp") || "";
    const sig = url.searchParams.get("sig") || "";
    if (!/^\d+$/.test(exp) || Date.now() / 1000 > Number(exp)) return json(req, { error: "Lien expiré" }, 403);
    if (!sameSig(sig, await sign(env.SIGNING_SECRET, `${op}\n${key}\n${exp}`))) return json(req, { error: "Signature invalide" }, 403);

    if (req.method === "PUT") {
      const len = Number(req.headers.get("content-length") || 0);
      if (!len) return json(req, { error: "Fichier vide" }, 400);
      if (len > MAX_PDF) return json(req, { error: "PDF trop lourd (max 100 Mo)" }, 413);
      await env.PDFS.put(key, req.body, { httpMetadata: { contentType: "application/pdf" } });
      const head = await env.PDFS.get(key, { range: { offset: 0, length: 5 } });
      const magic = head ? await head.text() : "";
      if (magic !== "%PDF-") {
        await env.PDFS.delete(key);
        return json(req, { error: "Ce n'est pas un PDF" }, 400);
      }
      return json(req, { ok: true, size: len }, 201);
    }

    if (req.method === "DELETE") {
      await env.PDFS.delete(key);
      return reply(req, null, 204);
    }

    if (req.method === "HEAD") {
      const obj = await env.PDFS.head(key);
      if (!obj) return reply(req, null, 404);
      return reply(req, null, 200, { "content-type": "application/pdf", "content-length": String(obj.size), "accept-ranges": "bytes" });
    }

    if (req.method === "GET") {
      const meta = await env.PDFS.head(key);
      if (!meta) return json(req, { error: "PDF introuvable" }, 404);
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
      headers["content-length"] = String(obj.size);
      return reply(req, obj.body, 200, headers);
    }

    return json(req, { error: "Méthode non autorisée" }, 405);
  },
};
