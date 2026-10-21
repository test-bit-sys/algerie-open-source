/**
 * Where deals leak.
 *
 * The forecast page could say how often deals are won, how long each stage
 * takes, and why deals close - but not which *step* loses them. A 60% win
 * rate out of Proposal is a different business from a 12% conversion into
 * Proposal, and the fix is different too: one is a closing problem, the
 * other a qualification problem.
 *
 * Every deal already carries `stageHistory`, so all of this is derived at
 * render time - no snapshots, no new stored data. Pure functions over
 * plain deals plus the configured stage list.
 */

import { monthKey, round2 } from './util.js';
import { isTerminalStage, openStages } from './forecast.js';

/**
 * Cohorts a founder actually compares: this quarter against last, and the
 * year so far. A deal joins a cohort by when it *entered the funnel* (its
 * first recorded stage), which is the only date every deal has - an open
 * one has no close date, and an expected one is a guess.
 */
export const FUNNEL_WINDOWS = [
  { value: 'all', label: 'All time' },
  { value: 'quarter', label: 'Entered this quarter' },
  { value: 'last-quarter', label: 'Entered last quarter' },
  { value: 'year', label: 'Entered this year' },
];

/** When a deal joined the funnel: its first stage entry, else its clock. */
export function enteredAt(deal) {
  const hist = Array.isArray(deal?.stageHistory) ? deal.stageHistory : [];
  const first = hist.find((e) => Number.isFinite(e?.at));
  return first ? first.at : (Number(deal?.createdAt) || 0);
}

const quarterStart = (date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);

/** Is this deal in the cohort? `all` takes everything. */
export function matchesFunnelWindow(deal, window, now = new Date()) {
  if (!window || window === 'all') return true;
  const at = enteredAt(deal);
  if (!at) return false;
  const when = new Date(at);
  if (window === 'year') return when.getFullYear() === now.getFullYear();
  const start = quarterStart(now);
  if (window === 'quarter') return when >= start;
  if (window === 'last-quarter') {
    const prev = new Date(start.getFullYear(), start.getMonth() - 3, 1);
    return when >= prev && when < start;
  }
  return true;
}

/** The month a deal entered the funnel, for a label. */
export function enteredMonth(deal) {
  const at = enteredAt(deal);
  return at ? monthKey(new Date(at)) : null;
}

/**
 * The stages a deal has been in, and the furthest it got.
 *
 * `reached` is literal: a deal created straight into Proposal never
 * entered New, and counting it there would invent a conversion nobody
 * made. `furthest` is the highest position in the configured order it ever
 * held, which is how "did it advance past this stage?" is answered even
 * for a deal that moved backwards on the way.
 */
function journeyOf(deal, order) {
  const hist = Array.isArray(deal.stageHistory) ? deal.stageHistory : [];
  const reached = new Set();
  let furthest = -1;
  for (const entry of hist) {
    const stage = entry?.stage;
    if (typeof stage !== 'string' || !stage) continue;
    reached.add(stage);
    const at = order.get(stage);
    if (at !== undefined && at > furthest) furthest = at;
  }
  // The deal's own stage always counts, even if the history somehow missed
  // it - normalizeStageHistory keeps the two in step, and this is the
  // belt: a stage the deal is sitting in was certainly reached.
  if (typeof deal.stage === 'string' && deal.stage) {
    reached.add(deal.stage);
    const at = order.get(deal.stage);
    if (at !== undefined && at > furthest) furthest = at;
  }
  return { reached, furthest };
}

/** The stage a lost deal was in when it died: the entry before Lost. */
export function lostFromStage(deal) {
  if (deal.stage !== 'lost') return null;
  const hist = Array.isArray(deal.stageHistory) ? deal.stageHistory : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const stage = hist[i]?.stage;
    if (stage && !isTerminalStage(stage)) return stage;
  }
  return null;
}

/**
 * Has this deal any recorded journey through the open funnel at all?
 *
 * A deal closed before stage tracking existed carries one synthesized
 * entry naming the terminal stage it is already in - it never visibly
 * entered anything, and counting it would read as an instant conversion.
 * The report excludes those and says how many it excluded.
 */
export function hasOpenHistory(deal) {
  const hist = Array.isArray(deal.stageHistory) ? deal.stageHistory : [];
  return hist.some((e) => e?.stage && !isTerminalStage(e.stage))
    || (typeof deal.stage === 'string' && !isTerminalStage(deal.stage));
}

/**
 * The funnel: per stage, how many deals entered it, how many advanced past
 * it, how many died there, and how many are still sitting at or behind it.
 *
 *   {
 *     rows: [{ stage, label, gone, entered, advanced, lostHere, open,
 *              advanceRate, lossShare }],
 *     totals: { deals, won, lost, open, wonRate },
 *     untracked,
 *   }
 *
 * `rows` follows the configured order, then any stage only the history
 * remembers - one the funnel has since dropped - so a removed stage's
 * numbers are reported rather than silently swallowed.
 */
export function funnelReport(deals, stages) {
  const open = openStages(stages);
  const order = new Map(open.map((s, i) => [s.id, i]));
  // Won sits past every open stage; lost is not a position at all.
  order.set('won', open.length);

  const tracked = (Array.isArray(deals) ? deals : []).filter(hasOpenHistory);
  const untracked = (Array.isArray(deals) ? deals : []).length - tracked.length;

  const buckets = new Map();
  const bucket = (stage) => {
    let row = buckets.get(stage);
    if (!row) {
      row = { stage, entered: 0, advanced: 0, lostHere: 0, open: 0 };
      buckets.set(stage, row);
    }
    return row;
  };
  for (const s of open) bucket(s.id);

  const totals = { deals: tracked.length, won: 0, lost: 0, open: 0, wonRate: null };

  for (const deal of tracked) {
    if (deal.stage === 'won') totals.won++;
    else if (deal.stage === 'lost') totals.lost++;
    else totals.open++;

    const { reached, furthest } = journeyOf(deal, order);
    const diedIn = lostFromStage(deal);
    for (const stage of reached) {
      if (isTerminalStage(stage)) continue;
      const row = bucket(stage);
      row.entered++;
      const at = order.get(stage);
      // Unknown stages (removed from the funnel) have no position, so
      // "advanced past it" can't be read from the order - a deal that
      // moved on from one is counted by where it is now instead.
      const advanced = at === undefined
        ? deal.stage === 'won' || (deal.stage !== 'lost' && deal.stage !== stage)
        : furthest > at;
      if (advanced) row.advanced++;
      else if (diedIn === stage) row.lostHere++;
      else if (deal.stage !== 'lost') row.open++;
    }
  }

  const lostTotal = [...buckets.values()].reduce((n, r) => n + r.lostHere, 0);
  const known = new Set(open.map((s) => s.id));
  const rows = [...buckets.values()]
    .sort((a, b) => (order.get(a.stage) ?? Infinity) - (order.get(b.stage) ?? Infinity))
    .map((row) => ({
      ...row,
      label: stages.find((s) => s.id === row.stage)?.label || row.stage,
      gone: !known.has(row.stage),
      advanceRate: row.entered ? round2(row.advanced / row.entered) : null,
      lossShare: lostTotal ? round2(row.lostHere / lostTotal) : null,
    }));

  totals.wonRate = totals.deals ? round2(totals.won / totals.deals) : null;
  totals.lostShareBase = lostTotal;
  return { rows, totals, untracked };
}
