import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
let store, KV_KEYS, normalizeTask, compareTasks, sampleDataset;

beforeAll(async () => {
  mock = installMockPuter();
  // Import after the mock exists: the store module touches window/localStorage.
  ({ store, KV_KEYS, normalizeTask, compareTasks } = await import('../src/lib/store.js'));
  ({ sampleDataset } = await import('../src/lib/sample.js'));
});

beforeEach(async () => {
  mock.reset();
  await store.wipeAll();
});

describe('lists', () => {
  it('creates, updates, and deletes lists (cascading tasks)', async () => {
    const list = await store.addList({ name: 'Errands', icon: 'shopping-cart', slot: 2 });
    expect(store.listById(list.id).name).toBe('Errands');

    await store.addTask({ listId: list.id, title: 'Buy milk' });
    expect(store.openTasks(list.id)).toHaveLength(1);

    await store.updateList(list.id, { name: 'Errands & Groceries' });
    expect(store.listById(list.id).name).toBe('Errands & Groceries');

    await store.deleteList(list.id);
    expect(store.listById(list.id)).toBeNull();
    expect(store.tasks.filter((t) => t.listId === list.id)).toHaveLength(0);
  });

  it('deleting a list writes its tasks out before the list tombstone', async () => {
    const list = await store.addList({ name: 'Doomed' });
    await store.addTask({ listId: list.id, title: 'Goes with it' });
    await store.updateSettings({ defaultListId: list.id });

    const order = [];
    const orig = puter.kv.set.bind(puter.kv);
    puter.kv.set = (key, val) => { order.push(key); return orig(key, val); };
    try {
      await store.deleteList(list.id);
    } finally {
      puter.kv.set = orig;
    }

    // The tab can close between the two writes. Tasks first leaves an
    // empty list; the other order strands tasks under a list tombstone.
    expect(order.indexOf(KV_KEYS.items)).toBeLessThan(order.indexOf(KV_KEYS.lists));
    // The default-list reset reaches the cloud too, not just memory.
    const settings = await puter.kv.get(KV_KEYS.settings);
    expect(settings.data.defaultListId).toBeNull();
  });

  it('still queues the list tombstone when the tasks write is rejected', async () => {
    const list = await store.addList({ name: 'Doomed' });
    await store.addTask({ listId: list.id, title: 'Goes with it' });

    // A full cloud rejects the first of the two writes. Abandoning the rest
    // of the sequence left the delete on this device only — the list, and
    // its tasks, came back the next time another device read the cloud.
    const orig = puter.kv.set.bind(puter.kv);
    puter.kv.set = async (key, val) => {
      if (key === KV_KEYS.items) throw new Error('storage quota exceeded');
      return orig(key, val);
    };
    await expect(store.deleteList(list.id)).rejects.toThrow();
    puter.kv.set = orig;

    const lists = await puter.kv.get(KV_KEYS.lists);
    expect(lists.data.lists).toHaveLength(0);
    expect(lists.data.deleted.map((d) => d.id)).toContain(list.id);
    // The rejected write is still queued, so the deletion converges.
    expect(store.pendingWrites()).toBe(1);
  });

  it('keeps color slots whole and in range (they style var(--slot-N))', async () => {
    expect((await store.addList({ name: 'A', slot: 2.5 })).slot).toBe(2);
    expect((await store.addList({ name: 'B', slot: 42 })).slot).toBe(8);
    expect((await store.addList({ name: 'C', slot: 'garbage' })).slot).toBe(1);
    expect((await store.addList({ name: 'D', slot: 0.25 })).slot).toBe(1);
  });

  it('persists to KV so a fresh init sees the data', async () => {
    const list = await store.addList({ name: 'Persisted' });
    await store.addTask({ listId: list.id, title: 'Survives reload' });
    await store.init();
    expect(store.listById(list.id)?.name).toBe('Persisted');
    expect(store.tasks.some((t) => t.title === 'Survives reload')).toBe(true);
  });
});

describe('tasks', () => {
  let list;
  beforeEach(async () => {
    list = await store.addList({ name: 'Inbox' });
  });

  it('requires a title', async () => {
    await expect(store.addTask({ listId: list.id, title: '   ' })).rejects.toThrow(/title/i);
  });

  it('normalizes junk fields instead of storing them', async () => {
    const t = await store.addTask({
      listId: list.id, title: 'X', due: 'garbage', dueTime: '99x', priority: 42,
      subtasks: [{ title: '  ' }, { title: 'ok' }],
    });
    expect(t.due).toBeNull();
    expect(t.dueTime).toBeNull();
    expect(t.priority).toBe(0);
    expect(t.subtasks).toHaveLength(1);
  });

  it('drops a due time when there is no due date', async () => {
    const t = await store.addTask({ listId: list.id, title: 'Timed', dueTime: '10:00' });
    expect(t.dueTime).toBeNull();

    const dated = await store.addTask({
      listId: list.id, title: 'Dated', due: '2026-08-10', dueTime: '10:00',
    });
    expect(dated.dueTime).toBe('10:00');
    // Clearing the date via edit clears the time with it.
    await store.updateTask(dated.id, { due: null });
    expect(store.taskById(dated.id).dueTime).toBeNull();
  });

  it('never creates orphaned tasks: stale or missing lists fall back', async () => {
    // Stale list id (list deleted between form open and save).
    const t1 = await store.addTask({ listId: 'gone-list', title: 'Stale ref' });
    expect(store.listById(t1.listId)).not.toBeNull();

    // No lists at all (right after a full wipe).
    await store.wipeAll();
    const t2 = await store.addTask({ title: 'First task ever' });
    expect(store.lists.length).toBeGreaterThanOrEqual(1);
    expect(store.listById(t2.listId).name).toBe('Personal');
  });

  it('completes and un-completes a plain task', async () => {
    const t = await store.addTask({ listId: list.id, title: 'One-off' });
    const res = await store.completeTask(t.id);
    expect(res.recurred).toBe(false);
    expect(store.taskById(t.id).done).toBe(true);
    expect(store.taskById(t.id).completedAt).toBeTruthy();

    await store.uncompleteTask(t.id);
    expect(store.taskById(t.id).done).toBe(false);
    expect(store.taskById(t.id).completedAt).toBeNull();
  });

  it('deletes and restores (undo)', async () => {
    const t = await store.addTask({ listId: list.id, title: 'Oops' });
    const copy = { ...t };
    await store.deleteTask(t.id);
    expect(store.taskById(t.id)).toBeNull();
    await store.restoreTask(copy);
    expect(store.taskById(t.id).title).toBe('Oops');
  });
});

describe('recurring tasks', () => {
  let list;
  beforeEach(async () => {
    list = await store.addList({ name: 'Chores' });
  });

  it('completing logs the occurrence and rolls the task forward', async () => {
    const t = await store.addTask({
      listId: list.id, title: 'Water plants', due: '2026-08-04',
      repeat: { freq: 'daily', interval: 3, mode: 'due' },
      subtasks: [{ title: 'Kitchen', done: true }],
    });
    const res = await store.completeTask(t.id, { today: '2026-08-04' });
    expect(res.recurred).toBe(true);
    expect(res.next).toBe('2026-08-07');

    const rolled = store.taskById(t.id);
    expect(rolled.done).toBe(false);
    expect(rolled.due).toBe('2026-08-07');
    expect(rolled.subtasks[0].done).toBe(false); // checklist reset

    const logged = store.tasks.filter((x) => x.recurringOf === t.id);
    expect(logged).toHaveLength(1);
    expect(logged[0].done).toBe(true);
    expect(logged[0].repeat).toBeNull();

    // undoId names the logged occurrence, so the toast's Undo can reverse
    // the roll-forward with uncompleteTask like any plain completion.
    expect(res.undoId).toBe(logged[0].id);
    await store.uncompleteTask(res.undoId);
    expect(store.taskById(t.id).due).toBe('2026-08-04');
    expect(store.tasks.filter((x) => x.recurringOf === t.id)).toHaveLength(0);
  });

  it('a monthly task on the 31st comes back to the 31st after February', async () => {
    const t = await store.addTask({
      listId: list.id, title: 'Pay rent', due: '2027-01-31',
      repeat: { freq: 'monthly', interval: 1, mode: 'due' },
    });
    // Creation stamps the intended day on the rule.
    expect(store.taskById(t.id).repeat.day).toBe(31);
    await store.completeTask(t.id, { today: '2027-01-31' });
    expect(store.taskById(t.id).due).toBe('2027-02-28'); // clamped
    await store.completeTask(t.id, { today: '2027-02-28' });
    expect(store.taskById(t.id).due).toBe('2027-03-31'); // recovered, not the 28th

    // A deliberate reschedule re-points the anchor…
    await store.updateTask(t.id, { due: '2027-04-15' });
    expect(store.taskById(t.id).repeat.day).toBe(15);
    // …and quick-reschedules do the same.
    await store.rescheduleTasks([t.id], '2027-04-20');
    expect(store.taskById(t.id).repeat.day).toBe(20);
  });

  it('undoing a recurring completion rolls back instead of duplicating', async () => {
    const t = await store.addTask({
      listId: list.id, title: 'Water plants', due: '2026-08-04',
      repeat: { freq: 'daily', interval: 3, mode: 'due' },
      subtasks: [{ title: 'Kitchen', done: true }, { title: 'Balcony', done: false }],
    });
    await store.completeTask(t.id, { today: '2026-08-04' });
    const logged = store.tasks.find((x) => x.recurringOf === t.id);

    await store.uncompleteTask(logged.id);

    // The occurrence is gone, the source is back on its original date with
    // its pre-completion checklist, and there is exactly one copy.
    expect(store.taskById(logged.id)).toBeNull();
    const source = store.taskById(t.id);
    expect(source.due).toBe('2026-08-04');
    expect(source.repeat).not.toBeNull();
    expect(source.subtasks.map((s) => s.done)).toEqual([true, false]);
    expect(store.tasks.filter((x) => x.title === 'Water plants')).toHaveLength(1);
  });

  it('undoing an orphaned occurrence (source deleted) reopens it standalone', async () => {
    const t = await store.addTask({
      listId: list.id, title: 'Stretch', due: '2026-08-04',
      repeat: { freq: 'daily', interval: 1, mode: 'due' },
    });
    await store.completeTask(t.id, { today: '2026-08-04' });
    const logged = store.tasks.find((x) => x.recurringOf === t.id);
    await store.deleteTask(t.id);

    await store.uncompleteTask(logged.id);
    expect(store.taskById(logged.id).done).toBe(false);
  });

  it('skipping advances without logging a completion', async () => {
    const t = await store.addTask({
      listId: list.id, title: 'Weekly review', due: '2026-08-07',
      repeat: { freq: 'weekly', interval: 1, weekdays: [5], mode: 'due' },
    });
    const next = await store.skipOccurrence(t.id, { today: '2026-08-04' });
    expect(next).toBe('2026-08-14');
    expect(store.tasks.filter((x) => x.recurringOf === t.id)).toHaveLength(0);
  });
});

describe('normalizeTask — hostile field values', () => {
  const mk = (over) => normalizeTask({ title: 'x', listId: 'l', ...over });

  it('drops impossible calendar dates, not just malformed shapes', () => {
    expect(mk({ due: '2026-13-45' }).due).toBeNull();
    expect(mk({ due: '2026-02-30' }).due).toBeNull();
    expect(mk({ due: '0099-05-05' }).due).toBeNull(); // 2-digit-year Date pitfall
    expect(mk({ due: '2028-02-29' }).due).toBe('2028-02-29'); // real leap day
  });

  it('drops impossible wall-clock times', () => {
    expect(mk({ due: '2026-08-05', dueTime: '99:99' }).dueTime).toBeNull();
    expect(mk({ due: '2026-08-05', dueTime: '24:00' }).dueTime).toBeNull();
    expect(mk({ due: '2026-08-05', dueTime: '23:59' }).dueTime).toBe('23:59');
  });

  it('keeps completedAt only when it is a real epoch timestamp', () => {
    expect(mk({ done: true, completedAt: 'whenever' }).completedAt).toBeNull();
    expect(mk({ done: true, completedAt: 1e21 }).completedAt).toBeNull(); // Invalid Date
    const at = Date.now();
    expect(mk({ done: true, completedAt: at }).completedAt).toBe(at);
    expect(mk({ done: true, completedAt: String(at) }).completedAt).toBe(at);
  });
});

describe('ordering', () => {
  it('sorts dated before undated, then by date, time, and priority', () => {
    const mk = (over) => normalizeTask({ title: 'x', listId: 'l', ...over });
    const undated = mk({ order: 1 });
    const laterDay = mk({ due: '2026-08-06', order: 2 });
    const soonHigh = mk({ due: '2026-08-05', priority: 3, order: 3 });
    const soonLow = mk({ due: '2026-08-05', priority: 1, order: 4 });
    const timed = mk({ due: '2026-08-05', dueTime: '09:00', priority: 0, order: 5 });

    const sorted = [undated, laterDay, soonLow, soonHigh, timed].sort(compareTasks);
    expect(sorted.map((t) => t.order)).toEqual([5, 3, 4, 2, 1]);
  });
});

describe('archiving', () => {
  it('moves old completions to monthly fs files and out of the hot doc', async () => {
    const list = await store.addList({ name: 'History' });
    const now = Date.now();
    const old = now - 40 * 86400000;
    await store.addTask({ listId: list.id, title: 'Ancient', done: true, completedAt: old });
    await store.addTask({ listId: list.id, title: 'Recent', done: true, completedAt: now });

    const moved = await store.archiveOldCompleted({ now });
    expect(moved).toBe(1);
    expect(store.tasks.some((t) => t.title === 'Ancient')).toBe(false);
    expect(store.tasks.some((t) => t.title === 'Recent')).toBe(true);
    expect(store.logMonths).toHaveLength(1);

    const logged = await store.loadLog(store.logMonths[0]);
    expect(logged.some((t) => t.title === 'Ancient')).toBe(true);

    // Re-running is a no-op (no duplicates).
    expect(await store.archiveOldCompleted({ now })).toBe(0);
  });

  it('a task reopened mid-sweep stays in the hot doc instead of vanishing', async () => {
    const list = await store.addList({ name: 'History' });
    const now = Date.now();
    const t = await store.addTask({
      listId: list.id, title: 'Reopen me', done: true, completedAt: now - 40 * 86400000,
    });

    // Reopen the task while the sweep is between its fs round-trips.
    const origRead = puter.fs.read.bind(puter.fs);
    let fired = false;
    puter.fs.read = async (...a) => {
      if (!fired) { fired = true; await store.uncompleteTask(t.id); }
      return origRead(...a);
    };
    try {
      await store.archiveOldCompleted({ now });
    } finally {
      puter.fs.read = origRead;
    }

    const kept = store.taskById(t.id);
    expect(kept).not.toBeNull();
    expect(kept.done).toBe(false);
  });

  it('a transient read failure skips the sweep instead of clobbering the archive', async () => {
    const list = await store.addList({ name: 'History' });
    const now = Date.now();
    await store.addTask({ listId: list.id, title: 'First archived', done: true, completedAt: now - 40 * 86400000 });
    await store.archiveOldCompleted({ now });
    const key = store.logMonths[0];

    // Another completion in the same month, but the archive read fails
    // transiently (network hiccup — the file exists).
    await store.addTask({ listId: list.id, title: 'Second archived', done: true, completedAt: now - 39 * 86400000 });
    const origRead = puter.fs.read;
    puter.fs.read = async () => { throw new Error('Gateway timeout'); };
    try {
      await store.archiveOldCompleted({ now }).catch(() => {});
    } finally {
      puter.fs.read = origRead;
    }

    // The existing archive survives, and the unarchived completion stays in
    // the hot document for the next sweep to pick up.
    expect((await store.loadLog(key)).some((t) => t.title === 'First archived')).toBe(true);
    expect(store.tasks.some((t) => t.title === 'Second archived')).toBe(true);
    expect(await store.archiveOldCompleted({ now })).toBe(1);
    expect((await store.loadLog(key)).map((t) => t.title).sort())
      .toEqual(['First archived', 'Second archived']);
  });
});

describe('sharing', () => {
  it('publishes a snapshot and mints a viewer link', async () => {
    const list = await store.addList({ name: 'Household', icon: 'house', slot: 3 });
    await store.addTask({ listId: list.id, title: 'Water plants' });

    const shared = await store.enableShare(list.id);
    expect(shared.url).toMatch(/^https:/);
    expect(shared.link).toContain('#/shared?u=');

    const file = mock.fileMap.get(`tasks-data/shares/${list.id}.json`);
    const snapshot = JSON.parse(file);
    expect(snapshot.kind).toBe('tasks.shared-list');
    expect(snapshot.tasks[0].title).toBe('Water plants');

    await store.disableShare(list.id);
    expect(store.listById(list.id).shared).toBeNull();
    expect(mock.fileMap.has(`tasks-data/shares/${list.id}.json`)).toBe(false);
  });

  it('stopping mid-publish wins over the renew that was already in flight', async () => {
    const list = await store.addList({ name: 'Racy' });
    await store.addTask({ listId: list.id, title: 'Visible for now' });
    await store.enableShare(list.id);

    // The share sheet renews on open; stop sharing while that renew's
    // cloud round-trips are still running.
    const origUrl = puter.fs.getReadURL.bind(puter.fs);
    puter.fs.getReadURL = async (...a) => {
      await store.disableShare(list.id);
      return origUrl(...a);
    };
    let renewed;
    try {
      renewed = await store.enableShare(list.id);
    } finally {
      puter.fs.getReadURL = origUrl;
    }

    expect(renewed).toBeNull();
    expect(store.listById(list.id).shared).toBeNull();
    // …and the snapshot the renew rewrote does not outlive the stop.
    await new Promise((r) => setTimeout(r, 0)); // fs.delete is fire-and-forget
    expect(mock.fileMap.has(`tasks-data/shares/${list.id}.json`)).toBe(false);
  });

  it('a stop-sharing delete that failed is retried until the file is gone', async () => {
    const list = await store.addList({ name: 'Sticky share' });
    await store.enableShare(list.id);
    const path = `tasks-data/shares/${list.id}.json`;
    expect(mock.fileMap.has(path)).toBe(true);

    const orig = puter.fs.delete;
    puter.fs.delete = async () => { throw new Error('server hiccup'); };
    try {
      await store.disableShare(list.id);
      await new Promise((r) => setTimeout(r, 0));
      // The delete failed: the snapshot is still serving at its minted URL
      // even though the app told the user sharing stopped.
      expect(mock.fileMap.has(path)).toBe(true);
    } finally {
      puter.fs.delete = orig;
    }

    // The next share sync still owes the delete and settles it.
    await store.syncShares();
    expect(mock.fileMap.has(path)).toBe(false);
  });

  it('an owed delete survives a reload through the mirror', async () => {
    const list = await store.addList({ name: 'Owed across boots' });
    await store.enableShare(list.id);
    const path = `tasks-data/shares/${list.id}.json`;

    const orig = puter.fs.delete;
    puter.fs.delete = async () => { throw new Error('offline'); };
    try {
      await store.disableShare(list.id);
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      puter.fs.delete = orig;
    }
    expect(mock.fileMap.has(path)).toBe(true);

    // A fresh session (same device) picks the debt up from the mirror.
    const next = new (store.constructor)();
    next.cloud = puter;
    await next.init();
    await next.syncShares();
    expect(mock.fileMap.has(path)).toBe(false);
  });

  it('re-sharing cancels the owed delete instead of eating the new snapshot', async () => {
    const list = await store.addList({ name: 'Flip flop' });
    await store.enableShare(list.id);
    const path = `tasks-data/shares/${list.id}.json`;

    const orig = puter.fs.delete;
    puter.fs.delete = async () => { throw new Error('hiccup'); };
    try {
      await store.disableShare(list.id);
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      puter.fs.delete = orig;
    }

    await store.enableShare(list.id); // shared again before any retry ran
    await store.syncShares();
    expect(mock.fileMap.has(path)).toBe(true); // the reaper spared it
  });

  it('skips cloud writes when snapshot content is unchanged', async () => {
    const list = await store.addList({ name: 'Quiet' });
    await store.addTask({ listId: list.id, title: 'Stable' });
    await store.enableShare(list.id);

    let writes = 0;
    const orig = puter.fs.write.bind(puter.fs);
    puter.fs.write = (...args) => { writes++; return orig(...args); };
    try {
      await store.syncShares();
      await store.syncShares();
      expect(writes).toBe(0); // nothing changed since enableShare wrote it

      await store.addTask({ listId: list.id, title: 'New content' });
      await store.syncShares();
      expect(writes).toBe(1); // real change → exactly one write
    } finally {
      puter.fs.write = orig;
    }
  });

  it('syncShares rewrites snapshots so viewers see edits', async () => {
    const list = await store.addList({ name: 'Household' });
    const t = await store.addTask({ listId: list.id, title: 'Old title' });
    await store.enableShare(list.id);
    await store.updateTask(t.id, { title: 'New title' });
    await store.syncShares();
    const snapshot = JSON.parse(mock.fileMap.get(`tasks-data/shares/${list.id}.json`));
    expect(snapshot.tasks[0].title).toBe('New title');
  });

  it('snapshots follow the manual (drag) order, not the smart sort', async () => {
    const list = await store.addList({ name: 'Ordered share' });
    // 'urgent' would sort first by due/priority; the drag order disagrees.
    const urgent = await store.addTask({ listId: list.id, title: 'urgent', due: '2026-01-01', priority: 3, order: 2000 });
    await store.addTask({ listId: list.id, title: 'first by hand', order: 1000 });
    await store.enableShare(list.id);

    let snapshot = JSON.parse(mock.fileMap.get(`tasks-data/shares/${list.id}.json`));
    expect(snapshot.tasks.map((t) => t.title)).toEqual(['first by hand', 'urgent']);
    expect(snapshot.tasks[0].order).toBe(1000);

    // Reordering re-publishes with the new order.
    await store.reorderTask(urgent.id, { nextId: snapshot.tasks[0].id });
    await store.syncShares();
    snapshot = JSON.parse(mock.fileMap.get(`tasks-data/shares/${list.id}.json`));
    expect(snapshot.tasks.map((t) => t.title)).toEqual(['urgent', 'first by hand']);
  });
});

describe('sync state', () => {
  it('a quota failure still announces the queued write to the UI', async () => {
    const list = await store.addList({ name: 'Quota' });
    const events = [];
    const onSync = (e) => events.push(e.detail.pending);
    store.addEventListener('sync-state', onSync);
    const orig = puter.kv.set;
    puter.kv.set = async () => { throw new Error('storage quota exceeded'); };
    try {
      await expect(store.updateList(list.id, { name: 'Over quota' })).rejects.toMatchObject({ quota: true });
    } finally {
      puter.kv.set = orig;
      store.removeEventListener('sync-state', onSync);
    }
    // The write is queued; the offline/unsynced banner listens for this.
    expect(store.pendingWrites()).toBeGreaterThan(0);
    expect(events).toContain(store.pendingWrites());
    await store.flushPending(); // drain so later tests start clean
  });
});

describe('storage paths', () => {
  it('keeps crafted ids inside the app directories', async () => {
    // A hostile import (or a foreign manifest) controls these ids verbatim.
    await store.importAll({
      kind: 'tasks.export',
      settings: {},
      lists: [{ id: '../../escaped', name: 'Evil' }],
      items: {
        tasks: [{ id: 't', listId: '../../escaped', title: 'x' }],
        logMonths: ['../../etc/passwd', '2026-07'],
      },
    });
    await store.enableShare('../../escaped');
    await store.archiveOldCompleted();

    for (const path of mock.fileMap.keys()) {
      expect(path.startsWith('tasks-data/')).toBe(true);
      // No segment may climb out: the id is one encoded filename component.
      expect(path.split('/')).not.toContain('..');
    }
    // Bogus month keys never become archive paths.
    expect(store.logMonths).toEqual(['2026-07']);
  });
});

describe('calendar feed', () => {
  it('writes an ics file and stores the feed URL in settings', async () => {
    const list = await store.addList({ name: 'Cal' });
    await store.addTask({ listId: list.id, title: 'Dated', due: '2026-08-10' });
    const url = await store.enableCalendarFeed();
    expect(url).toMatch(/^https:/);
    expect(store.settings.calFeed.url).toBe(url);
    expect(mock.fileMap.get('tasks-data/tasks.ics')).toContain('SUMMARY:Dated');

    await store.disableCalendarFeed();
    expect(store.settings.calFeed).toBeNull();
  });
});

describe('sample data + import/export', () => {
  it('sample recurring tasks are due on their own recurrence weekday', async () => {
    // Regardless of what day the sample is generated on.
    for (const back of [0, 1, 2, 3, 4, 5, 6]) {
      const now = new Date(2026, 7, 4 + back, 12); // Tue Aug 4 .. Mon Aug 10
      const data = sampleDataset({ now });
      const review = data.items.tasks.find((t) => t.title === 'Weekly review');
      expect(new Date(review.due + 'T00:00').getDay()).toBe(5); // Friday
      expect(review.due >= '2026-08-04').toBe(true);
    }
  });

  it('installs the sample dataset through importAll and wipes clean', async () => {
    await store.importAll(sampleDataset());
    expect(store.settings.sampleData).toBe(true);
    expect(store.lists.length).toBeGreaterThanOrEqual(3);
    expect(store.openTasks().length).toBeGreaterThan(5);
    expect(store.completedTasks().length).toBeGreaterThan(0);
    // Every task points at a real list.
    const listIds = new Set(store.lists.map((l) => l.id));
    expect(store.tasks.every((t) => listIds.has(t.listId))).toBe(true);

    await store.wipeAll();
    expect(store.lists).toHaveLength(0);
    expect(store.tasks).toHaveLength(0);
    expect(store.settings.sampleData).toBe(false);
  });

  it('wipeAll removes every file the account wrote (shares, logs, feed)', async () => {
    const list = await store.addList({ name: 'Everything' });
    await store.addTask({ listId: list.id, title: 'Dated', due: '2026-08-10' });
    await store.addTask({
      listId: list.id, title: 'Old done', done: true,
      completedAt: Date.now() - 40 * 86400000,
    });
    await store.enableShare(list.id);
    await store.enableCalendarFeed();
    await store.archiveOldCompleted();
    expect(mock.fileMap.size).toBeGreaterThanOrEqual(3);

    await store.wipeAll();
    expect(mock.fileMap.size).toBe(0);
  });

  it('export → wipe → import round-trips the data', async () => {
    const list = await store.addList({ name: 'Keep me' });
    await store.addTask({ listId: list.id, title: 'Precious', priority: 2 });
    const dump = store.exportAll();

    await store.wipeAll();
    expect(store.tasks).toHaveLength(0);

    await store.importAll(structuredClone(dump));
    expect(store.lists[0].name).toBe('Keep me');
    expect(store.tasks[0].title).toBe('Precious');
    expect(store.tasks[0].priority).toBe(2);
  });

  it('rejects foreign files', async () => {
    await expect(store.importAll({ kind: 'accountant.export' })).rejects.toThrow(/not a tasks export/i);
  });

  it('rejects unrecognizable files instead of wiping the dataset', async () => {
    await store.addTask({ title: 'precious' });
    await expect(store.importAll({})).rejects.toThrow(/not a tasks export/i);
    await expect(store.importAll({ theme: 'dark', editor: 'vim' })).rejects.toThrow(/not a tasks export/i);
    await expect(store.importAll(null)).rejects.toThrow(/not a tasks export/i);
    expect(store.tasks.some((t) => t.title === 'precious')).toBe(true);
  });

  it('accepts pre-kind legacy shapes', async () => {
    const list = { id: 'legacy-l', name: 'Legacy', icon: 'list', slot: 1, order: 0 };
    await store.importAll({ lists: [list], tasks: [{ id: 'legacy-t', listId: 'legacy-l', title: 'Old export' }] });
    expect(store.listById('legacy-l')?.name).toBe('Legacy');
    expect(store.taskById('legacy-t')?.title).toBe('Old export');
  });

  it('import removes share snapshots of lists it replaces', async () => {
    const list = await store.addList({ name: 'Replaced' });
    await store.enableShare(list.id);
    const path = `tasks-data/shares/${list.id}.json`;
    expect(mock.fileMap.has(path)).toBe(true);

    await store.importAll(sampleDataset());
    expect(mock.fileMap.has(path)).toBe(false);
  });

  it('import keeps and refreshes shares for lists that survive it', async () => {
    const list = await store.addList({ name: 'Kept' });
    await store.addTask({ listId: list.id, title: 'Before import' });
    await store.enableShare(list.id);
    const dump = structuredClone(store.exportAll());
    dump.items.tasks[0].title = 'After import';

    await store.importAll(dump);
    await store.syncShares();
    const snapshot = JSON.parse(mock.fileMap.get(`tasks-data/shares/${list.id}.json`));
    expect(snapshot.tasks[0].title).toBe('After import');
    expect(store.listById(list.id).shared).not.toBeNull();
  });
});

describe('manual reordering', () => {
  it('reorderTask moves a task between its new neighbors with one write', async () => {
    const list = await store.addList({ name: 'Ordered' });
    const a = await store.addTask({ listId: list.id, title: 'a', order: 1000 });
    const b = await store.addTask({ listId: list.id, title: 'b', order: 2000 });
    const c = await store.addTask({ listId: list.id, title: 'c', order: 3000 });

    // c between a and b
    await store.reorderTask(c.id, { prevId: a.id, nextId: b.id });
    expect(store.manualTasks(list.id).map((t) => t.title)).toEqual(['a', 'c', 'b']);

    // b to the top
    await store.reorderTask(b.id, { nextId: a.id });
    expect(store.manualTasks(list.id).map((t) => t.title)).toEqual(['b', 'a', 'c']);

    // b to the bottom
    await store.reorderTask(b.id, { prevId: c.id });
    expect(store.manualTasks(list.id).map((t) => t.title)).toEqual(['a', 'c', 'b']);
  });

  it('renumbers the list when midpoint spacing degenerates', async () => {
    const list = await store.addList({ name: 'Tight' });
    const a = await store.addTask({ listId: list.id, title: 'a', order: 1 });
    const b = await store.addTask({ listId: list.id, title: 'b', order: 1 + Number.EPSILON });
    const c = await store.addTask({ listId: list.id, title: 'c', order: 5000 });

    await store.reorderTask(c.id, { prevId: a.id, nextId: b.id });
    const seq = store.manualTasks(list.id);
    expect(seq.map((t) => t.title)).toEqual(['a', 'c', 'b']);
    // Orders are usable again (strictly increasing with real gaps).
    expect(seq[1].order - seq[0].order).toBeGreaterThan(1);
    expect(seq[2].order - seq[1].order).toBeGreaterThan(1);
  });

  it('reorderList persists the new sidebar order', async () => {
    const l1 = await store.addList({ name: 'One' });
    const l2 = await store.addList({ name: 'Two' });
    const l3 = await store.addList({ name: 'Three' });

    await store.reorderList(l3.id, { nextId: l1.id });
    expect(store.lists.map((l) => l.name)).toEqual(['Three', 'One', 'Two']);

    await store.init();
    expect(store.lists.map((l) => l.name)).toEqual(['Three', 'One', 'Two']);
    expect(store.listById(l2.id)).not.toBeNull();
  });

  it('a list added after a drag-to-the-end gets a unique order past it', async () => {
    const a = await store.addList({ name: 'A' });
    const b = await store.addList({ name: 'B' });
    await store.reorderList(a.id, { prevId: b.id }); // A to the end: order = B + 1
    const c = await store.addList({ name: 'C' });

    const orders = store.lists.map((l) => l.order);
    expect(new Set(orders).size).toBe(orders.length); // no collisions
    expect(store.lists.at(-1).id).toBe(c.id); // and the new list lands last
  });
});

describe('quick rescheduling', () => {
  it('moves a batch of tasks to a new date in one write and undoes cleanly', async () => {
    const list = await store.addList({ name: 'Late' });
    const a = await store.addTask({ listId: list.id, title: 'a', due: '2026-07-01', dueTime: '10:00', reminder: 10 });
    const b = await store.addTask({ listId: list.id, title: 'b', due: '2026-07-02' });
    const done = await store.addTask({ listId: list.id, title: 'done', due: '2026-07-01', done: true });

    const undo = await store.rescheduleTasks([a.id, b.id, done.id], '2026-08-04');
    expect(undo).toHaveLength(2); // completed tasks are left alone
    expect(store.taskById(a.id).due).toBe('2026-08-04');
    expect(store.taskById(a.id).dueTime).toBe('10:00'); // time survives a move
    expect(store.taskById(done.id).due).toBe('2026-07-01');

    await store.restoreDues(undo);
    expect(store.taskById(a.id).due).toBe('2026-07-01');
    expect(store.taskById(a.id).reminder).toBe(10);
    expect(store.taskById(b.id).due).toBe('2026-07-02');
  });

  it('clearing the date also clears time and reminder, and undo restores them', async () => {
    const list = await store.addList({ name: 'Clear' });
    const t = await store.addTask({ listId: list.id, title: 't', due: '2026-08-10', dueTime: '09:30', reminder: 60 });

    const undo = await store.rescheduleTasks([t.id], null);
    expect(store.taskById(t.id).due).toBeNull();
    expect(store.taskById(t.id).dueTime).toBeNull();
    expect(store.taskById(t.id).reminder).toBeNull();

    await store.restoreDues(undo);
    const back = store.taskById(t.id);
    expect([back.due, back.dueTime, back.reminder]).toEqual(['2026-08-10', '09:30', 60]);
  });
});

describe('tags', () => {
  it('normalizes tags: lowercase, deduped, capped, slugged', async () => {
    const t = normalizeTask({
      title: 'x',
      tags: ['  #Errands ', 'errands', 'Waiting On', '', 'a'.repeat(40), 'b', 'c', 'd', 'e'],
    });
    expect(t.tags[0]).toBe('errands');
    expect(t.tags[1]).toBe('waiting-on');
    expect(t.tags[2]).toBe('a'.repeat(24));
    expect(t.tags).toHaveLength(5); // capped
    expect(new Set(t.tags).size).toBe(t.tags.length);
  });

  it('allTags counts open tasks and forgets empty tags', async () => {
    const list = await store.addList({ name: 'Tagged' });
    const a = await store.addTask({ listId: list.id, title: 'a', tags: ['errands'] });
    await store.addTask({ listId: list.id, title: 'b', tags: ['errands', 'calls'] });

    let tags = store.allTags();
    expect(tags.find((t) => t.tag === 'errands').open).toBe(2);
    expect(tags.find((t) => t.tag === 'calls').open).toBe(1);

    await store.completeTask(a.id);
    expect(store.allTags().find((t) => t.tag === 'errands').open).toBe(1);

    await store.updateTask(a.id, { tags: [] });
    const b = store.tasks.find((t) => t.title === 'b');
    await store.updateTask(b.id, { tags: ['calls'] });
    expect(store.allTags().some((t) => t.tag === 'errands')).toBe(false);
  });

  it('tags survive recurrence roll-forward and export round-trips', async () => {
    const list = await store.addList({ name: 'R' });
    const t = await store.addTask({
      listId: list.id, title: 'meds', due: '2026-08-04', tags: ['health'],
      repeat: { freq: 'daily', interval: 1, mode: 'due' },
    });
    await store.completeTask(t.id, { today: '2026-08-04' });
    expect(store.taskById(t.id).tags).toEqual(['health']);

    const dump = structuredClone(store.exportAll());
    await store.wipeAll();
    await store.importAll(dump);
    expect(store.taskById(t.id).tags).toEqual(['health']);
  });
});
