// Patrol offline: cache-first (with background refresh) for static files, network-first for the run JSON,
// never touch /report, /health, /api/assignments. Bump CACHE after changing what the page loads.
const CACHE = "patrol-v2";
const CORE = [
  "./", "./manifest.webmanifest", "./icon.svg", "./maplibre-gl-worker.mjs",
  "../vendor/maplibre-gl.mjs", "../vendor/maplibre-gl-shared.mjs", "../vendor/maplibre-gl-worker.mjs",
  "../vendor/maplibre-gl.css", "../vendor/pmtiles.js", "../vendor/basemaps.js", "../basemap/basemap.js",
  "../../app/tokens.css", "../../app/fonts.css",
];

const never = u => /\/(report|health)$/.test(u.pathname) || u.pathname.endsWith("/api/assignments");
const isRun = u => u.pathname.endsWith(".json") || u.pathname.includes("/api/run/") || u.pathname.endsWith("/story");

async function put(key, res) {
  if (res && res.status === 200) { const c = await caches.open(CACHE); await c.put(key, res.clone()); }
  return res;
}

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(p => c.add(p).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("patrol-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// The first open is not controlled yet: the page sends what it already loaded (performance entries) to be cached.
self.addEventListener("message", e => {
  const urls = (e.data && e.data.cache) || [];
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(urls.map(async s => {
    try {
      const u = new URL(s);
      if (never(u) || !/^https?:$/.test(u.protocol)) return;
      const key = u.origin === location.origin && u.pathname.endsWith("/patrol/") ? u.origin + u.pathname : s;
      if (await c.match(key)) return;
      await put(key, await fetch(s));
    } catch {}
  }))));
});

self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || never(u) || !/^https?:$/.test(u.protocol)) return;   // network only, untouched
  if (isRun(u)) {            // network-first, cache fallback (5 s timeout: no coverage often means hanging, not failing)
    e.respondWith(fetch(req, { signal: AbortSignal.timeout(5000) }).then(r => put(req, r))
      .catch(() => caches.match(req).then(r => r || Response.error())));
    return;
  }
  if (u.origin !== location.origin) return;
  const range = req.headers.get("range");
  if (range) {   // pmtiles reads byte ranges: slice the cached whole file (offline), else the network (a 206 is never cached)
    e.respondWith(caches.match(req).then(async hit => {
      const m = hit && hit.status === 200 && /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m) return fetch(req);
      const buf = await hit.arrayBuffer(), a = +m[1], b = Math.min(m[2] ? +m[2] : Infinity, buf.byteLength - 1);
      return new Response(buf.slice(a, b + 1), { status: 206, headers: { "Content-Type": hit.headers.get("Content-Type") || "application/octet-stream",
        "Content-Range": `bytes ${a}-${b}/${buf.byteLength}`, "Content-Length": String(b - a + 1) } });
    }));
    return;
  }
  const nav = req.mode === "navigate";
  const key = nav ? u.origin + u.pathname : req;   // the page is cached once, whatever ?team=&api= it was opened with
  e.respondWith(caches.match(key).then(hit => {
    const net = fetch(req).then(r => put(key, r));
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }   // cache-first, refresh in background
    return net.catch(() => nav ? caches.match("./").then(r => r || Response.error()) : Response.error());
  }));
});
