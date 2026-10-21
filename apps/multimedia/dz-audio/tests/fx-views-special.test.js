import { describe, it, expect } from 'vitest';
import './fx-wasm.js';
import '../src/effects/catalog.js';
import '../src/effects/views/index.js';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect, paramArray, slotSpec, defaults } from '../src/effects/registry.js';
import { openEffectDialog } from '../src/effects/dialog.js';
import { autoEditor } from '../src/effects/editors.js';
import { normalizeValues } from '../src/effects/params.js';
import { dsp } from '../src/audio/dsp.js';
import { drawnCurveTable, DRAWN, TABLE_OCTAVES, TABLE_STEPS, tableInput } from '../src/effects/defs/special.js';
import { presetCurve, presetPoints, curveAxes, visiblePoints } from '../src/effects/views/distortion.js';
import { dopplerPosition, dopplerRatio } from '../src/effects/views/special.js';
import { fakeApp, filled } from './fx-helpers.js';

function setup() {
  const app = fakeApp();
  const doc = new AudioFile({ name: 'a.wav', sampleRate: 48000, channels: [Channel.fromSamples(filled(48000, 0.1)), Channel.fromSamples(filled(48000, 0.1))] });
  app.active = doc;
  return { app, doc };
}

const sine = (f, rate, n, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / rate));
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('drawn distortion curves', () => {
  it('tables a unity curve as the identity and holds the end', () => {
    const t = drawnCurveTable([{ x: -120, y: -120 }, { x: 0, y: 0 }]);
    expect(t).toHaveLength(TABLE_OCTAVES * TABLE_STEPS + 1);
    expect(t[0]).toBeCloseTo(2 ** -20, 9);
    expect(t[(TABLE_OCTAVES - 1) * TABLE_STEPS + 64]).toBeCloseTo(0.75, 5);
    expect(t.at(-1)).toBeCloseTo(1, 5);
  });
  it('follows the points in dB and keeps the first gain below them', () => {
    const t = drawnCurveTable([{ x: -60, y: -66 }, { x: -6, y: -12 }, { x: 0, y: -12 }]);
    const at = (a) => {
      const j = Array.from({ length: t.length }, (_, k) => k).reduce((best, k) => (Math.abs(tableInput(k) - a) < Math.abs(tableInput(best) - a) ? k : best), 0);
      return t[j];
    };
    expect(20 * Math.log10(at(0.5))).toBeCloseTo(-12, 0); // -6 dB in
    expect(20 * Math.log10(at(1))).toBeCloseTo(-12, 1);
    expect(20 * Math.log10(at(0.0005))).toBeCloseTo(20 * Math.log10(0.0005) - 6, 0);
    // The octave grid stays fine at -90 dB, where a linear grid would have nothing.
    expect(20 * Math.log10(at(10 ** (-90 / 20)))).toBeCloseTo(-96, 0);
  });
  it('extends a curve drawn over a narrower range at its first gain', () => {
    const def = getEffect('distortion');
    const v = normalizeValues(def, { posCurve: [{ x: -60, y: -66 }, { x: 0, y: -6 }] });
    expect(v.posCurve[0]).toEqual({ x: -120, y: -120 });
    expect(v.posCurve[1]).toEqual({ x: -60, y: -66 });
    expect(normalizeValues(def, { posCurve: [{ x: -60, y: -60 }, { x: 0, y: 0 }] }).posCurve[0]).toEqual({ x: -120, y: -120 });
  });
  it('gates below -80 dB with a curve drawn on a -96 dB range', async () => {
    const d = await dsp();
    const def = getEffect('distortion');
    const v = normalizeValues(def, { drive: 0, positive: DRAWN, symmetric: true, dbRange: -96, posCurve: [{ x: -96, y: -120 }, { x: -82, y: -120 }, { x: -78, y: -78 }, { x: 0, y: 0 }] });
    const quiet = sine(1000, 48000, 24000, 10 ** (-86 / 20));
    const loud = sine(1000, 48000, 24000, 10 ** (-70 / 20));
    const run = (x) => d.runEffect(def.kind, 48000, [x], paramArray(def, v), { data: slotSpec(def, v, { rate: 48000 }).data })[0];
    expect(rms(run(quiet).subarray(12000)) / rms(quiet.subarray(12000))).toBeLessThan(0.1);
    expect(rms(run(loud).subarray(12000)) / rms(loud.subarray(12000))).toBeGreaterThan(0.8);
  });
  it('maps graph axes for the dB range and linear scale', () => {
    const db = curveAxes({ dbRange: -96 });
    expect(db.lo).toBe(-96);
    expect(db.toT(-48)).toBeCloseTo(0.5);
    const lin = curveAxes({ linearScale: true });
    expect(lin.toT(-6.0206)).toBeCloseTo(0.5, 4);
    expect(lin.fromV(0)).toBe(-120);
    expect(visiblePoints([{ x: -120, y: -120 }, { x: -60, y: -66 }, { x: 0, y: 0 }], db)[0]).toEqual({ x: -96, y: -98.4 });
  });
  it('applies a drawn curve in the WASM distortion', async () => {
    const d = await dsp();
    const def = getEffect('distortion');
    // Halve everything: -6 dB across the range, symmetric, no drive.
    const v = normalizeValues(def, { drive: 0, positive: DRAWN, symmetric: true, posCurve: [{ x: -60, y: -66 }, { x: 0, y: -6 }] });
    const x = sine(1000, 48000, 24000);
    const spec = slotSpec(def, v, { rate: 48000 });
    const [y] = d.runEffect(def.kind, 48000, [x], paramArray(def, v), { data: spec.data });
    expect(rms(y.subarray(12000)) / rms(x.subarray(12000))).toBeCloseTo(0.5, 1);
  });
  it('samples preset curves including the drive', () => {
    const hard = presetPoints(2, 12);
    // Hard clip driven 12 dB: everything above -12 dB in sits at 0 dB out.
    expect(hard.find((p) => p.x === -6).y).toBe(0);
    expect(hard.find((p) => p.x === -24).y).toBeCloseTo(-12, 1);
    expect(presetCurve(1, 0.001)).toBeCloseTo(0.001, 5);
    expect(presetCurve(6, 0.5)).toBe(0);
  });
  it('dragging a preset curve point turns that half into a drawn curve', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('distortion'), { doc, values: { drive: 12, positive: 1, symmetric: true } });
    const dlg = document.querySelector('.fx-dialog');
    expect(dlg.querySelectorAll('.dist-graph')).toHaveLength(2);
    // The generated grid is empty: the view lays out every parameter.
    expect(dlg.querySelector('.fx-dialog-body > .fx-controls').querySelectorAll('.fx-row')).toHaveLength(0);
    const handle = dlg.querySelector('.dist-graph .fx-point');
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    dlg.querySelector('.btn.primary').click();
    const values = await p;
    expect(values.positive).toBe(DRAWN);
    expect(values.drive).toBe(0);
    expect(values.posCurve.length).toBeGreaterThan(5);
  });
  it('rescales the graphs for a dB range and linear axes', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('distortion'), { doc, values: { drive: 0, positive: 2, symmetric: true, dbRange: -60 } });
    const dlg = document.querySelector('.fx-dialog');
    const count = () => dlg.querySelectorAll('.dist-graph')[0].querySelectorAll('.fx-point').length;
    const at60 = count();
    const lin = [...dlg.querySelectorAll('label.check input')].find((i) => i.closest('label').textContent === 'Linear Scale');
    lin.click();
    // Linear axes show the whole curve, down to -120 dB.
    expect(count()).toBeGreaterThan(at60);
    expect(dlg.querySelector('.dist-graph .fx-point').getAttribute('aria-valuetext')).toMatch(/^In 0, out/);
    // Reset draws the negative half straight again (and unlinks it).
    dlg.querySelector('[aria-label="Reset the negative curve"]').click();
    dlg.querySelector('.btn.primary').click();
    const v = await p;
    expect(v.linearScale).toBe(true);
    expect(v).toMatchObject({ symmetric: false, negative: DRAWN, negCurve: [{ x: -120, y: -120 }, { x: 0, y: 0 }] });
  });
});

describe('guitar suite bypass', () => {
  it('passes audio through with every module bypassed', async () => {
    const d = await dsp();
    const def = getEffect('guitarSuite');
    const v = normalizeValues(def, { compressor: 80, distType: 3, distAmount: 100, amp: 2, filterType: 1, filterFreq: 300, compBypass: true, distBypass: true, ampBypass: true, filterBypass: true });
    const x = sine(1000, 48000, 24000, 0.3);
    const [y] = d.runEffect(def.kind, 48000, [x], paramArray(def, v));
    const lat = def.latency(v, 48000);
    expect(rms(y.subarray(12000 + lat)) / rms(x.subarray(12000, 24000 - lat))).toBeCloseTo(1, 1);
    const [z] = d.runEffect(def.kind, 48000, [x], paramArray(def, { ...v, distBypass: false }));
    expect(peak(z.subarray(12000)) / rms(z.subarray(12000))).toBeLessThan(1.3); // fuzz squares the sine
  });
});

describe('mastering', () => {
  it('shelf Q shapes the drawn response', () => {
    const def = getEffect('mastering');
    const v = { ...defaults(def), lowShelfGain: 12 };
    const f = [100];
    const wide = def.response({ ...v, lowShelfQ: 0.5 }, [300], 48000)[0];
    const peaky = def.response({ ...v, lowShelfQ: 3 }, [300], 48000)[0];
    expect(wide).not.toBeCloseTo(peaky, 0);
    expect(def.response(v, f, 48000)[0]).toBeGreaterThan(5);
  });
  it('shows the EQ graph with three band handles and the module boxes', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('mastering'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    expect(dlg.classList.contains('fx-wide')).toBe(true);
    expect(dlg.querySelectorAll('.fx-response .fx-handle')).toHaveLength(3);
    expect([...dlg.querySelectorAll('.fx-group-title')].map((l) => l.textContent)).toContain('Loudness Maximizer');
    const tube = [...dlg.querySelectorAll('.fx-radio input')].find((i) => i.value === '2');
    tube.checked = true;
    tube.dispatchEvent(new Event('change'));
    dlg.querySelector('.btn.primary').click();
    expect((await p).exciterMode).toBe(2);
  });
});

describe('doppler path', () => {
  it('passes the closest point and then recedes', () => {
    const v = { path: 0, startDistance: 30, velocity: 10, comingFrom: -90, passFront: 5, passRight: 0 };
    expect(dopplerPosition(v, 0).y).toBeCloseTo(5);
    expect(dopplerPosition(v, 0).x).toBeCloseTo(-30);
    expect(dopplerPosition(v, 3).x).toBeCloseTo(0);
    expect(dopplerRatio(v, 0.5)).toBeGreaterThan(1);
    expect(dopplerRatio(v, 5.5)).toBeLessThan(1);
  });
  it('circles at the radius', () => {
    const v = { path: 1, radius: 4, velocity: 3, startAngle: 0, centerFront: 0, centerRight: 0 };
    for (const t of [0, 1, 2.5]) {
      const p = dopplerPosition(v, t);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(4);
    }
    expect(dopplerRatio(v, 1)).toBeCloseTo(1, 5);
  });
  it('draws the path view and shows only the controls of the chosen path', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('dopplerShifter'), { doc, values: { path: 0 } });
    const dlg = document.querySelector('.fx-dialog');
    const radius = [...dlg.querySelectorAll('.fx-label')].find((l) => l.textContent.replace(/:$/, '') === 'Radius');
    expect(radius.closest('.fx-controls').hidden).toBe(true);
    const circle = [...dlg.querySelectorAll('.fx-radio input')].find((i) => i.value === '1');
    circle.checked = true;
    circle.dispatchEvent(new Event('change'));
    expect(radius.closest('.fx-controls').hidden).toBe(false);
    expect(dlg.querySelector('.dp-status').textContent).toMatch(/semitones/);
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
});

describe('registered views', () => {
  it('replace the automatic editor for their effects', () => {
    for (const id of ['dehummer', 'mastering', 'dopplerShifter', 'vocalEnhancer', 'guitarSuite', 'distortion']) expect(autoEditor(getEffect(id))).toBeTypeOf('function');
  });
  it('guitar suite dims a bypassed module', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('guitarSuite'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    const box = [...dlg.querySelectorAll('.fx-group')].find((g) => g.querySelector('legend')?.textContent === 'Distortion');
    const bypass = [...box.querySelectorAll('.fx-bypass input')][0];
    bypass.checked = true;
    bypass.dispatchEvent(new Event('change'));
    expect(box.querySelector('select').disabled).toBe(true);
    dlg.querySelector('.btn.primary').click();
    expect((await p).distBypass).toBe(true);
  });
});
