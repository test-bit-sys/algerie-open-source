# Service worker: launch offline and complete the PWA story

Labels: enhancement, offline, pwa
Priority: P2
Status: Implemented

## Problem

The app has a manifest, icons, and iOS meta tags (`index.html`,
`public/manifest.webmanifest`) and carefully handles offline *data* — a
localStorage mirror, dirty-write flushing, an offline banner. But there is
no service worker anywhere in the project, so the app *shell* cannot load
offline: an installed PWA or a browser tab opened without a connection
gets a network error (or the explicit "Could not reach Puter" screen from
`src/main.js`, since the Puter SDK loads from `https://js.puter.com`).
All the offline plumbing exists, yet the one scenario it's for — opening
your tasks with no signal — fails at the front door. Chromium also gates
installability on a fetch-handling service worker.

## Proposal

- Add a small hand-rolled service worker (no workbox needed at this size):
  precache the built shell (HTML/JS/CSS/icons) at install,
  stale-while-revalidate for same-origin assets, cache-first with
  background refresh for the Puter SDK script.
- Offline boot path in `main.js`: when the SDK is unreachable but a
  localStorage mirror exists, start read-write against the mirror instead
  of showing the error screen — the store already queues failed writes and
  flushes them on `online`, so this mostly means not bailing out early.
- Version the cache from the build hash; show the existing toast pattern
  ("Updated — reload for the latest version") when a new worker activates.
- Keep the shared-list viewer route working offline-gracefully (it
  genuinely needs the network; show its existing error state, not a
  broken page).

## Acceptance criteria

- Airplane mode, previously visited: the app opens, shows the mirror's
  data, accepts adds/edits/completes, and syncs them once back online.
- Lighthouse "installable" passes; installed-PWA launch works offline.
- A deploy never leaves users stuck on stale assets (worker updates on
  next load; reload prompt shown once).
- The dev mock (`dev/mock.html`) and `npm run dev` remain unaffected
  (register the worker in production builds only).

## Out of scope

- Background sync / push (browser support is too uneven; the `online`
  listener already covers the common case).
- Offline sign-in for accounts that never loaded data on the device.
