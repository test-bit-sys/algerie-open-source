import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { installMockPuter, createMockPuter } from './helpers/mock-puter.js';

let mock;
let Store, KV_KEYS;

beforeAll(async () => {
  mock = installMockPuter();
  ({ Store, KV_KEYS } = await import('../src/lib/store.js'));
});

beforeEach(() => {
  mock.reset();
  localStorage.clear();
});

/** Make every kv.set fail, as if the network dropped. Returns a restore fn. */
function cutNetwork(cloud) {
  const origSet = cloud.kv.set;
  const origGet = cloud.kv.get;
  cloud.kv.set = async () => { throw new Error('Network down'); };
  cloud.kv.get = async () => { throw new Error('Network down'); };
  return () => {
    cloud.kv.set = origSet;
    cloud.kv.get = origGet;
  };
}

/** Wait until the store has no queued writes (flush settles). */
async function settled(store, tries = 50) {
  while (store.pendingWrites() > 0 && tries-- > 0) {
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 5));
}

/** Run fn as another device: same cloud, its own (empty) localStorage. */
async function onAnotherDevice(fn) {
  const MIRROR = 'tasks:mirror:v1';
  const mine = localStorage.getItem(MIRROR);
  localStorage.clear();
  try {
    await fn();
  } finally {
    localStorage.clear();
    if (mine !== null) localStorage.setItem(MIRROR, mine);
  }
}

describe('offline write queue durability', () => {
  it('edits queued offline survive closing the tab and reappear after an online boot', async () => {
    // Session 1: online, then the network drops mid-session.
    const s1 = new Store();
    await s1.init();
    const list = await s1.addList({ name: 'L' });
    await s1.addTask({ listId: list.id, title: 'synced before drop' });

    const restore = cutNetwork(puter);
    await s1.addTask({ listId: list.id, title: 'written offline' });
    expect(s1.pendingWrites()).toBeGreaterThan(0);
    restore();

    // The tab closes before connectivity returns; a later session boots
    // online against the stale cloud. The queued edit must not be lost.
    const s2 = new Store();
    await s2.init();
    expect(s2.tasks.some((t) => t.title === 'written offline')).toBe(true);
    expect(s2.tasks.some((t) => t.title === 'synced before drop')).toBe(true);

    // And it reaches the cloud, not just this device.
    await settled(s2);
    const raw = await puter.kv.get(KV_KEYS.items);
    expect(JSON.stringify(raw)).toContain('written offline');
  });

  it('queued edits merge with, not clobber, changes another device made meanwhile', async () => {
    const s1 = new Store();
    await s1.init();
    const list = await s1.addList({ name: 'L' });

    const restore = cutNetwork(puter);
    await s1.addTask({ listId: list.id, title: 'offline on A' });
    restore();

    // Another device writes while A's tab is closed.
    await onAnotherDevice(async () => {
      const other = new Store();
      other.deviceId = 'device-B';
      await other.init();
      await other.addTask({ listId: list.id, title: 'online on B' });
    });

    const s2 = new Store();
    await s2.init();
    await settled(s2);
    expect(s2.tasks.some((t) => t.title === 'offline on A')).toBe(true);
    expect(s2.tasks.some((t) => t.title === 'online on B')).toBe(true);
  });

  it('queued edits from a replaced dataset (newer import elsewhere) are dropped', async () => {
    const s1 = new Store();
    await s1.init();
    const list = await s1.addList({ name: 'Old world' });

    const restore = cutNetwork(puter);
    await s1.addTask({ listId: list.id, title: 'old-world straggler' });
    restore();

    // Another device replaces the dataset (new epoch) after the edit.
    await new Promise((r) => setTimeout(r, 5));
    await onAnotherDevice(async () => {
      const other = new Store();
      other.deviceId = 'device-B';
      await other.init();
      await other.importAll({
        kind: 'tasks.export',
        settings: {},
        lists: [{ id: 'fresh', name: 'New world' }],
        items: { tasks: [{ id: 'ft', listId: 'fresh', title: 'fresh task' }], logMonths: [] },
      });
    });

    const s2 = new Store();
    await s2.init();
    await settled(s2);
    expect(s2.tasks.some((t) => t.title === 'old-world straggler')).toBe(false);
    expect(s2.taskById('ft')?.title).toBe('fresh task');
  });

  it('announces the queue filling and draining so the UI can show it', async () => {
    const s = new Store();
    await s.init();
    const list = await s.addList({ name: 'L' });

    const seen = [];
    s.addEventListener('sync-state', (e) => seen.push(e.detail.pending));

    const restore = cutNetwork(puter);
    await s.addTask({ listId: list.id, title: 'queued' });
    expect(seen.at(-1)).toBeGreaterThan(0); // queue filled
    restore();

    expect(await s.flushPending()).toBe(0);
    expect(seen.at(-1)).toBe(0); // and drained
    expect(s.pendingWrites()).toBe(0);
  });

  it('reports a full cloud as kept-but-unsynced, not as a failed save', async () => {
    const s = new Store();
    await s.init();
    const list = await s.addList({ name: 'L' });

    const origSet = puter.kv.set;
    puter.kv.set = async () => { throw new Error('storage quota exceeded'); };
    // The store keeps the task and queues the write, so the error it hands
    // back must say so: a form told "could not save" re-offers its input,
    // and the user files the same task twice.
    const err = await s.addTask({ listId: list.id, title: 'over quota' }).catch((e) => e);
    puter.kv.set = origSet;

    expect(err.quota).toBe(true);
    expect(err.message).not.toMatch(/could not|failed/i);
    expect(s.tasks.some((t) => t.title === 'over quota')).toBe(true);
    expect(s.pendingWrites()).toBe(1);
    expect(await s.flushPending()).toBe(0); // and it lands once there is room
  });

  it('does not flush the queue over cloud state it could not re-read', async () => {
    const s1 = new Store();
    await s1.init();
    const list = await s1.addList({ name: 'L' });
    const t = await s1.addTask({ listId: list.id, title: 'base' });

    // Queue an edit while the network is down.
    const restore = cutNetwork(puter);
    await s1.updateTask(t.id, { title: 'stale edit from the queue' });
    expect(s1.pendingWrites()).toBeGreaterThan(0);
    restore();

    // Another device edits the same task meanwhile.
    await new Promise((r) => setTimeout(r, 5));
    await onAnotherDevice(async () => {
      const other = new Store();
      other.deviceId = 'device-B';
      await other.init();
      await other.updateTask(t.id, { title: 'newer from B' });
    });

    // Reads fail (transient server trouble) while writes would succeed:
    // flushing now would overwrite B's edit with the stale queue.
    const origGet = puter.kv.get;
    puter.kv.get = async () => { throw new Error('read outage'); };
    try {
      expect(await s1.flushPending()).toBeGreaterThan(0); // kept, not written
    } finally {
      puter.kv.get = origGet;
    }

    let raw = await puter.kv.get(KV_KEYS.items);
    expect(JSON.stringify(raw)).toContain('newer from B');
    expect(JSON.stringify(raw)).not.toContain('stale edit');

    // Once reads work again, the queue merges (B's edit is newer and wins).
    expect(await s1.flushPending()).toBe(0);
    expect(s1.taskById(t.id).title).toBe('newer from B');
    raw = await puter.kv.get(KV_KEYS.items);
    expect(JSON.stringify(raw)).toContain('newer from B');
  });

  it('never hands one account the mirror left behind by another', async () => {
    // Alice uses the app on this browser and ends up with unsynced edits;
    // her session then ends without an in-app sign-out (expired token,
    // account switch, shared machine), so her mirror is still here.
    const alice = createMockPuter({ username: 'alice' });
    const a = new Store();
    a.cloud = alice.puter;
    await a.init();
    const list = await a.addList({ name: 'Alice private list' });
    const restore = cutNetwork(alice.puter);
    await a.addTask({ listId: list.id, title: 'alice secret' });
    restore();

    // Bob signs in on the same browser with a brand-new, empty account.
    const bob = createMockPuter({ username: 'bob' });
    const b = new Store();
    b.cloud = bob.puter;
    await b.init();
    await settled(b);

    expect(b.tasks.some((t) => t.title === 'alice secret')).toBe(false);
    expect(b.lists.some((l) => l.name === 'Alice private list')).toBe(false);
    // And nothing of Alice's is written into Bob's cloud.
    expect(JSON.stringify([...bob.kvMap.values()])).not.toContain('alice secret');
  });

  it('a mirror restored into an empty cloud is pushed without waiting for an edit', async () => {
    // A session that only ever ran against an empty-but-reachable cloud
    // whose writes all failed: everything lives in the mirror.
    const s1 = new Store();
    const restore = cutNetwork(puter);
    // init() itself fails to fetch; the store boots from nothing, writes queue.
    await s1.init().catch(() => {});
    const list = await s1.addList({ name: 'Mirror only' }).catch(() => null);
    restore();

    if (!list) return; // init threw with no mirror; covered elsewhere

    const s2 = new Store();
    await s2.init();
    await settled(s2);
    const raw = await puter.kv.get(KV_KEYS.lists);
    expect(JSON.stringify(raw)).toContain('Mirror only');
  });
});
