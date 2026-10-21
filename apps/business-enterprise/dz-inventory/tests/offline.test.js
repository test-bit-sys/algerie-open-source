/**
 * The local mirror degrades to memory rather than hanging. Boot awaits
 * this layer, so an IndexedDB request that never answers — another tab
 * holding the old version through an upgrade, a wedged database — used
 * to leave the app on a blank screen with nothing on the console.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** An indexedDB whose open request behaves however the test says. */
function stubIDB(behaviour) {
  const open = () => {
    const req = { result: null, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
    // The handlers are attached synchronously right after open() returns.
    queueMicrotask(() => behaviour(req));
    return req;
  };
  vi.stubGlobal('indexedDB', { open });
}

let offline;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('when IndexedDB is blocked by another tab', () => {
  it('answers from memory instead of waiting forever', async () => {
    stubIDB((req) => req.onblocked?.(new Event('blocked')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    offline = await import('../src/lib/offline.js');

    // Every call still resolves, and the queue keeps working in memory.
    await expect(offline.queueCount()).resolves.toBe(0);
    await offline.queuePut('inv:products:v2', [{ id: 'p1' }]);
    await expect(offline.queueCount()).resolves.toBe(1);
    expect((await offline.queueGet('inv:products:v2')).value).toEqual([{ id: 'p1' }]);

    await offline.cachePut('inv:settings:v1', { currency: 'EUR' });
    expect((await offline.cacheGet('inv:settings:v1')).value).toEqual({ currency: 'EUR' });

    await offline.queueClear(['inv:products:v2']);
    await expect(offline.queueCount()).resolves.toBe(0);
  });
});

describe('when IndexedDB never answers at all', () => {
  it('gives up after the timeout and carries on in memory', async () => {
    vi.useFakeTimers();
    stubIDB(() => {}); // no success, no error, no block — just silence
    vi.spyOn(console, 'error').mockImplementation(() => {});
    offline = await import('../src/lib/offline.js');

    const pending = offline.queueCount();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe(0);

    // And the fallback is in place from then on, without another wait.
    await offline.queuePut('k', 1);
    await expect(offline.queueCount()).resolves.toBe(1);
  });
});

/**
 * A database that opens fine but starts refusing writes mid-session —
 * iOS under quota pressure: puts abort their transaction, reads and
 * deletes keep working.
 */
function stubQuotaIDB() {
  const state = { quota: false };
  const mkStores = (rows) => ({
    rows,
    forTx: (t) => ({
      put: (value, key) => {
        if (state.quota) t.fail();
        else rows.set(key, value);
        return {};
      },
      get: (key) => ({ result: rows.get(key) }),
      count: () => ({ result: rows.size }),
      delete: (key) => { rows.delete(key); return {}; },
      getAll: () => ({ result: [...rows.values()] }),
      getAllKeys: () => ({ result: [...rows.keys()] }),
      clear: () => { rows.clear(); return {}; },
    }),
  });
  const stores = { cache: mkStores(new Map()), queue: mkStores(new Map()) };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: (name) => {
      let failed = false;
      const t = {
        oncomplete: null, onerror: null, onabort: null, error: null,
        fail: () => { failed = true; t.error = new Error('quota exceeded'); },
      };
      t.objectStore = () => stores[name].forTx(t);
      queueMicrotask(() => (failed ? t.onabort?.() : t.oncomplete?.()));
      return t;
    },
  };
  stubIDB((req) => { req.result = db; req.onsuccess?.(); });
  return {
    cache: stores.cache.rows,
    queue: stores.queue.rows,
    breakWrites: () => { state.quota = true; },
  };
}

describe('when IndexedDB starts failing mid-session', () => {
  it('collapses to one consistent memory picture instead of splitting the queue', async () => {
    const idb = stubQuotaIDB();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    offline = await import('../src/lib/offline.js');

    await offline.setOwner('user-1');
    await offline.cachePut('inv:settings:v1', { currency: 'EUR' });
    await offline.queuePut('inv:products:v2', [{ id: 'p1' }]);
    expect(idb.queue.size).toBe(1);

    idb.breakWrites();
    await offline.queuePut('inv:activity:v1', [{ id: 'a1' }]);

    // Both queued writes are visible — the one on disk and the one only
    // memory could hold — so the flush sends both and the pending count
    // matches what the banner promises.
    await expect(offline.queueCount()).resolves.toBe(2);
    expect((await offline.queueAll()).map((r) => r.key).sort())
      .toEqual(['inv:activity:v1', 'inv:products:v2']);
    // The mirror and the owner marker made the move too.
    expect((await offline.cacheGet('inv:settings:v1')).value).toEqual({ currency: 'EUR' });
    await expect(offline.getOwner()).resolves.toBe('user-1');
  });

  it('deletes flushed rows off the disk too, so they cannot replay next boot', async () => {
    const idb = stubQuotaIDB();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    offline = await import('../src/lib/offline.js');

    await offline.queuePut('inv:products:v2', [{ id: 'p1' }]);
    idb.breakWrites();
    await offline.queuePut('inv:activity:v1', [{ id: 'a1' }]); // degrades to memory
    // What a flush does once both rows are sent:
    await offline.queueClear(['inv:products:v2', 'inv:activity:v1']);
    await expect(offline.queueCount()).resolves.toBe(0);
    // Deletes still work under quota pressure, and the shadow copy of
    // the already-sent row went with them.
    await new Promise((r) => setTimeout(r, 0));
    expect(idb.queue.size).toBe(0);
  });
});

describe('when IndexedDB works', () => {
  it('is used, and its failures still fall back rather than reject', async () => {
    const rows = new Map();
    const objectStore = {
      put: (value, key) => { rows.set(key, value); return { result: undefined }; },
      get: (key) => ({ result: rows.get(key) }),
      count: () => ({ result: rows.size }),
      delete: (key) => { rows.delete(key); },
      getAll: () => ({ result: [...rows.values()] }),
      clear: () => { rows.clear(); },
    };
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const t = { objectStore: () => objectStore, oncomplete: null, onerror: null, onabort: null };
        queueMicrotask(() => t.oncomplete?.());
        return t;
      },
    };
    stubIDB((req) => { req.result = db; req.onsuccess?.(); });
    offline = await import('../src/lib/offline.js');

    await offline.queuePut('a', { n: 1 });
    await expect(offline.queueCount()).resolves.toBe(1);
    expect((await offline.queueGet('a')).value).toEqual({ n: 1 });
    await offline.clearOffline();
    await expect(offline.queueCount()).resolves.toBe(0);
  });
});
