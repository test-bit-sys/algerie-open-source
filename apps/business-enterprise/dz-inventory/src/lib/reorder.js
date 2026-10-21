/**
 * Turning low-stock alerts into supplier orders: how much to order, who
 * to order it from, and what the order sheet says. Pure — no DOM, no
 * Puter; unit-tested.
 */

import { alertProducts, DEFAULT_LOW_STOCK } from './inventory.js';
import { roundQty, packSizeOf, packLabel, formatQtyIn, unitLabel, isCountUnit } from './units.js';
import { coverDays, DEFAULT_SAFETY_DAYS } from './demand.js';
import { sourcesOf, sourceFor, preferredSource, cheapestSource, packSizeFrom, leadTimeFrom } from './sources.js';
import { isKit } from './kits.js';
import { escapeFormula } from './csv.js';
import { asList } from './util.js';

/**
 * How many to order. A per-product `reorderQty` — "when it runs low,
 * order this many" — wins when set; otherwise enough to come back up to
 * a target level. That target is roughly twice the threshold, which is
 * the level the alert is measured against — unless a coverage horizon
 * is set and demand is known, in which case it is the days of demand
 * the owner asked to carry, floored just above the threshold so an
 * order can't land the product straight back into the alert it came
 * from. `incoming` (units already on their way on open orders)
 * subtracts from the need either way; 0 means the shortfall is covered
 * and there is nothing left to order. Products bought in packs round up
 * to whole packs, since that's what a supplier will actually ship.
 */
export function suggestedQty(product, defaultLow = DEFAULT_LOW_STOCK, incoming = 0, { perDay = 0, coverageDays = 0, source = null } = {}) {
  const fixed = Number(product.reorderQty) || 0;
  const low = Number(product.lowStock ?? defaultLow) || 0;
  const onHand = Number(product.quantity) || 0;
  const inbound = Math.max(0, Number(incoming) || 0);
  const rate = Math.max(0, Number(perDay) || 0);
  const horizon = Math.max(0, Math.round(Number(coverageDays) || 0));
  const target = horizon > 0 && rate > 0
    ? Math.max(rate * horizon, low + 1, 1)
    : Math.max(low * 2, low + 1, 1);
  const need = fixed > 0
    ? fixed - inbound
    : Math.max(target - onHand, isCountUnit(product.unit) ? 1 : 0.001) - inbound;
  if (need <= 0) return 0;
  // Whole packs, since that's what a supplier will actually ship — and
  // which supplier decides how big a pack is.
  const pack = source ? packSizeFrom(source, product) : packSizeOf(product);
  if (!pack) return roundQty(need, product.unit);
  // The epsilon keeps float residue (5.7 / 1.9 → 3.0000000000000004)
  // from rounding an exact whole-pack need up to a whole extra pack.
  return roundQty(Math.ceil(need / pack - 1e-9) * pack, product.unit);
}

/**
 * "3 cases of 24" when it's ordered in packs, else "". Pass the line's
 * `source` so the note counts the packs that supplier ships — the same
 * pack size suggestedQty rounded the quantity to.
 */
export function packNote(qty, product, source = null) {
  const pack = source ? packSizeFrom(source, product) : packSizeOf(product);
  // qty > 0, not just divisible: a cleared field is 0, and "0 cases"
  // is not a note worth printing next to it.
  if (!pack || !(qty > 0)) return '';
  // Whole-pack check by nearest multiple, not %, which carries float
  // residue for decimal packs (3.6 % 1.2 is 2.2e-16, not 0).
  const packs = Math.round(qty / pack);
  if (!packs || Math.abs(packs * pack - qty) > 1e-9) return '';
  return `${formatQtyIn(packs, 'each')} ${packLabel(product, packs)}`;
}

/**
 * Every line the reorder list would show, ungrouped: an alert that
 * still needs buying, the source it would be bought from, and how many
 * to ask for. `incoming` maps product ids to units already on their way
 * (see onOrderQty); a product whose shortfall those units cover drops
 * out, one they only dent stays, suggested at what's still missing.
 *
 * Kits are left out entirely — you don't buy a kit, you buy or build
 * what it's made of, and its components appear here on their own merits.
 *
 * This is the one place that decides what needs ordering. The grouped
 * view and the navigation badge both count it, so the number on the
 * badge is the number of lines the page actually shows — a badge that
 * worked it out for itself counted the kits the page leaves out, and
 * said "1 product to reorder" over a page reading "Nothing to reorder".
 */
export function reorderAlerts(products, {
  defaultLow = DEFAULT_LOW_STOCK, incoming = new Map(),
  rates = new Map(), coverageDays = 0, sources: chosen = new Map(),
} = {}) {
  const out = [];
  for (const { product, status } of alertProducts(products, defaultLow)) {
    // The thing to buy is never the kit: a built one is made from parts
    // that have their own lines here, and a sold-as one holds nothing.
    if (isKit(product)) continue;
    const inbound = incoming.get(product.id) || 0;
    const perDay = Math.max(0, Number(rates.get(product.id)) || 0);
    // Which place this line is being bought from: whoever the user
    // switched it to, else the preferred source — which is what
    // `supplierId` already names, so nothing changes for a product with
    // one supplier.
    const picked = chosen.get(product.id);
    const source = (picked !== undefined ? sourceFor(product, picked) : null) || preferredSource(product);
    const suggested = suggestedQty(product, defaultLow, inbound, { perDay, coverageDays, source });
    if (suggested <= 0) continue;
    out.push({ product, status, suggested, incoming: inbound, perDay, source });
  }
  return out;
}

/**
 * Those lines, grouped by supplier, with the no-supplier group last so
 * it reads as the leftovers.
 *
 * `rates` maps product ids to units out per day (see demandRates). Where
 * a rate is known each line carries it, along with the days of cover
 * left — and both the lines within a group and the groups themselves are
 * ordered by that, because a shelf emptying on Thursday matters more
 * than one alphabetically ahead of it. Lines the app can say nothing
 * about come after the ones it can.
 */
export function reorderGroups(products, {
  defaultLow = DEFAULT_LOW_STOCK, suppliers = [], incoming = new Map(),
  rates = new Map(), coverageDays = 0, safetyDays = DEFAULT_SAFETY_DAYS,
  sources: chosen = new Map(),
} = {}) {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const bySupplier = new Map();

  for (const line of reorderAlerts(products, { defaultLow, incoming, rates, coverageDays, sources: chosen })) {
    const { product, source, perDay } = line;
    const key = source?.supplierId || '';
    if (!bySupplier.has(key)) {
      bySupplier.set(key, { supplierId: source?.supplierId || null, name: names.get(key) || '', lines: [] });
    }
    bySupplier.get(key).lines.push({
      ...line,
      cover: coverDays(product, perDay),
      sources: sourcesOf(product),
      cheapest: cheapestSource(product),
      restockIn: (leadTimeFrom(source, supplierById.get(key)) || 0)
        + Math.max(0, Math.round(Number(safetyDays) || 0)),
    });
  }

  // Stable sorts throughout, so lines the arithmetic can't separate keep
  // the order alertProducts put them in (out of stock first, then the
  // emptiest shelf).
  const groups = [...bySupplier.values()];
  for (const group of groups) group.lines.sort((a, b) => urgency(a) - urgency(b));
  return groups.sort((a, b) => {
    if (!a.supplierId !== !b.supplierId) return a.supplierId ? -1 : 1;
    const byUrgency = groupUrgency(a) - groupUrgency(b);
    return byUrgency || a.name.localeCompare(b.name);
  });
}

/**
 * Sort key for a reorder line. An empty shelf is the most urgent thing
 * there is, whatever the log knows; after that it's days of cover, and
 * lines with no demand data last — "we can't say it's running out" is
 * not the same as "it is".
 */
const urgency = (line) => (line.status === 'out' ? -1 : (line.cover ?? Infinity));

const groupUrgency = (group) => Math.min(...group.lines.map(urgency));

/* ---------- Order lines and what's still due ---------- */

/** Orders placed and not yet fully resolved. */
export const OPEN_ORDER_STATUSES = new Set(['ordered', 'partial']);

const round3 = (n) => Math.round(n * 1000) / 1000;

/** Units of a line still undelivered; never negative (over-receipts clamp). */
export function lineRemaining(line) {
  return Math.max(0, round3((Number(line?.qty) || 0) - (Number(line?.received) || 0)));
}

/** Does any line of this order still have units due? */
export function orderOutstanding(order) {
  return asList(order?.lines).some((l) => lineRemaining(l) > 0);
}

/**
 * Units on their way per product: what open orders still owe, summed
 * across orders. This is the number the product row, the stock dialog,
 * and the reorder maths all show and subtract.
 */
export function onOrderQty(orders) {
  const map = new Map();
  for (const order of orders || []) {
    if (!OPEN_ORDER_STATUSES.has(order.status)) continue;
    for (const line of asList(order.lines)) {
      const remaining = lineRemaining(line);
      if (remaining <= 0 || !line.productId) continue;
      map.set(line.productId, round3((map.get(line.productId) || 0) + remaining));
    }
  }
  return map;
}

/** Every product id with units still due on an open order. */
export function productsOnOrder(orders) {
  return new Set(onOrderQty(orders).keys());
}

/**
 * Bring an order written before partial receiving up to shape: lines
 * carry `received` (a received order's lines arrived in full), and the
 * status field always exists. Idempotent.
 */
export function migrateOrder(order) {
  const status = order.status || 'ordered';
  return {
    ...order,
    status,
    lines: asList(order.lines).map((l) => ({
      ...l,
      received: Number(l.received) || (status === 'received' ? Number(l.qty) || 0 : 0),
    })),
  };
}

const pad = (s, n) => String(s).padStart(n);

/**
 * The order as plain text — what gets pasted into an email, a chat, or
 * a supplier's own form. Aligned quantities so it stays readable in a
 * monospaced client.
 */
export function orderToText(order, { title = 'Order', date = null } = {}) {
  const lines = asList(order.lines);
  const width = Math.max(...lines.map((l) => formatQtyIn(l.qty, l.unit).length), 1);
  const body = lines.map((l) => {
    const qty = `${pad(formatQtyIn(l.qty, l.unit), width)} ${unitLabel(l.unit, l.qty)}`;
    // Their code first: our SKU is a number they can't look up, which is
    // what made an order sheet worse than a phone call.
    const ref = l.code ? ` (${l.code})` : (l.sku ? ` (${l.sku})` : '');
    return `${qty}  ${l.name}${ref}`;
  });
  return [
    `${title}${order.supplierName ? `: ${order.supplierName}` : ''}`,
    date ? new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null,
    '',
    ...body,
  ].filter((l) => l !== null).join('\n');
}

/**
 * One row per line: the supplier's own code, our SKU, product, quantity,
 * unit. Their code leads, because the sheet is read by them — ours is
 * there so the file still reconciles on our side.
 */
export function orderRows(order) {
  // Same CWE-1236 guard as every other CSV export: the sheet is opened
  // in a spreadsheet, and names, codes, SKUs, and units are free text.
  return [
    ['Supplier code', 'SKU', 'Product', 'Quantity', 'Unit'],
    ...asList(order.lines).map((l) => [
      escapeFormula(l.code || ''),
      escapeFormula(l.sku || ''),
      escapeFormula(l.name),
      l.qty,
      escapeFormula(l.unit || 'each'),
    ]),
  ];
}
