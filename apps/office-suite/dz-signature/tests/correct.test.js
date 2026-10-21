import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../src/lib/store.js';
import { createSignLinks } from '../src/lib/signlinks.js';
import { makeFakePuter } from './helpers/fake-puter.js';
import { canCorrect } from '../src/ui/correct.js';
import { auditLabel } from '../src/lib/model.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe('who can be corrected', () => {
  const signer = { id: 's1', name: 'Ava', email: 'ava@example.com', status: 'pending' };

  it('a pending signer on a sent document', () => {
    expect(canCorrect({ status: 'sent' }, signer)).toBe(true);
    expect(canCorrect({ status: 'sent' }, { ...signer, status: 'viewed' })).toBe(true);
  });

  it('never once they have answered', () => {
    expect(canCorrect({ status: 'sent' }, { ...signer, status: 'signed' })).toBe(false);
    expect(canCorrect({ status: 'sent' }, { ...signer, status: 'declined' })).toBe(false);
  });

  it('never on a document that is finished, closed, or a sample', () => {
    for (const status of ['draft', 'completed', 'declined', 'voided']) {
      expect(canCorrect({ status }, signer)).toBe(false);
    }
    expect(canCorrect({ status: 'sent', sample: true }, signer)).toBe(false);
  });

  it('never for yourself: you edit your own row in the editor', () => {
    expect(canCorrect({ status: 'sent' }, { ...signer, isMe: true })).toBe(false);
  });
});

describe('reissuing a link', () => {
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
      fetchFn: (...args) => p.fetchTo(...args),
      verifyAttempts: 1,
      verifyDelayMs: 0,
      pageUrl: 'https://signatures.example/sign.html',
    });
  });

  async function sentDoc() {
    const doc = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 1 });
    await store.patchDoc(doc.id, {
      signers: [
        { id: 's1', name: 'Ava Chen', email: 'ava@example.com', isMe: false, status: 'pending' },
        { id: 's2', name: 'Bo Diaz', email: 'bo@example.com', isMe: false, status: 'pending' },
      ],
      fields: [
        { id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true },
        { id: 'f2', signerId: 's2', type: 'signature', page: 0, x: 0.5, y: 0.8, w: 0.3, h: 0.05, required: true },
      ],
    });
    const map = await links.syncDoc(store.getDoc(doc.id));
    await store.markSent(doc.id, map);
    return { doc: store.getDoc(doc.id), map };
  }

  it('mints a new token for the corrected signer and kills the old one', async () => {
    const { doc, map } = await sentDoc();
    const worker = p.workersByUrl.get(new URL(map.s1).origin).instance;
    const oldToken = map.s1.split('/').pop();
    expect((await worker.call('GET', `/api/sign/${oldToken}`)).status).toBe(200);

    // The correction the UI performs: new address, then a reissuing sync.
    const target = store.getDoc(doc.id);
    target.signers[0].email = 'dana@example.com';
    target.signers[0].name = 'Dana Lopez';
    await store.persistDoc(target);
    const fresh = await links.syncDoc(store.getDoc(doc.id), { reissue: ['s1'] });

    expect(fresh.s1).not.toBe(map.s1);
    // Everyone else keeps the link they were given.
    expect(fresh.s2).toBe(map.s2);
    expect((await worker.call('GET', `/api/sign/${oldToken}`)).status).toBe(404);
    const view = await (await worker.call('GET', `/api/sign/${fresh.s1.split('/').pop()}`)).json();
    expect(view.signer.email).toBe('dana@example.com');
    expect(view.signer.name).toBe('Dana Lopez');
    // The other signer's answer is untouched by the correction.
    expect(view.fields.find((f) => f.id === 'f2').mine).toBe(false);
  });

  it('leaves a signature already collected alone', async () => {
    const { doc, map } = await sentDoc();
    const worker = p.workersByUrl.get(new URL(map.s2).origin).instance;
    const token = map.s2.split('/').pop();
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    await worker.call('POST', `/api/sign/${token}`, { json: { action: 'consent', disclosureVersion: '1' } });
    await worker.call('POST', `/api/sign/${token}`, {
      json: { action: 'sign', values: { f2: { kind: 'image', data: IMG } } },
    });
    await links.pull({ force: true });
    expect(store.getDoc(doc.id).signers[1].status).toBe('signed');

    // Correcting the OTHER signer must not disturb that.
    const target = store.getDoc(doc.id);
    target.signers[0].email = 'dana@example.com';
    await store.persistDoc(target);
    await links.syncDoc(store.getDoc(doc.id), { reissue: ['s1'] });
    expect(store.getDoc(doc.id).signers[1].status).toBe('signed');
    expect((await store.readSigData(doc.id)).f2.data).toBe(IMG);
    expect((await worker.call('GET', `/api/sign/${token}`)).status).toBe(200);
  });

  /**
   * A reissue exists because the old link is in the wrong hands. Everything
   * its holder did belongs to them, and the consent above all: the signing
   * page skips the disclosure entirely once a consent is on record, so one
   * left behind let the new holder sign without ever agreeing, under someone
   * else's timestamp, IP, and browser - which the certificate then printed as
   * theirs.
   */
  it('does not hand the new holder what the old one did', async () => {
    const { doc, map } = await sentDoc();
    const worker = p.workersByUrl.get(new URL(map.s1).origin).instance;
    const wrongToken = map.s1.split('/').pop();

    // The address was mistyped, so the wrong person opened it and agreed.
    await worker.call('GET', `/api/sign/${wrongToken}`, { headers: { 'cf-connecting-ip': '198.51.100.9' } });
    await worker.call('POST', `/api/sign/${wrongToken}`, {
      headers: { 'cf-connecting-ip': '198.51.100.9' },
      json: { action: 'consent', disclosureVersion: '1', tzOffset: 0 },
    });
    await links.pull({ force: true });
    expect(store.getDoc(doc.id).signers[0].consentAt).toBeTruthy();

    // The correction, as src/ui/correct.js performs it.
    const target = store.getDoc(doc.id);
    const entry = target.signers[0];
    entry.name = 'Dana Lopez';
    entry.email = 'dana@example.com';
    entry.status = 'pending';
    delete entry.viewedAt;
    delete entry.consentAt;
    delete entry.consentVersion;
    delete entry.evidence;
    await store.persistDoc(target);
    const fresh = await links.syncDoc(store.getDoc(doc.id), { reissue: ['s1'] });

    // Dana's link starts from nothing: the worker has no consent for her, so
    // the page shows her the disclosure, and a signature is refused until it
    // is answered.
    const view = await (await worker.call('GET', `/api/sign/${fresh.s1.split('/').pop()}`)).json();
    expect(view.signer.consentAt).toBeFalsy();
    expect(view.signer.name).toBe('Dana Lopez');
    const early = await worker.call('POST', `/api/sign/${fresh.s1.split('/').pop()}`, {
      json: { action: 'sign', values: { f1: { kind: 'image', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' } } },
    });
    expect(early.status).toBe(409);
    expect((await early.json()).error).toBe('consent_required');
    // And the app's own copy no longer credits Dana with it either.
    expect(store.getDoc(doc.id).signers[0].consentAt).toBeFalsy();
    expect(store.getDoc(doc.id).signers[0].status).toBe('pending');
  });

  it('never deletes an answer that is already final', async () => {
    const { doc, map } = await sentDoc();
    const worker = p.workersByUrl.get(new URL(map.s2).origin).instance;
    const token = map.s2.split('/').pop();
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    await worker.call('POST', `/api/sign/${token}`, { json: { action: 'consent', disclosureVersion: '1' } });
    await worker.call('POST', `/api/sign/${token}`, {
      json: { action: 'sign', values: { f2: { kind: 'image', data: IMG } } },
    });
    // The UI cannot reissue a signer who has signed, but the route can be
    // asked to: a signature is evidence and must survive it.
    await links.syncDoc(store.getDoc(doc.id), { reissue: ['s2'] });
    const out = await (await worker.call('GET', '/admin/responses', {
      headers: { authorization: `Bearer ${(await p.kv.get('sig:worker:cfg:v1')).secret}` },
    })).json();
    expect(out.docs[doc.id].s2.status).toBe('signed');
    expect(out.docs[doc.id].s2.consentAt).toBeTruthy();
  });

  it('reads the correction back out of the audit trail', () => {
    expect(auditLabel({ type: 'corrected', detail: 'Ava <a@x.co> to Dana <d@y.co>' }))
      .toBe('Signer corrected: Ava <a@x.co> to Dana <d@y.co>');
    expect(auditLabel({ type: 'link_reissued', detail: 'Dana <d@y.co>' }))
      .toBe('Sign link reissued for Dana <d@y.co>');
  });
});
