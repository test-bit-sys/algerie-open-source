import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
let Store, KV_KEYS;
let mergeRecords, unwrapDoc;

/** Two devices: separate Store instances, one shared mock cloud. */
let A, B;

beforeAll(async () => {
  mock = installMockPuter();
  ({ Store, KV_KEYS } = await import('../src/lib/store.js'));
  ({ mergeRecords, unwrapDoc } = await import('../src/lib/merge.js'));
});

beforeEach(async () => {
  mock.reset();
  A = new Store();
  A.deviceId = 'device-A';
  B = new Store();
  B.deviceId = 'device-B';
  await A.init();
});

/** B pulls the latest cloud state. */
const pull = (s) => s.refreshFromCloud({ force: true });

describe('mergeRecords', () => {
  const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });

  it('is commutative and keeps the newer record on conflict', () => {
    const local = [rec('a', 10, { title: 'old' }), rec('b', 5)];
    const remote = [rec('a', 20, { title: 'new' }), rec('c', 7)];
    const ab = mergeRecords(local, remote, [], []);
    const ba = mergeRecords(remote, local, [], []);
    expect(ab).toEqual(ba);
    expect(ab.records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(ab.records.find((r) => r.id === 'a').title).toBe('new');
  });

  it('lets a tombstone win over an older record, and an edit outlive a tombstone', () => {
    const dead = mergeRecords([rec('a', 10)], [], [], [{ id: 'a', at: 15 }]);
    expect(dead.records).toHaveLength(0);
    expect(dead.deleted).toEqual([{ id: 'a', at: 15 }]);

    const alive = mergeRecords([rec('a', 20)], [], [], [{ id: 'a', at: 15 }]);
    expect(alive.records).toHaveLength(1);
    expect(alive.deleted).toHaveLength(0); // consumed by the newer edit
  });

  it('prunes tombstones past their window but keeps live ones', () => {
    const out = mergeRecords([], [], [{ id: 'old', at: 100 }], [{ id: 'new', at: 900 }], { pruneBefore: 500 });
    expect(out.deleted).toEqual([{ id: 'new', at: 900 }]);
  });
});

describe('two devices', () => {
  it('a task added on A appears on B after refresh', async () => {
    await B.init();
    const list = await A.addList({ name: 'Shared context' });
    await A.addTask({ listId: list.id, title: 'From A' });

    await pull(B);
    expect(B.tasks.some((t) => t.title === 'From A')).toBe(true);
    expect(B.listById(list.id)?.name).toBe('Shared context');
  });

  it('concurrent edits to different tasks both survive', async () => {
    const list = await A.addList({ name: 'L' });
    const t1 = await A.addTask({ listId: list.id, title: 'one' });
    const t2 = await A.addTask({ listId: list.id, title: 'two' });
    await B.init();

    // Both devices edit different tasks without seeing each other.
    await A.updateTask(t1.id, { title: 'one (A)' });
    await B.updateTask(t2.id, { title: 'two (B)' });

    await pull(A);
    await pull(B);
    for (const s of [A, B]) {
      expect(s.taskById(t1.id).title).toBe('one (A)');
      expect(s.taskById(t2.id).title).toBe('two (B)');
    }
  });

  it('the same task edited on both sides resolves to the newer edit everywhere', async () => {
    const list = await A.addList({ name: 'L' });
    const t = await A.addTask({ listId: list.id, title: 'orig' });
    await B.init();

    await A.updateTask(t.id, { title: 'from A' });
    await new Promise((r) => setTimeout(r, 5)); // strictly newer timestamp
    await B.updateTask(t.id, { title: 'from B (newer)' });

    await pull(A);
    await pull(B);
    expect(A.taskById(t.id).title).toBe('from B (newer)');
    expect(B.taskById(t.id).title).toBe('from B (newer)');
  });

  it('a deletion on A sticks on B (and does not resurrect via B\'s writes)', async () => {
    const list = await A.addList({ name: 'L' });
    const t = await A.addTask({ listId: list.id, title: 'doomed' });
    const keeper = await A.addTask({ listId: list.id, title: 'keeper' });
    await B.init();

    await A.deleteTask(t.id);
    // B, unaware, touches something else and pushes a full document.
    await B.updateTask(keeper.id, { title: 'keeper!' });

    await pull(A); // A merges B's write — the tombstone must hold
    expect(A.taskById(t.id)).toBeNull();
    await pull(B);
    expect(B.taskById(t.id)).toBeNull();
    expect(B.taskById(keeper.id).title).toBe('keeper!');
  });

  it('an edit made after a deletion elsewhere revives the task', async () => {
    const list = await A.addList({ name: 'L' });
    const t = await A.addTask({ listId: list.id, title: 'contested' });
    await B.init();

    await A.deleteTask(t.id);
    await new Promise((r) => setTimeout(r, 5));
    await B.updateTask(t.id, { title: 'still needed' }); // B edits later

    await pull(A);
    expect(A.taskById(t.id)?.title).toBe('still needed');
  });

  it('undo (restoreTask) clears the tombstone so the task survives merges', async () => {
    const list = await A.addList({ name: 'L' });
    const t = await A.addTask({ listId: list.id, title: 'restored' });
    const copy = { ...t };
    await A.deleteTask(t.id);
    await A.restoreTask(copy);

    await B.init();
    expect(B.taskById(t.id)?.title).toBe('restored');
    await pull(A);
    expect(A.taskById(t.id)?.title).toBe('restored');
  });

  it('deleting a list on A removes it and its tasks on B', async () => {
    const list = await A.addList({ name: 'Doomed list' });
    await A.addTask({ listId: list.id, title: 'in it' });
    await B.init();

    await A.deleteList(list.id);
    await pull(B);
    expect(B.listById(list.id)).toBeNull();
    expect(B.tasks.filter((t) => t.listId === list.id)).toHaveLength(0);
  });

  it('completions and reopens propagate', async () => {
    const list = await A.addList({ name: 'L' });
    const t = await A.addTask({ listId: list.id, title: 'flip' });
    await B.init();

    await A.completeTask(t.id);
    await pull(B);
    expect(B.taskById(t.id).done).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    await B.uncompleteTask(t.id);
    await pull(A);
    expect(A.taskById(t.id).done).toBe(false);
  });

  it('an import on A replaces the dataset on B instead of interleaving', async () => {
    const list = await A.addList({ name: 'Old world' });
    await A.addTask({ listId: list.id, title: 'old task' });
    await B.init();
    expect(B.tasks).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 5));
    await A.importAll({
      kind: 'tasks.export',
      settings: {},
      lists: [{ id: 'fresh-list', name: 'New world' }],
      items: { tasks: [{ id: 'fresh-task', listId: 'fresh-list', title: 'new task' }], logMonths: [] },
    });

    await pull(B);
    expect(B.taskById('fresh-task')?.title).toBe('new task');
    expect(B.tasks.some((t) => t.title === 'old task')).toBe(false);
    expect(B.lists.some((l) => l.name === 'Old world')).toBe(false);
  });

  it('an import is not destroyed by a stale-epoch write landing after it', async () => {
    const list = await A.addList({ name: 'L' });
    await A.addTask({ listId: list.id, title: 'original' });
    await B.init(); // B now shares the original epoch, freshly fetched

    // A replaces the dataset…
    await new Promise((r) => setTimeout(r, 5));
    await A.importAll({
      kind: 'tasks.export', v: 1,
      lists: [{ id: 'imp-list', name: 'Imported' }],
      items: { tasks: [{ id: 'imp-task', listId: 'imp-list', title: 'imported task' }], logMonths: [] },
    });

    // …while B, still inside its freshness window, writes the items doc
    // without refreshing — stamped with the old epoch but a newer time.
    await new Promise((r) => setTimeout(r, 5));
    await B.addTask({ listId: list.id, title: 'blind write' });

    // A must keep the import: the old epoch's write time is not newness.
    await pull(A);
    expect(A.taskById('imp-task')?.title).toBe('imported task');
    expect(A.tasks.some((t) => t.title === 'original')).toBe(false);
    expect(A.tasks.some((t) => t.title === 'blind write')).toBe(false);

    // A's refresh pushed its copy back over the stale items doc, so B's
    // next refresh converges on the imported dataset.
    await pull(B);
    expect(B.taskById('imp-task')?.title).toBe('imported task');
    expect(B.tasks.some((t) => t.title === 'blind write')).toBe(false);
    expect(B.lists.some((l) => l.name === 'Imported')).toBe(true);
  });

  it('a wipe on A empties B', async () => {
    const list = await A.addList({ name: 'L' });
    await A.addTask({ listId: list.id, title: 'gone soon' });
    await B.init();

    await new Promise((r) => setTimeout(r, 5));
    await A.wipeAll();
    await pull(B);
    expect(B.tasks).toHaveLength(0);
    expect(B.lists).toHaveLength(0);
  });

  it('a stale tab re-fetches and merges before writing instead of clobbering', async () => {
    const list = await A.addList({ name: 'L' });
    const keep = await A.addTask({ listId: list.id, title: 'mine' });
    await B.init();

    // A writes while B's tab sits idle in the background...
    await A.addTask({ listId: list.id, title: 'added on A' });

    // ...an hour later B edits without any explicit refresh. The save's
    // freshness guard must fold A's write in rather than overwrite it.
    const t0 = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => t0 + 3600000);
    try {
      await B.updateTask(keep.id, { title: 'mine (edited)' });
    } finally {
      spy.mockRestore();
    }
    expect(B.tasks.some((t) => t.title === 'added on A')).toBe(true);

    await pull(A);
    expect(A.taskById(keep.id).title).toBe('mine (edited)');
    expect(A.tasks.some((t) => t.title === 'added on A')).toBe(true);
  });

  it('a stale tab saving a setting keeps its own patch through the pre-write refresh', async () => {
    await B.init();
    // A writes settings while B's tab sits idle…
    await A.updateSettings({ startMonday: false });

    // …an hour later B toggles a setting. The save's freshness guard
    // refreshes first; adopting the remote settings wholesale mid-save
    // used to revert the patch and then write the reverted state.
    const t0 = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => t0 + 3600000);
    try {
      await B.updateSettings({ reminders: true });
    } finally {
      spy.mockRestore();
    }
    expect(B.settings.reminders).toBe(true);
    const written = await puter.kv.get(KV_KEYS.settings);
    expect(written.data.reminders).toBe(true);
  });

  it('a stale device cannot resurrect completions the archive sweep moved out', async () => {
    const list = await A.addList({ name: 'L' });
    const t = await A.addTask({ listId: list.id, title: 'ancient completion' });
    await A.completeTask(t.id);
    // Backdate the completion past the archive window, then sweep it out.
    const old = Date.now() - 40 * 86400000;
    Object.assign(A.taskById(t.id), { completedAt: old, updatedAt: old });
    expect(await A.archiveOldCompleted()).toBe(1);
    expect(A.taskById(t.id)).toBeNull();

    // A device that never ran its sweep still holds the copy and writes it.
    const raw = await puter.kv.get(KV_KEYS.items);
    raw.data.tasks.push({ ...t, done: true, completedAt: old, updatedAt: old });
    raw.rev += 1;
    raw.device = 'device-B';
    raw.at = Date.now();
    await puter.kv.set(KV_KEYS.items, raw);

    await pull(A);
    expect(A.taskById(t.id)).toBeNull();
  });

  it('emits remote-change only when a refresh actually changed something', async () => {
    const list = await A.addList({ name: 'L' });
    await B.init();

    let events = 0;
    B.addEventListener('remote-change', () => events++);

    await pull(B); // nothing new
    expect(events).toBe(0);

    await A.addTask({ listId: list.id, title: 'news' });
    await pull(B);
    expect(events).toBe(1);
  });
});

describe('legacy documents', () => {
  it('reads pre-envelope documents and upgrades them on the next write', async () => {
    mock.reset();
    // What the previous app version wrote: bare values, lists as an array.
    await puter.kv.set(KV_KEYS.settings, { theme: 'dark', onboarded: true });
    await puter.kv.set(KV_KEYS.lists, [{ id: 'l1', name: 'Legacy list', icon: 'star', slot: 2, order: 0 }]);
    await puter.kv.set(KV_KEYS.items, { tasks: [{ id: 't1', listId: 'l1', title: 'Legacy task' }], logMonths: [] });

    const s = new Store();
    await s.init();
    expect(s.settings.theme).toBe('dark');
    expect(s.listById('l1').name).toBe('Legacy list');
    expect(s.taskById('t1').title).toBe('Legacy task');

    await s.updateTask('t1', { title: 'Upgraded' });
    const raw = await puter.kv.get(KV_KEYS.items);
    expect(raw.v).toBe(2);
    expect(unwrapDoc(raw).data.tasks[0].title).toBe('Upgraded');
  });
});
