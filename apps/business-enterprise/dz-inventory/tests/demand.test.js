import { describe, it, expect } from 'vitest';
import {
  demandRates, coverDays, restockDays, suggestedThreshold, runningOut,
  rateLabel, coverLabel, DEMAND_DAYS, MIN_DEMAND_DAYS, DEFAULT_SAFETY_DAYS,
} from '../src/lib/demand.js';

const DAY = 24 * 3600 * 1000;
const now = new Date(2026, 7, 20, 12).getTime();
const daysAgo = (n) => now - n * DAY;

let seq = 0;
const entry = (over = {}) => ({
  id: `e${++seq}`, at: daysAgo(1), kind: 'remove', productId: 'a',
  name: 'Milk', unit: 'each', delta: -2, ...over,
});
const prod = (over = {}) => ({ id: 'a', name: 'Milk', unit: 'each', quantity: 10, cost: 2, ...over });

describe('demandRates', () => {
  it('divides units out by the span the log actually covers', () => {
    const entries = [
      entry({ at: daysAgo(10), delta: -5 }),
      entry({ at: daysAgo(5), delta: -5 }),
    ];
    // The log reaches back 10 days, not 30: 10 units over 10 days.
    const { rates, days, enough } = demandRates(entries, { now });
    expect(enough).toBe(true);
    expect(days).toBe(10);
    expect(rates.get('a')).toBeCloseTo(1, 5);
  });

  it('uses the window once the log is longer than it', () => {
    const entries = [
      entry({ at: daysAgo(200), delta: -100 }),  // outside the window
      entry({ at: daysAgo(3), delta: -60 }),
    ];
    const { rates, days } = demandRates(entries, { now });
    expect(days).toBe(DEMAND_DAYS);
    expect(rates.get('a')).toBeCloseTo(2, 5);
  });

  it('says nothing at all while the log is too short to mean anything', () => {
    const entries = [entry({ at: daysAgo(MIN_DEMAND_DAYS - 1), delta: -50 })];
    const { rates, enough } = demandRates(entries, { now });
    expect(enough).toBe(false);
    expect(rates.size).toBe(0);
  });

  it('counts demand only — a write-off is not a rate of sale', () => {
    const entries = [
      entry({ at: daysAgo(20), delta: -10, reason: 'sold' }),
      entry({ at: daysAgo(10), delta: -100, reason: 'damaged' }),
      entry({ at: daysAgo(10), delta: -20, productId: 'b', name: 'Rope' }),
    ];
    const { rates } = demandRates(entries, { now });
    expect(rates.get('a')).toBeCloseTo(0.5, 5);
    expect(rates.get('b')).toBeCloseTo(1, 5);
  });

  it('leaves products nothing has left out of the map entirely', () => {
    const entries = [
      entry({ at: daysAgo(20), delta: 30, kind: 'add' }),
      entry({ at: daysAgo(2), delta: -6 }),
    ];
    const { rates } = demandRates(entries, { now });
    expect(rates.get('a')).toBeCloseTo(0.3, 5);
    expect(demandRates([], { now }).rates.size).toBe(0);
  });
});

describe('coverDays', () => {
  it('divides what is on hand by the daily rate', () => {
    expect(coverDays(prod({ quantity: 12 }), 3)).toBe(4);
    expect(coverDays(prod({ quantity: 1 }), 3)).toBe(0.3);
    expect(coverDays(prod({ quantity: 0 }), 3)).toBe(0);
  });

  it('is null, never infinite, when demand is unknown', () => {
    expect(coverDays(prod(), 0)).toBeNull();
    expect(coverDays(prod(), undefined)).toBeNull();
  });
});

describe('restockDays', () => {
  it('adds the safety days to the supplier lead time', () => {
    expect(restockDays(5, 3)).toBe(8);
    // No supplier on file: the safety days stand alone.
    expect(restockDays(null, 3)).toBe(3);
    expect(restockDays(undefined)).toBe(DEFAULT_SAFETY_DAYS);
    expect(restockDays(-4, -2)).toBe(0);
  });
});

describe('suggestedThreshold', () => {
  it('is what sells while a restock is in flight, rounded up', () => {
    // 1.4 a day over 5 + 3 days = 11.2 → 12 whole units.
    expect(suggestedThreshold(prod(), { perDay: 1.4, leadTimeDays: 5, safetyDays: 3 })).toBe(12);
  });

  it('rounds up to a whole pack where the product is bought in packs', () => {
    // 2 a day over 5 days = 10, in cases of 24 → one case.
    expect(suggestedThreshold(prod({ packSize: 24 }), { perDay: 2, leadTimeDays: 2, safetyDays: 3 })).toBe(24);
  });

  it('keeps decimals for measured stock', () => {
    expect(suggestedThreshold(prod({ unit: 'kg' }), { perDay: 0.25, leadTimeDays: 1, safetyDays: 3 })).toBe(1);
    expect(suggestedThreshold(prod({ unit: 'kg' }), { perDay: 0.3, leadTimeDays: 0, safetyDays: 1 })).toBe(0.3);
  });

  it('says nothing without a rate or without any restock time', () => {
    expect(suggestedThreshold(prod(), { perDay: 0, leadTimeDays: 5 })).toBeNull();
    expect(suggestedThreshold(prod(), { perDay: 2, leadTimeDays: 0, safetyDays: 0 })).toBeNull();
  });

  it('never suggests a threshold of zero for something that sells', () => {
    expect(suggestedThreshold(prod(), { perDay: 0.01, leadTimeDays: 0, safetyDays: 1 })).toBe(1);
  });
});

describe('runningOut', () => {
  it('is true when the shelf empties before a restock could land', () => {
    // 3 days of cover, 8 days to restock.
    expect(runningOut(prod({ quantity: 9 }), { perDay: 3, leadTimeDays: 5, safetyDays: 3 })).toBe(true);
    // 30 days of cover, same restock time.
    expect(runningOut(prod({ quantity: 90 }), { perDay: 3, leadTimeDays: 5, safetyDays: 3 })).toBe(false);
  });

  it('is false — not true — when demand is unknown', () => {
    expect(runningOut(prod({ quantity: 0 }), { perDay: 0 })).toBe(false);
  });

  it('falls back to the safety days with no supplier on file', () => {
    expect(runningOut(prod({ quantity: 2 }), { perDay: 1, safetyDays: 3 })).toBe(true);
    expect(runningOut(prod({ quantity: 9 }), { perDay: 1, safetyDays: 3 })).toBe(false);
  });
});

describe('labels', () => {
  it('states a rate at the precision it deserves', () => {
    expect(rateLabel(1.44, 'each')).toBe('≈1.4 units a day');
    expect(rateLabel(1, 'each')).toBe('≈1 unit a day');
    expect(rateLabel(12.7, 'kg')).toBe('≈13 kg a day');
    expect(rateLabel(0, 'each')).toBe('');
  });

  it('states cover in days, and says out of stock rather than 0 days', () => {
    expect(coverLabel(4)).toBe('4 days of cover');
    expect(coverLabel(1)).toBe('1 day of cover');
    expect(coverLabel(0.4)).toBe('under a day of cover');
    expect(coverLabel(0)).toBe('out of stock');
    expect(coverLabel(null)).toBe('');
  });
});
