import { describe, it, expect } from 'vitest';
import { buildBackup, validateBackup, describeBackup, backupCounts, backupFilename } from '../src/lib/backup.js';
import { categoriesOf, inventoryStats, filterProducts } from '../src/lib/inventory.js';
import { migrateOrder, orderOutstanding, onOrderQty } from '../src/lib/reorder.js';
import { sourcesOf } from '../src/lib/sources.js';
import { allLots, lotsAt } from '../src/lib/lots.js';

const fakeStore = {
  settings: { currency: 'EUR', defaultLowStock: 5 },
  products: [{ id: 'p1', name: 'Mouse', sku: 'WM-1' }],
  locations: [{ id: 'l1', name: 'Main' }],
  suppliers: [],
  activity: [{ id: 'a1', kind: 'create', name: 'Mouse' }],
  orders: [],
  snapshots: [],
};

describe('buildBackup', () => {
  it('stamps provenance and carries every collection', () => {
    const b = buildBackup(fakeStore, 1000);
    expect(b).toMatchObject({ app: 'puter-inventory', version: 1, exportedAt: 1000 });
    expect(Object.keys(b.data).sort()).toEqual(['activity', 'families', 'locations', 'orders', 'products', 'settings', 'snapshots', 'stocktakes', 'suppliers']);
    expect(b.data.products).toHaveLength(1);
  });

  it('carries variant families, so a restore doesn’t scatter them', () => {
    const withFamily = {
      ...fakeStore,
      families: [{ id: 'f1', name: 'Cotton Shirt', axes: ['Size'] }, { name: 'No id' }, { id: 'f2', name: 42, axes: 'nope' }],
    };
    const res = validateBackup(buildBackup(withFamily));
    expect(res.data.families).toEqual([
      { id: 'f1', name: 'Cotton Shirt', axes: ['Size'] },
      { id: 'f2', name: '42', axes: [] },
    ]);
    // A file from before families reads as none, not as broken.
    expect(validateBackup({ data: { products: [{ name: 'Mouse' }] } }).data.families).toEqual([]);
  });

  it('round-trips through JSON and validation', () => {
    const parsed = JSON.parse(JSON.stringify(buildBackup(fakeStore)));
    const res = validateBackup(parsed);
    expect(res.ok).toBe(true);
    expect(res.data.products[0].name).toBe('Mouse');
    expect(res.data.settings.currency).toBe('EUR');
  });

  it('names the file with the local date', () => {
    expect(backupFilename(new Date(2026, 7, 4))).toBe('inventory-backup-2026-08-04.json');
  });
});

describe('validateBackup', () => {
  it('rejects non-objects and files with no collections', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup('nope').ok).toBe(false);
    expect(validateBackup([1, 2]).ok).toBe(false);
    expect(validateBackup({ hello: 'world' }).ok).toBe(false);
  });

  it('rejects backups from a newer version', () => {
    const res = validateBackup({ version: 99, data: { products: [] } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/newer version/);
  });

  it('accepts a bare body without the wrapper', () => {
    const res = validateBackup({ products: [{ id: 'p', name: 'Mouse' }] });
    expect(res.ok).toBe(true);
    expect(res.data.locations).toEqual([]);
    expect(res.data.settings).toEqual({});
  });

  it('fills missing collections and drops unusable product rows', () => {
    const res = validateBackup({ data: { products: [{ name: 'Ok' }, null, {}, { sku: 'S-1' }] } });
    expect(res.ok).toBe(true);
    expect(res.data.products).toHaveLength(2);
    expect(res.data.activity).toEqual([]);
  });

  it('names a kept row that only had a SKU', () => {
    const res = validateBackup({ data: { products: [{ sku: 'S-1' }] } });
    expect(res.data.products[0]).toMatchObject({ sku: 'S-1', name: 'S-1' });
  });

  it('gives id-less rows their own ids, keeping existing ones', () => {
    const res = validateBackup({ data: { products: [{ name: 'A' }, { name: 'B' }, { id: 'keep', name: 'C' }] } });
    const [a, b, c] = res.data.products;
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(c.id).toBe('keep');
  });

  /* Id-less records all answer to a lookup by undefined: deleting or
     cancelling one would take every id-less record with it, and the
     history view's duplicate check keeps only the first id-less entry. */
  it('gives id-less rows ids in every collection, not just products', () => {
    const res = validateBackup({
      data: {
        products: [{ name: 'P' }],
        locations: [{ name: 'L1' }, { name: 'L2' }],
        suppliers: [{ name: 'S' }],
        activity: [{ at: 1, kind: 'add', name: 'P' }, { at: 2, kind: 'remove', name: 'P' }],
        orders: [{ status: 'ordered', lines: [] }, { id: 'keep', status: 'ordered', lines: [] }],
        archives: { '2026-07': [{ at: 3, kind: 'add', name: 'P' }, null] },
      },
    });
    for (const key of ['locations', 'suppliers', 'activity', 'orders']) {
      for (const row of res.data[key]) expect(row.id, key).toBeTruthy();
    }
    const ids = [...res.data.locations, ...res.data.activity].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(res.data.orders[1].id).toBe('keep');
    // Archived months are activity too — same ids, and no null rows.
    expect(res.data.archives['2026-07']).toHaveLength(1);
    expect(res.data.archives['2026-07'][0].id).toBeTruthy();
  });

  it('ignores a settings value that is not an object', () => {
    const res = validateBackup({ data: { products: [], settings: [1, 2] } });
    expect(res.data.settings).toEqual({});
  });

  /* A hand-made file can hold rows that aren't records; restored as-is
     they crash the first render that touches them (a null order breaks
     the nav badge, a null snapshot the reports view). */
  it('drops rows that are not records from every collection', () => {
    const res = validateBackup({
      data: {
        products: [{ name: 'Ok' }],
        locations: [null, 'stray', { id: 'l1', name: 'Main' }],
        suppliers: [42, { id: 's1', name: 'Apex' }],
        activity: [null, { id: 'a1', kind: 'create', name: 'Ok' }],
        orders: [null, [1, 2], { id: 'o1', status: 'ordered', lines: [] }],
        snapshots: [null, { date: '2026-08-01' }],
      },
    });
    expect(res.data.locations).toEqual([{ id: 'l1', name: 'Main' }]);
    expect(res.data.suppliers).toEqual([{ id: 's1', name: 'Apex' }]);
    expect(res.data.activity).toHaveLength(1);
    expect(res.data.orders).toEqual([{ id: 'o1', status: 'ordered', lines: [] }]);
    expect(res.data.snapshots).toEqual([{ date: '2026-08-01' }]);
  });

  /* Views sort and label by name; a bare JSON number there would crash
     the first localeCompare it meets. */
  it('coerces the numeric fields the exporters write raw', () => {
    const res = validateBackup({
      products: [{ id: 'p1', name: 'Widget', cost: '=cmd|\'/c calc\'!A1', price: '=1+1', lowStock: 'x', reorderQty: '3', packSize: null }],
      suppliers: [{ id: 's1', name: 'Acme', leadTimeDays: '@SUM(1)', minOrder: '=HYPERLINK("http://evil","x")' }],
      activity: [{ id: 'a1', kind: 'add', name: 'Widget', at: 'now', delta: '=2', quantity: '7' }],
      snapshots: [{ date: '2026-01-01', value: '=9', units: '4' }],
    });
    expect(res.ok).toBe(true);
    expect(res.data.products[0]).toMatchObject({ cost: 0, price: null, lowStock: null, reorderQty: 3, packSize: null });
    expect(res.data.suppliers[0]).toMatchObject({ leadTimeDays: null, minOrder: null });
    expect(res.data.activity[0]).toMatchObject({ at: 0, delta: null, quantity: 7 });
    expect(res.data.snapshots[0]).toMatchObject({ value: 0, units: 4 });
  });

  it('coerces numeric fields inside archived months too', () => {
    const res = validateBackup({
      products: [{ id: 'p1', name: 'Widget' }],
      archives: { '2026-01': [{ id: 'a1', kind: 'add', name: 'Widget', at: '0', delta: '=2+3', quantity: 1 }] },
    });
    expect(res.ok).toBe(true);
    expect(res.data.archives['2026-01'][0]).toMatchObject({ delta: null, quantity: 1 });
  });

  it('coerces names to strings so the views can sort them', () => {
    const res = validateBackup({
      data: {
        products: [{ id: 'p1', name: 12345 }, { id: 'p2', sku: 678 }],
        locations: [{ id: 'l1', name: 42 }, { id: 'l2' }],
        suppliers: [{ id: 's1', name: 7 }],
      },
    });
    expect(res.data.products.map((p) => p.name)).toEqual(['12345', '678']);
    expect(res.data.locations.map((l) => l.name)).toEqual(['42', '']);
    expect(res.data.suppliers[0].name).toBe('7');
    const byName = (a, b) => a.name.localeCompare(b.name);
    expect(() => [...res.data.products].sort(byName)).not.toThrow();
    expect(() => [...res.data.locations].sort(byName)).not.toThrow();
  });

  it('coerces a product category so the category picker can sort it', () => {
    const res = validateBackup({
      data: {
        products: [
          { id: 'p1', name: 'Zed', category: 'Zinc' },
          { id: 'p2', name: 'Alpha', category: 'Alloy' },
          { id: 'p3', name: 'Num', category: 2024 },
          { id: 'p4', name: 'Mid', category: 'Mesh' },
          { id: 'p5', name: 'Beta', category: null },
          { id: 'p6', name: 'None' },
        ],
      },
    });
    expect(res.data.products.map((p) => p.category)).toEqual(['Zinc', 'Alloy', '2024', 'Mesh', '', undefined]);
    expect(() => categoriesOf(res.data.products)).not.toThrow();
    expect(categoriesOf(res.data.products)).toEqual(['2024', 'Alloy', 'Mesh', 'Zinc']);
  });
});

/**
 * A file written or truncated by hand can put anything where the app
 * keeps a list. Walking one with for…of throws, and these lists are
 * walked on every render — a single bad field took the Overview, the
 * Reports page and the products list down with it, on every reload.
 */
describe('lists that arrived as something other than lists', () => {
  const junk = {
    app: 'puter-inventory',
    version: 1,
    data: {
      products: [{
        id: 'p1', name: 'Odd', quantity: 3, kit: 'sell',
        components: 5, sources: 7, lots: { '': 9 },
      }],
      locations: [],
      suppliers: [],
      activity: [],
      orders: [{ id: 'o1', status: 'ordered', lines: 'nope' }],
    },
  };

  it('still validates, and every reader survives them', () => {
    const res = validateBackup(junk);
    expect(res.ok).toBe(true);
    const [p] = res.data.products;
    const [o] = res.data.orders;

    expect(() => inventoryStats(res.data.products)).not.toThrow();
    expect(() => filterProducts(res.data.products, { status: 'out' })).not.toThrow();
    expect(sourcesOf(p)).toEqual([]);
    expect(allLots(p)).toEqual([]);
    expect(lotsAt(p, '')).toEqual([]);
    expect(migrateOrder(o).lines).toEqual([]);
    expect(orderOutstanding(o)).toBe(false);
    expect(onOrderQty([o]).size).toBe(0);
  });

  it('reads a recipe that isn’t a list as no recipe at all', () => {
    const res = validateBackup(junk);
    // Not a kit, so it is judged on its own stock like anything else.
    expect(inventoryStats(res.data.products)).toMatchObject({ products: 1, out: 0 });
  });
});

describe('describeBackup', () => {
  it('counts each collection with correct plurals', () => {
    expect(describeBackup(fakeStore)).toBe('1 product, 1 location, 0 suppliers, 1 history entry');
    expect(describeBackup({ products: [], locations: [], suppliers: [], activity: [1, 2] }))
      .toBe('0 products, 0 locations, 0 suppliers, 2 history entries');
  });

  it('treats missing collections as empty', () => {
    expect(backupCounts({}).products).toBe(0);
  });
});
