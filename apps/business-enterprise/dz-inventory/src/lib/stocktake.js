/**
 * Stocktake sessions: a guided, resumable count of a location, a
 * category, or the whole store. The session freezes the product list
 * and expected quantities at start, keeps per-row counts as they're
 * entered (null = not counted yet — skipped is never zero), and is
 * committed in one pass as recount adjustments.
 *
 * Pure logic here; persistence and the commit live in the store.
 */

import { activeProducts } from './inventory.js';
import { holdsStock } from './kits.js';
import { normalizeUnit, isCountUnit } from './units.js';
import { stockAt, isAtLocation, binAt, compareBins, defaultLocationId } from './stock.js';
import { qtyValue } from './units.js';
import { round2 } from './util.js';

/**
 * Freeze the rows a session will count. `locationId` is a bucket key
 * ('' counts the unassigned bucket) or null for everywhere; `category`
 * narrows further. Expected is the location's bucket for a located
 * count, the product's total otherwise.
 */
export function buildStocktakeRows(products, { locationId = null, category = '' } = {}) {
  return activeProducts(products)
    // A sell-as-kit has nothing on a shelf to count; its components do.
    .filter(holdsStock)
    .filter((p) => !category || (p.category || '') === category)
    .filter((p) => locationId === null || isAtLocation(p, locationId))
    .map((p) => ({
      productId: p.id,
      name: p.name,
      sku: p.sku || '',
      barcode: p.barcode || '',
      unit: normalizeUnit(p.unit),
      // Where it sits in the room being counted — the scope's place, or
      // the product's own when the whole store is being counted. Frozen
      // with the row, like the name and the expected amount.
      bin: binAt(p, locationId === null ? defaultLocationId(p) : locationId),
      expected: locationId === null ? (Number(p.quantity) || 0) : stockAt(p, locationId),
      counted: null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** How a count sheet can be ordered. */
export const STOCKTAKE_SORTS = [
  { key: 'name', label: 'By name' },
  { key: 'bin', label: 'By bin' },
];

/**
 * Order the sheet for the job in hand. By name is the list a person
 * reads; by bin is the walk they actually take — shelf by shelf instead
 * of A to Z and back again, which is most of what bin codes are for.
 * Rows with no code go last, in name order, so an uncoded product is
 * still counted rather than lost between shelves.
 */
export function sortStocktakeRows(rows, mode = 'name') {
  const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
  if (mode !== 'bin') return [...(rows || [])].sort(byName);
  return [...(rows || [])].sort((a, b) => compareBins(a.bin, b.bin) || byName(a, b));
}

/** Does this sheet know where anything is? */
export function hasBinCodes(session) {
  return (session?.rows || []).some((r) => String(r.bin ?? '').trim());
}

/** How far along a session is. */
export function stocktakeProgress(session) {
  const rows = session?.rows || [];
  const counted = rows.filter((r) => r.counted !== null && r.counted !== undefined).length;
  return { counted, total: rows.length };
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** The session row a scanned code belongs to (barcode wins over SKU). */
export function stocktakeRowByCode(session, code) {
  const k = norm(code);
  if (!k) return null;
  const rows = session?.rows || [];
  return rows.find((r) => norm(r.barcode) === k) || rows.find((r) => norm(r.sku) === k) || null;
}

/**
 * What the count found: every counted row whose number differs from the
 * frozen expected, with the unit delta and its value at the product's
 * current cost — the report owners actually want from a stocktake.
 * `costOf` maps productId → cost (deleted products value at 0).
 */
export function stocktakeVariances(session, products = []) {
  const costOf = new Map(products.map((p) => [p.id, Number(p.cost) || 0]));
  const out = [];
  for (const row of session?.rows || []) {
    if (row.counted === null || row.counted === undefined) continue;
    const delta = round3(Number(row.counted) - (Number(row.expected) || 0));
    if (!delta) continue;
    out.push({
      ...row,
      delta,
      value: qtyValue(delta, costOf.get(row.productId) || 0),
    });
  }
  return out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || Math.abs(b.delta) - Math.abs(a.delta));
}

/** Net value across variances, at cost. */
export function varianceTotals(variances) {
  let value = 0;
  let up = 0;
  let down = 0;
  for (const v of variances) {
    value += v.value;
    if (v.delta > 0) up++;
    else down++;
  }
  return { value: Math.round(value * 100) / 100, up, down, rows: variances.length };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/* ---------- The record a count leaves behind ---------- */

/**
 * How many committed counts keep their per-product lines. Older ones
 * roll down to their totals — the same bargain the activity log strikes
 * with its month buckets: the recent detail in full, the trend for ever.
 */
export const STOCKTAKE_DETAIL = 12;

/** How many records are kept at all, newest first. */
export const STOCKTAKE_MAX = 60;

/**
 * One committed count, as a record worth keeping: the scope, when it ran,
 * how much of it got counted, and what it found — in units and in money.
 *
 * `applyStocktake` used to compute all of this for one review screen and
 * then throw the session away, leaving a set of recount entries whose
 * only common thread was a note string. "How bad was shrinkage last
 * month, and is it getting better?" — the question a count exists to
 * answer — had to be reassembled by hand out of the log.
 */
export function buildStocktakeRecord(session, variances, { at = Date.now(), adjusted = 0 } = {}) {
  const progress = stocktakeProgress(session);
  const totals = varianceTotals(variances);
  let unitsOver = 0;
  let unitsShort = 0;
  let measured = 0;
  for (const v of variances) {
    if (!isCountUnit(v.unit)) { measured++; continue; }
    if (v.delta > 0) unitsOver = round3(unitsOver + v.delta);
    else unitsShort = round3(unitsShort - v.delta);
  }
  return {
    id: session.id,
    startedAt: session.startedAt,
    committedAt: at,
    scope: { ...session.scope },
    blind: !!session.blind,
    sortBy: session.sortBy || 'name',
    total: progress.total,
    counted: progress.counted,
    skipped: progress.total - progress.counted,
    matched: progress.counted - variances.length,
    adjusted,
    varied: variances.length,
    unitsOver,
    unitsShort,
    measured,
    value: totals.value,
    ...countValues({ lines: variances }),
    lines: variances.map((v) => ({
      productId: v.productId,
      name: v.name,
      sku: v.sku || '',
      unit: v.unit,
      bin: v.bin || '',
      expected: v.expected,
      counted: v.counted,
      delta: v.delta,
      value: v.value,
    })),
  };
}

/**
 * Keep the history bounded: the newest records in full, older ones as
 * their totals, and nothing beyond STOCKTAKE_MAX at all. A rolled record
 * still answers the trend question, which is the one that outlives the
 * detail.
 */
export function trimStocktakeHistory(records) {
  const list = [...(records || [])].sort((a, b) => (b.committedAt || 0) - (a.committedAt || 0));
  return list.slice(0, STOCKTAKE_MAX).map((record, i) => {
    if (i < STOCKTAKE_DETAIL || !record.lines) return record;
    const { lines, ...rest } = record;
    return { ...rest, ...countValues(record), rolled: true };
  });
}

/** Records committed within the window, newest first. */
export function stocktakeHistory(records, { days = 0, now = Date.now() } = {}) {
  const from = days > 0 ? now - days * 24 * 3600 * 1000 : null;
  return (records || [])
    .filter((r) => from === null || (Number(r.committedAt) || 0) >= from)
    .sort((a, b) => (b.committedAt || 0) - (a.committedAt || 0));
}

/**
 * What counting has found over a window: one point per count, plus the
 * totals. A count is the only moment the app learns what is genuinely
 * missing, so it is the only honest source for that trend — `short` is
 * the money a count could not account for, which is the number people
 * mean by shrinkage.
 */
function countValues(record) {
  if (Number.isFinite(record.valueShort) && Number.isFinite(record.valueOver)) {
    return { valueShort: record.valueShort, valueOver: record.valueOver };
  }
  // Older detailed records can still recover both amounts. Already
  // rolled legacy records retain only their net, the best evidence left.
  const lines = Array.isArray(record.lines) ? record.lines : [{ value: record.value }];
  let valueShort = 0, valueOver = 0;
  for (const line of lines) {
    const value = Number(line.value) || 0;
    if (value < 0) valueShort -= value;
    else valueOver += value;
  }
  return { valueShort: round2(valueShort), valueOver: round2(valueOver) };
}

export function countVarianceTotals(records) {
  const totals = { counts: records.length, short: 0, over: 0, net: 0, unitsShort: 0, unitsOver: 0 };
  for (const r of records) {
    const value = Number(r.value) || 0;
    const amounts = countValues(r);
    totals.short = round2(totals.short + amounts.valueShort);
    totals.over = round2(totals.over + amounts.valueOver);
    totals.net = round2(totals.net + value);
    totals.unitsShort = round3(totals.unitsShort + (Number(r.unitsShort) || 0));
    totals.unitsOver = round3(totals.unitsOver + (Number(r.unitsOver) || 0));
  }
  return totals;
}

/** "Everything · 4 Aug" — a record as a chart or list needs it named. */
export function countLabel(record) {
  const scope = record?.scope?.label || 'Everything';
  const at = new Date(Number(record?.committedAt) || Date.now());
  return `${scope} · ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
