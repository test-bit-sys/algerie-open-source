import { describe, it, expect } from 'vitest';
import {
  upsertSnapshot, sameSnapshot, snapshotSeries, SNAPSHOT_MAX,
  movementByProduct, topMovers, deadStock, logReach,
  valueByCategory, valueByLocation, marginRows, averageMargin,
  shrinkageRows, shrinkageTotals, unspecifiedRemovals, reportRows,
  salesRows, salesTotals, topEarners, untrackedSales, movementSeries,
} from '../src/lib/reports.js';

const DAY = 24 * 3600 * 1000;
const now = new Date(2026, 7, 4, 12).getTime();
const daysAgo = (n) => now - n * DAY;

const snap = (date, over = {}) => ({ date, products: 1, units: 10, value: 100, low: 0, out: 0, ...over });
const entry = (over = {}) => ({ id: Math.random().toString(36).slice(2), at: daysAgo(1), kind: 'remove', productId: 'p1', name: 'Mouse', unit: 'each', delta: -2, ...over });
const prod = (over = {}) => ({ id: 'p1', name: 'Mouse', unit: 'each', quantity: 10, cost: 2, price: null, category: '', stock: {}, archived: false, ...over });

describe('snapshots', () => {
  it('keeps one row per day, refreshing today', () => {
    let list = upsertSnapshot([], snap('2026-08-03'));
    list = upsertSnapshot(list, snap('2026-08-04', { value: 100 }));
    list = upsertSnapshot(list, snap('2026-08-04', { value: 250 }));
    expect(list).toHaveLength(2);
    expect(list[1].value).toBe(250);
  });

  it('caps the series and drops the oldest', () => {
    let list = [];
    for (let i = 0; i < SNAPSHOT_MAX + 5; i++) list = upsertSnapshot(list, snap(`d${i}`));
    expect(list).toHaveLength(SNAPSHOT_MAX);
    expect(list[0].date).toBe('d5');
  });

  it('recognizes an unchanged reading', () => {
    expect(sameSnapshot(snap('2026-08-04'), snap('2026-08-04'))).toBe(true);
    expect(sameSnapshot(snap('2026-08-04'), snap('2026-08-04', { units: 11 }))).toBe(false);
    expect(sameSnapshot(null, snap('2026-08-04'))).toBe(false);
  });

  it('windows the series by day', () => {
    const list = [snap('2026-06-01'), snap('2026-08-01'), snap('2026-08-04')];
    expect(snapshotSeries(list, { days: 7, now }).map((s) => s.date)).toEqual(['2026-08-01', '2026-08-04']);
    expect(snapshotSeries(list, { days: 365, now })).toHaveLength(3);
    expect(snapshotSeries(null, { now })).toEqual([]);
  });
});

describe('movement', () => {
  const entries = [
    entry({ productId: 'a', name: 'A', delta: -5, at: daysAgo(1) }),
    entry({ productId: 'a', name: 'A', delta: 12, kind: 'add', at: daysAgo(2) }),
    entry({ productId: 'b', name: 'B', delta: -2, at: daysAgo(3) }),
    entry({ productId: 'b', name: 'B', delta: -1, kind: 'recount', at: daysAgo(3) }),
    entry({ productId: 'c', name: 'C', delta: -99, at: daysAgo(40) }),
    entry({ productId: null, name: 'Import', kind: 'import', delta: null, at: daysAgo(1) }),
  ];

  it('sums in and out per product inside the window', () => {
    const rows = movementByProduct(entries, { days: 30, now });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.productId === 'a')).toMatchObject({ in: 12, out: 5 });
    // a recount that found one missing counts as one gone
    expect(rows.find((r) => r.productId === 'b')).toMatchObject({ in: 0, out: 3 });
  });

  it('ranks by units out and ignores receipts-only products', () => {
    const rows = topMovers([...entries, entry({ productId: 'd', name: 'D', kind: 'add', delta: 40 })], { days: 30, now });
    expect(rows.map((r) => r.productId)).toEqual(['a', 'b']);
  });

  it('reports how far back the log reaches', () => {
    expect(logReach(entries)).toBe(daysAgo(40));
    expect(logReach([])).toBeNull();
  });

  it('drops write-offs from demand-only movement, keeping reason-less removals', () => {
    const tagged = [
      entry({ productId: 'a', delta: -5, reason: 'sold' }),
      entry({ productId: 'a', delta: -4, reason: 'damaged' }),
      entry({ productId: 'a', delta: -3 }), // pre-reason entry stays counted
      entry({ productId: 'b', delta: -9, reason: 'lost' }),
    ];
    const demand = movementByProduct(tagged, { days: 30, now, demandOnly: true });
    expect(demand.find((r) => r.productId === 'a')).toMatchObject({ out: 8 });
    expect(demand.find((r) => r.productId === 'b')).toBeUndefined();
    // Without the flag everything still counts, as before.
    expect(movementByProduct(tagged, { days: 30, now }).find((r) => r.productId === 'a')).toMatchObject({ out: 12 });
    expect(topMovers(tagged, { days: 30, now }).map((r) => r.productId)).toEqual(['a']);
  });
});

describe('deadStock', () => {
  const products = [
    prod({ id: 'a', name: 'Moving', quantity: 4, cost: 10 }),
    prod({ id: 'b', name: 'Stuck', quantity: 3, cost: 100 }),
    prod({ id: 'c', name: 'Empty', quantity: 0, cost: 100 }),
    prod({ id: 'd', name: 'Retired', quantity: 9, cost: 100, archived: true }),
  ];
  const entries = [entry({ productId: 'a', at: daysAgo(5) }), entry({ productId: 'b', at: daysAgo(120) })];

  it('lists stock on hand that nothing has left, by money stuck', () => {
    const rows = deadStock(products, entries, { days: 60, now });
    expect(rows.map((r) => r.product.id)).toEqual(['b']);
    expect(rows[0].value).toBe(300);
  });

  it('counts a downward recount as movement, like the movers chart does', () => {
    const recounted = [entry({ productId: 'b', kind: 'recount', delta: -1, at: daysAgo(5) })];
    expect(deadStock(products, recounted, { days: 60, now }).map((r) => r.product.id)).toEqual(['a']);
    // An upward recount is a receipt, not stock leaving.
    const upward = [entry({ productId: 'b', kind: 'recount', delta: 1, at: daysAgo(5) })];
    expect(deadStock(products, upward, { days: 60, now }).map((r) => r.product.id)).toEqual(['b', 'a']);
  });

  it('counts a product that moved just inside the window as alive', () => {
    expect(deadStock(products, entries, { days: 200, now }).map((r) => r.product.id)).toEqual([]);
  });

  it('does not count a write-off as movement', () => {
    const writeOff = [entry({ productId: 'b', delta: -1, reason: 'damaged', at: daysAgo(5) })];
    expect(deadStock(products, writeOff, { days: 60, now }).map((r) => r.product.id)).toEqual(['b', 'a']);
    const sold = [entry({ productId: 'b', delta: -1, reason: 'sold', at: daysAgo(5) })];
    expect(deadStock(products, sold, { days: 60, now }).map((r) => r.product.id)).toEqual(['a']);
  });
});

describe('shrinkage', () => {
  const products = [
    prod({ id: 'a', name: 'Milk', cost: 2 }),
    prod({ id: 'b', name: 'Rope', cost: 10, unit: 'm' }),
  ];
  const entries = [
    entry({ productId: 'a', delta: -3, reason: 'damaged', at: daysAgo(1) }),
    entry({ productId: 'a', delta: -2, reason: 'expired', at: daysAgo(2) }),
    entry({ productId: 'b', delta: -1.5, unit: 'm', reason: 'lost', at: daysAgo(3) }),
    entry({ productId: 'a', delta: -9, reason: 'sold', at: daysAgo(1) }),      // demand, not loss
    entry({ productId: 'a', delta: -4, reason: 'damaged', at: daysAgo(90) }),  // outside window
    entry({ productId: 'a', delta: -7, at: daysAgo(1) }),                      // no reason recorded
  ];

  it('sums write-offs per product at current cost, biggest loss first', () => {
    const rows = shrinkageRows(products, entries, { days: 30, now });
    expect(rows.map((r) => r.productId)).toEqual(['b', 'a']);
    expect(rows[1]).toMatchObject({ units: 5, value: 10, reasons: { damaged: 3, expired: 2 } });
    expect(rows[0]).toMatchObject({ units: 1.5, value: 15, reasons: { lost: 1.5 } });
  });

  it('values a deleted product at zero rather than inventing a cost', () => {
    const rows = shrinkageRows([], entries, { days: 30, now });
    expect(rows.find((r) => r.productId === 'a')).toMatchObject({ units: 5, value: 0 });
  });

  it('totals value always, units over counted products only', () => {
    const totals = shrinkageTotals(shrinkageRows(products, entries, { days: 30, now }));
    expect(totals).toEqual({ products: 2, units: 5, measured: 1, value: 25 });
  });

  it('counts reason-less removals in the window separately', () => {
    expect(unspecifiedRemovals(entries, { days: 30, now })).toBe(1);
    expect(unspecifiedRemovals([], { days: 30, now })).toBe(0);
  });
});

describe('movementSeries', () => {
  it('gives every day in the window a point, quiet ones included', () => {
    const series = movementSeries([], 'p1', { days: 5, now });
    expect(series).toHaveLength(5);
    expect(series[0].date).toBe('2026-07-31');
    expect(series[4].date).toBe('2026-08-04');
    expect(series.every((d) => d.in === 0 && d.out === 0)).toBe(true);
  });

  it('buckets one product\u2019s movement by local day', () => {
    const series = movementSeries([
      entry({ productId: 'p1', delta: -2, at: daysAgo(1) }),
      entry({ productId: 'p1', delta: -3, at: daysAgo(1) }),
      entry({ productId: 'p1', delta: 10, kind: 'add', at: daysAgo(2) }),
      entry({ productId: 'other', delta: -9, at: daysAgo(1) }),
      entry({ productId: 'p1', delta: -4, at: daysAgo(40) }),   // outside
    ], 'p1', { days: 5, now });
    // The window is Jul 31 – Aug 4, so yesterday is the fourth point.
    expect(series[2]).toMatchObject({ in: 10, out: 0 });
    expect(series[3]).toMatchObject({ in: 0, out: 5 });
    expect(series[4]).toMatchObject({ in: 0, out: 0 });
  });

  it('counts demand only, so a write-off is not a busy day', () => {
    const series = movementSeries([
      entry({ productId: 'p1', delta: -6, reason: 'damaged', at: daysAgo(1) }),
      entry({ productId: 'p1', delta: -1, reason: 'sold', at: daysAgo(1) }),
    ], 'p1', { days: 3, now });
    expect(series[1].out).toBe(1);
  });
});

describe('sales', () => {
  const products = [
    prod({ id: 'a', name: 'Milk', cost: 2 }),
    prod({ id: 'b', name: 'Rope', cost: 10, unit: 'm' }),
  ];
  const entries = [
    // Two priced sales of the same product, the second at a discount.
    entry({ productId: 'a', delta: -3, reason: 'sold', price: 5, cost: 2, at: daysAgo(1) }),
    entry({ productId: 'a', delta: -2, reason: 'sold', price: 4, cost: 2, at: daysAgo(2) }),
    // Measured stock, sold by the metre.
    entry({ productId: 'b', delta: -1.5, unit: 'm', reason: 'sold', price: 20, cost: 10, at: daysAgo(3) }),
    // Write-offs are not sales, whatever price they might carry.
    entry({ productId: 'a', delta: -4, reason: 'damaged', price: 5, cost: 2, at: daysAgo(1) }),
    // A sale with no price recorded: never valued at list price.
    entry({ productId: 'a', delta: -7, reason: 'sold', at: daysAgo(1) }),
    // Outside the window.
    entry({ productId: 'a', delta: -9, reason: 'sold', price: 5, cost: 2, at: daysAgo(90) }),
  ];

  it('sums revenue, cost of goods, and profit per product, biggest revenue first', () => {
    const rows = salesRows(products, entries, { days: 30, now });
    expect(rows.map((r) => r.productId)).toEqual(['b', 'a']);
    expect(rows[1]).toMatchObject({ units: 5, revenue: 23, cost: 10, profit: 13, sales: 2 });
    expect(rows[0]).toMatchObject({ units: 1.5, revenue: 30, cost: 15, profit: 15 });
  });

  it('uses the cost frozen on the entry, not what the product costs now', () => {
    const dearer = [prod({ id: 'a', name: 'Milk', cost: 9 })];
    const rows = salesRows(dearer, [entry({ productId: 'a', delta: -2, reason: 'sold', price: 5, cost: 2 })], { days: 30, now });
    expect(rows[0]).toMatchObject({ revenue: 10, cost: 4, profit: 6 });
  });

  it('falls back to the current cost only when the entry carries none', () => {
    const rows = salesRows(products, [entry({ productId: 'a', delta: -2, reason: 'sold', price: 5 })], { days: 30, now });
    expect(rows[0]).toMatchObject({ revenue: 10, cost: 4, profit: 6 });
    expect(salesRows([], [entry({ productId: 'a', delta: -2, reason: 'sold', price: 5 })], { days: 30, now })[0])
      .toMatchObject({ revenue: 10, cost: 0, profit: 10 });
  });

  it('counts a giveaway at zero rather than treating it as unpriced', () => {
    const rows = salesRows(products, [entry({ productId: 'a', delta: -2, reason: 'sold', price: 0, cost: 2 })], { days: 30, now });
    expect(rows[0]).toMatchObject({ revenue: 0, cost: 4, profit: -4 });
    expect(untrackedSales([entry({ productId: 'a', delta: -2, reason: 'sold', price: 0 })], { days: 30, now }).count).toBe(0);
  });

  it('totals the money always, units over counted products only', () => {
    const totals = salesTotals(salesRows(products, entries, { days: 30, now }));
    expect(totals).toMatchObject({ products: 2, sales: 3, units: 5, measured: 1, revenue: 53, cost: 25, profit: 28 });
    expect(totals.margin).toBeCloseTo(52.8, 1);
    expect(salesTotals([]).margin).toBeNull();
  });

  it('ranks top earners by gross profit, not revenue', () => {
    const rows = [
      { productId: 'a', name: 'Milk', unit: 'each', units: 5, revenue: 100, cost: 95, profit: 5, sales: 1 },
      { productId: 'b', name: 'Rope', unit: 'each', units: 2, revenue: 40, cost: 10, profit: 30, sales: 1 },
    ];
    expect(topEarners(rows).map((r) => r.productId)).toEqual(['b', 'a']);
    expect(topEarners(rows, { limit: 1 })).toHaveLength(1);
  });

  it('counts unpriced sales separately, and only demand removals', () => {
    expect(untrackedSales(entries, { days: 30, now })).toEqual({ count: 1, units: 7, measured: 0 });
    // A measured product's units don't add to a count of items.
    expect(untrackedSales([entry({ productId: 'b', unit: 'm', delta: -2, reason: 'sold' })], { days: 30, now }))
      .toEqual({ count: 1, units: 0, measured: 1 });
  });

  it('reads a kit sale as one sale, not a priced one and unpriced parts', () => {
    // Selling a set writes the money on the kit's entry and takes the
    // components out under the same reason. The parts aren't sales of
    // their own — counting them said the report was blind to takings it
    // had in fact recorded.
    const sale = [
      entry({ productId: 'kit', name: 'Breakfast set', delta: -2, reason: 'sold', price: 4, cost: 0.6 }),
      entry({ productId: 'a', delta: -2, reason: 'sold', kitId: 'kit' }),
      entry({ productId: 'b', unit: 'm', delta: -0.04, reason: 'sold', kitId: 'kit' }),
    ];
    expect(untrackedSales(sale, { days: 30, now })).toEqual({ count: 0, units: 0, measured: 0 });
    expect(salesRows([], sale, { days: 30, now }).map((r) => [r.productId, r.revenue]))
      .toEqual([['kit', 8]]);
    // The components still count as demand for themselves.
    expect(topMovers(sale, { days: 30, now }).map((r) => r.productId).sort())
      .toEqual(['a', 'b', 'kit']);
  });
});

describe('value breakdowns', () => {
  const products = [
    prod({ id: 'a', category: 'Cables', quantity: 10, cost: 2, stock: { l1: 10 } }),
    prod({ id: 'b', category: 'Cables', quantity: 5, cost: 4, stock: { l2: 5 } }),
    prod({ id: 'c', category: '', quantity: 1, cost: 100, stock: { l1: 1, '': 0 } }),
    prod({ id: 'd', category: 'Cables', quantity: 3, cost: 1, stock: { '': 3 } }),
    prod({ id: 'e', category: 'Hidden', quantity: 9, cost: 50, archived: true, stock: { l1: 9 } }),
  ];
  const locations = [{ id: 'l1', name: 'Main' }, { id: 'l2', name: 'Shop' }];

  it('groups by category, biggest first, skipping archived', () => {
    const rows = valueByCategory(products);
    expect(rows.map((r) => r.label)).toEqual(['Uncategorized', 'Cables']);
    expect(rows[1]).toMatchObject({ value: 43, products: 3 });
  });

  it('groups by where the stock actually is', () => {
    const rows = valueByLocation(products, locations);
    expect(rows.map((r) => r.label)).toEqual(['Main', 'Shop', 'No location']);
    expect(rows[0].value).toBe(120);
    expect(rows[2]).toMatchObject({ value: 3, products: 1 });
  });

  it('counts stock held at a location that is no longer on file', () => {
    const rows = valueByLocation([prod({ quantity: 4, cost: 5, stock: { gone: 4 } })], locations);
    expect(rows.map((r) => r.label)).toEqual(['No location']);
    expect(rows[0]).toMatchObject({ value: 20, units: 4, products: 1 });
  });

  it('counts a product once when several off-list buckets fold into No location', () => {
    const rows = valueByLocation([prod({ quantity: 7, cost: 5, stock: { '': 3, gone: 4 } })], locations);
    expect(rows.map((r) => r.label)).toEqual(['No location']);
    expect(rows[0]).toMatchObject({ value: 35, units: 7, products: 1 });
  });
});

describe('reportRows', () => {
  it('writes every section for the period, with raw numbers and guarded text', () => {
    const rows = reportRows({
      products: [
        prod({ id: 'a', name: '=SUM(A1)', quantity: 4, cost: 5, price: 9, category: 'Cables', stock: { l1: 4 } }),
      ],
      snapshots: [snap('2026-08-01'), snap('2026-06-01')],
      activity: [
        entry({ productId: 'a', name: '=SUM(A1)', delta: -2, reason: 'sold', at: daysAgo(1) }),
        entry({ productId: 'a', name: '=SUM(A1)', delta: -1, reason: 'damaged', at: daysAgo(2) }),
      ],
      locations: [{ id: 'l1', name: 'Main' }],
      days: 30,
      now,
    });
    const titles = rows.filter((r) => r.length === 1 && r[0]).map((r) => r[0]);
    expect(titles).toEqual([
      'Inventory report', 'Summary', 'Stock over time', 'Top movers', 'Sales',
      'Not moving', 'Shrinkage', 'Value by category', 'Value by location', 'Margins',
    ]);
    // The June snapshot is outside the 30-day window.
    expect(rows.some((r) => r[0] === '2026-06-01')).toBe(false);
    expect(rows.some((r) => r[0] === '2026-08-01')).toBe(true);
    // Formula-looking names are marked as text, and the write-off shows up.
    const shrink = rows[rows.findIndex((r) => r[0] === 'Shrinkage') + 2];
    expect(shrink).toEqual(["'=SUM(A1)", 1, 'each', 5, 'damaged: 1']);
    // The sold removal counts as movement, the damaged one doesn't.
    const mover = rows[rows.findIndex((r) => r[0] === 'Top movers') + 2];
    expect(mover).toEqual(["'=SUM(A1)", 2, 0, 'each']);
  });

  it('stamps the local date, not the UTC one', () => {
    // 9pm on Aug 4 west of UTC is already Aug 5 in UTC; the report is
    // read as a local document, so it has to say Aug 4.
    const evening = new Date(2026, 7, 4, 21, 30).getTime();
    const rows = reportRows({ products: [prod()], now: evening });
    const generated = rows.find((r) => r[0] === 'Generated');
    expect(generated[1]).toBe('2026-08-04');
  });
});

describe('margins', () => {
  it.each([0, 99])('uses component cost for sell-as-kit margins instead of stored cost %s', (storedCost) => {
    const part = prod({ id: 'part', name: 'Part', cost: 3, price: null, quantity: 20 });
    const kit = prod({ id: 'kit', name: 'Pair', kit: 'sell', cost: storedCost, price: 5, quantity: 0,
      components: [{ productId: part.id, qty: 2 }] });
    const products = [kit, part];
    expect(marginRows(products)).toMatchObject([
      { product: { id: 'kit' }, cost: 6, margin: -1, percent: -20, belowCost: true },
    ]);
    expect(averageMargin(products)).toBe(-20);
    expect(reportRows({ products })).toContainEqual(['Pair', 6, 5, -1, -20]);
    expect(kit.cost).toBe(storedCost);
  });

  const products = [
    prod({ id: 'a', name: 'Healthy', cost: 5, price: 20, quantity: 1 }),
    prod({ id: 'b', name: 'Thin', cost: 9, price: 10, quantity: 1 }),
    prod({ id: 'c', name: 'Loss', cost: 12, price: 10, quantity: 1 }),
    prod({ id: 'd', name: 'Unpriced', cost: 4, price: null, quantity: 1 }),
  ];

  it('lists priced products thinnest first, flagging losses', () => {
    const rows = marginRows(products);
    expect(rows.map((r) => r.product.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0]).toMatchObject({ margin: -2, percent: -20, belowCost: true });
    expect(rows[2]).toMatchObject({ margin: 15, percent: 75, belowCost: false });
  });

  it('averages by weight, and is null with nothing priced', () => {
    // (20+10+10 revenue − 5+9+12 cost) / 40 revenue
    expect(averageMargin(products)).toBe(35);
    expect(averageMargin([prod({ price: null })])).toBeNull();
  });
});
