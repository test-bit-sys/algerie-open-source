import { describe, it, expect } from 'vitest';
import { nextDue, normalizeRule, describeRule, reanchorRule } from '../src/lib/recur.js';
import { diffDays } from '../src/lib/dates.js';

const TODAY = '2026-08-04'; // a Tuesday

describe('normalizeRule', () => {
  it('rejects empty and unknown input', () => {
    expect(normalizeRule(null)).toBeNull();
    expect(normalizeRule({})).toBeNull();
  });

  it('coerces interval to a positive integer', () => {
    expect(normalizeRule({ freq: 'daily', interval: 0 }).interval).toBe(1);
    expect(normalizeRule({ freq: 'daily', interval: -3 }).interval).toBe(1);
    expect(normalizeRule({ freq: 'daily', interval: 2.7 }).interval).toBe(2);
    expect(normalizeRule({ freq: 'daily' }).interval).toBe(1);
  });

  it('keeps weekdays only for weekly rules, sorted and deduped', () => {
    const r = normalizeRule({ freq: 'weekly', interval: 1, weekdays: [5, 1, 5, 9] });
    expect(r.weekdays).toEqual([1, 5]);
    const d = normalizeRule({ freq: 'daily', interval: 1, weekdays: [1] });
    expect(d.weekdays).toBeUndefined();
  });

  it('drops non-integer weekdays (they match no day and break BYDAY)', () => {
    const r = normalizeRule({ freq: 'weekly', interval: 1, weekdays: [1.5, '2.7', 3] });
    expect(r.weekdays).toEqual([3]);
    const none = normalizeRule({ freq: 'weekly', interval: 1, weekdays: [1.5] });
    expect(none.weekdays).toBeUndefined();
  });
});

describe('nextDue — daily / monthly / yearly', () => {
  it('daily rolls forward by the interval', () => {
    expect(nextDue({ freq: 'daily', interval: 1 }, TODAY, TODAY)).toBe('2026-08-05');
    expect(nextDue({ freq: 'daily', interval: 3 }, TODAY, TODAY)).toBe('2026-08-07');
  });

  it('an overdue daily task lands today or later, never in the past', () => {
    const next = nextDue({ freq: 'daily', interval: 1 }, '2026-07-20', TODAY);
    expect(next >= TODAY).toBe(true);
  });

  it('a years-overdue task still lands today or later, on the rule grid', () => {
    // Daily: > 1000 missed steps used to exhaust the catch-up guard.
    expect(nextDue({ freq: 'daily', interval: 1 }, '2020-01-01', TODAY)).toBe(TODAY);
    // Interval grid preserved: every 3 days from 2020-01-01.
    const every3 = nextDue({ freq: 'daily', interval: 3 }, '2020-01-01', TODAY);
    expect(every3 >= TODAY).toBe(true);
    expect(diffDays('2020-01-01', every3) % 3).toBe(0);
    // Weekly with weekdays keeps the weekday across the jump.
    const mon = nextDue({ freq: 'weekly', interval: 1, weekdays: [1] }, '2001-01-01', TODAY);
    expect(mon).toBe('2026-08-10');
    // Every-2-weeks keeps the fortnight phase (2020-01-06 was a Monday).
    const fortnight = nextDue({ freq: 'weekly', interval: 2, weekdays: [1] }, '2020-01-06', TODAY);
    expect(fortnight >= TODAY).toBe(true);
    expect(diffDays('2020-01-06', fortnight) % 14).toBe(0);
    // Monthly and yearly catch up too.
    expect(nextDue({ freq: 'monthly', interval: 1 }, '2020-01-15', TODAY)).toBe('2026-08-15');
    expect(nextDue({ freq: 'yearly', interval: 1 }, '2020-03-01', TODAY)).toBe('2027-03-01');
  });

  it('monthly keeps the day-of-month, clamped to short months', () => {
    expect(nextDue({ freq: 'monthly', interval: 1 }, '2026-08-15', TODAY)).toBe('2026-09-15');
    expect(nextDue({ freq: 'monthly', interval: 1 }, '2026-08-31', TODAY)).toBe('2026-09-30');
  });

  it('an anchored monthly rule returns to its day after a clamped month', () => {
    const rule = { freq: 'monthly', interval: 1, day: 31 };
    // Rolling from the clamped February occurrence recovers the 31st…
    expect(nextDue(rule, '2027-02-28', '2027-02-28')).toBe('2027-03-31');
    // …instead of drifting to the 28th forever (the un-anchored behavior).
    expect(nextDue({ freq: 'monthly', interval: 1 }, '2027-02-28', '2027-02-28')).toBe('2027-03-28');
  });

  it('an anchored yearly rule lands on Feb 29 again in leap years', () => {
    const rule = { freq: 'yearly', interval: 1, day: 29 };
    expect(nextDue(rule, '2027-02-28', '2027-02-28')).toBe('2028-02-29');
  });

  it('yearly advances a year', () => {
    expect(nextDue({ freq: 'yearly', interval: 1 }, '2026-08-10', TODAY)).toBe('2027-08-10');
  });

  it('reanchorRule follows a deliberate due change, and only for month-anchored rules', () => {
    expect(reanchorRule({ freq: 'monthly', interval: 1, mode: 'due', day: 31 }, '2026-09-20'))
      .toEqual({ freq: 'monthly', interval: 1, mode: 'due', day: 20 });
    const weekly = { freq: 'weekly', interval: 1, mode: 'due', weekdays: [1] };
    expect(reanchorRule(weekly, '2026-09-20')).toBe(weekly);
  });

  it('mode done rolls from today, not the due date', () => {
    expect(nextDue({ freq: 'daily', interval: 2, mode: 'done' }, '2026-07-01', TODAY)).toBe('2026-08-06');
    expect(nextDue({ freq: 'monthly', interval: 1, mode: 'done' }, '2026-07-01', TODAY)).toBe('2026-09-04');
  });
});

describe('nextDue — weekly', () => {
  it('plain weekly is due date + 7 * interval', () => {
    expect(nextDue({ freq: 'weekly', interval: 1 }, TODAY, TODAY)).toBe('2026-08-11');
    expect(nextDue({ freq: 'weekly', interval: 2 }, TODAY, TODAY)).toBe('2026-08-18');
  });

  it('with weekdays, picks the next selected day', () => {
    // Tue → next of Mon/Fri is Friday the 7th.
    const rule = { freq: 'weekly', interval: 1, weekdays: [1, 5] };
    expect(nextDue(rule, TODAY, TODAY)).toBe('2026-08-07');
    // Fri → wraps to Monday the 10th.
    expect(nextDue(rule, '2026-08-07', TODAY)).toBe('2026-08-10');
  });

  it('every-2-weeks with weekdays skips the off week', () => {
    const rule = { freq: 'weekly', interval: 2, weekdays: [2] }; // Tuesdays
    // From Tue Aug 4: next eligible Tuesday two weeks out.
    expect(nextDue(rule, TODAY, TODAY)).toBe('2026-08-18');
  });

  it('finishing within the same week still honors selected days', () => {
    const rule = { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }; // Mon Wed Fri
    // Due Mon Aug 3, completed late on Tue the 4th: next is Wed the 5th.
    expect(nextDue(rule, '2026-08-03', TODAY)).toBe('2026-08-05');
  });

  it('a long-overdue weekly task skips all missed occurrences', () => {
    const rule = { freq: 'weekly', interval: 1, weekdays: [1] }; // Mondays
    const next = nextDue(rule, '2026-06-01', TODAY);
    expect(next).toBe('2026-08-10'); // the first Monday after today
  });
});

describe('describeRule', () => {
  it('reads naturally', () => {
    expect(describeRule({ freq: 'daily', interval: 1 })).toBe('Every day');
    expect(describeRule({ freq: 'daily', interval: 2 })).toBe('Every 2 days');
    expect(describeRule({ freq: 'weekly', interval: 1, weekdays: [1, 5] }))
      .toBe('Every week on Mon, Fri');
    expect(describeRule({ freq: 'monthly', interval: 3 })).toBe('Every 3 months');
    expect(describeRule({ freq: 'daily', interval: 1, mode: 'done' }))
      .toBe('Every day after completion');
    expect(describeRule(null)).toBe('');
  });
});
