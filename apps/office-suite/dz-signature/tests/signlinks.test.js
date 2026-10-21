/**
 * Integration: the signlinks client module deploying and talking to a REAL
 * instantiation of sign-worker.js through the fake Puter SDK.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../src/lib/store.js';
import { createSignLinks, SIGN_WORKER_VERSION } from '../src/lib/signlinks.js';
import { makeFakePuter } from './helpers/fake-puter.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

describe('signlinks', () => {
  let p;
  let store;
  let links;

  beforeEach(async () => {
    p = makeFakePuter();
    store = createStore({ getPuter: () => p });
    await store.init();
    links = createSignLinks({
      store,
      getPuter: () => p,
      fetchFn: p.fetchTo,
      verifyAttempts: 2,
      verifyDelayMs: 1,
      pageUrl: 'https://signatures.example/sign.html',
    });
  });

  async function sentDoc() {
    const doc = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 1 });
    await store.patchDoc(doc.id, {
      signers: [{ id: 'ext1', name: 'Ava', email: 'ava@example.com', isMe: false, status: 'pending' }],
      fields: [{ id: 'f1', signerId: 'ext1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true }],
    });
    return store.getDoc(doc.id);
  }

  it('deploys the worker once, verifies it, and persists the config', async () => {
    const cfg = await links.ensureWorker();
    expect(cfg.url).toMatch(/^https:\/\/doc-sign-[0-9a-f]{10}\.puter\.work$/);
    expect(cfg.version).toBe(SIGN_WORKER_VERSION);
    expect(p.workers.create).toHaveBeenCalledTimes(1);
    // The stored source contains no raw secret, only its hash.
    const source = new TextDecoder().decode(
      typeof p.fs.files.get('sign-worker.js') === 'string'
        ? new TextEncoder().encode(p.fs.files.get('sign-worker.js'))
        : p.fs.files.get('sign-worker.js'),
    );
    expect(source).not.toContain(cfg.secret);
    expect(source).toContain('https://signatures.example/sign.html');

    // A second instance adopts the stored config instead of redeploying.
    const again = createSignLinks({ store, getPuter: () => p, fetchFn: p.fetchTo, verifyAttempts: 2, verifyDelayMs: 1 });
    const cfg2 = await again.ensureWorker();
    expect(cfg2.url).toBe(cfg.url);
    expect(p.workers.create).toHaveBeenCalledTimes(1);
  });

  it('syncDoc mints one capability URL per external signer', async () => {
    const doc = await sentDoc();
    const map = await links.syncDoc(doc);
    expect(Object.keys(map)).toEqual(['ext1']);
    expect(map.ext1).toMatch(/^https:\/\/doc-sign-[0-9a-f]{10}\.puter\.work\/sign\/[0-9a-f]{40}$/);
    // Re-sync keeps the same link (the one already emailed must survive).
    const map2 = await links.syncDoc(store.getDoc(doc.id));
    expect(map2.ext1 ?? map.ext1).toBe(map.ext1);
  });

  it('tells the worker how the links go out, so it can tell a waiting signer', async () => {
    const doc = await sentDoc();
    const map = await links.syncDoc(doc);
    await store.markSent(doc.id, map, { channel: 'link' });
    await links.syncDoc(store.getDoc(doc.id));
    const worker = p.workersByUrl.get(new URL(map.ext1).origin).instance;
    expect((await worker.kv.get(`sigw:doc:${doc.id}`)).channel).toBe('link');
  });

  it('pull merges a signature submitted on the worker into the store', async () => {
    const doc = await sentDoc();
    const map = await links.syncDoc(doc);
    await store.markSent(doc.id, map);

    // The signer signs on their capability URL.
    const url = new URL(map.ext1);
    const worker = p.workersByUrl.get(url.origin).instance;
    const token = url.pathname.split('/').pop();
    await worker.call('POST', `/api/sign/${token}`, {
      json: { action: 'consent', disclosureVersion: '1', tzOffset: -420, tzName: 'America/Los_Angeles' },
    });
    const submit = await worker.call('POST', `/api/sign/${token}`, {
      json: { action: 'sign', values: { f1: { kind: 'image', data: IMG } }, tzOffset: -420, tzName: 'America/Los_Angeles' },
    });
    expect(submit.status).toBe(200);

    const results = await links.pull({ force: true });
    expect(results).toHaveLength(1);
    expect(results[0].completedNow).toBe(true);
    const done = store.getDoc(doc.id);
    expect(done.status).toBe('completed');
    expect(done.signers[0].status).toBe('signed');
    expect((await store.readSigData(doc.id)).f1.data).toBe(IMG);
    // The consent and the technical context came across with it.
    expect(done.signers[0].consentAt).toBeTruthy();
    expect(done.signers[0].consentVersion).toBe('1');
    expect(done.signers[0].evidence.sign.tzName).toBe('America/Los_Angeles');
    expect(done.signers[0].evidence.sign.tzOffset).toBe(-420);
    expect(done.audit.some((a) => a.type === 'consented')).toBe(true);

    // The merge is acknowledged: a second pull re-sends no values and
    // reports no change.
    expect(await links.pull({ force: true })).toEqual([]);
  });

  it('preserves the owner signature on the worker when reading its values fails', async () => {
    const doc = await sentDoc();
    doc.signers.push({ id: 'me', name: 'Owner', isMe: true, status: 'signed' });
    doc.fields.push({ ...doc.fields[0], id: 'mine', signerId: 'me' });
    await store.mergeSigData(doc.id, { mine: { kind: 'image', data: IMG } });
    await store.markSent(doc.id, await links.syncDoc(doc));
    const url = new URL(doc.links.ext1);
    const worker = p.workersByUrl.get(url.origin).instance;
    const ownerValue = async () => {
      const data = await (await worker.call('GET', `/api${url.pathname}`)).json();
      return data.fields.find((f) => f.id === 'mine').value;
    };
    expect(await ownerValue()).toEqual({ kind: 'image', data: IMG });

    p.fs.read.mockRejectedValueOnce(new Error('offline'));
    const outcome = await links.syncDoc(doc).then(() => null, (err) => err);
    expect(await ownerValue()).toEqual({ kind: 'image', data: IMG });
    expect(outcome).toBeInstanceOf(Error);

    // The same snapshot succeeds when storage is reachable again.
    await links.syncDoc(doc);
    expect(await ownerValue()).toEqual({ kind: 'image', data: IMG });
  });

  it.each(['record', 'values'])('retries a completed response after saving its %s fails', async (failure) => {
    const doc = await sentDoc();
    await store.markSent(doc.id, await links.syncDoc(doc));
    const url = new URL(doc.links.ext1);
    const worker = p.workersByUrl.get(url.origin).instance;
    const api = `/api${url.pathname}`;
    await worker.call('POST', api, { json: { action: 'consent', disclosureVersion: '1' } });
    expect((await worker.call('POST', api, {
      json: { action: 'sign', values: { f1: { kind: 'image', data: IMG } } },
    })).status).toBe(200);

    if (failure === 'record') p.kv.set.mockRejectedValueOnce(new Error('offline'));
    else p.fs.write.mockRejectedValueOnce(new Error('offline'));
    await expect(links.pull({ force: true })).rejects.toThrow('offline');
    expect(store.getDoc(doc.id).status).toBe('sent');
    expect(store.getDoc(doc.id).signers[0].status).toBe('pending');
    expect((await worker.kv.get(`sigw:resp:${doc.id}:ext1`)).acked).toBe(false);

    const retried = await links.pull({ force: true });
    expect(retried).toHaveLength(1);
    expect(retried[0].completedNow).toBe(true);
    expect(store.getDoc(doc.id).audit.filter((e) => e.type === 'signed')).toHaveLength(1);
    const reloaded = createStore({ getPuter: () => p });
    await reloaded.init();
    expect(reloaded.getDoc(doc.id).status).toBe('completed');
    expect((await reloaded.readSigData(doc.id)).f1.data).toBe(IMG);
    expect((await worker.kv.get(`sigw:resp:${doc.id}:ext1`)).acked).toBe(true);
  });

  it('voidDoc kills the links through the worker', async () => {
    const doc = await sentDoc();
    const map = await links.syncDoc(doc);
    await store.markSent(doc.id, map);
    await links.voidDoc(doc.id);

    const url = new URL(map.ext1);
    const worker = p.workersByUrl.get(url.origin).instance;
    const token = url.pathname.split('/').pop();
    expect((await worker.call('GET', `/api/sign/${token}`)).status).toBe(410);
  });

  it('never deploys a worker just to pull', async () => {
    await links.pull({ force: true });
    expect(p.workers.create).not.toHaveBeenCalled();
  });

  it('asks only about the documents something can still happen on', async () => {
    const open = await sentDoc();
    await store.markSent(open.id, await links.syncDoc(open));
    const done = await sentDoc();
    await store.markSent(done.id, await links.syncDoc(done));
    // A finished document: nothing can arrive on it, so the worker is not
    // asked to walk it - every pull used to read every document ever synced.
    await store.patchDoc(done.id, { status: 'completed' });
    const worker = [...p.workersByUrl.values()][0].instance;
    const origCall = worker.call;
    const seen = [];
    worker.call = (method, path, init) => { seen.push(path); return origCall(method, path, init); };
    await links.pull({ force: true });
    const asked = new URL(seen.find((path) => path.startsWith('/admin/responses')), 'https://x').searchParams.get('docs');
    expect(asked.split(',')).toEqual([open.id]);
    // And the worker honours it.
    const res = await worker.call('GET', `/admin/responses?docs=${done.id}`, {
      headers: { authorization: `Bearer ${(await links.ensureWorker()).secret}` },
    });
    expect(Object.keys((await res.json()).docs)).toEqual([done.id]);
    const all = await worker.call('GET', '/admin/responses', {
      headers: { authorization: `Bearer ${(await links.ensureWorker()).secret}` },
    });
    expect(Object.keys((await all.json()).docs).sort()).toEqual([open.id, done.id].sort());
  });

  it('does not call the worker at all when nothing is out for signature', async () => {
    const doc = await sentDoc();
    await store.markSent(doc.id, await links.syncDoc(doc));
    await store.patchDoc(doc.id, { status: 'completed' });
    const worker = [...p.workersByUrl.values()][0].instance;
    const origCall = worker.call;
    const seen = [];
    worker.call = (method, path, init) => { seen.push(path); return origCall(method, path, init); };
    expect(await links.pull({ force: true })).toEqual([]);
    expect(seen).toEqual([]);
  });
});
