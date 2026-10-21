/**
 * Take-out sessions: a basket of stock leaving in one pass, instead of
 * one dialog per product. Scanning stock out is the most repeated action
 * in a working day, and a dialog each — open, type, confirm, close —
 * was the slowest path in the app.
 *
 * A session carries one reason, one location and one note for the whole
 * basket, since most baskets are all sold, from one place; any line can
 * override all three. It persists under its own key like the count
 * session, so a phone locking mid-basket loses nothing, and it commits
 * in one pass: a safety snapshot, one `remove` per line, one products
 * write, every entry sharing a reference so History reads it as one
 * event.
 *
 * Pure logic here; persistence and the commit live in the store.
 */

import { isRemovalReason } from './activity.js';
import { isCountUnit, roundQty, qtyValue } from './units.js';
import { stockAt, defaultLocationId, UNASSIGNED } from './stock.js';
import { kitMode, buildableQty, kitUnitCost } from './kits.js';
import { round2, dateStamp } from './util.js';

/** What a fresh session defaults to: the fast path, one tap. */
export const DEFAULT_TAKEOUT_REASON = 'sold';

/**
 * The reason a line actually leaves under: its own override, or the
 * session's. An unknown reason (a hand-made restore) falls back rather
 * than travelling into the log.
 */
export function lineReason(session, line) {
  if (isRemovalReason(line?.reason)) return line.reason;
  return isRemovalReason(session?.reason) ? session.reason : DEFAULT_TAKEOUT_REASON;
}

/**
 * The bucket a line comes out of. A string — including '' for the
 * unassigned bucket — is a real choice; null or absent means "inherit",
 * and a session inheriting means each product's own default location.
 */
export function lineLocation(session, line, product = null) {
  if (typeof line?.locationId === 'string') return line.locationId;
  if (typeof session?.locationId === 'string') return session.locationId;
  return product ? defaultLocationId(product) : UNASSIGNED;
}

/** The note a line carries into the log: its own, or the session's. */
export function lineNote(session, line) {
  const own = String(line?.note ?? '').trim();
  return own || String(session?.note ?? '').trim();
}

/**
 * What one unit of this line sold for, or null when it isn't priced —
 * either because nothing was recorded or because it isn't a sale at all.
 * Zero is a price: stock given away is a real sale at nothing.
 */
export function linePrice(session, line) {
  if (lineReason(session, line) !== 'sold') return null;
  const v = line?.price;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

/**
 * A basket line for this product, seeded with one unit and the product's
 * selling price — so the ordinary case is scan, scan, scan, commit.
 * Name, SKU and unit are copied the way order lines copy them: the
 * basket still reads correctly if the product is renamed mid-session.
 */
export function buildTakeoutLine(product, { id, qty = 1 } = {}) {
  return {
    id: id || `${product.id}`,
    productId: product.id,
    name: product.name,
    sku: product.sku || '',
    barcode: product.barcode || '',
    unit: product.unit,
    qty: roundQty(qty, product.unit) || (isCountUnit(product.unit) ? 1 : 0.001),
    price: product.price === null || product.price === undefined ? null : round2(product.price),
    reason: '',
    locationId: null,
    note: '',
  };
}

/**
 * The reference every entry from one basket shares, so History reads a
 * committed basket as one event. Local date and time: a reference
 * stamped tomorrow because of UTC would be wrong on every screen it
 * appears on.
 */
export function takeoutRef(session) {
  const at = new Date(Number(session?.startedAt) || Date.now());
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return `Take-out ${dateStamp(at)} ${time}`;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * The line a scanned code already has in the basket — barcodes before
 * SKUs, the order a scan resolves in — so a second scan of the same
 * item increments its line instead of adding a second one.
 */
export function takeoutLineByCode(session, code) {
  const k = norm(code);
  if (!k) return null;
  const lines = session?.lines || [];
  return lines.find((l) => norm(l.barcode) === k) || lines.find((l) => norm(l.sku) === k) || null;
}

/** The line for a product, if the basket already holds one. */
export function takeoutLineFor(session, productId) {
  return (session?.lines || []).find((l) => l.productId === productId) || null;
}

/**
 * What the basket would do, valued line by line: units leaving, what
 * they cost, and what the priced ones take in. `shortLines` counts lines
 * asking for more than the location actually holds — those clamp to
 * what's there on commit, so it's worth saying before committing.
 *
 * `cost` is what the whole basket is worth at cost; `soldCost` is only
 * the part of it that is leaving against a recorded price, and `profit`
 * is the difference between that and the revenue. A basket mixing a
 * sale with a write-off has to keep the two apart: charging the binned
 * case against the sold one reported an ordinary sale at a heavy loss.
 *
 * Units total over counted products only (kilograms and pieces don't
 * add), with `measured` saying how many were left out for that reason.
 */
export function takeoutTotals(session, products = []) {
  const byId = new Map(products.map((p) => [p.id, p]));
  /* A sell-as-kit is worth what its parts are worth: it holds no stock,
     so it has no moving average of its own, and reading its `cost` as
     zero would report the whole price as profit. */
  const unitCost = (product) => (kitMode(product) === 'sell'
    ? kitUnitCost(product, products)
    : (Number(product.cost) || 0));
  const totals = {
    lines: 0, units: 0, measured: 0, cost: 0, soldCost: 0, revenue: 0, profit: 0,
    priced: 0, unpriced: 0, shortLines: 0, missing: 0,
  };
  for (const line of session?.lines || []) {
    const product = byId.get(line.productId);
    totals.lines++;
    if (!product) { totals.missing++; continue; }
    const qty = Math.max(0, Number(line.qty) || 0);
    if (isCountUnit(product.unit)) totals.units = round3(totals.units + qty);
    else totals.measured++;
    const value = qtyValue(qty, unitCost(product));
    totals.cost = round2(totals.cost + value);
    const price = linePrice(session, line);
    if (price === null) {
      if (lineReason(session, line) === 'sold') totals.unpriced++;
    } else {
      totals.priced++;
      totals.revenue = round2(totals.revenue + qtyValue(qty, price));
      totals.soldCost = round2(totals.soldCost + value);
    }
    if (qty > lineAvailable(session, line, product, products)) totals.shortLines++;
  }
  totals.profit = round2(totals.revenue - totals.soldCost);
  return totals;
}

/**
 * How much of this line the basket can actually take out. Normally
 * whatever the chosen location holds — but a sell-as-kit holds none
 * anywhere by design, so what it can do is what its components allow.
 */
export function lineAvailable(session, line, product, products = []) {
  if (!product) return 0;
  if (kitMode(product) === 'sell') return buildableQty(product, products);
  return stockAt(product, lineLocation(session, line, product));
}

const round3 = (n) => Math.round(n * 1000) / 1000;
