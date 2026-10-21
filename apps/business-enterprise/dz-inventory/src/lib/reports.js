/**
 * Report maths: the daily snapshot series, movement from the activity
 * log, dead stock, value breakdowns, and margins. Pure — no DOM, no
 * Puter; unit-tested.
 *
 * Everything except the value-over-time series is derived from data the
 * app already keeps. Movement figures can only see as far back as the
 * activity log reaches, so callers are given `window` to say so.
 */

import { round2, dateStamp } from './util.js';
import { activeProducts, inventoryStats } from './inventory.js';
import { isCountUnit } from './units.js';
import { stockEntries } from './stock.js';
import { UNASSIGNED_LABEL } from './stock.js';
import { escapeFormula, numCell } from './csv.js';
import { kitMode, kitUnitCost } from './kits.js';

/** Roughly a year of daily points; enough for a year-on-year glance. */
export const SNAPSHOT_MAX = 400;

const DAY = 24 * 3600 * 1000;

/**
 * Add (or refresh) today's point. One row per day: taking a hundred
 * readings a day would say nothing more than the last one.
 */
export function upsertSnapshot(snapshots, row) {
  const list = Array.isArray(snapshots) ? [...snapshots] : [];
  const last = list[list.length - 1];
  if (last?.date === row.date) list[list.length - 1] = row;
  else list.push(row);
  return list.length > SNAPSHOT_MAX ? list.slice(-SNAPSHOT_MAX) : list;
}

export function sameSnapshot(a, b) {
  if (!a || !b) return false;
  return ['date', 'products', 'units', 'value', 'low', 'out'].every((k) => a[k] === b[k]);
}

/** Snapshots within the last `days`, oldest first. */
export function snapshotSeries(snapshots, { days = 30, now = Date.now() } = {}) {
  const from = now - days * DAY;
  return (snapshots || []).filter((s) => {
    const [y, m, d] = String(s.date).split('-').map(Number);
    return y && new Date(y, m - 1, d).getTime() >= from;
  });
}

/* ---------- Movement ---------- */

const MOVEMENT_KINDS = new Set(['add', 'remove', 'recount']);

/** Removal reasons that are stock lost, not stock sold or deliberately used. */
export const SHRINKAGE_REASONS = new Set(['damaged', 'expired', 'lost']);

/**
 * Removal reasons that say nothing about customer demand. Entries from
 * before reasons existed carry none and stay counted as demand — the
 * numbers people already trusted must not empty out on upgrade.
 */
const NON_DEMAND_REASONS = new Set(['damaged', 'expired', 'internal', 'lost']);

const isDemand = (a) => !(a.kind === 'remove' && NON_DEMAND_REASONS.has(a.reason));

/**
 * Units in and out per product over a window, from the activity log.
 * Recounts count as movement in whichever direction they corrected —
 * a stocktake that finds five missing is five gone, whatever the cause.
 * `demandOnly` drops removals tagged with a non-demand reason, so a
 * case dropped in the stockroom stops looking like a bestseller.
 */
export function movementByProduct(entries, { days = 30, now = Date.now(), demandOnly = false } = {}) {
  const from = now - days * DAY;
  const rows = new Map();
  for (const a of entries || []) {
    if (!a.productId || !MOVEMENT_KINDS.has(a.kind) || a.at < from) continue;
    if (demandOnly && !isDemand(a)) continue;
    const delta = Number(a.delta) || 0;
    if (!delta) continue;
    let row = rows.get(a.productId);
    if (!row) {
      row = { productId: a.productId, name: a.name, unit: a.unit || 'each', in: 0, out: 0 };
      rows.set(a.productId, row);
    }
    if (delta > 0) row.in = round3(row.in + delta);
    else row.out = round3(row.out - delta);
  }
  return [...rows.values()];
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * One product's movement day by day over the window, oldest first, for
 * the small chart on its page. Every day in the window gets a point,
 * including the quiet ones — a line with the gaps closed up would read
 * as steady demand.
 *
 * `out` is demand only, the same rule the movers chart uses, so a case
 * dropped in the stockroom doesn't look like a busy Tuesday.
 */
export function movementSeries(entries, productId, { days = 30, now = Date.now() } = {}) {
  const series = [];
  const index = new Map();
  // Day boundaries walked with calendar arithmetic, so the two days a
  // year that aren't 24 hours long don't shift every bucket.
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    const key = dateStamp(day);
    index.set(key, series.length);
    series.push({ date: key, in: 0, out: 0 });
  }
  for (const a of entries || []) {
    if (a.productId !== productId || !MOVEMENT_KINDS.has(a.kind)) continue;
    const at = index.get(dateStamp(new Date(a.at)));
    if (at === undefined) continue;
    const delta = Number(a.delta) || 0;
    if (!delta) continue;
    const row = series[at];
    if (delta > 0) row.in = round3(row.in + delta);
    else if (isDemand(a)) row.out = round3(row.out - delta);
  }
  return series;
}

/**
 * The busiest products by units out — a demand measure, so write-offs
 * (damaged, expired, lost, internal use) don't count. Receipts ride
 * along on each row, but something that only came in isn't a mover —
 * listing it at zero would just be a row of empty bars under a chart
 * about what leaves.
 */
export function topMovers(entries, { days = 30, now = Date.now(), limit = 8 } = {}) {
  return movementByProduct(entries, { days, now, demandOnly: true })
    .filter((r) => r.out > 0)
    .sort((a, b) => (b.out - a.out) || (b.in - a.in))
    .slice(0, limit);
}

/**
 * Stock that isn't going anywhere: on hand, but nothing removed within
 * the window. Sorted by the money sitting still.
 */
export function deadStock(products, entries, { days = 60, now = Date.now(), limit = 8 } = {}) {
  const from = now - days * DAY;
  const moved = new Set();
  for (const a of entries || []) {
    if (!a.productId || a.at < from) continue;
    // Same rule as the movers chart: demand removals, and recounts that
    // corrected downward — a stocktake that found five missing is five
    // gone. A write-off is not movement: throwing away half a case of
    // something nobody buys doesn't make the rest of it any less stuck.
    if ((a.kind === 'remove' && isDemand(a)) || (a.kind === 'recount' && (Number(a.delta) || 0) < 0)) moved.add(a.productId);
  }
  return activeProducts(products)
    .filter((p) => (Number(p.quantity) || 0) > 0 && !moved.has(p.id))
    .map((p) => ({ product: p, value: round2((p.quantity || 0) * (p.cost || 0)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/**
 * What was thrown away in the window: removals tagged damaged, expired,
 * or lost, per product, valued at the product's current cost (0 when
 * the product is gone — a unit count with no cost beats a made-up
 * number). Sorted by the money lost. Removals without a reason are
 * invisible here; unspecifiedRemovals counts them so the view can say so.
 */
export function shrinkageRows(products, entries, { days = 30, now = Date.now() } = {}) {
  const from = now - days * DAY;
  const costOf = new Map(products.map((p) => [p.id, Number(p.cost) || 0]));
  const rows = new Map();
  for (const a of entries || []) {
    if (a.kind !== 'remove' || !SHRINKAGE_REASONS.has(a.reason) || a.at < from || !a.productId) continue;
    const units = Math.abs(Number(a.delta) || 0);
    if (!units) continue;
    let row = rows.get(a.productId);
    if (!row) {
      row = { productId: a.productId, name: a.name, unit: a.unit || 'each', units: 0, value: 0, reasons: {} };
      rows.set(a.productId, row);
    }
    row.units = round3(row.units + units);
    row.value = round2(row.value + units * (costOf.get(a.productId) || 0));
    row.reasons[a.reason] = round3((row.reasons[a.reason] || 0) + units);
  }
  return [...rows.values()].sort((a, b) => (b.value - a.value) || (b.units - a.units));
}

/**
 * Totals across shrinkage rows. Units sum over counted products only —
 * kilograms and pieces don't add — with `measured` saying how many
 * products were left out of that number for exactly that reason.
 */
export function shrinkageTotals(rows) {
  const totals = { products: rows.length, units: 0, measured: 0, value: 0 };
  for (const r of rows) {
    totals.value += r.value;
    if (isCountUnit(r.unit)) totals.units = round3(totals.units + r.units);
    else totals.measured++;
  }
  totals.value = round2(totals.value);
  return totals;
}

/** Removals in the window with no reason recorded — invisible to shrinkage. */
export function unspecifiedRemovals(entries, { days = 30, now = Date.now() } = {}) {
  const from = now - days * DAY;
  let n = 0;
  for (const a of entries || []) {
    if (a.kind === 'remove' && !a.reason && a.at >= from) n++;
  }
  return n;
}

/* ---------- Sales ---------- */

/**
 * What one unit of this removal sold for, or null when the removal
 * carries no price at all. Zero is a price — stock given away is a real
 * sale at nothing — so only absence counts as absence.
 */
function unitPrice(a) {
  if (a.price === null || a.price === undefined || a.price === '') return null;
  const n = Number(a.price);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Is this entry a removal that could have carried a sale price?
 *
 * A component that left because a kit was sold is part of that sale,
 * not a sale of its own: the money is on the kit's entry, and counting
 * the parts here reported every kit sold as takings the report couldn't
 * see. It still counts as demand for the component itself, which is a
 * different question and a different function.
 */
const isSaleCandidate = (a) => a.kind === 'remove' && isDemand(a) && !!a.productId && !a.kitId;

/**
 * What sold in the window, per product: units out, revenue at the price
 * recorded on each removal, COGS at the cost frozen on the same entry,
 * and the gross profit between them. Only priced removals are here —
 * everything else is counted by untrackedSales, never valued at list
 * price, because a partial history must not read as a complete one.
 *
 * `products` supplies a cost fallback for entries that carry a price but
 * no cost (a hand-made backup); the product's current cost is the only
 * honest guess left, and 0 once the product is gone.
 */
export function salesRows(products, entries, { days = 30, now = Date.now() } = {}) {
  const from = now - days * DAY;
  const costOf = new Map((products || []).map((p) => [p.id, Number(p.cost) || 0]));
  const rows = new Map();
  for (const a of entries || []) {
    if (!isSaleCandidate(a) || a.at < from) continue;
    const price = unitPrice(a);
    if (price === null) continue;
    const units = Math.abs(Number(a.delta) || 0);
    if (!units) continue;
    const unitCost = a.cost === null || a.cost === undefined || !Number.isFinite(Number(a.cost))
      ? (costOf.get(a.productId) || 0)
      : Number(a.cost);
    let row = rows.get(a.productId);
    if (!row) {
      row = { productId: a.productId, name: a.name, unit: a.unit || 'each', units: 0, revenue: 0, cost: 0, profit: 0, sales: 0 };
      rows.set(a.productId, row);
    }
    row.units = round3(row.units + units);
    row.revenue = round2(row.revenue + units * price);
    row.cost = round2(row.cost + units * unitCost);
    row.profit = round2(row.revenue - row.cost);
    row.sales++;
  }
  return [...rows.values()].sort((a, b) => (b.revenue - a.revenue) || (b.units - a.units));
}

/**
 * Revenue, COGS, gross profit and the realized margin across sales
 * rows. Units sum over counted products only — kilograms and pieces
 * don't add — with `measured` saying how many were left out for exactly
 * that reason. `margin` is null when nothing sold, rather than 0%.
 */
export function salesTotals(rows) {
  const totals = { products: rows.length, sales: 0, units: 0, measured: 0, revenue: 0, cost: 0, profit: 0, margin: null };
  for (const r of rows) {
    totals.sales += r.sales || 0;
    totals.revenue += r.revenue;
    totals.cost += r.cost;
    if (isCountUnit(r.unit)) totals.units = round3(totals.units + r.units);
    else totals.measured++;
  }
  totals.revenue = round2(totals.revenue);
  totals.cost = round2(totals.cost);
  totals.profit = round2(totals.revenue - totals.cost);
  if (totals.revenue) totals.margin = Math.round((totals.profit / totals.revenue) * 1000) / 10;
  return totals;
}

/** The products earning the most gross profit in the window. */
export function topEarners(rows, { limit = 8 } = {}) {
  return [...rows]
    .filter((r) => r.revenue > 0 || r.profit !== 0)
    .sort((a, b) => (b.profit - a.profit) || (b.revenue - a.revenue))
    .slice(0, limit);
}

/**
 * Sales the reports above cannot see: removals that look like demand
 * but carry no price. Reported next to the sales figures so a partial
 * record is legible as one — never folded in at list price.
 */
export function untrackedSales(entries, { days = 30, now = Date.now() } = {}) {
  const from = now - days * DAY;
  const out = { count: 0, units: 0, measured: new Set() };
  for (const a of entries || []) {
    if (!isSaleCandidate(a) || a.at < from) continue;
    if (unitPrice(a) !== null) continue;
    out.count++;
    const units = Math.abs(Number(a.delta) || 0);
    if (isCountUnit(a.unit)) out.units = round3(out.units + units);
    else out.measured.add(a.productId);
  }
  return { count: out.count, units: out.units, measured: out.measured.size };
}

/** How far back the log actually reaches, or null when it's empty. */
export function logReach(entries) {
  let oldest = null;
  for (const a of entries || []) {
    if (typeof a.at === 'number' && (oldest === null || a.at < oldest)) oldest = a.at;
  }
  return oldest;
}

/* ---------- Breakdowns ---------- */

/** Stock value grouped by category, biggest first. */
export function valueByCategory(products) {
  const groups = new Map();
  for (const p of activeProducts(products)) {
    const key = p.category || 'Uncategorized';
    const row = groups.get(key) || { label: key, value: 0, units: 0, products: 0 };
    row.value += (Number(p.quantity) || 0) * (Number(p.cost) || 0);
    if (isCountUnit(p.unit)) row.units += Number(p.quantity) || 0;
    row.products++;
    groups.set(key, row);
  }
  return finish(groups);
}

/**
 * Stock value grouped by where it physically is.
 *
 * Walks each product's own buckets rather than the location list, so
 * stock sitting in a place that isn't on that list — a partial restore,
 * say — still counts somewhere instead of vanishing from a report about
 * where the money is.
 */
export function valueByLocation(products, locations = []) {
  const names = new Map(locations.map((l) => [l.id, l.name]));
  const groups = new Map();
  for (const p of activeProducts(products)) {
    // Two off-list buckets fold into the same "No location" group; the
    // product is still one product there, not one per bucket.
    const counted = new Set();
    for (const [id, qty] of stockEntries(p)) {
      if (qty <= 0) continue;
      const key = names.has(id) ? id : UNASSIGNED_LABEL;
      const row = groups.get(key) || { label: names.get(id) || UNASSIGNED_LABEL, value: 0, units: 0, products: 0 };
      row.value += qty * (Number(p.cost) || 0);
      if (isCountUnit(p.unit)) row.units += qty;
      if (!counted.has(key)) { row.products++; counted.add(key); }
      groups.set(key, row);
    }
  }
  return finish(groups);
}

function finish(groups) {
  return [...groups.values()]
    .map((r) => ({ ...r, value: round2(r.value) }))
    .sort((a, b) => b.value - a.value);
}

/* ---------- Margins ---------- */

/**
 * Margin per product for anything priced. `belowCost` flags a price
 * under what it cost — usually a typo, occasionally a real problem, and
 * either way worth surfacing.
 */
export function marginFor(product, products = []) {
  const cost = kitMode(product) === 'sell' ? kitUnitCost(product, products) : Number(product.cost) || 0;
  if (!(Number(product.price) > 0) || !(cost > 0)) return null;
  const margin = round2(product.price - cost);
  return {
    product,
    cost,
    margin,
    percent: Math.round((margin / product.price) * 1000) / 10,
    belowCost: margin < 0,
  };
}

export function marginRows(products, { limit = 0 } = {}) {
  const rows = activeProducts(products)
    .map((p) => marginFor(p, products))
    .filter(Boolean)
    .sort((a, b) => a.percent - b.percent);
  return limit ? rows.slice(0, limit) : rows;
}

/* ---------- One-file report export ---------- */

/**
 * The whole Reports view as CSV rows — every table for the visible
 * period in one file, in labelled sections a spreadsheet can slice.
 * Numbers stay raw (no currency symbols) so they compute; text fields
 * carry the same CWE-1236 guard as every other export.
 */
export function reportRows({ products = [], snapshots = [], activity = [], locations = [], defaultLow = undefined, days = 30, now = Date.now() } = {}) {
  const rows = [];
  const section = (title, header, body) => {
    rows.push([title]);
    rows.push(header);
    for (const r of body) rows.push(r);
    rows.push([]);
  };

  const stats = inventoryStats(products, defaultLow);
  rows.push(['Inventory report']);
  // Local, like every other date the app writes: an evening report run
  // west of UTC would otherwise be stamped tomorrow.
  rows.push(['Generated', dateStamp(new Date(now))]);
  rows.push(['Period', `Last ${days} days`]);
  rows.push([]);

  section('Summary', ['Products', 'Units on hand', 'Stock value at cost', 'Low stock', 'Out of stock'],
    [[stats.products, stats.units, stats.value, stats.low, stats.out]]);

  section('Stock over time', ['Date', 'Stock value', 'Units', 'Low', 'Out'],
    snapshotSeries(snapshots, { days, now }).map((s) => [s.date, numCell(s.value), numCell(s.units), numCell(s.low), numCell(s.out)]));

  section('Top movers', ['Product', 'Units out', 'Units in', 'Unit'],
    topMovers(activity, { days, now, limit: 1000 }).map((m) => [escapeFormula(m.name), m.out, m.in, escapeFormula(m.unit)]));

  const sales = salesRows(products, activity, { days, now });
  const sold = salesTotals(sales);
  const unpriced = untrackedSales(activity, { days, now });
  section('Sales', ['Product', 'Units sold', 'Unit', 'Revenue', 'Cost of goods', 'Gross profit', 'Margin %'],
    [
      ...sales.map((r) => [
        escapeFormula(r.name), r.units, escapeFormula(r.unit),
        r.revenue, r.cost, r.profit,
        r.revenue ? Math.round((r.profit / r.revenue) * 1000) / 10 : '',
      ]),
      ['Total', sold.units, '', sold.revenue, sold.cost, sold.profit, sold.margin ?? ''],
      // Never folded into the totals above: a removal with no price
      // recorded is an unknown, not a sale at list price.
      ...(unpriced.count
        ? [[`${unpriced.count} removal${unpriced.count === 1 ? '' : 's'} with no price recorded`, unpriced.units, '', '', '', '', '']]
        : []),
    ]);

  section('Not moving', ['Product', 'On hand', 'Unit', 'Value at cost'],
    deadStock(products, activity, { days: Math.max(days, 30), now, limit: 1000 })
      .map(({ product: p, value }) => [escapeFormula(p.name), p.quantity, escapeFormula(p.unit || 'each'), value]));

  section('Shrinkage', ['Product', 'Units lost', 'Unit', 'Value at cost', 'Breakdown'],
    shrinkageRows(products, activity, { days, now }).map((r) => [
      escapeFormula(r.name), r.units, escapeFormula(r.unit),
      r.value,
      escapeFormula(Object.entries(r.reasons).map(([k, n]) => `${k}: ${n}`).join(' | ')),
    ]));

  section('Value by category', ['Category', 'Value at cost', 'Products'],
    valueByCategory(products).map((r) => [escapeFormula(r.label), r.value, r.products]));

  section('Value by location', ['Location', 'Value at cost', 'Products'],
    valueByLocation(products, locations).map((r) => [escapeFormula(r.label), r.value, r.products]));

  section('Margins', ['Product', 'Cost', 'Price', 'Margin', 'Margin %'],
    marginRows(products).map((m) => [escapeFormula(m.product.name), numCell(m.cost), numCell(m.product.price), m.margin, m.percent]));

  return rows;
}

/** Weighted average margin across everything priced, or null. */
export function averageMargin(products) {
  let revenue = 0;
  let cost = 0;
  for (const { product: p, cost: unitCost } of marginRows(products)) {
    const qty = Math.max(Number(p.quantity) || 0, 1);
    revenue += p.price * qty;
    cost += unitCost * qty;
  }
  if (!revenue) return null;
  return Math.round(((revenue - cost) / revenue) * 1000) / 10;
}
