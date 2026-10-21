import { describe, it, expect, beforeEach } from 'vitest';
import rawSource from '../src/workers/sign-worker.js?raw';
import { SIGN_WORKER_VERSION } from '../src/lib/signlinks.js';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';
import { makeFs } from './helpers/fake-puter.js';

const SECRET = 'test-admin-secret';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

async function buildWorker() {
  const source = rawSource
    .replace('__SIGN_ADMIN_SECRET_HASH__', await sha256Hex(SECRET))
    .replace('__SIGN_WORKER_VERSION__', SIGN_WORKER_VERSION)
    .replace('__SIGN_PAGE_URL__', 'https://signatures.example/sign.html');
  const fs = makeFs();
  await fs.write('signatures-data/d1/original.pdf', new Uint8Array([1, 2, 3]));
  const kv = makeKv();
  const worker = instantiateWorker(source, { me: { puter: { kv, fs } } });
  return { worker, kv, fs };
}

const auth = { authorization: `Bearer ${SECRET}` };

function snapshot(overrides = {}) {
  return {
    doc: {
      id: 'd1', title: 'NDA', note: 'please sign', ownerName: 'Alex',
      ownerEmail: 'alex@example.com', pageCount: 2, pdfPath: 'signatures-data/d1/original.pdf',
    },
    signers: [
      { id: 'me', name: 'Alex', email: 'alex@example.com', kind: 'self', signed: false },
      { id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external' },
      { id: 's2', name: 'Bo', email: 'bo@example.com', kind: 'external' },
    ],
    fields: [
      { id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true },
      { id: 'f2', signerId: 's1', type: 'checkbox', page: 0, x: 0.1, y: 0.6, w: 0.03, h: 0.03, required: false },
      { id: 'f3', signerId: 's2', type: 'signature', page: 1, x: 0.5, y: 0.8, w: 0.3, h: 0.05, required: true },
      { id: 'f4', signerId: 'me', type: 'signature', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true },
    ],
    values: {},
    ...overrides,
  };
}

describe('sign worker', () => {
  let worker;
  let kv;

  beforeEach(async () => {
    ({ worker, kv } = await buildWorker());
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

  it('exposes health without auth, admin only with the secret', async () => {
    const health = await worker.call('GET', '/health');
    expect((await health.json()).version).toBe(SIGN_WORKER_VERSION);
    expect((await worker.call('GET', '/admin/ping')).status).toBe(401);
    expect((await worker.call('GET', '/admin/ping', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await worker.call('GET', '/admin/ping', { headers: auth })).status).toBe(200);
    expect((await worker.call('GET', '/admin/responses')).status).toBe(401);
    expect((await worker.call('POST', '/admin/sync', { json: snapshot() })).status).toBe(401);
  });

  it('mints tokens for external signers only, and keeps them across re-syncs', async () => {
    const links = await sync();
    expect(Object.keys(links).sort()).toEqual(['s1', 's2']);
    expect(links.me).toBeUndefined();
    expect(links.s1).toMatch(/^[0-9a-f]{40}$/);

    const again = await sync();
    expect(again).toEqual({}); // nothing re-minted

    const reissued = await worker.call('POST', '/admin/sync', {
      headers: auth, json: { ...snapshot(), reissue: ['s1'] },
    });
    const fresh = (await reissued.json()).links;
    expect(fresh.s1).toMatch(/^[0-9a-f]{40}$/);
    expect(fresh.s1).not.toBe(links.s1);
    // The old token is dead.
    expect((await worker.call('GET', `/api/sign/${links.s1}`)).status).toBe(404);
    expect((await worker.call('GET', `/api/sign/${fresh.s1}`)).status).toBe(200);
  });

  it('serves the signer view, marks first contact as viewed, hides others incomplete fields values', async () => {
    const links = await sync();
    const res = await worker.call('GET', `/api/sign/${links.s1}`);
    const data = await res.json();
    expect(data.doc.title).toBe('NDA');
    expect(data.signer.email).toBe('ava@example.com');
    expect(data.signer.status).toBe('viewed');
    const mine = data.fields.filter((f) => f.mine).map((f) => f.id).sort();
    expect(mine).toEqual(['f1', 'f2']);
    // Viewed is recorded for the pull.
    const responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s1.status).toBe('viewed');
    expect(responses.docs.d1.s2).toBeUndefined();
  });

  it('rejects malformed and unknown tokens', async () => {
    expect((await worker.call('GET', '/api/sign/nothex')).status).toBe(404);
    expect((await worker.call('GET', `/api/sign/${'a'.repeat(40)}`)).status).toBe(404);
  });

  it('validates submissions: missing required fields are refused', async () => {
    const links = await sync();
    const res = await signAs(`/api/sign/${links.s1}`, { f2: true });
    expect(res.status).toBe(400);
    const out = await res.json();
    expect(out.error).toBe('missing_required');
    expect(out.fields).toEqual(['f1']);
  });

  it('refuses values that are not valid images for signature fields', async () => {
    const links = await sync();
    const res = await signAs(`/api/sign/${links.s1}`, { f1: { kind: 'image', data: 'javascript:alert(1)' } });
    expect(res.status).toBe(400);
  });

  it('accepts a full submission once, then conflicts on replays', async () => {
    const links = await sync();
    const res = await signAs(`/api/sign/${links.s1}`, { f1: { kind: 'image', data: IMG }, f2: true });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('signed');
    const replay = await signAs(`/api/sign/${links.s1}`, { f1: { kind: 'image', data: IMG } });
    expect(replay.status).toBe(409);
  });

  it('a signature a co-signer submitted shows on other signers pages', async () => {
    const links = await sync();
    await signAs(`/api/sign/${links.s1}`, { f1: { kind: 'image', data: IMG } });
    const view = await (await worker.call('GET', `/api/sign/${links.s2}`)).json();
    const f1 = view.fields.find((f) => f.id === 'f1');
    expect(f1.mine).toBe(false);
    expect(f1.value).toEqual({ kind: 'image', data: IMG });
  });

  it('completes only when self signers are signed too', async () => {
    const links = await sync();
    await signAs(`/api/sign/${links.s1}`, { f1: { kind: 'image', data: IMG } });
    const second = await (await signAs(`/api/sign/${links.s2}`, { f3: { kind: 'image', data: IMG } })).json();
    expect(second.state).toBe('open'); // the owner hasn't signed yet

    // The app re-syncs with the owner signed; now the doc reads completed.
    const signers = snapshot().signers.map((s) => (s.id === 'me' ? { ...s, signed: true } : s));
    await sync({ ...snapshot(), signers });
    const view = await (await worker.call('GET', `/api/sign/${links.s1}`)).json();
    expect(view.state).toBe('completed');
  });

  it('a decline closes signing for everyone', async () => {
    const links = await sync();
    const declined = await worker.call('POST', `/api/sign/${links.s1}`, {
      json: { action: 'decline', reason: 'Wrong terms' },
    });
    expect(declined.status).toBe(200);
    const other = await signAs(`/api/sign/${links.s2}`, { f3: { kind: 'image', data: IMG } });
    expect(other.status).toBe(410);
    const responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s1.status).toBe('declined');
    expect(responses.docs.d1.s1.declineReason).toBe('Wrong terms');
  });

  it('responses carry values until acked, and pages still render them after', async () => {
    const links = await sync();
    await signAs(`/api/sign/${links.s1}`, { f1: { kind: 'image', data: IMG } });
    let responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s1.values.f1.data).toBe(IMG);

    await worker.call('POST', '/admin/ack', { headers: auth, json: { docId: 'd1', signerIds: ['s1'] } });
    responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s1.values).toBeUndefined();
    expect(responses.docs.d1.s1.status).toBe('signed');

    const view = await (await worker.call('GET', `/api/sign/${links.s2}`)).json();
    expect(view.fields.find((f) => f.id === 'f1').value).toEqual({ kind: 'image', data: IMG });
  });

  it('void makes links dead but keeps records; revoke erases them', async () => {
    const links = await sync();
    await worker.call('POST', '/admin/void', { headers: auth, json: { docId: 'd1' } });
    expect((await worker.call('GET', `/api/sign/${links.s1}`)).status).toBe(410);
    expect((await signAs(`/api/sign/${links.s1}`, {})).status).toBe(410);

    await worker.call('POST', '/admin/revoke', { headers: auth, json: { docId: 'd1' } });
    expect((await worker.call('GET', `/api/sign/${links.s1}`)).status).toBe(404);
    expect([...kv.map.keys()].filter((k) => k.includes('d1'))).toHaveLength(0);
  });

  it('removing a signer on re-sync revokes their token and answer', async () => {
    const links = await sync();
    const without = snapshot();
    without.signers = without.signers.filter((s) => s.id !== 's2');
    without.fields = without.fields.filter((f) => f.signerId !== 's2');
    await sync(without);
    expect((await worker.call('GET', `/api/sign/${links.s2}`)).status).toBe(404);
    expect((await worker.call('GET', `/api/sign/${links.s1}`)).status).toBe(200);
  });

  it('serves the PDF to valid tokens only', async () => {
    const links = await sync();
    const pdf = await worker.call('GET', `/api/sign/${links.s1}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await worker.call('GET', `/api/sign/${'b'.repeat(40)}/pdf`)).status).toBe(404);
  });

  it('redirects the human link to the signing page with fragment params', async () => {
    const links = await sync();
    const res = await worker.call('GET', `/sign/${links.s1}`);
    expect(res.status).toBe(303);
    const location = res.headers.get('location');
    expect(location).toContain('https://signatures.example/sign.html#');
    expect(location).toContain(`t=${links.s1}`);
    expect(location).toContain(encodeURIComponent('https://test-worker.puter.work'));
  });
});
