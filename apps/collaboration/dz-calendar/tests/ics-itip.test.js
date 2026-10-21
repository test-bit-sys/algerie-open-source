import { describe, it, expect } from 'vitest';
import { parseITIP, parseICS, toICS } from '../src/js/ics.js';

const H = 3_600_000;

function crlf(lines) {
  return lines.join('\r\n');
}

describe('parseITIP: REQUEST / CANCEL / REPLY / COUNTER', () => {
  it('parses a REQUEST item with organizer, attendees, sequence and dtstamp', () => {
    const ics = crlf([
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:req-1@example.com',
      'DTSTAMP:20260810T090000Z',
      'SEQUENCE:3',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T100000Z',
      'ORGANIZER;CN=Boss:mailto:boss@example.com',
      'ATTENDEE;CN=Ada;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:ada@example.com',
      'SUMMARY:Kickoff',
      'END:VEVENT', 'END:VCALENDAR',
    ]);
    const { method, items } = parseITIP(ics);
    expect(method).toBe('REQUEST');
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.uid).toBe('req-1@example.com');
    expect(item.sequence).toBe(3);
    expect(item.dtstamp).toBe(Date.UTC(2026, 7, 10, 9, 0, 0));
    expect(item.cancelled).toBe(false);
    expect(item.organizer).toEqual({ email: 'boss@example.com', name: 'Boss' });
    expect(item.attendees).toEqual([
      { email: 'ada@example.com', name: 'Ada', status: 'needs-action', rsvp: true, role: 'REQ-PARTICIPANT' },
    ]);
    expect(item.event.title).toBe('Kickoff');
    expect(item.event.start).toBe(Date.UTC(2026, 8, 1, 9, 0, 0));
  });

  it('parses a CANCEL item: cancelled true, from either METHOD:CANCEL or STATUS:CANCELLED', () => {
    const byMethod = parseITIP(crlf([
      'BEGIN:VCALENDAR', 'METHOD:CANCEL', 'BEGIN:VEVENT', 'UID:c1', 'DTSTAMP:20260810T000000Z', 'END:VEVENT', 'END:VCALENDAR',
    ]));
    expect(byMethod.items[0].cancelled).toBe(true);

    const byStatus = parseITIP(crlf([
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:c2', 'DTSTAMP:20260810T000000Z', 'STATUS:CANCELLED', 'END:VEVENT', 'END:VCALENDAR',
    ]));
    expect(byStatus.items[0].cancelled).toBe(true);
    expect(byStatus.items[0].status).toBe('CANCELLED');
  });

  it('parses a REPLY item: the replying attendee, their PARTSTAT, and a COMMENT', () => {
    const ics = crlf([
      'BEGIN:VCALENDAR', 'METHOD:REPLY', 'BEGIN:VEVENT',
      'UID:reply-1', 'DTSTAMP:20260810T120000Z',
      'ORGANIZER:mailto:boss@example.com',
      'ATTENDEE;PARTSTAT=DECLINED:mailto:ada@example.com',
      'COMMENT:Can\'t make it', 'END:VEVENT', 'END:VCALENDAR',
    ]);
    const { method, items } = parseITIP(ics);
    expect(method).toBe('REPLY');
    expect(items[0].attendees).toEqual([{ email: 'ada@example.com', name: '', status: 'declined', rsvp: false, role: '' }]);
    expect(items[0].comment).toBe("Can't make it");
  });

  it('parses a COUNTER item carrying a proposed new time', () => {
    const ics = crlf([
      'BEGIN:VCALENDAR', 'METHOD:COUNTER', 'BEGIN:VEVENT',
      'UID:counter-1', 'DTSTAMP:20260810T120000Z',
      'DTSTART:20260902T150000Z', 'DTEND:20260902T160000Z',
      'SUMMARY:Proposed', 'END:VEVENT', 'END:VCALENDAR',
    ]);
    const { method, items } = parseITIP(ics);
    expect(method).toBe('COUNTER');
    expect(items[0].event.start).toBe(Date.UTC(2026, 8, 2, 15, 0, 0));
  });

  it('parses a recurring master + a RECURRENCE-ID;RANGE=THISANDFUTURE item as two separate items (no folding)', () => {
    const ics = crlf([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:series-1', 'DTSTAMP:20260810T000000Z', 'SEQUENCE:1',
      'DTSTART:20260901T090000', 'DTEND:20260901T100000',
      'RRULE:FREQ=WEEKLY;BYDAY=TU', 'SUMMARY:Standup',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series-1', 'DTSTAMP:20260812T000000Z', 'SEQUENCE:2',
      'RECURRENCE-ID;RANGE=THISANDFUTURE:20260908T090000',
      'DTSTART:20260908T110000', 'DTEND:20260908T120000',
      'SUMMARY:Standup (moved later)',
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
    const { items } = parseITIP(ics);
    expect(items).toHaveLength(2); // one item per VEVENT — no master/override folding
    expect(items[0].recurrenceId).toBeNull();
    expect(items[1].uid).toBe('series-1');
    expect(items[1].sequence).toBe(2);
    expect(items[1].recurrenceRange).toBe('THISANDFUTURE');
    expect(items[1].recurrenceId).toMatchObject({ dateOnly: false });
    expect(items[1].recurrenceId.ms).toBe(new Date(2026, 8, 8, 9, 0, 0).getTime());
    expect(items[1].event.title).toBe('Standup (moved later)');
  });

  it('sequence and dtstamp default to 0 when absent', () => {
    const ics = crlf(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:noseq', 'END:VEVENT', 'END:VCALENDAR']);
    const { items } = parseITIP(ics);
    expect(items[0].sequence).toBe(0);
    expect(items[0].dtstamp).toBe(0);
  });

  it('parseICS behavior is unchanged by the readBlocks extraction (regression net)', () => {
    // A representative sample from tests/ics.test.js's own fixtures — the real
    // regression net is that file passing untouched; this just confirms the
    // extraction didn't change parseICS's shape for a couple of shapes here too.
    const ev = { id: 'e1', title: 'Standup', start: new Date(2026, 6, 13, 9).getTime(), end: new Date(2026, 6, 13, 10).getTime(), allDay: false };
    const [back] = parseICS(toICS([ev]));
    expect(back.title).toBe('Standup');
    expect(back.start).toBe(ev.start);
    expect(back.end).toBe(ev.end);
  });
});

describe('Windows and Mozilla TZIDs resolve to IANA zones', () => {
  it('resolves an Outlook-shaped Windows zone name (Eastern Standard Time)', () => {
    // 09:00 Eastern (EDT, UTC-4) on 2026-07-13 is 13:00 UTC.
    const ics = crlf([
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:win-tz',
      'DTSTART;TZID=Eastern Standard Time:20260713T090000',
      'DTEND;TZID=Eastern Standard Time:20260713T100000',
      'SUMMARY:Outlook meeting', 'END:VEVENT', 'END:VCALENDAR',
    ]);
    const [back] = parseICS(ics);
    expect(back.start).toBe(Date.UTC(2026, 6, 13, 13, 0, 0));
    expect(back.end).toBe(Date.UTC(2026, 6, 13, 14, 0, 0));
  });

  it('resolves a Mozilla/Thunderbird globally-unique TZID', () => {
    const ics = crlf([
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:moz-tz',
      'DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20260713T090000',
      'DTEND;TZID=/mozilla.org/20050126_1/America/New_York:20260713T100000',
      'SUMMARY:Thunderbird meeting', 'END:VEVENT', 'END:VCALENDAR',
    ]);
    const [back] = parseICS(ics);
    expect(back.start).toBe(Date.UTC(2026, 6, 13, 13, 0, 0));
    expect(back.end).toBe(Date.UTC(2026, 6, 13, 14, 0, 0));
  });

  it('an unresolvable TZID keeps the existing floating-local fallback', () => {
    const ics = crlf([
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:unknown-tz',
      'DTSTART;TZID=Nonsense/Zone:20260713T090000',
      'DTEND;TZID=Nonsense/Zone:20260713T100000',
      'SUMMARY:x', 'END:VEVENT', 'END:VCALENDAR',
    ]);
    const [back] = parseICS(ics);
    expect(back.start).toBe(new Date(2026, 6, 13, 9, 0).getTime());
  });

  it('still parses in ITIP items too (parseDateTime/sourceZoneOf share tzidOf)', () => {
    const ics = crlf([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT', 'UID:win-itip',
      'DTSTAMP:20260810T000000Z',
      'DTSTART;TZID=Eastern Standard Time:20260713T090000',
      'DTEND;TZID=Eastern Standard Time:20260713T100000',
      'SUMMARY:x', 'END:VEVENT', 'END:VCALENDAR',
    ]);
    const { items } = parseITIP(ics);
    expect(items[0].event.start).toBe(Date.UTC(2026, 6, 13, 13, 0, 0));
  });
});

describe('toICS accepts a UID override', () => {
  const start = new Date(2026, 6, 20, 10, 0).getTime();
  const ev = { id: 'local-id', title: 'Reply test', start, end: start + H, allDay: false };

  it('a uid override replaces the synthesized UID', () => {
    const ics = toICS([ev], { method: 'REPLY', uid: 'organizer-assigned-uid@google.com' });
    expect(ics).toContain('UID:organizer-assigned-uid@google.com');
    expect(ics).not.toContain('local-id@calendar.puter.com');
  });

  it('a CRLF-bearing uid override cannot inject a new property line', () => {
    const ics = toICS([ev], { method: 'REPLY', uid: 'evil\r\nX-INJECTED:1' });
    // The CR/LF are stripped, not preserved as a line break — "X-INJECTED"
    // ends up fused into the UID value, never as a property of its own.
    expect(ics).not.toMatch(/\r\nX-INJECTED/);
    expect(ics).toMatch(/UID:evilX-INJECTED:1/);
  });

  it('an override that sanitizes to nothing falls back to the default UID', () => {
    const ics = toICS([ev], { uid: '\r\n' });
    expect(ics).toContain('UID:local-id@calendar.puter.com');
  });

  it('with no uid option, output is unchanged (default path)', () => {
    const withOpt = toICS([ev]);
    const withoutOpt = toICS([ev], { uid: '' });
    expect(withOpt).toBe(withoutOpt);
    expect(withOpt).toContain('UID:local-id@calendar.puter.com');
  });

  it('a long override is capped at 255 characters', () => {
    const long = 'x'.repeat(400) + '@example.com';
    const ics = toICS([ev], { uid: long });
    const uidLine = ics.split('\r\n').find((l) => l.startsWith('UID:'));
    // Folded lines join back for this check: strip the fold continuation.
    const joined = ics.replace(/\r\n /g, '');
    const rejoinedUidLine = joined.split('\r\n').find((l) => l.startsWith('UID:'));
    expect(rejoinedUidLine.slice('UID:'.length).length).toBeLessThanOrEqual(255);
    void uidLine;
  });
});
