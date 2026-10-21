import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { instantiateWorker, makeKv } from './helpers/worker-harness.js';
import { toICS } from '../src/js/ics.js';

const RAW = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/workers/email-worker.js'),
  'utf8',
);

const CALLER = {
  uuid: 'user-uuid-1',
  username: 'host',
  puter: { authToken: 'caller-token' },
};

const LINK = 'https://cal-rsvp-abc123.puter.work/rsvp/' + 'a'.repeat(40);
const LINK2 = 'https://cal-rsvp-abc123.puter.work/rsvp/' + 'b'.repeat(40);

/**
 * A worker with a fake `puter.email` on both the owner (`me`) and the caller
 * (`user`) — the two forms the send can take. `outcome` lets a test decide what
 * a given send does; by default every message is accepted. The fake carries
 * the API's current name, `sendTransactional`; `legacyMailer` gives it only
 * the old `send`, as a runtime whose SDK predates the rename would.
 */
function loadWorker({
  outcome = null,
  ownerSend = null,
  callerSend = null,
  legacyMailer = false,
} = {}) {
  const method = legacyMailer ? 'send' : 'sendTransactional';
  const kv = makeKv();
  const sent = [];
  const mailer = (via, override) =>
    vi.fn(async (message) => {
      if (override) return override(message);
      sent.push({ via, ...message });
      const out = outcome ? outcome(message) : null;
      return { messageId: `m${sent.length}`, cost: 25, suppressed: [], failed: [], ...(out || {}) };
    });
  const me = {
    puter: { kv, authToken: 'owner-token', email: { [method]: mailer('me', ownerSend) } },
  };
  const caller = {
    ...CALLER,
    puter: { ...CALLER.puter, email: { [method]: mailer('user', callerSend) } },
  };
  return { worker: instantiateWorker(RAW, { kv, me }), kv, sent, me, caller };
}

function payload(overrides = {}) {
  return {
    event: {
      id: 'evt-1',
      title: 'Team offsite',
      when: 'Thu, Aug 13, 2026 · 9:00 – 10:00 AM (PDT)',
      location: 'Pier 39',
      description: 'Bring sunscreen',
      organizerName: 'Nariman',
      organizerEmail: 'host@example.com',
      recurLabel: '',
    },
    recipients: [{ email: 'ada@example.com', name: 'Ada', rsvpUrl: LINK, version: 'abcd1234' }],
    kind: 'invite',
    ...overrides,
  };
}

async function post(world, body = payload(), { user = world.caller } = {}) {
  return world.worker.call('POST', '/invites', { json: body, user });
}

describe('email worker: access', () => {
  it('reports its version without auth', async () => {
    const world = loadWorker();
    const res = await world.worker.call('GET', '/health');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('reports the baked-in runtime, null under the harness', async () => {
    const world = loadWorker();
    const res = await world.worker.call('GET', '/health');
    expect((await res.json()).runtime).toBeNull();

    // Read per request: the same worker reports a preamble that arrives later.
    globalThis.__PUTER_PREAMBLE_VERSION__ = '2.6.2+63f857ce3';
    try {
      const res2 = await world.worker.call('GET', '/health');
      expect((await res2.json()).runtime).toBe('2.6.2+63f857ce3');
    } finally {
      delete globalThis.__PUTER_PREAMBLE_VERSION__;
    }
  });

  it('refuses a caller with no Puter session — nothing to bill, nothing to send', async () => {
    const world = loadWorker();
    const res = await world.worker.call('POST', '/invites', { json: payload() });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('sign_in_required');
    expect(world.sent).toHaveLength(0);
  });

  it('takes the caller however the runtime hands them over', async () => {
    // The context property has been both `user` and `requestor`; a session that
    // arrives on either one is a session.
    const world = loadWorker();
    const res = await world.worker.call('POST', '/invites', {
      json: payload(),
      user: world.caller,
      bindAs: 'requestor',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toBe(1);
  });

  it('identifies a caller whose id is only reachable through their own Puter', async () => {
    const world = loadWorker();
    const anonymous = {
      // No uuid/username on the context object itself.
      puter: {
        ...world.caller.puter,
        auth: { getUser: async () => ({ uuid: 'user-uuid-9' }) },
      },
    };
    expect((await (await post(world, payload(), { user: anonymous })).json()).sent).toBe(1);

    // And that id — not a blank shared one — is what keyed the record: the
    // same event to the same guest from a DIFFERENT caller still sends.
    const other = { uuid: 'user-uuid-2', puter: world.caller.puter };
    expect((await (await post(world, payload(), { user: other })).json()).sent).toBe(1);
    // ...while a repeat from the first caller is recognized as a duplicate.
    const repeat = await (await post(world, payload(), { user: anonymous })).json();
    expect(repeat.sent).toBe(0);
    expect(repeat.results[0].reason).toBe('already_sent');
  });

  it('refuses a session it cannot pin to a person, rather than sharing a bucket', async () => {
    const world = loadWorker();
    const faceless = { puter: { ...world.caller.puter } }; // no id, no auth handle
    const res = await post(world, payload(), { user: faceless });
    expect(res.status).toBe(401);
    expect((await res.json())).toMatchObject({ error: 'sign_in_required', detail: 'no_identity' });
    expect(world.sent).toHaveLength(0);
  });

  it('reports what it can see of a session, and never a value of it', async () => {
    const world = loadWorker();
    const res = await world.worker.call('GET', '/whoami', {
      user: world.caller,
      headers: { 'puter-auth': 'a-token' },
    });
    const data = await res.json();
    expect(data).toMatchObject({
      ok: true,
      sawAuthHeader: true,
      boundAs: 'user',
      identified: true,
      has: { puter: true, email: true },
      owner: { email: true, authToken: true },
    });
    expect(data.callerKeys).toContain('uuid');
    expect(data.puterKeys).toContain('authToken');
    // Names and booleans only — no token, address, or id in the payload.
    expect(JSON.stringify(data)).not.toContain('caller-token');
    expect(JSON.stringify(data)).not.toContain('user-uuid-1');

    const out = await (await world.worker.call('GET', '/whoami')).json();
    expect(out).toMatchObject({ boundAs: null, identified: false, sawAuthHeader: false });
  });

  it('rejects a request with no event id, no version, or no recipients', async () => {
    const world = loadWorker();
    const cases = [
      [payload({ event: { title: 'x' } }), 'event_id_required'],
      [payload({ event: { id: 'a b' } }), 'event_id_required'],
      [payload({ recipients: [{ email: 'ada@example.com', rsvpUrl: LINK }] }), 'version_required'],
      [payload({ recipients: [{ email: 'nope', version: 'abcd1234' }] }), 'recipients_required'],
      [payload({ recipients: [] }), 'recipients_required'],
    ];
    for (const [body, error] of cases) {
      const res = await post(world, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(error);
    }
    expect(world.sent).toHaveLength(0);
  });
});

describe('email worker: the message', () => {
  it('composes one private invitation per guest, with their own link', async () => {
    const world = loadWorker();
    const res = await post(
      world,
      payload({
        recipients: [
          { email: 'ada@example.com', name: 'Ada', rsvpUrl: LINK, version: 'abcd1234' },
          { email: 'bob@example.com', name: '', rsvpUrl: LINK2, version: 'abcd1234' },
        ],
      }),
    );
    const data = await res.json();
    expect(data.sent).toBe(2);
    expect(world.sent).toHaveLength(2);

    const [first, second] = world.sent;
    expect(first.to).toBe('ada@example.com');
    expect(second.to).toBe('bob@example.com');
    // Each guest sees only their own capability link.
    expect(first.text).toContain(`${LINK}/accept`);
    expect(first.text).not.toContain(LINK2);
    expect(second.text).toContain(`${LINK2}/decline`);
    // Answers come back to the calendar, but a reply goes to the organizer.
    expect(first.replyTo).toBe('host@example.com');
    expect(first.subject).toBe(
      'Invitation: Team offsite — Thu, Aug 13, 2026 · 9:00 – 10:00 AM (PDT)',
    );
    expect(first.text).toContain('Hi Ada,');
    expect(second.text).not.toContain('Hi ,');
    expect(first.html).toContain('Will you attend?');
    expect(first.html).toContain(`${LINK}/maybe`);
  });

  it('says so when the invitation is an update', async () => {
    const world = loadWorker();
    await post(world, payload({ kind: 'update' }));
    expect(world.sent[0].subject).toMatch(/^Updated invitation: Team offsite/);
    expect(world.sent[0].text).toContain('updated an event');
    expect(world.sent[0].html).toContain('updated an event');
  });

  it('escapes host-typed text and never linkifies it', async () => {
    const world = loadWorker();
    await post(
      world,
      payload({
        event: {
          ...payload().event,
          title: '<img src=x onerror=alert(1)>',
          description: 'Read https://evil.example/free-money now',
        },
      }),
    );
    const { html, text } = world.sent[0];
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    // The address survives as text, but the only <a href> in the mail is the
    // guest's own RSVP link.
    expect(text).toContain('https://evil.example/free-money');
    for (const href of html.match(/href="([^"]*)"/g) || []) {
      expect(href).toContain('cal-rsvp-abc123.puter.work/rsvp/');
    }
  });

  it('keeps a newline out of the subject line', async () => {
    const world = loadWorker();
    await post(
      world,
      payload({
        event: { ...payload().event, title: 'Standup\r\nBcc: victim@example.com' },
      }),
    );
    expect(world.sent[0].subject).not.toMatch(/[\r\n]/);
    expect(world.sent[0].subject).toContain('Standup Bcc: victim@example.com');
  });

  it('drops a link that is not an RSVP capability URL, and still sends', async () => {
    const world = loadWorker();
    const res = await post(
      world,
      payload({
        recipients: [
          {
            email: 'ada@example.com',
            rsvpUrl: 'https://evil.example/rsvp/' + 'a'.repeat(40),
            version: 'abcd1234',
          },
        ],
      }),
    );
    expect((await res.json()).sent).toBe(1);
    expect(world.sent[0].text).not.toContain('evil.example');
    expect(world.sent[0].html).not.toContain('href');
  });

  it('includes the Puter Meetings join link, in text and as a real link', async () => {
    for (const join of [
      'https://meetings.puter.com/#/m/abcd-efgh-ijkl', // open room code
      'https://meetings.puter.com/#/m/abc-defg-hij', //   classic room code
    ]) {
      const world = loadWorker();
      await post(world, payload({ event: { ...payload().event, meetingUrl: join } }));
      expect(world.sent[0].text).toContain(`Join: ${join}`);
      expect(world.sent[0].html).toContain(`href="${join}"`);
    }
  });

  it('drops a meeting link that is not a Puter Meetings room URL, and still sends', async () => {
    for (const bad of [
      'https://evil.example/#/m/abcd-efgh-ijkl', //                 wrong host
      'https://meetings.puter.com.evil.example/#/m/abcd-efgh-ijkl', // host prefix trick
      'https://meetings.puter.com/#/m/ABCD-EFGH-IJKL', //           not a room code
      'https://meetings.puter.com/#/m/abcd-efgh-ijkl?x="<i>', //    trailing junk
      'javascript:alert(1)', //                                     not even https
    ]) {
      const world = loadWorker(); // fresh, so the send isn't deduped away
      const res = await post(world, payload({ event: { ...payload().event, meetingUrl: bad } }));
      expect((await res.json()).sent).toBe(1);
      expect(world.sent[0].text).not.toContain('Join:');
      expect(world.sent[0].html).not.toContain('evil');
      expect(world.sent[0].html).not.toContain('javascript:');
    }
  });

  it('attaches the .ics it was given, base64-encoded', async () => {
    const world = loadWorker();
    const ics = 'BEGIN:VCALENDAR\r\nSUMMARY:Café ☕\r\nEND:VCALENDAR\r\n';
    await post(world, payload({ ics }));
    const [attachment] = world.sent[0].attachments;
    expect(attachment.filename).toBe('invite.ics');
    expect(attachment.contentType).toContain('text/calendar');
    expect(Buffer.from(attachment.content, 'base64').toString('utf8')).toBe(ics);
  });

  it('labels the attachment with the METHOD the .ics declares', async () => {
    const world = loadWorker();
    // The method= MIME parameter is what mail clients key on to make their
    // native RSVP buttons work; a file without a METHOD gets no parameter.
    const ics = 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n';
    await post(world, payload({ ics }));
    expect(world.sent[0].attachments[0].contentType).toBe(
      'text/calendar; charset=utf-8; method=REQUEST',
    );
  });

  it('sends without an attachment when there is no .ics', async () => {
    const world = loadWorker();
    await post(world, payload());
    expect(world.sent[0].attachments).toBeUndefined();
  });
});

describe('email worker: never send the same thing twice', () => {
  it('skips a guest who already has this exact invitation', async () => {
    const world = loadWorker();
    expect((await (await post(world)).json()).sent).toBe(1);

    const again = await (await post(world)).json();
    expect(again.sent).toBe(0);
    expect(again.skipped).toBe(1);
    expect(again.results[0]).toMatchObject({ status: 'skipped', reason: 'already_sent' });
    expect(world.sent).toHaveLength(1);
  });

  it('sends again when the guest\'s version changes (details or link moved)', async () => {
    const world = loadWorker();
    await post(world);
    const res = await post(
      world,
      payload({
        recipients: [{ email: 'ada@example.com', rsvpUrl: LINK, version: 'ffff9999' }],
      }),
    );
    expect((await res.json()).sent).toBe(1);
    expect(world.sent).toHaveLength(2);
  });

  it('resends on an explicit force', async () => {
    const world = loadWorker();
    await post(world);
    expect((await (await post(world, payload({ force: true }))).json()).sent).toBe(1);
    expect(world.sent).toHaveLength(2);
  });

  it('keys the record to the caller, so two hosts do not shadow each other', async () => {
    const world = loadWorker();
    await post(world);
    const other = { ...world.caller, uuid: 'user-uuid-2' };
    expect((await (await post(world, payload(), { user: other })).json()).sent).toBe(1);
    // Two records, and neither key contains an address, an id, or a title.
    const keys = [...world.kv.map.keys()].filter((k) => k.startsWith('mail:sent:'));
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^mail:sent:[0-9a-f]{64}$/);
      expect(Object.keys(world.kv.map.get(key)).sort()).toEqual(['at', 'v']);
    }
  });
});

describe('email worker: the organizer must be the caller', () => {
  const asUser = (email) => ({
    ...CALLER,
    puter: { ...CALLER.puter, auth: { getUser: async () => ({ uuid: CALLER.uuid, email }) } },
  });

  it('refuses an organizer address that is not the signed-in caller', async () => {
    const world = loadWorker();
    const res = await post(
      world,
      payload({ event: { ...payload().event, organizerName: 'The CEO', organizerEmail: 'attacker@evil.example' } }),
      { user: asUser('host@example.com') },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('organizer_mismatch');
    expect(world.sent).toHaveLength(0);
  });

  it('sends when the organizer is the caller, or when the platform cannot say who that is', async () => {
    const world = loadWorker();
    expect((await post(world, payload(), { user: asUser('HOST@example.com') })).status).toBe(200);
    // No address on the session: nothing to compare against, the send stands.
    const world2 = loadWorker();
    expect((await post(world2, payload())).status).toBe(200);
  });
});

describe('email worker: failure and limits', () => {
  it('does not record a suppressed or failed recipient as sent', async () => {
    const world = loadWorker({ outcome: () => ({ suppressed: ['ada@example.com'] }) });
    const first = await (await post(world)).json();
    expect(first.sent).toBe(0);
    expect(first.results[0].status).toBe('suppressed');
    // An unsubscribe is reported apart from a delivery failure — there is
    // nothing to retry.
    expect(first).toMatchObject({ suppressed: 1, failed: 0 });

    // Nothing was stored, so a later attempt is not mistaken for a duplicate.
    const world2 = loadWorker({ outcome: () => ({ failed: ['ada@example.com'] }) });
    const failed = await (await post(world2)).json();
    expect(failed.results[0]).toMatchObject({ status: 'failed', reason: 'delivery_failed' });
    expect([...world2.kv.map.keys()].filter((k) => k.startsWith('mail:sent:'))).toHaveLength(0);
  });

  it('reports a delivered mail as sent even when recording it fails', async () => {
    // The send went out; only the `mail:sent:` write broke. Reporting that as
    // `failed` made the app not log the guest, and the next press mailed them
    // the same invitation twice.
    const world = loadWorker();
    const realSet = world.kv.set.getMockImplementation();
    world.kv.set.mockImplementation(async (k, v) => {
      if (typeof k === 'string' && k.startsWith('mail:sent:')) throw new Error('kv unavailable');
      return realSet(k, v);
    });
    const data = await (await post(world)).json();
    world.kv.set.mockImplementation(realSet);
    expect(data.sent).toBe(1);
    expect(data.results[0]).toMatchObject({ status: 'sent' });
    expect(world.sent).toHaveLength(1);
  });

  it('reports one guest\'s failure without dropping the rest', async () => {
    const world = loadWorker({
      ownerSend: (message) => {
        if (message.to === 'ada@example.com') throw new Error('mailbox unavailable');
        return { messageId: 'ok', cost: 25, suppressed: [], failed: [] };
      },
    });
    const data = await (
      await post(
        world,
        payload({
          recipients: [
            { email: 'ada@example.com', rsvpUrl: LINK, version: 'abcd1234' },
            { email: 'bob@example.com', rsvpUrl: LINK2, version: 'abcd1234' },
          ],
        }),
      )
    ).json();
    expect(data.sent).toBe(1);
    expect(data.failed).toBe(1);
    expect(data.results.map((r) => r.status)).toEqual(['failed', 'sent']);
  });

  it('holds the daily cap under concurrent requests', async () => {
    // Read-then-write let every parallel request read the same count and send
    // its whole batch. Two requests with one send left between them: exactly
    // one mail goes out, and the counter ends at the cap.
    // A send that takes a moment, so both requests have read the quota before
    // either has settled it — the window the race lives in.
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { messageId: 'ok', cost: 25, suppressed: [], failed: [] };
    };
    const world = loadWorker({ ownerSend: slow });
    await post(world); // seeds the counter key
    const key = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    world.kv.map.set(key, 199);
    const [a, b] = await Promise.all([
      post(world, payload({ event: { ...payload().event, id: 'evt-a' }, recipients: [{ email: 'ada@example.com', rsvpUrl: LINK, version: 'aaaa0001' }] })),
      post(world, payload({ event: { ...payload().event, id: 'evt-b' }, recipients: [{ email: 'bob@example.com', rsvpUrl: LINK2, version: 'bbbb0001' }] })),
    ]);
    const outcomes = [await a.json(), await b.json()];
    const sent = outcomes.reduce((n, o) => n + (o.sent || 0), 0);
    expect(sent).toBe(1);
    expect(world.kv.map.get(key)).toBe(200);
    // …and a failed send hands its reservation back.
    const failing = loadWorker({ outcome: () => ({ failed: ['ada@example.com'] }) });
    await post(failing);
    const fkey = [...failing.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    expect(Number(failing.kv.map.get(fkey)) || 0).toBe(0);
  });

  it('stops at the daily cap and says which guests were not reached', async () => {
    const world = loadWorker();
    await post(world); // seeds the counter key, so the test can find its name
    const key = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    expect(key).toMatch(/^mail:rate:[0-9a-f]{64}:\d{4}-\d{2}-\d{2}$/);
    world.kv.map.set(key, 199); // one send left in today's budget

    const data = await (
      await post(
        world,
        payload({
          recipients: [
            { email: 'ada@example.com', rsvpUrl: LINK, version: 'ffff0001' },
            { email: 'bob@example.com', rsvpUrl: LINK2, version: 'ffff0002' },
          ],
        }),
      )
    ).json();
    expect(data.sent).toBe(1);
    expect(data.results[1]).toMatchObject({ status: 'skipped', reason: 'daily_limit' });

    world.kv.map.set(key, 200);
    const res = await post(world, payload({ force: true }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('daily_limit');
  });

  it('caps how many recipients one request can carry', async () => {
    const world = loadWorker();
    const recipients = Array.from({ length: 60 }, (_, i) => ({
      email: `guest${i}@example.com`,
      rsvpUrl: LINK,
      version: 'abcd1234',
    }));
    const data = await (await post(world, payload({ recipients }))).json();
    expect(data.results).toHaveLength(50);
    expect(world.sent).toHaveLength(50);
  });
});

describe('email worker: cancellations', () => {
  const postCancel = (world, body, opts) =>
    world.worker.call('POST', '/cancellations', { json: body, user: (opts && opts.user) || world.caller });
  const recipient = (version, extra = {}) => ({
    email: 'ada@example.com',
    name: 'Ada',
    rsvpUrl: LINK,
    version,
    ...extra,
  });

  it('refuses a caller with no session, like every send', async () => {
    const world = loadWorker();
    const res = await world.worker.call('POST', '/cancellations', { json: payload() });
    expect(res.status).toBe(401);
    expect(world.sent).toHaveLength(0);
  });

  it('composes a cancellation with no clickable destination, whatever the body claims', async () => {
    const world = loadWorker();
    const ics = 'BEGIN:VCALENDAR\r\nMETHOD:CANCEL\r\nEND:VCALENDAR\r\n';
    const res = await postCancel(
      world,
      payload({
        kind: 'invite', // the route decides what this is, not the body
        ics,
        event: { ...payload().event, meetingUrl: 'https://meetings.puter.com/#/m/abcd-efgh-ijkl' },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toBe(2);

    const [message] = world.sent;
    expect(message.subject).toMatch(/^Cancelled: Team offsite — /);
    expect(message.text).toContain('Nariman cancelled an event you were invited to.');
    expect(message.html).toContain('cancelled an event you were invited to.');
    // The guest's RSVP link and the meeting link both die with the event —
    // neither belongs in mail about a meeting that is off.
    expect(message.text).not.toContain('/rsvp/');
    expect(message.text).not.toContain('Join:');
    expect(message.html).not.toContain('Will you attend?');
    expect(message.attachments[0].filename).toBe('cancel.ics');
    expect(message.attachments[0].contentType).toBe('text/calendar; charset=utf-8; method=CANCEL');
    const host = world.sent.find((mail) => mail.to === 'host@example.com');
    expect(host.text).toContain('You cancelled this event.');
    expect(host.html).toContain('You cancelled this event.');
    expect(host.text).not.toContain('invited to');
    expect(host.text).not.toContain('Join:');
    expect(host.html).not.toContain('Will you attend?');
    expect(host.attachments).toEqual(message.attachments);
    const rate = [...world.kv.map.entries()].find(([key]) => key.startsWith('mail:rate:'));
    expect(rate[1]).toBe(2);
  });

  it('shares the already-sent record: cancel once, and a re-invitation still goes out', async () => {
    const world = loadWorker();
    expect((await (await post(world, payload({ recipients: [recipient('aaaa1111')] }))).json()).sent).toBe(1);
    expect((await (await postCancel(world, payload({ recipients: [recipient('cccc1111')] }))).json()).sent).toBe(2);

    // A second device asking for the same cancellation: the guest already knows.
    const dup = await (await postCancel(world, payload({ recipients: [recipient('cccc1111')] }))).json();
    expect(dup.sent).toBe(0);
    expect(dup.skipped).toBe(2);
    expect(dup.results[0]).toMatchObject({ status: 'skipped', reason: 'already_sent' });

    // The undo case: the host restores the event and re-invites. A fresh
    // digest must not be shadowed by either earlier record.
    expect((await (await post(world, payload({ recipients: [recipient('bbbb2222')] }))).json()).sent).toBe(1);
    expect(world.sent).toHaveLength(4);
  });

  it('describes a withdrawn invitation without claiming the event itself is cancelled', async () => {
    const world = loadWorker();
    await postCancel(world, payload({ cancellationScope: 'guests', note: 'The event remains scheduled for the other guests.' }));
    expect(world.sent[0].subject).toMatch(/^Invitation cancelled:/);
    expect(world.sent[0].text).toContain('Nariman cancelled your invitation to this event.');
    expect(world.sent[0].html).toContain('cancelled your invitation');
    expect(world.sent[0].text).not.toContain('/rsvp/');
    expect(world.sent[0].text).not.toContain('cancelled an event');
    expect(world.sent).toHaveLength(1);
  });

  it('sends the host only one copy if already included among the recipients', async () => {
    const world = loadWorker();
    const res = await postCancel(world, payload({ recipients: [
      recipient('cccc1111'),
      { email: 'HOST@example.com', name: 'Nariman', version: 'cccc1111' },
    ] }));
    expect((await res.json()).sent).toBe(2);
    expect(world.sent.filter((mail) => mail.to === 'host@example.com')).toHaveLength(1);
    expect(world.sent[1].text).toContain('You cancelled this event.');
  });

  it.each(['ada@example.com', 'host@example.com'])('retries only the failed cancellation to %s', async (failedEmail) => {
    let fail = true;
    const world = loadWorker({ outcome: (mail) => fail && mail.to === failedEmail ? { failed: [failedEmail] } : {} });
    const first = await (await postCancel(world, payload())).json();
    expect(first.sent).toBe(1);
    expect(first.failed).toBe(1);
    fail = false;
    const second = await (await postCancel(world, payload())).json();
    expect(second.sent).toBe(1);
    expect(second.skipped).toBe(1);
    expect(world.sent.at(-1).to).toBe(failedEmail);
  });

  it('still notifies guests when no host email is available', async () => {
    const world = loadWorker();
    const res = await postCancel(world, payload({ event: { ...payload().event, organizerEmail: '' } }));
    expect((await res.json()).sent).toBe(1);
    expect(world.sent[0].to).toBe('ada@example.com');
  });

  it('counts cancellations against the same daily budget', async () => {
    const world = loadWorker();
    await post(world); // seeds the counter key
    const key = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    world.kv.map.set(key, 200);
    const res = await postCancel(world, payload({ recipients: [recipient('cccc1111')] }));
    expect(res.status).toBe(429);
    expect(world.sent).toHaveLength(1); // only the seeding invitation
  });
});

describe('email worker: authorizing the send', () => {
  it('bills the caller through the owner-sends form', async () => {
    const world = loadWorker();
    await post(world);
    expect(world.sent[0].via).toBe('me');
    expect(world.sent[0].requesterToken).toBe('caller-token');
  });

  it('falls back to the caller-sends form when the first is not understood', async () => {
    const world = loadWorker({
      ownerSend: () => {
        throw new Error('unknown parameter: requesterToken');
      },
    });
    const data = await (await post(world)).json();
    expect(data.sent).toBe(1);
    expect(world.sent[0].via).toBe('user');
    expect(world.sent[0].emailAccessToken).toBe('owner-token');
    expect(world.me.puter.email.sendTransactional).toHaveBeenCalledTimes(1);
  });

  it("sends through sendTransactional, the API's current name", async () => {
    const world = loadWorker();
    await post(world);
    expect(world.me.puter.email.sendTransactional).toHaveBeenCalledTimes(1);
    expect(world.me.puter.email.send).toBeUndefined();
  });

  it('falls back to send() on a runtime whose SDK predates the rename', async () => {
    const world = loadWorker({ legacyMailer: true });
    const data = await (await post(world)).json();
    expect(data.sent).toBe(1);
    expect(world.sent[0].via).toBe('me');
    expect(world.me.puter.email.send).toHaveBeenCalledTimes(1);
  });

  it('never retries a message the transport already rejected on delivery', async () => {
    const world = loadWorker({
      ownerSend: () => {
        throw new Error('could not deliver to recipient');
      },
    });
    const data = await (await post(world)).json();
    expect(data.failed).toBe(1);
    expect(world.sent).toHaveLength(0); // and, crucially, not sent twice
  });
});

describe('email worker: the attachment is read before it is attached', () => {
  const MEETING = 'https://meetings.puter.com/#/m/abcd-efgh-ijkl';
  // The event exactly as the app hands it to toICS — every shape the
  // validator has to see through: a folded CONFERENCE line, a quoted CN with
  // a colon in it, a mixed-case organizer address, text properties carrying
  // a URL of their own, a recurrence rule.
  const appEvent = {
    id: 'evt-1',
    title: 'Team offsite; plan',
    start: Date.UTC(2026, 7, 13, 16),
    end: Date.UTC(2026, 7, 13, 17),
    allDay: false,
    location: 'Pier 39',
    description: 'Bring sunscreen\nhttps://example.com/agenda',
    meeting: { url: MEETING },
    organizer: { name: 'Nariman: Host', email: 'Host@Example.com' },
    guests: [{ email: 'ada@example.com', name: 'Ada, Countess', status: 'pending' }],
    recurrence: { freq: 'weekly', interval: 1, days: [4] },
    updatedAt: Date.UTC(2026, 7, 1),
  };
  const withEvent = (extra = {}) => ({
    ...payload().event,
    organizerEmail: 'host@example.com',
    meetingUrl: MEETING,
    ...extra,
  });
  const postCancel = (world, body) => world.worker.call('POST', '/cancellations', { json: body, user: world.caller });

  it("attaches the app's own invitation and cancellation files untouched", async () => {
    const invite = toICS([appEvent], { method: 'REQUEST', tzid: 'America/Los_Angeles', sequence: 5 });
    expect(invite).toMatch(/\r\n [^\r]/); // the fixture really is folded
    let world = loadWorker();
    let res = await post(world, payload({ ics: invite, event: withEvent() }));
    expect(res.status).toBe(200);
    expect(Buffer.from(world.sent[0].attachments[0].content, 'base64').toString('utf8')).toBe(invite);
    expect(world.sent[0].attachments[0].contentType).toBe('text/calendar; charset=utf-8; method=REQUEST');

    const cancel = toICS([appEvent], { method: 'CANCEL', status: 'CANCELLED', tzid: 'America/Los_Angeles', sequence: 9 });
    world = loadWorker();
    res = await postCancel(world, payload({ ics: cancel, event: withEvent() }));
    expect(res.status).toBe(200);
    expect(Buffer.from(world.sent[0].attachments[0].content, 'base64').toString('utf8')).toBe(cancel);
    expect(world.sent[0].attachments[0].contentType).toBe('text/calendar; charset=utf-8; method=CANCEL');
  });

  it('accepts a file with no organizer or link when the event has none', async () => {
    const bare = toICS([{ ...appEvent, meeting: null, organizer: null, guests: [] }], { method: 'REQUEST' });
    const world = loadWorker();
    const res = await post(world, payload({ ics: bare, event: { ...payload().event, organizerEmail: '' } }));
    expect(res.status).toBe(200);
    expect(world.sent[0].attachments).toHaveLength(1);
  });

  async function refused(route, body) {
    const world = loadWorker();
    const res = await world.worker.call('POST', route, { json: body, user: world.caller });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_ics');
    expect(world.sent).toHaveLength(0); // nothing goes out without its file, either
    return world;
  }

  it('refuses a URI carried in a parameter — ALTREP, DIR, SENT-BY', async () => {
    // A link can ride in a parameter as well as a value; ALTREP in particular
    // is what some clients render in place of the description's text.
    const inject = (line) =>
      toICS([appEvent], { method: 'REQUEST' }).replace(/^DESCRIPTION[^\r]*\r\n(?: [^\r]*\r\n)*/m, line + '\r\n');
    await refused('/invites', payload({ ics: inject('DESCRIPTION;ALTREP="https://evil.example/x":Agenda'), event: withEvent() }));
    await refused('/invites', payload({ ics: inject('DESCRIPTION;altrep="https://evil.example/x";LANGUAGE=en:Agenda'), event: withEvent() }));
    await refused('/invites', payload({ ics: inject('ORGANIZER;CN=Host;DIR="ldap://evil.example/":mailto:host@example.com'), event: withEvent() }));
    await refused('/invites', payload({ ics: inject('ATTENDEE;SENT-BY="mailto:evil@example.com":mailto:ada@example.com'), event: withEvent() }));
    // A colon inside a quoted parameter value is not the value separator:
    // the app's own quoted CN with a colon still passes.
    const world = loadWorker();
    const ok = await post(world, payload({ ics: toICS([appEvent], { method: 'REQUEST', tzid: 'America/Los_Angeles' }), event: withEvent() }));
    expect(ok.status).toBe(200);
  });

  it("refuses a METHOD that is not the route's", async () => {
    // A "Cancelled:" mail carrying a REQUEST would install the event it says
    // is off; an invitation carrying CANCEL would retract one.
    await refused('/cancellations', payload({ ics: 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n' }));
    await refused('/invites', payload({ ics: 'BEGIN:VCALENDAR\r\nMETHOD:CANCEL\r\nEND:VCALENDAR\r\n' }));
    await refused('/invites', payload({ ics: 'BEGIN:VCALENDAR\r\nmethod:PUBLISH\r\nEND:VCALENDAR\r\n' }));
  });

  it('refuses an ORGANIZER other than the one the body names', async () => {
    // Native RSVP buttons reply to ORGANIZER; a mail client shows it as the
    // sender of the invitation.
    const forged = (org) => `BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\n${org}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    await refused('/invites', payload({ ics: forged('ORGANIZER:mailto:ceo@victim.example') }));
    await refused('/invites', payload({ ics: forged('ORGANIZER;CN="Host":MAILTO:ceo@victim.example') }));
    // A quoted parameter cannot hide the real value.
    await refused('/invites', payload({ ics: forged('ORGANIZER;CN="x:mailto:host@example.com":mailto:ceo@victim.example') }));
    // …nor can naming an organizer when the body names none.
    await refused('/invites', payload({ ics: forged('ORGANIZER:mailto:host@example.com'), event: { ...payload().event, organizerEmail: '' } }));
  });

  it("refuses any link that is not the event's meeting link", async () => {
    const file = (prop) => `BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\n${prop}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    for (const prop of [
      'URL:https://evil.example/join',
      'X-GOOGLE-CONFERENCE:https://evil.example/join',
      'CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://evil.example/join',
      'ATTACH;FMTTYPE=application/pdf:https://evil.example/agenda.pdf',
      'X-ALT-DESC;FMTTYPE=text/html:<a href="https://evil.example">Join</a>',
      'url:https://evil.example/join', // case
      'UR\r\n L:https://evil.example/join', // folded across the property name
      'URL:https://meetings.puter.com/#/m/abcd-efgh-ijkl', // the RIGHT shape, but not this event's
    ]) {
      await refused('/invites', payload({ ics: file(prop) }));
    }
    // The event's own link is fine wherever a client looks for it — on a
    // cancellation too, whose body merely stops offering to join.
    const ok = file(`URL:${MEETING}\r\nX-GOOGLE-CONFERENCE:${MEETING}\r\nCONFERENCE;VALUE=URI;FEATURE=VIDEO:${MEETING}`);
    let world = loadWorker();
    expect((await post(world, payload({ ics: ok, event: withEvent() }))).status).toBe(200);
    world = loadWorker();
    expect((await postCancel(world, payload({ ics: ok.replace('METHOD:REQUEST', 'METHOD:CANCEL'), event: withEvent() }))).status).toBe(200);
  });

  it('leaves the host\'s own words alone, URLs and all', async () => {
    // A description or location is text to every client — the same words the
    // body already carries, escaped — and not a place a link is read from.
    const file =
      'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\n' +
      'DESCRIPTION:See https://example.com/agenda\\nJoin: https://meetings.puter.com/#/m/abcd-efgh-ijkl\r\n' +
      'LOCATION:https://maps.example/pier-39\r\nCOMMENT:mailto:someone@example.com\r\n' +
      'END:VEVENT\r\nEND:VCALENDAR\r\n';
    const world = loadWorker();
    expect((await post(world, payload({ ics: file }))).status).toBe(200);
  });
});

describe('email worker: the daily cap and a request that needs no mail', () => {
  it('answers a fully-deduped request with its skips, not a 429, once the cap is reached', async () => {
    const world = loadWorker();
    expect((await (await post(world)).json()).sent).toBe(1);
    const key = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    world.kv.map.set(key, 200); // today's budget is gone

    // The identical request again — a retry after a lost reply, or the same
    // event from a second device — would send nothing, so the cap has
    // nothing to refuse.
    const res = await post(world);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(data.results[0]).toMatchObject({ status: 'skipped', reason: 'already_sent' });
    expect(world.sent).toHaveLength(1);

    // A guest who actually needs mail is still refused.
    const busy = await post(world, payload({ recipients: [{ email: 'bob@example.com', rsvpUrl: LINK2, version: 'abcd1234' }] }));
    expect(busy.status).toBe(429);
  });
});
describe('email worker: replies (the /replies fallback for mail-received invitations)', () => {
  const asUser = (email) => ({
    ...CALLER,
    puter: { ...CALLER.puter, auth: { getUser: async () => ({ uuid: CALLER.uuid, email }) } },
  });

  function replyIcs({ organizerEmail = 'alice@example.com', attendeeEmail = 'host@example.com', status = 'ACCEPTED', method = 'REPLY' } = {}) {
    return toICS(
      [
        {
          id: 'evt-99',
          title: 'Team offsite',
          start: Date.UTC(2026, 7, 13, 16),
          end: Date.UTC(2026, 7, 13, 17),
          allDay: false,
          organizer: { email: organizerEmail },
          guests: [{ email: attendeeEmail, status: status.toLowerCase() === 'accepted' ? 'accepted' : status.toLowerCase() }],
        },
      ],
      { method },
    );
  }

  function replyPayload(overrides = {}) {
    return {
      event: {
        id: 'evt-99',
        title: 'Team offsite',
        when: 'Thu, Aug 13, 2026 · 9:00 – 10:00 AM (PDT)',
        organizerEmail: 'alice@example.com',
        organizerName: 'Alice',
      },
      attendee: { email: 'host@example.com', name: 'Host' },
      partstat: 'accepted',
      ics: replyIcs(),
      version: 'abcd1234',
      ...overrides,
    };
  }

  const postReply = (world, body = replyPayload(), user = world.caller) =>
    world.worker.call('POST', '/replies', { json: body, user });

  it('reports version 11 from /health', async () => {
    const world = loadWorker();
    const res = await world.worker.call('GET', '/health');
    expect((await res.json())).toMatchObject({ ok: true, version: '11' });
  });

  it('composes and sends a reply to the organizer, with no links anywhere', async () => {
    const world = loadWorker();
    const res = await postReply(world, replyPayload(), asUser('host@example.com'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, sent: 1, skipped: 0, failed: 0 });

    const [message] = world.sent;
    expect(message.to).toBe('alice@example.com');
    expect(message.subject).toBe('Accepted: Team offsite');
    expect(message.text).toContain('accepted your invitation');
    expect(message.html).not.toContain('<a ');
    expect(message.attachments[0].filename).toBe('reply.ics');
    expect(message.attachments[0].contentType).toBe('text/calendar; charset=utf-8; method=REPLY');
    expect(Buffer.from(message.attachments[0].content, 'base64').toString('utf8')).toContain('METHOD:REPLY');
  });

  it('refuses a reply that answers as someone else', async () => {
    const world = loadWorker();
    const res = await postReply(
      world,
      replyPayload({ attendee: { email: 'someoneelse@example.com', name: 'Nope' } }),
      asUser('host@example.com'),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('attendee_mismatch');
    expect(world.sent).toHaveLength(0);
  });

  it("allows replying as the invitation's own <username>@puter.email address, even if it differs from the account email", async () => {
    // The invitation was made out to host@puter.email; the signed-in account's
    // OWN email (host@example.com) is a different address entirely. Both name
    // the same person — refusing this would make it impossible to ever answer
    // as the address an invitation actually used.
    const world = loadWorker();
    const res = await postReply(
      world,
      replyPayload({
        attendee: { email: 'host@puter.email', name: 'Host' },
        ics: replyIcs({ attendeeEmail: 'host@puter.email' }),
      }),
      asUser('host@example.com'),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toBe(1);
  });

  it('refuses an .ics whose METHOD is not REPLY', async () => {
    const world = loadWorker();
    const res = await postReply(world, replyPayload({ ics: replyIcs({ method: 'REQUEST' }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_ics');
    expect(world.sent).toHaveLength(0);
  });

  it('rejects a request missing an event id, organizer, attendee, partstat, version, or .ics', async () => {
    const world = loadWorker();
    const cases = [
      [replyPayload({ event: { ...replyPayload().event, id: '' } }), 'event_id_required'],
      [replyPayload({ event: { ...replyPayload().event, organizerEmail: '' } }), 'organizer_required'],
      [replyPayload({ attendee: { email: '' } }), 'attendee_required'],
      [replyPayload({ partstat: 'maybe' }), 'partstat_required'],
      [replyPayload({ version: '' }), 'version_required'],
      [replyPayload({ ics: '' }), 'ics_required'],
    ];
    for (const [body, error] of cases) {
      const res = await postReply(world, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(error);
    }
    expect(world.sent).toHaveLength(0);
  });

  it('does not re-send the identical reply, but does send again when the answer changes', async () => {
    const world = loadWorker();
    expect((await (await postReply(world)).json()).sent).toBe(1);
    const dup = await (await postReply(world)).json();
    expect(dup).toMatchObject({ sent: 0, skipped: 1 });
    expect(dup.results[0]).toMatchObject({ status: 'skipped', reason: 'already_sent' });

    const changed = await (await postReply(world, replyPayload({ partstat: 'declined', version: 'ffff0001' }))).json();
    expect(changed.sent).toBe(1);
    expect(world.sent).toHaveLength(2);
    expect(world.sent[1].subject).toBe('Declined: Team offsite');
  });

  it('is refused by the daily cap like every other send', async () => {
    const world = loadWorker();
    await postReply(world); // seeds the counter key
    const key = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    world.kv.map.set(key, 200);
    const res = await postReply(world, replyPayload({ version: 'ffff0002' }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('daily_limit');
  });

  it('refuses a caller with no session', async () => {
    const world = loadWorker();
    const res = await world.worker.call('POST', '/replies', { json: replyPayload() });
    expect(res.status).toBe(401);
    expect(world.sent).toHaveLength(0);
  });
});

describe('email worker: the daily cap and a request that needs no mail', () => {
  it('answers a fully-deduped request with its skips, not a 429, once the cap is reached', async () => {
    const world = loadWorker();
    expect((await (await post(world)).json()).sent).toBe(1);
    const key = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    world.kv.map.set(key, 200); // today's budget is gone

    // The identical request again — a retry after a lost reply, or the same
    // event from a second device — would send nothing, so the cap has
    // nothing to refuse.
    const res = await post(world);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(data.results[0]).toMatchObject({ status: 'skipped', reason: 'already_sent' });
    expect(world.sent).toHaveLength(1);

    // A guest who actually needs mail is still refused.
    const busy = await post(world, payload({ recipients: [{ email: 'bob@example.com', rsvpUrl: LINK2, version: 'abcd1234' }] }));
    expect(busy.status).toBe(429);
  });
});
