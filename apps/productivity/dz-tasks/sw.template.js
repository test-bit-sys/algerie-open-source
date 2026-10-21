/**
 * Service worker TEMPLATE — not served as-is. The build (vite.config.js)
 * fills in the version and precache placeholders below and emits the
 * result as dist/sw.js. Registered by src/main.js in production only.
 *
 * Strategy: precache the app shell at install; serve navigations from the
 * cached shell (hash-routing means every route is index.html); cache-first
 * for same-origin static assets (they carry content hashes); and
 * stale-while-revalidate for the Puter SDK script so the app can boot
 * offline. Everything else — Puter API calls, share snapshot fetches —
 * goes straight to the network.
 */

const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const CACHE = `tasks-${VERSION}`;
const SDK_HOST = 'js.puter.com';
/* The SDK lives outside the versioned cache: it isn't part of a deploy,
   and keeping it in `CACHE` meant every update's activate step deleted
   the only copy — an update followed by an offline launch then booted
   into the degraded shim instead of the real app. */
const SDK_CACHE = 'tasks-sdk';
/* How long a cached SDK copy is trusted before a background re-fetch.
   The no-cors response is opaque — indistinguishable from a captive
   portal's login page — so a known-good copy is not overwritten on
   every fetch; once a day bounds both staleness and the poisoning
   window. */
const SDK_TTL = 24 * 60 * 60 * 1000;

/* Cache lookups must ignore Vary: the page requests scripts/styles with
   crossorigin (an Origin header) while precaching fetched them without,
   and a `Vary: Origin` response would never match otherwise. */
const MATCH = { ignoreVary: true, ignoreSearch: false };

self.addEventListener('install', (event) => {
  // No skipWaiting here: updates wait until the user opts in (message
  // below), so an active session is never yanked mid-use. cache: 'reload'
  // bypasses the HTTP cache — a fresh worker must precache the deploy it
  // shipped with, not whatever max-age copy the browser still holds.
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter((k) => k !== CACHE && k !== SDK_CACHE);
    // Migrate an SDK copy a previous version kept in its versioned cache
    // before deleting it — otherwise the first update after this deploy
    // would still open the offline gap it is meant to close.
    const sdk = await caches.open(SDK_CACHE);
    for (const k of old) {
      const cache = await caches.open(k);
      for (const req of await cache.keys()) {
        if (new URL(req.url).hostname !== SDK_HOST) continue;
        if (await sdk.match(req, MATCH)) continue;
        const res = await cache.match(req, MATCH);
        if (res) await sdk.put(req, res);
      }
    }
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Reminders fall back to registration.showNotification() on platforms
// where `new Notification()` throws (see src/lib/reminders.js); clicking
// one focuses the app rather than doing nothing.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => 'focus' in c);
      return client ? client.focus() : self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The Puter SDK: serve the cached copy immediately; re-fetch it in the
  // background only once the copy is older than SDK_TTL. With nothing
  // cached yet, even an unverifiable opaque copy beats no SDK at all.
  if (url.hostname === SDK_HOST) {
    const stampReq = new Request(`${req.url}${req.url.includes('?') ? '&' : '?'}__sw_fetched_at__`);
    const refresh = (cache) => fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        return cache.put(req, res.clone())
          .then(() => cache.put(stampReq, new Response(String(Date.now()))))
          .then(() => res);
      }
      return res;
    });
    event.respondWith(caches.open(SDK_CACHE).then(async (cache) => {
      const cached = await cache.match(req, MATCH);
      if (!cached) return refresh(cache).catch(() => Response.error());
      const stamp = await cache.match(stampReq, MATCH);
      const fetchedAt = stamp ? Number(await stamp.text()) : 0;
      if (Date.now() - fetchedAt >= SDK_TTL) {
        event.waitUntil(refresh(cache).catch(() => {}));
      }
      return cached;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // App-shell: every navigation is the (hash-routed) index page, cached
  // under './' at install time.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./', { ...MATCH, ignoreSearch: true })
        .then((cached) => cached || fetch(req))
    );
    return;
  }

  // Static assets are content-hashed: cache-first, fill on miss.
  event.respondWith(
    caches.match(req, MATCH).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});
