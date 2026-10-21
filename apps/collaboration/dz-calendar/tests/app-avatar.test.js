/**
 * The header avatar upgrades from the letter to the account's public profile
 * picture (via puter.auth.getProfilePicture) — and everything around it keeps
 * working exactly as before: the button still toggles the account popover
 * even though clicks now land on an <img> inside it, and accounts without a
 * profile keep the letter with no errors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/js/store.js';
import { createApp } from '../src/js/app.js';

const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function makeStore() {
  const s = { ...DEFAULT_SETTINGS, defaultView: 'agenda' };
  const listeners = new Set();
  return {
    getSettings: () => ({ ...s }),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
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

/** Auto-decoding Image stub — jsdom never fires load for data URLs itself. */
class FakeImage {
  set src(v) {
    this._src = v;
    queueMicrotask(() => this.onload && this.onload());
  }
  get src() {
    return this._src;
  }
}

describe('app — header avatar profile picture', () => {
  let app;
  let root;

  beforeEach(() => {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    vi.stubGlobal('Image', FakeImage);
    localStorage.clear();
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    if (app) app.destroy();
    app = null;
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('upgrades the letter to the profile picture when the account has one', async () => {
    vi.stubGlobal('puter', {
      auth: { getProfilePicture: vi.fn().mockResolvedValue(PIC) },
    });
    app = createApp(root, { store: makeStore(), user: { username: 'alice', uuid: 'u1' } });

    const btn = root.querySelector('button.avatar');
    expect(btn.textContent).toBe('A'); // the letter renders first, no blank flash
    await vi.waitFor(() => expect(btn.querySelector('img.avatar__img')).toBeTruthy());
    expect(btn.querySelector('img').src).toBe(PIC);
    expect(btn.getAttribute('aria-label')).toBe('Account and settings');
    expect(puter.auth.getProfilePicture).toHaveBeenCalledWith('alice');
  });

  it('keeps the letter untouched for an account with no profile picture', async () => {
    vi.stubGlobal('puter', {
      auth: { getProfilePicture: vi.fn().mockResolvedValue(null) },
    });
    app = createApp(root, { store: makeStore(), user: { username: 'alice', uuid: 'u1' } });

    await new Promise((r) => setTimeout(r, 0));
    const btn = root.querySelector('button.avatar');
    expect(btn.querySelector('img')).toBe(null);
    expect(btn.textContent).toBe('A');
  });

  it('still renders the letter when the Puter SDK is absent entirely', async () => {
    app = createApp(root, { store: makeStore(), user: { username: 'bob' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector('button.avatar').textContent).toBe('B');
  });

  it('the avatar still toggles the popover closed when the pointer lands on the image', async () => {
    vi.stubGlobal('puter', {
      auth: { getProfilePicture: vi.fn().mockResolvedValue(PIC) },
    });
    app = createApp(root, { store: makeStore(), user: { username: 'alice', uuid: 'u1' } });

    const btn = root.querySelector('button.avatar');
    await vi.waitFor(() => expect(btn.querySelector('img')).toBeTruthy());

    // Open the account popover, and let its deferred outside-click listeners attach.
    btn.click();
    expect(document.querySelector('.popover')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));

    // A real click on the button now targets the <img>: pointerdown first
    // (the popover's outside-click listener), then the button's click. This
    // must toggle the popover closed — not close-and-reopen it.
    btn.querySelector('img').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    btn.click();
    expect(document.querySelector('.popover')).toBe(null);
  });
});
