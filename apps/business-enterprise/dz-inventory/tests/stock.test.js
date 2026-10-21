import { describe, it, expect } from 'vitest';
import {
  UNASSIGNED, NO_LOCATION, bucketKey, stockMap, stockEntries, totalStock,
  stockAt, locationCount, defaultLocationId, isAtLocation, withStockAt, migrateProduct,
} from '../src/lib/stock.js';

const p = (over = {}) => ({ id: 'p1', name: 'Mouse', unit: 'each', quantity: 0, locationId: null, stock: {}, ...over });

describe('stockMap', () => {
  it('drops zeros, negatives, and junk', () => {
    expect(stockMap(p({ stock: { a: 5, b: 0, c: -2, d: 'x' } }))).toEqual({ a: 5 });
  });

  it('treats a missing or wrong-shaped map as empty', () => {
    expect(stockMap(p({ stock: undefined }))).toEqual({});
    expect(stockMap(p({ stock: [1, 2] }))).toEqual({});
    expect(stockMap(null)).toEqual({});
  });
});

describe('totals and lookups', () => {
  const split = p({ stock: { a: 3, b: 10, [UNASSIGNED]: 2 } });

  it('totals every bucket, biggest first', () => {
    expect(totalStock(split)).toBe(15);
    expect(stockEntries(split).map(([id]) => id)).toEqual(['b', 'a', UNASSIGNED]);
    expect(locationCount(split)).toBe(3);
  });

  it('reads one bucket, unassigned included', () => {
    expect(stockAt(split, 'b')).toBe(10);
    expect(stockAt(split, UNASSIGNED)).toBe(2);
    expect(stockAt(split, 'nope')).toBe(0);
    expect(stockAt(split, undefined)).toBe(2);
  });

  it('avoids float drift when summing measured stock', () => {
    expect(totalStock(p({ unit: 'kg', stock: { a: 0.1, b: 0.2 } }))).toBe(0.3);
  });
});

describe('defaultLocationId', () => {
  it('prefers the product’s own location', () => {
    expect(defaultLocationId(p({ locationId: 'a', stock: { b: 5 } }))).toBe('a');
  });

  it('falls back to the only place stock sits, else unassigned', () => {
    expect(defaultLocationId(p({ stock: { b: 5 } }))).toBe('b');
    expect(defaultLocationId(p({ stock: { b: 5, c: 1 } }))).toBe(UNASSIGNED);
    expect(defaultLocationId(p())).toBe(UNASSIGNED);
  });
});

describe('isAtLocation', () => {
  it('matches anywhere the product holds stock', () => {
    const split = p({ locationId: 'a', stock: { a: 1, b: 2 } });
    expect(isAtLocation(split, 'a')).toBe(true);
    expect(isAtLocation(split, 'b')).toBe(true);
    expect(isAtLocation(split, 'c')).toBe(false);
  });

  it('keeps an empty product visible at its own location', () => {
    const empty = p({ locationId: 'a' });
    expect(isAtLocation(empty, 'a')).toBe(true);
    expect(isAtLocation(empty, 'b')).toBe(false);
    expect(isAtLocation(p(), UNASSIGNED)).toBe(true);
  });
});

describe('withStockAt', () => {
  it('sets, rounds for the unit, and removes at zero', () => {
    const base = p({ stock: { a: 5 } });
    expect(withStockAt(base, 'b', 2.6)).toEqual({ a: 5, b: 3 });
    expect(withStockAt(p({ unit: 'kg', stock: { a: 5 } }), 'b', 2.6)).toEqual({ a: 5, b: 2.6 });
    expect(withStockAt(base, 'a', 0)).toEqual({});
    expect(withStockAt(base, 'a', -4)).toEqual({});
    // the original is untouched
    expect(base.stock).toEqual({ a: 5 });
  });
});

describe('migrateProduct', () => {
  it('moves a v1 quantity into its location bucket', () => {
    expect(migrateProduct({ quantity: 7, locationId: 'a' })).toMatchObject({ stock: { a: 7 }, quantity: 7 });
    expect(migrateProduct({ quantity: 3, locationId: null })).toMatchObject({ stock: { '': 3 } });
    expect(migrateProduct({ quantity: 0, locationId: 'a' })).toMatchObject({ stock: {}, quantity: 0 });
  });

  it('is idempotent, and re-derives the cached total', () => {
    const once = migrateProduct({ quantity: 7, locationId: 'a' });
    expect(migrateProduct(once)).toEqual(once);
    expect(migrateProduct({ stock: { a: 2, b: 3 }, quantity: 99 }).quantity).toBe(5);
  });

  it('does not mutate its input', () => {
    const v1 = { quantity: 7, locationId: 'a' };
    migrateProduct(v1);
    expect(v1.stock).toBeUndefined();
  });
});

describe('bucketKey', () => {
  it('turns the filter sentinel back into the real bucket', () => {
    expect(bucketKey(NO_LOCATION)).toBe(UNASSIGNED);
    expect(bucketKey('abc')).toBe('abc');
  });
});
