import { describe, it, expect } from 'vitest';
import {
  buildStocktakeRows, stocktakeProgress, stocktakeRowByCode,
  stocktakeVariances, varianceTotals, sortStocktakeRows, hasBinCodes,
  buildStocktakeRecord, trimStocktakeHistory, stocktakeHistory,
  countVarianceTotals, countLabel, STOCKTAKE_DETAIL, STOCKTAKE_MAX,
} from '../src/lib/stocktake.js';

const p = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  name: 'Widget', sku: '', barcode: '', unit: 'each', category: '',
  quantity: 0, stock: {}, cost: 1, locationId: null, archived: false, ...over,
});

describe('buildStocktakeRows', () => {
  const products = [
    p({ id: 'a', name: 'Mouse', sku: 'WM-1', category: 'Gear', quantity: 10, stock: { l1: 6, l2: 4 } }),
    p({ id: 'b', name: 'Beans', unit: 'kg', category: 'Food', quantity: 2.5, stock: { l1: 2.5 } }),
    p({ id: 'c', name: 'Empty here', category: 'Gear', quantity: 0, stock: {}, locationId: 'l1' }),
    p({ id: 'd', name: 'Elsewhere', quantity: 3, stock: { l2: 3 } }),
    p({ id: 'e', name: 'Retired', quantity: 9, stock: { l1: 9 }, archived: true }),
  ];

  it('freezes everything, sorted by name, expected at the total', () => {
    const rows = buildStocktakeRows(products);
    expect(rows.map((r) => r.productId)).toEqual(['b', 'd', 'c', 'a']);
    expect(rows.find((r) => r.productId === 'a').expected).toBe(10);
    expect(rows.every((r) => r.counted === null)).toBe(true);
  });

  it('scopes to a location with per-bucket expectations, keeping empty homes', () => {
    const rows = buildStocktakeRows(products, { locationId: 'l1' });
    expect(rows.map((r) => r.productId)).toEqual(['b', 'c', 'a']);
    // The count is of that shelf, not the product's whole holding.
    expect(rows.find((r) => r.productId === 'a').expected).toBe(6);
    expect(rows.find((r) => r.productId === 'c').expected).toBe(0);
  });

  it('scopes to a category, and never counts archived products', () => {
    const rows = buildStocktakeRows(products, { category: 'Gear' });
    expect(rows.map((r) => r.productId)).toEqual(['c', 'a']);
  });
});

describe('progress and scanning', () => {
  const session = {
    rows: [
      { productId: 'a', name: 'Mouse', sku: 'WM-1', barcode: '590123', unit: 'each', expected: 5, counted: 4 },
      { productId: 'b', name: 'Pad', sku: '590123', barcode: '', unit: 'each', expected: 2, counted: null },
      { productId: 'c', name: 'Zero', sku: '', barcode: '', unit: 'each', expected: 1, counted: 0 },
    ],
  };

  it('counts progress, treating an entered zero as counted', () => {
    expect(stocktakeProgress(session)).toEqual({ counted: 2, total: 3 });
    expect(stocktakeProgress(null)).toEqual({ counted: 0, total: 0 });
  });

  it('resolves a scan to its row, barcode before SKU', () => {
    expect(stocktakeRowByCode(session, '590123').productId).toBe('a');
    expect(stocktakeRowByCode(session, ' wm-1 ').productId).toBe('a');
    expect(stocktakeRowByCode(session, 'nope')).toBeNull();
    expect(stocktakeRowByCode(session, '')).toBeNull();
  });
});

describe('variances', () => {
  const session = {
    rows: [
      { productId: 'a', name: 'Short', unit: 'each', expected: 10, counted: 7 },
      { productId: 'b', name: 'Over', unit: 'each', expected: 2, counted: 3 },
      { productId: 'c', name: 'Match', unit: 'each', expected: 5, counted: 5 },
      { productId: 'd', name: 'Skipped', unit: 'each', expected: 4, counted: null },
      { productId: 'gone', name: 'Deleted', unit: 'each', expected: 2, counted: 0 },
    ],
  };
  const products = [p({ id: 'a', cost: 10 }), p({ id: 'b', cost: 2 }), p({ id: 'c', cost: 1 })];

  it('lists only real differences, valued at current cost, biggest first', () => {
    const rows = stocktakeVariances(session, products);
    expect(rows.map((r) => r.productId)).toEqual(['a', 'b', 'gone']);
    expect(rows[0]).toMatchObject({ delta: -3, value: -30 });
    expect(rows[1]).toMatchObject({ delta: 1, value: 2 });
    // A deleted product still reports its unit change, valued at zero.
    expect(rows[2]).toMatchObject({ delta: -2, value: 0 });
  });

  it('totals the damage', () => {
    const totals = varianceTotals(stocktakeVariances(session, products));
    expect(totals).toEqual({ value: -28, up: 1, down: 2, rows: 3 });
  });
});

describe('bin codes on the sheet', () => {
  it('freezes the code for the place being counted', () => {
    const products = [p({
      id: 'a', name: 'Mouse', quantity: 10, stock: { l1: 6, l2: 4 },
      locationId: 'l1', bin: { l1: 'A3-12', l2: 'B1' },
    })];
    expect(buildStocktakeRows(products, { locationId: 'l2' })[0].bin).toBe('B1');
    // Counting everywhere uses the product's own place.
    expect(buildStocktakeRows(products, {})[0].bin).toBe('A3-12');
    expect(buildStocktakeRows([p({ id: 'b', quantity: 1, stock: { l1: 1 } })], {})[0].bin).toBe('');
  });

  it('orders the sheet by the walk, with uncoded rows last', () => {
    const rows = [
      { name: 'Zeta', bin: 'A2' },
      { name: 'Alpha', bin: 'A10' },
      { name: 'Nothing', bin: '' },
      { name: 'Beta', bin: 'B1' },
    ];
    // A2 before A10 before B1 — numbers inside the code read as numbers.
    expect(sortStocktakeRows(rows, 'bin').map((r) => r.name)).toEqual(['Zeta', 'Alpha', 'Beta', 'Nothing']);
    expect(sortStocktakeRows(rows, 'name').map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Nothing', 'Zeta']);
    expect(sortStocktakeRows(rows).map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Nothing', 'Zeta']);
  });

  it('knows whether a sheet has any codes to walk by', () => {
    expect(hasBinCodes({ rows: [{ bin: '' }, { bin: 'A1' }] })).toBe(true);
    expect(hasBinCodes({ rows: [{ bin: '' }, {}] })).toBe(false);
    expect(hasBinCodes(null)).toBe(false);
  });
});

describe('the record a count leaves behind', () => {
  const session = {
    id: 's1',
    startedAt: new Date(2026, 7, 4, 9).getTime(),
    scope: { locationId: null, category: '', label: 'Everything' },
    blind: false,
    rows: [
      { productId: 'a', name: 'Mouse', sku: 'WM-1', unit: 'each', expected: 10, counted: 7 },
      { productId: 'b', name: 'Beans', sku: '', unit: 'kg', expected: 2.5, counted: 3 },
      { productId: 'c', name: 'Pad', sku: '', unit: 'each', expected: 4, counted: 4 },
      { productId: 'd', name: 'Skipped', sku: '', unit: 'each', expected: 9, counted: null },
    ],
  };
  const products = [
    p({ id: 'a', cost: 2 }),
    p({ id: 'b', cost: 10, unit: 'kg' }),
    p({ id: 'c', cost: 1 }),
  ];
  const at = new Date(2026, 7, 4, 11).getTime();

  it('keeps what the review screen showed, in units and in money', () => {
    const record = buildStocktakeRecord(session, stocktakeVariances(session, products), { at, adjusted: 2 });
    expect(record).toMatchObject({
      id: 's1', committedAt: at, total: 4, counted: 3, skipped: 1, matched: 1,
      varied: 2, adjusted: 2, unitsShort: 3, unitsOver: 0, measured: 1,
    });
    // 3 units of a £2 product short, half a kilo of a £10 one over.
    expect(record.value).toBe(-1);
    expect(record.lines.map((l) => l.name)).toEqual(['Mouse', 'Beans']);
    expect(record.lines[0]).toMatchObject({ expected: 10, counted: 7, delta: -3, value: -6 });
  });

  it('records a count where everything matched, with no lines', () => {
    const clean = { ...session, rows: [{ productId: 'c', name: 'Pad', unit: 'each', expected: 4, counted: 4 }] };
    const record = buildStocktakeRecord(clean, stocktakeVariances(clean, products), { at });
    expect(record).toMatchObject({ counted: 1, varied: 0, matched: 1, value: 0 });
    expect(record.lines).toEqual([]);
  });
});

describe('bounded count history', () => {
  const record = (i) => ({
    id: `r${i}`, committedAt: i * 1000, scope: { label: 'Everything' },
    counted: 1, skipped: 0, value: -i, unitsShort: i, unitsOver: 0,
    lines: [{ productId: 'a', name: 'Mouse', delta: -1, value: -i }],
  });

  it('keeps the newest in full and rolls older ones down to totals', () => {
    const list = trimStocktakeHistory(Array.from({ length: STOCKTAKE_DETAIL + 3 }, (_, i) => record(i)));
    expect(list[0].id).toBe(`r${STOCKTAKE_DETAIL + 2}`);
    expect(list[STOCKTAKE_DETAIL - 1].lines).toBeTruthy();
    expect(list[STOCKTAKE_DETAIL].lines).toBeUndefined();
    expect(list[STOCKTAKE_DETAIL]).toMatchObject({ rolled: true, value: expect.any(Number) });
  });

  it('never keeps more than the cap', () => {
    expect(trimStocktakeHistory(Array.from({ length: STOCKTAKE_MAX + 10 }, (_, i) => record(i)))).toHaveLength(STOCKTAKE_MAX);
    expect(trimStocktakeHistory(null)).toEqual([]);
  });

  it('windows the history and totals what counting found', () => {
    const now = new Date(2026, 7, 20).getTime();
    const DAY = 24 * 3600 * 1000;
    const list = [
      { id: 'new', committedAt: now - DAY, value: -20, unitsShort: 4, unitsOver: 0, scope: { label: 'Shelf' } },
      { id: 'old', committedAt: now - 90 * DAY, value: -100, unitsShort: 30, unitsOver: 0, scope: { label: 'Everything' } },
      { id: 'gain', committedAt: now - 2 * DAY, value: 5, unitsShort: 0, unitsOver: 1, scope: { label: 'Shelf' } },
    ];
    const windowed = stocktakeHistory(list, { days: 30, now });
    expect(windowed.map((r) => r.id)).toEqual(['new', 'gain']);
    expect(countVarianceTotals(windowed)).toMatchObject({ counts: 2, short: 20, over: 5, net: -15, unitsShort: 4, unitsOver: 1 });
  });

  it('names a count by its scope and the day it was applied', () => {
    expect(countLabel({ scope: { label: 'Stockroom' }, committedAt: new Date(2026, 7, 4).getTime() }))
      .toMatch(/^Stockroom · /);
  });
});

describe('gross count shortages', () => {
  it('does not let extra stock hide missing stock in the same count', () => {
    const session = { id: 'mixed', startedAt: 1, scope: {}, rows: [
      { productId: 'a', name: 'Missing', expected: 10, counted: 5, unit: 'each' },
      { productId: 'b', name: 'Extra', expected: 0, counted: 5, unit: 'each' },
    ] };
    const variances = stocktakeVariances(session, [{ id: 'a', cost: 10 }, { id: 'b', cost: 10 }]);
    const record = buildStocktakeRecord(session, variances, { at: 1 });
    expect(record.value).toBe(0);
    expect(countVarianceTotals([record])).toMatchObject({ short: 50, over: 50, net: 0 });
    const newer = Array.from({ length: STOCKTAKE_DETAIL }, (_, i) => ({ id: `new${i}`, committedAt: i + 2, value: 0 }));
    const rolled = trimStocktakeHistory([record, ...newer]).at(-1);
    expect(rolled.lines).toBeUndefined();
    expect(countVarianceTotals([rolled])).toMatchObject({ short: 50, over: 50, net: 0 });
  });

  it('recovers gross amounts from older detailed records before rolling them up', () => {
    const legacy = { id: 'old', committedAt: 1, value: -10, lines: [{ value: -30 }, { value: 20 }] };
    expect(countVarianceTotals([legacy])).toMatchObject({ short: 30, over: 20, net: -10 });
    const newer = Array.from({ length: STOCKTAKE_DETAIL }, (_, i) => ({ id: `new${i}`, committedAt: i + 2, value: 0 }));
    const rolled = trimStocktakeHistory([legacy, ...newer]).at(-1);
    expect(countVarianceTotals([rolled])).toMatchObject({ short: 30, over: 20, net: -10 });
  });
});
