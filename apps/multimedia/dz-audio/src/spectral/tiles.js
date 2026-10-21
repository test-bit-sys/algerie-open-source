// Spectrogram tiling. A channel is a list of pieces referencing immutable
// sample blocks, so analysis columns are placed on a grid aligned to each
// block (column k sits at block frame k * hop) and grouped into tiles of
// TILE_COLS columns. A tile's key names the exact sample content its analysis
// windows read: interior tiles depend only on their block and grid position,
// so they survive edits elsewhere in the file (including ones that shift
// them in time); tiles at piece edges also name the neighbouring content.
//
// Hops are powers of two chosen from the zoom level, so zooming within 2x
// reuses the same tiles, and other hops serve as placeholders while the
// right ones are computed.

export const TILE_COLS = 256;
export const FLOOR_DB = -160; // tile bytes map [FLOOR_DB, 0] dB to [0, 255]

/** Hop (power of two) for `fpp` frames per device pixel: 1 to 2 columns per pixel. */
export function chooseHop(fpp, fft) {
  const min = Math.max(8, fft / 32);
  const h = Math.pow(2, Math.floor(Math.log2(Math.max(1, fpp))));
  return Math.max(min, Math.min(1 << 22, h));
}

/**
 * Content signature of channel frames [a, b): the block slices covering it,
 * with zero padding outside the channel.
 */
export function rangeSignature(channel, a, b) {
  const parts = [];
  if (a < 0) parts.push(`z${Math.min(b, 0) - a}`);
  const s = Math.max(0, a);
  const e = Math.min(channel.length, b);
  if (e > s) {
    let i = channel.pieceIndex(s);
    let at = s;
    while (at < e) {
      const p = channel.pieces[i];
      const inPiece = at - channel.starts[i];
      const take = Math.min(p.length - inPiece, e - at);
      parts.push(`${p.block.id}@${p.offset + inPiece}+${take}`);
      at += take;
      i++;
    }
  }
  if (b > channel.length) parts.push(`z${b - Math.max(a, channel.length)}`);
  return parts.join(',');
}

/**
 * Tiles covering document frames [start, end) of `channel` at `hop`.
 * Each tile: { key, hop, cols, centres: first column centre (document
 * frame), step: hop, x0, x1 (document frame extent to draw), read }.
 * `read` describes the samples the analysis needs: { contiguous, start, length }
 * for hop < fft, or { gather: [frame...] } window starts otherwise.
 */
export function planTiles(channel, start, end, hop, fft, prefix = '') {
  if (hop >= DOC_GRID_HOP) return planDocTiles(channel, start, end, hop, fft, prefix);
  const tiles = [];
  if (!channel.length || end <= start) return tiles;
  const half = fft / 2;
  const a = Math.max(0, Math.floor(start - hop));
  const b = Math.min(channel.length, Math.ceil(end + hop));
  if (b <= a) return tiles;
  let i = channel.pieceIndex(a);
  for (; i < channel.pieces.length && channel.starts[i] < b; i++) {
    const p = channel.pieces[i];
    const docStart = channel.starts[i];
    // Columns whose centres lie inside this piece: block frames in [offset, offset + length).
    const kFirst = Math.ceil(p.offset / hop);
    const kLast = Math.ceil((p.offset + p.length) / hop) - 1;
    if (kLast < kFirst) continue;
    const toDoc = (k) => docStart + k * hop - p.offset;
    // Visible column range.
    const kv0 = Math.max(kFirst, Math.floor((a - docStart + p.offset) / hop));
    const kv1 = Math.min(kLast, Math.ceil((b - docStart + p.offset) / hop));
    if (kv1 < kv0) continue;
    for (let t = Math.floor(kv0 / TILE_COLS); t <= Math.floor(kv1 / TILE_COLS); t++) {
      const k0 = Math.max(kFirst, t * TILE_COLS);
      const k1 = Math.min(kLast, (t + 1) * TILE_COLS - 1);
      if (k1 < k0) continue;
      const c0 = toDoc(k0);
      const c1 = toDoc(k1);
      const cols = k1 - k0 + 1;
      // Interior when every analysis window stays inside this piece's slice of the block.
      const interior = k0 * hop - half >= p.offset && k1 * hop + half <= p.offset + p.length;
      let content;
      if (hop < fft) {
        content = interior ? `b${p.block.id}:${k0}-${k1}` : `e${rangeSignature(channel, c0 - half, c1 + half)}`;
      } else {
        // Windows are gathered one by one: each window's own content matters.
        const winInterior = (k) => k * hop - half >= p.offset && k * hop + half <= p.offset + p.length;
        const edges = [];
        if (!winInterior(k0)) edges.push(rangeSignature(channel, c0 - half, c0 + half));
        if (cols > 1 && !winInterior(k1)) edges.push(rangeSignature(channel, c1 - half, c1 + half));
        content = `b${p.block.id}:${k0}-${k1}${edges.length ? `|${edges.join('|')}` : ''}`;
      }
      tiles.push({
        key: `${prefix}${fft}/${hop}/${content}`,
        hop,
        cols,
        centre0: c0,
        x0: c0 - hop / 2,
        x1: c1 + hop / 2,
        read: hop < fft ? { contiguous: true, start: c0 - half, length: (cols - 1) * hop + fft } : { gather: Array.from({ length: cols }, (_, j) => c0 + j * hop - half) },
      });
    }
  }
  return tiles;
}

/**
 * Zoomed out, a block holds only a few columns, so block-aligned tiles would
 * be tiny. From this hop on, columns sit on a document grid (k * hop) and a
 * tile's key hashes the content of every window it reads: still exact, but
 * an edit that shifts audio by other than a multiple of the hop recomputes
 * the tiles after it (cheap at these densities).
 */
export const DOC_GRID_HOP = 1024;

// Channels never change, so a document-grid tile of a channel is planned once.
const docTileMemo = new WeakMap();

function planDocTiles(channel, start, end, hop, fft, prefix) {
  const tiles = [];
  if (!channel.length || end <= start) return tiles;
  let memo = docTileMemo.get(channel);
  if (!memo) docTileMemo.set(channel, (memo = new Map()));
  const kMin = Math.max(0, Math.floor((start - hop) / hop));
  const kMax = Math.min(Math.ceil(channel.length / hop) - 1, Math.ceil((end + hop) / hop));
  for (let t = Math.floor(kMin / TILE_COLS); t <= Math.floor(kMax / TILE_COLS); t++) {
    const id = `${prefix}${fft}/${hop}/${t}`;
    let tile = memo.get(id);
    if (tile === undefined) {
      tile = planDocTile(channel, t, hop, fft, prefix);
      memo.set(id, tile);
    }
    if (tile) tiles.push(tile);
  }
  return tiles;
}

function planDocTile(channel, t, hop, fft, prefix) {
  const half = fft / 2;
  {
    const k0 = t * TILE_COLS;
    const k1 = Math.min((t + 1) * TILE_COLS - 1, Math.ceil(channel.length / hop) - 1);
    if (k1 < k0) return null;
    const cols = k1 - k0 + 1;
    const c0 = k0 * hop;
    const c1 = k1 * hop;
    let sig;
    if (hop < fft) sig = rangeSignature(channel, c0 - half, c1 + half);
    else {
      const parts = [];
      for (let k = k0; k <= k1; k++) parts.push(windowSignature(channel, k * hop - half, fft));
      sig = parts.join(';');
    }
    return {
      key: `${prefix}${fft}/${hop}/d${k0}:${cols}:${hashString(sig)}`,
      hop,
      cols,
      centre0: c0,
      x0: c0 - hop / 2,
      x1: c1 + hop / 2,
      read: hop < fft ? { contiguous: true, start: c0 - half, length: (cols - 1) * hop + fft } : { gather: Array.from({ length: cols }, (_, j) => c0 + j * hop - half) },
    };
  }
}

/** Signature of one analysis window: its block and offset when it lies in one piece. */
function windowSignature(channel, s, n) {
  if (s >= 0 && s + n <= channel.length) {
    const i = channel.pieceIndex(s);
    const p = channel.pieces[i];
    const inPiece = s - channel.starts[i];
    if (inPiece + n <= p.length) return `${p.block.id}@${p.offset + inPiece}`;
  }
  return rangeSignature(channel, s, s + n);
}

/** Two independent 32-bit FNV-1a hashes of a string, as hex. */
export function hashString(str) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}

/** Reads the samples a tile's analysis needs (zero padded past the channel). */
export function readTileSamples(channel, tile, fft) {
  if (tile.read.contiguous) return channel.read(tile.read.start, new Float32Array(tile.read.length));
  const out = new Float32Array(tile.read.gather.length * fft);
  tile.read.gather.forEach((s, j) => channel.read(s, out, j * fft, fft));
  return out;
}

/**
 * Least-recently-used cache with a byte budget. `onEvict(value, key)` frees
 * resources (GPU textures).
 */
export class TileCache {
  constructor(budget, onEvict = () => {}) {
    this.budget = budget;
    this.onEvict = onEvict;
    this.map = new Map();
    this.bytes = 0;
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    // Re-insert to mark as most recently used.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  peek(key) {
    return this.map.get(key)?.value;
  }

  has(key) {
    return this.map.has(key);
  }

  set(key, value, bytes) {
    if (this.map.has(key)) this.delete(key);
    this.map.set(key, { value, bytes });
    this.bytes += bytes;
    this.trim();
  }

  delete(key) {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.bytes -= e.bytes;
    this.onEvict(e.value, key);
  }

  /** Evicts oldest entries until within budget, never touching `keep` keys. */
  trim(keep) {
    for (const key of this.map.keys()) {
      if (this.bytes <= this.budget) break;
      if (keep?.has(key)) continue;
      this.delete(key);
    }
  }

  clear() {
    for (const key of [...this.map.keys()]) this.delete(key);
  }

  get size() {
    return this.map.size;
  }
}
