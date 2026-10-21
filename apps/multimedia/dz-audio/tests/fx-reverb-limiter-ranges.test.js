// Reverb perception and Sum Inputs, wider reverb output levels and the Hard
// Limiter's longer look-ahead and deeper ceiling.
import { describe, it, expect } from 'vitest';
import { wasmBytes } from './fx-wasm.js';
import { getEffect, defaults, slotSpec, effectLatency } from '../src/effects/index.js';
import { FxHost } from '../src/engine/fxhost.js';

const RATE = 48000;

function render(id, values, L, R) {
  const def = getEffect(id);
  const host = new FxHost(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}), RATE);
  const chain = host.sync([slotSpec(def, { ...defaults(def), ...values }, { key: 'k' })]);
  const out = [new Float32Array(L.length), new Float32Array(R.length)];
  for (let at = 0; at < L.length; at += 128) {
    const n = Math.min(128, L.length - at);
    const buf = [L.slice(at, at + n), R.slice(at, at + n)];
    host.run(chain, buf, n);
    out[0].set(buf[0], at);
    out[1].set(buf[1], at);
  }
  return out;
}
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('Reverb', () => {
  const def = getEffect('reverb');
  it('adds Perception and Sum Inputs as WASM params 8 and 9, and wider output levels', () => {
    expect(def.params.map((p) => p.id).slice(8)).toEqual(['perception', 'sumInputs']);
    expect(def.params.find((p) => p.id === 'dry').max).toBe(200);
    expect(def.params.find((p) => p.id === 'wet').max).toBe(500);
  });

  it('feeds both sides from one input with Sum Inputs', () => {
    const L = new Float32Array(RATE);
    L[0] = 1;
    const R = new Float32Array(RATE);
    const [l, r] = render('reverb', { dry: 0, wet: 100, preDelay: 0, sumInputs: true }, L, R);
    expect(rms(r) / rms(l)).toBeGreaterThan(0.7);
    const [l2, r2] = render('reverb', { dry: 0, wet: 100, preDelay: 0, sumInputs: false }, L, R);
    expect(rms(l2)).toBeGreaterThan(0);
    expect(rms(r2) / rms(l2)).toBeLessThan(rms(r) / rms(l));
  });

  it('turns the reverb up past unity with Wet above 100 %', () => {
    const x = Float32Array.from({ length: RATE / 2 }, (_, i) => (i < 2400 ? Math.sin(i / 5) * 0.2 : 0));
    const [a] = render('reverb', { dry: 0, wet: 100 }, x, x);
    const [b] = render('reverb', { dry: 0, wet: 400 }, x, x);
    expect(rms(b) / rms(a)).toBeGreaterThan(3.5);
  });
});

describe('Hard Limiter', () => {
  const def = getEffect('hardLimiter');
  it('looks ahead up to 20 ms and limits down to -100 dB', () => {
    expect(def.params.find((p) => p.id === 'lookahead').max).toBe(20);
    expect(def.params.find((p) => p.id === 'ceiling').min).toBe(-100);
    const host = new FxHost(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}), RATE);
    const v = { ...defaults(def), lookahead: 18 };
    host.sync([slotSpec(def, v, { key: 'k' })]);
    expect(effectLatency(def, v, RATE)).toBe(Math.round(0.018 * RATE) - 1);
    const x = Float32Array.from({ length: RATE / 4 }, (_, i) => 0.5 * Math.sin(i / 9));
    const [l] = render('hardLimiter', { ceiling: -70, lookahead: 18 }, x, x);
    const tail = l.subarray(RATE / 8);
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(10 ** (-69 / 20));
  });
});
