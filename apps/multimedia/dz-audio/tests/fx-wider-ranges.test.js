// Ranges as wide as the reference layouts: Chorus spread and rates, Flanger
// rate, Analog Delay time and feedback, Center Channel Extractor levels,
// Convolution Reverb width and gain, Studio Reverb cuts. Each new reach is
// checked in the processor, not just in the slider.
import { describe, it, expect } from 'vitest';
import { wasmBytes } from './fx-wasm.js';
import { getEffect, defaults, slotSpec } from '../src/effects/index.js';
import { FxHost } from '../src/engine/fxhost.js';

const RATE = 48000;

function render(id, values, L, R = L) {
  const def = getEffect(id);
  const host = new FxHost(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}), RATE);
  const chain = host.sync([slotSpec(def, { ...defaults(def), ...values }, { key: 'k', rate: RATE })]);
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
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
const range = (id, pid) => {
  const p = getEffect(id).params.find((q) => q.id === pid);
  return [p.min, p.max];
};
const impulse = (n, at = 0) => {
  const x = new Float32Array(n);
  x[at] = 1;
  return x;
};
const firstAbove = (x, th, from = 1) => {
  for (let i = from; i < x.length; i++) if (Math.abs(x[i]) > th) return i;
  return -1;
};
const sine = (f, n, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / RATE));

describe('wider effect ranges', () => {
  it('declares the reference ranges', () => {
    expect(range('chorus', 'spread')).toEqual([0, 200]);
    expect(range('chorus', 'delayRate')[1]).toBe(12);
    expect(range('chorus', 'modRate')[1]).toBe(30);
    expect(range('chorus', 'depth')[1]).toBe(15);
    expect(range('flanger', 'rate')[1]).toBe(60);
    expect(range('analogDelay', 'delay')).toEqual([10, 8000]);
    expect(range('analogDelay', 'feedback')).toEqual([0, 200]);
    expect(range('centerChannelExtractor', 'centerLevel')).toEqual([-48, 40]);
    expect(range('centerChannelExtractor', 'sideLevel')).toEqual([-48, 40]);
    expect(range('convolutionReverb', 'width')).toEqual([0, 300]);
    expect(range('convolutionReverb', 'gain')).toEqual([-24, 18]);
    expect(range('studioReverb', 'hfCut')).toEqual([20, 20000]);
    expect(range('studioReverb', 'lfCut')).toEqual([20, 4000]);
  });

  it('Chorus spreads voices up to 200 ms apart', () => {
    const run = (spread) => {
      const [l] = render('chorus', { voices: 2, delay: 5, spread, dry: 0, wet: 100, feedback: 0, depth: 0, width: 0 }, impulse(RATE / 2));
      // The latest voice arrives after the delay plus the spread.
      let last = 0;
      for (let i = 0; i < l.length; i++) if (Math.abs(l[i]) > 0.02) last = i;
      return (last / RATE) * 1000;
    };
    expect(run(150)).toBeGreaterThan(140);
    expect(run(20)).toBeLessThan(60);
  });

  it('Analog Delay repeats after 6 seconds and holds 200 % feedback with saturation', () => {
    const n = Math.round(6.2 * RATE);
    const [l] = render('analogDelay', { delay: 6000, dry: 0, wet: 100, feedback: 0, spread: 0, trash: 0 }, impulse(n));
    const at = firstAbove(l, 0.05);
    expect(at / RATE).toBeGreaterThan(5.9);
    const [y] = render('analogDelay', { delay: 20, feedback: 200, dry: 100, wet: 100 }, sine(440, RATE, 0.5));
    expect(y.every(Number.isFinite)).toBe(true);
    expect(Math.max(...y.map(Math.abs))).toBeLessThan(8);
  });

  it('Flanger sweeps at up to 60 Hz', () => {
    // The sweeping comb makes a steady tone's level rise and fall at the sweep rate.
    const x = sine(3000, RATE / 2);
    const swings = (rate) => {
      const [l] = render('flanger', { rate, initialDelay: 1, finalDelay: 1.15, feedback: 0, mix: 50, sinusoidal: true, phasing: 0 }, x);
      const env = [];
      for (let k = 4800; k + 48 <= 14400; k += 48) env.push(rms(l.subarray(k, k + 48)));
      const mean = env.reduce((s, v) => s + v, 0) / env.length;
      let n = 0;
      for (let i = 1; i < env.length; i++) if ((env[i] - mean) * (env[i - 1] - mean) < 0) n++;
      return n;
    };
    expect(swings(55)).toBeGreaterThan(swings(8) * 3);
  });

  it('Center Channel Extractor raises the centre by up to 40 dB', () => {
    const x = sine(1000, RATE / 2, 0.001);
    const [l] = render('centerChannelExtractor', { centerLevel: 30, sideLevel: 0 }, x, x);
    expect(rms(l.subarray(RATE / 4)) / rms(x.subarray(RATE / 4))).toBeGreaterThan(20);
  });

  it('Convolution Reverb widens to 300 % and boosts to +18 dB', () => {
    const L = impulse(RATE);
    const R = new Float32Array(RATE);
    const side = (width) => {
      const [l, r] = render('convolutionReverb', { mix: 100, width, gain: 0 }, L, R);
      return rms(l.map((v, i) => v - r[i]));
    };
    expect(side(300)).toBeGreaterThan(side(200) * 1.2);
    const level = (gain) => rms(render('convolutionReverb', { mix: 100, gain }, L, R)[0]);
    expect(level(18) / level(0)).toBeCloseTo(10 ** (18 / 20), 0);
  });

  it('Studio Reverb cuts its highs as low as 200 Hz and its lows as high as 3 kHz', () => {
    const wet = (f, v) => rms(render('studioReverb', { dry: 0, wet: 100, ...v }, sine(f, RATE))[0].subarray(RATE / 2));
    expect(wet(5000, { hfCut: 200 })).toBeLessThan(wet(5000, { hfCut: 20000 }) * 0.1);
    expect(wet(300, { lfCut: 3000 })).toBeLessThan(wet(300, { lfCut: 20 }) * 0.3);
  });
});

describe('more reference ranges', () => {
  it('declares them', () => {
    expect(range('phaser', 'upperFreq')).toEqual([20, 20000]);
    expect(range('reverb', 'decay')[0]).toBe(20);
    expect(range('fullReverb', 'decay')[0]).toBe(20);
    expect(range('deesser', 'threshold')).toEqual([-80, 0]);
    expect(range('echo', 'eq0')).toEqual([-24, 15]);
    expect(range('adaptiveNoiseReduction', 'threshold')).toEqual([-20, 30]);
    expect(range('hissReduction', 'reduceBy')).toEqual([0, 100]);
    expect(range('fftFilter', 'curve')).toEqual([-100, 24]);
    expect(range('parametricEq', 'gain')).toEqual([-80, 40]);
    expect(range('scientificFilter', 'gain')).toEqual([-50, 50]);
    expect(range('graphicEq10', 'gain')).toEqual([-50, 50]);
    expect(range('stretchPitch', 'semitones')).toEqual([-36, 36]);
    expect(range('automaticPitchCorrection', 'sensitivity')).toEqual([1, 200]);
    expect(range('centerChannelExtractor', 'phaseAngle')).toEqual([-360, 360]);
    expect(range('mastering', 'output')).toEqual([-30, 18]);
    expect(range('convolutionReverb', 'roomSize')[0]).toBe(10);
    expect(range('surroundReverb', 'roomSize')[0]).toBe(10);
    expect(getEffect('denoise').params.find((p) => p.id === 'focus').options).toHaveLength(5);
  });

  it('Reverb decays within tens of milliseconds at its shortest', () => {
    // When the output falls 40 dB below its loudest 5 ms window, and stays there.
    const tailEnd = (decay) => {
      const [l] = render('reverb', { decay, dry: 0, wet: 100, preDelay: 0, diffusion: 100 }, impulse(RATE / 2));
      const win = 240;
      const env = [];
      for (let k = 0; k + win <= l.length; k += win) env.push(rms(l.subarray(k, k + win)));
      const top = Math.max(...env);
      let last = 0;
      env.forEach((e, i) => e > top / 100 && (last = i));
      return last * 5;
    };
    expect(tailEnd(20)).toBeLessThan(tailEnd(100));
  });

  it('Hiss Reduction reduces by up to 100 dB', () => {
    let seed = 7;
    const noise = Float32Array.from({ length: 2 * RATE }, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.02);
    const level = 10 * Math.log10((0.02 * 0.02) / 12);
    const floor = [{ f: 1, g: level }, { f: 24000, g: level }];
    const out = (reduceBy) => rms(render('hissReduction', { reduceBy, floorLeft: floor, floorRight: floor }, noise)[0].subarray(RATE));
    expect(out(100)).toBeLessThan(out(80));
  });

  it('DeNoise focuses on lows and highs together', () => {
    let seed = 3;
    const noise = Float32Array.from({ length: 2 * RATE }, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.1);
    const out = (focus) => render('denoise', { amount: 100, focus }, noise)[0];
    // Against mids-only, lows-and-highs reduces more at 100 Hz and less at 1.5 kHz.
    const band = (x, f) => {
      let re = 0;
      let im = 0;
      const w = (2 * Math.PI * f) / RATE;
      for (let i = RATE; i < 2 * RATE; i++) {
        re += x[i] * Math.cos(w * i);
        im += x[i] * Math.sin(w * i);
      }
      return Math.hypot(re, im);
    };
    const [both, mids] = [out(4), out(2)];
    const avg = (x, f) => [0.97, 0.99, 1, 1.01, 1.03].reduce((s, k) => s + band(x, f * k), 0);
    expect(avg(both, 100)).toBeLessThan(avg(mids, 100));
    expect(avg(both, 1500)).toBeGreaterThan(avg(mids, 1500));
  });
});
