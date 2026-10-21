/**
 * Reminder checks against stubbed browser globals: a granted Notification
 * permission and a Map-backed localStorage, which is all the module needs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { checkReminders } from '../src/lib/reminders.js';

let shown;

function installBrowserStubs() {
  shown = [];
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  class FakeNotification {
    static permission = 'granted';
    constructor(title, options) {
      shown.push({ title, body: options?.body });
    }
    close() {}
  }
  globalThis.window = globalThis;
  globalThis.Notification = FakeNotification;
}

const task = (over = {}) => ({
  id: 't1', title: 'Call Mei', due: '2026-08-04', dueTime: '', done: false, ...over,
});

/** Just enough store for the reminder check. */
const fakeStore = (tasks, settings = { notifications: true }) => ({
  settings,
  openTasks: () => tasks.filter((t) => !t.done),
});

const at = (h, m = 0) => new Date(2026, 7, 4, h, m);

beforeEach(installBrowserStubs);

describe('checkReminders', () => {
  it('does nothing when the setting is off', () => {
    const s = fakeStore([task({ due: '2026-08-01' })], { notifications: false });
    expect(checkReminders(s, at(9))).toBe(0);
    expect(shown).toEqual([]);
  });

  it('sends one digest per day covering overdue and due-today', () => {
    const s = fakeStore([
      task({ id: 'a', due: '2026-08-01' }),
      task({ id: 'b', due: '2026-08-04' }),
      task({ id: 'c', due: '2026-08-09' }),
    ]);
    expect(checkReminders(s, at(9))).toBe(1);
    expect(shown[0]).toMatchObject({ title: 'Follow-ups need you', body: '1 overdue · 1 due today' });

    // Same day again: already announced.
    expect(checkReminders(s, at(11))).toBe(0);
    expect(shown).toHaveLength(1);
  });

  it('stays quiet when nothing is due', () => {
    expect(checkReminders(fakeStore([task({ due: '2026-09-01' })]), at(9))).toBe(0);
    expect(shown).toEqual([]);
  });

  it('fires a timed follow-up once, at its hour', () => {
    const s = fakeStore([task({ due: '2026-08-04', dueTime: '14:00' })]);
    // 9am: the digest mentions it, the timed reminder is not due yet.
    checkReminders(s, at(9));
    expect(shown).toHaveLength(1);

    checkReminders(s, at(13, 59));
    expect(shown).toHaveLength(1);

    checkReminders(s, at(14, 0));
    expect(shown).toHaveLength(2);
    // The same clock the UI uses, not the stored 24-hour value.
    expect(shown[1]).toMatchObject({ title: 'Call Mei', body: 'Due at 2pm' });

    checkReminders(s, at(15));
    expect(shown).toHaveLength(2);
  });

  it('leaves yesterday’s timed follow-ups to the digest', () => {
    const s = fakeStore([task({ due: '2026-08-03', dueTime: '14:00' })]);
    checkReminders(s, at(16));
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Follow-ups need you');
  });

  it('does not dump a backlog of timed reminders at once', () => {
    const s = fakeStore(Array.from({ length: 8 }, (_, i) =>
      task({ id: `t${i}`, due: '2026-08-04', dueTime: '08:00' })));
    expect(checkReminders(s, at(9))).toBe(3);
  });
});
