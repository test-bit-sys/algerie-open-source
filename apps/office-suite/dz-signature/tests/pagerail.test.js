/**
 * The page rail. Its thumbnails are jump buttons, not tabs: what they mark is
 * which page is being looked at, and the mark has to move with it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/pdfdoc.js', () => ({
  openPdf: async () => ({}),
  pagePoints: async () => ({ w: 612, h: 792 }),
  pageAspect: async () => 792 / 612,
  renderPage: async () => ({}),
}));

const { pageRail } = await import('../src/ui/pagerail.js');

function mount(over = {}) {
  const jumps = [];
  const rail = pageRail({ pdf: {}, pageCount: 4, onJump: (i) => jumps.push(i), ...over });
  document.body.append(rail);
  return {
    rail,
    jumps,
    buttons: () => [...rail.querySelectorAll('.rail-jump')],
    current: () => rail.querySelectorAll('[aria-current="page"]').length,
    currentIndex: () => [...rail.querySelectorAll('.rail-jump')]
      .findIndex((b) => b.getAttribute('aria-current') === 'page'),
  };
}

beforeEach(() => document.body.replaceChildren());

describe('the page strip', () => {
  it('promises no keyboard model it does not have', () => {
    const ui = mount();
    // role="tab" inside role="tablist" tells a screen reader "tab 3 of 4" and
    // tells the user to try the arrow keys; nothing here handles them.
    expect(ui.rail.querySelector('[role="tablist"]')).toBeNull();
    expect(ui.rail.querySelector('[role="tab"]')).toBeNull();
    expect(ui.rail.querySelector('[aria-selected]')).toBeNull();
    expect(ui.rail.querySelector('.rail-strip').getAttribute('role')).toBe('group');
  });

  it('marks exactly one page as the current one, and moves the mark', () => {
    const ui = mount();
    expect(ui.current()).toBe(1);
    expect(ui.currentIndex()).toBe(0);
    ui.rail.setActive(2);
    expect(ui.current()).toBe(1);
    expect(ui.currentIndex()).toBe(2);
    expect(ui.rail.querySelectorAll('.rail-item.active')).toHaveLength(1);
  });

  it('clamps an index the document does not have', () => {
    const ui = mount();
    ui.rail.setActive(99);
    expect(ui.currentIndex()).toBe(3);
    ui.rail.setActive(-5);
    expect(ui.currentIndex()).toBe(0);
  });

  it('jumps to the page whose thumbnail was pressed', () => {
    const ui = mount();
    ui.buttons()[2].click();
    expect(ui.jumps).toEqual([2]);
    expect(ui.buttons()[2].getAttribute('aria-label')).toBe('Go to page 3');
  });

  it('offers page fixes only on an editable rail', () => {
    expect(mount().rail.querySelectorAll('.rail-tools')).toHaveLength(0);
    document.body.replaceChildren();
    const editable = mount({ editable: true, onPlan: () => {} });
    expect(editable.rail.querySelectorAll('.rail-tools')).toHaveLength(4);
  });
});
