/** Short random ids: 16 base36 characters from crypto randomness. */
export function uid() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return out + Date.now().toString(36).slice(-6);
}

export function uuid() {
  return crypto.randomUUID();
}
