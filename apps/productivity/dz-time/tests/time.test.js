import { describe, it, expect } from 'vitest';
import {
  parseDuration, fmtClock, fmtTimer, fmtDuration, toHours, roundSeconds,
  isoOf, dateOf, addDays, weekStartOf, weekDays, monthKeyOf, monthKeysBetween,
  monthDays, shiftMonth, timePartOf,
} from '../src/lib/time.js';

describe('parseDuration', () => {
  it('parses h:mm and h:mm:ss', () => {
    expect(parseDuration('1:30')).toBe(5400);
    expect(parseDuration('0:05')).toBe(300);
    expect(parseDuration('10:00')).toBe(36000);
    expect(parseDuration('1:30:15')).toBe(5415);
  });

  it('parses unit forms', () => {
    expect(parseDuration('90m')).toBe(5400);
    expect(parseDuration('1h')).toBe(3600);
    expect(parseDuration('1.5h')).toBe(5400);
    expect(parseDuration('1h 30m')).toBe(5400);
    expect(parseDuration('2h15m')).toBe(8100);
    expect(parseDuration('1h30')).toBe(5400);
    expect(parseDuration('45s')).toBe(45);
  });

  it('treats bare decimals as hours', () => {
    expect(parseDuration('1.5')).toBe(5400);
    expect(parseDuration('0.25')).toBe(900);
    expect(parseDuration('8')).toBe(28800);
  });

  it('accepts a leading decimal point', () => {
    expect(parseDuration('.5')).toBe(1800);
    expect(parseDuration('.25')).toBe(900);
    expect(parseDuration('.5h')).toBe(1800);
    expect(parseDuration(',5')).toBe(1800);
  });

  it('treats large bare integers as minutes', () => {
    expect(parseDuration('45')).toBe(2700);
    expect(parseDuration('90')).toBe(5400);
  });

  it('parses ":45" as minutes and accepts decimal commas', () => {
    expect(parseDuration(':45')).toBe(2700);
    expect(parseDuration('1,5')).toBe(5400);
  });

  it('rejects junk', () => {
    expect(parseDuration('')).toBeNaN();
    expect(parseDuration('abc')).toBeNaN();
    expect(parseDuration('1:99')).toBeNaN();
    expect(parseDuration(null)).toBeNaN();
  });
});

describe('formatting', () => {
  it('fmtClock renders h:mm', () => {
    expect(fmtClock(0)).toBe('0:00');
    expect(fmtClock(5400)).toBe('1:30');
    expect(fmtClock(36660)).toBe('10:11');
  });

  it('fmtTimer renders h:mm:ss', () => {
    expect(fmtTimer(0)).toBe('0:00:00');
    expect(fmtTimer(3661)).toBe('1:01:01');
  });

  it('fmtDuration renders human text', () => {
    expect(fmtDuration(0)).toBe('0m');
    expect(fmtDuration(2700)).toBe('45m');
    expect(fmtDuration(3600)).toBe('1h');
    expect(fmtDuration(5400)).toBe('1h 30m');
  });

  it('fmtDuration carries 59.9 minutes into the hour, never "60m"', () => {
    expect(fmtDuration(3599)).toBe('1h');
  });

  it('toHours converts with rounding', () => {
    expect(toHours(5400)).toBe(1.5);
    expect(toHours(1000)).toBe(0.28);
    expect(toHours(1000, 4)).toBe(0.2778);
  });
});

describe('roundSeconds (billing rounding, always up)', () => {
  it('rounds up to the increment', () => {
    expect(roundSeconds(61, 15)).toBe(900);
    expect(roundSeconds(900, 15)).toBe(900);
    expect(roundSeconds(901, 15)).toBe(1800);
    expect(roundSeconds(59, 6)).toBe(360);
  });

  it('passes through with no rounding configured', () => {
    expect(roundSeconds(1234, 0)).toBe(1234);
    expect(roundSeconds(1234)).toBe(1234);
  });

  it('never goes negative', () => {
    expect(roundSeconds(-5, 15)).toBe(0);
  });
});

describe('calendar math', () => {
  it('round-trips ISO dates in local time', () => {
    expect(isoOf(dateOf('2026-08-04'))).toBe('2026-08-04');
    expect(isoOf(dateOf('2026-01-01'))).toBe('2026-01-01');
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('weekStartOf respects Monday and Sunday starts', () => {
    // 2026-08-04 is a Tuesday.
    expect(weekStartOf('2026-08-04', 1)).toBe('2026-08-03');
    expect(weekStartOf('2026-08-04', 0)).toBe('2026-08-02');
    // A Monday is its own Monday-week start.
    expect(weekStartOf('2026-08-03', 1)).toBe('2026-08-03');
    // A Sunday belongs to the previous Monday-week.
    expect(weekStartOf('2026-08-09', 1)).toBe('2026-08-03');
  });

  it('weekDays lists seven consecutive days', () => {
    const days = weekDays('2026-08-03');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-08-03');
    expect(days[6]).toBe('2026-08-09');
  });

  it('monthKeysBetween spans ranges across years', () => {
    expect(monthKeysBetween('2026-08-01', '2026-08-31')).toEqual(['2026-08']);
    expect(monthKeysBetween('2025-11-15', '2026-02-03'))
      .toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('monthKeyOf extracts the month', () => {
    expect(monthKeyOf('2026-08-04')).toBe('2026-08');
  });

  it('monthDays lists every day of a month, leap years included', () => {
    const aug = monthDays('2026-08');
    expect(aug).toHaveLength(31);
    expect(aug[0]).toBe('2026-08-01');
    expect(aug[30]).toBe('2026-08-31');
    expect(monthDays('2024-02')).toHaveLength(29);
    expect(monthDays('2026-02')).toHaveLength(28);
  });

  it('shiftMonth crosses year boundaries both ways', () => {
    expect(shiftMonth('2026-08', 1)).toBe('2026-09');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-08', -14)).toBe('2025-06');
  });
});

describe('timePartOf', () => {
  it('reads a 24-hour time out of a cell', () => {
    expect(timePartOf('09:30')).toBe('09:30');
    expect(timePartOf('2026-08-03 09:30:00')).toBe('09:30');
    expect(timePartOf('21:05')).toBe('21:05');
    expect(timePartOf('')).toBeNull();
    expect(timePartOf('nonsense')).toBeNull();
    expect(timePartOf('24:30')).toBeNull();
  });

  it('reads a 12-hour time, so an afternoon does not land in the morning', () => {
    expect(timePartOf('1:30 PM')).toBe('13:30');
    expect(timePartOf('9:30 am')).toBe('09:30');
    expect(timePartOf('11:59 p.m.')).toBe('23:59');
    expect(timePartOf('2026-08-03 4:05:00 PM')).toBe('16:05');
    // Noon and midnight are the two the shift does not apply to.
    expect(timePartOf('12:15 PM')).toBe('12:15');
    expect(timePartOf('12:15 AM')).toBe('00:15');
    // A suffix that contradicts its hour is ignored, not doubled.
    expect(timePartOf('13:00 PM')).toBe('13:00');
  });
});
