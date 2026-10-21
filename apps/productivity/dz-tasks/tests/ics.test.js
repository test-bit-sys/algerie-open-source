import { describe, it, expect } from 'vitest';
import { buildICS, escapeText, foldLine } from '../src/lib/ics.js';

const NOW = new Date(Date.UTC(2026, 7, 4, 12, 0, 0));

function makeTask(extra = {}) {
  return {
    id: 't1',
    title: 'Renew passport',
    notes: '',
    due: '2026-08-10',
    dueTime: null,
    priority: 0,
    subtasks: [],
    repeat: null,
    done: false,
    ...extra,
  };
}

describe('escaping and folding', () => {
  it('escapes RFC 5545 special characters', () => {
    expect(escapeText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
    expect(escapeText('line1\nline2')).toBe('line1\\nline2');
  });

  it('escapes every line-break flavor, including a lone CR', () => {
    expect(escapeText('a\r\nb')).toBe('a\\nb');
    expect(escapeText('a\rb')).toBe('a\\nb'); // raw CR would split the content line
    expect(escapeText('x\rSUMMARY:injected')).not.toContain('\r');
  });

  it('folds long lines with a leading space on continuations', () => {
    const folded = foldLine('X'.repeat(200));
    const lines = folded.split('\r\n');
    expect(lines[0]).toHaveLength(74);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(lines.join('').replaceAll(' ', '')).toBe('X'.repeat(200));
  });

  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:hi')).toBe('SUMMARY:hi');
  });

  it('folds by UTF-8 octets, never splitting a multi-byte character', () => {
    const enc = new TextEncoder();
    for (const s of ['Ä'.repeat(100), 'こんにちは'.repeat(30), 'a' + '€'.repeat(60)]) {
      const folded = foldLine(`SUMMARY:${s}`);
      for (const line of folded.split('\r\n')) {
        expect(enc.encode(line).length).toBeLessThanOrEqual(74);
      }
      // Unfolding (strip CRLF + one leading space) restores the original.
      expect(folded.replaceAll('\r\n ', '')).toBe(`SUMMARY:${s}`);
    }
  });
});

describe('buildICS', () => {
  it('produces a well-formed calendar with an all-day event', () => {
    const ics = buildICS([makeTask()], { now: NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260810');
    expect(ics).toContain('DTEND;VALUE=DATE:20260811'); // exclusive end
    expect(ics).toContain('SUMMARY:Renew passport');
    expect(ics).toContain('DTSTAMP:20260804T120000Z');
    expect(ics).toContain('UID:t1@tasks.puter');
  });

  it('renders timed tasks as one-hour blocks in floating local time', () => {
    const ics = buildICS([makeTask({ dueTime: '17:30' })], { now: NOW });
    expect(ics).toContain('DTSTART:20260810T173000');
    expect(ics).toContain('DTEND:20260810T183000');
  });

  it('keeps DTEND after DTSTART for late-day times (rolls past midnight)', () => {
    const late = buildICS([makeTask({ dueTime: '23:30' })], { now: NOW });
    expect(late).toContain('DTSTART:20260810T233000');
    expect(late).toContain('DTEND:20260811T003000'); // full hour, next day

    // 23:59 must not collapse to a zero-length event (DTEND == DTSTART).
    const lastMinute = buildICS([makeTask({ dueTime: '23:59' })], { now: NOW });
    expect(lastMinute).toContain('DTSTART:20260810T235900');
    expect(lastMinute).toContain('DTEND:20260811T005900');
  });

  it('maps priorities to the iCal 1..9 scale', () => {
    const high = buildICS([makeTask({ priority: 3 })], { now: NOW });
    const low = buildICS([makeTask({ priority: 1 })], { now: NOW });
    const none = buildICS([makeTask({ priority: 0 })], { now: NOW });
    expect(high).toContain('PRIORITY:1');
    expect(low).toContain('PRIORITY:9');
    expect(none).not.toContain('PRIORITY:');
  });

  it('exports due-date repeat rules as RRULE', () => {
    const weekly = buildICS([makeTask({
      repeat: { freq: 'weekly', interval: 2, weekdays: [1, 5], mode: 'due' },
    })], { now: NOW });
    expect(weekly).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR');

    const daily = buildICS([makeTask({ repeat: { freq: 'daily', interval: 1, mode: 'due' } })], { now: NOW });
    expect(daily).toContain('RRULE:FREQ=DAILY\r\n');
  });

  it('exports the monthly anchor day so clamped DTSTARTs expand correctly', () => {
    const ics = buildICS([makeTask({
      due: '2027-02-28', // the clamped occurrence of "every month on the 31st"
      repeat: { freq: 'monthly', interval: 1, mode: 'due', day: 31 },
    })], { now: NOW });
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=31');
  });

  it('omits RRULE for after-completion rules (next date is unknowable)', () => {
    const ics = buildICS([makeTask({ repeat: { freq: 'daily', interval: 1, mode: 'done' } })], { now: NOW });
    expect(ics).not.toContain('RRULE');
  });

  it('skips undated tasks and includes list and subtasks in the description', () => {
    const ics = buildICS([
      makeTask({ due: null }),
      makeTask({
        id: 't2',
        notes: 'Bring documents',
        subtasks: [{ id: 's1', title: 'Book appointment', done: true }],
      }),
    ], { now: NOW, listNameOf: () => 'Personal' });
    const events = ics.split('BEGIN:VEVENT').length - 1;
    expect(events).toBe(1);
    expect(ics).toContain('List: Personal');
    expect(ics).toContain('[x] Book appointment');
  });

  it('emits a VALARM matching the app fire time', () => {
    // Timed: trigger is the offset before DTSTART.
    const timed = buildICS([makeTask({ dueTime: '14:30', reminder: 60 })], { now: NOW });
    expect(timed).toContain('BEGIN:VALARM');
    expect(timed).toContain('TRIGGER:-PT60M');

    // At due time exactly.
    const zero = buildICS([makeTask({ dueTime: '14:30', reminder: 0 })], { now: NOW });
    expect(zero).toContain('TRIGGER:PT0S');

    // All-day: the app anchors to 09:00, DTSTART is midnight → +9h shift.
    const allday = buildICS([makeTask({ reminder: 0 })], { now: NOW });
    expect(allday).toContain('TRIGGER:PT540M');
    const dayBefore = buildICS([makeTask({ reminder: 1440 })], { now: NOW });
    expect(dayBefore).toContain('TRIGGER:-PT900M');
  });

  it('omits VALARM without a reminder or when done', () => {
    expect(buildICS([makeTask()], { now: NOW })).not.toContain('VALARM');
    expect(buildICS([makeTask({ reminder: 10, done: true })], { now: NOW })).not.toContain('VALARM');
  });

  it('escapes the UID so a crafted id cannot inject calendar properties', () => {
    // An id can arrive verbatim from an import file or a collab replica.
    const ics = buildICS([makeTask({ id: 'evil\r\nSUMMARY:INJECTED\r\nUID:x' })], { now: NOW });
    // Exactly one SUMMARY line (the real one); nothing injected via the id.
    expect(ics.match(/^SUMMARY:/gm)).toHaveLength(1);
    // The newlines are neutralized, keeping the id on a single UID line.
    expect(ics).toContain('UID:evil\\nSUMMARY:INJECTED\\nUID:x@tasks.puter');
  });

  it('never emits an unfolded line longer than 75 octets', () => {
    const ics = buildICS([makeTask({
      title: 'A very long task title that keeps going and going and going well past the limit',
      notes: 'notes '.repeat(50),
    })], { now: NOW });
    for (const line of ics.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });
});
