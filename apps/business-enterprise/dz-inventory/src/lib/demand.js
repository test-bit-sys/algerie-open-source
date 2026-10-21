/**
 * Demand: how fast stock actually leaves, and what that implies for
 * thresholds and order quantities. Pure — no DOM, no Puter;
 * unit-tested.
 *
 * Everything here is one division and one multiplication over numbers
 * the account already holds: units out per day from the activity log,
 * lead times from the supplier. No seasonality, no smoothing, no
 * statistics — a rate over a window, explainable in one sentence on
 * screen. When the log is too short to say anything, it says nothing
 * and the threshold someone typed stands, which is the whole contract:
 * suggestions never write themselves.
 */

import { movementByProduct, logReach } from './reports.js';
import { roundQty, packSizeOf, isCountUnit } from './units.js';

const DAY = 24 * 3600 * 1000;

/** The window demand is measured over wherever the app shows a rate. */
export const DEMAND_DAYS = 30;

/**
 * Less log than this and a rate would be noise wearing a decimal point:
 * one busy afternoon would read as a permanent trend, and the
 * suggestions built on top of it would be worse than the guess they
 * replace.
 */
export const MIN_DEMAND_DAYS = 7;

/** Days of cover asked for on top of the supplier's lead time. */
export const DEFAULT_SAFETY_DAYS = 3;

/**
 * Units out per day per product, demand only (write-offs already
 * excluded by movementByProduct), plus the span those numbers were
 * measured over so the UI can say so.
 *
 * The span is the *log's* reach inside the window, not the window:
 * dividing a week of sales by thirty days would understate demand
 * four-fold, and every threshold suggested from it would be too low.
 *
 * → { days, rates: Map<productId, perDay>, enough }
 */
export function demandRates(entries, { days = DEMAND_DAYS, now = Date.now() } = {}) {
  const oldest = logReach(entries);
  const span = oldest === null ? 0 : Math.min(days, Math.max(0, (now - oldest) / DAY));
  const rates = new Map();
  if (span < MIN_DEMAND_DAYS) return { days: round1(span), rates, enough: false };
  for (const row of movementByProduct(entries, { days, now, demandOnly: true })) {
    if (row.out <= 0) continue;
    rates.set(row.productId, row.out / span);
  }
  return { days: round1(span), rates, enough: true };
}

/**
 * Days of stock left at the current rate, or null when demand is
 * unknown — a product nothing has left is not "infinite cover", it is a
 * product this feature has nothing to say about.
 */
export function coverDays(product, perDay) {
  const rate = Number(perDay) || 0;
  if (rate <= 0) return null;
  const onHand = Math.max(0, Number(product?.quantity) || 0);
  return round1(onHand / rate);
}

/**
 * How long putting stock back on the shelf realistically takes: the
 * supplier's usual lead time plus the safety days the owner asked for.
 * A product with no supplier falls back to the safety days alone, so
 * the feature works before suppliers are filled in.
 */
export function restockDays(leadTimeDays, safetyDays = DEFAULT_SAFETY_DAYS) {
  const lead = Math.max(0, Math.round(Number(leadTimeDays) || 0));
  const safety = Math.max(0, Math.round(Number(safetyDays) || 0));
  return lead + safety;
}

/**
 * The reorder point demand implies: what sells while a restock is in
 * flight, rounded up to something orderable (a whole pack where the
 * product is bought in packs, a whole unit where it's counted).
 *
 * Null when demand is unknown or nothing takes any time — there is no
 * arithmetic to show, so the form offers no suggestion.
 */
export function suggestedThreshold(product, { perDay = 0, leadTimeDays = 0, safetyDays = DEFAULT_SAFETY_DAYS } = {}) {
  const rate = Number(perDay) || 0;
  const window = restockDays(leadTimeDays, safetyDays);
  if (rate <= 0 || window <= 0) return null;
  const need = rate * window;
  const pack = packSizeOf(product);
  // The epsilon keeps float residue (5.7 / 1.9 → 3.0000000000000004)
  // from rounding an exact whole-pack need up to a whole extra pack.
  const up = pack
    ? Math.ceil(need / pack - 1e-9) * pack
    : (isCountUnit(product?.unit) ? Math.ceil(need - 1e-9) : need);
  return roundQty(Math.max(up, isCountUnit(product?.unit) ? 1 : 0.001), product?.unit);
}

/**
 * Is this product going to run out before a restock could land? That —
 * not a number typed months ago — is what "needs attention" means when
 * the app knows how fast something sells: fifty units with three days
 * of cover is the shelf that empties this week.
 */
export function runningOut(product, { perDay = 0, leadTimeDays = 0, safetyDays = DEFAULT_SAFETY_DAYS } = {}) {
  const cover = coverDays(product, perDay);
  if (cover === null) return false;
  return cover <= restockDays(leadTimeDays, safetyDays);
}

/**
 * "≈1.4 a day" — the rate as the UI says it, at the precision the
 * number deserves. Blank when there's no rate to state.
 */
export function rateLabel(perDay, unit) {
  const rate = Number(perDay) || 0;
  if (rate <= 0) return '';
  const n = rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10;
  return `≈${n} ${isCountUnit(unit) ? (n === 1 ? 'unit' : 'units') : unit} a day`;
}

/** "4 days of cover", "half a day of cover", "out of stock". */
export function coverLabel(cover) {
  if (cover === null || cover === undefined) return '';
  if (cover <= 0) return 'out of stock';
  if (cover < 1) return 'under a day of cover';
  const n = cover >= 10 ? Math.round(cover) : Math.round(cover * 10) / 10;
  return `${n} day${n === 1 ? '' : 's'} of cover`;
}

const round1 = (n) => Math.round(n * 10) / 10;
