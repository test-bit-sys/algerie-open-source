/**
 * Local persistence for offline work: a mirror of the KV data the app
 * last saw ('cache') and the writes made while unreachable ('queue',
 * one row per key — each key holds a whole collection, so only the
 * latest value matters).
 *
 * IndexedDB when the platform has it and will open it; plain in-memory
 * Maps otherwise (tests, ancient browsers, private modes, a database
 * another tab is holding open) so callers never need to care. Storage
 * here is a convenience — the cloud is the record — so degrading to
 * memory for the session is always better than failing.
 */

const DB_NAME = 'inv-offline';
const DB_VERSION = 1;

/**
 * How long to wait for the database to open before giving up on it.
 * An open request can simply never answer: another tab holding the
 * previous version blocks an upgrade, and a wedged or deleting
 * database answers neither success nor error. Boot awaits this, so a
 * request that hangs is a blank screen with nothing on the console.
 */
const OPEN_TIMEOUT = 4000;

/* In-memory stand-ins when IndexedDB is missing or unusable. */
const memCache = new Map();
const memQueue = new Map();

let dbPromise = null;
let memoryOnly = typeof indexedDB === 'undefined';

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
      const timer = setTimeout(
        () => finish(reject, new Error('IndexedDB did not open in time')),
        OPEN_TIMEOUT,
      );
      const done = (fn, value) => { clearTimeout(timer); finish(fn, value); };

      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue');
      };
      req.onsuccess = () => {
        // A later version elsewhere will close this one out from under us.
        req.result.onversionchange = () => req.result.close();
        done(resolve, req.result);
      };
      req.onerror = () => done(reject, req.error || new Error('IndexedDB failed to open'));
      // Another tab is still holding the old version open, so the
      // upgrade can't proceed — without this the request just waits.
      req.onblocked = () => done(reject, new Error('IndexedDB is blocked by another tab'));
    }).catch((err) => {
      // One failure is enough: the rest of the session uses memory
      // rather than retrying a database that isn't going to answer.
      memoryOnly = true;
      console.error('Offline storage unavailable; keeping this session in memory', err);
      throw err;
    });
  }
  return dbPromise;
}

function tx(storeName, mode, run) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = run(t.objectStore(storeName));
    t.oncomplete = () => resolve(Array.isArray(req) ? req.map((r) => r?.result) : req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/**
 * One-time collapse to memory after the database failed mid-session
 * (quota pressure, a connection closed under us). Falling back one call
 * at a time would split the truth across two stores: a queued write
 * landing in memory while the count and the flush keep reading the
 * database is a write the banner denies and the replay never sends —
 * gone entirely on reload. Seed memory with everything the database
 * still yields, then let it answer alone.
 */
let degrading = null;

function degradeToMemory() {
  if (!degrading) {
    degrading = (async () => {
      try {
        const [keys, rows] = await tx('cache', 'readonly', (s) => [s.getAllKeys(), s.getAll()]);
        keys.forEach((key, i) => {
          // The owner marker is stored raw; data rows carry a wrapper.
          if (!memCache.has(key)) memCache.set(key, key === OWNER_ROW ? rows[i] : rows[i]?.value);
        });
      } catch { /* reads are failing too; memory starts from here */ }
      try {
        for (const row of (await tx('queue', 'readonly', (s) => s.getAll())) || []) {
          if (!memQueue.has(row.key)) memQueue.set(row.key, row);
        }
      } catch { /* same */ }
      memoryOnly = true;
      console.error('Offline storage failing; keeping the rest of this session in memory');
    })();
  }
  return degrading;
}

/** Run against IndexedDB, falling back to the in-memory stand-in. */
async function store(storeName, mode, run, fallback) {
  if (memoryOnly) {
    // Memory holds the record, but writes still shadow into the
    // database when one was ever there: puts that persist are rows the
    // next session recovers, and deletes keep a row the flush already
    // sent from replaying over something newer next boot.
    if (mode === 'readwrite' && dbPromise) tx(storeName, mode, run).catch(() => {});
    return fallback();
  }
  try {
    return await tx(storeName, mode, run);
  } catch {
    await degradeToMemory();
    return fallback();
  }
}

/* ---------- Cache: the last data the app saw, by KV key ---------- */

export async function cachePut(key, value) {
  await store('cache', 'readwrite',
    (s) => s.put({ value, at: Date.now() }, key),
    () => { memCache.set(key, value); });
}

/** { value } when the key was ever cached, undefined otherwise. */
export async function cacheGet(key) {
  const row = await store('cache', 'readonly',
    (s) => s.get(key),
    () => (memCache.has(key) ? { value: memCache.get(key) } : undefined));
  return row === undefined ? undefined : { value: row.value };
}

/* ---------- Queue: writes waiting for the connection ---------- */

/** Unique per queued write, so a replay can tell "the row I sent" from
 *  "a newer value queued for the same key while I was sending". */
let writeSeq = 0;
const writeId = () => `${Date.now().toString(36)}-${++writeSeq}-${Math.random().toString(36).slice(2, 8)}`;

export async function queuePut(key, value, { del = false } = {}) {
  const row = { key, value, del, at: Date.now(), id: writeId() };
  await store('queue', 'readwrite',
    (s) => s.put(row, key),
    () => { memQueue.set(key, row); });
  return row;
}

export async function queueGet(key) {
  return store('queue', 'readonly', (s) => s.get(key), () => memQueue.get(key));
}

/** Every queued write, oldest first. */
export async function queueAll() {
  const rows = await store('queue', 'readonly',
    (s) => s.getAll(),
    () => [...memQueue.values()]);
  return (rows || []).sort((a, b) => a.at - b.at);
}

export async function queueClear(keys) {
  await store('queue', 'readwrite',
    (s) => { for (const k of keys) s.delete(k); },
    () => { for (const k of keys) memQueue.delete(k); });
}

export async function queueCount() {
  const n = await store('queue', 'readonly', (s) => s.count(), () => memQueue.size);
  return n || 0;
}

/* ---------- Ownership ---------- */

/**
 * The account the mirror and queue belong to, kept in the same store as
 * the data it describes so the two can't drift apart: a browser that
 * persists the mirror persists the marker, one that can't persist
 * either loses both together. (localStorage held this once — blocked
 * localStorage next to a working IndexedDB let another account inherit
 * the data.) The key can't collide with mirrored rows: KV keys all
 * start with 'inv:'.
 */
const OWNER_ROW = '__mirror-owner__';

export async function getOwner() {
  const row = await store('cache', 'readonly',
    (s) => s.get(OWNER_ROW),
    () => memCache.get(OWNER_ROW));
  return typeof row === 'string' && row ? row : null;
}

export async function setOwner(id) {
  await store('cache', 'readwrite',
    (s) => s.put(String(id), OWNER_ROW),
    () => { memCache.set(OWNER_ROW, String(id)); });
}

/**
 * Drop the whole mirror and queue. The data in here belongs to one
 * account; a sign-out or an account switch must not leave it behind
 * for the next person on this browser.
 *
 * Unlike everything else here this *throws* when the stored rows
 * couldn't actually be removed: pretending a cross-account wipe
 * happened is how the next user ends up reading — or replaying — the
 * previous user's data. The queue clears before the cache because the
 * owner marker lives in the cache store: it has to be the last thing
 * out, so a partial failure leaves it naming the data's real owner and
 * the next boot retries the wipe.
 */
export async function clearOffline() {
  memCache.clear();
  memQueue.clear();
  try {
    await tx('queue', 'readwrite', (s) => s.clear());
    await tx('cache', 'readwrite', (s) => s.clear());
  } catch (err) {
    // A memory session couldn't wipe the disk, but couldn't leak it
    // either — rows that survive still carry the marker naming their
    // owner, so the next session that can write retries the wipe.
    // A working database failing to clear is a real failure the
    // caller must not paper over.
    if (!memoryOnly) throw err;
  }
}

/** Test hook: drop the in-memory fallback state between cases. */
export function __resetMemoryState() {
  memCache.clear();
  memQueue.clear();
}
