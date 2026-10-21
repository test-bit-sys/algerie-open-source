import { describe, it, expect } from 'vitest';
import {
  todayISO, monthKey, shiftMonthKey, addDays, addMonthsClamped, daysBetween, dueLabel,
  formatDate, formatMonth, timeAgo, formatMoney, compactMoney, initials,
  fuzzyIncludes, clamp, round2, matchScore, sinceLabel, formatClock, isValidISODate,
} from '../src/lib/util.js';

describe('dates', () => {
  it('todayISO formats a local date as YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayISO(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('monthKey works for strings and Dates', () => {
    expect(monthKey('2026-08-04')).toBe('2026-08');
    expect(monthKey(new Date(2026, 7, 4))).toBe('2026-08');
  });

  it('shiftMonthKey crosses year boundaries in both directions', () => {
    expect(shiftMonthKey('2026-08', 1)).toBe('2026-09');
    expect(shiftMonthKey('2026-11', 3)).toBe('2027-02');
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29'); // leap year
  });

  it('addMonthsClamped clamps to the target month and crosses years', () => {
    expect(addMonthsClamped('2026-08-05', 1)).toBe('2026-09-05');
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonthsClamped('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsClamped('2026-01-15', -2)).toBe('2025-11-15');
  });

  it('daysBetween is signed and whole-day exact', () => {
    expect(daysBetween('2026-08-01', '2026-08-04')).toBe(3);
    expect(daysBetween('2026-08-04', '2026-08-01')).toBe(-3);
    expect(daysBetween('2026-08-04', '2026-08-04')).toBe(0);
  });

  it('dueLabel classifies against a fixed today', () => {
    const today = '2026-08-04';
    expect(dueLabel('2026-08-01', today)).toEqual({ text: '3d overdue', status: 'overdue' });
    expect(dueLabel('2026-08-04', today)).toEqual({ text: 'Today', status: 'today' });
    expect(dueLabel('2026-08-05', today)).toEqual({ text: 'Tomorrow', status: 'soon' });
    expect(dueLabel('2026-08-09', today)).toEqual({ text: 'In 5d', status: 'soon' });
    expect(dueLabel('2026-09-20', today).status).toBe('later');
  });

  it('formatDate hides the current year, shows others', () => {
    const thisYear = new Date().getFullYear();
    expect(formatDate(`${thisYear}-08-12`)).toBe('Aug 12');
    expect(formatDate('2001-08-12')).toBe('Aug 12, 2001');
  });

  it('formatDate shows an unnameable date as stored, not as "undefined"', () => {
    expect(formatDate('2020-45-13')).toBe('2020-45-13');
    expect(formatDate('')).toBe('');
  });

  it('isValidISODate accepts real days and rejects the rest', () => {
    expect(isValidISODate('2026-08-12')).toBe(true);
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
    expect(isValidISODate('2020-45-13')).toBe(false);
    expect(isValidISODate('2026-08-00')).toBe(false);
    expect(isValidISODate('2026-8-12')).toBe(false);
    expect(isValidISODate(null)).toBe(false);
  });

  it('formatMonth renders a month key', () => {
    expect(formatMonth('2026-08')).toBe('Aug 2026');
  });

  it('formatMonth can drop the year inside the current one', () => {
    const thisYear = new Date().getFullYear();
    expect(formatMonth(`${thisYear}-08`, { year: 'auto' })).toBe('Aug');
    expect(formatMonth(`${thisYear - 1}-12`, { year: 'auto' })).toBe(`Dec ${thisYear - 1}`);
  });

  it('timeAgo buckets by age', () => {
    const now = Date.now();
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});

describe('money', () => {
  it('formatMoney renders whole amounts without decimals', () => {
    expect(formatMoney(12500, 'USD')).toBe('$12,500');
    expect(formatMoney(0, 'USD')).toBe('$0');
  });

  it('formatMoney keeps both cent digits when there are cents', () => {
    expect(formatMoney(12500.5, 'USD')).toBe('$12,500.50');
    expect(formatMoney(12500.55, 'USD')).toBe('$12,500.55');
    expect(formatMoney(0.5, 'EUR')).toBe('€0.50');
  });

  it('compactMoney abbreviates large values', () => {
    expect(compactMoney(950, 'USD')).toBe('$950');
    expect(compactMoney(18500, 'USD')).toBe('$18.5K');
    expect(compactMoney(4_200_000, 'USD')).toBe('$4.2M');
    expect(compactMoney(-18500, 'USD')).toBe('-$18.5K');
    // Just under a million rounds up into the M range, never "$1000K".
    expect(compactMoney(999_960, 'USD')).toBe('$1M');
    expect(compactMoney(999_940, 'USD')).toBe('$999.9K');
    // And the same rung again at a billion, which a currency worth a
    // hundredth of a dollar reaches on an ordinary book of business.
    expect(compactMoney(1_234_567_890, 'USD')).toBe('$1.2B');
    expect(compactMoney(999_960_000, 'USD')).toBe('$1B');
    expect(compactMoney(999_940_000, 'USD')).toBe('$999.9M');
    expect(compactMoney(-2_500_000_000, 'USD')).toBe('-$2.5B');
  });

  it('compactMoney keeps small amounts exact', () => {
    expect(compactMoney(9600, 'USD')).toBe('$9,600');
  });
});

describe('matchScore', () => {
  it('ranks a match at the start above a word start above mid-word', () => {
    const start = matchScore('Mei Tanaka', 'mei');
    const word = matchScore('Ada Mei', 'mei');
    const mid = matchScore('Amei Corp', 'mei');
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
  });

  it('prefers the shorter of two matches from the start', () => {
    expect(matchScore('Mei', 'mei')).toBeGreaterThan(matchScore('Meital Rosenberg', 'mei'));
  });

  it('returns -1 when there is no match, 0 for an empty query', () => {
    expect(matchScore('Acme', 'zzz')).toBe(-1);
    expect(matchScore('Acme', '')).toBe(0);
    expect(matchScore(null, 'a')).toBe(-1);
  });

  it('ignores case and accents like the rest of search', () => {
    expect(matchScore('Zoë Étienne', 'zoe')).toBeGreaterThan(0);
    expect(matchScore('Zoë Étienne', 'etienne')).toBeGreaterThan(0);
  });
});

describe('sinceLabel', () => {
  it('speaks in the units people use for last contact', () => {
    expect(sinceLabel('2026-08-20', '2026-08-20').text).toBe('today');
    expect(sinceLabel('2026-08-19', '2026-08-20').text).toBe('yesterday');
    expect(sinceLabel('2026-08-15', '2026-08-20').text).toBe('5d ago');
    expect(sinceLabel('2026-08-01', '2026-08-20').text).toBe('3w ago');
    expect(sinceLabel('2026-05-20', '2026-08-20').text).toBe('3mo ago');
  });

  it('treats a future date as today rather than negative time', () => {
    expect(sinceLabel('2026-09-01', '2026-08-20')).toEqual({ text: 'today', days: 0 });
  });
});

describe('formatClock', () => {
  it('renders 24h input as a 12h label', () => {
    expect(formatClock('14:30')).toBe('2:30pm');
    expect(formatClock('09:00')).toBe('9am');
    expect(formatClock('00:05')).toBe('12:05am');
    expect(formatClock('12:00')).toBe('12pm');
    expect(formatClock('')).toBe('');
  });
});

describe('text helpers', () => {
  it('initials takes first and last name', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Mei Anne Tanaka')).toBe('MT');
    expect(initials('Plato')).toBe('P');
    expect(initials('')).toBe('?');
  });

  it('fuzzyIncludes ignores case and accents', () => {
    expect(fuzzyIncludes('Renée Fläche', 'renee')).toBe(true);
    expect(fuzzyIncludes('Atlas Freight', 'FREIGHT')).toBe(true);
    expect(fuzzyIncludes('Atlas', 'xyz')).toBe(false);
    expect(fuzzyIncludes(null, 'a')).toBe(false);
  });

  it('clamp and round2 behave', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(round2(1.005)).toBeCloseTo(1, 1);
    expect(round2(10.126)).toBe(10.13);
  });
});
