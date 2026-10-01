/* Build-time placeholders are filled by the Web build. Do not publish this
   template directly: every app asset must be precached for offline use. */
const APP_VERSION = "__APP_VERSION__";
const PRECACHE_ASSETS = __PRECACHE_ASSETS__;
const APP_SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `canada-pay-${encodeURIComponent(APP_SCOPE.pathname)}-`;
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;
const INDEX_URL = new URL("index.html", APP_SCOPE).href;
const PRECACHE_URLS = PRECACHE_ASSETS.map(path => new URL(path, APP_SCOPE).href);
const PRECACHE_SET = new Set(PRECACHE_URLS);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
  // A returning user's current version keeps running until they choose Update.
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== APP_SCOPE.origin
      || !url.pathname.startsWith(APP_SCOPE.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }

  // Only bundled app resources are eligible. Government reference links and
  // other external requests are never intercepted or cached.
  const isHashedAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|png|svg|webp)$/.test(url.pathname);
  if (PRECACHE_SET.has(url.href) || isHashedAsset) {
    event.respondWith(assetResponse(request));
  }
});

async function assetResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type !== "opaque") await cache.put(request, response.clone());
  return response;
}

async function navigationResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
      await cache.put(INDEX_URL, response.clone());
      return response;
    }
    const cached = await cache.match(INDEX_URL);
    return cached || response;
  } catch {
    const cached = await cache.match(INDEX_URL);
    if (cached) return cached;
    return new Response("Canada Pay Calculator needs an internet connection for its first visit. Reconnect and reload.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
