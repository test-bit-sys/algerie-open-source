/**
 * Turning other trackers' CSV exports into Hourly entries. Column names
 * from Toggl, Clockify, and Harvest detailed exports are recognized
 * automatically; anything else falls back to manual column mapping in
 * the import wizard.
 */

import { parseDuration, msAt, timePartOf } from './time.js';

const pad2 = (n) => String(n).padStart(2, '0');

/** The fields an import can fill, with the headers that auto-match them. */
export const IMPORT_TARGETS = [
  { key: 'date', label: 'Date', required: true, candidates: ['start date', 'date'] },
  { key: 'duration', label: 'Duration', required: true, candidates: ['duration', 'duration (h)', 'duration (decimal)', 'hours', 'time (h)'] },
  { key: 'project', label: 'Project', required: true, candidates: ['project', 'project name'] },
  { key: 'client', label: 'Client', required: false, candidates: ['client', 'client name'] },
  { key: 'task', label: 'Task', required: false, candidates: ['description', 'task', 'title'] },
  { key: 'notes', label: 'Notes', required: false, candidates: ['notes', 'note'] },
  { key: 'billable', label: 'Billable', required: false, candidates: ['billable', 'billable?'] },
  /* Toggl and Clockify both export clock times in their own columns next
     to the date; Harvest does not. Matching is exact, so "start time"
     never collides with the "start date" the date field claims. */
  { key: 'start', label: 'Start time', required: false, candidates: ['start time', 'start', 'from'] },
  { key: 'end', label: 'End time', required: false, candidates: ['end time', 'end', 'to'] },
];

/**
 * Guess which column feeds which field from the header row. Returns
 * { source, mapping } where mapping holds a column index per field key
 * (-1 when absent) and source names the recognized tracker.
 */
export function detectMapping(headers) {
  const lower = headers.map((h) => String(h).trim().toLowerCase());
  const mapping = {};
  for (const t of IMPORT_TARGETS) {
    const found = t.candidates.map((c) => lower.indexOf(c)).find((i) => i !== -1);
    mapping[t.key] = found === undefined ? -1 : found;
  }
  let source = 'CSV';
  if (lower.includes('duration (h)') || lower.includes('duration (decimal)')) source = 'Clockify';
  else if (lower.includes('start date') && lower.includes('duration')) source = 'Toggl';
  else if (lower.includes('hours') && lower.includes('date')) source = 'Harvest';
  return { source, mapping };
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * The ISO date a year/month/day triple names, or null when no such day
 * exists. Every date in the app is a local-calendar string, and the rest
 * of the app trusts that one to be real: "2026-02-30" would file an entry
 * under 2026-02 while every range that could show it (February ends at
 * the 28th, March starts at the 1st) skips straight past it, and a month
 * outside 1-12 would name a month file nothing ever reads back.
 */
function isoIfReal(year, month, day) {
  if (!(month >= 1 && month <= 12) || day < 1) return null;
  const longest = month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
  if (day > longest) return null;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/**
 * A date cell to ISO: "2026-08-03[ ...]", "8/3/2026", "03.08.2026".
 * Slash dates read month-first (the US convention that produces them);
 * dotted dates read day-first (the convention everywhere dots are used).
 * An impossible value flips the two. Returns null when unreadable, which
 * includes a well-formed date that does not exist on the calendar.
 */
export function parseImportDate(value) {
  const s = String(value ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoIfReal(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})([/.])(\d{1,2})\2(\d{4})/);
  if (m) {
    const dotted = m[2] === '.';
    let month = dotted ? +m[3] : +m[1];
    let day = dotted ? +m[1] : +m[3];
    if (month > 12 && day <= 12) [month, day] = [day, month];
    return isoIfReal(+m[4], month, day);
  }
  return null;
}

/**
 * A duration cell to seconds: "8:30:00" and "8:30" are clock durations,
 * bare numbers are decimal hours ("7.5", "7,5"), and explicit units use
 * the manual-entry parser. Returns null when unreadable or not positive.
 */
export function parseImportDuration(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const numeric = s.replace(',', '.');
  // Consume the whole value: parseFloat("1h 30m") silently imported one
  // hour, and malformed clock strings could also become decimal hours.
  // Bare numbers must stay hours even above 24 (manual entry differs).
  const seconds = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(numeric)
    ? Math.round(Number(numeric) * 3600)
    : parseDuration(s);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

const TRUTHY = new Set(['yes', 'true', '1', 'billable']);

/**
 * Data rows to import items using a mapping. Returns { items, invalid };
 * invalid rows carry their 1-based file line and a reason. Rows without
 * a billable column import as billable.
 */
export function rowsToItems(rows, mapping) {
  const items = [];
  const invalid = [];
  rows.forEach((row, i) => {
    const cell = (key) => (mapping[key] >= 0 ? String(row[mapping[key]] ?? '').trim() : '');
    const date = parseImportDate(cell('date'));
    const seconds = parseImportDuration(cell('duration'));
    const project = cell('project');
    if (!date || !seconds || !project) {
      invalid.push({
        line: i + 2, // 1-based, after the header row
        reason: !date ? 'unreadable date' : !seconds ? 'unreadable duration' : 'missing project',
      });
      return;
    }
    /* Clock times, when the export carries them: kept as wall-clock times
       on the row's own date. An end at or before its start is the small
       hours of the next morning, which is how a night shift reads. Times
       are decoration on the duration, never a source for it, so anything
       unreadable is simply dropped rather than failing the row. */
    const startedAt = msAt(date, timePartOf(cell('start')));
    let endedAt = msAt(date, timePartOf(cell('end')));
    if (startedAt && endedAt && endedAt <= startedAt) {
      endedAt = msAt(date, timePartOf(cell('end')), 1);
    }
    items.push({
      date,
      seconds,
      project,
      client: cell('client'),
      task: cell('task'),
      notes: cell('notes'),
      startedAt: startedAt && endedAt ? startedAt : null,
      endedAt: startedAt && endedAt ? endedAt : null,
      billable: mapping.billable >= 0 ? TRUTHY.has(cell('billable').toLowerCase()) : true,
    });
  });
  return { items, invalid };
}
