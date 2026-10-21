const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A short random id, safe in file names and kv keys. */
export function uid(len = 12) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return out;
}
