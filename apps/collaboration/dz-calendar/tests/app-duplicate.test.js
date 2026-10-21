import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../src/js/app.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/** Minimal store stand-in (mirrors app-shortcuts.test.js) with one event. */
function makeStore(events, saveEvent) {
  const s = { ...DEFAULT_SETTINGS, defaultView: 'month' };
  const listeners = new Set();
  return {
    getSettings: () => ({ ...s }),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getAllEvents: () => events,
    getEventsInRange: (from, to) => events.filter((e) => e.start < to && e.end > from),
    getAllTasks: () => [],
    getTasksInRange: () => [],
    getTask: () => null,
    getEvent: (id) => events.find((e) => e.id === id) || null,
    saveSettings: async (patch) => (Object.assign(s, patch), { ...s }),
    saveEvent,
    toggleTask: async () => {},
  };
}

describe('app — Duplicate from the context menu', () => {
  let app;

  beforeEach(() => {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  });

  afterEach(() => {
    if (app) app.destroy();
    app = null;
    delete document.documentElement.dataset.theme;
    document.body.replaceChildren();
  });

  it('creates an active copy of a declined event', async () => {
    // Regression: the duplicate spread every field of the source, so copying a
    // declined (dimmed) event minted a brand-new event that was itself
    // declined, even with no out-of-office overlapping it.
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 15, 9, 0).getTime();
    const declined = {
      id: 'e1',
      title: 'Dimmed',
      start,
      end: start + 3_600_000,
      allDay: false,
      color: 'blue',
      declined: true,
      reminders: [],
    };
    const saveEvent = vi.fn(async (e) => e);
    const root = document.createElement('div');
    document.body.append(root);
    app = createApp(root, { store: makeStore([declined], saveEvent), user: { username: 'x' } });

    const chip = document.querySelector('[data-event-id="e1"], .chip');
    expect(chip).toBeTruthy();
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    const item = [...document.querySelectorAll('.ctx-menu__item')].find(
      (n) => n.textContent.trim() === 'Duplicate',
    );
    expect(item).toBeTruthy();
    item.click();
    await Promise.resolve();

    expect(saveEvent).toHaveBeenCalledTimes(1);
    const copy = saveEvent.mock.calls[0][0];
    expect(copy.id).toBeUndefined();
    expect(copy.title).toBe('Dimmed');
    expect(copy.declined).toBe(false); // a fresh copy starts active
  });
});
