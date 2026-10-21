import { describe, it, expect } from 'vitest';
import {
  KIT_MODES, kitMode, isKit, holdsStock, componentList, normalizeComponents,
  componentRows, buildableQty, limitingComponent, componentsFor, kitUnitCost,
  recipeSummary, kitsUsing,
} from '../src/lib/kits.js';

const p = (over = {}) => ({
  id: 'p1', name: 'Thing', unit: 'each', quantity: 10, cost: 2, archived: false, ...over,
});

const beans = p({ id: 'beans', name: 'Coffee beans', unit: 'kg', quantity: 2, cost: 20 });
const cup = p({ id: 'cup', name: 'Cup', quantity: 40, cost: 0.2 });
const lid = p({ id: 'lid', name: 'Lid', quantity: 3, cost: 0.1 });
const set = p({
  id: 'set', name: 'Breakfast set', kit: 'sell', quantity: 0,
  components: [{ productId: 'beans', qty: 0.02 }, { productId: 'cup', qty: 1 }, { productId: 'lid', qty: 1 }],
});
const catalogue = [beans, cup, lid, set];

describe('what counts as a kit', () => {
  it('needs both a known mode and a recipe', () => {
    expect(kitMode(set)).toBe('sell');
    expect(isKit(set)).toBe(true);
    expect(kitMode(p({ kit: 'build', components: [] }))).toBe('');
    expect(kitMode(p({ kit: 'nonsense', components: [{ productId: 'cup', qty: 1 }] }))).toBe('');
    expect(isKit(p())).toBe(false);
    expect(KIT_MODES.map((m) => m.key)).toEqual(['build', 'sell']);
  });

  it('knows which kits hold stock of their own', () => {
    expect(holdsStock(p())).toBe(true);
    expect(holdsStock(p({ kit: 'build', components: [{ productId: 'cup', qty: 1 }] }))).toBe(true);
    expect(holdsStock(set)).toBe(false);
  });

  it('cleans a raw recipe without needing the catalogue', () => {
    expect(componentList({ components: [
      { productId: 'a', qty: 2 },
      { productId: 'a', qty: 5 },
      { productId: '', qty: 1 },
      { productId: 'b', qty: 0 },
      { productId: 'c', qty: 'x' },
    ] })).toEqual([{ productId: 'a', qty: 2 }]);
    expect(componentList(null)).toEqual([]);
  });
});

describe('normalizeComponents', () => {
  it('keeps real, non-kit products only — one level deep', () => {
    const list = normalizeComponents([
      { productId: 'cup', qty: 2 },
      { productId: 'set', qty: 1 },     // a kit can't be a component
      { productId: 'gone', qty: 1 },    // no such product
      { productId: 'self', qty: 1 },    // never itself
      { productId: 'cup', qty: 9 },     // no duplicates
    ], catalogue, { selfId: 'self' });
    expect(list).toEqual([{ productId: 'cup', qty: 2 }]);
  });

  it('rounds each quantity to what its own unit can express', () => {
    expect(normalizeComponents([{ productId: 'cup', qty: 2.6 }], catalogue)).toEqual([{ productId: 'cup', qty: 3 }]);
    expect(normalizeComponents([{ productId: 'beans', qty: 0.0205 }], catalogue)).toEqual([{ productId: 'beans', qty: 0.021 }]);
    expect(normalizeComponents([{ productId: 'cup', qty: 0 }], catalogue)).toEqual([]);
  });
});

describe('availability from components', () => {
  it.each([
    [0.3, 0.1, 3],
    [0.6, 0.2, 3],
    [0.299, 0.1, 2],
    [0.099, 0.1, 0],
  ])('allows the complete kits in %s kg at %s kg each', (quantity, qty, expected) => {
    const part = p({ id: 'ingredient', unit: 'kg', quantity });
    const kit = p({ kit: 'build', components: [{ productId: part.id, qty }] });
    expect(buildableQty(kit, [part, kit])).toBe(expected);
  });

  it('is as many whole kits as the shortest component allows', () => {
    // 2kg of beans allows 100, 40 cups allow 40, 3 lids allow 3.
    expect(buildableQty(set, catalogue)).toBe(3);
    expect(limitingComponent(set, catalogue).productId).toBe('lid');
  });

  it('is zero when a component is missing from the catalogue', () => {
    const broken = p({ id: 'k', kit: 'build', components: [{ productId: 'ghost', qty: 1 }] });
    expect(buildableQty(broken, catalogue)).toBe(0);
    expect(componentRows(broken, catalogue)[0]).toMatchObject({ missing: true, allows: 0 });
    expect(buildableQty(p(), catalogue)).toBe(0);
  });

  it('reports each component\u2019s stock and what it allows', () => {
    const rows = componentRows(set, catalogue);
    expect(rows.map((r) => [r.productId, r.allows])).toEqual([['beans', 100], ['cup', 40], ['lid', 3]]);
    expect(rows[0]).toMatchObject({ qty: 0.02, onHand: 2 });
  });
});

describe('what a kit takes and costs', () => {
  it('multiplies the recipe, rounding each component\u2019s own unit', () => {
    expect(componentsFor(set, 3, catalogue)).toEqual([
      { productId: 'beans', qty: 0.06, unit: 'kg', name: 'Coffee beans' },
      { productId: 'cup', qty: 3, unit: 'each', name: 'Cup' },
      { productId: 'lid', qty: 3, unit: 'each', name: 'Lid' },
    ]);
    expect(componentsFor(set, 0, catalogue)).toEqual([]);
  });

  it('costs one kit at what its parts cost now', () => {
    // 0.02kg × £20 + 1 × £0.20 + 1 × £0.10
    expect(kitUnitCost(set, catalogue)).toBe(0.7);
    expect(kitUnitCost(p(), catalogue)).toBe(0);
  });

  it('summarizes a recipe in one line', () => {
    expect(recipeSummary(set, catalogue)).toBe('0.02 × Coffee beans, 1 × Cup, 1 × Lid');
    expect(recipeSummary(p({ kit: 'build', components: [{ productId: 'ghost', qty: 2 }] }), catalogue))
      .toBe('2 × deleted product');
  });

  it('finds the kits a product is part of', () => {
    expect(kitsUsing('cup', catalogue).map((k) => k.id)).toEqual(['set']);
    expect(kitsUsing('set', catalogue)).toEqual([]);
  });
});
