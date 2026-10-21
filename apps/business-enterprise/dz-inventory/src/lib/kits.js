/**
 * Kits and bundles: one product made of others.
 *
 * Every product's stock was independent, so anything made of other
 * things had to be tracked in someone's head — a café's breakfast set, a
 * workshop's assembled kit, a three-pack of something also sold singly.
 * Selling one meant remembering to remove three or four components in
 * three or four separate dialogs at the busiest moment of the day, so it
 * got skipped and the component counts drifted until a stocktake found
 * it.
 *
 * A kit is a product with `components: [{ productId, qty }]` and a mode:
 *
 *   'build' — make N of it: the components are consumed and N lands in
 *             its own stock, at what the components cost that day. For
 *             kits assembled ahead of time.
 *   'sell'  — it holds no stock of its own; removing one removes its
 *             components. For the breakfast set.
 *
 * **One level deep**: a component cannot itself be a kit. That single
 * constraint keeps the maths one pass, keeps the UI a flat list, and
 * avoids the entire BOM-explosion problem this otherwise turns into.
 *
 * Pure — no DOM, no Puter; unit-tested.
 */

import { roundQty, isCountUnit, qtyValue } from './units.js';
import { round2, asList } from './util.js';

export const KIT_MODES = [
  { key: 'build', label: 'Build it', hint: 'Make it ahead of time: components out, kit in' },
  { key: 'sell', label: 'Sell as a kit', hint: 'Holds no stock of its own; selling one removes its components' },
];

const MODES = new Set(KIT_MODES.map((m) => m.key));

/** The mode this product is a kit in, or '' when it isn't one. */
export function kitMode(product) {
  const mode = String(product?.kit ?? '');
  if (!MODES.has(mode)) return '';
  return componentList(product).length ? mode : '';
}

export const isKit = (product) => !!kitMode(product);

/** Does this product hold stock of its own? A sell-as-kit never does. */
export const holdsStock = (product) => kitMode(product) !== 'sell';

/** The raw recipe, cleaned of junk but not resolved against products. */
export function componentList(product) {
  const out = [];
  const seen = new Set();
  for (const raw of asList(product?.components)) {
    const productId = raw?.productId;
    if (!productId || typeof productId !== 'string' || seen.has(productId)) continue;
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    seen.add(productId);
    out.push({ productId, qty });
  }
  return out;
}

/**
 * Clean a recipe against the catalogue: real products only, no
 * duplicates, never itself, and never another kit — which is the one
 * level deep rule, enforced where recipes are written rather than
 * everywhere they're read.
 */
export function normalizeComponents(list, products = [], { selfId = null } = {}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out = [];
  const seen = new Set();
  for (const raw of asList(list)) {
    const productId = raw?.productId;
    if (!productId || seen.has(productId) || productId === selfId) continue;
    const part = byId.get(productId);
    if (!part || isKit(part)) continue;
    const qty = roundQty(raw.qty, part.unit);
    if (qty <= 0) continue;
    seen.add(productId);
    out.push({ productId, qty });
  }
  return out;
}

/**
 * The recipe as rows: the component, how many one kit takes, what's on
 * hand, and how many kits that alone would allow. A component that has
 * been deleted is reported as missing rather than silently skipped — a
 * recipe that quietly shrank would build a different thing.
 */
export function componentRows(product, products = []) {
  const byId = new Map(products.map((p) => [p.id, p]));
  return componentList(product).map(({ productId, qty }) => {
    const part = byId.get(productId) || null;
    const onHand = Math.max(0, Number(part?.quantity) || 0);
    const ratio = onHand / qty;
    return {
      productId,
      product: part,
      qty,
      onHand,
      // Whole kits this component allows: a kit is a thing, so a
      // half-built one doesn't count.
      // Decimal division can put an exact fit just below the integer
      // (0.3 / 0.1). Correct only floating-point drift before flooring.
      allows: part ? Math.floor(ratio + Number.EPSILON * Math.max(1, ratio)) : 0,
      missing: !part,
    };
  });
}

/**
 * How many whole kits the components on hand allow. Zero when anything
 * it needs is missing — which is what puts a reason on screen for an
 * empty shelf.
 */
export function buildableQty(product, products = []) {
  const rows = componentRows(product, products);
  if (!rows.length) return 0;
  return rows.reduce((least, row) => Math.min(least, row.allows), Infinity) || 0;
}

/** The component that runs out first — what limits this kit. */
export function limitingComponent(product, products = []) {
  const rows = componentRows(product, products);
  if (!rows.length) return null;
  return rows.reduce((worst, row) => (worst === null || row.allows < worst.allows ? row : worst), null);
}

/** What `n` kits take out of stock, as [{ productId, qty }]. */
export function componentsFor(product, n = 1, products = []) {
  const count = Math.max(0, Number(n) || 0);
  return componentRows(product, products)
    .filter((row) => row.product)
    .map((row) => ({
      productId: row.productId,
      qty: roundQty(row.qty * count, row.product.unit),
      unit: row.product.unit,
      name: row.product.name,
    }))
    .filter((row) => row.qty > 0);
}

/**
 * What one kit costs to make: the sum of its components at what they
 * cost now. This is the number a build feeds into the kit's own moving
 * average, so stock value follows what the parts actually cost.
 */
export function kitUnitCost(product, products = []) {
  let total = 0;
  for (const row of componentRows(product, products)) {
    if (!row.product) continue;
    total = round2(total + qtyValue(row.qty, row.product.cost));
  }
  return round2(total);
}

/** "2 × Coffee beans, 1 × Cup" — a recipe in one line. */
export function recipeSummary(product, products = []) {
  return componentRows(product, products)
    .map((row) => `${formatCount(row.qty, row.product?.unit)} × ${row.product?.name || 'deleted product'}`)
    .join(', ');
}

const formatCount = (n, unit) => (isCountUnit(unit) ? String(Math.round(n)) : String(Math.round(n * 1000) / 1000));

/**
 * What a product's status should be measured against: its own stock,
 * or — for a sell-as-kit, which holds none by design — how many its
 * components allow. "Out of stock" for a kit means its parts have run
 * out, which is the only shortage anyone can act on.
 */
export function availableQty(product, products = []) {
  if (kitMode(product) === 'sell') return buildableQty(product, products);
  return Math.max(0, Number(product?.quantity) || 0);
}

/**
 * Products this one is a component of — what a recipe change or a
 * deletion affects, and what stops a component from becoming a kit
 * itself.
 */
export function kitsUsing(productId, products = []) {
  return (products || []).filter((p) => isKit(p) && componentList(p).some((c) => c.productId === productId));
}
