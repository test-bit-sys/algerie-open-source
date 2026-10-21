import { describe, it, expect, beforeEach, vi } from 'vitest';
import rawSource from '../src/workers/email-worker.js?raw';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';

const LINK = `https://doc-sign-abc12.puter.work/sign/${'a'.repeat(40)}`;

function makeCaller(sendImpl) {
  return {
    uuid: 'user-1',
    puter: {
      authToken: 'caller-token',
      email: { send: vi.fn(sendImpl || (async () => ({}))) },
    },
  };
}

function makeOwner(sendImpl) {
  const kv = makeKv();
  return {
    kv,
    me: {
      puter: {
        kv,
        authToken: 'owner-token',
        email: { send: vi.fn(sendImpl || (async () => ({}))) },
      },
    },
  };
}

function request(overrides = {}) {
  return {
    doc: { id: 'd1', title: 'NDA', ownerName: 'Alex', ownerEmail: 'alex@example.com', pageCount: 2 },
    recipients: [{ email: 'ava@example.com', name: 'Ava', signUrl: LINK, version: 'abcd1234' }],
    kind: 'request',
    note: '',
    ...overrides,
  };
}

describe('email worker', () => {
  let owner;
  let worker;

  beforeEach(() => {
    owner = makeOwner();
    worker = instantiateWorker(rawSource, { me: owner.me });
  });

  it('refuses anonymous callers: no session, no send', async () => {
    const res = await worker.call('POST', '/send', { json: request() });
    expect(res.status).toBe(401);
    expect(owner.me.puter.email.send).not.toHaveBeenCalled();
  });

  it('sends one private mail per signer, billed via the caller token', async () => {
    const user = makeCaller();
    const res = await worker.call('POST', '/send', { json: request(), user });
    const out = await res.json();
    expect(out.sent).toBe(1);
    expect(out.results[0]).toMatchObject({ email: 'ava@example.com', status: 'sent' });
    const message = owner.me.puter.email.send.mock.calls[0][0];
    expect(message.to).toBe('ava@example.com');
    expect(message.subject).toContain('Alex sent you "NDA" to sign');
    expect(message.requesterToken).toBe('caller-token');
    expect(message.replyTo).toBe('alex@example.com');
    expect(message.text).toContain(LINK);
    expect(message.html).toContain(LINK);
  });

  it('sends one message per address in a request, whatever it is asked for', async () => {
    // Why sendBlockers refuses two signers sharing an address: the second one
    // is dropped here, and the sender would never learn they were not mailed.
    const user = makeCaller();
    const out = await (await worker.call('POST', '/send', {
      json: request({
        recipients: [
          { email: 'ava@example.com', name: 'Ava', signUrl: LINK, version: 'abcd1234' },
          { email: 'ava@example.com', name: 'Ava (witness)', signUrl: `https://doc-sign-abc12.puter.work/sign/${'b'.repeat(40)}`, version: 'beef5678' },
        ],
      }),
      user,
    })).json();
    expect(out.sent).toBe(1);
    expect(out.results).toHaveLength(1);
    expect(owner.me.puter.email.send).toHaveBeenCalledTimes(1);
  });

  it('deduplicates by version, and force overrides', async () => {
    const user = makeCaller();
    await worker.call('POST', '/send', { json: request(), user });
    const second = await (await worker.call('POST', '/send', { json: request(), user })).json();
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.results[0].reason).toBe('already_sent');

    const forced = await (await worker.call('POST', '/send', { json: request({ force: true }), user })).json();
    expect(forced.sent).toBe(1);
  });

  it('a changed version (new link or details) sends again', async () => {
    const user = makeCaller();
    await worker.call('POST', '/send', { json: request(), user });
    const changed = request();
    changed.recipients[0].version = 'ffff9999';
    const out = await (await worker.call('POST', '/send', { json: changed, user })).json();
    expect(out.sent).toBe(1);
  });

  it('never mails a link that is not a puter.work sign capability', async () => {
    const user = makeCaller();
    const evil = request();
    evil.recipients[0].signUrl = 'https://phish.example/sign/' + 'a'.repeat(40);
    const out = await (await worker.call('POST', '/send', { json: evil, user })).json();
    expect(out.sent).toBe(1); // the mail goes, without any link
    const message = owner.me.puter.email.send.mock.calls[0][0];
    expect(message.text).not.toContain('phish.example');
    expect(message.html).not.toContain('phish.example');
  });

  it('folds header injection attempts out of the subject', async () => {
    const user = makeCaller();
    const sneaky = request();
    sneaky.doc.title = 'NDA\r\nBcc: everyone@example.com';
    await worker.call('POST', '/send', { json: sneaky, user });
    const message = owner.me.puter.email.send.mock.calls[0][0];
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.subject).toContain('NDA Bcc: everyone@example.com');
  });

  it('escapes sender-supplied text in the HTML body', async () => {
    const user = makeCaller();
    const sneaky = request({ note: '<script>alert(1)</script>' });
    await worker.call('POST', '/send', { json: sneaky, user });
    const message = owner.me.puter.email.send.mock.calls[0][0];
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('requires a version digest for every recipient', async () => {
    const user = makeCaller();
    const bad = request();
    delete bad.recipients[0].version;
    const res = await worker.call('POST', '/send', { json: bad, user });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('version_required');
  });

  it('composes reminder and completed subjects distinctly', async () => {
    const user = makeCaller();
    await worker.call('POST', '/send', { json: request({ kind: 'reminder', force: true }), user });
    expect(owner.me.puter.email.send.mock.calls[0][0].subject).toContain('Reminder:');
    await worker.call('POST', '/send', { json: request({ kind: 'completed', force: true }), user });
    expect(owner.me.puter.email.send.mock.calls[1][0].subject).toContain('Completed:');
  });

  it('enforces the daily cap', async () => {
    const user = makeCaller();
    const rateKey = `mail:rate:${await sha256Hex('user-1')}:${new Date().toISOString().slice(0, 10)}`;
    owner.kv.map.set(rateKey, 100);
    const res = await worker.call('POST', '/send', { json: request(), user });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('daily_limit');
  });

  it('reports suppressed recipients apart from failures and does not record them as sent', async () => {
    owner = makeOwner(async () => ({ suppressed: ['ava@example.com'] }));
    worker = instantiateWorker(rawSource, { me: owner.me });
    const user = makeCaller();
    const out = await (await worker.call('POST', '/send', { json: request(), user })).json();
    expect(out.suppressed).toBe(1);
    expect(out.sent).toBe(0);
    // Not deduped: a later retry may reach them if they resubscribe.
    const again = await (await worker.call('POST', '/send', { json: request(), user })).json();
    expect(again.skipped).toBe(0);
  });

  it('falls back to the caller-sends form when the runtime rejects the first', async () => {
    owner = makeOwner(async () => {
      throw new Error('unknown parameter requesterToken');
    });
    worker = instantiateWorker(rawSource, { me: owner.me });
    const user = makeCaller(async () => ({}));
    const out = await (await worker.call('POST', '/send', { json: request(), user })).json();
    expect(out.sent).toBe(1);
    const viaCaller = user.puter.email.send.mock.calls[0][0];
    expect(viaCaller.emailAccessToken).toBe('owner-token');
  });

  it('never retries a message the transport already rejected as delivery', async () => {
    owner = makeOwner(async () => {
      throw new Error('recipient mailbox unavailable');
    });
    worker = instantiateWorker(rawSource, { me: owner.me });
    const user = makeCaller();
    const out = await (await worker.call('POST', '/send', { json: request(), user })).json();
    expect(out.failed).toBe(1);
    expect(user.puter.email.send).not.toHaveBeenCalled();
  });

  it('health and whoami answer without sending anything', async () => {
    expect((await (await worker.call('GET', '/health')).json()).ok).toBe(true);
    const who = await (await worker.call('GET', '/whoami', { user: makeCaller() })).json();
    expect(who.identified).toBe(true);
    expect(who.has.puter).toBe(true);
    expect(JSON.stringify(who)).not.toContain('caller-token');
  });
});
