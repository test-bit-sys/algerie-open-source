// Biquad filter math for drawing EQ curves: RBJ cookbook coefficients and the
// magnitude response, computed in JS (cheap: a few hundred frequencies per
// band). Matches the filter shapes the DSP side implements.

export const FILTER_TYPES = ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch'];

/** Normalised coefficients { b0, b1, b2, a1, a2 } (a0 = 1). */
export function biquadCoefficients(type, freq, gainDb, q, rate) {
  const f = Math.min(Math.max(freq, 1), rate * 0.499);
  const w0 = (2 * Math.PI * f) / rate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const Q = Math.max(0.025, q || 0.707);
  const alpha = sin / (2 * Q);
  const A = Math.pow(10, (gainDb || 0) / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1; b1 = -2 * cos; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
    default: // peaking
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Magnitude in dB of a biquad at frequency f. */
export function magnitudeDb(c, f, rate) {
  const w = (2 * Math.PI * f) / rate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  const mag2 = (nr * nr + ni * ni) / (dr * dr + di * di || 1e-30);
  return 10 * Math.log10(Math.max(mag2, 1e-12));
}

/** Log-spaced frequencies from lo to hi. */
export function logFrequencies(n = 256, lo = 20, hi = 20000) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = lo * Math.pow(hi / lo, i / (n - 1));
  return out;
}

/**
 * Combined response in dB of bands [{ type, freq, gain, q, enabled, order }]
 * at each frequency. `order` > 1 cascades a pass filter (steeper slopes).
 */
export function combinedResponse(bands, freqs, rate, offsetDb = 0) {
  const out = new Float64Array(freqs.length).fill(offsetDb);
  for (const b of bands) {
    if (b.enabled === false) continue;
    const c = biquadCoefficients(b.type, b.freq, b.gain, b.q, rate);
    const stages = Math.max(1, Math.round(b.order || 1));
    for (let i = 0; i < freqs.length; i++) out[i] += stages * magnitudeDb(c, freqs[i], rate);
  }
  return out;
}

/** Q of a peaking band one `octaves` wide (graphic EQ bands). */
export function qForBandwidth(octaves) {
  const p = Math.pow(2, octaves);
  return Math.sqrt(p) / (p - 1);
}

/** Maps a type label or value ("Low Shelf", "HP", 3...) to a FILTER_TYPES name. */
export function filterTypeFromLabel(label) {
  const s = String(label).toLowerCase().replace(/[\s_-]/g, '');
  if (/lowshelf|lowshelving|ls$/.test(s)) return 'lowshelf';
  if (/highshelf|highshelving|hs$/.test(s)) return 'highshelf';
  if (/lowpass|^lp|highcut/.test(s)) return 'lowpass';
  if (/highpass|^hp|lowcut/.test(s)) return 'highpass';
  if (/bandpass|^bp/.test(s)) return 'bandpass';
  if (/notch|bandreject|bandstop/.test(s)) return 'notch';
  return 'peaking';
}
