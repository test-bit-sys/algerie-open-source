// Adaptive Noise Reduction (kind 134): the realtime noise follower, with
// and without High Quality Mode.
import { describe, it, expect } from 'vitest';
import { wasmBytes } from './fx-wasm.js';
import { getEffect, defaults, slotSpec, effectLatency } from '../src/effects/index.js';
import { FxHost } from '../src/engine/fxhost.js';

const RATE = 48000;
const def = getEffect('adaptiveNoiseReduction');

function noise(n, amp, seed = 3) {
  let s = seed;
  return Float32Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return amp * (s / 2147483648 - 1);
  });
}

function render(values, x) {
  const host = new FxHost(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}), RATE);
  const chain = host.sync([slotSpec(def, { ...defaults(def), ...values }, { key: 'k' })]);
  const out = new Float32Array(x.length);
  for (let at = 0; at < x.length; at += 128) {
    const l = x.slice(at, at + 128);
    const r = x.slice(at, at + 128);
    host.run(chain, [l, r], l.length);
    out.set(l, at);
  }
  return out;
}

const rms = (x, a, b) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

describe('Adaptive Noise Reduction', () => {
  it('has a High Quality Mode switch after the FFT size (WASM param 7)', () => {
    const i = def.params.findIndex((p) => p.id === 'highQuality');
    expect(i).toBe(7);
    expect(def.params[i].label).toBe('High Quality Mode (slower)');
    expect(slotSpec(def, { ...defaults(def), highQuality: true }).params[7]).toBe(1);
  });

  it('reduces steady noise in both modes with the latency it declares', () => {
    const hiss = noise(RATE * 2, 0.05);
    for (const highQuality of [false, true]) {
      const v = { ...defaults(def), reduceBy: 24, highQuality };
      const y = render(v, hiss);
      const lat = effectLatency(def, { ...defaults(def), ...v }, RATE);
      expect(lat).toBe(1024);
      const ratio = rms(y, RATE + lat, 2 * RATE) / rms(hiss, RATE, 2 * RATE - lat);
      expect(ratio, `highQuality ${highQuality}`).toBeLessThan(0.4);
      expect(y.every(Number.isFinite)).toBe(true);
    }
  });
});
