import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore } from '../src/lib/store.js';
import { createEmailer, digest, describeResult, failureMessage } from '../src/lib/emailer.js';
import { makeFakePuter } from './helpers/fake-puter.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const LINK = `https://doc-sign-abc12.puter.work/sign/${'a'.repeat(40)}`;

describe('digest', () => {
  it('is stable for equal input and different for different input', () => {
    expect(digest(['a', 1])).toBe(digest(['a', 1]));
    expect(digest(['a', 1])).not.toBe(digest(['a', 2]));
    expect(digest(['a', 1])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('describeResult', () => {
  it('summarizes outcomes for the toast', () => {
    expect(describeResult({ sent: 2 }).message).toBe('Emails sent to 2 signers');
    expect(describeResult({ sent: 1 }).message).toBe('Email sent');
    expect(describeResult({ sent: 1, failed: 1 }).message).toContain('could not be delivered');
    expect(describeResult({ suppressed: 1 }).message).toContain('opted out');
    expect(describeResult({
      sent: 0,
      results: [{ email: 'a@example.com', status: 'skipped', reason: 'daily_limit' }],
    }).message).toContain('daily email limit');
    expect(describeResult({}).quiet).toBe(true);
  });
});

describe('failureMessage', () => {
  it('maps statuses to human messages', () => {
    expect(failureMessage(401, {})).toContain('Sign in');
    expect(failureMessage(429, {})).toContain('daily email limit');
    expect(failureMessage(404, {})).toContain('unavailable');
    expect(failureMessage(500, {})).toContain('try again');
  });
});

describe('emailer', () => {
  let p;
  let store;
  let emailer;
  let doc;

  beforeEach(async () => {
    p = makeFakePuter();
    store = createStore({ getPuter: () => p });
    await store.init();
    await store.updateSettings({ fullName: 'Alex Rivera' });
    emailer = createEmailer({ store, getPuter: () => p });
    const created = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 1 });
    await store.patchDoc(created.id, {
      signers: [
        { id: 'me', name: 'Alex', email: 'me@example.com', isMe: true, status: 'pending' },
        { id: 's1', name: 'Ava', email: 'ava@example.com', isMe: false, status: 'pending' },
        { id: 's2', name: 'NoLink', email: 'bo@example.com', isMe: false, status: 'pending' },
      ],
    });
    await store.markSent(created.id, { s1: LINK });
    doc = store.getDoc(created.id);
  });

  it('plans only external signers that have a link', () => {
    const plan = emailer.planFor(doc);
    expect(plan.map((r) => r.signerId)).toEqual(['s1']);
    expect(plan[0].current).toBe(false);
    expect(plan[0].signUrl).toBe(LINK);
  });

  it('sends through workers.exec and records what went out', async () => {
    p.workers.exec.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, sent: 1, results: [{ email: 'ava@example.com', status: 'sent', at: 123 }] }),
    });
    const out = await emailer.send(doc, { kind: 'request' });
    expect(out.sent).toBe(1);
    const [url, init] = p.workers.exec.mock.calls[0];
    expect(url).toContain('signatures-email.puter.work/send');
    const body = JSON.parse(init.body);
    expect(body.doc.ownerName).toBe('Alex Rivera');
    expect(body.recipients).toHaveLength(1);
    expect(body.recipients[0].signUrl).toBe(LINK);
    // No deadline, no clock to state it in.
    expect(body.doc.tzOffset).toBeNull();

    const after = store.getDoc(doc.id);
    expect(after.emailed['s1:request'].at).toBe(123);
    expect(after.audit.some((a) => a.type === 'emailed')).toBe(true);
    // The signer is now "current": a plain re-send has nobody to mail.
    expect(emailer.planFor(after)[0].current).toBe(true);
    const again = await emailer.send(after, { kind: 'request' });
    expect(again.sent).toBe(0);
    expect(p.workers.exec).toHaveBeenCalledTimes(1);
  });

  it('a skipped result from the worker still heals the local cache', async () => {
    p.workers.exec.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, sent: 0, results: [{ email: 'ava@example.com', status: 'skipped', reason: 'already_sent', at: 99 }] }),
    });
    await emailer.send(doc, { kind: 'request' });
    expect(store.getDoc(doc.id).emailed['s1:request'].at).toBe(99);
  });

  it('does not record signers skipped for the daily limit as emailed', async () => {
    p.workers.exec.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, sent: 0, results: [{ email: 'ava@example.com', status: 'skipped', reason: 'daily_limit' }] }),
    });
    await emailer.send(doc, { kind: 'request' });
    expect(store.getDoc(doc.id).emailed?.['s1:request']).toBeUndefined();
    // The signer must still be offered for sending on the next attempt.
    expect(emailer.planFor(store.getDoc(doc.id))[0].current).toBe(false);
  });

  it('surfaces worker failures as toast-ready messages', async () => {
    p.workers.exec.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'daily_limit' }) });
    await expect(emailer.send(doc, { kind: 'request' })).rejects.toThrow(/daily email limit/);
  });

  it('tells the worker the sender\'s clock at the deadline, so the mail can state it', async () => {
    p.workers.exec.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, sent: 1, results: [] }) });
    const at = new Date(2026, 8, 12, 23, 59, 59, 999).getTime();
    await store.patchDoc(doc.id, { expiresAt: at });
    await emailer.send(store.getDoc(doc.id), { kind: 'request' });
    const body = JSON.parse(p.workers.exec.mock.calls[0][1].body);
    expect(body.doc.expiresAt).toBe(at);
    // 0 - offset, not -offset: in UTC that is -0, which JSON sends as 0.
    expect(body.doc.tzOffset).toBe(0 - new Date(at).getTimezoneOffset());
  });

  it('reminders address one signer and bypass dedupe', async () => {
    p.workers.exec.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, sent: 1, results: [{ email: 'ava@example.com', status: 'sent', at: 5 }] }),
    });
    await emailer.send(doc, { signerIds: ['s1'], kind: 'reminder', force: true });
    const body = JSON.parse(p.workers.exec.mock.calls[0][1].body);
    expect(body.kind).toBe('reminder');
    expect(body.force).toBe(true);
    expect(body.recipients).toHaveLength(1);
  });

  it('sends recurring reminders again while ordinary sends stay deduplicated', async () => {
    p.workers.exec.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, sent: 1, results: [{ email: 'ava@example.com', status: 'sent' }] }),
    });
    await emailer.send(doc, { kind: 'reminder', force: true });
    expect(emailer.planFor(store.getDoc(doc.id), 'reminder')[0].current).toBe(true);

    const ordinary = await emailer.send(store.getDoc(doc.id), { kind: 'reminder' });
    expect(ordinary.sent).toBe(0);
    const recurring = await emailer.send(store.getDoc(doc.id), { kind: 'reminder', force: true });
    expect(recurring.sent).toBe(1);
    expect(p.workers.exec).toHaveBeenCalledTimes(2);
    const body = JSON.parse(p.workers.exec.mock.calls[1][1].body);
    expect(body.force).toBe(true);
    expect(body.recipients.map((r) => r.email)).toEqual(['ava@example.com']);
  });
});
