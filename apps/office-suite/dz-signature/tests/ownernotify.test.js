import { describe, it, expect, beforeEach, vi } from 'vitest';
import signSource from '../src/workers/sign-worker.js?raw';
import emailSource from '../src/workers/email-worker.js?raw';
import { SIGN_WORKER_VERSION } from '../src/lib/signlinks.js';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';
import { makeFs } from './helpers/fake-puter.js';
import { createEmailer } from '../src/lib/emailer.js';

const SECRET = 'test-admin-secret';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const auth = { authorization: `Bearer ${SECRET}` };

/* ---- The sign worker mailing its own owner -------------------------------- */

async function buildSignWorker({ email = null } = {}) {
  const source = signSource
    .replace('__SIGN_ADMIN_SECRET_HASH__', await sha256Hex(SECRET))
    .replace('__SIGN_WORKER_VERSION__', SIGN_WORKER_VERSION)
    .replace('__SIGN_PAGE_URL__', 'https://signatures.example/sign.html');
  const fs = makeFs();
  await fs.write('signatures-data/d1/original.pdf', new Uint8Array([1, 2, 3]));
  const sent = [];
  const puter = { kv: makeKv(), fs };
  if (email !== false) {
    puter.email = {
      send: vi.fn(async (message) => {
        if (email === 'refuse') throw new Error('unauthorized token for own account');
        sent.push(message);
        return {};
      }),
    };
  }
  return { worker: instantiateWorker(source, { me: { puter } }), sent };
}

function snapshot(notify) {
  return {
    doc: { id: 'd1', title: 'NDA', pageCount: 1, pdfPath: 'signatures-data/d1/original.pdf' },
    signers: [
      { id: 's1', name: 'Ava Chen', email: 'ava@example.com', kind: 'external' },
      { id: 's2', name: 'Bo Diaz', email: 'bo@example.com', kind: 'external' },
    ],
    fields: [
      { id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true },
      { id: 'f2', signerId: 's2', type: 'signature', page: 0, x: 0.5, y: 0.8, w: 0.3, h: 0.05, required: true },
    ],
    values: {},
    notify,
  };
}

const ALL_ON = {
  email: 'owner@example.com', sign: true, decline: true, complete: true,
  docUrl: 'https://signatures.example/#/doc/d1',
};

describe('the sign worker tells its owner', () => {
  let worker;
  let sent;

  async function sync(notify = ALL_ON) {
    const res = await worker.call('POST', '/admin/sync', { headers: auth, json: snapshot(notify) });
    return (await res.json()).links;
  }

  async function signAs(token, values) {
    await worker.call('POST', `/api/sign/${token}`, { json: { action: 'consent', disclosureVersion: '1' } });
    return worker.call('POST', `/api/sign/${token}`, { json: { action: 'sign', values } });
  }

  beforeEach(async () => {
    ({ worker, sent } = await buildSignWorker());
  });

  it('mails the owner when a signer signs, and again on completion', async () => {
    const links = await sync();
    await signAs(links.s1, { f1: { kind: 'image', data: IMG } });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('owner@example.com');
    expect(sent[0].subject).toBe('Signed: Ava Chen signed "NDA"');

    await signAs(links.s2, { f2: { kind: 'image', data: IMG } });
    // The second signature, plus the completion it caused.
    expect(sent.map((m) => m.subject)).toEqual([
      'Signed: Ava Chen signed "NDA"',
      'Signed: Bo Diaz signed "NDA"',
      'Completed: "NDA" has been signed by everyone',
    ]);
    // The completion mail is the one that carries the link.
    expect(sent[2].html).toContain('https://signatures.example/#/doc/d1');
    expect(sent[0].html).not.toContain('href');
  });

  it('sends only what the owner asked for', async () => {
    const links = await sync({ ...ALL_ON, sign: false });
    await signAs(links.s1, { f1: { kind: 'image', data: IMG } });
    expect(sent).toHaveLength(0);
    await signAs(links.s2, { f2: { kind: 'image', data: IMG } });
    expect(sent.map((m) => m.subject)).toEqual(['Completed: "NDA" has been signed by everyone']);
  });

  it('mails a decline and never repeats itself', async () => {
    const links = await sync();
    await worker.call('POST', `/api/sign/${links.s1}`, { json: { action: 'decline', reason: 'no' } });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('Declined: Ava Chen');
    // A replayed decline is refused before it can mail again.
    await worker.call('POST', `/api/sign/${links.s1}`, { json: { action: 'decline' } });
    expect(sent).toHaveLength(1);
  });

  it('says nothing when no address or no preference came across', async () => {
    const links = await sync({ email: '', sign: true, decline: true, complete: true });
    await signAs(links.s1, { f1: { kind: 'image', data: IMG } });
    expect(sent).toHaveLength(0);
  });

  it('reports what it attempted, so the app can finish the job', async () => {
    const links = await sync();
    await signAs(links.s1, { f1: { kind: 'image', data: IMG } });
    const out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.notified.d1['sign:s1']).toMatchObject({ ok: true, kind: 'sign' });
  });

  it('records the failure rather than losing it, and never fails the signature', async () => {
    ({ worker, sent } = await buildSignWorker({ email: 'refuse' }));
    const links = await sync();
    const res = await signAs(links.s1, { f1: { kind: 'image', data: IMG } });
    expect(res.status).toBe(200); // the signature stands
    const out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.notified.d1['sign:s1']).toMatchObject({ ok: false });
    expect(out.notified.d1['sign:s1'].error).toContain('unauthorized');
  });

  it('survives a platform with no email at all', async () => {
    ({ worker, sent } = await buildSignWorker({ email: false }));
    const links = await sync();
    expect((await signAs(links.s1, { f1: { kind: 'image', data: IMG } })).status).toBe(200);
    const out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.notified.d1['sign:s1']).toMatchObject({ ok: false, error: 'email_unavailable' });
  });

  it('revoking a document clears what it remembered telling the owner', async () => {
    const links = await sync();
    await signAs(links.s1, { f1: { kind: 'image', data: IMG } });
    await worker.call('POST', '/admin/revoke', { headers: auth, json: { docId: 'd1' } });
    const out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.notified.d1).toBeUndefined();
  });
});

/* ---- The app's fallback --------------------------------------------------- */

describe('the app finishes what the worker could not', () => {
  const doc = {
    id: 'd1',
    title: 'NDA',
    pageCount: 1,
    status: 'completed',
    completedAt: 5,
    signers: [
      { id: 's1', name: 'Ava Chen', email: 'ava@example.com', status: 'signed', signedAt: 3 },
      { id: 'me', name: 'Alex', isMe: true, status: 'signed', signedAt: 4 },
    ],
  };

  function emailerWith({ kinds = ['request', 'reminder', 'completed', 'owner'], exec } = {}) {
    return createEmailer({
      store: { settings: {}, user: { username: 'alex', email: 'owner@example.com' }, patchDoc: async () => {}, getDoc: () => doc, addAudit: () => {}, persistDoc: async () => {} },
      getPuter: () => ({ workers: { exec } }),
      fetchFn: async () => ({ ok: true, json: async () => ({ ok: true, version: '2', kinds }) }),
    });
  }

  it('sends the owner update through the app-owned worker', async () => {
    const calls = [];
    const emailer = emailerWith({
      exec: async (url, init) => {
        calls.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ ok: true, sent: 1, results: [] }) };
      },
    });
    const out = await emailer.notifyOwner(doc, [{ type: 'completed', who: '', at: 5 }]);
    expect(out.sent).toBe(1);
    expect(calls[0].kind).toBe('owner');
    expect(calls[0].recipients[0].email).toBe('owner@example.com');
    expect(calls[0].events).toEqual([{ type: 'completed', who: '', at: 5 }]);
  });

  it('stays quiet when the deployed worker is too old to compose it', async () => {
    const exec = vi.fn();
    const emailer = emailerWith({ kinds: ['request', 'reminder', 'completed'], exec });
    const out = await emailer.notifyOwner(doc, [{ type: 'completed', who: '', at: 5 }]);
    expect(out.unsupported).toBe(true);
    expect(exec).not.toHaveBeenCalled();
  });
});

/* ---- The email worker's owner kind --------------------------------------- */

describe('email worker owner updates', () => {
  let worker;
  const sent = [];

  beforeEach(async () => {
    sent.length = 0;
    const email = { send: async (m) => (sent.push(m), {}) };
    worker = instantiateWorker(emailSource, {
      me: { puter: { kv: makeKv(), email, authToken: 'owner-token' } },
    });
  });

  const caller = {
    uuid: 'u-1',
    puter: { authToken: 'caller-token', auth: { getUser: async () => ({ uuid: 'u-1', email: 'owner@example.com' }) } },
  };

  const body = (over = {}) => ({
    doc: { id: 'd1', title: 'NDA', ownerName: 'Alex', ownerEmail: 'owner@example.com', pageCount: 1 },
    recipients: [{ email: 'owner@example.com', version: 'abcdef12' }],
    kind: 'owner',
    events: [{ type: 'signed', who: 'Ava Chen', at: 1 }],
    ...over,
  });

  it('advertises the kinds it can compose', async () => {
    const out = await (await worker.call('GET', '/health')).json();
    expect(out.kinds).toContain('owner');
  });

  it('composes an owner update with no links in it', async () => {
    const res = await worker.call('POST', '/send', { json: body(), user: caller });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Signed: activity on "NDA"');
    expect(sent[0].text).toContain('Ava Chen signed.');
    expect(sent[0].html).not.toContain('href');
  });

  it('addresses it to the caller\'s own account, not the address in the request', async () => {
    await worker.call('POST', '/send', {
      json: body({ recipients: [{ email: 'someone.else@example.com', version: 'abcdef12' }] }),
      user: caller,
    });
    expect(sent[0].to).toBe('owner@example.com');
  });

  it('refuses an owner update with no events', async () => {
    const res = await worker.call('POST', '/send', { json: body({ events: [] }), user: caller });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('events_required');
  });

  it('names a decline and a completion for what they are', async () => {
    await worker.call('POST', '/send', {
      json: body({ events: [{ type: 'declined', who: 'Bo Diaz', at: 2 }] }),
      user: caller,
    });
    expect(sent[0].subject).toContain('Declined');
    expect(sent[0].text).toContain('Bo Diaz declined to sign');
    await worker.call('POST', '/send', {
      json: body({ events: [{ type: 'completed', who: '', at: 3 }], recipients: [{ email: 'owner@example.com', version: 'beefbeef' }] }),
      user: caller,
    });
    expect(sent[1].subject).toContain('Completed');
  });
});
