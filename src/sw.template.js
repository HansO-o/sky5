// Generated into dist/sw.js by vite.config.ts. App-shell cache only; game data lives in IndexedDB.
const VERSION = "__VERSION__";
const SHELL = __SHELL__;
const CACHE = `shell-${VERSION}`;

// No skipWaiting(): a page still running the previous release lazy-loads chunks (Jolt, appearance,
// Babylon extensions) that only the previous shell cache holds, and activate deletes that cache. The new
// worker takes over once no tab of the old release is open.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The network copy is not written back: it may belong to a newer release than this worker's cache, and
// each shell cache must hold exactly one release (VERSION covers index.html and manifest.json, so a
// release that changes either installs a new worker with a fresh cache).
function networkFirst(req, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const fromCache = () =>
      caches.match(req, { ignoreSearch: true }).then((r) => {
        if (!done && r) {
          done = true;
          resolve(r);
        }
        return r;
      });
    const timer = setTimeout(fromCache, timeoutMs);
    fetch(req)
      .then((res) => {
        clearTimeout(timer);
        if (!done) {
          done = true;
          resolve(res);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then((r) => {
          if (!done) {
            done = true;
            resolve(r || new Response("offline", { status: 503 }));
          }
        });
      });
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // content-addressed game data: handled by the asset worker + IndexedDB
  if (/\/data\/[0-9a-f]{16}\.\w+$/.test(url.pathname)) return;
  // main.ts re-checking its manifest against the network (cache: "reload"): no timeout, no cached copy
  if (url.pathname.endsWith("/manifest.json") && e.request.cache === "reload") return;
  if (e.request.mode === "navigate" || url.pathname.endsWith("/manifest.json")) {
    // fresh when online (new releases), instant from cache when offline or slow
    e.respondWith(networkFirst(e.request, e.request.mode === "navigate" ? 1500 : 2500));
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && SHELL.some((s) => url.pathname.endsWith(s.replace(/^\.\//, "/")))) {
            const copy = res.clone(); // now: once res is handed to the page its body is in use
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});
