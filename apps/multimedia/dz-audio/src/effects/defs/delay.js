// Effect definitions: Delay and Echo (WASM kinds 60..62, wasm/dsp/src/fx/delay).

import { registerEffect } from '../registry.js';
import { num, db, ms, pct, bool, choice, section, preset } from './util.js';

const GROUP = 'Delay and Echo';

/** Longest tail any feedback effect reports, in seconds (fx/delay/mod.rs). */
export const MAX_TAIL_SECONDS = 30;

/**
 * Frames until a feedback loop with per-pass gain `g` and pass length `delay`
 * frames decays by 60 dB, capped. Mirrors feedback_tail in fx/delay/mod.rs.
 */
export function feedbackTail(delay, g, rate) {
  const cap = MAX_TAIL_SECONDS * rate;
  let t;
  if (g <= 1e-3) t = delay;
  else if (g >= 0.999) t = cap;
  else t = delay * (Math.ceil(-3 / Math.log10(g)) + 1);
  return Math.round(Math.max(0, Math.min(cap, t)));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Most negative Delay time (fx/delay/simple.rs MAX_NEG_MS). */
const MAX_NEG_MS = 500;

/** Rust util::ms_frames in f32 arithmetic. */
function msFrames(msValue, rate) {
  return Math.round(Math.fround(Math.fround(Math.fround(Math.max(0, msValue)) * Math.fround(0.001)) * Math.fround(rate)));
}

registerEffect({
  id: 'delay',
  name: 'Delay',
  group: GROUP,
  kind: 60,
  about: 'Delays each channel on its own. A negative time moves that channel earlier than the other; the mix blends the delayed copy with the original.',
  params: [
    ...section('Left Channel', 'left', [ms('delay', 'Delay Time', -MAX_NEG_MS, 2000, 250, { scale: 'linear', step: 0.1 }), pct('mix', 'Mix', 50, { ends: ['Dry', 'Wet'] }), bool('invert', 'Invert')]),
    ...section('Right Channel', 'right', [ms('delay', 'Delay Time', -MAX_NEG_MS, 2000, 250, { scale: 'linear', step: 0.1 }), pct('mix', 'Mix', 50, { ends: ['Dry', 'Wet'] }), bool('invert', 'Invert')]),
  ],
  // Negative times hold every path back by the earliest one (fx/delay/simple.rs).
  latency: (v, rate) => msFrames(-Math.min(clamp(v.leftDelay, -MAX_NEG_MS, 2000), clamp(v.rightDelay, -MAX_NEG_MS, 2000), 0), rate),
  presets: [
    preset('Default', { leftDelay: 250, leftMix: 50, leftInvert: false, rightDelay: 250, rightMix: 50, rightInvert: false }),
    preset('Quick Slapback', { leftDelay: 90, leftMix: 35, leftInvert: false, rightDelay: 105, rightMix: 35, rightInvert: false }),
    preset('Stereo Doubler', { leftDelay: 12, leftMix: 45, leftInvert: false, rightDelay: 23, rightMix: 45, rightInvert: false }),
    preset('Haas Widener', { leftDelay: 0, leftMix: 0, leftInvert: false, rightDelay: 18, rightMix: 100, rightInvert: false }),
    preset('Long Throw', { leftDelay: 500, leftMix: 40, leftInvert: false, rightDelay: 750, rightMix: 40, rightInvert: false }),
    preset('Flip Right Polarity', { leftDelay: 0, leftMix: 0, leftInvert: false, rightDelay: 0, rightMix: 100, rightInvert: true }),
    preset('Left Leads by 15 ms', { leftDelay: -15, leftMix: 100, leftInvert: false, rightDelay: 0, rightMix: 100, rightInvert: false }),
  ],
  tail: (v, rate) => Math.round((Math.max(clamp(v.leftDelay, 0, 2000), clamp(v.rightDelay, 0, 2000)) / 1000) * rate),
});

export const ECHO_BANDS = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
const bandLabel = (f) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);
const eqValues = (gains) => Object.fromEntries(gains.map((g, i) => [`eq${i}`, g]));

registerEffect({
  id: 'echo',
  name: 'Echo',
  group: GROUP,
  kind: 61,
  params: [
    ...section('Left Channel', 'left', [ms('delay', 'Delay Time', 1, 5000, 300), pct('feedback', 'Feedback', 40), pct('level', 'Echo Level', 60)]),
    // Locked, the right channel follows the left settings.
    ...section('Right Channel', 'right', [ms('delay', 'Delay Time', 1, 5000, 300), pct('feedback', 'Feedback', 40), pct('level', 'Echo Level', 60)]).map((p) => ({ ...p, enabledIf: (v) => !v.lock })),
    bool('lock', 'Lock Left and Right', true),
    bool('bounce', 'Echo Bounce', false),
    ...ECHO_BANDS.map((f, i) => db(`eq${i}`, bandLabel(f), -24, 15, 0, { section: 'Successive Echo Equalizer', short: bandLabel(f).replace(' Hz', '').replace(' kHz', 'k') })),
    pct('dry', 'Dry Level', 100),
  ],
  about: 'Repeats the sound with each echo quieter than the last. The equalizer shapes every repeat again, so echoes darken or thin out as they fade; Echo Bounce alternates them between the channels.',
  layout: { wide: true, columns: [['Left Channel', 'Right Channel'], ['Successive Echo Equalizer']], vertical: ['Successive Echo Equalizer'] },
  presets: [
    preset('Default', { leftDelay: 300, leftFeedback: 40, leftLevel: 60, lock: true, bounce: false, dry: 100, ...eqValues([0, 0, 0, 0, 0, 0, 0, 0]) }),
    preset('Canyon Call', { leftDelay: 700, leftFeedback: 55, leftLevel: 50, lock: true, bounce: true, dry: 100, ...eqValues([-2, 0, 0, 0, -1, -3, -6, -9]) }),
    preset('Ping Pong Eighths', { leftDelay: 250, leftFeedback: 50, leftLevel: 55, lock: true, bounce: true, dry: 100, ...eqValues([-3, 0, 0, 0, 0, 0, -2, -4]) }),
    preset('Phone Line Repeats', { leftDelay: 380, leftFeedback: 45, leftLevel: 60, lock: true, bounce: false, dry: 100, ...eqValues([-24, -12, -3, 3, 3, -3, -12, -24]) }),
    preset('Short Room Slap', { leftDelay: 75, leftFeedback: 12, leftLevel: 40, lock: true, bounce: false, dry: 100, ...eqValues([0, 0, 0, 0, 0, -2, -4, -6]) }),
    preset('Wide Offset Echoes', { leftDelay: 330, leftFeedback: 35, leftLevel: 50, rightDelay: 495, rightFeedback: 35, rightLevel: 50, lock: false, bounce: false, dry: 100, ...eqValues([0, 0, 0, 0, 0, -1, -3, -6]) }),
  ],
  tail: (v, rate) => {
    const delayMs = v.lock ? v.leftDelay : Math.max(v.leftDelay, v.rightDelay);
    const fb = (v.lock ? v.leftFeedback : Math.max(v.leftFeedback, v.rightFeedback)) / 100;
    let boost = 0;
    for (let i = 0; i < ECHO_BANDS.length; i++) boost = Math.max(boost, v[`eq${i}`] ?? 0);
    return feedbackTail((clamp(delayMs, 1, 5000) / 1000) * rate, clamp(fb, 0, 1) * 10 ** (boost / 20), rate);
  },
});

/** Right channel delay is longer by up to this fraction at 200 % spread (fx/delay/analog.rs). */
const SPREAD_OFFSET = 0.08;

registerEffect({
  id: 'analogDelay',
  name: 'Analog Delay',
  group: GROUP,
  kind: 62,
  about: 'A delay with the character of tape and bucket-brigade units: repeats lose highs and pick up grit (Trash) as they feed back, and Spread pulls the channels apart in time.',
  params: [
    choice('mode', 'Mode', ['Tape', 'Tape and Tube', 'Analog'], 0),
    pct('dry', 'Dry Out', 80, { max: 200 }),
    pct('wet', 'Wet Out', 50, { max: 200 }),
    ms('delay', 'Delay', 10, 8000, 350),
    pct('feedback', 'Feedback', 45, { max: 200 }),
    pct('trash', 'Trash', 0),
    pct('spread', 'Spread', 100, { max: 200 }),
    num('lowCut', 'Low Cut', 10, 2000, 80, 'Hz', { step: 1, scale: 'log' }),
    num('highCut', 'High Cut', 500, 20000, 6000, 'Hz', { step: 1, scale: 'log' }),
  ],
  presets: [
    preset('Default', { mode: 0, dry: 80, wet: 50, delay: 350, feedback: 45, trash: 0, spread: 100, lowCut: 80, highCut: 6000 }),
    preset('Warm Tape Slap', { mode: 0, dry: 100, wet: 45, delay: 110, feedback: 15, trash: 10, spread: 60, lowCut: 120, highCut: 5000 }),
    preset('Runaway Dub Spiral', { mode: 2, dry: 90, wet: 70, delay: 420, feedback: 108, trash: 35, spread: 140, lowCut: 200, highCut: 3000 }),
    preset('Lo-Fi Bucket Brigade', { mode: 2, dry: 85, wet: 60, delay: 280, feedback: 55, trash: 45, spread: 80, lowCut: 150, highCut: 2500 }),
    preset('Tube Echo Wash', { mode: 1, dry: 85, wet: 55, delay: 520, feedback: 70, trash: 25, spread: 180, lowCut: 90, highCut: 7000 }),
    preset('Tight Doubling', { mode: 0, dry: 100, wet: 60, delay: 28, feedback: 0, trash: 0, spread: 150, lowCut: 60, highCut: 12000 }),
  ],
  tail: (v, rate) => {
    const spread = clamp(v.spread / 100, 0, 2);
    const longest = clamp(v.delay, 5, 8000) * (1 + SPREAD_OFFSET * spread) * 1.003;
    return feedbackTail((longest / 1000) * rate, clamp(v.feedback / 100, 0, 2), rate);
  },
});
