import { describe, it, expect, beforeAll, vi } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';

let reminderFireAt, missedReminders, describeReminder, catchUpMissedReminders,
  scheduleTaskReminders, normalizeTask;

beforeAll(async () => {
  installMockPuter();
  ({ reminderFireAt, missedReminders, describeReminder, catchUpMissedReminders, scheduleTaskReminders } =
    await import('../src/lib/reminders.js'));
  ({ normalizeTask } = await import('../src/lib/store.js'));
});

const at = (iso, hh, mm) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
};

describe('reminderFireAt', () => {
  it('fires at the due time for offset 0', () => {
    const t = normalizeTask({ title: 'x', due: '2026-08-10', dueTime: '14:30', reminder: 0 });
    expect(reminderFireAt(t)).toBe(at('2026-08-10', 14, 30));
  });

  it('subtracts the offset', () => {
    const t = normalizeTask({ title: 'x', due: '2026-08-10', dueTime: '14:30', reminder: 60 });
    expect(reminderFireAt(t)).toBe(at('2026-08-10', 13, 30));
  });

  it('anchors all-day tasks to 09:00', () => {
    const t = normalizeTask({ title: 'x', due: '2026-08-10', reminder: 1440 });
    expect(reminderFireAt(t)).toBe(at('2026-08-09', 9, 0));
  });

  it('is null without a reminder, without a date, or when done', () => {
    expect(reminderFireAt(normalizeTask({ title: 'x', due: '2026-08-10' }))).toBeNull();
    expect(reminderFireAt(normalizeTask({ title: 'x', reminder: 10 }))).toBeNull();
    expect(reminderFireAt(normalizeTask({ title: 'x', due: '2026-08-10', reminder: 10, done: true }))).toBeNull();
  });
});

describe('reminder normalization', () => {
  it('keeps valid offsets and floors fractions', () => {
    expect(normalizeTask({ title: 'x', due: '2026-08-10', reminder: 10.7 }).reminder).toBe(10);
    expect(normalizeTask({ title: 'x', due: '2026-08-10', reminder: 0 }).reminder).toBe(0);
  });

  it('drops the reminder without a due date and rejects junk', () => {
    expect(normalizeTask({ title: 'x', reminder: 10 }).reminder).toBeNull();
    expect(normalizeTask({ title: 'x', due: '2026-08-10', reminder: '10' }).reminder).toBeNull();
    expect(normalizeTask({ title: 'x', due: '2026-08-10', reminder: -5 }).reminder).toBeNull();
    expect(normalizeTask({ title: 'x', due: '2026-08-10' }).reminder).toBeNull();
  });
});

describe('missedReminders', () => {
  // Tasks must predate their own fire time to count as missed, so the
  // fixtures pin createdAt instead of inheriting "now" — otherwise every
  // case here silently stops selecting anything once the wall clock
  // passes the due dates below.
  const mk = (over) => normalizeTask({ title: over.title || 'x', createdAt: at('2026-08-01', 0, 0), ...over });

  it('selects only fire times inside (since, now], oldest first', () => {
    const tasks = [
      mk({ title: 'inside', due: '2026-08-10', dueTime: '10:00', reminder: 0 }),
      mk({ title: 'later inside', due: '2026-08-10', dueTime: '11:00', reminder: 0 }),
      mk({ title: 'before window', due: '2026-08-10', dueTime: '08:00', reminder: 0 }),
      mk({ title: 'future', due: '2026-08-10', dueTime: '18:00', reminder: 0 }),
      mk({ title: 'no reminder', due: '2026-08-10', dueTime: '10:30' }),
    ];
    const missed = missedReminders(tasks, at('2026-08-10', 9, 0), at('2026-08-10', 12, 0));
    expect(missed.map((m) => m.task.title)).toEqual(['inside', 'later inside']);
  });

  it('skips reminders already in the fired ledger', () => {
    const t = mk({ title: 'once', due: '2026-08-10', dueTime: '10:00', reminder: 0 });
    const fireAt = at('2026-08-10', 10, 0);
    const fired = { [`${t.id}@${fireAt}`]: Date.now() };
    expect(missedReminders([t], at('2026-08-10', 9, 0), at('2026-08-10', 12, 0), fired)).toHaveLength(0);
  });

  it('never reports a task created after its own fire time', () => {
    const since = at('2026-08-10', 9, 0);
    const now = at('2026-08-10', 15, 0);
    const late = mk({ title: 'added at 14:00', due: '2026-08-10', dueTime: '10:00', reminder: 0, createdAt: at('2026-08-10', 14, 0) });
    expect(missedReminders([late], since, now)).toHaveLength(0);
    const existed = mk({ title: 'existed', due: '2026-08-10', dueTime: '10:00', reminder: 0, createdAt: at('2026-08-09', 8, 0) });
    expect(missedReminders([existed], since, now)).toHaveLength(1);
  });
});

describe('catchUpMissedReminders', () => {
  it('consumes reminders only when the notification was actually shown', async () => {
    const t = normalizeTask({
      title: 'x', due: '2026-08-10', dueTime: '10:00', reminder: 0,
      createdAt: at('2026-08-09', 8, 0),
    });
    const store = { settings: { reminders: true }, tasks: [t] };
    const window = [String(at('2026-08-10', 9, 0)), { now: at('2026-08-10', 12, 0) }];

    try {
      // Platform where new Notification() throws (and no service worker):
      // the reminder must stay unclaimed, not vanish silently.
      globalThis.Notification = class {
        static permission = 'granted';
        constructor() { throw new Error('only workers may notify'); }
      };
      localStorage.setItem('tasks:lastReminderCheck', window[0]);
      expect(await catchUpMissedReminders(store, window[1])).toBeNull();
      expect(localStorage.getItem('tasks:firedReminders:v1')).toBeNull();

      // Working platform: shown once, then claimed in the ledger.
      const shown = [];
      globalThis.Notification = class {
        static permission = 'granted';
        constructor(title) { shown.push(title); }
      };
      localStorage.setItem('tasks:lastReminderCheck', window[0]);
      expect(await catchUpMissedReminders(store, window[1])).toEqual({ missed: 1 });
      expect(shown).toHaveLength(1);
      expect(localStorage.getItem('tasks:firedReminders:v1')).toContain(t.id);
    } finally {
      delete globalThis.Notification;
      localStorage.removeItem('tasks:lastReminderCheck');
      localStorage.removeItem('tasks:firedReminders:v1');
    }
  });
});

describe('fired ledger vs the catch-up window', () => {
  it('a tab left open for over a week does not re-announce what it already showed', async () => {
    const shown = [];
    const boot = at('2026-08-01', 8, 0);
    // Fires an hour after boot, and again nine days later: the second
    // firing is what prunes the first one's ledger entry.
    const early = normalizeTask({
      title: 'early standup', due: '2026-08-01', dueTime: '09:00', reminder: 0,
      createdAt: at('2026-07-30', 8, 0),
    });
    const late = normalizeTask({
      title: 'late standup', due: '2026-08-10', dueTime: '09:00', reminder: 0,
      createdAt: at('2026-07-30', 8, 0),
    });
    const store = {
      settings: { reminders: true },
      tasks: [early, late],
      taskById: (id) => store.tasks.find((t) => t.id === id) || null,
    };

    vi.useFakeTimers();
    try {
      globalThis.Notification = class {
        static permission = 'granted';
        constructor(title) { shown.push(title); }
      };
      vi.setSystemTime(boot);
      // Boot: the checkpoint is set here and never moves again — the tab
      // stays visible, so nothing calls catch-up until day nine.
      localStorage.setItem('tasks:lastReminderCheck', String(boot));
      scheduleTaskReminders(store);
      await vi.advanceTimersByTimeAsync(2 * 3600000); // early fires
      expect(shown).toEqual(['Reminder: early standup']);

      // Nine days of an open tab: the horizon timer re-arms itself and
      // the second reminder fires, marking (and pruning) the ledger.
      await vi.advanceTimersByTimeAsync(9 * 86400000);
      expect(shown).toEqual(['Reminder: early standup', 'Reminder: late standup']);

      // The tab is finally backgrounded and brought back: catch-up looks
      // back to the checkpoint, which still sits at boot.
      vi.useRealTimers();
      await catchUpMissedReminders(store, { now: at('2026-08-10', 12, 0) });
      expect(shown).toEqual(['Reminder: early standup', 'Reminder: late standup']);
    } finally {
      vi.useRealTimers();
      delete globalThis.Notification;
      localStorage.removeItem('tasks:lastReminderCheck');
      localStorage.removeItem('tasks:firedReminders:v1');
    }
  });
});

describe('describeReminder', () => {
  it('labels presets and derives the rest', () => {
    expect(describeReminder(0)).toBe('At due time');
    expect(describeReminder(1440)).toBe('1 day before');
    expect(describeReminder(2880)).toBe('2 days before');
    expect(describeReminder(120)).toBe('2 hours before');
    expect(describeReminder(45)).toBe('45 minutes before');
  });
});
