/**
 * The store's gate to Puter KV, made offline-tolerant:
 *
 *   reads   — served from the cloud and mirrored locally; when the
 *             cloud is unreachable, the mirror answers instead, so the
 *             stockroom with no bars still browses its data.
 *   writes  — sent to the cloud; when unreachable, queued (latest value
 *             per key — each key holds a whole collection) and replayed
 *             on reconnect. Log entries carry their own timestamps in
 *             the values, so history stays truthful across the gap.
 *
 * Collection projections are last-write-wins. The store's immutable
 * operation journal preserves edits across sessions; a real API error
 * (not a network failure) still rejects so callers can react.
 *
 * `syncEvents` fires 'change' whenever the pending count moves, and
 * 'flushed' after a replay lands everything.
 */

import {
  cachePut, cacheGet, queuePut, queueGet, queueAll, queueClear, queueCount,
  clearOffline, getOwner, setOwner,
} from './offline.js';

export const syncEvents = new EventTarget();
let syncError = null;
export const lastSyncError = () => syncError;

let pending = 0;
let flushing = null;
let retryTimer = null;
let retryDelay = 4000;
const RETRY_MAX = 60000;

/**
 * Try the queue again soon, backing off up to a minute. The 'online'
 * event replays after a real offline stretch, but a write that died on
 * the wire while the browser still claimed to be online has no event
 * to wake it — without this, "Syncing 1 change…" would sit in the
 * banner until a reload.
 */
function scheduleRetry() {
  if (retryTimer || isOffline()) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flushQueue().catch(() => {});
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
}

/** Writes waiting for a connection (mirrored count, kept fresh). */
export function pendingWrites() {
  return pending;
}

async function refreshPending() {
  pending = await queueCount().catch(() => pending);
  syncEvents.dispatchEvent(new Event('change'));
}

/** Explicitly offline — not "unknown", which test and server runtimes are. */
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * A failure worth queueing over: the browser says offline, or the
 * request itself died on the wire. Anything else is a real error.
 */
const isNetworkError = (err) => isOffline() || err instanceof TypeError;

// KV values are JSON. Detach them at the persistence boundary so the
// memory fallback and delayed writes have the same snapshot semantics
// as IndexedDB and the server, even when callers mutate their objects.
const copyValue = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/** A safety copy must reach the cloud, not just the offline queue. */
export async function kvSetConfirmed(key, value) {
  if (isOffline()) throw new Error('Connect to save a safety snapshot');
  const before = await queueGet(key);
  await chainWrite(key, async () => {
    await puter.kv.set(key, copyValue(value));
    await cachePut(key, copyValue(value));
    const current = await queueGet(key);
    if (current && current.id === before?.id) await queueClear([key]);
    await refreshPending();
  });
}

/** Immutable operation entries, including changes still on this device. */
export async function kvList(prefix, knownRows = []) {
  const mirrorKey = `list:${prefix}`;
  let rows;
  try {
    if (isOffline()) throw new TypeError('Offline');
    const keys = await puter.kv.list(`${prefix}*`);
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) throw new Error('Invalid operation listing');
    const known = new Map(knownRows.map((row) => [row.key, row.value]));
    rows = await Promise.all(keys.map(async (key) => ({ key,
      value: known.get(key) ?? (await cacheGet(key))?.value ?? await kvGet(key),
    })));
    await cachePut(mirrorKey, rows);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await cacheGet(mirrorKey);
    if (!cached) throw err;
    rows = cached.value;
  }
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const row of await queueAll()) {
    if (!row.key.startsWith(prefix)) continue;
    if (row.del) byKey.delete(row.key);
    else byKey.set(row.key, { key: row.key, value: row.value });
  }
  return [...byKey.values()];
}

/* ---------- Reads ---------- */

export async function kvGet(key) {
  let value;
  try {
    value = await puter.kv.get(key);
  } catch (err) {
    // The mirror answers when the cloud can't; a queued local write is
    // newer than anything mirrored.
    const queued = await queueGet(key).catch(() => undefined);
    if (queued) return queued.del ? null : copyValue(queued.value);
    const cached = await cacheGet(key).catch(() => undefined);
    if (cached !== undefined) return copyValue(cached.value);
    throw err;
  }
  const queued = await queueGet(key).catch(() => undefined);
  if (queued) return queued.del ? null : copyValue(queued.value); // local is newer until flushed
  cachePut(key, value).catch(() => {});
  return copyValue(value);
}

/* ---------- Writes ---------- */

/**
 * Direct writes to one key go out one at a time, in call order. Two on
 * the wire at once can land on the server in either order — typing "12"
 * into a stocktake row fires a write per keystroke, and HTTP/2 happily
 * finishes the "12" before the "1" — leaving the cloud holding the
 * older value while the mirror shows the newer, a loss that surfaces
 * only on the next reload or another device.
 */
const writeChains = new Map();

function chainWrite(key, run) {
  const chain = writeChains.get(key) ?? { tail: Promise.resolve(), queuedId: null };
  const next = chain.tail.then(() => run(chain));
  // The stored tail never rejects, so one failed write can't poison
  // every write after it.
  const tail = next.catch(() => {});
  chain.tail = tail;
  writeChains.set(key, chain);
  tail.then(() => {
    if (chain.tail === tail) writeChains.delete(key);
  });
  return next;
}

// A preceding request in this chain can fail and queue itself after a
// later caller took its snapshot. That row is older too; an offline
// edit made in the meantime has a different id and remains protected.
const supersedes = (current, before, chain) => current
  && (current.id === before?.id || current.id === chain.queuedId);

export async function kvSet(key, value) {
  value = copyValue(value);
  // The mirror holds the local truth first: even if everything after
  // this fails, an offline reload still shows what the user just did.
  await cachePut(key, value).catch(() => {});
  // Queueing is local bookkeeping and must not wait behind a write
  // already on the wire — the in-flight write's own guards read the
  // queue to decide whether it has been superseded.
  if (isOffline()) {
    await queuePut(key, value);
    await refreshPending();
    return;
  }
  // Snapshot the queue row now, not at send time: any row queued after
  // this moment came from a later call and is newer than this value.
  // The snapshot travels with the write so the superseded checks below
  // compare against the right instant even when the send waited its
  // turn in the chain.
  const before = await queueGet(key).catch(() => undefined);
  return chainWrite(key, (chain) => sendSet(key, value, before, chain));
}

async function sendSet(key, value, before, chain) {
  try {
    await puter.kv.set(key, value);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // A request that hung before dying may be older than a value queued
    // for this key in the meantime; requeueing over that would replay
    // the stale value on reconnect. Queue this one only while the row
    // is absent or still the one seen before the write went out.
    const current = await queueGet(key).catch(() => undefined);
    if (!current || supersedes(current, before, chain)) {
      chain.queuedId = (await queuePut(key, value)).id;
    }
    await refreshPending();
    scheduleRetry();
    return;
  }
  // A direct write that landed supersedes any *older* queued value —
  // replaying it later would clobber this newer one. But a value that
  // went offline-queued mid-flight is newer than what just landed;
  // clearing it would lose that change entirely. Only the row seen
  // before the write went out is provably older.
  const current = await queueGet(key).catch(() => undefined);
  if (supersedes(current, before, chain)) await queueClear([key]).catch(() => {});
  else if (current) scheduleRetry();
  if (pending) await refreshPending();
}

export async function kvDel(key) {
  await cachePut(key, null).catch(() => {});
  if (isOffline()) {
    await queuePut(key, null, { del: true });
    await refreshPending();
    return;
  }
  const before = await queueGet(key).catch(() => undefined);
  return chainWrite(key, (chain) => sendDel(key, before, chain));
}

async function sendDel(key, before, chain) {
  try {
    await puter.kv.del?.(key);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Same guard as kvSet: never bury a value queued mid-flight.
    const current = await queueGet(key).catch(() => undefined);
    if (!current || supersedes(current, before, chain)) {
      chain.queuedId = (await queuePut(key, null, { del: true })).id;
    }
    await refreshPending();
    scheduleRetry();
    return;
  }
  // Same rule as kvSet: only clear the row this delete superseded, not
  // one queued while it was on the wire.
  const current = await queueGet(key).catch(() => undefined);
  if (supersedes(current, before, chain)) await queueClear([key]).catch(() => {});
  else if (current) scheduleRetry();
  if (pending) await refreshPending();
}

/* ---------- Replay ---------- */

/**
 * Push the queue to the cloud, oldest first. Stops quietly at the
 * first network failure (still offline). API rejections remain queued
 * for recovery while independent keys can still sync. Returns successes.
 */
export async function flushQueue() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    syncError = null;
    try {
      const rows = await queueAll();
      for (const row of rows) {
        // Replay shares the direct-write chain in both directions:
        // a save already in flight must finish before replay can start.
        const proceed = await chainWrite(row.key, async () => {
          // A preceding save may have superseded this queued snapshot.
          const queued = await queueGet(row.key);
          if (!queued || queued.id !== row.id) return true;
          try {
            if (row.del) await puter.kv.del?.(row.key);
            else await puter.kv.set(row.key, row.value);
          } catch (err) {
            if (isNetworkError(err)) return false;
            syncError = err;
            syncEvents.dispatchEvent(new Event('error'));
            return true;
          }
          // Keep any newer value queued while this replay was in flight.
          const current = await queueGet(row.key).catch(() => undefined);
          if (!current || current.id === row.id) await queueClear([row.key]);
          sent++;
          return true;
        });
        if (!proceed) break;
      }
    } finally {
      await refreshPending();
      flushing = null;
    }
    if (pending === 0) {
      retryDelay = 4000;
      clearTimeout(retryTimer);
      retryTimer = null;
    } else {
      scheduleRetry();
    }
    if (sent && pending === 0) syncEvents.dispatchEvent(new Event('flushed'));
    return sent;
  })();
  return flushing;
}

/** Prime the mirrored pending count (call once at boot). */
export async function initSync() {
  syncError = null;
  clearTimeout(retryTimer);
  retryTimer = null;
  await refreshPending();
}

/* ---------- Account scoping ---------- */

/** Where builds before the in-database marker kept the owner. */
const OWNER_KEY = 'inventory:mirror-owner';

/**
 * Bind the mirror and queue to the account that owns them. On a shared
 * browser, a different user signing in must not be shown the previous
 * user's mirrored data when a read falls back to the cache — or worse,
 * have the previous user's queued writes replayed into their account
 * by the boot-time flush. An unknown id (an offline boot, where
 * getUser can't answer) means "same as before": signing in as someone
 * else can't have happened without a connection.
 *
 * A wipe that fails rethrows and fails the boot: showing this account
 * the previous one's data is the worse outcome, and the marker stays
 * with the data so the next boot retries.
 */
export async function adoptAccount(userId) {
  const id = userId ? String(userId) : '';
  if (!id) return;
  let prev = await getOwner().catch(() => null);
  if (!prev) {
    try { prev = localStorage.getItem(OWNER_KEY); } catch {}
  }
  if (prev && prev !== id) {
    await clearOffline();
    await refreshPending();
  }
  await setOwner(id).catch(() => {});
  try { localStorage.removeItem(OWNER_KEY); } catch {}
}

/**
 * Forget the mirror on sign-out, so the next user starts clean. The
 * owner marker lives with the mirror and leaves with it; if the wipe
 * fails it stays put, and the next sign-in retries the wipe before
 * trusting anything left behind — which is why nothing here may remove
 * the marker on its own.
 */
export async function releaseAccount() {
  try {
    await clearOffline();
  } catch (err) {
    console.error('Sign-out could not clear the offline mirror', err);
  }
  try { localStorage.removeItem(OWNER_KEY); } catch {}
  await refreshPending();
}
