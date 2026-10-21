/**
 * Pipeline trends: the trajectory the forecast page can't see.
 *
 * "Am I adding pipeline as fast as I'm closing it?" is *the* solo-founder
 * sales question, and every number here derives at render time from
 * fields the deals already carry - createdAt, closedAt, value, stage.
 * No snapshots, no scheduler, no new stored data. Pure functions.
 */

import { monthKey, shiftMonthKey, round2 } from './util.js';
import { contractValue } from './recurring.js';

const DAY = 86400000;

/** The last `months` month keys ending at `to`, oldest first. */
export function monthSpan(months = 12, to = monthKey()) {
  return Array.from({ length: months }, (_, i) => shiftMonthKey(to, i - (months - 1)));
}

/**
 * Monthly pipeline flows over the last `months` months:
 *   [{ key, added: { count, value }, won: {...}, lost: {...} }]
 * Added buckets by the month a deal was created (whatever became of it);
 * won and lost bucket by the month the deal closed.
 *
 * Money is a deal's *contract* value, the way every other figure in the
 * app reads it: a $3k/mo deal on a 6-month term added $18k of pipeline,
 * not $3k. Reading the bare field here made this the one chart on the
 * Forecast page that disagreed with the tiles and the table above it.
 */
export function monthlyFlows(deals, { months = 12, to = monthKey() } = {}) {
  const rows = monthSpan(months, to).map((key) => ({
    key,
    added: { count: 0, value: 0 },
    won: { count: 0, value: 0 },
    lost: { count: 0, value: 0 },
  }));
  const index = new Map(rows.map((r) => [r.key, r]));

  for (const deal of deals) {
    const value = contractValue(deal);
    if (Number.isFinite(deal.createdAt)) {
      const row = index.get(monthKey(new Date(deal.createdAt)));
      if (row) {
        row.added.count++;
        row.added.value = round2(row.added.value + value);
      }
    }
    if ((deal.stage === 'won' || deal.stage === 'lost') && Number.isFinite(deal.closedAt)) {
      const row = index.get(monthKey(new Date(deal.closedAt)));
      if (row) {
        const bucket = row[deal.stage];
        bucket.count++;
        bucket.value = round2(bucket.value + value);
      }
    }
  }
  return rows;
}

/**
 * Win rate per close month, from flows. `rate` is null in a month where
 * nothing closed - no data is not 0%.
 */
export function winRateTrend(flows) {
  return flows.map((r) => {
    const closed = r.won.count + r.lost.count;
    return { key: r.key, rate: closed ? round2(r.won.count / closed) : null, closed };
  });
}

/**
 * Average days from created to closed for deals WON in each month - the
 * sales-cycle length, tracked over time. Null where nothing was won.
 */
export function salesCycleTrend(deals, { months = 12, to = monthKey() } = {}) {
  const totals = new Map();
  for (const deal of deals) {
    if (deal.stage !== 'won') continue;
    if (!Number.isFinite(deal.closedAt) || !Number.isFinite(deal.createdAt)) continue;
    const key = monthKey(new Date(deal.closedAt));
    const t = totals.get(key) || { days: 0, count: 0 };
    t.days += Math.max(0, (deal.closedAt - deal.createdAt) / DAY);
    t.count++;
    totals.set(key, t);
  }
  return monthSpan(months, to).map((key) => {
    const t = totals.get(key);
    return { key, days: t ? Math.round(t.days / t.count) : null, count: t?.count || 0 };
  });
}
