/**
 * Sequential signing, the app's half: when a signature lands and the next
 * turn opens, what happens follows the channel the sender chose at the send.
 * Requests that went out by email are followed by the next request by email;
 * links the sender copied by hand are never followed by an email behind
 * their back - the sender is told whose turn it is instead, once.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { doc: null };
const toasts = [];
const sends = [];
const failNext = { value: false };

vi.mock('../src/lib/store.js', () => ({
  store: {
    getDoc: () => state.doc,
    addAudit: (doc, type, detail = '') => { (doc.audit ||= []).push({ at: Date.now(), type, detail }); },
    persistDoc: async (doc) => doc,
    patchDoc: async (id, patch) => Object.assign(state.doc, patch),
    readPdf: async () => new Uint8Array(),
    readSigData: async () => ({}),
    writeSignedPdf: async () => {},
    get settings() { return {}; },
    get user() { return { email: 'me@example.com' }; },
  },
}));
vi.mock('../src/lib/services.js', () => ({
  signlinks: { syncDoc: async (doc) => doc.links || {} },
  emailer: {
    available: () => true,
    send: async (doc, opts) => {
      sends.push(opts);
      if (failNext.value) {
        failNext.value = false;
        throw new Error('Could not reach the email service.');
      }
      return { ok: true, sent: 1, results: [] };
    },
  },
}));
vi.mock('../src/ui/toast.js', () => ({
  toast: (message, opts = {}) => { toasts.push({ message, ...opts }); },
}));

const { advanceTurn, requestsWereEmailed } = await import('../src/ui/actions.js');

function ordered(over = {}) {
  return {
    id: 'd1',
    title: 'NDA',
    status: 'sent',
    signOrder: true,
    signers: [
      { id: 'a', name: 'Ava', email: 'ava@example.com', status: 'signed' },
      { id: 'b', name: 'Bo', email: 'bo@example.com', status: 'pending' },
      { id: 'c', name: 'Cy', email: 'cy@example.com', status: 'pending' },
    ],
    links: { a: 'https://w.puter.work/sign/aa', b: 'https://w.puter.work/sign/bb', c: 'https://w.puter.work/sign/cc' },
    emailed: {},
    audit: [],
    ...over,
  };
}

beforeEach(() => {
  toasts.length = 0;
  sends.length = 0;
});

describe('advancing the turn', () => {
  it('knows which channel the requests went out on', () => {
    // The choice recorded at the send is the answer.
    expect(requestsWereEmailed(ordered({ channel: 'email' }))).toBe(true);
    expect(requestsWereEmailed(ordered({ channel: 'link', emailed: { 'a:request': { at: 1, v: 'x' } } }))).toBe(false);
    // Documents sent before the choice was recorded: read it off what went out.
    expect(requestsWereEmailed(ordered())).toBe(false);
    expect(requestsWereEmailed(ordered({ emailed: { 'a:request': { at: 1, v: 'x' } } }))).toBe(true);
    // A reminder or a completion notice is not a request.
    expect(requestsWereEmailed(ordered({ emailed: { 'a:reminder': { at: 1, v: 'x' } } }))).toBe(false);
  });

  it('emails the next request when the first went by email', async () => {
    state.doc = ordered({ emailed: { 'a:request': { at: 1, v: 'x' } } });
    await advanceTurn(state.doc);
    expect(sends).toEqual([{ kind: 'request', signerIds: ['b'] }]);
    expect(state.doc.audit.map((e) => e.type)).toContain('turn_opened');
    expect(toasts[0].message).toBe('Bo has been asked to sign');
  });

  it('emails the first external signer once the owner, first in order, has signed', async () => {
    // The sender chose email, but with themselves first nothing went out at
    // the send, so `emailed` is empty. Reading the channel off it called this
    // a copy-link document and told the sender to hand the link over by hand.
    state.doc = ordered({
      channel: 'email',
      signers: [
        { id: 'me', name: 'Alex', isMe: true, status: 'signed' },
        { id: 'b', name: 'Bo', email: 'bo@example.com', status: 'pending' },
      ],
    });
    await advanceTurn(state.doc);
    expect(sends).toEqual([{ kind: 'request', signerIds: ['b'] }]);
    expect(toasts[0].message).toBe('Bo has been asked to sign');
  });

  it('emails a turn once, however many pulls report the same state', async () => {
    state.doc = ordered({ channel: 'email' });
    await advanceTurn(state.doc);
    // The request is versioned on the document, so a changed deadline or a
    // new access code would otherwise send it again on the next pull.
    state.doc.expiresAt = Date.now() + 7 * 86_400_000;
    await advanceTurn(state.doc);
    expect(sends).toHaveLength(1);
    expect(state.doc.turnOpened.b).toBeTruthy();
    expect(state.doc.audit.filter((e) => e.type === 'turn_opened')).toHaveLength(1);
  });

  it('leaves an emailed turn open for retry when the send fails', async () => {
    state.doc = ordered({ channel: 'email' });
    failNext.value = true;
    await advanceTurn(state.doc);
    expect(state.doc.turnOpened).toBeUndefined();
    await advanceTurn(state.doc);
    expect(sends).toHaveLength(2);
    expect(state.doc.turnOpened.b).toBeTruthy();
  });

  it('never emails behind a sender who copied the links by hand', async () => {
    state.doc = ordered();
    await advanceTurn(state.doc);
    expect(sends).toEqual([]);
    // Told whose turn it is, and it goes on the trail.
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain("Bo's turn");
    expect(state.doc.audit.find((e) => e.type === 'turn_opened').detail).toBe('Bo');
  });

  it('announces a turn once, however many pulls report the same state', async () => {
    state.doc = ordered();
    await advanceTurn(state.doc);
    await advanceTurn(state.doc);
    expect(toasts).toHaveLength(1);
    expect(state.doc.audit.filter((e) => e.type === 'turn_opened')).toHaveLength(1);
    // The next turn is its own announcement.
    state.doc.signers[1].status = 'signed';
    await advanceTurn(state.doc);
    expect(toasts).toHaveLength(2);
    expect(toasts[1].message).toContain("Cy's turn");
  });

  it('does not announce the first signer: they had their link at the send', async () => {
    state.doc = ordered();
    state.doc.signers[0].status = 'viewed';
    await advanceTurn(state.doc);
    expect(toasts).toHaveLength(0);
    expect(sends).toEqual([]);
  });

  it('has nothing to do for parallel, finished, or owner-next documents', async () => {
    state.doc = ordered({ signOrder: false });
    await advanceTurn(state.doc);
    state.doc = ordered({ status: 'completed' });
    await advanceTurn(state.doc);
    state.doc = ordered();
    state.doc.signers[1].isMe = true;
    await advanceTurn(state.doc);
    expect(toasts).toHaveLength(0);
    expect(sends).toEqual([]);
  });
});
