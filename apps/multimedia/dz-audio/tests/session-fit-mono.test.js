import { describe, it, expect } from 'vitest';
import { fitClipsToSource, createClip } from '../src/model/session-edits.js';
import { ChunkStore, renderBlock, createScratch, CHUNK } from '../src/engine/mixcore.js';

describe('fitClipsToSource', () => {
  it('shortens clips past the new source end and leaves others alone', () => {
    const state = {
      clips: [
        createClip({ id: 'a', sourceId: 's', offset: 100, length: 900, fadeOut: { length: 500, curve: 0 } }),
        createClip({ id: 'b', sourceId: 's', offset: 0, length: 200 }),
        createClip({ id: 'c', sourceId: 's', offset: 0, length: 5000, loop: true }),
        createClip({ id: 'd', sourceId: 'x', offset: 0, length: 5000 }),
      ],
    };
    const out = fitClipsToSource(state, 's', 400);
    expect(out.clips[0]).toMatchObject({ offset: 100, length: 300 });
    expect(out.clips[0].fadeOut.length).toBe(300);
    expect(out.clips[1]).toBe(state.clips[1]);
    expect(out.clips[2]).toBe(state.clips[2]);
    expect(out.clips[3]).toBe(state.clips[3]);
    expect(fitClipsToSource(out, 's', 400)).toBe(out);
  });
});

describe('mono tracks', () => {
  it('fold a stereo clip to mono in both outputs', () => {
    const store = new ChunkStore();
    store.put('k', 0, [new Float32Array(CHUNK).fill(1), new Float32Array(CHUNK).fill(0)]);
    const clip = { id: 'c', source: 'k', channels: 2, start: 0, offset: 0, length: 1000, gain: 1, fadeIn: 0, fadeOut: 0, mono: true };
    const graph = { tracks: [{ id: 't', gain: 1, pan: 0, clips: [clip], fx: [] }], master: { gain: 1 } };
    const master = [new Float32Array(128), new Float32Array(128)];
    renderBlock(graph, store, 0, 128, master, createScratch(128));
    expect(master[0][10]).toBeCloseTo(0.5);
    expect(master[1][10]).toBeCloseTo(0.5);
  });
});
