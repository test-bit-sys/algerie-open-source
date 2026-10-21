/**
 * A list to walk, whatever arrived. Every array-shaped field the app
 * stores — a kit's components, an order's lines, a product's sources,
 * a location's lots — reaches these modules from a JSON file a person
 * may have written or truncated by hand. The maps already guard their
 * shape (see stockMap); the lists have to as well, because `for…of` a
 * number throws, and one such field took the Overview, the Reports
 * page and the products list down with it on every render.
 */
export const asList = (value) => (Array.isArray(value) ? value : []);

/** Random, sortable-enough unique id: time prefix + random tail. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Round to cents, half away from zero, absorbing the float drift that
 * makes a decimal like 8.165 arrive as 816.4999999999999 hundredths.
 *
 * The nudge has to scale with the value: Number.EPSILON is the gap
 * between representable numbers at 1.0, so adding it flat did nothing
 * at all above 2 — 8.165 rounded down to 8.16 while 1.005 rounded up.
 */
export function round2(n) {
  const cents = Number(n) * 100;
  const rounded = Math.round(cents + Math.sign(cents) * Math.abs(cents) * Number.EPSILON);
  // Without this a small negative comes back as -0, which prints as
  // "-0.00" in some currencies and compares oddly everywhere.
  return rounded === 0 ? 0 : rounded / 100;
}

const FORMATTERS = new Map();

/** Format an amount in the given ISO currency; falls back to a plain number. */
export function formatMoney(amount, currency = 'DZD') {
  const n = Number(amount) || 0;
  if (currency === 'DZD') {
    return `${new Intl.NumberFormat('fr-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} د.ج`;
  }
  let fmt = FORMATTERS.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    FORMATTERS.set(currency, fmt);
  }
  return fmt.format(n);
}

const QTY_FMT = new Intl.NumberFormat();

/** Format a unit count with thousands separators. */
export function formatQty(n) {
  return QTY_FMT.format(Number(n) || 0);
}

/**
 * Parse a quantity from user or CSV input. Accepts thousands separators
 * and surrounding junk; returns NaN for non-numbers, and never negatives.
 * Decimals are rejected unless asked for — a count of items can't be
 * 2.5, and silently rounding a typo would be worse than refusing it.
 *
 * Commas follow the same rule as parseMoney: a trailing comma group
 * reads as the decimal separator ("4,25", "1.234,56") unless it looks
 * like a thousands group ("1,234", "1,23,456") — the alternative reads
 * a European "4,25" as 425 and imports it a hundredfold.
 */
export function parseQty(raw, { decimals = false } = {}) {
  let s = String(raw ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) {
    const tail = s.length - lastComma - 1;
    const decimal = tail > 0 && (lastDot !== -1 || tail !== 3);
    s = s.replace(/\./g, '');
    const cut = s.lastIndexOf(',');
    s = decimal
      ? `${s.slice(0, cut).replace(/,/g, '')}.${s.slice(cut + 1)}`
      : s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }
  if (decimals) {
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 1000) / 1000;
  }
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  // A count written with a decimal part that comes to nothing — "5.00",
  // which is how spreadsheets and most stock-system exports format a
  // whole number, and "5,00" in a European one — is that whole number,
  // not a fraction to refuse. Every row of such a file used to import
  // no quantity at all. A real fraction is still refused: silently
  // rounding 2.5 items away is worse than saying it can't be read.
  if (!/^\d*\.\d+$/.test(s)) return NaN;
  const whole = parseFloat(s);
  return Number.isInteger(whole) ? whole : NaN;
}

/**
 * Parse a money value from user or CSV input: currency symbols and codes,
 * thousands separators, "1.234,56" style decimals, minus and "(12.34)"
 * accounting negatives. NaN when hopeless.
 */
export function parseMoney(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : NaN;
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  // Strip currency symbols and codes first, so "$ -4.20" and "EUR 7-"
  // still expose their sign at the edges of what remains.
  s = s.replace(/[−–]/g, '-').replace(/[^\d.,-]/g, '');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/-/g, '');
  if (!/\d/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) {
    // A trailing comma group is the decimal separator ("1.234,56",
    // "4,20") — unless it reads as a thousands group ("1,234",
    // "1,234,567"), which is what a Quantity column in the same file
    // would call one thousand two hundred, not 1.2.
    const decimal = lastDot !== -1 || s.length - lastComma - 1 !== 3;
    s = s.replace(/\./g, '');
    const cut = s.lastIndexOf(',');
    s = decimal
      ? `${s.slice(0, cut).replace(/,/g, '')}.${s.slice(cut + 1)}`
      : s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }
  const v = parseFloat(s);
  if (Number.isNaN(v)) return NaN;
  return round2(neg ? -v : v);
}

/** Local YYYY-MM-DD, for export filenames (toISOString would be UTC). */
export function dateStamp(d = new Date()) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "2 hours ago", "3d ago" style relative time for activity rows. */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Debounce: trailing-edge only. */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Trigger a client-side file download. */
export function downloadFile(name, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
