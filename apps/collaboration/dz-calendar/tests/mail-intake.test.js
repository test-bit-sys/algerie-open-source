import { describe, it, expect, vi } from 'vitest';
import { createMailIntake } from '../src/js/mail-intake.js';
import { createStore } from '../src/js/store.js';
import { makeKv } from './helpers/worker-harness.js';

function crlf(lines) {
  return lines.join('\r\n');
}

const DAY_MS = 86_400_000;

let keyCounter = 0;
/** A lexically-sortable cal:mail:inv: key, like the handler's own ts36-h8 form. */
function recordKey() {
  keyCounter++;
  return 'cal:mail:inv:' + String(keyCounter).padStart(9, '0') + '-' + String(keyCounter).padStart(8, '0');
}

function requestIcal({
  uid = 'evt-uid-1',
  organizer = 'alice@example.com',
  organizerName = '',
  attendees = [{ email: 'bob@example.com', status: 'NEEDS-ACTION' }],
  sequence = 0,
  dtstamp = '20260810T000000Z',
  start = '20260901T090000Z',
  end = '20260901T100000Z',
  summary = 'Team sync',
  method = 'REQUEST',
} = {}) {
  const attLines = attendees.map(
    (a) => `ATTENDEE${a.name ? `;CN=${a.name}` : ''};PARTSTAT=${a.status || 'NEEDS-ACTION'}:mailto:${a.email}`,
  );
  return crlf([
    'BEGIN:VCALENDAR', 'VERSION:2.0', `METHOD:${method}`, 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${dtstamp}`, `SEQUENCE:${sequence}`,
    `DTSTART:${start}`, `DTEND:${end}`,
    `ORGANIZER${organizerName ? `;CN=${organizerName}` : ''}:mailto:${organizer}`,
    ...attLines,
    `SUMMARY:${summary}`,
    'END:VEVENT', 'END:VCALENDAR',
  ]);
}

function cancelIcal({ uid, sequence = 1, dtstamp = '20260811T000000Z' }) {
  return crlf([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:CANCEL', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${dtstamp}`, `SEQUENCE:${sequence}`, 'STATUS:CANCELLED',
    'END:VEVENT', 'END:VCALENDAR',
  ]);
}

function cancelOccurrenceIcal({ uid, recurrenceIdValue, sequence = 1, dtstamp = '20260811T000000Z', range = '' }) {
  return crlf([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:CANCEL', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${dtstamp}`, `SEQUENCE:${sequence}`,
    `RECURRENCE-ID${range ? `;RANGE=${range}` : ''}:${recurrenceIdValue}`,
    'STATUS:CANCELLED', 'END:VEVENT', 'END:VCALENDAR',
  ]);
}

function localStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}T${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function replyIcal({ uid, attendeeEmail, partstat = 'ACCEPTED', dtstamp = '20260811T000000Z' }) {
  return crlf([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REPLY', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${dtstamp}`, `ATTENDEE;PARTSTAT=${partstat}:mailto:${attendeeEmail}`,
    'END:VEVENT', 'END:VCALENDAR',
  ]);
}

function counterIcal({ uid, start = '20260902T150000Z', end = '20260902T160000Z', summary = 'Team sync (proposed)' }) {
  return crlf([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:COUNTER', 'BEGIN:VEVENT',
    `UID:${uid}`, 'DTSTAMP:20260811T000000Z', `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${summary}`,
    'END:VEVENT', 'END:VCALENDAR',
  ]);
}

function makeRecord(overrides = {}) {
  return {
    v: 1,
    at: Date.now(),
    file: { path: '~/.mail/objects/2026-09-11/x', uid: 'x' },
    from: { email: 'alice@example.com', name: 'Alice' },
    replyTo: '',
    sender: '',
    subject: 'Team sync',
    date: Date.now(),
    auth: { internal: false, dkim: 'pass', dkimAligned: true, spf: 'pass', received: true },
    method: 'REQUEST',
    mimeMethod: 'REQUEST',
    uid: 'evt-uid-1',
    summary: 'Team sync',
    organizer: 'alice@example.com',
    attendees: ['bob@example.com'],
    events: 1,
    truncated: false,
    snippet: '',
    ical: requestIcal(),
    ...overrides,
  };
}

function makeIntake({ kv, store, contacts = null, user = { username: 'nariman', email: 'nariman@example.com' }, toast = vi.fn(), blocked = () => false, getPuter = () => null } = {}) {
  const mailbox = { available: () => true, onChange: () => () => {} };
  return createMailIntake({ kv, store, mailbox, contacts, user, toast, blocked, getPuter });
}

// A record whose sender fails authentication (dkim/spf fail, not internal) —
// used to keep a KNOWN sender's record sitting in the tray instead of
// auto-applying, so a test can exercise the manual accept/ignore/block path.
const UNAUTHENTICATED = { internal: false, dkim: 'fail', dkimAligned: false, spf: 'fail', received: true };
// Contacts stand-in that knows any address — for tests where the known/
// unknown gate itself isn't what's being exercised.
const KNOWS_EVERYONE = { knows: () => true };

async function setup() {
  const kv = makeKv();
  const store = createStore(kv);
  await store.load();
  return { kv, store };
}

describe('trust policy: authenticated + known gate auto-add', () => {
  it('an unknown sender is hidden entirely by default — no tray row, no count', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u1' }) }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(store.getAllEvents()).toHaveLength(0);
    expect(intake.getPending()).toHaveLength(0);
  });

  it('the same unknown sender appears once mailInvitesShowUnknown is on, labelled "Unknown sender"', async () => {
    const { kv, store } = await setup();
    await store.saveSettings({ mailInvitesShowUnknown: true });
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u1b' }) }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(store.getAllEvents()).toHaveLength(0);
    const pending = intake.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('request');
    expect(pending[0].known).toBe(false);
    expect(pending[0].hint).toBe('Unknown sender');
  });

  it('toggling mailInvitesShowUnknown surfaces and hides the row without a fresh pump', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u1c' }) }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(intake.getPending()).toHaveLength(0); // hidden

    await store.saveSettings({ mailInvitesShowUnknown: true });
    expect(intake.getPending()).toHaveLength(1); // surfaced — no pump() in between

    await store.saveSettings({ mailInvitesShowUnknown: false });
    expect(intake.getPending()).toHaveLength(0); // hidden again
  });

  it('a known (via contacts), DKIM-aligned sender auto-creates the event with invite.uid stamped', async () => {
    const { kv, store } = await setup();
    const contacts = { knows: (email) => email === 'alice@example.com' };
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u2' }) }));
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    const events = store.getAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0].invite).toMatchObject({ uid: 'u2', from: 'alice@example.com' });
    expect(events[0].organizer.email).toBe('alice@example.com');
    expect(intake.getPending()).toHaveLength(0);
  });

  it('a known sender who fails authentication stays in the tray', async () => {
    const { kv, store } = await setup();
    const contacts = { knows: () => true };
    kv.map.set(recordKey(), makeRecord({
      ical: requestIcal({ uid: 'u3' }),
      auth: { internal: false, dkim: 'fail', dkimAligned: false, spf: 'fail', received: true },
    }));
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    expect(store.getAllEvents()).toHaveLength(0);
    expect(intake.getPending()).toHaveLength(1);
  });

  it('an internal @puter.email sender is authenticated but NOT automatically known — hidden by default', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'stranger@puter.email', name: '' },
      ical: requestIcal({ uid: 'u4', organizer: 'stranger@puter.email' }),
      auth: { internal: true, dkim: 'none', dkimAligned: false, spf: 'none', received: false },
    }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(store.getAllEvents()).toHaveLength(0);
    expect(intake.getPending()).toHaveLength(0); // unknown — hidden, "Puter user" alone isn't known

    await store.saveSettings({ mailInvitesShowUnknown: true });
    const pending = intake.getPending();
    expect(pending).toHaveLength(1);
    // Unknown takes priority over the internal-sender hint once surfaced.
    expect(pending[0].hint).toBe('Unknown sender');
  });

  it('a known ORGANIZER cannot substitute for an unknown/unauthenticated From address — hidden, not just un-added', async () => {
    const { kv, store } = await setup();
    // Contacts "knows" the ORGANIZER the iCalendar names, not the real sender.
    const contacts = { knows: (email) => email === 'boss@example.com' };
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'attacker@example.com', name: '' },
      ical: requestIcal({ uid: 'u5', organizer: 'boss@example.com', organizerName: 'Boss' }),
    }));
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    expect(store.getAllEvents()).toHaveLength(0);
    expect(intake.getPending()).toHaveLength(0);
  });

  it('a stale "all" value cannot come back to life — an unknown sender still needs the tray, never straight to auto-add', async () => {
    const { kv, store } = await setup();
    // A hand-edited or pre-rebuild settings value — mail-intake no longer has
    // any special case for 'all', so this must behave exactly like anything
    // other than 'never': authenticated + known required, never a bypass.
    kv.map.set('cal:settings', { mailInvites: 'all' });
    await store.load();
    expect(store.getSettings().mailInvites).toBe('known'); // sanitizeMailInvites rejects 'all' on load
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u5b' }) })); // alice, unknown
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(store.getAllEvents()).toHaveLength(0);
    expect(intake.getPending()).toHaveLength(0); // still hidden, not merely un-added
  });

  it('"never" trays everything, even a known+authenticated sender', async () => {
    const { kv, store } = await setup();
    await store.saveSettings({ mailInvites: 'never' });
    const contacts = { knows: () => true };
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u5c' }) }));
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    expect(store.getAllEvents()).toHaveLength(0);
    expect(intake.getPending()).toHaveLength(1);
  });
});

describe('REQUEST update semantics', () => {
  it('a higher SEQUENCE applies and keeps the guest\'s own PARTSTAT', async () => {
    const { kv, store } = await setup();
    const contacts = { knows: () => true };
    await store.saveEvent({
      title: 'Team sync',
      start: Date.UTC(2026, 8, 1, 9), end: Date.UTC(2026, 8, 1, 10),
      organizer: { email: 'alice@example.com' },
      guests: [{ email: 'bob@example.com', status: 'accepted' }],
      invite: { uid: 'u6', seq: 0, stamp: 0, from: 'alice@example.com' },
    });
    kv.map.set(recordKey(), makeRecord({
      ical: requestIcal({ uid: 'u6', sequence: 1, dtstamp: '20260812T000000Z', summary: 'Team sync (updated)' }),
    }));
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    const events = store.getAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Team sync (updated)');
    expect(events[0].invite.seq).toBe(1);
    expect(events[0].guests.find((g) => g.email === 'bob@example.com').status).toBe('accepted');
  });

  it('an equal sequence with a NEWER dtstamp applies', async () => {
    const { kv, store } = await setup();
    const contacts = { knows: () => true };
    await store.saveEvent({
      title: 'Team sync', start: 1, end: 2,
      organizer: { email: 'alice@example.com' },
      invite: { uid: 'u6b', seq: 1, stamp: Date.UTC(2026, 7, 1), from: 'alice@example.com' },
    });
    kv.map.set(recordKey(), makeRecord({
      ical: requestIcal({ uid: 'u6b', sequence: 1, dtstamp: '20260815T000000Z', summary: 'Moved' }),
    }));
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    expect(store.getAllEvents()[0].title).toBe('Moved');
  });

  it('an equal sequence with an OLDER dtstamp does not apply', async () => {
    const { kv, store } = await setup();
    const contacts = { knows: () => true };
    await store.saveEvent({
      title: 'Team sync', start: 1, end: 2,
      organizer: { email: 'alice@example.com' },
      invite: { uid: 'u6c', seq: 1, stamp: Date.UTC(2026, 7, 12), from: 'alice@example.com' },
    });
    kv.map.set(recordKey(), makeRecord({
      ical: requestIcal({ uid: 'u6c', sequence: 1, dtstamp: '20260810T000000Z', summary: 'Stale update' }),
    }));
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    expect(store.getAllEvents()[0].title).toBe('Team sync');
  });
});

describe('CANCEL identity check', () => {
  it('CANCEL from the stored organizer deletes the event', async () => {
    const { kv, store } = await setup();
    const existing = await store.saveEvent({
      title: 'X', start: 1, end: 2,
      organizer: { email: 'alice@example.com' },
      invite: { uid: 'u7', seq: 0, stamp: 0, from: 'alice@example.com' },
    });
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'alice@example.com', name: '' },
      method: 'CANCEL', mimeMethod: 'CANCEL', ical: cancelIcal({ uid: 'u7' }),
    }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(store.getEvent(existing.id)).toBeNull();
    expect(intake.getPending()).toHaveLength(0);
  });

  it('CANCEL from a different address does not delete; trayed, labelled Cancellation', async () => {
    const { kv, store } = await setup();
    const existing = await store.saveEvent({
      title: 'X', start: 1, end: 2,
      organizer: { email: 'alice@example.com' },
      invite: { uid: 'u8', seq: 0, stamp: 0, from: 'alice@example.com' },
    });
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'mallory@example.com', name: '' },
      method: 'CANCEL', mimeMethod: 'CANCEL', ical: cancelIcal({ uid: 'u8' }),
    }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(store.getEvent(existing.id)).toBeTruthy();
    const pending = intake.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].hint).toBe('Cancellation');
  });

  it('C2: a RECURRENCE-ID a few seconds off a real slot still cancels the right occurrence', async () => {
    const { kv, store } = await setup();
    const seriesStart = new Date(2026, 8, 1, 9, 0, 0).getTime(); // some Tuesday-or-other in Sep 2026
    await store.saveEvent({
      title: 'Standup', start: seriesStart, end: seriesStart + 1_800_000,
      organizer: { email: 'alice@example.com' },
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [new Date(seriesStart).getDay()] },
      invite: { uid: 'series-uid-1', seq: 0, stamp: 0, from: 'alice@example.com' },
    });
    // The following week's occurrence, named a few seconds off the real slot —
    // exactly what a foreign producer's own rounding/zone math tends to do.
    const target = new Date(seriesStart + 7 * 86_400_000 + 3000);
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'alice@example.com', name: '' },
      method: 'CANCEL', mimeMethod: 'CANCEL', ical: cancelOccurrenceIcal({ uid: 'series-uid-1', recurrenceIdValue: localStamp(target) }),
    }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    const occs = store.getEventsInRange(new Date(2026, 8, 1).getTime(), new Date(2026, 8, 30).getTime());
    expect(occs.some((o) => new Date(o.start).getTime() === seriesStart)).toBe(true); // first slot untouched
    expect(occs.some((o) => new Date(o.start).getTime() === seriesStart + 7 * 86_400_000)).toBe(false); // 2nd cancelled
    expect(intake.getPending()).toHaveLength(0); // applied, not trayed
  });

  it('C2: a RECURRENCE-ID matching no slot at all leaves the event alone and trays the record', async () => {
    const { kv, store } = await setup();
    const seriesStart = new Date(2026, 8, 1, 9, 0, 0).getTime();
    await store.saveEvent({
      title: 'Standup', start: seriesStart, end: seriesStart + 1_800_000,
      organizer: { email: 'alice@example.com' },
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [new Date(seriesStart).getDay()] },
      invite: { uid: 'series-uid-2', seq: 0, stamp: 0, from: 'alice@example.com' },
    });
    // 4 days later is never the same weekday as the series' own — a day the
    // schedule simply never produces a slot on.
    const garbageDay = new Date(seriesStart + 4 * 86_400_000);
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'alice@example.com', name: '' },
      method: 'CANCEL', mimeMethod: 'CANCEL', ical: cancelOccurrenceIcal({ uid: 'series-uid-2', recurrenceIdValue: localStamp(garbageDay) }),
    }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    const occs = store.getEventsInRange(new Date(2026, 8, 1).getTime(), new Date(2026, 8, 30).getTime());
    expect(occs.length).toBeGreaterThan(0); // series left fully intact
    const pending = intake.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].hint).toBe('Cancellation');
  });
});

describe('REPLY', () => {
  it('updates one guest\'s status, only for the matching (sender-identity) attendee', async () => {
    const { kv, store } = await setup();
    const existing = await store.saveEvent({
      title: 'Team sync', start: 1, end: 2,
      guests: [
        { email: 'bob@example.com', status: 'needs-action' },
        { email: 'carl@example.com', status: 'needs-action' },
      ],
    });
    const uid = `${existing.id}@calendar.puter.com`;
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'bob@example.com', name: '' },
      method: 'REPLY', mimeMethod: 'REPLY', ical: replyIcal({ uid, attendeeEmail: 'bob@example.com', partstat: 'ACCEPTED' }),
    }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    const updated = store.getEvent(existing.id);
    expect(updated.guests.find((g) => g.email === 'bob@example.com').status).toBe('accepted');
    expect(updated.guests.find((g) => g.email === 'carl@example.com').status).toBe('needs-action');
    expect(intake.getPending()).toHaveLength(0); // REPLY never shows in the tray
  });

  it('a REPLY for a UID we do not host is dropped silently, with no tray row', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'bob@example.com', name: '' },
      method: 'REPLY', mimeMethod: 'REPLY', ical: replyIcal({ uid: 'nobody-hosts-this@calendar.puter.com', attendeeEmail: 'bob@example.com' }),
    }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(intake.getPending()).toHaveLength(0);
    expect([...kv.map.keys()].some((k) => k.startsWith('cal:mail:inv:'))).toBe(false);
  });
});

describe('COUNTER', () => {
  it('never auto-applies; sits in the tray with hint "Proposed time"', async () => {
    const { kv, store } = await setup();
    const contacts = { knows: () => true };
    kv.map.set(recordKey(), makeRecord({ method: 'COUNTER', mimeMethod: 'COUNTER', ical: counterIcal({ uid: 'u9' }) }));
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    expect(store.getAllEvents()).toHaveLength(0);
    const pending = intake.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].hint).toBe('Proposed time');
    expect(pending[0].kind).toBe('counter');
  });
});

describe('blocked senders', () => {
  it("a blocked sender's record is deleted immediately, nothing shown", async () => {
    const { kv, store } = await setup();
    kv.map.set('cal:mail:senders', { blocked: ['evil@example.com'], allowed: [], at: 0 });
    kv.map.set(recordKey(), makeRecord({ from: { email: 'evil@example.com', name: '' }, ical: requestIcal({ uid: 'u10' }) }));
    const intake = makeIntake({ kv, store });
    await intake.start();
    expect(intake.getPending()).toHaveLength(0);
    expect([...kv.map.keys()].filter((k) => k.startsWith('cal:mail:inv:'))).toHaveLength(0);
  });
});

describe('user actions on a pending row', () => {
  // Known (so it's visible) but unauthenticated (so it trays instead of
  // auto-applying) — isolates the manual action from the known/unknown gate.
  it('accept() applies a REQUEST regardless of trust, and remembers the sender as allowed', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u11' }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    const [pending] = intake.getPending();
    expect(pending).toBeTruthy();
    const ok = await intake.accept(pending.id);
    expect(ok).toBe(true);
    expect(store.getAllEvents()).toHaveLength(1);
    expect(intake.getPending()).toHaveLength(0);
  });

  it('ignore() deletes the pending record without applying it', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u12' }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    const [pending] = intake.getPending();
    await intake.ignore(pending.id);
    expect(store.getAllEvents()).toHaveLength(0);
    expect(intake.getPending()).toHaveLength(0);
  });

  it('blockSender() blocks the address and removes every pending record from them', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u13a' }), auth: UNAUTHENTICATED }));
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u13b', summary: 'Second one' }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    expect(intake.getPending()).toHaveLength(2);
    const [first] = intake.getPending();
    await intake.blockSender(first.id);
    expect(intake.getPending()).toHaveLength(0);
    expect(intake.getBlocked()).toContain('alice@example.com');
  });

  it('unblock() removes a previously blocked address', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u14' }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    const [pending] = intake.getPending();
    await intake.blockSender(pending.id);
    expect(intake.getBlocked()).toContain('alice@example.com');
    await intake.unblock('alice@example.com');
    expect(intake.getBlocked()).not.toContain('alice@example.com');
  });

  it('blocking an unknown sender works while it is shown via mailInvitesShowUnknown', async () => {
    const { kv, store } = await setup();
    await store.saveSettings({ mailInvitesShowUnknown: true });
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u14b' }) })); // alice — unknown, no contacts
    const intake = makeIntake({ kv, store });
    await intake.pump();
    const [pending] = intake.getPending();
    expect(pending.known).toBe(false);
    await intake.blockSender(pending.id);
    expect(intake.getBlocked()).toContain('alice@example.com');
    expect(intake.getPending()).toHaveLength(0);
  });
});

describe('per-pump and tray caps', () => {
  it('auto-applies at most 25 per pump(), leaving the rest pending', async () => {
    const { kv, store } = await setup();
    const contacts = { knows: () => true };
    for (let i = 0; i < 30; i++) {
      kv.map.set(recordKey(), makeRecord({
        from: { email: `sender${i}@example.com`, name: '' },
        ical: requestIcal({ uid: `cap-uid-${i}`, organizer: `sender${i}@example.com` }),
      }));
    }
    const intake = makeIntake({ kv, store, contacts });
    await intake.pump();
    expect(store.getAllEvents().length).toBeLessThanOrEqual(25);
    expect(intake.getPending().length).toBeGreaterThan(0);
  });

  it('getPending() never returns more than 50 rows', async () => {
    const { kv, store } = await setup();
    for (let i = 0; i < 60; i++) {
      kv.map.set(recordKey(), makeRecord({
        from: { email: `u${i}@example.com`, name: '' },
        ical: requestIcal({ uid: `tray-uid-${i}`, organizer: `u${i}@example.com` }),
        auth: UNAUTHENTICATED, // known + unauthenticated -> trayed, not auto-applied
      }));
    }
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    expect(intake.getPending().length).toBeLessThanOrEqual(50);
  });
});

describe('view models: parsed once, exposing plain strings only', () => {
  it('getPending() view models carry the documented fields', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'vm-uid', summary: 'Board meeting' }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    const [vm] = intake.getPending();
    expect(vm).toMatchObject({ kind: 'request', title: 'Board meeting', fromEmail: 'alice@example.com', hint: '' });
    expect(typeof vm.whenText).toBe('string');
    expect(vm.whenText.length).toBeGreaterThan(0);
    expect(typeof vm.authenticated).toBe('boolean');
    expect(typeof vm.id).toBe('string');
    expect(typeof vm.at).toBe('number');
  });
});

describe('KV listing discipline: never flat-list with values', () => {
  it('never calls kv.list for cal:mail:inv:* with returnValues true', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'flat-uid' }) }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    for (const call of kv.list.mock.calls) {
      if (String(call[0]).startsWith('cal:mail:inv:')) {
        expect(call[1]).not.toBe(true);
      }
    }
  });
});

describe('onDetected — new arrivals while the app is open', () => {
  it('stays quiet on the first pump and reports only what a later pump added', async () => {
    const { kv, store } = await setup();
    const onDetected = vi.fn();
    const mailbox = { available: () => true, onChange: () => () => {} };
    const intake = createMailIntake({
      kv,
      store,
      mailbox,
      contacts: KNOWS_EVERYONE, // known + unauthenticated below -> trayed, visible
      user: { username: 'nariman', email: 'nariman@example.com' },
      toast: vi.fn(),
      blocked: () => false,
      getPuter: () => null,
      onDetected,
    });

    // A backlog that was already there is not news.
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'b1' }), auth: UNAUTHENTICATED }));
    await intake.pump();
    expect(intake.getPending()).toHaveLength(1);
    expect(onDetected).not.toHaveBeenCalled();

    // Two more arrive; only those two are announced.
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'b2' }), auth: UNAUTHENTICATED }));
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'b3' }), auth: UNAUTHENTICATED }));
    await intake.pump();
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(2);

    // A pump that finds nothing new says nothing.
    await intake.pump();
    expect(onDetected).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener cannot break the pump', async () => {
    const { kv, store } = await setup();
    const mailbox = { available: () => true, onChange: () => () => {} };
    const intake = createMailIntake({
      kv,
      store,
      mailbox,
      contacts: KNOWS_EVERYONE,
      user: { username: 'nariman', email: 'nariman@example.com' },
      toast: vi.fn(),
      blocked: () => false,
      getPuter: () => null,
      onDetected: () => {
        throw new Error('listener bug');
      },
    });
    await intake.pump();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'c1' }), auth: UNAUTHENTICATED }));
    await expect(intake.pump()).resolves.toBeUndefined();
    expect(intake.getPending()).toHaveLength(1);
  });
});

describe('a cancellation the sender cannot prove is theirs', () => {
  async function trayedCancel(fromEmail) {
    const { kv, store } = await setup();
    const saved = await store.saveEvent({
      title: 'Budget review',
      start: Date.parse('2026-09-01T09:00:00Z'),
      end: Date.parse('2026-09-01T10:00:00Z'),
      organizer: { email: 'alice@example.com' },
      invite: { uid: 'u-cancel-1', from: 'alice@example.com' },
    });
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: fromEmail, name: 'Someone' },
        method: 'CANCEL',
        mimeMethod: 'CANCEL',
        ical: cancelIcal({ uid: 'u-cancel-1' }),
      }),
    );
    const intake = makeIntake({ kv, store });
    await intake.pump();
    return { kv, store, intake, saved };
  }

  it('offers no primary action and says why', async () => {
    const { intake, store, saved } = await trayedCancel('mallory@evil.example');
    const [row] = intake.getPending();
    expect(row.kind).toBe('cancel');
    expect(row.canApply).toBe(false);
    expect(row.blockedReason).toBe('Not from the organizer of that event.');
    expect(store.getEvent(saved.id)).not.toBeNull();
  });

  it('does not delete the event even if accept() is called directly', async () => {
    const { intake, store, saved } = await trayedCancel('mallory@evil.example');
    const [row] = intake.getPending();
    await intake.accept(row.id);
    expect(store.getEvent(saved.id)).not.toBeNull();
    expect(store.getEvent(saved.id).title).toBe('Budget review');
  });

  it('a cancellation from the organizer needs no tray at all — it just applies', async () => {
    const { intake, store, saved } = await trayedCancel('alice@example.com');
    expect(intake.getPending()).toHaveLength(0);
    expect(store.getEvent(saved.id)).toBeNull();
  });

  it('a cancellation naming an event this calendar does not have says so', async () => {
    const { kv, store } = await setup();
    kv.map.set(
      recordKey(),
      makeRecord({
        method: 'CANCEL',
        mimeMethod: 'CANCEL',
        ical: cancelIcal({ uid: 'u-nothing-here' }),
      }),
    );
    // From someone the user knows, so the row is shown at all.
    const intake = makeIntake({ kv, store, contacts: { knows: () => true } });
    await intake.pump();
    const [row] = intake.getPending();
    expect(row.canApply).toBe(false);
    expect(row.blockedReason).toBe('No matching event on this calendar.');
  });

  // Picking a METHOD must not be a way past the prior-interaction rule.
  it('a stranger cannot raise a tray row with a CANCEL that names nothing', async () => {
    const { kv, store } = await setup();
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'mallory@evil.example', name: 'Mallory' },
        method: 'CANCEL',
        mimeMethod: 'CANCEL',
        ical: cancelIcal({ uid: 'u-nothing-here' }),
      }),
    );
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(intake.getPending()).toHaveLength(0);
  });

  it('nor with a COUNTER for an event the user does not have', async () => {
    const { kv, store } = await setup();
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'mallory@evil.example', name: 'Mallory' },
        method: 'COUNTER',
        mimeMethod: 'COUNTER',
        ical: requestIcal({ uid: 'u-unheard-of', method: 'COUNTER' }),
      }),
    );
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(intake.getPending()).toHaveLength(0);
  });

  it('but a cancellation for an event the user DOES hold is shown, known sender or not', async () => {
    const { kv, store } = await setup();
    await store.saveEvent({
      title: 'Budget review',
      start: Date.parse('2026-09-01T09:00:00Z'),
      end: Date.parse('2026-09-01T10:00:00Z'),
      organizer: { email: 'alice@example.com' },
      invite: { uid: 'u-held', from: 'alice@example.com' },
    });
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'mallory@evil.example', name: 'Mallory' },
        method: 'CANCEL',
        mimeMethod: 'CANCEL',
        ical: cancelIcal({ uid: 'u-held' }),
      }),
    );
    const intake = makeIntake({ kv, store });
    await intake.pump();
    const [row] = intake.getPending();
    expect(row).toBeTruthy();
    expect(row.kind).toBe('cancel');
    expect(row.canApply).toBe(false);
    expect(row.blockedReason).toBe('Not from the organizer of that event.');
  });
});

describe('Undo an add', () => {
  it('removes the event and puts the invitation back in the tray', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u-undo-1' }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();

    const [row] = intake.getPending();
    expect(row).toBeTruthy();
    await intake.accept(row.id);
    expect(intake.getPending()).toHaveLength(0);
    const added = store.getAllEvents().find((e) => e.invite && e.invite.uid === 'u-undo-1');
    expect(added).toBeTruthy();

    await intake.undoAdd(added.id, row.id);
    expect(store.getAllEvents().find((e) => e.invite && e.invite.uid === 'u-undo-1')).toBeUndefined();
    const back = intake.getPending();
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(row.id);
    // and it is durable, not just in memory
    expect(kv.map.has(row.id)).toBe(true);
  });
});

describe('recurring invitations', () => {
  const seriesStart = new Date(2026, 5, 1, 9, 0, 0); // a Monday
  const week = 7 * DAY_MS;

  function seriesIcal({ uid = 'series-req-1', sequence = 0, exdate = null, exception = null } = {}) {
    const master = [
      'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260810T000000Z', `SEQUENCE:${sequence}`,
      `DTSTART:${localStamp(seriesStart)}`, `DTEND:${localStamp(new Date(seriesStart.getTime() + 1_800_000))}`,
      'RRULE:FREQ=WEEKLY;BYDAY=MO', ...(exdate ? [`EXDATE:${localStamp(exdate)}`] : []),
      'ORGANIZER:mailto:alice@example.com', 'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:nariman@puter.email',
      'SUMMARY:Weekly sync', 'END:VEVENT',
    ];
    return crlf(['BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', ...(exception || []), ...master, 'END:VCALENDAR']);
  }

  function occurrenceIcal({ uid = 'series-req-1', rid, start, sequence = 1, summary = 'Weekly sync (moved)' }) {
    return crlf([
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      `UID:${uid}`, 'DTSTAMP:20260811T000000Z', `SEQUENCE:${sequence}`, `RECURRENCE-ID:${localStamp(rid)}`,
      `DTSTART:${localStamp(start)}`, `DTEND:${localStamp(new Date(start.getTime() + 1_800_000))}`,
      'ORGANIZER:mailto:alice@example.com', `SUMMARY:${summary}`, 'END:VEVENT', 'END:VCALENDAR',
    ]);
  }

  it('accepting one keeps its RRULE and EXDATE, so a series that began earlier still shows today', async () => {
    const { kv, store } = await setup();
    const skipped = new Date(seriesStart.getTime() + week);
    kv.map.set(recordKey(), makeRecord({ ical: seriesIcal({ exdate: skipped }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    const [row] = intake.getPending();
    expect(await intake.accept(row.id)).toBe(true);

    const [ev] = store.getAllEvents();
    expect(ev.recurrence).toMatchObject({ freq: 'weekly' });
    const oct = new Date(2026, 9, 5).getTime();
    expect(store.getEventsInRange(oct, oct + week)).toHaveLength(1);
    const twoWeeks = store.getEventsInRange(seriesStart.getTime(), seriesStart.getTime() + 2 * week);
    expect(twoWeeks.map((o) => o.start)).toEqual([seriesStart.getTime()]); // second Monday excluded
  });

  it('an exception VEVENT listed before the master does not replace the series', async () => {
    const { kv, store } = await setup();
    const rid = new Date(seriesStart.getTime() + 2 * week);
    const exception = occurrenceIcal({ rid, start: new Date(rid.getTime() + 3_600_000) })
      .split('\r\n')
      .filter((l) => !/VCALENDAR|^VERSION|^METHOD/.test(l));
    kv.map.set(recordKey(), makeRecord({ ical: seriesIcal({ exception }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    const [row] = intake.getPending();
    await intake.accept(row.id);
    const [ev] = store.getAllEvents();
    expect(ev.start).toBe(seriesStart.getTime());
    expect(ev.recurrence).toBeTruthy();
  });

  it('an update naming one occurrence changes only that occurrence', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: seriesIcal() }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump(); // known + authenticated: auto-added
    const [series] = store.getAllEvents();
    expect(series.recurrence).toBeTruthy();

    const rid = new Date(seriesStart.getTime() + 2 * week);
    const moved = new Date(rid.getTime() + 3_600_000);
    kv.map.set(recordKey(), makeRecord({ ical: occurrenceIcal({ rid, start: moved }) }));
    await intake.pump();

    const after = store.getEvent(series.id);
    expect(after.start).toBe(seriesStart.getTime());
    expect(after.recurrence).toMatchObject({ freq: 'weekly' });
    expect(after.title).toBe('Weekly sync');
    const occs = store.getEventsInRange(seriesStart.getTime(), seriesStart.getTime() + 4 * week);
    expect(occs).toHaveLength(4);
    const changed = occs.find((o) => o.recurrenceId === rid.getTime());
    expect(changed.start).toBe(moved.getTime());
    expect(changed.title).toBe('Weekly sync (moved)');
    expect(intake.getPending()).toHaveLength(0);
  });
});

describe('a UID is not a licence to overwrite', () => {
  it('a different sender cannot update an event another sender created', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'shared-uid' }) }));
    const intake = makeIntake({ kv, store, contacts: { knows: (e) => e === 'alice@example.com' } });
    await intake.pump();
    const mine = store.getAllEvents().find((e) => e.invite && e.invite.uid === 'shared-uid');
    expect(mine).toBeTruthy();
    expect(mine.title).toBe('Team sync');

    // Mallory is authenticated and known (she is on the guest list of nothing,
    // so allow her explicitly), and sends a REQUEST with the same UID.
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'mallory@evil.example', name: 'Mallory' },
        ical: requestIcal({ uid: 'shared-uid', summary: 'Hijacked', sequence: 9 }),
      }),
    );
    const intake2 = makeIntake({ kv, store, contacts: { knows: () => true } });
    await intake2.pump();

    expect(store.getEvent(mine.id).title).toBe('Team sync');
    const row = intake2.getPending().find((r) => r.title === 'Hijacked');
    expect(row).toBeTruthy();
    expect(row.action).toBe('Add as new');
    expect(row.blockedReason).toMatch(/Conflicts with an existing event/i);
  });

  it('cannot reach an event the user hosts through the calendar.puter.com UID suffix', async () => {
    const { kv, store } = await setup();
    const hosted = await store.saveEvent({
      title: 'My standup',
      start: Date.parse('2026-09-01T09:00:00Z'),
      end: Date.parse('2026-09-01T09:15:00Z'),
      guests: [{ email: 'bob@example.com' }],
    });
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'mallory@evil.example', name: 'Mallory' },
        ical: requestIcal({ uid: `${hosted.id}@calendar.puter.com`, summary: 'Hijacked', sequence: 9 }),
      }),
    );
    const intake = makeIntake({ kv, store, contacts: { knows: () => true } });
    await intake.pump();

    const after = store.getEvent(hosted.id);
    expect(after.title).toBe('My standup');
    // and critically: no `invite` stamped on it, which would have taken it out
    // of RSVP-link sync (rsvp-links.isHosted bails on `invite`).
    expect(after.invite).toBeUndefined();
  });

  // Own-echo rule: this exact shape — a REQUEST addressed via our own
  // UID suffix to an event the user hosts — is now recognized as our own
  // invitation reflected back through a Puter mailbox, and dropped silently
  // rather than trayed as "Add as new" (superseding the old conflict-tray
  // behavior for this specific case; a UID clash with another MAIL-sourced
  // event, tested above, is unaffected).
  it('an own-echo REQUEST (our own UID suffix, an event we host) is dropped silently — never trayed', async () => {
    const { kv, store } = await setup();
    const hosted = await store.saveEvent({
      title: 'My standup',
      start: Date.parse('2026-09-01T09:00:00Z'),
      end: Date.parse('2026-09-01T09:15:00Z'),
    });
    const key = recordKey();
    kv.map.set(
      key,
      makeRecord({
        from: { email: 'mallory@evil.example' },
        auth: { internal: false, dkim: 'none', dkimAligned: false, spf: 'none', received: true },
        ical: requestIcal({ uid: `${hosted.id}@calendar.puter.com`, summary: 'Their meeting' }),
      }),
    );
    const intake = makeIntake({ kv, store, contacts: { knows: () => true } });
    await intake.pump();

    expect(intake.getPending()).toHaveLength(0);
    expect(store.getEvent(hosted.id).title).toBe('My standup');
    expect(store.getAllEvents().find((e) => e.title === 'Their meeting')).toBeUndefined();
    expect(kv.map.has(key)).toBe(false); // deleted, not left for a later pump
  });

  it('the sender who created it can still update it', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'own-uid' }) }));
    const intake = makeIntake({ kv, store, contacts: { knows: () => true } });
    await intake.pump();
    const first = store.getAllEvents().find((e) => e.invite && e.invite.uid === 'own-uid');

    kv.map.set(
      recordKey(),
      makeRecord({ ical: requestIcal({ uid: 'own-uid', summary: 'Team sync (moved)', sequence: 3 }) }),
    );
    const intake2 = makeIntake({ kv, store, contacts: { knows: () => true } });
    await intake2.pump();
    expect(store.getEvent(first.id).title).toBe('Team sync (moved)');
  });
});

describe('being on a stranger\'s guest list does not make you known', () => {
  it('a co-attendee of a mail-added event cannot auto-add on their own', async () => {
    const { kv, store } = await setup();
    // An invitation from Alice that lists Carol as a co-attendee, auto-added.
    kv.map.set(
      recordKey(),
      makeRecord({
        ical: requestIcal({
          uid: 'party-1',
          attendees: [
            { email: 'bob@example.com', status: 'NEEDS-ACTION' },
            { email: 'carol@strangers.example', status: 'NEEDS-ACTION' },
          ],
        }),
      }),
    );
    const intake = makeIntake({ kv, store, contacts: { knows: (e) => e === 'alice@example.com' } });
    await intake.pump();
    const added = store.getAllEvents().find((e) => e.invite && e.invite.uid === 'party-1');
    expect(added).toBeTruthy();
    expect(added.guests.some((g) => g.email === 'carol@strangers.example')).toBe(true);

    // Carol now sends her own invitation. She is on that guest list, but the
    // user never vouched for her.
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'carol@strangers.example', name: 'Carol' },
        ical: requestIcal({ uid: 'carol-1', organizer: 'carol@strangers.example', summary: 'Carol event' }),
      }),
    );
    const intake2 = makeIntake({ kv, store, contacts: { knows: (e) => e === 'alice@example.com' } });
    await intake2.pump();

    expect(store.getAllEvents().find((e) => e.title === 'Carol event')).toBeUndefined();
    // Carol is unknown (guest-list membership on a mail-sourced event doesn't
    // count), so her invitation is hidden entirely, not merely un-added.
    expect(intake2.getPending().some((r) => r.title === 'Carol event')).toBe(false);
  });

  it('a guest on an event the USER created still counts as known', async () => {
    const { kv, store } = await setup();
    await store.saveEvent({
      title: 'My meeting',
      start: Date.parse('2026-09-01T09:00:00Z'),
      end: Date.parse('2026-09-01T10:00:00Z'),
      guests: [{ email: 'dave@example.com' }],
    });
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'dave@example.com', name: 'Dave' },
        ical: requestIcal({ uid: 'dave-1', organizer: 'dave@example.com', summary: 'Dave event' }),
      }),
    );
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(store.getAllEvents().find((e) => e.title === 'Dave event')).toBeTruthy();
  });
});

describe('a failed Add keeps the invitation', () => {
  it('does not delete the record or allow the sender when the write throws', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'fail-1' }), auth: UNAUTHENTICATED }));
    const intake = makeIntake({ kv, store, contacts: KNOWS_EVERYONE });
    await intake.pump();
    const [row] = intake.getPending();
    expect(row).toBeTruthy();

    const boom = new Error("You're offline");
    store.saveEvent = async () => {
      throw boom;
    };
    await expect(intake.accept(row.id)).rejects.toBe(boom);

    expect(intake.getPending()).toHaveLength(1);
    expect(kv.map.has(row.id)).toBe(true);
    expect(intake.getBlocked()).not.toContain('alice@example.com');
    const senders = kv.map.get('cal:mail:senders');
    expect((senders && senders.allowed) || []).not.toContain('alice@example.com');
  });
});

describe('sent-folder correspondents index (cal:mail:corr)', () => {
  it('never runs on the boot pump, runs on the next one, and marks a previously-emailed address as known', async () => {
    const { kv, store } = await setup();
    const fakePuter = {
      email: {
        list: vi.fn(async () => ({ items: [{ id: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', size: 500 }] })),
        get: vi.fn(async () => ({ to: [{ address: 'dana@example.com' }], cc: [], bcc: [] })),
      },
    };
    const intake = makeIntake({ kv, store, getPuter: () => fakePuter });

    await intake.start(); // the boot pump
    expect(fakePuter.email.list).not.toHaveBeenCalled();

    await intake.pump(); // second pump — now it runs
    expect(fakePuter.email.list).toHaveBeenCalledTimes(1);
    expect(fakePuter.email.get).toHaveBeenCalledTimes(1);
    expect(kv.map.get('cal:mail:corr').addresses).toContain('dana@example.com');

    await intake.pump(); // third pump — at most once per session
    expect(fakePuter.email.list).toHaveBeenCalledTimes(1);

    // Dana now emails an invitation of her own; correspondence alone makes
    // her known, even with no contacts entry and no prior calendar history.
    kv.map.set(recordKey(), makeRecord({
      from: { email: 'dana@example.com', name: 'Dana' },
      ical: requestIcal({ uid: 'corr-1', organizer: 'dana@example.com', summary: 'Coffee' }),
    }));
    await intake.pump();
    expect(store.getAllEvents().find((e) => e.title === 'Coffee')).toBeTruthy();
  });

  it('skips a message over 256 KB without fetching it, but still advances past it', async () => {
    const { kv, store } = await setup();
    const fakePuter = {
      email: {
        list: vi.fn(async () => ({
          items: [
            { id: 'dddddddd-dddd-7ddd-8ddd-dddddddddd02', size: 300_000 }, // oversized, newest
            { id: 'dddddddd-dddd-7ddd-8ddd-dddddddddd01', size: 100 },
          ],
        })),
        get: vi.fn(async () => ({ to: [{ address: 'small@example.com' }], cc: [], bcc: [] })),
      },
    };
    const intake = makeIntake({ kv, store, getPuter: () => fakePuter });
    await intake.start();
    await intake.pump();

    expect(fakePuter.email.get).toHaveBeenCalledTimes(1);
    expect(fakePuter.email.get).toHaveBeenCalledWith({ id: 'dddddddd-dddd-7ddd-8ddd-dddddddddd01', folder: 'sent' });
    const stored = kv.map.get('cal:mail:corr');
    expect(stored.addresses).toEqual(['small@example.com']);
    // The watermark still advances past the oversized (skipped) message.
    expect(stored.watermark).toBe('dddddddd-dddd-7ddd-8ddd-dddddddddd02');
  });

  it('keeps at most 500 correspondents, preferring the newest', async () => {
    const { kv, store } = await setup();
    const many = Array.from({ length: 500 }, (_, i) => `old${i}@example.com`);
    kv.map.set('cal:mail:corr', { v: 1, at: Date.now() - 2 * DAY_MS, watermark: '', addresses: many });
    const fakePuter = {
      email: {
        list: vi.fn(async () => ({ items: [{ id: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee', size: 10 }] })),
        get: vi.fn(async () => ({ to: [{ address: 'newcomer@example.com' }], cc: [], bcc: [] })),
      },
    };
    const intake = makeIntake({ kv, store, getPuter: () => fakePuter });
    await intake.start();
    await intake.pump();
    const stored = kv.map.get('cal:mail:corr');
    expect(stored.addresses).toHaveLength(500);
    expect(stored.addresses).toContain('newcomer@example.com');
  });

  it('a rejected list() leaves the existing index untouched and never breaks the pump', async () => {
    const { kv, store } = await setup();
    kv.map.set('cal:mail:corr', { v: 1, at: Date.now() - 2 * DAY_MS, watermark: 'w', addresses: ['keep@example.com'] });
    const fakePuter = { email: { list: vi.fn(async () => { throw new Error('network down'); }), get: vi.fn() } };
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'still-works' }) }));
    const intake = makeIntake({ kv, store, getPuter: () => fakePuter, contacts: KNOWS_EVERYONE });
    await intake.start();
    await intake.pump();
    expect(kv.map.get('cal:mail:corr').addresses).toEqual(['keep@example.com']);
    expect(fakePuter.email.get).not.toHaveBeenCalled();
    // The record pump itself is unaffected by the index refresh failing.
    expect(store.getAllEvents().some((e) => e.invite && e.invite.uid === 'still-works')).toBe(true);
  });

  it('one bad get() does not abort the rest of the pass', async () => {
    const { kv, store } = await setup();
    const fakePuter = {
      email: {
        list: vi.fn(async () => ({
          items: [
            { id: 'cccccccc-cccc-7ccc-8ccc-cccccccccc02', size: 10 },
            { id: 'cccccccc-cccc-7ccc-8ccc-cccccccccc01', size: 10 },
          ],
        })),
        get: vi.fn(async ({ id }) => {
          if (id.endsWith('02')) throw new Error('boom');
          return { to: [{ address: 'ok@example.com' }], cc: [], bcc: [] };
        }),
      },
    };
    const intake = makeIntake({ kv, store, getPuter: () => fakePuter });
    await intake.start();
    await intake.pump();
    expect(kv.map.get('cal:mail:corr').addresses).toContain('ok@example.com');
  });
});

describe('the events socket only opens once the mailbox is connected', () => {
  function makeIntakeWithPuter({ kv, store, mode, onLocal }) {
    let listener = null;
    const mailbox = {
      available: () => true,
      status: () => ({ mode }),
      onChange: (fn) => {
        listener = fn;
        return () => {};
      },
    };
    const intake = createMailIntake({
      kv,
      store,
      mailbox,
      user: { username: 'nariman', email: 'nariman@example.com' },
      toast: vi.fn(),
      blocked: () => false,
      getPuter: () => ({ appID: 'app-1', events: { onLocal } }),
    });
    return { intake, fire: () => listener && listener(), setMode: (m) => (mode = m) };
  }

  it('subscribes to nothing while the mailbox is off', async () => {
    const { kv, store } = await setup();
    const onLocal = vi.fn(() => ({ off: vi.fn() }));
    const { intake } = makeIntakeWithPuter({ kv, store, mode: 'off', onLocal });
    await intake.start();
    expect(onLocal).not.toHaveBeenCalled();
  });

  it('does not subscribe in foreground mode either', async () => {
    const { kv, store } = await setup();
    const onLocal = vi.fn(() => ({ off: vi.fn() }));
    const { intake } = makeIntakeWithPuter({ kv, store, mode: 'foreground', onLocal });
    await intake.start();
    expect(onLocal).not.toHaveBeenCalled();
  });

  it('subscribes when connected in the background, and tears down on disconnect', async () => {
    const { kv, store } = await setup();
    const off = vi.fn();
    const onLocal = vi.fn(() => ({ off }));
    const { intake, fire, setMode } = makeIntakeWithPuter({ kv, store, mode: 'background', onLocal });
    await intake.start();
    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onLocal.mock.calls[0][0]).toBe('kv:app-1:cal:mail:tick');

    // A second mailbox change must not stack a second subscription.
    fire();
    expect(onLocal).toHaveBeenCalledTimes(1);

    setMode('off');
    fire();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('subscribes later, when connecting happens after start()', async () => {
    const { kv, store } = await setup();
    const onLocal = vi.fn(() => ({ off: vi.fn() }));
    const { intake, fire, setMode } = makeIntakeWithPuter({ kv, store, mode: 'off', onLocal });
    await intake.start();
    expect(onLocal).not.toHaveBeenCalled();
    setMode('background');
    fire();
    expect(onLocal).toHaveBeenCalledTimes(1);
  });
});

describe('a forged Sender: header is not an identity', () => {
  // DKIM aligns against the From domain only, so anyone who can sign for their
  // own domain could otherwise name any address at all in Sender: and inherit
  // its authority.
  function forged(extra = {}) {
    return makeRecord({
      from: { email: 'mallory@evil.example', name: 'Mallory' },
      sender: 'alice@example.com',
      auth: { internal: false, dkim: 'pass', dkimAligned: true, spf: 'pass', received: true },
      ...extra,
    });
  }

  it('cannot update an event the real sender created', async () => {
    const { kv, store } = await setup();
    kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: 'u-forge' }) }));
    const intake = makeIntake({ kv, store, contacts: { knows: (e) => e === 'alice@example.com' } });
    await intake.pump();
    const mine = store.getAllEvents().find((e) => e.invite && e.invite.uid === 'u-forge');
    expect(mine.title).toBe('Team sync');

    kv.map.set(
      recordKey(),
      forged({ ical: requestIcal({ uid: 'u-forge', summary: 'Hijacked', sequence: 9 }) }),
    );
    // Mallory is known and authenticated in her OWN right, so she reaches the
    // update path — only the forged Sender: would let her through it.
    const intake2 = makeIntake({ kv, store, contacts: { knows: () => true } });
    await intake2.pump();
    expect(store.getEvent(mine.id).title).toBe('Team sync');
  });

  it('cannot cancel an event it does not really organize', async () => {
    const { kv, store } = await setup();
    const saved = await store.saveEvent({
      title: 'Budget review',
      start: Date.parse('2026-09-01T09:00:00Z'),
      end: Date.parse('2026-09-01T10:00:00Z'),
      organizer: { email: 'alice@example.com' },
      invite: { uid: 'u-forge-cancel', from: 'alice@example.com' },
    });
    kv.map.set(recordKey(), forged({ method: 'CANCEL', mimeMethod: 'CANCEL', ical: cancelIcal({ uid: 'u-forge-cancel' }) }));
    const intake = makeIntake({ kv, store });
    await intake.pump();
    expect(store.getEvent(saved.id)).not.toBeNull();
  });

  it('cannot answer an RSVP on the user\'s own event for a guest', async () => {
    const { kv, store } = await setup();
    const hosted = await store.saveEvent({
      title: 'My standup',
      start: Date.parse('2026-09-01T09:00:00Z'),
      end: Date.parse('2026-09-01T09:15:00Z'),
      guests: [{ email: 'bob@example.com', status: 'needs-action' }],
    });
    kv.map.set(
      recordKey(),
      forged({
        sender: 'bob@example.com',
        method: 'REPLY',
        mimeMethod: 'REPLY',
        ical: replyIcal({
          uid: `${hosted.id}@calendar.puter.com`,
          attendeeEmail: 'bob@example.com',
          partstat: 'ACCEPTED',
        }),
      }),
    );
    const intake = makeIntake({ kv, store });
    await intake.pump();
    const guest = store.getEvent(hosted.id).guests.find((g) => g.email === 'bob@example.com');
    expect(guest.status).toBe('needs-action');
  });
});

describe('a mail-sourced event does not vouch for the people named in it', () => {
  it('its ORGANIZER does not become known', async () => {
    const { kv, store } = await setup();
    // A known correspondent's invitation naming a third party as ORGANIZER.
    kv.map.set(
      recordKey(),
      makeRecord({ ical: requestIcal({ uid: 'u-relay', organizer: 'stranger@elsewhere.example' }) }),
    );
    const intake = makeIntake({ kv, store, contacts: { knows: (e) => e === 'alice@example.com' } });
    await intake.pump();
    expect(store.getAllEvents().find((e) => e.invite && e.invite.uid === 'u-relay')).toBeTruthy();

    // That third party now writes in on their own account.
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'stranger@elsewhere.example', name: 'Stranger' },
        ical: requestIcal({ uid: 'u-stranger', organizer: 'stranger@elsewhere.example', summary: 'Stranger event' }),
      }),
    );
    const intake2 = makeIntake({ kv, store, contacts: { knows: (e) => e === 'alice@example.com' } });
    await intake2.pump();
    expect(store.getAllEvents().find((e) => e.title === 'Stranger event')).toBeUndefined();
    expect(intake2.getPending()).toHaveLength(0);
  });
});

describe('the apply budget is not a way past the prior-interaction rule', () => {
  it('an unknown CANCEL naming nothing stays hidden even in the over-budget branch', async () => {
    const { kv, store } = await setup();
    // Oldest record, so the pump reaches it last — after the per-pump apply
    // budget is spent and the over-budget branch takes over.
    kv.map.set(
      recordKey(),
      makeRecord({
        from: { email: 'mallory@evil.example', name: 'Mallory' },
        method: 'CANCEL',
        mimeMethod: 'CANCEL',
        ical: cancelIcal({ uid: 'u-nothing-at-all' }),
      }),
    );
    // 26 auto-addable invitations from someone known: one more than
    // PUMP_APPLY_CAP (25).
    for (let i = 0; i < 26; i++) {
      kv.map.set(recordKey(), makeRecord({ ical: requestIcal({ uid: `u-bulk-${i}` }) }));
    }

    const intake = makeIntake({ kv, store, contacts: { knows: (e) => e === 'alice@example.com' } });
    await intake.pump();

    // The budget really was exhausted (otherwise this proves nothing).
    expect(store.getAllEvents().length).toBe(25);
    expect(intake.getPending().some((r) => r.kind === 'cancel')).toBe(false);
  });
});
