/**
 * Activity as a number you can steer by.
 *
 * Revenue is a lagging indicator: by the time a month's won figure is
 * wrong, the calls that would have fixed it were due three weeks ago. The
 * number a founder can actually control today is touches made this week -
 * and nothing in the app counted them. The monthly revenue goal gave the
 * lagging number a target; this gives the leading one one.
 *
 * Pure functions over plain activity records, so the week maths and the
 * pace maths test without Puter or a DOM.
 */

import { todayISO, addDays, monthKey, round2 } from './util.js';
import { ACTIVITY_TYPES } from './statuses.js';

/** Windows the activity log offers, in display order. */
export const ACTIVITY_WINDOWS = [
  { value: 'week', label: 'This week' },
  { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
];

/**
 * Monday of the week a date falls in, as an ISO day.
 *
 * Monday because a sales week is Monday to Sunday - a Sunday-start week
 * puts the day nobody sells on at the front and makes every Monday look
 * like a fifth of the way in.
 */
export function weekStartISO(today = todayISO()) {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // getDay(): 0 = Sunday. Monday-based offset, so Sunday closes the week.
  const offset = (date.getDay() + 6) % 7;
  return addDays(today, -offset);
}

/** The Monday-to-Sunday week a date falls in, as ISO days. */
export function weekRange(today = todayISO()) {
  const from = weekStartISO(today);
  return { from, to: addDays(from, 6) };
}

/** How far through the week today is, as a share - today counts whole. */
export function weekElapsed(today = todayISO()) {
  const [y, m, d] = today.split('-').map(Number);
  return (((new Date(y, m - 1, d).getDay() + 6) % 7) + 1) / 7;
}

/** Does this activity fall inside a window? */
export function matchesActivityWindow(activity, window, today = todayISO()) {
  const date = activity?.date;
  if (!date) return false;
  if (!window || window === 'all') return true;
  if (window === 'week') {
    const { from, to } = weekRange(today);
    return date >= from && date <= to;
  }
  if (window === '30') return date >= addDays(today, -29) && date <= today;
  if (window === 'month') return monthKey(date) === monthKey(today);
  return true;
}

/* ---------- weekly touch target ---------- */

const TYPE_IDS = ACTIVITY_TYPES.map((t) => t.value);

const count = (v) => {
  const n = typeof v === 'number' ? v
    : (typeof v === 'string' && v.trim() ? Number(v) : NaN);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(999, Math.round(n));
};

/**
 * The target, shaped: `{ all, meeting, call, email, note }`, every entry a
 * whole non-negative count. 0 means "no target for this", which is how the
 * whole feature stays opt-in.
 */
export function normalizeTouchTargets(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { all: count(source.all) };
  for (const type of TYPE_IDS) out[type] = count(source[type]);
  return out;
}

/** Per-type targets that are actually set, in the app's own type order. */
export function typeTargets(targets) {
  const t = normalizeTouchTargets(targets);
  return ACTIVITY_TYPES
    .filter((type) => t[type.value] > 0)
    .map((type) => ({ type: type.value, label: type.label, target: t[type.value] }));
}

/**
 * The number of touches a week the founder is aiming at: the overall
 * target when one is set, else the per-type ones added up. Setting "8
 * calls, 3 meetings" and nothing else means a target of 11 - saying it
 * twice would only let the two disagree.
 */
export function touchTarget(targets) {
  const t = normalizeTouchTargets(targets);
  if (t.all) return t.all;
  return TYPE_IDS.reduce((sum, type) => sum + t[type], 0);
}

/** Is any target set at all? */
export function hasTouchTarget(targets) {
  return touchTarget(targets) > 0;
}

/**
 * This week's activity against the target, with pace - the same bargain
 * the monthly revenue goal strikes: 4 of 12 on Monday is fine, 4 of 12 on
 * Friday is not.
 *
 *   { target, logged, remaining, pct, expected, elapsed, gap, pace,
 *     byType: [{ type, label, target, logged, pct }], from, to }
 *
 * `pace` is null when no target is set, so callers can fall back to the
 * plain count.
 */
export function touchProgress(activities, targets, today = todayISO()) {
  const { from, to } = weekRange(today);
  const inWeek = (Array.isArray(activities) ? activities : [])
    .filter((a) => a?.date >= from && a?.date <= to);
  const logged = inWeek.length;
  const target = touchTarget(targets);
  const perType = typeTargets(targets).map((row) => {
    const done = inWeek.filter((a) => a.type === row.type).length;
    return { ...row, logged: done, pct: row.target ? done / row.target : null };
  });

  if (!target) {
    return {
      target: 0, logged, remaining: 0, pct: null, expected: 0,
      elapsed: weekElapsed(today), gap: 0, pace: null, byType: perType, from, to,
    };
  }
  const elapsed = weekElapsed(today);
  const expected = round2(target * elapsed);
  return {
    target,
    logged,
    remaining: Math.max(0, target - logged),
    pct: logged / target,
    expected,
    elapsed,
    gap: Math.max(0, Math.ceil(expected - logged)),
    pace: logged >= target ? 'met' : logged >= expected ? 'on-track' : 'behind',
    byType: perType,
    from,
    to,
  };
}
