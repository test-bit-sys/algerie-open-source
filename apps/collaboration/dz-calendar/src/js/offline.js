/**
 * Offline mode: a write-gate over the store plus a small connectivity
 * controller. Together they enforce the one rule that keeps offline support
 * from ever creating sync issues:
 *
 *   While offline the calendar is READ-ONLY. No data write is ever performed,
 *   queued, or replayed — so the cloud (puter.kv) stays the single source of
 *   truth and there is nothing to reconcile on reconnect.
 *
 * `gate(store)` returns a proxy with the store's exact method surface:
 *   - reads + subscribe → delegate straight through;
 *   - data mutators → while offline, block BEFORE the store mutates anything
 *     (the store updates memory + re-renders synchronously before awaiting the
 *     network, so a late failure isn't enough), show one friendly toast, snap
 *     the UI back to its canonical state, and reject with OfflineWriteError;
 *   - saveSettings → always delegate so preference/appearance changes still take
 *     effect locally, but swallow the persist rejection (a non-persisted
 *     preference is harmless and sync-safe; last-write-wins on one key).
 *
 * Connectivity is an explicit `blocked` flag, NOT a live read of
 * navigator.onLine: reconnect only clears it AFTER a real cloud read succeeds,
 * so a flapping/"lie" online signal can never route a write into a dead network.
 */
import { el } from './dom.js';

export class OfflineWriteError extends Error {
  constructor() {
    super('Offline: writes are disabled until you reconnect.');
    this.name = 'OfflineWriteError';
  }
}

export function isOfflineError(err) {
  return err instanceof OfflineWriteError;
}

const OFFLINE_MSG = "You're offline — reconnect to make changes";
const TOAST_THROTTLE_MS = 3000;
const RECONNECT_POLL_MS = 8000;

// The 15 store methods that change calendar data. saveSettings is handled
// separately (it may still apply locally); everything else is a read.
const DATA_MUTATORS = new Set([
  'saveEvent',
  'deleteEvent',
  'importEvents',
  'updateOccurrence',
  'deleteOccurrence',
  'updateSeries',
  'updateFuture',
  'deleteFuture',
  'applyOutOfOffice',
  'setDeclined',
  'rsvpEvent',
  'applyRsvpResponses',
  'saveTask',
  'toggleTask',
  'deleteTask',
]);

// Module-level so the editor opener (modal.js) can consult it
// without a reference to the controller instance, which main.js creates later.
let blocked = false;

/** True while the calendar is in read-only offline mode. */
export function isBlocked() {
  return blocked;
}

/**
 * @param {{
 *   toast: (msg: string, opts?: object) => void,
 *   onReconnectRefresh: () => Promise<boolean>, // resolves true when the cloud is reachable again
 * }} deps
 */
export function createOffline({ toast, onReconnectRefresh }) {
  let render = null;
  let refreshing = false;
  let lastToastAt = 0;
  let banner = null;
  let pollTimer = null;

  function showBanner() {
    if (!banner) {
      banner = el('div', { class: 'offline-banner', role: 'status', 'aria-live': 'polite' }, [
        el('span', { class: 'offline-banner__dot', 'aria-hidden': 'true' }),
        el('span', { text: 'Offline — showing your last synced calendar' }),
      ]);
      document.body.append(banner);
    }
    document.documentElement.classList.add('is-offline');
  }

  function hideBanner() {
    document.documentElement.classList.remove('is-offline');
    if (banner) {
      banner.remove();
      banner = null;
    }
  }

  function setBlocked(next) {
    blocked = next;
    if (next) showBanner();
    else hideBanner();
  }

  /** Called when a write is refused offline: nudge the user (throttled) and
   *  re-render so any optimistic gesture (a mid-drag element) snaps back. */
  function onBlockedWrite() {
    const now = Date.now();
    if (now - lastToastAt > TOAST_THROTTLE_MS) {
      lastToastAt = now;
      toast(OFFLINE_MSG);
    }
    if (render) {
      try {
        render();
      } catch {
        /* a render failure must not mask the offline notice */
      }
    }
  }

  /** Don't reconnect-refresh while the user is mid-interaction: a refresh
   *  re-renders and would drop focus or tear an overlay. Retry on the next tick.
   *  The context menu counts too — render() closes it unconditionally, so a
   *  background reconnect would yank it out from under the pointer (the app's
   *  own minute-tick skips renders for exactly this reason). */
  function isBusy() {
    if (document.querySelector('.modal-scrim, .dialog-scrim, .ctx-menu')) return true;
    const active = document.activeElement;
    const tag = ((active && active.tagName) || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  async function tryReconnect() {
    if (!blocked || refreshing) return;
    // Only probe when the browser thinks there's a connection, and only when
    // idle. The actual unblock still depends on the probe truly succeeding.
    if (!navigator.onLine || isBusy()) return;
    refreshing = true;
    try {
      const ok = await onReconnectRefresh();
      if (ok) setBlocked(false);
    } catch {
      /* still unreachable — stay offline, we'll try again */
    } finally {
      refreshing = false;
    }
  }

  window.addEventListener('offline', () => setBlocked(true));
  window.addEventListener('online', () => tryReconnect());

  // A cheap heartbeat covers the cases the events miss: an `online` that fired
  // while the user was busy, connectivity that returns without an event, and
  // flapping. It's a no-op unless we're blocked AND the browser reports online.
  pollTimer = setInterval(tryReconnect, RECONNECT_POLL_MS);

  // Fire-and-forget writers (drag, toggle, color filter) have no `.catch`; keep
  // their intentional offline rejections out of the console. Narrow by type so
  // real bugs still surface.
  window.addEventListener('unhandledrejection', (event) => {
    if (isOfflineError(event.reason)) event.preventDefault();
  });

  function gate(store) {
    const proxy = {};
    for (const key of Object.keys(store)) {
      const value = store[key];
      if (typeof value !== 'function') {
        proxy[key] = value;
      } else if (DATA_MUTATORS.has(key)) {
        proxy[key] = (...args) => {
          if (blocked) {
            onBlockedWrite();
            return Promise.reject(new OfflineWriteError());
          }
          return value.apply(store, args);
        };
      } else if (key === 'saveSettings') {
        // Apply locally regardless; a failed persist is non-critical and never
        // surfaces as an error (this is also strictly safer than today online).
        proxy[key] = (...args) => Promise.resolve(value.apply(store, args)).catch(() => {});
      } else {
        proxy[key] = (...args) => value.apply(store, args);
      }
    }
    return proxy;
  }

  return {
    gate,
    /** Late-bind the app's render so a blocked write can restore canonical UI. */
    bindRender(fn) {
      render = fn;
    },
    /** Set the initial connectivity determined at boot. */
    start({ online }) {
      setBlocked(!online);
    },
    isBlocked,
    stop() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },
  };
}

/**
 * Render the "you're offline" screen shown when we can't reach the cloud AND
 * have no cached calendar to show. Mirrors main.js's error/sign-in screens.
 */
export function renderOfflineScreen(root, { onRetry } = {}) {
  root.replaceChildren();
  root.removeAttribute('aria-busy');
  const retry = el('button', {
    class: 'btn btn--primary btn--block',
    type: 'button',
    text: 'Retry',
  });
  if (onRetry) retry.addEventListener('click', () => onRetry());
  root.append(
    el('div', { class: 'screen' }, [
      el('div', { class: 'auth-card' }, [
        el('img', {
          class: 'auth-card__logo',
          src: '/icon-192.png',
          alt: 'Calendar',
          width: '56',
          height: '56',
        }),
        el('h1', { class: 'auth-card__title', text: "You're offline" }),
        el('p', {
          class: 'auth-card__sub',
          text: 'Reconnect to load your calendar. Your events are safe in your Puter storage.',
        }),
        retry,
      ]),
    ]),
  );
}
