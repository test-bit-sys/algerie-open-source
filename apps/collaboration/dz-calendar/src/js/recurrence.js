/**
 * Recurrence engine — pure, dependency-free (beyond date-utils) and heavily
 * unit-tested. Everything works in the browser's local time zone using the
 * DST-safe adders from date-utils, so a "7:30pm weekly" event stays at 7:30pm
 * local across daylight-saving transitions.
 *
 * A recurring event is a single stored "series master" carrying a `recurrence`
 * rule plus inline `exdates` (cancelled occurrences) and `overrides` (per-
 * occurrence edits). This module turns that master into individual occurrence
 * objects for a date range; the store and views treat each occurrence as its
 * own event while preserving the link back to the series.
 *
 *   rule = {
 *     freq: 'daily' | 'weekly' | 'monthly' | 'yearly',
 *     interval: >=1,                 // every N units
 *     byWeekday: number[] | null,    // weekly only, 0=Sun..6=Sat
 *     wkst: 0..6 | null,             // weekly only: week-start day (default 0,
 *                                    // Sunday). Only observable with
 *                                    // interval >= 2 and a multi-day byWeekday;
 *                                    // carried so imported WKST=MO rules keep
 *                                    // their true week parity.
 *     monthlyMode: 'date' | 'weekday' | null,
 *     monthlyNth: -1 | 1..5 | null,  // weekday mode only: which one (-1 = last);
 *                                    // null derives it from the start date
 *     count: number | null,          // ends after N occurrences
 *     until: number | null,          // ends on date (end-of-day ms, inclusive)
 *   }                                // never-ends => count == null && until == null
 *
 * `recurrenceId` = an occurrence's ORIGINAL scheduled start (epoch ms). It is
 * the stable per-occurrence key: an override may move an occurrence's time, but
 * its recurrenceId never changes.
 */
import {
  addDays,
  daysInMonth,
  startOfDay,
  endOfDay,
  MS_PER_DAY,
  diffCalendarDays,
  WEEKDAYS_SHORT,
  WEEKDAYS_LONG,
  MONTHS_SHORT,
  MONTHS_LONG,
} from './date-utils.js';

export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
export const WEEKDAY_PRESET = [1, 2, 3, 4, 5];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

// Backstops against a logic bug producing an unbounded loop. Jump-ahead keeps
// real per-query work tiny (occurrences in the window), so these are never hit
// in practice; they only guarantee the loops terminate.
const EXPAND_CAP = 10_000;
const COUNT_CAP = 500_000;
// The furthest instant a Date can hold, either way (ECMA-262). Beyond it every
// Date is Invalid and every getTime() is NaN.
const MAX_TIME_MS = 8.64e15;

/* ---- Validation ------------------------------------------------------- */

/**
 * Validate + fill defaults for a rule, given the series start (for byWeekday /
 * monthlyMode defaults). Returns a well-formed rule, or `null` for "no repeat".
 */
export function normalizeRecurrence(input, startMs) {
  if (!input || typeof input !== 'object') return null;
  if (!FREQS.includes(input.freq)) return null;
  const start = new Date(startMs);
  const freq = input.freq;

  let interval = Math.round(Number(input.interval));
  if (!Number.isFinite(interval) || interval < 1) interval = 1;
  interval = Math.min(interval, 999);

  let byWeekday = null;
  let wkst = null;
  if (freq === 'weekly') {
    const src = Array.isArray(input.byWeekday) ? input.byWeekday : [];
    const set = new Set(
      src
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    );
    if (set.size === 0) set.add(start.getDay());
    byWeekday = [...set].sort((a, b) => a - b);
    const w = Math.trunc(Number(input.wkst));
    wkst = Number.isInteger(w) && w >= 0 && w <= 6 ? w : 0;
  }

  let monthlyMode = null;
  let monthlyNth = null;
  if (freq === 'monthly') {
    monthlyMode = input.monthlyMode === 'weekday' ? 'weekday' : 'date';
    // An explicit "which weekday of the month" (-1 = last). Without it the nth
    // is derived from the start date — which cannot express "last" at all, and
    // reads a 4th-and-last Friday as "4th" (wrong in five-Friday months).
    if (monthlyMode === 'weekday' && input.monthlyNth != null) {
      const n = Math.trunc(Number(input.monthlyNth));
      if (n === -1 || (n >= 1 && n <= 5)) monthlyNth = n;
    }
  }

  let count = null;
  if (input.count != null) {
    count = Math.round(Number(input.count));
    if (!Number.isFinite(count) || count < 1) count = 1;
    count = Math.min(count, 999);
  }

  let until = null;
  if (input.until != null) {
    const u = Math.round(Number(input.until));
    if (Number.isFinite(u)) until = u;
  }

  return { freq, interval, byWeekday, wkst, monthlyMode, monthlyNth, count, until };
}

/* ---- Weekday / month helpers ------------------------------------------ */

/** First day of the week containing `date` (per `wkst`, default Sunday),
 *  preserving the time of day. */
function weekAnchor(date, wkst = 0) {
  return addDays(date, -((date.getDay() - wkst + 7) % 7));
}

/** { nth: 1..5, weekday: 0..6, isLast } describing `date` within its month. */
export function nthWeekdayInfo(date) {
  const d = new Date(date);
  const dom = d.getDate();
  return {
    nth: Math.ceil(dom / 7),
    weekday: d.getDay(),
    isLast: dom + 7 > daysInMonth(d.getFullYear(), d.getMonth()),
  };
}

/** Day-of-month of the nth `weekday` in a month, or null if it doesn't exist. */
function nthWeekdayDate(year, month, weekday, nth) {
  const firstDow = new Date(year, month, 1).getDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return day <= daysInMonth(year, month) ? day : null;
}

/** Day-of-month of the LAST `weekday` in a month (always exists). */
function lastWeekdayDate(year, month, weekday) {
  const dim = daysInMonth(year, month);
  const lastDow = new Date(year, month, dim).getDay();
  return dim - ((lastDow - weekday + 7) % 7);
}

/**
 * The scheduled start Date(s) produced by period `p` (0-based) of the rule.
 * Weekly periods can yield several (one per selected weekday, ascending);
 * monthly/yearly periods yield one or, when the target day doesn't exist in
 * that month/year (e.g. the 31st, or Feb 29), none.
 */
function periodStarts(rule, startDate, p) {
  const h = startDate.getHours();
  const min = startDate.getMinutes();
  // Preserve the start's seconds/ms too: daily/weekly carry them for free via
  // addDays on the full start Date, but monthly/yearly build a fresh
  // Date below, so drop them here and a sub-minute start (only reachable via an
  // ICS import like DTSTART:T093045) would land at :00 — shifting every
  // occurrence's recurrenceId and breaking exdate/override matching and the
  // "current/next" pick in search. See store.js reproject / commit 5b997e9.
  const sec = startDate.getSeconds();
  const ms = startDate.getMilliseconds();

  if (rule.freq === 'daily') {
    return [addDays(startDate, p * rule.interval)];
  }

  if (rule.freq === 'weekly') {
    const wkst = rule.wkst || 0;
    // Every candidate is ONE calendar hop from the real start. Stepping back
    // to the week's anchor day first and forward from there — two hops — went
    // through a Date that may not exist: with the default Sunday anchor the
    // anchor IS the spring-forward day in the US, EU, Australia and Chile, so
    // a series started at 02:30 in that week resolved its anchor to 03:30 and
    // every later hop carried the wrong wall clock — each occurrence an hour
    // late for the life of the series, and no occurrence id equal to the
    // master's start (which then read a title-only edit as a time change and
    // cleared the exceptions). In zones that change at midnight the same
    // thing shifted all-day series to 01:00.
    const startOffset = (startDate.getDay() - wkst + 7) % 7;
    const floor = startOfDay(startDate).getTime();
    const out = [];
    // Emit in chronological order: byWeekday is sorted 0..6, but the week's
    // day order starts at wkst, so order by each day's offset from it.
    const days = [...rule.byWeekday].sort(
      (a, b) => ((a - wkst + 7) % 7) - ((b - wkst + 7) % 7),
    );
    for (const wd of days) {
      const cand = addDays(startDate, p * rule.interval * 7 + ((wd - wkst + 7) % 7) - startOffset);
      if (cand.getTime() >= floor) out.push(cand); // clip the partial first week
    }
    return out;
  }

  if (rule.freq === 'monthly') {
    const total = startDate.getMonth() + p * rule.interval;
    const year = startDate.getFullYear() + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    if (rule.monthlyMode === 'weekday') {
      const { nth, weekday } = nthWeekdayInfo(startDate);
      const n = rule.monthlyNth != null ? rule.monthlyNth : nth;
      const day =
        n === -1 ? lastWeekdayDate(year, month, weekday) : nthWeekdayDate(year, month, weekday, n);
      if (day == null) return [];
      const cand = new Date(year, month, day, h, min, sec, ms);
      // An explicit nth earlier in the anchor's own month ("first Friday" on a
      // series anchored on the last one) would put period 0 BEFORE the start —
      // an occurrence the event never had, and the one the series would then
      // count from. Clip it, as the weekly branch clips its partial first week.
      return cand.getTime() >= startOfDay(startDate).getTime() ? [cand] : [];
    }
    const day = startDate.getDate();
    return day > daysInMonth(year, month) ? [] : [new Date(year, month, day, h, min, sec, ms)];
  }

  // yearly
  const year = startDate.getFullYear() + p * rule.interval;
  const month = startDate.getMonth();
  const day = startDate.getDate();
  return day > daysInMonth(year, month) ? [] : [new Date(year, month, day, h, min, sec, ms)];
}

/** Approximate period index whose occurrences land near `targetMs` (for jump-ahead). */
function periodIndexFor(rule, startDate, targetMs) {
  const target = new Date(targetMs);
  let idx;
  if (rule.freq === 'daily') {
    idx = Math.floor(diffCalendarDays(startDate, target) / rule.interval);
  } else if (rule.freq === 'weekly') {
    idx = Math.floor(diffCalendarDays(weekAnchor(startDate, rule.wkst || 0), target) / 7 / rule.interval);
  } else if (rule.freq === 'monthly') {
    const months =
      (target.getFullYear() - startDate.getFullYear()) * 12 +
      (target.getMonth() - startDate.getMonth());
    idx = Math.floor(months / rule.interval);
  } else {
    idx = Math.floor((target.getFullYear() - startDate.getFullYear()) / rule.interval);
  }
  return Number.isFinite(idx) ? idx : 0;
}

/* ---- Generation ------------------------------------------------------- */

/**
 * Ascending scheduled starts (ms) with `lower <= start < to`, honoring count
 * and until. When a count is set we enumerate from the first occurrence (bounded
 * by count); otherwise we jump ahead to the window so an old "never ends" series
 * costs only the occurrences actually in view.
 */
function collectStarts(rule, startDate, lower, to) {
  const out = [];
  // A window no Date can hold has no occurrences — and must not be searched
  // for any. periodIndexFor reads an Invalid Date as period 0, and against a
  // `to` past the last representable instant the early exit below can never
  // fire (every getTime() is NaN), so a never-ending rule would walk its
  // whole EXPAND_CAP to return nothing. Reachable from outside: a range or an
  // occurrence id a caller made up.
  if (!(lower < to) || Math.abs(lower) > MAX_TIME_MS || Math.abs(to) > MAX_TIME_MS) return out;
  const untilMs = rule.until;

  if (rule.count != null) {
    let period = 0;
    let index = 0;
    let guard = 0;
    while (guard++ < EXPAND_CAP) {
      const starts = periodStarts(rule, startDate, period++);
      for (const d of starts) {
        if (index >= rule.count) return out;
        const ms = d.getTime();
        index++;
        if (untilMs != null && ms > untilMs) return out;
        if (ms >= lower && ms < to) out.push(ms);
      }
      if (starts.length && starts[0].getTime() >= to) return out;
    }
    return out;
  }

  let period = Math.max(0, periodIndexFor(rule, startDate, lower) - 2);
  let guard = 0;
  while (guard++ < EXPAND_CAP) {
    const starts = periodStarts(rule, startDate, period++);
    if (starts.length) {
      for (const d of starts) {
        const ms = d.getTime();
        if (untilMs != null && ms > untilMs) return out;
        if (ms >= lower && ms < to) out.push(ms);
      }
      if (starts[0].getTime() >= to) return out; // whole period past the window
    }
  }
  return out;
}

/** Number of scheduled occurrences strictly before `recurrenceId` (for splitting). */
export function countScheduledBefore(rule, startMs, recurrenceId) {
  const startDate = new Date(startMs);
  const untilMs = rule.until;
  let period = 0;
  let index = 0;
  let n = 0;
  let guard = 0;
  while (guard++ < COUNT_CAP) {
    const starts = periodStarts(rule, startDate, period++);
    for (const d of starts) {
      if (rule.count != null && index >= rule.count) return n;
      const ms = d.getTime();
      index++;
      if (untilMs != null && ms > untilMs) return n;
      if (ms < recurrenceId) n++;
      else return n;
    }
    if (starts.length && starts[0].getTime() >= recurrenceId) return n;
  }
  return n;
}

/**
 * The start (ms) of the n-th (1-based) scheduled occurrence of `recurrence`
 * anchored at `startMs`, ignoring any count of its own — or null when the rule
 * yields fewer (an `until` ends it first) or the enumeration cap is reached.
 * Lets an importer turn a COUNT the engine can't hold (> 999) into the UNTIL
 * it amounts to.
 */
export function nthScheduledStart(recurrence, startMs, n) {
  const rule = normalizeRecurrence({ ...recurrence, count: null }, startMs);
  if (!rule || !(n >= 1)) return null;
  const startDate = new Date(startMs);
  let period = 0;
  let index = 0;
  let guard = 0;
  while (guard++ < EXPAND_CAP) {
    for (const d of periodStarts(rule, startDate, period++)) {
      const ms = d.getTime();
      if (rule.until != null && ms > rule.until) return null;
      if (++index === n) return ms;
    }
  }
  return null;
}

/** The series' first scheduled start in ms — usually the anchor itself. It
 *  differs only when the anchor is off-pattern (a weekly rule whose byWeekday
 *  excludes the anchor's weekday clips it to the next selected day). Ignores
 *  exdates: a cancelled first occurrence still anchors the schedule. Returns
 *  `startMs` unchanged for a rule that yields no occurrence at all. */
export function firstScheduledStart(recurrence, startMs) {
  const rule = normalizeRecurrence(recurrence, startMs);
  if (!rule) return startMs;
  const startDate = new Date(startMs);
  let period = 0;
  let guard = 0;
  while (guard++ < COUNT_CAP) {
    for (const d of periodStarts(rule, startDate, period++)) {
      const ms = d.getTime();
      if (rule.until != null && ms > rule.until) return startMs;
      return ms;
    }
  }
  return startMs;
}

/* ---- Occurrence materialization --------------------------------------- */

function buildOccurrence(master, recurrenceId, override, dur) {
  const pick = (key) => (override && override[key] != null ? override[key] : master[key]);
  const allDay = Boolean(pick('allDay'));

  let start = recurrenceId;
  if (override && Number.isFinite(override.start)) start = override.start;

  let end;
  if (override && Number.isFinite(override.end)) {
    end = override.end;
  } else if (allDay) {
    // An all-day occurrence must span whole CALENDAR days. Deriving its end from
    // a fixed-ms `dur` drifts across a DST transition — on a 23h spring-forward
    // day `start + dur` lands ~59min into the next day, so the occurrence renders
    // on two days (and multi-day banners / ICS DTEND stretch a day too far).
    // Span the day COUNT instead (matches store.js reproject / ics.js import).
    const dayCount = Math.max(1, Math.round(dur / MS_PER_DAY));
    end = endOfDay(addDays(startOfDay(new Date(start)), dayCount - 1)).getTime();
  } else {
    end = start + dur;
  }
  // A corrupt/foreign override can carry end <= start; keep the master's
  // positive-duration guarantee so views never compute a negative height.
  if (end <= start) end = start + (dur > 0 ? dur : 1);
  return {
    id: `${master.id}::${recurrenceId}`,
    seriesId: master.id,
    recurrenceId,
    title: pick('title'),
    description: pick('description'),
    location: pick('location'),
    allDay: Boolean(pick('allDay')),
    color: pick('color'),
    reminders: Array.isArray(pick('reminders')) ? pick('reminders') : [],
    start,
    end,
    // RSVP state lives on the master (a reply covers the whole series);
    // occurrences carry it through for display. `declined` dims the series'
    // occurrences after an RSVP "No" (out-of-office declines skip recurring
    // events, so nothing else sets it on a master).
    organizer: master.organizer || null,
    guests: Array.isArray(master.guests) ? master.guests : [],
    // The meeting link lives on the master (one room serves the whole series);
    // occurrences carry it through for display, like RSVP state below.
    meeting: master.meeting || null,
    // A repeating out-of-office block: every occurrence marks you away, so it
    // renders as OOO and counts as busy exactly like a one-off block.
    ooo: Boolean(pick('ooo')),
    declined: Boolean(master.declined),
    createdAt: master.createdAt,
    updatedAt: master.updatedAt,
    isOccurrence: true,
    isException: Boolean(override),
  };
}

/** A single occurrence for `recurrenceId` (with any override applied), or null. */
export function materializeOccurrence(master, recurrenceId) {
  if (!master || !master.recurrence) return null;
  const rule = normalizeRecurrence(master.recurrence, master.start);
  if (!rule) return null;
  const dur = Math.max(0, master.end - master.start);
  const overrides = master.overrides || {};
  return buildOccurrence(master, Number(recurrenceId), overrides[recurrenceId], dur);
}

/**
 * The occurrence that best represents a series relative to `targetMs`: the first
 * non-cancelled occurrence scheduled at or after target (the current or next
 * one), else the most recent one before it. Unlike a fixed-window scan this
 * finds the nearest occurrence even for a long-interval series (e.g. every four
 * years) whose neighbours fall outside any reasonable window. Returns a
 * materialized occurrence, or null if the master carries no recurrence.
 */
export function occurrenceNear(master, targetMs) {
  const rule = normalizeRecurrence(master && master.recurrence, master && master.start);
  if (!rule) return null;
  const startDate = new Date(master.start);
  const untilMs = rule.until;
  const exdates = new Set((master.exdates || []).map(Number));
  // A bounded series (count or until) is enumerated from its first occurrence so
  // the bound is honored and, if it ended before target, we return its LAST
  // occurrence. An unbounded one jumps ahead to near the target cheaply — it
  // always has a "next", so its incomplete `prev` is never the result.
  const bounded = rule.count != null || untilMs != null;
  let period = bounded ? 0 : Math.max(0, periodIndexFor(rule, startDate, targetMs) - 2);
  let index = 0;
  let prev = null; // most recent non-cancelled scheduled start strictly before target
  let guard = 0;
  while (guard++ < COUNT_CAP) {
    const starts = periodStarts(rule, startDate, period++);
    for (const d of starts) {
      if (rule.count != null && index >= rule.count) {
        return materializeOccurrence(master, prev != null ? prev : master.start);
      }
      const ms = d.getTime();
      index++; // exdated slots still consume a count slot (matches collectStarts)
      if (untilMs != null && ms > untilMs) {
        return materializeOccurrence(master, prev != null ? prev : master.start);
      }
      if (exdates.has(ms)) continue; // cancelled — never a representative
      if (ms >= targetMs) return materializeOccurrence(master, ms);
      prev = ms;
    }
  }
  return materializeOccurrence(master, prev != null ? prev : master.start);
}

/**
 * Individual occurrences of a series master intersecting the half-open range
 * [from, to). Exdated occurrences are skipped; overrides are applied — including
 * an override that moved an occurrence's time INTO this window from a scheduled
 * slot outside it.
 */
export function expandOccurrences(master, from, to) {
  if (!master || !master.recurrence) return [];
  const rule = normalizeRecurrence(master.recurrence, master.start);
  if (!rule) return [];

  const startDate = new Date(master.start);
  const dur = Math.max(0, master.end - master.start);
  const exdates = new Set((master.exdates || []).map(Number));
  const overrides = master.overrides || {};
  const lower = from - dur; // earliest scheduled start that could still intersect

  const out = [];
  const emitted = new Set();
  for (const ms of collectStarts(rule, startDate, lower, to)) {
    emitted.add(ms);
    if (exdates.has(ms)) continue;
    const occ = buildOccurrence(master, ms, overrides[ms], dur);
    if (occ.start < to && occ.end > from) out.push(occ);
  }
  // Overrides whose scheduled slot falls outside [from,to) but were moved in.
  const pending = [];
  for (const key of Object.keys(overrides)) {
    const rid = Number(key);
    if (Number.isFinite(rid) && !emitted.has(rid) && !exdates.has(rid)) pending.push(rid);
  }
  // Only surface an override keyed to a genuine scheduled slot. Guards against
  // foreign/imported overrides whose recurrenceId is off-pattern or past the
  // series' count/until bound, which would otherwise render a phantom
  // occurrence the rule never produces. For a count-bounded rule that check
  // enumerates from the first occurrence every time (there is no jump-ahead
  // under a count), so asking it once per override made a month render —
  // 42 cells, each expanding the series — O(overrides × count) per cell: a
  // "999 times" weekday series with a few hundred edited past occurrences
  // (a Google export of an edited standup) took seconds. Enumerate the
  // schedule once and check every override against that set instead.
  const scheduled =
    pending.length && rule.count != null
      ? new Set(collectStarts(rule, startDate, -MAX_TIME_MS, MAX_TIME_MS))
      : null;
  for (const rid of pending) {
    const genuine = scheduled ? scheduled.has(rid) : isScheduledStart(rule, master.start, rid);
    if (!genuine) continue;
    const occ = buildOccurrence(master, rid, overrides[rid], dur);
    if (occ.start < to && occ.end > from) out.push(occ);
  }
  return out;
}

/** True when `rid` is a genuine scheduled start of `rule` (on-pattern and within
 *  count/until), anchored at `startMs`. */
export function isScheduledStart(rule, startMs, rid) {
  return collectStarts(rule, new Date(startMs), rid, rid + 1).length > 0;
}

/** True when `recurrenceId` names an occurrence `master`'s schedule actually
 *  produces (on-pattern, within count/until) — cancelled-or-not. The guard the
 *  store uses before vouching for or writing per-occurrence state. */
export function isScheduledOccurrence(master, recurrenceId) {
  if (!master || !master.recurrence) return false;
  const rule = normalizeRecurrence(master.recurrence, master.start);
  if (!rule) return false;
  const rid = Number(recurrenceId);
  return Number.isFinite(rid) && isScheduledStart(rule, master.start, rid);
}

/* ---- Human-readable summaries & presets ------------------------------- */

function formatUntil(ms) {
  const d = new Date(ms);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function ordinal(nth) {
  return ORDINALS[nth - 1] || `${nth}th`;
}

/** A one-line description of a rule, e.g. "Weekly on Monday, 13 times". */
export function describeRecurrence(rule, startMs) {
  if (!rule) return 'Does not repeat';
  const norm = normalizeRecurrence(rule, startMs);
  if (!norm) return 'Does not repeat';
  const start = new Date(startMs);
  const n = norm.interval;
  let base;

  if (norm.freq === 'daily') {
    base = n === 1 ? 'Daily' : `Every ${n} days`;
  } else if (norm.freq === 'weekly') {
    const days = norm.byWeekday;
    const isWeekdays = days.length === 5 && WEEKDAY_PRESET.every((d) => days.includes(d));
    if (isWeekdays && n === 1) {
      base = 'Every weekday';
    } else {
      const names = days.map((d) => WEEKDAYS_SHORT[d]).join(', ');
      base = n === 1 ? `Weekly on ${names}` : `Every ${n} weeks on ${names}`;
    }
  } else if (norm.freq === 'monthly') {
    if (norm.monthlyMode === 'weekday') {
      const { nth, weekday } = nthWeekdayInfo(start);
      const effective = norm.monthlyNth != null ? norm.monthlyNth : nth;
      const on = `the ${effective === -1 ? 'last' : ordinal(effective)} ${WEEKDAYS_LONG[weekday]}`;
      base = n === 1 ? `Monthly on ${on}` : `Every ${n} months on ${on}`;
    } else {
      base = n === 1 ? `Monthly on day ${start.getDate()}` : `Every ${n} months on day ${start.getDate()}`;
    }
  } else {
    const on = `${MONTHS_LONG[start.getMonth()]} ${start.getDate()}`;
    base = n === 1 ? `Annually on ${on}` : `Every ${n} years on ${on}`;
  }

  if (norm.count != null) base += `, ${norm.count} time${norm.count === 1 ? '' : 's'}`;
  else if (norm.until != null) base += `, until ${formatUntil(norm.until)}`;
  return base;
}

/** The "Repeat" dropdown presets, labelled for the given start date. */
export function buildPresets(startMs) {
  const start = new Date(startMs);
  const dow = start.getDay();
  const { nth } = nthWeekdayInfo(start);
  // A "fifth Tuesday" series would skip every month without one — never what
  // anyone means by picking a monthly repeat on such a date. Offer "last"
  // instead (a fifth weekday is always the last), like Google Calendar.
  const monthlyRule = { freq: 'monthly', interval: 1, monthlyMode: 'weekday' };
  if (nth === 5) monthlyRule.monthlyNth = -1;
  return [
    { key: 'none', label: 'Does not repeat', rule: null },
    { key: 'daily', label: 'Daily', rule: { freq: 'daily', interval: 1 } },
    {
      key: 'weekly',
      label: `Weekly on ${WEEKDAYS_LONG[dow]}`,
      rule: { freq: 'weekly', interval: 1, byWeekday: [dow] },
    },
    {
      key: 'monthly',
      label: `Monthly on the ${nth === 5 ? 'last' : ordinal(nth)} ${WEEKDAYS_LONG[dow]}`,
      rule: monthlyRule,
    },
    {
      key: 'yearly',
      label: `Annually on ${MONTHS_LONG[start.getMonth()]} ${start.getDate()}`,
      rule: { freq: 'yearly', interval: 1 },
    },
    {
      key: 'weekday',
      label: 'Every weekday (Monday to Friday)',
      rule: { freq: 'weekly', interval: 1, byWeekday: [...WEEKDAY_PRESET] },
    },
    { key: 'custom', label: 'Custom…' },
  ];
}

/** Which preset key a rule corresponds to (for selecting the dropdown on edit). */
export function matchPreset(rule, startMs) {
  const norm = normalizeRecurrence(rule, startMs);
  if (!norm) return 'none';
  if (norm.count != null || norm.until != null || norm.interval !== 1) return 'custom';
  const start = new Date(startMs);
  if (norm.freq === 'daily') return 'daily';
  if (norm.freq === 'weekly') {
    const days = norm.byWeekday;
    if (days.length === 1 && days[0] === start.getDay()) return 'weekly';
    if (days.length === 5 && WEEKDAY_PRESET.every((d) => days.includes(d))) return 'weekday';
    return 'custom';
  }
  if (norm.freq === 'monthly') {
    if (norm.monthlyMode !== 'weekday') return 'custom';
    // Match only when the rule schedules exactly what the preset (labelled for
    // this start date) would: the derived nth, or "last" where the preset says
    // last. An explicit nth that differs — e.g. an imported "last Friday" whose
    // start is a fourth-and-last Friday — must read as Custom, not be relabelled.
    const { nth } = nthWeekdayInfo(start);
    const presetNth = nth === 5 ? -1 : nth;
    const effective = norm.monthlyNth != null ? norm.monthlyNth : nth;
    return effective === presetNth ? 'monthly' : 'custom';
  }
  if (norm.freq === 'yearly') return 'yearly';
  return 'custom';
}
