// Hors ligne : la page et les dernières données restent lisibles sans réseau,
// plus les 3 derniers PDF ouverts (pas plus, pour ne pas remplir le téléphone).
const SHELL = "agenda-shell-v4", DATA = "agenda-data-v1", PDF = "agenda-pdf-v1", MAX_PDF = 3;
const ASSETS = ["/pdf-tools.js", "/tts.js", ...["core", "reviser", "session", "today", "agenda", "events", "cours", "import", "settings"].map((n) => `/js/${n}.js`)];
const DATA_PATHS = ["/api/events", "/api/chapters", "/api/profile", "/schedule.json", "/api/me"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/app.css", ...ASSETS, "/manifest.webmanifest", "/icons/icon-192.png"])).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: cacheName === SHELL });
    if (hit) return hit;
    if (cacheName === DATA) return new Response(JSON.stringify({ error: "Hors ligne" }), { status: 503, headers: { "content-type": "application/json" } });
    throw new Error("offline");
  }
}

async function pdf(req) {
  const url = new URL(req.url);
  const key = url.origin + url.pathname;
  const cache = await caches.open(PDF);
  try {
    const res = await fetch(key, { credentials: "same-origin", mode: "cors", redirect: "follow" });
    if (!res.ok || res.type === "opaque") throw new Error("pas de cache");
    const blob = await res.blob();
    const headers = { "content-type": res.headers.get("content-type") || "application/pdf", "content-disposition": res.headers.get("content-disposition") || "inline" };
    await cache.delete(key);
    await cache.put(key, new Response(blob, { headers }));
    const keys = await cache.keys(); // ordre d'insertion : les plus anciens d'abord
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PDF))) await cache.delete(k);
    return new Response(blob, { headers });
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    return fetch(req);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/files/")) return event.respondWith(pdf(req));
  if (DATA_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) return event.respondWith(networkFirst(req, DATA));
  if (url.pathname === "/app.css" || ASSETS.includes(url.pathname)) return event.respondWith(networkFirst(req, SHELL));
  if (req.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html")) return event.respondWith(networkFirst(new Request("/"), SHELL));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Agenda DCG", {
    body: data.body || "",
    tag: data.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      await win.focus();
      win.postMessage({ type: "open", url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
