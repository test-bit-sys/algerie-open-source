import { describe, it, expect } from 'vitest';
import { previewRange } from '../src/editor/preview-editor.js';

const doc = (o) => ({ length: 48000 * 600, sampleRate: 48000, view: { start: 0, end: 48000 * 10 }, hasSelection: false, selection: { start: 0, end: 0 }, ...o });

describe('preview editor range', () => {
  it('previews the visible range, or the selection within it', () => {
    expect(previewRange(doc())).toEqual({ view: [0, 480000], range: [0, 480000] });
    expect(previewRange(doc({ hasSelection: true, selection: { start: 96000, end: 960000 } })).range).toEqual([96000, 480000]);
  });

  it('declines selections out of view and ranges that are too long', () => {
    expect(previewRange(doc({ hasSelection: true, selection: { start: 900000, end: 960000 } })).range).toBe(null);
    const wide = previewRange(doc({ view: { start: 0, end: 48000 * 300 } }));
    expect(wide.range).toBe(null);
    expect(wide.tooLong).toBe(true);
    expect(previewRange(doc({ length: 0 }))).toBe(null);
  });
});
