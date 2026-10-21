import { describe, it, expect } from 'vitest';
import { normalizeEvent, createStore } from '../src/js/store.js';

/** In-memory kv (the same stand-in shape the other store tests use). */
function makeKv() {
  const map = new Map();
  return {
    map,
    async set(k, v) {
      const items = Array.isArray(k) ? k : [{ key: k, value: v }];
      for (const { key, value } of items) map.set(key, JSON.parse(JSON.stringify(value)));
    },
    async get(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async del(k) {
      map.delete(k);
    },
    async list(pattern, values) {
      const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const keys = [...map.keys()].filter((k) => re.test(k));
      return values ? keys.map((k) => ({ key: k, value: map.get(k) })) : keys;
    },
  };
}

describe('store: booking field on events', () => {
  it('is absent by default — existing events keep their exact stored shape', () => {
    const ev = normalizeEvent({ title: 'Plain', start: 1, end: 2 });
    expect('booking' in ev).toBe(false);
  });

  it('keeps a valid booking ref, normalized', () => {
    const ev = normalizeEvent({
      title: 'Booked',
      start: 1,
      end: 2,
      booking: {
        id: 'abc123def456',
        pageId: 'ab12cd34ef',
        pageTitle: '  Office hours  ',
        name: 'Ada',
        email: 'ADA@Example.com',
      },
    });
    expect(ev.booking).toEqual({
      id: 'abc123def456',
      pageId: 'ab12cd34ef',
      pageTitle: 'Office hours',
      name: 'Ada',
      email: 'ada@example.com',
    });
  });

  it('drops malformed refs (bad id, garbage) instead of storing them', () => {
    expect('booking' in normalizeEvent({ start: 1, end: 2, booking: { id: 'NOT VALID' } })).toBe(false);
    expect('booking' in normalizeEvent({ start: 1, end: 2, booking: 'abc123def456' })).toBe(false);
    expect('booking' in normalizeEvent({ start: 1, end: 2, booking: { pageId: 'x' } })).toBe(false);
  });

  it('survives an edit round-trip and is cleared by booking: null', async () => {
    const store = createStore(makeKv());
    await store.load();
    const ev = await store.saveEvent({
      title: 'Booked',
      start: 1000,
      end: 2000,
      booking: { id: 'abc123def456', email: 'ada@example.com' },
    });
    // A later edit that doesn't mention booking keeps it (…existing spread).
    const edited = await store.saveEvent({ id: ev.id, title: 'Renamed' });
    expect(edited.booking).toEqual({ id: 'abc123def456', email: 'ada@example.com' });
    // Explicitly nulling it (what Duplicate does) removes it.
    const cleared = await store.saveEvent({ id: ev.id, booking: null });
    expect('booking' in cleared).toBe(false);
  });
});
