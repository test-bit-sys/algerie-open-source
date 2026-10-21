import { describe, it, expect } from 'vitest';
import { selectionRange, movedEventEnd, resizedEdges, clampMoveStart } from '../src/js/views/timegrid.js';

describe('selectionRange (drag-to-create)', () => {
  it('orders the range regardless of drag direction', () => {
    const down = selectionRange(540, 660); // 9:00 dragged down to 11:00
    const up = selectionRange(660, 540); // 11:00 dragged up to 9:00
    expect(down).toEqual({ start: 540, end: 660 });
    expect(up).toEqual({ start: 540, end: 660 });
  });

  it('snaps both endpoints to the 15-minute grid', () => {
    // 9:07 -> 9:00, 10:52 -> 10:45
    expect(selectionRange(547, 652)).toEqual({ start: 540, end: 645 });
    // 9:08 rounds up to 9:15, 10:53 rounds up to 11:00
    expect(selectionRange(548, 653)).toEqual({ start: 555, end: 660 });
  });

  it('enforces a minimum duration when the drag barely moves', () => {
    expect(selectionRange(540, 543)).toEqual({ start: 540, end: 555 });
    // A zero-length drag still yields a 15-minute block.
    expect(selectionRange(600, 600)).toEqual({ start: 600, end: 615 });
  });

  it('clamps the selection to the day', () => {
    // Above midnight clamps to 0.
    expect(selectionRange(-120, 300)).toEqual({ start: 0, end: 300 });
    // Below end-of-day clamps to 1440.
    expect(selectionRange(1380, 2000)).toEqual({ start: 1380, end: 1440 });
  });

  it('keeps the minimum block inside the day at the very bottom', () => {
    // Dragging into/after the last slot still produces a valid in-day range.
    expect(selectionRange(1440, 1445)).toEqual({ start: 1425, end: 1440 });
  });

  it('supports a full-day selection', () => {
    expect(selectionRange(0, 1440)).toEqual({ start: 0, end: 1440 });
  });

  it('honors custom snap and minimum-duration options', () => {
    expect(selectionRange(547, 700, { snap: 30 })).toEqual({ start: 540, end: 690 });
    expect(selectionRange(540, 545, { minDur: 30 })).toEqual({ start: 540, end: 570 });
  });
});

describe('movedEventEnd (drag-to-move preserves duration)', () => {
  const day = new Date(2026, 6, 13).getTime(); // local midnight, a normal 24h day
  const at = (min) => {
    const d = new Date(day);
    d.setMinutes(min);
    return d.getTime();
  };

  it('preserves a short (sub-15-min) duration instead of snapping up to 15 minutes', () => {
    // Regression: a 5-minute imported event dropped at 11:00 must stay 5 minutes,
    // not grow to 15 (the old committed end derived from a SNAP_MIN-clamped value).
    const end = movedEventEnd(5 * 60_000, day, 660);
    expect(end - at(660)).toBe(5 * 60_000);
  });

  it('preserves a sub-minute duration exactly', () => {
    const end = movedEventEnd(40_000, day, 660); // 40 seconds
    expect(end - at(660)).toBe(40_000);
  });

  it('preserves a fractional-minute duration exactly', () => {
    const end = movedEventEnd(45.5 * 60_000, day, 600); // 45 min 30 s
    expect(end - at(600)).toBe(45.5 * 60_000);
  });

  it('keeps whole-minute events on the wall-clock (minutes-from-midnight) basis', () => {
    // A 60-minute event dropped at 11:00 ends at exactly 12:00 — same result the
    // pre-fix formula produced, so the common (>=15-min) path is unchanged.
    expect(movedEventEnd(60 * 60_000, day, 660)).toBe(at(720));
  });

  it('clampMoveStart reserves room for a sub-minute remainder at the bottom of the day', () => {
    // Regression: the clamp ROUNDED the duration (90m20s → 90) while the commit
    // floors + adds the remainder, so the lowest allowed drop (22:30) committed
    // an end of 00:00:20 next day — a cross-midnight sliver that lost its
    // drag/resize handles on both days.
    const durMs = 90 * 60_000 + 20_000; // 90m20s
    const startMin = clampMoveStart(1440, durMs); // dropped at the very bottom
    const end = movedEventEnd(durMs, day, startMin);
    const nextMidnight = new Date(2026, 6, 14).getTime();
    expect(end).toBeLessThanOrEqual(nextMidnight);
    // Whole-minute durations keep the exact old clamp.
    expect(clampMoveStart(1440, 90 * 60_000)).toBe(1440 - 90);
    expect(clampMoveStart(-30, 60 * 60_000)).toBe(0);
    // Short events still clamp against the 15-minute floor.
    expect(clampMoveStart(1440, 40_000)).toBe(1440 - 15);
  });
});

describe('resizedEdges (edge-resize clamps)', () => {
  it('keeps the top edge of a sub-15-min event at the start of day inside the day', () => {
    // Regression: a 00:00–00:10 event's top-edge wiggle committed s = -5
    // (23:55 of the PREVIOUS day) for any pointer position.
    expect(resizedEdges('top', 0, 0, 10)).toEqual({ s: 0, en: 10 });
    expect(resizedEdges('top', -15, 0, 10)).toEqual({ s: 0, en: 10 });
    expect(resizedEdges('top', 15, 0, 10)).toEqual({ s: 0, en: 10 });
  });

  it('keeps the bottom edge of a sub-15-min event at the end of day inside the day', () => {
    // Regression: 23:50–23:55 escaped to 00:05 the next day (en = 1445).
    expect(resizedEdges('bottom', 1440, 1430, 1435).en).toBe(1440);
    expect(resizedEdges('bottom', 1500, 1430, 1435).en).toBe(1440);
    // Dragging up can't shrink below the existing short duration.
    expect(resizedEdges('bottom', 1420, 1430, 1435).en).toBe(1435);
  });

  it('never moves the dragged edge in the wrong direction on a short event', () => {
    // Regression: dragging a 9:00–9:05 event's top edge DOWN jumped the start
    // UP to 8:50 (endMin - SNAP overrode the pointer).
    expect(resizedEdges('top', 555, 540, 545).s).toBe(540); // down: holds
    expect(resizedEdges('top', 540, 540, 545).s).toBe(540); // still: holds
    expect(resizedEdges('top', 525, 540, 545).s).toBe(525); // up: grows
  });

  it('leaves ordinary >= 15-minute resizes unchanged', () => {
    // Shrinking stops at a 15-minute minimum; growing is free; day-clamped.
    expect(resizedEdges('top', 570, 540, 600).s).toBe(570);
    expect(resizedEdges('top', 600, 540, 600).s).toBe(585);
    expect(resizedEdges('bottom', 500, 540, 600).en).toBe(555);
    expect(resizedEdges('bottom', 1500, 540, 600).en).toBe(1440);
    expect(resizedEdges('top', -30, 540, 600).s).toBe(0);
  });
});
