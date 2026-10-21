/**
 * The public-holiday overlay where it meets the rest of the app: the store's
 * opt-in merge, the three views that draw it, and the consumers that must
 * never see it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore, DEFAULT_SETTINGS } from '../src/js/store.js';
import { computeBusy } from '../src/js/booking.js';
import { renderMonth } from '../src/js/views/month.js';
import { renderTimeGrid } from '../src/js/views/timegrid.js';
import { renderAgenda } from '../src/js/views/agenda.js';
import { clearHolidayCache } from '../src/js/holidays.js';
import { clearClockChangeCache } from '../src/js/dst.js';

/** In-memory stand-in matching the subset of puter.kv the store uses. */
function makeKv(initial = {}) {
  const map = new Map(Object.entries(initial));
  const globToRe = (glob) =>
    new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return {
    map,
    set: vi.fn(async (k, v) => {
      const items = Array.isArray(k) ? k : [{ key: k, value: v }];
      for (const { key, value } of items) map.set(key, JSON.parse(JSON.stringify(value)));
      return true;
    }),
    get: vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
    del: vi.fn(async (k) => void map.delete(k) || true),
    list: vi.fn(async (pattern, returnValues) => {
      let keys = [...map.keys()];
      if (typeof pattern === 'string') keys = keys.filter((k) => globToRe(pattern).test(k));
      return returnValues ? keys.map((k) => ({ key: k, value: map.get(k) })) : keys;
    }),
  };
}

// The US on 4 July 2026 — a Saturday, so the federal day off is Friday the 3rd,
// which gives every surface two holidays in one week to place.
const JULY = (d, h = 0) => new Date(2026, 6, d, h).getTime();

async function makeStore({ country = 'us', events = [], clockChanges = false } = {}) {
  // Clock changes are off in these fixtures unless a test is about them: the
  // process zone decides whether any exist, and the holiday checks should not
  // depend on where CI happens to run.
  const initial = { 'cal:settings': { ...DEFAULT_SETTINGS, holidayCountry: country, clockChanges } };
  for (const ev of events) initial[`cal:evt:${ev.id}`] = ev;
  const store = createStore(makeKv(initial));
  await store.load();
  return store;
}

const titles = (items) => items.map((i) => i.title);

describe('store.getEventsInRange', () => {
  it('leaves holidays out unless they are asked for', async () => {
    const store = await makeStore();
    expect(store.getEventsInRange(JULY(1), JULY(8))).toEqual([]);
    expect(titles(store.getEventsInRange(JULY(1), JULY(8), { includeHolidays: true }))).toEqual([
      'Independence Day (observed)',
      'Independence Day',
    ]);
  });

  it('keeps them away from the consumers that ask for hidden events', async () => {
    // The reminder scheduler, search and the app-to-app API all read this way.
    const store = await makeStore();
    expect(store.getEventsInRange(JULY(1), JULY(8), { includeHidden: true })).toEqual([]);
  });

  it('shows nothing when the setting is off, even when asked', async () => {
    const store = await makeStore({ country: '' });
    expect(store.getEventsInRange(JULY(1), JULY(8), { includeHolidays: true })).toEqual([]);
  });

  it('follows the country the user picked', async () => {
    const store = await makeStore({ country: 'fr' });
    expect(titles(store.getEventsInRange(JULY(1), JULY(20), { includeHolidays: true }))).toEqual([
      'Bastille Day',
    ]);
  });

  it('cannot be hidden by the category filter', async () => {
    // Every palette color switched off: the user's own events vanish, the
    // holiday does not — it has no color to filter on in the first place.
    const store = await makeStore({
      events: [
        {
          id: 'e1',
          title: 'Barbecue',
          start: JULY(4, 12),
          end: JULY(4, 14),
          color: 'blue',
        },
      ],
    });
    await store.saveSettings({ hiddenColors: ['blue'] });
    const shown = store.getEventsInRange(JULY(4), JULY(5), { includeHolidays: true });
    expect(titles(shown)).toEqual(['Independence Day']);
  });

  it('sorts a holiday ahead of the day’s other items', async () => {
    const store = await makeStore({
      events: [
        { id: 'a', title: 'Family visit', start: JULY(4), end: JULY(5), allDay: true, color: 'green' },
        { id: 'b', title: 'Fireworks', start: JULY(4, 21), end: JULY(4, 22), color: 'red' },
      ],
    });
    expect(titles(store.getEventsInRange(JULY(4), JULY(5), { includeHolidays: true }))).toEqual([
      'Independence Day',
      'Family visit',
      'Fireworks',
    ]);
  });

  it('is derived, never stored', async () => {
    const kv = makeKv({ 'cal:settings': { ...DEFAULT_SETTINGS, holidayCountry: 'us' } });
    const store = createStore(kv);
    await store.load();
    store.getEventsInRange(JULY(1), JULY(8), { includeHolidays: true });
    expect([...kv.map.keys()].filter((k) => k.startsWith('cal:evt:'))).toEqual([]);
    expect(store.getAllEvents()).toEqual([]);
    // …so a holiday is not something an export or the API could pick up.
    expect(store.getEvent('hol:us:2026-07-04')).toBeNull();
  });
});

describe('clock changes in the overlay', () => {
  // Pinned to New York for the duration: the overlay follows the process zone.
  // Both overlays memoise timestamps computed in the zone of the moment, so
  // both caches are emptied on the way in and out.
  let savedTZ;
  beforeEach(() => {
    savedTZ = process.env.TZ;
    process.env.TZ = 'America/New_York';
    clearClockChangeCache();
    clearHolidayCache();
  });
  afterEach(() => {
    if (savedTZ === undefined) delete process.env.TZ;
    else process.env.TZ = savedTZ;
    clearClockChangeCache();
    clearHolidayCache();
  });
  const MAR = (d, h = 0) => new Date(2026, 2, d, h).getTime();

  it('are on by default and ride along with the holidays', async () => {
    expect(DEFAULT_SETTINGS.clockChanges).toBe(true);
    const store = await makeStore({ clockChanges: true });
    expect(store.getEventsInRange(MAR(1), MAR(15))).toEqual([]);
    const shown = store.getEventsInRange(MAR(1), MAR(15), { includeHolidays: true });
    expect(titles(shown)).toEqual(['Clocks go forward']);
    expect(shown[0]).toMatchObject({ dst: true, readOnly: true, zone: 'America/New_York' });
  });

  it('go away with the setting', async () => {
    const store = await makeStore({ clockChanges: false });
    expect(store.getEventsInRange(MAR(1), MAR(15), { includeHolidays: true })).toEqual([]);
  });

  it('sort after a same-day holiday and ahead of the user’s events', async () => {
    // A real coincidence: Sunday 1 November 2026 is both All Saints' Day
    // (France) and the US clocks-back day, so a French user in New York sees
    // both on one day.
    const store = await makeStore({
      country: 'fr',
      clockChanges: true,
      events: [{ id: 'a', title: 'Brunch', start: new Date(2026, 10, 1, 11).getTime(), end: new Date(2026, 10, 1, 13).getTime(), color: 'blue' }],
    });
    expect(titles(store.getEventsInRange(new Date(2026, 10, 1).getTime(), new Date(2026, 10, 2).getTime(), { includeHolidays: true }))).toEqual([
      "All Saints' Day",
      'Clocks go back',
      'Brunch',
    ]);
  });

  it('draw as a clock chip in the month view that opens the item', async () => {
    const store = await makeStore({ clockChanges: true });
    const opened = [];
    const ctx = { ...ctxFor(store, new Date(2026, 2, 15)), actions: { ...ACTIONS, openEvent: (e) => opened.push(e) } };
    const { node } = renderMonth(ctx);
    const chips = [...node.querySelectorAll('.chip--holiday')];
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(['Clock change: Clocks go forward']);
    expect(chips[0].getAttribute('role')).toBe('button');
    expect(chips[0].querySelector('.chip__holiday-icon svg')).not.toBeNull();
    chips[0].click();
    expect(opened[0]).toMatchObject({ dst: true, title: 'Clocks go forward' });
  });

  it('sit in the week view’s all-day rail and the agenda’s list', async () => {
    const store = await makeStore({
      clockChanges: true,
      events: [{ id: 'e', title: 'Dentist', start: MAR(9, 9), end: MAR(9, 10), color: 'blue' }],
    });
    const days = [...Array(7)].map((_, i) => new Date(2026, 2, 8 + i));
    const week = renderTimeGrid(days, ctxFor(store, days[0])).node;
    expect([...week.querySelectorAll('.allday-chip--holiday')].map((c) => c.getAttribute('aria-label'))).toEqual([
      'Clock change: Clocks go forward',
    ]);
    const agenda = renderAgenda(ctxFor(store, new Date(2026, 2, 1))).node;
    const row = agenda.querySelector('.agenda__event--holiday');
    expect(row.getAttribute('aria-label')).toBe('Clock change: Clocks go forward');
    expect(row.querySelector('.agenda__event-time').textContent).toBe('Clocks');
  });

  it('do not stop the agenda calling itself empty', async () => {
    const store = await makeStore({ clockChanges: true });
    const { node } = renderAgenda(ctxFor(store, new Date(2026, 2, 1)));
    expect(node.querySelector('.empty')).not.toBeNull();
  });
});

describe('booking availability', () => {
  it('does not make the host busy on a public holiday', async () => {
    const store = await makeStore();
    // The horizon starts at `now`; a holiday inside it must contribute nothing.
    expect(computeBusy(store, 14, JULY(1, 9))).toEqual([]);
    // A real meeting on the same horizon still does.
    const busyStore = await makeStore({
      events: [{ id: 'm', title: 'Standup', start: JULY(2, 9), end: JULY(2, 10), color: 'blue' }],
    });
    expect(computeBusy(busyStore, 14, JULY(1, 9))).toEqual([[JULY(2, 9), JULY(2, 10)]]);
  });
});

/* ---- Views -------------------------------------------------------------- */

const ACTIONS = {
  createAt() {}, gotoDayView() {}, gotoMonthView() {}, slotContextMenu() {},
  openEvent() {}, openTask() {}, toggleTask() {}, eventContextMenu() {},
  taskContextMenu() {}, moveEvent() {}, moveTask() {}, edgePage() {},
  selectDate() {}, miniShift() {}, toggleColor() {},
};

function ctxFor(store, cursor) {
  return {
    store,
    settings: store.getSettings(),
    cursor,
    miniCursor: cursor,
    now: cursor,
    actions: ACTIONS,
  };
}

describe('month view', () => {
  it('draws a holiday as a chip you can open but not drag', async () => {
    const store = await makeStore();
    const { node } = renderMonth(ctxFor(store, new Date(2026, 6, 15)));
    const chips = [...node.querySelectorAll('.chip--holiday')];
    expect(chips.map((c) => c.querySelector('.chip__title').textContent)).toEqual([
      'Independence Day (observed)',
      'Independence Day',
    ]);
    for (const chip of chips) {
      // Reachable like an event chip — a clipped name needs somewhere to be
      // read in full, and on touch the tooltip is not it — but not draggable.
      expect(chip.getAttribute('tabindex')).toBe('0');
      expect(chip.getAttribute('role')).toBe('button');
      expect(chip.getAttribute('draggable')).toBeNull();
      expect(chip.title).toBe(`${chip.querySelector('.chip__title').textContent} · United States`);
    }
  });

  it('leaves the grid alone when holidays are off', async () => {
    const store = await makeStore({ country: '' });
    const { node } = renderMonth(ctxFor(store, new Date(2026, 6, 15)));
    expect(node.querySelectorAll('.chip--holiday')).toHaveLength(0);
  });

  it('opens the holiday on click and on Enter, and nothing else', async () => {
    const store = await makeStore();
    const opened = [];
    const menus = [];
    const ctx = {
      ...ctxFor(store, new Date(2026, 6, 15)),
      actions: { ...ACTIONS, openEvent: (e) => opened.push(e), eventContextMenu: (e) => menus.push(e) },
    };
    const { node } = renderMonth(ctx);
    const chip = node.querySelector('.chip--holiday');
    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    chip.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(opened.map((h) => h.title)).toEqual([
      'Independence Day (observed)',
      'Independence Day (observed)',
    ]);
    // The item handed over is the computed holiday itself, flagged read-only,
    // so the card knows to offer no Edit or Delete.
    expect(opened[0]).toMatchObject({ holiday: true, readOnly: true, countryName: 'United States' });
    // No context menu: there is nothing to edit, duplicate or delete.
    chip.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
    expect(menus).toEqual([]);
  });

  it('does not let a holiday click fall through and create an event', async () => {
    const store = await makeStore();
    const created = [];
    const ctx = { ...ctxFor(store, new Date(2026, 6, 15)), actions: { ...ACTIONS, createAt: (d) => created.push(d) } };
    const { node } = renderMonth(ctx);
    node.querySelector('.chip--holiday').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(created).toEqual([]);
  });
});

describe('week view', () => {
  it('puts a holiday in the all-day rail', async () => {
    const store = await makeStore();
    const days = [...Array(7)].map((_, i) => new Date(2026, 5, 28 + i)); // Sun 28 Jun – Sat 4 Jul
    const { node } = renderTimeGrid(days, ctxFor(store, days[0]));
    const rail = node.querySelector('.timegrid__allday');
    expect(rail).not.toBeNull();
    const chips = [...rail.querySelectorAll('.allday-chip--holiday')];
    expect(chips.map((c) => c.querySelector('.allday-chip__title').textContent)).toEqual([
      'Independence Day (observed)',
      'Independence Day',
    ]);
    for (const chip of chips) {
      expect(chip.getAttribute('tabindex')).toBe('0');
      expect(chip.getAttribute('role')).toBe('button');
    }
  });

  it('opens the holiday from the rail', async () => {
    const store = await makeStore();
    const days = [...Array(7)].map((_, i) => new Date(2026, 5, 28 + i));
    const opened = [];
    const ctx = { ...ctxFor(store, days[0]), actions: { ...ACTIONS, openEvent: (e) => opened.push(e) } };
    const { node } = renderTimeGrid(days, ctx);
    const chip = node.querySelector('.allday-chip--holiday');
    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    chip.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(opened.map((h) => h.title)).toEqual([
      'Independence Day (observed)',
      'Independence Day (observed)',
    ]);
  });

  it('opens the rail for a week whose only all-day item is a holiday', async () => {
    const store = await makeStore();
    const days = [...Array(7)].map((_, i) => new Date(2026, 5, 28 + i));
    const { node } = renderTimeGrid(days, ctxFor(store, days[0]));
    expect(node.querySelector('.timegrid__allday')).not.toBeNull();
  });
});

describe('agenda view', () => {
  it('lists a holiday alongside the user’s own events', async () => {
    const store = await makeStore({
      events: [{ id: 'e', title: 'Dentist', start: JULY(6, 9), end: JULY(6, 10), color: 'blue' }],
    });
    const { node } = renderAgenda(ctxFor(store, new Date(2026, 6, 1)));
    const rows = [...node.querySelectorAll('.agenda__event')].map((r) => [
      // No-break space before AM/PM (see date-utils) read back as a plain one.
      r.querySelector('.agenda__event-time').textContent.replace(/\u00a0/g, ' '),
      r.querySelector('.agenda__event-title').textContent,
    ]);
    expect(rows).toEqual([
      ['Holiday', 'Independence Day (observed)'],
      ['Holiday', 'Independence Day'],
      ['9 AM – 10 AM', 'Dentist'],
    ]);
    const holidayRow = node.querySelector('.agenda__event--holiday');
    expect(holidayRow.getAttribute('tabindex')).toBe('0');
    expect(holidayRow.getAttribute('role')).toBe('button');
  });

  it('opens the holiday from its row', async () => {
    const store = await makeStore({
      events: [{ id: 'e', title: 'Dentist', start: JULY(6, 9), end: JULY(6, 10), color: 'blue' }],
    });
    const opened = [];
    const ctx = { ...ctxFor(store, new Date(2026, 6, 1)), actions: { ...ACTIONS, openEvent: (e) => opened.push(e) } };
    const { node } = renderAgenda(ctx);
    const row = node.querySelector('.agenda__event--holiday');
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(opened.map((h) => h.title)).toEqual([
      'Independence Day (observed)',
      'Independence Day (observed)',
    ]);
  });

  it('still shows the empty state when holidays are all there is', async () => {
    // "Nothing coming up" is about the user's own agenda; sixty days of
    // holidays is not a fuller answer, and it would cost them the New event
    // button that the empty state exists to offer.
    const store = await makeStore();
    const { node } = renderAgenda(ctxFor(store, new Date(2026, 6, 1)));
    expect(node.querySelector('.empty')).not.toBeNull();
    expect(node.querySelectorAll('.agenda__event--holiday')).toHaveLength(0);
  });
});

describe('what a screen reader hears', () => {
  // Each holiday chip is a button, so it may carry an aria-label — and it
  // must, to be told apart from an event: a bare "Christmas Day" is
  // indistinguishable from one. The label also survives the ≤520px month
  // dot mode, where the visible title is display:none.

  it('names the month chip a public holiday', async () => {
    const store = await makeStore();
    const { node } = renderMonth(ctxFor(store, new Date(2026, 6, 15)));
    const chip = node.querySelector('.chip--holiday');
    expect(chip.getAttribute('aria-label')).toBe('Public holiday: Independence Day (observed)');
    // No hidden duplicate of the title is left over from the label-less days.
    expect(chip.querySelector('.sr-only')).toBeNull();
  });

  it('does the same in the week view\u2019s all-day rail', async () => {
    const store = await makeStore();
    const days = [...Array(7)].map((_, i) => new Date(2026, 5, 28 + i));
    const { node } = renderTimeGrid(days, ctxFor(store, days[0]));
    const chip = node.querySelector('.allday-chip--holiday');
    expect(chip.getAttribute('aria-label')).toBe('Public holiday: Independence Day (observed)');
    expect(chip.querySelector('.sr-only')).toBeNull();
  });

  it('and in the agenda row', async () => {
    const store = await makeStore({
      events: [{ id: 'e', title: 'Dentist', start: JULY(6, 9), end: JULY(6, 10), color: 'blue' }],
    });
    const { node } = renderAgenda(ctxFor(store, new Date(2026, 6, 1)));
    const row = node.querySelector('.agenda__event--holiday');
    expect(row.getAttribute('aria-label')).toBe('Public holiday: Independence Day (observed)');
    // The visible row still reads "Holiday <name>" for everyone else.
    expect(row.textContent).toContain('Holiday');
    expect(row.textContent).toContain('Independence Day');
  });
});

/* ---- Stylesheet --------------------------------------------------------- */

describe('the clickable look survives the cascade', () => {
  // The holiday rules and the base rules they share the file with sit at the
  // same specificity in more than one place, so this checks the resolved
  // value rather than the source: a holiday opens a card on click, and must
  // look like it does — the same pointer cursor as every other chip.
  const css = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/views.css'),
    'utf8',
  );

  function withStylesheet(fn) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    try {
      return fn();
    } finally {
      style.remove();
    }
  }

  it('gives a holiday the pointer cursor in every view that draws one', async () => {
    // One real event, so the agenda lists its days instead of showing the
    // empty state (see above) and there is a holiday row to measure.
    const store = await makeStore({
      events: [{ id: 'e', title: 'Dentist', start: JULY(6, 9), end: JULY(6, 10), color: 'blue' }],
    });
    withStylesheet(() => {
      for (const [label, node] of [
        ['month', renderMonth(ctxFor(store, new Date(2026, 6, 15))).node],
        ['agenda', renderAgenda(ctxFor(store, new Date(2026, 6, 1))).node],
        [
          'week',
          renderTimeGrid(
            [...Array(7)].map((_, i) => new Date(2026, 5, 28 + i)),
            ctxFor(store, new Date(2026, 5, 28)),
          ).node,
        ],
      ]) {
        document.body.append(node);
        const holiday = node.querySelector('.chip--holiday, .agenda__event--holiday, .allday-chip--holiday');
        expect(holiday, label).not.toBeNull();
        expect(getComputedStyle(holiday).cursor, label).toBe('pointer');
        node.remove();
      }
    });
  });

  it('no longer switches the hover response off', () => {
    // The inert-era overrides are gone: a holiday row takes the base row's
    // hover fill, and the chips brighten like any other chip.
    expect(css).not.toMatch(/\.agenda__event\.agenda__event--holiday:hover/);
    expect(css).not.toMatch(/chip--holiday[^{]*\{[^}]*cursor: default/);
  });
});

describe('the default setting', () => {
  it('is "auto", so holidays appear without anyone finding the picker', () => {
    expect(DEFAULT_SETTINGS.holidayCountry).toBe('auto');
  });

  it('resolves through the store for a browser that says Tokyo', async () => {
    clearHolidayCache(); // detection is memoised for the session
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
      resolvedOptions: () => ({ timeZone: 'Asia/Tokyo' }),
    }));
    try {
      const store = await makeStore({ country: 'auto' });
      const items = store.getEventsInRange(
        new Date(2026, 4, 3).getTime(),
        new Date(2026, 4, 7).getTime(),
        { includeHolidays: true },
      );
      expect(titles(items)).toEqual([
        'Constitution Memorial Day',
        'Greenery Day',
        "Children's Day",
        'Constitution Memorial Day (observed)',
      ]);
    } finally {
      vi.restoreAllMocks();
      clearHolidayCache();
    }
  });
});
