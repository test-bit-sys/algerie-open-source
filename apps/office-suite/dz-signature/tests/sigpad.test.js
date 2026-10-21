/**
 * The signature pad's lifecycle. The Draw pane observes its own canvas so a
 * rotated phone re-measures the pad; that observer has to go when the pane
 * or the dialog does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const observers = [];

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.live = true;
    observers.push(this);
  }
  observe(target) { this.targets.push(target); }
  unobserve(target) { this.targets = this.targets.filter((t) => t !== target); }
  disconnect() { this.live = false; this.targets = []; }
}

const { openSignaturePad } = await import('../src/ui/sigpad.js');

const last = (selector) => [...document.querySelectorAll(selector)].pop() || null;
const tab = (name) => [...document.querySelectorAll('.sigpad-tabs button')]
  .filter((b) => b.textContent === name).pop();
const live = () => observers.filter((o) => o.live);
// A closing dialog is only removed from the DOM after its animation, so a
// stack of them can be on screen at once; always act on the newest.
const dismiss = () => last('.modal-root:not(.closing) .modal-scrim').click();

beforeEach(() => {
  document.body.replaceChildren();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // The pad measures its canvas on the next frame. jsdom paints nothing and
  // ships no 2d context, and none of this is about measurement.
  vi.stubGlobal('requestAnimationFrame', () => 0);
});
afterEach(() => vi.unstubAllGlobals());

describe('the signature pad', () => {
  it('watches the drawing canvas it is showing', () => {
    openSignaturePad({});
    expect(live()).toHaveLength(1);
    expect(live()[0].targets[0]).toBe(last('.sigpad-canvas'));
  });

  it('stops watching a pane it has switched away from', () => {
    openSignaturePad({});
    tab('Type').click();
    expect(document.querySelector('.sigpad-canvas')).toBeNull();
    expect(live()).toHaveLength(0);
    // Back to Draw: one observer again, on the new canvas.
    tab('Draw').click();
    expect(live()).toHaveLength(1);
    expect(live()[0].targets[0]).toBe(last('.sigpad-canvas'));
  });

  it('leaves nothing behind when the dialog closes', async () => {
    const pending = openSignaturePad({});
    expect(live()).toHaveLength(1);
    dismiss();
    expect(live()).toHaveLength(0);
    await expect(pending).resolves.toBeNull();
  });

  it('accumulates nothing across a signing session', () => {
    // One dialog per signature field: a document with initials on every page
    // opens this many times.
    for (let i = 0; i < 5; i++) {
      openSignaturePad({});
      dismiss();
    }
    expect(observers).toHaveLength(5);
    expect(live()).toHaveLength(0);
  });

  it('offers the saved signature first when there is one', () => {
    openSignaturePad({ saved: 'data:image/png;base64,iVBORw0KGgo=' });
    expect([...document.querySelectorAll('.sigpad-tabs button')].map((b) => b.textContent))
      .toEqual(['Saved', 'Draw', 'Type', 'Upload']);
    // The saved pane draws no canvas, so nothing is observed.
    expect(live()).toHaveLength(0);
  });
});
