// Generated into dist/sw.js by vite.config.ts. App-shell cache only; game data lives in IndexedDB.
const VERSION = "__VERSION__";
const SHELL = __SHELL__;
const CACHE = `shell-${VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

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
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
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
          if (res.ok && SHELL.some((s) => url.pathname.endsWith(s.replace(/^\.\//, "/")))) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        }),
    ),
  );
});
