/**
 * The documents list, driven through real events. The row is itself a
 * `role="button"` and the per-row action menu lives inside it, so the two
 * compete for the same keys — which is what these cover.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const docs = [];
const events = new EventTarget();

vi.mock('../src/lib/store.js', () => ({
  store: {
    listDocs: () => docs,
    addEventListener: (...a) => events.addEventListener(...a),
    removeEventListener: (...a) => events.removeEventListener(...a),
    get settings() { return {}; },
    get user() { return {}; },
  },
}));

const { documentsView } = await import('../src/views/documents.js');

const sentDoc = (over = {}) => ({
  id: 'd1',
  title: 'NDA',
  status: 'sent',
  pageCount: 1,
  updatedAt: Date.now(),
  signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', status: 'pending' }],
  fields: [],
  links: {},
  audit: [],
  ...over,
});

function mount() {
  const navigated = [];
  const root = documentsView({ navigate: (hash) => navigated.push(hash) });
  document.body.append(root);
  return {
    root,
    navigated,
    row: () => root.querySelector('.doc-row'),
    trigger: () => root.querySelector('[data-menu-for="d1"]'),
    items: () => [...root.querySelectorAll('.menu-item')],
  };
}

function key(node, k) {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.replaceChildren();
  docs.length = 0;
  docs.push(sentDoc());
});

describe('the row action menu', () => {
  it('opens with focus on its first item', () => {
    const ui = mount();
    ui.trigger().click();
    expect(ui.items().length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(ui.items()[0]);
    expect(ui.trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('lets the keyboard activate an item instead of opening the document', () => {
    const ui = mount();
    ui.trigger().click();
    // The menu sits inside a row that claims Enter and Space for itself.
    // Claiming them here too cancelled the button's own activation, so the
    // item never ran and the document opened instead.
    for (const k of ['Enter', ' ']) {
      const event = key(ui.items()[0], k);
      expect(event.defaultPrevented).toBe(false);
      expect(ui.navigated).toEqual([]);
    }
  });

  it('still moves between items, and closes on Escape', () => {
    const ui = mount();
    ui.trigger().click();
    const items = ui.items();
    key(items[0], 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(items[1], 'ArrowUp');
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);
    key(document.activeElement, 'Escape');
    expect(ui.items()).toEqual([]);
    expect(document.activeElement).toBe(ui.trigger());
    expect(ui.navigated).toEqual([]);
  });
});

describe('what the menu offers', () => {
  const labels = (ui) => ui.items().map((item) => item.textContent.trim());

  it('matches the document page: a progress copy only once someone has signed', () => {
    let ui = mount();
    ui.trigger().click();
    expect(labels(ui)).not.toContain('Download progress copy');
    document.body.replaceChildren();
    docs[0] = sentDoc({ signers: [{ id: 's1', name: 'Ava', email: 'ava@example.com', status: 'signed' }] });
    ui = mount();
    ui.trigger().click();
    expect(labels(ui)).toContain('Download progress copy');
  });

  it('still offers void on an expired document, which the page does too', () => {
    docs[0] = sentDoc({ status: 'expired', expiresAt: Date.now() - 1000 });
    const ui = mount();
    ui.trigger().click();
    expect(labels(ui)).toContain('Void');
    document.body.replaceChildren();
    docs[0] = sentDoc({ status: 'completed' });
    const done = mount();
    done.trigger().click();
    expect(labels(done)).not.toContain('Void');
    expect(labels(done)).toContain('Download signed copy');
  });
});

describe('the row itself', () => {
  it('still opens on its own Enter and Space', () => {
    const ui = mount();
    const row = ui.row();
    row.focus();
    expect(key(row, 'Enter').defaultPrevented).toBe(true);
    expect(key(row, ' ').defaultPrevented).toBe(true);
    expect(ui.navigated).toEqual(['#/doc/d1', '#/doc/d1']);
  });

  it('sends a draft to the editor and everything else to the detail view', () => {
    docs[0] = sentDoc({ status: 'draft' });
    const ui = mount();
    ui.row().click();
    expect(ui.navigated).toEqual(['#/doc/d1/edit']);
  });
});

describe('the row meta line', () => {
  it('counts down to a deadline, and says expired once it has passed', () => {
    // A hair over five days: the row renders a few ms after this, and the
    // count floors to whole days.
    docs[0] = sentDoc({ expiresAt: Date.now() + 5 * 24 * 60 * 60 * 1000 + 60_000 });
    let ui = mount();
    expect(ui.row().querySelector('.doc-row-meta').textContent).toContain('expires in 5 days');
    document.body.replaceChildren();
    // Status still reads 'sent' until the timer pass (or never, offline):
    // the line must not read "expires expired".
    docs[0] = sentDoc({ expiresAt: Date.now() - 1000 });
    ui = mount();
    const meta = ui.row().querySelector('.doc-row-meta').textContent;
    expect(meta).toContain('expired');
    expect(meta).not.toContain('expires expired');
  });
});
