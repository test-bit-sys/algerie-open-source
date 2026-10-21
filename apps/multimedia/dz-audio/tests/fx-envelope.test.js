import { describe, it, expect } from 'vitest';
import { normalizeEnvelope, valueAt, addPoint, movePoint, removePoint, renderEnvelope, MIN_GAP } from '../src/effects/envelope.js';

const base = [{ t: 0, v: 0 }, { t: 1, v: 100 }];

describe('envelope model', () => {
  it('normalizes: sorted, pinned ends, clamped values', () => {
    expect(normalizeEnvelope([{ t: 0.8, v: 500 }, { t: 0.2, v: -5 }], { min: 0, max: 100 })).toEqual([{ t: 0, v: 0 }, { t: 1, v: 100 }]);
    expect(normalizeEnvelope([], { min: 0, max: 1 })).toHaveLength(2);
    expect(normalizeEnvelope([{ t: 0.5, v: 3 }])).toEqual([{ t: 0, v: 3 }, { t: 1, v: 3 }]);
  });
  it('interpolates linearly and smoothly', () => {
    expect(valueAt(base, 0.25)).toBe(25);
    expect(valueAt(base, 0.5, true)).toBeCloseTo(50);
    expect(valueAt(base, 0.25, true)).toBeLessThan(25);
    expect(valueAt(base, -1)).toBe(0);
  });
  it('adds points on the curve between neighbours', () => {
    const { points, index } = addPoint(base, 0.5);
    expect(index).toBe(1);
    expect(points[1]).toEqual({ t: 0.5, v: 50 });
    expect(addPoint(points, 0.5).index).toBe(-1); // too close to an existing point
  });
  it('moves points without crossing neighbours and keeps ends pinned', () => {
    let { points } = addPoint(base, 0.5, 20);
    points = movePoint(points, 1, 2, 300, { min: 0, max: 100 });
    expect(points[1].t).toBeCloseTo(1 - MIN_GAP);
    expect(points[1].v).toBe(100);
    points = movePoint(points, 0, 0.4, 10);
    expect(points[0]).toEqual({ t: 0, v: 10 });
  });
  it('removes inner points only', () => {
    const { points } = addPoint(base, 0.5);
    expect(removePoint(points, 0)).toBe(points);
    expect(removePoint(points, 2)).toBe(points);
    expect(removePoint(points, 1)).toEqual(base);
  });
  it('renders per-frame values with an optional mapping', () => {
    const out = renderEnvelope([{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 0 }], 5, { map: (v) => v * 2 });
    expect([...out]).toEqual([0, 1, 2, 1, 0]);
  });
});
