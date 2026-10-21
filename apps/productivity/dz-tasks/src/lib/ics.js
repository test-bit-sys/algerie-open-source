/**
 * iCalendar (RFC 5545) export. Dated tasks become VEVENTs (all-day, or one
 * hour when a time is set) because consumer calendars import VEVENT far more
 * reliably than VTODO. Due-date repeat rules map to RRULE; after-completion
 * rules depend on when you finish, so only their current occurrence exports.
 */

import { pad2 } from './dates.js';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const PRIORITY_MAP = { 3: 1, 2: 5, 1: 9 }; // ours (high/med/low) → iCal 1..9

export function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // Lone \r included: a raw CR would break the content line apart (and
    // read as property injection to lenient parsers).
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold long content lines at 74 octets with a leading space (RFC 5545 3.1).
 * The 75-octet limit is on UTF-8 bytes, not string length, and a fold must
 * not split a multi-byte character — so measure per code point.
 */
const utf8 = new TextEncoder();

export function foldLine(line) {
  if (utf8.encode(line).length <= 74) return line;
  const parts = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const w = utf8.encode(ch).length;
    if (curBytes + w > 74) {
      parts.push(cur);
      cur = ' ';
      curBytes = 1;
    }
    cur += ch;
    curBytes += w;
  }
  parts.push(cur);
  return parts.join('\r\n');
}

function dateValue(iso) {
  return iso.replaceAll('-', '');
}

function dateTimeValue(iso, hhmm) {
  return `${dateValue(iso)}T${hhmm.replace(':', '')}00`;
}

function utcStamp(d) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

function rrule(rule) {
  if (!rule || rule.mode === 'done') return null;
  const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[rule.freq];
  if (!freq) return null;
  let out = `FREQ=${freq}`;
  if (rule.interval > 1) out += `;INTERVAL=${rule.interval}`;
  if (rule.freq === 'weekly' && rule.weekdays?.length) {
    out += `;BYDAY=${rule.weekdays.map((d) => BYDAY[d]).join(',')}`;
  }
  // Without this, a consumer expands a rule whose DTSTART sits on a
  // clamped occurrence (Feb 28 for "every 31st") as "the 28th monthly".
  if (rule.freq === 'monthly' && rule.day) out += `;BYMONTHDAY=${rule.day}`;
  return out;
}

function endTime(iso, hhmm) {
  // One-hour block. Roll into the next day when the task starts in the
  // final hour: clamping to the same day would shorten late events and, at
  // 23:59, produce DTEND == DTSTART — a zero-length event that RFC 5545
  // forbids and calendars reject.
  const [y, mo, d] = iso.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const end = new Date(y, mo - 1, d, h + 1, m);
  return `${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(end.getDate())}` +
    `T${pad2(end.getHours())}${pad2(end.getMinutes())}00`;
}

function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const nd = new Date(y, m - 1, d + 1);
  return `${nd.getFullYear()}${pad2(nd.getMonth() + 1)}${pad2(nd.getDate())}`;
}

/**
 * tasks: dated tasks (due != null). listNameOf(task) labels the source list.
 * Returns the full text of a .ics file.
 */
export function buildICS(tasks, { calName = 'Tasks', now = new Date(), listNameOf = () => null } = {}) {
  const stamp = utcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tasks on Puter//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calName)}`,
  ];

  for (const t of tasks) {
    if (!t.due) continue;
    lines.push('BEGIN:VEVENT');
    // Escape the id: it can arrive verbatim from an import or a collab
    // member's replica, and a raw newline in it would break out of the UID
    // line and inject arbitrary calendar properties.
    lines.push(`UID:${escapeText(t.id)}@tasks.puter`);
    lines.push(`DTSTAMP:${stamp}`);
    if (t.dueTime) {
      lines.push(`DTSTART:${dateTimeValue(t.due, t.dueTime)}`);
      lines.push(`DTEND:${endTime(t.due, t.dueTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(t.due)}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(t.due)}`);
    }
    lines.push(`SUMMARY:${escapeText(t.title)}`);
    const listName = listNameOf(t);
    const descParts = [];
    if (listName) descParts.push(`List: ${listName}`);
    if (t.notes) descParts.push(t.notes);
    if (t.subtasks?.length) {
      descParts.push(t.subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join('\n'));
    }
    if (descParts.length) lines.push(`DESCRIPTION:${escapeText(descParts.join('\n\n'))}`);
    if (PRIORITY_MAP[t.priority]) lines.push(`PRIORITY:${PRIORITY_MAP[t.priority]}`);
    const rr = rrule(t.repeat);
    if (rr) lines.push(`RRULE:${rr}`);
    if (t.done) lines.push('STATUS:CANCELLED');
    if (!t.done && Number.isFinite(t.reminder)) {
      // Triggers are relative to DTSTART; all-day events start at midnight
      // while the app anchors their reminders to 09:00 — shift to match.
      const min = (t.dueTime ? 0 : 540) - t.reminder;
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeText(t.title)}`);
      lines.push(`TRIGGER:${min === 0 ? 'PT0S' : min > 0 ? `PT${min}M` : `-PT${-min}M`}`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
