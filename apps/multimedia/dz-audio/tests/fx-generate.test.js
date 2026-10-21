import { describe, it, expect } from 'vitest';
import { generateTones, generateNoise, waveSample, rng, dbToGain } from '../src/effects/generate.js';
import { placeGenerated, speechOptions, puterErrorMessage } from '../src/effects/generate-ui.js';
import { AudioFile } from '../src/model/audio-file.js';
import { Channel } from '../src/audio/channel.js';
import { fakeApp } from './fx-helpers.js';

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const crossings = (a) => {
  let n = 0;
  for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) n++;
  return n;
};

describe('tone generator', () => {
  it('produces the base frequency at the requested peak', () => {
    const t = generateTones({ rate: 48000, frames: 48000, base: 440, volumeDb: -6 });
    expect(crossings(t)).toBeGreaterThanOrEqual(439);
    expect(crossings(t)).toBeLessThanOrEqual(441);
    expect(peak(t)).toBeCloseTo(dbToGain(-6), 3);
    expect(t[0]).toBe(0);
  });
  it('scales summed harmonic components so the peak stays within the volume', () => {
    const t = generateTones({ rate: 48000, frames: 4800, base: 200, components: [1, 1, 1], volumeDb: 0 });
    expect(peak(t)).toBeLessThanOrEqual(1);
    expect(peak(t)).toBeGreaterThan(0.6);
  });
  it('skips components above Nyquist', () => {
    const t = generateTones({ rate: 8000, frames: 800, base: 3000, components: [0, 1], volumeDb: 0 });
    expect(peak(t)).toBe(0);
  });
  it('frequency-modulates around the base', () => {
    const steady = generateTones({ rate: 8000, frames: 8000, base: 400 });
    const fm = generateTones({ rate: 8000, frames: 8000, base: 400, modulateBy: 200, modFreq: 2 });
    expect(Math.abs(crossings(fm) - crossings(steady))).toBeLessThan(10);
    expect(fm.some((v, i) => Math.abs(v - steady[i]) > 0.1)).toBe(true);
  });
  it('shapes the standard waveforms', () => {
    expect(waveSample('sine', 0.25)).toBeCloseTo(1);
    expect(waveSample('triangle', 0.25)).toBe(1);
    expect(waveSample('triangle', 0.75)).toBe(-1);
    expect(waveSample('square', 0.25)).toBe(1);
    expect(waveSample('square', 0.75)).toBe(-1);
    expect(waveSample('sawtooth', 0.75)).toBeCloseTo(0.5);
    expect(waveSample('inverseSawtooth', 0.75)).toBeCloseTo(-0.5);
    // Band-limiting softens the step only near the discontinuity.
    expect(Math.abs(waveSample('sawtooth', 0.001, 0.01))).toBeLessThan(0.5);
  });
  it('returns silence for zero amplitudes or no frames', () => {
    expect(peak(generateTones({ rate: 1000, frames: 10, components: [0] }))).toBe(0);
    expect(generateTones({ rate: 1000, frames: 0 })).toHaveLength(0);
  });
});

describe('noise generator', () => {
  it('is deterministic for a seed and normalised to the volume', () => {
    const a = generateNoise({ frames: 4000, color: 'white', volumeDb: -3, seed: 7 });
    const b = generateNoise({ frames: 4000, color: 'white', volumeDb: -3, seed: 7 });
    expect(a[0]).toEqual(b[0]);
    expect(peak(a[0])).toBeCloseTo(dbToGain(-3), 5);
    const mean = a[0].reduce((s, v) => s + v, 0) / a[0].length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });
  it('colours the spectrum: pink and brown have less high-frequency energy than white', () => {
    const hfRatio = (x) => {
      const d = x.slice(1).map((v, i) => v - x[i]);
      return rms(d) / rms(x);
    };
    const [white] = generateNoise({ frames: 20000, color: 'white', seed: 3 });
    const [pink] = generateNoise({ frames: 20000, color: 'pink', seed: 3 });
    const [brown] = generateNoise({ frames: 20000, color: 'brown', seed: 3 });
    const [grey] = generateNoise({ frames: 20000, color: 'grey', seed: 3 });
    expect(hfRatio(pink)).toBeLessThan(hfRatio(white));
    expect(hfRatio(brown)).toBeLessThan(hfRatio(pink));
    expect(hfRatio(grey)).toBeLessThan(hfRatio(white));
  });
  it('intensity blends from white towards the colour', () => {
    const [half] = generateNoise({ frames: 20000, color: 'brown', intensity: 0.5, seed: 3 });
    const [full] = generateNoise({ frames: 20000, color: 'brown', intensity: 1, seed: 3 });
    const hf = (x) => rms(x.slice(1).map((v, i) => v - x[i])) / rms(x);
    expect(hf(half)).toBeGreaterThan(hf(full));
  });
  it('supports independent, mono and inverse channel styles', () => {
    const ind = generateNoise({ frames: 100, channels: 2, style: 'independent', seed: 1 });
    expect(ind[0]).not.toEqual(ind[1]);
    const mono = generateNoise({ frames: 100, channels: 2, style: 'mono', seed: 1 });
    expect(mono[0]).toEqual(mono[1]);
    const inv = generateNoise({ frames: 100, channels: 2, style: 'inverse', seed: 1 });
    expect(inv[1][5]).toBeCloseTo(-inv[0][5]);
  });
  it('rng gives values in [0, 1)', () => {
    const r = rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe('placing generated audio', () => {
  it('creates a new file when no audio file is open', () => {
    const app = fakeApp();
    app.prefs.set('defaultChannels', 2);
    const doc = placeGenerated(app, [new Float32Array(10).fill(0.5)], 8000, { label: 'Generate Tones', name: 'Tones' });
    expect(doc.channelCount).toBe(2);
    expect(doc.length).toBe(10);
    expect(doc.sampleRate).toBe(8000);
    expect(app.active).toBe(doc);
  });
  it('inserts at the playhead, or replaces the selection', () => {
    const app = fakeApp();
    const doc = new AudioFile({ name: 'a', sampleRate: 8000, channels: [Channel.silence(100)] });
    app.active = doc;
    doc.setCursor(40);
    placeGenerated(app, [new Float32Array(10).fill(1)], 8000, { label: 'Generate Noise', name: 'Noise' });
    expect(doc.length).toBe(110);
    expect(doc.selection).toMatchObject({ start: 40, end: 50 });
    doc.setSelection(0, 20);
    placeGenerated(app, [new Float32Array(5).fill(1)], 8000, { label: 'Generate Noise', name: 'Noise', placement: 'replace' });
    expect(doc.length).toBe(95);
    expect(doc.history.entries.at(-1).label).toBe('Generate Noise');
  });
});

describe('speech helpers', () => {
  it('maps voice choices to txt2speech options', () => {
    expect(speechOptions('polly:Joanna', 'en-US', true)).toEqual({ provider: 'aws-polly', voice: 'Joanna', language: 'en-US', engine: 'neural' });
    expect(speechOptions('openai:nova', 'fr-FR', false)).toMatchObject({ provider: 'openai', voice: 'nova' });
  });
  it('reads messages from the shapes Puter errors take', () => {
    expect(puterErrorMessage('boom')).toBe('boom');
    expect(puterErrorMessage(new Error('bad'))).toBe('bad');
    expect(puterErrorMessage({ error: { message: 'insufficient funds' } })).toBe('insufficient funds');
    expect(puterErrorMessage({ code: 'bad_request' })).toBe('Error bad_request');
    expect(puterErrorMessage(null)).toBe('Unknown error.');
  });
});
