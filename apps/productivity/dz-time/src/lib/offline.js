/**
 * Offline layer: a per-user localStorage mirror of the Puter data plus a
 * queue of writes made while unreachable.
 *
 * The mirror stores raw JSON strings, so it needs no schema knowledge:
 *   hourly:cache:v1:user            { uuid, username }  (cache owner)
 *   hourly:cache:v1:<uuid>:kv:<key> raw KV value ('null' = known-missing)
 *   hourly:cache:v1:<uuid>:fs:<mo>  month-file text ('null' = known-missing)
 *   hourly:cache:v1:<uuid>:dirty    ["kv:hourly:settings:v1", "fs:2026-08"]
 *
 * Every value is whole-document (KV values and month files are written in
 * full), so the queue is just a dirty set: replaying a write sends the
 * *current* cached value, no operation log needed. Sync is
 * last-writer-wins per document, matching how concurrent devices already
 * behave online.
 *
 * Month files are capped to the newest MONTH_CAP; dirty months are never
 * evicted. All cache access is best-effort: without localStorage the app
 * simply behaves as before (online-only).
 */

const ROOT = 'hourly:cache:v1';
const META_KEY = `${ROOT}:user`;
const MONTH_CAP = 24;

let meta = null;
try {
  meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
  if (!meta?.uuid) meta = null;
} catch { meta = null; }

const ns = () => (meta ? `${ROOT}:${meta.uuid}` : null);

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function lsRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

function allCacheKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ROOT)) keys.push(k);
    }
  } catch {}
  return keys;
}

function readDirty() {
  const base = ns();
  if (!base) return [];
  try {
    const list = JSON.parse(lsGet(`${base}:dirty`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeDirty(list) {
  const base = ns();
  if (base) lsSet(`${base}:dirty`, JSON.stringify(list));
}

/** Drop the oldest cached, non-dirty month (true if one was evicted). */
function evictOldestMonth() {
  const base = ns();
  if (!base) return false;
  const dirty = new Set(readDirty());
  const months = allCacheKeys()
    .filter((k) => k.startsWith(`${base}:fs:`))
    .map((k) => k.slice(`${base}:fs:`.length))
    .filter((mo) => !dirty.has(`fs:${mo}`))
    .sort();
  if (!months.length) return false;
  lsRemove(`${base}:fs:${months[0]}`);
  return true;
}

function setWithEviction(key, value) {
  if (lsSet(key, value)) return true;
  // Quota: make room by dropping old months, oldest first.
  for (let i = 0; i < 6; i++) {
    if (!evictOldestMonth()) return false;
    if (lsSet(key, value)) return true;
  }
  return false;
}

export const offline = {
  /** The user this cache belongs to ({ uuid, username }) or null. */
  get user() {
    return meta;
  },

  hasCache() {
    return !!meta;
  },

  matches(user) {
    return !!(meta && user?.uuid && meta.uuid === user.uuid);
  },

  setUser(user) {
    if (!user?.uuid) return;
    meta = { uuid: user.uuid, username: user.username || '' };
    lsSet(META_KEY, JSON.stringify(meta));
  },

  /** Wipe everything (sign-out, or a different user signed in). */
  clearAll() {
    for (const k of allCacheKeys()) lsRemove(k);
    meta = null;
  },

  /* ---- KV mirror (raw JSON strings; 'null' = known-missing) ---- */

  /** Raw cached value, null for known-missing, undefined for cache miss. */
  getKV(key) {
    const base = ns();
    if (!base) return undefined;
    const raw = lsGet(`${base}:kv:${key}`);
    if (raw === null) return undefined;
    return raw === 'null' ? null : raw;
  },

  setKV(key, rawOrNull) {
    const base = ns();
    if (!base) return false;
    return setWithEviction(`${base}:kv:${key}`, rawOrNull ?? 'null');
  },

  /* ---- Month-file mirror ---- */

  getMonth(monthKey) {
    const base = ns();
    if (!base) return undefined;
    const raw = lsGet(`${base}:fs:${monthKey}`);
    if (raw === null) return undefined;
    return raw === 'null' ? null : raw;
  },

  setMonth(monthKey, textOrNull) {
    const base = ns();
    if (!base) return false;
    const ok = setWithEviction(`${base}:fs:${monthKey}`, textOrNull ?? 'null');
    if (ok) {
      const dirty = new Set(readDirty());
      // Never prune the month just written: a queued offline write is
      // only marked dirty after this returns, and evicting it here
      // would silently discard the sole copy of that data.
      const months = allCacheKeys()
        .filter((k) => k.startsWith(`${base}:fs:`))
        .map((k) => k.slice(`${base}:fs:`.length))
        .filter((mo) => mo !== monthKey && !dirty.has(`fs:${mo}`))
        .sort();
      while (months.length > MONTH_CAP) lsRemove(`${base}:fs:${months.shift()}`);
    }
    return ok;
  },

  /* ---- Dirty set (queued writes) ---- */

  isDirty(entry) {
    return readDirty().includes(entry);
  },

  markDirty(entry, { replace = false } = {}) {
    // Restoring a backup intentionally replaces an index. Keep that
    // intent through reloads and subsequent edits until it reaches the
    // server; ordinary offline additions should still merge on replay.
    if (replace && ns()) lsSet(`${ns()}:replace:${entry}`, 'true');
    const list = readDirty();
    if (!list.includes(entry)) {
      list.push(entry);
      writeDirty(list);
    }
  },

  isReplacement(entry) {
    return !!ns() && lsGet(`${ns()}:replace:${entry}`) === 'true';
  },

  clearDirty(entry) {
    if (ns()) lsRemove(`${ns()}:replace:${entry}`);
    const list = readDirty();
    const i = list.indexOf(entry);
    if (i !== -1) {
      list.splice(i, 1);
      writeDirty(list);
    }
  },

  dirtyList() {
    return readDirty();
  },

  pendingCount() {
    return readDirty().length;
  },

  /**
   * When the Puter SDK itself could not load (offline, uncached), install
   * a stand-in whose network calls all fail. The store's cache fallbacks
   * and write queue then serve the whole app from local data.
   */
  installStub() {
    const fail = () => Promise.reject(new TypeError('Offline: Puter is unreachable'));
    window.puter = {
      env: 'web',
      auth: {
        isSignedIn: () => true,
        getUser: () => Promise.resolve(meta ? { uuid: meta.uuid, username: meta.username } : null),
        signIn: fail,
        signOut: () => {},
      },
      kv: { get: fail, set: fail, del: fail },
      fs: { read: fail, write: fail, mkdir: fail, readdir: fail, delete: fail },
    };
  },
};

/** A transport-level failure (offline/unreachable) vs a real API error. */
export function isNetworkError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true; // fetch() rejects with TypeError on network failure
  const msg = String(err?.message ?? err?.error?.message ?? '').toLowerCase();
  return /network|failed to fetch|load failed|offline|unreachable|timed?\s?out|connection/.test(msg);
}
