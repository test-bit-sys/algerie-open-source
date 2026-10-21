/**
 * Date and duration helpers. Dates travel as local-calendar ISO strings
 * ("YYYY-MM-DD") so a Tuesday entry stays on Tuesday in every timezone;
 * durations travel as whole seconds.
 */

const pad2 = (n) => String(n).padStart(2, '0');

/** Local-calendar ISO date of a Date (no UTC shifting). */
export function isoOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO() {
  return isoOf(new Date());
}

/** "YYYY-MM" month key of an ISO date (defaults to today). */
export function monthKeyOf(iso = todayISO()) {
  return iso.slice(0, 7);
}

/** ISO date string to a local-midnight Date. */
export function dateOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const d = dateOf(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/**
 * Whole days from one ISO date to another, negative when `toISO` is
 * earlier. Rounded rather than truncated: two local midnights are 23 or
 * 25 hours apart across a daylight-saving change, and dividing would
 * report the wrong number of days for half the year.
 */
export function daysApart(fromISO, toISO) {
  return Math.round((dateOf(toISO) - dateOf(fromISO)) / 86400000);
}

/**
 * ISO date of the first day of the week containing `iso`.
 * `weekStart` is 1 for Monday (default) or 0 for Sunday.
 */
export function weekStartOf(iso, weekStart = 1) {
  const d = dateOf(iso);
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return isoOf(d);
}

/** The seven ISO dates of the week starting at `startISO`. */
export function weekDays(startISO) {
  return Array.from({ length: 7 }, (_, i) => addDays(startISO, i));
}

/** All ISO dates of a "YYYY-MM" month, in order. */
export function monthDays(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${monthKey}-${pad2(i + 1)}`);
}

/** Shift a "YYYY-MM" key by `delta` months. */
export function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** Month keys touched by an inclusive ISO date range, in order. */
export function monthKeysBetween(fromISO, toISO) {
  const keys = [];
  let [y, m] = fromISO.split('-').map(Number);
  const [ey, em] = toISO.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    keys.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

/**
 * Parse a typed duration into whole seconds. Accepts the ways people
 * actually write time: "1:30" (h:mm), "1:30:00", "90m", "1.5h", "1h 30m",
 * ":45" (45 minutes). Bare numbers are hours ("1.5" = 1h 30m, "8" = 8h),
 * except bare integers above 24, which people type meaning minutes
 * ("45" = 45m, "90" = 1h 30m). Returns NaN when unparseable.
 */
export function parseDuration(str) {
  let s = String(str ?? '').trim().toLowerCase().replace(',', '.');
  if (!s) return NaN;
  // ".5" or ".5h" mean 0.5: give a leading decimal point its zero so
  // the number patterns below can read it.
  if (s.startsWith('.')) s = `0${s}`;

  // "1:30" or "1:30:15"
  const colon = s.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (colon) {
    return (+colon[1]) * 3600 + (+colon[2]) * 60 + (+(colon[3] || 0));
  }
  // ":45" shorthand for 45 minutes
  const bareMin = s.match(/^:([0-5]?\d)$/);
  if (bareMin) return (+bareMin[1]) * 60;

  // Bare number, no unit: hours ("1.5", "8"), or minutes when it only
  // makes sense as minutes ("45", "90").
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (Number.isInteger(n) && n > 24) return n * 60;
    return Math.round(n * 3600);
  }

  // "1h", "1.5h", "1h30", "1h 30m"
  const hours = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?|\s+(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?))?$/);
  if (hours) {
    const m = parseFloat(hours[2] ?? hours[3] ?? hours[4] ?? 0);
    return Math.round(parseFloat(hours[1]) * 3600 + m * 60);
  }
  // "90m", "45 min"
  const mins = s.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?$/);
  if (mins) return Math.round(parseFloat(mins[1]) * 60);
  // "45s", "30 sec"
  const secs = s.match(/^(\d+)\s*s(?:ec(?:ond)?s?)?$/);
  if (secs) return +secs[1];
  // Full combo with explicit units: "1h 30m 20s", "2m 30s"
  const combo = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+)\s*s)?$/);
  if (combo && (combo[1] !== undefined || combo[2] !== undefined || combo[3] !== undefined)) {
    return Math.round(parseFloat(combo[1] || 0) * 3600 + parseFloat(combo[2] || 0) * 60 + (+(combo[3] || 0)));
  }
  return NaN;
}

/** Seconds as a compact clock string: "1:05" (h:mm) or "0:45". */
export function fmtClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}:${pad2(m)}`;
}

/** Seconds as a live timer string: "1:05:09". */
export function fmtTimer(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${pad2(m)}:${pad2(s)}`;
}

/** Seconds as human text: "1h 30m", "45m", "0m". */
export function fmtDuration(seconds) {
  const totalMin = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Seconds as decimal hours for exports and rate math: 5400 becomes 1.5. */
export function toHours(seconds, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round((seconds / 3600) * f) / f;
}

/**
 * Billing rounding: round a duration UP to the next `minutes` increment
 * (the industry convention for billable time). 0 or falsy means no rounding.
 */
export function roundSeconds(seconds, minutes = 0) {
  if (!minutes || seconds <= 0) return Math.max(0, seconds);
  const step = minutes * 60;
  return Math.ceil(seconds / step) * step;
}

/* ---------- clock times on an entry ----------
   Optional start and end live on an entry as epoch milliseconds, the same
   shape the running timer already uses. They are wall-clock facts about a
   local day (the entry's own date), so they format in the local zone and
   nothing here converts between zones. */

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "9:00 AM" or "09:00", in the user's own convention. */
export function fmtTime(ms) {
  return TIME_FMT.format(new Date(ms));
}

/** "9:00 AM – 10:30 AM", or null when either end is missing. */
export function fmtTimeRange(startMs, endMs) {
  if (!startMs || !endMs) return null;
  return `${fmtTime(startMs)} – ${fmtTime(endMs)}`;
}

/** "HH:MM" in 24-hour local time, the value an <input type="time"> wants. */
export function timeValueOf(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Epoch ms for a "HH:MM" (or "HH:MM:SS") wall-clock time on an ISO date,
 * or null when either part is missing or unreadable. `plusDays` shifts the
 * result forward, which is how an end time before its start reads as the
 * small hours of the next morning rather than as negative work.
 */
export function msAt(dateISO, timeValue, plusDays = 0) {
  const m = String(timeValue ?? '').match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  if (!dateISO || !m) return null;
  const [y, mo, d] = dateISO.split('-').map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d + plusDays, +m[1], +m[2], +(m[3] || 0), 0).getTime();
}

/**
 * The time-of-day part of an imported cell, as 24-hour "HH:MM":
 * "09:30", "2026-08-03 09:30:00", "1:30 PM". Whether a tracker writes
 * clock times on a 12- or 24-hour dial follows the exporting account's
 * own locale setting, so an "am"/"pm" suffix is read rather than
 * ignored — dropped, every afternoon in the file lands in the morning.
 * A suffix that contradicts the hour it qualifies ("13:00 PM") is left
 * out of it. Returns null when there is no readable time.
 */
export function timePartOf(value) {
  const s = String(value ?? '');
  // The 12-hour form first, so its suffix is not left behind by a match
  // that stopped at the minutes.
  const m = s.match(/(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*([ap])\.?\s*m\.?/i)
    || s.match(/(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/);
  if (!m) return null;
  let hour = Number(m[1]);
  const half = m[4]?.toLowerCase();
  if (half && hour >= 1 && hour <= 12) {
    // Noon and midnight are the two the shift does not apply to: 12 PM is
    // already 12, and 12 AM is 0.
    if (half === 'p') hour = hour === 12 ? 12 : hour + 12;
    else hour = hour === 12 ? 0 : hour;
  }
  if (hour > 23) return null;
  return `${pad2(hour)}:${m[2]}`;
}

const WD_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const WD_LONG_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const DAY_YEAR_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** "Tue" for an ISO date. */
export function fmtWeekday(iso) {
  return WD_FMT.format(dateOf(iso));
}

/** "Aug 4" or "Aug 4, 2026" when the year differs from the current one. */
export function fmtDay(iso, { year = 'auto' } = {}) {
  const d = dateOf(iso);
  const withYear = year === true || (year === 'auto' && d.getFullYear() !== new Date().getFullYear());
  return (withYear ? DAY_YEAR_FMT : DAY_FMT).format(d);
}

/** "Today", "Yesterday", or "Tuesday, Aug 4". */
export function fmtDayHeading(iso) {
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return `${WD_LONG_FMT.format(dateOf(iso))}, ${fmtDay(iso)}`;
}

/** "Aug 4 - Aug 10" (or with years when they differ). */
export function fmtWeekRange(startISO) {
  const endISO = addDays(startISO, 6);
  return `${fmtDay(startISO)} - ${fmtDay(endISO)}`;
}

/** "August 2026" for a "YYYY-MM" month key. */
export function fmtMonth(monthKey) {
  return MONTH_FMT.format(dateOf(`${monthKey}-01`));
}
