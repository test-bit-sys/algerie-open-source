import { describe, it, expect } from 'vitest';
import {
  toISO, parseISO, addDays, addMonths, addYears, diffDays, weekdayOf,
  monthGrid, relativeDue, isOverdue, isDueToday, monthKeyOf,
} from '../src/lib/dates.js';

describe('date math', () => {
  it('round-trips ISO through local Date without timezone drift', () => {
    expect(toISO(parseISO('2026-08-04'))).toBe('2026-08-04');
    expect(toISO(parseISO('2026-01-01'))).toBe('2026-01-01');
    expect(toISO(parseISO('2026-12-31'))).toBe('2026-12-31');
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29'); // leap year
  });

  it('addMonths clamps to the target month length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-08-15', 1)).toBe('2026-09-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('addYears handles Feb 29', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });

  it('diffDays is signed', () => {
    expect(diffDays('2026-08-04', '2026-08-07')).toBe(3);
    expect(diffDays('2026-08-07', '2026-08-04')).toBe(-3);
    expect(diffDays('2026-08-04', '2026-08-04')).toBe(0);
  });

  it('weekdayOf matches known dates', () => {
    expect(weekdayOf('2026-08-04')).toBe(2); // Tuesday
    expect(weekdayOf('2026-08-09')).toBe(0); // Sunday
  });

  it('monthKeyOf slices the month', () => {
    expect(monthKeyOf('2026-08-04')).toBe('2026-08');
  });
});

describe('monthGrid', () => {
  it('returns 42 cells starting on Monday when asked', () => {
    const grid = monthGrid(2026, 8, true); // Aug 2026 starts on a Saturday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-07-27'); // Monday before Aug 1
    expect(weekdayOf(grid[0])).toBe(1);
    expect(grid).toContain('2026-08-01');
    expect(grid).toContain('2026-08-31');
  });

  it('starts on Sunday when startMonday is false', () => {
    const grid = monthGrid(2026, 8, false);
    expect(weekdayOf(grid[0])).toBe(0);
    expect(grid[0]).toBe('2026-07-26');
  });

  it('covers a month that needs six rows', () => {
    const grid = monthGrid(2026, 5, true); // May 2026: Fri start, 31 days
    expect(grid).toContain('2026-05-01');
    expect(grid).toContain('2026-05-31');
  });
});

describe('relativeDue', () => {
  const today = '2026-08-04';
  it('names the near days', () => {
    expect(relativeDue('2026-08-04', today)).toBe('Today');
    expect(relativeDue('2026-08-05', today)).toBe('Tomorrow');
    expect(relativeDue('2026-08-03', today)).toBe('Yesterday');
  });
  it('uses a weekday inside the coming week', () => {
    const label = relativeDue('2026-08-07', today);
    expect(label.length).toBeLessThanOrEqual(4); // e.g. 'Fri'
  });
  it('mentions how long ago for the recent past', () => {
    expect(relativeDue('2026-08-01', today)).toMatch(/3 days ago/);
  });
});

describe('due checks', () => {
  const today = '2026-08-04';
  it('overdue only when open, dated, and in the past', () => {
    expect(isOverdue({ done: false, due: '2026-08-03' }, today)).toBe(true);
    expect(isOverdue({ done: true, due: '2026-08-03' }, today)).toBe(false);
    expect(isOverdue({ done: false, due: null }, today)).toBe(false);
    expect(isOverdue({ done: false, due: today }, today)).toBe(false);
  });
  it('isDueToday matches only the exact day', () => {
    expect(isDueToday({ due: today }, today)).toBe(true);
    expect(isDueToday({ due: '2026-08-05' }, today)).toBe(false);
  });
});
