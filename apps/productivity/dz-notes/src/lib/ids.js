/** Short random ids, safe in file names and URLs. */
export function uid(prefix = '') {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return prefix + s;
}
