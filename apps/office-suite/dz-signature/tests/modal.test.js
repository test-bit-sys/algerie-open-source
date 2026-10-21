/**
 * The modal's casual ways out (scrim, Escape, the X), and the lock that takes
 * them away for a dialog whose contents exist nowhere else once it is gone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openModal, alertDialog } from '../src/ui/modal.js';
import { el } from '../src/ui/dom.js';

const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren(el('div', { id: 'app' }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a dialog', () => {
  it('closes on Escape, the scrim, and the X', () => {
    for (const way of ['escape', 'scrim', 'x']) {
      const onClose = vi.fn();
      openModal({ title: 'T', content: el('div'), onClose });
      if (way === 'escape') escape();
      if (way === 'scrim') document.querySelector('.modal-scrim').click();
      if (way === 'x') document.querySelector('.modal-head .icon-btn').click();
      expect(onClose).toHaveBeenCalledTimes(1);
      vi.runAllTimers();
      expect(document.querySelector('.modal-root')).toBeNull();
    }
  });

  it('once locked, only its own button closes it', () => {
    const onClose = vi.fn();
    const modal = openModal({ title: 'Codes', content: el('div'), onClose });
    modal.lock();
    escape();
    document.querySelector('.modal-scrim').click();
    // The X is gone rather than a button that does nothing.
    expect(document.querySelector('.modal-head .icon-btn').hidden).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-root')).not.toBeNull();
    modal.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(document.querySelector('.modal-root')).toBeNull();
  });

  it('a sticky alert resolves only from its button', async () => {
    let settled = false;
    const done = alertDialog({ title: 'Share this code', message: 'ABCD', sticky: true }).then(() => { settled = true; });
    escape();
    document.querySelector('.modal-scrim').click();
    await Promise.resolve();
    expect(settled).toBe(false);
    document.querySelector('.modal-panel .btn-primary').click();
    await done;
    expect(settled).toBe(true);
  });
});
