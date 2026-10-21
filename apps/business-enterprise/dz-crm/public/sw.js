/**
 * The service worker: what makes an installed copy launch with no network.
 *
 * The app ships a manifest and installs to a phone home screen, and it is
 * built to be used from one - but with no worker, a cold launch offline was
 * a blank page. Data is a separate problem, solved by the outbox and the
 * local copy it keeps (src/lib/outbox.js); this file is only about getting
 * the shell on screen.
 *
 * Deliberately no build-time manifest: the hashed asset names change every
 * build, and a hand-written list would rot silently. Instead the shell is
 * precached by its stable URLs, and everything else the app asks for is
 * cached the first time it is fetched, then served from cache and quietly
 * refreshed. So the first visit needs the network; every one after it
 * doesn't.
 *
 * What is never cached: Puter's own API. Auth and KV calls must fail fast
 * offline so the app's outbox takes over - a stale cached answer there
 * would be a lie about the user's data.
 */

const VERSION = 'v1';
const SHELL = `crm-shell-${VERSION}`;
const RUNTIME = `crm-runtime-${VERSION}`;

/* Stable URLs only. The hashed bundle is picked up at runtime. */
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './favicon.ico',
];

/** Puter's own services: never served from cache. */
const isPuterAPI = (url) => /(^|\.)puter\.(com|localhost)$/i.test(url.hostname)
  && !/^js\./i.test(url.hostname);

/** The SDK itself, from Puter's CDN: cacheable, and needed to boot at all. */
const isPuterSDK = (url) => /^js\.puter\.com$/i.test(url.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // One failure (a 404 on an icon) must not fail the whole install.
    await Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME]);
    for (const name of await caches.keys()) {
      if (name.startsWith('crm-') && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/** Cache a response worth keeping; opaque ones count (the CDN script). */
async function put(cacheName, request, response) {
  if (!response || (response.status !== 200 && response.type !== 'opaque')) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone()).catch(() => {});
}

/** Serve from cache, refresh in the background - fast, and offline-proof. */
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const fetching = fetch(request)
    .then(async (response) => {
      await put(cacheName, request, response);
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await fetching;
  return fresh || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isPuterAPI(url)) return;                    // let it fail, honestly

  // A navigation offline gets the cached shell: the app is a hash router,
  // so index.html is every route.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        await put(SHELL, request, fresh);
        return fresh;
      } catch {
        return (await caches.match(request))
          || (await caches.match('./index.html'))
          || (await caches.match('./'))
          || Response.error();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin || isPuterSDK(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
  }
});
