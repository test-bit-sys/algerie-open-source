import { describe, it, expect } from 'vitest';
import { coerce, normalizeValues, toPosition, fromPosition, formatValue, parseValue, linkGroups, setLinked, roundToStep } from '../src/effects/params.js';
import { getEffect } from '../src/effects/index.js';

const gain = { id: 'gain', min: -24, max: 24, step: 0.1, default: 0, unit: 'dB' };
const freq = { id: 'freq', min: 20, max: 20000, step: 1, default: 1000, unit: 'Hz', scale: 'log' };
const mode = { id: 'mode', type: 'choice', options: [{ value: 0, label: 'Soft' }, { value: 1, label: 'Hard' }], default: 0 };
const flag = { id: 'on', type: 'bool', default: true };

describe('param coercion', () => {
  it('clamps, rounds to the step and fills defaults', () => {
    expect(coerce(gain, 30)).toBe(24);
    expect(coerce(gain, -3.04)).toBe(-3);
    expect(coerce(gain, 'abc')).toBe(0);
    expect(coerce(mode, '1')).toBe(1);
    expect(coerce(mode, 7)).toBe(0);
    expect(coerce(flag, 0)).toBe(false);
    expect(coerce(flag, 'true')).toBe(true);
    const def = { params: [gain, mode, flag] };
    expect(normalizeValues(def, { gain: 2, junk: 5 })).toEqual({ gain: 2, mode: 0, on: true });
  });
  it('rounds steps relative to the minimum without float noise', () => {
    expect(roundToStep(0.30000000004, 0.1)).toBe(0.3);
    expect(roundToStep(7, 5, 1)).toBe(6);
  });
  it('keeps envelope and curve data valid', () => {
    const env = { id: 'env', type: 'envelope', min: 0, max: 2, default: [{ t: 0, v: 1 }, { t: 1, v: 1 }] };
    expect(coerce(env, null)).toEqual(env.default);
    expect(coerce(env, [{ t: 1, v: 5 }, { t: 0, v: -1 }])).toEqual([{ t: 0, v: 0 }, { t: 1, v: 2 }]);
    const curve = { id: 'c', type: 'curve', min: -60, max: 24, default: [{ f: 20, g: 0 }, { f: 20000, g: 0 }] };
    expect(coerce(curve, [{ f: 1000, g: 40 }, { f: 100, g: -3 }])).toEqual([{ f: 100, g: -3 }, { f: 1000, g: 24 }]);
  });
});

describe('slider mapping', () => {
  it('maps linear params proportionally', () => {
    expect(toPosition(gain, 0)).toBeCloseTo(0.5);
    expect(fromPosition(gain, 0.75)).toBe(12);
  });
  it('maps log params geometrically and round-trips', () => {
    expect(toPosition(freq, 632.4555)).toBeCloseTo(0.5, 3);
    expect(fromPosition(freq, 0)).toBe(20);
    expect(fromPosition(freq, 1)).toBe(20000);
    for (const v of [50, 440, 1000, 8000]) expect(fromPosition(freq, toPosition(freq, v))).toBeCloseTo(v, -1);
  });
});

describe('format and parse', () => {
  it('formats units', () => {
    expect(formatValue(gain, -3)).toBe('-3.0 dB');
    expect(formatValue(freq, 1500)).toBe('1.5 kHz');
    expect(formatValue(freq, 440)).toBe('440 Hz');
    expect(formatValue({ unit: ':1', step: 0.1 }, 4)).toBe('4.0:1');
    expect(formatValue({ unit: 'ms', step: 1 }, 2500)).toBe('2.50 s');
    expect(formatValue(mode, 1)).toBe('Hard');
    expect(formatValue(flag, false)).toBe('Off');
  });
  it('parses typed values with suffixes', () => {
    expect(parseValue(freq, '2k')).toBe(2000);
    expect(parseValue(freq, '2.5 kHz')).toBe(2500);
    expect(parseValue({ unit: 'ms' }, '1.5 s')).toBe(1500);
    expect(parseValue({ unit: 's' }, '250ms')).toBe(0.25);
    expect(parseValue(gain, '-6 dB')).toBe(-6);
    expect(parseValue(gain, 'loud')).toBeNaN();
  });
});

describe('linked params', () => {
  it('moves Amplify left and right together while linked', () => {
    const def = getEffect('amplify');
    expect(linkGroups(def)).toEqual([{ link: 'linked', ids: ['left', 'right'] }]);
    let v = { left: 0, right: -2, linked: true };
    v = setLinked(def, v, 'left', 3);
    expect(v).toEqual({ left: 3, right: 1, linked: true });
    v = setLinked(def, { ...v, linked: false }, 'right', 6);
    expect(v.left).toBe(3);
    expect(v.right).toBe(6);
  });
  it('clamps the linked partner at its range', () => {
    const def = getEffect('amplify');
    expect(setLinked(def, { left: 40, right: 46, linked: true }, 'left', 45).right).toBe(48);
  });
});
