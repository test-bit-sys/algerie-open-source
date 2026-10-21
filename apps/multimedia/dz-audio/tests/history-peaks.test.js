import { describe, it, expect } from 'vitest';
import { History } from '../src/lib/history.js';
import { Channel } from '../src/audio/channel.js';
import { channelColumns, channelPeak } from '../src/audio/peaks.js';

describe('History', () => {
  it('undoes, redoes and drops redo entries on a new edit', () => {
    const h = new History('a');
    h.push('B', 'b');
    h.push('C', 'c');
    expect(h.undo()).toBe(true);
    expect(h.state).toBe('b');
    expect(h.redoLabel).toBe('C');
    h.push('D', 'd');
    expect(h.canRedo).toBe(false);
    expect(h.entries.map((e) => e.label)).toEqual(['Open', 'B', 'D']);
    h.goTo(0);
    expect(h.state).toBe('a');
  });
  it('respects the step limit but keeps the initial state', () => {
    const h = new History(0, { limit: 3 });
    for (let i = 1; i <= 5; i++) h.push(`s${i}`, i);
    expect(h.entries.map((e) => e.state)).toEqual([0, 4, 5]);
  });
});

describe('peaks', () => {
  it('computes per-column min and max across block levels', () => {
    const data = new Float32Array(100000);
    data[50000] = 0.9;
    data[70001] = -0.7;
    const c = Channel.fromSamples(data);
    const cols = channelColumns(c, 0, 10000, 10);
    expect(cols[2 * 5 + 1]).toBeCloseTo(0.9);
    expect(cols[2 * 7]).toBeCloseTo(-0.7);
    expect(cols[2 * 1 + 1]).toBe(0);
    expect(channelPeak(c)).toBeCloseTo(0.9);
  });
  it('marks columns outside the channel as NaN', () => {
    const cols = channelColumns(Channel.fromSamples(new Float32Array(10)), -20, 5, 8);
    expect(Number.isNaN(cols[0])).toBe(true);
    expect(cols[2 * 4]).toBe(0);
    expect(Number.isNaN(cols[2 * 7])).toBe(true);
  });
});
