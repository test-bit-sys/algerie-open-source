// Clip remix: the music analysis, the path search and the audio splice
// behind Clip > Remix (see model/clip-remix.js for the clip model and
// multitrack/remix.js for the background renderer).
//
//  1. Short-time spectra (Hann window, about 46 ms, hop a quarter of that)
//     give per frame: log mel band energies, cepstral coefficients from them
//     (timbre), a 12-bin pitch-class profile (harmony) and spectral flux
//     (the summed rise of the mel bands, which peaks on note onsets).
//  2. Tempo: autocorrelation of the onset curve over lags from 50 to 220
//     BPM, weighted toward moderate tempos so half and double tempo lose.
//  3. Beats: dynamic programming over the onset curve. Each frame scores its
//     onset strength plus the best earlier beat about one period back, with
//     a penalty that grows with the log of how far the spacing strays from
//     the period. Weak beats at the start and end (silence, a fade) drop.
//  4. Per-beat features: the mean cepstrum and pitch-class profile of each
//     beat, normalized so the two kinds weigh alike.
//  5. Path search: a jump after beat i to beat j sounds natural when beat j
//     resembles the beat that would have come next (i + 1) and beat i
//     resembles what normally leads into j (j - 1). The best few jumps from
//     each beat are candidates. Dynamic programming over (beat, beats played)
//     finds the cheapest route from the clip's start to the source's end whose
//     length lands within a tolerance of the target; every segment lasts at
//     least a minimum number of beats ("edit length").
//  6. The result is a list of source ranges, joined with short equal-power
//     crossfades centred on each cut.
//
// Pure functions on Float32Arrays (no DOM); long steps yield through `pause`
// and report progress, and stop on an AbortSignal.

import { fft, monoMix } from './align.js';

const TAU = 2 * Math.PI;
const pause = () => new Promise((r) => setTimeout(r, 0));
const checkAbort = (signal) => {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
};

/** Cepstral coefficients kept per frame (the level term is kept apart). */
const CEPS = 12;
const MEL_BANDS = 40;

const hzToMel = (f) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m) => 700 * (10 ** (m / 2595) - 1);

/** Triangular mel filters over FFT bins: [{ lo, weights }]. */
function melBank(size, rate, bands, fmin = 30, fmax = Math.min(11000, rate / 2)) {
  const bins = size / 2 + 1;
  const m0 = hzToMel(fmin);
  const m1 = hzToMel(fmax);
  const edges = Array.from({ length: bands + 2 }, (_, i) => (melToHz(m0 + ((m1 - m0) * i) / (bands + 1)) * size) / rate);
  return Array.from({ length: bands }, (_, b) => {
    const [l, c, r] = [edges[b], edges[b + 1], edges[b + 2]];
    const lo = Math.max(0, Math.floor(l));
    const hi = Math.min(bins - 1, Math.ceil(r));
    const weights = new Float32Array(Math.max(1, hi - lo + 1));
    for (let k = lo; k <= hi; k++) weights[k - lo] = Math.max(0, k < c ? (k - l) / (c - l || 1) : (r - k) / (r - c || 1));
    return { lo, weights };
  });
}

/** Pitch class (0 = A) of each FFT bin between 55 Hz and 5 kHz, or -1 outside. */
function chromaMap(size, rate) {
  const bins = size / 2 + 1;
  const map = new Int8Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) {
    const f = (k * rate) / size;
    if (f < 55 || f > 5000) continue;
    map[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  return map;
}

/**
 * Frame features of mono samples `x`: { hop, frames, flux, ceps (frames x
 * CEPS), level, chroma (frames x 12) }. Frame f is centred on sample f * hop.
 */
export async function frameFeatures(x, rate, { signal, onProgress } = {}) {
  const size = 2 ** Math.round(Math.log2(rate * 0.046));
  const hop = size / 4;
  const frames = Math.max(1, Math.ceil(x.length / hop));
  const bank = melBank(size, rate, MEL_BANDS);
  const pcs = chromaMap(size, rate);
  const win = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / size));
  // DCT-II rows 0..CEPS over the log mel bands; row 0 is the level.
  const dct = Array.from({ length: CEPS + 1 }, (_, k) => Float32Array.from({ length: MEL_BANDS }, (_, b) => Math.cos((Math.PI * k * (b + 0.5)) / MEL_BANDS)));
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const prev = new Float32Array(MEL_BANDS);
  const cur = new Float32Array(MEL_BANDS);
  const flux = new Float32Array(frames);
  const level = new Float32Array(frames);
  const ceps = new Float32Array(frames * CEPS);
  const chroma = new Float32Array(frames * 12);
  for (let f = 0; f < frames; f++) {
    const c0 = f * hop - size / 2;
    for (let i = 0; i < size; i++) {
      const j = c0 + i;
      re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    // Power spectrum in place (re holds it from here on).
    for (let k = 0; k <= size / 2; k++) re[k] = re[k] * re[k] + im[k] * im[k];
    let rise = 0;
    for (let b = 0; b < MEL_BANDS; b++) {
      const { lo, weights } = bank[b];
      let e = 0;
      for (let k = 0; k < weights.length; k++) e += weights[k] * re[lo + k];
      // Log compression with a floor about 100 dB below full scale.
      cur[b] = Math.log(e + 1e-10);
      if (f > 0 && cur[b] > prev[b]) rise += cur[b] - prev[b];
    }
    flux[f] = rise;
    for (let k = 0; k <= CEPS; k++) {
      const row = dct[k];
      let s = 0;
      for (let b = 0; b < MEL_BANDS; b++) s += row[b] * cur[b];
      if (k === 0) level[f] = s / MEL_BANDS;
      else ceps[f * CEPS + k - 1] = s;
    }
    const ch = f * 12;
    for (let k = 1; k <= size / 2; k++) if (pcs[k] >= 0) chroma[ch + pcs[k]] += Math.sqrt(re[k]);
    prev.set(cur);
    if (f % 1500 === 1499) {
      checkAbort(signal);
      onProgress?.(f / frames);
      await pause();
    }
  }
  onProgress?.(1);
  return { hop, size, frames, flux, level, ceps, chroma };
}

/** The onset curve: flux minus its local mean (about 0.3 s), floored at 0 and scaled to unit deviation. */
export function onsetEnvelope(flux, half = 12) {
  const n = flux.length;
  const out = new Float32Array(n);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    while (hi < Math.min(n - 1, i + half)) sum += flux[++hi];
    while (lo < i - half) sum -= flux[lo++];
    out[i] = Math.max(0, flux[i] - sum / (hi - lo + 1));
  }
  let sq = 0;
  for (let i = 0; i < n; i++) sq += out[i] * out[i];
  const sd = Math.sqrt(sq / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

/**
 * Tempo of an onset curve sampled every `hop` samples. Returns the beat
 * period in frames (fractional) and in BPM.
 */
export function estimateTempo(env, rate, hop, { minBpm = 50, maxBpm = 220, centerBpm = 120 } = {}) {
  const fps = rate / hop;
  const lag0 = Math.max(1, Math.floor((60 * fps) / maxBpm));
  const lag1 = Math.min(env.length - 1, Math.ceil((60 * fps) / minBpm));
  if (lag1 <= lag0 + 1) return { period: (60 * fps) / centerBpm, bpm: centerBpm, confidence: 0 };
  const ac = new Float64Array(lag1 + 2);
  for (let lag = lag0 - 1; lag <= lag1 + 1; lag++) {
    if (lag < 1) continue;
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (env.length - lag);
  }
  let zero = 0;
  for (let i = 0; i < env.length; i++) zero += env[i] * env[i];
  zero /= env.length || 1;
  let best = lag0;
  let bestScore = -Infinity;
  for (let lag = lag0; lag <= lag1; lag++) {
    const bpm = (60 * fps) / lag;
    // Log-normal preference around `centerBpm` (an octave either side halves it less than twice).
    const w = Math.exp(-0.5 * (Math.log2(bpm / centerBpm) / 1) ** 2);
    const score = ac[lag] * w;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic refinement of the peak.
  let period = best;
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const den = a - 2 * b + c;
  if (best > lag0 && best < lag1 && den < 0) period = best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  return { period, bpm: (60 * fps) / period, confidence: zero > 0 ? ac[best] / zero : 0 };
}

/**
 * Beat frames of an onset curve with a beat period (frames). `tightness`
 * sets how strongly beat spacing keeps to the period.
 */
export function trackBeats(env, period, { tightness = 100 } = {}) {
  const n = env.length;
  if (!n || !(period > 1)) return [];
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.max(1, Math.round(period / 2));
  const hi = Math.max(lo + 1, Math.round(period * 2));
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const l = Math.log((t - tau) / period);
      const s = score[tau] - tightness * l * l;
      if (arg < 0 || s > best) {
        best = s;
        arg = tau;
      }
    }
    // Starting a new chain is allowed when every earlier link would cost more than it brings.
    if (arg >= 0 && best > 0) {
      score[t] = env[t] + best;
      back[t] = arg;
    } else score[t] = env[t];
  }
  // The chain ends on the best-scoring local peak in the last period.
  let end = n - 1;
  let top = -Infinity;
  for (let t = Math.max(0, n - Math.ceil(period)); t < n; t++) {
    if (score[t] > top) {
      top = score[t];
      end = t;
    }
  }
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();
  // Drop weak beats at either end (silence before the music, a fade at the end).
  const strength = (t) => {
    let m = 0;
    for (let i = Math.max(0, t - 2); i <= Math.min(n - 1, t + 2); i++) m = Math.max(m, env[i]);
    return m;
  };
  const vals = beats.map(strength).sort((x, y) => x - y);
  const floor = 0.15 * (vals[Math.floor(vals.length / 2)] || 0);
  let a = 0;
  let b = beats.length;
  while (a < b && strength(beats[a]) <= floor) a++;
  while (b > a && strength(beats[b - 1]) <= floor) b--;
  return beats.slice(a, b);
}

/**
 * Analyses music for remixing. `channels` are Float32Arrays at `rate`.
 * Returns { rate, length, bpm, period (samples), beats: Int32Array of beat
 * start samples, timbre: Float32Array[] and chroma: Float32Array[] per beat }.
 */
export async function analyzeMusic(channels, rate, { signal, onProgress } = {}) {
  const full = monoMix(channels);
  // Features need nothing above about 11 kHz, so high rates are averaged down first (half the work at 48 kHz).
  const dec = Math.max(1, Math.floor(rate / 22000));
  const x = dec > 1 ? decimate(full, dec) : full;
  const fr = await frameFeatures(x, rate / dec, { signal, onProgress: (p) => onProgress?.(p * 0.9) });
  fr.hop *= dec;
  const env = onsetEnvelope(fr.flux);
  const tempo = estimateTempo(env, rate, fr.hop);
  const beatFrames = trackBeats(env, tempo.period);
  checkAbort(signal);
  // Cuts sit a hop before the detected onset so crossfades finish before the attack.
  const beats = Int32Array.from(beatFrames, (f) => Math.max(0, (f - 1) * fr.hop));
  const n = beats.length;
  const timbre = [];
  const chroma = [];
  for (let k = 0; k < n; k++) {
    const f0 = beatFrames[k];
    const f1 = k + 1 < n ? beatFrames[k + 1] : Math.min(fr.frames, f0 + Math.round(tempo.period));
    const t = new Float32Array(CEPS + 1);
    const c = new Float32Array(12);
    const count = Math.max(1, f1 - f0);
    for (let f = f0; f < Math.max(f0 + 1, f1) && f < fr.frames; f++) {
      for (let i = 0; i < CEPS; i++) t[i] += fr.ceps[f * CEPS + i] / count;
      t[CEPS] += fr.level[f] / count;
      for (let i = 0; i < 12; i++) c[i] += fr.chroma[f * 12 + i];
    }
    let norm = 0;
    for (let i = 0; i < 12; i++) norm += c[i] * c[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-9) for (let i = 0; i < 12; i++) c[i] /= norm;
    timbre.push(t);
    chroma.push(c);
  }
  // Timbre dimensions to zero mean and unit deviation across beats.
  if (n > 1) {
    for (let i = 0; i <= CEPS; i++) {
      let m = 0;
      for (const t of timbre) m += t[i];
      m /= n;
      let v = 0;
      for (const t of timbre) v += (t[i] - m) ** 2;
      const sd = Math.sqrt(v / n) || 1;
      for (const t of timbre) t[i] = (t[i] - m) / sd;
    }
  }
  onProgress?.(1);
  return { rate, length: full.length, bpm: tempo.bpm, period: tempo.period * fr.hop, beats, timbre, chroma };
}

/** Every `d` samples averaged into one (a box low-pass, enough for analysis). */
function decimate(x, d) {
  const out = new Float32Array(Math.ceil(x.length / d));
  for (let i = 0, o = 0; i < x.length; i += d, o++) {
    let s = 0;
    const end = Math.min(x.length, i + d);
    for (let j = i; j < end; j++) s += x[j];
    out[o] = s / (end - i);
  }
  return out;
}

// ------------------------------------------------------------ path search

function euclid(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function cosDist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return 1 - s;
}

/** Median of a sample of values (0 when empty). */
function median(values) {
  if (!values.length) return 0;
  const v = Float64Array.from(values).sort();
  return v[Math.floor(v.length / 2)];
}

/**
 * Beat-to-beat distance as fn(a, b), mixing timbre and harmony by `balance`
 * (0 timbre only, 1 harmony only). Each part is scaled by its median over
 * beat pairs so a distance of 1 is "typical" for this music.
 */
export function beatDistance(analysis, balance = 0.5) {
  const { timbre, chroma } = analysis;
  const n = timbre.length;
  const st = [];
  const sc = [];
  const step = Math.max(1, Math.floor((n * n) / 20000));
  for (let p = 0, q = 0; p < n * n; p += step, q++) {
    const a = Math.floor(p / n);
    const b = p % n;
    if (a === b) continue;
    st.push(euclid(timbre[a], timbre[b]));
    sc.push(cosDist(chroma[a], chroma[b]));
  }
  const mt = median(st) || 1;
  const mc = median(sc) || 1;
  const w = Math.max(0, Math.min(1, balance));
  // Filled on demand; NaN marks pairs not yet measured.
  const cache = new Float32Array(n * n).fill(NaN);
  return (a, b) => {
    if (a === b) return 0;
    const key = a < b ? a * n + b : b * n + a;
    let d = cache[key];
    if (Number.isNaN(d)) {
      d = ((1 - w) * euclid(timbre[a], timbre[b])) / mt + (w * cosDist(chroma[a], chroma[b])) / mc;
      cache[key] = d;
    }
    return d;
  };
}

/**
 * Jump candidates: for each beat i, up to `perBeat` beats j to continue from
 * after i (instead of i + 1), cheapest first: [{ to, cost }][]. Jumps land
 * at or after beat `first`, move at least two beats and at most `maxJump`
 * beats (0 = any). Moves that break the bar position cost `barPenalty` more.
 */
export function jumpCandidates(analysis, { balance = 0.5, first = 0, maxJump = 0, beatsPerBar = 4, perBeat = 16, barPenalty = 0.35 } = {}) {
  const n = analysis.beats.length;
  const d = beatDistance(analysis, balance);
  const at = (k) => Math.max(0, Math.min(n - 1, k));
  const out = Array.from({ length: n }, () => []);
  for (let i = Math.max(0, first); i < n - 1; i++) {
    const list = [];
    for (let j = Math.max(1, first); j < n; j++) {
      const shift = j - (i + 1);
      if (Math.abs(shift) < 2) continue;
      if (maxJump > 0 && Math.abs(shift) > maxJump) continue;
      // What we play next should match what would have come next, and what we just
      // played should match what normally leads into the new place.
      let cost = 0.4 * d(i + 1, j) + 0.4 * d(i, j - 1) + 0.2 * d(at(i - 1), at(j - 2));
      if (beatsPerBar > 1 && ((shift % beatsPerBar) + beatsPerBar) % beatsPerBar !== 0) cost += barPenalty;
      list.push({ to: j, cost });
    }
    list.sort((x, y) => x.cost - y.cost || x.to - y.to);
    out[i] = list.slice(0, perBeat);
  }
  return out;
}

/** Minimum segment length (beats) and cost per jump for an edit-length setting 0 (short) .. 1 (long). */
export function editShape(edit = 0.5) {
  const e = Math.max(0, Math.min(1, Number(edit) || 0));
  return { minRun: Math.round(2 + e * 14), jumpCost: 0.05 + e * 0.6 };
}

/** Most states the path search keeps (beats x beat counts) before it gives up. */
const MAX_STATES = 6e6;

/**
 * Finds a remix of the source from sample `start` to its end, about `target`
 * samples long. Returns { segments: [[a, b]] (source samples), length,
 * target, tolerance, fits, jumps, cost } or throws when the music has too
 * few beats after `start`.
 */
export function planRemix(analysis, { start = 0, target, edit = 0.5, balance = 0.5, maxJump = 0, beatsPerBar = 4, tolerance } = {}) {
  const { beats, length: end } = analysis;
  start = Math.max(0, Math.min(end, Math.round(start)));
  target = Math.max(1, Math.round(target));
  const n = beats.length;
  let k0 = 0;
  while (k0 < n && beats[k0] < start) k0++;
  const usable = n - k0;
  if (usable < 4) throw new Error('This clip has too few beats to remix. Remix works on music with a steady beat.');
  const lens = new Float64Array(n);
  for (let k = 0; k < n - 1; k++) lens[k] = beats[k + 1] - beats[k];
  // cum[k]: samples from beat 0 to beat k.
  const cum = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) cum[k + 1] = cum[k] + lens[k];
  const inner = Array.from(lens.subarray(k0, n - 1));
  const period = median(inner) || analysis.period || 1;
  const tol = tolerance ?? Math.max(period, Math.round(0.25 * analysis.rate));
  const pre = beats[k0] - start;
  const tail = end - beats[n - 1];
  const last = n - 1;
  const { minRun, jumpCost } = editShape(edit);
  const run = Math.max(1, Math.min(minRun, usable - 1));
  const cands = jumpCandidates(analysis, { balance, first: k0, maxJump, beatsPerBar });
  const K = n - k0;
  const search = (M) => {
    const W = M + 1;
    const size = K * W;
    const cost = new Float32Array(size).fill(Infinity);
    const frames = new Float64Array(size);
    const back = new Int32Array(size).fill(-1);
    const idx = (k, m) => (k - k0) * W + m;
    const relax = (from, k, m, c, f) => {
      if (m > M) return;
      const i = idx(k, m);
      if (c < cost[i] - 1e-9) {
        cost[i] = c;
        frames[i] = f;
        back[i] = from;
      }
    };
    // The first segment plays at least `run` beats (or to the end) before any jump.
    const r0 = Math.min(run, last - k0);
    relax(-1, k0 + r0, r0, 0, pre + cum[k0 + r0] - cum[k0]);
    for (let m = 0; m <= M; m++) {
      for (let k = k0; k < last; k++) {
        const i = idx(k, m);
        const c = cost[i];
        if (c === Infinity) continue;
        const f = frames[i] + lens[k];
        relax(i, k + 1, m + 1, c, f);
        for (const { to, cost: jc } of cands[k]) {
          // After a jump the music plays on for at least `run` beats, so the ending is never a fragment.
          if (to + run > last) continue;
          relax(i, to + run, m + 1 + run, c + jc + jumpCost, f + cum[to + run] - cum[to]);
        }
      }
    }
    return { cost, frames, back, idx, W };
  };
  // Beats the target asks for between the intro piece and the ending.
  const want = (target - pre - tail) / period;
  let M = Math.max(run + 2, Math.ceil(want + tol / period) + 2);
  let res = null;
  let pick = -1;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (K * (M + 1) > MAX_STATES) {
      if (res) break;
      throw new Error('The remix target is too long for this music. Try a shorter duration.');
    }
    res = search(M);
    // Endings: the last beat reached after m beats; the tail then plays to the source end.
    let best = Infinity;
    let closest = Infinity;
    let pickClose = -1;
    pick = -1;
    const mu = 0.15;
    for (let m = 0; m <= M; m++) {
      const i = res.idx(last, m);
      if (res.cost[i] === Infinity) continue;
      const len = res.frames[i] + tail;
      const dev = Math.abs(len - target);
      const score = res.cost[i] + (mu * dev) / period;
      if (dev <= tol && score < best) {
        best = score;
        pick = i;
      }
      if (dev < closest) {
        closest = dev;
        pickClose = i;
      }
    }
    if (pick >= 0) break;
    // Nothing long enough yet: search further (a long target with few ways back).
    const longest = Math.max(-1, ...Array.from({ length: M + 1 }, (_, m) => (res.cost[res.idx(last, m)] < Infinity ? m : -1)));
    if (pickClose >= 0 && (longest < 0 || res.frames[res.idx(last, longest)] + tail >= target)) {
      pick = pickClose;
      break;
    }
    pick = pickClose;
    M = Math.ceil(M * 1.6) + run;
  }
  if (pick < 0) throw new Error('No remix path reaches the end of this music.');
  // Walk back to the start, collecting the cuts.
  const { back, cost, frames, W } = res;
  const states = [];
  for (let i = pick; i >= 0; i = back[i]) states.push(i);
  states.reverse();
  const segments = [];
  let segStart = start;
  let jumps = 0;
  for (let s = 1; s < states.length; s++) {
    const kp = k0 + Math.floor(states[s - 1] / W);
    const mp = states[s - 1] % W;
    const k = k0 + Math.floor(states[s] / W);
    const m = states[s] % W;
    if (k === kp + 1 && m === mp + 1) continue;
    // A jump after beat kp, landing on beat `to` and playing on to beat k.
    const to = k - (m - mp - 1);
    segments.push([segStart, beats[kp + 1]]);
    segStart = beats[to];
    jumps++;
  }
  segments.push([segStart, end]);
  const length = segments.reduce((s, [a, b]) => s + b - a, 0);
  return { segments, length, target, tolerance: tol, fits: Math.abs(length - target) <= tol, jumps, cost: cost[pick], bpm: analysis.bpm, check: frames[pick] + tail };
}

// ----------------------------------------------------------------- render

/** Total length of segments [[a, b]] in samples. */
export const segmentsLength = (segments) => segments.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);

/**
 * Renders segments of `channels` (Float32Array[]) back to back, crossfading
 * each join over `xfade` samples centred on the cut with equal-power gains.
 */
export async function renderRemix(channels, segments, xfade, { signal, onProgress } = {}) {
  const n = channels[0]?.length ?? 0;
  const total = segmentsLength(segments);
  const outs = channels.map(() => new Float32Array(total));
  const half = Math.max(0, Math.floor(xfade / 2));
  // Overlap at each join, limited by the audio available on both sides.
  const joins = segments.slice(1).map(([a], p) => Math.max(0, Math.min(half, a, n - segments[p][1], segments[p][1] - segments[p][0], segments[p + 1][1] - a)));
  let pos = 0;
  for (let p = 0; p < segments.length; p++) {
    const [a, b] = segments[p];
    const hl = p > 0 ? joins[p - 1] : 0;
    const hr = p < segments.length - 1 ? joins[p] : 0;
    const from = a - hl;
    const to = Math.min(n, b + hr);
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const out = outs[c];
      for (let s = from; s < to; s++) {
        const o = pos + (s - a);
        if (o < 0 || o >= total || s < 0) continue;
        let g = 1;
        if (hl && s < a + hl) g = Math.sin((Math.PI / 2) * ((s - (a - hl) + 0.5) / (2 * hl)));
        else if (hr && s >= b - hr) g = Math.cos((Math.PI / 2) * ((s - (b - hr) + 0.5) / (2 * hr)));
        out[o] += src[s] * g;
      }
    }
    pos += b - a;
    if (p % 8 === 7) {
      checkAbort(signal);
      onProgress?.(pos / total);
      await pause();
    }
  }
  onProgress?.(1);
  return outs;
}
