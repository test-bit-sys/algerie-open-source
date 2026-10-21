// Frequency axis for the spectral display and the frequency analysis plot.
// A scale maps a fraction of the lane height (0 = bottom, 1 = top) to Hz and
// back, linearly or logarithmically, over a visible range [lo, hi] that the
// vertical zoom narrows.

/** Lowest frequency a logarithmic axis shows (0 Hz has no logarithm). */
export const LOG_FLOOR_HZ = 20;

/**
 * @param {{ log: boolean, lo: number, hi: number }} o visible range in Hz
 * @returns {{ log, lo, hi, toFrac(f), toHz(frac) }}
 */
export function makeScale({ log, lo, hi }) {
  hi = Math.max(hi, 1);
  if (log) {
    lo = Math.max(LOG_FLOOR_HZ, Math.min(lo, hi / 2));
    const span = Math.log(hi / lo);
    return {
      log: true,
      lo,
      hi,
      toFrac: (f) => Math.log(Math.max(f, 1e-6) / lo) / span,
      toHz: (frac) => lo * Math.exp(frac * span),
    };
  }
  lo = Math.max(0, Math.min(lo, hi - 1));
  return {
    log: false,
    lo,
    hi,
    toFrac: (f) => (f - lo) / (hi - lo),
    toHz: (frac) => lo + frac * (hi - lo),
  };
}

/** Short ruler label: 950, 1k, 1.5k, 12k. */
export function formatHz(f) {
  if (f >= 1000) {
    const k = f / 1000;
    return `${Number.isInteger(k) ? k : k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(Math.round(f));
}

/** Readout text: "1,234 Hz" or "12.3 kHz". */
export function formatHzLong(f) {
  if (!Number.isFinite(f)) return '';
  if (f >= 10000) return `${(f / 1000).toFixed(1)} kHz`;
  return `${Math.round(f).toLocaleString('en-US')} Hz`;
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Nearest note name and cents offset, A4 = 440 Hz: { name: 'A4', cents: -3 }. */
export function noteName(f) {
  if (!(f > 0)) return null;
  const midi = 69 + 12 * Math.log2(f / 440);
  const n = Math.round(midi);
  const cents = Math.round((midi - n) * 100);
  return { name: `${NOTES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`, cents, midi: n };
}

/**
 * Tick marks for a ruler `height` px tall: { f, y, label } where y is px from
 * the top. Steps follow 1-2-5 decades on linear axes and octave-friendly
 * values on log axes, keeping at least `minGap` px between labels.
 */
export function frequencyTicks(scale, height, minGap = 18) {
  const yOf = (f) => (1 - scale.toFrac(f)) * height;
  const ticks = [];
  if (scale.log) {
    const candidates = [];
    for (let decade = 1; decade <= 100000; decade *= 10) {
      for (const m of [1, 1.5, 2, 3, 4, 5, 6, 7, 8]) candidates.push(decade * m);
    }
    // Prefer round values first so they win label space.
    const rank = (f) => {
      const d = Math.pow(10, Math.floor(Math.log10(f)));
      const m = f / d;
      return m === 1 ? 0 : m === 2 || m === 5 ? 1 : m === 3 ? 2 : 3;
    };
    const inRange = candidates.filter((f) => f >= scale.lo && f <= scale.hi);
    inRange.sort((a, b) => rank(a) - rank(b) || a - b);
    const taken = [];
    for (const f of inRange) {
      const y = yOf(f);
      if (y < 4 || y > height - 4) continue;
      if (taken.some((t) => Math.abs(t - y) < minGap)) continue;
      taken.push(y);
      ticks.push({ f, y, label: formatHz(f) });
    }
    ticks.sort((a, b) => a.f - b.f);
    return ticks;
  }
  const span = scale.hi - scale.lo;
  const maxTicks = Math.max(1, Math.floor(height / minGap));
  let step = 1;
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000]) {
    step = s;
    if (span / s <= maxTicks) break;
  }
  for (let f = Math.ceil(scale.lo / step) * step; f <= scale.hi; f += step) {
    const y = yOf(f);
    if (y < 4 || y > height - 4) continue;
    ticks.push({ f, y, label: formatHz(f) });
  }
  return ticks;
}

/**
 * Zooms the visible range around `centre` Hz by `factor` (< 1 zooms in),
 * in the axis' own space, clamped to [0, nyquist].
 */
export function zoomRange({ lo, hi }, factor, nyquist, log, centre = null) {
  const s = makeScale({ log, lo, hi });
  const c = centre ?? s.toHz(0.5);
  const cf = s.toFrac(c);
  const a = cf - cf * factor;
  const b = cf + (1 - cf) * factor;
  let nlo = s.toHz(a);
  let nhi = s.toHz(b);
  const min = log ? LOG_FLOOR_HZ : 0;
  // Keep at least a narrow band visible.
  if (nhi - nlo < 20) return { lo, hi };
  if (nlo <= min + 1e-6) nlo = 0;
  return { lo: Math.max(0, nlo), hi: Math.min(nyquist, nhi) };
}
