import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderSidebar } from '../src/js/sidebar.js';
import { createApp } from '../src/js/app.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/** Minimal store/ctx stand-in: the sidebar reads getAllEvents and getAllTasks
 *  (for the Category filter) and getEventsInRange (for the mini-calendar event
 *  dots). */
function makeCtx({ events = [], tasks = [], settings = {}, actions = {}, booking = null } = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const store = {
    getAllEvents: () => events,
    getAllTasks: () => tasks,
    getEventsInRange: () => [],
    getSettings: () => ({ ...s }),
  };
  const now = new Date(2026, 6, 1);
  return {
    store,
    settings: s,
    cursor: now,
    miniCursor: new Date(2026, 6, 1),
    now,
    booking,
    actions: {
      createAt() {},
      miniShift() {},
      selectDate() {},
      toggleColor() {},
      renameCategory() {},
      toggleCategories() {},
      toggleBookingLinks() {},
      newBookingPage() {},
      editBookingPage() {},
      copyBookingLink() {},
      ...actions,
    },
  };
}

/** Stand-in for the booking module. `pages` defaults to one live link. */
function makeBooking(pages = [{ id: 'p1', title: 'Intro call', durationMin: 30, enabled: true }]) {
  return {
    getPages: () => pages,
    linkFor: () => 'https://calendar.puter.com/#/x/intro',
  };
}

const filterKeys = (node) =>
  [...node.querySelectorAll('.cal-filter__toggle')].map((el) =>
    el.dataset.focusKey.replace('filter-', ''),
  );
const filterLabels = (node) =>
  [...node.querySelectorAll('.cal-filter__label')].map((el) => el.textContent);

describe('sidebar — category filter', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('lists a color used only on a per-occurrence override', () => {
    // A recurring master colored blue, with one occurrence overridden to red.
    const master = {
      id: 'm1',
      color: 'blue',
      start: new Date(2026, 6, 6, 9).getTime(),
      end: new Date(2026, 6, 6, 10).getTime(),
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1], count: null, until: null },
      exdates: [],
      overrides: { [new Date(2026, 6, 13, 9).getTime()]: { color: 'red' } },
    };
    const node = renderSidebar(makeCtx({ events: [master] }));
    const keys = filterKeys(node);
    // Both the master color and the override-only color must be togglable.
    expect(keys).toContain('blue');
    expect(keys).toContain('red');
  });

  it('shows no filter when there are no events', () => {
    const node = renderSidebar(makeCtx({ events: [] }));
    expect(node.querySelectorAll('.cal-filter__item')).toHaveLength(0);
  });

  it('lists a color used only by a task', () => {
    // The filter hides tasks by color too, so a task-only color needs a
    // toggle — or that task could never be hidden, nor, once hidden, brought back.
    const task = {
      id: 't1',
      title: 'Buy milk',
      color: 'indigo',
      due: new Date(2026, 6, 6, 9).getTime(),
      allDay: false,
      done: false,
      isTask: true,
    };
    const node = renderSidebar(makeCtx({ events: [], tasks: [task] }));
    expect(filterKeys(node)).toEqual(['indigo']);
  });
});

describe('sidebar — renaming a category', () => {
  const ev = (color) => ({
    id: `e-${color}`,
    color,
    start: new Date(2026, 6, 6, 9).getTime(),
    end: new Date(2026, 6, 6, 10).getTime(),
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shows the user's name in place of the palette label", () => {
    const node = renderSidebar(
      makeCtx({ events: [ev('violet'), ev('red')], settings: { categoryNames: { violet: 'Family' } } }),
    );
    expect(filterLabels(node)).toEqual(['Family', 'Red']);
  });

  it('keeps a named category listed once its last event is gone', () => {
    // Nothing is violet any more, but the name is: without the row there would
    // be no way left to rename it back.
    const node = renderSidebar(
      makeCtx({ events: [ev('red')], settings: { categoryNames: { violet: 'Family' } } }),
    );
    expect(filterKeys(node)).toEqual(['violet', 'red']);
  });

  it('the rename button names the category it opens, and only opens it', () => {
    const renamed = [];
    const toggled = [];
    const node = renderSidebar(
      makeCtx({
        events: [ev('violet')],
        settings: { categoryNames: { violet: 'Family' } },
        actions: { renameCategory: (k) => renamed.push(k), toggleColor: (k) => toggled.push(k) },
      }),
    );

    const btn = node.querySelector('.cal-filter__rename');
    expect(btn.getAttribute('aria-label')).toBe('Rename Family');
    btn.click();
    expect(renamed).toEqual(['violet']);
    // The pencil is a sibling of the checkbox, not inside it: pressing it must
    // not also toggle the category's visibility.
    expect(toggled).toEqual([]);
  });
});

describe('sidebar — mini calendar states', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('marks today with aria-current="date" and names the selected day in its label', () => {
    // aria-current="date" means the current date. The selected (shown) day is
    // a different thing and used to carry the attribute instead.
    const ctx = makeCtx();
    ctx.now = new Date(2026, 6, 20);
    ctx.cursor = new Date(2026, 6, 8);
    const node = renderSidebar(ctx);
    const current = [...node.querySelectorAll('[aria-current="date"]')];
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe('20');
    const selected = node.querySelector('.mini__cell.is-selected, .is-selected');
    expect(selected.textContent).toBe('8');
    expect(selected.getAttribute('aria-label')).toMatch(/selected$/);
    expect(selected.hasAttribute('aria-current')).toBe(false);
  });
});

describe('sidebar — the category section folds away', () => {
  const ev = (color) => ({
    id: `e-${color}`,
    color,
    start: new Date(2026, 6, 6, 9).getTime(),
    end: new Date(2026, 6, 6, 10).getTime(),
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('sits at the foot of the sidebar, below the booking links', () => {
    const node = renderSidebar(makeCtx({ events: [ev('red')], booking: makeBooking() }));
    const sections = [...node.querySelectorAll('.side-section')];
    // Booking links first, categories last — the order the sidebar is used in.
    expect(sections.map((s) => !!s.querySelector('.book-list'))).toEqual([true, false]);
    expect(sections.at(-1).querySelector('.cal-filter')).not.toBeNull();
  });

  it('is expanded by default, with the list exposed to the header', () => {
    const node = renderSidebar(makeCtx({ events: [ev('red')] }));
    const toggle = node.querySelector('.side-section__toggle');
    const list = node.querySelector('.cal-filter');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(list.id);
    expect(list.hidden).toBe(false);
    // A heading that is still a heading: the button is inside the <h2>, since a
    // heading is not phrasing content and cannot legally live in a button.
    expect(toggle.closest('h2')).not.toBeNull();
  });

  it('hides the list when the setting says collapsed, and asks to be reopened', () => {
    const toggled = [];
    const node = renderSidebar(
      makeCtx({
        events: [ev('red')],
        settings: { categoriesCollapsed: true },
        actions: { toggleCategories: () => toggled.push(true) },
      }),
    );
    const toggle = node.querySelector('.side-section__toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(node.querySelector('.cal-filter').hidden).toBe(true);
    toggle.click();
    expect(toggled).toEqual([true]);
  });

  it('counts the categories the filter is hiding while it is folded', () => {
    // A closed section must not swallow the reason the calendar looks empty.
    const ctx = makeCtx({
      events: [ev('red'), ev('blue'), ev('green')],
      settings: { categoriesCollapsed: true, hiddenColors: ['red', 'blue'] },
    });
    expect(renderSidebar(ctx).querySelector('.side-section__note').textContent).toBe('2 hidden');
  });

  it('says nothing about hidden categories when none are hidden, or when open', () => {
    const shown = renderSidebar(
      makeCtx({ events: [ev('red')], settings: { categoriesCollapsed: true } }),
    );
    expect(shown.querySelector('.side-section__note')).toBeNull();
    // Expanded, the unchecked rows say it themselves.
    const open = renderSidebar(
      makeCtx({ events: [ev('red')], settings: { hiddenColors: ['red'] } }),
    );
    expect(open.querySelector('.side-section__note')).toBeNull();
  });

  it('has no header to fold when no category is listed at all', () => {
    const node = renderSidebar(makeCtx({ events: [] }));
    expect(node.querySelector('.side-section__toggle')).toBeNull();
  });
});

describe('sidebar — the booking links section folds away', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const bookingSection = (node) =>
    [...node.querySelectorAll('.side-section')].find((s) => s.querySelector('.book-list'));

  it('is expanded by default, with the list exposed to the header', () => {
    const node = renderSidebar(makeCtx({ booking: makeBooking() }));
    const section = bookingSection(node);
    const toggle = section.querySelector('.side-section__toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(section.querySelector('.book-list').id);
    expect(section.querySelector('.book-list').hidden).toBe(false);
    expect(toggle.closest('h2')).not.toBeNull();
  });

  it('hides the list — the New booking link button with it — when folded', () => {
    const toggled = [];
    const node = renderSidebar(
      makeCtx({
        booking: makeBooking(),
        settings: { bookingLinksCollapsed: true },
        actions: { toggleBookingLinks: () => toggled.push(true) },
      }),
    );
    const list = bookingSection(node).querySelector('.book-list');
    expect(list.hidden).toBe(true);
    // The only way to make a new link lives in the list, so the fold must be
    // reversible from the header it left behind.
    expect(list.querySelector('.book-new')).not.toBeNull();
    bookingSection(node).querySelector('.side-section__toggle').click();
    expect(toggled).toEqual([true]);
  });

  it('counts the paused links while it is folded', () => {
    // A paused link turns guests away; that must not hide behind the fold.
    const pages = [
      { id: 'p1', title: 'Intro call', durationMin: 30, enabled: true },
      { id: 'p2', title: 'Office hours', durationMin: 60, enabled: false },
      { id: 'p3', title: 'Coffee', durationMin: 15, enabled: false },
    ];
    const node = renderSidebar(
      makeCtx({ booking: makeBooking(pages), settings: { bookingLinksCollapsed: true } }),
    );
    expect(bookingSection(node).querySelector('.side-section__note').textContent).toBe('2 off');
  });

  it('says nothing while every link is live, or while it stands open', () => {
    const folded = renderSidebar(
      makeCtx({ booking: makeBooking(), settings: { bookingLinksCollapsed: true } }),
    );
    expect(bookingSection(folded).querySelector('.side-section__note')).toBeNull();
    // Open, the rows carry their own "Off" pills.
    const open = renderSidebar(
      makeCtx({ booking: makeBooking([{ id: 'p1', title: 'X', durationMin: 30, enabled: false }]) }),
    );
    expect(bookingSection(open).querySelector('.side-section__note')).toBeNull();
    expect(bookingSection(open).querySelector('.book-item__off')).not.toBeNull();
  });

  it('folds independently of the categories', () => {
    const node = renderSidebar(
      makeCtx({
        events: [{ id: 'e', color: 'red', start: Date.now(), end: Date.now() + 1 }],
        booking: makeBooking(),
        settings: { bookingLinksCollapsed: true },
      }),
    );
    expect(bookingSection(node).querySelector('.book-list').hidden).toBe(true);
    expect(node.querySelector('.cal-filter').hidden).toBe(false);
    // Two headings, two different lists named.
    const ids = [...node.querySelectorAll('.side-section__toggle')].map((t) =>
      t.getAttribute('aria-controls'),
    );
    expect(new Set(ids).size).toBe(2);
  });
});

/* ---- The fold, wired to the store -------------------------------------- */

describe('app — folding the category section', () => {
  let app = null;
  let saved;
  let store;

  function makeStore(settings = {}) {
    const s = { ...DEFAULT_SETTINGS, defaultView: 'agenda', ...settings };
    const listeners = new Set();
    const events = [
      { id: 'e1', title: 'Dinner', color: 'violet', allDay: false, reminders: [],
        start: Date.now(), end: Date.now() + 3600_000 },
    ];
    return {
      getSettings: () => ({ ...s }),
      subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
      getAllEvents: () => events,
      getAllTasks: () => [],
      getEventsInRange: (from, to) => events.filter((e) => e.start < to && e.end > from),
      getTasksInRange: () => [],
      getTask: () => null,
      getEvent: (id) => events.find((e) => e.id === id) || null,
      toggleTask: async () => {},
      // Mirrors the real store: memory first, then emit — the app's single
      // render path.
      saveSettings: async (patch) => {
        saved.push(patch);
        Object.assign(s, patch);
        for (const fn of [...listeners]) fn();
        return { ...s };
      },
    };
  }

  const header = () => document.querySelector('[data-focus-key="filter-collapse"]');

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
    document.querySelectorAll('.toast, .app-root, .dialog-scrim').forEach((n) => n.remove());
    document.body.replaceChildren();
  });

  function mount(settings) {
    const root = document.createElement('div');
    root.className = 'app-root';
    document.body.append(root);
    store = makeStore(settings);
    app = createApp(root, { store, user: { username: 'x' } });
    return root;
  }

  it('saves the fold, and nothing else, then renders it folded', async () => {
    mount();
    header().focus();
    header().click();
    expect(saved).toEqual([{ categoriesCollapsed: true }]);
    await Promise.resolve();
    expect(document.querySelector('.cal-filter').hidden).toBe(true);
    expect(header().getAttribute('aria-expanded')).toBe('false');
    // The sidebar is rebuilt from scratch on every render; the header carries a
    // data-focus-key so the keyboard is not dropped to <body> mid-toggle.
    expect(document.activeElement).toBe(header());
  });

  it('unfolds again from the folded setting', async () => {
    mount({ categoriesCollapsed: true });
    expect(document.querySelector('.cal-filter').hidden).toBe(true);
    header().click();
    expect(saved).toEqual([{ categoriesCollapsed: false }]);
    await Promise.resolve();
    expect(document.querySelector('.cal-filter').hidden).toBe(false);
  });
});
