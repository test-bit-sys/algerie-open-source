export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Round money to 2 decimals without float drift on typical inputs. */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sum(arr, fn = (x) => x) {
  return arr.reduce((a, x) => a + fn(x), 0);
}

/**
 * Parse a typed money amount, tolerating both decimal-comma and
 * thousands-separator styles: "1,234.56" and "1.234,56" become 1234.56,
 * "12,50" becomes 12.5, "1,234" becomes 1234. Returns NaN when unparseable.
 */
export function parseAmount(str) {
  const s = String(str ?? '').replace(/[\s\u202f']/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized = s;
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: whichever comes last is the decimal separator.
    normalized = lastComma > lastDot
      ? s.replaceAll('.', '').replace(',', '.')
      : s.replaceAll(',', '');
  } else if (lastComma !== -1) {
    // Comma only: "1,234" / "1,234,567" is grouping; "12,50" is a decimal.
    normalized = /^-?\d{1,3}(,\d{3})+$/.test(s)
      ? s.replaceAll(',', '')
      : s.replace(',', '.');
  }
  // A partial number must not become a saved rate, payment, or budget.
  // Keep supported numeric notation while rejecting trailing text and
  // extra separators instead of silently billing the parsed prefix.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return NaN;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : NaN;
}

/** Case- and accent-insensitive "haystack contains needle". */
export function textMatches(haystack, needle) {
  if (!needle) return true;
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return norm(haystack).includes(norm(needle));
}

/** Currency codes offered in settings; formatting itself goes through Intl. */
export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'AED',
  'BRL', 'DKK', 'HKD', 'IDR', 'ILS', 'KRW', 'MXN', 'NOK', 'NZD', 'PHP',
  'PLN', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR',
];

/* ---------- billing option lists ----------
   Offered in Settings as the global default and on a client as an
   override; the labels live here so both sheets word them identically. */

/** Billing rounding increments, in minutes (0 = no rounding). */
export const ROUNDINGS = [0, 5, 6, 10, 15, 30];

/** Minimum billable durations, in minutes (0 = no minimum). */
export const MINIMUMS = [0, 6, 10, 15, 30, 60];

/** Payment terms offered, in net days (0 = due the day it is issued). */
export const TERM_DAYS = [0, 7, 14, 21, 30, 45, 60];

export function roundingLabel(minutes) {
  return minutes ? `Up to ${minutes} minutes` : 'No rounding';
}

export function minimumLabel(minutes) {
  if (!minutes) return 'No minimum';
  return minutes === 60 ? '1 hour' : `${minutes} minutes`;
}

export function termsLabel(days) {
  if (days == null) return 'No due date';
  return Number(days) === 0 ? 'Due on receipt' : `Net ${days} days`;
}

const moneyFmtCache = new Map();

/** Format an amount in a currency using the user's locale conventions. */
export function fmtMoney(n, currency = 'USD') {
  let fmt = moneyFmtCache.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFmtCache.set(currency, fmt);
  }
  return fmt.format(n);
}

/**
 * Format per-currency amounts side by side ("$1,200 · €340"). Amounts in
 * different currencies are never converted or added together; an empty
 * list renders as zero in the fallback currency.
 */
export function fmtMoneyList(amounts, fallbackCurrency = 'USD') {
  if (!amounts?.length) return fmtMoney(0, fallbackCurrency);
  return amounts.map((a) => fmtMoney(a.amount, a.currency)).join(' · ');
}

/** Trigger a client-side file download. */
export function downloadFile(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download (Firefox).
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
