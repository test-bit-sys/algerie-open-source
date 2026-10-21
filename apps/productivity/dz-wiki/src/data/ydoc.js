import * as Y from 'yjs';

/** Transaction origins: edits made here, and edits that arrived from elsewhere. */
export const LOCAL = 'local';
export const REMOTE = 'remote';

export { Y };

export function encodeBase64(bytes) {
  let text = '';
  for (let n = 0; n < bytes.length; n += 8192) text += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return btoa(text);
}

export function decodeBase64(value) {
  if (typeof value !== 'string' || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Invalid update.');
  }
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** A fresh document, optionally loaded from saved state. */
export function makeDoc(state) {
  const doc = new Y.Doc();
  if (state && state.length) Y.applyUpdate(doc, state, REMOTE);
  return doc;
}

/** Run fn in a local transaction (one undo step, one save). */
export function local(doc, fn) {
  let result;
  doc.transact(() => {
    result = fn();
  }, LOCAL);
  return result;
}

/** Plain object of a Y.Map's entries, with nested Y types converted. */
export function plain(map) {
  if (!map) return null;
  const out = {};
  for (const [k, v] of map.entries()) out[k] = v instanceof Y.AbstractType ? v.toJSON() : v;
  return out;
}
