/**
 * Replenishment: moving what the account already has to the place that
 * needs it. Stock is per-location and transfers work, but the alert
 * isn't — it compares a product's *total* against one threshold, so a
 * shop with a shelf and a stockroom is never told the shelf is empty
 * while forty sit in the back.
 *
 * A minimum per product per place (see minMap in stock.js) is what makes
 * that answerable, and this is the arithmetic over it: who is short,
 * how much, and where it could come from. Pure — no DOM, no Puter;
 * unit-tested.
 *
 * Buying is not this file's business. A shortfall with nothing to move
 * is a purchase, which Reorder already covers; here it is reported as
 * exactly that rather than dressed up as an impossible transfer.
 */

import { activeProducts } from './inventory.js';
import { holdsStock } from './kits.js';
import { isCountUnit, roundQty, qtyValue } from './units.js';
import { minEntries, shortfallAt, stockEntries, UNASSIGNED } from './stock.js';
import { round2 } from './util.js';

/**
 * Where a shortfall could come from: every other bucket holding stock,
 * biggest first, minus what that bucket needs for its own minimum —
 * robbing one shelf to fill another is not replenishment.
 */
export function sourcesFor(product, locationId) {
  const out = [];
  for (const [id, qty] of stockEntries(product)) {
    if (id === locationId || qty <= 0) continue;
    const spare = roundQty(Math.max(0, qty - shortfallKeep(product, id)), product.unit);
    if (spare > 0) out.push({ locationId: id, qty: spare });
  }
  return out;
}

/**
 * What a source bucket has to keep back: its own minimum. A bucket at
 * or above its minimum can give away the surplus; one below it gives
 * nothing.
 */
function shortfallKeep(product, locationId) {
  const map = Object.fromEntries(minEntries(product));
  return Number(map[locationId]) || 0;
}

/**
 * One row per product-and-place that is below its minimum, worst first.
 *
 * `moves` is the transfer plan: sources drawn largest-first until the
 * shortfall is covered, each one a { from, qty } the caller can hand
 * straight to transferStock. `movable` is what those moves add up to and
 * `buy` is what no shelf in the account can supply — the part that is a
 * purchase, not a move.
 *
 * `locationId` narrows to one place; otherwise every place with a
 * minimum is considered.
 */
export function replenishRows(products, { locationId = null, now = Date.now() } = {}) {
  const rows = [];
  for (const product of activeProducts(products)) {
    /* A sell-as-kit holds no stock in any place, by design: a minimum
       for one can never be met by a transfer, and Reorder won't buy a
       kit either — so a row for it is a shortfall nothing in the app can
       ever clear. The same rule the alerts, the count sheet and Reorder
       already apply to it. */
    if (!holdsStock(product)) continue;
    for (const [id] of minEntries(product)) {
      if (locationId !== null && id !== locationId) continue;
      const need = shortfallAt(product, id);
      if (need <= 0) continue;
      rows.push({
        product,
        locationId: id,
        need,
        moves: [],
        movable: 0,
        buy: need,
        value: qtyValue(need, product.cost),
      });
    }
  }
  // Worst first, but "worst" is how empty the shelf is relative to what
  // it should hold — not the raw number, which would put a bin of
  // screws ahead of an empty shelf of monitors.
  rows.sort((a, b) => share(b) - share(a) || b.value - a.value);
  // All rows form one executable plan. Reserve surplus in display
  // order so two destinations cannot both spend the same source stock.
  const reserved = new Map();
  for (const row of rows) {
    const { product } = row;
    let used = reserved.get(product.id);
    if (!used) reserved.set(product.id, used = new Map());
    let left = row.need;
    for (const source of sourcesFor(product, row.locationId)) {
      if (left <= 0) break;
      const already = used.get(source.locationId) || 0;
      const take = roundQty(Math.min(source.qty - already, left), product.unit);
      if (take <= 0) continue;
      row.moves.push({ from: source.locationId, qty: take });
      used.set(source.locationId, roundQty(already + take, product.unit));
      left = roundQty(left - take, product.unit);
    }
    row.movable = roundQty(row.need - left, product.unit);
    row.buy = left;
  }
  return rows;
}

const share = (row) => row.need / Math.max(1e-9, row.need + Math.max(0, Number(row.product.quantity) || 0));

/**
 * Totals across replenish rows: how many places are short, what can be
 * moved now, and what has to be bought. Units sum over counted products
 * only — kilograms and pieces don't add.
 */
export function replenishTotals(rows) {
  const totals = { rows: rows.length, products: 0, units: 0, measured: 0, movable: 0, buy: 0, value: 0, buyRows: 0 };
  const seen = new Set();
  for (const row of rows) {
    if (!seen.has(row.product.id)) { seen.add(row.product.id); totals.products++; }
    if (isCountUnit(row.product.unit)) {
      totals.units = round3(totals.units + row.need);
      totals.movable = round3(totals.movable + row.movable);
      totals.buy = round3(totals.buy + row.buy);
    } else totals.measured++;
    if (row.buy > 0) totals.buyRows++;
    totals.value = round2(totals.value + row.value);
  }
  return totals;
}

/**
 * How many products a location is short of, for the location card. The
 * count a card shows and the list that card links to have to be the same
 * question asked once.
 */
export function belowMinimumCount(products, locationId) {
  return replenishRows(products, { locationId }).length;
}

/** Every location that states a minimum for anything, as a Set of keys. */
export function locationsWithMinimums(products) {
  const out = new Set();
  for (const product of activeProducts(products)) {
    if (!holdsStock(product)) continue;
    for (const [id] of minEntries(product)) out.add(id ?? UNASSIGNED);
  }
  return out;
}

/** The moves a row's plan implies, as transferStock arguments. */
export function rowMoves(row) {
  return row.moves.map((m) => ({ productId: row.product.id, from: m.from, to: row.locationId, qty: m.qty }));
}

const round3 = (n) => Math.round(n * 1000) / 1000;
