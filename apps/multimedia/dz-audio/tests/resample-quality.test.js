import { describe, it, expect, afterEach } from 'vitest';
import { testDsp } from './wasm-helper.js';
import { setResampleSettings, resampleSettings } from '../src/audio/dsp.js';
import { StreamResampler } from '../src/export/pipeline.js';
import { convertState } from '../src/commands/edit-dialogs.js';
import { Channel } from '../src/audio/channel.js';
import { CATEGORIES } from '../src/ui/preferences.js';
import { applyModulePrefs } from '../src/features/preferences.js';
import { DEFAULTS } from '../src/lib/prefs.js';

const tone = (f, rate, n) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / rate));
const rms = (x, a, b) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

afterEach(() => setResampleSettings({ quality: 50, filter: true }));

describe('sample-rate conversion quality', () => {
  it('quality and the pre/post filter change the output', () => {
    const d = testDsp();
    // 22.4 kHz at 96 kHz lies just above the 22.05 kHz Nyquist of 44.1 kHz.
    const x = tone(22400, 96000, 48000);
    const leak = (o) => rms(d.resample(x, 96000, 44100, undefined, o), 2000, 20000);
    const low = leak({ quality: 0, filter: true });
    const high = leak({ quality: 100, filter: true });
    const open = leak({ quality: 100, filter: false });
    expect(high).toBeLessThan(low);
    expect(high).toBeLessThan(1e-4);
    expect(open).toBeGreaterThan(high * 10);
  });

  it('every setting keeps an in-band tone', () => {
    const d = testDsp();
    const x = tone(1000, 44100, 22050);
    for (const quality of [0, 50, 100]) {
      for (const filter of [true, false]) {
        const y = d.resample(x, 44100, 48000, undefined, { quality, filter });
        expect(y.length).toBe(24000);
        for (let j = 2000; j < 22000; j += 97) expect(Math.abs(y[j] - Math.sin((2 * Math.PI * 1000 * j) / 48000))).toBeLessThan(0.02);
      }
    }
  });

  it('the preference defaults apply when no options are given', () => {
    const d = testDsp();
    const x = tone(21500, 48000, 24000);
    const def = d.resample(x, 48000, 44100);
    setResampleSettings({ quality: 0, filter: false });
    expect(resampleSettings()).toEqual({ quality: 0, filter: false });
    const changed = d.resample(x, 48000, 44100);
    expect(rms(changed, 1000, 20000)).not.toBeCloseTo(rms(def, 1000, 20000), 3);
  });

  it('applyModulePrefs hands the Data preferences to the resampler', () => {
    const values = { ...DEFAULTS, srcQuality: 80, srcFilter: false };
    applyModulePrefs({ get: (k) => values[k] });
    expect(resampleSettings()).toEqual({ quality: 80, filter: false });
  });

  it('the streaming export resampler honours the settings', () => {
    const d = testDsp();
    const x = tone(22400, 96000, 48000);
    const run = (o) => {
      const r = new StreamResampler(d, 96000, 44100, 1 << 16, o);
      const y = r.process(x);
      r.free();
      return rms(y, 2000, 20000);
    };
    expect(run({ quality: 100, filter: false })).toBeGreaterThan(run({ quality: 100, filter: true }) * 10);
  });

  it('convertState passes quality and filter to the resampler', () => {
    const calls = [];
    const state = { sampleRate: 1000, channels: [Channel.fromSamples(new Float32Array(100))], markers: [], bitDepth: 32 };
    convertState(state, { rate: 2000, channels: 1, bits: 32, quality: 90, filter: false }, (x, from, to, o) => {
      calls.push(o);
      return new Float32Array(200);
    });
    expect(calls).toEqual([{ quality: 90, filter: false }]);
  });

  it('Preferences > Data has a Sample Rate Conversion section', () => {
    const data = CATEGORIES.find((c) => c.id === 'data');
    const sec = data.sections.find((s) => s.title === 'Sample Rate Conversion');
    expect(sec.items.map((i) => i.key)).toEqual(['srcQuality', 'srcFilter']);
  });
});
