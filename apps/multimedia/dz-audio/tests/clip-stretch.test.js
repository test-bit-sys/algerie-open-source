// Clip stretching: the pure clip model, the background renderer with its
// previews, the commands, the Move tool corner handles and the real DSP.
import { describe, it, expect, beforeAll } from 'vitest';
import './fx-wasm.js';
import * as S from '../src/model/session-edits.js';
import { Session } from '../src/model/session.js';
import { Channel } from '../src/audio/channel.js';
import { restretchClip, stretchOf, isStretched, stretchKey, originalRange, stretchClips, stretchOrigins } from '../src/model/clip-stretch.js';
import { Stretcher, varispeed, stretchIdle } from '../src/multitrack/stretch.js';
import { serializeSession, parseSession } from '../src/model/session-io.js';

const RATE = 1000;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
});

describe('clip stretch model', () => {
  const clip = () =>
    S.createClip({
      trackId: 't',
      sourceId: 'orig',
      start: 500,
      offset: 200,
      length: 400,
      fadeIn: { length: 40, curve: 0 },
      fadeOut: { length: 80, curve: 2 },
      volumeEnv: [{ t: 0, v: 0 }, { t: 400, v: -6 }],
    });

  it('stretches offset, length, fades and envelopes, and plays the derived source', () => {
    const c = restretchClip(clip(), { mode: 'realtime', ratio: 1.5 }, 'orig~derived');
    expect(c).toMatchObject({ start: 500, sourceId: 'orig~derived', offset: 300, length: 600 });
    expect(c.fadeIn.length).toBe(60);
    expect(c.fadeOut).toEqual({ length: 120, curve: 2 });
    expect(c.volumeEnv).toEqual([{ t: 0, v: 0 }, { t: 600, v: -6 }]);
    expect(c.stretch).toMatchObject({ mode: 'realtime', ratio: 1.5, semitones: 0, sourceId: 'orig' });
    expect(isStretched(c)).toBe(true);
    expect(originalRange(c)).toEqual({ sourceId: 'orig', offset: 200, length: 400 });
  });

  it('restretches from the original timing and returns to it with mode Off', () => {
    let c = restretchClip(clip(), { mode: 'rendered', ratio: 2 }, 'd2');
    c = restretchClip(c, { ratio: 0.5 }, 'd05');
    expect(c).toMatchObject({ sourceId: 'd05', offset: 100, length: 200 });
    expect(c.stretch.mode).toBe('rendered');
    c = restretchClip(c, { mode: 'off' });
    expect(c).toMatchObject({ sourceId: 'orig', offset: 200, length: 400, stretch: null });
    expect(c.fadeIn.length).toBe(40);
  });

  it('keeps a mode without changing the audio at ratio 1, and pitch alone is a stretch', () => {
    const c = restretchClip(clip(), { mode: 'realtime' });
    expect(c.sourceId).toBe('orig');
    expect(c.stretch.mode).toBe('realtime');
    expect(isStretched(c)).toBe(false);
    expect(() => restretchClip(clip(), { mode: 'realtime', semitones: 3 })).toThrow();
    const p = restretchClip(clip(), { mode: 'realtime', semitones: 3 }, 'dp');
    expect(p).toMatchObject({ sourceId: 'dp', length: 400, offset: 200 });
  });

  it('moves the start when a left handle stretches', () => {
    const c = restretchClip(clip(), { mode: 'realtime', ratio: 1.25, start: 400 }, 'd');
    expect(c.start).toBe(400);
    expect(c.length).toBe(500);
  });

  it('splits a stretched clip into halves that restretch consistently', () => {
    const c = restretchClip(clip(), { mode: 'realtime', ratio: 2 }, 'd2');
    let s = S.addClips(S.createSessionState({ sampleRate: RATE, tracks: 1 }), [{ ...c, trackId: 'x' }]);
    s = S.splitClips(s, null, c.start + 300);
    const [left, right] = s.clips;
    expect(originalRange(left)).toEqual({ sourceId: 'orig', offset: 200, length: 150 });
    expect(originalRange(right)).toEqual({ sourceId: 'orig', offset: 350, length: 250 });
    expect(restretchClip(right, { mode: 'off' })).toMatchObject({ offset: 350, length: 250, sourceId: 'orig' });
  });

  it('names derived sources by source, ratio, pitch, formants and quality', () => {
    const a = stretchKey('src', { mode: 'realtime', ratio: 1.5, semitones: 0, formants: false });
    expect(stretchKey('src', { mode: 'realtime', ratio: 1.5, semitones: 0, formants: false })).toBe(a);
    expect(stretchKey('src', { mode: 'rendered', ratio: 1.5, semitones: 0, formants: false })).not.toBe(a);
    expect(stretchKey('src', { mode: 'realtime', ratio: 1.5, semitones: 2, formants: false })).not.toBe(a);
  });

  it('skips locked clips for timing changes but not for mode changes; lists origins to save', () => {
    let s = S.createSessionState({ sampleRate: RATE, tracks: 1 });
    const c = S.createClip({ trackId: s.tracks[0].id, sourceId: 'orig', length: 100, locked: true });
    s = S.addClips(s, [c]);
    expect(stretchClips(s, [c.id], { mode: 'realtime', ratio: 2 }, () => 'd')).toBe(s);
    const m = stretchClips(s, [c.id], { mode: 'rendered' }, () => 'd');
    expect(stretchOf(m.clips[0]).mode).toBe('rendered');
    const st = stretchClips({ ...s, clips: [{ ...c, locked: false }] }, [c.id], { mode: 'realtime', ratio: 2 }, () => 'd');
    expect([...stretchOrigins(st)]).toEqual(['orig']);
  });
});

describe('varispeed preview', () => {
  it('resamples to the requested length keeping the ends', () => {
    const x = Float32Array.from({ length: 11 }, (_, i) => i);
    const y = varispeed(x, 2);
    expect(y.length).toBe(22);
    expect(y[0]).toBe(0);
    expect(y[21]).toBeCloseTo(10);
    expect(varispeed(x, 0.5).length).toBe(6);
  });
});

function sessionWithClip(len = 1000) {
  const doc = new Session({ name: 'S.asesx', sampleRate: RATE, tracks: 2 });
  const samples = Float32Array.from({ length: len }, (_, i) => Math.sin(i / 5));
  const src = doc.addSource({ name: 'take.wav', channels: [Channel.fromSamples(samples)] });
  const c = S.createClip({ trackId: doc.state.tracks[0].id, sourceId: src, name: 'take', start: 100, offset: 100, length: 600 });
  doc.apply('Insert', S.addClips(doc.state, [c]));
  return { doc, src, c };
}

function fakeRender(calls) {
  return async ({ channels, settings }) => {
    calls.push(settings);
    // A recognisable "render": constant 0.5, slightly too short (the Stretcher fits it).
    return channels.map((ch) => new Float32Array(Math.round(ch.length * settings.ratio) - 3).fill(0.5));
  };
}

describe('background stretch renders', () => {
  it('applies the stretch at once with a varispeed preview, then swaps in the render without an undo step', async () => {
    const { doc, src, c } = sessionWithClip();
    const calls = [];
    const st = new Stretcher({}, doc, { render: fakeRender(calls) });
    st.apply('Stretch Clip', [c.id], { mode: 'realtime', ratio: 1.5 });
    const clip = S.findClip(doc.state, c.id);
    expect(clip).toMatchObject({ offset: 150, length: 900 });
    const derived = doc.pool.get(clip.sourceId);
    expect(derived.pending).toBe(true);
    expect(derived.channels[0].length).toBe(1500);
    expect(derived.channels[0].toArray()[0]).toBeCloseTo(0);
    const steps = doc.history.entries.length;
    await st.whenIdle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ from: src, ratio: 1.5, mode: 'realtime' });
    const done = doc.pool.get(clip.sourceId);
    expect(done.pending).toBe(false);
    expect(done.channels[0].length).toBe(1500);
    expect(done.channels[0].toArray()[10]).toBe(0.5);
    expect(doc.history.entries.length).toBe(steps);
    // Undo plays the original again; redo reuses the render.
    doc.history.undo();
    expect(S.findClip(doc.state, c.id).sourceId).toBe(src);
    doc.history.redo();
    st.sync();
    await st.whenIdle();
    expect(calls).toHaveLength(1);
  });

  it('previews a quality change with the other render and renders the new quality', async () => {
    const { doc, c } = sessionWithClip();
    const calls = [];
    const st = new Stretcher({}, doc, { render: fakeRender(calls) });
    st.apply('Stretch', [c.id], { mode: 'realtime', ratio: 2 });
    await st.whenIdle();
    st.apply('Render', [c.id], { mode: 'rendered' });
    const hq = doc.pool.get(S.findClip(doc.state, c.id).sourceId);
    expect(hq.pending).toBe(true);
    expect(hq.channels[0].toArray()[10]).toBe(0.5);
    await st.whenIdle();
    expect(calls.map((x) => x.mode)).toEqual(['realtime', 'rendered']);
  });

  it('skips renders nothing uses and picks them up again after redo', async () => {
    const { doc, c } = sessionWithClip();
    const calls = [];
    const st = new Stretcher({}, doc, { render: fakeRender(calls) });
    st.apply('Stretch', [c.id], { mode: 'realtime', ratio: 3 });
    doc.history.undo();
    await st.whenIdle();
    expect(calls).toHaveLength(0);
    doc.history.redo();
    st.sync();
    await st.whenIdle();
    expect(calls).toHaveLength(1);
  });

  it('renders again when the original audio is edited', async () => {
    const { doc, src, c } = sessionWithClip();
    const calls = [];
    const st = new Stretcher({}, doc, { render: fakeRender(calls) });
    st.apply('Stretch', [c.id], { mode: 'realtime', ratio: 1.2 });
    await st.whenIdle();
    doc.updateSource(src, { channels: [Channel.fromSamples(new Float32Array(1000).fill(0.1))] });
    st.sync();
    await st.whenIdle();
    expect(calls).toHaveLength(2);
  });

  it('saves the original audio of a stretched clip and restores the stretch on open', async () => {
    const { doc, src, c } = sessionWithClip();
    const st = new Stretcher({}, doc, { render: fakeRender([]) });
    st.apply('Stretch', [c.id], { mode: 'rendered', ratio: 1.5, semitones: -2 });
    doc.stretcher = st;
    await stretchIdle(doc);
    const { text, media } = serializeSession(doc);
    const ids = media.map((m) => m.id);
    const clip = S.findClip(doc.state, c.id);
    expect(ids).toContain(src);
    expect(ids).toContain(clip.sourceId);
    expect(doc.usedSources().has(src)).toBe(true);
    const parsed = parseSession(text);
    expect(parsed.state.clips[0].stretch).toMatchObject({ mode: 'rendered', ratio: 1.5, semitones: -2, sourceId: src });
  });
});

async function appWithClip() {
  localStorage.clear();
  const { App } = await import('../src/app.js');
  const { installCore } = await import('../src/features/core.js');
  const { installMultitrack } = await import('../src/features/multitrack.js');
  const app = new App();
  installCore(app);
  installMultitrack(app);
  app.syncGraph = () => {};
  const { doc, src, c } = sessionWithClip();
  app.addDocument(doc);
  doc.stretcher = new Stretcher(app, doc, { render: fakeRender([]) });
  return { app, doc, src, c };
}

describe('stretch commands', () => {
  it('sets the stretch mode, renders or realtimes all stretched clips, and checks the mode', async () => {
    const { app, doc, c } = await appWithClip();
    doc.selectClips([c.id]);
    expect(app.commands.isChecked('clip.stretchModeOff')).toBe(true);
    await app.commands.run('clip.stretchModeRealtime');
    expect(app.commands.isChecked('clip.stretchModeRealtime')).toBe(true);
    expect(app.commands.isEnabled('clip.renderAll')).toBe(false);
    doc.stretcher.apply('Stretch Clip', [c.id], { ratio: 1.5 });
    expect(app.commands.isEnabled('clip.renderAll')).toBe(true);
    await app.commands.run('clip.renderAll');
    expect(stretchOf(S.findClip(doc.state, c.id)).mode).toBe('rendered');
    expect(app.commands.isEnabled('clip.realtimeAll')).toBe(true);
    await app.commands.run('clip.realtimeAll');
    expect(stretchOf(S.findClip(doc.state, c.id)).mode).toBe('realtime');
    await app.commands.run('clip.stretchModeOff');
    expect(S.findClip(doc.state, c.id)).toMatchObject({ length: 600, offset: 100, stretch: null });
    await doc.stretcher.whenIdle();
  });

  it('toggles global clip stretching and opens the original audio of a stretched clip', async () => {
    const { app, doc, c } = await appWithClip();
    expect(app.commands.isChecked('clip.globalStretch')).toBe(false);
    await app.commands.run('clip.globalStretch');
    expect(app.prefs.get('clipStretching')).toBe(true);
    doc.stretcher.apply('Stretch Clip', [c.id], { mode: 'realtime', ratio: 2 });
    await doc.stretcher.whenIdle();
    await app.commands.run('clip.editSource', { id: c.id });
    const file = app.active;
    expect(file.kind).toBe('audio');
    expect(file.length).toBe(1000);
    expect([file.selection.start, file.selection.end]).toEqual([100, 700]);
  });

  it('sets stretch, pitch and mode in Stretch Properties, linking stretch and duration', async () => {
    const { app, doc, c } = await appWithClip();
    doc.selectClips([c.id]);
    const run = app.commands.run('clip.stretch');
    const dlg = document.querySelector('.dialog');
    const pct = dlg.querySelector('[aria-label="Stretch percentage"]');
    const dur = dlg.querySelector('[aria-label="Duration in seconds"]');
    const mode = dlg.querySelector('[aria-label="Stretch mode"]');
    expect(mode.value).toBe('off');
    dur.value = '0.9';
    dur.dispatchEvent(new Event('input'));
    expect(pct.value).toBe('150');
    expect(mode.value).toBe('realtime');
    dlg.querySelector('[aria-label="Pitch shift in semitones"]').value = '-3';
    dlg.querySelector('.btn.primary').click();
    await run;
    const clip = S.findClip(doc.state, c.id);
    expect(stretchOf(clip)).toMatchObject({ mode: 'realtime', ratio: 1.5, semitones: -3 });
    expect(clip.length).toBe(900);
    expect(doc.history.undoLabel).toBe('Stretch Properties');
    await doc.stretcher.whenIdle();
  });

  it('stretches a clip by dragging its top-right corner with the Move tool', async () => {
    const { app, doc, c } = await appWithClip();
    const view = app.documentKinds.get('session').view(app, doc);
    document.body.replaceChildren(view.el);
    view.width = 1000;
    view.height = 600;
    view.computeRows();
    doc.setView(0, 1000);
    app.currentView = () => view;
    app.tool = 'move';
    const r = view.clipRects().find((x) => x.clip.id === c.id);
    expect(view.hitTest(r.x1 - 3, r.y + 3).part).toBe('fadeOut');
    app.prefs.set('clipStretching', true);
    expect(view.hitTest(r.x1 - 3, r.y + 3).part).toBe('stretchOut');
    expect(view.hitTest(r.x0 + 3, r.y + 3).part).toBe('stretchIn');
    expect(view.hitTest(r.x1 - 3, r.y + 60).part).toBe('edgeOut');
    view.surface.setPointerCapture = () => {};
    const fire = (type, x, y) => view.surface.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    fire('pointerdown', r.x1 - 3, r.y + 3);
    fire('pointermove', r.x1 - 3 + 150, r.y + 3);
    expect(doc.viewState.clips.find((x) => x.id === c.id).stretchPreview).toBeCloseTo(1.25, 2);
    fire('pointerup', r.x1 - 3 + 150, r.y + 3);
    const clip = S.findClip(doc.state, c.id);
    expect(clip.length).toBe(750);
    expect(clip.stretchPreview).toBeUndefined();
    expect(stretchOf(clip)).toMatchObject({ mode: 'realtime', ratio: 1.25 });
    expect(doc.history.undoLabel).toBe('Stretch Clip');
    await doc.stretcher.whenIdle();
    view.destroy();
  });
});

describe('stretch DSP', () => {
  it('renders a stretched tone at the same pitch with the real Stretch and Pitch process', async () => {
    const rate = 48000;
    const doc = new Session({ name: 'S.asesx', sampleRate: rate, tracks: 1 });
    const n = rate;
    const tone = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
    const src = doc.addSource({ name: 'tone.wav', channels: [Channel.fromSamples(tone)] });
    const c = S.createClip({ trackId: doc.state.tracks[0].id, sourceId: src, length: n });
    doc.apply('Insert', S.addClips(doc.state, [c]));
    const st = new Stretcher({}, doc);
    st.apply('Stretch', [c.id], { mode: 'realtime', ratio: 1.5 });
    await st.whenIdle();
    const out = doc.pool.get(S.findClip(doc.state, c.id).sourceId);
    expect(out.pending).toBe(false);
    const y = out.channels[0].toArray();
    expect(y.length).toBe(Math.round(n * 1.5));
    // Zero crossings in the middle: still about 440 Hz.
    const mid = y.subarray(y.length / 4, (3 * y.length) / 4);
    let crossings = 0;
    for (let i = 1; i < mid.length; i++) if (mid[i - 1] < 0 && mid[i] >= 0) crossings++;
    expect((crossings * rate) / mid.length).toBeGreaterThan(420);
    expect((crossings * rate) / mid.length).toBeLessThan(460);
  });
});
