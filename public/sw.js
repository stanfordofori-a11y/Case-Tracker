// Service worker: makes the tracker installable and lets it open quickly.
// It never caches Supabase data: only this site's own files are handled, and
// pages are always fetched fresh when online so new versions appear at once.
const CACHE = "pat-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // Supabase etc. go straight to the network

  // Pages: network first, fall back to the last copy if offline
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CACHE);
        c.put("/", res.clone());
        return res;
      } catch {
        return (await caches.match("/")) || new Response("You're offline. Reconnect and try again.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // Built files have unique names per version, so they can be cached safely
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});
