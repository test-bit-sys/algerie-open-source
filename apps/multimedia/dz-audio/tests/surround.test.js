import { describe, it, expect } from 'vitest';
import { ChunkStore, renderBlock, createScratch, CHUNK } from '../src/engine/mixcore.js';
import { pointGains, surroundMatrix, downmixStereo, normSurround, SURROUND_DEFAULTS } from '../src/engine/surround.js';
import { buildSessionGraph } from '../src/model/session-graph.js';
import { Session } from '../src/model/session.js';
import * as S from '../src/model/session-edits.js';
import { Channel } from '../src/audio/channel.js';
import { MENUS } from '../src/ui/menus.js';
import { speakerLevels, surroundFromPoint, surroundPoint, usesSurround } from '../src/panels/surround-panner.js';

const near = (a, b) => expect(a).toBeCloseTo(b, 4);
const L = 0, R = 1, C = 2, LFE = 3, LS = 4, RS = 5;

describe('surround panner math', () => {
  it('puts a source on a speaker, between two, or spread round the room', () => {
    const at = (a, r = 100, c = 100) => [...pointGains(a, r, c)];
    near(at(0)[C], 1);
    near(at(-30)[L], 1);
    near(at(30)[R], 1);
    near(at(110)[RS], 1);
    const back = at(180);
    near(back[LS], Math.SQRT1_2);
    near(back[RS], Math.SQRT1_2);
    // No centre speaker: a phantom centre from L and R.
    const phantom = at(0, 100, 0);
    near(phantom[C], 0);
    near(phantom[L], phantom[R]);
    // The middle of the room: every main speaker alike, nothing to the LFE.
    const mid = at(77, 0);
    for (const ch of [L, R, C, LS, RS]) near(mid[ch], 1 / Math.sqrt(5));
    near(mid[LFE], 0);
    // Constant power everywhere.
    for (const a of [-170, -60, 15, 95, 140]) near(at(a, 60, 50).reduce((s, g) => s + g * g, 0), 1);
  });

  it('places a stereo track\'s inputs either side of its angle and sends to the LFE', () => {
    const [gl, gr] = surroundMatrix(SURROUND_DEFAULTS, 2);
    near(gl[L], 1);
    near(gr[R], 1);
    const [m] = surroundMatrix({ lfe: 50 }, 1);
    near(m[C], 1);
    near(m[LFE], 0.5);
    expect(normSurround({ angle: 999, radius: -4 })).toMatchObject({ angle: 180, radius: 0 });
  });

  it('downmixes 5.1 to stereo for monitoring', () => {
    const src = [0.1, 0.2, 0.3, 0.9, 0.4, 0.5].map((v) => new Float32Array([v]));
    const dst = [new Float32Array(1), new Float32Array(1)];
    downmixStereo(src, dst, 1);
    near(dst[0][0], 0.1 + Math.SQRT1_2 * (0.3 + 0.4));
    near(dst[1][0], 0.2 + Math.SQRT1_2 * (0.3 + 0.5));
  });
});

describe('5.1 mixing', () => {
  const clip = (o = {}) => ({ id: 'c', source: 'st', channels: 2, start: 0, offset: 0, length: 1000, gain: 1, fadeIn: 0, fadeOut: 0, ...o });
  const store = () => {
    const s = new ChunkStore();
    s.put('st', 0, [new Float32Array(CHUNK).fill(0.5), new Float32Array(CHUNK).fill(0.25)]);
    s.put('six', 0, [1, 2, 3, 4, 5, 6].map((v) => new Float32Array(CHUNK).fill(v / 10)));
    return s;
  };
  const render = (graph) => {
    const master = Array.from({ length: 6 }, () => new Float32Array(128));
    const meters = new Map();
    renderBlock({ surround: true, master: { gain: 1 }, ...graph }, store(), 0, 128, master, createScratch(128), { meters });
    return { out: master.map((c) => c[64]), meters };
  };

  it('places stereo tracks with their panner and ignores the stereo pan', () => {
    let { out } = render({ tracks: [{ id: 't', gain: 1, pan: 1, fx: [], clips: [clip()], surround: {} }] });
    expect(out).toEqual([0.5, 0.25, 0, 0, 0, 0]);
    ({ out } = render({ tracks: [{ id: 't', gain: 1, pan: 0, fx: [], clips: [clip()], surround: { angle: 180, spread: 140 } }] }));
    // Turned round to face the back, the image rotates: its left input lands on Rs.
    near(out[RS], 0.5);
    near(out[LS], 0.25);
    near(out[L], 0);
  });

  it('plays 5.1 tracks channel for channel and stereo sources on their L/R', () => {
    let { out, meters } = render({ tracks: [{ id: 't', six: true, gain: 0.5, pan: 0, fx: [], clips: [clip({ source: 'six', channels: 6 })] }] });
    [0.05, 0.1, 0.15, 0.2, 0.25, 0.3].forEach((v, i) => near(out[i], v));
    near(meters.get('t')[0], 0.25);
    near(meters.get('t')[1], 0.3);
    ({ out } = render({ tracks: [{ id: 't', six: true, gain: 1, pan: 0, fx: [], clips: [clip()] }] }));
    expect(out).toEqual([0.5, 0.25, 0, 0, 0, 0]);
  });

  it('collects inputs in 5.1 buses and downmixes 5.1 tracks into stereo buses', () => {
    let { out } = render({
      tracks: [
        { id: 'a', gain: 1, pan: 0, fx: [], output: 'bus', clips: [clip()], surround: { angle: 0, spread: 0 } },
        { id: 'bus', bus: true, six: true, gain: 2, pan: 0, fx: [], clips: [] },
      ],
    });
    near(out[C], (0.5 + 0.25) * 2);
    ({ out } = render({
      tracks: [
        { id: 'a', six: true, gain: 1, pan: 0, fx: [], output: 'bus', clips: [clip({ source: 'six', channels: 6 })] },
        { id: 'bus', bus: true, gain: 1, pan: 0, fx: [], clips: [], surround: {} },
      ],
    }));
    near(out[L], 0.1 + Math.SQRT1_2 * (0.3 + 0.5));
    near(out[R], 0.2 + Math.SQRT1_2 * (0.3 + 0.6));
    near(out[C], 0);
  });

  it('applies the master gain to all six channels', () => {
    const { out } = render({ master: { gain: 0.5 }, tracks: [{ id: 't', six: true, gain: 1, pan: 0, fx: [], clips: [clip({ source: 'six', channels: 6 })] }] });
    near(out[RS], 0.3);
  });
});

describe('5.1 sessions', () => {
  it('a 5.1 master makes a surround graph with 5.1 tracks and panner settings', () => {
    const doc = new Session({ sampleRate: 1000, tracks: 1, masterChannels: 6 });
    expect(doc.state.master.channels).toBe(6);
    const six = S.createTrack({ name: 'Bed', channels: 6 });
    let state = S.addTrack(doc.state, six, 1);
    state = S.updateTrack(state, state.tracks[0].id, { surround: { angle: 90 } });
    const { graph } = buildSessionGraph(state, new Map());
    expect(graph.surround).toBe(true);
    expect(graph.tracks[0].surround).toEqual({ angle: 90 });
    expect(graph.tracks[1].six).toBe(true);
    const stereo = buildSessionGraph(new Session({ tracks: 1 }).state, new Map()).graph;
    expect(stereo.surround).toBeUndefined();
    expect(stereo.tracks[0].surround).toBeUndefined();
  });

  it('has 5.1 track commands in the Tracks menu', () => {
    const mt = MENUS.find((m) => m.label === 'Multitrack');
    const tracks = mt.submenu.find((x) => x.label === 'Tracks');
    expect(tracks.submenu).toEqual(expect.arrayContaining(['mt.add51', 'mt.add51Bus']));
  });
});

describe('surround panner panel helpers', () => {
  it('maps stage points to angle and radius and lists speaker levels', () => {
    const [x, y] = surroundPoint(90, 50);
    expect(surroundFromPoint(x, y)).toEqual({ angle: 90, radius: 50 });
    const levels = Object.fromEntries(speakerLevels({ angle: 0, spread: 0 }, 1));
    near(levels.C, 0);
    expect(levels.L).toBe(-Infinity);
    const doc = new Session({ tracks: 1, masterChannels: 6 });
    expect(usesSurround(doc, doc.state.tracks[0])).toBe(true);
    expect(usesSurround(new Session({ tracks: 1 }), doc.state.tracks[0])).toBe(false);
  });
});
