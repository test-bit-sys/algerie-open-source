import { describe, it, expect } from 'vitest';
import { visibleMarkers, editMarkerField } from '../src/panels/markers.js';

const markers = [
  { id: 'a', name: 'Verse', start: 300, duration: 100, type: 'cue', description: '' },
  { id: 'b', name: 'intro', start: 0, duration: 0, type: 'cd', description: 'count-in' },
  { id: 'c', name: 'Chorus', start: 500, duration: 50, type: 'subclip', description: '' },
];

describe('markers panel', () => {
  it('sorts by any column in either direction', () => {
    expect(visibleMarkers(markers).map((m) => m.id)).toEqual(['b', 'a', 'c']);
    expect(visibleMarkers(markers, { sort: { col: 'name', dir: 1 } }).map((m) => m.id)).toEqual(['c', 'b', 'a']);
    expect(visibleMarkers(markers, { sort: { col: 'duration', dir: -1 } }).map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('filters by text and type', () => {
    expect(visibleMarkers(markers, { query: 'COUNT' }).map((m) => m.id)).toEqual(['b']);
    expect(visibleMarkers(markers, { types: new Set(['cue', 'subclip']) }).map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('edits times keeping the marker inside the file', () => {
    const m = markers[0];
    expect(editMarkerField(m, 'start', 950, 1000)).toMatchObject({ start: 900, duration: 100 });
    expect(editMarkerField(m, 'end', 350, 1000)).toMatchObject({ start: 300, duration: 50 });
    expect(editMarkerField(m, 'end', 100, 1000)).toMatchObject({ duration: 0 });
    expect(editMarkerField(m, 'duration', 5000, 1000)).toMatchObject({ duration: 700 });
    expect(editMarkerField(m, 'name', 'Bridge', 1000).name).toBe('Bridge');
  });
});
