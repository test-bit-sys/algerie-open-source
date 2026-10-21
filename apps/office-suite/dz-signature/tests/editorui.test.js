/**
 * The field editor's selection, driven through real pointer events: the
 * geometry helpers are covered in fieldtools.test.js, but which fields stay
 * selected through a gesture is decided by the DOM handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// pdf.js needs browser globals jsdom does not have, and none of this is about
// rendering: the editor only ever asks pages.js for frames and overlays.
vi.mock('../src/lib/pdfdoc.js', () => ({
  openPdf: async () => ({}),
  pagePoints: async () => ({ w: 612, h: 792 }),
  pageAspect: async () => 792 / 612,
  renderPage: async () => ({ width: 612, height: 792 }),
}));

const { mountFieldEditor } = await import('../src/ui/fieldeditor.js');

/** A pointer event jsdom will dispatch (it ships no PointerEvent). */
function pointer(node, type, opts = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...opts });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  node.dispatchEvent(event);
  return event;
}

const field = (over = {}) => ({
  id: 'f1', type: 'text', page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.04,
  signerId: 's1', required: true, ...over,
});

function mount(over = {}) {
  const doc = {
    id: 'd1',
    pageCount: 1,
    signers: [{ id: 's1', name: 'Ava' }],
    fields: [field(), field({ id: 'f2', x: 0.5, y: 0.5 })],
  };
  const container = document.createElement('div');
  document.body.append(container);
  let announced = [];
  const editor = mountFieldEditor({
    container,
    pdf: {},
    doc,
    onChange: () => {},
    onSelect: (list) => { announced = list.map((f) => f.id); },
    ...over,
  });
  return {
    doc,
    editor,
    container,
    frame: () => container.querySelector('.page-frame'),
    box: (id) => container.querySelector(`[data-fid="${id}"]`),
    ids: () => editor.selectedFields.map((f) => f.id).sort(),
    announced: () => announced,
  };
}

beforeEach(() => {
  // A synthetic pointer cannot be captured, and the throw would abort the drag.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  // jsdom lays nothing out, and the editor turns pointer pixels into page
  // fractions by dividing by the frame's box: a zero-width one makes every
  // gesture land at infinity.
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
  });
  document.body.replaceChildren();
});

describe('selecting fields', () => {
  it('selects one field on a plain click', () => {
    const ui = mount();
    pointer(ui.box('f1'), 'pointerdown');
    pointer(ui.box('f1'), 'pointerup');
    expect(ui.ids()).toEqual(['f1']);
    expect(ui.announced()).toEqual(['f1']);
    expect(ui.box('f1').classList.contains('selected')).toBe(true);
  });

  it('builds a group with shift-click and keeps it once the pointer lifts', () => {
    const ui = mount();
    pointer(ui.box('f1'), 'pointerdown');
    pointer(ui.box('f1'), 'pointerup');
    pointer(ui.box('f2'), 'pointerdown', { shiftKey: true });
    pointer(ui.box('f2'), 'pointerup', { shiftKey: true });
    expect(ui.ids()).toEqual(['f1', 'f2']);
    expect(ui.box('f1').classList.contains('selected')).toBe(true);
    expect(ui.box('f2').classList.contains('primary')).toBe(true);
  });

  it('drops a field back out of the group when it is shift-clicked again', () => {
    const ui = mount();
    pointer(ui.box('f1'), 'pointerdown');
    pointer(ui.box('f1'), 'pointerup');
    pointer(ui.box('f2'), 'pointerdown', { shiftKey: true });
    pointer(ui.box('f2'), 'pointerup', { shiftKey: true });
    pointer(ui.box('f2'), 'pointerdown', { shiftKey: true });
    pointer(ui.box('f2'), 'pointerup', { shiftKey: true });
    expect(ui.ids()).toEqual(['f1']);
  });

  it('keeps the whole group selected after dragging it', () => {
    const ui = mount();
    ui.editor.selectMany(['f1', 'f2']);
    pointer(ui.box('f1'), 'pointerdown', { clientX: 10, clientY: 10 });
    pointer(ui.box('f1'), 'pointermove', { clientX: 40, clientY: 40 });
    pointer(ui.box('f1'), 'pointerup', { clientX: 40, clientY: 40 });
    // 30px across a 100px frame moves both by the same 0.3 of the page.
    expect(ui.doc.fields.map((f) => f.x)).toEqual([0.4, 0.8]);
    expect(ui.ids()).toEqual(['f1', 'f2']);
    // Announced primary first, which is the reference for align and match.
    expect(ui.announced()).toEqual(['f2', 'f1']);
    // Both boxes still show the ring after the rebuild the drag ends with.
    expect(ui.box('f1').classList.contains('selected')).toBe(true);
    expect(ui.box('f2').classList.contains('selected')).toBe(true);
  });

  it('narrows a group to the one field a click lands on', () => {
    const ui = mount();
    ui.editor.selectMany(['f1', 'f2']);
    pointer(ui.box('f1'), 'pointerdown', { clientX: 10, clientY: 10 });
    pointer(ui.box('f1'), 'pointerup', { clientX: 10, clientY: 10 });
    expect(ui.ids()).toEqual(['f1']);
    expect(ui.box('f2').classList.contains('selected')).toBe(false);
  });

  it('nudges by a bigger step with shift or alt held', () => {
    const ui = mount();
    const nudge = (opts) => ui.box('f1').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, ...opts }));
    ui.editor.select('f1');
    nudge({});
    expect(ui.doc.fields[0].x).toBeCloseTo(0.105);
    nudge({ shiftKey: true });
    expect(ui.doc.fields[0].x).toBeCloseTo(0.125);
    nudge({ altKey: true });
    expect(ui.doc.fields[0].x).toBeCloseTo(0.145);
  });

  it('keeps the named reference when a group action re-selects the same fields', () => {
    const ui = mount();
    // What a shift-click builds: f2 was touched last, so it is the reference
    // the toolbar's align and match-size actions line the group up on.
    ui.editor.selectMany(['f1', 'f2']);
    expect(ui.announced()).toEqual(['f2', 'f1']);
    // The toolbar re-selects the same group after acting on it. Without the
    // primary carried over, the reference drifted to the other field, so
    // "align left" and then "same size" used two different references.
    ui.editor.selectMany(['f2', 'f1'], { primary: 'f2' });
    expect(ui.announced()).toEqual(['f2', 'f1']);
    expect(ui.box('f2').classList.contains('primary')).toBe(true);
    expect(ui.box('f1').classList.contains('primary')).toBe(false);
  });

  it('falls back to the last id when the named reference is not in the group', () => {
    const ui = mount();
    ui.editor.selectMany(['f1', 'f2'], { primary: 'gone' });
    expect(ui.announced()).toEqual(['f2', 'f1']);
  });

  it('keeps the ring on every member while the group is nudged with the keyboard', () => {
    const ui = mount();
    ui.editor.selectMany(['f1', 'f2']);
    const before = ui.doc.fields.map((f) => f.x);
    ui.box('f1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(ui.doc.fields.map((f) => f.x)).not.toEqual(before);
    expect(ui.ids()).toEqual(['f1', 'f2']);
    expect(ui.box('f1').classList.contains('selected')).toBe(true);
    expect(ui.box('f2').classList.contains('selected')).toBe(true);
  });
});

describe('placing a field', () => {
  it('drops one where the page was tapped', () => {
    const ui = mount({ getArmed: () => 'signature', getSigner: () => 's1' });
    pointer(ui.frame(), 'pointerdown', { clientX: 30, clientY: 30 });
    pointer(ui.frame(), 'pointerup', { clientX: 30, clientY: 30 });
    expect(ui.doc.fields).toHaveLength(3);
    expect(ui.doc.fields[2].type).toBe('signature');
  });

  it('places nothing when the document has no room left', () => {
    const ui = mount({ getArmed: () => 'signature', getSigner: () => 's1', canPlace: () => false });
    ui.editor.selectMany(['f1']);
    pointer(ui.frame(), 'pointerdown', { clientX: 30, clientY: 30 });
    pointer(ui.frame(), 'pointerup', { clientX: 30, clientY: 30 });
    expect(ui.doc.fields).toHaveLength(2);
    // The tap still lands on the page, so it clears the selection.
    expect(ui.ids()).toEqual([]);
  });
});
