/**
 * Follow-up recurrence rules. Repeat-on-completion, not calendar RRULEs:
 * the next occurrence exists only once the current one is checked off,
 * due = completion day plus the interval. That matches keep-in-touch
 * cadences ("every 30 days" means 30 days of quiet, not the 30th of the
 * month) and keeps the model one field.
 *
 * Kept apart from the store - like statuses.js - so the CSV layer can
 * label a rule without importing the data layer it feeds.
 */

import { addDays, addMonthsClamped } from './util.js';

export const REPEAT_UNITS = ['day', 'week', 'month'];

const toCount = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  if (typeof v !== 'string' || !v.trim()) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** A well-formed repeat rule or null - never a half-shaped object. */
export function normalizeRepeat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!REPEAT_UNITS.includes(raw.unit)) return null;
  const every = toCount(raw.every);
  if (every < 1 || every > 365) return null;
  return { every, unit: raw.unit };
}

/** Next due date for a repeat rule, counted from `fromISO` (completion day). */
export function nextRepeatDue(fromISO, repeat) {
  const rule = normalizeRepeat(repeat);
  if (!rule) return fromISO;
  if (rule.unit === 'day') return addDays(fromISO, rule.every);
  if (rule.unit === 'week') return addDays(fromISO, rule.every * 7);
  return addMonthsClamped(fromISO, rule.every);
}

/** "Every day" / "Every 2 weeks" / "Every 3 months", or '' for no rule. */
export function repeatLabel(repeat) {
  const rule = normalizeRepeat(repeat);
  if (!rule) return '';
  return rule.every === 1 ? `Every ${rule.unit}` : `Every ${rule.every} ${rule.unit}s`;
}
