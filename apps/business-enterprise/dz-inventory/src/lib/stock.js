/**
 * Per-location stock. A product holds `stock: { [locationId]: qty }`
 * with '' as the bucket for stock that isn't assigned anywhere, and
 * `quantity` as a cached total the store rewrites on every change — the
 * map is the truth, the total is there so lists, sorting, stats, and
 * CSV can stay simple.
 *
 * `locationId` on the product remains its default location: where new
 * stock lands, and what the single-location workflow keeps using.
 */

import { roundQty } from './units.js';

/** Bucket key for stock with no location. */
export const UNASSIGNED = '';

export const UNASSIGNED_LABEL = 'No location';

/**
 * How filters and URLs name the unassigned bucket. Its real key is '',
 * which every "no filter" check would swallow.
 */
export const NO_LOCATION = '__none__';

/** Filter value → bucket key. */
export const bucketKey = (value) => (value === NO_LOCATION ? UNASSIGNED : value);

/** Normalized { locationId: qty } — always an object, never zeros. */
export function stockMap(product) {
  const out = {};
  const raw = product?.stock;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const n = Number(value) || 0;
      if (n > 0) out[key] = n;
    }
  }
  return out;
}

/** [locationId, qty] pairs, largest holding first. */
export function stockEntries(product) {
  return Object.entries(stockMap(product)).sort((a, b) => b[1] - a[1]);
}

export function totalStock(product) {
  let total = 0;
  for (const n of Object.values(stockMap(product))) total += n;
  return Math.round(total * 1000) / 1000;
}

export function stockAt(product, locationId) {
  return stockMap(product)[locationId ?? UNASSIGNED] || 0;
}

export function locationCount(product) {
  return stockEntries(product).length;
}

/**
 * Where a stock change should land by default: the product's own
 * location if it has one, else wherever its stock already sits, else
 * the unassigned bucket.
 */
export function defaultLocationId(product) {
  if (product?.locationId) return product.locationId;
  const entries = stockEntries(product);
  return entries.length === 1 ? entries[0][0] : UNASSIGNED;
}

/** Does this product count as being at `locationId`? */
export function isAtLocation(product, locationId) {
  const key = locationId ?? UNASSIGNED;
  if (stockAt(product, key) > 0) return true;
  // A place with a minimum for this product is a place the product
  // belongs, whether or not any is there right now — an empty shelf with
  // a minimum of six is the whole reason minimums exist, and hiding it
  // from its own location would hide it from the list that fixes it.
  if (minAt(product, key) > 0) return true;
  // With nothing on hand anywhere, the product still belongs to its
  // default location — otherwise a location filter would hide the very
  // out-of-stock items you went looking for.
  return totalStock(product) === 0 && (product?.locationId || UNASSIGNED) === key;
}

/**
 * Return a new stock map with `locationId` set to `qty` (rounded for the
 * product's unit). Zero or less removes the bucket.
 */
export function withStockAt(product, locationId, qty) {
  const map = stockMap(product);
  const key = locationId ?? UNASSIGNED;
  const n = roundQty(qty, product?.unit);
  if (n > 0) map[key] = n;
  else delete map[key];
  return map;
}

/* ---------- Per-location minimums ---------- */

/**
 * What each place should hold: `min: { [locationId]: qty }`, the same
 * per-location shape as `stock` and `lots`, so it migrates and merges
 * the way they do. Absent or zero everywhere means the app behaves
 * exactly as it did before minimums existed.
 */
export function minMap(product) {
  const out = {};
  const raw = product?.min;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const n = Number(value) || 0;
      if (n > 0) out[key] = n;
    }
  }
  return out;
}

/** [locationId, qty] pairs of stated minimums, largest first. */
export function minEntries(product) {
  return Object.entries(minMap(product)).sort((a, b) => b[1] - a[1]);
}

export function minAt(product, locationId) {
  return minMap(product)[locationId ?? UNASSIGNED] || 0;
}

/** Does this product state a minimum anywhere at all? */
export function hasMinimums(product) {
  return Object.keys(minMap(product)).length > 0;
}

/**
 * A new minimums map with `locationId` set to `qty` (rounded for the
 * product's unit). Zero or less removes it — "no minimum here" is the
 * absence of a number, not a zero to compare against.
 */
export function withMinAt(product, locationId, qty) {
  const map = minMap(product);
  const key = locationId ?? UNASSIGNED;
  const n = roundQty(qty, product?.unit);
  if (n > 0) map[key] = n;
  else delete map[key];
  return map;
}

/**
 * How far below its minimum this place is: what would have to arrive
 * for the shelf to be right again. Zero when there's no minimum, or the
 * shelf already holds it.
 */
export function shortfallAt(product, locationId) {
  const min = minAt(product, locationId);
  if (!min) return 0;
  const held = stockAt(product, locationId);
  return held >= min ? 0 : roundQty(min - held, product?.unit);
}

/** Is this product short of its minimum anywhere? */
export function belowMinimumAnywhere(product) {
  return minEntries(product).some(([locationId]) => shortfallAt(product, locationId) > 0);
}

/* ---------- Shelf and bin codes ---------- */

/**
 * Where a product actually sits inside a place: `bin: { [locationId]:
 * 'A3-12' }`, the same per-location shape as `stock`, `lots` and `min`.
 *
 * A short string, not a hierarchy: no zones, aisles, capacities, or
 * bin-to-bin rules. Sorting these as text is what makes "A3-12 before
 * B1-01" work without inventing a grammar. Blank everywhere is exactly
 * the app as it was.
 */
export function binMap(product) {
  const out = {};
  const raw = product?.bin;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const code = String(value ?? '').trim().slice(0, 24);
      if (code) out[key] = code;
    }
  }
  return out;
}

/** [locationId, code] pairs, in bin-code order. */
export function binEntries(product) {
  return Object.entries(binMap(product)).sort((a, b) => compareBins(a[1], b[1]));
}

export function binAt(product, locationId) {
  return binMap(product)[locationId ?? UNASSIGNED] || '';
}

/** Does this product have a shelf code anywhere? */
export function hasBins(product) {
  return Object.keys(binMap(product)).length > 0;
}

/**
 * A new bin map with `locationId` set to `code`. An empty string removes
 * it — a place with no code is a place nobody has written one for.
 */
export function withBinAt(product, locationId, code) {
  const map = binMap(product);
  const key = locationId ?? UNASSIGNED;
  const clean = String(code ?? '').trim().slice(0, 24);
  if (clean) map[key] = clean;
  else delete map[key];
  return map;
}

/**
 * Compare two bin codes for a walk through the room: as text, case- and
 * accent-insensitively, with numbers inside the code read as numbers so
 * A2 comes before A10 the way a person walking the aisle expects.
 * Codeless rows sort last — they have no place in the room to be at.
 */
export function compareBins(a, b) {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Bring a v1 product (single quantity + locationId) up to the per
 * location model. Idempotent: products that already carry a map pass
 * through with their total re-derived.
 */
export function migrateProduct(p) {
  const product = { ...p };
  if (product.stock && typeof product.stock === 'object' && !Array.isArray(product.stock)) {
    product.stock = stockMap(product);
  } else {
    const qty = Math.max(0, Number(product.quantity) || 0);
    product.stock = qty > 0 ? { [product.locationId || UNASSIGNED]: qty } : {};
  }
  product.quantity = totalStock(product);
  return product;
}
