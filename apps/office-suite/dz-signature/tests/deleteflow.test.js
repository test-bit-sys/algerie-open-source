import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { createSignLinks } from '../src/lib/signlinks.js';
import { makeFakePuter } from './helpers/fake-puter.js';
import { signlinks } from '../src/lib/services.js';
import { confirmDialog } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';
import { deleteDocFlow } from '../src/ui/actions.js';

vi.mock('../src/lib/services.js', () => ({ signlinks: { revokeDoc: vi.fn() }, emailer: {} }));
vi.mock('../src/ui/modal.js', () => ({ confirmDialog: vi.fn() }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

let p;
let links;
let doc;

beforeEach(async () => {
  vi.clearAllMocks();
  p = makeFakePuter();
  vi.stubGlobal('puter', p);
  await store.init();
  links = createSignLinks({ store, getPuter: () => p, fetchFn: p.fetchTo, verifyDelayMs: 1 });
  signlinks.revokeDoc.mockImplementation((id) => links.revokeDoc(id));
  confirmDialog.mockResolvedValue(true);
  doc = await store.createDoc({ title: 'NDA', pdfBytes: new Uint8Array([1]), pageCount: 1 });
  await store.patchDoc(doc.id, {
    signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', status: 'pending' }],
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('deleting a document', () => {
  it('keeps the document recoverable when revoking its live link fails', async () => {
    await store.markSent(doc.id, await links.syncDoc(doc));
    const url = new URL(doc.links.s1);
    const worker = p.workersByUrl.get(url.origin).instance;
    const api = `/api${url.pathname}`;
    expect((await worker.call('GET', api)).status).toBe(200);
    signlinks.revokeDoc.mockRejectedValueOnce(new Error('offline'));

    const deleted = await deleteDocFlow(doc);
    expect((await worker.call('GET', api)).status).toBe(200);
    expect(deleted).toBe(false);
    expect(store.getDoc(doc.id)).not.toBeNull();
    expect(p.fs.delete).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/could not.*signing service/i), expect.anything());

    // Retry can still revoke the worker copy, then remove the owner copy.
    expect(await deleteDocFlow(doc)).toBe(true);
    expect((await worker.call('GET', api)).status).toBe(404);
    expect(store.getDoc(doc.id)).toBeNull();
  });

  it('deletes a draft without deploying or contacting a worker', async () => {
    expect(await deleteDocFlow(doc)).toBe(true);
    expect(signlinks.revokeDoc).not.toHaveBeenCalled();
    expect(store.getDoc(doc.id)).toBeNull();
  });

  it('leaves everything alone when cancelled', async () => {
    confirmDialog.mockResolvedValue(false);
    expect(await deleteDocFlow(doc)).toBe(false);
    expect(signlinks.revokeDoc).not.toHaveBeenCalled();
    expect(store.getDoc(doc.id)).toBe(doc);
  });
});
