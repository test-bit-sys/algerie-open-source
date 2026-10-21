/**
 * The offline-tolerant KV gate, run against a fake Puter whose failures
 * we script: network failures queue, real API errors surface, and the
 * queue replays latest-value-per-key on reconnect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const kvData = new Map();
let fail = null; // null | 'network' | 'api'
let gate = null; // holds exactly one kv.set in flight until released

const boom = () => {
  if (fail === 'network') throw new TypeError('Failed to fetch');
  if (fail === 'api') throw new Error('key too large');
};

/** The next kv.set stalls until release(); `entered` resolves once it has. */
function gateNextSet() {
  let enter, release;
  const entered = new Promise((r) => { enter = r; });
  const blocked = new Promise((r) => { release = r; });
  gate = { enter, blocked };
  return { entered, release };
}

globalThis.puter = globalThis.puter || {};
globalThis.puter.kv = {
  get: async (k) => { boom(); return kvData.has(k) ? kvData.get(k) : null; },
  set: async (k, v) => {
    boom();
    if (gate) {
      const g = gate;
      gate = null;
      g.enter();
      await g.blocked;
      boom(); // a held request can die on release, like a real timeout
    }
    kvData.set(k, v);
    return true;
  },
  del: async (k) => { boom(); kvData.delete(k); return true; },
};

const { kvGet, kvSet, kvDel, flushQueue, pendingWrites, initSync, adoptAccount, releaseAccount } = await import('../src/lib/cloud.js');
const { __resetMemoryState, cacheGet } = await import('../src/lib/offline.js');

const goOffline = () => vi.stubGlobal('navigator', { onLine: false });

beforeEach(async () => {
  kvData.clear();
  fail = null;
  gate = null;
  __resetMemoryState();
  await initSync();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('online', () => {
  it('passes writes and reads through, nothing pending', async () => {
    await kvSet('a', { n: 1 });
    expect(kvData.get('a')).toEqual({ n: 1 });
    expect(await kvGet('a')).toEqual({ n: 1 });
    expect(pendingWrites()).toBe(0);
  });

  it('rethrows real API errors instead of queueing them', async () => {
    fail = 'api';
    await expect(kvSet('a', 1)).rejects.toThrow('key too large');
    expect(pendingWrites()).toBe(0);
  });

  it('lands rapid writes to one key in call order', async () => {
    const { entered, release } = gateNextSet();
    const first = kvSet('a', 1); // stalls on the wire
    await entered;
    const second = kvSet('a', 2);
    // The newer write waits its turn instead of overtaking on the wire —
    // finishing first would let the server apply the older value last.
    await new Promise((r) => setTimeout(r, 0));
    expect(kvData.has('a')).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(kvData.get('a')).toBe(2);
  });

  it('captures an object at save time even while a preceding write is in flight', async () => {
    const { entered, release } = gateNextSet();
    const first = kvSet('a', { n: 0 });
    await entered;
    const value = { nested: { n: 1 } };
    const second = kvSet('a', value);
    value.nested.n = 2;
    release();
    await Promise.all([first, second]);
    expect(kvData.get('a')).toEqual({ nested: { n: 1 } });
  });

  it('keeps writing after one write in the chain fails', async () => {
    fail = 'api';
    await expect(kvSet('a', 1)).rejects.toThrow('key too large');
    fail = null;
    await kvSet('a', 2);
    expect(kvData.get('a')).toBe(2);
  });
});

describe('offline', () => {
  it('keeps a queued snapshot unchanged when its source data is edited', async () => {
    goOffline();
    const products = [{ id: 'p1', stock: { shelf: 5 } }];
    await kvSet('inv:backup:test', { data: { products } });
    products[0].stock.shelf = 1;
    products.push({ id: 'p2', stock: {} });

    const saved = await kvGet('inv:backup:test');
    expect(saved.data.products).toEqual([{ id: 'p1', stock: { shelf: 5 } }]);
    saved.data.products[0].stock.shelf = 99;
    expect((await kvGet('inv:backup:test')).data.products[0].stock.shelf).toBe(5);

    vi.unstubAllGlobals();
    await flushQueue();
    expect(kvData.get('inv:backup:test').data.products).toEqual([{ id: 'p1', stock: { shelf: 5 } }]);
  });

  it('queues writes and serves them back to reads', async () => {
    goOffline();
    await kvSet('a', { n: 1 });
    expect(kvData.has('a')).toBe(false);
    expect(pendingWrites()).toBe(1);
    // The app keeps working against its own latest value.
    expect(await kvGet('a')).toEqual({ n: 1 });
  });

  it('keeps only the latest value per key', async () => {
    goOffline();
    await kvSet('a', 1);
    await kvSet('a', 2);
    await kvSet('b', 9);
    expect(pendingWrites()).toBe(2);

    vi.unstubAllGlobals();
    expect(await flushQueue()).toBe(2);
    expect(kvData.get('a')).toBe(2);
    expect(kvData.get('b')).toBe(9);
    expect(pendingWrites()).toBe(0);
  });

  it('queues on a network failure even while claiming to be online', async () => {
    fail = 'network';
    await kvSet('a', 5);
    expect(pendingWrites()).toBe(1);
    fail = null;
    await flushQueue();
    expect(kvData.get('a')).toBe(5);
  });

  it.each([
    ['set', 'set'], ['set', 'delete'], ['delete', 'set'], ['delete', 'delete'],
  ])('keeps the newest rapid write (%s then %s) when both requests fail on the network', async (earlier, operation) => {
    kvData.set('a', 'initial');
    fail = 'network';
    const first = earlier === 'delete' ? kvDel('a') : kvSet('a', 'old');
    const second = operation === 'delete' ? kvDel('a') : kvSet('a', 'new');
    await Promise.all([first, second]);
    fail = null;
    await flushQueue();
    if (operation === 'delete') expect(kvData.has('a')).toBe(false);
    else expect(kvData.get('a')).toBe('new');
    expect(pendingWrites()).toBe(0);
  });

  it('protects a newer offline edit from both earlier requests failing', async () => {
    const blocked = gateNextSet();
    const first = kvSet('a', 'old');
    await blocked.entered;
    const second = kvSet('a', 'middle');
    await new Promise((resolve) => setTimeout(resolve, 0));
    goOffline();
    await kvSet('a', 'newest');
    fail = 'network';
    blocked.release();
    await Promise.all([first, second]);
    fail = null;
    vi.unstubAllGlobals();
    await flushQueue();
    expect(kvData.get('a')).toBe('newest');
    expect(pendingWrites()).toBe(0);
  });

  it('does not replay a failed earlier request after the next save succeeds', async () => {
    const blocked = gateNextSet();
    const first = kvSet('a', 'old');
    await blocked.entered;
    const second = kvSet('a', 'new');
    fail = 'network';
    blocked.release();
    await first;
    fail = null;
    await second;
    await flushQueue();
    expect(kvData.get('a')).toBe('new');
    expect(pendingWrites()).toBe(0);
  });

  it('serves cached reads when the cloud is unreachable', async () => {
    await kvSet('a', 7); // online: written and mirrored
    fail = 'network';
    expect(await kvGet('a')).toBe(7);
    // Never-seen keys still fail — nothing to invent.
    await expect(kvGet('never')).rejects.toThrow();
  });

  it('queues deletions and replays them', async () => {
    await kvSet('a', 1);
    goOffline();
    await kvDel('a');
    expect(await kvGet('a')).toBeNull();
    vi.unstubAllGlobals();
    await flushQueue();
    expect(kvData.has('a')).toBe(false);
    expect(pendingWrites()).toBe(0);
  });

  it('stops a flush at the first network failure and resumes later', async () => {
    goOffline();
    await kvSet('a', 1);
    vi.unstubAllGlobals();
    fail = 'network';
    expect(await flushQueue()).toBe(0);
    expect(pendingWrites()).toBe(1);
    fail = null;
    expect(await flushQueue()).toBe(1);
    expect(kvData.get('a')).toBe(1);
  });

  it('lets a successful direct write supersede an older queued one', async () => {
    goOffline();
    await kvSet('a', 'stale');
    vi.unstubAllGlobals();
    await kvSet('a', 'fresh'); // back online, direct write lands
    expect(pendingWrites()).toBe(0);
    await flushQueue();
    expect(kvData.get('a')).toBe('fresh'); // the stale value never replays
  });

  it('keeps a value queued while its key is being replayed', async () => {
    goOffline();
    await kvSet('a', 'v1');
    vi.unstubAllGlobals();

    const { entered, release } = gateNextSet();
    const flush = flushQueue(); // starts replaying 'a' → v1
    await entered;              // v1 is on the wire

    goOffline();
    await kvSet('a', 'v2');     // edited again mid-flight; queues v2
    vi.unstubAllGlobals();

    release();
    await flush;

    // v2 must not be dropped by the replay's clean-up of 'a'.
    expect(pendingWrites()).toBe(1);
    expect(await flushQueue()).toBe(1);
    expect(kvData.get('a')).toBe('v2');
  });

  it('keeps a value queued while a direct write for its key is in flight', async () => {
    const { entered, release } = gateNextSet();
    const write = kvSet('a', 'v1'); // online, held on the wire
    await entered;

    goOffline();
    await kvSet('a', 'v2'); // connection drops mid-flight; queues v2

    vi.unstubAllGlobals();
    release();
    await write; // v1's response finally arrives

    // v1 landing must not clear the newer v2 out of the queue.
    expect(pendingWrites()).toBe(1);
    await flushQueue();
    expect(kvData.get('a')).toBe('v2');
  });

  it('a write that hangs and then dies never buries a newer queued value', async () => {
    const { entered, release } = gateNextSet();
    const write = kvSet('a', 'v1'); // held on the wire
    await entered;

    goOffline();
    await kvSet('a', 'v2'); // user keeps working; queues v2

    fail = 'network'; // the hung request finally times out
    release();
    await write;
    fail = null;

    vi.unstubAllGlobals();
    await flushQueue();
    expect(kvData.get('a')).toBe('v2'); // v1 must not have replaced it
    expect(pendingWrites()).toBe(0);
  });

  it('lands a direct write after a flush that is replaying the same key', async () => {
    goOffline();
    await kvSet('a', 'old');
    vi.unstubAllGlobals();

    const { entered, release } = gateNextSet();
    const flush = flushQueue(); // replaying 'a' → 'old', held on the wire
    await entered;

    const write = kvSet('a', 'new'); // online direct write, must not be overtaken
    release();
    await flush;
    await write;

    expect(kvData.get('a')).toBe('new');
    expect(pendingWrites()).toBe(0);
  });

  it.each(['set', 'delete'])('does not replay an old %s over a direct write already in flight', async (operation) => {
    goOffline();
    if (operation === 'delete') await kvDel('a');
    else await kvSet('a', 'old');
    vi.unstubAllGlobals();

    const directGate = gateNextSet();
    const write = kvSet('a', 'new');
    await directGate.entered;

    const replayGate = gateNextSet();
    const flush = flushQueue();
    // Give replay a turn while the newer direct request is held.
    await new Promise((resolve) => setTimeout(resolve, 0));
    directGate.release();
    await write;
    replayGate.release();
    await flush;

    expect(kvData.get('a')).toBe('new');
    expect(pendingWrites()).toBe(0);
  });

  it('a different account signing in inherits neither mirror nor queue', async () => {
    const ls = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, v),
      removeItem: (k) => ls.delete(k),
    });
    await adoptAccount('user-a');
    vi.stubGlobal('navigator', { onLine: false });
    await kvSet('inv:products:v2', ['user-a private data']);
    expect(pendingWrites()).toBe(1);

    await adoptAccount('user-b');
    // Nothing of A's left to replay into B's account, or to read back.
    expect(pendingWrites()).toBe(0);
    expect(await cacheGet('inv:products:v2')).toBeUndefined();
  });

  it('the same account keeps its offline work across boots', async () => {
    const ls = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, v),
      removeItem: (k) => ls.delete(k),
    });
    await adoptAccount('user-a');
    vi.stubGlobal('navigator', { onLine: false });
    await kvSet('a', 1);
    await adoptAccount('user-a'); // next boot, same user
    expect(pendingWrites()).toBe(1);
    // An offline boot can't know the user; that must not wipe anything.
    await adoptAccount(null);
    expect(pendingWrites()).toBe(1);
  });

  it('sign-out clears the mirror and queue', async () => {
    const ls = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, v),
      removeItem: (k) => ls.delete(k),
    });
    await adoptAccount('user-a');
    vi.stubGlobal('navigator', { onLine: false });
    await kvSet('a', 1);
    await releaseAccount();
    expect(pendingWrites()).toBe(0);
    expect(await cacheGet('a')).toBeUndefined();
    expect(ls.has('inventory:mirror-owner')).toBe(false);
  });

  it('scopes the mirror to its account even with no localStorage at all', async () => {
    // No localStorage stub: the marker must live with the mirror itself.
    await adoptAccount('user-a');
    goOffline();
    await kvSet('inv:products:v2', ['user-a private data']);
    expect(pendingWrites()).toBe(1);

    await adoptAccount('user-b');
    expect(pendingWrites()).toBe(0);
    expect(await cacheGet('inv:products:v2')).toBeUndefined();

    // And the same account still keeps its queue.
    goOffline();
    await kvSet('a', 1);
    await adoptAccount('user-b');
    expect(pendingWrites()).toBe(1);
  });

  it('honors a marker left by builds that kept it in localStorage', async () => {
    const ls = new Map([['inventory:mirror-owner', 'user-a']]);
    vi.stubGlobal('localStorage', {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, v),
      removeItem: (k) => ls.delete(k),
    });
    goOffline();
    await kvSet('a', 'user-a leftovers');
    await adoptAccount('user-b');
    expect(pendingWrites()).toBe(0);
    // Migrated: the legacy slot is gone, the marker now travels with
    // the mirror.
    expect(ls.has('inventory:mirror-owner')).toBe(false);
    await adoptAccount('user-b');
    expect(pendingWrites()).toBe(0);
  });

  it('retries a queued write by itself while the browser stays online', async () => {
    vi.useFakeTimers();
    fail = 'network';
    await kvSet('a', 5); // dies on the wire, queues, arms the retry
    expect(pendingWrites()).toBe(1);
    fail = null;
    await vi.advanceTimersByTimeAsync(4000);
    expect(kvData.get('a')).toBe(5);
    expect(pendingWrites()).toBe(0);
  });
});
