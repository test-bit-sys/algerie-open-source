import { describe, it, expect, beforeEach } from 'vitest';
import rawSource from '../src/workers/sign-worker.js?raw';
import { SIGN_WORKER_VERSION } from '../src/lib/signlinks.js';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';
import { makeFs } from './helpers/fake-puter.js';
import {
  isValidInput, displayValue, needsSigner, isFieldComplete, numericText, inputTypeHint,
} from '../src/lib/model.js';

const SECRET = 'test-admin-secret';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const auth = { authorization: `Bearer ${SECRET}` };

describe('input types', () => {
  it('accepts blank whatever the type: required is a separate question', () => {
    for (const type of ['text', 'number', 'email', 'date']) {
      expect(isValidInput(type, '')).toBe(true);
      expect(isValidInput(type, '   ')).toBe(true);
      expect(isValidInput(type, undefined)).toBe(true);
    }
  });

  it('validates numbers, ignoring thousands separators', () => {
    expect(numericText('1,250.50')).toBe('1250.50');
    expect(isValidInput('number', '1,250.50')).toBe(true);
    expect(isValidInput('number', '-4')).toBe(true);
    expect(isValidInput('number', '.5')).toBe(true);
    expect(isValidInput('number', '12 dollars')).toBe(false);
    expect(isValidInput('number', '1.2.3')).toBe(false);
  });

  it('validates email addresses and dates', () => {
    expect(isValidInput('email', 'alex@example.com')).toBe(true);
    expect(isValidInput('email', 'alex@example')).toBe(false);
    expect(isValidInput('date', '2026-09-04')).toBe(true);
    expect(isValidInput('date', '2026-13-45')).toBe(false);
    expect(isValidInput('date', 'next Friday')).toBe(false);
  });

  it('a text field is only complete when its value fits its type', () => {
    const field = { type: 'text', required: true, inputType: 'email' };
    expect(isFieldComplete(field, 'nope')).toBe(false);
    expect(isFieldComplete(field, 'ava@example.com')).toBe(true);
    // An untyped field takes anything.
    expect(isFieldComplete({ type: 'text', required: true }, 'nope')).toBe(true);
  });

  it.each(['2026-02-29', '2026-02-30', '2026-04-31', '1900-02-29'])(
    'rejects nonexistent calendar date %s', (value) => {
      expect(isValidInput('date', value)).toBe(false);
    },
  );

  it.each(['2024-02-29', '2000-02-29', '2026-04-30'])(
    'accepts real calendar date %s', (value) => {
      expect(isValidInput('date', value)).toBe(true);
    },
  );

  it('names what each type wants', () => {
    expect(inputTypeHint('number')).toMatch(/number/i);
    expect(inputTypeHint('email')).toMatch(/email/i);
  });
});

describe('sender-filled and read-only fields', () => {
  it('shows the sender value until the signer answers', () => {
    expect(displayValue({ id: 'a', preset: 'Acme Inc' }, {})).toBe('Acme Inc');
    expect(displayValue({ id: 'a', preset: 'Acme Inc' }, { a: 'Other Ltd' })).toBe('Other Ltd');
    expect(displayValue({ id: 'a', preset: 'Acme Inc' }, { a: '' })).toBe('');
    // An unchecked box is a real answer and outranks a preset.
    expect(displayValue({ id: 'a', preset: true }, { a: false })).toBe(false);
    expect(displayValue({ id: 'a' }, {})).toBeUndefined();
  });

  it('read-only fields are never work for the signer', () => {
    expect(needsSigner({ required: true })).toBe(true);
    expect(needsSigner({ required: true, readOnly: true })).toBe(false);
    expect(needsSigner({ required: false })).toBe(false);
  });
});

/* ---- The worker's half --------------------------------------------------- */

async function buildWorker() {
  const source = rawSource
    .replace('__SIGN_ADMIN_SECRET_HASH__', await sha256Hex(SECRET))
    .replace('__SIGN_WORKER_VERSION__', SIGN_WORKER_VERSION)
    .replace('__SIGN_PAGE_URL__', 'https://signatures.example/sign.html');
  const fs = makeFs();
  await fs.write('signatures-data/d1/original.pdf', new Uint8Array([1, 2, 3]));
  return instantiateWorker(source, { me: { puter: { kv: makeKv(), fs } } });
}

function snapshot(fields) {
  return {
    doc: { id: 'd1', title: 'NDA', pageCount: 1, pdfPath: 'signatures-data/d1/original.pdf' },
    signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', kind: 'external' }],
    fields: [
      { id: 'sig', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true },
      ...fields,
    ],
    values: {},
  };
}

describe('sign worker field options', () => {
  let worker;

  beforeEach(async () => {
    worker = await buildWorker();
  });

  async function sync(body) {
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

  const textField = (extra) => ({
    id: 'txt', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.03,
    required: true, ...extra,
  });

  it('serves label, help, type and read-only to the signer', async () => {
    const links = await sync(snapshot([
      textField({ label: 'Job title', help: 'As it appears on your contract', inputType: 'text' }),
      { id: 'ro', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.3, w: 0.3, h: 0.03, required: true, readOnly: true, preset: 'Acme Inc' },
    ]));
    const data = await (await worker.call('GET', `/api/sign/${links.s1}`)).json();
    const txt = data.fields.find((f) => f.id === 'txt');
    expect(txt).toMatchObject({ label: 'Job title', help: 'As it appears on your contract', inputType: 'text', readOnly: false });
    const ro = data.fields.find((f) => f.id === 'ro');
    expect(ro).toMatchObject({ readOnly: true, value: 'Acme Inc' });
  });

  it('prefills the sender value and lets the signer replace it', async () => {
    const links = await sync(snapshot([textField({ preset: 'Acme Inc' })]));
    const before = await (await worker.call('GET', `/api/sign/${links.s1}`)).json();
    expect(before.fields.find((f) => f.id === 'txt').value).toBe('Acme Inc');

    const res = await signAs(`/api/sign/${links.s1}`, { sig: { kind: 'image', data: IMG }, txt: 'Other Ltd' });
    expect(res.status).toBe(200);
    const responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s1.values.txt).toBe('Other Ltd');
  });

  it('refuses a value that does not fit the type, even hand-rolled', async () => {
    const links = await sync(snapshot([textField({ inputType: 'email', label: 'Work email' })]));
    const bad = await signAs(`/api/sign/${links.s1}`, { sig: { kind: 'image', data: IMG }, txt: 'not-an-email' });
    expect(bad.status).toBe(400);
    expect((await bad.json())).toMatchObject({ error: 'missing_required', fields: ['txt'] });

    const good = await signAs(`/api/sign/${links.s1}`, { sig: { kind: 'image', data: IMG }, txt: 'ava@example.com' });
    expect(good.status).toBe(200);
  });

  it('keeps an optional preset blank when the signer clears it', async () => {
    const links = await sync(snapshot([textField({ required: false, preset: 'Acme Inc' })]));
    const path = `/api/sign/${links.s1}`;
    expect((await signAs(path, { sig: { kind: 'image', data: IMG }, txt: '' })).status).toBe(200);
    const data = await (await worker.call('GET', path)).json();
    expect(data.fields.find((f) => f.id === 'txt').value).toBe('');
  });

  it('refuses impossible calendar dates in a direct submission', async () => {
    const links = await sync(snapshot([textField({ inputType: 'date' })]));
    const path = `/api/sign/${links.s1}`;
    const invalid = await signAs(path, { sig: { kind: 'image', data: IMG }, txt: '2026-02-29' });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).fields).toEqual(['txt']);
    const valid = await signAs(path, { sig: { kind: 'image', data: IMG }, txt: '2024-02-29' });
    expect(valid.status).toBe(200);
  });

  it('keeps the sender\'s value on a read-only field whatever is submitted', async () => {
    const links = await sync(snapshot([
      { id: 'ro', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.3, w: 0.3, h: 0.03, required: true, readOnly: true, preset: 'Acme Inc' },
    ]));
    // Required, read-only, and nothing submitted for it: still accepted.
    const res = await signAs(`/api/sign/${links.s1}`, { sig: { kind: 'image', data: IMG }, ro: 'Tampered Ltd' });
    expect(res.status).toBe(200);
    const responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s1.values.ro).toBe('Acme Inc');
  });

  it('a read-only checkbox keeps its sender state', async () => {
    const links = await sync(snapshot([
      { id: 'box', signerId: 's1', type: 'checkbox', page: 0, x: 0.1, y: 0.4, w: 0.03, h: 0.03, required: true, readOnly: true, preset: true },
    ]));
    const res = await signAs(`/api/sign/${links.s1}`, { sig: { kind: 'image', data: IMG }, box: false });
    expect(res.status).toBe(200);
    const responses = await (await worker.call('GET', '/admin/responses', { headers: auth })).json();
    expect(responses.docs.d1.s1.values.box).toBe(true);
  });

  it('drops a bogus input type and an over-long label rather than trusting them', async () => {
    const links = await sync(snapshot([
      textField({ inputType: 'sql', label: 'x'.repeat(400), help: 'y'.repeat(400) }),
    ]));
    const data = await (await worker.call('GET', `/api/sign/${links.s1}`)).json();
    const txt = data.fields.find((f) => f.id === 'txt');
    expect(txt.inputType).toBe('text');
    expect(txt.label).toHaveLength(100);
    expect(txt.help).toHaveLength(200);
  });
});
