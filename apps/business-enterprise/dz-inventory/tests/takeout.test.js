import { describe, it, expect } from 'vitest';
import {
  lineReason, lineLocation, lineNote, linePrice, buildTakeoutLine,
  takeoutLineByCode, takeoutLineFor, takeoutTotals, lineAvailable, takeoutRef,
  DEFAULT_TAKEOUT_REASON,
} from '../src/lib/takeout.js';

const prod = (over = {}) => ({
  id: 'p1', name: 'Mouse', sku: 'WM-1', barcode: '111', unit: 'each',
  quantity: 10, stock: { main: 8, '': 2 }, locationId: 'main', cost: 2, price: 5, ...over,
});

const session = (over = {}) => ({
  id: 's1', startedAt: new Date(2026, 7, 20, 9, 5).getTime(), updatedAt: 0,
  reason: 'sold', locationId: null, note: '', lines: [], ...over,
});

const line = (over = {}) => ({
  id: 'l1', productId: 'p1', name: 'Mouse', sku: 'WM-1', barcode: '111',
  unit: 'each', qty: 2, price: 5, reason: '', locationId: null, note: '', ...over,
});

describe('what a line inherits', () => {
  it('takes the session reason unless it has its own', () => {
    expect(lineReason(session(), line())).toBe('sold');
    expect(lineReason(session({ reason: 'damaged' }), line())).toBe('damaged');
    expect(lineReason(session(), line({ reason: 'lost' }))).toBe('lost');
    // Junk from a hand-made restore never reaches the log.
    expect(lineReason(session({ reason: 'nonsense' }), line({ reason: 'rubbish' }))).toBe(DEFAULT_TAKEOUT_REASON);
  });

  it('resolves the bucket: own, then session, then the product default', () => {
    expect(lineLocation(session(), line(), prod())).toBe('main');
    expect(lineLocation(session({ locationId: 'shop' }), line(), prod())).toBe('shop');
    expect(lineLocation(session({ locationId: 'shop' }), line({ locationId: 'back' }), prod())).toBe('back');
    // '' is the unassigned bucket — a real choice, not "inherit".
    expect(lineLocation(session({ locationId: '' }), line(), prod())).toBe('');
    expect(lineLocation(session(), line({ locationId: '' }), prod())).toBe('');
  });

  it('takes the session note unless the line wrote its own', () => {
    expect(lineNote(session({ note: 'Market' }), line())).toBe('Market');
    expect(lineNote(session({ note: 'Market' }), line({ note: 'Sample' }))).toBe('Sample');
    expect(lineNote(session(), line())).toBe('');
  });

  it('prices only sales, and treats zero as a price', () => {
    expect(linePrice(session(), line({ price: 7.005 }))).toBe(7.01);
    expect(linePrice(session(), line({ price: 0 }))).toBe(0);
    expect(linePrice(session(), line({ price: null }))).toBeNull();
    expect(linePrice(session(), line({ price: -1 }))).toBeNull();
    // A write-off has no revenue, whatever the line happens to carry.
    expect(linePrice(session({ reason: 'damaged' }), line({ price: 5 }))).toBeNull();
    expect(linePrice(session(), line({ reason: 'lost', price: 5 }))).toBeNull();
  });
});

describe('buildTakeoutLine', () => {
  it('seeds one unit at the product’s selling price', () => {
    expect(buildTakeoutLine(prod(), { id: 'x' })).toMatchObject({
      id: 'x', productId: 'p1', name: 'Mouse', sku: 'WM-1', unit: 'each', qty: 1, price: 5,
    });
  });

  it('never seeds a line asking for nothing', () => {
    expect(buildTakeoutLine(prod(), { qty: 0 }).qty).toBe(1);
    expect(buildTakeoutLine(prod({ unit: 'kg' }), { qty: 0 }).qty).toBe(0.001);
    // A counted product can't take half a unit.
    expect(buildTakeoutLine(prod(), { qty: 2.6 }).qty).toBe(3);
  });

  it('carries no price when the product has none', () => {
    expect(buildTakeoutLine(prod({ price: null })).price).toBeNull();
  });
});

describe('finding a line', () => {
  const s = session({
    lines: [
      line({ id: 'a', productId: 'p1', barcode: '111', sku: 'WM-1' }),
      line({ id: 'b', productId: 'p2', barcode: '', sku: '222' }),
    ],
  });

  it('matches a scanned code, barcodes before SKUs', () => {
    expect(takeoutLineByCode(s, '111').id).toBe('a');
    expect(takeoutLineByCode(s, ' wm-1 ').id).toBe('a');
    expect(takeoutLineByCode(s, '222').id).toBe('b');
    expect(takeoutLineByCode(s, '999')).toBeNull();
    expect(takeoutLineByCode(s, '')).toBeNull();
  });

  it('finds the line a product already has', () => {
    expect(takeoutLineFor(s, 'p2').id).toBe('b');
    expect(takeoutLineFor(s, 'nope')).toBeNull();
  });
});

describe('takeoutTotals', () => {
  const products = [
    prod(),
    prod({ id: 'p2', name: 'Rope', unit: 'm', quantity: 5, stock: { main: 5 }, cost: 10, price: 20 }),
  ];

  it('values the basket line by line', () => {
    const s = session({
      lines: [
        line({ id: 'a', qty: 3, price: 5 }),
        line({ id: 'b', productId: 'p2', unit: 'm', qty: 1.5, price: 20 }),
      ],
    });
    const t = takeoutTotals(s, products);
    expect(t).toMatchObject({
      lines: 2, units: 3, measured: 1, cost: 21, revenue: 45, profit: 24, priced: 2, unpriced: 0,
    });
  });

  it('counts unpriced sales without valuing them', () => {
    const s = session({ lines: [line({ qty: 2, price: null })] });
    expect(takeoutTotals(s, products)).toMatchObject({ revenue: 0, priced: 0, unpriced: 1, cost: 4 });
  });

  it('does not count a write-off as an unpriced sale', () => {
    const s = session({ reason: 'damaged', lines: [line({ qty: 2, price: null })] });
    expect(takeoutTotals(s, products)).toMatchObject({ unpriced: 0, revenue: 0 });
  });

  it('keeps a write-off out of the gross profit on what sold', () => {
    // One sold at 5 (cost 2), one binned at a cost of 10 — the basket is
    // worth 21 at cost, but the sale made 5 − 2 = 3.
    const s = session({
      lines: [
        line({ id: 'a', qty: 1, price: 5 }),
        line({ id: 'b', productId: 'p2', unit: 'm', qty: 1, price: null, reason: 'damaged' }),
      ],
    });
    expect(takeoutTotals(s, products)).toMatchObject({
      cost: 12, soldCost: 2, revenue: 5, profit: 3, priced: 1, unpriced: 0,
    });
  });

  it('flags lines asking for more than the location holds', () => {
    // 8 at main, and the line asks for 9 out of the product's own home.
    const s = session({ lines: [line({ qty: 9 })] });
    expect(takeoutTotals(s, products).shortLines).toBe(1);
    // The whole product has 10, but not in this one bucket.
    expect(takeoutTotals(session({ locationId: '', lines: [line({ qty: 3 })] }), products).shortLines).toBe(1);
  });

  it('counts a deleted product as missing rather than free stock', () => {
    const s = session({ lines: [line({ productId: 'gone' })] });
    expect(takeoutTotals(s, products)).toMatchObject({ lines: 1, missing: 1, cost: 0, revenue: 0 });
  });
});

describe('lineAvailable', () => {
  it('is what the chosen bucket holds, and zero for a deleted product', () => {
    expect(lineAvailable(session(), line(), prod())).toBe(8);
    expect(lineAvailable(session({ locationId: '' }), line(), prod())).toBe(2);
    expect(lineAvailable(session(), line(), null)).toBe(0);
  });

  /* A sell-as-kit holds none anywhere, on purpose. Reading its bucket
     said every basket line for one was short by its whole quantity. */
  it('reads a sell-as-kit against what its components allow', () => {
    const part = prod({ id: 'part', name: 'Bean', quantity: 9, stock: { main: 9 }, cost: 1 });
    const kit = prod({
      id: 'kit', name: 'Set', quantity: 0, stock: {}, price: 5,
      kit: 'sell', components: [{ productId: 'part', qty: 2 }],
    });
    const s = session({ lines: [line({ productId: 'kit', qty: 3 })] });
    expect(lineAvailable(s, s.lines[0], kit, [part, kit])).toBe(4);
    expect(takeoutTotals(s, [part, kit]).shortLines).toBe(0);
    // And it is costed at what its parts cost, not at the nothing it holds.
    expect(takeoutTotals(s, [part, kit])).toMatchObject({ cost: 6, revenue: 15, profit: 9 });
  });
});

describe('takeoutRef', () => {
  it('stamps the local date and time the basket started', () => {
    expect(takeoutRef(session())).toBe('Take-out 2026-08-20 09:05');
  });
});
