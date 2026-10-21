import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toast } from '../src/js/toast.js';

/** The toast dismisses by animating out; jsdom fires no animationend, so a
 *  dismissed toast is the one carrying the leaving class. */
const leaving = () => [...document.querySelectorAll('.toast')].filter((n) => n.classList.contains('is-leaving'));
const live = () => [...document.querySelectorAll('.toast')].filter((n) => !n.classList.contains('is-leaving'));

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a plain notice leaves after four seconds', () => {
    toast('Saved');
    vi.advanceTimersByTime(3_999);
    expect(live()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(leaving()).toHaveLength(1);
  });

  it('a toast with something to do stays twice as long', () => {
    // Undo is the only way back from every destructive action; 4 s is enough
    // to read it, not to reach it — least of all by keyboard.
    toast('Event deleted', { action: { label: 'Undo', onClick() {} } });
    vi.advanceTimersByTime(4_000);
    expect(live()).toHaveLength(1);
    vi.advanceTimersByTime(3_999);
    expect(live()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(leaving()).toHaveLength(1);
  });

  it('an explicit duration is honoured either way', () => {
    toast('Quick', { duration: 1_000, action: { label: 'Undo', onClick() {} } });
    vi.advanceTimersByTime(1_000);
    expect(leaving()).toHaveLength(1);
  });

  it('waits while the pointer or focus is on it, then resumes with the time that was left', () => {
    toast('Event deleted', { action: { label: 'Undo', onClick() {} } });
    const node = document.querySelector('.toast');
    vi.advanceTimersByTime(3_000);
    node.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(60_000); // read it at leisure
    expect(live()).toHaveLength(1);
    node.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(4_999); // 8 s − 3 s already spent
    expect(live()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(leaving()).toHaveLength(1);

    // Focus holds it the same way; leaving right at the end still leaves a moment.
    toast('Task deleted', { action: { label: 'Undo', onClick() {} } });
    const second = live()[0];
    vi.advanceTimersByTime(7_900);
    second.dispatchEvent(new FocusEvent('focusin'));
    vi.advanceTimersByTime(10_000);
    expect(live()).toHaveLength(1);
    second.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body }));
    vi.advanceTimersByTime(1_000);
    expect(live()).toHaveLength(1); // not the 100 ms that were left
    vi.advanceTimersByTime(500);
    expect(live()).toHaveLength(0);
  });

  it('the action dismisses the toast and runs', () => {
    const onClick = vi.fn();
    toast('Event deleted', { action: { label: 'Undo', onClick } });
    document.querySelector('.toast__action').click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(leaving()).toHaveLength(1);
    vi.advanceTimersByTime(10_000); // no second dismissal, no error
  });
});
