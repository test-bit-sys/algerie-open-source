import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import * as E from '../src/model/edits.js';
import { createMarker } from '../src/model/markers.js';

const state = (n = 10, channels = 2) => ({
  sampleRate: 1000,
  channels: Array.from({ length: channels }, (_, c) => Channel.fromSamples(Float32Array.from({ length: n }, (_, i) => i + c * 100))),
  markers: [],
});
const arr = (s, c = 0) => Array.from(s.channels[c].toArray());

describe('edits', () => {
  it('deletes a range on all channels and shifts later markers', () => {
    const s = { ...state(), markers: [createMarker({ start: 8 }), createMarker({ start: 3 })] };
    const out = E.deleteRange(s, 2, 5);
    expect(arr(out)).toEqual([0, 1, 5, 6, 7, 8, 9]);
    expect(out.markers.map((m) => m.start)).toEqual([5]); // the cue inside the deleted range is removed
    expect(arr(s).length).toBe(10);
  });

  it('silences instead of deleting when only some channels are enabled', () => {
    const out = E.deleteRange(state(), 2, 4, [true, false]);
    expect(arr(out)).toEqual([0, 1, 0, 0, 4, 5, 6, 7, 8, 9]);
    expect(arr(out, 1)[2]).toBe(102);
  });

  it('inserts and replaces clips, spreading mono to stereo', () => {
    const clip = { sampleRate: 1000, channels: [Channel.fromSamples(new Float32Array([-1, -2]))] };
    const ins = E.insertClip(state(4), 1, clip);
    expect(arr(ins)).toEqual([0, -1, -2, 1, 2, 3]);
    expect(arr(ins, 1)).toEqual([100, -1, -2, 101, 102, 103]);
    const rep = E.replaceRange(state(4), 1, 3, clip);
    expect(arr(rep)).toEqual([0, -1, -2, 3]);
  });

  it('crops to a range', () => {
    expect(arr(E.cropRange(state(), 3, 6))).toEqual([3, 4, 5]);
  });

  it('mix-pastes with gains and extends past the end', () => {
    const clip = { channels: [Channel.fromSamples(new Float32Array([1, 1, 1]))] };
    const out = E.mixPaste(state(4, 1), 2, clip, { existing: 0.5, pasted: 2 });
    expect(arr(out)).toEqual([0, 1, 3, 3.5, 2]);
  });

  it('fades in with a linear ramp and reverses', () => {
    const s = { sampleRate: 1000, channels: [Channel.fromSamples(new Float32Array([1, 1, 1, 1, 1]))], markers: [] };
    expect(arr(E.fadeRange(s, 0, 5, 'in'))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(arr(E.reverseRange(state(4, 1), 0, 4))).toEqual([3, 2, 1, 0]);
  });

  it('converts stereo to mono by averaging', () => {
    const out = E.convertChannels(state(2), 1);
    expect(out.channels.length).toBe(1);
    expect(arr(out)).toEqual([50, 51]);
  });
});
