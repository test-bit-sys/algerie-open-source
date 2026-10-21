import { webcrypto } from 'node:crypto';

// jsdom's crypto lacks subtle/getRandomValues in some versions; the app code
// leans on both. Node's webcrypto is a drop-in.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// Some jsdom builds ship a localStorage stub missing methods; replace it
// with a complete in-memory one.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(String(k)),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  }
}

// jsdom ships no matchMedia; theme and modal code query it.
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  if (typeof window !== 'undefined') window.matchMedia = globalThis.matchMedia;
}

// jsdom implements no scrolling, so Element#scrollIntoView is absent; code
// that walks the reader to a field calls it.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
