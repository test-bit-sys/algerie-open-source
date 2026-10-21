import { describe, it, expect, beforeEach, vi } from 'vitest';
import signSource from '../src/workers/sign-worker.js?raw';
import emailSource from '../src/workers/email-worker.js?raw';
import { SIGN_WORKER_VERSION } from '../src/lib/signlinks.js';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';
import { makeFs } from './helpers/fake-puter.js';
import { randomCode, normalizeCode } from '../src/lib/util.js';

const SECRET = 'test-admin-secret';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const auth = { authorization: `Bearer ${SECRET}` };

describe('access codes', () => {
  it('generates codes with no character that can be misheard', () => {
    for (let i = 0; i < 50; i++) {
      const code = randomCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ACDEFGHJKMNPQRTUVWXY2346789]+$/);
      // One of each confusable pair is gone: O/0, I/1/L, S/5, B/8, Z/2.
      expect(code).not.toMatch(/[O0I1LSZB5]/);
    }
    expect(randomCode(10)).toHaveLength(10);
  });

  it('compares codes the way people say them', () => {
    expect(normalizeCode(' a b c 1 ')).toBe('ABC1');
    expect(normalizeCode('abc123')).toBe('ABC123');
    expect(normalizeCode(null)).toBe('');
  });
});

async function buildWorker() {
  const source = signSource
    .replace('__SIGN_ADMIN_SECRET_HASH__', await sha256Hex(SECRET))
    .replace('__SIGN_WORKER_VERSION__', SIGN_WORKER_VERSION)
    .replace('__SIGN_PAGE_URL__', 'https://signatures.example/sign.html');
  const fs = makeFs();
  await fs.write('signatures-data/d1/original.pdf', new Uint8Array([1, 2, 3]));
  const kv = makeKv();
  return { worker: instantiateWorker(source, { me: { puter: { kv, fs } } }), kv };
}

function snapshot(over = {}) {
  return {
    doc: { id: 'd1', title: 'NDA', pageCount: 1, pdfPath: 'signatures-data/d1/original.pdf' },
    signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external', code: 'SWAN42' }],
    fields: [{ id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true }],
    values: {},
    ...over,
  };
}

describe('the sign worker code gate', () => {
  let worker;
  let kv;
  let token;

  beforeEach(async () => {
    ({ worker, kv } = await buildWorker());
    const res = await worker.call('POST', '/admin/sync', { headers: auth, json: snapshot() });
    token = (await res.json()).links.s1;
  });

  const unlock = (code) => worker.call('POST', `/api/sign/${token}`, { json: { action: 'unlock', code } });
  const withSession = (session) => ({ 'x-sign-session': session });

  it('stores only a salted hash of the code', async () => {
    const record = kv.map.get('sigw:doc:d1');
    expect(JSON.stringify(record)).not.toContain('SWAN42');
    expect(record.signers.s1.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.signers.s1.codeSalt).toMatch(/^[0-9a-f]{40}$/);
  });

  it('serves nothing at all until the code is given', async () => {
    const view = await worker.call('GET', `/api/sign/${token}`);
    expect(view.status).toBe(401);
    expect((await view.json()).error).toBe('code_required');
    expect((await worker.call('GET', `/api/sign/${token}/pdf`)).status).toBe(401);
    expect((await worker.call('POST', `/api/sign/${token}`, { json: { action: 'consent' } })).status).toBe(401);
    // Not even a view was recorded.
    const out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.docs.d1.s1).toBeUndefined();
  });

  it('trades the right code for a session that opens everything', async () => {
    const res = await unlock('swan 42'); // spacing and case are noise
    expect(res.status).toBe(200);
    const { session, expiresAt } = await res.json();
    expect(session).toMatch(/^[0-9a-f]{40}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const view = await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) });
    expect(view.status).toBe(200);
    const data = await view.json();
    expect(data.doc.title).toBe('NDA');
    expect(data.signer.codeRequired).toBe(true);
    expect((await worker.call('GET', `/api/sign/${token}/pdf`, { headers: withSession(session) })).status).toBe(200);

    await worker.call('POST', `/api/sign/${token}`, {
      headers: withSession(session), json: { action: 'consent', disclosureVersion: '1' },
    });
    const signed = await worker.call('POST', `/api/sign/${token}`, {
      headers: withSession(session), json: { action: 'sign', values: { f1: { kind: 'image', data: IMG } } },
    });
    expect(signed.status).toBe(200);
  });

  it('refuses a session that belongs to another signer or has expired', async () => {
    const { session } = await (await unlock('SWAN42')).json();
    // Point the stored session at a different signer.
    const key = `sigw:sess:${await sha256Hex(session)}`;
    kv.map.set(key, { ...kv.map.get(key), signerId: 'someone-else' });
    expect((await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) })).status).toBe(401);

    kv.map.set(key, { docId: 'd1', signerId: 's1', exp: Date.now() - 1 });
    expect((await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) })).status).toBe(401);
    // And a made-up one.
    expect((await worker.call('GET', `/api/sign/${token}`, { headers: withSession('f'.repeat(40)) })).status).toBe(401);
  });

  it('counts wrong codes down and then locks out', async () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await unlock('WRONG1');
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'bad_code', remaining: 5 - attempt });
    }
    const locked = await unlock('WRONG1');
    expect(locked.status).toBe(429);
    const body = await locked.json();
    expect(body.error).toBe('locked');
    expect(body.until).toBeGreaterThan(Date.now());
    // Even the right code waits out the lockout.
    expect((await unlock('SWAN42')).status).toBe(429);
    // And so does the document.
    expect((await worker.call('GET', `/api/sign/${token}`)).status).toBe(429);
  });

  it('starts the count over once a lockout has run its course', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) await unlock('WRONG1');
    const key = 'sigw:resp:d1:s1';
    expect(kv.map.get(key).codeLockedUntil).toBeGreaterThan(Date.now());
    // The wait is over.
    kv.map.set(key, { ...kv.map.get(key), codeLockedUntil: Date.now() - 1 });
    // One more wrong guess is the first of a fresh five, not a sixth that
    // locks the door again at once.
    const res = await unlock('WRONG1');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'bad_code', remaining: 4 });
    expect((await worker.call('GET', `/api/sign/${token}`)).status).toBe(401);
    // And the right one still opens it.
    expect((await unlock('SWAN42')).status).toBe(200);
  });

  it('reports failures and unlocks to the owner', async () => {
    await unlock('WRONG1');
    let out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.docs.d1.s1.code).toMatchObject({ fails: 1, unlockedAt: 0 });
    expect(out.docs.d1.s1.status).toBeUndefined();

    await unlock('SWAN42');
    out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.docs.d1.s1.code.fails).toBe(0);
    expect(out.docs.d1.s1.code.unlockedAt).toBeTruthy();
  });

  it('records the view properly even after failed attempts wrote a record', async () => {
    await unlock('WRONG1');
    const { session } = await (await unlock('SWAN42')).json();
    await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) });
    const out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.docs.d1.s1.status).toBe('viewed');
    expect(out.docs.d1.s1.viewedAt).toBeTruthy();
  });

  it('keeps the code across a re-sync that does not mention it', async () => {
    const noCode = snapshot();
    delete noCode.signers[0].code;
    await worker.call('POST', '/admin/sync', { headers: auth, json: noCode });
    expect((await worker.call('GET', `/api/sign/${token}`)).status).toBe(401);
    expect((await unlock('SWAN42')).status).toBe(200);
  });

  it('replaces a code without touching the link, and clears the lockout', async () => {
    const before = token;
    await unlock('WRONG1');
    const links = await (await worker.call('POST', '/admin/sync', {
      headers: auth, json: snapshot({ signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external', code: 'HERON7' }] }),
    })).json();
    expect(links.links.s1).toBeUndefined(); // no new link was minted
    expect(token).toBe(before);
    expect((await unlock('SWAN42')).status).toBe(401);
    expect((await unlock('HERON7')).status).toBe(200);
    const out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.docs.d1.s1.code.fails).toBe(0);
  });

  it('kills the sessions the old code bought when a new one replaces it', async () => {
    const { session } = await (await unlock('SWAN42')).json();
    expect((await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) })).status).toBe(200);
    await worker.call('POST', '/admin/sync', {
      headers: auth,
      json: snapshot({ signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external', code: 'HERON7' }] }),
    });
    // Whoever held the link and the old code is asked again, right away.
    const after = await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) });
    expect(after.status).toBe(401);
    expect((await after.json()).error).toBe('code_required');
    expect([...kv.map.keys()].filter((k) => k.startsWith('sigw:sess:'))).toHaveLength(0);
  });

  it('kills them when the link is reissued to someone else', async () => {
    const { session } = await (await unlock('SWAN42')).json();
    await worker.call('POST', '/admin/sync', { headers: auth, json: snapshot({ reissue: ['s1'] }) });
    expect([...kv.map.keys()].filter((k) => k.startsWith('sigw:sess:'))).toHaveLength(0);
    expect((await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) })).status).toBe(404);
  });

  it('removes the requirement when the code is cleared', async () => {
    await worker.call('POST', '/admin/sync', {
      headers: auth,
      json: snapshot({ signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external', code: null }] }),
    });
    const view = await worker.call('GET', `/api/sign/${token}`);
    expect(view.status).toBe(200);
    expect((await view.json()).signer.codeRequired).toBe(false);
    expect((await unlock('SWAN42')).status).toBe(400);
  });

  it('ignores a code too short to be a second factor', async () => {
    await worker.call('POST', '/admin/sync', {
      headers: auth,
      json: snapshot({ signers: [{ id: 's2', name: 'Bo', email: 'bo@example.com', kind: 'external', code: '12' }] }),
    });
    const record = kv.map.get('sigw:doc:d1');
    expect(record.signers.s2.codeHash).toBeNull();
  });

  it('does not let sessions pile up in the store', async () => {
    const { session } = await (await unlock('SWAN42')).json();
    const key = `sigw:sess:${await sha256Hex(session)}`;
    // Asked to fall out of the store on its own, where the platform can.
    expect(kv.expire).toHaveBeenCalledWith(key, 2 * 60 * 60);
    // And one that has run out is deleted the moment it is seen, rather than
    // sitting there for every later scan to walk past.
    kv.map.set(key, { docId: 'd1', signerId: 's1', exp: Date.now() - 1 });
    expect((await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) })).status).toBe(401);
    expect(kv.map.has(key)).toBe(false);
    // A scan for one signer's sessions sweeps up any dead ones it meets.
    kv.map.set('sigw:sess:stale', { docId: 'other-doc', signerId: 'x', exp: Date.now() - 1 });
    await worker.call('POST', '/admin/sync', {
      headers: auth,
      json: snapshot({ signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external', code: 'HERON7' }] }),
    });
    expect(kv.map.has('sigw:sess:stale')).toBe(false);
  });

  it('revoking a document drops the unlocked sessions with it', async () => {
    const { session } = await (await unlock('SWAN42')).json();
    await worker.call('POST', '/admin/revoke', { headers: auth, json: { docId: 'd1' } });
    expect([...kv.map.keys()].filter((k) => k.startsWith('sigw:sess:'))).toHaveLength(0);
    expect((await worker.call('GET', `/api/sign/${token}`, { headers: withSession(session) })).status).toBe(404);
  });
});

describe('the request email mentions a code without carrying it', () => {
  it('says a code is needed and never what it is', async () => {
    const sent = [];
    const worker = instantiateWorker(emailSource, {
      me: { puter: { kv: makeKv(), email: { send: async (m) => (sent.push(m), {}) }, authToken: 't' } },
    });
    const caller = { uuid: 'u-1', puter: { authToken: 'c' } };
    await worker.call('POST', '/send', {
      user: caller,
      json: {
        doc: { id: 'd1', title: 'NDA', ownerName: 'Alex', ownerEmail: 'alex@example.com', pageCount: 1 },
        recipients: [{
          email: 'ava@example.com', name: 'Ava', version: 'abcdef12', codeRequired: true,
          signUrl: `https://w.puter.work/sign/${'a'.repeat(40)}`,
        }],
        kind: 'request',
      },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('protected by an access code');
    expect(sent[0].html).toContain('protected by an access code');
    expect(sent[0].text).not.toContain('SWAN42');
  });
});
