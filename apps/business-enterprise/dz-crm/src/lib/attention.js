/**
 * Who is going quiet.
 *
 * Every meeting, call, email, and note already carries a date, so "when
 * did I last talk to this person?" is derivable - it was just never
 * derived. These are pure functions over plain records plus a lookup for
 * last-activity dates, so they test without Puter or a DOM.
 */

import { todayISO, daysBetween } from './util.js';
import { isOpen } from './forecast.js';
import { contractValue } from './recurring.js';
import { hasDecisionMaker } from './deal-contacts.js';

/** Days of silence before a lead counts as going cold. */
export const DEFAULT_COLD_DAYS = 14;

/** Statuses worth chasing - a customer or a lost lead isn't "going cold". */
const CHASEABLE = new Set(['lead', 'active']);

/**
 * Since when has this record been quiet? Falls back to when it was created,
 * so a lead added this morning isn't cold for lack of history.
 */
function quietSince(lastAt, createdAt, today) {
  const since = lastAt || (Number.isFinite(createdAt) ? todayISO(new Date(createdAt)) : today);
  return { since, days: Math.max(0, daysBetween(since, today)) };
}

/**
 * Leads nobody has touched lately, coldest first.
 * `lastTouchOf(contactId)` returns an ISO date or null.
 *
 *   [{ contact, lastAt, days }]
 */
export function goingCold(contacts, lastTouchOf, { coldDays = DEFAULT_COLD_DAYS, today = todayISO() } = {}) {
  if (!coldDays) return [];
  return contacts
    .filter((c) => CHASEABLE.has(c.status))
    .map((c) => {
      const lastAt = lastTouchOf(c.id) || null;
      const { days } = quietSince(lastAt, c.createdAt, today);
      return { contact: c, lastAt, days };
    })
    .filter((r) => r.days >= coldDays)
    .sort((a, b) => b.days - a.days || a.contact.name.localeCompare(b.contact.name));
}

/**
 * Open deals with no next action: no open follow-up, and no recent
 * activity either. The classic gap that turns a live deal into a dead one.
 *
 *   [{ deal, lastAt, days }]
 */
export function noNextStep(deals, {
  lastTouchOf, hasOpenTask, coldDays = DEFAULT_COLD_DAYS, today = todayISO(),
} = {}) {
  if (!coldDays) return [];
  return deals
    .filter((d) => isOpen(d) && !hasOpenTask(d.id))
    .map((d) => {
      const lastAt = lastTouchOf(d) || null;
      const { days } = quietSince(lastAt, d.createdAt, today);
      return { deal: d, lastAt, days };
    })
    .filter((r) => r.days >= coldDays)
    .sort((a, b) => b.days - a.days || contractValue(b.deal) - contractValue(a.deal));
}

/**
 * Open deals with nobody named as the person who signs.
 *
 * The question that actually decides a B2B deal is whether you have ever
 * spoken to the decision maker, and a deal can look busy - calls logged,
 * follow-ups booked - while the answer is no. Biggest first: that is where
 * the missing name costs the most.
 *
 *   [{ deal }]
 */
export function noDecisionMaker(deals) {
  return deals
    .filter((d) => isOpen(d) && !hasDecisionMaker(d))
    .map((deal) => ({ deal }))
    .sort((a, b) => contractValue(b.deal) - contractValue(a.deal)
      || String(a.deal.name).localeCompare(String(b.deal.name)));
}
