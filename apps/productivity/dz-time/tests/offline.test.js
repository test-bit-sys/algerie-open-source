import { describe, it, expect, beforeEach } from 'vitest';
import { createPuterMock } from './puter-mock.js';

/* offline.js touches localStorage at import time; give Node one first.
   Vitest isolates test files, so this stub never leaks to other suites. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _clear: () => map.clear(),
  };
}
globalThis.localStorage = memoryStorage();

const { offline, isNetworkError } = await import('../src/lib/offline.js');
const { createStore } = await import('../src/lib/store.js');

let mock;
let store;
let network;

function killNetwork() {
  const fail = async () => { throw new TypeError('Failed to fetch'); };
  network = { kvGet: mock.kv.get, kvSet: mock.kv.set, fsRead: mock.fs.read, fsWrite: mock.fs.write };
  mock.kv.get = fail;
  mock.kv.set = fail;
  mock.fs.read = fail;
  mock.fs.write = fail;
}

function restoreNetwork() {
  mock.kv.get = network.kvGet;
  mock.kv.set = network.kvSet;
  mock.fs.read = network.fsRead;
  mock.fs.write = network.fsWrite;
}

async function seedProject() {
  const client = await store.addClient({ name: 'Acme', slot: 1, rate: 100 });
  const project = await store.addProject({ clientId: client.id, name: 'Site' });
  return { client, project };
}

beforeEach(async () => {
  localStorage._clear();
  offline.clearAll();
  mock = createPuterMock();
  mock.auth.getUser = async () => ({ uuid: 'user-1', username: 'tester' });
  globalThis.puter = mock;
  store = createStore();
  await store.init();
});

describe('isNetworkError', () => {
  it('separates transport failures from real API errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new Error('Network request timed out'))).toBe(true);
    expect(isNetworkError(new Error('quota exceeded'))).toBe(false);
    expect(isNetworkError(new Error('permission denied'))).toBe(false);
  });
});

describe('offline mirror and write queue', () => {
  it('retains a queued list when a sync can read the server but cannot write', async () => {
    await seedProject();
    killNetwork();
    const client = await store.addClient({ name: 'Queued client' });
    restoreNetwork();
    const realSet = mock.kv.set;
    mock.kv.set = async () => { throw new TypeError('Failed to fetch'); };

    expect(await store.flushPending()).toBe(0);
    expect(JSON.parse(offline.getKV('hourly:clients:v1')).map((c) => c.id)).toContain(client.id);
    expect(store.pendingWrites()).toBe(1);

    mock.kv.set = realSet;
    await store.flushPending();
    expect((await mock.kv.get('hourly:clients:v1')).map((c) => c.id)).toContain(client.id);
    expect(store.pendingWrites()).toBe(0);
  });

  it('keeps offline-created clients and projects when syncing after a reload', async () => {
    await seedProject();
    killNetwork();
    const client = await store.addClient({ name: 'Offline client' });
    const project = await store.addProject({ clientId: client.id, name: 'Offline project' });
    const second = createStore();
    await second.init();

    restoreNetwork();
    await second.flushPending();
    expect((await mock.kv.get('hourly:clients:v1')).map((c) => c.id)).toContain(client.id);
    expect((await mock.kv.get('hourly:projects:v1')).map((p) => p.id)).toContain(project.id);
    expect(second.client(client.id)?.name).toBe('Offline client');
    expect(second.project(project.id)?.name).toBe('Offline project');
    expect(second.pendingWrites()).toBe(0);
  });

  it('queues writes while unreachable and still serves them locally', async () => {
    const { project } = await seedProject();
    killNetwork();

    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    expect(entry).toBeTruthy();
    expect(store.pendingWrites()).toBeGreaterThan(0);

    // A fresh boot with the network still down runs entirely on the mirror.
    const second = createStore();
    await second.init();
    expect(second.clients).toHaveLength(1);
    expect(second.months).toEqual(['2026-08']);
    const entries = await second.entriesBetween('2026-08-01', '2026-08-31');
    expect(entries).toHaveLength(1);
    expect(entries[0].seconds).toBe(3600);
  });

  it('flushes queued writes on reconnect, then nothing is pending', async () => {
    const { project } = await seedProject();
    killNetwork();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.updateSettings({ currency: 'EUR' });
    expect(store.pendingWrites()).toBeGreaterThan(0);

    restoreNetwork();
    const flushed = await store.flushPending();
    expect(flushed).toBeGreaterThan(0);
    expect(store.pendingWrites()).toBe(0);

    // The server now holds everything a cold online boot needs.
    const cold = createStore();
    offline.clearAll();
    await cold.init();
    expect(cold.settings.currency).toBe('EUR');
    expect(await cold.entriesBetween('2026-08-01', '2026-08-31')).toHaveLength(1);
  });

  it('starts and stops the timer offline without losing anything', async () => {
    const { project } = await seedProject();
    killNetwork();

    await store.startTimer({ projectId: project.id, task: 'Offline work' });
    expect(store.running).toBe(true);

    // Survives a reload while still offline.
    const second = createStore();
    await second.init();
    expect(second.timer?.task).toBe('Offline work');

    const entry = await store.stopTimer();
    expect(entry.task).toBe('Offline work');
    expect(store.running).toBe(false);
    expect((await store.entriesBetween('2000-01-01', '2100-01-01'))).toHaveLength(1);
  });

  it('real API errors still fail loudly instead of queueing', async () => {
    await seedProject();
    mock.kv.set = async () => { throw new Error('permission denied'); };
    await expect(store.updateSettings({ currency: 'EUR' })).rejects.toThrow('permission denied');
    expect(store.pendingWrites()).toBe(0);
  });

  it('a reconnect replay never clobbers a fresher concurrent write', async () => {
    killNetwork();
    await store.updateSettings({ currency: 'EUR' });
    expect(store.pendingWrites()).toBe(1);
    restoreNetwork();

    // Slow down the first server write so the replay and a fresh write
    // overlap; the fresher value must still win on the server.
    const realSet = mock.kv.set;
    let first = true;
    mock.kv.set = async (key, value) => {
      const wait = first ? 50 : 0;
      first = false;
      await new Promise((r) => setTimeout(r, wait));
      return realSet(key, value);
    };
    const flushing = store.flushPending();
    await store.updateSettings({ currency: 'GBP' });
    await flushing;
    mock.kv.set = realSet;

    expect((await mock.kv.get('hourly:settings:v1')).currency).toBe('GBP');
    expect(store.pendingWrites()).toBe(0);
  });

  it('quick-resume helpers skip months the mirror cannot serve', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Recent', seconds: 600 });
    await store.addEntry({ date: '2026-05-10', projectId: project.id, task: 'Old', seconds: 600 });

    killNetwork();
    const fresh = createStore();
    await fresh.init();
    // The older month falls out of the mirror (cap eviction): offline it
    // is unreadable, but the helpers must still serve what they can.
    localStorage.removeItem('hourly:cache:v1:user-1:fs:2026-05');

    expect((await fresh.recentWork(6)).map((e) => e.task)).toEqual(['Recent']);
    expect(await fresh.taskSuggestions()).toEqual(['Recent']);
  });

  it('never evicts the month it just queued when the mirror is at its cap', async () => {
    const { project } = await seedProject();
    // Fill the mirror to its 24-month cap with newer months.
    const d = new Date(2024, 7, 15);
    for (let i = 0; i < 24; i++) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
      await store.addEntry({ date: iso, projectId: project.id, seconds: 600 });
      d.setMonth(d.getMonth() + 1);
    }

    // Backfill into a month older than everything cached: its key sorts
    // first, so the cap prune must not throw away the queued copy.
    killNetwork();
    await store.addEntry({ date: '2023-06-15', projectId: project.id, seconds: 900, task: 'Backfilled' });
    expect(store.pendingWrites()).toBeGreaterThan(0);

    restoreNetwork();
    await store.flushPending();
    expect(store.pendingWrites()).toBe(0);

    // The entry made it to the server, not just onto the screen.
    const cold = createStore();
    offline.clearAll();
    await cold.init();
    const june = await cold.entriesBetween('2023-06-01', '2023-06-30');
    expect(june.map((e) => e.task)).toEqual(['Backfilled']);
  });

  it('a different account never sees or flushes the previous cache', async () => {
    const { project } = await seedProject();
    killNetwork();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    expect(store.pendingWrites()).toBeGreaterThan(0);

    // Someone else signs in on this device; the old mirror is wiped.
    restoreNetwork();
    mock.auth.getUser = async () => ({ uuid: 'user-2', username: 'other' });
    const second = createStore();
    await second.init();
    expect(offline.user.uuid).toBe('user-2');
    expect(second.pendingWrites()).toBe(0);
  });
});

describe('offline writes and another device', () => {
  it('keeps an offline backup restore as a replacement after reload and further edits', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 });
    const backup = await store.exportAll();
    await store.addEntry({ date: '2026-09-03', projectId: project.id, seconds: 600 });
    killNetwork();
    await store.importAll(backup);
    await store.addEntry({ date: '2026-07-03', projectId: project.id, seconds: 900 });
    const second = createStore();
    await second.init();
    restoreNetwork();

    await second.flushPending();
    expect(await mock.kv.get('hourly:months:v1')).toEqual(['2026-07', '2026-08']);
    expect(second.months).toEqual(['2026-07', '2026-08']);
    expect(second.pendingWrites()).toBe(0);
  });

  it('replays an offline backup restore\u2019s month files as replacements too', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Kept', seconds: 600 });
    const backup = await store.exportAll();
    // Work the backup predates, on the server and in this device's baseline.
    await store.addEntry({ date: '2026-08-04', projectId: project.id, task: 'Removed by restore', seconds: 600 });
    killNetwork();
    await store.importAll(backup);
    expect((await store.entriesBetween('2026-08-01', '2026-08-31')).map((e) => e.task)).toEqual(['Kept']);
    restoreNetwork();

    await store.flushPending();
    expect(store.pendingWrites()).toBe(0);
    // The restore replaced the month; replaying it must not merge the
    // entry it removed back in from the server's older copy.
    expect((await store.entriesBetween('2026-08-01', '2026-08-31')).map((e) => e.task)).toEqual(['Kept']);
    const cold = createStore();
    await cold.init();
    expect((await cold.entriesBetween('2026-08-01', '2026-08-31')).map((e) => e.task)).toEqual(['Kept']);
  });

  it('preserves months added by another device when replaying the month index', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 });
    killNetwork();
    await store.addEntry({ date: '2026-07-03', projectId: project.id, seconds: 900 });
    restoreNetwork();
    await serverAddEntry('2026-09', 'Other device', project.id);
    await mock.kv.set('hourly:months:v1', ['2026-08', '2026-09']);

    await store.flushPending();
    expect(await mock.kv.get('hourly:months:v1')).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(store.months).toEqual(['2026-07', '2026-08', '2026-09']);
    const cold = createStore();
    await cold.init();
    expect((await cold.entriesBetween('2026-09-01', '2026-09-30')).map((e) => e.task))
      .toEqual(['Other device']);
  });

  /* The offline mirror is per device, and two stores in one process share
     one, so "the other device" here changes the server directly: that is
     exactly what a phone's write looks like from this laptop's side. */
  async function serverAddClient(name, slot) {
    const list = (await mock.kv.get('hourly:clients:v1')) || [];
    const now = Date.now();
    await mock.kv.set('hourly:clients:v1', [...list, {
      id: `remote-${slot}`, name, slot, rate: null, currency: null,
      archived: false, createdAt: now, updatedAt: now,
    }]);
  }

  async function serverAddEntry(monthKey, task, projectId) {
    const path = `hourly-data/entries-${monthKey}.json`;
    const list = JSON.parse(mock._files.get(path) || '[]');
    const now = Date.now();
    list.push({
      id: `remote-${task}`, date: `${monthKey}-03`, projectId, task, notes: '',
      seconds: 600, billable: true, rate: null, invoicedAt: null,
      createdAt: now, updatedAt: now,
    });
    mock._files.set(path, JSON.stringify(list));
  }

  it('reconciles a queued month write on the way out instead of overwriting', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Mine', seconds: 3600 });

    // This device goes offline and keeps working: the queued copy is the
    // newer one here, so a refresh must leave it alone.
    killNetwork();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Offline', seconds: 900 });
    expect(store.pendingWrites()).toBeGreaterThan(0);
    await store.refresh();
    expect((await store.loadMonth('2026-08')).some((e) => e.task === 'Offline')).toBe(true);

    // Meanwhile the other device tracked in the same month.
    restoreNetwork();
    await serverAddEntry('2026-08', 'Theirs', project.id);

    // Coming back online must not push this device's day over the other's.
    await store.flushPending();
    const stored = JSON.parse(mock._files.get('hourly-data/entries-2026-08.json'));
    expect(stored.map((e) => e.task).sort()).toEqual(['Mine', 'Offline', 'Theirs']);
    expect(store.pendingWrites()).toBe(0);
  });

  it('reconciles a queued client list on the way out', async () => {
    await store.addClient({ name: 'Acme', slot: 1 });

    killNetwork();
    await store.addClient({ name: 'Added offline', slot: 3 });
    restoreNetwork();
    // The other device added one of its own while this one was away.
    await serverAddClient('Globex', 2);

    await store.flushPending();
    const stored = await mock.kv.get('hourly:clients:v1');
    expect(stored.map((c) => c.name).sort()).toEqual(['Acme', 'Added offline', 'Globex']);
    expect(store.clients.map((c) => c.name).sort()).toEqual(['Acme', 'Added offline', 'Globex']);
  });
});
