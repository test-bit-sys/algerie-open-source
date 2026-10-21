// Reading what the browser does not report about a video file: whether it
// has a picture at all, its size and duration (through a <video> element) and
// its frame rate (from the MP4 or WebM/Matroska headers).

import { VIDEO_EXTENSIONS, extensionOf } from '../audio/decode.js';

/** True for names and types that may hold video (the probe decides). */
export function maybeVideo(name = '', type = '') {
  return /^video\//i.test(type) || VIDEO_EXTENSIONS.includes(extensionOf(name));
}

// Common rates written as fractions (24000/1001) come out a hair off.
const NOMINAL = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 119.88, 120];

export function roundFrameRate(fps) {
  // Outside this range the header describes a time base, not frames (recorders write 1 ms).
  if (!(fps >= 1 && fps <= 300)) return 0;
  const near = NOMINAL.find((r) => Math.abs(r - fps) < 0.01);
  return near ?? Math.round(fps * 1000) / 1000;
}

// ------------------------------------------------------------------- MP4

const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Child boxes of [start, end): [{ type, start (payload), end }]. */
function boxes(b, start, end) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = fourcc(b, o + 4);
    let head = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = dv.getUint32(o + 8) * 2 ** 32 + dv.getUint32(o + 12);
      head = 16;
    } else if (size === 0) size = end - o;
    if (size < head) break;
    out.push({ type, start: o + head, end: Math.min(end, o + size) });
    o += size;
  }
  return out;
}

const child = (b, box, type) => boxes(b, box.start, box.end).find((x) => x.type === type) || null;

/**
 * Frame rate of the first video track in an MP4/MOV 'moov' box (or a buffer
 * that contains one at the top level). Returns 0 when it cannot be read.
 */
export function mp4FrameRate(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const top = boxes(b, 0, b.length);
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) return 0;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (const trak of boxes(b, moov.start, moov.end).filter((x) => x.type === 'trak')) {
    const mdia = child(b, trak, 'mdia');
    const hdlr = mdia && child(b, mdia, 'hdlr');
    if (!hdlr || fourcc(b, hdlr.start + 8) !== 'vide') continue;
    const mdhd = child(b, mdia, 'mdhd');
    const stbl = child(b, child(b, mdia, 'minf') || { start: 0, end: 0 }, 'stbl');
    const stts = stbl && child(b, stbl, 'stts');
    if (!mdhd || !stts) return 0;
    const v1 = b[mdhd.start] === 1;
    const timescale = dv.getUint32(mdhd.start + (v1 ? 20 : 12));
    const count = dv.getUint32(stts.start + 4);
    // Average over the decoding time table, which also covers variable frame rates.
    let samples = 0;
    let ticks = 0;
    for (let i = 0; i < count && stts.start + 16 + i * 8 <= stts.end; i++) {
      const n = dv.getUint32(stts.start + 8 + i * 8);
      samples += n;
      ticks += n * dv.getUint32(stts.start + 12 + i * 8);
    }
    return timescale && ticks ? roundFrameRate((samples * timescale) / ticks) : 0;
  }
  return 0;
}

// ---------------------------------------------------------- WebM/Matroska

/** EBML variable-length integer at `o`: { value, length, unknown } (value keeps the marker bit for ids). */
function vint(b, o, id = false) {
  const first = b[o];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    length++;
    mask >>= 1;
  }
  let value = id ? first : first & (mask - 1);
  let unknown = !id && (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    if (o + i >= b.length) return null;
    value = value * 256 + b[o + i];
    if (b[o + i] !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const DEFAULT_DURATION = 0x23e383;
const CLUSTER = 0x1f43b675;

function uintAt(b, o, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[o + i];
  return v;
}

/**
 * Frame rate of the first video track of a WebM/Matroska file from its
 * DefaultDuration, read from the start of the file (the track headers come
 * before the first cluster). Returns 0 when the file does not say.
 */
export function webmFrameRate(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const walk = (start, end, visit) => {
    let o = start;
    while (o < end) {
      const id = vint(b, o, true);
      if (!id) return;
      const size = vint(b, o + id.length);
      if (!size) return;
      const body = o + id.length + size.length;
      const stop = size.unknown ? end : Math.min(end, body + size.value);
      if (visit(id.value, body, stop) === false) return;
      o = stop;
    }
  };
  let fps = 0;
  walk(0, b.length, (id, s, e) => {
    if (id !== SEGMENT) return true;
    walk(s, e, (id2, s2, e2) => {
      if (id2 === CLUSTER) return false;
      if (id2 !== TRACKS) return true;
      walk(s2, e2, (id3, s3, e3) => {
        if (id3 !== TRACK_ENTRY) return true;
        let type = 0;
        let dur = 0;
        walk(s3, e3, (id4, s4, e4) => {
          if (id4 === TRACK_TYPE) type = uintAt(b, s4, e4 - s4);
          else if (id4 === DEFAULT_DURATION) dur = uintAt(b, s4, e4 - s4);
          return true;
        });
        if (type === 1) {
          fps = dur > 0 ? roundFrameRate(1e9 / dur) : 0;
          return false;
        }
        return true;
      });
      return false;
    });
    return false;
  });
  return fps;
}

/** Frame rate of a video Blob from its container headers, or 0. */
export async function sniffFrameRate(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
      return webmFrameRate(new Uint8Array(await blob.slice(0, 1 << 20).arrayBuffer()));
    }
    // MP4/MOV: walk the top-level boxes to the 'moov' box (it may sit at the end).
    let o = 0;
    for (let i = 0; i < 64 && o + 8 <= blob.size; i++) {
      const hb = new Uint8Array(await blob.slice(o, o + 16).arrayBuffer());
      const dv = new DataView(hb.buffer);
      let size = dv.getUint32(0);
      const type = fourcc(hb, 4);
      if (size === 1 && hb.length >= 16) size = dv.getUint32(8) * 2 ** 32 + dv.getUint32(12);
      else if (size === 0) size = blob.size - o;
      if (size < 8) return 0;
      if (type === 'moov') {
        if (size > 64 * 1024 * 1024) return 0;
        return mp4FrameRate(new Uint8Array(await blob.slice(o, o + size).arrayBuffer()));
      }
      o += size;
    }
  } catch {
    // Unreadable headers: the rate stays unknown.
  }
  return 0;
}

// ---------------------------------------------------------------- browser

/**
 * Loads a video Blob's metadata in a detached <video>. Resolves { width,
 * height, duration } (duration 0 when unknown), or null when the browser
 * cannot play it or it has no picture (an audio-only MP4 or WebM).
 */
export function probeVideo(blob, { timeout = 15000 } = {}) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), timeout);
    const result = () => (v.videoWidth > 0 ? { width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0 } : null);
    v.muted = true;
    v.preload = 'metadata';
    v.addEventListener('error', () => finish(null));
    v.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(v.duration) || v.videoWidth === 0) return finish(result());
      // Recordings often leave the duration out of the header: seeking far ahead makes the browser find it.
      v.addEventListener('durationchange', () => Number.isFinite(v.duration) && finish(result()));
      setTimeout(() => finish(result()), 3000);
      v.currentTime = 1e9;
    });
    v.src = url;
  });
}
