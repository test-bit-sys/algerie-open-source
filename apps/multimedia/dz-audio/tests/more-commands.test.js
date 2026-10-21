import { describe, it, expect } from 'vitest';
import { offlineSources } from '../src/multitrack/more-commands.js';

describe('link media', () => {
  const pool = new Map([
    ['a', { id: 'a', name: 'a.wav', channels: [], offline: true }],
    ['b', { id: 'b', name: 'b.wav', channels: [new Float32Array(4)] }],
  ]);
  const clips = [{ id: 'c1', sourceId: 'a' }, { id: 'c2', sourceId: 'b' }, { id: 'c3', sourceId: 'a' }];
  it('finds missing media of the selected clips, or of all clips', () => {
    expect(offlineSources({ state: { clips }, pool, selectedClips: new Set() }).map((s) => s.id)).toEqual(['a']);
    expect(offlineSources({ state: { clips }, pool, selectedClips: new Set(['c2']) })).toEqual([]);
  });
});
