/**
 * The grid behind the follow-up calendar.
 *
 * Follow-ups group into overdue, today, and upcoming, which answers "what
 * now" and hides "what does my week look like". A list can't show that
 * Thursday holds nine calls and Friday holds none.
 *
 * Pure date arithmetic over ISO days, so the shape of a month is testable
 * without a DOM: no Date objects escape, and every week starts on Monday
 * the way the activity week does.
 */

import { todayISO, addDays, daysInMonth, monthKey, shiftMonthKey } from './util.js';

/** Monday first: a sales week starts on the day people answer the phone. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday-based weekday index of an ISO day: 0 = Monday, 6 = Sunday. */
export function weekdayIndex(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** The Monday of the week an ISO day falls in. */
export function weekStart(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

const cell = (iso, { today, monthOf = null }) => ({
  iso,
  day: Number(iso.slice(8, 10)),
  weekday: weekdayIndex(iso),
  today: iso === today,
  past: iso < today,
  weekend: weekdayIndex(iso) >= 5,
  inMonth: monthOf === null ? true : iso.slice(0, 7) === monthOf,
});

/**
 * A month as whole weeks: the days of `key` plus the neighbouring days that
 * share their first and last weeks, so the grid is always rectangular.
 */
export function monthCells(key = monthKey(), today = todayISO()) {
  const [y, m] = key.split('-').map(Number);
  const first = `${key}-01`;
  const start = weekStart(first);
  const last = `${key}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
  const end = addDays(weekStart(last), 6);
  const out = [];
  for (let iso = start; iso <= end; iso = addDays(iso, 1)) {
    out.push(cell(iso, { today, monthOf: key }));
  }
  return out;
}

/** One week, Monday to Sunday, containing `iso`. */
export function weekCells(iso = todayISO(), today = todayISO()) {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => cell(addDays(start, i), { today }));
}

/** Move a month key or a week's anchor day by `n` periods. */
export function shiftPeriod(mode, anchor, n) {
  return mode === 'month' ? shiftMonthKey(anchor, n) : addDays(anchor, n * 7);
}

/** The anchor a period starts from, for "today" - a key or a day. */
export function periodAnchor(mode, today = todayISO()) {
  return mode === 'month' ? monthKey(today) : weekStart(today);
}

/**
 * Entries by day: `{ [iso]: [entry] }`, each day's entries in the order
 * given. `dateOf` reads an entry's day, so tasks and deal close dates can
 * be mixed without either knowing about the other.
 */
export function byDay(entries, dateOf = (e) => e.date) {
  const out = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const iso = dateOf(entry);
    if (!iso) continue;
    (out[iso] ||= []).push(entry);
  }
  return out;
}

/** The days a grid covers, for a heading and for "is it in range". */
export function cellRange(cells) {
  if (!cells.length) return { from: null, to: null };
  return { from: cells[0].iso, to: cells[cells.length - 1].iso };
}

/** Entries whose day is inside a range - what the grid actually has to draw. */
export function inRange(entries, { from, to }, dateOf = (e) => e.date) {
  if (!from || !to) return [];
  return entries.filter((entry) => {
    const iso = dateOf(entry);
    return iso && iso >= from && iso <= to;
  });
}
