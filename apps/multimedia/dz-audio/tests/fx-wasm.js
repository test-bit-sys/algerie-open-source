// Test helpers: the built DSP module for Node, and the registered catalog.
import fs from 'node:fs';
import path from 'node:path';
import { setDspBytes } from '../src/audio/dsp.js';

export const wasmBytes = fs.readFileSync(path.resolve(import.meta.dirname, '../src/audio/dsp.wasm'));
setDspBytes(wasmBytes);

/** A fresh raw instance (exports) of the DSP module. */
export function instance() {
  return new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}).exports;
}

/** Deterministic test signal: a sine sweep plus noise, stereo, `seconds` long. */
export function testSignal(rate = 48000, seconds = 1, amp = 0.5) {
  const n = Math.round(rate * seconds);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = 60 * Math.pow(200, i / n);
    phase += (2 * Math.PI * f) / rate;
    const s = Math.sin(phase);
    l[i] = amp * (0.8 * s + 0.2 * rnd());
    r[i] = amp * (0.7 * s + 0.3 * rnd());
  }
  return [l, r];
}
