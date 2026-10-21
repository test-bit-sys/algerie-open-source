import { describe, it, expect } from 'vitest';
import { parseAmount, round2, sum, uid } from '../src/lib/util.js';

describe('parseAmount', () => {
  it('parses plain numbers', () => {
    expect(parseAmount('100')).toBe(100);
    expect(parseAmount('99.5')).toBe(99.5);
  });

  it('handles decimal commas and thousands separators', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('1,234')).toBe(1234);
  });

  it('rejects junk', () => {
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
    for (const value of ['100oops', '12.5.0', '1,2,3', '1e', 'Infinity', '1e309']) {
      expect(parseAmount(value), value).toBeNaN();
    }
  });

  it('keeps supported signed, fractional, grouped, and exponent amounts', () => {
    expect(parseAmount('-12,50')).toBe(-12.5);
    expect(parseAmount('+12.50')).toBe(12.5);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('1 234,56')).toBe(1234.56);
    expect(parseAmount("1'234.56")).toBe(1234.56);
    expect(parseAmount('1,234,567.89')).toBe(1234567.89);
    expect(parseAmount('1e2')).toBe(100);
  });
});

describe('round2', () => {
  it('rounds to cents without drift', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10.994)).toBe(10.99);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('sum', () => {
  it('sums with an accessor', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([{ v: 2 }, { v: 5 }], (x) => x.v)).toBe(7);
    expect(sum([])).toBe(0);
  });
});

describe('uid', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, uid));
    expect(ids.size).toBe(100);
  });
});
