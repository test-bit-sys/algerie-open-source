/**
 * Minimal promise wrapper over IndexedDB. One database per owner (the
 * signed-out guest, or a Puter user) so accounts never mix on one device.
 */
const VERSION = 1;
export const STORES = ['collections', 'environments', 'history', 'files', 'responses', 'meta', 'sync'];

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

// A write is only stored once its transaction commits: a full disk fails the commit, after the request succeeded.
const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // A failed request aborts its transaction, so abort reports every failure.
    tx.onabort = () => reject(tx.error || new DOMException('The write was aborted.', 'AbortError'));
  });

/**
 * onVersionChange runs when another tab deletes this database (signing in moves
 * signed-out work, then deletes it). The connection closes first so the delete
 * is not held up, and this tab stops writing to a database about to disappear.
 */
export async function openDb(name, { onVersionChange } = {}) {
  const open = indexedDB.open(name, VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
  };
  const db = await req(open);
  db.onversionchange = () => {
    db.close();
    onVersionChange?.();
  };
  return new Db(db);
}

export async function deleteDb(name) {
  await req(indexedDB.deleteDatabase(name));
}

export class Db {
  constructor(db) {
    this.db = db;
  }

  #store(name, mode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  get(store, key) {
    return req(this.#store(store).get(key));
  }

  #write(store, op) {
    const tx = this.db.transaction(store, 'readwrite');
    op(tx.objectStore(store));
    return done(tx);
  }

  put(store, key, value) {
    return this.#write(store, (s) => s.put(value, key));
  }

  delete(store, key) {
    return this.#write(store, (s) => s.delete(key));
  }

  clear(store) {
    return this.#write(store, (s) => s.clear());
  }

  async all(store) {
    const s = this.#store(store);
    const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
    return keys.map((k, i) => [k, values[i]]);
  }

  keys(store) {
    return req(this.#store(store).getAllKeys());
  }

  /** Writes and deletes in one transaction. ops: [{ store, key, value } | { store, key, delete: true }] */
  batch(ops) {
    if (!ops.length) return Promise.resolve();
    const names = [...new Set(ops.map((o) => o.store))];
    const tx = this.db.transaction(names, 'readwrite');
    for (const o of ops) {
      const s = tx.objectStore(o.store);
      if (o.delete) s.delete(o.key);
      else s.put(o.value, o.key);
    }
    return done(tx);
  }

  close() {
    this.db.close();
  }
}
