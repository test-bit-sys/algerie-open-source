/**
 * Recurring revenue: what a deal is worth per month, per year, and over
 * its whole contract.
 *
 * Most founders using a CRM like this sell subscriptions, and a deal
 * carrying one `value` can only be entered one of two wrong ways: the
 * monthly price (the forecast reads a twelfth of the deal) or the annual
 * one (the close month shows a year of revenue landing at once). A deal
 * says how it bills instead, and every figure below is derived from
 * `value` + `billing` + `term` - nothing is stored twice.
 *
 * Pure functions over plain deal objects, so they test without Puter or a
 * DOM. Deliberately no dependency on forecast.js: that module reads this
 * one, and the reverse would be a cycle.
 */

import { monthKey, shiftMonthKey, round2, formatMoney, compactMoney } from './util.js';

/** How a deal bills. `one-time` is the default and the historical behaviour. */
export const BILLING_MODES = [
  { value: 'one-time', label: 'One-time', per: '', valueLabel: 'Value' },
  { value: 'monthly', label: 'Monthly', per: '/mo', valueLabel: 'Monthly value' },
  { value: 'annual', label: 'Annual', per: '/yr', valueLabel: 'Annual value' },
];

const MODE_IDS = new Set(BILLING_MODES.map((m) => m.value));

/** Contract length used when a recurring deal doesn't name one. */
export const DEFAULT_TERM = 12;
/** Ten years. Long enough for any real contract, short enough to stay sane. */
export const MAX_TERM = 120;

/**
 * A well-formed billing mode. Anything unrecognized - including the absent
 * field on every deal written before this feature - reads as one-time, so
 * existing data and every report over it are unchanged.
 */
export function normalizeBilling(value) {
  return MODE_IDS.has(value) ? value : 'one-time';
}

export function isRecurring(deal) {
  return normalizeBilling(deal?.billing) !== 'one-time';
}

/**
 * Contract term in whole months, or null for a one-time deal (which has
 * no term to speak of). Only a number, or a string that spells one,
 * counts - the same strict reading the rest of the data layer uses.
 */
export function normalizeTerm(value, billing = 'monthly') {
  if (normalizeBilling(billing) === 'one-time') return null;
  const n = typeof value === 'number' ? value
    : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isFinite(n)) return DEFAULT_TERM;
  return Math.min(MAX_TERM, Math.max(1, Math.round(n)));
}

/** The term a deal actually runs for: 1 for a one-time deal. */
export function termOf(deal) {
  const billing = normalizeBilling(deal?.billing);
  if (billing === 'one-time') return 1;
  return normalizeTerm(deal?.term, billing);
}

const amountOf = (deal) => Number(deal?.value) || 0;

/** Monthly recurring revenue: 0 for a one-time deal. */
export function mrrOf(deal) {
  const billing = normalizeBilling(deal?.billing);
  if (billing === 'monthly') return round2(amountOf(deal));
  if (billing === 'annual') return round2(amountOf(deal) / 12);
  return 0;
}

/** Annual recurring revenue: MRR × 12. */
export function arrOf(deal) {
  return round2(mrrOf(deal) * 12);
}

/**
 * Total contract value - what the deal is worth in full. A one-time deal
 * is its own value, so every number built on this is unchanged for data
 * that predates billing.
 */
export function contractValue(deal) {
  const billing = normalizeBilling(deal?.billing);
  if (billing === 'one-time') return round2(amountOf(deal));
  const term = normalizeTerm(deal?.term, billing);
  return round2(billing === 'monthly'
    ? amountOf(deal) * term
    : amountOf(deal) * (term / 12));
}

/**
 * The months a deal's revenue actually lands in, starting at `startKey`
 * (a YYYY-MM key): [{ key, amount }].
 *
 * A one-time deal is one entry, so callers that spread revenue behave
 * exactly as they did before. Monthly bills every month of the term.
 * Annual bills once per 12-month period, prorated when a term stops
 * mid-year - a two-and-a-half-year contract is two full years plus half.
 */
export function billingSpread(deal, startKey = monthKey()) {
  const billing = normalizeBilling(deal?.billing);
  const value = amountOf(deal);
  if (billing === 'one-time') return [{ key: startKey, amount: round2(value) }];
  const term = normalizeTerm(deal?.term, billing);
  const out = [];
  if (billing === 'monthly') {
    for (let i = 0; i < term; i++) {
      out.push({ key: shiftMonthKey(startKey, i), amount: round2(value) });
    }
    return out;
  }
  for (let i = 0; i < term; i += 12) {
    const months = Math.min(12, term - i);
    out.push({ key: shiftMonthKey(startKey, i), amount: round2(value * (months / 12)) });
  }
  return out;
}

/** Amount a deal bills in one month of a schedule that starts at `startKey`. */
export function billedInMonth(deal, startKey, key) {
  let total = 0;
  for (const entry of billingSpread(deal, startKey)) {
    if (entry.key === key) total += entry.amount;
  }
  return round2(total);
}

/** The month a won deal's revenue starts landing in. */
export function revenueStartKey(deal) {
  return monthKey(deal?.closedAt ? new Date(deal.closedAt) : new Date());
}

/** Is `key` inside the term of a won recurring deal? */
export function contractCoversMonth(deal, key = monthKey()) {
  if (!isRecurring(deal)) return false;
  const start = revenueStartKey(deal);
  const term = termOf(deal);
  return key >= start && key < shiftMonthKey(start, term);
}

/**
 * Committed recurring revenue: MRR and ARR across won recurring deals
 * whose contract still covers `key`, and how many contracts that is.
 * A contract whose term has run out stops counting - there is no renewal
 * pipeline here, so the honest reading is that it has finished billing.
 */
export function recurringSummary(deals, key = monthKey()) {
  let mrr = 0;
  let count = 0;
  for (const deal of Array.isArray(deals) ? deals : []) {
    if (deal?.stage !== 'won' || !contractCoversMonth(deal, key)) continue;
    mrr += mrrOf(deal);
    count++;
  }
  return { mrr: round2(mrr), arr: round2(mrr * 12), count };
}

/** Open recurring deals: the MRR still in play, for the same tile's sub-line. */
export function pipelineMRR(deals) {
  let mrr = 0;
  let count = 0;
  for (const deal of Array.isArray(deals) ? deals : []) {
    if (!deal || deal.stage === 'won' || deal.stage === 'lost' || !isRecurring(deal)) continue;
    mrr += mrrOf(deal);
    count++;
  }
  return { mrr: round2(mrr), count };
}

/* ---------- words for the numbers ---------- */

export function billingInfo(deal) {
  const id = normalizeBilling(deal?.billing);
  return BILLING_MODES.find((m) => m.value === id) || BILLING_MODES[0];
}

/** "Monthly", "Annual", "One-time" - the label for a badge or a CSV cell. */
export function billingLabel(deal) {
  return billingInfo(deal).label;
}

/** "$2,000/mo", "$24,000/yr", or plain "$5,000" for one-time. */
export function rateText(deal, currency = 'USD', { compact = false } = {}) {
  const money = compact ? compactMoney : formatMoney;
  return `${money(amountOf(deal), currency)}${billingInfo(deal).per}`;
}

/** "1 month" / "12 months" for a term, or null when there isn't one. */
export function termText(deal) {
  if (!isRecurring(deal)) return null;
  const term = termOf(deal);
  return `${term} month${term === 1 ? '' : 's'}`;
}

/**
 * What the whole contract comes to: "$24,000 over 12 months". Null for a
 * one-time deal, whose value already says it.
 */
export function contractText(deal, currency = 'USD', { compact = false } = {}) {
  if (!isRecurring(deal)) return null;
  const money = compact ? compactMoney : formatMoney;
  return `${money(contractValue(deal), currency)} over ${termText(deal)}`;
}
