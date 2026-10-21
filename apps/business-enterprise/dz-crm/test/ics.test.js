import { describe, it, expect } from 'vitest';
import {
  escapeText, foldLine, buildEvent, buildCalendar, taskEvent, dealEvent,
} from '../src/lib/ics.js';

const now = new Date(Date.UTC(2026, 7, 4, 9, 30, 0));
const lines = (text) => text.split('\r\n');

describe('escaping and folding', () => {
  it('escapes the characters iCalendar reserves', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(escapeText(null)).toBe('');
  });

  it('folds long lines with a leading space on continuations', () => {
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`).split('\r\n');
    expect(folded[0]).toHaveLength(75);
    expect(folded.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(folded.join('').replace(/ /g, '').length).toBe(208);
  });

  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:hi')).toBe('SUMMARY:hi');
  });

  it('escapes a lone carriage return, and drops the other control chars', () => {
    // A parser that splits on CR would read everything after it as a new
    // property; \n is the escape the spec asks for either way.
    expect(escapeText('a\rb')).toBe('a\\nb');
    expect(escapeText('a\r\nb')).toBe('a\\nb');
    expect(escapeText('a\x01b\x7fc')).toBe('abc');
    expect(escapeText('keeps\ttabs')).toBe('keeps\ttabs');
  });

  it('folds on octets, never through the middle of a code point', () => {
    // 74 ASCII octets, then an emoji (4 octets) that must move whole to the
    // continuation - slicing by characters would cut its surrogate pair.
    const folded = foldLine(`SUMMARY:${'x'.repeat(66)}🎉🎉`).split('\r\n');
    const octets = (s) => new TextEncoder().encode(s).length;
    expect(folded.every((l) => octets(l) <= 75)).toBe(true);
    expect(folded.join('').replace(/ /g, '')).toBe(`SUMMARY:${'x'.repeat(66)}🎉🎉`);
    // Accented text counts its real UTF-8 weight too.
    const accents = foldLine(`SUMMARY:${'é'.repeat(80)}`).split('\r\n');
    expect(accents.every((l) => octets(l) <= 75)).toBe(true);
  });
});

describe('events', () => {
  it('writes an all-day event that ends the next day', () => {
    const out = buildEvent({ uid: 'u1', summary: 'Close', date: '2026-08-31' }, now);
    expect(out).toContain('DTSTART;VALUE=DATE:20260831');
    expect(out).toContain('DTEND;VALUE=DATE:20260901');
    expect(out).not.toContain('BEGIN:VALARM');
  });

  it('writes a timed event in floating local time with an alarm', () => {
    const out = buildEvent({
      uid: 'u2', summary: 'Call Mei', date: '2026-08-04', time: '14:00', alarm: true,
    }, now);
    expect(out).toContain('DTSTART:20260804T140000');
    expect(out).toContain('DTEND:20260804T143000');
    expect(out).toContain('TRIGGER:-PT30M');
  });

  it('rolls a late event into the next day', () => {
    const out = buildEvent({ uid: 'u3', summary: 'Late', date: '2026-08-04', time: '23:45' }, now);
    expect(out).toContain('DTEND:20260805T001500');
  });

  it('wraps events in a calendar with CRLF line endings', () => {
    const text = buildCalendar([{ uid: 'u1', summary: 'A', date: '2026-08-04' }], now);
    expect(lines(text)[0]).toBe('BEGIN:VCALENDAR');
    expect(text).toContain('PRODID:-//Sales CRM//Puter//EN');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('DTSTAMP:20260804T093000Z');
  });
});

describe('record → event', () => {
  it('turns a follow-up into a timed or all-day event', () => {
    const timed = taskEvent({ id: 't1', title: 'Send proposal', due: '2026-08-10', dueTime: '09:15' },
      { contactName: 'Mei', dealName: 'Acme deal' });
    expect(timed).toMatchObject({ time: '09:15', date: '2026-08-10', alarm: true });
    expect(timed.summary).toBe('Follow up: Send proposal');
    expect(timed.description).toContain('Mei · Acme deal');

    const allDay = taskEvent({ id: 't2', title: 'Ping', due: '2026-08-10', dueTime: '' });
    expect(allDay.time).toBe('');
  });

  it('turns a deal close date into an all-day marker', () => {
    const e = dealEvent({ id: 'd1', name: 'Acme', expectedClose: '2026-09-01' },
      { companyName: 'Acme Inc', value: '$5,000' });
    expect(e).toMatchObject({ date: '2026-09-01', summary: 'Expected close: Acme' });
    expect(e.time).toBeUndefined();
    expect(e.description).toContain('$5,000 · Acme Inc');
  });

  it('cannot be talked into a second event by a record id', () => {
    // Ids survive a JSON import verbatim (they have to - other records
    // point at them), so a hostile file can put line breaks in one. UID
    // has no escaping of its own, so the breaks have to go.
    const text = buildCalendar([taskEvent({
      id: 'x\r\nBEGIN:VEVENT\r\nUID:evil\r\nSUMMARY:Wire the funds\r\nEND:VEVENT\r\nX-J:',
      title: 'Real task', due: '2026-08-10', dueTime: '',
    })], now);
    // Unfold first, the way a calendar parser does, or the check is a lie.
    const rows = text.replace(/\r\n /g, '').split('\r\n');
    expect(rows.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(rows.filter((l) => l === 'END:VEVENT')).toHaveLength(1);
    expect(rows).not.toContain('SUMMARY:Wire the funds');
  });

  it('keeps a line break in a title from ending the line', () => {
    const text = buildCalendar([dealEvent({
      id: 'd1', name: 'Acme\rURL:https://evil.example', expectedClose: '2026-09-01',
    })], now);
    const rows = text.replace(/\r\n /g, '').split('\r\n');
    expect(rows.some((l) => l.startsWith('URL:'))).toBe(false);
    expect(text).toContain('SUMMARY:Expected close: Acme\\nURL:https://evil.example');
  });

  it('produces a calendar a parser can walk', () => {
    const text = buildCalendar([
      taskEvent({ id: 't1', title: 'A; with, chars', due: '2026-08-10', dueTime: '10:00' }),
      dealEvent({ id: 'd1', name: 'B', expectedClose: '2026-08-20' }),
    ], now);
    const rows = lines(text);
    expect(rows.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(rows.filter((l) => l === 'END:VEVENT')).toHaveLength(2);
    expect(text).toContain('SUMMARY:Follow up: A\\; with\\, chars');
  });
});
