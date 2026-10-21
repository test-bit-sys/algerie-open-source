// Silence and audio detection shared by Delete Silence and Mark Audio.
// Levels come from the WASM peak kernel (5 ms windows), held over a short
// neighbourhood so low notes are not mistaken for gaps between their peaks.

const HOLD = 2; // windows either side

/** Window length in frames for detection. */
export function detectionWindow(rate) {
  return Math.max(1, Math.round(rate / 200));
}

/**
 * Peak level in dBFS per window, the loudest channel winning.
 * @param {import('../../audio/dsp.js').Dsp} dsp
 */
export function levelsDb(dsp, channels, win) {
  const len = channels[0].length;
  const n = Math.ceil(len / win);
  const peak = new Float32Array(n);
  for (const ch of channels) {
    const src = dsp.copyIn(ch);
    const out = dsp.floats(n);
    dsp.x.special_peaks(src.ptr, len, win, out.ptr);
    const v = out.view();
    for (let i = 0; i < n; i++) if (v[i] > peak[i]) peak[i] = v[i];
    src.free();
    out.free();
  }
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = Math.max(0, i - HOLD); k <= Math.min(n - 1, i + HOLD); k++) if (peak[k] > m) m = peak[k];
    db[i] = 20 * Math.log10(Math.max(m, 1e-10));
  }
  return db;
}

/**
 * Silent stretches as [start, end) frame pairs.
 * Silence: level below `silenceThreshold` dB for at least `silenceMin` ms.
 * Audio: level above `audioThreshold` dB for at least `audioMin` ms; louder
 * blips shorter than that do not interrupt a silence.
 */
export function findSilence(db, win, rate, len, { silenceThreshold, silenceMin, audioThreshold, audioMin }) {
  const n = db.length;
  const quiet = new Uint8Array(n);
  for (let i = 0; i < n; i++) quiet[i] = db[i] < silenceThreshold ? 1 : 0;
  const msWin = (ms) => Math.max(1, Math.round((ms * rate) / 1000 / win));
  const audioWin = msWin(audioMin);
  // Non-quiet runs without a long enough loud stretch count as silence.
  for (let i = 0; i < n; ) {
    if (quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    let best = 0;
    let cur = 0;
    while (j < n && !quiet[j]) {
      cur = db[j] >= audioThreshold ? cur + 1 : 0;
      if (cur > best) best = cur;
      j++;
    }
    if (best < audioWin) quiet.fill(1, i, j);
    i = j;
  }
  const minWin = msWin(silenceMin);
  const out = [];
  for (let i = 0; i < n; ) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && quiet[j]) j++;
    if (j - i >= minWin) out.push([i * win, Math.min(len, j * win)]);
    i = j;
  }
  return out;
}

/** Removes each silence but `keep` frames of it (half on each side). */
export function removeSilence(channels, silences, keep) {
  const len = channels[0].length;
  const half = Math.floor(keep / 2);
  const cuts = [];
  for (const [a, b] of silences) {
    const s = a === 0 ? 0 : a + half;
    const e = b === len ? len : b - (keep - half);
    if (e > s) cuts.push([s, e]);
  }
  const removed = cuts.reduce((t, [s, e]) => t + e - s, 0);
  return channels.map((ch) => {
    const out = new Float32Array(len - removed);
    let at = 0;
    let from = 0;
    for (const [s, e] of cuts) {
      out.set(ch.subarray(from, s), at);
      at += s - from;
      from = e;
    }
    out.set(ch.subarray(from), at);
    return out;
  });
}

/** Audio regions (the gaps between silences) as range markers, padded and merged. */
export function audioMarkers(silences, len, padding) {
  const regions = [];
  let at = 0;
  for (const [a, b] of silences) {
    if (a > at) regions.push([at, a]);
    at = b;
  }
  if (at < len) regions.push([at, len]);
  const merged = [];
  for (const [a, b] of regions) {
    const s = Math.max(0, a - padding);
    const e = Math.min(len, b + padding);
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.map(([s, e], i) => ({ start: s, duration: e - s, name: `Audio ${String(i + 1).padStart(2, '0')}`, type: 'cue' }));
}
