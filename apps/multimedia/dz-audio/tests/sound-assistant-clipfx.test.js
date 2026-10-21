// Per-clip effect chains (Sound Assistant) in the mix core and session graph.
import { describe, it, expect } from 'vitest';
import { ChunkStore, renderBlock, createScratch, CHUNK } from '../src/engine/mixcore.js';
import { graphFxKeys } from '../src/engine/fxhost.js';
import { buildSessionGraph } from '../src/model/session-graph.js';
import { createSessionState, createClip } from '../src/model/session-edits.js';
import { Channel } from '../src/audio/channel.js';
import '../src/effects/index.js';

function setup(clips, trackFx = []) {
  const store = new ChunkStore();
  store.put('k', 0, [new Float32Array(CHUNK).fill(0.5), new Float32Array(CHUNK).fill(0.25)]);
  const graph = { tracks: [{ id: 't', gain: 1, pan: 0, clips, fx: trackFx }], master: { gain: 1 } };
  return { store, graph };
}

const clip = (o) => ({ id: 'c', source: 'k', channels: 2, start: 0, offset: 0, length: 100, gain: 1, fadeIn: 0, fadeOut: 0, ...o });

describe('clip effect chains in mixcore', () => {
  it('runs a clip chain on that clip only, once per block', () => {
    const { store, graph } = setup([clip({ id: 'a', fx: [{ key: 'x' }] }), clip({ id: 'b', start: 0 })]);
    const calls = [];
    const runFx = (chain, buf, frames) => {
      calls.push(chain[0].key);
      for (let i = 0; i < frames; i++) {
        buf[0][i] *= 2;
        buf[1][i] *= 2;
      }
    };
    const master = [new Float32Array(128), new Float32Array(128)];
    renderBlock(graph, store, 0, 128, master, createScratch(128), { runFx });
    expect(calls).toEqual(['x']);
    // Clip a doubled (1.0) plus clip b dry (0.5).
    expect(master[0][10]).toBeCloseTo(1.5);
    expect(master[1][10]).toBeCloseTo(0.75);
    expect(master[0][110]).toBe(0);
  });

  it('keeps the chain running for the tail after the clip ends', () => {
    const { store, graph } = setup([clip({ id: 'a', length: 100, fx: [{ key: 'x' }], fxTail: 300 })]);
    let calls = 0;
    const runFx = (chain, buf, frames) => {
      calls++;
      for (let i = 0; i < frames; i++) buf[0][i] += 0.01; // a "tail" that rings on
    };
    const master = [new Float32Array(128), new Float32Array(128)];
    const scratch = createScratch(128);
    renderBlock(graph, store, 256, 128, master, scratch, { runFx }); // inside the tail
    expect(calls).toBe(1);
    expect(master[0][5]).toBeCloseTo(0.01);
    renderBlock(graph, store, 512, 128, master, scratch, { runFx }); // past the tail
    expect(calls).toBe(1);
  });

  it('mixes looped segments of one clip into one buffer', () => {
    const { store, graph } = setup([clip({ id: 'a', start: 0, length: 50, fx: [{ key: 'x' }], base: 0, full: 100 }), clip({ id: 'a', start: 50, length: 50, offset: 0, fx: [{ key: 'x' }], base: 50, full: 100 })]);
    let calls = 0;
    const master = [new Float32Array(128), new Float32Array(128)];
    renderBlock(graph, store, 0, 128, master, createScratch(128), { runFx: () => calls++ });
    expect(calls).toBe(1);
    expect(master[0][25]).toBeCloseTo(0.5);
    expect(master[0][75]).toBeCloseTo(0.5);
  });

  it('plays clips dry without an effect host', () => {
    const { store, graph } = setup([clip({ id: 'a', fx: [{ key: 'x' }] })]);
    const master = [new Float32Array(128), new Float32Array(128)];
    renderBlock(graph, store, 0, 128, master, createScratch(128));
    expect(master[0][10]).toBeCloseTo(0.5);
  });

  it('lists clip slot keys so hosts keep their instances', () => {
    const keys = graphFxKeys({ tracks: [{ fx: [{ key: 't1' }], clips: [{ fx: [{ key: 'c1' }] }, {}] }], master: { fx: [] } });
    expect([...keys].sort()).toEqual(['c1', 't1']);
  });
});

describe('clip effect chains in the session graph', () => {
  it('turns clip.fx slots into per-clip slot specs with a tail', () => {
    const state = createSessionState({ sampleRate: 48000, tracks: 1 });
    const t = state.tracks[0];
    const c = createClip({
      trackId: t.id,
      sourceId: 'src',
      start: 0,
      length: 48000,
      fx: [
        { id: 'sa-reverb', effect: 'studioReverb', values: { decay: 1000 }, enabled: true },
        { id: 'sa-loudness', effect: 'amplify', values: { left: 3, right: 3 }, enabled: true },
      ],
    });
    const pool = new Map([['src', { channels: [Channel.fromSamples(new Float32Array(48000))] }]]);
    const { graph } = buildSessionGraph({ ...state, clips: [c] }, pool);
    const gc = graph.tracks[0].clips[0];
    expect(gc.fx.map((s) => s.key)).toEqual([`clip:${c.id}:sa-reverb`, `clip:${c.id}:sa-loudness`]);
    expect(gc.fx[1].params[0]).toBe(3);
    expect(gc.fxTail).toBeGreaterThan(48000); // 1 s decay plus padding
  });

  it('keeps fx and Sound Assistant settings through createClip (session files)', () => {
    const c = createClip({ trackId: 't', sourceId: 's', fx: [{ id: 'a', effect: 'amplify', values: { left: 1 } }, null], soundAssistant: { type: 'music' } });
    expect(c.fx).toHaveLength(1);
    expect(c.soundAssistant).toEqual({ type: 'music' });
    expect(createClip({}).fx).toEqual([]);
    expect(createClip({}).soundAssistant).toBe(null);
  });

  it('reads settings saved under the earlier clip key', () => {
    expect(createClip({ essential: { type: 'sfx' } }).soundAssistant).toEqual({ type: 'sfx' });
  });
});
