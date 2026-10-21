/**
 * A local copy of every document in IndexedDB, so pages open instantly and
 * edits made offline survive a reload until they are saved to the cloud.
 * The cloud copy stays the source of truth; both are merged on load.
 */
export function memoryCache() {
  const m = new Map();
  return {
    async get(key) {
      return m.get(key) || null;
    },
    async set(key, value) {
      m.set(key, value);
    },
    async del(key) {
      m.delete(key);
    },
    async keys(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

export async function indexedDbCache(name = 'wiki-cache') {
  if (typeof indexedDB === 'undefined') return memoryCache();
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('docs');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  } catch {
    // Private windows and blocked storage: work without a local copy.
    return memoryCache();
  }
  const run = (mode, fn) =>
    new Promise((resolve, reject) => {
      const t = db.transaction('docs', mode);
      const req = fn(t.objectStore('docs'));
      t.oncomplete = () => resolve(req?.result ?? null);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    get: (key) => run('readonly', (s) => s.get(key)).catch(() => null),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)).catch(() => {}),
    del: (key) => run('readwrite', (s) => s.delete(key)).catch(() => {}),
    keys: (prefix) => run('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`))).catch(() => []),
  };
}
