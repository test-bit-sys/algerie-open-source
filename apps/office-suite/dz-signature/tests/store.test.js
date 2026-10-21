import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, KV_KEYS, DEFAULT_SETTINGS } from '../src/lib/store.js';
import { makeFakePuter } from './helpers/fake-puter.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

describe('store', () => {
  let p;
  let store;

  beforeEach(async () => {
    p = makeFakePuter();
    store = createStore({ getPuter: () => p });
    await store.init();
  });

  async function draft(extra = {}) {
    const doc = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 2 });
    if (Object.keys(extra).length) await store.patchDoc(doc.id, extra);
    return store.getDoc(doc.id);
  }

  it('boots with defaults and loads documents from KV', async () => {
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    const doc = await draft();
    const second = createStore({ getPuter: () => p });
    await second.init();
    expect(second.getDoc(doc.id)?.title).toBe('NDA');
    expect(second.listDocs()).toHaveLength(1);
  });

  it('createDoc writes the PDF and records its absolute path', async () => {
    const doc = await draft();
    expect(doc.status).toBe('draft');
    expect(doc.pdfAbsPath).toContain(`signatures-data/${doc.id}/original.pdf`);
    const bytes = await store.readPdf(doc.id);
    expect([...bytes]).toEqual([...PDF]);
    expect(doc.audit[0].type).toBe('created');
  });

  it('updateSettings persists and notifies', async () => {
    let notified = 0;
    store.addEventListener('change', () => { notified += 1; });
    await store.updateSettings({ theme: 'dark', fullName: 'Alex' });
    expect(notified).toBe(1);
    expect(p.kv.map.get(KV_KEYS.settings).theme).toBe('dark');
  });

  it('markSent stamps links and starts signers pending', async () => {
    const doc = await draft({
      signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', isMe: false }],
    });
    await store.markSent(doc.id, { s1: 'https://w.puter.work/sign/aa' }, { channel: 'email' });
    const sent = store.getDoc(doc.id);
    expect(sent.status).toBe('sent');
    expect(sent.sentAt).toBeTruthy();
    expect(sent.links.s1).toContain('/sign/');
    expect(sent.signers[0].status).toBe('pending');
    expect(sent.audit.some((a) => a.type === 'sent')).toBe(true);
    // How the links were handed out is a recorded choice, not inferred later.
    expect(sent.channel).toBe('email');
  });

  it('applyResponses merges statuses newest-wins and completes the doc', async () => {
    const doc = await draft({
      signers: [
        { id: 'me', name: 'Me', isMe: true, status: 'signed', signedAt: 1 },
        { id: 's1', name: 'Ava', email: 'ava@example.com', isMe: false, status: 'pending' },
      ],
      fields: [{ id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05, required: true }],
    });
    await store.markSent(doc.id, {});

    const viewed = await store.applyResponses(doc.id, [{ signerId: 's1', status: 'viewed', viewedAt: 100 }]);
    expect(viewed.changed).toBe(true);
    expect(store.getDoc(doc.id).signers[1].status).toBe('viewed');

    const signed = await store.applyResponses(doc.id, [{
      signerId: 's1', status: 'signed', signedAt: 200,
      values: { f1: { kind: 'image', data: 'data:image/png;base64,AAA' } },
    }]);
    expect(signed.completedNow).toBe(true);
    const done = store.getDoc(doc.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeTruthy();
    const sigData = await store.readSigData(doc.id);
    expect(sigData.f1.kind).toBe('image');

    // A stale replay must not regress the signed status.
    const replay = await store.applyResponses(doc.id, [{ signerId: 's1', status: 'viewed', viewedAt: 100 }]);
    expect(replay.changed).toBe(false);
    expect(store.getDoc(doc.id).signers[1].status).toBe('signed');
  });

  it('a decline closes the document and keeps the reason', async () => {
    const doc = await draft({
      signers: [{ id: 's1', name: 'Ava', email: 'a@b.co', isMe: false, status: 'pending' }],
    });
    await store.markSent(doc.id, {});
    const result = await store.applyResponses(doc.id, [{
      signerId: 's1', status: 'declined', declinedAt: 300, declineReason: 'Wrong terms',
    }]);
    expect(result.declinedNow).toBe(true);
    const closed = store.getDoc(doc.id);
    expect(closed.status).toBe('declined');
    expect(closed.signers[0].declineReason).toBe('Wrong terms');
  });

  it('markSignerSigned stores values and completes when last', async () => {
    const doc = await draft({
      signers: [{ id: 'me', name: 'Me', isMe: true, status: 'pending' }],
      fields: [{ id: 'f1', signerId: 'me', type: 'text', page: 0, x: 0, y: 0, w: 0.2, h: 0.05, required: true }],
    });
    await store.markSent(doc.id, {});
    const result = await store.markSignerSigned(doc.id, 'me', { f1: 'Hello' });
    expect(result.completedNow).toBe(true);
    expect((await store.readSigData(doc.id)).f1).toBe('Hello');
  });

  it('voidDoc is terminal even with all signatures in', async () => {
    const doc = await draft({ signers: [{ id: 's1', isMe: false, status: 'pending' }] });
    await store.markSent(doc.id, {});
    await store.voidDoc(doc.id, 'sent by mistake');
    await store.applyResponses(doc.id, [{ signerId: 's1', status: 'signed', signedAt: 10 }]);
    expect(store.getDoc(doc.id).status).toBe('voided');
  });

  it('deleteDoc removes the record and the files', async () => {
    const doc = await draft();
    expect(p.fs.files.size).toBeGreaterThan(0);
    await store.deleteDoc(doc.id);
    expect(store.getDoc(doc.id)).toBe(null);
    expect([...p.fs.files.keys()].filter((k) => k.includes(doc.id))).toHaveLength(0);
    expect(p.kv.map.has(KV_KEYS.docPrefix + doc.id)).toBe(false);
  });

  it('readSigData returns {} for missing files but rethrows real failures', async () => {
    const doc = await draft();
    expect(await store.readSigData(doc.id)).toEqual({});
    p.fs.read.mockRejectedValueOnce(new Error('network down'));
    await expect(store.readSigData(doc.id)).rejects.toThrow('network down');
  });

  it('sample import and wipe leave real documents alone', async () => {
    const real = await draft();
    await store.importDataset([{
      doc: {
        id: 'sample1', title: 'Sample', fileName: 's.pdf', pageCount: 1, status: 'completed',
        signers: [], fields: [], links: {}, emailed: {}, audit: [], sample: true,
        createdAt: 1, updatedAt: 1,
      },
      pdfBytes: PDF,
      sigData: { x: 'y' },
    }]);
    expect(store.settings.sampleData).toBe(true);
    expect(store.listDocs()).toHaveLength(2);
    await store.wipeSampleData();
    expect(store.settings.sampleData).toBe(false);
    expect(store.listDocs().map((d) => d.id)).toEqual([real.id]);
  });

  it('saved signature round-trips and clears', async () => {
    await store.setSavedSignature({ image: 'data:image/png;base64,AAA', updatedAt: 1 });
    expect((await store.getSavedSignature()).image).toContain('base64');
    await store.setSavedSignature(null);
    expect(await store.getSavedSignature()).toBe(null);
  });
});
