import { describe, it, expect, vi } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { registerEffect, EFFECTS } from '../src/effects/registry.js';
import { writeResult, renderEffect, isAbort } from '../src/effects/apply.js';
import { applyEffectToDoc, runEffect, installEffectCommands, peakOf } from '../src/effects/commands.js';
import { fakeApp, filled } from './fx-helpers.js';

const state = (chs) => ({ sampleRate: 1000, channels: chs.map((c) => Channel.fromSamples(c)), markers: [] });
const arr = (c, a = 0, b = c.length) => [...c.toArray(a, b)];

/** Stand-in for applyChain: doubles the input and adds `tail` frames of 0.5. */
function fakeChain(calls = []) {
  return vi.fn(async (channels, rate, specs, { start, end, tail = 0, onProgress }) => {
    calls.push({ specs, start, end, tail });
    onProgress?.(1);
    return channels.slice(0, 2).map((c) => {
      const out = new Float32Array(end - start + tail).fill(0.5);
      out.set(c.toArray(start, end).map((v) => v * 2));
      return out;
    });
  });
}

const testDouble = { id: 'testDouble', name: 'Test Double', group: 'Special', kind: 99, params: [{ id: 'amount', min: 0, max: 1, default: 1 }] };
const testTail = { ...testDouble, id: 'testTail', name: 'Test Tail', tail: (v, rate) => rate / 100 };
const testStretch = {
  id: 'testStretch',
  name: 'Test Stretch',
  group: 'Special',
  kind: null,
  params: [{ id: 'factor', min: 1, max: 4, step: 1, default: 2 }],
  process: async ({ channels, values }) => ({ channels: channels.map((c) => {
    const out = new Float32Array(c.length * values.factor);
    for (let i = 0; i < out.length; i++) out[i] = c[Math.floor(i / values.factor)];
    return out;
  }), markers: [{ start: 1, name: 'Found' }] }),
};
registerEffect(testDouble);
registerEffect(testTail);
registerEffect(testStretch);

describe('writeResult', () => {
  it('writes a processed range and mixes the tail into what follows', () => {
    const s = state([filled(10, 0.1)]);
    const out = new Float32Array(5).fill(1);
    const next = writeResult(s, 2, 4, [out], null, { tail: 3 });
    expect(arr(next.channels[0])).toEqual([0.1, 0.1, 1, 1, 1.1, 1.1, 1.1, 0.1, 0.1, 0.1].map((v) => Math.fround(v)));
  });
  it('drops tail frames past the end of the file', () => {
    const s = state([filled(4, 0)]);
    const next = writeResult(s, 2, 4, [new Float32Array(6).fill(1)], null, { tail: 4 });
    expect(next.channels[0].length).toBe(4);
  });
  it('only writes masked channels', () => {
    const s = state([filled(4, 0), filled(4, 0)]);
    const next = writeResult(s, 0, 4, [filled(4, 1), filled(4, 1)], [false, true]);
    expect(arr(next.channels[0])).toEqual([0, 0, 0, 0]);
    expect(arr(next.channels[1])).toEqual([1, 1, 1, 1]);
  });
  it('replaces the range when the length changes on all channels', () => {
    const s = state([filled(6, (i) => i)]);
    s.markers = [{ id: 'm', name: 'end', start: 5, duration: 0, type: 'cue' }];
    const next = writeResult(s, 1, 3, [filled(4, 9)], null);
    expect(arr(next.channels[0])).toEqual([0, 9, 9, 9, 9, 3, 4, 5]);
    expect(next.markers[0].start).toBe(7);
  });
  it('fits a length change to the range when only some channels are written', () => {
    const s = state([filled(4, 0), filled(4, 0)]);
    const next = writeResult(s, 0, 4, [filled(8, 1)], [true, false]);
    expect(next.channels[0].length).toBe(4);
    expect(arr(next.channels[0])).toEqual([1, 1, 1, 1]);
  });
});

describe('renderEffect', () => {
  it('runs realtime effects through applyChain with tail frames', async () => {
    const calls = [];
    const s = state([filled(1000, 0.25), filled(1000, 0.25)]);
    const { state: next, length } = await renderEffect({ def: EFFECTS.get('testTail'), values: {}, state: s, start: 100, end: 200, applyChain: fakeChain(calls) });
    expect(length).toBe(100);
    expect(calls[0]).toMatchObject({ start: 100, end: 200, tail: 10 });
    expect(calls[0].specs[0]).toMatchObject({ key: 'apply', kind: 99, params: [1], enabled: true });
    expect(next.channels[0].toArray(150, 151)[0]).toBe(0.5);
    expect(next.channels[0].toArray(205, 206)[0]).toBe(0.75); // 0.25 + tail 0.5
    expect(next.channels[0].toArray(215, 216)[0]).toBe(0.25);
  });
  it('runs offline processes, accepting length changes and markers', async () => {
    const s = state([filled(10, (i) => i)]);
    const { state: next, length } = await renderEffect({ def: EFFECTS.get('testStretch'), values: { factor: 2 }, state: s, start: 2, end: 4 });
    expect(length).toBe(4);
    expect(arr(next.channels[0])).toEqual([0, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9]);
    expect(next.markers).toHaveLength(1);
    expect(next.markers[0]).toMatchObject({ start: 3, name: 'Found' });
  });
  it('refuses effects that have neither WASM nor a process', async () => {
    const def = { id: 'x', name: 'Nothing', kind: null, params: [] };
    await expect(renderEffect({ def, values: {}, state: state([filled(4, 0)]), start: 0, end: 4 })).rejects.toThrow(/cannot be applied/);
  });
});

describe('effect commands', () => {
  const setup = () => {
    const app = fakeApp();
    installEffectCommands(app);
    const doc = new AudioFile({ name: 'a.wav', sampleRate: 1000, channels: [Channel.fromSamples(filled(1000, 0.1)), Channel.fromSamples(filled(1000, 0.1))] });
    app.active = doc;
    return { app, doc };
  };

  it('registers fx.<id> for every registered effect with dialog labels', () => {
    const { app } = setup();
    expect(app.commands.label('fx.amplify')).toBe('Amplify...');
    expect(app.commands.get('fx.testDouble').repeatable).toBe(true);
    expect(app.commands.isEnabled('fx.testDouble')).toBe(true);
  });

  it('applies to the selection as one undo step and honours the channel mask', async () => {
    const { app, doc } = setup();
    doc.setSelection(100, 300, { channels: [true, false] });
    const applied = [];
    app.on('fx-applied', (e) => applied.push(e));
    const ok = await applyEffectToDoc(app, doc, EFFECTS.get('testDouble'), { amount: 0.5 }, { applyChain: fakeChain() });
    expect(ok).toBe(true);
    expect(doc.history.entries.at(-1).label).toBe('Test Double');
    expect(doc.state.channels[0].toArray(150, 151)[0]).toBeCloseTo(0.2);
    expect(doc.state.channels[1].toArray(150, 151)[0]).toBeCloseTo(0.1);
    expect(doc.state.channels[0].toArray(50, 51)[0]).toBeCloseTo(0.1);
    expect(doc.selection).toMatchObject({ start: 100, end: 300 });
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ effect: 'testDouble', values: { amount: 0.5 }, name: 'Test Double', doc, before: [100, 300] });
    expect(app.prefs.get('fxLast').testDouble).toEqual({ amount: 0.5 });
    doc.history.undo();
    expect(doc.state.channels[0].toArray(150, 151)[0]).toBeCloseTo(0.1);
  });

  it('processes the whole file without a selection', async () => {
    const { app, doc } = setup();
    const calls = [];
    await applyEffectToDoc(app, doc, EFFECTS.get('testDouble'), {}, { applyChain: fakeChain(calls) });
    expect(calls[0]).toMatchObject({ start: 0, end: 1000 });
  });

  it('repeats with the last values and no dialog', async () => {
    const { app, doc } = setup();
    app.prefs.set('fxLast', { testStretch: { factor: 3 } });
    doc.setSelection(0, 10);
    await app.commands.run('fx.testStretch', { repeat: true });
    expect(doc.length).toBe(1020);
    expect(app.lastCommand.id).toBe('fx.testStretch');
    expect(document.querySelector('.fx-dialog')).toBeNull();
  });

  it('applies given values directly (favorites)', async () => {
    const { app, doc } = setup();
    doc.setSelection(0, 10);
    await runEffect(app, 'testStretch', { values: { factor: 4 } });
    expect(doc.length).toBe(1030);
  });

  it('reports cancellation without changing the file', async () => {
    const { app, doc } = setup();
    const chain = vi.fn(async () => {
      const e = new Error('Cancelled');
      throw e;
    });
    const before = doc.state;
    expect(await applyEffectToDoc(app, doc, EFFECTS.get('testDouble'), {}, { applyChain: chain })).toBe(false);
    expect(doc.state).toBe(before);
    expect(isAbort(new DOMException('Cancelled', 'AbortError'))).toBe(true);
  });

  it('normalizes peaks and converts channel layouts', async () => {
    const { app, doc } = setup();
    doc.setSelection(0, 1000);
    await app.commands.run('fx.normalizePeak', { peak: -6 });
    expect(peakOf(doc.state, 0, 1000)).toBeCloseTo(Math.pow(10, -6 / 20), 5);
    await app.commands.run('fx.toMono');
    expect(doc.channelCount).toBe(1);
    expect(app.commands.isEnabled('fx.toMono')).toBe(false);
    await app.commands.run('fx.toStereo');
    expect(doc.channelCount).toBe(2);
  });

  it('fades the selection in', async () => {
    const { app, doc } = setup();
    doc.setSelection(0, 101);
    await app.commands.run('fx.fadeIn');
    expect(doc.state.channels[0].toArray(0, 1)[0]).toBe(0);
    expect(doc.state.channels[0].toArray(50, 51)[0]).toBeCloseTo(0.05);
  });
});
