/**
 * Vitest setup, run before every test file.
 *
 * Node 22+ ships a global `localStorage` of its own which, without a
 * `--localstorage-file` path, is a stub with no working methods. Under the
 * jsdom environment that stub shadows jsdom's real Storage, so everything that
 * touches storage — offline-store.js, contacts.js, and any test that calls
 * `localStorage.clear()` — silently breaks. Install a functional in-memory
 * Storage whenever the ambient one is unusable, and leave a working one alone.
 */
function ambientStorageWorks() {
  try {
    if (typeof globalThis.localStorage === 'undefined') return false;
    const probe = '__vitest_storage_probe__';
    globalThis.localStorage.setItem(probe, '1');
    const ok = globalThis.localStorage.getItem(probe) === '1';
    globalThis.localStorage.removeItem(probe);
    return ok && typeof globalThis.localStorage.clear === 'function';
  } catch {
    return false;
  }
}

if (!ambientStorageWorks()) {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => void map.set(String(k), String(v)),
    removeItem: (k) => void map.delete(String(k)),
    clear: () => void map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true, // vi.stubGlobal in individual tests must still win
    writable: true,
  });
  if (typeof window !== 'undefined' && window.localStorage !== storage) {
    try {
      Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
    } catch {
      /* window may be sealed; the global above is what src code resolves */
    }
  }
}
