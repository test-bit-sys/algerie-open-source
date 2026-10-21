// Effect definitions: Reverb (WASM kinds 80..83, wasm/dsp/src/fx/reverb).

import { registerEffect } from '../registry.js';
import { num, db, hz, ms, pct, bool, choice, preset, dataId, biquadDb } from './util.js';
import { IMPULSES, generateImpulse, impulseLength, loadedImpulse, shapeLoadedImpulse, MAX_LOADED_SECONDS } from './reverb-impulses.js';

const GROUP = 'Reverb';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Extra time reported after the decay (fx/reverb/mod.rs TAIL_PAD_MS). */
const TAIL_PAD_MS = 250;

/** Tail of an algorithmic reverb: decay plus pre-delay plus padding (fx/reverb/mod.rs reverb_tail). */
export function reverbTail(decayMs, predelayMs, rate) {
  return Math.round(((decayMs + predelayMs + TAIL_PAD_MS) * rate) / 1000);
}

registerEffect({
  id: 'studioReverb',
  name: 'Studio Reverb',
  group: GROUP,
  kind: 80,
  params: [
    pct('roomSize', 'Room Size', 50),
    ms('decay', 'Decay', 100, 15000, 1500),
    pct('early', 'Early Reflections', 50),
    pct('width', 'Stereo Width', 100),
    hz('hfCut', 'High Frequency Cut', 20, 20000, 8000),
    hz('lfCut', 'Low Frequency Cut', 20, 4000, 80),
    pct('damping', 'Damping', 50),
    pct('diffusion', 'Diffusion', 80),
    pct('dry', 'Dry', 90, { section: 'Output Level' }),
    pct('wet', 'Wet', 40, { section: 'Output Level' }),
  ],
  presets: [
    preset('Default', { roomSize: 50, decay: 1500, early: 50, width: 100, hfCut: 8000, lfCut: 80, damping: 50, diffusion: 80, dry: 90, wet: 40 }),
    preset('Vocal Booth', { roomSize: 12, decay: 350, early: 70, width: 60, hfCut: 7000, lfCut: 150, damping: 70, diffusion: 60, dry: 100, wet: 25 }),
    preset('Bright Small Room', { roomSize: 25, decay: 700, early: 60, width: 90, hfCut: 14000, lfCut: 120, damping: 20, diffusion: 75, dry: 95, wet: 30 }),
    preset('Drum Room', { roomSize: 40, decay: 1100, early: 80, width: 100, hfCut: 10000, lfCut: 90, damping: 40, diffusion: 90, dry: 90, wet: 35 }),
    preset('Warm Hall', { roomSize: 80, decay: 2800, early: 40, width: 100, hfCut: 6000, lfCut: 60, damping: 65, diffusion: 90, dry: 85, wet: 40 }),
    preset('Endless Space', { roomSize: 100, decay: 9000, early: 20, width: 100, hfCut: 9000, lfCut: 50, damping: 40, diffusion: 100, dry: 70, wet: 55 }),
  ],
  tail: (v, rate) => reverbTail(clamp(v.decay, 50, 30000), 0, rate),
});

registerEffect({
  id: 'reverb',
  name: 'Reverb',
  group: GROUP,
  kind: 81,
  params: [
    ms('decay', 'Decay Time', 20, 15000, 2000),
    ms('preDelay', 'Pre-Delay', 0, 500, 20, { scale: 'linear' }),
    ms('attack', 'Attack Time', 0, 1000, 0, { scale: 'linear' }),
    hz('highCut', 'High Frequency Cut', 500, 20000, 7000),
    hz('lowCut', 'Low Frequency Cut', 10, 2000, 100),
    pct('diffusion', 'Diffusion', 80),
    pct('dry', 'Dry', 80, { max: 200, section: 'Output Level' }),
    pct('wet', 'Wet', 35, { max: 500, section: 'Output Level' }),
    pct('perception', 'Perception', 70, { max: 200, ends: ['Absorbent', 'Reflective'] }),
    bool('sumInputs', 'Sum Inputs', false, { section: 'Output Level' }),
  ],
  presets: [
    preset('Default', { decay: 2000, preDelay: 20, attack: 0, highCut: 7000, lowCut: 100, diffusion: 80, dry: 80, wet: 35 }),
    preset('Ambient Wash', { decay: 6000, preDelay: 40, attack: 150, highCut: 6000, lowCut: 150, diffusion: 100, dry: 70, wet: 60 }),
    preset('Slow Bloom', { decay: 3500, preDelay: 10, attack: 450, highCut: 8000, lowCut: 120, diffusion: 90, dry: 85, wet: 45 }),
    preset('Tight Space', { decay: 600, preDelay: 5, attack: 0, highCut: 10000, lowCut: 200, diffusion: 70, dry: 95, wet: 25 }),
    preset('Distant Voice', { decay: 2500, preDelay: 80, attack: 60, highCut: 3500, lowCut: 300, diffusion: 85, dry: 40, wet: 70 }),
    preset('Bright Splash', { decay: 1500, preDelay: 25, attack: 0, highCut: 16000, lowCut: 250, diffusion: 75, dry: 85, wet: 40 }),
  ],
  tail: (v, rate) => reverbTail(clamp(v.decay, 50, 30000) + clamp(v.attack, 0, 1000), clamp(v.preDelay, 0, 500), rate),
});

const COLOR = 'Coloration';
const OUT = 'Output Level';
const fullValues = (o) => ({
  decay: 1800, preDelay: 12, diffusion: 85, perception: 40, roomSize: 450, dimension: 1.5, hpCut: 60,
  lowShelfFreq: 180, lowShelfGain: 0, midFreq: 1200, midGain: 0, midQ: 1, highShelfFreq: 5000, highShelfGain: -3,
  dry: 90, reverb: 30, early: 25, location: 0, includeDirect: false, sumInputs: false, ...o,
});

/** Room dimensions [width, depth, height] in metres for a volume and width/depth ratio (fx/reverb/full.rs room). */
export function roomDimensions(volume, dim) {
  const v = clamp(volume, 5, 50000);
  const h = clamp(Math.cbrt(v) * 0.6, 2.4, 25);
  const d = Math.sqrt(v / h / clamp(dim, 0.1, 10));
  return [dim * d, d, h];
}

/**
 * A decay time (ms) that suits the room: Sabine's T60 = 0.161 V / A, with
 * the surfaces' absorption falling as Perception (liveliness) rises.
 */
export function decayForRoom(volume, dim, perception) {
  const [w, d, h] = roomDimensions(volume, dim);
  const surface = 2 * (w * d + w * h + d * h);
  const alpha = 0.35 - 0.27 * clamp(perception, 0, 100) / 100;
  return clamp(Math.round((1000 * 0.161 * volume) / (surface * alpha)), 100, 15000);
}

registerEffect({
  id: 'fullReverb',
  name: 'Full Reverb',
  group: GROUP,
  kind: 82,
  params: [
    ms('decay', 'Decay Time', 20, 15000, 1800, { section: 'Reverb' }),
    ms('preDelay', 'Pre-Delay Time', 0, 500, 12, { scale: 'linear', section: 'Reverb' }),
    pct('diffusion', 'Diffusion', 85, { section: 'Reverb' }),
    pct('perception', 'Perception', 40, { section: 'Reverb' }),
    num('roomSize', 'Room Size', 10, 20000, 450, 'm³', { step: 1, scale: 'log', section: 'Reverb' }),
    num('dimension', 'Dimension (width : depth)', 0.25, 4, 1.5, '', { step: 0.01, scale: 'log', section: 'Reverb' }),
    hz('hpCut', 'High Pass Cutoff', 10, 20000, 60, { section: 'Reverb' }),
    hz('lowShelfFreq', 'Low Shelf Frequency', 20, 1000, 180, { section: COLOR }),
    db('lowShelfGain', 'Low Shelf Level', -15, 15, 0, { section: COLOR }),
    hz('midFreq', 'Mid Band Frequency', 100, 10000, 1200, { section: COLOR }),
    db('midGain', 'Mid Band Level', -15, 15, 0, { section: COLOR }),
    num('midQ', 'Mid Band Q', 0.2, 10, 1, '', { step: 0.01, scale: 'log', section: COLOR }),
    hz('highShelfFreq', 'High Shelf Frequency', 1000, 20000, 5000, { section: COLOR }),
    db('highShelfGain', 'High Shelf Level', -15, 15, -3, { section: COLOR }),
    pct('dry', 'Dry', 90, { max: 200, section: OUT }),
    pct('reverb', 'Reverberation', 30, { max: 500, section: OUT }),
    pct('early', 'Early Reflections', 25, { max: 200, section: OUT }),
    num('location', 'Left/Right Location', -100, 100, 0, '%', { step: 1, section: 'Reverb' }),
    bool('includeDirect', 'Include Direct', false, { section: OUT }),
    bool('sumInputs', 'Sum Inputs', false, { section: OUT }),
  ],
  /** The colouration EQ applied to the reverb (fx/reverb/full.rs). */
  response(v, freqs, rate) {
    const out = new Float32Array(freqs.length);
    freqs.forEach((f, i) => {
      out[i] = biquadDb('low', v.lowShelfFreq, v.lowShelfGain, Math.SQRT1_2, f, rate) + biquadDb('peak', v.midFreq, v.midGain, v.midQ, f, rate) + biquadDb('high', v.highShelfFreq, v.highShelfGain, Math.SQRT1_2, f, rate);
    });
    return out;
  },
  presets: [
    preset('Default', fullValues({})),
    preset('Wood Panel Room', fullValues({ decay: 900, preDelay: 6, roomSize: 120, dimension: 1.3, perception: 55, lowShelfGain: 2, highShelfGain: -5, reverb: 25, early: 35 })),
    preset('Concert Stage', fullValues({ decay: 2400, preDelay: 22, roomSize: 6000, dimension: 1.6, perception: 30, midGain: 1, highShelfGain: -4, reverb: 35, early: 20 })),
    preset('Long Corridor', fullValues({ decay: 1600, preDelay: 8, roomSize: 300, dimension: 0.25, perception: 80, diffusion: 60, reverb: 30, early: 45 })),
    preset('Stone Church', fullValues({ decay: 5200, preDelay: 35, roomSize: 15000, dimension: 0.6, perception: 35, lowShelfGain: 3, highShelfGain: -6, reverb: 45, early: 20, dry: 80 })),
    preset('Bright Garage', fullValues({ decay: 1300, preDelay: 4, roomSize: 90, dimension: 1.8, perception: 70, highShelfGain: 4, midGain: 2, midFreq: 2500, reverb: 30, early: 40 })),
  ],
  tail: (v, rate) => reverbTail(clamp(v.decay, 50, 30000), clamp(v.preDelay, 0, 500), rate),
});

/** Level 1 block of the partitioned convolution (fx/reverb/convolution.rs B1). */
const CONVOLUTION_LATENCY = 256;
const impulseCache = new Map();

function impulseKey(v, rate) {
  return [Math.round(v.impulse), v.roomSize, v.dampLF, v.dampHF, rate];
}

/** Choice value of a loaded impulse (after the built-in ones). */
export const LOADED_IMPULSE = IMPULSES.length;

/** The impulse for the values (generated, or the loaded one shaped), cached by its shaping parameters. */
export function convolutionImpulse(v, rate) {
  const loaded = v.impulse === LOADED_IMPULSE ? loadedImpulse(v.impulseName) : null;
  // A loaded impulse missing after a reload falls back to the default room.
  const shaping = loaded ? v : { ...v, impulse: v.impulse === LOADED_IMPULSE ? 2 : v.impulse };
  const id = dataId([...impulseKey(shaping, rate), loaded ? v.impulseName : '']);
  let ir = impulseCache.get(id);
  if (!ir) {
    ir = loaded ? shapeLoadedImpulse(loaded, v, rate) : generateImpulse(shaping, rate);
    impulseCache.set(id, ir);
    // Keep only a few impulses (each can be a few megabytes).
    while (impulseCache.size > 4) impulseCache.delete(impulseCache.keys().next().value);
  }
  return { id, ir };
}

registerEffect({
  id: 'convolutionReverb',
  name: 'Convolution Reverb',
  group: GROUP,
  kind: 83,
  params: [
    choice('impulse', 'Impulse', [...IMPULSES.map((t) => t.label), 'Loaded Impulse'], 2),
    pct('mix', 'Mix', 35),
    pct('roomSize', 'Room Size', 100, { min: 10, max: 200 }),
    pct('dampLF', 'Damping LF', 0),
    pct('dampHF', 'Damping HF', 30),
    ms('preDelay', 'Pre-Delay', 0, 500, 0, { scale: 'linear' }),
    pct('width', 'Width', 100, { max: 300 }),
    db('gain', 'Gain', -24, 18, 0),
    // Surround Reverb's send and return controls (WASM params 8..10), left neutral here.
    pct('centerSend', 'Center Send', 100, { hidden: true }),
    pct('centerWet', 'Center Wet Level', 50, { hidden: true }),
    num('balance', 'Left/Right Balance', -100, 100, 0, '%', { step: 1, hidden: true }),
    { id: 'impulseName', label: 'Loaded Impulse File', type: 'text', default: '', hidden: true },
  ],
  presets: [
    preset('Default', { impulse: 2, mix: 35, roomSize: 100, dampLF: 0, dampHF: 30, preDelay: 0, width: 100, gain: 0 }),
    preset('Intimate Room', { impulse: 0, mix: 25, roomSize: 100, dampLF: 10, dampHF: 40, preDelay: 0, width: 90, gain: 0 }),
    preset('Orchestral Hall', { impulse: 3, mix: 30, roomSize: 110, dampLF: 0, dampHF: 35, preDelay: 18, width: 120, gain: 0 }),
    preset('Vintage Plate Vocals', { impulse: 5, mix: 28, roomSize: 90, dampLF: 30, dampHF: 20, preDelay: 25, width: 110, gain: 0 }),
    preset('Stone Cathedral', { impulse: 4, mix: 40, roomSize: 120, dampLF: 0, dampHF: 50, preDelay: 30, width: 130, gain: -1 }),
    preset('Tight Chamber Drums', { impulse: 6, mix: 22, roomSize: 70, dampLF: 20, dampHF: 25, preDelay: 0, width: 100, gain: 0 }),
  ],
  latency: () => CONVOLUTION_LATENCY,
  tail: (v, rate) => convolutionTail(v, rate),
  data: (v, { rate }) => {
    const { id, ir } = convolutionImpulse(v, rate);
    return [{ slot: 0, id, values: ir }];
  },
});

function convolutionTail(v, rate) {
  const loaded = v.impulse === LOADED_IMPULSE ? loadedImpulse(v.impulseName) : null;
  const len = loaded ? Math.min(MAX_LOADED_SECONDS * rate, (loaded.channels[0].length / loaded.rate) * rate * (clamp(v.roomSize, 10, 400) / 100)) : impulseLength(v.impulse === LOADED_IMPULSE ? { ...v, impulse: 2 } : v, rate);
  return Math.round(len) + Math.round((clamp(v.preDelay, 0, 500) * rate) / 1000);
}

// Surround Reverb: the convolution reverb with a send and return built for
// placing a source in a wider image: how much of the centre of the input
// reaches the room, the level of the centre of the reverb, its left/right
// balance and front width (fx/reverb/convolution.rs params 8..10).
registerEffect({
  id: 'surroundReverb',
  name: 'Surround Reverb',
  group: GROUP,
  kind: 83,
  params: [
    choice('impulse', 'Impulse', [...IMPULSES.map((t) => t.label), 'Loaded Impulse'], 4, { section: 'Reverb Settings' }),
    pct('mix', 'Mix', 100, { section: 'Output' }),
    pct('roomSize', 'Room Size', 100, { min: 10, max: 200, section: 'Reverb Settings' }),
    pct('dampLF', 'Damping LF', 70, { section: 'Reverb Settings' }),
    pct('dampHF', 'Damping HF', 73, { section: 'Reverb Settings' }),
    ms('preDelay', 'Pre-Delay', 0, 100, 0, { scale: 'linear', section: 'Reverb Settings' }),
    pct('width', 'Front Width', 100, { max: 300, section: 'Reverb Settings' }),
    db('gain', 'Gain', -18, 18, 0, { section: 'Output' }),
    pct('centerSend', 'Center', 100, { section: 'Input' }),
    pct('centerWet', 'Center Wet Level', 50, { section: 'Output' }),
    num('balance', 'Left/Right Balance', -100, 100, 0, '%', { step: 1, section: 'Output' }),
    { id: 'impulseName', label: 'Loaded Impulse File', type: 'text', default: '', hidden: true },
    // 5.1 (on 6-channel tracks and a 5.1 master): the LFE's share of the room's
    // input, the rear pair's width, and the reverb's front/back balance. On
    // stereo the rear folds into the output as the balance moves back.
    pct('lfeSend', 'LFE', 0, { section: 'Input' }),
    pct('surroundWidth', 'Surround Width', 100, { max: 300, section: 'Reverb Settings' }),
    num('fbBalance', 'Front/Back Balance', -100, 100, 0, '%', { step: 1, section: 'Output' }),
  ],
  // Processes all six channels of a 5.1 track or master.
  surround: true,
  presets: [
    preset('Default', {}),
    preset('Wide Hall Around Dialogue', { impulse: 3, mix: 35, centerSend: 40, centerWet: 30, width: 180 }),
    preset('Room Behind the Listener', { impulse: 1, mix: 45, roomSize: 80, centerWet: 20, width: 250 }),
    preset('Stage Left Ambience', { impulse: 6, mix: 40, balance: -60, width: 120 }),
    preset('Centered Plate', { impulse: 5, mix: 30, centerWet: 80, width: 60 }),
  ],
  latency: () => CONVOLUTION_LATENCY,
  tail: (v, rate) => convolutionTail(v, rate),
  data: (v, { rate }) => {
    const { id, ir } = convolutionImpulse(v, rate);
    return [{ slot: 0, id, values: ir }];
  },
});
