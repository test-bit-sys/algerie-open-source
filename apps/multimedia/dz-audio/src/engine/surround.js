// 5.1 surround helpers for the mix core: the speaker layout, the surround
// panner that places a mono or stereo track in the 5.1 field, and the stereo
// downmix used for monitoring.
//
// Channel order is the WAV/SMPTE order: L, R, C, LFE, Ls, Rs.
//
// Panner parameters (track.surround):
//   angle   -180..180 degrees, where the source sits (0 = front centre, + = right)
//   spread  0..180 degrees between a stereo track's left and right inputs
//   radius  0..100 %: 100 places the source at the speakers, 0 in the middle
//           of the room (every main speaker equally)
//   center  0..100 %: how much of a front-centre source the centre speaker
//           carries; the rest goes to L and R as a phantom centre
//   lfe     0..100 %: level of the track sent to the LFE channel
// Between two neighbouring speakers the source is panned with a sine/cosine
// (constant power) law; the result is normalised to constant power.

export const SURROUND_CHANNELS = 6;
export const SURROUND_LABELS = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];
export const SURROUND_DEFAULTS = { angle: 0, spread: 60, radius: 100, center: 100, lfe: 0 };

/** Main speakers round the circle, by azimuth: [channel, degrees]. */
export const SPEAKERS = [
  [4, -110],
  [0, -30],
  [2, 0],
  [1, 30],
  [5, 110],
];

const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);

/** Panner settings completed with defaults and clamped. */
export function normSurround(s = {}) {
  const d = SURROUND_DEFAULTS;
  return {
    angle: clamp(s?.angle, -180, 180, d.angle),
    spread: clamp(s?.spread, 0, 180, d.spread),
    radius: clamp(s?.radius, 0, 100, d.radius),
    center: clamp(s?.center, 0, 100, d.center),
    lfe: clamp(s?.lfe, 0, 100, d.lfe),
  };
}

const wrap = (a) => {
  let x = ((a + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
};

/** Speaker gains (6 channels, LFE excluded) for one source at `angle` degrees. */
export function pointGains(angle, radius = 100, center = 100, out = new Float32Array(6)) {
  out.fill(0);
  const az = wrap(angle);
  // Find the pair of neighbouring speakers around az (the last pair wraps Rs -> Ls).
  let a = SPEAKERS[SPEAKERS.length - 1];
  let b = SPEAKERS[0];
  let span = b[1] + 360 - a[1];
  let pos = az >= a[1] ? az - a[1] : az + 360 - a[1];
  for (let i = 0; i < SPEAKERS.length - 1; i++) {
    const p = SPEAKERS[i];
    const q = SPEAKERS[i + 1];
    if (az >= p[1] && az <= q[1]) {
      a = p;
      b = q;
      span = q[1] - p[1];
      pos = az - p[1];
      break;
    }
  }
  const f = Math.max(0, Math.min(1, pos / span));
  out[a[0]] += Math.cos((f * Math.PI) / 2);
  out[b[0]] += Math.sin((f * Math.PI) / 2);
  // Centre share: what the centre speaker does not carry becomes a phantom centre.
  const c = center / 100;
  const g = out[2];
  if (g && c < 1) {
    out[2] = g * c;
    out[0] += g * (1 - c) * Math.SQRT1_2;
    out[1] += g * (1 - c) * Math.SQRT1_2;
  }
  // Radius: blend towards every main speaker equally (the middle of the room).
  const r = radius / 100;
  if (r < 1) {
    const room = 1 / Math.sqrt(5);
    for (const [ch] of SPEAKERS) out[ch] = out[ch] * r + room * (1 - r) * (ch === 2 ? c : 1);
  }
  let power = 0;
  for (let i = 0; i < 6; i++) power += out[i] * out[i];
  const k = power > 0 ? 1 / Math.sqrt(power) : 0;
  // Drop the rounding residue of cos(pi/2) so a speaker that should be silent is.
  for (let i = 0; i < 6; i++) out[i] = out[i] * k < 1e-7 ? 0 : out[i] * k;
  return out;
}

/**
 * Gain vectors (one Float32Array(6) per input channel) for a track with
 * `inputs` channels (1 or 2) under panner settings `s`.
 */
export function surroundMatrix(s, inputs = 2) {
  const p = normSurround(s);
  const lfe = p.lfe / 100;
  const at = inputs === 1 ? [p.angle] : [p.angle - p.spread / 2, p.angle + p.spread / 2];
  return at.map((angle) => {
    const g = pointGains(angle, p.radius, p.center);
    // A stereo pair shares the LFE send.
    g[3] = inputs === 1 ? lfe : lfe * Math.SQRT1_2;
    return g;
  });
}

/** Stereo monitoring downmix of 6-channel planar audio: L + 0.707 (C + Ls), R + 0.707 (C + Rs); LFE left out. */
export function downmixStereo(src, dst, frames, offset = 0) {
  const k = Math.SQRT1_2;
  const [L, R, C, , Ls, Rs] = src;
  const dL = dst[0];
  const dR = dst[1];
  for (let i = 0; i < frames; i++) {
    dL[offset + i] = L[i] + k * (C[i] + Ls[i]);
    dR[offset + i] = R[i] + k * (C[i] + Rs[i]);
  }
}

/** Where a source's channels go in a 5.1 track: 6 channels map straight, stereo to L/R, mono to C. */
export function channelMap(srcChannels) {
  if (srcChannels >= 6) return [0, 1, 2, 3, 4, 5];
  if (srcChannels === 1) return [-1, -1, 0, -1, -1, -1];
  return [0, 1, -1, -1, -1, -1];
}
