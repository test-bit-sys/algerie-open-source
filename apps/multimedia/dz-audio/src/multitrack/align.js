// Automatic speech alignment: makes a new recording of the same words (an
// overdub, a second take) follow the timing of a reference recording.
//
//  1. Short-time features of both signals: an FFT per frame, a mel-spaced
//     filterbank, log energies, and a DCT to cepstral coefficients (dropping
//     the level term), normalized per signal so level and microphone colour
//     matter less than what is said.
//  2. Dynamic time warping between the two feature sequences inside a band
//     around the diagonal: the cheapest monotonic path pairing reference and
//     unaligned frames, from both starts to both ends.
//  3. The path becomes a smooth, monotonic time map (reference time to
//     unaligned time).
//  4. WSOLA (waveform-similarity overlap-add) renders the unaligned audio
//     along that map: windowed grains are read where the map points, each
//     nudged within a small tolerance to the offset that best continues the
//     previous grain, so the voice keeps its pitch while its timing changes.
//
// Pure functions on Float32Arrays (no DOM); long steps yield through `pause`
// and report progress, and stop on an AbortSignal.

const TAU = 2 * Math.PI;

export const ALIGN_PRECISIONS = [
  // Analysis hop (seconds) and time-map smoothing (frames, about 50 ms).
  { id: 'low', label: 'Low (fast)', hop: 0.02, smooth: 3 },
  { id: 'medium', label: 'Medium', hop: 0.01, smooth: 5 },
  { id: 'high', label: 'High (slow)', hop: 0.005, smooth: 9 },
];

const pause = () => new Promise((r) => setTimeout(r, 0));
const checkAbort = (signal) => {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
};

// ------------------------------------------------------------------- FFT

/** In-place iterative radix-2 complex FFT (length a power of two). */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// -------------------------------------------------------------- features

const hzToMel = (f) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m) => 700 * (10 ** (m / 2595) - 1);

/** Triangular mel filters over FFT bins: [{ lo, weights }]. */
function melFilters(size, rate, bands, fmin = 80, fmax = Math.min(7600, rate / 2)) {
  const bins = size / 2 + 1;
  const m0 = hzToMel(fmin);
  const m1 = hzToMel(fmax);
  const edges = Array.from({ length: bands + 2 }, (_, i) => (melToHz(m0 + ((m1 - m0) * i) / (bands + 1)) * size) / rate);
  const out = [];
  for (let b = 0; b < bands; b++) {
    const [l, c, r] = [edges[b], edges[b + 1], edges[b + 2]];
    const lo = Math.max(0, Math.floor(l));
    const hi = Math.min(bins - 1, Math.ceil(r));
    const weights = new Float32Array(hi - lo + 1);
    for (let k = lo; k <= hi; k++) weights[k - lo] = Math.max(0, k < c ? (k - l) / (c - l || 1) : (r - k) / (r - c || 1));
    out.push({ lo, weights });
  }
  return out;
}

/** Mono mix of channels (Float32Array[]). */
export function monoMix(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/**
 * Cepstral features of `x` every `hop` seconds: Float32Array[frames] of
 * `coeffs` values each, mean and variance normalized over the signal.
 */
export async function speechFeatures(x, rate, { hop = 0.01, bands = 26, coeffs = 13, signal, onProgress } = {}) {
  const hopN = Math.max(1, Math.round(rate * hop));
  const size = 2 ** Math.round(Math.log2(rate * 0.025));
  const filters = melFilters(size, rate, bands);
  const win = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / size));
  const frames = Math.max(1, Math.ceil(x.length / hopN));
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const logMel = new Float32Array(bands);
  // DCT-II rows 1..coeffs (row 0, the overall level, is left out).
  const dct = Array.from({ length: coeffs }, (_, k) => Float32Array.from({ length: bands }, (_, b) => Math.cos((Math.PI * (k + 1) * (b + 0.5)) / bands)));
  const out = new Array(frames);
  for (let f = 0; f < frames; f++) {
    const c0 = f * hopN - size / 2;
    for (let i = 0; i < size; i++) {
      const j = c0 + i;
      re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bands; b++) {
      const { lo, weights } = filters[b];
      let e = 0;
      for (let k = 0; k < weights.length; k++) {
        const r = re[lo + k];
        const q = im[lo + k];
        e += weights[k] * (r * r + q * q);
      }
      logMel[b] = Math.log(e + 1e-8);
    }
    const v = new Float32Array(coeffs);
    for (let k = 0; k < coeffs; k++) {
      let s = 0;
      const row = dct[k];
      for (let b = 0; b < bands; b++) s += row[b] * logMel[b];
      v[k] = s;
    }
    out[f] = v;
    if (f % 2000 === 1999) {
      checkAbort(signal);
      onProgress?.(f / frames);
      await pause();
    }
  }
  normalizeFeatures(out);
  onProgress?.(1);
  return out;
}

/** Subtracts each coefficient's mean and divides by its deviation (in place). */
export function normalizeFeatures(frames) {
  if (!frames.length) return frames;
  const d = frames[0].length;
  const mean = new Float64Array(d);
  const sq = new Float64Array(d);
  for (const v of frames) for (let k = 0; k < d; k++) mean[k] += v[k];
  for (let k = 0; k < d; k++) mean[k] /= frames.length;
  for (const v of frames) for (let k = 0; k < d; k++) sq[k] += (v[k] - mean[k]) ** 2;
  for (let k = 0; k < d; k++) sq[k] = Math.sqrt(sq[k] / frames.length) || 1;
  for (const v of frames) for (let k = 0; k < d; k++) v[k] = (v[k] - mean[k]) / sq[k];
  return frames;
}

// ------------------------------------------------------------------- DTW

function dist(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) {
    const d = a[k] - b[k];
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Dynamic time warping of feature sequences A (reference) and B. Only cells
 * within `band` frames of the straight line from start to end are searched.
 * Horizontal and vertical steps cost `slope` extra so the path prefers to
 * advance both sequences together. Returns the path as [i, j] pairs from
 * [0, 0] to [A.length - 1, B.length - 1].
 */
export async function dtw(A, B, { band = Infinity, slope = 0.1, distance = dist, signal, onProgress } = {}) {
  const N = A.length;
  const M = B.length;
  if (!N || !M) return [];
  const W = Math.max(2, Math.ceil(Math.min(band, Math.max(N, M))));
  // Row i covers columns [lo(i), hi(i)] around the line j = i * (M - 1) / (N - 1).
  const center = (i) => (N > 1 ? (i * (M - 1)) / (N - 1) : 0);
  const lo = new Int32Array(N);
  const hi = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    lo[i] = Math.max(0, Math.floor(center(i) - W));
    hi[i] = Math.min(M - 1, Math.ceil(center(i) + W));
  }
  // Keep rows connected: each row must reach back to the previous row's columns.
  for (let i = 1; i < N; i++) lo[i] = Math.min(lo[i], hi[i - 1]);
  const offs = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) offs[i + 1] = offs[i] + hi[i] - lo[i] + 1;
  const dir = new Uint8Array(offs[N]); // 0 diagonal, 1 from above (i-1), 2 from the left (j-1)
  let prev = new Float64Array(M).fill(Infinity);
  let cur = new Float64Array(M).fill(Infinity);
  for (let i = 0; i < N; i++) {
    cur.fill(Infinity, lo[i], hi[i] + 1);
    for (let j = lo[i]; j <= hi[i]; j++) {
      const d = distance(A[i], B[j]);
      let best;
      let how = 0;
      if (i === 0 && j === 0) best = 0;
      else {
        const diag = i > 0 && j > 0 ? prev[j - 1] : Infinity;
        const up = i > 0 ? prev[j] + slope : Infinity;
        const left = j > 0 ? cur[j - 1] + slope : Infinity;
        best = diag;
        if (up < best) {
          best = up;
          how = 1;
        }
        if (left < best) {
          best = left;
          how = 2;
        }
      }
      cur[j] = best + d;
      dir[offs[i] + j - lo[i]] = how;
    }
    // Columns outside this row's band are unreachable from the next row.
    if (i > 0) prev.fill(Infinity, lo[i - 1], hi[i - 1] + 1);
    [prev, cur] = [cur, prev];
    if (i % 500 === 499) {
      checkAbort(signal);
      onProgress?.(i / N);
      await pause();
    }
  }
  const path = [];
  let i = N - 1;
  let j = M - 1;
  if (j < lo[i] || j > hi[i]) throw new Error('The alignment band is too narrow for these clips.');
  for (;;) {
    path.push([i, j]);
    if (i === 0 && j === 0) break;
    const how = dir[offs[i] + j - lo[i]];
    if (how === 0) {
      i--;
      j--;
    } else if (how === 1) i--;
    else j--;
    if (i < 0 || j < 0 || j < lo[i] || j > hi[i]) throw new Error('The alignment path left its band.');
  }
  onProgress?.(1);
  return path.reverse();
}

// -------------------------------------------------------------- time map

/**
 * Turns a DTW path into a time map: for each reference frame, the matching
 * unaligned frame (fractional), smoothed over `smooth` frames and kept
 * increasing. Returns Float64Array(N).
 */
export function pathToMap(path, N, smooth = 1) {
  const sum = new Float64Array(N);
  const count = new Float64Array(N);
  for (const [i, j] of path) {
    sum[i] += j;
    count[i]++;
  }
  let map = new Float64Array(N);
  for (let i = 0; i < N; i++) map[i] = count[i] ? sum[i] / count[i] : i > 0 ? map[i - 1] : 0;
  if (smooth > 1 && N > 2) {
    const half = Math.floor(smooth / 2);
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      let n = 0;
      for (let k = Math.max(0, i - half); k <= Math.min(N - 1, i + half); k++) {
        s += map[k];
        n++;
      }
      out[i] = s / n;
    }
    // The ends stay pinned to the path's ends.
    out[0] = map[0];
    out[N - 1] = map[N - 1];
    map = out;
  }
  for (let i = 1; i < N; i++) if (map[i] < map[i - 1]) map[i] = map[i - 1];
  return map;
}

/** Evaluates a frame map at a fractional reference frame (linear between frames). */
export function mapAt(map, f) {
  if (f <= 0) return map[0];
  const last = map.length - 1;
  if (f >= last) return map[last] + (f - last);
  const i = Math.floor(f);
  return map[i] + (map[i + 1] - map[i]) * (f - i);
}

// ------------------------------------------------------------------ WSOLA

/**
 * Renders `channels` along `warp(t)` (output sample -> input sample) into
 * `outLength` samples with WSOLA. `win` is the grain length and `tol` the
 * search tolerance (samples).
 */
export async function wsola(channels, outLength, warp, { win = 1024, tol = 256, signal, onProgress } = {}) {
  win = Math.max(16, win & ~1);
  const hop = win / 2;
  const n = channels[0].length;
  const mono = monoMix(channels);
  const out = channels.map(() => new Float32Array(outLength + win));
  const norm = new Float32Array(outLength + win);
  const w = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * (i + 0.5)) / win));
  const at = (p) => (p >= 0 && p < n ? mono[p] : 0);
  let prevPos = null;
  const step = Math.max(1, Math.round(win / 256));
  const frames = Math.ceil((outLength + hop) / hop);
  for (let k = 0; k < frames; k++) {
    const t = k * hop - hop;
    // Where the map wants this grain's centre to come from.
    const want = Math.round(warp(t + win / 2) - win / 2);
    let pos = want;
    if (prevPos !== null) {
      // The natural continuation of the previous grain, and the offset near `want` most like it.
      const nat = prevPos + hop;
      let best = -Infinity;
      for (let d = -tol; d <= tol; d += step) {
        const p = want + d;
        let s = 0;
        for (let i = 0; i < win; i += step) s += at(p + i) * at(nat + i);
        if (s > best) {
          best = s;
          pos = p;
        }
      }
    }
    prevPos = pos;
    for (let i = 0; i < win; i++) {
      const o = t + i;
      if (o < 0 || o >= outLength) continue;
      const p = pos + i;
      norm[o] += w[i];
      if (p < 0 || p >= n) continue;
      for (let c = 0; c < channels.length; c++) out[c][o] += channels[c][p] * w[i];
    }
    if (k % 400 === 399) {
      checkAbort(signal);
      onProgress?.(k / frames);
      await pause();
    }
  }
  onProgress?.(1);
  return out.map((o) => {
    const r = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) r[i] = norm[i] > 1e-3 ? o[i] / norm[i] : 0;
    return r;
  });
}

// -------------------------------------------------------------- pipeline

/**
 * Aligns `unaligned` (Float32Array[] channels) to `reference` (Float32Array[])
 * at `rate`. Returns { channels (reference length), map, path, hop }.
 */
export async function alignSpeech(reference, unaligned, rate, { precision = 'medium', signal, onProgress } = {}) {
  const p = ALIGN_PRECISIONS.find((x) => x.id === precision) || ALIGN_PRECISIONS[1];
  const stage = (a, b) => (f) => onProgress?.(a + (b - a) * f);
  const A = await speechFeatures(monoMix(reference), rate, { hop: p.hop, signal, onProgress: stage(0, 0.15) });
  const B = await speechFeatures(monoMix(unaligned), rate, { hop: p.hop, signal, onProgress: stage(0.15, 0.3) });
  // The band lets timing wander by up to 30% of the length (at least 1.5 seconds), within
  // about 40 million cells so long clips stay within memory.
  const band = Math.min(Math.max(1.5 / p.hop, 0.3 * Math.max(A.length, B.length)), Math.max(1 / p.hop, 2e7 / A.length));
  const path = await dtw(A, B, { band, signal, onProgress: stage(0.3, 0.6) });
  const map = pathToMap(path, A.length, p.smooth);
  const hopN = rate * p.hop;
  const warp = (t) => mapAt(map, t / hopN) * hopN;
  const outLength = reference[0].length;
  const win = 2 * Math.round(rate * 0.015);
  const channels = await wsola(unaligned, outLength, warp, { win, tol: Math.round(rate * 0.008), signal, onProgress: stage(0.6, 1) });
  return { channels, map, path, hop: p.hop };
}
