/**
 * All task dates are local-calendar ISO strings ('YYYY-MM-DD'); times are
 * 'HH:MM'. Strings compare correctly with < and >, and stay timezone-safe
 * because nothing round-trips through UTC.
 */

export const pad2 = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

/** ISO date string → Date at local midnight. */
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * True when iso is a real local-calendar date: '2026-02-30' rolls over,
 * '2026-13-01' has no month, and '0099-01-01' would hit the Date
 * constructor's two-digit-year remapping — all fail the round-trip.
 */
export function isValidISODate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && toISO(parseISO(iso)) === iso;
}

/** True for a real 24h wall-clock time: '25:00' and '09:99' are not. */
export function isValidTime(hhmm) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm || '');
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(iso, n) {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // Clamp to the target month's length (Jan 31 + 1 month → Feb 28/29).
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
  return toISO(d);
}

export function addYears(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dim = daysInMonth(y + n, m);
  return `${y + n}-${pad2(m)}-${pad2(Math.min(d, dim))}`;
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso) {
  return parseISO(iso).getDay();
}

export function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

export function monthKeyOf(iso) {
  return iso.slice(0, 7);
}

/**
 * 6x7 grid of ISO dates covering the month, starting on Monday or Sunday.
 * month1 is 1-based.
 */
export function monthGrid(year, month1, startMonday = true) {
  const first = new Date(year, month1 - 1, 1);
  const firstDow = first.getDay(); // 0=Sun
  const lead = startMonday ? (firstDow + 6) % 7 : firstDow;
  const start = new Date(year, month1 - 1, 1 - lead);
  const out = [];
  for (let i = 0; i < 42; i++) {
    out.push(toISO(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  }
  return out;
}

const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const DAY_YEAR_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

export function fmtDay(iso, { today = todayISO() } = {}) {
  const d = parseISO(iso);
  return iso.slice(0, 4) === today.slice(0, 4) ? DAY_FMT.format(d) : DAY_YEAR_FMT.format(d);
}

export function fmtMonth(year, month1) {
  return MONTH_FMT.format(new Date(year, month1 - 1, 1));
}

export function fmtWeekday(iso) {
  return WEEKDAY_FMT.format(parseISO(iso));
}

/** 'HH:MM' → locale time like '2:30 PM'. */
export function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2000, 0, 1, h, m));
}

/**
 * Human phrase for a due date, relative to today:
 * 'Today', 'Tomorrow', 'Yesterday', weekday inside a week, date beyond.
 */
export function relativeDue(iso, today = todayISO()) {
  const diff = diffDays(today, iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return fmtWeekday(iso);
  if (diff < -1 && diff > -7) return `${WEEKDAY_FMT.format(parseISO(iso))}, ${-diff} days ago`;
  return fmtDay(iso, { today });
}

/** The first `weekday` (0 = Sunday) strictly after `iso`. */
export function nextWeekday(iso, weekday) {
  let d = addDays(iso, 1);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}

export function isOverdue(task, today = todayISO()) {
  return !task.done && !!task.due && task.due < today;
}

export function isDueToday(task, today = todayISO()) {
  return !!task.due && task.due === today;
}
