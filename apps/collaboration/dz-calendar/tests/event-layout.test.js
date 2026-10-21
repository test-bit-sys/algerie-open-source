import { describe, it, expect } from 'vitest';
import { layoutColumns, splitDayEvents } from '../src/js/event-layout.js';

const H = 3_600_000; // one hour in ms
const base = new Date(2026, 6, 12).getTime(); // local midnight
const at = (hour) => base + hour * H;

function ev(id, startHour, endHour, extra = {}) {
  return { id, start: at(startHour), end: at(endHour), ...extra };
}

describe('layoutColumns', () => {
  it('gives sequential (non-overlapping) events a single column each', () => {
    const out = layoutColumns([ev('a', 9, 10), ev('b', 10, 11), ev('c', 11, 12)]);
    for (const item of out) {
      expect(item.colCount).toBe(1);
      expect(item.colIndex).toBe(0);
    }
  });

  it('places two overlapping events side by side', () => {
    const out = layoutColumns([ev('a', 9, 11), ev('b', 10, 12)]);
    const a = out.find((o) => o.event.id === 'a');
    const b = out.find((o) => o.event.id === 'b');
    expect(a.colCount).toBe(2);
    expect(b.colCount).toBe(2);
    expect(new Set([a.colIndex, b.colIndex])).toEqual(new Set([0, 1]));
  });

  it('handles three mutually overlapping events', () => {
    const out = layoutColumns([ev('a', 9, 12), ev('b', 9.5, 11), ev('c', 10, 12)]);
    expect(out.every((o) => o.colCount === 3)).toBe(true);
    expect(new Set(out.map((o) => o.colIndex))).toEqual(new Set([0, 1, 2]));
  });

  it('treats touching events (end == start) as separate clusters', () => {
    const out = layoutColumns([ev('a', 9, 10), ev('b', 10, 11)]);
    expect(out.every((o) => o.colCount === 1)).toBe(true);
  });

  it('reuses a freed column when an earlier event has ended', () => {
    // a: 9-10, b: 9-12 (overlap a), c: 10-11 can reuse a's column.
    const out = layoutColumns([ev('a', 9, 10), ev('b', 9, 12), ev('c', 10, 11)]);
    const a = out.find((o) => o.event.id === 'a');
    const c = out.find((o) => o.event.id === 'c');
    // The whole run is one cluster (b bridges them) needing two columns.
    expect(out.every((o) => o.colCount === 2)).toBe(true);
    // c should take the column a vacated.
    expect(c.colIndex).toBe(a.colIndex);
  });

  it('is stable for an empty list', () => {
    expect(layoutColumns([])).toEqual([]);
  });

  it('gives zero-length events a usable column', () => {
    const out = layoutColumns([{ id: 'z', start: at(9), end: at(9) }]);
    expect(out[0].colCount).toBe(1);
  });
});

describe('splitDayEvents', () => {
  const dayStart = at(0);
  const dayEnd = base + 24 * H - 1;

  it('separates all-day from timed events', () => {
    const { allDay, timed } = splitDayEvents(
      [ev('meeting', 9, 10), ev('holiday', 0, 0, { allDay: true })],
      dayStart,
      dayEnd,
    );
    expect(allDay.map((e) => e.id)).toEqual(['holiday']);
    expect(timed.map((e) => e.id)).toEqual(['meeting']);
  });

  it('treats a >=24h event as all-day', () => {
    const long = { id: 'trip', start: at(0), end: at(0) + 26 * H };
    const { allDay } = splitDayEvents([long], dayStart, dayEnd);
    expect(allDay.map((e) => e.id)).toEqual(['trip']);
  });

  it('clips timed events to the day window', () => {
    const spilling = { id: 'late', start: base - 2 * H, end: at(2) };
    const { timed } = splitDayEvents([spilling], dayStart, dayEnd);
    expect(timed[0].start).toBe(dayStart);
    expect(timed[0].end).toBe(at(2));
  });
});

describe('splitDayEvents — DST fall-back day', () => {
  // Only meaningful in a zone with a fall-back transition (25h day).
  const hasFallBack =
    new Date(2026, 9, 15, 12).getTimezoneOffset() !== new Date(2026, 10, 15, 12).getTimezoneOffset();

  it.runIf(hasFallBack)('keeps a same-day timed event on the hour grid despite >=24h of real time', () => {
    // Nov 1, 2026 (US zones) is 25 wall-clock hours; 00:00–23:45 is 24h45m of
    // real time but still a single calendar day — it must render as a timed
    // block, not land in the all-day rail.
    const dayStart = new Date(2026, 10, 1).getTime();
    const dayEnd = new Date(2026, 10, 2).getTime() - 1;
    const ev = { id: 'long-day', start: dayStart, end: new Date(2026, 10, 1, 23, 45).getTime() };
    expect(ev.end - ev.start).toBeGreaterThanOrEqual(24 * 3_600_000); // precondition
    const { allDay, timed } = splitDayEvents([ev], dayStart, dayEnd);
    expect(allDay).toEqual([]);
    expect(timed.map((e) => e.id)).toEqual(['long-day']);
  });
});
