// RMS histogram for Amplitude Statistics: how often each windowed RMS level
// occurs, in 1 dB bins from HIST_FLOOR to 0 dBFS (full-scale square wave).
// Quieter windows land in the bottom bin.

export const HIST_FLOOR = -120;
export const HIST_BINS = -HIST_FLOOR + 1;

/** Adds the RMS of every whole `win`-sample window of `x` to `hist` (Uint32Array of HIST_BINS). */
export function accumulateRmsHistogram(hist, x, win) {
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += x[j] * x[j];
    const rms = Math.sqrt(s / win);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const bin = Math.max(0, Math.min(HIST_BINS - 1, Math.round(db - HIST_FLOOR)));
    hist[bin]++;
  }
  return hist;
}

/** The level (dB) a histogram bin stands for. */
export const binDb = (bin) => HIST_FLOOR + bin;
