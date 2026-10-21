import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/js/store.js';
import { createSampleDataPopulator, sampleCalendar } from '../src/js/demo.js';
import { createOffline } from '../src/js/offline.js';

async function setup() {
  const data = new Map();
  const kv = {
    get: async (key) => data.get(key),
    list: async (pattern) => [...data].filter(([key]) => key.startsWith(pattern.slice(0, -1))).map(([key, value]) => ({ key, value })),
    set: vi.fn(async (key, value) => { data.set(key, structuredClone(value)); }),
  };
  const store = createStore(kv);
  await store.load();
  const session = { store, app: { showDate: vi.fn() } };
  return { kv, store, session, populate: createSampleDataPopulator(() => session) };
}

describe('console sample calendar', () => {
  it('persists events and tasks without altering existing records or preferences', async () => {
    const { store, session, populate } = await setup();
    const existing = await store.saveEvent({ title: 'Existing event', reminders: [10] });
    const settings = store.getSettings();
    const pending = populate();
    expect(populate()).toBe(pending);
    const result = await pending;
    expect(result).toMatchObject({ events: 20, tasks: 5 });
    await store.load();
    expect(store.getAllEvents()).toHaveLength(21);
    expect(store.getAllTasks()).toHaveLength(5);
    expect(store.getEvent(existing.id)).toEqual(existing);
    expect(store.getSettings()).toEqual(settings);
    expect(session.app.showDate).toHaveBeenCalledWith(expect.any(Date), 'week');
    const samples = result.eventIds.map(store.getEvent);
    expect(samples.every(e => e.description.includes('Fictional sample') && !e.guests.length && !e.reminders.length)).toBe(true);
    expect(samples.some(e => e.recurrence?.count === 20)).toBe(true);
    expect(samples.some(e => e.allDay)).toBe(true);
    const second = await populate();
    expect(second.eventIds.some(id => result.eventIds.includes(id))).toBe(false);
  });

  it.each([new Date(2027, 0, 1), new Date(2026, 2, 8), new Date(2026, 10, 1)])('uses local calendar dates around %s', (now) => {
    const { events, tasks } = sampleCalendar(now);
    const focus = events.find(e => e.recurrence);
    expect(new Date(focus.start).getDay()).toBe(1);
    expect(new Date(focus.start).getHours()).toBe(11);
    expect(events.every(e => e.end > e.start)).toBe(true);
    expect(tasks.every(t => new Date(t.due).getHours() === 16)).toBe(true);
  });

  it('rejects when not ready, honors offline gating, and permits a retry after failure', async () => {
    await expect(createSampleDataPopulator(() => null)()).rejects.toThrow('Sign in');
    const { kv, store, session, populate } = await setup();
    const offline = createOffline({ toast: vi.fn(), onReconnectRefresh: async () => true });
    offline.start({ online: false });
    try {
      session.store = offline.gate(store);
      await expect(populate()).rejects.toThrow('after 0 events');
      expect(kv.set).not.toHaveBeenCalled();
    } finally { offline.stop(); }
    session.store = store;
    kv.set.mockRejectedValueOnce(new Error('Connection failed'));
    await expect(populate()).rejects.toThrow('after 0 events');
    expect(store.getAllEvents()).toHaveLength(0);
    expect((await populate()).events).toBe(20);
  });
})
