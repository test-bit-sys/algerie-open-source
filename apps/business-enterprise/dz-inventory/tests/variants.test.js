import { describe, it, expect } from 'vitest';
import {
  MAX_AXES, normalizeAxes, normalizeValues, remapAxisValues, variantLabel, variantName,
  familyVariants, familyTotals, groupVariantRows, familyAsProduct,
} from '../src/lib/variants.js';

const p = (over = {}) => ({
  id: 'p1', name: 'Shirt', unit: 'each', quantity: 4, cost: 5,
  lowStock: null, archived: false, updatedAt: 10, ...over,
});
const fam = (over = {}) => ({ id: 'f1', name: 'Cotton Shirt', axes: ['Size', 'Colour'], ...over });

describe('axes and values', () => {
  it('trims, deduplicates, and caps the axes', () => {
    expect(normalizeAxes([' Size ', 'size', 'Colour', 'Fit'])).toEqual(['Size', 'Colour']);
    expect(normalizeAxes(['', null, 'Size'])).toEqual(['Size']);
    expect(normalizeAxes([]).length).toBe(0);
    expect(normalizeAxes(['a', 'b', 'c']).length).toBe(MAX_AXES);
  });

  it('keeps only values for the axes that exist', () => {
    expect(normalizeValues({ Size: ' M ', Colour: 'Navy', Fit: 'Slim' }, ['Size', 'Colour']))
      .toEqual({ Size: 'M', Colour: 'Navy' });
    expect(normalizeValues({ Size: '  ' }, ['Size'])).toEqual({});
    expect(normalizeValues(null, ['Size'])).toEqual({});
  });

  it('labels a variant by its values, in axis order', () => {
    expect(variantLabel({ Colour: 'Navy', Size: 'M' }, ['Size', 'Colour'])).toBe('M / Navy');
    expect(variantLabel({ Size: 'M' }, ['Size', 'Colour'])).toBe('M');
    expect(variantLabel({}, ['Size'])).toBe('');
  });

  it('carries values across a renamed axis', () => {
    // A typo fixed in the axis name is the same axis, not a new one.
    expect(remapAxisValues({ Size: 'M', Colour: 'Navy' }, ['Size', 'Colour'], ['Size', 'Color']))
      .toEqual({ Size: 'M', Color: 'Navy' });
    expect(remapAxisValues({ Size: 'M' }, ['Size'], ['Sizes'])).toEqual({ Sizes: 'M' });
    // A change of case is still the same name.
    expect(remapAxisValues({ Size: 'M' }, ['Size'], ['size'])).toEqual({ size: 'M' });
  });

  it('keeps values by name when axes are reordered, added, or dropped', () => {
    expect(remapAxisValues({ Size: 'M', Colour: 'Navy' }, ['Size', 'Colour'], ['Colour', 'Size']))
      .toEqual({ Colour: 'Navy', Size: 'M' });
    expect(remapAxisValues({ Size: 'M' }, ['Size'], ['Size', 'Colour'])).toEqual({ Size: 'M' });
    expect(remapAxisValues({ Size: 'M', Colour: 'Navy' }, ['Size', 'Colour'], ['Size'])).toEqual({ Size: 'M' });
    // An axis that stays under its own name isn't the one being renamed,
    // whatever position it ends up in.
    expect(remapAxisValues({ Size: 'M', Colour: 'Navy' }, ['Size', 'Colour'], ['Colour', 'Fit']))
      .toEqual({ Colour: 'Navy' });
    expect(remapAxisValues(null, ['Size'], ['Sizes'])).toEqual({});
  });

  it('names a variant with the family first', () => {
    expect(variantName(fam(), { Size: 'M', Colour: 'Navy' })).toBe('Cotton Shirt: M / Navy');
    // No values yet: the family's name stands alone rather than trailing
    // a separator into nothing.
    expect(variantName(fam(), {})).toBe('Cotton Shirt');
    expect(variantName({ name: '', axes: ['Size'] }, { Size: 'M' })).toBe('M');
  });
});

describe('familyTotals', () => {
  it('adds up units and value, and takes the worst status', () => {
    const totals = familyTotals([
      p({ id: 'a', quantity: 10, cost: 2 }),
      p({ id: 'b', quantity: 1, cost: 3, lowStock: 5 }),
    ], 5);
    expect(totals).toMatchObject({ variants: 2, units: 11, measured: 0, value: 23, status: 'low', low: 1, out: 0 });
  });

  it('is out of stock when any variant is — a missing size is not "in stock"', () => {
    const totals = familyTotals([p({ id: 'a', quantity: 40 }), p({ id: 'b', quantity: 0 })], 5);
    expect(totals).toMatchObject({ status: 'out', out: 1 });
  });

  it('leaves measured variants out of a count of items', () => {
    const totals = familyTotals([p({ id: 'a', quantity: 3 }), p({ id: 'b', unit: 'kg', quantity: 2.5 })], 5);
    expect(totals).toMatchObject({ units: 3, measured: 1 });
  });
});

describe('groupVariantRows', () => {
  const family = fam({ axes: ['Size'] });
  const products = [
    p({ id: 'loose', name: 'Mouse' }),
    p({ id: 'm', name: 'Cotton Shirt: M', familyId: 'f1', axes: { Size: 'M' }, quantity: 4 }),
    p({ id: 's', name: 'Cotton Shirt: S', familyId: 'f1', axes: { Size: 'S' }, quantity: 2 }),
    p({ id: 'orphan', name: 'Ghost', familyId: 'gone' }),
  ];

  it('collapses a family into one row, in the order the products came', () => {
    const rows = groupVariantRows(products, [family], 5);
    expect(rows.map((r) => r.kind)).toEqual(['product', 'family', 'product']);
    expect(rows[1].variants.map((v) => v.id)).toEqual(['m', 's']);
    expect(rows[1].totals).toMatchObject({ variants: 2, units: 6 });
  });

  it('reads a product whose family is gone as a plain product', () => {
    const rows = groupVariantRows([products[3]], [family], 5);
    expect(rows).toEqual([{ kind: 'product', id: 'orphan', product: products[3] }]);
  });

  it('groups over the products given, so a filtered list groups what matched', () => {
    const rows = groupVariantRows([products[1]], [family], 5);
    expect(rows[0].variants.map((v) => v.id)).toEqual(['m']);
    expect(rows[0].totals.units).toBe(4);
  });
});

describe('familyAsProduct', () => {
  it('presents a family to the sorters as what it adds up to', () => {
    const variants = [
      p({ id: 'a', quantity: 10, cost: 2, updatedAt: 50 }),
      p({ id: 'b', quantity: 10, cost: 4, updatedAt: 90 }),
    ];
    const totals = familyTotals(variants, 5);
    const row = familyAsProduct(fam(), variants, totals);
    expect(row).toMatchObject({ name: 'Cotton Shirt', quantity: 20, cost: 3, updatedAt: 90, archived: false });
  });

  it('is archived only when every variant is', () => {
    const some = [p({ id: 'a', archived: true }), p({ id: 'b' })];
    expect(familyAsProduct(fam(), some, familyTotals(some, 5)).archived).toBe(false);
    const all = [p({ id: 'a', archived: true }), p({ id: 'b', archived: true })];
    expect(familyAsProduct(fam(), all, familyTotals(all, 5)).archived).toBe(true);
  });
});

describe('familyVariants', () => {
  it('picks a family’s variants out of the products, in readable order', () => {
    const list = [
      p({ id: 'b', name: 'Shirt: M', familyId: 'f1' }),
      p({ id: 'a', name: 'Shirt: 10', familyId: 'f1' }),
      p({ id: 'x', name: 'Other', familyId: 'f2' }),
    ];
    expect(familyVariants(list, 'f1').map((v) => v.id)).toEqual(['a', 'b']);
    expect(familyVariants(list, 'nope')).toEqual([]);
  });
});
