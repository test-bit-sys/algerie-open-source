import { describe, it, expect, beforeEach } from 'vitest';
import rawSource from '../src/workers/sign-worker.js?raw';
import { SIGN_WORKER_VERSION } from '../src/lib/signlinks.js';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';
import { makeFs } from './helpers/fake-puter.js';
import { isSignerTurn, currentTurn, effectiveSignerStatus } from '../src/lib/model.js';
import { createEmailer } from '../src/lib/emailer.js';

const SECRET = 'test-admin-secret';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const auth = { authorization: `Bearer ${SECRET}` };

/* ---- The pure side ------------------------------------------------------- */

const parallel = {
  signOrder: false,
  signers: [
    { id: 'a', name: 'Ava', status: 'pending' },
    { id: 'b', name: 'Bo', status: 'pending' },
  ],
};
const ordered = { ...parallel, signOrder: true };

describe('signing order model', () => {
  it('without the toggle everyone may sign at once', () => {
    expect(isSignerTurn(parallel, 'a')).toBe(true);
    expect(isSignerTurn(parallel, 'b')).toBe(true);
    expect(currentTurn(parallel)).toBeNull();
    expect(effectiveSignerStatus(parallel, parallel.signers[1])).toBe('pending');
  });

  it('with the toggle a turn opens only when everyone earlier has signed', () => {
    expect(isSignerTurn(ordered, 'a')).toBe(true);
    expect(isSignerTurn(ordered, 'b')).toBe(false);
    expect(currentTurn(ordered).id).toBe('a');
    expect(effectiveSignerStatus(ordered, ordered.signers[1])).toBe('waiting');

    const after = { signOrder: true, signers: [{ ...ordered.signers[0], status: 'signed' }, ordered.signers[1]] };
    expect(isSignerTurn(after, 'b')).toBe(true);
    expect(currentTurn(after).id).toBe('b');
    expect(effectiveSignerStatus(after, after.signers[1])).toBe('pending');
  });

  it('a signer who already answered keeps their own status', () => {
    const doc = {
      signOrder: true,
      signers: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'declined' }],
    };
    expect(effectiveSignerStatus(doc, doc.signers[1])).toBe('declined');
    // A decline ends signing, so nobody is next.
    expect(currentTurn(doc).id).toBe('a');
  });

  it('an unknown signer has no turn', () => {
    expect(isSignerTurn(ordered, 'nobody')).toBe(false);
  });
});

describe('sequential request email', () => {
  const doc = {
    id: 'd1',
    title: 'NDA',
    signOrder: true,
    pageCount: 1,
    links: { a: 'https://w.puter.work/sign/aa', b: 'https://w.puter.work/sign/bb' },
    signers: [
      { id: 'a', name: 'Ava', email: 'ava@example.com', status: 'pending' },
      { id: 'b', name: 'Bo', email: 'bo@example.com', status: 'pending' },
    ],
  };
  const emailer = createEmailer({
    store: { settings: { fullName: 'Alex' }, user: { username: 'alex' } },
    getPuter: () => ({ workers: { exec: () => {} } }),
  });

  it('plans only the signer whose turn it is', () => {
    expect(emailer.planFor(doc, 'request').map((r) => r.email)).toEqual(['ava@example.com']);
    const next = { ...doc, signers: [{ ...doc.signers[0], status: 'signed' }, doc.signers[1]] };
    expect(emailer.planFor(next, 'request').map((r) => r.email)).toEqual(['bo@example.com']);
    expect(emailer.planFor(next, 'reminder').map((r) => r.email)).toEqual(['bo@example.com']);
  });

  it('the completion notice still goes to everyone', () => {
    expect(emailer.planFor(doc, 'completed').map((r) => r.email)).toEqual(['ava@example.com', 'bo@example.com']);
  });

  it('parallel documents plan everyone', () => {
    expect(emailer.planFor({ ...doc, signOrder: false }, 'request')).toHaveLength(2);
  });
});

/* ---- The worker gate ----------------------------------------------------- */

async function buildWorker() {
  const source = rawSource
    .replace('__SIGN_ADMIN_SECRET_HASH__', await sha256Hex(SECRET))
    .replace('__SIGN_WORKER_VERSION__', SIGN_WORKER_VERSION)
    .replace('__SIGN_PAGE_URL__', 'https://signatures.example/sign.html');
  const fs = makeFs();
  await fs.write('signatures-data/d1/original.pdf', new Uint8Array([1, 2, 3]));
  const worker = instantiateWorker(source, { me: { puter: { kv: makeKv(), fs } } });
  return worker;
}

function snapshot(overrides = {}) {
  return {
    doc: {
      id: 'd1', title: 'NDA', pageCount: 1, pdfPath: 'signatures-data/d1/original.pdf',
    },
    signers: [
      { id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external' },
      { id: 's2', name: 'Bo', email: 'bo@example.com', kind: 'external' },
    ],
    fields: [
      { id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true },
      { id: 'f2', signerId: 's2', type: 'signature', page: 0, x: 0.5, y: 0.8, w: 0.3, h: 0.05, required: true },
    ],
    values: {},
    signOrder: true,
    order: ['s1', 's2'],
    ...overrides,
  };
}

describe('sign worker signing order', () => {
  let worker;

  beforeEach(async () => {
    worker = await buildWorker();
  });

  async function sync(body = snapshot()) {
    const res = await worker.call('POST', '/admin/sync', { headers: auth, json: body });
    expect(res.status).toBe(200);
    return (await res.json()).links;
  }

  /**
   * Consent, then sign: the worker refuses a signature it has no recorded
   * agreement for, which is the point of the consent step.
   */
  async function signAs(path, values) {
    await worker.call('POST', path, { json: { action: 'consent', disclosureVersion: '1' } });
    return worker.call('POST', path, { json: { action: 'sign', values } });
  }

  it('serves the first signer and holds the second back', async () => {
    const links = await sync();
    const first = await worker.call('GET', `/api/sign/${links.s1}`);
    expect(first.status).toBe(200);

    const second = await worker.call('GET', `/api/sign/${links.s2}`);
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body).toMatchObject({ error: 'not_yet', waitingFor: 'Ava', position: 2, total: 2, channel: '' });
    // Nothing about the document leaks in the refusal.
    expect(JSON.stringify(body)).not.toContain('NDA');
  });

  it('tells a held-back signer how the sender hands links out', async () => {
    // The page words the wait on it: an email is only promised when the
    // sender chose email; a copied link is announced by the sender.
    const links = await sync(snapshot({ channel: 'link' }));
    expect((await (await worker.call('GET', `/api/sign/${links.s2}`)).json()).channel).toBe('link');
    // The document view says so too, for what happens after signing.
    expect((await (await worker.call('GET', `/api/sign/${links.s1}`)).json()).channel).toBe('link');
    await sync(snapshot({ channel: 'email' }));
    expect((await (await worker.call('GET', `/api/sign/${links.s2}`)).json()).channel).toBe('email');
    // Anything else is unknown, never trusted as a channel.
    await sync(snapshot({ channel: 'carrier pigeon' }));
    expect((await (await worker.call('GET', `/api/sign/${links.s2}`)).json()).channel).toBe('');
  });

  it('refuses the file and the submission before a signer\'s turn', async () => {
    const links = await sync();
    const pdf = await worker.call('GET', `/api/sign/${links.s2}/pdf`);
    expect(pdf.status).toBe(409);
    expect((await pdf.json()).error).toBe('not_yet');

    const post = await signAs(`/api/sign/${links.s2}`, { f2: { kind: 'image', data: IMG } });
    expect(post.status).toBe(409);
    expect((await post.json()).error).toBe('not_yet');
    // And nothing was written for them.
    const responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s2).toBeUndefined();
  });

  it('a held-back visit is not recorded as a view', async () => {
    const links = await sync();
    await worker.call('GET', `/api/sign/${links.s2}`);
    const responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s2).toBeUndefined();
  });

  it('opens the next turn when the signer ahead signs', async () => {
    const links = await sync();
    const signed = await signAs(`/api/sign/${links.s1}`, { f1: { kind: 'image', data: IMG } });
    expect(signed.status).toBe(200);

    const second = await worker.call('GET', `/api/sign/${links.s2}`);
    expect(second.status).toBe(200);
    const data = await second.json();
    expect(data.doc.title).toBe('NDA');
    // The co-signer's signature is on the document they now see.
    expect(data.fields.find((f) => f.id === 'f1').value.kind).toBe('image');

    const pdf = await worker.call('GET', `/api/sign/${links.s2}/pdf`);
    expect(pdf.status).toBe(200);
  });

  it('waits on a self signer (the owner) like anyone else', async () => {
    const links = await sync(snapshot({
      signers: [
        { id: 'me', name: 'Alex', kind: 'self', signed: false },
        { id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external' },
      ],
      order: ['me', 's1'],
      fields: [{ id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true }],
    }));
    expect((await worker.call('GET', `/api/sign/${links.s1}`)).status).toBe(409);

    // The app pushes the owner's signature as part of the next snapshot.
    await sync(snapshot({
      signers: [
        { id: 'me', name: 'Alex', kind: 'self', signed: true },
        { id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external' },
      ],
      order: ['me', 's1'],
      fields: [{ id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true }],
    }));
    expect((await worker.call('GET', `/api/sign/${links.s1}`)).status).toBe(200);
  });

  it('tells a signer parked behind a decline that signing is closed', async () => {
    const links = await sync();
    await worker.call('POST', `/api/sign/${links.s1}`, { json: { action: 'decline', reason: 'No' } });
    // Bo's turn is never coming. "Wait for Ava" - who is the one who declined -
    // and the promise of an email would both be wrong; and still nothing about
    // the document is served or recorded.
    for (const path of [`/api/sign/${links.s2}`, `/api/sign/${links.s2}/pdf`]) {
      const res = await worker.call('GET', path);
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('declined');
      expect(JSON.stringify(body)).not.toContain('NDA');
    }
    const post = await signAs(`/api/sign/${links.s2}`, { f2: { kind: 'image', data: IMG } });
    expect(post.status).toBe(410);
    expect((await post.json()).error).toBe('declined');
    const responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s2).toBeUndefined();
  });

  it('leaves parallel documents ungated', async () => {
    const links = await sync(snapshot({ signOrder: false }));
    expect((await worker.call('GET', `/api/sign/${links.s2}`)).status).toBe(200);
  });

  it('keeps the order across a re-sync and drops signers who left', async () => {
    const links = await sync();
    await sync(snapshot({
      signers: [{ id: 's2', name: 'Bo', email: 'bo@example.com', kind: 'external' }],
      order: ['s1', 's2'],
      fields: [{ id: 'f2', signerId: 's2', type: 'signature', page: 0, x: 0.5, y: 0.8, w: 0.3, h: 0.05, required: true }],
    }));
    // s1 is gone from the document, so s2 is now first in line and unblocked.
    const second = await worker.call('GET', `/api/sign/${links.s2}`);
    expect(second.status).toBe(200);
    expect((await worker.call('GET', `/api/sign/${links.s1}`)).status).toBe(404);
  });
});
