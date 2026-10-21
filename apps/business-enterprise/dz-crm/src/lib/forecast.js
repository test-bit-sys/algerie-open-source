/**
 * Forecast & pipeline math. Pure functions over plain deal objects so the
 * whole module is testable without Puter or a DOM.
 *
 * A deal: { id, name, value, stage, expectedClose (ISO date), closedAt?, ... }
 * Stages carry the win probability used for weighting; won = 1, lost = 0.
 *
 * Every figure here reads a deal's *contract* value (see lib/recurring.js),
 * so a $2k/mo deal on a 12-month term is worth $24k to the pipeline rather
 * than $2k. A one-time deal - the default, and every deal written before
 * billing existed - is its own value, so all of this is unchanged for it.
 */

import { monthKey, shiftMonthKey, round2, todayISO } from './util.js';
import { contractValue, billingSpread, isRecurring } from './recurring.js';

/** Won and lost are terminal: always last, always pinned to 1/0. */
export const TERMINAL_STAGES = [
  { id: 'won', label: 'Won', probability: 1 },
  { id: 'lost', label: 'Lost', probability: 0 },
];

/** The out-of-the-box funnel, used until the user configures their own. */
export const DEFAULT_OPEN_STAGES = [
  { id: 'new', label: 'New', probability: 0.1 },
  { id: 'qualified', label: 'Qualified', probability: 0.25 },
  { id: 'proposal', label: 'Proposal', probability: 0.5 },
  { id: 'negotiation', label: 'Negotiation', probability: 0.75 },
];

/** Default stage list. Runtime code uses store.stages() - the configured one. */
export const STAGES = [...DEFAULT_OPEN_STAGES, ...TERMINAL_STAGES];

export const OPEN_STAGES = DEFAULT_OPEN_STAGES;

/** A board with more columns than this stops being readable. */
export const MAX_OPEN_STAGES = 8;

export function isTerminalStage(stageId) {
  return stageId === 'won' || stageId === 'lost';
}

export function openStages(stages = STAGES) {
  return stages.filter((s) => !isTerminalStage(s.id));
}

/** Id new deals (and deals with an unknown stage) land on. */
export function firstStageId(stages = STAGES) {
  return openStages(stages)[0]?.id || STAGES[0].id;
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * Drop anything that would break the board: non-objects, blank/duplicate
 * ids, ids colliding with the terminal stages, and everything past the cap.
 */
function sanitizeOpenStages(list) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object') continue;
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    if (!id || isTerminalStage(id) || seen.has(id)) continue;
    const label = (typeof s.label === 'string' && s.label.trim()) || id;
    // Only a number, or a string that spells one, counts - Number() takes
    // null, '', and true for 0 or 1, so a hand-edited export carrying
    // "probability": null would silently zero the stage out of every
    // weighted forecast instead of getting the midpoint fallback.
    const p = typeof s.probability === 'number' ? s.probability
      : (typeof s.probability === 'string' && s.probability.trim() ? Number(s.probability) : NaN);
    seen.add(id);
    out.push({ id, label, probability: Number.isFinite(p) ? clamp01(p) : 0.5 });
    if (out.length >= MAX_OPEN_STAGES) break;
  }
  return out;
}

/**
 * The stage list a given settings object describes: the user's open stages
 * when they have configured any, else the defaults - with Won and Lost
 * pinned on the end either way.
 */
export function resolveStages(settings = {}) {
  const custom = sanitizeOpenStages(settings?.stages);
  const open = custom.length ? custom : DEFAULT_OPEN_STAGES.map((s) => ({ ...s }));
  return [...open, ...TERMINAL_STAGES.map((s) => ({ ...s }))];
}

export function stageInfo(stageId, stages = STAGES) {
  return stages.find((s) => s.id === stageId) || stages[0];
}

export function isOpen(deal) {
  return !isTerminalStage(deal.stage);
}

/* ---------- per-deal confidence ----------
   A founder knows more about a specific deal than any stage average: a
   verbal "send the contract" in Proposal is not the cold maybe next to
   it. `deal.confidence` (0..1, or null for "use the stage weight") is
   that judgment, set on the deal itself. */

/** The categories the deal form offers, mapped to probabilities. */
export const CONFIDENCE_LEVELS = [
  { value: 0.9, label: 'Commit' },
  { value: 0.7, label: 'Likely' },
  { value: 0.25, label: 'Best case' },
  { value: 0, label: 'Omit' },
];

/** A well-formed confidence (clamped 0..1) or null - never NaN. */
export function normalizeConfidence(v) {
  const n = typeof v === 'number' ? v
    : (typeof v === 'string' && v.trim() ? Number(v) : NaN);
  return Number.isFinite(n) ? clamp01(n) : null;
}

/** "Commit · 90%" for a category value, "45%" for a custom one, null unset. */
export function confidenceLabel(confidence) {
  const c = normalizeConfidence(confidence);
  if (c === null) return null;
  const level = CONFIDENCE_LEVELS.find((l) => l.value === c);
  const pct = `${Math.round(c * 100)}%`;
  return level ? `${level.label} · ${pct}` : pct;
}

/**
 * Effective win probability of a deal: the deal's own confidence override
 * when set, else the settings override for its stage, else the stage's
 * own probability. Won/lost are pinned to 1/0 - no override may unsettle
 * a closed deal.
 */
export function probabilityOf(deal, overrides = {}, stages = STAGES) {
  if (deal.stage === 'won') return 1;
  if (deal.stage === 'lost') return 0;
  const own = normalizeConfidence(deal.confidence);
  if (own !== null) return own;
  // Same strict reading as the per-deal override: a hand-edited export
  // with "proposal": null must fall through to the stage default, not
  // coerce to 0 and quietly zero the stage out of the forecast.
  const o = normalizeConfidence(overrides?.[deal.stage]);
  if (o !== null) return o;
  return stageInfo(deal.stage, stages).probability;
}

export function weightedValue(deal, overrides = {}, stages = STAGES) {
  return round2(contractValue(deal) * probabilityOf(deal, overrides, stages));
}

/** Sum of open deal values (the unweighted "best case" pipeline). */
export function pipelineValue(deals) {
  return round2(deals.filter(isOpen).reduce((sum, d) => sum + contractValue(d), 0));
}

/** Probability-weighted sum of open deals. */
export function weightedPipeline(deals, overrides = {}, stages = STAGES) {
  return round2(deals.filter(isOpen).reduce((sum, d) => sum + weightedValue(d, overrides, stages), 0));
}

/** Per-stage totals in configured order, for the board header and funnel. */
export function stageSummary(deals, overrides = {}, stages = STAGES) {
  return stages.map((s) => {
    const inStage = deals.filter((d) => d.stage === s.id);
    return {
      stage: s.id,
      label: s.label,
      count: inStage.length,
      value: round2(inStage.reduce((sum, d) => sum + contractValue(d), 0)),
      weighted: round2(inStage.reduce((sum, d) => sum + weightedValue(d, overrides, stages), 0)),
    };
  });
}

/**
 * Monthly forecast for the next `months` months starting at `from`
 * (a YYYY-MM key, defaulting to the current month).
 *
 * Open deals bucket by expected close month; a stale expected close in the
 * past rolls into the first month - it still needs closing, and dropping it
 * would silently understate the pipeline. Won deals count into the month
 * they closed (this month when the record carries no close date, matching
 * wonInMonth) so the chart shows closed revenue alongside what is still in
 * play; one won before the horizon is simply history and drops out.
 *
 * A recurring deal spreads across the months it actually bills instead of
 * spiking its close month - which is the whole point of billing: a
 * $2k/mo deal signed in June is $2k in June, not $24k. That also means a
 * recurring deal won *before* the horizon can still bill inside it, so
 * won revenue is spread from the close month rather than looked up in it.
 * Each deal is counted once, in the first month of its own that the
 * horizon shows.
 */
export function forecastByMonth(deals, { months = 6, from = monthKey(), overrides = {}, stages = STAGES } = {}) {
  const keys = Array.from({ length: months }, (_, i) => shiftMonthKey(from, i));
  const rows = keys.map((key) => ({ key, best: 0, weighted: 0, won: 0, count: 0 }));
  const index = new Map(rows.map((r) => [r.key, r]));

  for (const deal of deals) {
    if (deal.stage === 'lost') continue;
    if (deal.stage === 'won') {
      // Won revenue belongs to the month it landed in. Falling back to the
      // expected close would book a deal won last winter against whatever
      // future month its stale close date happens to name.
      const start = monthKey(deal.closedAt ? new Date(deal.closedAt) : new Date());
      let counted = false;
      for (const { key, amount } of billingSpread(deal, start)) {
        const row = index.get(key);
        if (!row) continue;
        row.won = round2(row.won + amount);
        if (!counted) { row.count++; counted = true; }
      }
      continue;
    }
    let start = deal.expectedClose ? monthKey(deal.expectedClose) : from;
    if (start < from) start = from;        // overdue close date → still open now
    const probability = probabilityOf(deal, overrides, stages);
    let counted = false;
    for (const { key, amount } of billingSpread(deal, start)) {
      const row = index.get(key);
      if (!row) continue;                  // beyond the horizon - table only
      row.best = round2(row.best + amount);
      row.weighted = round2(row.weighted + round2(amount * probability));
      if (!counted) { row.count++; counted = true; }
    }
  }
  return rows;
}

/**
 * Win rate over closed deals: won / (won + lost), by count. Returns rate
 * as null when nothing has closed yet - 0% would read as "losing".
 */
export function winRate(deals) {
  const won = deals.filter((d) => d.stage === 'won').length;
  const lost = deals.filter((d) => d.stage === 'lost').length;
  const closed = won + lost;
  return { won, lost, rate: closed ? won / closed : null };
}

/**
 * Revenue won in a given YYYY-MM month: what actually billed in it.
 *
 * A one-time deal bills in the month it closed, exactly as before. A
 * recurring deal bills its own amount in each month of its term, so a
 * $2k/mo contract signed in June counts $2k against June's goal and $2k
 * against July's - not $24k once and nothing after.
 */
export function wonInMonth(deals, key = monthKey()) {
  let total = 0;
  for (const deal of deals) {
    if (deal.stage !== 'won') continue;
    const start = monthKey(deal.closedAt ? new Date(deal.closedAt) : new Date());
    if (!isRecurring(deal)) {
      if (start === key) total += contractValue(deal);
      continue;
    }
    for (const entry of billingSpread(deal, start)) {
      if (entry.key === key) total += entry.amount;
    }
  }
  return round2(total);
}

/* ---------- close-date windows (deal filters) ---------- */

/** The windows the pipeline filter offers, in display order. */
export const CLOSE_WINDOWS = [
  { value: 'any', label: 'Any close date' },
  { value: 'month', label: 'Closing this month' },
  { value: 'quarter', label: 'Closing this quarter' },
  { value: 'overdue', label: 'Past its close date' },
];

/**
 * Does a deal fall inside a close-date window? Deals with no expected
 * close never match a dated window - "closing this month" has to mean the
 * user said so, not that we guessed.
 */
export function matchesCloseWindow(deal, window, today = new Date()) {
  if (!window || window === 'any') return true;
  if (!deal.expectedClose) return false;
  const todayKey = typeof today === 'string' ? today : todayISO(today);
  if (window === 'overdue') return isOpen(deal) && deal.expectedClose < todayKey;
  const key = monthKey(deal.expectedClose);
  const nowKey = monthKey(todayKey);
  if (window === 'month') return key === nowKey;
  if (window === 'quarter') {
    const [y, m] = nowKey.split('-').map(Number);
    const first = Math.floor((m - 1) / 3) * 3 + 1;
    return key >= `${y}-${String(first).padStart(2, '0')}`
      && key <= `${y}-${String(first + 2).padStart(2, '0')}`;
  }
  return true;
}

/* ---------- why deals closed ---------- */

/** Starter reasons. Free text lives in the note beside them. */
export const WON_REASONS = [
  'Referral strength', 'Product fit', 'Price', 'Relationship', 'Timing', 'Other',
];
export const LOST_REASONS = [
  'Price', 'Competitor', 'Timing', 'No budget', 'Went silent', 'No fit', 'Other',
];

export function reasonsForStage(stage) {
  return stage === 'won' ? WON_REASONS : LOST_REASONS;
}

/**
 * Closed deals of one stage grouped by recorded reason, biggest group
 * first, plus how many closed without one (so the report can be honest
 * about its own coverage).
 */
export function closeReasonBreakdown(deals, stage) {
  const rows = new Map();
  let unrecorded = 0;
  for (const d of deals) {
    if (d.stage !== stage) continue;
    const reason = String(d.closeReason || '').trim();
    if (!reason) { unrecorded++; continue; }
    const row = rows.get(reason) || { reason, count: 0, value: 0 };
    row.count++;
    row.value = round2(row.value + contractValue(d));
    rows.set(reason, row);
  }
  return {
    rows: [...rows.values()].sort((a, b) => b.count - a.count || b.value - a.value),
    unrecorded,
    total: [...rows.values()].reduce((n, r) => n + r.count, 0) + unrecorded,
  };
}

/**
 * Win rate grouped by whatever `labelOf` returns for a deal (lead source,
 * industry, company size…). Deals with no label are skipped rather than
 * lumped into a fake "unknown" cohort.
 */
export function winRateBy(deals, labelOf) {
  const groups = new Map();
  for (const d of deals) {
    if (d.stage !== 'won' && d.stage !== 'lost') continue;
    const key = String(labelOf(d) || '').trim();
    if (!key) continue;
    const g = groups.get(key) || { key, won: 0, lost: 0, wonValue: 0 };
    if (d.stage === 'won') {
      g.won++;
      g.wonValue = round2(g.wonValue + contractValue(d));
    } else {
      g.lost++;
    }
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, total: g.won + g.lost, rate: g.won / (g.won + g.lost) }))
    .sort((a, b) => b.total - a.total || b.won - a.won || a.key.localeCompare(b.key));
}

/** Average deal size of what closed, won vs lost. Null with none of a kind. */
export function avgClosedValue(deals) {
  const avg = (list) => (list.length
    ? round2(list.reduce((sum, d) => sum + contractValue(d), 0) / list.length)
    : null);
  return {
    won: avg(deals.filter((d) => d.stage === 'won')),
    lost: avg(deals.filter((d) => d.stage === 'lost')),
  };
}

/* ---------- stage history ---------- */

const DAY = 86400000;

/** How long a deal may sit in one stage before the board flags it. */
export const DEFAULT_STALE_DAYS = 14;

/** When the deal entered its current stage (falls back to its own clock). */
export function stageEnteredAt(deal) {
  const hist = Array.isArray(deal.stageHistory) ? deal.stageHistory : [];
  const last = hist[hist.length - 1];
  if (last && Number.isFinite(last.at)) return last.at;
  return Number(deal.updatedAt) || Number(deal.createdAt) || 0;
}

/** Whole days the deal has spent in its current stage. */
export function daysInStage(deal, now = Date.now()) {
  return Math.max(0, Math.floor((now - stageEnteredAt(deal)) / DAY));
}

/** An open deal that hasn't moved in `staleDays` days. 0 turns the flag off. */
export function isStalled(deal, staleDays = DEFAULT_STALE_DAYS, now = Date.now()) {
  return isOpen(deal) && staleDays > 0 && daysInStage(deal, now) >= staleDays;
}

/** Stalled deals, longest-stuck first. */
export function stalledDeals(deals, staleDays = DEFAULT_STALE_DAYS, now = Date.now()) {
  return deals
    .filter((d) => isStalled(d, staleDays, now))
    .sort((a, b) => stageEnteredAt(a) - stageEnteredAt(b));
}

/**
 * Average days spent in each stage, over transitions that actually
 * completed - a deal still sitting in Proposal says nothing yet about how
 * long Proposal takes. `days` is null for stages nothing has left.
 */
export function stageVelocity(deals, stages = STAGES) {
  const totals = new Map();
  for (const deal of deals) {
    const hist = Array.isArray(deal.stageHistory) ? deal.stageHistory : [];
    for (let i = 0; i < hist.length - 1; i++) {
      const days = Math.max(0, (hist[i + 1].at - hist[i].at) / DAY);
      const t = totals.get(hist[i].stage) || { days: 0, count: 0 };
      t.days += days;
      t.count++;
      totals.set(hist[i].stage, t);
    }
  }
  return openStages(stages).map((s) => {
    const t = totals.get(s.id);
    return {
      stage: s.id,
      label: s.label,
      days: t ? Math.round(t.days / t.count) : null,
      count: t?.count || 0,
    };
  });
}

/* ---------- revenue goal ---------- */

/**
 * Progress against a monthly revenue goal, with pace: a founder on day 3
 * at 10% is fine, on day 27 at 10% is not. `pace` is null when no goal is
 * set, so callers can fall back to the plain won figure.
 *
 *   { goal, won, remaining, pct, expected, elapsed, gap, pace }
 *   pace: 'met' | 'on-track' | 'behind'
 */
export function goalProgress(deals, goal, key = monthKey(), today = new Date()) {
  const g = Math.max(0, Number(goal) || 0);
  const won = wonInMonth(deals, key);
  if (!g) return { goal: 0, won, remaining: 0, pct: null, expected: 0, elapsed: 0, gap: 0, pace: null };

  const nowKey = monthKey(today);
  const [y, m] = key.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  // Elapsed share of the month: a past month is spent, a future one hasn't
  // started, and today counts as a whole day of selling.
  const elapsed = key < nowKey ? 1
    : key > nowKey ? 0
    : Math.min(1, (typeof today === 'string' ? Number(today.slice(8, 10)) : today.getDate()) / daysInMonth);
  const expected = round2(g * elapsed);

  return {
    goal: g,
    won,
    remaining: round2(Math.max(0, g - won)),
    pct: won / g,
    expected,
    elapsed,
    gap: round2(Math.max(0, expected - won)),
    pace: won >= g ? 'met' : won >= expected ? 'on-track' : 'behind',
  };
}

/**
 * Pipeline coverage: weighted open pipeline over what is left of the goal.
 * The standard "do I need more leads at the top?" ratio. Null when there
 * is no goal, or none of it left to cover.
 */
export function pipelineCoverage(weighted, remainingGoal) {
  const r = Number(remainingGoal) || 0;
  if (r <= 0) return null;
  return round2((Number(weighted) || 0) / r);
}

/**
 * Average days from creation to close over won deals - the sales-cycle
 * length founders quote. Null until at least one deal has closed.
 */
export function avgSalesCycle(deals) {
  const won = deals.filter((d) => d.stage === 'won' && d.closedAt && d.createdAt);
  if (!won.length) return null;
  const days = won.reduce((sum, d) => sum + Math.max(0, (d.closedAt - d.createdAt) / 86400000), 0);
  return Math.round(days / won.length);
}
