/**
 * Shared between the app and the collaboration worker. Adapted from the
 * Whiteboard app's collaboration protocol (src/whiteboard/src/collaboration).
 */
export const PROTOCOL = 1;
export const SESSION_TTL = 60_000;
/** Updates up to this many base64 characters are kept inline in KV. */
export const MAX_INLINE = 240_000;
export const ID = /^[a-z0-9]{8,40}$/;
export const DOC = /^(tree|[a-z0-9]{1,40}(\.c)?)$/;
export const ROLES = ['owner', 'editor', 'commenter', 'viewer'];
export const INVITE_ROLES = ['editor', 'commenter', 'viewer'];
export const canEditContent = (role) => role === 'owner' || role === 'editor';
export const canComment = (role) => canEditContent(role) || role === 'commenter';
export const canManage = (role) => role === 'owner';
/** Whether a role may write a document: comments for commenters, content for editors. */
export const canWriteDoc = (role, doc) => (doc.endsWith('.c') ? canComment(role) : canEditContent(role));

export const enc = new TextEncoder();

export function encode(bytes) {
  let text = '';
  for (let n = 0; n < bytes.length; n += 8192) text += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return btoa(text);
}

export function decode(value, max = Infinity) {
  if (typeof value !== 'string' || value.length > max || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Invalid collaboration update.');
  }
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? enc.encode(value) : value))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}

export async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
  };
}

const imported = new Map();
function importKey(jwk, usage) {
  const id = usage + JSON.stringify(jwk);
  let key = imported.get(id);
  if (!key) {
    if (imported.size >= 1024) imported.delete(imported.keys().next().value);
    key = crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [usage]);
    imported.set(id, key);
    key.catch(() => {
      if (imported.get(id) === key) imported.delete(id);
    });
  }
  return key;
}

export async function sign(key, value) {
  const k = await importKey(key, 'sign');
  return encode(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(JSON.stringify(value)))));
}

export async function verify(key, value, signature) {
  try {
    const k = await importKey(key, 'verify');
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, decode(signature, 200), enc.encode(JSON.stringify(value)));
  } catch {
    return false;
  }
}

/** Only Puter worker addresses are ever called or deployed. */
export function workerURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.puter\.work$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid collaboration server address.');
  }
  return url.origin;
}

/** The link that opens a shared space (and joins it with an invitation). */
export function shareLink(server, room, token, page = null, base = location.href) {
  const url = new URL(base);
  // The development sandbox (?local) keeps its flag so links open there too.
  if (url.searchParams.has('local')) url.search = '?local';
  else url.search = '';
  url.hash = new URLSearchParams({
    server: workerURL(server),
    space: room,
    ...(page ? { page } : {}),
    ...(token ? { invite: token } : {}),
  }).toString();
  return url.href;
}

export function parseLink(value, base = typeof location === 'undefined' ? 'https://localhost/' : location.href) {
  const url = new URL(value, base);
  const p = new URLSearchParams(url.hash.slice(1));
  const room = p.get('space');
  if (!room || !ID.test(room)) throw new Error('Invalid space link.');
  const page = p.get('page');
  return {
    server: workerURL(p.get('server')),
    room,
    page: page && /^[a-z0-9]{1,40}$/.test(page) ? page : null,
    token: p.get('invite') || undefined,
  };
}
