// Mix Paste, Convert Sample Type and Interpret Sample Rate: the state changes
// behind the dialogs and the dialogs themselves.
import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { mixPasteState, convertState, convertChannelData, quantizeChannels, convertProblem, CONVERT_PRESETS } from '../src/commands/edit-dialogs.js';

const ch = (arr) => Channel.fromSamples(Float32Array.from(arr));
const stateOf = (...chans) => ({ sampleRate: 1000, channels: chans.map(ch), markers: [], bitDepth: 32 });
const arr = (state, i = 0) => Array.from(state.channels[i].toArray());

async function makeApp() {
  HTMLCanvasElement.prototype.getContext = () => null;
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  };
  localStorage.clear();
  const { App } = await import('../src/app.js');
  const { FEATURES } = await import('../src/features.js');
  const app = new App();
  for (const install of FEATURES) install(app);
  app.syncGraph = () => {};
  return app;
}

describe('mix paste', () => {
  const src = [Float32Array.from([1, 1])];

  it('overlaps, overwrites, inserts and modulates', () => {
    const s = stateOf([0.5, 0.5, 0.5, 0.5]);
    expect(arr(mixPasteState(s, 1, src, { type: 'overlap' }))).toEqual([0.5, 1.5, 1.5, 0.5]);
    expect(arr(mixPasteState(s, 1, src, { type: 'overwrite' }))).toEqual([0.5, 1, 1, 0.5]);
    expect(arr(mixPasteState(s, 1, src, { type: 'insert' }))).toEqual([0.5, 1, 1, 0.5, 0.5, 0.5]);
    expect(arr(mixPasteState(s, 1, [Float32Array.from([0.5, 2])], { type: 'modulate' }))).toEqual([0.5, 0.25, 1, 0.5]);
  });

  it('applies volumes, inversion and loops, and grows the file past its end', () => {
    const s = stateOf([1, 1, 1]);
    const out = mixPasteState(s, 2, src, { type: 'overlap', copied: 0.5, existing: 0.5, invert: true, loops: 2 });
    expect(arr(out)).toEqual([1, 1, 0, -0.5, -0.5, -0.5]);
  });

  it('crossfades the pasted audio in and out', () => {
    const s = stateOf(new Array(8).fill(0));
    const out = arr(mixPasteState(s, 0, [new Float32Array(8).fill(1)], { type: 'overlap', fadeFrames: 4 }));
    expect(out[0]).toBeCloseTo(0.125);
    expect(out[3]).toBeCloseTo(0.875);
    expect(out[4]).toBeCloseTo(0.875);
    expect(out[7]).toBeCloseTo(0.125);
  });

  it('leaves channels outside the mask alone and spreads a mono source', () => {
    const s = stateOf([0, 0], [0, 0]);
    const out = mixPasteState(s, 0, src, { type: 'overlap', mask: [false, true] });
    expect(arr(out, 0)).toEqual([0, 0]);
    expect(arr(out, 1)).toEqual([1, 1]);
  });
});

describe('convert sample type', () => {
  it('mixes channels with levels', () => {
    const [mono] = convertChannelData([Float32Array.from([1, 1]), Float32Array.from([0, 1])], 1, { left: 1, right: 0.5 });
    expect(Array.from(mono)).toEqual([1, 1.5]);
    const [l, r] = convertChannelData([Float32Array.from([1, -1])], 2, { left: 1, right: 0.5 });
    expect(Array.from(l)).toEqual([1, -1]);
    expect(Array.from(r)).toEqual([0.5, -0.5]);
  });

  it('rounds to a lower bit depth', () => {
    const [q] = quantizeChannels([Float32Array.from([0.3, -0.71])], 8, 'none');
    expect(q[0]).toBe(Math.round(0.3 * 128) / 128);
    expect(q[1]).toBe(Math.round(-0.71 * 128) / 128);
    const x = [Float32Array.from([0.3])];
    expect(quantizeChannels(x, 32)).toBe(x);
  });

  it('converts rate, channels and bit depth together', () => {
    const resample = (x, from, to) => Float32Array.from({ length: Math.round((x.length * to) / from) }, (_, i) => x[Math.floor((i * from) / to)]);
    const s = { ...stateOf([0.25, 0.25, 0.25, 0.25], [0.75, 0.75, 0.75, 0.75]), markers: [{ id: 'm', start: 2, duration: 2 }] };
    const out = convertState(s, { rate: 500, channels: 1, bits: 16, dither: 'none', mix: { left: 0.5, right: 0.5 } }, resample);
    expect(out.sampleRate).toBe(500);
    expect(out.channels.length).toBe(1);
    expect(arr(out)).toEqual([0.5, 0.5]);
    expect(out.bitDepth).toBe(16);
    expect(out.markers[0]).toMatchObject({ start: 1, duration: 1 });
  });

  it('validates rates and offers presets', () => {
    expect(convertProblem({ rate: 500 })).not.toBe('');
    expect(convertProblem({ rate: 44100 })).toBe('');
    expect(CONVERT_PRESETS[0].rate).toBeNull();
  });

  it('applies a preset from the dialog', async () => {
    const app = await makeApp();
    const { AudioFile } = await import('../src/model/audio-file.js');
    const doc = new AudioFile({ name: 'c.wav', sampleRate: 44100, channels: [ch([0.1, 0.2]), ch([0.3, 0.4])], info: { bitDepth: 32 } });
    app.addDocument(doc);
    const done = app.commands.run('edit.convertSampleType');
    const dialog = document.querySelector('.convert-dialog');
    const preset = dialog.querySelector('.dlg-preset');
    preset.value = String(CONVERT_PRESETS.findIndex((p) => p.name.startsWith('Podcast')));
    preset.dispatchEvent(new Event('change'));
    expect(dialog.querySelector('[aria-label="Channels"]').value).toBe('1');
    dialog.querySelector('.dialog-foot .btn.primary').click();
    await done;
    expect(doc.channelCount).toBe(1);
    expect(doc.state.bitDepth).toBe(16);
  });
});

describe('interpret sample rate', () => {
  it('shows the resulting duration and reinterprets the file', async () => {
    const app = await makeApp();
    const { AudioFile } = await import('../src/model/audio-file.js');
    const doc = new AudioFile({ name: 'i.wav', sampleRate: 48000, channels: [Channel.fromSamples(new Float32Array(48000))] });
    app.addDocument(doc);
    const done = app.commands.run('edit.interpretRate');
    const dialog = [...document.querySelectorAll('.dialog')].pop();
    const input = dialog.querySelector('input');
    input.value = '24000';
    input.dispatchEvent(new Event('input'));
    expect(dialog.textContent).toContain('48000 Hz');
    expect(dialog.textContent).toContain(app.formatTime(48000, 24000));
    dialog.querySelector('.dialog-foot .btn.primary').click();
    await done;
    expect(doc.sampleRate).toBe(24000);
  });
});
