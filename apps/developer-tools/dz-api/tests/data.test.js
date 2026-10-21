import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { MemoryDb } from './helpers/memory-db.js';
import { openDb, deleteDb } from '../src/data/idb.js';
import { Workspace, HISTORY_LIMIT, VARIABLES_WRITE_DELAY } from '../src/data/workspace.js';
import { CloudSync } from '../src/data/sync.js';
import { request, folder } from '../src/core/model.js';

async function workspace(db = new MemoryDb()) {
  const ws = new Workspace(db);
  await ws.load();
  return ws;
}

describe('IndexedDB wrapper', () => {
  it('stores, lists, batches and deletes', async () => {
    const db = await openDb('test-db');
    await db.put('meta', 'a', { x: 1 });
    await db.batch([{ store: 'meta', key: 'b', value: 2 }, { store: 'collections', key: 'c', value: { id: 'c' } }, { store: 'meta', key: 'a', delete: true }]);
    expect(await db.get('meta', 'a')).toBeUndefined();
    expect(await db.all('meta')).toEqual([['b', 2]]);
    expect(await db.keys('collections')).toEqual(['c']);
    db.close();
    await deleteDb('test-db');
  });
});

describe('Workspace', () => {
  let ws;
  beforeEach(async () => {
    ws = await workspace();
  });

  it('creates collections and items and emits changes', async () => {
    const events = [];
    ws.on('change', (e) => events.push(e));
    const c = await ws.addCollection({ name: 'Shop' });
    const f = folder({ name: 'Orders' });
    await ws.addItem(c.id, c.id, f);
    const r = request({ name: 'List orders', url: 'https://x/orders' });
    await ws.addItem(c.id, f.id, r);
    const loc = ws.locate(r.id);
    expect(loc.collection.id).toBe(c.id);
    expect(loc.parents.map((p) => p.name)).toEqual(['Shop', 'Orders']);
    expect(events.every((e) => e.kind === 'collection')).toBe(true);
    expect(events[0].created).toBe(true);
  });

  it('persists through a reload', async () => {
    const db = new MemoryDb();
    const a = await workspace(db);
    const c = await a.addCollection({ name: 'Persisted' });
    await a.addItem(c.id, c.id, request({ name: 'R' }));
    await a.addEnvironment({ name: 'Dev', variables: [{ key: 'base', value: 'x' }] });
    await a.updateGlobals((g) => g.variables.push({ id: 'g1', key: 'k', value: 'v', enabled: true }));
    const b = await workspace(db);
    expect(b.collections[0].items[0].name).toBe('R');
    expect(b.environments[0].variables[0].key).toBe('base');
    expect(b.globals.variables[0].key).toBe('k');
  });

  it('saves a request draft over the stored one', async () => {
    const c = await ws.addCollection({ name: 'C' });
    const r = request({ name: 'Old', url: 'a' });
    await ws.addItem(c.id, c.id, r);
    await ws.saveRequest({ ...structuredClone(r), name: 'New', url: 'b' });
    expect(ws.locate(r.id).item).toMatchObject({ name: 'New', url: 'b' });
  });

  it('moves items within and across collections, refusing cycles', async () => {
    const a = await ws.addCollection({ name: 'A' });
    const b = await ws.addCollection({ name: 'B' });
    const f = folder({ name: 'F' });
    const inner = folder({ name: 'Inner' });
    const r1 = request({ name: 'r1' });
    const r2 = request({ name: 'r2' });
    await ws.addItem(a.id, a.id, f);
    await ws.addItem(a.id, f.id, inner);
    await ws.addItem(a.id, a.id, r1);
    await ws.addItem(a.id, a.id, r2);
    expect(await ws.moveItem(f.id, a.id, inner.id)).toBe(false);
    await ws.moveItem(r2.id, a.id, a.id, 0);
    expect(ws.getCollection(a.id).items.map((i) => i.name)).toEqual(['r2', 'F', 'r1']);
    await ws.moveItem(r1.id, a.id, a.id, 0);
    expect(ws.getCollection(a.id).items.map((i) => i.name)).toEqual(['r1', 'r2', 'F']);
    await ws.moveItem(f.id, b.id, b.id);
    expect(ws.getCollection(b.id).items[0].items[0].name).toBe('Inner');
    expect(ws.locate(inner.id).collection.id).toBe(b.id);
  });

  it('duplicates with fresh ids', async () => {
    const c = await ws.addCollection({ name: 'C' });
    const r = request({ name: 'R' });
    await ws.addItem(c.id, c.id, r);
    const copy = await ws.duplicateItem(r.id);
    expect(copy.id).not.toBe(r.id);
    expect(ws.getCollection(c.id).items.map((i) => i.name)).toEqual(['R', 'R Copy']);
    const cc = await ws.duplicateCollection(c.id);
    expect(cc.items.map((i) => i.id)).not.toContain(r.id);
  });

  it('applies script variable changes to each scope', async () => {
    const c = await ws.addCollection({ name: 'C', variables: [{ key: 'keep', value: '1' }, { key: 'drop', value: 'x' }] });
    const e = await ws.addEnvironment({ name: 'E' });
    await ws.applyVariableChanges({ environmentId: e.id, collectionId: c.id, changes: { environment: { token: 'abc' }, collection: { drop: null, keep: '2' }, globals: { g: 'G' } } });
    expect(ws.getEnvironment(e.id).variables.map((v) => [v.key, v.value])).toEqual([['token', 'abc']]);
    expect(ws.getCollection(c.id).variables.map((v) => [v.key, v.value])).toEqual([['keep', '2']]);
    expect(ws.globals.variables[0]).toMatchObject({ key: 'g', value: 'G' });
  });

  it('still finds every item and saves the collection after scripts change its variables', async () => {
    const db = new MemoryDb();
    const a = await workspace(db);
    const c = await a.addCollection({ name: 'C' });
    const f = folder({ name: 'F' });
    const r = request({ name: 'R' });
    await a.addItem(c.id, c.id, f);
    await a.addItem(c.id, f.id, r);
    await a.applyVariableChanges({ collectionId: c.id, changes: { collection: { token: 'abc' } } });
    expect(a.locate(r.id).parents.map((p) => p.name)).toEqual(['C', 'F']);
    expect(a.locate(f.id).collection.id).toBe(c.id);
    // Items added afterwards are found too.
    const r2 = request({ name: 'R2' });
    await a.addItem(c.id, f.id, r2);
    expect(a.locate(r2.id).item.name).toBe('R2');
    await a.flushWrites();
    const b = await workspace(db);
    expect(b.getCollection(c.id).variables.map((v) => [v.key, v.value])).toEqual([['token', 'abc']]);
  });

  describe('collection variables set by scripts', () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const stored = async (db, id) => (await db.get('collections', id))?.variables.map((v) => [v.key, v.value]);

    it('are stored once they pause, in one write with the latest values', async () => {
      const db = new MemoryDb();
      const a = await workspace(db);
      const c = await a.addCollection({ name: 'C' });
      const put = vi.spyOn(db, 'put');
      const events = [];
      a.on('change', (e) => events.push(e));
      for (let i = 1; i <= 5; i++) await a.applyVariableChanges({ collectionId: c.id, changes: { collection: { n: String(i) } } });
      // In memory and announced (the cloud sync uploads from memory) at once.
      expect(a.getCollection(c.id).variables.map((v) => [v.key, v.value])).toEqual([['n', '5']]);
      expect(events).toHaveLength(5);
      expect(put).not.toHaveBeenCalled();
      await wait(VARIABLES_WRITE_DELAY + 50);
      expect(put).toHaveBeenCalledTimes(1);
      expect(await stored(db, c.id)).toEqual([['n', '5']]);
    });

    it('keep being stored during a long run', async () => {
      const db = new MemoryDb();
      const a = await workspace(db);
      const c = await a.addCollection({ name: 'C' });
      const put = vi.spyOn(db, 'put');
      const start = Date.now();
      for (let i = 0; Date.now() - start < VARIABLES_WRITE_DELAY * 2.5; i++) {
        await a.applyVariableChanges({ collectionId: c.id, changes: { collection: { n: String(i) } } });
        await wait(20);
      }
      expect(put.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('are stored at once by flushWrites', async () => {
      const db = new MemoryDb();
      const a = await workspace(db);
      const c = await a.addCollection({ name: 'C' });
      const d = await a.addCollection({ name: 'D' });
      await a.applyVariableChanges({ collectionId: c.id, changes: { collection: { n: '1' } } });
      await a.applyVariableChanges({ collectionId: d.id, changes: { collection: { m: '2' } } });
      await a.flushWrites();
      expect(await stored(db, c.id)).toEqual([['n', '1']]);
      expect(await stored(db, d.id)).toEqual([['m', '2']]);
      const put = vi.spyOn(db, 'put');
      await wait(VARIABLES_WRITE_DELAY + 50);
      expect(put).not.toHaveBeenCalled();
      // Nothing waiting: nothing to write.
      await a.flushWrites();
      expect(put).not.toHaveBeenCalled();
    });

    it('do not bring back a collection deleted before they were stored, and keep later edits', async () => {
      const db = new MemoryDb();
      const a = await workspace(db);
      const c = await a.addCollection({ name: 'C' });
      const d = await a.addCollection({ name: 'D' });
      await a.applyVariableChanges({ collectionId: c.id, changes: { collection: { n: '1' } } });
      await a.applyVariableChanges({ collectionId: d.id, changes: { collection: { n: '1' } } });
      await a.deleteCollection(c.id);
      await a.updateCollection(d.id, (x) => {
        x.description = 'edited';
      });
      await wait(VARIABLES_WRITE_DELAY + 50);
      expect(await db.get('collections', c.id)).toBeUndefined();
      expect(await db.get('collections', d.id)).toMatchObject({ description: 'edited', variables: [{ key: 'n', value: '1' }] });
      const b = await workspace(db);
      expect(b.collections.map((x) => x.name)).toEqual(['D']);
    });

    it('report a refused write', async () => {
      const db = new MemoryDb();
      const a = await workspace(db);
      const c = await a.addCollection({ name: 'C' });
      const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
      db.put = vi.fn(async () => {
        throw quota;
      });
      const errors = [];
      a.on('storage-error', (e) => errors.push(e));
      await a.applyVariableChanges({ collectionId: c.id, changes: { collection: { n: '1' } } });
      await a.flushWrites();
      expect(errors).toEqual([quota]);
      // A connection already closed throws instead of rejecting: reported the same way.
      const closed = new DOMException('The database connection is closing.', 'InvalidStateError');
      db.put = () => {
        throw closed;
      };
      await a.applyVariableChanges({ collectionId: c.id, changes: { collection: { n: '2' } } });
      await a.flushWrites();
      expect(errors).toEqual([quota, closed]);
      expect(a.getCollection(c.id).variables[0].value).toBe('2');
    });
  });

  it('applies script variable changes to the entry reads use (last enabled)', async () => {
    const e = await ws.addEnvironment({
      name: 'E',
      variables: [
        { key: 'token', value: 'old', enabled: false },
        { key: 'token', value: 'cur' },
        { key: 'x', value: 'a' },
        { key: 'x', value: 'b' },
        { key: 'off', value: 'o', enabled: false },
        { key: 'gone', value: '1' },
        { key: 'gone', value: '2' },
        { key: 'gone', value: '3', enabled: false },
      ],
    });
    await ws.applyVariableChanges({ environmentId: e.id, changes: { environment: { token: 'NEW', x: 'c', off: 'on', gone: null } } });
    expect(ws.getEnvironment(e.id).variables.map((v) => [v.key, v.value, v.enabled])).toEqual([
      ['token', 'old', false],
      ['token', 'NEW', true],
      ['x', 'a', true],
      ['x', 'c', true],
      ['off', 'on', true],
      ['gone', '3', false],
    ]);
  });

  it('keeps history newest first and capped', async () => {
    for (let i = 0; i < 5; i++) await ws.addHistory({ request: request({ url: `https://h/${i}` }), response: { status: 200 } });
    expect(ws.history[0].request.url).toBe('https://h/4');
    await ws.mergeHistory([{ id: 'old', at: 1, request: request({ url: 'https://old' }) }]);
    expect(ws.history.at(-1).id).toBe('old');
    await ws.deleteHistory(['old']);
    expect(ws.history).toHaveLength(5);
    await ws.clearHistory();
    expect(ws.history).toHaveLength(0);
    expect(HISTORY_LIMIT).toBeGreaterThan(100);
  });

  it('collects local files referenced by a request body', async () => {
    const ref = await ws.putFile(new Blob(['data']));
    const r = request({ method: 'POST', body: { mode: 'binary', binary: { ref, name: 'a.bin', size: 4 } } });
    const files = await ws.filesFor(r);
    expect(files.has(ref)).toBe(true);
  });
});

/** Fake puter.fs over a Map of path -> { text, modified }. */
function fakeFs() {
  const files = new Map();
  let clock = 1000;
  const fs = {
    files,
    async mkdir() {},
    async write(path, data) {
      files.set(path, { text: data, modified: ++clock });
      return { path, modified: clock };
    },
    async read(path) {
      const f = files.get(path);
      if (!f) throw Object.assign(new Error('not found'), { code: 'subject_does_not_exist' });
      return new Blob([f.text]);
    },
    async readdir(dir) {
      const out = [];
      for (const [path, f] of files) {
        if (!path.startsWith(`${dir}/`)) continue;
        const rest = path.slice(dir.length + 1);
        if (!rest.includes('/')) out.push({ name: rest, path, isDir: false, modified: f.modified });
      }
      return out;
    },
    async delete(path) {
      files.delete(path);
    },
  };
  return fs;
}

describe('CloudSync', () => {
  it('uploads local changes and downloads them on another device', async () => {
    vi.useFakeTimers();
    const fs = fakeFs();
    const dbA = new MemoryDb();
    const a = await workspace(dbA);
    const syncA = new CloudSync({ ws: a, db: dbA, fs });
    await syncA.start();
    const c = await a.addCollection({ name: 'Shared' });
    await a.addEnvironment({ name: 'Prod' });
    await vi.advanceTimersByTimeAsync(2000);
    await syncA.flush();
    expect([...fs.files.keys()].some((p) => p === `workspace/collections/${c.id}.json`)).toBe(true);

    const dbB = new MemoryDb();
    const b = await workspace(dbB);
    const syncB = new CloudSync({ ws: b, db: dbB, fs });
    await syncB.start();
    expect(b.getCollection(c.id).name).toBe('Shared');
    expect(b.environments[0].name).toBe('Prod');

    // A rename on A reaches B on the next pull.
    await a.updateCollection(c.id, (x) => {
      x.name = 'Renamed';
    });
    await syncA.flush();
    await syncB.pull();
    expect(b.getCollection(c.id).name).toBe('Renamed');

    // A delete on B removes it from A.
    await b.deleteCollection(c.id);
    await syncB.flush();
    await syncA.pull();
    expect(a.getCollection(c.id)).toBeNull();
    vi.useRealTimers();
  });

  it('uploads collection variables set by scripts before they are stored on this device', async () => {
    const fs = fakeFs();
    const db = new MemoryDb();
    const a = await workspace(db);
    const sync = new CloudSync({ ws: a, db, fs });
    await sync.start();
    const c = await a.addCollection({ name: 'C' });
    await sync.flush();
    await a.applyVariableChanges({ collectionId: c.id, changes: { collection: { token: 'abc' } } });
    await sync.flush();
    expect((await db.get('collections', c.id)).variables).toEqual([]);
    const uploaded = JSON.parse(await (await fs.read(`workspace/collections/${c.id}.json`)).text());
    expect(uploaded.variables).toMatchObject([{ key: 'token', value: 'abc' }]);
    await a.flushWrites();
    expect((await db.get('collections', c.id)).variables).toMatchObject([{ key: 'token', value: 'abc' }]);
  });

  it('keeps the newer side when both changed', async () => {
    const fs = fakeFs();
    const db = new MemoryDb();
    const ws = await workspace(db);
    const sync = new CloudSync({ ws, db, fs });
    await sync.start();
    const c = await ws.addCollection({ name: 'Mine' });
    await sync.flush();
    // Another device writes an older edit to the same file.
    const remote = { ...structuredClone(ws.getCollection(c.id)), name: 'Theirs', updatedAt: 1 };
    await fs.write(`workspace/collections/${c.id}.json`, JSON.stringify(remote));
    await ws.updateCollection(c.id, (x) => {
      x.name = 'Mine, edited';
    });
    await sync.pull();
    expect(ws.getCollection(c.id).name).toBe('Mine, edited');
    expect(JSON.parse(fs.files.get(`workspace/collections/${c.id}.json`).text).name).toBe('Mine, edited');
  });

  it('uploads globals changed before sync started once forgotten', async () => {
    const fs = fakeFs();
    const db = new MemoryDb();
    const ws = await workspace(db);
    let sync = new CloudSync({ ws, db, fs });
    await sync.start();
    await ws.updateGlobals((g) => g.variables.push({ id: 'a', key: 'a', value: '1', enabled: true }));
    await sync.flush();
    sync.stop();
    // Signed out work moves in on the next sign-in before sync is running.
    const next = await workspace(db);
    await next.updateGlobals((g) => g.variables.push({ id: 'b', key: 'b', value: '2', enabled: true }));
    sync = new CloudSync({ ws: next, db, fs });
    await sync.forget('globals', 'globals');
    await sync.start();
    await sync.flush();
    expect(JSON.parse(fs.files.get('workspace/globals.json').text).variables.map((v) => v.key)).toEqual(['a', 'b']);
  });

  it('does not let new history postpone a pending collection upload', async () => {
    vi.useFakeTimers();
    const fs = fakeFs();
    const db = new MemoryDb();
    const ws = await workspace(db);
    const sync = new CloudSync({ ws, db, fs });
    await sync.start();
    const c = await ws.addCollection({ name: 'A' });
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(500);
      await ws.addHistory({ request: request({ url: `https://example.com/${i}` }), response: null });
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(fs.files.has(`workspace/collections/${c.id}.json`)).toBe(true);
    sync.stop();
    vi.useRealTimers();
  });

  it('uploads an edit made while a pulled copy was being stored', async () => {
    const fs = fakeFs();
    const db = new MemoryDb();
    const ws = await workspace(db);
    const sync = new CloudSync({ ws, db, fs });
    await sync.start();
    const c = await ws.addCollection({ name: 'Mine' });
    await sync.flush();
    await fs.write(`workspace/collections/${c.id}.json`, JSON.stringify({ ...structuredClone(ws.getCollection(c.id)), name: 'Remote' }));
    const put = db.put.bind(db);
    db.put = async (store, key, value) => {
      if (store === 'collections' && value.name === 'Remote') {
        db.put = put;
        await ws.updateCollection(c.id, (x) => {
          x.name = 'Edited during pull';
        });
      }
      return put(store, key, value);
    };
    await sync.pull();
    await sync.flush();
    expect(JSON.parse(fs.files.get(`workspace/collections/${c.id}.json`).text).name).toBe('Edited during pull');
    sync.stop();
  });

  it('does not bring back history deleted or cleared on another device', async () => {
    const fs = fakeFs();
    const dbA = new MemoryDb();
    const a = await workspace(dbA);
    const syncA = new CloudSync({ ws: a, db: dbA, fs });
    await syncA.start();
    for (let i = 0; i < 3; i++) await a.addHistory({ request: request({ url: `https://h/${i}` }), response: null });
    await syncA.flush();
    const dbB = new MemoryDb();
    const b = await workspace(dbB);
    const syncB = new CloudSync({ ws: b, db: dbB, fs });
    await syncB.start();
    expect(b.history).toHaveLength(3);

    await a.deleteHistory([a.history[0].id]);
    await syncA.flush();
    expect(fs.files.has('workspace/history.json')).toBe(true);
    await syncB.pull();
    expect(b.history).toHaveLength(2);

    await a.clearHistory();
    await syncA.flush();
    await syncB.pull();
    await syncB.flush();
    expect(b.history).toHaveLength(0);
    await syncA.pull();
    expect(a.history).toHaveLength(0);
    // New entries after the clear still sync.
    await new Promise((r) => setTimeout(r, 5));
    await b.addHistory({ request: request({ url: 'https://h/new' }), response: null });
    await syncB.flush();
    await syncA.pull();
    expect(a.history.map((h) => h.request.url)).toEqual(['https://h/new']);
    syncA.stop();
    syncB.stop();
  });

  it('shows the error state when an upload fails', async () => {
    const fs = fakeFs();
    const db = new MemoryDb();
    const ws = await workspace(db);
    const sync = new CloudSync({ ws, db, fs });
    await sync.start();
    fs.write = async () => {
      throw new Error('offline');
    };
    await ws.addCollection({ name: 'A' });
    await sync.flush();
    expect(sync.status).toBe('error');
    sync.stop();
  });

  it('ignores damaged files instead of wiping local data', async () => {
    const fs = fakeFs();
    await fs.write('workspace/collections/bad.json', '{not json');
    const db = new MemoryDb();
    const ws = await workspace(db);
    const sync = new CloudSync({ ws, db, fs });
    await sync.start();
    expect(ws.collections).toHaveLength(0);
    expect(sync.status).toBe('synced');
  });
});

describe('Storage failures', () => {
  it('keeps the edit, still emits the change and reports when a write is refused', async () => {
    const db = new MemoryDb();
    const ws = await workspace(db);
    const c = await ws.addCollection({ name: 'Shop' });
    const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
    db.put = vi.fn(async () => {
      throw quota;
    });
    const changes = [];
    const errors = [];
    ws.on('change', (e) => changes.push(e));
    ws.on('storage-error', (e) => errors.push(e));
    await ws.updateCollection(c.id, (x) => {
      x.description = 'edited';
    });
    expect(ws.getCollection(c.id).description).toBe('edited');
    expect(changes).toEqual([{ kind: 'collection', id: c.id }]);
    expect(errors).toEqual([quota]);
  });

  it('waits for the transaction to commit and rejects when it aborts', async () => {
    const db = await openDb('abort-db');
    const tx = db.db.transaction;
    db.db.transaction = function (...args) {
      const t = tx.apply(this, args);
      queueMicrotask(() => t.abort());
      return t;
    };
    await expect(db.put('meta', 'a', 1)).rejects.toBeTruthy();
    db.db.transaction = tx;
    expect(await db.get('meta', 'a')).toBeUndefined();
    db.close();
    await deleteDb('abort-db');
  });
});

describe('Deleting the database from another tab', () => {
  it('closes this connection so the delete goes through, and tells the app', async () => {
    const onVersionChange = vi.fn();
    const db = await openDb('shared-db', { onVersionChange });
    await db.put('meta', 'a', 1);
    await deleteDb('shared-db');
    expect(onVersionChange).toHaveBeenCalledOnce();
    const fresh = await openDb('shared-db');
    expect(await fresh.get('meta', 'a')).toBeUndefined();
    fresh.close();
    await deleteDb('shared-db');
  });
});

describe('collides', () => {
  it('finds a collection that reuses the id of a collection or of any item already here', async () => {
    const ws = await workspace();
    const r = request({ name: 'R' });
    const c = await ws.addCollection({ name: 'Mine', items: [folder({ name: 'F', items: [r] })] });
    expect(ws.collides({ id: c.id, items: [] })).toBe(true);
    expect(ws.collides({ id: 'other', items: [{ id: 'x', type: 'folder', items: [{ ...r }] }] })).toBe(true);
    expect(ws.collides({ id: 'other', items: [request({ name: 'New' })] })).toBe(false);
  });
});

describe('moving signed-out work into an account', () => {
  it('points the moved tabs and saved responses at requests that got new ids', async () => {
    const { moveGuestData } = await import('../src/data/migrate.js');
    const r = request({ name: 'Mine', url: 'https://a.test' });
    const guestDb = await openDb('guest-move');
    const guest = await workspace(guestDb);
    const c = await guest.addCollection({ type: 'collection', name: 'Guest', items: [r] });
    await guest.setMeta('tabs', { active: 't1', tabs: [{ id: 't1', kind: 'request', refId: r.id, draft: { ...r, url: 'https://edited.test' } }] });
    await guestDb.put('responses', r.id, { status: 201 });
    guestDb.close();

    const ws = await workspace();
    // The same request, imported into the account before.
    const mine = await ws.addCollection({ type: 'collection', name: 'Account', items: [{ ...r }] });
    await moveGuestData(ws, 'guest-move');
    const moved = ws.collections.find((x) => x.name === 'Guest');
    const newId = moved.items[0].id;
    expect(moved.id).not.toBe(c.id);
    expect(newId).not.toBe(r.id);
    const tab = (await ws.getMeta('tabs')).tabs[0];
    expect(tab.refId).toBe(newId);
    expect(tab.draft.id).toBe(newId);
    expect(await ws.db.get('responses', newId)).toEqual({ status: 201 });
    expect(await ws.db.get('responses', r.id)).toBeUndefined();
    expect(ws.locate(r.id).collection.id).toBe(mine.id);
  });
});

describe('moving signed-out work when this browser refuses a write', () => {
  it('fails and keeps the signed-out copy', async () => {
    const { moveGuestData } = await import('../src/data/migrate.js');
    const guestDb = await openDb('guest-full');
    const guest = await workspace(guestDb);
    await guest.addCollection({ name: 'Guest' });
    guestDb.close();
    const db = new MemoryDb();
    const ws = await workspace(db);
    db.put = async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    await expect(moveGuestData(ws, 'guest-full')).rejects.toThrow('Quota exceeded');
    const kept = await openDb('guest-full');
    expect((await kept.all('collections')).map(([, c]) => c.name)).toEqual(['Guest']);
    kept.close();
    await deleteDb('guest-full');
  });
});
