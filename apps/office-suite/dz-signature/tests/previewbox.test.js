/**
 * The read-only field boxes on a sent document's page preview (views/detail).
 * They carry role=img, which makes everything inside them presentational: the
 * label is the whole of what a screen reader gets.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/pdfdoc.js', () => ({
  openPdf: async () => ({}),
  pagePoints: async () => ({ w: 612, h: 792 }),
  pageAspect: async () => 792 / 612,
  renderPage: async () => ({}),
}));

const { staticFieldBox } = await import('../src/ui/pages.js');

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const doc = { signers: [{ id: 's1', name: 'Ava Chen', email: 'ava@example.com' }] };
const field = (over = {}) => ({
  id: 'f1', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.04, ...over,
});
const label = (node) => node.getAttribute('aria-label');

describe('a filled preview box', () => {
  it('announces the value that is drawn in it', () => {
    const node = staticFieldBox(field({ label: 'Company name' }), doc, 'Acme Inc');
    expect(node.querySelector('.fb-text').textContent).toBe('Acme Inc');
    expect(label(node)).toBe('Company name for Ava Chen: Acme Inc');
  });

  it('says a signature is signed and a box is ticked', () => {
    expect(label(staticFieldBox(field({ type: 'signature' }), doc, { kind: 'image', data: IMG })))
      .toBe('Signature for Ava Chen, signed');
    expect(label(staticFieldBox(field({ type: 'checkbox' }), doc, true)))
      .toBe('Checkbox for Ava Chen, ticked');
  });
});

describe('an empty preview box', () => {
  it('uses the sender\'s own label, the same one it shows', () => {
    const node = staticFieldBox(field({ label: 'Company name' }), doc, undefined);
    expect(node.querySelector('.fb-label').textContent).toBe('Company name');
    expect(label(node)).toBe('Company name for Ava Chen');
  });

  it('falls back to the field type when there is no label', () => {
    expect(label(staticFieldBox(field(), doc, ''))).toBe('Text for Ava Chen');
    // An unticked box is not a value, so it reads as still empty.
    expect(label(staticFieldBox(field({ type: 'checkbox' }), doc, false)))
      .toBe('Checkbox for Ava Chen');
  });

  it('still names a signer the document no longer has', () => {
    expect(label(staticFieldBox(field({ signerId: 'gone' }), doc, 'x')))
      .toBe('Text for signer: x');
  });
});
