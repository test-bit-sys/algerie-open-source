// Surround Reverb on 5.1: a 6-channel slot on 5.1 tracks and a 5.1 master,
// run by the effect host and the mixer, with LFE send, surround width and
// front/back balance; stereo effects stay out of 6-channel chains.
import { describe, it, expect } from 'vitest';
import { wasmBytes } from './fx-wasm.js';
import '../src/effects/catalog.js';
import { getEffect, defaults, slotSpec } from '../src/effects/index.js';
import { FxHost } from '../src/engine/fxhost.js';
import { ChunkStore, renderBlock, createScratch, CHUNK } from '../src/engine/mixcore.js';
import { buildSessionGraph } from '../src/model/session-graph.js';
import { Session } from '../src/model/session.js';
import * as S from '../src/model/session-edits.js';

const RATE = 48000;
const def = getEffect('surroundReverb');
const host = () => new FxHost(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}), RATE);
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));

/** Runs `values` on a 6-channel block with an impulse on channel `input`; rms per output channel. */
function sixOut(values, input = 2, n = 16384) {
  const h = host();
  const chain = h.sync([slotSpec(def, { ...defaults(def), mix: 100, ...values }, { key: 's', rate: RATE, channels: 6 })]);
  const buf = Array.from({ length: 6 }, () => new Float32Array(n));
  buf[input][10] = 1;
  for (let at = 0; at < n; at += 128) {
    const blk = buf.map((c) => c.subarray(at, at + 128));
    h.run(chain, blk, 128);
  }
  return buf.map(rms);
}

describe('Surround Reverb on 5.1', () => {
  it('adds LFE send, surround width and front/back balance after the impulse name', () => {
    const ids = def.params.map((p) => p.id);
    expect(ids.slice(11)).toEqual(['impulseName', 'lfeSend', 'surroundWidth', 'fbBalance']);
    expect(def.surround).toBe(true);
    expect(slotSpec(def, defaults(def), { channels: 6 }).channels).toBe(6);
    expect(slotSpec(getEffect('convolutionReverb'), defaults(getEffect('convolutionReverb')), { channels: 6 }).channels).toBeUndefined();
  });

  it('returns reverb on every speaker but the LFE, steered front to back', () => {
    const all = sixOut({});
    expect(all.filter((v, c) => c !== 3).every((v) => v > 1e-4)).toBe(true);
    expect(all[3]).toBe(0);
    const back = sixOut({ fbBalance: 100 });
    expect(back[0]).toBeLessThan(1e-6);
    expect(back[4]).toBeGreaterThan(1e-4);
    const front = sixOut({ fbBalance: -100 });
    expect(front[4]).toBeLessThan(1e-6);
    // The LFE feeds the room only through its send (its own output stays dry).
    expect(sixOut({}, 3)[0]).toBe(0);
    expect(sixOut({ lfeSend: 100 }, 3)[0]).toBeGreaterThan(1e-4);
  });

  it('runs in the mix on a 5.1 track and a 5.1 master, leaving stereo effects out', () => {
    const store = new ChunkStore();
    const click = Array.from({ length: 6 }, (_, c) => {
      const a = new Float32Array(CHUNK);
      if (c === 2) a[0] = 1;
      return a;
    });
    store.put('six', 0, click);
    const reverb = slotSpec(def, { ...defaults(def), mix: 100 }, { key: 'trk:s', rate: RATE, channels: 6 });
    const amp = slotSpec(getEffect('amplify'), { left: -96, right: -96 }, { key: 'trk:a' });
    const h = host();
    const runFx = (chain, buf, f) => h.run(h.sync(chain), buf, f);
    const render = (graph) => {
      const master = Array.from({ length: 6 }, () => new Float32Array(128));
      const scratch = createScratch(128);
      const sums = new Float64Array(6);
      for (let pos = 0; pos < 8192; pos += 128) {
        renderBlock({ surround: true, master: { gain: 1 }, ...graph }, store, pos, 128, master, scratch, { runFx });
        master.forEach((c, k) => c.forEach((v) => (sums[k] += v * v)));
      }
      return Array.from(sums);
    };
    const clip = { id: 'c', source: 'six', channels: 6, start: 0, offset: 0, length: 8192, gain: 1, fadeIn: 0, fadeOut: 0 };
    // On the track: the centre click reverberates into the front and rear pairs; the stereo amplify is left out.
    const onTrack = render({ tracks: [{ id: 't', six: true, gain: 1, pan: 0, fx: [amp, reverb], clips: [clip] }] });
    expect(onTrack[0]).toBeGreaterThan(1e-6);
    expect(onTrack[4]).toBeGreaterThan(1e-6);
    // On the master.
    const onMaster = render({ master: { gain: 1, fx: [{ ...reverb, key: 'm:s' }] }, tracks: [{ id: 't', six: true, gain: 1, pan: 0, fx: [], clips: [clip] }] });
    expect(onMaster[5]).toBeGreaterThan(1e-6);
    // Without it the click stays on C.
    const dry = render({ tracks: [{ id: 't', six: true, gain: 1, pan: 0, fx: [amp], clips: [clip] }] });
    expect(dry[0]).toBe(0);
    expect(dry[2]).toBeCloseTo(1, 5);
  });

  it('builds six-channel slots for 5.1 tracks and the 5.1 master in a session graph', () => {
    const doc = new Session({ sampleRate: RATE, tracks: 1, masterChannels: 6 });
    const six = { ...S.createTrack({ name: 'Bed', channels: 6 }), fxPower: true, fx: [{ id: 'r', effect: 'surroundReverb', values: {}, enabled: true }, { id: 'e', effect: 'parametricEq', values: {}, enabled: true }] };
    let state = S.addTrack(doc.state, six, 1);
    state = { ...state, master: { ...state.master, fxPower: true, fx: [{ id: 'm', effect: 'surroundReverb', values: {}, enabled: true }] } };
    const { graph } = buildSessionGraph(state, new Map());
    const bed = graph.tracks.find((t) => t.six);
    expect(bed.fx.map((s) => s.channels)).toEqual([6, undefined]);
    expect(graph.master.fx[0].channels).toBe(6);
  });
});
