import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { openCategoryRename } from '../src/js/category-dialog.js';
import { createApp } from '../src/js/app.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';
import { categoryLabel, sanitizeCategoryNames, MAX_CATEGORY_NAME } from '../src/js/colors.js';

/**
 * Renaming a sidebar category. The dialog writes a name and nothing else — the
 * palette key it belongs to is what events store — so these cover what comes
 * back out of it: a name, '' for "use the palette default again", or nothing.
 */

const dialog = () => document.querySelector('form.cat-rename');
const input = () => dialog().querySelector('input');
const button = (label) =>
  [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const submit = () => dialog().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('category label resolution', () => {
  it('falls back to the palette name, and only for a blank of its own', () => {
    expect(categoryLabel('violet', { violet: 'Family' })).toBe('Family');
    expect(categoryLabel('violet', {})).toBe('Violet');
    expect(categoryLabel('violet', { violet: '   ' })).toBe('Violet');
    expect(categoryLabel('violet', null)).toBe('Violet');
    // An unknown key still has to answer with something printable.
    expect(categoryLabel('chartreuse', {})).toBe('Indigo');
  });

  it('sanitizes a stored map down to real, informative names', () => {
    expect(
      sanitizeCategoryNames({
        violet: '  Family  ',
        chartreuse: 'Not a palette key',
        red: 42,
        blue: '',
        green: 'Green',
        teal: 'x'.repeat(MAX_CATEGORY_NAME + 20),
      }),
    ).toEqual({ violet: 'Family', teal: 'x'.repeat(MAX_CATEGORY_NAME) });
  });

  it('never hands back a name ending mid-cut on a space', () => {
    const long = `${'a'.repeat(MAX_CATEGORY_NAME - 1)} tail`;
    expect(sanitizeCategoryNames({ violet: long }).violet).toBe('a'.repeat(MAX_CATEGORY_NAME - 1));
  });

  it('leaves the input map alone', () => {
    const names = { violet: '  Family  ' };
    sanitizeCategoryNames(names);
    expect(names).toEqual({ violet: '  Family  ' });
  });
});

describe('rename dialog', () => {
  it('opens on the current name and saves a new one', () => {
    const onSave = vi.fn();
    openCategoryRename({ key: 'violet', names: { violet: 'Family' }, onSave });

    expect(dialog().textContent).toContain('Rename “Family”');
    expect(input().value).toBe('Family');
    expect(input().getAttribute('maxlength')).toBe(String(MAX_CATEGORY_NAME));

    input().value = '  Family & friends  ';
    submit();
    expect(dialog()).toBeNull();
    expect(onSave).toHaveBeenCalledWith('Family & friends');
  });

  it('leaves the name field free of spellcheck squiggles', () => {
    openCategoryRename({ key: 'violet', names: {}, onSave: () => {} });
    // A property, not an attribute string: `spellcheck` is a boolean IDL
    // attribute, so the string 'false' would read as true (see the dialog).
    expect(input().spellcheck).toBe(false);
  });

  it('offers the palette name as the placeholder, and empty as the way back', () => {
    openCategoryRename({ key: 'graphite', names: {}, onSave: () => {} });
    expect(dialog().textContent).toContain('Rename “Graphite”');
    expect(input().placeholder).toBe('Graphite');
    expect(dialog().textContent).toContain('Leave it empty to go back to “Graphite”');
  });

  it('an emptied field saves the clear, rather than closing on nothing', () => {
    const onSave = vi.fn();
    openCategoryRename({ key: 'violet', names: { violet: 'Family' }, onSave });
    input().value = '   ';
    submit();
    expect(onSave).toHaveBeenCalledWith('');
  });

  it('saves nothing when the name did not change', () => {
    const onSave = vi.fn();
    openCategoryRename({ key: 'violet', names: { violet: 'Family' }, onSave });
    submit();
    expect(dialog()).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('an unnamed category submitted untouched saves nothing either', () => {
    const onSave = vi.fn();
    openCategoryRename({ key: 'violet', names: {}, onSave });
    submit();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Cancel and Escape both write nothing', () => {
    const onSave = vi.fn();
    openCategoryRename({ key: 'violet', names: {}, onSave });
    input().value = 'Family';
    button('Cancel').click();
    expect(dialog()).toBeNull();
    expect(onSave).not.toHaveBeenCalled();

    openCategoryRename({ key: 'violet', names: {}, onSave });
    input().value = 'Family';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('an Escape pressed mid-IME-composition cancels the candidate, not the dialog', () => {
    const onSave = vi.fn();
    openCategoryRename({ key: 'violet', names: {}, onSave });
    input().value = '家';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    expect(dialog()).not.toBeNull();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true }));
    expect(dialog()).not.toBeNull();
    expect(input().value).toBe('家');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
  });
});

/* ---- The sidebar pencil, wired to the store ---------------------------- */

describe('renaming from the sidebar', () => {
  let app = null;
  let saved;

  function makeStore(settings = {}) {
    const s = { ...DEFAULT_SETTINGS, defaultView: 'month', ...settings };
    const events = [
      { id: 'e1', title: 'Dinner', color: 'violet', allDay: false, reminders: [],
        start: Date.now(), end: Date.now() + 3600_000 },
    ];
    return {
      getSettings: () => ({ ...s }),
      subscribe: () => () => {},
      getAllEvents: () => events,
      getEventsInRange: (from, to) => events.filter((e) => e.start < to && e.end > from),
      getAllTasks: () => [],
      getTasksInRange: () => [],
      getTask: () => null,
      getEvent: (id) => events.find((e) => e.id === id) || null,
      saveSettings: async (patch) => (saved.push(patch), Object.assign(s, patch), { ...s }),
    };
  }

  function mount(store) {
    const root = document.createElement('div');
    root.className = 'app-root';
    document.body.append(root);
    app = createApp(root, { store, user: { username: 'x' } });
    return root;
  }

  beforeEach(() => {
    saved = [];
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
    document.querySelectorAll('.toast, .ctx-menu, .app-root, .dialog-scrim').forEach((n) => n.remove());
  });

  it('saves the renamed category alone, never the whole map', () => {
    mount(makeStore({ categoryNames: { red: 'Bills' } }));
    document.querySelector('[data-focus-key="filter-rename-violet"]').click();
    input().value = 'Family';
    submit();
    // 'red' must not ride along: this device's copy of it is as old as its
    // last sync, and the store merges a categoryNames patch key by key — a
    // whole-map patch would push a stale 'Bills' over a newer name.
    expect(saved).toEqual([{ categoryNames: { violet: 'Family' } }]);
  });

  it('leaves the mobile drawer open, with the row still behind the dialog', () => {
    const root = mount(makeStore());
    const shell = root.querySelector('.app');
    root.querySelector('.menu-toggle').click();
    expect(shell.classList.contains('sidebar-open')).toBe(true);

    document.querySelector('[data-focus-key="filter-rename-violet"]').click();
    // The dialog sits above the drawer (.dialog-scrim outranks it), so there is
    // nothing to close — and closing it would hide the row being renamed.
    expect(dialog()).toBeTruthy();
    expect(shell.classList.contains('sidebar-open')).toBe(true);

    input().value = 'Family';
    submit();
    expect(shell.classList.contains('sidebar-open')).toBe(true);
  });

  it('sends the cleared name as a tombstone, still on its own', () => {
    mount(makeStore({ categoryNames: { violet: 'Family', red: 'Bills' } }));
    document.querySelector('[data-focus-key="filter-rename-violet"]').click();
    input().value = '';
    submit();
    expect(saved).toEqual([{ categoryNames: { violet: '' } }]);
  });
});
