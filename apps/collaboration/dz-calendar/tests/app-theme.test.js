import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/js/app.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/** Minimal store stand-in exposing an `_emit` to drive the app's subscription
 *  (the single render path) and a mutable settings object. The agenda view is
 *  used (via defaultView) so rendering needs no matchMedia. */
function makeStore(overrides = {}) {
  const s = { ...DEFAULT_SETTINGS, defaultView: 'agenda', ...overrides };
  const listeners = new Set();
  return {
    _emit() { for (const fn of [...listeners]) fn(); },
    _setTheme(t) { s.theme = t; },
    getSettings: () => ({ ...s }),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getAllEvents: () => [],
    getEventsInRange: () => [],
    getAllTasks: () => [],
    getTasksInRange: () => [],
    getTask: () => null,
    getEvent: () => null,
    saveSettings: async (patch) => (Object.assign(s, patch), { ...s }),
    toggleTask: async () => {},
  };
}

describe('app — theme stays in sync with the setting on every render', () => {
  let app;

  beforeEach(() => {
    // jsdom lacks matchMedia; createApp's resize path may consult it.
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  });

  afterEach(() => {
    if (app) app.destroy();
    app = null;
    delete document.documentElement.dataset.theme;
    document.body.replaceChildren();
  });

  it('keeps the theme-color metas in step with an explicit theme override', () => {
    // Regression: the metas are media-scoped to the OS scheme, so picking
    // "Dark" on a light-mode OS left the browser/PWA chrome white above a
    // dark app (and vice versa).
    const mkMeta = (media, content) => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      m.setAttribute('media', media);
      m.setAttribute('content', content);
      document.head.append(m);
      return m;
    };
    const light = mkMeta('(prefers-color-scheme: light)', '#ffffff');
    const dark = mkMeta('(prefers-color-scheme: dark)', '#0e0f13');

    const root = document.createElement('div');
    document.body.append(root);
    const store = makeStore({ theme: 'dark' });
    app = createApp(root, { store, user: { username: 'x' } });
    // Explicit dark: BOTH metas carry the dark color, whatever the OS scheme.
    expect(light.content).toBe('#0e0f13');
    expect(dark.content).toBe('#0e0f13');

    store._setTheme('light');
    store._emit();
    expect(light.content).toBe('#ffffff');
    expect(dark.content).toBe('#ffffff');

    // Back to system: per-scheme defaults restored.
    store._setTheme('system');
    store._emit();
    expect(light.content).toBe('#ffffff');
    expect(dark.content).toBe('#0e0f13');

    light.remove();
    dark.remove();
  });

  it('applies the theme on the initial render and re-applies it on a store-driven re-render', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const store = makeStore({ theme: 'light' });
    app = createApp(root, { store, user: { username: 'x' } });
    expect(document.documentElement.dataset.theme).toBe('light');

    // Simulate a reconnect reload: the store reloads a changed theme and emits,
    // which re-renders. render() must re-apply the theme to the document, even
    // if the DOM was left stale.
    document.documentElement.dataset.theme = 'light'; // stale value
    store._setTheme('dark');
    store._emit();
    expect(document.documentElement.dataset.theme).toBe('dark');

    // Switching to 'system' clears the attribute (CSS media query takes over).
    store._setTheme('system');
    store._emit();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
