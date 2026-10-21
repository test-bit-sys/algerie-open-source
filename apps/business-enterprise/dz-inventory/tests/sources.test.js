import { describe, it, expect } from 'vitest';
import {
  normalizeSources, sourcesOf, preferredSource, sourceFor, hasChoice,
  cheapestSource, savingPerUnit, codeFor, priceFrom, leadTimeFrom,
  packSizeFrom, supplierPriceList,
} from '../src/lib/sources.js';

const p = (over = {}) => ({
  id: 'p1', name: 'Mouse', unit: 'each', quantity: 10, cost: 2,
  supplierId: null, archived: false, ...over,
});

const src = (over = {}) => ({ supplierId: 's1', code: '', price: null, packSize: 0, leadTimeDays: null, preferred: false, ...over });

describe('normalizeSources', () => {
  it('keeps real suppliers, one entry each, exactly one preferred', () => {
    const list = normalizeSources([
      src({ supplierId: 's1', code: ' APX-1 ', price: '4.005' }),
      src({ supplierId: 's1', code: 'dupe' }),
      src({ supplierId: '', code: 'nobody' }),
      src({ supplierId: 's2', preferred: true }),
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ supplierId: 's1', code: 'APX-1', price: 4.01, preferred: false });
    expect(list[1]).toMatchObject({ supplierId: 's2', preferred: true });
  });

  it('prefers the first entry when nothing claims it', () => {
    const list = normalizeSources([src({ supplierId: 's1' }), src({ supplierId: 's2' })]);
    expect(list.map((x) => x.preferred)).toEqual([true, false]);
  });

  it('refuses junk prices, lead times and pack sizes', () => {
    const [only] = normalizeSources([src({ price: 'free', leadTimeDays: -3, packSize: 1 })]);
    expect(only).toMatchObject({ price: null, leadTimeDays: null, packSize: 0 });
    expect(normalizeSources([src({ price: 0 })])[0].price).toBe(0);
    expect(normalizeSources(null)).toEqual([]);
  });

  it('rounds a pack size to what the unit can express', () => {
    expect(normalizeSources([src({ packSize: 2.6 })], { unit: 'each' })[0].packSize).toBe(3);
    expect(normalizeSources([src({ packSize: 2.55 })], { unit: 'kg' })[0].packSize).toBe(2.55);
  });
});

describe('sourcesOf', () => {
  it('reads a lone supplierId as the preferred source, with no invented price', () => {
    const list = sourcesOf(p({ supplierId: 's1', cost: 7 }));
    expect(list).toHaveLength(1);
    // `cost` is the moving average of what stock cost, not what a
    // supplier charges; presenting one as the other would be a lie.
    expect(list[0]).toMatchObject({ supplierId: 's1', preferred: true, price: null, derived: true });
  });

  it('is empty for a product with no supplier at all', () => {
    expect(sourcesOf(p())).toEqual([]);
    expect(sourcesOf(null)).toEqual([]);
  });

  it('puts the preferred source first', () => {
    const product = p({
      supplierId: 's2',
      sources: [src({ supplierId: 's1', price: 3 }), src({ supplierId: 's2', price: 4, preferred: true })],
    });
    expect(sourcesOf(product).map((s) => s.supplierId)).toEqual(['s2', 's1']);
    expect(preferredSource(product).supplierId).toBe('s2');
    expect(hasChoice(product)).toBe(true);
    expect(hasChoice(p({ supplierId: 's1' }))).toBe(false);
  });
});

describe('comparing sources', () => {
  const product = p({
    supplierId: 's1',
    sources: [
      src({ supplierId: 's1', code: 'APX-1', price: 4, preferred: true, leadTimeDays: 2 }),
      src({ supplierId: 's2', code: 'BRT-9', price: 3.5, packSize: 12 }),
      src({ supplierId: 's3' }),
    ],
  });

  it('finds the cheapest priced source, and says what switching saves', () => {
    expect(cheapestSource(product).supplierId).toBe('s2');
    expect(savingPerUnit(product)).toBe(0.5);
    // Nothing to compare: one price, or the preferred one already cheapest.
    expect(savingPerUnit(p({ supplierId: 's1' }))).toBeNull();
    expect(cheapestSource(p({ supplierId: 's1' }))).toBeNull();
  });

  it('reads a supplier\u2019s own code and price', () => {
    expect(codeFor(product, 's2')).toBe('BRT-9');
    expect(codeFor(product, 's3')).toBe('');
    expect(priceFrom(product, 's1')).toBe(4);
    expect(priceFrom(product, 's3')).toBeNull();
    expect(sourceFor(product, 'nope')).toBeNull();
  });

  it('falls back from the source to the supplier for lead time and pack', () => {
    const supplier = { id: 's2', leadTimeDays: 9 };
    expect(leadTimeFrom(sourceFor(product, 's2'), supplier)).toBe(9);
    expect(leadTimeFrom(sourceFor(product, 's1'), supplier)).toBe(2);
    expect(leadTimeFrom(null, null)).toBeNull();
    expect(packSizeFrom(sourceFor(product, 's2'), product)).toBe(12);
    expect(packSizeFrom(sourceFor(product, 's1'), { ...product, packSize: 6 })).toBe(6);
    expect(packSizeFrom(sourceFor(product, 's1'), product)).toBe(0);
  });
});

describe('supplierPriceList', () => {
  const products = [
    p({
      id: 'a',
      name: 'Mouse',
      supplierId: 's1',
      sources: [src({ supplierId: 's1', code: 'APX-1', price: 4, preferred: true }), src({ supplierId: 's2', price: 3.5 })],
    }),
    p({ id: 'b', name: 'Beans', supplierId: 's2', sources: [src({ supplierId: 's2', price: 9, preferred: true })] }),
    p({ id: 'c', name: 'Retired', supplierId: 's1', archived: true }),
  ];

  it('lists what a supplier supplies, with the comparison against the cheapest', () => {
    const rows = supplierPriceList(products, 's1');
    expect(rows.map((r) => r.product.id)).toEqual(['a']);
    expect(rows[0]).toMatchObject({ preferred: true, cheapest: false, undercutBy: 0.5 });
  });

  it('marks the cheapest only when there is another price to beat', () => {
    const forS2 = supplierPriceList(products, 's2');
    expect(forS2.map((r) => r.product.id)).toEqual(['Beans', 'Mouse'].map((n) => products.find((x) => x.name === n).id));
    expect(forS2.find((r) => r.product.id === 'a')).toMatchObject({ cheapest: true, undercutBy: null });
    // 'Beans' has one source, so "cheapest" would be a comparison with nothing.
    expect(forS2.find((r) => r.product.id === 'b')).toMatchObject({ cheapest: false, preferred: true });
  });

  it('leaves archived products out', () => {
    expect(supplierPriceList(products, 's1').some((r) => r.product.archived)).toBe(false);
  });
});
