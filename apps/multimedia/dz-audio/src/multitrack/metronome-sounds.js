// Metronome click sounds, synthesized procedurally (no samples): each sound
// set has an accented click for the first beat of a bar and a normal click
// for the other beats. Noise comes from a seeded generator, so a sound is the
// same every time it is made.

export const METRONOME_SOUNDS = [
  { id: 'beep', label: 'Beep' },
  { id: 'woodblock', label: 'Woodblock' },
  { id: 'clave', label: 'Clave' },
  { id: 'cowbell', label: 'Cowbell' },
  { id: 'hihat', label: 'Hi-Hat' },
  { id: 'rimshot', label: 'Rimshot' },
  { id: 'shaker', label: 'Shaker' },
  { id: 'sticks', label: 'Sticks' },
  { id: 'kit', label: 'Drum Kit' },
  { id: 'tick', label: 'Tick' },
];

export const DEFAULT_METRONOME_SOUND = 'beep';

const TAU = 2 * Math.PI;

/** Deterministic white noise in [-1, 1). */
function noise(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    // xorshift32
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 2147483648 - 1;
  };
}

/** A decaying sine partial added into `out`. */
function partial(out, rate, freq, amp, decay, { attack = 0, sweepTo = null, sweepTime = 0.05 } = {}) {
  let phase = 0;
  const a = Math.max(1, Math.round(attack * rate));
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const f = sweepTo == null ? freq : sweepTo + (freq - sweepTo) * Math.exp(-t / sweepTime);
    phase += (TAU * f) / rate;
    const env = Math.exp(-t / decay) * Math.min(1, i / a);
    out[i] += amp * env * Math.sin(phase);
  }
}

/** Noise through a two-pole resonator at `freq` (Q about `q`), or high-passed when freq is null. */
function filteredNoise(out, rate, seed, amp, decay, { freq = null, q = 4, attack = 0.001, hp = 0 } = {}) {
  const rnd = noise(seed);
  const a = Math.max(1, Math.round(attack * rate));
  let y1 = 0;
  let y2 = 0;
  let prev = 0;
  let r = 0;
  let c1 = 0;
  let c2 = 0;
  let g = 1;
  if (freq) {
    const bw = freq / q;
    r = Math.exp((-Math.PI * bw) / rate);
    c1 = 2 * r * Math.cos((TAU * freq) / rate);
    c2 = -r * r;
    g = 1 - r;
  }
  const hpk = hp ? Math.exp((-TAU * hp) / rate) : 0;
  let hpy = 0;
  for (let i = 0; i < out.length; i++) {
    let x = rnd();
    if (freq) {
      const y = g * x + c1 * y1 + c2 * y2;
      y2 = y1;
      y1 = y;
      x = y * 4;
    }
    if (hp) {
      // One-pole high-pass: removes the low end so noise sounds like metal or seeds.
      hpy = hpk * (hpy + x - prev);
      prev = x;
      x = hpy;
    }
    const env = Math.exp(-i / rate / decay) * Math.min(1, i / a);
    out[i] += amp * env * x;
  }
}

/** Square-ish wave (first odd harmonics) with a decay, for bells and cymbals. */
function squarish(out, rate, freq, amp, decay, harmonics = 4) {
  for (let k = 0; k < harmonics; k++) {
    const n = 2 * k + 1;
    if (freq * n > rate / 2.2) break;
    partial(out, rate, freq * n, amp / n, decay);
  }
}

/** Scales a click so its peak is `peak`. */
function normalize(out, peak) {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  if (m > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / m;
  return out;
}

/**
 * One click of a sound set at `rate`. Accented clicks are higher and louder.
 * @param {string} id one of METRONOME_SOUNDS
 * @param {number} rate sample rate
 * @param {boolean} accent the first beat of a bar
 * @returns {Float32Array}
 */
export function clickSound(id, rate, accent) {
  const len = (s) => new Float32Array(Math.max(1, Math.round(s * rate)));
  const loud = accent ? 0.55 : 0.36;
  switch (id) {
    case 'woodblock': {
      const out = len(0.09);
      const f = accent ? 1250 : 940;
      partial(out, rate, f, 1, 0.022);
      partial(out, rate, f * 2.71, 0.35, 0.009);
      filteredNoise(out, rate, 11, 0.4, 0.003, { freq: f * 1.5, q: 2 });
      return normalize(out, loud);
    }
    case 'clave': {
      const out = len(0.12);
      const f = accent ? 2650 : 2300;
      partial(out, rate, f, 1, 0.035);
      partial(out, rate, f * 1.98, 0.12, 0.012);
      return normalize(out, loud);
    }
    case 'cowbell': {
      const out = len(0.3);
      const k = accent ? 1.12 : 1;
      squarish(out, rate, 562 * k, 0.6, 0.11);
      squarish(out, rate, 845 * k, 0.6, 0.07);
      // Quick initial drop gives the struck-metal attack.
      for (let i = 0; i < out.length; i++) out[i] *= 0.45 + 0.55 * Math.exp(-i / rate / 0.012);
      return normalize(out, loud * 0.9);
    }
    case 'hihat': {
      const out = len(accent ? 0.22 : 0.08);
      const decay = accent ? 0.07 : 0.025;
      for (const f of [317, 465, 541, 692, 805, 1030]) squarish(out, rate, f * 4, 0.3, decay, 3);
      filteredNoise(out, rate, 23, 0.8, decay, { hp: 7000 });
      return normalize(out, loud * 0.8);
    }
    case 'rimshot': {
      const out = len(0.1);
      partial(out, rate, accent ? 480 : 410, 0.7, 0.02);
      filteredNoise(out, rate, 31, 1, 0.012, { freq: accent ? 1900 : 1600, q: 3 });
      partial(out, rate, 1700, 0.3, 0.008);
      return normalize(out, loud);
    }
    case 'shaker': {
      const out = len(accent ? 0.14 : 0.09);
      filteredNoise(out, rate, accent ? 41 : 43, 1, accent ? 0.04 : 0.025, { hp: 4500, attack: 0.012 });
      return normalize(out, loud * 0.75);
    }
    case 'sticks': {
      const out = len(0.06);
      const f = accent ? 2600 : 2200;
      filteredNoise(out, rate, 53, 1, 0.006, { freq: f, q: 6 });
      partial(out, rate, f * 0.62, 0.5, 0.01);
      return normalize(out, loud);
    }
    case 'kit': {
      if (accent) {
        // Kick: a falling sine with a short beater click.
        const out = len(0.35);
        partial(out, rate, 150, 1, 0.16, { sweepTo: 48, sweepTime: 0.03 });
        filteredNoise(out, rate, 61, 0.15, 0.002, { freq: 3000, q: 1 });
        return normalize(out, 0.6);
      }
      const out = len(0.08);
      filteredNoise(out, rate, 67, 1, 0.022, { hp: 8000 });
      return normalize(out, 0.3);
    }
    case 'tick': {
      const out = len(0.02);
      const f = accent ? 4200 : 3300;
      partial(out, rate, f, 1, 0.0025);
      out[0] += 0.5;
      return normalize(out, loud * 0.9);
    }
    default: {
      // Beep: a short sine blip (the original metronome sound).
      const out = len(0.03);
      const freq = accent ? 1760 : 1320;
      const amp = accent ? 0.5 : 0.32;
      const n = out.length;
      for (let i = 0; i < n; i++) out[i] = amp * Math.exp(-i / (n / 5)) * Math.sin((TAU * freq * i) / rate);
      return out;
    }
  }
}
