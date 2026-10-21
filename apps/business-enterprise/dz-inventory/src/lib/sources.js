/**
 * Where a product can be bought: `sources: [{ supplierId, code, price,
 * packSize, leadTimeDays, preferred }]`.
 *
 * Anything staple is bought from two or three suppliers depending on
 * price and who has it, and a single `supplierId` had no room for the
 * second one — picking one lost the other's price, its order code, and
 * its lead time, so "who is cheapest for this right now?" was a question
 * the app couldn't answer even though the owner asks it every time they
 * order.
 *
 * A product with one supplier needs no sources at all: `sourcesOf` reads
 * `supplierId` as the first, preferred source, so nothing has to be
 * migrated and nothing changes for anyone who doesn't need this. Once a
 * second source is added the array is written in full, and the store
 * keeps `supplierId` pointing at the preferred one — the way `quantity`
 * caches the stock buckets — so every filter, report and reorder group
 * that reads it keeps working untouched.
 *
 * One price per source: no price breaks, no quantity tiers, no
 * contracts, no per-source currency. What a note from a phone call
 * actually contains. Pure — no DOM, no Puter; unit-tested.
 */

import { round2, asList } from './util.js';
import { roundQty } from './units.js';

/** A source's price, or null when nobody has written one down. */
function priceOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

/** A whole positive day count, or null when unusable. */
function daysOf(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Clean a list of sources: real supplier ids only, one entry per
 * supplier, exactly one preferred (the first one that claims it, else
 * the first entry). Order is kept — it's the order the form shows.
 */
export function normalizeSources(list, { unit = 'each' } = {}) {
  const out = [];
  const seen = new Set();
  const listed = asList(list);
  for (const raw of listed) {
    const supplierId = raw?.supplierId;
    if (!supplierId || typeof supplierId !== 'string' || seen.has(supplierId)) continue;
    seen.add(supplierId);
    out.push({
      supplierId,
      code: String(raw.code ?? '').trim().slice(0, 60),
      price: priceOf(raw.price),
      packSize: roundQty(raw.packSize, unit) > 1 ? roundQty(raw.packSize, unit) : 0,
      leadTimeDays: daysOf(raw.leadTimeDays),
      preferred: false,
    });
  }
  if (!out.length) return out;
  const first = listed.findIndex((raw) => raw?.preferred && out.some((s) => s.supplierId === raw.supplierId));
  const preferred = first === -1 ? out[0] : out.find((s) => s.supplierId === listed[first].supplierId);
  preferred.preferred = true;
  return out;
}

/**
 * Every source for this product, preferred first.
 *
 * A product that never grew a second source reads as one derived from
 * `supplierId` — with no price of its own, because `cost` is the moving
 * average of what stock actually cost, not what a supplier charges, and
 * quietly presenting one as the other is how a price list starts lying.
 */
export function sourcesOf(product) {
  const listed = normalizeSources(product?.sources, { unit: product?.unit });
  if (listed.length) {
    return [...listed].sort((a, b) => (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0));
  }
  if (!product?.supplierId) return [];
  return [{
    supplierId: product.supplierId,
    code: '',
    price: null,
    packSize: 0,
    leadTimeDays: null,
    preferred: true,
    derived: true,
  }];
}

/** The source an order goes to unless someone says otherwise. */
export function preferredSource(product) {
  const sources = sourcesOf(product);
  return sources.find((s) => s.preferred) || sources[0] || null;
}

/** This product's source for one supplier, or null. */
export function sourceFor(product, supplierId) {
  if (!supplierId) return null;
  return sourcesOf(product).find((s) => s.supplierId === supplierId) || null;
}

/** Does this product name more than one place to buy it? */
export function hasChoice(product) {
  return sourcesOf(product).length > 1;
}

/**
 * The cheapest source with a price, or null when nobody's price is
 * written down. Shown, never chosen: the app doesn't re-source anything
 * on its own.
 */
export function cheapestSource(product) {
  let best = null;
  for (const source of sourcesOf(product)) {
    if (source.price === null) continue;
    if (!best || source.price < best.price) best = source;
  }
  return best;
}

/**
 * What switching from the preferred source to the cheapest one would
 * save per unit, or null when there's nothing to compare — the number
 * that makes the choice visible while it's being made.
 */
export function savingPerUnit(product) {
  const preferred = preferredSource(product);
  const cheapest = cheapestSource(product);
  if (!preferred || !cheapest || preferred.price === null) return null;
  if (cheapest.supplierId === preferred.supplierId) return null;
  const diff = round2(preferred.price - cheapest.price);
  return diff > 0 ? diff : null;
}

/** The supplier's own code for this product, for the order sheet. */
export function codeFor(product, supplierId) {
  return sourceFor(product, supplierId)?.code || '';
}

/**
 * What a unit costs from this supplier — the source's own price, and
 * failing that nothing. Callers decide whether to fall back to the
 * product's average cost; this function never invents a price.
 */
export function priceFrom(product, supplierId) {
  return sourceFor(product, supplierId)?.price ?? null;
}

/**
 * How long this supplier takes for this product: the source's own lead
 * time when it has one, else the supplier's usual.
 */
export function leadTimeFrom(source, supplier) {
  return daysOf(source?.leadTimeDays) ?? daysOf(supplier?.leadTimeDays) ?? null;
}

/** Units per pack when ordering from this source: its own, else the product's. */
export function packSizeFrom(source, product) {
  const own = roundQty(source?.packSize, product?.unit);
  if (own > 1) return own;
  const theirs = roundQty(product?.packSize, product?.unit);
  return theirs > 1 ? theirs : 0;
}

/**
 * Everything a supplier supplies, as a price list: one row per product
 * that names them, with their code, their price, and what the account
 * currently pays on average — the comparison a supplier page is for.
 */
export function supplierPriceList(products, supplierId) {
  const rows = [];
  for (const product of products || []) {
    if (product.archived) continue;
    const source = sourceFor(product, supplierId);
    if (!source) continue;
    const cheapest = cheapestSource(product);
    // "Cheapest" only means something against another price; the only
    // source on file is not a comparison.
    const compared = sourcesOf(product).filter((x) => x.price !== null).length > 1;
    rows.push({
      product,
      source,
      preferred: !!source.preferred,
      // Is this supplier the cheapest of the ones on file for it?
      cheapest: compared && !!cheapest && cheapest.supplierId === supplierId,
      // What another source would charge instead, when it's less.
      undercutBy: cheapest && source.price !== null && cheapest.supplierId !== supplierId
        ? round2(source.price - cheapest.price)
        : null,
    });
  }
  return rows.sort((a, b) => a.product.name.localeCompare(b.product.name, undefined, { sensitivity: 'base' }));
}
