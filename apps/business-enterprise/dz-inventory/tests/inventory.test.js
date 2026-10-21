import { describe, it, expect } from 'vitest';
import {
  stockStatus, statusOf, inventoryStats, alertProducts, filterProducts,
  sortProducts, mergeImport, categoriesOf, activeProducts, archivedMatches, kitStockMatches,
  locationTotals,
} from '../src/lib/inventory.js';

const p = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  name: 'Widget', sku: '', category: '', quantity: 10,
  locationId: null, supplierId: null, cost: 2, price: null,
  lowStock: null, notes: '', ...over,
});

describe('stockStatus', () => {
  it('is out at zero, regardless of threshold', () => {
    expect(stockStatus(p({ quantity: 0 }))).toBe('out');
    expect(stockStatus(p({ quantity: 0, lowStock: 0 }))).toBe('out');
  });

  it('is low at or below the per-product threshold', () => {
    expect(stockStatus(p({ quantity: 3, lowStock: 3 }))).toBe('low');
    expect(stockStatus(p({ quantity: 4, lowStock: 3 }))).toBe('ok');
  });

  it('falls back to the default threshold when the product has none', () => {
    expect(stockStatus(p({ quantity: 5 }), 5)).toBe('low');
    expect(stockStatus(p({ quantity: 6 }), 5)).toBe('ok');
  });

  it('a threshold of 0 disables the low warning', () => {
    expect(stockStatus(p({ quantity: 1, lowStock: 0 }))).toBe('ok');
  });
});

describe('inventoryStats', () => {
  it('totals units and value at cost, and counts alerts', () => {
    const stats = inventoryStats([
      p({ quantity: 10, cost: 1.5 }),
      p({ quantity: 0, cost: 99 }),
      p({ quantity: 2, cost: 0.1, lowStock: 5 }),
    ]);
    expect(stats).toEqual({ products: 3, units: 12, measured: 0, value: 15.2, low: 1, out: 1 });
  });

  it('is all zeroes for an empty inventory', () => {
    expect(inventoryStats([])).toEqual({ products: 0, units: 0, measured: 0, value: 0, low: 0, out: 0 });
  });
});

describe('alertProducts', () => {
  it('puts out-of-stock first, then lowest quantity', () => {
    const a = p({ id: 'a', quantity: 3, lowStock: 5 });
    const b = p({ id: 'b', quantity: 0 });
    const c = p({ id: 'c', quantity: 1, lowStock: 5 });
    const d = p({ id: 'd', quantity: 100 });
    expect(alertProducts([a, b, c, d]).map((x) => x.product.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('filterProducts', () => {
  const items = [
    p({ id: '1', name: 'Café Grinder', sku: 'CG-01', category: 'Kitchen', quantity: 50 }),
    p({ id: '2', name: 'USB Cable', sku: 'CB-77', category: 'Cables', quantity: 2, lowStock: 5, locationId: 'L1', supplierId: 'S1' }),
    p({ id: '3', name: 'Monitor', sku: 'MN-27', category: 'Displays', quantity: 0 }),
  ];

  it('matches name, SKU, and category, ignoring case and accents', () => {
    expect(filterProducts(items, { query: 'cafe' })).toHaveLength(1);
    expect(filterProducts(items, { query: 'cb-77' })).toHaveLength(1);
    expect(filterProducts(items, { query: 'display' })).toHaveLength(1);
  });

  it('filters by status, including the combined alerts filter', () => {
    expect(filterProducts(items, { status: 'low' }).map((x) => x.id)).toEqual(['2']);
    expect(filterProducts(items, { status: 'out' }).map((x) => x.id)).toEqual(['3']);
    expect(filterProducts(items, { status: 'alerts' }).map((x) => x.id)).toEqual(['2', '3']);
  });

  it('filters by location and supplier ids', () => {
    expect(filterProducts(items, { locationId: 'L1' }).map((x) => x.id)).toEqual(['2']);
    expect(filterProducts(items, { supplierId: 'S1' }).map((x) => x.id)).toEqual(['2']);
  });

  it('combines query and status', () => {
    expect(filterProducts(items, { query: 'cable', status: 'low' })).toHaveLength(1);
    expect(filterProducts(items, { query: 'grinder', status: 'low' })).toHaveLength(0);
  });

  it('passes everything with no filters', () => {
    expect(filterProducts(items, {})).toHaveLength(3);
  });
});

describe('locationTotals', () => {
  it('counts what the location filter shows: stocked here, or homed here and out everywhere', () => {
    const products = [
      p({ quantity: 5, stock: { A: 5 }, locationId: 'A' }),
      p({ quantity: 0, stock: {}, locationId: 'A' }),        // out of stock, homed at A
      p({ quantity: 3, stock: { B: 3 }, locationId: 'B' }),
      p({ quantity: 0, stock: {}, locationId: 'A', archived: true }),
    ];
    const totals = locationTotals(products, 'A');
    expect(totals.products).toBe(2); // the out-of-stock one is findable via the card's link
    expect(totals.units).toBe(5);    // but only real stock adds up
    expect(totals.value).toBe(10);
  });

  it('does not claim an out-of-stock product homed elsewhere', () => {
    const products = [p({ quantity: 0, stock: {}, locationId: 'B' })];
    expect(locationTotals(products, 'A').products).toBe(0);
  });
});

describe('statusOf', () => {
  const bean = p({ id: 'bean', name: 'Beans', quantity: 100 });
  const kit = (over = {}) => p({
    id: 'kit', name: 'Breakfast set', quantity: 0,
    kit: 'sell', components: [{ productId: 'bean', qty: 2 }], ...over,
  });

  it('judges a sell-as-kit on what its components allow', () => {
    const items = [bean, kit()];
    expect(stockStatus(kit())).toBe('out'); // it holds none, by design
    expect(statusOf(kit(), items)).toBe('ok');
  });

  it('reports a sell-as-kit as out once its components run out', () => {
    const items = [p({ id: 'bean', name: 'Beans', quantity: 0 }), kit()];
    expect(statusOf(kit(), items)).toBe('out');
  });

  it('leaves an ordinary product to plain stockStatus', () => {
    const plain = p({ quantity: 2, lowStock: 5 });
    expect(statusOf(plain, [plain])).toBe('low');
  });

  it('is the rule the status filter uses, so badge and chip agree', () => {
    const items = [bean, kit()];
    // A kit its components can cover belongs under neither alert chip.
    expect(filterProducts(items, { status: 'out' }).map((x) => x.id)).toEqual([]);
    expect(filterProducts(items, { status: 'alerts' }).map((x) => x.id)).toEqual([]);
    // And it does show up once the parts are gone.
    const empty = [p({ id: 'bean', name: 'Beans', quantity: 0 }), kit()];
    expect(filterProducts(empty, { status: 'out' }).map((x) => x.id)).toEqual(['bean', 'kit']);
  });
});

describe('sortProducts', () => {
  it('sorts by the requested key and direction without mutating input', () => {
    const items = [p({ name: 'B', quantity: 2 }), p({ name: 'A', quantity: 9 })];
    const byQty = sortProducts(items, 'quantity', -1);
    expect(byQty.map((x) => x.quantity)).toEqual([9, 2]);
    expect(items.map((x) => x.name)).toEqual(['B', 'A']);
  });

  it('breaks ties by name', () => {
    const items = [p({ name: 'Zeta', quantity: 5 }), p({ name: 'Alpha', quantity: 5 })];
    expect(sortProducts(items, 'quantity', 1).map((x) => x.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('does not throw on a row with no name', () => {
    const items = [p({ name: 'Alpha' }), { id: 'x', quantity: 1 }];
    expect(() => sortProducts(items, 'name', 1)).not.toThrow();
    expect(sortProducts(items, 'value', 1)).toHaveLength(2);
  });

  it('sorts by days of cover from the caller\'s map, unknowns last', () => {
    const items = [
      p({ id: 'slow', name: 'Slow' }),
      p({ id: 'fast', name: 'Fast' }),
      p({ id: 'quiet', name: 'Quiet' }),
      p({ id: 'hush', name: 'Hush' }),
    ];
    const cover = new Map([['slow', 20], ['fast', 2], ['quiet', null]]);
    expect(sortProducts(items, 'cover', 1, { cover }).map((x) => x.id))
      .toEqual(['fast', 'slow', 'hush', 'quiet']);
    // Reversed, the known ones flip; the pair with no data at all still
    // has a stable order rather than a random one.
    expect(sortProducts(items, 'cover', -1, { cover }).slice(-2).map((x) => x.id))
      .toEqual(['slow', 'fast']);
  });
});

describe('the running-out filter', () => {
  const items = [p({ id: 'a', name: 'Fast' }), p({ id: 'b', name: 'Slow' })];

  it('passes only the ids the caller worked out from the log', () => {
    const rows = filterProducts(items, { status: 'cover', runningOut: new Set(['a']) });
    expect(rows.map((x) => x.id)).toEqual(['a']);
  });

  it('shows nothing rather than everything when the caller knows nothing', () => {
    expect(filterProducts(items, { status: 'cover' })).toEqual([]);
    expect(filterProducts(items, { status: 'cover', runningOut: new Set() })).toEqual([]);
  });
});

describe('categoriesOf', () => {
  it('returns distinct sorted names, skipping empties', () => {
    const items = [p({ category: 'B' }), p({ category: 'A' }), p({ category: 'B' }), p({ category: '' })];
    expect(categoriesOf(items)).toEqual(['A', 'B']);
  });
});

describe('mergeImport', () => {
  const existing = [
    p({ id: 'e1', name: 'Mouse', sku: 'WM-1', quantity: 10, cost: 5 }),
    p({ id: 'e2', name: 'Keyboard', sku: 'KB-2', quantity: 4 }),
  ];
  const draft = (over = {}) => ({
    name: 'Mouse v2', sku: 'WM-1', category: '', quantity: 3, cost: 6,
    price: null, lowStock: null, notes: '', locationName: '', supplierName: '', ...over,
  });

  it('creates drafts whose SKU is unknown or empty', () => {
    const r = mergeImport(existing, [draft({ sku: 'NEW-9' }), draft({ sku: '' })]);
    expect(r.created).toHaveLength(2);
    expect(r.updated).toHaveLength(0);
  });

  it('matches SKUs case-insensitively and updates in update mode', () => {
    const r = mergeImport(existing, [draft({ sku: 'wm-1' })], 'update');
    expect(r.created).toHaveLength(0);
    expect(r.updated).toHaveLength(1);
    expect(r.updated[0]).toMatchObject({ id: 'e1', name: 'Mouse v2', quantity: 3, cost: 6 });
  });

  it('adds quantities in add mode and keeps existing fields when the draft is blank', () => {
    const r = mergeImport(existing, [draft({ name: '', cost: 0, quantity: 3 })], 'add');
    expect(r.updated[0]).toMatchObject({ id: 'e1', name: 'Mouse', quantity: 13, cost: 5 });
  });

  it('collapses duplicate SKUs within one file in add mode', () => {
    const r = mergeImport(existing, [draft({ quantity: 3 }), draft({ quantity: 2 })], 'add');
    expect(r.updated).toHaveLength(1);
    expect(r.updated[0].quantity).toBe(15);
  });

  it('counts matches as skipped in skip mode and leaves them untouched', () => {
    const r = mergeImport(existing, [draft(), draft({ sku: 'NEW-9' })], 'skip');
    expect(r.skipped).toBe(1);
    expect(r.created).toHaveLength(1);
    expect(r.updated).toHaveLength(0);
    expect(existing[0].name).toBe('Mouse');
  });

  it('does not mutate the existing products', () => {
    mergeImport(existing, [draft()], 'update');
    expect(existing[0]).toMatchObject({ name: 'Mouse', quantity: 10, cost: 5 });
  });

  /* A price list has no Quantity or Cost column; updating from one must
     not read as "everything is now zero". */
  it('leaves fields the file never mentioned alone in update mode', () => {
    const priceRow = {
      name: 'Mouse', sku: 'WM-1', price: 29.99, locationName: '', supplierName: '',
      quantity: undefined, cost: undefined, category: undefined,
      notes: undefined, barcode: undefined, lowStock: undefined, archived: undefined,
    };
    const r = mergeImport(existing, [priceRow], 'update');
    expect(r.updated[0]).toMatchObject({ id: 'e1', quantity: 10, cost: 5, price: 29.99 });
    expect(r.updated[0].stockByName).toBeUndefined();
    expect(r.updated[0].category).toBe('');
  });

  it('still clears a field whose column is present but empty', () => {
    const r = mergeImport(existing, [draft({ category: '', price: null })], 'update');
    expect(r.updated[0]).toMatchObject({ category: '', price: null });
  });
});

describe('archived products', () => {
  const set = [
    p({ id: 'a', name: 'Live', quantity: 4, cost: 2 }),
    p({ id: 'b', name: 'Retired', quantity: 100, cost: 5, archived: true }),
    p({ id: 'c', name: 'Empty', quantity: 0, cost: 1 }),
  ];

  it('are left out of the active set, totals, and alerts', () => {
    expect(activeProducts(set).map((x) => x.id)).toEqual(['a', 'c']);
    const stats = inventoryStats(set, 5);
    expect(stats).toMatchObject({ products: 2, units: 4, value: 8, low: 1, out: 1 });
    expect(alertProducts(set, 5).map((x) => x.product.id)).toEqual(['c', 'a']);
  });

  it('are hidden from the list until asked for', () => {
    expect(filterProducts(set, {}).map((x) => x.id)).toEqual(['a', 'c']);
    expect(filterProducts(set, { status: 'archived' }).map((x) => x.id)).toEqual(['b']);
    expect(filterProducts(set, { archived: 'only' }).map((x) => x.id)).toEqual(['b']);
    expect(filterProducts(set, { archived: 'all' }).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('still honor the other filters while archived-only', () => {
    const mixed = [
      p({ id: 'x', name: 'Old mug', category: 'Kitchen', archived: true }),
      p({ id: 'y', name: 'Old pan', category: 'Kitchen', archived: true }),
      p({ id: 'z', name: 'Old mug', category: 'Decor', archived: true }),
    ];
    expect(filterProducts(mixed, { status: 'archived', query: 'mug' }).map((x) => x.id)).toEqual(['x', 'z']);
    expect(filterProducts(mixed, { status: 'archived', category: 'Kitchen' }).map((x) => x.id)).toEqual(['x', 'y']);
  });
});

describe('mergeImport and the archived flag', () => {
  const existing = [{ id: '1', sku: 'A-1', name: 'Retired', quantity: 2, archived: true }];
  const draft = (over = {}) => ({ name: 'Retired', sku: 'A-1', quantity: 5, cost: 1, price: null, lowStock: null, notes: '', category: '', archived: null, ...over });

  it('never un-archives on add, even when the file says active', () => {
    const { updated } = mergeImport(existing, [draft({ archived: false })], 'add');
    expect(updated[0]).toMatchObject({ quantity: 7, archived: true });
  });

  it('archives on add when the file asks for it', () => {
    const active = [{ id: '2', sku: 'B-1', name: 'Live', quantity: 1 }];
    const { updated } = mergeImport(active, [draft({ sku: 'B-1', archived: true })], 'add');
    expect(updated[0].archived).toBe(true);
  });

  it('restores on update when the file says the product is active', () => {
    const { updated } = mergeImport(existing, [draft({ archived: false })], 'update');
    expect(updated[0].archived).toBe(false);
  });

  it('leaves the flag alone when the file has no Archived column', () => {
    const { updated } = mergeImport(existing, [draft()], 'update');
    expect(updated[0].archived).toBe(true);
  });

  it('counts drafts landing on archived products, ignoring unknown SKUs', () => {
    expect(archivedMatches(existing, [draft(), draft({ sku: 'a-1' }), draft({ sku: 'ZZ' })])).toBe(1);
    expect(archivedMatches(existing, [draft({ sku: '' })])).toBe(0);
  });

  it('counts drafts giving stock to a product sold as a kit', () => {
    const kit = p({ sku: 'KIT-1', kit: 'sell', components: [{ productId: 'x', qty: 1 }] });
    const built = p({ sku: 'KIT-2', kit: 'build', components: [{ productId: 'x', qty: 1 }] });
    const list = [kit, built, p({ sku: 'A-1' })];
    expect(kitStockMatches(list, [draft({ sku: 'kit-1', quantity: 5 }), draft({ sku: 'KIT-2', quantity: 5 }), draft({ sku: 'A-1' })])).toBe(1);
    // A breakdown is stock too; a row stating no quantity at all isn't.
    expect(kitStockMatches(list, [draft({ sku: 'KIT-1', quantity: undefined, stock: [{ name: 'Main', qty: 2 }] })])).toBe(1);
    expect(kitStockMatches(list, [draft({ sku: 'KIT-1', quantity: undefined })])).toBe(0);
    expect(kitStockMatches([], [draft({ sku: 'KIT-1', quantity: 5 })])).toBe(0);
  });
});
