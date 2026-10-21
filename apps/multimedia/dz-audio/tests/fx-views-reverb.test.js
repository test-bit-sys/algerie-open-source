import { describe, it, expect } from 'vitest';
import './fx-wasm.js';
import '../src/effects/catalog.js';
import '../src/effects/views/index.js';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect, paramArray, slotSpec, defaults } from '../src/effects/registry.js';
import { openEffectDialog } from '../src/effects/dialog.js';
import { normalizeValues } from '../src/effects/params.js';
import { roomDimensions, decayForRoom, convolutionImpulse, LOADED_IMPULSE } from '../src/effects/defs/reverb.js';
import { setLoadedImpulse, shapeLoadedImpulse } from '../src/effects/defs/reverb-impulses.js';
import { dsp } from '../src/audio/dsp.js';
import { fakeApp, filled } from './fx-helpers.js';

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

function setup() {
  const app = fakeApp();
  const doc = new AudioFile({ name: 'a.wav', sampleRate: 48000, channels: [Channel.fromSamples(filled(4800, 0.1)), Channel.fromSamples(filled(4800, 0.1))] });
  app.active = doc;
  return { app, doc };
}

describe('full reverb room', () => {
  it('derives room dimensions and a decay that grows with the room', () => {
    const [w, d, hgt] = roomDimensions(500, 2);
    expect(w * d * hgt).toBeCloseTo(500, 0);
    expect(w / d).toBeCloseTo(2);
    expect(decayForRoom(8000, 1.5, 40)).toBeGreaterThan(decayForRoom(100, 1.5, 40));
    expect(decayForRoom(500, 1.5, 100)).toBeGreaterThan(decayForRoom(500, 1.5, 0));
  });
  it('draws the coloration curve from the definition', () => {
    const def = getEffect('fullReverb');
    const v = { ...defaults(def), highShelfGain: -9, lowShelfGain: 0, midGain: 0 };
    const [lo, hi] = def.response(v, [100, 15000], 48000);
    expect(lo).toBeCloseTo(0, 0);
    expect(hi).toBeLessThan(-6);
  });
  it('lays out tabs and output faders, and sets the decay from the room', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('fullReverb'), { doc, values: { roomSize: 8000, decay: 500 } });
    const dlg = document.querySelector('.fx-dialog');
    expect([...dlg.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Reverb Settings', 'Coloration']);
    expect(dlg.querySelectorAll('.rv-faders .fx-vrange')).toHaveLength(3);
    expect(dlg.querySelectorAll('.fx-response .fx-handle')).toHaveLength(3);
    [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Set Decay From Room Size').click();
    dlg.querySelector('.btn.primary').click();
    const v = await p;
    expect(v.decay).toBe(decayForRoom(8000, v.dimension, v.perception));
    expect(v.decay).toBeGreaterThan(500);
  });
});

describe('loaded impulses', () => {
  const click = { rate: 24000, channels: [Float32Array.from({ length: 2400 }, (_, i) => (i === 0 ? 1 : Math.exp(-i / 300) * Math.sin(i)))] };
  it('shapes a loaded impulse: resampled, scaled by room size, normalised', () => {
    const ir = shapeLoadedImpulse(click, { roomSize: 100 }, 48000);
    expect(ir[0]).toBe(1);
    expect(ir.length - 1).toBeGreaterThan(4700);
    const big = shapeLoadedImpulse(click, { roomSize: 200 }, 48000);
    expect(big.length).toBeGreaterThan(ir.length * 1.8);
    expect(rms(ir.subarray(1)) * Math.sqrt(ir.length - 1)).toBeCloseTo(1, 3);
  });
  it('uses the loaded impulse when selected and falls back when it is missing', () => {
    setLoadedImpulse('click.wav', click);
    const v = { ...defaults(getEffect('convolutionReverb')), impulse: LOADED_IMPULSE, impulseName: 'click.wav' };
    const a = convolutionImpulse(v, 48000);
    const missing = convolutionImpulse({ ...v, impulseName: 'gone.wav' }, 48000);
    const hall = convolutionImpulse({ ...v, impulse: 2 }, 48000);
    expect(a.ir[0]).toBe(1);
    expect(missing.ir.length).toBe(hall.ir.length);
    expect(a.id).not.toBe(hall.id);
  });
});

describe('surround reverb', () => {
  it('balances the reverb and leaves convolution reverb unchanged by default', async () => {
    const d = await dsp();
    const def = getEffect('surroundReverb');
    const x = Float32Array.from({ length: 24000 }, (_, i) => 0.3 * Math.sin(i / 7) * (i < 2400 ? 1 : 0));
    const run = (values) => d.runEffect(def.kind, 48000, [x, x], paramArray(def, normalizeValues(def, values)), { data: slotSpec(def, normalizeValues(def, values)).data, tail: 0 });
    const [l, r] = run({ mix: 100, balance: 100 });
    expect(rms(l.subarray(3000))).toBeLessThan(rms(r.subarray(3000)) * 0.05);
    const conv = getEffect('convolutionReverb');
    const p = paramArray(conv, defaults(conv));
    expect(p.slice(8, 11)).toEqual([100, 50, 0]);
    // Stereo: front/back balance at the front (or centred) leaves the output as it was; toward the back it changes it.
    const [l0] = run({ mix: 100 });
    const [l1] = run({ mix: 100, fbBalance: -60 });
    const [l2] = run({ mix: 100, fbBalance: 80 });
    expect(Array.from(l1)).toEqual(Array.from(l0));
    expect(rms(l2.map((v, i) => v - l0[i]))).toBeGreaterThan(rms(l0) * 0.1);
  });
  it('shows input, settings and output boxes with faders', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('surroundReverb'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    expect([...dlg.querySelectorAll('.fx-group-title')].map((l) => l.textContent)).toEqual(['Input', 'Reverb Settings', 'Output']);
    expect([...dlg.querySelectorAll('.rv-faders .fx-vfader-label')].map((l) => l.textContent)).toEqual(['Center', 'LFE', 'C Wet', 'L/R Bal', 'F/B Bal', 'Mix', 'Gain']);
    expect([...dlg.querySelectorAll('input[type=range]')].some((r) => r.getAttribute('aria-label') === 'Surround Width')).toBe(true);
    expect([...dlg.querySelectorAll('.btn')].some((b) => b.textContent === 'Load...')).toBe(true);
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
});
