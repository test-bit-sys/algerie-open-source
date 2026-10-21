import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSearch } from '../src/js/search.js';
import { createStore, normalizeEvent, normalizeTask, DEFAULT_SETTINGS } from '../src/js/store.js';

function makeStore(events, tasks = []) {
  return {
    getAllEvents: () => events,
    getAllTasks: () => tasks,
    // No occurrences within the search's ±400-day window.
    getEventsInRange: () => [],
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
  };
}

/** Minimal async KV backing a real store (mirrors puter.kv's shape). */
function memKv() {
  const map = new Map();
  return {
    set: async (k, v) => { map.set(k, JSON.parse(JSON.stringify(v))); return true; },
    get: async (k) => (map.has(k) ? map.get(k) : null),
    del: async (k) => { map.delete(k); return true; },
    list: async (pattern, returnValues) => {
      const prefix = String(pattern).replace(/\*$/, '');
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix));
      return returnValues ? keys.map((k) => ({ key: k, value: map.get(k) })) : keys;
    },
  };
}

describe('search — recurring series with no windowed occurrence', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('picks a materialized occurrence (with seriesId) rather than the raw master', () => {
    // A daily×10 series that ended years before "now": no occurrence lands in the
    // ±400-day window, so representative() falls back to the nearest occurrence —
    // for an ended series, its MOST RECENT one (not the first).
    const master = normalizeEvent({
      id: 'm1',
      title: 'Old standup',
      start: new Date(2020, 0, 1, 9, 0).getTime(),
      end: new Date(2020, 0, 1, 10, 0).getTime(),
      recurrence: { freq: 'daily', interval: 1, count: 10 },
    });

    const picked = vi.fn();
    const search = createSearch({ store: makeStore([master]), onPick: picked });
    search.open();

    const row = document.querySelector('.search__result');
    expect(row).toBeTruthy();
    row.click();

    expect(picked).toHaveBeenCalledTimes(1);
    const arg = picked.mock.calls[0][0];
    // The picked target routes through the recurring edit path (scope dialog),
    // not the plain-event path — so it must carry the series linkage.
    expect(arg.seriesId).toBe('m1');
    expect(arg.isOccurrence).toBe(true);
    // The 10th (last) daily occurrence, not the first — the most recent one.
    expect(arg.recurrenceId).toBe(new Date(2020, 0, 10, 9, 0).getTime());
  });

  it('dates a long-interval series (every 4 years) by its nearest occurrence, not its first', async () => {
    // Every-4-years series first held 2016; "now" is 2026, so its neighbours
    // (2024, 2028) both fall outside the ±400-day window. It must resolve to the
    // next occurrence (2028), not be stranded/mis-bucketed at 2016.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 16, 12, 0));
    try {
      const store = createStore(memKv());
      await store.load();
      await store.saveEvent({
        title: 'Olympics',
        start: new Date(2016, 6, 15, 9, 0).getTime(),
        end: new Date(2016, 6, 15, 10, 0).getTime(),
        recurrence: { freq: 'yearly', interval: 4 },
      });

      const picked = vi.fn();
      const search = createSearch({ store, onPick: picked });
      search.open();
      document.querySelector('.search__result').click();

      const arg = picked.mock.calls[0][0];
      expect(arg.seriesId).toBeTruthy();
      expect(new Date(arg.recurrenceId).getFullYear()).toBe(2028);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not mis-dated by a per-occurrence all-day override pulling a later occurrence forward', async () => {
    // getEventsInRange sorts all-day events first globally; a future occurrence
    // toggled to all-day must not become the series representative over the
    // nearer timed one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 13, 12, 0)); // Mon
    try {
      const store = createStore(memKv());
      await store.load();
      const m = await store.saveEvent({
        title: 'Weekly sync',
        start: new Date(2026, 6, 15, 9, 0).getTime(), // Wed, 2 days out
        end: new Date(2026, 6, 15, 10, 0).getTime(),
        recurrence: { freq: 'weekly', interval: 1 },
      });
      // Toggle the 3rd occurrence (3 weeks out) to all-day.
      const rid = new Date(2026, 6, 29, 9, 0).getTime();
      await store.updateOccurrence(m.id, rid, {
        allDay: true,
        start: rid,
        end: rid + 24 * 3600_000 - 1,
      });

      const picked = vi.fn();
      const search = createSearch({ store, onPick: picked });
      search.open();
      document.querySelector('.search__result').click();

      const arg = picked.mock.calls[0][0];
      // The nearest occurrence is the timed one 2 days out (Jul 15), not the
      // all-day override 3 weeks out (Jul 29).
      expect(new Date(arg.recurrenceId).getDate()).toBe(15);
      expect(arg.allDay).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('search — ranking of an in-progress recurring event', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('does not demote a currently-running recurring occurrence below a later one-off', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 13, 9, 15, 0)); // Mon 09:15, mid-standup

    const store = createStore(memKv());
    await store.load();
    await store.saveEvent({
      title: 'Standup',
      start: new Date(2026, 6, 1, 9, 0).getTime(),
      end: new Date(2026, 6, 1, 9, 30).getTime(),
      recurrence: { freq: 'daily', interval: 1 },
    });
    await store.saveEvent({
      title: 'Standup later',
      start: new Date(2026, 6, 16, 9, 0).getTime(),
      end: new Date(2026, 6, 16, 10, 0).getTime(),
    });

    const search = createSearch({ store, onPick: () => {} });
    search.open();
    const input = document.querySelector('.search__input');
    input.value = 'standup';
    input.dispatchEvent(new Event('input'));

    const titles = [...document.querySelectorAll('.search__result .search__title')].map((n) => n.textContent);
    // The live occurrence (happening right now) should rank at/above a future one-off,
    // not below it (pre-fix it was bucketed "past" because its start is < now).
    expect(titles).toEqual(['Standup', 'Standup later']);
  });
});

describe('search — empty-state message', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('echoes the query in its original case, not lowercased', () => {
    const ev = normalizeEvent({
      id: 'e1',
      title: 'Team lunch',
      start: new Date(2026, 6, 13, 12, 0).getTime(),
      end: new Date(2026, 6, 13, 13, 0).getTime(),
    });
    const search = createSearch({ store: makeStore([ev]), onPick: () => {} });
    search.open();

    const input = document.querySelector('.search__input');
    input.value = 'Zürich'; // no match; mixed case with a non-ASCII letter
    input.dispatchEvent(new Event('input'));

    const empty = document.querySelector('.search__empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('Zürich'); // preserves the typed casing
    expect(empty.textContent).not.toContain('zürich'); // never the lowercased form
  });
});

describe('search — per-occurrence override text', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('finds an occurrence renamed via a "this event" edit', async () => {
    // Regression: the index only carried the series master's text, so an
    // occurrence retitled with scope "This event" was visible on the calendar
    // but unfindable in search.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 16, 12, 0));
    try {
      const store = createStore(memKv());
      await store.load();
      const m = await store.saveEvent({
        title: 'Team sync',
        start: new Date(2026, 6, 13, 9, 0).getTime(),
        end: new Date(2026, 6, 13, 9, 30).getTime(),
        recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      });
      const rid = new Date(2026, 6, 20, 9, 0).getTime();
      await store.updateOccurrence(m.id, rid, { title: 'Budget review with CFO' });

      const picked = vi.fn();
      const search = createSearch({ store, onPick: picked });
      search.open();
      const input = document.querySelector('.search__input');
      input.value = 'budget';
      input.dispatchEvent(new Event('input'));

      const rows = [...document.querySelectorAll('.search__result .search__title')];
      expect(rows.map((n) => n.textContent)).toEqual(['Budget review with CFO']);

      document.querySelector('.search__result').click();
      const arg = picked.mock.calls[0][0];
      expect(arg.seriesId).toBe(m.id);
      expect(arg.recurrenceId).toBe(rid); // the renamed occurrence itself
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('search — IME composition', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores Enter/Escape pressed to commit or cancel a composition', () => {
    const ev = normalizeEvent({
      id: 'e1',
      title: 'Team lunch',
      start: new Date(2026, 6, 13, 12, 0).getTime(),
      end: new Date(2026, 6, 13, 13, 0).getTime(),
    });
    const picked = vi.fn();
    const search = createSearch({ store: makeStore([ev]), onPick: picked });
    search.open();

    const input = document.querySelector('.search__input');
    // Enter during composition commits text — it must not pick a result.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    expect(picked).not.toHaveBeenCalled();
    expect(search.isOpen()).toBe(true);

    // Escape during composition cancels the composition — not the palette.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
    );
    expect(search.isOpen()).toBe(true);

    // A real Enter still picks.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(picked).toHaveBeenCalledTimes(1);
  });
});

describe('search — exdated override slots stay hidden', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not surface an override whose slot is also exdated (foreign data)', () => {
    // Imported ICS can carry an override AND an exdate for the same slot; the
    // calendar never renders it, so search must not offer a phantom result
    // (picking it and saving would strip the exdate and resurrect the slot).
    const rid = new Date(2026, 6, 20, 9, 0).getTime();
    const master = normalizeEvent({
      id: 'm-ex',
      title: 'Team sync',
      start: new Date(2026, 6, 13, 9, 0).getTime(),
      end: new Date(2026, 6, 13, 9, 30).getTime(),
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
      exdates: [rid],
      overrides: { [rid]: { title: 'Budget review with CFO' } },
    });
    const search = createSearch({ store: makeStore([master]), onPick: () => {} });
    search.open();
    const input = document.querySelector('.search__input');
    input.value = 'budget';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.search__result')).toHaveLength(0);
  });
});

describe('search — tasks', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function query(text) {
    const input = document.querySelector('.search__input');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  it('finds a task saved through the real store and opens the stored task', async () => {
    // The reported bug: create a task "Task Test", search "Task Test", get
    // "No events match" — tasks live in their own store map and never came
    // through getAllEvents.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 11, 12, 0));
    try {
      const store = createStore(memKv());
      await store.load();
      const due = new Date(2026, 8, 14, 15, 0).getTime();
      const saved = await store.saveTask({ title: 'Task Test', due });

      const picked = vi.fn();
      const search = createSearch({ store, onPick: picked });
      search.open();
      query('Task Test');

      const rows = [...document.querySelectorAll('.search__result')];
      expect(rows).toHaveLength(1);
      expect(rows[0].querySelector('.search__title').textContent).toBe('Task Test');
      expect(rows[0].classList.contains('search__result--task')).toBe(true);
      expect(rows[0].querySelector('.search__check')).toBeTruthy();
      expect(rows[0].querySelector('.search__meta').textContent).toMatch(/3\s*PM/);

      rows[0].click();
      expect(picked).toHaveBeenCalledTimes(1);
      const arg = picked.mock.calls[0][0];
      // The stored task itself (not a display shim): the card/editor read
      // `due`, and the app routes by `isTask`.
      expect(arg).toEqual(saved);
      expect(arg.isTask).toBe(true);
      expect(arg.due).toBe(due);
      expect(arg.start).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches a task by its notes, labels all-day tasks "To-do", and marks done ones', () => {
    const t1 = normalizeTask({
      id: 't1',
      title: 'Renew passport',
      notes: 'Bring two photos and the old booklet',
      due: new Date(2026, 8, 20, 0, 0).getTime(),
      allDay: true,
    });
    const t2 = normalizeTask({
      id: 't2',
      title: 'File expenses',
      due: new Date(2026, 8, 10, 9, 0).getTime(),
      done: true,
    });
    const search = createSearch({ store: makeStore([], [t1, t2]), onPick: () => {} });
    search.open();

    query('booklet'); // only in t1's notes
    let rows = [...document.querySelectorAll('.search__result')];
    expect(rows.map((r) => r.querySelector('.search__title').textContent)).toEqual(['Renew passport']);
    expect(rows[0].querySelector('.search__meta').textContent).toContain('To-do');
    expect(rows[0].classList.contains('is-done')).toBe(false);

    query('expenses');
    rows = [...document.querySelectorAll('.search__result')];
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains('is-done')).toBe(true);
    expect(rows[0].querySelector('.search__check.is-checked')).toBeTruthy();
    expect(rows[0].querySelector('.search__meta').textContent).toContain('Done');
  });

  it('lists tasks alongside events and ranks by title match then time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 11, 12, 0));
    const ev = normalizeEvent({
      id: 'e1',
      title: 'Budget review',
      start: new Date(2026, 8, 12, 10, 0).getTime(),
      end: new Date(2026, 8, 12, 11, 0).getTime(),
    });
    const task = normalizeTask({
      id: 't1',
      title: 'Budget draft',
      due: new Date(2026, 8, 11, 17, 0).getTime(), // sooner than the event
    });
    const search = createSearch({ store: makeStore([ev], [task]), onPick: () => {} });
    search.open();
    query('budget');
    const titles = [...document.querySelectorAll('.search__result .search__title')].map((n) => n.textContent);
    // Both are title-prefix matches and both upcoming, so the sooner one leads.
    expect(titles).toEqual(['Budget draft', 'Budget review']);
  });

  it('wording of the empty state covers tasks', () => {
    const search = createSearch({ store: makeStore([], []), onPick: () => {} });
    search.open();
    expect(document.querySelector('.search__empty').textContent).toBe('Nothing to search yet');
    search.close();

    const task = normalizeTask({ id: 't1', title: 'Water plants', due: Date.now() });
    const s2 = createSearch({ store: makeStore([], [task]), onPick: () => {} });
    s2.open();
    query('zzz');
    expect(document.querySelector('.search__empty').textContent).toBe('No events or tasks match “zzz”');
  });
});
