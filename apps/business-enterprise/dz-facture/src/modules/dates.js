/**
 * DZ-Facture: Local Date Utilities (Timezone-Safe)
 * ------------------------------------------------
 * IMPORTANT: `new Date().toISOString()` returns a UTC timestamp. Algeria runs
 * on UTC+1, so between 00:00 and 00:59 local time the UTC date is YESTERDAY.
 * Naively using `toISOString().split('T')[0]` produced off-by-one dates in
 * invoices, daily Z-reports, and dashboard charts.
 *
 * All date keys in the application MUST be produced by these helpers so that
 * documents are always stamped with the merchant's actual local date.
 */

/**
 * Converts any date-like value into a local `YYYY-MM-DD` date key.
 *  - Date-only strings (`YYYY-MM-DD`) are returned as-is.
 *  - Full ISO strings / Date objects are converted to the LOCAL calendar day.
 *  - Invalid input returns '' (never throws).
 */
export function toLocalDateKey(date = new Date()) {
  if (date == null) return '';

  if (typeof date === 'string') {
    const trimmed = date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return '';
    return toLocalDateKey(parsed);
  }

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's date key in the machine's local timezone (`YYYY-MM-DD`). */
export function todayLocalISO(date = new Date()) {
  return toLocalDateKey(date);
}

/** Local time-of-day key (`HH:MM`) used by held-cart labels. */
export function toLocalTimeKey(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
