import { describe, it, expect } from 'vitest';
import {
  makeField, clampField, defaultRect, toPdfRect, isFieldComplete, missingRequired,
  deriveStatus, signerColor, signerProgress, auditLabel, sendChannel, MIN_FIELD,
} from '../src/lib/model.js';

describe('field geometry', () => {
  it('creates fields centered on the tap point', () => {
    const f = makeField({ type: 'signature', page: 0, x: 0.5, y: 0.5, signerId: 's1' });
    const { w, h } = defaultRect('signature');
    expect(f.x).toBeCloseTo(0.5 - w / 2);
    expect(f.y).toBeCloseTo(0.5 - h / 2);
    expect(f.page).toBe(0);
    expect(f.signerId).toBe('s1');
    expect(f.required).toBe(true);
  });

  it('checkbox fields default to optional', () => {
    const f = makeField({ type: 'checkbox', page: 0, x: 0.5, y: 0.5, signerId: 's1' });
    expect(f.required).toBe(false);
  });

  it('clamps fields fully inside the page', () => {
    const f = makeField({ type: 'signature', page: 0, x: 0.99, y: 0.01, signerId: 's1' });
    expect(f.x + f.w).toBeLessThanOrEqual(1);
    expect(f.y).toBeGreaterThanOrEqual(0);
  });

  it('clamps size to the minimum', () => {
    const f = clampField({ x: 0.1, y: 0.1, w: 0.001, h: 0.001 });
    expect(f.w).toBe(MIN_FIELD.w);
    expect(f.h).toBe(MIN_FIELD.h);
  });

  it('converts to PDF points with a flipped y axis', () => {
    // A field at the TOP of the page must land near pageH in PDF space.
    const rect = toPdfRect({ x: 0.1, y: 0, w: 0.5, h: 0.1 }, 600, 800);
    expect(rect.x).toBeCloseTo(60);
    expect(rect.y).toBeCloseTo(720); // (1 - 0 - 0.1) * 800
    expect(rect.w).toBeCloseTo(300);
    expect(rect.h).toBeCloseTo(80);
  });
});

describe('field completion', () => {
  const sig = { type: 'signature', required: true };
  const text = { type: 'text', required: true };
  const box = { type: 'checkbox', required: false };

  it('signature fields need an image value', () => {
    expect(isFieldComplete(sig, undefined)).toBe(false);
    expect(isFieldComplete(sig, 'Alice')).toBe(false);
    expect(isFieldComplete(sig, { kind: 'image', data: 'data:image/png;base64,AAA' })).toBe(true);
    expect(isFieldComplete(sig, { kind: 'image', data: 'https://evil.example/x.png' })).toBe(false);
  });

  it('text fields need non-blank text', () => {
    expect(isFieldComplete(text, '   ')).toBe(false);
    expect(isFieldComplete(text, 'hello')).toBe(true);
  });

  it('optional checkboxes are always complete; required ones need a tick', () => {
    expect(isFieldComplete(box, undefined)).toBe(true);
    expect(isFieldComplete({ ...box, required: true }, false)).toBe(false);
    expect(isFieldComplete({ ...box, required: true }, true)).toBe(true);
  });

  it('missingRequired reports only my incomplete required fields', () => {
    const fields = [
      { id: 'a', type: 'text', required: true, signerId: 'me' },
      { id: 'b', type: 'text', required: false, signerId: 'me' },
      { id: 'c', type: 'text', required: true, signerId: 'other' },
    ];
    expect(missingRequired(fields, {}, 'me').map((f) => f.id)).toEqual(['a']);
    expect(missingRequired(fields, { a: 'done' }, 'me')).toEqual([]);
  });
});

describe('document status', () => {
  const doc = (signers, status = 'sent') => ({ status, signers });

  it('any decline wins', () => {
    expect(deriveStatus(doc([{ status: 'signed' }, { status: 'declined' }]))).toBe('declined');
  });

  it('completes when everyone signed', () => {
    expect(deriveStatus(doc([{ status: 'signed' }, { status: 'signed' }]))).toBe('completed');
  });

  it('stays sent while anyone is pending', () => {
    expect(deriveStatus(doc([{ status: 'signed' }, { status: 'viewed' }]))).toBe('sent');
  });

  it('a draft never auto-completes', () => {
    expect(deriveStatus(doc([{ status: 'signed' }], 'draft'))).toBe('draft');
  });

  it('voided is terminal', () => {
    expect(deriveStatus(doc([{ status: 'signed' }], 'voided'))).toBe('voided');
  });
});

describe('signer helpers', () => {
  it('colors follow signer order and wrap after six', () => {
    const signers = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}` }));
    expect(signerColor(signers[0], signers)).toBe(1);
    expect(signerColor(signers[5], signers)).toBe(6);
    expect(signerColor(signers[6], signers)).toBe(1);
  });

  it('progress counts signed signers', () => {
    expect(signerProgress({ signers: [{ status: 'signed' }, { status: 'viewed' }] }))
      .toEqual({ signed: 1, total: 2 });
  });

  it('audit labels read as sentences', () => {
    expect(auditLabel({ type: 'signed', detail: 'Ava' })).toBe('Signed by Ava');
    expect(auditLabel({ type: 'completed' })).toMatch(/^Completed/);
  });

  it('knows how the links went out: the recorded choice, else what was emailed', () => {
    expect(sendChannel({ channel: 'email' })).toBe('email');
    expect(sendChannel({ channel: 'link', emailed: { 'a:request': { at: 1 } } })).toBe('link');
    expect(sendChannel({ emailed: { 'a:request': { at: 1 } } })).toBe('email');
    // A reminder or a completion notice is not a request; nothing is unknown.
    expect(sendChannel({ emailed: { 'a:reminder': { at: 1 } } })).toBe('');
    expect(sendChannel({})).toBe('');
    expect(sendChannel({ channel: 'fax' })).toBe('');
  });
});
