/** Small, dependency-free helpers shared by the data layer and the UI. */

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD (never UTC - a follow-up due "today" must mean the user's today). */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** YYYY-MM month key of an ISO date string or Date. */
export function monthKey(date = new Date()) {
  if (typeof date === 'string') return date.slice(0, 7);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** Month key shifted by `n` months (n may be negative). */
export function shiftMonthKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** ISO date shifted by `n` days. */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + n));
}

/**
 * ISO date shifted by `n` calendar months, clamped to the target month's
 * last day - "monthly from Jan 31" must mean Feb 28, not March 3.
 */
export function addMonthsClamped(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = m - 1 + n;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(Math.min(d, daysInMonth(year, month)))}`;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days in a 1-indexed month of a given year. */
export function daysInMonth(year, month) {
  if (month < 1 || month > 12) return 0;
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
}

/**
 * Is this a YYYY-MM-DD string naming a real calendar day? The shape alone
 * isn't enough: "2026-02-30" and "2020-45-13" both pass a regex and then
 * poison every month bucket and date label they reach.
 */
export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return d >= 1 && d <= daysInMonth(y, m);
}

/** Whole-day difference b - a (positive when b is after a). */
export function daysBetween(a, b) {
  const parse = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  return Math.round((parse(b) - parse(a)) / 86400000);
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 12" or "Aug 12, 2025" when the year differs from today's. */
export function formatDate(iso, { year = 'auto' } = {}) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  // Anything we can't name is shown as it was stored - "undefined 13, 2020"
  // helps nobody.
  if (!MONTHS_SHORT[m - 1] || !Number.isFinite(d)) return String(iso);
  const showYear = year === 'always' || (year === 'auto' && y !== new Date().getFullYear());
  return `${MONTHS_SHORT[m - 1]} ${d}${showYear ? `, ${y}` : ''}`;
}

/** "14:30" → "2:30pm" (en-US, matching the rest of the UI's formatting). */
export function formatClock(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${pad2(m)}${suffix}` : `${hour}${suffix}`;
}

/**
 * "Aug 2026" for a YYYY-MM key. `year: 'auto'` drops the year inside the
 * current one, the way formatDate does - for labels sitting next to a
 * month that is already named ("Won in Aug ... vs Jul").
 */
export function formatMonth(key, { year = 'always' } = {}) {
  const [y, m] = key.split('-').map(Number);
  const showYear = year === 'always' || (year === 'auto' && y !== new Date().getFullYear());
  return `${MONTHS_SHORT[m - 1]}${showYear ? ` ${y}` : ''}`;
}

/**
 * Human framing of a due date relative to today:
 * "3d overdue" / "Today" / "Tomorrow" / "In 5d" / "Aug 24".
 * Also reports the status so the UI can color it without re-deriving.
 */
export function dueLabel(iso, today = todayISO()) {
  const diff = daysBetween(today, iso);
  if (diff < 0) return { text: `${-diff}d overdue`, status: 'overdue' };
  if (diff === 0) return { text: 'Today', status: 'today' };
  if (diff === 1) return { text: 'Tomorrow', status: 'soon' };
  if (diff <= 7) return { text: `In ${diff}d`, status: 'soon' };
  return { text: formatDate(iso), status: 'later' };
}

/**
 * How long ago a dated record happened, in the coarse units people use for
 * "when did we last talk": "today" / "yesterday" / "5d ago" / "3w ago" /
 * "4mo ago". Future dates read as today.
 */
export function sinceLabel(iso, today = todayISO()) {
  const days = Math.max(0, daysBetween(iso, today));
  if (days === 0) return { text: 'today', days };
  if (days === 1) return { text: 'yesterday', days };
  if (days < 14) return { text: `${days}d ago`, days };
  if (days < 60) return { text: `${Math.round(days / 7)}w ago`, days };
  return { text: `${Math.round(days / 30)}mo ago`, days };
}

/** "just now" / "5m ago" / "3h ago" / "Aug 12" for a timestamp. */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(todayISO(new Date(ts)));
}

/* Money is pinned to en-US formatting: the UI (and the K/M suffixes below)
   is English, and pinning keeps symbols identical on every device. */
const MONEY_LOCALE = 'en-US';

/**
 * Full currency amount: formatMoney(12500, 'USD') → "$12,500".
 * Round numbers lose the ".00"; anything with cents keeps both digits, so
 * a deal worth 12500.50 never reads as "$12,500.5".
 */
export function formatMoney(amount, currency = 'DZD') {
  const n = Number(amount) || 0;
  const digits = Number.isInteger(n) ? 0 : 2;
  if (currency === 'DZD') {
    return `${n.toLocaleString('fr-DZ', { minimumFractionDigits: digits, maximumFractionDigits: digits })} د.ج`;
  }
  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: 'currency', currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString(MONEY_LOCALE, {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    })}`;
  }
}

/** Compact currency for stat tiles and chart labels: "$4.2M", "$18.5K", "$950", or "4.2M د.ج". */
export function compactMoney(amount, currency = 'DZD') {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (currency === 'DZD') {
    if (abs >= 1e6) return `${sign}${trim1(abs / 1e6)}M د.ج`;
    if (abs >= 1e3) return `${sign}${trim1(abs / 1e3)}K د.ج`;
    return `${sign}${abs.toLocaleString('fr-DZ', { maximumFractionDigits: 0 })} د.ج`;
  }
  const sym = symbolOf(currency);
  if (abs >= 999_950_000) return `${sign}${sym}${trim1(abs / 1e9)}B`;
  if (abs >= 999_950) return `${sign}${sym}${trim1(abs / 1e6)}M`;
  if (abs >= 10000) return `${sign}${sym}${trim1(abs / 1000)}K`;
  return `${sign}${sym}${abs.toLocaleString(MONEY_LOCALE, { maximumFractionDigits: 0 })}`;
}

const trim1 = (n) => (Math.round(n * 10) / 10).toString();

function symbolOf(currency) {
  if (currency === 'DZD') return 'د.ج ';
  try {
    const parts = new Intl.NumberFormat(MONEY_LOCALE, { style: 'currency', currency }).formatToParts(1);
    return parts.find((p) => p.type === 'currency')?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

/** "Ada Lovelace" → "AL"; single names and empty strings degrade gracefully. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Case- and accent-folded text, the basis of every search in the app. */
export function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Case/accent-insensitive substring test for search boxes. */
export function fuzzyIncludes(haystack, needle) {
  return normalizeText(haystack).includes(normalizeText(needle));
}

/**
 * How well `text` matches a query, for ranking mixed result lists:
 * -1 no match, 30 mid-word, 60 at a word start, 100ish from the first
 * character (shorter matches score higher - "Mei" beats "Meital").
 */
export function matchScore(text, query) {
  const hay = normalizeText(text);
  const needle = normalizeText(query);
  if (!needle) return 0;
  const at = hay.indexOf(needle);
  if (at < 0) return -1;
  if (at === 0) return 100 - Math.min(40, hay.length - needle.length);
  return /[\s\-_/.,(]/.test(hay[at - 1]) ? 60 : 30;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
