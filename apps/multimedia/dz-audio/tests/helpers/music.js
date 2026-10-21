// Synthetic music for the remix tests: chords on a steady beat.

export const MUSIC_RATE = 16000;

/**
 * Synthetic music: a decaying chord on every beat with a noise click on top,
 * one chord per bar of four beats, cycling through `roots`. Deterministic.
 */
export function song({ rate = MUSIC_RATE, bpm = 120, bars = 16, roots = [220, 261.63, 329.63, 392], lead = 0 } = {}) {
  const beat = 60 / bpm;
  const n = Math.round(rate * (lead + bars * 4 * beat));
  const x = new Float32Array(n);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const t = i / rate - lead;
    if (t < 0) continue;
    const k = Math.floor(t / beat);
    const f = roots[Math.floor(k / 4) % roots.length];
    const tb = t - k * beat;
    const env = Math.exp(-tb * 7);
    // Root, fifth and octave; a short noise click marks the beat.
    x[i] = 0.25 * env * (Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * f * 1.5 * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) + (tb < 0.006 ? 0.5 * (rnd() * 2 - 1) : 0);
  }
  return x;
}

let cached = null;
/** The default song and its analysis (computed once per test file). */
export async function songAnalysis(analyzeMusic) {
  if (!cached) {
    const x = song();
    cached = { x, an: await analyzeMusic([x], MUSIC_RATE) };
  }
  return cached;
}
