import { describe, it, expect } from 'vitest';
import {
  WEEKDAYS, weekdayIndex, weekStart, monthCells, weekCells,
  shiftPeriod, periodAnchor, byDay, cellRange, inRange,
} from '../src/lib/calendar-grid.js';

describe('the week', () => {
  it('starts on Monday', () => {
    expect(WEEKDAYS[0]).toBe('Mon');
    expect(WEEKDAYS[6]).toBe('Sun');
    // 2026-08-20 is a Thursday.
    expect(weekdayIndex('2026-08-20')).toBe(3);
    expect(weekdayIndex('2026-08-17')).toBe(0);
    expect(weekdayIndex('2026-08-23')).toBe(6);
    expect(weekStart('2026-08-20')).toBe('2026-08-17');
    expect(weekStart('2026-08-23')).toBe('2026-08-17');
  });
});

describe('monthCells', () => {
  const cells = monthCells('2026-08', '2026-08-20');

  it('covers whole weeks, so the grid is rectangular', () => {
    expect(cells.length % 7).toBe(0);
    expect(cells[0].iso).toBe('2026-07-27');            // the Monday before
    // Aug 31, 2026 is a Monday, so the month's last week runs into September.
    expect(cells[cells.length - 1].iso).toBe('2026-09-06');
    expect(cells).toHaveLength(42);
    expect(cells[0].weekday).toBe(0);
    expect(cells[cells.length - 1].weekday).toBe(6);
  });

  it('marks the days that belong to the month, and the ones that don’t', () => {
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells.find((c) => c.iso === '2026-07-31').inMonth).toBe(false);
  });

  it('marks today, the past, and the weekend', () => {
    const today = cells.find((c) => c.iso === '2026-08-20');
    expect(today).toMatchObject({ today: true, past: false, weekend: false, day: 20 });
    expect(cells.find((c) => c.iso === '2026-08-19')).toMatchObject({ past: true, today: false });
    expect(cells.find((c) => c.iso === '2026-08-22').weekend).toBe(true);
  });

  it('handles a month that starts on a Monday without an empty leading week', () => {
    // June 2026 starts on a Monday.
    const june = monthCells('2026-06', '2026-06-15');
    expect(june[0].iso).toBe('2026-06-01');
  });

  it('handles February, leap year and not', () => {
    expect(monthCells('2026-02', '2026-02-10').filter((c) => c.inMonth)).toHaveLength(28);
    expect(monthCells('2028-02', '2028-02-10').filter((c) => c.inMonth)).toHaveLength(29);
  });
});

describe('weekCells', () => {
  it('is Monday to Sunday around the given day', () => {
    const cells = weekCells('2026-08-20', '2026-08-20');
    expect(cells).toHaveLength(7);
    expect(cells[0].iso).toBe('2026-08-17');
    expect(cells[6].iso).toBe('2026-08-23');
    expect(cells.filter((c) => c.today)).toHaveLength(1);
  });
});

describe('moving between periods', () => {
  it('steps a month or a week at a time', () => {
    expect(shiftPeriod('month', '2026-08', 1)).toBe('2026-09');
    expect(shiftPeriod('month', '2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('week', '2026-08-17', 1)).toBe('2026-08-24');
    expect(shiftPeriod('week', '2026-08-17', -1)).toBe('2026-08-10');
  });

  it('knows where "today" is for each mode', () => {
    expect(periodAnchor('month', '2026-08-20')).toBe('2026-08');
    expect(periodAnchor('week', '2026-08-20')).toBe('2026-08-17');
  });
});

describe('placing items on the grid', () => {
  const items = [
    { id: 'a', date: '2026-08-20' },
    { id: 'b', date: '2026-08-20' },
    { id: 'c', date: '2026-09-30' },
    { id: 'd', date: '' },
  ];

  it('groups by day, keeping the order given', () => {
    const days = byDay(items);
    expect(days['2026-08-20'].map((i) => i.id)).toEqual(['a', 'b']);
    expect(days['2026-09-30']).toHaveLength(1);
    // An item with no day belongs to no day.
    expect(Object.values(days).flat()).toHaveLength(3);
  });

  it('reports the span a grid covers', () => {
    const cells = weekCells('2026-08-20', '2026-08-20');
    expect(cellRange(cells)).toEqual({ from: '2026-08-17', to: '2026-08-23' });
    expect(cellRange([])).toEqual({ from: null, to: null });
  });

  it('keeps only what the grid can draw', () => {
    const range = cellRange(weekCells('2026-08-20', '2026-08-20'));
    expect(inRange(items, range).map((i) => i.id)).toEqual(['a', 'b']);
    expect(inRange(items, { from: null, to: null })).toEqual([]);
  });
});
