/* Hourly service worker: app-shell + runtime caching. */
const VERSION = 'hourly-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'];

/* Each deploy ships freshly hashed asset URLs while VERSION stays the
   same, so without a cap the runtime cache would keep every build's
   assets forever. A deploy needs only a handful of entries; trim the
   oldest beyond this. */
const RUNTIME_MAX = 40;

async function trimRuntimeCache() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - RUNTIME_MAX))) {
    await cache.delete(key);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Puter API calls, only the SDK script itself.
  const isPuterSdk = url.origin === 'https://js.puter.com';
  const isApi = url.hostname.startsWith('api.') || url.pathname.startsWith('/drivers');
  if (!isPuterSdk && url.origin !== self.location.origin) return;
  if (isApi) return;

  // Navigations: network-first so users get fresh HTML, cache fallback offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only a healthy HTML document may replace the offline shell;
          // an error page or a navigation to an asset must not.
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets + SDK: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy)).then(trimRuntimeCache);
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
