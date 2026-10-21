import { describe, it, expect } from 'vitest';
import { Channel, BLOCK } from '../src/audio/channel.js';

const ramp = (n, from = 0) => Float32Array.from({ length: n }, (_, i) => from + i);

describe('Channel', () => {
  it('splits long input into blocks and reads back exactly', () => {
    const c = Channel.fromSamples(ramp(BLOCK * 2 + 10));
    expect(c.pieces.length).toBe(3);
    expect(c.length).toBe(BLOCK * 2 + 10);
    expect(Array.from(c.toArray(BLOCK - 2, BLOCK + 2))).toEqual([BLOCK - 2, BLOCK - 1, BLOCK, BLOCK + 1]);
  });

  it('slices and splices without copying sample blocks', () => {
    const c = Channel.fromSamples(ramp(100));
    const s = c.splice(10, 20, Channel.fromSamples(ramp(3, 1000)));
    expect(s.length).toBe(93);
    expect(Array.from(s.toArray(8, 14))).toEqual([8, 9, 1000, 1001, 1002, 20]);
    expect(s.pieces[0].block).toBe(c.pieces[0].block);
    expect(c.length).toBe(100);
  });

  it('reads past either end as silence', () => {
    const c = Channel.fromSamples(ramp(4, 1));
    expect(Array.from(c.read(-2, new Float32Array(8)))).toEqual([0, 0, 1, 2, 3, 4, 0, 0]);
  });

  it('shares one zero block for silence', () => {
    const s = Channel.silence(BLOCK * 3);
    expect(new Set(s.pieces.map((p) => p.block)).size).toBe(1);
    expect(s.toArray(5, 8).every((v) => v === 0)).toBe(true);
  });

  it('visits contiguous runs in order', () => {
    const c = Channel.fromSamples(ramp(10)).concat(Channel.fromSamples(ramp(10, 10)));
    const seen = [];
    c.forEachRun(5, 15, (run, at) => seen.push([at, run.length]));
    expect(seen).toEqual([
      [5, 5],
      [10, 5],
    ]);
  });
});
