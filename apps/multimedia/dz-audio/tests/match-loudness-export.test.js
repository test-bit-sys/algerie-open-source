import { describe, it, expect, vi } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { exportMatched, matchExportSettings, MATCH_DEFAULTS, loudnessPanel } from '../src/analysis/loudness.js';
import { outputWriter } from '../src/batch/export-settings.js';
import { fakeApp } from './fx-helpers.js';

const doc = () => new AudioFile({ name: 'Voice.wav', sampleRate: 48000, channels: [Channel.fromSamples(new Float32Array(480).fill(0.1))] });

describe('Match Loudness export', () => {
  it('encodes the matched audio with the export settings and leaves the file alone', async () => {
    const d = doc();
    const before = d.state;
    const apply = vi.fn(async (state, plan) => ({ state: { ...state, channels: state.channels.map((c) => Channel.fromSamples(c.toArray().map((v) => v * Math.pow(10, plan.gainDb / 20)))) } }));
    const encoded = [];
    const encode = vi.fn(async (source, options) => {
      encoded.push({ source, options });
      return new Blob(['x']);
    });
    const written = [];
    const x = matchExportSettings({ format: 'flac', bitDepth: 16 });
    const name = await exportMatched(d, { action: 'gain', gainDb: 6 }, MATCH_DEFAULTS, x, { apply, encode, write: async (n, b) => (written.push([n, b]), n) });
    expect(name).toBe('Voice (matched).flac');
    expect(written).toHaveLength(1);
    expect(encoded[0].options).toMatchObject({ format: 'flac', bitDepth: 16, sampleRate: 48000, channels: 1 });
    expect(encoded[0].source.channels[0].toArray(0, 1)[0]).toBeCloseTo(0.1 * Math.pow(10, 6 / 20), 5);
    expect(d.state).toBe(before);
  });

  it('exports files that already match without processing them', async () => {
    const apply = vi.fn();
    const encode = vi.fn(async () => new Blob(['x']));
    await exportMatched(doc(), { action: 'skip', gainDb: 0 }, MATCH_DEFAULTS, matchExportSettings({}), { apply, encode, write: async (n) => n });
    expect(apply).not.toHaveBeenCalled();
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('collects downloads with unique names', async () => {
    const app = fakeApp();
    const out = await outputWriter(app, matchExportSettings({ location: 'download' }));
    expect(await out.write('A.wav', new Blob(['1']))).toBe('A.wav');
    expect(await out.write('A.wav', new Blob(['2']))).toBe('A 2.wav');
  });

  it('the panel switches Run to Export and describes where files go', () => {
    const app = fakeApp();
    app.activate = () => {};
    const panel = loudnessPanel(app);
    const box = panel.el.querySelector('.match-export input[type="checkbox"]');
    const run = panel.el.querySelector('.btn.primary');
    expect(run.textContent).toBe('Run');
    expect(panel.el.querySelector('.match-export .btn').disabled).toBe(true);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(app.prefs.get('matchLoudness').export).toBe(true);
    expect(run.textContent).toBe('Export');
    expect(panel.el.querySelector('.match-export-note').textContent).toMatch(/Wave PCM.*downloaded/);
  });
});
