/**
 * Store tests run against a Map-backed fake of the Puter SDK, exercising
 * the same persistence paths the app uses.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const kvData = new Map();

globalThis.puter = {
  env: 'web',
  auth: {
    isSignedIn: () => true,
    getUser: async () => ({ username: 'tester' }),
  },
  kv: {
    list: async (prefix) => [...kvData.keys()].filter((k) => k.startsWith(prefix.replace(/\*$/, ''))),
    get: async (k) => (kvData.has(k) ? kvData.get(k) : null),
    set: async (k, v) => { kvData.set(k, JSON.parse(JSON.stringify(v))); return true; },
    del: async (k) => { kvData.delete(k); return true; },
  },
};

const { store, DEFAULT_SETTINGS } = await import('../src/lib/store.js');
const { totalStock } = await import('../src/lib/stock.js');
const { __resetMemoryState } = await import('../src/lib/offline.js');

beforeEach(async () => {
  kvData.clear();
  await store.init();
});

describe('init', () => {
  it('seeds defaults on a fresh account', () => {
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.products).toEqual([]);
    expect(store.user.username).toBe('tester');
  });

  it('reads persisted state back', async () => {
    await store.addProduct({ name: 'Mouse', sku: 'WM-1', quantity: 5 });
    await store.updateSettings({ currency: 'EUR' });

    await store.init(); // simulate a fresh boot on the same account
    expect(store.products).toHaveLength(1);
    expect(store.products[0].name).toBe('Mouse');
    expect(store.settings.currency).toBe('EUR');
  });

  it('rolls a settings change back when it cannot be saved', async () => {
    const set = puter.kv.set;
    puter.kv.set = async () => { throw new Error('offline'); };
    try {
      await expect(store.updateSettings({ currency: 'JPY' })).rejects.toThrow();
    } finally {
      puter.kv.set = set;
    }
    expect(store.settings.currency).toBe(DEFAULT_SETTINGS.currency);
  });
});

describe('products', () => {
  it('normalizes fields on add', async () => {
    const p = await store.addProduct({ name: '  Mouse ', quantity: -3, cost: '2.5', price: '', lowStock: '' });
    expect(p).toMatchObject({ name: 'Mouse', quantity: 0, cost: 2.5, price: null, lowStock: null });
    expect(kvData.get('inv:products:v2')).toHaveLength(1);
  });

  it('logs creation and deletion to the activity feed', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 5 });
    await store.deleteProduct(p.id);
    expect(store.activity.map((a) => a.kind)).toEqual(['delete', 'create']);
    expect(store.products).toEqual([]);
  });

  it('detects duplicate SKUs case-insensitively, excluding self', async () => {
    const p = await store.addProduct({ name: 'Mouse', sku: 'WM-1' });
    expect(store.skuTaken('wm-1')).toBe(true);
    expect(store.skuTaken('wm-1', p.id)).toBe(false);
    expect(store.skuTaken('other')).toBe(false);
    expect(store.skuTaken('')).toBe(false);
  });
});

describe('productByCode', () => {
  it('prefers a barcode match, then falls back to the SKU', async () => {
    const scanned = await store.addProduct({ name: 'Mouse', sku: 'WM-1', barcode: '5901234123457' });
    const other = await store.addProduct({ name: 'Pad', sku: '5901234123457' });
    // The code is one product's barcode and another's SKU: the barcode wins.
    expect(store.productByCode('5901234123457').id).toBe(scanned.id);
    expect(store.productByCode('wm-1').id).toBe(scanned.id);
    expect(store.productByCode(' WM-1 ').id).toBe(scanned.id);
    expect(other.id).not.toBe(scanned.id);
  });

  it('is empty-safe and misses cleanly', async () => {
    await store.addProduct({ name: 'Mouse', sku: '', barcode: '' });
    expect(store.productByCode('')).toBeNull();
    expect(store.productByCode(null)).toBeNull();
    expect(store.productByCode('nope')).toBeNull();
  });
});

describe('adjustStock', () => {
  it('applies deltas, clamps at zero, and logs each change', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 5 });
    await store.adjustStock(p.id, { delta: 3 });
    expect(store.productById(p.id).quantity).toBe(8);
    await store.adjustStock(p.id, { delta: -100, note: 'shrinkage' });
    expect(store.productById(p.id).quantity).toBe(0);

    const [remove, add] = store.activity;
    expect(add).toMatchObject({ kind: 'add', delta: 3, quantity: 8 });
    expect(remove).toMatchObject({ kind: 'remove', delta: -8, quantity: 0, note: 'shrinkage' });
  });

  it('recounts to an absolute value', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 5 });
    await store.adjustStock(p.id, { set: 12 });
    expect(store.productById(p.id).quantity).toBe(12);
    expect(store.activity[0]).toMatchObject({ kind: 'recount', delta: 7, quantity: 12 });
  });

  it('folds a receipt cost into the product cost as a moving average', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 10, cost: 2 });
    await store.adjustStock(p.id, { delta: 5, cost: 5 });
    // (10 × 2 + 5 × 5) / 15
    expect(store.productById(p.id).cost).toBe(3);
    expect(store.activity[0]).toMatchObject({ kind: 'add', delta: 5, cost: 5 });
  });

  it('takes the receipt cost outright when nothing was on hand', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 0, cost: 2 });
    await store.adjustStock(p.id, { delta: 4, cost: 3.5 });
    expect(store.productById(p.id).cost).toBe(3.5);
  });

  it('leaves cost untouched without a receipt cost, and ignores it on removals', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 10, cost: 2 });
    await store.adjustStock(p.id, { delta: 5 });
    expect(store.productById(p.id).cost).toBe(2);
    expect(store.activity[0].cost).toBeUndefined();

    await store.adjustStock(p.id, { delta: -3, cost: 9 });
    expect(store.productById(p.id).cost).toBe(2);
    expect(store.activity[0].cost).toBeUndefined();

    // Junk never becomes a valuation.
    await store.adjustStock(p.id, { delta: 1, cost: 'free' });
    expect(store.productById(p.id).cost).toBe(2);
  });

  it('records what a removal sold for, with the cost frozen at that moment', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 10, cost: 2 });
    await store.adjustStock(p.id, { delta: -3, reason: 'sold', price: 7.5 });
    expect(store.activity[0]).toMatchObject({ kind: 'remove', delta: -3, reason: 'sold', price: 7.5, cost: 2 });
    // A later receipt moves the average, but the sale keeps its own cost.
    await store.adjustStock(p.id, { delta: 7, cost: 10 });
    expect(store.productById(p.id).cost).toBe(6);
    expect(store.activity.find((a) => a.kind === 'remove').cost).toBe(2);
  });

  it('records a giveaway at zero, and never a price on an add or recount', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 10, cost: 2 });
    await store.adjustStock(p.id, { delta: -1, reason: 'sold', price: 0 });
    expect(store.activity[0]).toMatchObject({ price: 0, cost: 2 });

    await store.adjustStock(p.id, { delta: 4, price: 9 });
    expect(store.activity[0].price).toBeUndefined();
    await store.adjustStock(p.id, { set: 3, price: 9 });
    expect(store.activity[0].price).toBeUndefined();
  });

  it('leaves a removal exactly as it was without a price, and ignores junk', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 10, cost: 2 });
    await store.adjustStock(p.id, { delta: -2, reason: 'sold' });
    expect(store.activity[0].price).toBeUndefined();
    expect(store.activity[0].cost).toBeUndefined();

    await store.adjustStock(p.id, { delta: -2, reason: 'sold', price: 'free' });
    expect(store.activity[0].price).toBeUndefined();
    await store.adjustStock(p.id, { delta: -2, reason: 'sold', price: -4 });
    expect(store.activity[0].price).toBeUndefined();
  });

  it('averages over the whole product, not one location bucket', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Mouse', quantity: 8, cost: 1, locationId: main.id });
    // Receiving 2 at another location still averages against all 8 on hand.
    await store.adjustStock(p.id, { delta: 2, cost: 6, locationId: shop.id });
    expect(store.productById(p.id).cost).toBe(2); // (8×1 + 2×6) / 10
  });

  it('keeps a removal reason on remove entries only, and only known ones', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 10 });
    await store.adjustStock(p.id, { delta: -2, reason: 'damaged' });
    expect(store.activity[0]).toMatchObject({ kind: 'remove', reason: 'damaged' });

    // A reason on an add is a caller mistake, not data.
    await store.adjustStock(p.id, { delta: 3, reason: 'sold' });
    expect(store.activity[0].kind).toBe('add');
    expect(store.activity[0].reason).toBeUndefined();

    // Unknown reasons are dropped rather than stored.
    await store.adjustStock(p.id, { delta: -1, reason: 'gremlins' });
    expect(store.activity[0].kind).toBe('remove');
    expect(store.activity[0].reason).toBeUndefined();
  });

  it('is a no-op when nothing changes', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 5 });
    await store.adjustStock(p.id, { delta: 0 });
    expect(store.activity).toHaveLength(1); // only the create entry
  });
});

describe('locations and suppliers', () => {
  it('unassigns products when their location is deleted', async () => {
    const loc = await store.addLocation({ name: 'Shelf A' });
    const p = await store.addProduct({ name: 'Mouse', locationId: loc.id });
    await store.deleteLocation(loc.id);
    expect(store.locations).toEqual([]);
    expect(store.productById(p.id).locationId).toBeNull();
    // and the unassignment was persisted, not just in memory
    expect(kvData.get('inv:products:v2')[0].locationId).toBeNull();
  });

  it('unassigns products when their supplier is deleted', async () => {
    const sup = await store.addSupplier({ name: 'Apex' });
    const p = await store.addProduct({ name: 'Mouse', supplierId: sup.id });
    await store.deleteSupplier(sup.id);
    expect(store.productById(p.id).supplierId).toBeNull();
  });

  it('takes a deleted supplier off every product source list', async () => {
    const gone = await store.addSupplier({ name: 'Apex' });
    const kept = await store.addSupplier({ name: 'Nordic' });
    const p = await store.addProduct({
      name: 'Mouse',
      sources: [
        { supplierId: gone.id, code: 'A-1', price: 3, preferred: true },
        { supplierId: kept.id, code: 'N-1', price: 4 },
      ],
    });
    expect(p.supplierId).toBe(gone.id);

    await store.deleteSupplier(gone.id);
    const after = store.productById(p.id);
    // The survivor becomes the default, and supplierId follows it — a
    // list still naming the deleted one grouped Reorder under a
    // supplier record that no longer exists.
    expect(after.sources.map((s) => s.supplierId)).toEqual([kept.id]);
    expect(after.sources[0]).toMatchObject({ code: 'N-1', price: 4, preferred: true });
    expect(after.supplierId).toBe(kept.id);
    expect(kvData.get('inv:products:v2')[0].supplierId).toBe(kept.id);
  });

  it('leaves a product with no supplier when its only source is deleted', async () => {
    const sup = await store.addSupplier({ name: 'Apex' });
    const p = await store.addProduct({
      name: 'Mouse',
      sources: [{ supplierId: sup.id, code: 'A-1', price: 3, preferred: true }],
    });
    await store.deleteSupplier(sup.id);
    const after = store.productById(p.id);
    expect(after.supplierId).toBeNull();
    expect(after.sources).toBeUndefined();
  });

  it('normalizes lead time and minimum order on add', async () => {
    const sup = await store.addSupplier({ name: 'Apex', leadTimeDays: 5.4, minOrder: 99.999 });
    expect(sup).toMatchObject({ leadTimeDays: 5, minOrder: 100 });
    const bare = await store.addSupplier({ name: 'Loose', leadTimeDays: 0, minOrder: -3 });
    expect(bare).toMatchObject({ leadTimeDays: null, minOrder: null });
  });
});

describe('applyImport', () => {
  const draft = (over = {}) => ({
    name: 'Mouse', sku: 'WM-1', category: 'Peripherals', quantity: 5, cost: 2,
    price: null, lowStock: null, notes: '', locationName: '', supplierName: '', ...over,
  });

  it('creates products and auto-creates named locations and suppliers', async () => {
    const res = await store.applyImport([draft({ locationName: 'Main', supplierName: 'Apex' })]);
    expect(res).toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(store.locations.map((l) => l.name)).toEqual(['Main']);
    expect(store.suppliers.map((s) => s.name)).toEqual(['Apex']);
    expect(store.products[0]).toMatchObject({
      locationId: store.locations[0].id,
      supplierId: store.suppliers[0].id,
    });
  });

  it('never puts a file’s quantity on a product sold as a kit', async () => {
    const cup = await store.addProduct({ name: 'Cup', quantity: 40, cost: 0.2 });
    const kit = await store.addProduct({
      name: 'Pen set', sku: 'PS-1', price: 12, cost: 3, kit: 'sell',
      components: [{ productId: cup.id, qty: 2 }],
    });
    await store.applyImport([draft({ name: 'Pen set', sku: 'PS-1', quantity: 25, category: 'Sets' })], 'update');
    let after = store.productById(kit.id);
    // The rest of the row still lands; the number that has nowhere to go doesn't.
    expect(after).toMatchObject({ quantity: 0, stock: {}, category: 'Sets', kit: 'sell' });
    await store.applyImport([draft({ sku: 'PS-1', quantity: 5, stock: [{ name: 'Main', qty: 5 }] })], 'add');
    after = store.productById(kit.id);
    expect(after.quantity).toBe(0);
    expect(totalStock(after)).toBe(0);
    await store.init();
    expect(store.productById(kit.id).quantity).toBe(0);
  });

  it('reuses locations by name, case-insensitively', async () => {
    await store.addLocation({ name: 'Main' });
    await store.applyImport([draft({ locationName: 'MAIN' })]);
    expect(store.locations).toHaveLength(1);
    expect(store.products[0].locationId).toBe(store.locations[0].id);
  });

  it('updates matched products without leaking draft-only fields', async () => {
    await store.applyImport([draft()]);
    await store.applyImport([draft({ name: 'Mouse v2', quantity: 9 })], 'update');
    expect(store.products).toHaveLength(1);
    expect(store.products[0]).toMatchObject({ name: 'Mouse v2', quantity: 9 });
    expect('locationName' in store.products[0]).toBe(false);
    expect('supplierName' in store.products[0]).toBe(false);
  });

  it('adds to stock in add mode', async () => {
    await store.applyImport([draft({ quantity: 5 })]);
    const res = await store.applyImport([draft({ quantity: 3 })], 'add');
    expect(res.updated).toBe(1);
    expect(store.products[0].quantity).toBe(8);
  });

  it('lands supplier lead time and minimum on the supplier record, never the product', async () => {
    await store.applyImport([draft({ supplierName: 'Apex', supplierLeadTime: 5, supplierMinOrder: 100 })]);
    expect(store.suppliers[0]).toMatchObject({ name: 'Apex', leadTimeDays: 5, minOrder: 100 });
    expect('supplierLeadTime' in store.products[0]).toBe(false);
    expect('supplierMinOrder' in store.products[0]).toBe(false);

    // An update row can refresh the details; a row that says nothing leaves them.
    await store.applyImport([draft({ supplierName: 'Apex', supplierLeadTime: 7 })], 'update');
    expect(store.suppliers[0]).toMatchObject({ leadTimeDays: 7, minOrder: 100 });
    expect('supplierLeadTime' in store.products[0]).toBe(false);
  });

  it('imports a reorder quantity onto the product', async () => {
    await store.applyImport([draft({ reorderQty: 40 })]);
    expect(store.products[0].reorderQty).toBe(40);
  });

  /* A file with no Quantity column says nothing about stock; importing it
     must not empty every shelf. */
  it('keeps per-location stock when the file has no quantity column', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Mouse', sku: 'WM-1', quantity: 6, cost: 4, locationId: main.id });
    await store.adjustStock(p.id, { delta: 2, locationId: shop.id });

    await store.applyImport([{
      name: 'Mouse', sku: 'WM-1', price: 19.99, locationName: '', supplierName: '',
      quantity: undefined, cost: undefined, category: undefined,
      notes: undefined, barcode: undefined, lowStock: undefined, archived: undefined,
    }], 'update');

    const saved = store.productById(p.id);
    expect(saved.stock).toEqual({ [main.id]: 6, [shop.id]: 2 });
    expect(saved.quantity).toBe(8);
    expect(saved.cost).toBe(4);
    expect(saved.price).toBe(19.99);
  });
});

describe('per-location stock', () => {
  const setup = async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Mouse', quantity: 10, locationId: main.id });
    return { main, shop, p };
  };

  it('puts opening stock in the product’s own location', async () => {
    const { main, p } = await setup();
    expect(store.productById(p.id).stock).toEqual({ [main.id]: 10 });
    expect(store.productById(p.id).quantity).toBe(10);
  });

  it('adjusts one bucket at a time and keeps the total in step', async () => {
    const { main, shop, p } = await setup();
    await store.adjustStock(p.id, { delta: 4, locationId: shop.id });
    const after = store.productById(p.id);
    expect(after.stock).toEqual({ [main.id]: 10, [shop.id]: 4 });
    expect(after.quantity).toBe(14);
    expect(store.activity[0]).toMatchObject({ kind: 'add', delta: 4, quantity: 14, locationName: 'Shop' });
  });

  it('defaults to the product’s location when none is named', async () => {
    const { main, p } = await setup();
    await store.adjustStock(p.id, { delta: -3 });
    expect(store.productById(p.id).stock).toEqual({ [main.id]: 7 });
  });

  it('drops a bucket that empties, rather than leaving a zero', async () => {
    const { p } = await setup();
    await store.adjustStock(p.id, { set: 0 });
    expect(store.productById(p.id).stock).toEqual({});
    expect(store.productById(p.id).quantity).toBe(0);
  });

  it('moves stock between locations without changing the total', async () => {
    const { main, shop, p } = await setup();
    await store.transferStock(p.id, { from: main.id, to: shop.id, qty: 4, note: 'restock' });
    const after = store.productById(p.id);
    expect(after.stock).toEqual({ [main.id]: 6, [shop.id]: 4 });
    expect(after.quantity).toBe(10);
    expect(store.activity[0]).toMatchObject({
      kind: 'move', moved: 4, quantity: 10, locationName: 'Main', toLocationName: 'Shop', note: 'restock',
    });
  });

  it('moves only what is actually there, and refuses an empty move', async () => {
    const { main, shop, p } = await setup();
    await store.transferStock(p.id, { from: main.id, to: shop.id, qty: 999 });
    expect(store.productById(p.id).stock).toEqual({ [shop.id]: 10 });
    await expect(store.transferStock(p.id, { from: main.id, to: shop.id, qty: 5 })).rejects.toThrow();
    // Same place at both ends is a no-op, not an error.
    await store.transferStock(p.id, { from: shop.id, to: shop.id, qty: 5 });
    expect(store.productById(p.id).stock).toEqual({ [shop.id]: 10 });
  });

  it('carries a single-location product’s stock when its home changes', async () => {
    const { main, shop, p } = await setup();
    await store.updateProduct(p.id, { locationId: shop.id });
    expect(store.productById(p.id).stock).toEqual({ [shop.id]: 10 });

    // Split stock is left alone: that needs a deliberate move.
    await store.adjustStock(p.id, { delta: 5, locationId: main.id });
    await store.updateProduct(p.id, { locationId: main.id });
    expect(store.productById(p.id).stock).toEqual({ [shop.id]: 10, [main.id]: 5 });
  });

  it('logs the move an edited home location performs, and saves the log', async () => {
    const { main, shop, p } = await setup();
    await store.updateProduct(p.id, { locationId: shop.id });
    expect(store.activity[0]).toMatchObject({
      kind: 'move', productId: p.id, moved: 10, quantity: 10,
      locationId: main.id, locationName: 'Main',
      toLocationId: shop.id, toLocationName: 'Shop',
    });
    // The entry has to survive a reload, not just live in this tab.
    expect(kvData.get('inv:activity:v1')[0].kind).toBe('move');

    // An edit that moves nothing writes nothing.
    const before = store.activity.length;
    await store.updateProduct(p.id, { name: 'Renamed' });
    expect(store.activity.length).toBe(before);
  });

  it('logs a bulk relocation per product, under its summary', async () => {
    const { main, shop, p } = await setup();
    await store.bulkUpdateProducts([p.id], { locationId: shop.id }, { summary: 'location → Shop' });
    expect(store.activity[0]).toMatchObject({ kind: 'bulk', note: 'location → Shop' });
    expect(store.activity[1]).toMatchObject({
      kind: 'move', productId: p.id, moved: 10,
      locationId: main.id, toLocationId: shop.id,
    });
  });

  it('keeps stock from a deleted location, unassigned', async () => {
    const { main, p } = await setup();
    await store.deleteLocation(main.id);
    const after = store.productById(p.id);
    expect(after.locationId).toBeNull();
    expect(after.stock).toEqual({ '': 10 });
    expect(after.quantity).toBe(10);
  });

  it('logs the forced move when a deleted location held stock', async () => {
    const { main, p } = await setup();
    await store.deleteLocation(main.id);
    const entry = store.activity[0];
    expect(entry).toMatchObject({
      kind: 'move', productId: p.id, moved: 10, quantity: 10,
      locationName: 'Main', toLocationName: 'No location',
    });
    expect(entry.note).toMatch(/deleted/);
    // An empty location deletes without writing a phantom move.
    const spare = await store.addLocation({ name: 'Spare' });
    const before = store.activity.length;
    await store.deleteLocation(spare.id);
    expect(store.activity.length).toBe(before);
  });

  it('migrates a v1 account on first read', async () => {
    kvData.clear();
    kvData.set('inv:locations:v1', [{ id: 'loc1', name: 'Main' }]);
    kvData.set('inv:products:v1', [
      { id: 'p1', name: 'Mouse', quantity: 7, locationId: 'loc1' },
      { id: 'p2', name: 'Pad', quantity: 3, locationId: null },
      { id: 'p3', name: 'Empty', quantity: 0, locationId: 'loc1' },
    ]);
    await store.init();
    expect(store.products.map((p) => p.stock)).toEqual([{ loc1: 7 }, { '': 3 }, {}]);
    // and the upgrade was written back under the new key
    expect(kvData.get('inv:products:v2')).toHaveLength(3);
    expect(kvData.get('inv:products:v1')).toHaveLength(3); // left alone
  });
});

describe('units of measure', () => {
  it('keeps counted stock whole and measured stock at three decimals', async () => {
    const items = await store.addProduct({ name: 'Mice', quantity: 2.6 });
    expect(items.quantity).toBe(3);
    const beans = await store.addProduct({ name: 'Beans', unit: 'KG', quantity: '2.5678' });
    expect(beans).toMatchObject({ unit: 'kg', quantity: 2.568 });

    await store.adjustStock(beans.id, { delta: 0.4321 });
    expect(store.productById(beans.id).quantity).toBe(3);
    await store.adjustStock(items.id, { delta: 1.6 });
    expect(store.productById(items.id).quantity).toBe(5);
  });

  it('records the unit on each log entry so history reads right later', async () => {
    const p = await store.addProduct({ name: 'Beans', unit: 'kg', quantity: 1 });
    await store.adjustStock(p.id, { delta: 0.5 });
    expect(store.activity[0]).toMatchObject({ kind: 'add', unit: 'kg', delta: 0.5, quantity: 1.5 });
    expect(store.activity[1]).toMatchObject({ kind: 'create', unit: 'kg' });
  });

  it('normalizes pack size and name', async () => {
    const p = await store.addProduct({ name: 'Pens', packSize: '12', packName: '  box ' });
    expect(p).toMatchObject({ packSize: 12, packName: 'box' });
    const plain = await store.addProduct({ name: 'Mugs' });
    expect(plain).toMatchObject({ unit: 'each', packSize: 0, packName: '' });
  });

  /* The buckets are the truth, so re-measuring has to round them, not
     just the cached total — which a reload recomputes from them anyway. */
  it('re-rounds every bucket when the unit changes', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Beans', unit: 'kg', quantity: 2.5, locationId: main.id });
    await store.adjustStock(p.id, { delta: 1.25, locationId: shop.id });
    expect(store.productById(p.id).quantity).toBe(3.75);

    await store.updateProduct(p.id, { unit: 'each' });
    const counted = store.productById(p.id);
    expect(counted.stock).toEqual({ [main.id]: 3, [shop.id]: 1 });
    expect(counted.quantity).toBe(4);
    expect(counted.quantity).toBe(totalStock(counted));
  });

  it.each([2.4, 2.6])('keeps dated lots aligned when a CSV unit edit rounds %s units', async (qty) => {
    const p = await store.addProduct({ name: 'Beans', sku: 'BN-1', unit: 'kg', trackExpiry: true });
    await store.adjustStock(p.id, { delta: qty, expiryDate: '2027-01-01' });
    await store.applyImport([{ sku: 'BN-1', unit: 'each' }]);
    await store.init();

    const { lotsTotal, lotsAt } = await import('../src/lib/lots.js');
    const counted = store.productById(p.id);
    expect(counted.quantity).toBe(Math.round(qty));
    expect(lotsTotal(lotsAt(counted, ''))).toBe(counted.quantity);
    expect(lotsAt(counted, '')[0].date).toBe('2027-01-01');

    await store.adjustStock(p.id, { delta: -counted.quantity, reason: 'sold' });
    expect(store.productById(p.id).quantity).toBe(0);
    expect(lotsAt(store.productById(p.id), '')).toEqual([]);
    await store.adjustStock(p.id, { delta: 1, expiryDate: '2027-02-01' });
    expect(lotsAt(store.productById(p.id), '')).toEqual([{ date: '2027-02-01', qty: 1 }]);
  });

  it('re-rounds stock when an import re-measures a product', async () => {
    const p = await store.addProduct({ name: 'Beans', sku: 'BN-1', unit: 'kg', quantity: 2.5 });
    await store.applyImport([{
      name: 'Beans', sku: 'BN-1', unit: 'each', locationName: '', supplierName: '',
      quantity: undefined, cost: undefined, category: undefined,
      notes: undefined, barcode: undefined, lowStock: undefined, archived: undefined,
    }], 'update');
    const counted = store.productById(p.id);
    expect(counted.quantity).toBe(3);
    expect(counted.quantity).toBe(totalStock(counted));
  });
});

describe('archiving', () => {
  it('keeps the product but takes it out of the alerts, and logs both ways', async () => {
    const p = await store.addProduct({ name: 'Candles', quantity: 0, lowStock: 3 });
    await store.setArchived(p.id, true);
    expect(store.productById(p.id).archived).toBe(true);
    expect(store.activity[0]).toMatchObject({ kind: 'archive', name: 'Candles' });
    expect(kvData.get('inv:products:v2')[0].archived).toBe(true);

    await store.setArchived(p.id, false);
    expect(store.productById(p.id).archived).toBe(false);
    expect(store.activity[0].kind).toBe('restore');
  });

  it('is a no-op when the flag already matches', async () => {
    const p = await store.addProduct({ name: 'Candles' });
    await store.setArchived(p.id, false);
    expect(store.activity).toHaveLength(1);
    await expect(store.setArchived('nope', true)).rejects.toThrow();
  });

  it('keeps the SKU reserved, and names the holder for the form', async () => {
    const p = await store.addProduct({ name: 'Candles', sku: 'CN-1' });
    await store.setArchived(p.id, true);
    expect(store.skuTaken('cn-1')).toBe(true);
    expect(store.productBySku('CN-1')).toMatchObject({ id: p.id, archived: true });
    expect(store.productBySku('CN-1', p.id)).toBeNull();
    expect(store.productBySku('')).toBeNull();
  });
});

describe('undoDelete', () => {
  it.each(['delete', 'transfer'])('retracts an archived %s entry and removes an emptied archive from the manifest', async (operation) => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 4 });
    const token = operation === 'delete'
      ? await store.deleteProduct(p.id)
      : await store.transferMany([{ productId: p.id, from: '', to: 'shelf', qty: 2 }]);
    const entries = store.activity.filter((a) => token.activityIds.includes(a.id));
    const { monthKey } = await import('../src/lib/activity.js');
    const month = monthKey(entries[0].at);
    // A persisted month can outlive the live log and its in-memory cache.
    await store.importAll({ products: store.products, archives: { [month]: entries } });
    await store.init();
    if (operation === 'delete') await store.undoDelete(token);
    else await store.undoTransfers(token);
    await store.init();
    expect(store.productById(p.id).stock).toEqual({ '': 4 });
    expect(store.activity).toEqual([]);
    expect(store.archives).toEqual([]);
    expect(await store.loadArchive(month)).toEqual([]);
  });

  it('puts the product back in place and retracts the delete entry', async () => {
    await store.addProduct({ name: 'First' });
    const p = await store.addProduct({ name: 'Second' });
    await store.addProduct({ name: 'Third' });
    const order = () => store.products.map((x) => x.name);
    const before = order();

    const token = await store.deleteProduct(p.id);
    expect(store.activity[0].kind).toBe('delete');

    await store.undoDelete(token);
    expect(order()).toEqual(before);
    expect(store.activity.some((a) => a.kind === 'delete')).toBe(false);
    expect(kvData.get('inv:products:v2').map((x) => x.name)).toEqual(before);
  });

  it('is a no-op for a missing product or a second undo', async () => {
    const p = await store.addProduct({ name: 'Mouse' });
    const token = await store.deleteProduct(p.id);
    await store.undoDelete(token);
    await store.undoDelete(token);
    expect(store.products).toHaveLength(1);
    expect(await store.deleteProduct('nope')).toBeNull();
    await store.undoDelete(null);
  });
});

describe('activity archiving', () => {
  const churn = async (id, times) => {
    for (let i = 0; i < times; i++) await store.adjustStock(id, { delta: i % 2 ? -1 : 1 });
  };

  it('keeps the live log small and rolls the rest into month buckets', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 1000 });
    await churn(p.id, 450);

    expect(store.activity.length).toBeLessThanOrEqual(400);
    const month = Object.keys(Object.fromEntries(
      [...kvData.keys()].filter((k) => k.startsWith('inv:activity:v1:')).map((k) => [k, 1])
    ))[0];
    expect(month).toBeDefined();

    const archived = kvData.get(month);
    expect(archived.length).toBe(451 - store.activity.length); // 450 adjustments + create
    // Archived entries are older than everything still live.
    expect(archived[0].at).toBeLessThanOrEqual(store.activity.at(-1).at);
    expect(store.archives[0]).toMatchObject({ count: archived.length });
  });

  it('does not lose entries when two flushes overlap', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 1000 });
    await churn(p.id, 399); // live log exactly at the cap

    // Answer bucket reads with the value as of the request, delivered
    // late — the slow network under which unserialized flushes would
    // each merge into the same stale base and the second write erase
    // the first.
    const get = puter.kv.get;
    puter.kv.get = async (k) => {
      const value = await get(k);
      if (k.startsWith('inv:activity:v1:')) await new Promise((r) => setTimeout(r, 5));
      return value;
    };
    try {
      await Promise.all([
        store.adjustStock(p.id, { delta: 1 }),
        store.adjustStock(p.id, { delta: -1 }),
      ]);
    } finally {
      puter.kv.get = get;
    }

    const month = store.archives[0].month;
    const archived = kvData.get(`inv:activity:v1:${month}`);
    // create + 399 churns + 2 concurrent adjustments, split between the
    // live log and the bucket with nothing lost.
    expect(archived.length + store.activity.length).toBe(402);
  });

  it('keeps trimmed entries in the persisted log until they are archived', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 1000 });
    await churn(p.id, 399); // at the cap

    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k.startsWith('inv:activity:v1:')) throw new Error('offline');
      return set(k, v);
    };
    try {
      await store.adjustStock(p.id, { delta: 1 });
    } finally {
      puter.kv.set = set;
    }
    // The bucket write failed: the trimmed entry must survive a reload,
    // so it stays in the persisted log alongside the live 400.
    expect(store.activity).toHaveLength(400);
    expect(kvData.get('inv:activity:v1')).toHaveLength(401);

    // The next mutation retries the flush and everything lands.
    await store.adjustStock(p.id, { delta: -1 });
    expect(kvData.get('inv:activity:v1')).toHaveLength(400);
    expect(kvData.get(`inv:activity:v1:${store.archives[0].month}`)).toHaveLength(2);
  });

  it('never rewrites a bucket it could not read', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 1000 });
    await churn(p.id, 420); // bucket exists on the "server"
    const month = store.archives[0].month;
    const key = `inv:activity:v1:${month}`;
    const before = kvData.get(key).length;

    // A different browser: no offline mirror of the bucket, fresh boot.
    __resetMemoryState();
    await store.init();

    const get = puter.kv.get;
    puter.kv.get = async (k) => {
      if (k.startsWith('inv:activity:v1:')) throw new TypeError('network down');
      return get(k);
    };
    try {
      await store.adjustStock(p.id, { delta: 1 }); // trims one entry, flush runs
    } finally {
      puter.kv.get = get;
    }
    // The flush couldn't read its base: the server bucket must be
    // untouched, not overwritten with only the freshly trimmed entries.
    expect(kvData.get(key)).toHaveLength(before);

    // Connection back: the next mutation retries and merges properly.
    await store.adjustStock(p.id, { delta: -1 });
    expect(kvData.get(key).length).toBe(before + 2);
  });

  it('a wipe waits for an in-flight archive flush instead of racing it', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 1000 });
    await churn(p.id, 399); // live log exactly at the cap

    // The next trim's bucket write is slow — a flush in flight while
    // the user reaches Settings and erases everything.
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k.startsWith('inv:activity:v1:')) await new Promise((r) => setTimeout(r, 10));
      return set(k, v);
    };
    try {
      const mutation = store.adjustStock(p.id, { delta: 1 });
      await new Promise((r) => setTimeout(r, 0)); // flush reaches the wire
      await store.wipeAll({ snapshot: false });
      await mutation;
    } finally {
      puter.kv.set = set;
    }

    // Nothing of the pre-wipe history may survive the wipe.
    expect(store.archives).toEqual([]);
    expect([...kvData.keys()].filter((k) => k.startsWith('inv:activity:v1:'))).toEqual([]);
  });

  it('exposes archived months for the history view, cached after the first read', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 1000 });
    await churn(p.id, 420);
    const month = store.archives[0].month;
    const rows = await store.loadArchive(month);
    expect(rows.length).toBeGreaterThan(0);
    expect(await store.loadArchive(month)).toBe(rows);
    expect(Object.keys(await store.loadAllArchives())).toEqual([month]);
  });

  it('carries archives through a backup and drops them on wipe', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 1000 });
    await churn(p.id, 420);
    const month = store.archives[0].month;

    await store.wipeAll();
    expect(store.archives).toEqual([]);
    expect(kvData.has(`inv:activity:v1:${month}`)).toBe(false);

    const data = await store.readSnapshot(store.latestSnapshot().id);
    expect(Object.keys(data.archives || {})).toEqual([month]);
    await store.restoreBackup(data);
    expect(store.archives[0].month).toBe(month);
    expect((await store.loadArchive(month)).length).toBeGreaterThan(0);
  });
});

describe('kits and bundles', () => {
  const cafe = async () => {
    const beans = await store.addProduct({ name: 'Coffee beans', unit: 'kg', quantity: 2, cost: 20 });
    const cup = await store.addProduct({ name: 'Cup', quantity: 40, cost: 0.2 });
    return { beans, cup };
  };

  it('keeps a recipe and its mode, and refuses a kit made of kits', async () => {
    const { beans, cup } = await cafe();
    const set = await store.addProduct({
      name: 'Breakfast set', kit: 'sell', price: 4,
      components: [{ productId: beans.id, qty: 0.02 }, { productId: cup.id, qty: 1 }],
    });
    expect(set.kit).toBe('sell');
    expect(set.components).toEqual([{ productId: beans.id, qty: 0.02 }, { productId: cup.id, qty: 1 }]);

    // One level deep, both ways round.
    const outer = await store.addProduct({ name: 'Hamper', kit: 'build', components: [{ productId: set.id, qty: 1 }] });
    expect(outer.kit).toBeUndefined();
    const before = structuredClone(cup);
    await expect(store.updateProduct(cup.id, { name: 'Invalid kit', kit: 'build', components: [{ productId: beans.id, qty: 1 }] }))
      .rejects.toThrow(/component of another kit/);
    expect(cup).toEqual(before);
    // An unrelated successful save must not persist the rejected edit.
    await store.adjustStock(beans.id, { delta: 1 });
    await store.init();
    expect(store.productById(cup.id)).toEqual(before);
  });

  it('empties a sell-as-kit’s own stock: its availability is its parts’', async () => {
    const { cup } = await cafe();
    const p = await store.addProduct({ name: 'Three-pack', quantity: 9 });
    await store.updateProduct(p.id, { kit: 'sell', components: [{ productId: cup.id, qty: 3 }] });
    expect(store.productById(p.id).quantity).toBe(0);
  });

  it('logs the stock a sell-as-kit conversion takes off the books', async () => {
    const { cup } = await cafe();
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Three-pack', quantity: 9, locationId: main.id });
    await store.transferStock(p.id, { from: main.id, to: shop.id, qty: 4 });
    const before = store.activity.length;
    await store.updateProduct(p.id, { kit: 'sell', components: [{ productId: cup.id, qty: 3 }] });
    expect(store.productById(p.id).quantity).toBe(0);
    // One recount to zero per shelf that held some, so the history
    // reconciles: the last entry no longer says "9 on hand" over a
    // product showing none.
    const written = store.activity.slice(0, store.activity.length - before);
    expect(written.map((a) => [a.kind, a.delta, a.quantity, a.locationName]).sort()).toEqual([
      ['recount', -4, 0, 'Shop'],
      ['recount', -5, 0, 'Main'],
    ].sort());
    expect(written.every((a) => a.productId === p.id && /sold as a kit/i.test(a.note))).toBe(true);
    expect(kvData.get('inv:activity:v1')).toHaveLength(store.activity.length);
    // Saving a sell-as-kit again, or a build kit, writes off nothing.
    const again = store.activity.length;
    await store.updateProduct(p.id, { kit: 'sell', components: [{ productId: cup.id, qty: 4 }] });
    await store.updateProduct(cup.id, { name: 'Cup', lowStock: 2 });
    expect(store.activity.length).toBe(again);
  });

  it('never gives a new sell-as-kit opening stock or expiry lots', async () => {
    const { cup } = await cafe();
    const kit = await store.addProduct({
      name: 'Three-pack', quantity: 9, trackExpiry: true, kit: 'sell',
      components: [{ productId: cup.id, qty: 3 }],
    });
    expect(kit.quantity).toBe(0);
    expect(totalStock(kit)).toBe(0);
    expect(Object.values(kit.lots || {}).flat()).toEqual([]);
    expect(store.activity[0]).toMatchObject({ kind: 'create', quantity: 0 });
    await store.init();
    expect(store.productById(kit.id).quantity).toBe(0);
    expect(store.productById(cup.id).quantity).toBe(40);
  });

  it('sells a kit by taking its components out, under one reference', async () => {
    const { beans, cup } = await cafe();
    const set = await store.addProduct({
      name: 'Breakfast set', kit: 'sell', price: 4,
      components: [{ productId: beans.id, qty: 0.02 }, { productId: cup.id, qty: 1 }],
    });
    await store.adjustStock(set.id, { delta: -2, reason: 'sold', price: 4 });

    expect(store.productById(beans.id).quantity).toBe(1.96);
    expect(store.productById(cup.id).quantity).toBe(38);
    expect(store.productById(set.id).quantity).toBe(0);
    const removals = store.activity.filter((a) => a.kind === 'remove');
    expect(removals).toHaveLength(3);
    // The kit's own entry carries the money; the parts carry the units.
    const kitEntry = removals.find((a) => a.productId === set.id);
    expect(kitEntry).toMatchObject({ delta: -2, price: 4, cost: 0.6, reason: 'sold' });
    expect(removals.filter((a) => a.note.includes('Breakfast set × 2'))).toHaveLength(2);
  });

  it('sells a kit out of wherever its parts actually sit', async () => {
    // Homed at the warehouse, but every unit is on the shop floor: a
    // sale that only looked in the product's own bucket took nothing
    // out and logged the sale anyway.
    const shop = await store.addLocation({ name: 'Shop' });
    const warehouse = await store.addLocation({ name: 'Warehouse' });
    const cup = await store.addProduct({ name: 'Cup', quantity: 0, cost: 0.2, locationId: warehouse.id });
    await store.adjustStock(cup.id, { delta: 20, locationId: shop.id });
    const set = await store.addProduct({
      name: 'Breakfast set', kit: 'sell', price: 4,
      components: [{ productId: cup.id, qty: 2 }],
    });

    await store.adjustStock(set.id, { delta: -3, reason: 'sold', price: 4 });

    expect(store.productById(cup.id).quantity).toBe(14);
    expect(store.productById(cup.id).stock[shop.id]).toBe(14);
    const removal = store.activity.find((a) => a.kind === 'remove' && a.productId === cup.id);
    expect(removal).toMatchObject({ delta: -6, locationId: shop.id, locationName: 'Shop' });
  });

  it('builds a kit from its parts, costing it at what they cost', async () => {
    const { beans, cup } = await cafe();
    const kit = await store.addProduct({
      name: 'Brew kit', kit: 'build', quantity: 0,
      components: [{ productId: beans.id, qty: 0.5 }, { productId: cup.id, qty: 2 }],
    });
    await store.buildKit(kit.id, { qty: 3 });

    expect(store.productById(kit.id).quantity).toBe(3);
    // 0.5kg × £20 + 2 × £0.20 = £10.40 each
    expect(store.productById(kit.id).cost).toBe(10.4);
    expect(store.productById(beans.id).quantity).toBe(0.5);
    expect(store.productById(cup.id).quantity).toBe(34);
    expect(store.activity[0]).toMatchObject({ kind: 'add', productId: kit.id, delta: 3, cost: 10.4 });
    expect(store.activity.filter((a) => a.kind === 'remove' && a.reason === 'internal')).toHaveLength(2);
  });

  it('refuses to build more than the parts allow', async () => {
    const { beans, cup } = await cafe();
    const kit = await store.addProduct({
      name: 'Brew kit', kit: 'build', quantity: 0,
      components: [{ productId: beans.id, qty: 0.5 }, { productId: cup.id, qty: 2 }],
    });
    await expect(store.buildKit(kit.id, { qty: 5 })).rejects.toThrow(/Not enough/);
    expect(store.productById(beans.id).quantity).toBe(2);
    // And a product that isn't a build kit can't be built at all.
    await expect(store.buildKit(cup.id, { qty: 1 })).rejects.toThrow();
  });

  it('refuses a build with a deleted component without consuming the remaining parts', async () => {
    const { beans, cup } = await cafe();
    const kit = await store.addProduct({
      name: 'Brew kit', kit: 'build',
      components: [{ productId: beans.id, qty: 0.5 }, { productId: cup.id, qty: 2 }],
    });
    const deleted = await store.deleteProduct(cup.id);
    const before = JSON.stringify({ products: store.products, activity: store.activity });

    await expect(store.buildKit(kit.id, { qty: 1 })).rejects.toThrow(/missing|deleted/i);
    expect(JSON.stringify({ products: store.products, activity: store.activity })).toBe(before);

    await store.undoDelete(deleted);
    await store.buildKit(kit.id, { qty: 1 });
    await store.init();
    expect(store.productById(kit.id)).toMatchObject({ quantity: 1, cost: 10.4 });
    expect(store.productById(beans.id).quantity).toBe(1.5);
    expect(store.productById(cup.id).quantity).toBe(38);
  });

  it('keeps kits out of the alerts and the reorder list', async () => {
    const { beans, cup } = await cafe();
    const set = await store.addProduct({
      name: 'Breakfast set', kit: 'sell', lowStock: 5,
      components: [{ productId: cup.id, qty: 1 }],
    });
    const { alertProducts } = await import('../src/lib/inventory.js');
    const { reorderGroups } = await import('../src/lib/reorder.js');
    expect(alertProducts(store.products, 5).some((x) => x.product.id === set.id)).toBe(false);
    const lines = reorderGroups(store.products, { defaultLow: 5 }).flatMap((g) => g.lines);
    expect(lines.some((l) => l.product.id === set.id)).toBe(false);
    expect(beans.id).toBeTruthy();
  });
});

describe('kept counts', () => {
  it('keeps a record of a committed count, and clears the session', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const a = await store.addProduct({ name: 'Mouse', sku: 'WM-1', quantity: 10, cost: 2, locationId: main.id });
    const b = await store.addProduct({ name: 'Pad', quantity: 4, cost: 1, locationId: main.id });
    await store.startStocktake({ locationId: main.id });
    await store.setStocktakeCount(a.id, 7);
    await store.setStocktakeCount(b.id, 4);
    const session = store.stocktake;
    await store.applyStocktake();

    expect(store.stocktakes).toHaveLength(1);
    const record = store.stocktakeRecord(session.id);
    expect(record).toMatchObject({
      total: 2, counted: 2, skipped: 0, matched: 1, varied: 1, adjusted: 1,
      unitsShort: 3, unitsOver: 0, value: -6,
    });
    expect(record.lines[0]).toMatchObject({ name: 'Mouse', expected: 10, counted: 7, delta: -3, value: -6 });
    expect(kvData.get('inv:stocktakes:v1')).toHaveLength(1);
    // The variance is valued at what the stock cost when it was counted,
    // whatever happens to the product afterwards.
    await store.updateProduct(a.id, { cost: 99 });
    expect(store.stocktakes[0].lines[0].value).toBe(-6);
  });

  it('carries kept counts through a backup, and drops them on a wipe', async () => {
    const p = await store.addProduct({ name: 'Mouse', quantity: 10, cost: 2 });
    await store.startStocktake({});
    await store.setStocktakeCount(p.id, 8);
    await store.applyStocktake();
    const snapshot = await store.saveSnapshot('erase');

    await store.wipeAll({ snapshot: false });
    expect(store.stocktakes).toEqual([]);
    expect(kvData.get('inv:stocktakes:v1')).toEqual([]);

    await store.importAll(await store.readSnapshot(snapshot.id));
    expect(store.stocktakes).toHaveLength(1);
    expect(store.stocktakes[0].value).toBe(-4);
  });
});

describe('variant families', () => {
  const shirt = async () => {
    const sup = await store.addSupplier({ name: 'Apex' });
    const main = await store.addLocation({ name: 'Main' });
    const p = await store.addProduct({
      name: 'Cotton Shirt', sku: 'SH-1', category: 'Clothing', quantity: 4,
      cost: 5, price: 20, lowStock: 3, supplierId: sup.id, locationId: main.id,
    });
    return { p, sup, main };
  };

  it('turns a product into the first variant, keeping its id and stock', async () => {
    const { p, sup } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    expect(family).toMatchObject({ name: 'Cotton Shirt', axes: ['Size'], category: 'Clothing', price: 20, supplierId: sup.id });
    const kept = store.productById(p.id);
    expect(kept).toMatchObject({ id: p.id, quantity: 4, familyId: family.id, name: 'Cotton Shirt: M' });
    expect(kept.axes).toEqual({ Size: 'M' });
    expect(kvData.get('inv:families:v1')).toHaveLength(1);
    // One family at a time per product.
    await expect(store.createFamily(p.id, { axes: ['Colour'] })).rejects.toThrow();
    await expect(store.createFamily((await store.addProduct({ name: 'Loose' })).id, { axes: [] })).rejects.toThrow();
  });

  it('seeds a new variant from the shared half', async () => {
    const { p, sup } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    const large = await store.addVariant(family.id, { values: { Size: 'L' }, sku: 'SH-L', cost: 6, quantity: 2 });
    expect(large).toMatchObject({
      name: 'Cotton Shirt: L', sku: 'SH-L', category: 'Clothing',
      price: 20, lowStock: 3, supplierId: sup.id, cost: 6, quantity: 2, familyId: family.id,
    });
    expect(store.variantsOf(family.id).map((v) => v.name)).toEqual(['Cotton Shirt: L', 'Cotton Shirt: M']);
  });

  it('writes a new variant into its family in one products write', async () => {
    const { p } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    const writes = [];
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => { writes.push([k, JSON.parse(JSON.stringify(v))]); return set(k, v); };
    let large;
    try {
      large = await store.addVariant(family.id, { values: { Size: 'L' } });
    } finally {
      puter.kv.set = set;
    }
    const products = writes.filter(([k]) => k === 'inv:products:v2');
    expect(products).toHaveLength(1);
    // Never persisted, even for a moment, as a loose product.
    expect(products[0][1].find((x) => x.id === large.id)).toMatchObject({ familyId: family.id, axes: { Size: 'L' } });
    // A family the id doesn't name is not a family: the product is loose.
    const loose = await store.addProduct({ name: 'Odd', familyId: 'nope', axes: { Size: 'S' } });
    expect(loose.familyId).toBeUndefined();
    expect(loose.axes).toBeUndefined();
  });

  it('writes a family edit to every variant, in one entry', async () => {
    const { p } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    await store.addVariant(family.id, { values: { Size: 'L' } });
    const before = store.activity.length;
    await store.updateFamily(family.id, { name: 'Linen Shirt', category: 'Shirts', price: 25 });
    const variants = store.variantsOf(family.id);
    expect(variants.map((v) => v.name)).toEqual(['Linen Shirt: L', 'Linen Shirt: M']);
    expect(variants.every((v) => v.category === 'Shirts' && v.price === 25)).toBe(true);
    expect(store.activity.length).toBe(before + 1);
  });

  it('drops an axis from every variant’s name when the family drops it', async () => {
    const { p } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size', 'Colour'], values: { Size: 'M', Colour: 'Navy' } });
    expect(store.productById(p.id).name).toBe('Cotton Shirt: M / Navy');
    await store.updateFamily(family.id, { axes: ['Size'] });
    expect(store.productById(p.id).name).toBe('Cotton Shirt: M');
    expect(store.productById(p.id).axes).toEqual({ Size: 'M' });
  });

  it('keeps every variant’s values and name when an axis is renamed', async () => {
    const { p } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size', 'Colour'], values: { Size: 'M', Colour: 'Navy' } });
    const large = await store.addVariant(family.id, { values: { Size: 'L', Colour: 'Navy' }, sku: 'SH-L' });
    await store.updateFamily(family.id, { axes: ['Size', 'Color'] });
    expect(store.productById(p.id)).toMatchObject({ name: 'Cotton Shirt: M / Navy', axes: { Size: 'M', Color: 'Navy' } });
    expect(store.productById(large.id)).toMatchObject({ name: 'Cotton Shirt: L / Navy', axes: { Size: 'L', Color: 'Navy' } });
    // Fixing the case of a name is a rename too.
    await store.updateFamily(family.id, { axes: ['size', 'Color'] });
    expect(store.productById(p.id).axes).toEqual({ size: 'M', Color: 'Navy' });
    expect(store.productById(p.id).name).toBe('Cotton Shirt: M / Navy');
    await store.init();
    expect(store.productById(large.id).name).toBe('Cotton Shirt: L / Navy');
  });

  it('renames one variant when its own axis values change', async () => {
    const { p } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    await store.setVariantAxes(p.id, { Size: 'XL' });
    expect(store.productById(p.id).name).toBe('Cotton Shirt: XL');
    await expect(store.setVariantAxes('nope', { Size: 'S' })).rejects.toThrow();
  });

  it('splits a family up without touching its products', async () => {
    const { p } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    await store.addVariant(family.id, { values: { Size: 'L' }, quantity: 7 });
    expect(await store.dissolveFamily(family.id)).toBe(2);
    expect(store.families).toEqual([]);
    const loose = store.products.filter((x) => x.name.startsWith('Cotton Shirt'));
    expect(loose).toHaveLength(2);
    expect(loose.every((x) => x.familyId === undefined && x.axes === undefined)).toBe(true);
    expect(store.productById(p.id).quantity).toBe(4);
  });

  it('sweeps families with no variants left at boot, not on delete', async () => {
    const { p } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    const token = await store.deleteProduct(p.id);
    // Still there, because undo has to find it.
    expect(store.familyById(family.id)).toBeTruthy();
    await store.undoDelete(token);
    expect(store.productById(p.id).familyId).toBe(family.id);

    await store.deleteProduct(p.id);
    await store.init();
    expect(store.families).toEqual([]);
    expect(kvData.get('inv:families:v1')).toEqual([]);
  });

  it('carries families through a backup and clears them on a wipe', async () => {
    const { p } = await shirt();
    const family = await store.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    const snapshot = await store.saveSnapshot('erase');
    await store.wipeAll({ snapshot: false });
    expect(store.families).toEqual([]);

    const data = await store.readSnapshot(snapshot.id);
    await store.importAll(data);
    expect(store.families.map((f) => f.id)).toEqual([family.id]);
    expect(store.productById(p.id).familyId).toBe(family.id);
  });
});

describe('supplier sources', () => {
  const two = async () => {
    const apex = await store.addSupplier({ name: 'Apex', leadTimeDays: 5 });
    const brt = await store.addSupplier({ name: 'Brightline', leadTimeDays: 2 });
    return { apex, brt };
  };

  it('keeps supplierId pointing at the preferred source', async () => {
    const { apex, brt } = await two();
    const p = await store.addProduct({
      name: 'Mouse',
      supplierId: apex.id,
      sources: [
        { supplierId: apex.id, code: 'APX-1', price: 4 },
        { supplierId: brt.id, code: 'BRT-9', price: 3.5, preferred: true },
      ],
    });
    expect(p.supplierId).toBe(brt.id);
    expect(p.sources.map((s) => s.preferred)).toEqual([false, true]);

    await store.updateProduct(p.id, {
      sources: [{ supplierId: apex.id, code: 'APX-1', price: 4, preferred: true }, { supplierId: brt.id, price: 3.5 }],
    });
    expect(store.productById(p.id).supplierId).toBe(apex.id);
  });

  it('moves the source list when a bulk edit moves the supplier', async () => {
    const { apex, brt } = await two();
    const p = await store.addProduct({
      name: 'Mouse',
      sources: [
        { supplierId: apex.id, code: 'APX-1', price: 4, preferred: true },
        { supplierId: brt.id, code: 'BRT-9', price: 3.5 },
      ],
    });
    // Re-assigning the supplier without restating the list used to leave
    // the row naming one place and every order going to another.
    await store.bulkUpdateProducts([p.id], { supplierId: brt.id });
    const moved = store.productById(p.id);
    expect(moved.supplierId).toBe(brt.id);
    expect(moved.sources.find((x) => x.preferred).supplierId).toBe(brt.id);
    // The other source keeps its code and price; nothing is thrown away.
    expect(moved.sources.find((x) => x.supplierId === apex.id)).toMatchObject({ code: 'APX-1', price: 4 });

    // A supplier that isn't on the list yet joins it rather than
    // replacing what's there.
    const third = await store.addSupplier({ name: 'Nordic' });
    await store.bulkUpdateProducts([p.id], { supplierId: third.id });
    const again = store.productById(p.id);
    expect(again.supplierId).toBe(third.id);
    expect(again.sources).toHaveLength(3);
    expect(again.sources.find((x) => x.preferred).supplierId).toBe(third.id);
  });

  it('clears explicit sources when a bulk edit selects no supplier', async () => {
    const { apex, brt } = await two();
    const p = await store.addProduct({ name: 'Mouse', sources: [
      { supplierId: apex.id, code: 'APX-1', price: 4, preferred: true },
      { supplierId: brt.id, price: 3 },
    ] });
    await store.bulkUpdateProducts([p.id], { supplierId: null });
    await store.init();

    const { sourcesOf, supplierPriceList } = await import('../src/lib/sources.js');
    const { reorderGroups } = await import('../src/lib/reorder.js');
    expect(sourcesOf(store.productById(p.id))).toEqual([]);
    expect(supplierPriceList(store.products, apex.id)).toEqual([]);
    expect(supplierPriceList(store.products, brt.id)).toEqual([]);
    expect(reorderGroups(store.products)[0].supplierId).toBeNull();

    await store.updateProduct(p.id, { supplierId: brt.id });
    expect(sourcesOf(store.productById(p.id))).toMatchObject([{ supplierId: brt.id, preferred: true }]);
  });

  it('leaves a single bare source implicit — supplierId already says it', async () => {
    const { apex } = await two();
    const p = await store.addProduct({ name: 'Mouse', sources: [{ supplierId: apex.id }] });
    expect(p.supplierId).toBe(apex.id);
    expect(p.sources).toBeUndefined();
    // One source that carries a code or a price is worth keeping.
    await store.updateProduct(p.id, { sources: [{ supplierId: apex.id, code: 'APX-1' }] });
    expect(store.productById(p.id).sources).toHaveLength(1);
    // And clearing the list drops it again.
    await store.updateProduct(p.id, { sources: [] });
    expect(store.productById(p.id).sources).toBeUndefined();
  });

  it('freezes the supplier\u2019s own code and price onto the order lines', async () => {
    const { apex, brt } = await two();
    const p = await store.addProduct({
      name: 'Mouse',
      quantity: 0,
      cost: 4,
      sources: [
        { supplierId: apex.id, code: 'APX-1', price: 4, preferred: true },
        { supplierId: brt.id, code: 'BRT-9', price: 3 },
      ],
    });
    const order = await store.placeOrder({ supplierId: brt.id, lines: [{ productId: p.id, qty: 10 }] });
    expect(order.lines[0]).toMatchObject({ code: 'BRT-9', price: 3 });

    // Receiving values the delivery at what was agreed, feeding the
    // moving average.
    await store.receiveOrder(order.id);
    expect(store.productById(p.id).cost).toBe(3);
    expect(store.activity[0]).toMatchObject({ kind: 'add', delta: 10, cost: 3 });
  });

  it('lets a receipt state a different cost, and a cleared one revalue nothing', async () => {
    const { apex } = await two();
    const p = await store.addProduct({ name: 'Mouse', quantity: 10, cost: 2, sources: [{ supplierId: apex.id, price: 5 }] });
    const order = await store.placeOrder({ supplierId: apex.id, lines: [{ productId: p.id, qty: 10 }] });
    await store.receiveOrderLines(order.id, [{ productId: p.id, qty: 10, cost: 4 }]);
    // (10 × 2 + 10 × 4) / 20
    expect(store.productById(p.id).cost).toBe(3);

    const second = await store.placeOrder({ supplierId: apex.id, lines: [{ productId: p.id, qty: 5 }] });
    await store.receiveOrderLines(second.id, [{ productId: p.id, qty: 5, cost: null }]);
    expect(store.productById(p.id).cost).toBe(3);
    expect(store.activity[0].cost).toBeUndefined();
  });

  it('re-rounds a source pack size when the unit changes', async () => {
    const { apex } = await two();
    const p = await store.addProduct({
      name: 'Rope', unit: 'm',
      sources: [{ supplierId: apex.id, price: 2, packSize: 2.5 }],
    });
    expect(p.sources[0].packSize).toBe(2.5);
    await store.updateProduct(p.id, { unit: 'each', sources: p.sources });
    expect(store.productById(p.id).sources[0].packSize).toBe(3);
  });
});

describe('per-location minimums', () => {
  it('normalizes what the form states, and treats absence as no minimum', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const p = await store.addProduct({ name: 'Mouse', quantity: 4, locationId: main.id, min: { [main.id]: 2.6, ghost: 0 } });
    // Rounded for a counted unit; a zero is not a minimum.
    expect(p.min).toEqual({ [main.id]: 3 });

    await store.updateProduct(p.id, { min: {} });
    expect(store.productById(p.id).min).toBeUndefined();
    expect(kvData.get('inv:products:v2')[0].min).toBeUndefined();
  });

  it('re-rounds minimums when the unit changes', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const p = await store.addProduct({ name: 'Rope', unit: 'm', quantity: 10, locationId: main.id, min: { [main.id]: 2.5 } });
    expect(p.min).toEqual({ [main.id]: 2.5 });
    await store.updateProduct(p.id, { unit: 'each' });
    // A counted product can't be judged against 2.5 items.
    expect(store.productById(p.id).min).toEqual({ [main.id]: 3 });
  });

  it('drops a minimum for a location that is deleted', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Mouse', quantity: 4, locationId: shop.id, min: { [main.id]: 5, [shop.id]: 2 } });
    await store.deleteLocation(main.id);
    expect(store.productById(p.id).min).toEqual({ [shop.id]: 2 });
  });
});

describe('shelf and bin codes', () => {
  it('keeps trimmed codes per place, and drops the map when it says nothing', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const p = await store.addProduct({ name: 'Mouse', quantity: 4, locationId: main.id, bin: { [main.id]: '  A3-12 ', ghost: '  ' } });
    expect(p.bin).toEqual({ [main.id]: 'A3-12' });
    await store.updateProduct(p.id, { bin: {} });
    expect(store.productById(p.id).bin).toBeUndefined();
  });

  it('drops a code for a location that is deleted', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Mouse', quantity: 4, locationId: shop.id, bin: { [main.id]: 'A1', [shop.id]: 'B2' } });
    await store.deleteLocation(main.id);
    expect(store.productById(p.id).bin).toEqual({ [shop.id]: 'B2' });
  });

  it('freezes the code onto a count sheet and can order the sheet by it', async () => {
    const main = await store.addLocation({ name: 'Main' });
    await store.addProduct({ name: 'Zeta', quantity: 2, locationId: main.id, bin: { [main.id]: 'A2' } });
    await store.addProduct({ name: 'Alpha', quantity: 2, locationId: main.id, bin: { [main.id]: 'A10' } });
    const session = await store.startStocktake({ locationId: main.id, sortBy: 'bin' });
    expect(session.sortBy).toBe('bin');
    expect(session.rows.map((r) => r.bin).sort()).toEqual(['A10', 'A2']);
    await store.setStocktakeSort('name');
    expect(kvData.get('inv:counts:v1').sortBy).toBe('name');
  });

  it('imports codes by column and by breakdown', async () => {
    const main = await store.addLocation({ name: 'Main' });
    await store.addProduct({ name: 'Mouse', sku: 'WM-1', quantity: 1, locationId: main.id });
    await store.applyImport([{
      name: 'Mouse', sku: 'WM-1', bin: 'C4',
      quantity: undefined, cost: undefined, category: undefined, price: undefined,
      lowStock: undefined, notes: undefined, locationName: '', supplierName: '',
    }], 'update');
    expect(store.products.find((p) => p.sku === 'WM-1').bin).toEqual({ [main.id]: 'C4' });

    await store.applyImport([{
      name: 'Mouse', sku: 'WM-1', bins: [{ name: 'Main', code: 'D1' }, { name: 'Annex', code: 'E2' }],
      quantity: undefined, cost: undefined, category: undefined, price: undefined,
      lowStock: undefined, notes: undefined, locationName: '', supplierName: '',
    }], 'update');
    const annex = store.locations.find((l) => l.name === 'Annex');
    expect(store.products.find((p) => p.sku === 'WM-1').bin).toEqual({ [main.id]: 'D1', [annex.id]: 'E2' });
  });
});

describe('transferMany', () => {
  it('executes a replenishment plan without draining a shared source below its minimum', async () => {
    const p = await store.addProduct({ name: 'Cups', quantity: 10, locationId: 'back',
      min: { back: 5, left: 4, right: 4 } });
    const { replenishRows, rowMoves } = await import('../src/lib/replenish.js');
    const token = await store.transferMany(replenishRows(store.products).flatMap(rowMoves));
    expect(store.productById(p.id).stock).toEqual({ back: 5, left: 4, right: 1 });
    await store.undoTransfers(token);
    await store.init();
    expect(store.productById(p.id).stock).toEqual({ back: 10 });
  });

  const shelves = async () => {
    const shelf = await store.addLocation({ name: 'Shelf' });
    const back = await store.addLocation({ name: 'Back' });
    const a = await store.addProduct({ name: 'Mouse', quantity: 0, locationId: shelf.id });
    const b = await store.addProduct({ name: 'Pad', quantity: 0, locationId: shelf.id });
    await store.adjustStock(a.id, { delta: 20, locationId: back.id });
    await store.adjustStock(b.id, { delta: 5, locationId: back.id });
    return { shelf, back, a, b };
  };

  it('moves several products in one write, with one entry each', async () => {
    const { shelf, back, a, b } = await shelves();
    const token = await store.transferMany([
      { productId: a.id, from: back.id, to: shelf.id, qty: 8 },
      { productId: b.id, from: back.id, to: shelf.id, qty: 2 },
    ], { note: 'Replenishment' });

    expect(token.count).toBe(2);
    expect(store.productById(a.id).stock).toEqual({ [back.id]: 12, [shelf.id]: 8 });
    expect(store.productById(b.id).stock).toEqual({ [back.id]: 3, [shelf.id]: 2 });
    const moves = store.activity.filter((e) => e.kind === 'move');
    expect(moves).toHaveLength(2);
    expect(moves[0]).toMatchObject({ note: 'Replenishment', moved: 2, toLocationName: 'Shelf' });
    // The totals never change on a move.
    expect(store.productById(a.id).quantity).toBe(20);
  });

  it('moves what is there, skips what is not, and reports nothing when nothing moved', async () => {
    const { shelf, back, a } = await shelves();
    await store.transferMany([
      { productId: a.id, from: back.id, to: shelf.id, qty: 99 },
      { productId: 'gone', from: back.id, to: shelf.id, qty: 5 },
      { productId: a.id, from: shelf.id, to: shelf.id, qty: 5 },
    ]);
    expect(store.productById(a.id).stock).toEqual({ [shelf.id]: 20 });
    expect(await store.transferMany([{ productId: a.id, from: back.id, to: shelf.id, qty: 5 }])).toBeNull();
  });

  it('undoes the whole batch and retracts its entries', async () => {
    const { shelf, back, a, b } = await shelves();
    const token = await store.transferMany([
      { productId: a.id, from: back.id, to: shelf.id, qty: 8 },
      { productId: b.id, from: back.id, to: shelf.id, qty: 2 },
    ]);
    const before = store.activity.length;
    await store.undoTransfers(token);
    expect(store.productById(a.id).stock).toEqual({ [back.id]: 20 });
    expect(store.productById(b.id).stock).toEqual({ [back.id]: 5 });
    expect(store.activity).toHaveLength(before - 2);
  });

  it('carries dated lots both ways', async () => {
    const shelf = await store.addLocation({ name: 'Shelf' });
    const back = await store.addLocation({ name: 'Back' });
    const p = await store.addProduct({ name: 'Milk', quantity: 0, trackExpiry: true, locationId: shelf.id });
    await store.adjustStock(p.id, { delta: 6, locationId: back.id, expiryDate: '2026-09-01' });
    const token = await store.transferMany([{ productId: p.id, from: back.id, to: shelf.id, qty: 4 }]);
    expect(store.productById(p.id).lots[shelf.id]).toEqual([{ date: '2026-09-01', qty: 4 }]);
    await store.undoTransfers(token);
    expect(store.productById(p.id).lots[back.id]).toEqual([{ date: '2026-09-01', qty: 6 }]);
    expect(store.productById(p.id).lots[shelf.id]).toBeUndefined();
  });
});

describe('take-out sessions', () => {
  it('retracts archived removals as well as the live log when undoing a large basket', async () => {
    const products = Array.from({ length: 405 }, (_, i) => ({
      id: `bulk-${i}`, name: `Product ${i}`, unit: 'each', quantity: 2, cost: 1, price: 3,
    }));
    const older = { id: 'older-entry', at: Date.now(), kind: 'import', name: 'Earlier import' };
    await store.importAll({ products, activity: [older] });
    await store.startTakeout();
    for (const p of products) await store.addToTakeout(p.id);
    const token = await store.applyTakeout();
    expect(Object.values(await store.loadAllArchives()).flat().some((a) => a.kind === 'remove')).toBe(true);

    await store.undoTakeout(token);
    await store.init();
    const history = [...store.activity, ...Object.values(await store.loadAllArchives()).flat()];
    expect(history.filter((a) => a.kind === 'remove')).toEqual([]);
    expect(history).toContainEqual(older);
    expect(store.products.every((p) => p.quantity === 2)).toBe(true);
    for (const archive of store.archives) {
      expect(archive.count).toBe((await store.loadArchive(archive.month)).length);
    }
    expect(store.takeout.lines).toHaveLength(405);
  });

  const basket = async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const a = await store.addProduct({ name: 'Mouse', sku: 'WM-1', barcode: '111', quantity: 10, cost: 2, price: 5, locationId: main.id });
    const b = await store.addProduct({ name: 'Pad', sku: 'PD-1', quantity: 4, cost: 1, price: 3, locationId: shop.id });
    return { main, shop, a, b };
  };

  it('persists the basket under its own key, and only one at a time', async () => {
    const { main } = await basket();
    const session = await store.startTakeout({ reason: 'sold', locationId: main.id, note: 'Market' });
    expect(kvData.get('inv:takeout:v1')).toMatchObject({ id: session.id, reason: 'sold', note: 'Market' });
    // Starting again returns the session already open rather than
    // throwing away a half-scanned basket.
    expect((await store.startTakeout({ reason: 'lost' })).id).toBe(session.id);
    expect(store.takeout.reason).toBe('sold');
  });

  it('adds a line, and a second scan of the same code counts one more', async () => {
    const { a } = await basket();
    await store.startTakeout();
    await store.scanIntoTakeout('111');
    await store.scanIntoTakeout('111');
    expect(store.takeout.lines).toHaveLength(1);
    expect(store.takeout.lines[0]).toMatchObject({ productId: a.id, qty: 2, price: 5 });
    // An unknown code is not an error, just nothing to add.
    expect(await store.scanIntoTakeout('nope')).toBeNull();
    expect(store.takeout.lines).toHaveLength(1);
  });

  it('edits and removes lines', async () => {
    const { a } = await basket();
    await store.startTakeout();
    const line = await store.addToTakeout(a.id);
    await store.setTakeoutLine(line.id, { qty: 3, price: '4.005', reason: 'damaged', locationId: '', note: ' spoiled ' });
    expect(store.takeout.lines[0]).toMatchObject({ qty: 3, price: 4.01, reason: 'damaged', locationId: '', note: 'spoiled' });
    // Junk never becomes data.
    await store.setTakeoutLine(line.id, { price: 'free', reason: 'rubbish', locationId: 7 });
    expect(store.takeout.lines[0]).toMatchObject({ price: null, reason: '', locationId: null });
    await store.removeTakeoutLine(line.id);
    expect(store.takeout.lines).toEqual([]);
  });

  it('commits as one remove per line, sharing one reference', async () => {
    const { a, b, main } = await basket();
    await store.startTakeout({ reason: 'sold', note: 'Saturday market' });
    await store.addToTakeout(a.id, { qty: 3 });
    await store.addToTakeout(b.id, { qty: 1 });
    const ref = store.takeout && (await import('../src/lib/takeout.js')).takeoutRef(store.takeout);
    const token = await store.applyTakeout();

    expect(store.takeout).toBeNull();
    expect(kvData.get('inv:takeout:v1')).toBeNull();
    expect(store.productById(a.id).quantity).toBe(7);
    expect(store.productById(b.id).quantity).toBe(3);
    const removals = store.activity.filter((e) => e.kind === 'remove');
    expect(removals).toHaveLength(2);
    expect(removals.every((e) => e.note === `${ref}: Saturday market`)).toBe(true);
    // Sale price and the cost at that moment, from #21, per line.
    expect(removals.find((e) => e.productId === a.id)).toMatchObject({ delta: -3, reason: 'sold', price: 5, cost: 2 });
    // Each line leaves its own bucket, not the product's total.
    expect(store.productById(a.id).stock).toEqual({ [main.id]: 7 });
    expect(token.lines).toHaveLength(2);
  });

  it('takes only what the location holds, and records what actually left', async () => {
    const { a, shop } = await basket();
    await store.startTakeout({ locationId: shop.id });
    await store.addToTakeout(a.id, { qty: 5 });   // 10 on hand, but none at Shop
    await expect(store.applyTakeout()).rejects.toThrow();
    expect(store.productById(a.id).quantity).toBe(10);

    await store.setTakeoutDefaults({ locationId: null });
    await store.setTakeoutLine(store.takeout.lines[0].id, { qty: 99 });
    await store.applyTakeout();
    expect(store.productById(a.id).quantity).toBe(0);
    expect(store.activity[0]).toMatchObject({ kind: 'remove', delta: -10 });
  });

  it('honours per-line reasons, locations, and prices', async () => {
    const { a, shop } = await basket();
    await store.adjustStock(a.id, { delta: 4, locationId: shop.id });
    await store.startTakeout({ reason: 'sold' });
    const line = await store.addToTakeout(a.id, { qty: 2 });
    await store.setTakeoutLine(line.id, { reason: 'damaged', locationId: shop.id });
    await store.applyTakeout();
    expect(store.activity[0]).toMatchObject({ kind: 'remove', reason: 'damaged', delta: -2 });
    // A write-off records no revenue, whatever the line was seeded with.
    expect(store.activity[0].price).toBeUndefined();
    expect(store.productById(a.id).stock).toMatchObject({ [shop.id]: 2 });
  });

  it('undoes a whole basket: stock back, entries retracted, basket restored', async () => {
    const { a, b } = await basket();
    await store.startTakeout();
    await store.addToTakeout(a.id, { qty: 3 });
    await store.addToTakeout(b.id, { qty: 2 });
    const token = await store.applyTakeout();
    const logLength = store.activity.length;

    await store.undoTakeout(token);
    expect(store.productById(a.id).quantity).toBe(10);
    expect(store.productById(b.id).quantity).toBe(4);
    expect(store.activity).toHaveLength(logLength - 2);
    // The basket comes back so a mistake can be fixed, not re-scanned.
    expect(store.takeout.lines).toHaveLength(2);
    expect(kvData.get('inv:takeout:v1').lines).toHaveLength(2);
  });

  it('puts dated stock back under the dates it left with', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const p = await store.addProduct({ name: 'Milk', quantity: 0, trackExpiry: true, locationId: main.id });
    await store.adjustStock(p.id, { delta: 4, expiryDate: '2026-09-01' });
    await store.adjustStock(p.id, { delta: 6, expiryDate: '2026-10-01' });
    await store.startTakeout();
    await store.addToTakeout(p.id, { qty: 5 });
    const token = await store.applyTakeout();
    // FEFO: the whole September lot and one from October.
    expect(store.productById(p.id).lots[main.id]).toEqual([{ date: '2026-10-01', qty: 5 }]);

    await store.undoTakeout(token);
    expect(store.productById(p.id).lots[main.id]).toEqual([
      { date: '2026-09-01', qty: 4 },
      { date: '2026-10-01', qty: 6 },
    ]);
  });

  it('does not clobber a new basket when an old one is undone', async () => {
    const { a, b } = await basket();
    await store.startTakeout();
    await store.addToTakeout(a.id, { qty: 1 });
    const token = await store.applyTakeout();
    await store.startTakeout();
    await store.addToTakeout(b.id, { qty: 1 });
    await store.undoTakeout(token);
    expect(store.takeout.lines).toHaveLength(1);
    expect(store.takeout.lines[0].productId).toBe(b.id);
    expect(store.productById(a.id).quantity).toBe(10);
  });

  it('follows the stock when the location it points at is deleted', async () => {
    const { a, main } = await basket();
    await store.startTakeout({ locationId: main.id });
    const line = await store.addToTakeout(a.id, { qty: 2 });
    await store.setTakeoutLine(line.id, { locationId: main.id });
    await store.deleteLocation(main.id);
    expect(store.takeout.locationId).toBe('');
    expect(store.takeout.lines[0].locationId).toBe('');
    // And the commit still finds the stock, now unassigned.
    await store.applyTakeout();
    expect(store.productById(a.id).quantity).toBe(8);
  });

  it('refuses an empty basket and clears on a wipe', async () => {
    await basket();
    await store.startTakeout();
    await expect(store.applyTakeout()).rejects.toThrow();
    await store.wipeAll({ snapshot: false });
    expect(store.takeout).toBeNull();
    expect(kvData.get('inv:takeout:v1')).toBeNull();
  });

  /**
   * A sell-as-kit holds no stock of its own, so there is no bucket for
   * the basket to take one out of. The stock dialog knew that; the
   * basket did not, and quietly took nothing out at all.
   */
  describe('a sell-as-kit in the basket', () => {
    const withKit = async () => {
      const main = await store.addLocation({ name: 'Main' });
      const nib = await store.addProduct({ name: 'Nib', quantity: 10, locationId: main.id, cost: 1 });
      const ink = await store.addProduct({ name: 'Ink', quantity: 4, locationId: main.id, cost: 3 });
      const kit = await store.addProduct({
        name: 'Pen set', quantity: 0, price: 12, kit: 'sell',
        components: [{ productId: nib.id, qty: 2 }, { productId: ink.id, qty: 1 }],
      });
      return { main, nib, ink, kit };
    };

    it('takes its components out and records the sale on the kit', async () => {
      const { main, nib, ink, kit } = await withKit();
      await store.startTakeout({ reason: 'sold', note: 'market' });
      await store.addToTakeout(kit.id, { qty: 3 });
      const token = await store.applyTakeout();

      expect(store.productById(nib.id).quantity).toBe(4);
      expect(store.productById(ink.id).quantity).toBe(1);
      // The kit never holds any, so its own count doesn't move.
      expect(store.productById(kit.id).quantity).toBe(0);

      const onKit = store.activity.find((a) => a.productId === kit.id && a.kind === 'remove');
      // Its money, against what the parts cost: 2 nibs + 1 ink = 5.
      expect(onKit).toMatchObject({ delta: -3, quantity: 0, price: 12, cost: 5, reason: 'sold' });
      // The parts point back at the kit, so the sales report reads the
      // basket as one sale rather than three unpriced removals.
      const parts = store.activity.filter((a) => a.kitId === kit.id);
      expect(parts.map((a) => a.delta).sort((x, y) => x - y)).toEqual([-6, -3]);
      expect(parts.every((a) => a.locationName === 'Main')).toBe(true);
      // One basket line went out, restored from two component buckets.
      expect(token.count).toBe(1);
      expect(token.lines).toHaveLength(2);
      expect(token.lines.every((l) => l.locationId === main.id)).toBe(true);
    });

    it('undoes as cleanly as any other line', async () => {
      const { nib, ink, kit } = await withKit();
      await store.startTakeout();
      await store.addToTakeout(kit.id, { qty: 2 });
      const token = await store.applyTakeout();
      const logLength = store.activity.length;

      await store.undoTakeout(token);
      expect(store.productById(nib.id).quantity).toBe(10);
      expect(store.productById(ink.id).quantity).toBe(4);
      // Two component entries and the kit's own, all retracted.
      expect(store.activity).toHaveLength(logLength - 3);
      expect(store.takeout.lines).toHaveLength(1);
    });

    it('takes what the parts allow, and skips a line they can’t cover at all', async () => {
      const { nib, ink, kit } = await withKit();
      // Ink is the limit: 4 makes 4 sets, and there are nibs for 5.
      await store.startTakeout();
      await store.addToTakeout(kit.id, { qty: 9 });
      await store.applyTakeout();
      expect(store.productById(ink.id).quantity).toBe(0);
      expect(store.productById(nib.id).quantity).toBe(2);

      // Nothing left to give: the line is skipped rather than logging a
      // sale of stock that never moved.
      await store.startTakeout();
      await store.addToTakeout(kit.id, { qty: 1 });
      await expect(store.applyTakeout()).rejects.toThrow();
      expect(store.activity.filter((a) => a.productId === kit.id && a.kind === 'remove')).toHaveLength(1);
    });
  });
});

describe('bulk actions', () => {
  const three = async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const a = await store.addProduct({ name: 'A', quantity: 5, locationId: main.id });
    const b = await store.addProduct({ name: 'B', quantity: 2, locationId: main.id });
    const c = await store.addProduct({ name: 'C', quantity: 9, locationId: main.id });
    return { main, shop, a, b, c };
  };

  it('applies one patch to many products with a single summarizing entry', async () => {
    const { a, c } = await three();
    const n = await store.bulkUpdateProducts([a.id, c.id], { category: 'Seasonal', lowStock: 4 },
      { summary: 'category → Seasonal' });
    expect(n).toBe(2);
    expect(store.products.map((p) => p.category)).toEqual(['Seasonal', '', 'Seasonal']);
    expect(store.activity[0]).toMatchObject({ kind: 'bulk', name: '2 products updated', note: 'category → Seasonal' });
    expect(kvData.get('inv:products:v2').filter((p) => p.lowStock === 4)).toHaveLength(2);
  });

  it('rounds a shared threshold to what each product’s unit can hold', async () => {
    const { a } = await three();
    const flour = await store.addProduct({ name: 'Flour', unit: 'kg', quantity: 3 });
    await store.bulkUpdateProducts([a.id, flour.id], { lowStock: 2.5, reorderQty: 0.4 });
    expect(store.productById(a.id)).toMatchObject({ lowStock: 3, reorderQty: null });
    expect(store.productById(flour.id)).toMatchObject({ lowStock: 2.5, reorderQty: 0.4 });
    // Blank clears; zero is a threshold ("never warn"), not an absence.
    await store.updateProduct(a.id, { lowStock: '', reorderQty: '' });
    expect(store.productById(a.id)).toMatchObject({ lowStock: null, reorderQty: null });
    await store.updateProduct(a.id, { lowStock: 0 });
    expect(store.productById(a.id).lowStock).toBe(0);
  });

  it('carries single-location stock when the location changes', async () => {
    const { shop, a, b } = await three();
    await store.bulkUpdateProducts([a.id, b.id], { locationId: shop.id });
    expect(store.productById(a.id).stock).toEqual({ [shop.id]: 5 });
    expect(store.productById(b.id).stock).toEqual({ [shop.id]: 2 });
  });

  it('applies a different patch per product in one write and one entry', async () => {
    const { a, b, c } = await three();
    const n = await store.bulkUpdateEach([
      { id: a.id, patch: { lowStock: 12 } },
      { id: b.id, patch: { lowStock: 3 } },
      // Nothing decided about this one: it isn't touched at all.
      { id: c.id, patch: {} },
    ], { summary: 'threshold → suggested from demand' });
    expect(n).toBe(2);
    expect([a, b, c].map((p) => store.productById(p.id).lowStock)).toEqual([12, 3, null]);
    expect(store.productById(c.id).updatedAt).toBe(c.updatedAt);
    expect(store.activity.filter((e) => e.kind === 'bulk')).toHaveLength(1);
    expect(store.activity[0]).toMatchObject({ name: '2 products updated', note: 'threshold → suggested from demand' });
  });

  it('ignores unknown ids and empty patch lists', async () => {
    const { a } = await three();
    expect(await store.bulkUpdateEach([{ id: 'nope', patch: { lowStock: 2 } }])).toBe(0);
    expect(await store.bulkUpdateEach([])).toBe(0);
    expect(store.activity.some((e) => e.kind === 'bulk')).toBe(false);
    expect(await store.bulkUpdateEach([{ id: a.id, patch: { lowStock: 2 } }])).toBe(1);
  });

  it('ignores unknown ids and does nothing when none match', async () => {
    const { a } = await three();
    expect(await store.bulkUpdateProducts(['nope'], { category: 'X' })).toBe(0);
    expect(store.activity.some((e) => e.kind === 'bulk')).toBe(false);
    expect(await store.bulkUpdateProducts([a.id, 'nope'], { category: 'X' })).toBe(1);
  });

  it('archives and restores together, skipping products already there', async () => {
    const { a, b } = await three();
    await store.setArchived(a.id, true);
    expect(await store.bulkSetArchived([a.id, b.id], true)).toBe(1);
    expect(store.products.filter((p) => p.archived)).toHaveLength(2);
    expect(await store.bulkSetArchived([a.id, b.id], true)).toBe(0);
    expect(await store.bulkSetArchived([a.id, b.id], false)).toBe(2);
  });

  it('deletes many and puts them all back in place', async () => {
    const { a, c } = await three();
    const order = () => store.products.map((p) => p.name);
    const before = order();

    const token = await store.bulkDeleteProducts([a.id, c.id]);
    expect(order()).toEqual(['B']);
    expect(store.activity[0]).toMatchObject({ kind: 'delete', name: '2 products deleted' });

    await store.undoDelete(token);
    expect(order()).toEqual(before);
    expect(store.activity.some((e) => e.kind === 'delete')).toBe(false);
  });

  it('names the single product when only one is deleted, and returns null for none', async () => {
    const { b } = await three();
    const token = await store.bulkDeleteProducts([b.id]);
    expect(store.activity[0]).toMatchObject({ kind: 'delete', name: 'B', productId: b.id });
    expect(token.products).toHaveLength(1);
    expect(await store.bulkDeleteProducts(['nope'])).toBeNull();
  });
});

describe('expiry lots', () => {
  const day = (offset) => {
    const d = new Date(Date.now() + offset * 24 * 3600 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('gives existing stock an undated lot when tracking turns on, and drops lots when it turns off', async () => {
    const p = await store.addProduct({ name: 'Milk', quantity: 6 });
    expect(p.lots).toBeUndefined();
    await store.updateProduct(p.id, { trackExpiry: true });
    expect(store.productById(p.id).lots).toEqual({ '': [{ date: '', qty: 6 }] });
    await store.updateProduct(p.id, { trackExpiry: false });
    expect(store.productById(p.id).lots).toBeUndefined();
  });

  it('keeps stock when one edit turns tracking on and moves the home', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Milk', quantity: 10, locationId: main.id });

    // One ordinary form save: enable expiry tracking and change location.
    await store.updateProduct(p.id, { trackExpiry: true, locationId: shop.id });
    expect(store.productById(p.id).quantity).toBe(10);
    expect(store.productById(p.id).stock[shop.id]).toBe(10);
    expect(store.productById(p.id).lots[shop.id]).toEqual([{ date: '', qty: 10 }]);
  });

  it('moves dated lots along when an edit changes a tracked product\'s home', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Milk', quantity: 0, trackExpiry: true, locationId: main.id });
    await store.adjustStock(p.id, { delta: 6, expiryDate: day(5), locationId: main.id });

    await store.updateProduct(p.id, { locationId: shop.id });
    expect(store.productById(p.id).quantity).toBe(6);
    expect(store.productById(p.id).lots[shop.id]).toEqual([{ date: day(5), qty: 6 }]);
    expect(store.productById(p.id).lots[main.id]).toBeUndefined();
  });

  it('dates receipts, keeps buckets as lot totals, and removes FEFO', async () => {
    const p = await store.addProduct({ name: 'Milk', quantity: 0, trackExpiry: true });
    await store.adjustStock(p.id, { delta: 4, expiryDate: day(20) });
    await store.adjustStock(p.id, { delta: 2, expiryDate: day(5) });
    expect(store.productById(p.id).quantity).toBe(6);
    expect(store.productById(p.id).lots['']).toEqual([
      { date: day(5), qty: 2 },
      { date: day(20), qty: 4 },
    ]);

    // FEFO: the removal eats the day(5) lot first.
    await store.adjustStock(p.id, { delta: -3, reason: 'sold' });
    expect(store.productById(p.id).lots['']).toEqual([{ date: day(20), qty: 3 }]);
    expect(store.productById(p.id).quantity).toBe(3);
  });

  it('lets a removal name the lot reality took from', async () => {
    const p = await store.addProduct({ name: 'Milk', quantity: 0, trackExpiry: true });
    await store.adjustStock(p.id, { delta: 4, expiryDate: day(5) });
    await store.adjustStock(p.id, { delta: 4, expiryDate: day(20) });
    await store.adjustStock(p.id, { delta: -2, lotDate: day(20), reason: 'damaged' });
    expect(store.productById(p.id).lots['']).toEqual([
      { date: day(5), qty: 4 },
      { date: day(20), qty: 2 },
    ]);
  });

  it('moves lots with their dates and recounts without inventing them', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const p = await store.addProduct({ name: 'Milk', quantity: 0, trackExpiry: true, locationId: main.id });
    await store.adjustStock(p.id, { delta: 6, expiryDate: day(5), locationId: main.id });

    await store.transferStock(p.id, { from: main.id, to: shop.id, qty: 2 });
    expect(store.productById(p.id).lots[main.id]).toEqual([{ date: day(5), qty: 4 }]);
    expect(store.productById(p.id).lots[shop.id]).toEqual([{ date: day(5), qty: 2 }]);

    // Recount up: growth has no known date.
    await store.adjustStock(p.id, { set: 7, locationId: main.id });
    expect(store.productById(p.id).lots[main.id]).toEqual([
      { date: day(5), qty: 4 },
      { date: '', qty: 3 },
    ]);
  });

  it('keeps dated lots through a location deletion', async () => {
    const main = await store.addLocation({ name: 'Main' });
    const p = await store.addProduct({ name: 'Milk', quantity: 0, trackExpiry: true, locationId: main.id });
    await store.adjustStock(p.id, { delta: 5, expiryDate: day(9), locationId: main.id });
    await store.deleteLocation(main.id);
    expect(store.productById(p.id).lots['']).toEqual([{ date: day(9), qty: 5 }]);
    expect(store.productById(p.id).quantity).toBe(5);
  });

  it('receives order lines as undated lots on tracked products', async () => {
    const sup = await store.addSupplier({ name: 'Dairy' });
    const p = await store.addProduct({ name: 'Milk', quantity: 0, trackExpiry: true, supplierId: sup.id });
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: p.id, qty: 6 }] });
    await store.receiveOrder(order.id);
    expect(store.productById(p.id).lots['']).toEqual([{ date: '', qty: 6 }]);
  });
});

describe('stocktake sessions', () => {
  const setup = async () => {
    const main = await store.addLocation({ name: 'Main' });
    const shop = await store.addLocation({ name: 'Shop' });
    const a = await store.addProduct({ name: 'Mouse', sku: 'WM-1', quantity: 10, cost: 2, locationId: main.id });
    const b = await store.addProduct({ name: 'Pad', quantity: 4, cost: 1, locationId: main.id });
    await store.adjustStock(a.id, { delta: 3, locationId: shop.id }); // a: 10 main + 3 shop
    return { main, shop, a, b };
  };

  it('starts a session that survives a reboot, and allows only one', async () => {
    const { main } = await setup();
    const session = await store.startStocktake({ locationId: main.id });
    expect(session.rows.map((r) => r.name).sort()).toEqual(['Mouse', 'Pad']);
    expect(session.rows.find((r) => r.name === 'Mouse').expected).toBe(10);
    await expect(store.startStocktake({})).rejects.toThrow();

    await store.setStocktakeCount(session.rows[0].productId, 7);
    await store.init(); // reload
    expect(store.stocktake.rows[0].counted).toBe(7);
  });

  it('refuses to delete the location a session is scoped to', async () => {
    const { main, a } = await setup();
    await store.startStocktake({ locationId: main.id });

    // Deleting mid-count would leave the apply writing into a dead
    // bucket while the moved stock also survives — doubled on hand.
    await expect(store.deleteLocation(main.id)).rejects.toThrow(/being counted/);
    expect(store.locationById(main.id)).not.toBeNull();

    await store.setStocktakeCount(a.id, 10);
    await store.applyStocktake();
    await store.deleteLocation(main.id); // fine once the count is done
    expect(store.locationById(main.id)).toBeNull();
    expect(store.productById(a.id).quantity).toBe(13);
  });

  it('refuses to delete a stocked location while the unassigned bucket is being counted', async () => {
    const { main, a } = await setup();
    await store.adjustStock(a.id, { delta: 2, locationId: '' }); // 2 unassigned
    await store.startStocktake({ locationId: '' });
    await store.setStocktakeCount(a.id, 2);

    // Deleting Main would move its 10 units into the very bucket the
    // frozen count is about to state absolutely — applying afterwards
    // would recount those units away.
    await expect(store.deleteLocation(main.id)).rejects.toThrow(/being counted/);
    expect(store.locationById(main.id)).not.toBeNull();

    // A location holding nothing moves nothing, so it may go.
    const empty = await store.addLocation({ name: 'Empty' });
    await store.deleteLocation(empty.id);
    expect(store.locationById(empty.id)).toBeNull();

    await store.applyStocktake();
    await store.deleteLocation(main.id); // fine once the count is done
    expect(store.productById(a.id).quantity).toBe(15); // 10 main + 3 shop + 2 unassigned
  });

  it('refuses an empty scope, and can be discarded without touching stock', async () => {
    const { a } = await setup();
    await expect(store.startStocktake({ category: 'Nope' })).rejects.toThrow();
    await store.startStocktake({});
    await store.setStocktakeCount(a.id, 1);
    await store.cancelStocktake();
    expect(store.stocktake).toBeNull();
    expect(store.productById(a.id).quantity).toBe(13);
  });

  it('applies a located count as recounts at that location, skipping untouched rows', async () => {
    const { main, shop, a, b } = await setup();
    await store.startStocktake({ locationId: main.id });
    await store.setStocktakeCount(a.id, 8);   // main: 10 → 8
    // b never counted: stays untouched, not zeroed.
    const adjusted = await store.applyStocktake();

    expect(adjusted).toBe(1);
    expect(store.stocktake).toBeNull();
    expect(store.productById(a.id).stock).toEqual({ [main.id]: 8, [shop.id]: 3 });
    expect(store.productById(b.id).quantity).toBe(4);
    expect(store.activity[0]).toMatchObject({
      kind: 'recount', productId: a.id, delta: -2, quantity: 11, locationId: main.id,
    });
    expect(store.activity[0].note).toMatch(/^Stocktake .*Main/);
    // The pre-commit safety snapshot ran.
    expect(store.backups[0]?.reason).toBe('stocktake');
  });

  it('applies a whole-store count against the total, draining largest buckets first', async () => {
    const { main, shop, a } = await setup();
    await store.startStocktake({});
    await store.setStocktakeCount(a.id, 2); // 13 total → 2: main 10 drains to 0, shop 3 → 2
    await store.applyStocktake();
    expect(store.productById(a.id).stock).toEqual({ [shop.id]: 2 });
    expect(store.productById(a.id).quantity).toBe(2);

    // Growth lands in the default bucket.
    await store.startStocktake({});
    await store.setStocktakeCount(a.id, 5);
    await store.applyStocktake();
    expect(store.productById(a.id).stock).toEqual({ [shop.id]: 2, [main.id]: 3 });
  });

  it('treats a counted zero as zero and a matching count as no change', async () => {
    const { main, a, b } = await setup();
    await store.startStocktake({ locationId: main.id });
    await store.setStocktakeCount(a.id, 0);
    await store.setStocktakeCount(b.id, 4); // matches expected
    const adjusted = await store.applyStocktake();
    expect(adjusted).toBe(1);
    expect(store.productById(a.id).stock[main.id]).toBeUndefined();
    expect(store.productById(b.id).quantity).toBe(4);
  });
});

describe('assignBarcodes', () => {
  it('codes only products with no barcode and no SKU, in one pass', async () => {
    const bare = await store.addProduct({ name: 'Loose apples' });
    const bare2 = await store.addProduct({ name: 'Bulk rice' });
    const skued = await store.addProduct({ name: 'Mouse', sku: 'WM-1' });
    const coded = await store.addProduct({ name: 'Pad', barcode: '590123' });

    const n = await store.assignBarcodes([bare.id, bare2.id, skued.id, coded.id]);
    expect(n).toBe(2);
    // Which of the two gets which number is unimportant; that both got
    // distinct sequential codes is.
    const codes = [bare, bare2].map((p) => store.productById(p.id).barcode);
    expect(codes.slice().sort()).toEqual(['INV-000001', 'INV-000002']);
    expect(store.productById(skued.id).barcode).toBe('');
    expect(store.productById(coded.id).barcode).toBe('590123');
    // Scanning a fresh code finds the product now carrying it.
    const holder = store.products.find((p) => p.barcode === 'INV-000001');
    expect([bare.id, bare2.id]).toContain(holder.id);
    expect(store.productByCode('INV-000001').id).toBe(holder.id);
    expect(store.activity[0]).toMatchObject({ kind: 'bulk' });
    // Nothing left to assign on a second pass.
    expect(await store.assignBarcodes([bare.id, skued.id])).toBe(0);
  });
});

describe('purchase orders', () => {
  const setup = async () => {
    const sup = await store.addSupplier({ name: 'Apex' });
    const loc = await store.addLocation({ name: 'Main' });
    const a = await store.addProduct({ name: 'Mouse', sku: 'WM-1', quantity: 1, locationId: loc.id, supplierId: sup.id });
    const b = await store.addProduct({ name: 'Beans', unit: 'kg', quantity: 0.5, locationId: loc.id, supplierId: sup.id });
    return { sup, loc, a, b };
  };

  it('records a placed order with the details frozen in', async () => {
    const { sup, a, b } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 10 }, { productId: b.id, qty: 2.5 }] });
    expect(order).toMatchObject({ status: 'ordered', supplierName: 'Apex' });
    expect(order.reference).toMatch(/^PO-/);
    expect(order.lines).toEqual([
      { productId: a.id, name: 'Mouse', sku: 'WM-1', code: '', unit: 'each', qty: 10, received: 0 },
      { productId: b.id, name: 'Beans', sku: '', code: '', unit: 'kg', qty: 2.5, received: 0 },
    ]);
    expect(store.activity[0]).toMatchObject({ kind: 'order' });
    expect(store.openOrders()).toHaveLength(1);

    // A later rename doesn't rewrite history on the order.
    await store.updateProduct(a.id, { name: 'Mouse v2' });
    expect(store.orderById(order.id).lines[0].name).toBe('Mouse');
  });

  it('gives each order of the day its own reference', async () => {
    const { sup, a } = await setup();
    const refs = [];
    for (let i = 0; i < 3; i++) {
      refs.push((await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 1 }] })).reference);
    }
    expect(new Set(refs).size).toBe(3);
    expect(refs[1]).toBe(`${refs[0]}-2`);
    expect(refs[2]).toBe(`${refs[0]}-3`);
    // An explicitly given reference is still used as-is.
    const named = await store.placeOrder({ supplierId: sup.id, reference: ' PO-9 ', lines: [{ productId: a.id, qty: 1 }] });
    expect(named.reference).toBe('PO-9');
  });

  it('drops empty lines and refuses an empty order', async () => {
    const { sup, a } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 4 }, { productId: 'nope', qty: 9 }, { productId: a.id, qty: 0 }] });
    expect(order.lines).toHaveLength(1);
    await expect(store.placeOrder({ supplierId: sup.id, lines: [] })).rejects.toThrow();
  });

  it('receives every line into stock, noted with the reference', async () => {
    const { sup, loc, a, b } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 10 }, { productId: b.id, qty: 2.5 }] });

    expect(await store.receiveOrder(order.id)).toBe(2);
    expect(store.productById(a.id).stock).toEqual({ [loc.id]: 11 });
    expect(store.productById(b.id).stock).toEqual({ [loc.id]: 3 });
    expect(store.activity[0]).toMatchObject({ kind: 'add', note: order.reference, locationName: 'Main' });
    expect(store.orderById(order.id)).toMatchObject({ status: 'received' });
    expect(store.openOrders()).toEqual([]);
    // and it can't be received twice
    await expect(store.receiveOrder(order.id)).rejects.toThrow();
  });

  it('receives into a chosen location when one is given', async () => {
    const { sup, a } = await setup();
    const shop = await store.addLocation({ name: 'Shop' });
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 3 }] });
    await store.receiveOrder(order.id, { locationId: shop.id });
    expect(store.productById(a.id).stock[shop.id]).toBe(3);
  });

  it('skips lines whose product is gone, without failing the delivery', async () => {
    const { sup, a, b } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 5 }, { productId: b.id, qty: 1 }] });
    await store.deleteProduct(b.id);
    expect(await store.receiveOrder(order.id)).toBe(1);
    expect(store.orderById(order.id).status).toBe('received');
  });

  it('cancels an order without touching stock, keeping the record', async () => {
    const { sup, a } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 5 }] });
    await store.cancelOrder(order.id);
    expect(store.orderById(order.id).status).toBe('cancelled');
    expect(store.productById(a.id).quantity).toBe(1);
    expect(store.openOrders()).toEqual([]);
    expect(kvData.get('inv:orders:v1')[0].status).toBe('cancelled');
    expect(store.activity[0]).toMatchObject({ kind: 'order', note: 'Order cancelled' });
  });

  it('receives line by line, holding the order open while lines are short', async () => {
    const { sup, loc, a, b } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 10 }, { productId: b.id, qty: 2.5 }] });

    // 4 of 10 mice arrive; the beans don't.
    expect(await store.receiveOrderLines(order.id, [{ productId: a.id, qty: 4 }])).toBe(1);
    expect(store.productById(a.id).stock).toEqual({ [loc.id]: 5 });
    expect(store.orderById(order.id)).toMatchObject({ status: 'partial', receivedAt: null });
    expect(store.orderById(order.id).lines[0].received).toBe(4);
    expect(store.openOrders()).toHaveLength(1);
    expect(store.activity[0]).toMatchObject({ kind: 'add', delta: 4, note: order.reference });

    // The rest lands; the order completes.
    expect(await store.receiveOrder(order.id)).toBe(2);
    expect(store.productById(a.id).stock).toEqual({ [loc.id]: 11 });
    expect(store.productById(b.id).stock).toEqual({ [loc.id]: 3 });
    expect(store.orderById(order.id).status).toBe('received');
    expect(store.openOrders()).toEqual([]);
  });

  it('accepts an over-delivery without leaving the order open', async () => {
    const { sup, loc, a } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 3 }] });
    await store.receiveOrderLines(order.id, [{ productId: a.id, qty: 5 }]);
    expect(store.productById(a.id).stock).toEqual({ [loc.id]: 6 });
    expect(store.orderById(order.id).status).toBe('received');
  });

  it('closes an order short, recording the undelivered remainder', async () => {
    const { sup, a, b } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 10 }, { productId: b.id, qty: 2 }] });
    await store.receiveOrderLines(order.id, [{ productId: a.id, qty: 10 }]);
    await store.closeOrderShort(order.id);
    expect(store.orderById(order.id).status).toBe('closed');
    expect(store.openOrders()).toEqual([]);
    expect(store.activity[0]).toMatchObject({ kind: 'order', note: 'Closed short; 1 line undelivered' });
    // The beans never arrived and stock says so.
    expect(store.productById(b.id).quantity).toBe(0.5);
  });

  it('migrates pre-partial orders on boot: received lines read as arrived in full', async () => {
    const { sup, a } = await setup();
    const order = await store.placeOrder({ supplierId: sup.id, lines: [{ productId: a.id, qty: 5 }] });
    // Simulate a record written before `received` existed.
    const raw = kvData.get('inv:orders:v1');
    delete raw[0].lines[0].received;
    raw[0].status = 'received';
    // Simulate an account written by the pre-journal application.
    for (const key of kvData.keys()) if (key.startsWith('inv:op:v1:')) kvData.delete(key);
    kvData.set('inv:orders:v1', raw);

    await store.init();
    expect(store.orderById(order.id).lines[0].received).toBe(5);
    expect(store.openOrders()).toEqual([]);
  });
});

describe('automatic snapshots', () => {
  /* A backup written before per-location stock carries only a quantity
     and a locationId; restoring it must build the buckets, or the first
     adjustment afterwards starts from an empty map and loses the count. */
  it('migrates products from a backup made before per-location stock', async () => {
    await store.restoreBackup({
      settings: {},
      products: [{ id: 'p1', name: 'Mouse', quantity: 7, locationId: 'a' }],
      locations: [{ id: 'a', name: 'Main' }],
      suppliers: [], activity: [], orders: [],
    });
    expect(store.productById('p1')).toMatchObject({ stock: { a: 7 }, quantity: 7 });

    await store.adjustStock('p1', { delta: -2 });
    expect(store.productById('p1').quantity).toBe(5);
    expect(kvData.get('inv:products:v2')[0].stock).toEqual({ a: 5 });
  });

  it('captures data before an erase and restores it', async () => {
    await store.addProduct({ name: 'Mouse', quantity: 4 });
    await store.addLocation({ name: 'Main' });

    await store.wipeAll();
    expect(store.products).toEqual([]);

    const snap = store.latestSnapshot();
    expect(snap).toMatchObject({ reason: 'erase', counts: { products: 1, locations: 1 } });

    const data = await store.readSnapshot(snap.id);
    await store.restoreBackup(data);
    expect(store.products.map((p) => p.name)).toEqual(['Mouse']);
    expect(store.locations.map((l) => l.name)).toEqual(['Main']);
    expect(kvData.get('inv:products:v2')).toHaveLength(1);
  });

  it('skips snapshots when there is nothing to lose', async () => {
    await store.wipeAll();
    expect(store.backups).toEqual([]);
  });

  it('snapshots before a CSV import and keeps only the newest few', async () => {
    await store.addProduct({ name: 'Mouse', sku: 'WM-1' });
    for (let i = 0; i < 5; i++) {
      await store.applyImport([{ name: `Item ${i}`, sku: `S-${i}`, quantity: 1, cost: 0, price: null, lowStock: null, notes: '', category: '', locationName: '', supplierName: '' }]);
    }
    expect(store.backups).toHaveLength(3);
    expect(store.backups[0].reason).toBe('import');
    // Evicted snapshot payloads are cleaned up, not left behind.
    const keys = [...kvData.keys()].filter((k) => k.startsWith('inv:backup:'));
    expect(keys).toHaveLength(3);
    // Newest first, and the oldest one restores the pre-import state.
    expect(store.backups[0].at).toBeGreaterThanOrEqual(store.backups[2].at);
  });

  it('survives a boot: the manifest persists', async () => {
    await store.addProduct({ name: 'Mouse' });
    await store.wipeAll();
    await store.init();
    expect(store.latestSnapshot()?.reason).toBe('erase');
  });
});

describe('applyImport and locations', () => {
  const draft = (over = {}) => ({
    name: 'Cable', sku: 'CB-1', category: '', quantity: 0, cost: 1,
    price: null, lowStock: null, notes: '', unit: '', packSize: 0, packName: '',
    locationName: '', supplierName: '', archived: null, stock: null, ...over,
  });

  it('splits a new product across the locations its breakdown names', async () => {
    await store.applyImport([draft({ quantity: 15, stock: [{ name: 'Main', qty: 10 }, { name: 'Shop', qty: 5 }] })]);
    const p = store.products[0];
    const [main, shop] = ['Main', 'Shop'].map((n) => store.locations.find((l) => l.name === n).id);
    expect(p.stock).toEqual({ [main]: 10, [shop]: 5 });
    expect(p.quantity).toBe(15);
  });

  it('puts a plain quantity at the row’s location', async () => {
    await store.applyImport([draft({ quantity: 4, locationName: 'Depot' })]);
    const depot = store.locations[0].id;
    expect(store.products[0].stock).toEqual({ [depot]: 4 });
  });

  it('replaces the whole breakdown in update mode', async () => {
    await store.applyImport([draft({ quantity: 15, stock: [{ name: 'Main', qty: 10 }, { name: 'Shop', qty: 5 }] })]);
    await store.applyImport([draft({ quantity: 2, stock: [{ name: 'Shop', qty: 2 }] })], 'update');
    const shop = store.locations.find((l) => l.name === 'Shop').id;
    expect(store.products[0].stock).toEqual({ [shop]: 2 });
    expect(store.products[0].quantity).toBe(2);
  });

  it('tops buckets up in add mode, including repeated rows', async () => {
    await store.applyImport([draft({ quantity: 10, stock: [{ name: 'Main', qty: 10 }] })]);
    await store.applyImport([
      draft({ quantity: 3, stock: [{ name: 'Main', qty: 3 }] }),
      draft({ quantity: 5, stock: [{ name: 'Shop', qty: 5 }] }),
    ], 'add');
    const [main, shop] = ['Main', 'Shop'].map((n) => store.locations.find((l) => l.name === n).id);
    expect(store.products[0].stock).toEqual({ [main]: 13, [shop]: 5 });
    expect(store.products[0].quantity).toBe(18);
  });

  /* Two rows of one receiving file sharing a NEW SKU: each row's stock
     must land at its own location, not merged at the last row's. */
  it('splits duplicate new-SKU rows across their own locations in add mode', async () => {
    await store.applyImport([
      draft({ quantity: 5, locationName: 'Warehouse A' }),
      draft({ quantity: 3, locationName: 'Warehouse B' }),
    ], 'add');
    expect(store.products).toHaveLength(1);
    const [a, b] = ['Warehouse A', 'Warehouse B'].map((n) => store.locations.find((l) => l.name === n)?.id);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(store.products[0].stock).toEqual({ [a]: 5, [b]: 3 });
    expect(store.products[0].quantity).toBe(8);
  });

  it('keeps both breakdowns when duplicate new-SKU rows carry them in add mode', async () => {
    await store.applyImport([
      draft({ quantity: 10, stock: [{ name: 'Main', qty: 10 }] }),
      draft({ quantity: 5, stock: [{ name: 'Shop', qty: 5 }] }),
    ], 'add');
    const [main, shop] = ['Main', 'Shop'].map((n) => store.locations.find((l) => l.name === n).id);
    expect(store.products[0].stock).toEqual({ [main]: 10, [shop]: 5 });
    expect(store.products[0].quantity).toBe(15);
  });

  it('lets the last duplicate new-SKU row win in update mode', async () => {
    await store.applyImport([
      draft({ quantity: 5, locationName: 'Warehouse A' }),
      draft({ quantity: 3, locationName: 'Warehouse B' }),
    ], 'update');
    const b = store.locations.find((l) => l.name === 'Warehouse B').id;
    expect(store.products[0].stock).toEqual({ [b]: 3 });
    expect(store.products[0].quantity).toBe(3);
  });

  it('keeps unassigned stock unassigned, even when the product has a home', async () => {
    await store.applyImport([draft({ locationName: 'Main', quantity: 5, stock: [{ name: '', qty: 5, unassigned: true }] })]);
    expect(store.products[0].stock).toEqual({ '': 5 });
    expect(store.products[0].locationId).toBe(store.locations[0].id);
  });

  it('leaves no import-only fields behind on the product', async () => {
    await store.applyImport([draft({ quantity: 1, locationName: 'Main' })]);
    await store.applyImport([draft({ quantity: 2, locationName: 'Main' })], 'update');
    const p = store.products[0];
    for (const key of ['stockByName', 'stockMode', 'locationName', 'supplierName']) {
      expect(key in p).toBe(false);
    }
  });
});

describe('wipeAll', () => {
  it('clears data and the sample flag but keeps preferences', async () => {
    await store.updateSettings({ currency: 'EUR', sampleData: true });
    await store.addProduct({ name: 'Mouse' });
    await store.wipeAll();
    expect(store.products).toEqual([]);
    expect(store.settings.sampleData).toBe(false);
    expect(store.settings.currency).toBe('EUR');
    expect(kvData.get('inv:products:v2')).toEqual([]);
  });
});

describe('change events', () => {
  it('dispatches change on every mutation', async () => {
    let n = 0;
    const onChange = () => n++;
    store.addEventListener('change', onChange);
    const p = await store.addProduct({ name: 'Mouse' });
    await store.adjustStock(p.id, { delta: 2 });
    await store.updateSettings({ currency: 'GBP' });
    store.removeEventListener('change', onChange);
    expect(n).toBe(3);
  });
});
