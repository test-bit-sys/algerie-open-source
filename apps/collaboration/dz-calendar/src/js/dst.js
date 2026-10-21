/**
 * Clock changes (daylight saving transitions) — a computed, read-only overlay
 * in the mould of holidays.js.
 *
 * Never a table of dates. "March 8th and November 1st" is true of the US in
 * 2026, false of it in 2027 (the 14th and the 7th), three weeks off in Berlin,
 * the wrong way round in Sydney and never true in Tokyo — and a marker that is
 * wrong looks exactly as authoritative as one that is right. The browser
 * already knows every transition of every zone, so a year is scanned for the
 * days on which a zone's UTC offset changes and the exact minute is found by
 * bisection. Correct for any zone in any year, and correctly EMPTY where the
 * clocks never move (Japan, India, Arizona, Saskatchewan).
 *
 * A transition is described by what it is — the clocks go forward or back by
 * so much at such a time — not by why. That stays true for the one-off offset
 * changes a country legislates now and then, which are not daylight saving at
 * all but move the clocks all the same.
 */
import { isValidTimeZone } from './date-utils.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The browser's IANA zone, or '' if Intl cannot say. */
export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/* ---- Offsets ------------------------------------------------------------ */

// One formatter per zone, not one per lookup: a year's scan asks for ~400
// offsets, and constructing an Intl.DateTimeFormat is the expensive part.
const formatters = new Map();
function formatterFor(zone) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** `zone`'s UTC offset in whole minutes at the instant `ms`. */
function offsetAt(ms, zone) {
  const parts = formatterFor(zone).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  // Hour "24" (some engines' midnight) must roll into the next day — no % 24.
  const asZone = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asZone - Math.floor(ms / MINUTE) * MINUTE) / MINUTE);
}

/* ---- Transitions -------------------------------------------------------- */

const cache = new Map(); // `${zone}:${year}` -> frozen [{ at, before, after }]
const CACHE_MAX = 64;

/**
 * Every offset change in `zone` whose instant falls in the UTC year `year`, in
 * order, as `{ at, before, after }` (ms and minutes). The UTC years partition
 * time, so a range query that walks consecutive years sees each change once.
 *
 * The scan compares the offset at successive UTC midnights; a change between
 * two of them is then bisected to the minute. Real transitions are all on a
 * whole minute (almost all on a whole hour), so the bisection is exact.
 */
export function transitionsInYear(zone, year) {
  const key = `${zone}:${year}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = [];
  const end = Date.UTC(year + 1, 0, 1);
  let t = Date.UTC(year, 0, 1);
  let before = offsetAt(t, zone);
  while (t < end) {
    const next = Math.min(t + DAY, end);
    const after = offsetAt(next, zone);
    if (after !== before) {
      let lo = t;
      let hi = next;
      while (hi - lo > MINUTE) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
        if (offsetAt(mid, zone) === before) lo = mid;
        else hi = mid;
      }
      out.push(Object.freeze({ at: hi, before, after }));
      before = after;
    }
    t = next;
  }
  const value = Object.freeze(out);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

/**
 * The clock changes of `zone` whose day intersects `[from, to)` as read-only,
 * event-shaped objects — one all-day item on the local day the clocks move.
 * `zone` is the browser's zone in practice (the calendar's days ARE that
 * zone's days), so the local date of the instant is the day the chip sits on.
 */
export function getClockChangesInRange(zone, from, to) {
  if (!isValidTimeZone(zone) || !(to > from)) return [];
  const out = [];
  // A change in the first or last hours of a local year can sit in the
  // neighbouring UTC year, hence the year of padding either side.
  const y0 = new Date(from).getFullYear() - 1;
  const y1 = new Date(to - 1).getFullYear() + 1;
  for (let y = y0; y <= y1; y++) {
    for (const tr of transitionsInYear(zone, y)) {
      const d = new Date(tr.at);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      if (start >= to || end <= from) continue;
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const forward = tr.after > tr.before;
      out.push(
        Object.freeze({
          id: `dst:${zone}:${day}`,
          dst: true,
          readOnly: true,
          title: forward ? 'Clocks go forward' : 'Clocks go back',
          allDay: true,
          start,
          end,
          at: tr.at,
          before: tr.before,
          after: tr.after,
          zone,
        }),
      );
    }
  }
  return out;
}

/** "1 hour", "2 hours", "30 minutes" — the size of a change, unsigned. */
export function describeShift(minutes) {
  const m = Math.abs(minutes);
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`;
  return `${m} minutes`;
}

/** Drop every memoised year. Only the tests need this. */
export function clearClockChangeCache() {
  cache.clear();
  formatters.clear();
}
