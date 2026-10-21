/**
 * Recurrence engine.
 *
 * A repeat rule is:
 *   { freq: 'daily' | 'weekly' | 'monthly' | 'yearly',
 *     interval: 1..,             // every N days/weeks/months/years
 *     weekdays?: [0..6],         // weekly only; 0 = Sunday
 *     day?: 1..31,               // monthly/yearly: the intended day-of-month,
 *                                // so one clamped roll (Jan 31 → Feb 28)
 *                                // doesn't re-anchor every later occurrence
 *     mode: 'due' | 'done' }     // roll from the due date, or from completion
 *
 * Completing a recurring task never edits history: the finished occurrence
 * is logged separately and the task itself rolls forward to nextDue().
 */

import { addDays, addMonths, addYears, weekdayOf, parseISO, toISO, todayISO, diffDays, daysInMonth, pad2 } from './dates.js';

export const FREQS = [
  { value: 'daily', label: 'day' },
  { value: 'weekly', label: 'week' },
  { value: 'monthly', label: 'month' },
  { value: 'yearly', label: 'year' },
];

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function normalizeRule(rule) {
  if (!rule || !rule.freq) return null;
  const freq = FREQS.some((f) => f.value === rule.freq) ? rule.freq : 'daily';
  const interval = Math.max(1, Math.floor(Number(rule.interval) || 1));
  const out = { freq, interval, mode: rule.mode === 'done' ? 'done' : 'due' };
  if (freq === 'weekly' && Array.isArray(rule.weekdays) && rule.weekdays.length) {
    // Integers only: a fractional weekday (imported data) matches no real
    // day and would render as an empty BYDAY entry in the calendar export.
    out.weekdays = [...new Set(rule.weekdays.map(Number))]
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (!out.weekdays.length) delete out.weekdays;
  }
  if (freq === 'monthly' || freq === 'yearly') {
    const day = Math.floor(Number(rule.day));
    if (Number.isInteger(day) && day >= 1 && day <= 31) out.day = day;
  }
  return out;
}

/** Clamp the rule's intended day-of-month into iso's month. */
function withAnchorDay(iso, day) {
  if (!day) return iso;
  const [y, m] = iso.split('-').map(Number);
  return `${iso.slice(0, 7)}-${pad2(Math.min(day, daysInMonth(y, m)))}`;
}

/**
 * Point a monthly/yearly rule's anchor at a new due date. Creation and
 * deliberate reschedules pass through here; completion rolls do not, so a
 * clamped occurrence never erases the day the rule means.
 */
export function reanchorRule(rule, dueISO) {
  if (!rule || !dueISO) return rule;
  if (rule.freq !== 'monthly' && rule.freq !== 'yearly') return rule;
  const day = Number(dueISO.slice(8, 10));
  if (!day || rule.day === day) return rule;
  return { ...rule, day };
}

/** Monday-based start of the week containing iso, for interval alignment. */
function weekStart(iso) {
  const shift = (weekdayOf(iso) + 6) % 7;
  return addDays(iso, -shift);
}

function wholeWeeksBetween(aIso, bIso) {
  return Math.round((parseISO(bIso) - parseISO(aIso)) / (7 * 86400000));
}

/**
 * The single next occurrence strictly after `base`.
 * Weekly rules with weekdays honor the interval by counting weeks from the
 * base date's week: only weeks a multiple of `interval` away are eligible.
 */
function nextAfter(rule, base) {
  const { freq, interval } = rule;
  if (freq === 'daily') return addDays(base, interval);
  if (freq === 'monthly') return withAnchorDay(addMonths(base, interval), rule.day);
  if (freq === 'yearly') return withAnchorDay(addYears(base, interval), rule.day);
  // weekly
  if (!rule.weekdays?.length) return addDays(base, 7 * interval);
  const anchor = weekStart(base);
  for (let i = 1; i <= 7 * (interval + 1); i++) {
    const day = addDays(base, i);
    if (!rule.weekdays.includes(weekdayOf(day))) continue;
    if (wholeWeeksBetween(anchor, weekStart(day)) % interval === 0) return day;
  }
  return addDays(base, 7 * interval); // unreachable, defensive
}

/**
 * Where the task lands after completing the current occurrence.
 * mode 'done' rolls from today; mode 'due' rolls from the old due date but
 * never lands in the past (an overdue "every Monday" skips missed weeks).
 */
export function nextDue(rule, dueISO, today = todayISO()) {
  const norm = normalizeRule(rule);
  if (!norm) return null;
  const base = norm.mode === 'done' ? today : (dueISO || today);
  let next = nextAfter(norm, base);
  if (next < today) {
    // Catch up on a long backlog in one jump where the step is a fixed
    // number of days — a years-overdue daily task would otherwise need
    // thousands of single steps (and a step cap quietly returned a date
    // still in the past). Multiples of the block keep the weekday and
    // the interval's week-phase, so the jump stays on the rule's grid.
    const block = norm.freq === 'daily' ? norm.interval
      : norm.freq === 'weekly' ? 7 * norm.interval : 0;
    if (block) {
      const behind = Math.floor(diffDays(next, today) / block);
      if (behind > 0) next = addDays(next, behind * block);
    }
    // Monthly/yearly backlogs are at most a few steps per elapsed month
    // or year; nextAfter always advances, so this terminates.
    while (next < today) next = nextAfter(norm, next);
  }
  return next;
}

/** Human description: 'Every day', 'Every 2 weeks on Mon, Wed', ... */
export function describeRule(rule) {
  const norm = normalizeRule(rule);
  if (!norm) return '';
  const unit = FREQS.find((f) => f.value === norm.freq).label;
  let text = norm.interval === 1 ? `Every ${unit}` : `Every ${norm.interval} ${unit}s`;
  if (norm.freq === 'weekly' && norm.weekdays?.length) {
    text += ` on ${norm.weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ')}`;
  }
  if (norm.mode === 'done') text += ' after completion';
  return text;
}
