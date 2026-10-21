/**
 * Variant families: one product the owner thinks of as a single thing —
 * a shirt, a coffee, a cable — kept as the several real things it
 * actually is on the shelf.
 *
 * The catalogue was flat, so every size, colour, grind or flavour was an
 * unrelated product: four rows with copy-pasted names, categories,
 * suppliers, thresholds and photos, and a change to any shared detail
 * was four edits. Bulk edit and Duplicate exist because of exactly that,
 * and they only make the copying cheaper.
 *
 * The shape here is deliberate: **a variant is an ordinary product**.
 * It keeps its own SKU, barcode, stock buckets, lots, minimums, bins,
 * cost and history, so scanning, counting, ordering, reporting and the
 * activity log all keep working at the level of real things without
 * knowing families exist. What the family record adds is the shared
 * half — the name, the category, the unit, the supplier, the price, the
 * threshold — held once, and applied to its variants in one write when
 * it changes.
 *
 * Two axes at most and no matrix generator: a family with an "Add
 * variant" row covers what a small shop keeps, and stops this becoming a
 * merchandising system. Pure — no DOM, no Puter; unit-tested.
 */

import { stockStatus, DEFAULT_LOW_STOCK } from './inventory.js';
import { isCountUnit } from './units.js';
import { round2 } from './util.js';

/** Most axes a family may have. Two is a grid; three is a spreadsheet. */
export const MAX_AXES = 2;

/** Fields a family owns on behalf of its variants. */
export const SHARED_FIELDS = [
  'category', 'unit', 'supplierId', 'price', 'lowStock', 'reorderQty',
  'packSize', 'packName', 'trackExpiry', 'notes', 'imagePath', 'locationId',
];

/** Axis names, trimmed, deduplicated, and capped at MAX_AXES. */
export function normalizeAxes(list) {
  const out = [];
  for (const raw of list || []) {
    const name = String(raw ?? '').trim().slice(0, 24);
    if (!name || out.some((x) => x.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
    if (out.length >= MAX_AXES) break;
  }
  return out;
}

/** One variant's axis values, keyed by axis name, blanks dropped. */
export function normalizeValues(values, axes) {
  const out = {};
  for (const axis of normalizeAxes(axes)) {
    const value = String(values?.[axis] ?? '').trim().slice(0, 40);
    if (value) out[axis] = value;
  }
  return out;
}

/**
 * A variant's values after its family's axes changed. Values follow
 * their axis by name, case-insensitively — so "Size" becoming "size"
 * keeps every M and L — and, when the family still has the same number
 * of axes, by position: the axis that used to sit where a new name now
 * sits was renamed, not removed, so "Colour" becoming "Color" carries
 * "Navy" over instead of dropping it from every variant and collapsing
 * their names to the family's. An axis that really went away takes its
 * values with it, and a new one starts empty.
 */
export function remapAxisValues(values, fromAxes, toAxes) {
  const from = normalizeAxes(fromAxes);
  const to = normalizeAxes(toAxes);
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const out = {};
  to.forEach((axis, i) => {
    let source = from.find((old) => same(old, axis));
    if (!source && from.length === to.length) {
      const old = from[i];
      // Only an old name that is nowhere in the new list was renamed;
      // one still present has merely moved, and keeps its own values.
      if (old && !to.some((kept) => same(kept, old))) source = old;
    }
    if (source !== undefined && values?.[source] !== undefined) out[axis] = values[source];
  });
  return normalizeValues(out, to);
}

/** "M / Navy" — what distinguishes this variant, in axis order. */
export function variantLabel(values, axes) {
  return normalizeAxes(axes)
    .map((axis) => values?.[axis])
    .filter(Boolean)
    .join(' / ');
}

/**
 * A variant's full name: the family's, then what makes it different.
 * It's a real name on a real product, because the activity log, order
 * lines, labels and reports all keep names — a variant that reads as
 * "Cotton Shirt" in the log with three siblings would be unreadable.
 */
export function variantName(family, values) {
  const base = String(family?.name ?? '').trim();
  const label = variantLabel(values, family?.axes);
  if (!base) return label;
  return label ? `${base}: ${label}` : base;
}

/** The variants of one family, in axis order then name. */
export function familyVariants(products, familyId) {
  return (products || [])
    .filter((p) => p.familyId === familyId)
    .sort((a, b) => variantOrder(a, b));
}

const variantOrder = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { numeric: true, sensitivity: 'base' });

/**
 * What a family adds up to: units on hand (counted products only, the
 * same rule every other total keeps), value at cost, and the worst
 * status among its variants — a family with one size out of stock is not
 * "in stock".
 */
export function familyTotals(variants, defaultLow = DEFAULT_LOW_STOCK) {
  const totals = {
    variants: variants.length, units: 0, measured: 0, value: 0,
    status: 'ok', low: 0, out: 0,
  };
  for (const p of variants) {
    const qty = Number(p.quantity) || 0;
    if (isCountUnit(p.unit)) totals.units = round3(totals.units + qty);
    else totals.measured++;
    totals.value = round2(totals.value + qty * (Number(p.cost) || 0));
    const status = stockStatus(p, defaultLow);
    if (status === 'out') totals.out++;
    else if (status === 'low') totals.low++;
  }
  totals.status = totals.out ? 'out' : (totals.low ? 'low' : 'ok');
  return totals;
}

/**
 * Group a list of products into list rows: a family collapses to one
 * row carrying its variants, a standalone product stays itself. Order
 * follows the input, taking each family's place from its first variant —
 * so whatever sorted the products sorts the families too.
 *
 * Families are grouped over the products *given*, which is the filtered
 * list: a search for "navy" shows the family with the variants that
 * matched, not the ones that didn't.
 */
export function groupVariantRows(products, families = [], defaultLow = DEFAULT_LOW_STOCK) {
  const byId = new Map((families || []).map((f) => [f.id, f]));
  const rows = [];
  const at = new Map();
  for (const product of products || []) {
    const family = product.familyId ? byId.get(product.familyId) : null;
    if (!family) {
      rows.push({ kind: 'product', id: product.id, product });
      continue;
    }
    const seen = at.get(family.id);
    if (seen !== undefined) {
      rows[seen].variants.push(product);
      continue;
    }
    at.set(family.id, rows.length);
    rows.push({ kind: 'family', id: family.id, family, variants: [product] });
  }
  for (const row of rows) {
    if (row.kind !== 'family') continue;
    row.variants.sort(variantOrder);
    row.totals = familyTotals(row.variants, defaultLow);
  }
  return rows;
}

/**
 * A family row as something the product sorters understand: the shared
 * name, the family's total on hand, its value, and the newest change
 * among its variants. Cost is the weighted average of what its stock
 * actually cost, which is the only cost a family can honestly claim.
 */
export function familyAsProduct(family, variants, totals) {
  const units = variants.reduce((n, p) => n + (Number(p.quantity) || 0), 0);
  return {
    id: family.id,
    name: family.name,
    sku: '',
    category: family.category || '',
    unit: family.unit || 'each',
    quantity: round3(units),
    cost: units > 0 ? round2(totals.value / units) : 0,
    updatedAt: variants.reduce((n, p) => Math.max(n, Number(p.updatedAt) || 0), 0),
    archived: variants.every((p) => p.archived),
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;
