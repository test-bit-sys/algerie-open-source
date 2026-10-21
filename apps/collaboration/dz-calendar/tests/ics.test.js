import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toICS, parseICS } from '../src/js/ics.js';
import { normalizeEvent, createStore } from '../src/js/store.js';
import { expandOccurrences } from '../src/js/recurrence.js';

const H = 3_600_000;

function makeKv() {
  const map = new Map();
  const re = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return {
    // Mirrors puter.kv.set's two forms: (key, value) or a batch array of
    // { key, value } items (importEvents batches its writes).
    set: async (k, v) => {
      const items = Array.isArray(k) ? k : [{ key: k, value: v }];
      for (const it of items) map.set(it.key, JSON.parse(JSON.stringify(it.value)));
      return true;
    },
    get: async (k) => (map.has(k) ? map.get(k) : null),
    del: async (k) => (map.delete(k), true),
    list: async (pattern, rv) => {
      let keys = [...map.keys()];
      if (typeof pattern === 'string') keys = keys.filter((k) => re(pattern).test(k));
      else if (pattern === true) rv = true;
      return rv ? keys.map((k) => ({ key: k, value: map.get(k) })) : keys;
    },
  };
}

describe('toICS / parseICS', () => {
  it('wraps events in a VCALENDAR envelope', () => {
    const ev = normalizeEvent({ title: 'Solo', start: new Date(2026, 6, 13, 9).getTime(), end: new Date(2026, 6, 13, 10).getTime() });
    const ics = toICS([ev]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Solo');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('emits TZID, SEQUENCE, and a UTC UNTIL for mailed invitations', () => {
    const start = new Date(2026, 6, 13, 9).getTime();
    const ev = normalizeEvent({
      id: 'e1',
      title: 'Standup',
      start,
      end: start + H,
      recurrence: {
        freq: 'weekly',
        interval: 1,
        byWeekday: [new Date(start).getDay()],
        until: start + 14 * 24 * H,
      },
      exdates: [start + 7 * 24 * H],
    });
    const ics = toICS([ev], { method: 'REQUEST', tzid: 'America/Los_Angeles', sequence: 7 });
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('SEQUENCE:7');
    expect(ics).toContain('DTSTART;TZID=America/Los_Angeles:20260713T090000');
    expect(ics).toContain('DTEND;TZID=America/Los_Angeles:20260713T100000');
    expect(ics).toContain('EXDATE;TZID=America/Los_Angeles:20260720T090000');
    // RFC 5545: a zoned DTSTART requires its UNTIL in UTC.
    expect(ics).toMatch(/UNTIL=\d{8}T\d{6}Z/);

    // A downloaded file is untouched: floating times, no revision counter.
    const plain = toICS([ev]);
    expect(plain).toContain('DTSTART:20260713T090000');
    expect(plain).not.toContain('TZID');
    expect(plain).not.toContain('SEQUENCE');
    expect(plain).toMatch(/UNTIL=\d{8}T\d{6}(?!Z)/);
  });

  it('drops a TZID that could not be a zone name rather than corrupt the line', () => {
    const start = new Date(2026, 6, 13, 9).getTime();
    const ev = normalizeEvent({ title: 'Solo', start, end: start + H });
    const ics = toICS([ev], { tzid: 'bad;zone\r\nX-INJECTED:1' });
    expect(ics).toContain('DTSTART:20260713T090000');
    expect(ics).not.toContain('TZID');
    expect(ics).not.toContain('X-INJECTED');
  });

  it.each([false, true])('cancels only the original slot of a moved occurrence (allDay=%s)', (allDay) => {
    const start = new Date(2026, 6, 13, allDay ? 0 : 9).getTime();
    const recurrenceId = start + 7 * 24 * H;
    const moved = new Date(2026, 6, 21, allDay ? 11 : 0).getTime();
    const master = normalizeEvent({
      id: 'series', title: 'Standup', start,
      end: allDay ? start + 24 * H - 1 : start + H,
      allDay,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      overrides: {
        [recurrenceId]: { title: 'Moved standup', start: moved, end: moved + H, allDay: !allDay },
      },
      exdates: [start + 14 * 24 * H],
    });
    const ics = toICS([master], {
      method: 'CANCEL', status: 'CANCELLED', sequence: 9,
      tzid: 'America/Los_Angeles', recurrenceId,
    });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('UID:series@calendar.puter.com');
    expect(ics).toContain(allDay
      ? 'RECURRENCE-ID;VALUE=DATE:20260720'
      : 'RECURRENCE-ID;TZID=America/Los_Angeles:20260720T090000');
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:9');
    expect(ics).toContain('SUMMARY:Moved standup');
    expect(ics).not.toMatch(/RRULE|EXDATE|RANGE=/);
    expect(ics).toContain(allDay
      ? 'DTSTART;TZID=America/Los_Angeles:20260721T110000'
      : 'DTSTART;VALUE=DATE:20260721');
  });

  it('refuses an invalid occurrence instead of exporting a whole-series cancellation', () => {
    const ev = normalizeEvent({ title: 'Solo', start: Date.now(), end: Date.now() + H });
    expect(() => toICS([ev], { method: 'CANCEL', recurrenceId: ev.start })).toThrow();
  });

  it('writes STATUS on every VEVENT of a mailed cancellation, and never otherwise', () => {
    const start = new Date(2026, 6, 13, 9).getTime();
    const override = start + 7 * 24 * H;
    const ev = normalizeEvent({
      id: 'e1',
      title: 'Standup',
      start,
      end: start + H,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [new Date(start).getDay()] },
      overrides: { [override]: { title: 'Moved standup' } },
    });
    const ics = toICS([ev], { method: 'CANCEL', status: 'CANCELLED', sequence: 9 });
    expect(ics).toContain('METHOD:CANCEL');
    // The master and its override both carry it: a client that indexes the
    // override VEVENT separately must also see that one retracted.
    expect(ics.match(/^STATUS:CANCELLED\r$/gm)).toHaveLength(2);

    expect(toICS([ev])).not.toContain('STATUS');
    // A STATUS that could not be one is dropped rather than corrupt the file.
    expect(toICS([ev], { status: 'BAD\r\nX-INJECTED:1' })).not.toContain('X-INJECTED');
  });

  it('round-trips a timed event', () => {
    const start = new Date(2026, 6, 13, 9, 30).getTime();
    const end = new Date(2026, 6, 13, 10, 45).getTime();
    const ev = normalizeEvent({ title: 'Standup', location: 'Zoom', description: 'Line 1\nLine 2', start, end });
    const [back] = parseICS(toICS([ev]));
    expect(back.title).toBe('Standup');
    expect(back.location).toBe('Zoom');
    expect(back.description).toBe('Line 1\nLine 2');
    expect(back.allDay).toBe(false);
    expect(back.start).toBe(start);
    expect(back.end).toBe(end);
  });

  it('escapes and restores special characters', () => {
    const ev = normalizeEvent({
      title: 'Meet; plan, review \\ notes',
      start: new Date(2026, 6, 13, 9).getTime(),
      end: new Date(2026, 6, 13, 10).getTime(),
    });
    const [back] = parseICS(toICS([ev]));
    expect(back.title).toBe('Meet; plan, review \\ notes');
  });

  it('round-trips an all-day event with an exclusive DTEND', () => {
    const start = new Date(2026, 6, 16).getTime();
    const ev = normalizeEvent({ title: 'Holiday', start, end: start, allDay: true });
    const ics = toICS([ev]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260716');
    expect(ics).toContain('DTEND;VALUE=DATE:20260717'); // exclusive: next day
    const [back] = parseICS(ics);
    expect(back.allDay).toBe(true);
    expect(new Date(back.start).getDate()).toBe(16);
    // End clamps back to the covered day.
    expect(new Date(back.end).getDate()).toBe(16);
  });

  it('imports a DATE-TIME carrying a TZID as the correct instant', () => {
    // 09:00 in New York on 2026-07-13 (EDT, UTC-4) is 13:00 UTC.
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:tz-1',
      'DTSTART;TZID=America/New_York:20260713T090000',
      'DTEND;TZID=America/New_York:20260713T103000',
      'SUMMARY:Zoned',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [back] = parseICS(ics);
    expect(back.start).toBe(Date.UTC(2026, 6, 13, 13, 0, 0));
    expect(back.end).toBe(Date.UTC(2026, 6, 13, 14, 30, 0));
    expect(back.allDay).toBe(false);
  });

  it('imports a quoted TZID containing a colon instead of dropping the event', () => {
    // Windows/Outlook exports quote the TZID and its value carries a COLON, e.g.
    // "(UTC-05:00) Eastern Time". Splitting the content line on the first raw ':'
    // cuts inside the quotes, so DTSTART/DTEND parsed to NaN and the whole event
    // was silently dropped on import. The value delimiter is the first UNQUOTED
    // colon. The Windows zone isn't a valid IANA id, so it falls back to floating
    // local time (this module's documented behavior for an unknown zone).
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:win-1',
      'DTSTART;TZID="(UTC-05:00) Eastern Time (US & Canada)":20260713T090000',
      'DTEND;TZID="(UTC-05:00) Eastern Time (US & Canada)":20260713T100000',
      'SUMMARY:Meeting',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = parseICS(ics);
    expect(parsed).toHaveLength(1);
    const [back] = parsed;
    expect(Number.isFinite(back.start)).toBe(true);
    expect(Number.isFinite(back.end)).toBe(true);
    expect(back.start).toBe(new Date(2026, 6, 13, 9, 0).getTime());
    expect(back.end).toBe(new Date(2026, 6, 13, 10, 0).getTime());
    expect(back.title).toBe('Meeting');
  });

  it('treats a lowercase z suffix as UTC (not floating local)', () => {
    // 'Z' is the RFC 5545 UTC designator; a non-conformant lowercase 'z' must
    // not be read as floating local time, which would shift the instant.
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:z-1',
      'DTSTART:20260713T090000z',
      'DTEND:20260713T100000z',
      'SUMMARY:Lowercase Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [back] = parseICS(ics);
    expect(back.start).toBe(Date.UTC(2026, 6, 13, 9, 0, 0));
    expect(back.end).toBe(Date.UTC(2026, 6, 13, 10, 0, 0));
  });

  it('imports DTSTART + DURATION when DTEND is absent', () => {
    const start = new Date(2026, 6, 13, 9, 0).getTime(); // floating local
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:dur-1',
      'DTSTART:20260713T090000',
      'DURATION:PT1H30M',
      'SUMMARY:Dur',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [back] = parseICS(ics);
    expect(back.start).toBe(start);
    expect(back.end).toBe(start + 90 * 60_000);
  });

  it('does not let a VALARM sub-component leak into the parent event', () => {
    // Regression: Google/Apple/Outlook emit a VALARM inside the VEVENT. Its own
    // DESCRIPTION/SUMMARY/DURATION must not overwrite the event's fields.
    const start = new Date(2026, 6, 13, 9, 0).getTime();
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:alarm-1',
      'DTSTART:20260713T090000',
      'DTEND:20260713T100000',
      'SUMMARY:Dentist',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:This is an event reminder',
      'TRIGGER:-PT30M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [back] = parseICS(ics);
    expect(back.title).toBe('Dentist');
    expect(back.description).toBe(''); // not the alarm's DESCRIPTION
    expect(back.start).toBe(start);
    expect(back.end).toBe(start + 60 * 60_000); // the event's own DTEND, intact
  });

  it('keeps the event DURATION when a VALARM carries its own DURATION', () => {
    // The alarm's repeat DURATION must not become the event's length; with no
    // DTEND the event is zero-length (spec default for a DATE-TIME).
    const start = new Date(2026, 6, 13, 9, 0).getTime();
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:alarm-2',
      'DTSTART:20260713T090000',
      'SUMMARY:Call',
      'BEGIN:VALARM',
      'ACTION:AUDIO',
      'TRIGGER:-PT10M',
      'DURATION:PT5M',
      'REPEAT:3',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [back] = parseICS(ics);
    expect(back.end).toBe(start); // zero-length, not start + 5min
  });

  it('imports an all-day DTSTART + multi-day DURATION', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:dur-2',
      'DTSTART;VALUE=DATE:20260713',
      'DURATION:P3D',
      'SUMMARY:Trip',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [back] = parseICS(ics);
    expect(back.allDay).toBe(true);
    expect(new Date(back.start).getDate()).toBe(13);
    expect(new Date(back.end).getDate()).toBe(15); // 3 covered days: 13,14,15
  });

  it('bounds an all-day series UNTIL to a whole local day when it arrives as a UTC date-time', () => {
    // Regression: a non-conformant DATE-TIME/UTC UNTIL on a DATE (all-day) series
    // must bound the last COVERED calendar day, not a raw UTC instant. In a
    // positive-offset zone that instant lands on the next local day and admits one
    // extra occurrence, so pin the zone to +12 to make the bug (if any) manifest.
    const savedTZ = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:until-allday',
        'DTSTART;VALUE=DATE:20260713',
        'DTEND;VALUE=DATE:20260714',
        'SUMMARY:Daily',
        'RRULE:FREQ=DAILY;UNTIL=20260714T235959Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const [back] = parseICS(ics);
      expect(back.allDay).toBe(true);
      // The bound sits inside July 14 (the last covered day)…
      const until = new Date(back.recurrence.until);
      expect(until.getMonth()).toBe(6);
      expect(until.getDate()).toBe(14);
      // …and strictly before July 15 00:00 local, so the 15th is not generated.
      expect(back.recurrence.until).toBeLessThan(new Date(2026, 6, 15).getTime());
    } finally {
      // Restore precisely: assigning `undefined` would set TZ to "undefined" (→UTC).
      if (savedTZ === undefined) delete process.env.TZ;
      else process.env.TZ = savedTZ;
    }
  });

  it('round-trips a weekly recurrence with an exception, preserving occurrences', async () => {
    const mon = new Date(2026, 6, 13, 9, 0).getTime();
    const master = normalizeEvent({
      title: 'Weekly sync',
      start: mon,
      end: mon + H,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      exdates: [new Date(2026, 6, 20, 9, 0).getTime()], // cancel the 2nd Monday
    });

    const ics = toICS([master]);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(ics).toContain('EXDATE:20260720T090000');

    // Import into a fresh store and confirm the same occurrences show up.
    const store = createStore(makeKv());
    await store.load();
    const parsed = parseICS(ics);
    await store.importEvents(parsed);

    const occ = store
      .getEventsInRange(new Date(2026, 6, 1).getTime(), new Date(2026, 6, 31).getTime())
      .map((o) => new Date(o.start).getDate());
    expect(occ).toEqual([13, 27]); // 20 cancelled via EXDATE
  });

  it('honors WKST on import (RFC default MO), keeping week parity for INTERVAL>=2', async () => {
    const mk = (rrule) =>
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:wkst@test',
        'DTSTAMP:20260101T000000Z',
        'DTSTART:20260708T090000',
        'DTEND:20260708T100000',
        'SUMMARY:Biweekly',
        `RRULE:${rrule}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
    const datesFor = async (rrule) => {
      const store = createStore(makeKv());
      await store.load();
      await store.importEvents(parseICS(mk(rrule)));
      return store
        .getEventsInRange(new Date(2026, 6, 1).getTime(), new Date(2026, 7, 1).getTime())
        .map((o) => new Date(o.start).getDate());
    };
    // No WKST => RFC default MO: Sun Jul 12 shares Wed Jul 8's week.
    expect(await datesFor('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,SU')).toEqual([8, 12, 22, 26]);
    expect(await datesFor('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,SU;WKST=MO')).toEqual([8, 12, 22, 26]);
    // Explicit SU (what this app itself exports) keeps the Sunday anchor.
    expect(await datesFor('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,SU;WKST=SU')).toEqual([8, 19, 22]);
    // WKST without a spanning BYDAY changes nothing.
    expect(await datesFor('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;WKST=MO')).toEqual([8, 22]);
  });

  it('rotates WKST with BYDAY when a zoned DTSTART crosses to the previous local day', async () => {
    // DTSTART Mon 2026-07-13 04:00 JST = Sun 2026-07-12 19:00 UTC. In local
    // UTC the importer rotates BYDAY MO,SU -> SU,SA; the biweekly WKST anchor
    // must rotate too (MO -> SU) or the whole series lands a week off — the
    // true Google/Apple instants are Jul 12, 18, 26 (and Aug 1, 9, 15).
    const savedTZ = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:wkst-rot@test',
        'DTSTART;TZID=Asia/Tokyo:20260713T040000',
        'DTEND;TZID=Asia/Tokyo:20260713T050000',
        'SUMMARY:Standup',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=MO',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const store = createStore(makeKv());
      await store.load();
      await store.importEvents(parseICS(ics));
      const dates = store
        .getEventsInRange(new Date(2026, 6, 1).getTime(), new Date(2026, 7, 20).getTime())
        .map((o) => `${new Date(o.start).getMonth() + 1}/${new Date(o.start).getDate()}`);
      expect(dates).toEqual(['7/12', '7/18', '7/26', '8/1', '8/9', '8/15']);
    } finally {
      if (savedTZ === undefined) delete process.env.TZ;
      else process.env.TZ = savedTZ;
    }
  });

  it('round-trips an imported Monday-anchored rule as WKST=MO', () => {
    const wed = new Date(2026, 6, 8, 9, 0).getTime();
    const ev = normalizeEvent({
      title: 'Biweekly',
      start: wed,
      end: wed + H,
      recurrence: { freq: 'weekly', interval: 2, byWeekday: [0, 3], wkst: 1 },
    });
    expect(toICS([ev])).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,WE;WKST=MO');
  });

  it('imports a monthly BYDAY=-1 ("last weekday") rule and expands it correctly', async () => {
    // Feb 27 2026 is the 4th-and-last Friday: deriving nth from DTSTART would
    // read this as "4th Friday" and land a week early in five-Friday months.
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:last-fri@test',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260227T090000',
      'DTEND:20260227T100000',
      'SUMMARY:Last Friday retro',
      'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    expect(ev.recurrence).toMatchObject({ freq: 'monthly', monthlyMode: 'weekday', monthlyNth: -1 });

    const store = createStore(makeKv());
    await store.load();
    await store.importEvents([ev]);
    const occ = store
      .getEventsInRange(new Date(2026, 1, 1).getTime(), new Date(2026, 6, 1).getTime())
      .map((o) => [new Date(o.start).getMonth() + 1, new Date(o.start).getDate()]);
    // Last Fridays: Feb 27, Mar 27, Apr 24, May 29 (five Fridays), Jun 26.
    expect(occ).toEqual([
      [2, 27],
      [3, 27],
      [4, 24],
      [5, 29],
      [6, 26],
    ]);
  });

  it('round-trips the monthly BYDAY ordinal, including -1', () => {
    const lastFri = new Date(2026, 1, 27, 9, 0).getTime(); // Fri Feb 27 2026 (4th and last)
    const ev = normalizeEvent({
      title: 'Retro',
      start: lastFri,
      end: lastFri + H,
      recurrence: { freq: 'monthly', interval: 1, monthlyMode: 'weekday', monthlyNth: -1 },
    });
    const ics = toICS([ev]);
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYDAY=-1FR');
    const [back] = parseICS(ics);
    expect(back.recurrence).toMatchObject({ monthlyMode: 'weekday', monthlyNth: -1 });

    // A positive explicit ordinal survives too ("2TU" stays the 2nd Tuesday).
    const secondTue = new Date(2026, 6, 14, 9, 0).getTime(); // Tue Jul 14 2026 (2nd)
    const ev2 = normalizeEvent({
      title: 'Board',
      start: secondTue,
      end: secondTue + H,
      recurrence: { freq: 'monthly', interval: 1, monthlyMode: 'weekday' },
    });
    const ics2 = toICS([ev2]);
    expect(ics2).toContain('BYDAY=2TU');
    const [back2] = parseICS(ics2);
    expect(back2.recurrence).toMatchObject({ monthlyMode: 'weekday', monthlyNth: 2 });
  });

  it('reads the ordinal from BYSETPOS when BYDAY carries none (Outlook form)', async () => {
    // Outlook/Exchange write "last Friday" as BYDAY=FR;BYSETPOS=-1. Ignoring
    // BYSETPOS derives "4th Friday" from DTSTART — a week early in every
    // five-Friday month (May 22 instead of May 29 below).
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:outlook-last-fri@test',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260227T090000',
      'DTEND:20260227T100000',
      'SUMMARY:Last Friday retro',
      'RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    expect(ev.recurrence).toMatchObject({ freq: 'monthly', monthlyMode: 'weekday', monthlyNth: -1 });

    const store = createStore(makeKv());
    await store.load();
    await store.importEvents([ev]);
    const occ = store
      .getEventsInRange(new Date(2026, 4, 1).getTime(), new Date(2026, 5, 1).getTime())
      .map((o) => [new Date(o.start).getMonth() + 1, new Date(o.start).getDate()]);
    expect(occ).toEqual([[5, 29]]); // the LAST Friday of five, not the 4th

    // An explicit BYDAY ordinal still wins over a (contradictory) BYSETPOS.
    const [ev2] = parseICS(ics.replace('BYDAY=FR;BYSETPOS=-1', 'BYDAY=2FR;BYSETPOS=-1'));
    expect(ev2.recurrence.monthlyNth).toBe(2);
  });

  it('imports a monthly BYDAY ordinal the engine cannot represent (-2 and below) as a one-off', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:penultimate@test',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260220T090000',
      'DTEND:20260220T100000',
      'SUMMARY:Penultimate Friday',
      'RRULE:FREQ=MONTHLY;BYDAY=-2FR',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    // Deriving the nth from DTSTART (the old fallback) made this "the third
    // Friday" — a different series than the file describes. The honest
    // reading of a rule the engine can't hold is a one-off on its DTSTART.
    expect(ev.recurrence).toBeUndefined();
    expect(new Date(ev.start).getDate()).toBe(20);
  });

  it('emits WKST=SU for an every-N-weeks rule so other calendars keep the anchor', async () => {
    // The engine anchors weeks on Sunday; RFC 5545 defaults WKST to MO, which
    // changes the dates a conformant reader computes for INTERVAL>1 + a BYDAY
    // spanning the Sun/Mon boundary. Export must pin WKST=SU.
    const sun = new Date(2026, 6, 5, 9, 0).getTime(); // Sun Jul 5 2026
    const biweekly = normalizeEvent({
      title: 'Biweekly',
      start: sun,
      end: sun + H,
      recurrence: { freq: 'weekly', interval: 2, byWeekday: [0, 3] }, // Sun + Wed
    });
    expect(toICS([biweekly])).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,WE;WKST=SU');

    // Weekly with interval 1 needs no WKST (the week boundary can't change which
    // week each day lands in), so the common case stays minimal.
    const weekly = normalizeEvent({
      title: 'Weekly',
      start: sun,
      end: sun + H,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
    });
    expect(toICS([weekly])).not.toContain('WKST');

    // Round-trip still yields this app's own dates (import always anchors Sunday).
    const store = createStore(makeKv());
    await store.load();
    await store.importEvents(parseICS(toICS([biweekly])));
    const occ = store
      .getEventsInRange(new Date(2026, 6, 1).getTime(), new Date(2026, 7, 1).getTime())
      .map((o) => new Date(o.start).getDate());
    expect(occ).toEqual([5, 8, 19, 22]);
  });

  it('round-trips a per-occurrence override via RECURRENCE-ID', async () => {
    const mon = new Date(2026, 6, 13, 9, 0).getTime();
    const rid = new Date(2026, 6, 20, 9, 0).getTime();
    const moved = new Date(2026, 6, 20, 14, 0).getTime();
    const master = normalizeEvent({
      title: 'Weekly sync',
      start: mon,
      end: mon + H,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      overrides: { [rid]: { title: 'Moved sync', start: moved, end: moved + H } },
    });

    const ics = toICS([master]);
    expect(ics).toContain('RECURRENCE-ID:20260720T090000');

    const store = createStore(makeKv());
    await store.load();
    await store.importEvents(parseICS(ics));

    const occ = store.getEventsInRange(new Date(2026, 6, 1).getTime(), new Date(2026, 6, 31).getTime());
    const moved20 = occ.find((o) => new Date(o.start).getHours() === 14);
    expect(moved20).toBeTruthy();
    expect(moved20.title).toBe('Moved sync');
  });

  it('keeps a timed series RECURRENCE-ID timed even when the override flips all-day', async () => {
    // A per-occurrence override that turns a timed occurrence into an all-day one
    // must still identify its ORIGINAL slot by the master's timed schedule. If
    // RECURRENCE-ID collapsed to a bare DATE (midnight) the id would no longer
    // match the 09:00 scheduled slot and the override would detach on re-import.
    const mon = new Date(2026, 6, 13, 9, 0).getTime();
    const rid = new Date(2026, 6, 20, 9, 0).getTime();
    const master = normalizeEvent({
      title: 'Weekly sync',
      start: mon,
      end: mon + H,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      overrides: {
        [rid]: {
          title: 'All-day sync',
          allDay: true,
          start: new Date(2026, 6, 20).getTime(),
          end: new Date(2026, 6, 20, 23, 59, 59, 999).getTime(),
        },
      },
    });

    const ics = toICS([master]);
    // RECURRENCE-ID stays timed (master's schedule); the override's own DTSTART is a DATE.
    expect(ics).toContain('RECURRENCE-ID:20260720T090000');

    const store = createStore(makeKv());
    await store.load();
    await store.importEvents(parseICS(ics));

    const occ = store.getEventsInRange(new Date(2026, 6, 1).getTime(), new Date(2026, 6, 31).getTime());
    const special = occ.find((o) => o.title === 'All-day sync');
    expect(special).toBeTruthy();
    expect(special.allDay).toBe(true);
    // The override replaced its occurrence rather than detaching into a standalone
    // event: still exactly the three July Mondays on/after the series start (13, 20, 27).
    expect(occ.filter((o) => o.seriesId).length).toBe(3);
  });

  it('parses COUNT and INTERVAL from an RRULE', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x@example.com',
      'DTSTART:20260713T090000',
      'DTEND:20260713T100000',
      'SUMMARY:Every other day',
      'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    expect(ev.recurrence).toMatchObject({ freq: 'daily', interval: 2, count: 5 });
  });

  it('defaults a timed VEVENT with no DTEND to zero duration (not undefined)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:noend@example.com',
      'DTSTART:20260713T090000',
      'SUMMARY:No end',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    expect(ev.end).toBe(ev.start);
    // And it normalizes to a valid positive-duration event on import.
    expect(normalizeEvent(ev).end).toBeGreaterThan(normalizeEvent(ev).start);
  });

  it('unfolds folded content lines', () => {
    const longTitle = 'A'.repeat(120);
    const ev = normalizeEvent({ title: longTitle, start: new Date(2026, 6, 13, 9).getTime(), end: new Date(2026, 6, 13, 10).getTime() });
    const ics = toICS([ev]);
    // The SUMMARY line must have been folded (contains a CRLF + space).
    expect(ics).toMatch(/\r\n /);
    const [back] = parseICS(ics);
    expect(back.title).toBe(longTitle);
  });

  it('preserves a lone carriage return in text instead of truncating it', () => {
    // A bare CR must be escaped like a line break; otherwise unfold splits on it
    // and the tail ("Beta") is dropped as a line with no ':'.
    const ev = normalizeEvent({ title: 'Alpha\rBeta', start: new Date(2026, 0, 5, 9).getTime(), end: new Date(2026, 0, 5, 10).getTime() });
    const [back] = parseICS(toICS([ev]));
    expect(back.title).toBe('Alpha\nBeta');
  });

  it('keeps every orphaned RECURRENCE-ID override when the master is missing', () => {
    // Two overrides share a UID but there is no master VEVENT. Neither can attach
    // to a series, so both must survive as standalone events (not just the first).
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:series@x', 'RECURRENCE-ID:20260720T090000', 'DTSTART:20260720T140000', 'DTEND:20260720T150000', 'SUMMARY:Moved A', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:series@x', 'RECURRENCE-ID:20260727T090000', 'DTSTART:20260727T160000', 'DTEND:20260727T170000', 'SUMMARY:Moved B', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const titles = parseICS(ics).map((e) => e.title).sort();
    expect(titles).toEqual(['Moved A', 'Moved B']);
  });

  it('does not split a multi-byte character across a fold boundary', () => {
    // Position an emoji (a UTF-16 surrogate pair) right at the 75-octet fold
    // point. A naive slice would cut it in half; once UTF-8 encoded for the
    // download Blob the lone surrogates corrupt to U+FFFD.
    const title = 'A'.repeat(66) + '🎉' + 'B'.repeat(20);
    const ev = normalizeEvent({ title, start: new Date(2026, 0, 5, 9).getTime(), end: new Date(2026, 0, 5, 10).getTime() });
    const ics = toICS([ev]);
    // No lone surrogate survives in the folded output.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(ics)).toBe(false);
    // Survives a real byte-level round-trip (Blob encode → re-open).
    const bytes = new TextEncoder().encode(ics);
    const decoded = new TextDecoder('utf-8').decode(bytes);
    const [back] = parseICS(decoded);
    expect(back.title).toBe(title);
  });
});

describe('import — BYDAY in a foreign zone', () => {
  it('rotates weekly BYDAY when the DTSTART conversion crosses local midnight', () => {
    // A Tuesday 04:00 Tokyo standup. In any zone west of UTC+9 the converted
    // instant lands on the previous local calendar day, so the engine (which
    // expands byWeekday against LOCAL days) must see the rotated weekday or
    // the whole series lands a week off its true instants.
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:jp-1',
      'DTSTART;TZID=Asia/Tokyo:20260714T040000',
      'DTEND;TZID=Asia/Tokyo:20260714T043000',
      'SUMMARY:APAC standup',
      'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3',
      'EXDATE;TZID=Asia/Tokyo:20260721T040000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [ev] = parseICS(ics);
    // True instants: Jul 14/21/28 04:00 JST == Jul 13/20/27 19:00 UTC.
    const instants = [Date.UTC(2026, 6, 13, 19), Date.UTC(2026, 6, 20, 19), Date.UTC(2026, 6, 27, 19)];
    expect(ev.start).toBe(instants[0]);

    const master = normalizeEvent({ ...ev, id: 'jp-1' });
    const occ = expandOccurrences(master, Date.UTC(2026, 6, 1), Date.UTC(2026, 7, 15));
    // The middle occurrence is EXDATEd; the other two land on the TRUE instants
    // (pre-fix: everything shifted a week and the EXDATE matched nothing).
    expect(occ.map((o) => o.start)).toEqual([instants[0], instants[2]]);
  });

  it('leaves BYDAY alone for floating and same-day conversions', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:float-1',
      'DTSTART:20260713T090000',
      'DTEND:20260713T093000',
      'SUMMARY:Local standup',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    expect(ev.recurrence.byWeekday).toEqual([1]);
  });
});

describe('export — DTSTART anchored on the first scheduled occurrence', () => {
  it('advances an off-pattern weekly anchor so DTSTART is a real occurrence', () => {
    // Weekly on Tuesday anchored on a Monday (the custom dialog allows
    // deselecting the start's weekday; the app clips the Monday). RFC 5545
    // makes DTSTART always count, so exporting the Monday would hand
    // conformant readers a phantom Monday event and (with COUNT) drop the
    // real last occurrence.
    const ev = normalizeEvent({
      title: 'Tue sync',
      start: new Date(2026, 6, 13, 9, 0).getTime(), // Mon Jul 13
      end: new Date(2026, 6, 13, 9, 30).getTime(),
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [2], count: 3 },
    });
    const ics = toICS([ev]);
    expect(ics).toContain('DTSTART:20260714T090000'); // first Tuesday
    expect(ics).toContain('DTEND:20260714T093000'); // duration carried
    expect(ics).toContain('BYDAY=TU');
    expect(ics).toContain('COUNT=3');
  });

  it('keeps an on-pattern anchor untouched', () => {
    const ev = normalizeEvent({
      title: 'Mon sync',
      start: new Date(2026, 6, 13, 9, 0).getTime(), // Mon Jul 13
      end: new Date(2026, 6, 13, 9, 30).getTime(),
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
    });
    expect(toICS([ev])).toContain('DTSTART:20260713T090000');
  });
});

describe('ORGANIZER / ATTENDEE round-trip', () => {
  const H = 3_600_000;
  const start = new Date(2026, 6, 20, 10, 0).getTime();

  it('exports and re-imports organizer and guests with statuses', () => {
    const ev = {
      id: 'rsvp1',
      title: 'Planning',
      start,
      end: start + H,
      allDay: false,
      organizer: { email: 'boss@corp.com', name: 'Boss' },
      guests: [
        { email: 'a@x.com', name: 'Ada Lovelace', status: 'accepted' },
        { email: 'b@x.com', status: 'tentative' },
        { email: 'c@x.com', status: 'needs-action' },
      ],
    };
    const ics = toICS([ev]);
    expect(ics).toContain('ORGANIZER;CN="Boss":mailto:boss@corp.com');
    expect(ics).toContain('PARTSTAT=ACCEPTED');
    expect(ics).toContain('RSVP=TRUE:mailto:c@x.com');

    const [back] = parseICS(ics);
    expect(back.organizer).toEqual({ email: 'boss@corp.com', name: 'Boss' });
    expect(back.guests).toEqual([
      { email: 'a@x.com', name: 'Ada Lovelace', status: 'accepted' },
      { email: 'b@x.com', status: 'tentative' },
      { email: 'c@x.com', status: 'needs-action' },
    ]);
  });

  it('a control character in a guest name cannot break the ATTENDEE line', () => {
    // Regression: cnParam stripped quotes but not CR/LF. A name with an
    // embedded newline (reachable via the JSON import path — single-line UI
    // fields can't produce one) emitted a raw line break mid-property; the
    // unterminated quote then made parsers drop the whole guest.
    const ev = {
      id: 'ctrl1',
      title: 'Planning',
      start,
      end: start + H,
      allDay: false,
      organizer: { email: 'boss@corp.com', name: 'The\nBoss' },
      guests: [{ email: 'j@x.com', name: 'Jane\r\nDoe', status: 'accepted' }],
    };
    const ics = toICS([ev]);
    expect(ics).toContain('ORGANIZER;CN="The Boss":mailto:boss@corp.com');
    expect(ics).toContain('CN="Jane Doe"');

    const [back] = parseICS(ics);
    expect(back.guests).toEqual([{ email: 'j@x.com', name: 'Jane Doe', status: 'accepted' }]);
  });

  it('parses a Google-style invite block', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'DTSTART:20260720T100000',
      'DTEND:20260720T110000',
      'UID:abc123@google.com',
      'ORGANIZER;CN=Jane Boss:mailto:jane@corp.com',
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=',
      ' TRUE;CN=Nariman;X-NUM-GUESTS=0:mailto:nj@puter.com',
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Jane B',
      ' oss:mailto:jane@corp.com',
      'SUMMARY:Q3 kickoff',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    expect(ev.title).toBe('Q3 kickoff');
    expect(ev.organizer).toEqual({ email: 'jane@corp.com', name: 'Jane Boss' });
    expect(ev.guests).toEqual([
      { email: 'nj@puter.com', name: 'Nariman', status: 'needs-action' },
      { email: 'jane@corp.com', name: 'Jane Boss', status: 'accepted' },
    ]);
  });

  it('events without guests export no ATTENDEE/ORGANIZER lines', () => {
    const ics = toICS([{ id: 'p1', title: 'Solo', start, end: start + H, allDay: false }]);
    expect(ics).not.toContain('ATTENDEE');
    expect(ics).not.toContain('ORGANIZER');
  });

  it('quoted CN params with separators survive', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260720T100000',
      'DTEND:20260720T110000',
      'UID:q1@x',
      'ATTENDEE;CN="Doe; Jane";PARTSTAT=DECLINED:mailto:jane@x.com',
      'SUMMARY:Quoting',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    expect(ev.guests).toEqual([{ email: 'jane@x.com', name: 'Doe; Jane', status: 'declined' }]);
  });
});

describe('ics — reminders as VALARM', () => {
  const start = new Date(2026, 6, 13, 9, 0).getTime();
  const event = (reminders) =>
    normalizeEvent({ id: 'r1', title: 'Dentist', start, end: start + 3_600_000, reminders });

  it('writes one DISPLAY alarm per stored offset', () => {
    const ics = toICS([event([0, 10, 60])]);
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:PT0S'); // "at the time of the event"
    expect(ics).toContain('TRIGGER:-PT10M');
    expect(ics).toContain('TRIGGER:-PT60M');
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(3);
    // Sub-components come after every property (RFC 5545 §3.6.1).
    expect(ics.indexOf('SUMMARY:')).toBeLessThan(ics.indexOf('BEGIN:VALARM'));
  });

  it('round-trips the reminders it wrote', () => {
    const [back] = parseICS(toICS([event([10, 60])]));
    expect(back.reminders).toEqual([10, 60]);
  });

  it('reads a foreign alarm without letting its text into the event', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:foreign@x',
      'DTSTART:20260713T090000',
      'DTEND:20260713T100000',
      'SUMMARY:Dentist',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:This is an event reminder',
      'TRIGGER:-PT30M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [back] = parseICS(ics);
    expect(back.reminders).toEqual([30]);
    expect(back.description).toBe('');
    expect(back.title).toBe('Dentist');
  });

  it('skips triggers it cannot express as "minutes before the start"', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:odd@x',
      'DTSTART:20260713T090000',
      'DTEND:20260713T100000',
      'SUMMARY:Odd alarms',
      // Measured from the END, not the start.
      'BEGIN:VALARM',
      'TRIGGER;RELATED=END:-PT15M',
      'END:VALARM',
      // An absolute instant, not an offset.
      'BEGIN:VALARM',
      'TRIGGER;VALUE=DATE-TIME:20260713T083000Z',
      'END:VALARM',
      // Fires AFTER the start — this app has no such offset.
      'BEGIN:VALARM',
      'TRIGGER:PT20M',
      'END:VALARM',
      // …and one it can.
      'BEGIN:VALARM',
      'TRIGGER:-PT5M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [back] = parseICS(ics);
    expect(back.reminders).toEqual([5]);
  });

  it('keeps a mailed invitation free of the host’s own alarms', () => {
    // The host's "notify me 10 minutes before" is their preference, not an
    // alarm to install in every guest's calendar.
    const invite = toICS([event([10])], { method: 'REQUEST', tzid: 'America/New_York' });
    expect(invite).not.toContain('VALARM');
    // …while a plain backup of the same event keeps them.
    expect(toICS([event([10])])).toContain('VALARM');
  });

  it('carries an occurrence exception’s own reminders', () => {
    const master = normalizeEvent({
      id: 'series',
      title: 'Standup',
      start,
      end: start + 1_800_000,
      reminders: [10],
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      overrides: { [start + 7 * 86_400_000]: { reminders: [60] } },
    });
    const ics = toICS([master]);
    expect(ics).toContain('TRIGGER:-PT10M');
    expect(ics).toContain('TRIGGER:-PT60M');
  });
});

describe('ics — an exception keeps inheriting from its series', () => {
  const start = new Date(2026, 6, 13, 9, 0).getTime(); // Mon 13 Jul 2026
  const week = 7 * 86_400_000;

  /** A weekly series whose second occurrence was only MOVED. */
  const moved = () =>
    normalizeEvent({
      id: 'series',
      title: 'Standup',
      description: 'Round the table',
      location: 'Room 4',
      start,
      end: start + 1_800_000,
      reminders: [10],
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      overrides: { [start + week]: { start: start + week + 3_600_000, end: start + week + 5_400_000 } },
    });

  it('does not pin text the exception only inherited', () => {
    const [back] = parseICS(toICS([moved()]));
    const patch = back.overrides[start + week];
    // Only the times differ, so only the times are recorded.
    expect(Object.keys(patch).sort()).toEqual(['end', 'start']);
  });

  it('so a later series-wide edit still reaches the exception', () => {
    const [back] = parseICS(toICS([moved()]));
    const restored = normalizeEvent({ ...back, id: 'series' });
    const renamed = normalizeEvent({ ...restored, title: 'Daily sync', description: 'New agenda' });
    const occ = expandOccurrences(renamed, start + week, start + week + 86_400_000)[0];
    expect(occ.title).toBe('Daily sync');
    expect(occ.description).toBe('New agenda');
    // …while what the exception really overrode is untouched.
    expect(occ.start).toBe(start + week + 3_600_000);
  });

  it('still records the fields the exception genuinely changed', () => {
    const ev = normalizeEvent({
      id: 'series',
      title: 'Standup',
      description: 'Round the table',
      start,
      end: start + 1_800_000,
      reminders: [10],
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      overrides: { [start + week]: { title: 'Retro', reminders: [60] } },
    });
    const [back] = parseICS(toICS([ev]));
    const patch = back.overrides[start + week];
    expect(patch.title).toBe('Retro');
    expect(patch.reminders).toEqual([60]);
    expect(patch.description).toBeUndefined(); // inherited, not overridden
  });
});

describe('import — cancelled events are retractions, not events', () => {
  const cal = (...vevents) =>
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//EN', ...vevents, 'END:VCALENDAR', ''].join('\r\n');
  const vevent = (uid, extra = []) =>
    ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260801T000000Z', 'DTSTART:20260910T090000', 'DTEND:20260910T100000', 'SUMMARY:Standup', ...extra, 'END:VEVENT'].join('\r\n');

  it('drops a STATUS:CANCELLED event and keeps the live ones around it', () => {
    const events = parseICS(cal(vevent('a', ['STATUS:CANCELLED']), vevent('b', ['STATUS:CONFIRMED']), vevent('c')));
    expect(events.map((e) => e.title)).toEqual(['Standup', 'Standup']);
    expect(events).toHaveLength(2);
  });

  it('adds nothing from a METHOD:CANCEL file — including the one this app mails', () => {
    // The cancellation attachment invites.js sends: METHOD:CANCEL plus
    // STATUS:CANCELLED. Importing it must not resurrect the deleted event.
    const ev = normalizeEvent({ id: 'evt-9', title: 'Offsite', start: new Date(2026, 8, 10, 9).getTime(), end: new Date(2026, 8, 10, 10).getTime() });
    const mailed = toICS([ev], { method: 'CANCEL', status: 'CANCELLED' });
    expect(mailed).toContain('STATUS:CANCELLED');
    expect(parseICS(mailed)).toEqual([]);
    // …and a CANCEL that names no STATUS (an uninvite) adds nothing either.
    expect(parseICS(cal('METHOD:CANCEL', vevent('a')).replace('PRODID:-//x//EN\r\nMETHOD', 'METHOD'))).toEqual([]);
  });

  it('reads a cancelled occurrence of a live series as an exception date', () => {
    const master = vevent('s', ['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=4']);
    const skipped = [
      'BEGIN:VEVENT', 'UID:s', 'DTSTAMP:20260801T000000Z', 'RECURRENCE-ID:20260917T090000',
      'DTSTART:20260917T090000', 'DTEND:20260917T100000', 'SUMMARY:Standup', 'STATUS:CANCELLED', 'END:VEVENT',
    ].join('\r\n');
    const moved = [
      'BEGIN:VEVENT', 'UID:s', 'DTSTAMP:20260801T000000Z', 'RECURRENCE-ID:20260924T090000',
      'DTSTART:20260924T110000', 'DTEND:20260924T120000', 'SUMMARY:Standup', 'END:VEVENT',
    ].join('\r\n');
    const [series] = parseICS(cal(master, skipped, moved));
    const rid17 = new Date(2026, 8, 17, 9).getTime();
    const rid24 = new Date(2026, 8, 24, 9).getTime();
    expect(series.exdates).toEqual([rid17]);
    expect(Object.keys(series.overrides)).toEqual([String(rid24)]);
    const occ = expandOccurrences(normalizeEvent(series), new Date(2026, 8, 1).getTime(), new Date(2026, 9, 10).getTime());
    expect(occ.map((o) => new Date(o.start).getDate())).toEqual([10, 24, 1]);
    expect(new Date(occ[1].start).getHours()).toBe(11);
  });

  it('a cancelled series takes its exceptions with it', () => {
    const master = vevent('s', ['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=4', 'STATUS:CANCELLED']);
    const moved = [
      'BEGIN:VEVENT', 'UID:s', 'DTSTAMP:20260801T000000Z', 'RECURRENCE-ID:20260924T090000',
      'DTSTART:20260924T110000', 'DTEND:20260924T120000', 'SUMMARY:Standup', 'END:VEVENT',
    ].join('\r\n');
    expect(parseICS(cal(master, moved))).toEqual([]);
  });
});

describe('import — RRULE parts the engine cannot express', () => {
  const file = (dtstart, rrule) =>
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:r', 'DTSTAMP:20260101T000000Z',
      `DTSTART:${dtstart}`, `DTEND:${dtstart.slice(0, 9)}100000`, 'SUMMARY:Rule', `RRULE:${rrule}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const ruleOf = (dtstart, rrule) => parseICS(file(dtstart, rrule))[0].recurrence || null;

  it('imports "last day of the month" and a BYMONTHDAY off the DTSTART as one-offs, not the wrong series', () => {
    // Before: Jan 31, Mar 31, May 31… (every short month skipped) and "the 5th".
    expect(ruleOf('20260131T090000', 'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4')).toBeNull();
    expect(ruleOf('20260105T090000', 'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3')).toBeNull();
    expect(ruleOf('20260105T090000', 'FREQ=MONTHLY;BYMONTHDAY=5,20')).toBeNull();
    // A BYMONTHDAY that restates the DTSTART — what this app and most exporters
    // write — is the ordinary monthly-by-date rule.
    expect(ruleOf('20260115T090000', 'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3')).toMatchObject({ freq: 'monthly', monthlyMode: 'date' });
    // …checked against the file's own digits, not a zone-shifted local date.
    expect(ruleOf('20260115T230000Z', 'FREQ=MONTHLY;BYMONTHDAY=15')).toMatchObject({ freq: 'monthly' });
  });

  it('keeps a yearly rule that restates its date, and drops one by weekday', () => {
    expect(ruleOf('20260704T090000', 'FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=4')).toMatchObject({ freq: 'yearly' });
    expect(ruleOf('20260704T090000', 'FREQ=YEARLY;BYMONTH=8')).toBeNull();
    expect(ruleOf('20261126T090000', 'FREQ=YEARLY;BYDAY=-1TH;BYMONTH=11')).toBeNull(); // Thanksgiving
  });

  it('reads DAILY;BYDAY=MO,…,FR as the weekly rule it is, and only with INTERVAL=1', () => {
    expect(ruleOf('20260105T090000', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR')).toMatchObject({ freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] });
    expect(ruleOf('20260105T090000', 'FREQ=DAILY;INTERVAL=2;BYDAY=MO,WE')).toBeNull();
  });

  it('drops BYMONTHDAY / BYMONTH / BYSETPOS where they filter rather than restate the start', () => {
    // Under DAILY or WEEKLY these parts are filters the engine has no shape
    // for; ignoring them fabricated a plain daily / weekly series.
    expect(ruleOf('20260115T090000', 'FREQ=DAILY;BYMONTHDAY=15')).toBeNull();
    expect(ruleOf('20260315T090000', 'FREQ=MONTHLY;BYMONTH=3;BYMONTHDAY=15')).toBeNull();
    expect(ruleOf('20260303T090000', 'FREQ=WEEKLY;BYDAY=TU;BYMONTH=3')).toBeNull();
    expect(ruleOf('20260105T090000', 'FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1')).toBeNull();
    // Every Friday of the month, not "the Friday the start falls on".
    expect(ruleOf('20260102T090000', 'FREQ=MONTHLY;BYDAY=FR')).toBeNull();
    // Two Fridays a month is not the first alone.
    expect(ruleOf('20260102T090000', 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1,3')).toBeNull();
    expect(ruleOf('20260102T090000', 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-2')).toBeNull();
    // …while the shapes the engine does hold still import.
    expect(ruleOf('20260102T090000', 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1')).toMatchObject({ monthlyMode: 'weekday', monthlyNth: 1 });
    expect(ruleOf('20260130T090000', 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1')).toMatchObject({ monthlyMode: 'weekday', monthlyNth: -1 });
    expect(ruleOf('20260105T090000', 'FREQ=WEEKLY;BYDAY=MO,WE')).toMatchObject({ freq: 'weekly', byWeekday: [1, 3] });
  });

  it('drops a monthly rule on several weekdays and any sub-day part', () => {
    expect(ruleOf('20260105T090000', 'FREQ=MONTHLY;BYDAY=1MO,3MO')).toBeNull();
    expect(ruleOf('20260105T090000', 'FREQ=MONTHLY;BYDAY=1MO')).toMatchObject({ freq: 'monthly', monthlyMode: 'weekday', monthlyNth: 1 });
    expect(ruleOf('20260105T090000', 'FREQ=DAILY;BYHOUR=9,17')).toBeNull();
    expect(ruleOf('20260105T090000', 'FREQ=YEARLY;BYWEEKNO=20')).toBeNull();
  });

  it('a one-off from an unrepresentable rule still lands on its DTSTART', () => {
    const [ev] = parseICS(file('20260131T090000', 'FREQ=MONTHLY;BYMONTHDAY=-1'));
    expect(ev.recurrence).toBeUndefined();
    expect(new Date(ev.start).getDate()).toBe(31);
  });
});

describe('parseICS — component names are case-insensitive', () => {
  it('imports a file that spells BEGIN:VEVENT in lowercase', () => {
    const text = [
      'begin:vcalendar',
      'VERSION:2.0',
      'begin:vevent',
      'UID:lower@example.com',
      'DTSTART:20260713T090000',
      'DTEND:20260713T100000',
      'SUMMARY:Lowercase',
      'begin:valarm',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      'end:valarm',
      'end:vevent',
      'end:vcalendar',
    ].join('\r\n');
    const events = parseICS(text);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Lowercase');
    expect(events[0].reminders).toEqual([10]);
  });
});

describe('parseICS — all-day series exceptions written as DATE-TIME', () => {
  it('reads a DATE-TIME EXDATE / RECURRENCE-ID on an all-day master as the day it names', () => {
    // RFC 5545 wants VALUE=DATE here, but real exporters write the day as a
    // midnight DATE-TIME (UTC or zoned). Read as instants those matched no
    // occurrence: the cancelled days stayed and the override was dropped.
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:allday@test',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;VALUE=DATE:20260105',
      'DTEND;VALUE=DATE:20260106',
      'SUMMARY:Daily',
      'RRULE:FREQ=DAILY;COUNT=5',
      'EXDATE:20260106T000000Z',
      'EXDATE;TZID=Europe/Berlin:20260107T000000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:allday@test',
      'DTSTAMP:20260101T000000Z',
      'RECURRENCE-ID;TZID=Europe/Berlin:20260108T000000',
      'DTSTART;VALUE=DATE:20260108',
      'DTEND;VALUE=DATE:20260109',
      'SUMMARY:Daily (renamed)',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(text);
    const occ = expandOccurrences(
      normalizeEvent(ev),
      new Date(2026, 0, 1).getTime(),
      new Date(2026, 0, 31).getTime(),
    ).sort((a, b) => a.start - b.start);
    expect(occ.map((o) => `${new Date(o.start).getDate()}:${o.title}`)).toEqual([
      '5:Daily',
      '8:Daily (renamed)',
      '9:Daily',
    ]);
  });
});

describe('parseICS — a COUNT past the engine\'s cap', () => {
  const file = (rrule) =>
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:big', 'DTSTAMP:20260101T000000Z',
      'DTSTART:20260105T090000', 'DTEND:20260105T100000', 'SUMMARY:Long', `RRULE:${rrule}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

  it('becomes the UNTIL it amounts to, so nothing is truncated or re-exported wrong', () => {
    const [ev] = parseICS(file('FREQ=DAILY;COUNT=1500'));
    expect(ev.recurrence.count).toBeUndefined();
    // The 1500th daily occurrence is 1499 days after Jan 5 2026; the bound is
    // the end of that day.
    const last = new Date(2026, 0, 5 + 1499, 9, 0);
    expect(ev.recurrence.until).toBe(new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999).getTime());
    const out = toICS([normalizeEvent(ev)]);
    expect(out).not.toMatch(/COUNT=/);
    expect(out).toMatch(/UNTIL=/);
    // And the series really does have 1500 occurrences.
    const all = expandOccurrences(normalizeEvent(ev), new Date(2026, 0, 1).getTime(), new Date(2031, 0, 1).getTime());
    expect(all).toHaveLength(1500);
  });

  it('treats a count the enumeration can never reach as never-ending, not as 999', () => {
    const [ev] = parseICS(file('FREQ=DAILY;COUNT=200000'));
    expect(ev.recurrence.count).toBeUndefined();
    expect(ev.recurrence.until).toBeUndefined();
    // …while a count the engine holds is untouched.
    expect(parseICS(file('FREQ=DAILY;COUNT=999'))[0].recurrence.count).toBe(999);
  });
});

describe('parseICS — zoned exceptions when the file\'s zone and the browser\'s change clocks on different dates', () => {
  let savedTZ;
  beforeEach(() => {
    savedTZ = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles'; // clocks go forward Mar 8 2026
  });
  afterEach(() => {
    if (savedTZ === undefined) delete process.env.TZ;
    else process.env.TZ = savedTZ;
  });

  it('still cancels the exdated occurrence and applies the override', () => {
    // Berlin goes forward on Mar 29 2026. Between Mar 8 and Mar 28 the true
    // instant of a 15:00-Berlin exception is 07:00 in Los Angeles, while the
    // engine — which repeats the master's local wall clock — has the
    // occurrence at 06:00. Matched as instants, the exdate missed (the
    // cancelled Tuesday came back) and the override was dropped.
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:zoned@test',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Europe/Berlin:20260106T150000',
      'DTEND;TZID=Europe/Berlin:20260106T160000',
      'SUMMARY:Standup',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'EXDATE;TZID=Europe/Berlin:20260310T150000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:zoned@test',
      'DTSTAMP:20260101T000000Z',
      'RECURRENCE-ID;TZID=Europe/Berlin:20260317T150000',
      'DTSTART;TZID=Europe/Berlin:20260317T150000',
      'DTEND;TZID=Europe/Berlin:20260317T160000',
      'SUMMARY:Standup (retro)',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(text);
    const occ = expandOccurrences(normalizeEvent(ev), new Date(2026, 2, 1).getTime(), new Date(2026, 3, 1).getTime())
      .sort((a, b) => a.start - b.start);
    expect(occ.map((o) => `${new Date(o.start).getDate()}:${o.title}`)).toEqual([
      '3:Standup',
      '17:Standup (retro)',
      '24:Standup',
      '31:Standup',
    ]);
  });

  it('leaves a floating series (no zone) matching by plain instant, as before', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:float@test',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260106T090000',
      'DTEND:20260106T100000',
      'SUMMARY:Floating',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'EXDATE:20260113T090000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(text);
    expect(ev.exdates).toEqual([new Date(2026, 0, 13, 9, 0).getTime()]);
  });
});
