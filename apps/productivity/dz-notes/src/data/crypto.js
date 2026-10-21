/**
 * Encryption for password-protected sections, on the Web Crypto API:
 * PBKDF2-SHA-256 derives an AES-GCM 256-bit key from the password, and
 * every sealed value carries its own random 96-bit IV. The password itself
 * is never stored; a sealed check value tells a right password from a
 * wrong one.
 */

const ITERATIONS = 310000;
const CHECK = 'notes-section-check-v1';
const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Encryption is not available in this browser.');
  return s;
}

export function toBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function deriveKey(password, saltB64, iterations = ITERATIONS) {
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt: fromBase64(saltB64), iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function openBytes(key, sealed) {
  const bytes = sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}

export async function sealJSON(key, value) {
  return toBase64(await sealBytes(key, enc.encode(JSON.stringify(value))));
}

export async function openJSON(key, b64) {
  return JSON.parse(dec.decode(await openBytes(key, fromBase64(b64))));
}

/** New protection settings for a password: { lock, key }. */
export async function createLock(password) {
  const salt = toBase64(randomBytes(16));
  const key = await deriveKey(password, salt);
  return { lock: { v: 1, salt, iterations: ITERATIONS, check: await sealJSON(key, CHECK) }, key };
}

/** The key for a lock if the password is right, otherwise null. */
export async function unlockKey(lock, password) {
  const key = await deriveKey(password, lock.salt, lock.iterations || ITERATIONS);
  try {
    return (await openJSON(key, lock.check)) === CHECK ? key : null;
  } catch {
    return null;
  }
}
