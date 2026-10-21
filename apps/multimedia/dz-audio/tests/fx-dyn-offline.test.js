// Offline Amplitude effects: Normalize, Fade Envelope and Gain Envelope, plus
// the static transfer curves the dynamics dialogs draw.
import { describe, it, expect } from 'vitest';
import './fx-wasm.js';
import { getEffect } from '../src/effects/index.js';
import { renderEnvelope } from '../src/effects/defs/amplitude.js';

const peakOf = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('normalize', () => {
  const def = getEffect('normalize');
  const l = Float32Array.from({ length: 1000 }, (_, i) => 0.25 * Math.sin(i / 10));
  const r = Float32Array.from({ length: 1000 }, (_, i) => 0.5 * Math.sin(i / 7));

  it('scales all channels equally to the loudest peak', async () => {
    const [a, b] = await def.process({ channels: [l, r], rate: 48000, values: { unit: 1, targetPercent: 100, equal: true } });
    expect(peakOf(b)).toBeCloseTo(1, 4);
    expect(peakOf(a)).toBeCloseTo(0.5, 2);
    expect(l[10]).toBeCloseTo(0.25 * Math.sin(1), 6); // input untouched
  });

  it('normalizes channels independently in dB', async () => {
    const [a, b] = await def.process({ channels: [l, r], rate: 48000, values: { unit: 0, targetDb: -6, equal: false } });
    const t = 10 ** (-6 / 20);
    expect(peakOf(a)).toBeCloseTo(t, 4);
    expect(peakOf(b)).toBeCloseTo(t, 4);
  });

  it('removes DC offset before measuring', async () => {
    const x = Float32Array.from({ length: 2000 }, (_, i) => 0.3 + 0.2 * Math.sin((2 * Math.PI * i) / 100));
    const [y] = await def.process({ channels: [x], rate: 48000, values: { unit: 1, targetPercent: 100, removeDc: true } });
    const mean = y.reduce((s, v) => s + v, 0) / y.length;
    expect(Math.abs(mean)).toBeLessThan(1e-3);
    expect(peakOf(y)).toBeCloseTo(1, 3);
  });

  it('moves the DC offset to the bias amount, with or without normalizing', async () => {
    const x = Float32Array.from({ length: 2000 }, (_, i) => 0.3 + 0.2 * Math.sin((2 * Math.PI * i) / 100));
    const mean = (y) => y.reduce((s, v) => s + v, 0) / y.length;
    const [a] = await def.process({ channels: [x], rate: 48000, values: { normalizeTo: false, removeDc: true, dcAmount: 5 } });
    expect(mean(a)).toBeCloseTo(0.05, 3);
    expect(peakOf(a) - 0.05).toBeCloseTo(0.2, 3); // level unchanged
    const [b] = await def.process({ channels: [x], rate: 48000, values: { normalizeTo: false, removeDc: false } });
    expect(Array.from(b)).toEqual(Array.from(x));
    const [c] = await def.process({ channels: [x], rate: 48000, values: { unit: 1, targetPercent: 50, removeDc: true, dcAmount: -10 } });
    expect(mean(c)).toBeCloseTo(-0.1, 3);
    expect(Math.max(...c)).toBeCloseTo(0.4, 3);
  });

  it('leaves silence alone', async () => {
    const [y] = await def.process({ channels: [new Float32Array(10)], rate: 48000, values: {} });
    expect(Array.from(y)).toEqual(Array(10).fill(0));
  });
});

describe('envelopes', () => {
  it('renders linear and monotone spline envelopes', () => {
    const lin = renderEnvelope([{ t: 0, v: 0 }, { t: 1, v: 1 }], 11);
    expect(lin[0]).toBe(0);
    expect(lin[5]).toBeCloseTo(0.5, 6);
    expect(lin[10]).toBeCloseTo(1, 6);
    const pts = [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 0.6, v: 1 }, { t: 1, v: 0 }];
    const sp = renderEnvelope(pts, 1001, true);
    expect(Math.max(...sp)).toBeLessThanOrEqual(1 + 1e-9); // no overshoot
    expect(Math.min(...sp)).toBeGreaterThanOrEqual(-1e-9);
    expect(sp[500]).toBeCloseTo(1, 6);
    // Points not covering the ends hold their values.
    const held = renderEnvelope([{ t: 0.5, v: 0.3 }], 5);
    expect(Array.from(held).every((v) => Math.abs(v - 0.3) < 1e-6)).toBe(true);
  });

  it('fade envelope fades in across the range', async () => {
    const x = new Float32Array(101).fill(0.8);
    const [y] = await getEffect('fadeEnvelope').process({ channels: [x], rate: 48000, values: {} });
    expect(y[0]).toBe(0);
    expect(y[50]).toBeCloseTo(0.4, 5);
    expect(y[100]).toBeCloseTo(0.8, 5);
  });

  it('gain envelope applies gains above unity and clamps to its range', async () => {
    const x = new Float32Array(3).fill(0.1);
    const env = [{ t: 0, v: 2 }, { t: 1, v: 9 }];
    const [y] = await getEffect('gainEnvelope').process({ channels: [x, x], rate: 48000, values: { envelope: env } });
    expect(y[0]).toBeCloseTo(0.2, 6);
    expect(y[2]).toBeCloseTo(0.4, 6);
  });
});

describe('transfer curves', () => {
  it('single-band compressor follows its ratio above threshold', () => {
    const def = getEffect('singleBandCompressor');
    const v = { threshold: -20, ratio: 4, knee: 0, outputGain: 0 };
    expect(def.transfer(v, -30)).toBe(-30);
    expect(def.transfer(v, 0)).toBeCloseTo(-15, 6);
  });
  it('hard limiter caps at the ceiling', () => {
    const def = getEffect('hardLimiter');
    expect(def.transfer({ ceiling: -1, inputBoost: 6 }, -3)).toBe(-1);
    expect(def.transfer({ ceiling: -1, inputBoost: 6 }, -20)).toBe(-14);
  });
});
