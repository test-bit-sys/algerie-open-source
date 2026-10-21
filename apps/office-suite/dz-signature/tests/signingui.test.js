/**
 * The fill-and-sign surface, as a signer's browser builds it. What each box
 * shows comes from the fields the sign worker (or selfsign.js) hands over,
 * with the value already resolved.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/pdfdoc.js', () => ({
  openPdf: async () => ({}),
  pagePoints: async () => ({ w: 612, h: 792 }),
  pageAspect: async () => 792 / 612,
  renderPage: async () => ({ width: 612, height: 792 }),
}));

const { mountSigning } = await import('../src/ui/signing.js');

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

const field = (over = {}) => ({
  id: 'f1', type: 'text', page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.04,
  required: true, mine: false, ...over,
});

function mount(fields, extra = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const api = mountSigning({
    container,
    pdf: {},
    data: { title: 'NDA', pageCount: 1, fields },
    ...extra,
  });
  return { container, api, texts: () => [...container.querySelectorAll('.fb-text')].map((n) => n.textContent) };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('what a signer is shown', () => {
  it("shows a co-signer's answer instead of an empty box", () => {
    const ui = mount([
      field({ id: 'a', signerName: 'Bo', value: 'Bo Chen' }),
      field({ id: 'b', type: 'signature', y: 0.3, signerName: 'Bo', value: { kind: 'image', data: IMG } }),
      field({ id: 'c', type: 'checkbox', y: 0.5, signerName: 'Bo', value: true }),
    ]);
    expect(ui.texts()).toContain('Bo Chen');
    expect(ui.container.querySelector('img')?.getAttribute('src')).toBe(IMG);
    expect(ui.container.querySelectorAll('.field-box.filled')).toHaveLength(3);
    // role=img boxes say their value, or a screen reader gets nothing at all.
    expect([...ui.container.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label')))
      .toContain('Text for Bo: Bo Chen');
  });

  it('shows my own read-only field filled in, and never asks me for it', () => {
    let progress = null;
    const ui = mount([
      field({ id: 'a', mine: true, readOnly: true, label: 'Company', value: 'Acme Inc' }),
    ], { onProgress: (p) => { progress = p; } });
    expect(ui.texts()).toContain('Acme Inc');
    // Read-only work is not the signer's: nothing is owed, and nothing of it
    // is submitted.
    expect(progress).toMatchObject({ done: 0, total: 0, complete: true });
    expect(ui.api.getValues()).toEqual({});
  });

  it('still labels an empty field with whose it is', () => {
    const ui = mount([field({ id: 'a', signerName: 'Bo' })]);
    expect(ui.texts()).toEqual([]);
    expect(ui.container.querySelector('.field-box').getAttribute('aria-label')).toBe('Text for Bo');
  });

  it('keeps my own fields interactive, prefilled with what the sender put there', () => {
    const ui = mount([
      field({ id: 'a', mine: true, label: 'Full name', value: 'Ava Ray' }),
      field({ id: 'b', type: 'signature', y: 0.4, mine: true }),
    ]);
    const input = ui.container.querySelector('input.fb-input');
    expect(input.value).toBe('Ava Ray');
    expect(ui.api.getValues().a).toBe('Ava Ray');
    // The signature is still owed, so finishing is not complete yet.
    expect(ui.api.isComplete()).toBe(false);
  });
});

describe('walking to the field that still needs attention', () => {
  it('puts the keyboard in it, whatever kind of box it is', () => {
    const ui = mount([
      field({ id: 'a', mine: true, label: 'Full name' }),
      field({ id: 'b', type: 'signature', y: 0.4, mine: true }),
    ]);
    // A signature box IS the button, but a text box is a div wrapping the
    // input: focusing the wrapper does nothing, which left the signer
    // scrolled to the field and still hunting for it.
    ui.api.focusFirstIncomplete();
    expect(document.activeElement).toBe(ui.container.querySelector('input.fb-input'));

    ui.container.querySelector('input.fb-input').value = 'Ava Ray';
    ui.container.querySelector('input.fb-input').dispatchEvent(new Event('input', { bubbles: true }));
    ui.api.focusFirstIncomplete();
    expect(document.activeElement).toBe(ui.container.querySelector('button.field-box'));
  });

  it('walks to a checkbox nobody ticked', () => {
    const ui = mount([field({ id: 'a', type: 'checkbox', mine: true, required: true })]);
    ui.api.focusFirstIncomplete();
    expect(document.activeElement).toBe(ui.container.querySelector('input.fb-check'));
  });

  it('does nothing when everything is answered', () => {
    const ui = mount([field({ id: 'a', mine: true, value: 'Ava Ray' })]);
    document.body.focus();
    const before = document.activeElement;
    ui.api.focusFirstIncomplete();
    expect(document.activeElement).toBe(before);
  });
});
