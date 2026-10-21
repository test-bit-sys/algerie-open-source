import { describe, it, expect, beforeEach } from 'vitest';
import rawSource from '../src/workers/sign-worker.js?raw';
import { SIGN_WORKER_VERSION } from '../src/lib/signlinks.js';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';
import { makeFs, makeFakePuter } from './helpers/fake-puter.js';
import { createStore } from '../src/lib/store.js';
import {
  describeDevice, formatOffset, evidenceLine, stampWithOffset, groupHex, DISCLOSURE_VERSION,
} from '../src/lib/consent.js';

const SECRET = 'test-admin-secret';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const auth = { authorization: `Bearer ${SECRET}` };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

describe('evidence presentation', () => {
  it('names browser and platform from a user agent', () => {
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'))
      .toBe('Chrome 141 on macOS');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('Safari 17 on iOS');
    // Chromium browsers all claim Safari, and Edge claims Chrome too.
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0.0.0'))
      .toBe('Edge 120 on Windows');
    expect(describeDevice('')).toBe('');
    expect(describeDevice('curl/8.4.0')).toBe('');
  });

  it('formats clock offsets the way people write them', () => {
    expect(formatOffset(-420)).toBe('UTC-07:00');
    expect(formatOffset(330)).toBe('UTC+05:30');
    expect(formatOffset(0)).toBe('UTC+00:00');
    expect(formatOffset(undefined)).toBe('');
  });

  it('joins only the evidence it actually has', () => {
    expect(evidenceLine({ ip: '203.0.113.7', ua: 'Mozilla/5.0 (Windows NT 10.0) Firefox/130.0' }))
      .toBe('203.0.113.7 · Firefox 130 on Windows');
    expect(evidenceLine({ ip: '203.0.113.7' })).toBe('203.0.113.7');
    expect(evidenceLine(null)).toBe('');
  });

  it('stamps a time in the signer\'s own clock when it knows it', () => {
    const at = Date.parse('2026-08-20T21:41:00Z');
    expect(stampWithOffset(at, { tzOffset: -420 })).toContain('UTC-07:00');
    expect(stampWithOffset(at, null)).not.toContain('UTC');
    expect(stampWithOffset(null, { tzOffset: 0 })).toBe('');
  });

  it('groups a digest so it can be read and wrapped', () => {
    expect(groupHex('a'.repeat(16))).toBe('aaaaaaaa aaaaaaaa');
  });
});

/* ---- The worker's record ------------------------------------------------- */

async function buildWorker() {
  const source = rawSource
    .replace('__SIGN_ADMIN_SECRET_HASH__', await sha256Hex(SECRET))
    .replace('__SIGN_WORKER_VERSION__', SIGN_WORKER_VERSION)
    .replace('__SIGN_PAGE_URL__', 'https://signatures.example/sign.html');
  const fs = makeFs();
  await fs.write('signatures-data/d1/original.pdf', PDF);
  return instantiateWorker(source, { me: { puter: { kv: makeKv(), fs } } });
}

const snapshot = {
  doc: { id: 'd1', title: 'NDA', pageCount: 1, pdfPath: 'signatures-data/d1/original.pdf' },
  signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external' }],
  fields: [{ id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true }],
  values: {},
};

const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'cf-connecting-ip': '203.0.113.7',
};

describe('consent and technical context', () => {
  let worker;
  let token;

  beforeEach(async () => {
    worker = await buildWorker();
    const res = await worker.call('POST', '/admin/sync', { headers: auth, json: snapshot });
    token = (await res.json()).links.s1;
  });

  const responses = async () =>
    (await (await worker.call('GET', '/admin/responses', { headers: auth })).json()).docs.d1.s1;

  it('captures IP and browser on the first view', async () => {
    await worker.call('GET', `/api/sign/${token}`, { headers: BROWSER });
    const resp = await responses();
    expect(resp.status).toBe('viewed');
    expect(resp.evidence.view).toMatchObject({ ip: '203.0.113.7' });
    expect(describeDevice(resp.evidence.view.ua)).toBe('Chrome 141 on macOS');
    expect(resp.consentAt).toBeNull();
  });

  it('refuses a signature with no recorded agreement', async () => {
    const res = await worker.call('POST', `/api/sign/${token}`, {
      headers: BROWSER,
      json: { action: 'sign', values: { f1: { kind: 'image', data: IMG } } },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('consent_required');
    expect((await responses()) ?? null).toBeNull();
  });

  it('records the agreement with its disclosure version and context', async () => {
    const res = await worker.call('POST', `/api/sign/${token}`, {
      headers: BROWSER,
      json: { action: 'consent', disclosureVersion: DISCLOSURE_VERSION, tzOffset: -420, tzName: 'America/Los_Angeles' },
    });
    expect(res.status).toBe(200);
    const resp = await responses();
    expect(resp.consentVersion).toBe(DISCLOSURE_VERSION);
    expect(resp.consentAt).toBeTruthy();
    expect(resp.evidence.consent).toMatchObject({ ip: '203.0.113.7', tzOffset: -420, tzName: 'America/Los_Angeles' });
    // Reporting it back to the page means it never asks twice.
    const view = await (await worker.call('GET', `/api/sign/${token}`)).json();
    expect(view.signer.consentAt).toBe(resp.consentAt);
  });

  it('keeps the first agreement when the page is reopened', async () => {
    await worker.call('POST', `/api/sign/${token}`, { headers: BROWSER, json: { action: 'consent', disclosureVersion: '1' } });
    const first = (await responses()).consentAt;
    await worker.call('POST', `/api/sign/${token}`, { headers: BROWSER, json: { action: 'consent', disclosureVersion: '9' } });
    const again = await responses();
    expect(again.consentAt).toBe(first);
    expect(again.consentVersion).toBe('1');
  });

  it('attaches the signer\'s clock and address to the signature', async () => {
    await worker.call('POST', `/api/sign/${token}`, { headers: BROWSER, json: { action: 'consent', disclosureVersion: '1' } });
    await worker.call('POST', `/api/sign/${token}`, {
      headers: { ...BROWSER, 'cf-connecting-ip': '198.51.100.22' },
      json: { action: 'sign', values: { f1: { kind: 'image', data: IMG } }, tzOffset: 60, tzName: 'Europe/Berlin' },
    });
    const resp = await responses();
    expect(resp.evidence.sign).toMatchObject({ ip: '198.51.100.22', tzOffset: 60, tzName: 'Europe/Berlin' });
    expect(resp.signedAt).toBe(resp.evidence.sign.at);
  });

  it('records the context of a decline too', async () => {
    await worker.call('POST', `/api/sign/${token}`, {
      headers: BROWSER,
      json: { action: 'decline', reason: 'Wrong terms', tzOffset: 0 },
    });
    const resp = await responses();
    expect(resp.status).toBe('declined');
    expect(resp.evidence.decline).toMatchObject({ ip: '203.0.113.7', tzOffset: 0 });
  });

  it('takes the first address of a forwarded chain, and nothing from the client', async () => {
    await worker.call('GET', `/api/sign/${token}`, {
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' },
    });
    expect((await responses()).evidence.view.ip).toBe('203.0.113.7');
  });

  it('ignores a clock offset that is not one', async () => {
    await worker.call('POST', `/api/sign/${token}`, {
      headers: BROWSER,
      json: { action: 'consent', disclosureVersion: '1', tzOffset: 99999, tzName: 'x'.repeat(200) },
    });
    const resp = await responses();
    expect(resp.evidence.consent.tzOffset).toBeUndefined();
    expect(resp.evidence.consent.tzName).toHaveLength(60);
  });
});

/**
 * The worker captures the signer's clock from the request body, so the page
 * has to put it there. It did for the consent and the decline and not for the
 * signature - the one act the certificate prints a clock beside - which left
 * every external signer's signature stamped in the reader's timezone with no
 * record of the signer's own.
 */
describe('the signing page sends the signer\'s clock with every act', () => {
  it('puts localClock() on the consent, the decline, and the signature', async () => {
    const page = (await import('../src/sign-main.js?raw')).default;
    const bodies = [...page.matchAll(/action: '(consent|decline|sign)'[^\n]*/g)].map((m) => m[0]);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) expect(body).toContain('...localClock()');
  });
});

/* ---- The document fingerprint -------------------------------------------- */

describe('document fingerprint', () => {
  it('is the SHA-256 of the original bytes, recorded once', async () => {
    const p = makeFakePuter();
    const store = createStore({ getPuter: () => p });
    await store.init();
    const doc = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 1 });
    const first = await store.recordFingerprint(doc.id);
    // SHA-256 of the four bytes "%PDF".
    expect(first.hex).toBe(await sha256Hex('%PDF'));
    expect(first.alg).toBe('SHA-256');
    expect(store.getDoc(doc.id).fingerprint.hex).toBe(first.hex);
    // Recording again keeps the original stamp: the file has not changed.
    const second = await store.recordFingerprint(doc.id);
    expect(second.at).toBe(first.at);
  });

  it('records the owner\'s own consent in the app', async () => {
    const p = makeFakePuter();
    const store = createStore({ getPuter: () => p });
    await store.init();
    const doc = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 1 });
    await store.patchDoc(doc.id, { signers: [{ id: 'me', name: 'Alex', isMe: true, status: 'pending' }] });
    await store.recordConsent(doc.id, 'me', { version: '1', tzOffset: -420, tzName: 'America/Los_Angeles' });
    const me = store.getDoc(doc.id).signers[0];
    expect(me.consentAt).toBeTruthy();
    expect(me.consentVersion).toBe('1');
    expect(me.evidence.consent.tzName).toBe('America/Los_Angeles');
    expect(store.getDoc(doc.id).audit.some((a) => a.type === 'consented')).toBe(true);
    // Signing in-app stamps the same shape of record.
    await store.markSignerSigned(doc.id, 'me', {});
    expect(store.getDoc(doc.id).signers[0].evidence.sign.at).toBeTruthy();
  });

  it('fingerprints the rebuilt PDF after a failed send leaves a draft editable', async () => {
    const p = makeFakePuter();
    const store = createStore({ getPuter: () => p });
    await store.init();
    const doc = await store.createDoc({ title: 'NDA', pdfBytes: PDF, pageCount: 1 });
    // Sending fingerprints before deploying the worker. A failed deployment
    // leaves the draft open to adding, rotating, or deleting pages.
    const before = await store.recordFingerprint(doc.id);
    await store.replacePdf(doc.id, new TextEncoder().encode('%PDF rebuilt'), 2);
    const reloaded = createStore({ getPuter: () => p });
    await reloaded.init();
    const after = await reloaded.recordFingerprint(doc.id);
    expect(after.hex).toBe(await sha256Hex('%PDF rebuilt'));
    expect(after.hex).not.toBe(before.hex);
  });

  it('preserves the fingerprint when replacing the PDF fails', async () => {
    const p = makeFakePuter();
    const store = createStore({ getPuter: () => p });
    await store.init();
    const doc = await store.createDoc({ title: 'NDA', pdfBytes: PDF, pageCount: 1 });
    const before = await store.recordFingerprint(doc.id);
    p.fs.write.mockRejectedValueOnce(new Error('offline'));
    await expect(store.replacePdf(doc.id, new Uint8Array([1]), 2)).rejects.toThrow('offline');
    expect(await store.recordFingerprint(doc.id)).toEqual(before);
    await store.markSent(doc.id, {});
    await expect(store.replacePdf(doc.id, new Uint8Array([1]), 2)).rejects.toThrow('Only a draft');
    expect(await store.recordFingerprint(doc.id)).toEqual(before);
  });
});
