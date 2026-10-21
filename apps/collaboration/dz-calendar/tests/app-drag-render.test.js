import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../src/js/app.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

const pointer = (type, target, { x = 0, y = 0, pointerId = 1, pointerType = 'mouse', button = 0 } = {}) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
  return e;
};

function makeStore(events) {
  const settings = { ...DEFAULT_SETTINGS, defaultView: 'month' };
  const listeners = new Set();
  return {
    _emit() {
      for (const fn of [...listeners]) fn();
    },
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

describe('app — a store change that lands mid-drag', () => {
  let root;
  let app;
  let store;
  let events;

  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    root = document.createElement('div');
    document.body.append(root);
    events = [{ id: 'a', title: 'Held', start: dayAt(9), end: dayAt(10), allDay: false, color: 'blue' }];
    store = makeStore(events);
    app = createApp(root, { store, user: { username: 'x' } });
  });
  afterEach(() => {
    if (app) app.destroy();
    app = null;
    vi.useRealTimers();
    document.body.replaceChildren();
    document.body.classList.remove('is-dragging');
  });

  it('is rendered as soon as the gesture ends, even one that commits nothing', () => {
    const chip = root.querySelector('[data-focus-key="ev:a"]');
    expect(chip).toBeTruthy();
    pointer('pointerdown', chip, { x: 10, y: 10 });
    pointer('pointermove', window, { x: 40, y: 40 });
    expect(document.body.classList.contains('is-dragging')).toBe(true);

    // Another writer adds an event while the chip is held.
    events.push({ id: 'b', title: 'Arrived', start: dayAt(13), end: dayAt(14), allDay: false, color: 'red' });
    store._emit();
    expect(root.querySelector('[data-focus-key="ev:b"]')).toBeNull(); // not mid-drag
    expect(document.body.classList.contains('is-dragging')).toBe(true); // …and the drag survived

    // Escape abandons the drag: nothing is written, nothing else emits.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.classList.contains('is-dragging')).toBe(false);
    expect(root.querySelector('[data-focus-key="ev:b"]')).toBeTruthy();
  });

  it('waits for an open context menu to close, then renders', () => {
    const chip = root.querySelector('[data-focus-key="ev:a"]');
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    const menu = document.querySelector('.ctx-menu');
    expect(menu).toBeTruthy();
    events.push({ id: 'b', title: 'Arrived', start: dayAt(13), end: dayAt(14), allDay: false, color: 'red' });
    store._emit();
    // Not yet: the menu is still up and untouched.
    expect(document.querySelector('.ctx-menu')).toBe(menu);
    expect(root.querySelector('[data-focus-key="ev:b"]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.ctx-menu')).toBeNull();
    expect(root.querySelector('[data-focus-key="ev:b"]')).toBeTruthy();
  });

  it('renders once for a change that lands with no drag in flight', () => {
    const spy = vi.spyOn(store, 'getEventsInRange');
    store._emit();
    const perRender = spy.mock.calls.length;
    spy.mockClear();
    store._emit();
    expect(spy.mock.calls.length).toBe(perRender);
  });
});
