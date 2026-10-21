import { describe, it, expect, beforeEach } from 'vitest';
import signSource from '../src/workers/sign-worker.js?raw';
import emailSource from '../src/workers/email-worker.js?raw';
import { SIGN_WORKER_VERSION } from '../src/lib/signlinks.js';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';
import { makeFs, makeFakePuter } from './helpers/fake-puter.js';
import { createStore } from '../src/lib/store.js';
import {
  isExpired, expiresInWords, reminderDue, deriveStatus, DAY_MS, PRE_EXPIRY_DAYS, DOC_STATUSES,
} from '../src/lib/model.js';
import { pastDeadline } from '../src/ui/sendflow.js';
import { createSignLinks } from '../src/lib/signlinks.js';

const SECRET = 'test-admin-secret';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const auth = { authorization: `Bearer ${SECRET}` };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const NOW = Date.parse('2026-08-20T12:00:00Z');

function sentDoc(over = {}) {
  return {
    id: 'd1',
    title: 'NDA',
    status: 'sent',
    sentAt: NOW - 10 * DAY_MS,
    signers: [
      { id: 's1', name: 'Ava', email: 'ava@example.com', status: 'pending' },
      { id: 'me', name: 'Alex', isMe: true, status: 'signed' },
    ],
    reminder: { every: 3, beforeExpiry: true },
    ...over,
  };
}

describe('expiry', () => {
  it('is a status of its own', () => {
    expect(DOC_STATUSES.expired.label).toBe('Expired');
  });

  it('knows whether a deadline has passed', () => {
    expect(isExpired({ expiresAt: NOW - 1 }, NOW)).toBe(true);
    expect(isExpired({ expiresAt: NOW + 1 }, NOW)).toBe(false);
    expect(isExpired({}, NOW)).toBe(false);
  });

  it('counts down in the units that matter', () => {
    expect(expiresInWords({ expiresAt: NOW + 5 * DAY_MS }, NOW)).toBe('in 5 days');
    expect(expiresInWords({ expiresAt: NOW + DAY_MS }, NOW)).toBe('in 1 day');
    expect(expiresInWords({ expiresAt: NOW + 4 * 60 * 60 * 1000 }, NOW)).toBe('in 4 hours');
    expect(expiresInWords({ expiresAt: NOW - 1 }, NOW)).toBe('expired');
    expect(expiresInWords({}, NOW)).toBe('');
  });

  it('takes a sent document past its deadline to expired, and back on an extension', () => {
    expect(deriveStatus(sentDoc({ expiresAt: NOW - 1 }), NOW)).toBe('expired');
    expect(deriveStatus(sentDoc({ status: 'expired', expiresAt: NOW + DAY_MS }), NOW)).toBe('sent');
    expect(deriveStatus(sentDoc({ status: 'expired', expiresAt: NOW - 1 }), NOW)).toBe('expired');
  });

  it('lets an answer outrank the clock', () => {
    const done = sentDoc({ expiresAt: NOW - 1 });
    done.signers = done.signers.map((s) => ({ ...s, status: 'signed' }));
    expect(deriveStatus(done, NOW)).toBe('completed');
    const refused = sentDoc({ expiresAt: NOW - 1 });
    refused.signers[0].status = 'declined';
    expect(deriveStatus(refused, NOW)).toBe('declined');
    expect(deriveStatus(sentDoc({ status: 'voided', expiresAt: NOW - 1 }), NOW)).toBe('voided');
  });
});

describe('a deadline the sender picked', () => {
  it('is refused once it has gone by', () => {
    // Typing a date walks past the picker's `min`, and sending then means
    // links the worker answers 410 to and an email inviting their use.
    expect(pastDeadline(NOW - 1, NOW)).toBe(true);
    expect(pastDeadline(NOW, NOW)).toBe(true);
    expect(pastDeadline(NOW + 1, NOW)).toBe(false);
    // No expiry at all is not a problem.
    expect(pastDeadline(0, NOW)).toBe(false);
    expect(pastDeadline(null, NOW)).toBe(false);
  });
});

describe('when a reminder is due', () => {
  it('follows the schedule from the last one, or from the send', () => {
    expect(reminderDue(sentDoc(), NOW)).toBe('schedule');
    expect(reminderDue(sentDoc({ reminder: { every: 3, lastAt: NOW - DAY_MS } }), NOW)).toBe('');
    expect(reminderDue(sentDoc({ reminder: { every: 3, lastAt: NOW - 4 * DAY_MS } }), NOW)).toBe('schedule');
    expect(reminderDue(sentDoc({ reminder: { every: 0 } }), NOW)).toBe('');
  });

  it('makes one last call before the deadline, once', () => {
    const soon = sentDoc({
      expiresAt: NOW + (PRE_EXPIRY_DAYS - 1) * DAY_MS,
      reminder: { every: 0, beforeExpiry: true },
    });
    expect(reminderDue(soon, NOW)).toBe('expiry');
    expect(reminderDue({ ...soon, reminder: { ...soon.reminder, preExpiryAt: NOW } }, NOW)).toBe('');
  });

  it('does not make the last call on the heels of the request itself', () => {
    // A deadline a day out puts the whole document inside the last-call
    // window at the send; the request states the deadline, so the reminder
    // waits a day for the signer to act on it.
    const short = sentDoc({
      sentAt: NOW - 60_000,
      expiresAt: NOW + DAY_MS,
      reminder: { every: 0, beforeExpiry: true },
    });
    expect(reminderDue(short, NOW)).toBe('');
    expect(reminderDue({ ...short, sentAt: NOW - DAY_MS }, NOW)).toBe('expiry');
    // The same day's grace after a reminder that has just gone out.
    const chased = { ...short, sentAt: NOW - 3 * DAY_MS, reminder: { every: 3, beforeExpiry: true, lastAt: NOW - 60_000 } };
    expect(reminderDue(chased, NOW)).toBe('');
  });

  it('stops at the deadline: chasing a dead link is worse than silence', () => {
    expect(reminderDue(sentDoc({ expiresAt: NOW - 1 }), NOW)).toBe('');
  });

  it('says nothing when nobody owes a signature', () => {
    const done = sentDoc();
    done.signers[0].status = 'signed';
    expect(reminderDue(done, NOW)).toBe('');
    const refused = sentDoc();
    refused.signers[0].status = 'declined';
    expect(reminderDue(refused, NOW)).toBe('');
  });

  it('skips drafts, samples, and documents already closed', () => {
    expect(reminderDue(sentDoc({ status: 'draft' }), NOW)).toBe('');
    expect(reminderDue(sentDoc({ sample: true }), NOW)).toBe('');
    expect(reminderDue(sentDoc({ status: 'completed' }), NOW)).toBe('');
  });

  it('waits its turn when signing is sequential', () => {
    const ordered = sentDoc({
      signOrder: true,
      signers: [
        { id: 'a', name: 'Ava', email: 'a@x.co', status: 'pending' },
        { id: 'b', name: 'Bo', email: 'b@x.co', status: 'pending' },
      ],
    });
    // Only the signer whose turn it is counts as outstanding, and they are.
    expect(reminderDue(ordered, NOW)).toBe('schedule');
    const waiting = { ...ordered, signers: [{ ...ordered.signers[0], status: 'declined' }, ordered.signers[1]] };
    expect(reminderDue(waiting, NOW)).toBe('');
  });
});

describe('the store side of a deadline', () => {
  let store;

  beforeEach(async () => {
    const p = makeFakePuter();
    store = createStore({ getPuter: () => p });
    await store.init();
  });

  async function doc() {
    const created = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 1 });
    await store.patchDoc(created.id, {
      signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', status: 'pending' }],
    });
    return created.id;
  }

  it('stamps the deadline and the schedule when sending', async () => {
    const id = await doc();
    const at = Date.now() + 14 * DAY_MS;
    await store.markSent(id, {}, { expiresAt: at, reminder: { every: 7, beforeExpiry: true } });
    const sent = store.getDoc(id);
    expect(sent.expiresAt).toBe(at);
    expect(sent.reminder).toMatchObject({ every: 7, beforeExpiry: true, lastAt: 0, preExpiryAt: 0 });
  });

  it('expires, extends, and clears, writing each to the trail', async () => {
    const id = await doc();
    await store.markSent(id, {}, { expiresAt: Date.now() - 1000 });
    await store.markExpired(id);
    expect(store.getDoc(id).status).toBe('expired');
    expect(store.getDoc(id).audit.some((a) => a.type === 'expired')).toBe(true);

    await store.setExpiry(id, Date.now() + 7 * DAY_MS);
    expect(store.getDoc(id).status).toBe('sent');
    expect(store.getDoc(id).audit.some((a) => a.type === 'extended')).toBe(true);

    await store.setExpiry(id, null);
    expect(store.getDoc(id).expiresAt).toBeNull();
    expect(store.getDoc(id).audit.some((a) => a.type === 'expiry_cleared')).toBe(true);
  });

  it('only expires a document that was out for signature', async () => {
    const id = await doc();
    await store.patchDoc(id, { expiresAt: Date.now() - 1 });
    expect(await store.markExpired(id)).toBeNull(); // still a draft
    expect(store.getDoc(id).status).toBe('draft');
  });

  it('re-arms the last call when the deadline moves', async () => {
    const id = await doc();
    await store.markSent(id, {}, { expiresAt: Date.now() + DAY_MS, reminder: { every: 3, beforeExpiry: true } });
    await store.markReminded(id, { preExpiry: true });
    expect(store.getDoc(id).reminder.preExpiryAt).toBeTruthy();
    // The last call already sent was about the old date.
    await store.setExpiry(id, Date.now() + 8 * DAY_MS);
    expect(store.getDoc(id).reminder.preExpiryAt).toBe(0);
    // The schedule itself counts on from the reminder that did go out.
    expect(store.getDoc(id).reminder.lastAt).toBeTruthy();
    expect(store.getDoc(id).reminder.every).toBe(3);
  });

  it('remembers when a reminder went out', async () => {
    const id = await doc();
    await store.markSent(id, {}, { reminder: { every: 3, beforeExpiry: true } });
    await store.markReminded(id, { preExpiry: true });
    const after = store.getDoc(id).reminder;
    expect(after.lastAt).toBeTruthy();
    expect(after.preExpiryAt).toBe(after.lastAt);
  });
});

describe('the worker enforces the deadline itself', () => {
  let worker;
  let token;

  async function sync(expiresAt) {
    const res = await worker.call('POST', '/admin/sync', {
      headers: auth,
      json: {
        doc: { id: 'd1', title: 'NDA', pageCount: 1, pdfPath: 'signatures-data/d1/original.pdf' },
        signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external' }],
        fields: [{ id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true }],
        values: {},
        expiresAt,
      },
    });
    const { links } = await res.json();
    return links.s1 || token;
  }

  beforeEach(async () => {
    const source = signSource
      .replace('__SIGN_ADMIN_SECRET_HASH__', await sha256Hex(SECRET))
      .replace('__SIGN_WORKER_VERSION__', SIGN_WORKER_VERSION)
      .replace('__SIGN_PAGE_URL__', 'https://signatures.example/sign.html');
    const fs = makeFs();
    await fs.write('signatures-data/d1/original.pdf', PDF);
    worker = instantiateWorker(source, { me: { puter: { kv: makeKv(), fs } } });
    token = await sync(Date.now() + 60_000);
  });

  it('serves the document up to the deadline', async () => {
    expect((await worker.call('GET', `/api/sign/${token}`)).status).toBe(200);
  });

  it('refuses everything after it, whatever the app knows', async () => {
    await sync(Date.now() - 1);
    const view = await worker.call('GET', `/api/sign/${token}`);
    expect(view.status).toBe(410);
    expect((await view.json()).error).toBe('expired');
    expect((await worker.call('GET', `/api/sign/${token}/pdf`)).status).toBe(410);
    const post = await worker.call('POST', `/api/sign/${token}`, {
      json: { action: 'consent', disclosureVersion: '1' },
    });
    expect(post.status).toBe(410);
    expect((await post.json()).error).toBe('expired');
  });

  it('takes an extension without reissuing the link', async () => {
    await sync(Date.now() - 1);
    expect((await worker.call('GET', `/api/sign/${token}`)).status).toBe(410);
    await sync(Date.now() + 60_000);
    expect((await worker.call('GET', `/api/sign/${token}`)).status).toBe(200);
  });

  it('reports an expired document as expired, and a finished one as completed', async () => {
    await worker.call('POST', `/api/sign/${token}`, { json: { action: 'consent', disclosureVersion: '1' } });
    await worker.call('POST', `/api/sign/${token}`, {
      json: { action: 'sign', values: { f1: { kind: 'image', data: IMG } } },
    });
    // Signed before the clock ran out: the deadline no longer decides.
    await sync(Date.now() - 1);
    const out = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(out.docs.d1.s1.status).toBe('signed');
  });

  it('keeps serving a completed document after its deadline', async () => {
    await worker.call('POST', `/api/sign/${token}`, { json: { action: 'consent', disclosureVersion: '1' } });
    await worker.call('POST', `/api/sign/${token}`, {
      json: { action: 'sign', values: { f1: { kind: 'image', data: IMG } } },
    });
    await sync(Date.now() - 1);
    // Everyone signed before the clock ran out, so the signer who comes back
    // for the completed copy the page offered them still gets it: the view
    // and the file both answer, and the document reads completed, not expired.
    const view = await worker.call('GET', `/api/sign/${token}`);
    expect(view.status).toBe(200);
    expect((await view.json()).state).toBe('completed');
    expect((await worker.call('GET', `/api/sign/${token}/pdf`)).status).toBe(200);
    // A second signature is still refused, but for the right reason.
    const again = await worker.call('POST', `/api/sign/${token}`, {
      json: { action: 'sign', values: { f1: { kind: 'image', data: IMG } } },
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('already_signed');
  });

  it('lets a decline outrank the deadline too, as the app does', async () => {
    await worker.call('POST', `/api/sign/${token}`, { json: { action: 'decline', reason: 'No' } });
    await sync(Date.now() - 1);
    const view = await worker.call('GET', `/api/sign/${token}`);
    expect(view.status).toBe(200);
    const data = await view.json();
    expect(data.state).toBe('declined');
    expect(data.signer.status).toBe('declined');
  });
});

/**
 * The send path, end to end: the deadline the sender chooses in the send
 * dialog is only stamped on the record by markSent, which cannot run until the
 * links exist — so the snapshot pushed to the worker has to carry it. When it
 * did not, the worker enforced no deadline at all and every link stayed alive
 * past it, while the app's own copy read Expired.
 */
describe('the deadline chosen while sending', () => {
  it('reaches the worker in the same pass that mints the links', async () => {
    const p = makeFakePuter();
    const store = createStore({ getPuter: () => p });
    await store.init();
    const links = createSignLinks({
      store,
      getPuter: () => p,
      fetchFn: p.fetchTo,
      verifyAttempts: 2,
      verifyDelayMs: 1,
      pageUrl: 'https://signatures.example/sign.html',
    });

    const draft = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 1 });
    await store.patchDoc(draft.id, {
      signers: [{ id: 'ext1', name: 'Ava', email: 'ava@example.com', isMe: false, status: 'pending' }],
      fields: [{ id: 'f1', signerId: 'ext1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true }],
    });

    // What src/ui/sendflow.js does on the send button, in that order.
    const deadline = Date.now() + 7 * DAY_MS;
    const map = await links.syncDoc({ ...store.getDoc(draft.id), expiresAt: deadline });
    await store.markSent(draft.id, map, { expiresAt: deadline, reminder: { every: 0, beforeExpiry: true } });

    const url = new URL(map.ext1);
    const worker = p.workersByUrl.get(url.origin).instance;
    const token = url.pathname.split('/').pop();
    expect((await worker.kv.get(`sigw:doc:${draft.id}`)).expiresAt).toBe(deadline);

    // And it is the worker, not the app, that shuts the link down.
    await links.syncDoc({ ...store.getDoc(draft.id), expiresAt: Date.now() - 1 });
    const view = await worker.call('GET', `/api/sign/${token}`);
    expect(view.status).toBe(410);
    expect((await view.json()).error).toBe('expired');
  });
});

describe('the request email states the deadline', () => {
  it('says when to sign by, in the sender\'s own clock', async () => {
    const sent = [];
    const worker = instantiateWorker(emailSource, {
      me: { puter: { kv: makeKv(), email: { send: async (m) => (sent.push(m), {}) }, authToken: 't' } },
    });
    // The end of 12 September in Los Angeles is the morning of the 13th in
    // UTC; the mail has to say the 12th, or a signer there has until a day
    // the link is already dead.
    await worker.call('POST', '/send', {
      user: { uuid: 'u-1', puter: { authToken: 'c' } },
      json: {
        doc: {
          id: 'd1', title: 'NDA', ownerName: 'Alex', ownerEmail: 'alex@example.com', pageCount: 1,
          expiresAt: Date.parse('2026-09-13T06:59:59.999Z'), tzOffset: -420,
        },
        recipients: [{
          email: 'ava@example.com', name: 'Ava', version: 'abcdef12',
          signUrl: `https://w.puter.work/sign/${'a'.repeat(40)}`,
        }],
        kind: 'request',
      },
    });
    expect(sent[0].text).toContain('Please sign by 12 September 2026, 11:59 PM (UTC-07:00)');
    expect(sent[0].html).toContain('12 September 2026, 11:59 PM (UTC-07:00)');
    // East of Greenwich the same instant reads with a plus.
    sent.length = 0;
    await worker.call('POST', '/send', {
      user: { uuid: 'u-1', puter: { authToken: 'c' } },
      json: {
        doc: { id: 'd2', title: 'NDA', pageCount: 1, expiresAt: Date.parse('2026-09-12T15:29:59Z'), tzOffset: 330 },
        recipients: [{ email: 'ava@example.com', version: 'abcdef12' }],
        kind: 'request',
      },
    });
    expect(sent[0].text).toContain('12 September 2026, 8:59 PM (UTC+05:30)');
  });

  it('falls back to the UTC date when the app does not say what clock the sender is on', async () => {
    const sent = [];
    const worker = instantiateWorker(emailSource, {
      me: { puter: { kv: makeKv(), email: { send: async (m) => (sent.push(m), {}) }, authToken: 't' } },
    });
    await worker.call('POST', '/send', {
      user: { uuid: 'u-1', puter: { authToken: 'c' } },
      json: {
        doc: {
          id: 'd1', title: 'NDA', ownerName: 'Alex', ownerEmail: 'alex@example.com', pageCount: 1,
          expiresAt: Date.parse('2026-09-04T23:59:59Z'),
        },
        recipients: [{
          email: 'ava@example.com', name: 'Ava', version: 'abcdef12',
          signUrl: `https://w.puter.work/sign/${'a'.repeat(40)}`,
        }],
        kind: 'request',
      },
    });
    expect(sent[0].text).toContain('Please sign by 4 September 2026 (UTC)');
    expect(sent[0].html).toContain('4 September 2026 (UTC)');
  });
});
