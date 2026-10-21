// Collects encoder output into a few large Blob parts instead of thousands of
// small ones, so long exports stay cheap to assemble.

const SIZE = 1 << 20;

export class ByteSink {
  constructor() {
    this.parts = [];
    this.buf = new Uint8Array(SIZE);
    this.fill = 0;
    this.length = 0;
  }

  /** Appends bytes (Uint8Array or ArrayBuffer view). */
  push(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
    this.length += bytes.length;
    if (bytes.length >= SIZE / 2) {
      this.#flush();
      this.parts.push(bytes.slice());
      return;
    }
    if (this.fill + bytes.length > SIZE) this.#flush();
    this.buf.set(bytes, this.fill);
    this.fill += bytes.length;
  }

  #flush() {
    if (!this.fill) return;
    this.parts.push(this.buf.slice(0, this.fill));
    this.fill = 0;
  }

  /** All bytes as Blob parts (the sink is empty afterwards). */
  take() {
    this.#flush();
    const parts = this.parts;
    this.parts = [];
    return parts;
  }
}

export const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

export function concatBytes(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
