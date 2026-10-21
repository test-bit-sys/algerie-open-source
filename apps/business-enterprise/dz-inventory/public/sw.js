/**
 * Service worker: the app shell loads with no connection at all.
 *
 * Strategy, deliberately simple:
 *   - navigations: network-first, falling back to the cached shell —
 *     updates flow when online, the stockroom basement still opens the
 *     app when not;
 *   - same-origin assets and the Puter SDK script: stale-while-
 *     revalidate — served instantly from cache, refreshed behind;
 *   - everything else (the Puter API itself): untouched. Data offline
 *     is the app's own IndexedDB mirror's job, not a cache's.
 *
 * Bump the version to retire old caches on deploy.
 */

const CACHE = 'inv-shell-v5';

/** The one cross-origin URL worth caching: the Puter SDK bundle. */
const SDK_URL = 'https://js.puter.com/v2/';

const PRECACHE = [
  './',
  './manifest.json',
  // Every icon the manifest or the shell head points at: the page never
  // fetches most of these itself, so the runtime cache can't backfill
  // them — without precaching, an offline launch of the installed app
  // draws a blank splash icon and offline tabs lose their favicon.
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.ico',
  './favicon-32x32.png',
  './favicon-16x16.png',
  SDK_URL,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Each URL alone: one blocked icon must not void the whole shell.
    // The SDK is cross-origin with no CORS headers, so it has to be
    // fetched no-cors (an opaque response caches fine).
    await Promise.allSettled(PRECACHE.map((url) => {
      const request = new URL(url, self.location.href).origin === self.location.origin
        ? url
        : new Request(url, { mode: 'no-cors' });
      return cache.add(request);
    }));
    // The shell references hashed JS/CSS bundles the page fetched
    // before this worker controlled anything, so nothing else caches
    // them on the first visit: visit once, go offline, and the cached
    // HTML's only script would 404 — a splash that pulses forever.
    // Read them out of the cached shell and bring them in now.
    try {
      const shell = await cache.match('./');
      if (shell) {
        const html = await shell.clone().text();
        const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
        await Promise.allSettled(assets.map((url) => cache.add(url)));
      }
    } catch {
      // Best-effort: online visits keep working either way, and the
      // runtime cache fills the same slots as pages use them.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event));
    return;
  }
  // The SDK by exact URL, not by origin: anything else on that host is
  // someone else's script, and an opaque response can't be checked.
  if (url.origin === self.location.origin || request.url === SDK_URL) {
    event.respondWith(staleWhileRevalidate(event));
  }
  // Anything else — the Puter API above all — goes straight through.
});

/** The paths that really are the app shell — nothing else may become it. */
const SHELL_PATHS = new Set([
  new URL('./', self.location.href).pathname,
  new URL('./index.html', self.location.href).pathname,
]);

/** How long a navigation waits on the network when a cached shell
 *  could answer instead. Long enough for a normal page load; far
 *  shorter than a stalling connection's own timeout. */
const NAV_TIMEOUT = 3500;

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('navigation timed out')), ms)),
]);

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  // Public articles must retain their own document when offline.
  const isShell = SHELL_PATHS.has(new URL(request.url).pathname);
  const cached = isShell
    ? (await cache.match('./')) || (await cache.match(request))
    : await cache.match(request);
  const pending = fetch(request).then(async (fresh) => {
    // Only app navigations refresh the shell; articles cache by URL.
    // This also runs when a timeout has already answered from cache.
    if (fresh.ok) {
      await cache.put(isShell ? './' : request, fresh.clone());
    }
    return fresh;
  });
  // Once the timeout answers from cache, nothing else holds the worker
  // alive — without this the browser may shut it down and abort the
  // very fetch that was going to refresh the shell.
  event.waitUntil(pending.catch(() => {}));
  try {
    // On lie-fi a navigation can hang for the browser's full timeout
    // while a perfectly good shell sits in cache: give the network a
    // few seconds, then open from cache. With nothing cached, wait the
    // network out — an aborted first load helps nobody.
    return await (cached ? withTimeout(pending, NAV_TIMEOUT) : pending);
  } catch {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (fresh) => {
      // An opaque response (the no-cors SDK script) reports status 0
      // whether it succeeded or 404'd, so it may fill an empty slot but
      // never replace a copy known to work — one bad fetch would
      // otherwise leave a broken SDK cached until the version is bumped.
      const usable = fresh.ok || (fresh.type === 'opaque' && !cached);
      if (usable) await cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => undefined);
  // The cached copy answers immediately; keep the worker alive until
  // the revalidation actually lands rather than letting it be killed.
  event.waitUntil(refresh);
  return cached || (await refresh) || Response.error();
}
