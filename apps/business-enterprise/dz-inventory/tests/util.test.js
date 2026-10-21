import { describe, it, expect } from 'vitest';
import { uid, round2, parseQty, parseMoney, timeAgo } from '../src/lib/util.js';

describe('uid', () => {
  it('generates unique, url-safe ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, uid));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

describe('round2', () => {
  it('rounds to cents and absorbs float drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10.005)).toBe(10.01);
  });

  it('rounds half away from zero at any magnitude', () => {
    // 8.165 arrives as 816.4999999999999 hundredths; a flat epsilon is
    // too small to fix that above 2, so this used to come back 8.16.
    expect(round2(8.165)).toBe(8.17);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(1234.565)).toBe(1234.57);
    // Symmetric: the same magnitude rounds the same way either side.
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(-8.165)).toBe(-8.17);
  });

  it('leaves values that should round down alone', () => {
    expect(round2(8.164)).toBe(8.16);
    expect(round2(0.014)).toBe(0.01);
    expect(round2(19.99)).toBe(19.99);
  });

  it('never returns negative zero', () => {
    expect(Object.is(round2(-0.001), 0)).toBe(true);
    expect(Object.is(round2(0), 0)).toBe(true);
  });
});

describe('parseQty', () => {
  it('accepts plain and thousands-separated integers', () => {
    expect(parseQty('42')).toBe(42);
    expect(parseQty('1,200')).toBe(1200);
    expect(parseQty('1,234,567')).toBe(1234567);
    expect(parseQty('1,23,456')).toBe(123456);
    expect(parseQty('1 200')).toBe(1200);
    expect(parseQty(' 7 ')).toBe(7);
    expect(parseQty(15)).toBe(15);
  });

  it('rejects negatives, decimals, and junk', () => {
    expect(parseQty('-3')).toBeNaN();
    expect(parseQty('2.5')).toBeNaN();
    expect(parseQty('.5')).toBeNaN();
    expect(parseQty('many')).toBeNaN();
    expect(parseQty('')).toBeNaN();
    expect(parseQty(null)).toBeNaN();
  });

  /* How spreadsheets and stock systems format a whole number. Refusing
     these imported no quantity at all from an otherwise perfect file. */
  it('reads a decimal part that comes to nothing as the whole number', () => {
    expect(parseQty('5.0')).toBe(5);
    expect(parseQty('5.00')).toBe(5);
    expect(parseQty('1,200.00')).toBe(1200);
    expect(parseQty('12,00')).toBe(12);
    expect(parseQty('0.000')).toBe(0);
  });

  it('takes decimals only when asked, rounded to three places', () => {
    expect(parseQty('2.5', { decimals: true })).toBe(2.5);
    expect(parseQty('2.5678', { decimals: true })).toBe(2.568);
    expect(parseQty('1,234.56', { decimals: true })).toBe(1234.56);
  });

  /* The same rule as parseMoney: a "4,25" cell is four and a quarter,
     not four hundred and twenty-five — reading it the other way imports
     every European quantity a hundredfold. */
  it('reads a comma as the decimal point when it can only be one', () => {
    expect(parseQty('4,25', { decimals: true })).toBe(4.25);
    expect(parseQty('1.234,56', { decimals: true })).toBe(1234.56);
    expect(parseQty('1 234,5', { decimals: true })).toBe(1234.5);
    expect(parseQty('1,2345', { decimals: true })).toBe(1.235);
  });

  it('still reads a bare 3-digit comma group as thousands', () => {
    expect(parseQty('1,234', { decimals: true })).toBe(1234);
  });

  it('refuses a decimal comma for a plain count instead of misreading it', () => {
    expect(parseQty('4,25')).toBeNaN();
  });
});

describe('parseMoney', () => {
  it('parses currency symbols, codes, and separators', () => {
    expect(parseMoney('$11.50')).toBe(11.5);
    expect(parseMoney('USD 1,234.56')).toBe(1234.56);
    expect(parseMoney('1.234,56')).toBe(1234.56);
    expect(parseMoney('7')).toBe(7);
    expect(parseMoney(3.5)).toBe(3.5);
  });

  it('reads a bare 3-digit comma group as thousands, like parseQty does', () => {
    expect(parseMoney('1,234')).toBe(1234);
    expect(parseMoney('$1,234')).toBe(1234);
    expect(parseMoney('12,500')).toBe(12500);
    expect(parseMoney('1,234,567')).toBe(1234567);
    expect(parseMoney('(1,000)')).toBe(-1000);
  });

  it('still reads a comma as the decimal point when it can only be one', () => {
    expect(parseMoney('4,20')).toBe(4.2);
    expect(parseMoney('€ 1.234.567,89')).toBe(1234567.89);
    expect(parseMoney('1,2345')).toBe(1.23);
  });

  it('handles negatives in minus and parentheses form', () => {
    expect(parseMoney('-4.20')).toBe(-4.2);
    expect(parseMoney('(4.20)')).toBe(-4.2);
  });

  it('keeps the sign when a currency symbol or code precedes it', () => {
    expect(parseMoney('$ -4.20')).toBe(-4.2);
    expect(parseMoney('EUR -7')).toBe(-7);
    expect(parseMoney('4.20-')).toBe(-4.2);
    expect(parseMoney('($1,000.50)')).toBe(-1000.5);
  });

  it('returns NaN for non-numbers', () => {
    expect(parseMoney('free')).toBeNaN();
    expect(parseMoney('')).toBeNaN();
    expect(parseMoney(null)).toBeNaN();
  });
});

describe('timeAgo', () => {
  const now = 1_700_000_000_000;

  it('formats seconds, minutes, hours, and days', () => {
    expect(timeAgo(now - 30 * 1000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60 * 1000, now)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3600 * 1000, now)).toBe('3h ago');
    expect(timeAgo(now - 2 * 86400 * 1000, now)).toBe('2d ago');
  });

  it('never reports the future as ago', () => {
    expect(timeAgo(now + 60_000, now)).toBe('just now');
  });
});
