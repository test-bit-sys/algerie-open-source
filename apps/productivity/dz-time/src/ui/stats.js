/** Stat-tile builders shared by views. */

import { el } from './dom.js';
import { fmtDuration } from '../lib/time.js';
import { fmtMoney } from '../lib/util.js';

/**
 * Stat-tile value for per-currency amounts. A stat value is a single
 * clipped line, so "€1,265.00 · $892.91" would lose the second currency
 * with no way to reveal it — and nothing here is ever converted or
 * summed, so that is money the user cannot see anywhere else. One
 * currency reads exactly as before; several stack, one per line.
 */
export function moneyValue(amounts, fallbackCurrency = 'USD') {
  const list = amounts?.length ? amounts : [{ amount: 0, currency: fallbackCurrency }];
  if (list.length === 1) return fmtMoney(list[0].amount, list[0].currency);
  return el('span.money-stack', {},
    list.map((a) => el('span', {}, fmtMoney(a.amount, a.currency))));
}

/**
 * A week stat tile showing quiet progress toward the weekly target:
 * "Xh Ym of Zh" plus a small bar. Reaching the target turns the bar
 * green; there are no toasts or notifications by design.
 */
export function targetStatTile(label, doneSeconds, targetHours) {
  const targetSeconds = targetHours * 3600;
  const pct = Math.min(100, Math.round((doneSeconds / targetSeconds) * 100));
  const met = doneSeconds >= targetSeconds;
  return el('div.stat-tile', {
    role: 'img',
    'aria-label': `${label}: ${fmtDuration(doneSeconds)} of the ${targetHours} hour weekly target`,
  },
    el('div.stat-label', {}, label),
    el('div.stat-value', {},
      fmtDuration(doneSeconds),
      el('span.stat-value-sub', {}, ` of ${targetHours}h`)
    ),
    el('div.target-track', { 'aria-hidden': 'true' },
      el('div', {
        className: `target-bar${met ? ' met' : ''}`,
        style: { width: `${Math.max(2, pct)}%` },
      }))
  );
}
