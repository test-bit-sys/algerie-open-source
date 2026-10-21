// Generate dialogs: preview playback of the generated signal before it is inserted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { previewPlayer, generateTonesCommand, synthesizeSpeech, clearSpeechTake, PREVIEW_SECONDS } from '../src/effects/generate-ui.js';
import { fakeApp } from './fx-helpers.js';

let played;
beforeEach(() => {
  played = [];
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
    played.push(this.src);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  URL.createObjectURL = vi.fn((blob) => `blob:${blob.size}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('generator preview', () => {
  it('plays what render() makes and stops again', async () => {
    const app = fakeApp();
    const render = vi.fn(() => ({ outs: [new Float32Array(4800)], rate: 48000 }));
    const p = previewPlayer(app, render);
    const btn = p.el.querySelector('.fx-play');
    btn.click();
    await tick();
    expect(render).toHaveBeenCalledTimes(1);
    expect(played).toHaveLength(1);
    // 44-byte header + 4800 32-bit samples.
    expect(played[0]).toBe(`blob:${44 + 4800 * 4}`);
    expect(p.playing()).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Stop preview');
    // Changes while playing render again after a short pause.
    p.refresh();
    await tick(200);
    expect(render).toHaveBeenCalledTimes(2);
    btn.click();
    expect(p.playing()).toBe(false);
    p.refresh();
    await tick(200);
    expect(render).toHaveBeenCalledTimes(2);
    p.dispose();
  });

  it('shows why a preview could not be made', async () => {
    const p = previewPlayer(fakeApp(), () => {
      throw new Error('Type some text to speak.');
    });
    p.el.querySelector('.fx-play').click();
    await tick();
    expect(p.playing()).toBe(false);
    expect(p.el.querySelector('.gen-preview-status').textContent).toBe('Type some text to speak.');
  });

  it('is in the Generate Tones dialog and previews at most the first seconds', async () => {
    const app = fakeApp();
    app.prefs.set('defaultChannels', 1);
    const run = generateTonesCommand(app);
    await tick();
    const dlg = [...document.querySelectorAll('.fx-dialog')].at(-1);
    const btn = dlg.querySelector('.dialog-foot .fx-play');
    expect(btn).toBeTruthy();
    btn.click();
    await tick();
    expect(played).toHaveLength(1);
    // Default 5 s mono at 48 kHz, float samples.
    expect(played[0]).toBe(`blob:${44 + 5 * 48000 * 4}`);
    expect(PREVIEW_SECONDS).toBeLessThanOrEqual(30);
    dlg.querySelector('.dialog-head .icon-btn').click();
    expect(await run).toBeNull();
  });
});

describe('speech takes', () => {
  it('reuses the previewed take and reshapes it without asking the service again', async () => {
    await import('./fx-wasm.js');
    clearSpeechTake();
    const rate = 16000;
    const tone = Float32Array.from({ length: rate / 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate));
    const { encodeWav } = await import('../src/audio/wav.js');
    const wav = await encodeWav({ sampleRate: rate, channels: [tone], bitDepth: 16 }).arrayBuffer();
    globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => wav.slice(0) }));
    const sdk = { ai: { txt2speech: vi.fn(async () => ({ src: 'https://example.test/a.wav' })) } };
    const s = { text: 'Hello', voice: 'polly:Joanna', language: 'en-US', neural: false, speed: 100, volume: 100 };
    const a = await synthesizeSpeech(sdk, s, rate);
    const b = await synthesizeSpeech(sdk, { ...s }, rate);
    expect(b).toBe(a);
    const quiet = await synthesizeSpeech(sdk, { ...s, volume: 50 }, rate);
    expect(sdk.ai.txt2speech).toHaveBeenCalledTimes(1);
    expect(Math.max(...quiet.outs[0])).toBeCloseTo(Math.max(...a.outs[0]) / 2, 2);
    await synthesizeSpeech(sdk, { ...s, text: 'Other' }, rate);
    expect(sdk.ai.txt2speech).toHaveBeenCalledTimes(2);
  });
});
