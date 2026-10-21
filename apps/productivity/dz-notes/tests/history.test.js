import { describe, it, expect } from 'vitest';
import { History, snapshotOf, applySnapshot } from '../src/editor/history.js';

describe('History', () => {
  it('undoes and redoes snapshots in order', () => {
    const h = new History();
    h.reset('a');
    h.push('b');
    h.push('c');
    expect(h.undo().snapshot).toBe('b');
    expect(h.undo().snapshot).toBe('a');
    expect(h.undo()).toBeNull();
    expect(h.redo().snapshot).toBe('b');
  });

  it('drops the redo branch on a new edit', () => {
    const h = new History();
    h.reset('a');
    h.push('b');
    h.undo();
    h.push('x');
    expect(h.canRedo()).toBe(false);
    expect(h.undo().snapshot).toBe('a');
  });

  it('ignores unchanged snapshots and caps its length', () => {
    const h = new History(3);
    h.reset('a');
    expect(h.push('a')).toBe(false);
    for (const s of ['b', 'c', 'd', 'e']) h.push(s);
    expect(h.stack.length).toBe(3);
  });

  it('snapshots only the editable page state', () => {
    const page = { id: 'p', title: 'T', created: 'c', outlines: [{ id: 'o', html: 'x' }], ink: [], color: null, rules: 'college', ruleColor: null };
    const snap = snapshotOf(page);
    page.title = 'Changed';
    page.outlines = [];
    applySnapshot(page, snap);
    expect(page.title).toBe('T');
    expect(page.outlines).toHaveLength(1);
    expect(page.created).toBe('c');
  });
});
