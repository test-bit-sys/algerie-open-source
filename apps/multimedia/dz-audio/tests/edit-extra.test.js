import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { findZeroCrossing, splitBands, defaultCrossovers, crossoverProblem } from '../src/commands/edit-extra.js';

const sine = (n, period, phase = 0) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * (i + phase)) / period));
const state = (...chans) => ({ sampleRate: 1000, channels: chans.map((c) => Channel.fromSamples(c)), markers: [] });
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('zero crossings', () => {
  it('finds the nearest crossing in each direction', () => {
    // Crossings of a 100-sample sine sit at 0, 50, 100, ...
    const s = state(sine(400, 100, 0.5));
    expect(findZeroCrossing(s, 120, -1)).toBe(100);
    expect(findZeroCrossing(s, 120, 1)).toBe(150);
  });

  it('uses the sum of the enabled channels only', () => {
    const left = sine(400, 100, 0.5);
    const right = sine(400, 80, 0.5);
    const s = state(left, right);
    expect(findZeroCrossing(s, 125, 1, [false, true])).toBe(160);
    expect(findZeroCrossing(s, 125, 1, [true, false])).toBe(150);
  });

  it('returns the frame unchanged when there is no crossing', () => {
    const s = state(new Float32Array(100).fill(0.5));
    expect(findZeroCrossing(s, 40, 1)).toBe(40);
    expect(findZeroCrossing(s, 40, -1)).toBe(40);
  });
});

describe('frequency band splitter', () => {
  it('separates low and high tones into their bands', () => {
    const rate = 48000;
    const low = sine(rate, rate / 100);
    const high = sine(rate, rate / 8000);
    const mix = low.map((v, i) => v + high[i]);
    const [lo, hi] = splitBands(mix, [1000], rate);
    // Skip the filter warm-up.
    const tail = (x) => x.subarray(4800);
    expect(rms(tail(lo))).toBeGreaterThan(0.69);
    expect(rms(tail(lo))).toBeLessThan(0.72);
    expect(rms(tail(hi))).toBeGreaterThan(0.69);
    expect(rms(tail(hi))).toBeLessThan(0.72);
  });

  it('bands add back up with a flat magnitude', () => {
    const rate = 48000;
    let seed = 7;
    const noise = Float32Array.from({ length: rate }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5));
    const bands = splitBands(noise, [200, 1500, 6000], rate);
    expect(bands).toHaveLength(4);
    const sum = new Float32Array(noise.length);
    for (const b of bands) for (let i = 0; i < b.length; i++) sum[i] += b[i];
    expect(rms(sum.subarray(4800)) / rms(noise.subarray(4800))).toBeCloseTo(1, 1);
  });

  it('suggests ascending crossovers and validates them', () => {
    const f = defaultCrossovers(5, 48000);
    expect(f).toHaveLength(4);
    expect(f.every((v, i) => !i || v > f[i - 1])).toBe(true);
    expect(crossoverProblem(f, 48000)).toBe('');
    expect(crossoverProblem([500, 510], 48000)).toMatch(/apart/);
    expect(crossoverProblem([10], 48000)).toMatch(/between/);
  });
});

describe('band splitter dialog', () => {
  it('maps frequencies on log and linear scales and lists band ranges', async () => {
    const { freqScale, bandRanges, tidyHz } = await import('../src/commands/band-splitter.js');
    const log = freqScale(24000);
    expect(log.toX(20)).toBeCloseTo(0);
    expect(log.toX(24000)).toBeCloseTo(1);
    expect(log.toHz(log.toX(1000))).toBeCloseTo(1000);
    expect(freqScale(24000, false).toX(12000)).toBeCloseTo(0.5);
    expect(bandRanges([2000], 24000)).toEqual([{ min: 0, max: 2000, width: 2000 }, { min: 2000, max: 24000, width: 22000 }]);
    expect(tidyHz(1234.5)).toBe(1230);
    expect(tidyHz(56.78)).toBe(56.8);
  });

  it('keeps a flat sum with the steeper crossovers', () => {
    const rate = 48000;
    let seed = 11;
    const noise = Float32Array.from({ length: rate }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5));
    const bands = splitBands(noise, [300, 3000], rate, 48);
    const sum = new Float32Array(noise.length);
    for (const b of bands) for (let i = 0; i < b.length; i++) sum[i] += b[i];
    expect(rms(sum.subarray(4800)) / rms(noise.subarray(4800))).toBeCloseTo(1, 1);
    // A tone well inside the low band hardly leaks into the high band.
    const tone = sine(rate, rate / 100);
    const [, hi] = splitBands(tone, [1000], rate, 48);
    expect(rms(hi.subarray(4800))).toBeLessThan(0.001);
  });

  it('splits into one file per band from a preset', async () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
    };
    localStorage.clear();
    const { App } = await import('../src/app.js');
    const { FEATURES } = await import('../src/features.js');
    const { AudioFile } = await import('../src/model/audio-file.js');
    const { Channel } = await import('../src/audio/channel.js');
    const { BAND_PRESETS } = await import('../src/commands/band-splitter.js');
    const app = new App();
    for (const install of FEATURES) install(app);
    app.syncGraph = () => {};
    app.addDocument(new AudioFile({ name: 'b.wav', sampleRate: 48000, channels: [Channel.fromSamples(sine(48000, 480).slice(0, 4800))] }));
    const done = app.commands.run('edit.bandSplitter');
    const dialog = document.querySelector('.bands-dialog');
    const preset = dialog.querySelector('.dlg-preset');
    preset.value = String(BAND_PRESETS.findIndex((p) => p.crossovers.length === 2));
    preset.dispatchEvent(new Event('change'));
    expect(dialog.querySelectorAll('.bands-xover').length).toBe(2);
    expect(dialog.querySelectorAll('.bands-n[aria-pressed="true"]').length).toBe(3);
    dialog.querySelectorAll('.bands-n')[4].click();
    expect(dialog.querySelectorAll('.bands-xover').length).toBe(4);
    dialog.querySelector('.dialog-foot .btn.primary').click();
    await done;
    expect(app.documents.length).toBe(6);
    expect(app.prefs.get('bandSplitter').crossovers.length).toBe(4);
  });
});
