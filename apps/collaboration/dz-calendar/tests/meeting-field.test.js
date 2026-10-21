import { describe, it, expect } from 'vitest';
import { normalizeEvent, createStore } from '../src/js/store.js';
import { expandOccurrences } from '../src/js/recurrence.js';
import { toICS, parseICS } from '../src/js/ics.js';

const H = 3_600_000;
const DAY = 86_400_000;
const at = (day, hour = 9) => new Date(2031, 4, day, hour, 0, 0, 0).getTime();

const MEETING = { url: 'https://meet.example/#/m/abc-defg-hij', code: 'abc-defg-hij' };

function makeKv() {
  const map = new Map();
  const re = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return {
    map,
    set: async (k, v) => {
      const items = Array.isArray(k) ? k : [{ key: k, value: v }];
      for (const { key, value } of items) map.set(key, JSON.parse(JSON.stringify(value)));
      return true;
    },
    get: async (k) => (map.has(k) ? map.get(k) : null),
    del: async (k) => map.delete(k),
    list: async (pattern, returnValues) => {
      let keys = [...map.keys()];
      if (typeof pattern === 'string') keys = keys.filter((k) => re(pattern).test(k));
      return returnValues ? keys.map((k) => ({ key: k, value: map.get(k) })) : keys;
    },
  };
}

describe('normalizeEvent — the meeting link', () => {
  it('keeps a well-formed link and drops everything else about it', () => {
    const ev = normalizeEvent({
      title: 'Sync',
      start: at(5),
      end: at(5, 10),
      meeting: { url: ` ${MEETING.url} `, code: MEETING.code, extra: 'nope' },
    });
    expect(ev.meeting).toEqual(MEETING);
  });

  it('stays absent (not null) on events without one, so stored shapes are unchanged', () => {
    const ev = normalizeEvent({ title: 'Sync', start: at(5), end: at(5, 10) });
    expect('meeting' in ev).toBe(false);
  });

  it('refuses a link that is not a web URL', () => {
    for (const url of ['javascript:alert(1)', 'ftp://x', 'not a url', '', 42]) {
      const ev = normalizeEvent({ start: at(5), end: at(5, 10), meeting: { url } });
      expect('meeting' in ev).toBe(false);
    }
  });

  it('keeps a code-less link (e.g. imported from ICS)', () => {
    const ev = normalizeEvent({ start: at(5), end: at(5, 10), meeting: { url: MEETING.url } });
    expect(ev.meeting).toEqual({ url: MEETING.url });
  });
});

describe('recurring series — the meeting link', () => {
  it('carries the master link onto every occurrence', () => {
    const master = normalizeEvent({
      title: 'Standup',
      start: at(5),
      end: at(5, 10),
      recurrence: { freq: 'daily' },
      meeting: MEETING,
    });
    const occs = expandOccurrences(master, at(5) - H, at(8));
    expect(occs.length).toBeGreaterThan(1);
    for (const occ of occs) expect(occ.meeting).toEqual(MEETING);
  });

  it('updateSeries leaves the link alone when the patch does not mention it, and removes it on null', async () => {
    const store = createStore(makeKv());
    await store.load();
    const master = await store.saveEvent({
      title: 'Standup',
      start: at(5),
      end: at(5, 10),
      recurrence: { freq: 'daily' },
      meeting: MEETING,
    });

    const { event: retitled } = await store.updateSeries(master.id, { title: 'Daily' });
    expect(retitled.meeting).toEqual(MEETING);

    const { event: detached } = await store.updateSeries(master.id, { meeting: null });
    expect('meeting' in detached).toBe(false);
  });

  it('updateFuture keeps the link (same room) on both halves of a split', async () => {
    const store = createStore(makeKv());
    await store.load();
    const master = await store.saveEvent({
      title: 'Standup',
      start: at(5),
      end: at(5, 10),
      recurrence: { freq: 'daily' },
      meeting: MEETING,
    });

    const splitAt = at(7);
    const { event: tail } = await store.updateFuture(master.id, splitAt, { title: 'Daily' });
    expect(tail.meeting).toEqual(MEETING);
    expect(store.getEvent(master.id).meeting).toEqual(MEETING);
  });
});

describe('ICS — the meeting link', () => {
  it('round-trips through URL', () => {
    const ev = normalizeEvent({
      title: 'Sync',
      start: at(5),
      end: at(5, 10),
      meeting: { url: MEETING.url },
    });
    const ics = toICS([ev]);
    expect(ics).toContain(`URL:${MEETING.url}`);

    const [back] = parseICS(ics);
    expect(normalizeEvent(back).meeting).toEqual({ url: MEETING.url });
  });

  it('emits no URL line for events without a link', () => {
    const ev = normalizeEvent({ title: 'Sync', start: at(5), end: at(5, 10) });
    expect(toICS([ev])).not.toContain('\nURL:');
  });

  it('never TEXT-escapes the URL property — URI values carry commas/semicolons raw', () => {
    // Regression: URL was run through escapeText, so a link with a comma or
    // semicolon exported as URL:…\,… — RFC 5545 backslash-escaping applies to
    // TEXT values only, and Apple/Google read the literal backslash into the
    // link, breaking it. (The DESCRIPTION "Join:" mirror IS text and keeps
    // its escaping.)
    const url = 'https://meet.example.com/j?ids=1,2;m=x';
    const ev = normalizeEvent({ title: 'Sync', start: at(5), end: at(5, 10), meeting: { url } });
    const ics = toICS([ev]);
    expect(ics).toContain(`URL:${url}`);
    expect(ics).not.toContain('URL:https://meet.example.com/j?ids=1\\,2');
    // Our own importer still reads it back whole.
    const [back] = parseICS(ics);
    expect(back.meeting).toEqual({ url });
  });

  it('writes the conference properties and a Join description line — never LOCATION', () => {
    // Gmail draws a LOCATION as a physical place (map pin, Directions button,
    // clicks open Google Maps), so the link must not ride there. Google reads
    // X-GOOGLE-CONFERENCE, standards-followers RFC 7986's CONFERENCE, and
    // Outlook.com (which shows neither URL nor those) the description line.
    const ev = normalizeEvent({
      title: 'Sync',
      start: at(5),
      end: at(5, 10),
      meeting: { url: MEETING.url },
    });
    const ics = toICS([ev]);
    expect(ics).toContain(`X-GOOGLE-CONFERENCE:${MEETING.url}`);
    expect(ics).toContain(`CONFERENCE;VALUE=URI;FEATURE=VIDEO:${MEETING.url}`);
    expect(ics).toContain(`DESCRIPTION:Join: ${MEETING.url}`);
    expect(ics).not.toContain('LOCATION:');
  });

  it('a real location rides untouched next to the conference properties', () => {
    const ev = normalizeEvent({
      title: 'Sync',
      start: at(5),
      end: at(5, 10),
      location: 'Room 4',
      description: 'Agenda',
      meeting: { url: MEETING.url },
    });
    const ics = toICS([ev]);
    expect(ics).toContain('LOCATION:Room 4');
    expect(ics).not.toContain(`LOCATION:${MEETING.url}`);
    // The blank separator line survives as escaped \n\n on the wire.
    expect(ics).toContain(`DESCRIPTION:Agenda\\n\\nJoin: ${MEETING.url}`);
  });

  it('import peels the synthesized copies back off — full round-trip', () => {
    const bare = normalizeEvent({
      title: 'Sync',
      start: at(5),
      end: at(5, 10),
      meeting: { url: MEETING.url },
    });
    const [bareBack] = parseICS(toICS([bare]));
    expect(bareBack.location).toBe('');
    expect(bareBack.description).toBe('');
    expect(bareBack.meeting).toEqual({ url: MEETING.url });

    const full = normalizeEvent({
      title: 'Sync',
      start: at(5),
      end: at(5, 10),
      location: 'Room 4',
      description: 'Agenda',
      meeting: { url: MEETING.url },
    });
    const [fullBack] = parseICS(toICS([full]));
    expect(fullBack.location).toBe('Room 4');
    expect(fullBack.description).toBe('Agenda');
    expect(fullBack.meeting).toEqual({ url: MEETING.url });
  });

  it('a location or Join line naming any OTHER url is real data and stays', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:x@elsewhere',
      'DTSTART:20310505T090000',
      'DTEND:20310505T100000',
      'SUMMARY:Sync',
      'LOCATION:https://other.example/room',
      'DESCRIPTION:Join: https://other.example/room',
      `URL:${MEETING.url}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICS(ics);
    expect(ev.location).toBe('https://other.example/room');
    expect(ev.description).toBe('Join: https://other.example/room');
    expect(ev.meeting).toEqual({ url: MEETING.url });
  });

  /** A minimal foreign VCALENDAR around the given VEVENT property lines. */
  const veventFile = (...propLines) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:x@elsewhere',
      'DTSTART:20310505T090000',
      'DTEND:20310505T100000',
      'SUMMARY:Sync',
      ...propLines,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

  it('still peels the LOCATION mirror out of files this app exported before the conference properties', () => {
    const [ev] = parseICS(
      veventFile(
        `LOCATION:${MEETING.url}`,
        `DESCRIPTION:Join: ${MEETING.url}`,
        `URL:${MEETING.url}`,
      ),
    );
    expect(ev.location).toBe('');
    expect(ev.description).toBe('');
    expect(ev.meeting).toEqual({ url: MEETING.url });
  });

  it('reads the link from X-GOOGLE-CONFERENCE or CONFERENCE when URL is absent (Google Calendar exports)', () => {
    const [viaGoogle] = parseICS(veventFile(`X-GOOGLE-CONFERENCE:${MEETING.url}`));
    expect(viaGoogle.meeting).toEqual({ url: MEETING.url });

    const [viaRfc7986] = parseICS(veventFile(`CONFERENCE;VALUE=URI;FEATURE=VIDEO:${MEETING.url}`));
    expect(viaRfc7986.meeting).toEqual({ url: MEETING.url });

    // RFC 7986 also allows dial-in URIs there; only web links become the
    // meeting field.
    const [viaTel] = parseICS(veventFile('CONFERENCE;VALUE=URI;FEATURE=AUDIO:tel:+15551234'));
    expect('meeting' in viaTel).toBe(false);
  });

  it('scans past a dial-in to the video link when several CONFERENCE entries ride together (RFC 7986)', () => {
    const [ev] = parseICS(
      veventFile(
        'CONFERENCE;VALUE=URI;FEATURE=AUDIO:tel:+15551234',
        `CONFERENCE;VALUE=URI;FEATURE=VIDEO:${MEETING.url}`,
      ),
    );
    expect(ev.meeting).toEqual({ url: MEETING.url });
  });

  it('a conference property outranks URL, which some producers point at an event PAGE', () => {
    const [ev] = parseICS(
      veventFile('URL:https://tickets.example/event/42', `X-GOOGLE-CONFERENCE:${MEETING.url}`),
    );
    expect(ev.meeting).toEqual({ url: MEETING.url });
  });

  it('a non-web URL neither becomes the link nor blocks the conference fallback', () => {
    const [withConf] = parseICS(
      veventFile('URL:webcal://cal.example/feed', `X-GOOGLE-CONFERENCE:${MEETING.url}`),
    );
    expect(withConf.meeting).toEqual({ url: MEETING.url });

    const [alone] = parseICS(veventFile('URL:webcal://cal.example/feed'));
    expect('meeting' in alone).toBe(false);
  });

  it("never peels a foreign file's real LOCATION, even when it names the join link (Google's Zoom shape)", () => {
    // Google Calendar exports a Zoom-scheduled event with the join link in
    // BOTH LOCATION and X-GOOGLE-CONFERENCE and no URL property. The location
    // is that producer's real data — only files that also carry the link in
    // URL (this app's own exports) get the synthesized copies peeled.
    const [ev] = parseICS(
      veventFile(`LOCATION:${MEETING.url}`, `X-GOOGLE-CONFERENCE:${MEETING.url}`),
    );
    expect(ev.location).toBe(MEETING.url);
    expect(ev.meeting).toEqual({ url: MEETING.url });
  });
});
