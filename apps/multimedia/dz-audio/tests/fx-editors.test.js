import { describe, it, expect } from 'vitest';
import { biquadCoefficients, magnitudeDb, combinedResponse, logFrequencies, qForBandwidth, filterTypeFromLabel } from '../src/effects/biquad.js';
import { detectBands, detectDynamics, transferCurve, autoEditor, formatPoint } from '../src/effects/editors.js';

const R = 48000;

describe('biquad response', () => {
  it('peaking band reaches its gain at the centre and is flat far away', () => {
    const c = biquadCoefficients('peaking', 1000, 6, 1, R);
    expect(magnitudeDb(c, 1000, R)).toBeCloseTo(6, 3);
    expect(Math.abs(magnitudeDb(c, 20, R))).toBeLessThan(0.1);
  });
  it('Butterworth low-pass is -3 dB at the cutoff and steep above', () => {
    const c = biquadCoefficients('lowpass', 1000, 0, Math.SQRT1_2, R);
    expect(magnitudeDb(c, 1000, R)).toBeCloseTo(-3.01, 1);
    expect(magnitudeDb(c, 100, R)).toBeCloseTo(0, 1);
    expect(magnitudeDb(c, 10000, R)).toBeLessThan(-35);
  });
  it('shelves approach their gain past the corner', () => {
    expect(magnitudeDb(biquadCoefficients('lowshelf', 200, -9, 0.7, R), 20, R)).toBeCloseTo(-9, 0);
    expect(magnitudeDb(biquadCoefficients('highshelf', 5000, 4, 0.7, R), 18000, R)).toBeCloseTo(4, 0);
  });
  it('sums bands, skips disabled ones and cascades orders', () => {
    const f = logFrequencies(64);
    const on = combinedResponse([{ type: 'peaking', freq: 1000, gain: 6, q: 1 }, { type: 'peaking', freq: 1000, gain: 6, q: 1, enabled: false }], [1000], R);
    expect(on[0]).toBeCloseTo(6, 3);
    const steep = combinedResponse([{ type: 'highpass', freq: 1000, q: Math.SQRT1_2, order: 2 }], [1000], R, 1);
    expect(steep[0]).toBeCloseTo(1 - 6.02, 1);
    expect(f[0]).toBeCloseTo(20);
    expect(f[63]).toBeCloseTo(20000);
  });
  it('derives graphic EQ Q and filter types from labels', () => {
    expect(qForBandwidth(1)).toBeCloseTo(1.414, 2);
    expect(filterTypeFromLabel('Low Shelf')).toBe('lowshelf');
    expect(filterTypeFromLabel('High Pass')).toBe('highpass');
    expect(filterTypeFromLabel('Notch')).toBe('notch');
    expect(filterTypeFromLabel('Bell')).toBe('peaking');
  });
});

describe('editor detection from param ids', () => {
  it('finds parametric bands named with sections (band1Freq) and named bands (hpFreq)', () => {
    const def = {
      id: 'parametricEq',
      params: [
        { id: 'hpOn', type: 'bool' }, { id: 'hpFreq', unit: 'Hz' },
        { id: 'band1Freq', unit: 'Hz' }, { id: 'band1Gain', unit: 'dB' }, { id: 'band1Q' },
        { id: 'band2Freq', unit: 'Hz' }, { id: 'band2Gain', unit: 'dB' }, { id: 'band2Type', type: 'choice', options: [{ value: 0, label: 'Bell' }] },
        { id: 'outputGain', unit: 'dB' },
      ],
    };
    const l = detectBands(def);
    expect(l.bands.map((b) => b.key)).toEqual(['hp', '1', '2']);
    expect(l.bands[0].ids).toEqual({ on: 'hpOn', freq: 'hpFreq' });
    expect(l.bands[2].ids.type).toBe('band2Type');
    expect(l.offsetId).toBe('outputGain');
    expect(autoEditor(def)).toBeTypeOf('function');
  });
  it('treats dB sliders labelled with frequencies as a graphic EQ', () => {
    const def = { id: 'graphicEq10', params: ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'].map((f, i) => ({ id: `b${i}`, label: `${f} Hz`, unit: 'dB', min: -12, max: 12 })) };
    const l = detectBands(def);
    expect(l.graphic).toBe(true);
    expect(l.bands).toHaveLength(10);
    expect(l.bands[5].fixed.freq).toBe(1000);
    expect(l.bands[0].fixed.q).toBeCloseTo(qForBandwidth(Math.log2(16000 / 31) / 9), 5);
  });
  it('finds dynamics roles and draws the static curve', () => {
    const ids = detectDynamics({ params: [{ id: 'threshold' }, { id: 'ratio' }, { id: 'knee' }, { id: 'makeupGain' }, { id: 'attack' }] });
    expect(ids).toEqual({ threshold: 'threshold', ratio: 'ratio', knee: 'knee', makeup: 'makeupGain' });
    expect(transferCurve(-30, { threshold: -20, ratio: 4 })).toBe(-30);
    expect(transferCurve(0, { threshold: -20, ratio: 4 })).toBe(-15);
    expect(transferCurve(0, { threshold: -20, ratio: 4, makeup: 3 })).toBe(-12);
    expect(transferCurve(-20, { threshold: -20, ratio: 4, knee: 10 })).toBeLessThan(-20);
    expect(transferCurve(-6, { boost: 10, ceiling: -0.1 })).toBe(-0.1);
    expect(autoEditor({ id: 'singleBandCompressor', params: [{ id: 'threshold' }, { id: 'ratio' }] })).toBeTypeOf('function');
    expect(autoEditor({ id: 'chorus', params: [{ id: 'rate' }] })).toBeNull();
  });
  it('formats envelope points, showing multipliers as percent', () => {
    expect(formatPoint({ unit: '%', min: 0, max: 4 }, 1.5)).toBe('150 %');
    expect(formatPoint({ unit: 'dB', min: -60, max: 24 }, -3)).toBe('-3.0 dB');
  });
});

describe('response-driven curves', () => {
  it('uses an EQ definition with only a response function', () => {
    const def = { id: 'scientificFilter', params: [{ id: 'cutoff', unit: 'Hz' }], response: (v, f) => new Float32Array(f.length) };
    expect(autoEditor(def)).toBeTypeOf('function');
  });
});
