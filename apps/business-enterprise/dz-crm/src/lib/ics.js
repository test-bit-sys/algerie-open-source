/**
 * iCalendar (.ics) generation - the escape hatch that puts follow-ups in
 * the calendar the founder actually checks.
 *
 * Pure string work, no DOM: events go in as plain objects, one text blob
 * comes out. Timed events use floating local time (no timezone), which is
 * what "2pm my time" means to every calendar app that will read this.
 */

const CRLF = '\r\n';

/* A line break inside a value would end the content line and let the rest
   of that value pose as its own iCalendar property - a note or a deal name
   is not trusted input (a CSV import carries whatever the spreadsheet had).
   Breaks become the literal \n the spec asks for; the remaining control
   characters, which RFC 5545 forbids in TEXT and parsers disagree about,
   are dropped. TAB is legal whitespace and stays. */
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** RFC 5545 text escaping: backslash, semicolon, comma, and newlines. */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // A lone CR ends the line for any parser that splits on it, so it is a
    // break in its own right - not only the CRLF and LF pair.
    .replace(/\r\n|[\r\n]/g, '\\n')
    .replace(CONTROL_CHARS, '');
}

/**
 * UID carries an id, not TEXT: it has no escaping of its own, so the only
 * safe thing to do with a control character in one is drop it. Ids come
 * from crypto.randomUUID() here, but an imported file supplies its own.
 */
const safeIdentifier = (value) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, '');

/**
 * Content lines wrap at 75 octets; continuations start with a space. The
 * limit is octets, not characters - "café" is five octets in UTF-8 - and a
 * break must never land inside a code point, or an emoji straddling the
 * boundary decodes as two replacement characters in the calendar app.
 */
export function foldLine(line) {
  const octets = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
  const parts = [];
  let part = '';
  let size = 0;
  for (const ch of line) {              // by code point, never half a pair
    const n = octets(ch.codePointAt(0));
    if (size + n > 75) {
      parts.push(part);
      part = ' ';
      size = 1;
    }
    part += ch;
    size += n;
  }
  parts.push(part);
  return parts.join(CRLF);
}

const compactDate = (iso) => String(iso).replace(/-/g, '');
const compactTime = (hhmm) => `${String(hhmm).replace(':', '')}00`;

/** YYYY-MM-DD plus n days, without going through Date parsing quirks. */
function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(y, m - 1, d + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

function stamp(now = new Date()) {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    + `${String(now.getUTCDate()).padStart(2, '0')}T`
    + `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`
    + `${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
}

/**
 * One VEVENT.
 *   { uid, summary, description?, date, time?, minutes?, alarm? }
 * With no `time` the event is all-day (DTEND is the next day, per spec).
 */
export function buildEvent(event, now = new Date()) {
  const lines = ['BEGIN:VEVENT', `UID:${safeIdentifier(event.uid)}`, `DTSTAMP:${stamp(now)}`];

  if (event.time) {
    const [h, m] = event.time.split(':').map(Number);
    const endMinutes = h * 60 + m + (event.minutes || 30);
    const end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
    // Past midnight the end rolls into the next day.
    const endDate = endMinutes >= 1440 ? shiftDate(event.date, 1) : event.date;
    lines.push(`DTSTART:${compactDate(event.date)}T${compactTime(event.time)}`);
    lines.push(`DTEND:${compactDate(endDate)}T${compactTime(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(shiftDate(event.date, 1))}`);
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.alarm && event.time) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(event.summary)}`, 'TRIGGER:-PT30M', 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

/** A complete calendar around one or more events. */
export function buildCalendar(events, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sales CRM//Puter//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap((e) => buildEvent(e, now)),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

/** A follow-up as a calendar event: timed if it has a due time, else all-day. */
export function taskEvent(task, { contactName = '', dealName = '' } = {}) {
  const context = [contactName, dealName].filter(Boolean).join(' · ');
  return {
    uid: `crm-task-${task.id}@sales-crm.puter`,
    summary: `Follow up: ${task.title}`,
    description: context ? `${context}\nFrom your Sales CRM.` : 'From your Sales CRM.',
    date: task.due,
    time: task.dueTime || '',
    minutes: 30,
    alarm: true,
  };
}

/** An open deal's expected close, as an all-day marker. */
export function dealEvent(deal, { companyName = '', value = '' } = {}) {
  const parts = [value, companyName].filter(Boolean).join(' · ');
  return {
    uid: `crm-deal-${deal.id}@sales-crm.puter`,
    summary: `Expected close: ${deal.name}`,
    description: parts ? `${parts}\nFrom your Sales CRM.` : 'From your Sales CRM.',
    date: deal.expectedClose,
  };
}
