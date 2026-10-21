import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../src/js/app.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/**
 * The minute tick keeps the now-line and the "today" highlight honest. It used
 * to skip any tick with focus inside the sidebar or the view, which froze the
 * clock indefinitely in the ordinary case: closing an event's details card
 * returns focus to its chip and leaves it there. render() can hand focus to the
 * rebuilt counterpart of anything carrying a data-focus-key, so those ticks run
 * — and only a focused control it could NOT restore still holds the tick off.
 */

function makeStore(events, view = 'month') {
  const settings = { ...DEFAULT_SETTINGS, defaultView: view };
  const listeners = new Set();
  return {
    getSettings: () => ({ ...settings }),
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    getAllEvents: () => events,
    getEventsInRange: (from, to) => events.filter((e) => e.start < to && e.end > from),
    getAllTasks: () => [],
    getTasksInRange: () => [],
    getTask: () => null,
    getEvent: (id) => events.find((e) => e.id === id) || null,
    saveSettings: async (patch) => (Object.assign(settings, patch), { ...settings }),
    saveEvent: async (e) => e,
    toggleTask: async () => {},
  };
}

const dayAt = (h) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 15, h, 0).getTime();
};

describe('app — the minute tick and keyboard focus', () => {
  let app;
  let root;

  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    const events = [
      { id: 'e1', title: 'Standup', start: dayAt(9), end: dayAt(10), allDay: false, color: 'blue', reminders: [] },
    ];
    root = document.createElement('div');
    root.className = 'app-root';
    document.body.append(root);
    app = createApp(root, { store: makeStore(events), user: { username: 'x' } });
  });

  afterEach(() => {
    if (app) app.destroy();
    app = null;
    vi.useRealTimers();
    delete document.documentElement.dataset.theme;
    document.querySelectorAll('.app-root, .toast, .ctx-menu').forEach((n) => n.remove());
  });

  it('re-renders under a focused event chip and hands focus back', () => {
    const chip = root.querySelector('.chip');
    chip.focus();
    expect(document.activeElement).toBe(chip);

    vi.advanceTimersByTime(60_000);

    const fresh = root.querySelector('.chip');
    expect(fresh).not.toBe(chip); // the view really was rebuilt
    expect(document.activeElement).toBe(fresh); // …and focus followed it
    expect(document.activeElement.dataset.focusKey).toBe('ev:e1');
  });

  it('re-renders under a focused sidebar control and hands focus back', () => {
    const prev = root.querySelector('[data-focus-key="mini-prev"]');
    prev.focus();

    vi.advanceTimersByTime(60_000);

    const fresh = root.querySelector('[data-focus-key="mini-prev"]');
    expect(fresh).not.toBe(prev);
    expect(document.activeElement).toBe(fresh);
  });

  it('still waits out a focused control it could not restore', () => {
    // The day-number button carries no focus key, so a rebuild would drop the
    // user's focus to <body>; the tick leaves it alone instead.
    const dayNum = root.querySelector('.month__daynum');
    expect(dayNum.getAttribute('data-focus-key')).toBe(null);
    dayNum.focus();

    vi.advanceTimersByTime(60_000);

    expect(root.querySelector('.month__daynum')).toBe(dayNum); // no re-render
    expect(document.activeElement).toBe(dayNum);
  });

  it('leaves focus alone when it lives outside the rebuilt regions', () => {
    const avatar = root.querySelector('.avatar');
    avatar.focus();

    vi.advanceTimersByTime(60_000);

    expect(document.activeElement).toBe(avatar);
  });
});
