/** CSV export of time entries, one row per entry, plus a small parser. */

import { fmtClock, fmtTimer, isoOf, toHours, timeValueOf } from './time.js';

/**
 * Parse CSV text into rows of string fields (RFC 4180: quoted fields may
 * hold commas, quotes, and newlines). Tolerates CRLF and a leading BOM;
 * fully empty lines are dropped.
 */
export function parseCSV(text) {
  const s = String(text ?? '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Escape one CSV field per RFC 4180, with a spreadsheet formula guard. */
export function csvField(value) {
  let s = String(value ?? '');
  // Spreadsheets execute cells starting with = + - @ (or a stray tab/CR)
  // as formulas; a leading apostrophe marks them as literal text (OWASP
  // CSV-injection guidance). App-generated numbers here are never
  // negative, so only user text is ever affected.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCSVLine(fields) {
  return fields.map(csvField).join(',');
}

export const CSV_HEADER = [
  'Date', 'Start', 'End', 'Client', 'Project', 'Task', 'Notes',
  'Duration', 'Hours', 'Billable', 'Rate', 'Currency', 'Amount', 'Invoiced',
];

/**
 * Entries to CSV text. `store` supplies client/project names and rate math
 * so the export shows exactly what the app shows.
 */
export function entriesToCSV(entries, store) {
  const lines = [toCSVLine(CSV_HEADER)];
  for (const e of entries) {
    const project = store.project(e.projectId);
    const client = store.client(project?.clientId);
    lines.push(toCSVLine([
      e.date,
      // 24-hour local clock times, empty on a duration-only entry. The
      // Date column carries the day, so these are the times of day.
      e.startedAt ? timeValueOf(e.startedAt) : '',
      e.endedAt ? timeValueOf(e.endedAt) : '',
      client?.name || '',
      project?.name || '',
      e.task,
      e.notes,
      // h:mm:ss when the seconds don't fall on a minute (timer entries):
      // "1:30" would silently shave the rest off the exported record.
      e.seconds % 60 ? fmtTimer(e.seconds) : fmtClock(e.seconds),
      toHours(e.seconds),
      e.billable ? 'yes' : 'no',
      e.billable ? store.effectiveRate(e) : '',
      e.billable ? store.resolveCurrency(e) : '',
      e.billable ? store.entryAmount(e).toFixed(2) : '',
      // Local calendar date, like every other date in the app (the UTC
      // date can be a day off around midnight).
      e.invoicedAt ? isoOf(new Date(e.invoicedAt)) : '',
    ]));
  }
  return lines.join('\r\n');
}
