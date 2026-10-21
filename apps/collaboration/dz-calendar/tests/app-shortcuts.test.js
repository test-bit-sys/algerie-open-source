import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/js/app.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/** Minimal store stand-in (mirrors app-theme.test.js). */
function makeStore(overrides = {}) {
  const s = { ...DEFAULT_SETTINGS, defaultView: 'month', ...overrides };
  const listeners = new Set();
  return {
    _emit() { for (const fn of [...listeners]) fn(); },
    getSettings: () => ({ ...s }),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getAllEvents: () => [],
    getEventsInRange: () => [],
    getAllTasks: () => [],
    getTasksInRange: () => [],
    getTask: () => null,
    getEvent: () => null,
    // Like the real store: the patch lands in memory and subscribers are told
    // synchronously, before the (here, instant) persist.
    saveSettings(patch) {
      Object.assign(s, patch);
      for (const fn of [...listeners]) fn();
      return Promise.resolve({ ...s });
    },
    toggleTask: async () => {},
  };
}

/** The view a segmented/tab button currently marks active. */
function activeView() {
  const btn = document.querySelector('[data-view][aria-pressed="true"], [data-view].is-active');
  return btn ? btn.dataset.view : null;
}

const pressKey = (key) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('app — single-key view shortcuts', () => {
  let app;
  let store;

  beforeEach(() => {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    const root = document.createElement('div');
    document.body.append(root);
    store = makeStore();
    app = createApp(root, { store, user: { username: 'x' } });
  });

  afterEach(() => {
    if (app) app.destroy();
    app = null;
    delete document.documentElement.dataset.theme;
    document.body.replaceChildren();
  });

  it('Escape closes the mobile drawer and hands focus back to the menu button', () => {
    const menu = document.querySelector('.menu-toggle');
    const shell = document.querySelector('.app');
    menu.click();
    expect(shell.classList.contains('sidebar-open')).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.scrim')).not.toBeNull();
    pressKey('Escape');
    expect(shell.classList.contains('sidebar-open')).toBe(false);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.scrim')).toBeNull();
    expect(document.activeElement).toBe(menu);
    // Idle Escape is a no-op, not an error.
    pressKey('Escape');
    expect(shell.classList.contains('sidebar-open')).toBe(false);
  });

  it('the List view opens a new period at the top, and keeps its place otherwise', () => {
    pressKey('a');
    const list = document.querySelector('.agenda');
    expect(list).not.toBeNull();
    list.scrollTop = 500;
    // A re-render of the SAME period (a store change) keeps the reader's place…
    store._emit();
    expect(document.querySelector('.agenda').scrollTop).toBe(500);
    // …paging to another period does not: that is a different list of days.
    pressKey('ArrowRight');
    expect(document.querySelector('.agenda').scrollTop).toBe(0);
  });

  it('switches views with lowercase letter shortcuts', () => {
    pressKey('w');
    expect(activeView()).toBe('week');
    pressKey('d');
    expect(activeView()).toBe('day');
    pressKey('y');
    expect(activeView()).toBe('year');
  });

  it('still switches views when the key is uppercase (CapsLock / Shift)', () => {
    // Regression: the switch matched only lowercase e.key, so CapsLock or a held
    // Shift silently disabled every letter shortcut.
    pressKey('W');
    expect(activeView()).toBe('week');
    pressKey('A');
    expect(activeView()).toBe('agenda');
    pressKey('M');
    expect(activeView()).toBe('month');
  });

  it('ignores Alt chords — browser shortcuts must not also drive the calendar', () => {
    // Regression: Alt+D (Windows/Linux address-bar focus) reaches the page as
    // keydown d with altKey set; the calendar switched to Day view alongside
    // the browser action. Same for Alt+ArrowLeft (history back).
    const altKey = (key) =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true }));
    expect(activeView()).toBe('month');
    altKey('d');
    expect(activeView()).toBe('month');
    altKey('w');
    expect(activeView()).toBe('month');
  });
});
