import { describe, it, expect } from 'vitest';
import {
  minMap, minAt, minEntries, withMinAt, shortfallAt, hasMinimums, belowMinimumAnywhere,
  binMap, binAt, binEntries, withBinAt, hasBins, compareBins,
} from '../src/lib/stock.js';
import {
  sourcesFor, replenishRows, replenishTotals, belowMinimumCount,
  locationsWithMinimums, rowMoves,
} from '../src/lib/replenish.js';

const p = (over = {}) => ({
  id: 'p1', name: 'Mouse', unit: 'each', cost: 2, archived: false,
  stock: { shelf: 2, back: 40 }, quantity: 42, min: { shelf: 10 }, ...over,
});

describe('the minimums map', () => {
  it('keeps positive numbers only', () => {
    expect(minMap(p({ min: { a: 5, b: 0, c: -2, d: 'x' } }))).toEqual({ a: 5 });
    expect(minMap(p({ min: null }))).toEqual({});
    expect(minMap({})).toEqual({});
    expect(minMap(p({ min: [1, 2] }))).toEqual({});
  });

  it('reads one place, and lists them biggest first', () => {
    expect(minAt(p(), 'shelf')).toBe(10);
    expect(minAt(p(), 'back')).toBe(0);
    expect(minEntries(p({ min: { a: 2, b: 9 } }))).toEqual([['b', 9], ['a', 2]]);
  });

  it('writes a place, and absence removes it', () => {
    expect(withMinAt(p(), 'back', 4)).toEqual({ shelf: 10, back: 4 });
    expect(withMinAt(p(), 'shelf', 0)).toEqual({});
    // Rounded the way the product's unit allows.
    expect(withMinAt(p(), 'back', 2.6)).toEqual({ shelf: 10, back: 3 });
    expect(withMinAt(p({ unit: 'kg' }), 'back', 2.55)).toEqual({ shelf: 10, back: 2.55 });
  });

  it('measures the shortfall at a place, not the total', () => {
    // 42 on hand across the account, and the shelf is still 8 short.
    expect(shortfallAt(p(), 'shelf')).toBe(8);
    expect(shortfallAt(p({ stock: { shelf: 10, back: 40 }, quantity: 50 }), 'shelf')).toBe(0);
    expect(shortfallAt(p({ stock: { shelf: 20 } }), 'shelf')).toBe(0);
    // No minimum stated means nothing to be short of.
    expect(shortfallAt(p(), 'back')).toBe(0);
  });

  it('answers whether a product has minimums at all', () => {
    expect(hasMinimums(p())).toBe(true);
    expect(hasMinimums(p({ min: {} }))).toBe(false);
    expect(belowMinimumAnywhere(p())).toBe(true);
    expect(belowMinimumAnywhere(p({ stock: { shelf: 10 }, quantity: 10 }))).toBe(false);
  });
});

describe('sourcesFor', () => {
  it('offers every other bucket, biggest first', () => {
    const product = p({ stock: { shelf: 2, back: 40, van: 5 }, quantity: 47 });
    expect(sourcesFor(product, 'shelf')).toEqual([
      { locationId: 'back', qty: 40 },
      { locationId: 'van', qty: 5 },
    ]);
  });

  it('never robs a shelf that has its own minimum to keep', () => {
    const product = p({ stock: { shelf: 2, back: 12 }, quantity: 14, min: { shelf: 10, back: 10 } });
    // Back holds 12 with a minimum of 10, so only 2 are spare.
    expect(sourcesFor(product, 'shelf')).toEqual([{ locationId: 'back', qty: 2 }]);
    // And a source already below its own minimum gives nothing.
    const tight = p({ stock: { shelf: 2, back: 6 }, quantity: 8, min: { shelf: 10, back: 10 } });
    expect(sourcesFor(tight, 'shelf')).toEqual([]);
  });
});

describe('replenishRows', () => {
  it('plans the moves that fix a shortfall, largest source first', () => {
    const rows = replenishRows([p({ stock: { shelf: 2, back: 5, van: 20 }, quantity: 27 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ need: 8, movable: 8, buy: 0 });
    expect(rows[0].moves).toEqual([{ from: 'van', qty: 8 }]);
    expect(rowMoves(rows[0])).toEqual([{ productId: 'p1', from: 'van', to: 'shelf', qty: 8 }]);
  });

  it('draws from several places when one is not enough', () => {
    const rows = replenishRows([p({ stock: { shelf: 0, back: 6, van: 3 }, quantity: 9 })]);
    expect(rows[0].moves).toEqual([{ from: 'back', qty: 6 }, { from: 'van', qty: 3 }]);
    expect(rows[0]).toMatchObject({ need: 10, movable: 9, buy: 1 });
  });

  it('says a shortfall with nothing to move is a purchase', () => {
    const rows = replenishRows([p({ stock: { shelf: 1 }, quantity: 1 })]);
    expect(rows[0]).toMatchObject({ need: 9, movable: 0, buy: 9 });
    expect(rows[0].moves).toEqual([]);
  });

  it('leaves out places that hold what they should, and archived products', () => {
    expect(replenishRows([p({ stock: { shelf: 10 }, quantity: 10 })])).toEqual([]);
    expect(replenishRows([p({ archived: true })])).toEqual([]);
    expect(replenishRows([p({ min: {} })])).toEqual([]);
  });

  it('narrows to one place when asked', () => {
    const product = p({ stock: { shelf: 1, back: 1 }, quantity: 2, min: { shelf: 10, back: 10 } });
    expect(replenishRows([product])).toHaveLength(2);
    expect(replenishRows([product], { locationId: 'back' })).toHaveLength(1);
    expect(replenishRows([product], { locationId: 'back' })[0].locationId).toBe('back');
  });

  it('puts the emptiest shelf first, not the biggest number', () => {
    const rows = replenishRows([
      p({ id: 'screws', name: 'Screws', stock: { shelf: 400, back: 100 }, quantity: 500, min: { shelf: 450 } }),
      p({ id: 'monitor', name: 'Monitor', stock: { shelf: 0, back: 3 }, quantity: 3, min: { shelf: 4 } }),
    ]);
    expect(rows.map((r) => r.product.id)).toEqual(['monitor', 'screws']);
  });

  it('totals the shortfall, the movable part, and what has to be bought', () => {
    const rows = replenishRows([
      p({ id: 'a', stock: { shelf: 2, back: 20 }, quantity: 22, min: { shelf: 10 } }),
      p({ id: 'b', stock: { shelf: 0 }, quantity: 0, min: { shelf: 5 } }),
      p({ id: 'c', unit: 'kg', stock: { shelf: 0.5 }, quantity: 0.5, min: { shelf: 2 } }),
    ]);
    expect(replenishTotals(rows)).toMatchObject({
      rows: 3, products: 3, units: 13, measured: 1, movable: 8, buy: 5, buyRows: 2,
    });
  });
});

describe('per-location summaries', () => {
  it('allocates a shared surplus once across every destination', () => {
    const product = p({ stock: { back: 10 }, quantity: 10, min: { back: 5, left: 4, right: 4 } });
    const rows = replenishRows([product]);
    expect(replenishTotals(rows)).toMatchObject({ movable: 5, buy: 3 });
    expect(rows.map((r) => r.movable)).toEqual([4, 1]);
    expect(rows.flatMap((r) => r.moves).reduce((sum, move) => sum + move.qty, 0)).toBe(5);
    expect(product.stock).toEqual({ back: 10 });
    // A plan for just one destination can use the whole available surplus.
    expect(replenishRows([product], { locationId: 'right' })[0]).toMatchObject({ movable: 4, buy: 0 });
  });

  const products = [
    p({ id: 'a', stock: { shelf: 2 }, quantity: 2, min: { shelf: 10 } }),
    p({ id: 'b', stock: { shelf: 20 }, quantity: 20, min: { shelf: 10, van: 4 } }),
  ];

  it('counts what a place is short of', () => {
    expect(belowMinimumCount(products, 'shelf')).toBe(1);
    expect(belowMinimumCount(products, 'van')).toBe(1);
    expect(belowMinimumCount(products, 'back')).toBe(0);
  });

  it('lists every place anything states a minimum for', () => {
    expect([...locationsWithMinimums(products)].sort()).toEqual(['shelf', 'van']);
  });

  /**
   * A sell-as-kit holds no stock in any place, on purpose. Its
   * shortfall can't be moved (there is nothing anywhere to move) and
   * Reorder won't buy a kit — so the row could never be cleared, and
   * the "Buy it" button it offered led to a page that ignores kits.
   */
  it('leaves out a product that holds no stock of its own', () => {
    const part = p({ id: 'part', name: 'Nib', stock: { back: 40 }, quantity: 40, min: {} });
    const kit = p({
      id: 'kit', name: 'Pen set', stock: {}, quantity: 0, min: { shelf: 6 },
      kit: 'sell', components: [{ productId: 'part', qty: 2 }],
    });
    expect(replenishRows([part, kit])).toEqual([]);
    expect(belowMinimumCount([part, kit], 'shelf')).toBe(0);
    expect([...locationsWithMinimums([part, kit])]).toEqual([]);

    // A kit that does hold its own stock (built ahead of time) still counts.
    const built = p({ ...kit, id: 'built', kit: 'build' });
    expect(replenishRows([part, built]).map((r) => r.product.id)).toEqual(['built']);
  });
});

describe('shelf and bin codes', () => {
  const b = (over = {}) => p({ bin: { shelf: ' A3-12 ', back: 'B1', empty: '  ' }, ...over });

  it('keeps trimmed, non-empty codes only', () => {
    expect(binMap(b())).toEqual({ shelf: 'A3-12', back: 'B1' });
    expect(binMap(p({ bin: null }))).toEqual({});
    expect(binMap(p({ bin: ['A1'] }))).toEqual({});
    expect(binAt(b(), 'shelf')).toBe('A3-12');
    expect(binAt(b(), 'nowhere')).toBe('');
    expect(hasBins(b())).toBe(true);
    expect(hasBins(p())).toBe(false);
  });

  it('writes a code, and a blank removes it', () => {
    expect(withBinAt(p(), 'shelf', ' C4 ')).toEqual({ shelf: 'C4' });
    expect(withBinAt(b(), 'shelf', '')).toEqual({ back: 'B1' });
  });

  it('lists and compares codes the way a person walks a room', () => {
    expect(binEntries(p({ bin: { a: 'B1', b: 'A10', c: 'A2' } })).map(([, code]) => code))
      .toEqual(['A2', 'A10', 'B1']);
    expect(compareBins('a2', 'A10')).toBeLessThan(0);
    expect(compareBins('', 'A1')).toBeGreaterThan(0);
    expect(compareBins('', '')).toBe(0);
  });
});
