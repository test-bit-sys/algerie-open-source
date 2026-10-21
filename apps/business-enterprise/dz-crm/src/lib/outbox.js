/**
 * The write outbox: what makes this app usable with no connection.
 *
 * Every mutation used to go straight to KV. The store applied it in memory
 * and emitted, so the UI showed it - then the write rejected and the form
 * said "Couldn't save. Check your connection". The record was on screen
 * and gone on reload. Logging a call the minute you walk out of the
 * meeting is the single habit that makes a CRM work, and it is exactly
 * where the connection is worst.
 *
 * So each collection keeps a durable local copy, and a write that can't
 * reach KV is queued instead of lost:
 *
 *   snap:<kvKey>  { payload, base }   payload = newest local truth (what a
 *                                    cold start reads), base = the value
 *                                    KV last had, for conflict detection
 *   out:<kvKey>   { payload, at, conflict }   a write still owed to KV
 *
 * One entry per key, because the store writes whole collections: the
 * newest local copy is the write, and last-writer-wins is the honest
 * default. What must never happen is losing someone *else's* work
 * silently - so a queued write only lands if KV still holds the value we
 * based it on, and otherwise it waits for the user to choose.
 *
 * Storage is injected, so the policy here is testable without IndexedDB.
 */

const SNAP = 'snap:';
const OUT = 'out:';

/** Everything KV values are compared as: the exact string that was stored. */
export function payloadString(raw) {
  if (raw === null || raw === undefined) return null;
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

/** In-memory storage: the test double, and the fallback where IndexedDB isn't. */
export function memoryStorage() {
  const map = new Map();
  return {
    durable: false,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, value); },
    async del(key) { map.delete(key); },
    async entries(prefix) {
      return [...map.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key: key.slice(prefix.length), value }));
    },
  };
}

/**
 * IndexedDB-backed storage - one object store, string keys, plain values.
 * Falls back to memory when IndexedDB is missing or refuses to open (a
 * private window, a browser with site data blocked): the app keeps
 * working, it just can't promise durability, and `durable` says so.
 */
export function idbStorage(name = 'crm-offline', storeName = 'kv') {
  if (typeof indexedDB === 'undefined') return memoryStorage();

  let open = null;
  const db = () => {
    open ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const conn = request.result;
        if (!conn.objectStoreNames.contains(storeName)) conn.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('idb-blocked'));
    }).catch((err) => { open = null; throw err; });
    return open;
  };

  const run = (mode, work) => db().then((conn) => new Promise((resolve, reject) => {
    const tx = conn.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));
    tx.onabort = () => reject(tx.error);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  }));

  return {
    durable: true,
    async get(key) {
      const value = await run('readonly', (s) => s.get(key));
      return value === undefined ? null : value;
    },
    set(key, value) { return run('readwrite', (s) => s.put(value, key)).then(() => {}); },
    del(key) { return run('readwrite', (s) => s.delete(key)).then(() => {}); },
    async entries(prefix) {
      const keys = await run('readonly', (s) => s.getAllKeys());
      const wanted = keys.filter((key) => typeof key === 'string' && key.startsWith(prefix));
      const values = await Promise.all(wanted.map((key) => this.get(key)));
      return wanted.map((key, i) => ({ key: key.slice(prefix.length), value: values[i] }));
    },
  };
}

/**
 * The outbox over a storage. `kv` is the remote ({ get, set }); `now`
 * exists so tests don't depend on the clock.
 */
export function createOutbox({ storage, kv, now = () => Date.now() } = {}) {
  const store = storage || memoryStorage();
  /** Keys whose write is owed to KV, so a caller can ask without a read. */
  const queued = new Set();
  /**
   * Keys with a write staged that KV has not yet answered for. A read that
   * lands in that window is about the value KV had *before* the write,
   * and must not be mirrored over it - see mirror.
   */
  const staged = new Set();
  let loaded = null;

  const readSnap = async (key) => (await store.get(SNAP + key)) || { payload: null, base: null };

  /** Learn what is already queued, so the app knows its state at boot. */
  async function ready() {
    loaded ??= (async () => {
      for (const { key } of await store.entries(OUT)) queued.add(key);
    })();
    await loaded;
    return queued.size;
  }

  /** After a successful read: KV's value is both the local truth and the base. */
  async function mirror(key, raw) {
    // A pending local edit outranks a read - queued, or staged and still
    // waiting on KV's answer. The store refreshes on every return to the
    // tab, and a read that started before a save and answered after it
    // was writing the value KV used to hold over the one just staged.
    if (queued.has(key) || staged.has(key)) return;
    const payload = payloadString(raw);
    await store.set(SNAP + key, { payload, base: payload, at: now() });
  }

  /** The value a cold start should read for this key, or null. */
  async function localValue(key) {
    const snap = await readSnap(key);
    return snap.payload;
  }

  /** Is there anything at all to boot from? */
  async function hasLocalData() {
    const snaps = await store.entries(SNAP);
    return snaps.some((s) => s.value?.payload);
  }

  /** A local write, before KV has been asked: durable immediately. */
  async function stage(key, payload) {
    staged.add(key);
    const snap = await readSnap(key);
    await store.set(SNAP + key, { payload, base: snap.base, at: now() });
  }

  /** KV took the write: it is the new base, and nothing is owed. */
  async function confirm(key, payload) {
    staged.delete(key);
    await store.set(SNAP + key, { payload, base: payload, at: now() });
    if (queued.delete(key)) await store.del(OUT + key);
  }

  /**
   * KV has just taken `landed` from this device. Usually that settles the
   * key; but a replay is a write in flight like any other, and this device
   * kept working while it was out. If the local truth has moved on since -
   * a newer edit staged, or one that already landed on its own - then KV
   * now holds the older copy, and treating that as settled would throw the
   * newer one away: dropped from the queue, and then read back over what
   * is on screen by the next refresh. So `landed` becomes the base, and
   * the newer copy is owed again.
   *
   * Returns whether the key is fully settled.
   */
  async function settle(key, landed) {
    const snap = await readSnap(key);
    if (snap.payload === null || snap.payload === landed) {
      await confirm(key, landed);
      return true;
    }
    await store.set(SNAP + key, { payload: snap.payload, base: landed, at: now() });
    await store.set(OUT + key, { payload: snap.payload, at: now(), conflict: false });
    queued.add(key);
    return false;
  }

  /** KV refused the write: owe it. One entry per key - the newest wins. */
  async function queue(key, payload) {
    await store.set(OUT + key, { payload, at: now(), conflict: false });
    queued.add(key);
  }

  /** What is still owed, oldest first - the order it will be replayed in. */
  async function pending() {
    const rows = await store.entries(OUT);
    return rows
      .filter((row) => row.value)
      .map((row) => ({ key: row.key, at: row.value.at || 0, conflict: !!row.value.conflict }))
      .sort((a, b) => a.at - b.at);
  }

  const hasPending = () => queued.size > 0;
  const pendingCount = () => queued.size;

  /**
   * Replay what is owed, oldest first.
   *
   * A write lands only if KV still holds the value it was based on. If KV
   * has moved on - another device wrote while this one was offline - the
   * entry is marked as a conflict and left alone: whole-collection writes
   * mean landing it would erase that other work, and this app would rather
   * ask than choose.
   *
   *   { synced: [key], conflicts: [key], failed: [key] }
   */
  async function flush() {
    await ready();
    const result = { synced: [], conflicts: [], failed: [] };
    for (const { key } of await pending()) {
      let outcome = await replay(key);
      // The device wrote again while the replay was out, so the key is
      // owed once more (see settle). Go straight back for it rather than
      // leave "1 waiting to sync" standing on a live connection until the
      // next return to the tab.
      if (outcome === 'again') outcome = await replay(key);
      if (outcome === 'synced' || outcome === 'again') result.synced.push(key);
      else if (outcome === 'conflict') result.conflicts.push(key);
      else if (outcome === 'failed') result.failed.push(key);
    }
    return result;
  }

  /** One key's replay: 'synced' | 'again' | 'conflict' | 'failed' | 'gone'. */
  async function replay(key) {
    const entry = await store.get(OUT + key);
    if (!entry) { queued.delete(key); return 'gone'; }
    const snap = await readSnap(key);
    let remote;
    try {
      remote = payloadString(await kv.get(key));
    } catch {
      return 'failed';                      // still offline; try again later
    }
    if (remote !== null && remote !== snap.base) {
      if (!entry.conflict) await store.set(OUT + key, { ...entry, conflict: true });
      return 'conflict';
    }
    // The newest copy, not the one read above: a write queued during the
    // read is based on the same KV value, and it is what the user last saw.
    const latest = (await store.get(OUT + key)) || entry;
    try {
      await kv.set(key, latest.payload);
    } catch {
      return 'failed';
    }
    return (await settle(key, latest.payload)) ? 'synced' : 'again';
  }

  /** Keys whose replay is blocked on a decision. */
  async function conflicts() {
    return (await pending()).filter((row) => row.conflict).map((row) => row.key);
  }

  /**
   * Settle a conflict. 'mine' writes this device's copy over KV's;
   * 'theirs' drops the queued write, leaving KV's value to be read back.
   * Returns whether anything changed.
   */
  async function resolve(key, choice) {
    const entry = await store.get(OUT + key);
    if (!entry) return false;
    if (choice === 'theirs') {
      queued.delete(key);
      staged.delete(key);
      await store.del(OUT + key);
      // The base is unknown now; the next read sets both halves.
      await store.set(SNAP + key, { payload: null, base: null, at: now() });
      return true;
    }
    try {
      await kv.set(key, entry.payload);
    } catch {
      return false;
    }
    // A decision is a write in flight like a replay, and the same thing
    // can happen to it while it is out: see settle.
    await settle(key, entry.payload);
    return true;
  }

  /** Forget everything - a sign-out or an erase should not leave a shadow. */
  async function clear() {
    for (const { key } of await store.entries(OUT)) await store.del(OUT + key);
    for (const { key } of await store.entries(SNAP)) await store.del(SNAP + key);
    queued.clear();
    staged.clear();
  }

  return {
    durable: store.durable !== false,
    ready,
    mirror,
    localValue,
    hasLocalData,
    stage,
    confirm,
    queue,
    pending,
    pendingCount,
    hasPending,
    flush,
    conflicts,
    resolve,
    clear,
  };
}
