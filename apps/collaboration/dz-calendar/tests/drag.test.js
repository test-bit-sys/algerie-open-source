import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { draggable } from '../src/js/drag.js';

const pointer = (type, target, { x = 0, y = 0, pointerId = 1, pointerType = 'mouse', button = 0 } = {}) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
  return e;
};

describe('draggable', () => {
  let handle;
  let hooks;

  beforeEach(() => {
    handle = document.createElement('div');
    document.body.append(handle);
    hooks = { onStart: vi.fn(), onMove: vi.fn(), onDrop: vi.fn(), onCancel: vi.fn() };
    draggable(handle, hooks);
  });
  afterEach(() => {
    document.body.replaceChildren();
    document.body.classList.remove('is-dragging');
  });

  it('starts a drag once the pointer travels past the threshold', () => {
    pointer('pointerdown', handle, { x: 10, y: 10 });
    pointer('pointermove', window, { x: 30, y: 30 });
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('is-dragging')).toBe(true);
    pointer('pointerup', window, { x: 30, y: 30 });
    expect(hooks.onDrop).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('is-dragging')).toBe(false);
  });

  it('does not start a drag from a handle a re-render has since detached', () => {
    // Pressed, then the view was rebuilt (a store change, the minute tick)
    // before the pointer moved far enough to count as a drag. The node the
    // press landed on is gone from the document; measuring a drag from it
    // would commit a move hours from where the pointer is.
    pointer('pointerdown', handle, { x: 10, y: 10 });
    handle.remove();
    pointer('pointermove', window, { x: 30, y: 30 });
    expect(hooks.onStart).not.toHaveBeenCalled();
    expect(document.body.classList.contains('is-dragging')).toBe(false);
    // The gesture was released, not left half-tracked: the release commits
    // nothing, and a fresh press on a live handle works as usual.
    pointer('pointerup', window, { x: 30, y: 30 });
    expect(hooks.onDrop).not.toHaveBeenCalled();
    expect(hooks.onCancel).not.toHaveBeenCalled();
    document.body.append(handle);
    pointer('pointerdown', handle, { x: 10, y: 10 });
    pointer('pointermove', window, { x: 40, y: 40 });
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    pointer('pointerup', window, { x: 40, y: 40 });
  });

  it('does not start a touch drag whose handle was detached during the hold', () => {
    vi.useFakeTimers();
    try {
      pointer('pointerdown', handle, { x: 10, y: 10, pointerType: 'touch' });
      handle.remove();
      vi.advanceTimersByTime(1000); // past the long-press hold
      expect(hooks.onStart).not.toHaveBeenCalled();
      expect(document.body.classList.contains('is-dragging')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
