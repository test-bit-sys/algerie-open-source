import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { createStore } from '../src/js/store.js';
import { materializeOccurrence, expandOccurrences } from '../src/js/recurrence.js';
import { createRsvpLinks } from '../src/js/rsvp-links.js';
import { createInvites, digest, describeWhen, describeResult, describeCancelResult, EMAIL_WORKER_URL } from '../src/js/invites.js';
import { instantiateWorker, makeKv, makeFakePuter, bridgeFetch } from './helpers/worker-harness.js';

// rsvp-links (and the worker it deploys) use WebCrypto; jsdom doesn't ship it.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const EMAIL_WORKER_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/workers/email-worker.js'),
  'utf8',
);

const HOUR = 3_600_000;
const HOST = { email: 'host@example.com', uuid: 'user-uuid-1' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function settle(rsvp) {
  for (let i = 0; i < 3; i++) {
    await tick();
    await rsvp.whenIdle();
  }
}

/**
 * The whole path in one place: a store, the user's own RSVP worker (which
 * mints the links), and the app-owned email worker the invitations go
 * through — with `puter.workers.exec` bridged to it the way the real SDK
 * bridges it, caller session and all.
 */
const STUB_LINK = 'https://cal-rsvp-stub01.puter.work/rsvp/' + 'c1d2'.repeat(10);

/**
 * A stand-in for rsvp-links with the timing under the test's control: no guest
 * has a link until `mintLinks` says so. The real module mints them within a
 * tick or two of a save, which is exactly what makes "still waiting" hard to
 * observe with it.
 */
function stubRsvpLinks() {
  let links = {};
  const listeners = new Set();
  return {
    isHosted: (ev) => (ev.guests || []).some((g) => g.email !== HOST.email),
    linkableGuests: (ev) => (ev.guests || []).filter((g) => g.email !== HOST.email),
    linksFor: () => ({ ...links }),
    onUpdate: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    mint(map, eventId) {
      links = map;
      for (const cb of [...listeners]) cb(eventId);
    },
  };
}

/**
 * `user`, `requestUser` and `requestEmail` shape what invites knows about the
 * host (the RSVP worker always knows HOST): who boot said I was, what a fresh
 * getUser() says, and what Puter's permission prompt would answer.
 */
function makeWorld({
  offline = false,
  readyTimeoutMs = 120_000,
  stubRsvp = false,
  user = HOST,
  requestUser,
  requestEmail,
} = {}) {
  const kv = makeKv();
  const store = createStore(kv);
  const fakePuter = makeFakePuter();
  const rsvp = stubRsvp
    ? stubRsvpLinks()
    : createRsvpLinks({
        kv,
        store,
        user: HOST,
        getPuter: () => fakePuter,
        fetchFn: bridgeFetch(fakePuter),
        blocked: () => false,
        requestUser: async () => HOST,
        syncDelayMs: 0,
      });

  const mail = [];
  const send = vi.fn(async (message) => {
    mail.push(message);
    return { messageId: `m${mail.length}`, cost: 25, suppressed: [], failed: [] };
  });
  const emailKv = makeKv();
  const emailWorker = instantiateWorker(EMAIL_WORKER_SRC, {
    kv: emailKv,
    me: { puter: { kv: emailKv, authToken: 'owner-token', email: { send } } },
  });
  let status = null; // when set, exec answers with this instead of the worker
  const exec = vi.fn(async (url, init = {}) => {
    if (status) {
      return {
        ok: false,
        status,
        json: async () => ({ error: status === 429 ? 'daily_limit' : 'sign_in_required' }),
      };
    }
    const parsed = new URL(url);
    return emailWorker.call(init.method || 'GET', parsed.pathname + parsed.search, {
      headers: init.headers || {},
      body: init.body,
      user: { ...HOST, puter: { authToken: 'caller-token' } },
    });
  });

  let blocked = offline;
  const toasts = [];
  const invites = createInvites({
    kv,
    store,
    rsvp,
    user,
    requestUser,
    requestEmail,
    getPuter: () => ({ ...fakePuter, workers: { ...fakePuter.workers, exec } }),
    blocked: () => blocked,
    toast: (message, opts) => toasts.push({ message, variant: (opts && opts.variant) || 'default' }),
    readyTimeoutMs,
  });

  return {
    kv,
    store,
    rsvp,
    invites,
    mail,
    send,
    exec,
    toasts,
    emailWorker,
    setBlocked: (v) => {
      blocked = v;
    },
    setStatus: (v) => {
      status = v;
    },
  };
}

async function hostEvent(store, overrides = {}) {
  const start = Date.now() + 24 * HOUR;
  return store.saveEvent({
    title: 'Team offsite',
    start,
    end: start + 2 * HOUR,
    location: 'Pier 39',
    organizer: { email: HOST.email, name: 'Nariman' },
    guests: [
      { email: HOST.email, status: 'accepted' },
      { email: 'ada@example.com', name: 'Ada', status: 'needs-action' },
    ],
    ...overrides,
  });
}

describe('invites: digest and formatting', () => {
  it('changes only when what the guest sees changes', () => {
    const base = { title: 'Standup', when: 'Mon' };
    expect(digest([base, 'link'])).toBe(digest([{ ...base }, 'link']));
    expect(digest([base, 'link'])).not.toBe(digest([{ ...base, title: 'Standup!' }, 'link']));
    // A re-issued RSVP link is reason enough to write again.
    expect(digest([base, 'link'])).not.toBe(digest([base, 'other-link']));
    expect(digest([base, 'link'])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('names the time zone, which the in-app card can take for granted', () => {
    // The times are formatted in the machine's zone, which callers always name;
    // run as an organizer in Los Angeles so CI's UTC clock reads the same.
    const zone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const start = new Date('2026-08-13T17:00:00Z').getTime();
      const when = describeWhen({ start, end: start + HOUR }, {
        hour12: true,
        tz: 'America/Los_Angeles',
      });
      expect(when).toContain('10\u00a0AM'); // no-break space before AM/PM
      expect(when).toContain('(PDT)');
      expect(
        describeWhen({ start, end: start + 24 * HOUR, allDay: true }, { tz: 'UTC' }),
      ).toContain('All day');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

describe('invites: what needs sending', () => {
  let world;
  let event;
  beforeEach(async () => {
    world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    event = await hostEvent(world.store);
    await settle(world.rsvp);
    await world.invites.start();
  });

  it('plans for guests with a link, never for the host themself', () => {
    const plan = world.invites.planFor(event);
    expect(plan.ready.map((r) => r.email)).toEqual(['ada@example.com']);
    expect(plan.pending).toHaveLength(1);
    expect(plan.waiting).toBe(0);
    expect(plan.lastSentAt).toBe(0);
    expect(plan.ready[0].rsvpUrl).toMatch(/^https:\/\/cal-rsvp-[0-9a-f]+\.puter\.work\/rsvp\/[0-9a-f]{40}$/);
  });

  it('counts a guest whose link is not minted yet as waiting, not sendable', async () => {
    const solo = makeWorld();
    await solo.store.load();
    const ev = await hostEvent(solo.store); // no rsvp pass — no links yet
    await solo.invites.start();
    const plan = solo.invites.planFor(ev);
    expect(plan.ready).toHaveLength(0);
    expect(plan.waiting).toBe(1);
  });

  it('plans nothing for an event someone else organizes', async () => {
    const theirs = await world.store.saveEvent({
      title: 'Their party',
      start: Date.now() + HOUR,
      end: Date.now() + 2 * HOUR,
      organizer: { email: 'someone@else.com' },
      guests: [{ email: HOST.email, status: 'needs-action' }],
    });
    expect(world.invites.planFor(theirs).ready).toHaveLength(0);
  });
});

describe('invites: sending', () => {
  let world;
  let event;
  beforeEach(async () => {
    world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    event = await hostEvent(world.store);
    await settle(world.rsvp);
    await world.invites.start();
  });

  it('emails each pending guest their own invitation, with the event attached', async () => {
    const out = await world.invites.send(event);
    expect(out.sent).toBe(1);
    expect(world.exec).toHaveBeenCalledWith(`${EMAIL_WORKER_URL}/invites`, expect.anything());

    const [message] = world.mail;
    expect(message.to).toBe('ada@example.com');
    expect(message.subject).toMatch(/^Invitation: Team offsite — /);
    expect(message.text).toContain('Pier 39');
    expect(message.text).toContain(world.invites.planFor(event).ready[0].rsvpUrl + '/accept');
    expect(message.replyTo).toBe(HOST.email);

    // A real iTIP invitation: the guest's mail client renders working native
    // RSVP buttons only for METHOD:REQUEST, with the instant pinned to a zone
    // (a floating time files the event hours off for guests elsewhere) and a
    // SEQUENCE for updates to supersede earlier copies by.
    const ics = Buffer.from(message.attachments[0].content, 'base64').toString('utf8');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('SUMMARY:Team offsite');
    expect(ics).toMatch(/DTSTART;TZID=[A-Za-z0-9_+/-]+:/);
    expect(ics).toMatch(/^SEQUENCE:\d+\r$/m);
    expect(ics).toContain(`ORGANIZER;CN="Nariman":mailto:${HOST.email}`);
    expect(ics).toContain('ATTENDEE;CN="Ada";PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ada@example.com');
  });

  it('carries a personal note from the host into the message', async () => {
    await world.invites.send(event, { note: 'Ferry leaves at 8 sharp — bring a coat.' });
    expect(world.mail[0].text).toContain('Ferry leaves at 8 sharp');
    expect(world.mail[0].html).toContain('Ferry leaves at 8 sharp');
  });

  it('remembers who was sent what, and offers nothing more until something changes', async () => {
    await world.invites.send(event);
    const plan = world.invites.planFor(event);
    expect(plan.pending).toHaveLength(0);
    expect(plan.ready[0]).toMatchObject({ current: true });
    expect(plan.ready[0].sentAt).toBeGreaterThan(0);
    expect(world.kv.map.get(`cal:invite:${event.id}`)['ada@example.com'].v).toHaveLength(16);

    // Nothing pending: no call, no mail, no error.
    world.exec.mockClear();
    expect((await world.invites.send(event)).sent).toBe(0);
    expect(world.exec).not.toHaveBeenCalled();
    expect(world.mail).toHaveLength(1);
  });

  it('sends an update — labelled as one — after the event changes', async () => {
    await world.invites.send(event);
    const moved = await world.store.saveEvent({ ...event, location: 'Pier 41' });
    await settle(world.rsvp);

    const plan = world.invites.planFor(moved);
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0].sentAt).toBeGreaterThan(0); // known guest, stale invitation

    expect((await world.invites.send(moved)).sent).toBe(1);
    expect(world.mail[1].subject).toMatch(/^Updated invitation: /);
    expect(world.mail[1].text).toContain('Pier 41');
  });

  it.each(['title', 'description', 'location', 'time', 'allDay', 'delete'])('detects a guest-visible occurrence change: %s', async (change) => {
    event = await world.store.saveEvent({ ...event, recurrence: { freq: 'daily', interval: 1 } });
    await settle(world.rsvp);
    await world.invites.send(event);
    const rid = event.start + 24 * HOUR;
    const originalVersion = world.invites.planFor(event).ready[0].version;
    let result;
    if (change === 'delete') result = await world.store.deleteOccurrence(event.id, rid);
    else {
      const patch = change === 'time' ? { start: rid + HOUR, end: rid + 3 * HOUR }
        : change === 'allDay' ? { allDay: true } : { [change]: 'Changed occurrence' };
      result = await world.store.updateOccurrence(event.id, rid, patch);
    }
    expect(world.invites.planFor(event).pending).toHaveLength(1);
    expect(world.invites.planFor(event).ready[0].version).not.toBe(originalVersion);
    expect((await world.invites.send(event)).sent).toBe(1);
    expect(world.mail[1].subject).toMatch(/^Updated invitation:/);
    const ics = Buffer.from(world.mail[1].attachments[0].content, 'base64').toString('utf8');
    expect(ics).toContain(change === 'delete' ? 'EXDATE' : 'RECURRENCE-ID');
    if (['title', 'description', 'location'].includes(change)) expect(ics).toContain('Changed occurrence');
    expect(world.invites.planFor(event).pending).toHaveLength(0);
    await result.undo();
    expect(world.invites.planFor(event).pending).toHaveLength(1); // guests need the restored schedule
    expect((await world.invites.send(event)).sent).toBe(1);
  });

  it('does not reflag unchanged series for local-only or no-op overrides', async () => {
    event = await world.store.saveEvent({ ...event, recurrence: { freq: 'daily', interval: 1 } });
    await settle(world.rsvp);
    await world.invites.send(event);
    const version = world.invites.planFor(event).ready[0].version;
    const rid = event.start + 24 * HOUR;
    await world.store.updateOccurrence(event.id, rid, {
      color: 'red', reminders: [5], title: event.title, description: event.description,
      location: event.location, start: rid, end: rid + event.end - event.start,
      allDay: event.allDay,
    });
    expect(world.invites.planFor(event).ready[0].version).toBe(version);
    expect(world.invites.planFor(event).pending).toHaveLength(0);
    expect((await world.invites.send(event)).sent).toBe(0);
  });

  it('treats reordered exception maps as the same invitation', async () => {
    event = await world.store.saveEvent({ ...event, recurrence: { freq: 'daily', interval: 1 } });
    const first = event.start + 24 * HOUR;
    const second = first + 24 * HOUR;
    await world.store.updateOccurrence(event.id, first, { title: 'First' });
    await world.store.updateOccurrence(event.id, second, { location: 'Second' });
    await settle(world.rsvp);
    await world.invites.send(event);
    const master = world.store.getEvent(event.id);
    await world.store.saveEvent({ ...master, overrides: Object.fromEntries(Object.entries(master.overrides).reverse()) });
    expect(world.invites.planFor(event).pending).toHaveLength(0);
  });

  it('sends a first invitation to a guest added later, and nothing to the rest', async () => {
    await world.invites.send(event);
    const grown = await world.store.saveEvent({
      ...event,
      guests: [...event.guests, { email: 'bob@example.com', status: 'needs-action' }],
    });
    await settle(world.rsvp);

    const out = await world.invites.send(grown);
    expect(out.sent).toBe(1);
    expect(world.mail[1].to).toBe('bob@example.com');
    expect(world.mail[1].subject).toMatch(/^Invitation: /); // not an "update" for them
  });

  it('a mixed send labels each guest by what they hold — update for the stale, invitation for the new', async () => {
    await world.invites.send(event); // ada holds the original invitation
    const grownMoved = await world.store.saveEvent({
      ...event,
      location: 'Pier 41', // ada's copy is now stale…
      guests: [...event.guests, { email: 'bob@example.com', status: 'needs-action' }], // …and bob is new
    });
    await settle(world.rsvp);

    const out = await world.invites.send(grownMoved);
    expect(out.sent).toBe(2);
    const subjects = Object.fromEntries(world.mail.slice(1).map((m) => [m.to, m.subject]));
    expect(subjects['bob@example.com']).toMatch(/^Invitation: /);
    // Ada's only news is the change — a fresh "Invitation:" reads as a
    // duplicate of the mail she already has, and the new location gets missed.
    expect(subjects['ada@example.com']).toMatch(/^Updated invitation: /);
  });

  it('resends to everyone when explicitly asked', async () => {
    await world.invites.send(event);
    const all = world.invites.planFor(event).ready.map((r) => r.email);
    const out = await world.invites.send(event, { emails: all, force: true });
    expect(out.sent).toBe(1);
    expect(world.mail).toHaveLength(2);
    expect(world.mail[1].to).toBe('ada@example.com');
  });

  it('records what the worker says it already sent, so it stops offering to', async () => {
    // Another device sent this exact invitation; this one never heard.
    await world.invites.send(event);
    world.kv.map.delete(`cal:invite:${event.id}`);
    const fresh = makeWorld();
    await fresh.store.load();
    // Same worker state, different app cache: the reply heals the cache.
    const out = await world.invites.send(event, {
      emails: ['ada@example.com'],
    });
    expect(out.sent).toBe(0);
    expect(out.results[0].status).toBe('skipped');
    expect(world.mail).toHaveLength(1);
    expect(fresh.mail).toHaveLength(0);
  });
});

describe('invites: sending once the links exist', () => {
  /** Let a send that was triggered from a callback run to completion. */
  const drain = async () => {
    for (let i = 0; i < 6; i++) await tick();
  };

  it('holds the invitation until the guest has a link, then sends it', async () => {
    const world = makeWorld({ stubRsvp: true });
    await world.store.load();
    const event = await hostEvent(world.store); // saved, but no links yet
    await world.invites.start();

    world.invites.sendWhenReady(event);
    await drain();
    // Nothing goes out half-prepared: mailing the ready guests now would leave
    // the rest needing a press the host has no reason to expect.
    expect(world.mail).toHaveLength(0);

    world.rsvp.mint({ 'ada@example.com': STUB_LINK }, event.id);
    await drain();
    expect(world.mail).toHaveLength(1);
    expect(world.mail[0].to).toBe('ada@example.com');
    expect(world.mail[0].text).toContain(`${STUB_LINK}/accept`);
    expect(world.toasts.at(-1)).toEqual({ message: 'Invitation sent', variant: 'success' });
  });

  it('updates the historical half without waiting for uninvited guests to get links', async () => {
    const world = makeWorld({ stubRsvp: true });
    await world.store.load();
    const event = await hostEvent(world.store);
    await world.invites.start();
    world.rsvp.mint({ 'ada@example.com': STUB_LINK }, event.id);
    await world.invites.send(event);
    await world.store.saveEvent({ ...event, title: 'Shortened series', guests: [...event.guests, { email: 'bob@example.com' }] });
    world.invites.sendWhenReady({ id: event.id }, { previouslyInvitedOnly: true });
    await drain();
    expect(world.mail).toHaveLength(2);
    expect(world.mail[1].to).toBe('ada@example.com');
    expect(world.mail[1].subject).toContain('Updated invitation: Shortened series');
    expect(world.toasts.at(-1).variant).toBe('success');
  });

  it('rechecks a split before sending an invitation queued behind another send', async () => {
    const world = makeWorld({ stubRsvp: true });
    await world.store.load();
    const event = await hostEvent(world.store);
    await world.invites.start();
    world.rsvp.mint({ 'ada@example.com': STUB_LINK }, event.id);
    let release, began;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { began = resolve; });
    world.send.mockImplementationOnce(async (mail) => {
      began();
      await gate;
      world.mail.push(mail);
      return { messageId: 'first', failed: [], suppressed: [] };
    });
    const sending = world.invites.send(event);
    await started;
    let valid = true;
    await world.store.saveEvent({ ...event, title: 'Split edit' });
    world.invites.sendWhenReady({ id: event.id }, { canSend: () => valid });
    valid = false;
    release();
    await sending;
    await drain();
    expect(world.mail).toHaveLength(1);
    expect(world.exec).toHaveBeenCalledTimes(1);
  });

  it('waits for the last guest, not the first', async () => {
    const world = makeWorld({ stubRsvp: true });
    await world.store.load();
    const event = await hostEvent(world.store, {
      guests: [
        { email: HOST.email, status: 'accepted' },
        { email: 'ada@example.com', status: 'needs-action' },
        { email: 'bob@example.com', status: 'needs-action' },
      ],
    });
    await world.invites.start();

    world.invites.sendWhenReady(event);
    world.rsvp.mint({ 'ada@example.com': STUB_LINK }, event.id); // only one of two
    await drain();
    expect(world.mail).toHaveLength(0);

    world.rsvp.mint(
      { 'ada@example.com': STUB_LINK, 'bob@example.com': STUB_LINK.replace('c1d2c1d2', 'e5f6e5f6') },
      event.id,
    );
    await drain();
    expect(world.mail.map((m) => m.to)).toEqual(['ada@example.com', 'bob@example.com']);
  });

  it('mails a fresh event\'s guests once the real RSVP worker has caught up', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const event = await hostEvent(world.store);
    await world.invites.start();

    world.invites.sendWhenReady(event);
    await settle(world.rsvp);
    await drain();
    expect(world.mail).toHaveLength(1);
    expect(world.mail[0].to).toBe('ada@example.com');
  });

  it('sends straight away when the links are already there', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const event = await hostEvent(world.store);
    await settle(world.rsvp);
    await world.invites.start();

    world.invites.sendWhenReady(event);
    await drain();
    expect(world.mail).toHaveLength(1);
  });

  it('says who it could not reach when the links never arrive', async () => {
    const world = makeWorld({ readyTimeoutMs: 20, stubRsvp: true });
    await world.store.load();
    const event = await hostEvent(world.store);
    await world.invites.start();

    world.invites.sendWhenReady(event);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await drain();
    expect(world.mail).toHaveLength(0);
    expect(world.toasts.at(-1)).toMatchObject({
      variant: 'danger',
      message: expect.stringContaining('Could not prepare RSVP links for 1 guest'),
    });
  });

  it('mails a guest once even if two saves both said yes', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const event = await hostEvent(world.store);
    await settle(world.rsvp);
    await world.invites.start();

    world.invites.sendWhenReady(event);
    world.invites.sendWhenReady(event);
    await drain();
    // The second pass reaches the worker, which recognizes the invitation it
    // just sent and declines to repeat it.
    expect(world.mail).toHaveLength(1);
  });

  it('never lets two sends for one event overlap on the wire', async () => {
    // puter.kv has no transactions: two requests arriving together can both
    // pass the worker's already-sent check before either has recorded a
    // send. So the app itself puts the second behind the first — whatever
    // the network does to their timing. Make the worker slow enough that an
    // unqueued pair would certainly overlap.
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const event = await hostEvent(world.store);
    await settle(world.rsvp);
    await world.invites.start();

    const inner = world.exec.getMockImplementation();
    let concurrent = 0;
    let peak = 0;
    world.exec.mockImplementation(async (url, init) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        return await inner(url, init);
      } finally {
        concurrent -= 1;
      }
    });

    const [first, second] = await Promise.all([world.invites.send(event), world.invites.send(event)]);
    expect(peak).toBe(1);
    expect(world.mail).toHaveLength(1);
    expect(first.sent).toBe(1);
    // Re-planned after the first send had persisted its log, the second found
    // nobody left to write to.
    expect(second.sent).toBe(0);
    expect(second.failed).toBe(0);
  });

  it('stays quiet when the answer is that nothing needed sending', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const event = await hostEvent(world.store);
    await settle(world.rsvp);
    await world.invites.start();
    await world.invites.send(event); // everyone is current
    const before = world.toasts.length;

    world.invites.sendWhenReady(event);
    await drain();
    expect(world.mail).toHaveLength(1);
    expect(world.toasts).toHaveLength(before); // no "already has this" seconds later
  });

  it('does not queue a send while offline', async () => {
    const world = makeWorld({ offline: true });
    await world.store.load();
    const event = await hostEvent(world.store);
    await world.invites.start();
    world.invites.sendWhenReady(event);
    await drain();
    expect(world.mail).toHaveLength(0);
  });
});

describe('invites: refusals', () => {
  let world;
  let event;
  beforeEach(async () => {
    world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    event = await hostEvent(world.store);
    await settle(world.rsvp);
    await world.invites.start();
  });

  it('refuses to send while offline', async () => {
    world.setBlocked(true);
    await expect(world.invites.send(event)).rejects.toThrow(/offline/i);
    expect(world.mail).toHaveLength(0);
  });

  it('turns the worker\'s refusals into something a person can act on', async () => {
    world.setStatus(401);
    await expect(world.invites.send(event)).rejects.toThrow(/Sign in to Puter/);
    world.setStatus(429);
    await expect(world.invites.send(event)).rejects.toThrow(/invitation limit/);
  });

  it('refuses an event it does not host', async () => {
    const theirs = await world.store.saveEvent({
      title: 'Their party',
      start: Date.now() + HOUR,
      end: Date.now() + 2 * HOUR,
      organizer: { email: 'someone@else.com' },
      guests: [{ email: HOST.email, status: 'needs-action' }],
    });
    await expect(world.invites.send(theirs)).rejects.toThrow(/organizer/i);
  });

  it('forgets the log of an event that no longer exists', async () => {
    await world.invites.send(event);
    expect(world.kv.map.has(`cal:invite:${event.id}`)).toBe(true);
    await world.store.deleteEvent(event.id);

    const reboot = createInvites({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      getPuter: () => null,
      blocked: () => false,
    });
    await reboot.start();
    expect(world.kv.map.has(`cal:invite:${event.id}`)).toBe(false);
  });

  it('does nothing at all without the worker bridge', async () => {
    const bare = createInvites({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      getPuter: () => ({ workers: {} }),
      blocked: () => false,
    });
    expect(bare.available()).toBe(false);
    await expect(bare.send(event)).rejects.toThrow(/Puter SDK/);
    expect(bare.cancellationFor(event)).toBeNull();
  });
});

describe('invites: cancelling a deleted event', () => {
  let world;
  let event;
  beforeEach(async () => {
    world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    event = await hostEvent(world.store);
    await settle(world.rsvp);
    await world.invites.start();
  });

  it('has nothing to cancel while nobody has been emailed', () => {
    expect(world.invites.cancellationFor(event)).toBeNull();
  });

  it('withdraws only removed, previously emailed guests and preserves everyone else', async () => {
    event = await world.store.saveEvent({ ...event, guests: [...event.guests, { email: 'bob@example.com' }] });
    await settle(world.rsvp);
    await world.invites.send(event);
    const bobLog = world.kv.map.get(`cal:invite:${event.id}`)['bob@example.com'];
    const saved = await world.store.saveEvent({ ...event, guests: event.guests.filter((g) => g.email !== 'ada@example.com') });
    const cancel = await world.invites.removedGuestsFor(event, saved);
    expect(cancel.recipients.map((r) => r.email)).toEqual(['ada@example.com']);
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(1);
    const mail = world.mail.at(-1);
    expect(mail.to).toBe('ada@example.com');
    expect(mail.subject).toMatch(/^Invitation cancelled:/);
    expect(mail.text).toContain('cancelled your invitation');
    expect(mail.text).toContain('event remains scheduled for the other guests');
    const ics = Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain(`UID:${event.id}@calendar.puter.com`);
    expect(ics).not.toContain('STATUS:');
    expect(ics.match(/^ATTENDEE.*$/gm)).toHaveLength(1);
    expect(ics).toContain('mailto:ada@example.com');
    expect(ics).not.toContain('mailto:bob@example.com');
    expect(world.store.getEvent(event.id)).toBeTruthy();
    expect(world.kv.map.get(`cal:invite:${event.id}`)).toEqual({ 'bob@example.com': bobLog });
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(0);

    const restored = await world.store.saveEvent(event);
    await settle(world.rsvp);
    expect(world.invites.planFor(restored).pending.map((r) => r.email)).toEqual(['ada@example.com']);
    expect((await world.invites.send(restored)).sent).toBe(1);
  });

  it('does not offer removals for unsent guests, retained guests, or someone else’s event', async () => {
    const saved = { ...event, guests: [] };
    expect(await world.invites.removedGuestsFor(event, saved)).toBeNull();
    await world.invites.send(event);
    expect(await world.invites.removedGuestsFor(event, event)).toBeNull();
    expect(await world.invites.removedGuestsFor({ ...event, organizer: { email: 'other@example.com' } }, saved)).toBeNull();
  });

  it('filters guests added back before sending, and keeps failures available for retry', async () => {
    event = await world.store.saveEvent({ ...event, guests: [...event.guests, { email: 'bob@example.com' }] });
    await settle(world.rsvp);
    await world.invites.send(event);
    const saved = await world.store.saveEvent({ ...event, guests: [] });
    const cancel = await world.invites.removedGuestsFor(event, saved);
    await world.store.saveEvent({ ...saved, guests: [{ email: 'bob@example.com' }] });
    world.send.mockResolvedValueOnce({ failed: ['ada@example.com'] });
    expect((await world.invites.sendCancellation(cancel)).failed).toBe(1);
    expect(Object.keys(world.kv.map.get(`cal:invite:${event.id}`)).sort()).toEqual(['ada@example.com', 'bob@example.com']);
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(1);
    expect(world.mail.at(-1).to).toBe('ada@example.com');
    await world.store.saveEvent(event);
    const count = world.mail.length;
    await expect(world.invites.sendCancellation(cancel)).rejects.toThrow('added back');
    expect(world.mail).toHaveLength(count);
  });

  it.each([false, true])('limits removal from a split series to this and following occurrences (allDay=%s)', async (allDay) => {
    const start = new Date(2026, 8, 8, allDay ? 0 : 9).getTime();
    event = await world.store.saveEvent({ ...event, start, end: start + (allDay ? 24 : 1) * HOUR - (allDay ? 1 : 0), allDay,
      recurrence: { freq: 'daily', interval: 1 } });
    await settle(world.rsvp);
    await world.invites.send(event);
    const rid = start + 24 * HOUR;
    const split = await world.store.updateFuture(event.id, rid, { guests: [] });
    const cancel = await world.invites.removedGuestsFor(event, split.event, { recurrenceId: rid });
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(1);
    const mail = world.mail.at(-1);
    const ics = Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
    expect(ics).toContain(`UID:${event.id}@calendar.puter.com`);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain(allDay
      ? 'RECURRENCE-ID;VALUE=DATE;RANGE=THISANDFUTURE:20260909'
      : ';RANGE=THISANDFUTURE:20260909T090000');
    expect(ics).not.toContain('STATUS:');
    expect(mail.text).toContain('Earlier occurrences are unchanged');
    expect(world.kv.map.get(`cal:invite:${event.id}`)['ada@example.com']).toBeTruthy();
    await split.undo();
    await expect(world.invites.sendCancellation(cancel)).rejects.toThrow('event changed');
  });

  it('serializes removal and remaining-guest updates without restoring the removed guest’s sent record', async () => {
    event = await world.store.saveEvent({ ...event, guests: [...event.guests, { email: 'bob@example.com' }] });
    await settle(world.rsvp);
    await world.invites.send(event);
    const saved = await world.store.saveEvent({ ...event, title: 'Updated offsite', guests: [{ email: 'bob@example.com' }] });
    const cancel = await world.invites.removedGuestsFor(event, saved);
    await Promise.all([world.invites.sendCancellation(cancel), world.invites.send(saved)]);
    expect(Object.keys(world.kv.map.get(`cal:invite:${event.id}`))).toEqual(['bob@example.com']);
    expect(world.invites.planFor(saved).pending).toHaveLength(0);
  });

  it('waits for an invitation already being delivered before checking removed guests', async () => {
    let release;
    let started;
    const pending = new Promise((resolve) => { release = resolve; });
    const began = new Promise((resolve) => { started = resolve; });
    world.send.mockImplementationOnce(async (message) => {
      started();
      await pending;
      world.mail.push(message);
      return { messageId: 'first', failed: [], suppressed: [] };
    });
    const sending = world.invites.send(event);
    await began;
    const saved = await world.store.saveEvent({ ...event, guests: [] });
    const preparing = world.invites.removedGuestsFor(event, saved);
    release();
    await sending;
    const cancel = await preparing;
    expect(cancel.recipients.map((r) => r.email)).toEqual(['ada@example.com']);
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(1);
  });

  it('clears only successfully withdrawn guests after a partial delivery failure', async () => {
    event = await world.store.saveEvent({ ...event, guests: [...event.guests, { email: 'bob@example.com' }] });
    await settle(world.rsvp);
    await world.invites.send(event);
    const saved = await world.store.saveEvent({ ...event, guests: [] });
    const cancel = await world.invites.removedGuestsFor(event, saved);
    world.send.mockResolvedValueOnce({ failed: ['ada@example.com'] });
    const result = await world.invites.sendCancellation(cancel);
    expect(result).toMatchObject({ sent: 1, failed: 1 });
    expect(Object.keys(world.kv.map.get(`cal:invite:${event.id}`))).toEqual(['ada@example.com']);
  });

  it('snapshots the emailed guests — even one since removed from the list', async () => {
    await world.invites.send(event);
    const invited = world.invites.planFor(event).ready[0];
    const cancel = world.invites.cancellationFor(event);
    expect(cancel.eventId).toBe(event.id);
    expect(cancel.recipients).toEqual([
      { email: 'ada@example.com', name: 'Ada', version: expect.stringMatching(/^[0-9a-f]{16}$/) },
    ]);
    // Its own digest, not the invitation's: the worker would otherwise skip
    // the cancellation as a message it already sent.
    expect(cancel.recipients[0].version).not.toBe(invited.version);

    // Dropping Ada from the guest list does not un-send her invitation — she
    // still believes the event is on, so she is still owed the cancellation.
    const withoutAda = await world.store.saveEvent({
      ...event,
      guests: [{ email: HOST.email, status: 'accepted' }],
    });
    const still = world.invites.cancellationFor(withoutAda);
    expect(still.recipients.map((r) => r.email)).toEqual(['ada@example.com']);
    expect(still.recipients[0].name).toBe(''); // the list no longer knows her name
  });

  it('emails an iTIP CANCEL that supersedes the invitation, with no links in it', async () => {
    await world.invites.send(event);
    const invitationIcs = Buffer.from(world.mail[0].attachments[0].content, 'base64').toString('utf8');
    const invitationSeq = Number(/^SEQUENCE:(\d+)\r$/m.exec(invitationIcs)[1]);

    const cancel = world.invites.cancellationFor(event);
    await world.store.deleteEvent(event.id);
    const out = await world.invites.sendCancellation(cancel);
    expect(out.sent).toBe(2);
    expect(world.exec).toHaveBeenCalledWith(`${EMAIL_WORKER_URL}/cancellations`, expect.anything());

    const message = world.mail[1];
    expect(message.to).toBe('ada@example.com');
    expect(message.subject).toMatch(/^Cancelled: Team offsite — /);
    expect(message.text).toContain('cancelled an event you were invited to');
    expect(message.text).not.toContain('/rsvp/'); // her link is being revoked with the event
    expect(message.attachments[0].filename).toBe('cancel.ics');

    // Same UID as the invitation, a later SEQUENCE, and the two cancellation
    // markers — what the guest's calendar needs to retract its copy.
    const ics = Buffer.from(message.attachments[0].content, 'base64').toString('utf8');
    expect(ics).toContain(`UID:${event.id}@calendar.puter.com`);
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(Number(/^SEQUENCE:(\d+)\r$/m.exec(ics)[1])).toBeGreaterThan(invitationSeq);

    // The record of who was mailed the invitation answered its last question.
    expect(world.kv.map.has(`cal:invite:${event.id}`)).toBe(false);
  });

  it('sends one cancellation per recipient even when two devices both ask', async () => {
    await world.invites.send(event);
    const cancel = world.invites.cancellationFor(event);
    await world.store.deleteEvent(event.id);
    await world.invites.sendCancellation(cancel);
    const again = await world.invites.sendCancellation(cancel);
    expect(again.sent).toBe(0);
    expect(again.results[0].status).toBe('skipped');
    expect(world.mail).toHaveLength(3); // invitation + guest and host cancellations
  });

  it('cancels a moved occurrence through the worker and keeps the remaining series reachable', async () => {
    event = await world.store.saveEvent({
      ...event, recurrence: { freq: 'daily', interval: 1 },
    });
    const rid = event.start + 24 * HOUR;
    const moved = rid + 2 * HOUR;
    await world.store.updateOccurrence(event.id, rid, {
      title: 'Moved offsite', start: moved, end: moved + HOUR,
    });
    await settle(world.rsvp);
    await world.invites.send(event);
    const log = world.kv.map.get(`cal:invite:${event.id}`);
    const master = world.store.getEvent(event.id);
    const occurrence = materializeOccurrence(master, rid);
    const cancel = world.invites.cancellationFor(occurrence);
    expect(cancel.recurrenceId).toBe(rid);
    expect(cancel.details.title).toBe('Moved offsite');
    expect(cancel.details.when).toBe(describeWhen(occurrence));
    expect(cancel.details.recurLabel).toBe('');
    await world.store.deleteOccurrence(event.id, rid);

    expect((await world.invites.sendCancellation(cancel)).sent).toBe(2);
    const message = world.mail[1];
    expect(message.subject).toContain('Cancelled: Moved offsite');
    expect(message.text).toContain(cancel.details.when);
    expect(message.text).toContain('Only this occurrence is cancelled. The rest of the series is unchanged.');
    expect(message.html).toContain('Only this occurrence is cancelled. The rest of the series is unchanged.');
    const decode = (mail) => Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
    const ics = decode(message);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain(`UID:${event.id}@calendar.puter.com`);
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    // The original slot is the same RECURRENCE-ID as in the invitation's override.
    expect(ics.match(/^RECURRENCE-ID[^\r]+/m)[0]).toBe(decode(world.mail[0]).match(/^RECURRENCE-ID[^\r]+/m)[0]);
    expect(ics).not.toMatch(/RRULE|EXDATE|RANGE=/);
    expect(Number(ics.match(/SEQUENCE:(\d+)/)[1])).toBeGreaterThan(Number(decode(world.mail[0]).match(/SEQUENCE:(\d+)/)[1]));
    expect(world.kv.map.get(`cal:invite:${event.id}`)).toEqual(log);
    const remaining = expandOccurrences(world.store.getEvent(event.id), event.start, rid + 2 * 24 * HOUR);
    expect(remaining.map((o) => o.recurrenceId)).not.toContain(rid);
    expect(remaining.length).toBeGreaterThan(1);
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(0);

    const next = world.invites.cancellationFor(materializeOccurrence(master, rid + 24 * HOUR));
    expect(next.recipients[0].version).not.toBe(cancel.recipients[0].version);
    await world.store.deleteOccurrence(event.id, rid + 24 * HOUR);
    expect((await world.invites.sendCancellation(next)).sent).toBe(2);
    const all = world.invites.cancellationFor({ id: event.id });
    expect(all.recipients.map((r) => r.email)).toEqual(['ada@example.com']);
    await world.store.deleteEvent(event.id);
    expect((await world.invites.sendCancellation(all)).sent).toBe(2);
    expect(world.kv.map.has(`cal:invite:${event.id}`)).toBe(false);
  });

  it.each([
    ['timed, unbounded', false, null], ['timed, count-limited', false, 5],
    ['all-day, count-limited', true, 5],
  ])('cancels this and following occurrences through the worker (%s)', async (_, allDay, count) => {
    const start = new Date(2026, 8, 14, allDay ? 0 : 9).getTime();
    event = await world.store.saveEvent({ ...event, start, end: start + (allDay ? 24 : 1) * HOUR,
      allDay, recurrence: { freq: 'daily', interval: 1, count } });
    const rid = start + 2 * 24 * HOUR;
    await world.store.updateOccurrence(event.id, rid, { title: 'Moved meeting', start: rid + (allDay ? 24 : 2) * HOUR,
      end: rid + (allDay ? 48 : 3) * HOUR });
    await settle(world.rsvp);
    await world.invites.send(event);
    const log = world.kv.map.get(`cal:invite:${event.id}`);
    const occurrence = world.store.getEvent(`${event.id}::${rid}`);
    const one = world.invites.cancellationFor(occurrence);
    const cancel = world.invites.cancellationFor(occurrence, { future: true });
    expect(cancel.recipients[0].version).not.toBe(one.recipients[0].version);
    expect(cancel.recurrenceRange).toBe('THISANDFUTURE');
    const res = await world.store.deleteFuture(event.id, rid);
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(2);
    const mail = world.mail.at(-1);
    const ics = Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
    expect(mail.text).toContain('This and all following occurrences are cancelled. Earlier occurrences are unchanged.');
    expect(mail.html).toContain('Earlier occurrences are unchanged.');
    expect(ics).toContain(`UID:${event.id}@calendar.puter.com`);
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SUMMARY:Moved meeting');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toMatch(/RRULE|EXDATE/);
    expect(ics).toMatch(allDay
      ? /RECURRENCE-ID;VALUE=DATE;RANGE=THISANDFUTURE:20260916/
      : /RECURRENCE-ID[^\r]*;RANGE=THISANDFUTURE:20260916T090000/);
    expect(expandOccurrences(res.event, start, rid + 24 * HOUR)).toHaveLength(2);
    expect(world.kv.map.get(`cal:invite:${event.id}`)).toEqual(log);
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(0);
    await res.undo();
    await expect(world.invites.sendCancellation(cancel)).rejects.toThrow('restored');
  });

  it('deleting from the first occurrence sends a whole-series cancellation and clears its log', async () => {
    event = await world.store.saveEvent({ ...event, recurrence: { freq: 'daily', interval: 1, count: 4 } });
    await settle(world.rsvp);
    await world.invites.send(event);
    const cancel = world.invites.cancellationFor(materializeOccurrence(event, event.start), { future: true });
    expect(cancel.recurrenceId).toBeUndefined();
    expect(cancel.recurrenceRange).toBeUndefined();
    await world.store.deleteFuture(event.id, event.start);
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(2);
    expect(world.kv.map.has(`cal:invite:${event.id}`)).toBe(false);
  });

  it('rechecks a range cancellation after Undo while another notification was in flight', async () => {
    event = await world.store.saveEvent({ ...event, recurrence: { freq: 'daily', interval: 1 } });
    await settle(world.rsvp);
    await world.invites.send(event);
    let release, began;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { began = resolve; });
    world.send.mockImplementationOnce(async (mail) => {
      began();
      await gate;
      world.mail.push(mail);
      return { messageId: 'update', failed: [], suppressed: [] };
    });
    event = await world.store.saveEvent({ ...event, title: 'Earlier update' });
    const sending = world.invites.send(event);
    await started;
    const rid = event.start + 24 * HOUR;
    const cancel = world.invites.cancellationFor(materializeOccurrence(event, rid), { future: true });
    const res = await world.store.deleteFuture(event.id, rid);
    const cancelled = world.invites.sendCancellation(cancel);
    await res.undo();
    release();
    await sending;
    await expect(cancelled).rejects.toThrow('restored');
    expect(world.exec.mock.calls.filter(([url]) => url.endsWith('/cancellations'))).toHaveLength(0);
  });

  it('keeps failed range cancellations retryable and earlier invitees reachable', async () => {
    event = await world.store.saveEvent({ ...event, recurrence: { freq: 'daily', interval: 1 } });
    await settle(world.rsvp);
    await world.invites.send(event);
    const rid = event.start + 24 * HOUR;
    const cancel = world.invites.cancellationFor(materializeOccurrence(event, rid), { future: true });
    await world.store.deleteFuture(event.id, rid);
    world.send.mockResolvedValueOnce({ failed: ['ada@example.com'] });
    expect((await world.invites.sendCancellation(cancel)).failed).toBe(1);
    expect((await world.invites.sendCancellation(cancel)).sent).toBe(1);
    expect(world.invites.cancellationFor({ id: event.id }).recipients).toHaveLength(1);
  });

  it('sends the split schedule with its own RSVP links without inviting unsent guests to earlier events', async () => {
    event = await world.store.saveEvent({ ...event, recurrence: { freq: 'daily', interval: 1, count: 5 } });
    await settle(world.rsvp);
    await world.invites.send(event);
    event = await world.store.saveEvent({ ...event, guests: [...event.guests, { email: 'bob@example.com' }] });
    await settle(world.rsvp);
    const rid = event.start + 2 * 24 * HOUR;
    const split = await world.store.updateFuture(event.id, rid, { title: 'Future meeting', start: rid + HOUR, end: rid + 2 * HOUR });
    await settle(world.rsvp);
    world.invites.sendWhenReady({ id: event.id }, { previouslyInvitedOnly: true });
    world.invites.sendWhenReady({ id: split.event.id });
    // Wait for both worker calls, including batching and sent-log persistence.
    for (let i = 0; i < 10; i++) await tick();
    const bodies = world.exec.mock.calls.slice(1).map(([, opts]) => JSON.parse(opts.body));
    const old = bodies.find((b) => b.event.id === event.id);
    const tail = bodies.find((b) => b.event.id === split.event.id);
    expect(old.recipients.map((r) => r.email)).toEqual(['ada@example.com']);
    expect(old.ics).toContain('COUNT=2');
    expect(tail.ics).toContain('COUNT=3');
    expect(tail.ics).toContain('SUMMARY:Future meeting');
    expect(tail.ics).toContain(`UID:${split.event.id}@calendar.puter.com`);
    expect(tail.recipients.map((r) => r.email).sort()).toEqual(['ada@example.com', 'bob@example.com']);
    expect(tail.recipients[0].rsvpUrl).toBe(world.rsvp.linksFor(split.event.id)[tail.recipients[0].email]);
    expect(tail.recipients[0].rsvpUrl).not.toBe(world.rsvp.linksFor(event.id)[tail.recipients[0].email]);
    expect(world.invites.planFor(split.event).pending).toHaveLength(0);
  });

  it('keeps every series recipient when an occurrence cancellation fails', async () => {
    event = await world.store.saveEvent({ ...event, recurrence: { freq: 'daily', interval: 1 } });
    await settle(world.rsvp);
    await world.invites.send(event);
    const log = world.kv.map.get(`cal:invite:${event.id}`);
    const cancel = world.invites.cancellationFor(materializeOccurrence(event, event.start));
    await world.store.deleteOccurrence(event.id, event.start);
    world.send.mockResolvedValueOnce({ failed: ['ada@example.com'] });
    expect((await world.invites.sendCancellation(cancel)).failed).toBe(1);
    expect(world.kv.map.get(`cal:invite:${event.id}`)).toEqual(log);
    expect(world.invites.cancellationFor({ id: event.id }).recipients).toHaveLength(1);
  });

  it('lets a fresh invitation out after an undo — cancelled is not forever', async () => {
    await world.invites.send(event);
    const cancel = world.invites.cancellationFor(event);
    await world.store.deleteEvent(event.id);
    await world.invites.sendCancellation(cancel);

    // Undo re-saves the event. The guests were told it's off, so they are owed
    // a first invitation again — which the worker must not skip as a duplicate.
    await world.store.saveEvent(event);
    await settle(world.rsvp);
    const plan = world.invites.planFor(event);
    expect(plan.pending.map((r) => r.email)).toEqual(['ada@example.com']);
    expect(plan.pending[0].sentAt).toBe(0);
    expect((await world.invites.send(event)).sent).toBe(1);
    expect(world.mail.at(-1).subject).toMatch(/^Invitation: /);
  });

  it('reaches every emailed guest of a big event, in worker-sized batches', async () => {
    // The worker takes 50 recipients per request and drops the rest, which an
    // invitation recovers from (the dropped stay pending) but a cancellation
    // never could — this send is the guests' one chance to hear.
    const emails = Array.from({ length: 60 }, (_, i) => `guest${i}@example.com`);
    const big = makeWorld();
    await big.store.load();
    await big.rsvp.start();
    const ev = await hostEvent(big.store);
    await big.kv.set(
      `cal:invite:${ev.id}`,
      Object.fromEntries(emails.map((e) => [e, { at: 1, v: 'aaaa1111' }])),
    );
    await big.invites.start();

    const cancel = big.invites.cancellationFor(ev);
    expect(cancel.recipients).toHaveLength(60);
    await big.store.deleteEvent(ev.id);
    const out = await big.invites.sendCancellation(cancel);
    expect(out.sent).toBe(61);
    expect(new Set(big.mail.map((m) => m.to)).size).toBe(61);
    expect(big.mail.filter((m) => m.to === 'host@example.com')).toHaveLength(1);
  });

  it('counts the guests a mid-way refusal stranded instead of pretending', async () => {
    const emails = Array.from({ length: 60 }, (_, i) => `guest${i}@example.com`);
    const big = makeWorld();
    await big.store.load();
    await big.rsvp.start();
    const ev = await hostEvent(big.store);
    await big.kv.set(
      `cal:invite:${ev.id}`,
      Object.fromEntries(emails.map((e) => [e, { at: 1, v: 'aaaa1111' }])),
    );
    await big.invites.start();

    const cancel = big.invites.cancellationFor(ev);
    await big.store.deleteEvent(ev.id);
    const real = big.exec.getMockImplementation();
    let calls = 0;
    big.exec.mockImplementation(async (url, init) => {
      calls += 1;
      if (calls === 2) return { ok: false, status: 500, json: async () => null };
      return real(url, init);
    });
    const out = await big.invites.sendCancellation(cancel);
    expect(out.sent).toBe(51);
    expect(out.failed).toBe(10); // "Sent 51, but 10 could not be delivered."
    expect(big.mail).toHaveLength(51);

    // The 10 stranded guests remain in the log — the only record that can
    // still reach them. Deleting it wholesale (as this path once did) made an
    // undo + re-delete return "nobody to notify" while 10 guests still
    // believed the event was on.
    const kept = big.kv.map.get(`cal:invite:${ev.id}`);
    const strandedEmails = cancel.recipients.slice(50).map((r) => r.email);
    expect(Object.keys(kept).sort()).toEqual([...strandedEmails].sort());

    // Undo re-saves the event; asking again now names exactly the stranded.
    await big.store.saveEvent(ev);
    const retry = big.invites.cancellationFor(ev);
    expect(retry.recipients.map((r) => r.email).sort()).toEqual([...strandedEmails].sort());
  });

  it('refuses to cancel while offline, and names the worker refusals', async () => {
    await world.invites.send(event);
    const cancel = world.invites.cancellationFor(event);
    await world.store.deleteEvent(event.id);

    world.setBlocked(true);
    await expect(world.invites.sendCancellation(cancel)).rejects.toThrow(/offline/i);
    world.setBlocked(false);

    world.setStatus(401);
    await expect(world.invites.sendCancellation(cancel)).rejects.toThrow(/Sign in to Puter/);
    world.setStatus(429);
    await expect(world.invites.sendCancellation(cancel)).rejects.toThrow(/email limit/);
    world.setStatus(null);

    // An email-worker deployment that predates /cancellations answers 404:
    // an honest failure, never an "Invitation" to an event that is gone.
    world.exec.mockImplementationOnce(async () => ({ ok: false, status: 404, json: async () => null }));
    await expect(world.invites.sendCancellation(cancel)).rejects.toThrow(/needs an update/i);

    expect(world.mail).toHaveLength(1); // nothing but the original invitation
    // Every refusal keeps the sent log: the host can try again.
    expect(world.kv.map.has(`cal:invite:${event.id}`)).toBe(true);
  });
});

describe('invites: a guest the daily cap skipped was not invited', () => {
  const cappedReply = (sentEmail, cappedEmail) => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      sent: 1,
      skipped: 1,
      failed: 0,
      suppressed: 0,
      results: [
        { email: sentEmail, status: 'sent', at: Date.now() },
        { email: cappedEmail, status: 'skipped', reason: 'daily_limit' },
      ],
    }),
  });

  it('logs only the guest who was mailed, keeps offering the other, and says so', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const event = await hostEvent(world.store, {
      guests: [
        { email: HOST.email, status: 'accepted' },
        { email: 'ada@example.com', name: 'Ada', status: 'needs-action' },
        { email: 'bob@example.com', name: 'Bob', status: 'needs-action' },
      ],
    });
    await settle(world.rsvp);
    await world.invites.start();
    world.exec.mockImplementation(async () => cappedReply('ada@example.com', 'bob@example.com'));

    const out = await world.invites.send(event);
    expect(out).toMatchObject({ sent: 1, capped: 1 });
    expect(describeResult(out)).toMatchObject({ variant: 'danger', quiet: false });
    expect(describeResult(out).message).toMatch(/email limit/);
    // Ada is recorded as invited; Bob is not, so the card still offers him.
    const log = await world.kv.get(`cal:invite:${event.id}`);
    expect(Object.keys(log)).toEqual(['ada@example.com']);
    const plan = world.invites.planFor(event);
    expect(plan.pending.map((g) => g.email)).toEqual(['bob@example.com']);
  });

  it('keeps a capped guest stranded on a cancellation, so the record still names them', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const event = await hostEvent(world.store, {
      guests: [
        { email: HOST.email, status: 'accepted' },
        { email: 'ada@example.com', name: 'Ada', status: 'needs-action' },
        { email: 'bob@example.com', name: 'Bob', status: 'needs-action' },
      ],
    });
    await world.kv.set(`cal:invite:${event.id}`, {
      'ada@example.com': { at: 1, v: 'aaaa1111' },
      'bob@example.com': { at: 1, v: 'aaaa1111' },
    });
    await world.invites.start();
    const cancel = world.invites.cancellationFor(event);
    await world.store.deleteEvent(event.id);
    world.exec.mockImplementation(async () => cappedReply('ada@example.com', 'bob@example.com'));

    const out = await world.invites.sendCancellation(cancel);
    expect(out).toMatchObject({ sent: 1, capped: 1 });
    expect(describeCancelResult(out).message).toMatch(/email limit/);
    // Bob was not told: his entry survives for the retry; Ada's is done with.
    expect(Object.keys((await world.kv.get(`cal:invite:${event.id}`)) || {})).toEqual(['bob@example.com']);
  });
});

describe('invites: an invitation names its host', () => {
  // Puter withholds the account's email until the user grants it: boot's user
  // object has none, and neither does a fresh getUser() until the grant lands.
  const NOBODY = { uuid: HOST.uuid };

  /** Poll until `check` holds — the automatic send runs off callbacks. */
  async function until(check) {
    for (let i = 0; i < 100 && !check(); i++) await tick();
    expect(check()).toBe(true);
  }

  /** A world whose host is unknown, and an event saved while it was: no
   *  organizer stamped, the host not on their own guest list. */
  async function anonymousWorld(opts) {
    const world = makeWorld({ user: NOBODY, ...opts });
    await world.store.load();
    await world.rsvp.start();
    const start = Date.now() + 24 * HOUR;
    const event = await world.store.saveEvent({
      title: 'Team offsite',
      start,
      end: start + 2 * HOUR,
      guests: [{ email: 'ada@example.com', name: 'Ada', status: 'needs-action' }],
    });
    await settle(world.rsvp);
    await world.invites.start();
    return { world, event };
  }

  it('refuses to mail an invitation it cannot sign', async () => {
    const requestEmail = vi.fn(async () => null); // asked, and refused
    const { world, event } = await anonymousWorld({ requestUser: async () => NOBODY, requestEmail });
    await expect(world.invites.send(event)).rejects.toThrow(/your email address/);
    expect(requestEmail).toHaveBeenCalledTimes(1);
    expect(world.mail).toHaveLength(0);
    // Nothing was recorded as sent: the guest is still owed her invitation.
    expect(world.invites.planFor(event).pending).toHaveLength(1);
  });

  it('asks for the address on a press, then sends — and cancels — as that host', async () => {
    const requestEmail = vi.fn(async () => HOST.email);
    const { world, event } = await anonymousWorld({ requestUser: async () => NOBODY, requestEmail });
    const out = await world.invites.send(event);
    expect(out.sent).toBe(1);
    expect(requestEmail).toHaveBeenCalledTimes(1);

    const [message] = world.mail;
    expect(message.replyTo).toBe(HOST.email);
    expect(message.text).toContain(`${HOST.email} invited you`);
    // The guest's calendar reads the organizer from here — without it Google
    // Calendar files the event under unknownorganizer@calendar.google.com.
    const ics = Buffer.from(message.attachments[0].content, 'base64').toString('utf8');
    expect(ics).toContain(`ORGANIZER:mailto:${HOST.email}`);

    // The address is remembered: what she was sent is current, and the next
    // press neither asks again nor writes to her again.
    expect(world.invites.planFor(event).pending).toHaveLength(0);
    await world.invites.send(event);
    expect(requestEmail).toHaveBeenCalledTimes(1);
    expect(world.mail).toHaveLength(1);

    const cancel = world.invites.cancellationFor(event);
    await world.store.deleteEvent(event.id);
    await world.invites.sendCancellation(cancel);
    expect(world.mail[1].replyTo).toBe(HOST.email);
    const cancelIcs = Buffer.from(world.mail[1].attachments[0].content, 'base64').toString('utf8');
    expect(cancelIcs).toContain(`ORGANIZER:mailto:${HOST.email}`);
  });

  it('waits for the SDK email permission prompt and sends immediately after approval', async () => {
    let approve;
    const permission = new Promise((resolve) => { approve = resolve; });
    const request = vi.fn((resource) => {
      if (resource !== 'email') throw new Error('Expected the email resource');
      return permission;
    });
    vi.stubGlobal('puter', {
      auth: { getUser: vi.fn(async () => NOBODY) },
      perms: { request },
    });
    let world;
    try {
      const anonymous = await anonymousWorld({ requestUser: async () => NOBODY });
      world = anonymous.world;
      const sending = world.invites.send(anonymous.event);
      await until(() => request.mock.calls.length > 0);
      expect(request).toHaveBeenCalledExactlyOnceWith('email');
      expect(world.mail).toHaveLength(0);
      expect(world.toasts).toHaveLength(0);

      approve(HOST.email);
      await expect(sending).resolves.toMatchObject({ sent: 1 });
      expect(world.mail[0].replyTo).toBe(HOST.email);
      expect(world.invites.planFor(anonymous.event).pending).toHaveLength(0);
    } finally {
      approve(undefined);
      world?.rsvp.stop();
      vi.unstubAllGlobals();
    }
  });

  it('never prompts from the automatic send after a save, but takes a grant that landed since boot', async () => {
    const requestEmail = vi.fn(async () => HOST.email);
    let known = NOBODY;
    const requestUser = vi.fn(async () => known);
    const { world, event } = await anonymousWorld({ requestUser, requestEmail });

    world.invites.sendWhenReady(event);
    await until(() => world.toasts.length > 0);
    expect(world.toasts[0]).toMatchObject({ variant: 'danger' });
    expect(world.toasts[0].message).toMatch(/your email address/);
    expect(requestEmail).not.toHaveBeenCalled();
    expect(world.mail).toHaveLength(0);

    // The grant landed elsewhere (another dialog asked): a fresh getUser() has
    // the address, and the next automatic send needs no press.
    known = HOST;
    world.invites.sendWhenReady(event);
    await until(() => world.mail.length > 0);
    expect(world.mail[0].replyTo).toBe(HOST.email);
    expect(requestEmail).not.toHaveBeenCalled();
  });
});
