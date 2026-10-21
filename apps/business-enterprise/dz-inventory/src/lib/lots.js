/**
 * Dated lots for products that track expiry ("track expiry dates" on
 * the product form). Deliberately lean: a lot is { date, qty } — no
 * supplier lot numbers, no per-lot cost — enough to answer "what do I
 * need to sell or toss this week?".
 *
 * A tracked product holds `lots: { [locationId]: [{ date, qty }] }`
 * alongside its `stock` buckets; the buckets stay the cached totals
 * (sum of lots per location), so everything that reads quantities keeps
 * working untouched. Dates are local 'YYYY-MM-DD' strings; '' means
 * "date unknown" (stock from before tracking, or receipts that didn't
 * say). FEFO order is earliest date first, unknown-date last.
 *
 * Pure — no DOM, no Puter; unit-tested.
 */

import { asList } from './util.js';

/** The date of a lot whose expiry nobody recorded. */
export const NO_DATE = '';

const round3 = (n) => Math.round(n * 1000) / 1000;

const cleanDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d ?? '')) ? String(d) : NO_DATE);

/** First-expired-first-out order: dated lots ascending, undated last. */
function fefo(a, b) {
  if (a.date === b.date) return 0;
  if (a.date === NO_DATE) return 1;
  if (b.date === NO_DATE) return -1;
  return a.date < b.date ? -1 : 1;
}

/** Merge same dates, drop empties and junk, sort FEFO. Always a new array. */
export function normalizeLots(list) {
  const byDate = new Map();
  for (const lot of asList(list)) {
    const qty = Number(lot?.qty) || 0;
    if (qty <= 0) continue;
    const date = cleanDate(lot.date);
    byDate.set(date, round3((byDate.get(date) || 0) + qty));
  }
  return [...byDate.entries()].map(([date, qty]) => ({ date, qty })).sort(fefo);
}

export function lotsTotal(lots) {
  let n = 0;
  for (const lot of asList(lots)) n += Number(lot?.qty) || 0;
  return round3(n);
}

/** A receipt: one more lot (or more of an existing one). */
export function addLot(lots, date, qty) {
  const n = Number(qty) || 0;
  if (n <= 0) return normalizeLots(lots);
  return normalizeLots([...(lots || []), { date: cleanDate(date), qty: n }]);
}

/**
 * Take `qty` in FEFO order. Returns { lots, taken } — `taken` keeps the
 * dates of what left, so a move can carry them to the other end.
 * Taking more than there is takes what there is.
 */
export function consumeLots(lots, qty) {
  let need = Number(qty) || 0;
  const rest = [];
  const taken = [];
  for (const lot of normalizeLots(lots)) {
    if (need <= 0) { rest.push(lot); continue; }
    const take = Math.min(lot.qty, need);
    need = round3(need - take);
    if (take > 0) taken.push({ date: lot.date, qty: take });
    if (lot.qty - take > 0) rest.push({ date: lot.date, qty: round3(lot.qty - take) });
  }
  return { lots: rest, taken };
}

/**
 * Take `qty` from the lot dated `date` first — the override for when
 * reality differs from FEFO — spilling into FEFO order only if that
 * lot runs out.
 */
export function consumeLotAt(lots, date, qty) {
  const wanted = cleanDate(date);
  const all = normalizeLots(lots);
  const hit = all.find((l) => l.date === wanted);
  if (!hit) return consumeLots(all, qty);
  const need = Number(qty) || 0;
  const fromHit = Math.min(hit.qty, need);
  const hitRest = round3(hit.qty - fromHit);
  const spill = consumeLots(all.filter((l) => l.date !== wanted), round3(need - fromHit));
  return {
    lots: normalizeLots([...(hitRest > 0 ? [{ date: wanted, qty: hitRest }] : []), ...spill.lots]),
    taken: [...(fromHit > 0 ? [{ date: wanted, qty: fromHit }] : []), ...spill.taken],
  };
}

/**
 * Make the lots sum to `target`: growth becomes undated stock (a
 * recount can't know a date), shrinkage leaves in FEFO order.
 */
export function resizeLots(lots, target) {
  const want = Math.max(0, Number(target) || 0);
  const have = lotsTotal(lots);
  if (want === have) return normalizeLots(lots);
  if (want > have) return addLot(lots, NO_DATE, round3(want - have));
  return consumeLots(lots, round3(have - want)).lots;
}

/* ---------- Per-product views ---------- */

/** Normalized lots at one location of a tracked product. */
export function lotsAt(product, locationId) {
  return normalizeLots(asList(product?.lots?.[locationId ?? NO_DATE]));
}

/** Every lot across locations, merged by date, FEFO order. */
export function allLots(product) {
  const merged = [];
  for (const list of Object.values(product?.lots || {})) merged.push(...asList(list));
  return normalizeLots(merged);
}

/** Local YYYY-MM-DD for a timestamp. */
export function dayStamp(now = Date.now()) {
  const d = new Date(now);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * YYYY-MM-DD `days` from now, local. Calendar arithmetic, not
 * now + days × 24h: across a daylight-saving change that lands an hour
 * short and names the day before, quietly dropping a whole day's worth
 * of lots out of the expiring-soon window.
 */
export function dayStampIn(days, now = Date.now()) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return dayStamp(d.getTime());
}

/**
 * How a tracked product stands against the calendar: units already
 * expired, units expiring within `days` (expired excluded), and the
 * earliest date on hand. Null for untracked products.
 */
export function expiryStatus(product, { days = 30, now = Date.now() } = {}) {
  if (!product?.trackExpiry) return null;
  const today = dayStamp(now);
  const horizon = dayStampIn(days, now);
  let expired = 0;
  let soon = 0;
  let soonest = NO_DATE;
  for (const lot of allLots(product)) {
    if (lot.date === NO_DATE) continue;
    if (!soonest) soonest = lot.date;
    if (lot.date < today) expired = round3(expired + lot.qty);
    else if (lot.date <= horizon) soon = round3(soon + lot.qty);
  }
  return { expired, soon, soonest };
}

/**
 * Tracked products with anything expired or expiring within `days`,
 * worst first by value at cost — the dashboard's expiry alerts.
 */
export function expiringProducts(products, { days = 30, now = Date.now() } = {}) {
  const out = [];
  for (const p of products || []) {
    if (p.archived || !p.trackExpiry) continue;
    const status = expiryStatus(p, { days, now });
    if (!status || (status.expired <= 0 && status.soon <= 0)) continue;
    const cost = Number(p.cost) || 0;
    out.push({
      product: p,
      ...status,
      value: Math.round((status.expired + status.soon) * cost * 100) / 100,
    });
  }
  // Anything already expired outranks anything merely due, and within
  // each group the money at stake decides — 2 units of something worth
  // £500 matters more than 100 units of something worth 10p.
  return out.sort((a, b) => ((b.expired > 0) - (a.expired > 0)) || (b.value - a.value));
}

/** Does this product have stock expired or expiring within `days`? */
export function isExpiring(product, { days = 30, now = Date.now() } = {}) {
  const status = expiryStatus(product, { days, now });
  return !!status && (status.expired > 0 || status.soon > 0);
}

/** "Sep 4" / "Sep 4, 2027" for a lot date; "No date" when unknown. */
export function lotDateLabel(date, now = Date.now()) {
  if (!date || date === NO_DATE) return 'No date';
  const [y, m, d] = String(date).split('-').map(Number);
  if (!y || !m || !d) return String(date);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    year: y === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}
