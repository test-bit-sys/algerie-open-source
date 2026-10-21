import { describe, it, expect, vi } from 'vitest';
import { createOutbox, memoryStorage, payloadString } from '../src/lib/outbox.js';

/** A KV that can be switched offline, and inspected. */
function fakeKV(initial = {}) {
  const data = new Map(Object.entries(initial));
  const kv = {
    online: true,
    data,
    async get(key) {
      if (!kv.online) throw new Error('offline');
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, payload) {
      if (!kv.online) throw new Error('offline');
      data.set(key, payload);
      return true;
    },
  };
  return kv;
}

const make = (initial) => {
  const kv = fakeKV(initial);
  let clock = 1000;
  const outbox = createOutbox({ storage: memoryStorage(), kv, now: () => ++clock });
  return { kv, outbox };
};

const list = (names) => JSON.stringify(names.map((name) => ({ name })));

describe('payloadString', () => {
  it('compares KV values as the strings they were stored as', () => {
    expect(payloadString('[]')).toBe('[]');
    expect(payloadString([{ a: 1 }])).toBe('[{"a":1}]');
    expect(payloadString(null)).toBeNull();
    expect(payloadString(undefined)).toBeNull();
  });
});

describe('working online', () => {
  it('keeps a local copy of what it reads', async () => {
    const { outbox } = make({ 'crm:contacts:v1': list(['Mei']) });
    await outbox.mirror('crm:contacts:v1', list(['Mei']));
    expect(await outbox.localValue('crm:contacts:v1')).toBe(list(['Mei']));
    expect(await outbox.hasLocalData()).toBe(true);
    expect(outbox.hasPending()).toBe(false);
  });

  it('owes nothing when KV takes the write', async () => {
    const { kv, outbox } = make();
    await outbox.stage('crm:deals:v1', list(['A']));
    await kv.set('crm:deals:v1', list(['A']));
    await outbox.confirm('crm:deals:v1', list(['A']));
    expect(outbox.pendingCount()).toBe(0);
    expect(await outbox.localValue('crm:deals:v1')).toBe(list(['A']));
  });
});

describe('working offline', () => {
  it('keeps the write, and the local copy a reload would read', async () => {
    const { kv, outbox } = make({ 'crm:contacts:v1': list(['Mei']) });
    await outbox.mirror('crm:contacts:v1', list(['Mei']));

    kv.online = false;
    await outbox.stage('crm:contacts:v1', list(['Mei', 'Sam']));
    await outbox.queue('crm:contacts:v1', list(['Mei', 'Sam']));

    expect(outbox.hasPending()).toBe(true);
    expect(await outbox.localValue('crm:contacts:v1')).toBe(list(['Mei', 'Sam']));
    expect(await outbox.pending()).toEqual([
      { key: 'crm:contacts:v1', at: expect.any(Number), conflict: false },
    ]);
  });

  it('replays in order when the connection returns', async () => {
    const { kv, outbox } = make();
    kv.online = false;
    await outbox.queue('crm:contacts:v1', list(['Mei']));
    await outbox.queue('crm:deals:v1', list(['A']));
    expect((await outbox.flush()).failed).toEqual(['crm:contacts:v1', 'crm:deals:v1']);

    kv.online = true;
    const result = await outbox.flush();
    expect(result.synced).toEqual(['crm:contacts:v1', 'crm:deals:v1']);
    expect(kv.data.get('crm:contacts:v1')).toBe(list(['Mei']));
    expect(outbox.hasPending()).toBe(false);
  });

  it('keeps only the newest write per collection', async () => {
    const { kv, outbox } = make();
    kv.online = false;
    await outbox.queue('crm:tasks:v1', list(['first']));
    await outbox.queue('crm:tasks:v1', list(['second']));
    expect(outbox.pendingCount()).toBe(1);

    kv.online = true;
    await outbox.flush();
    expect(kv.data.get('crm:tasks:v1')).toBe(list(['second']));
  });

  it('a read while offline does not overwrite a queued local edit', async () => {
    const { kv, outbox } = make({ 'crm:contacts:v1': list(['Mei']) });
    await outbox.mirror('crm:contacts:v1', list(['Mei']));
    kv.online = false;
    await outbox.stage('crm:contacts:v1', list(['Mei', 'Sam']));
    await outbox.queue('crm:contacts:v1', list(['Mei', 'Sam']));

    // Back online, something reads the old remote value before the flush.
    await outbox.mirror('crm:contacts:v1', list(['Mei']));
    expect(await outbox.localValue('crm:contacts:v1')).toBe(list(['Mei', 'Sam']));
  });
});

describe('conflicts', () => {
  async function conflicted() {
    const { kv, outbox } = make({ 'crm:deals:v1': list(['A']) });
    await outbox.mirror('crm:deals:v1', list(['A']));
    kv.online = false;
    await outbox.stage('crm:deals:v1', list(['A', 'mine']));
    await outbox.queue('crm:deals:v1', list(['A', 'mine']));
    // Another device wrote while this one was away.
    kv.data.set('crm:deals:v1', list(['A', 'theirs']));
    kv.online = true;
    return { kv, outbox };
  }

  it('refuses to overwrite work this device never saw', async () => {
    const { kv, outbox } = await conflicted();
    const result = await outbox.flush();
    expect(result).toMatchObject({ synced: [], conflicts: ['crm:deals:v1'] });
    // The other device's value still stands, and ours is still owed.
    expect(kv.data.get('crm:deals:v1')).toBe(list(['A', 'theirs']));
    expect(await outbox.conflicts()).toEqual(['crm:deals:v1']);
    expect(outbox.hasPending()).toBe(true);
  });

  it('stays conflicted across further flushes rather than resolving itself', async () => {
    const { outbox } = await conflicted();
    await outbox.flush();
    expect((await outbox.flush()).conflicts).toEqual(['crm:deals:v1']);
  });

  it('keeps this device’s version when asked', async () => {
    const { kv, outbox } = await conflicted();
    await outbox.flush();
    expect(await outbox.resolve('crm:deals:v1', 'mine')).toBe(true);
    expect(kv.data.get('crm:deals:v1')).toBe(list(['A', 'mine']));
    expect(outbox.hasPending()).toBe(false);
  });

  it('drops the queued write when the other version is chosen', async () => {
    const { kv, outbox } = await conflicted();
    await outbox.flush();
    expect(await outbox.resolve('crm:deals:v1', 'theirs')).toBe(true);
    expect(kv.data.get('crm:deals:v1')).toBe(list(['A', 'theirs']));
    expect(outbox.hasPending()).toBe(false);
    // The local copy is cleared, so the next read is the one that fills it.
    expect(await outbox.localValue('crm:deals:v1')).toBeNull();
  });

  it('says so when a resolution cannot be delivered', async () => {
    const { kv, outbox } = await conflicted();
    await outbox.flush();
    kv.online = false;
    expect(await outbox.resolve('crm:deals:v1', 'mine')).toBe(false);
    expect(outbox.hasPending()).toBe(true);
  });

  it('is not a conflict when this device is the only one that wrote', async () => {
    const { kv, outbox } = make({ 'crm:deals:v1': list(['A']) });
    await outbox.mirror('crm:deals:v1', list(['A']));
    kv.online = false;
    await outbox.queue('crm:deals:v1', list(['A', 'B']));
    kv.online = true;
    expect((await outbox.flush()).synced).toEqual(['crm:deals:v1']);
  });

  it('is not a conflict when the key never existed remotely', async () => {
    const { outbox } = make();
    await outbox.queue('crm:templates:v1', list(['T']));
    expect((await outbox.flush()).synced).toEqual(['crm:templates:v1']);
  });
});

describe('durability across sessions', () => {
  it('picks the queue back up from storage', async () => {
    const storage = memoryStorage();
    const kv = fakeKV();
    const first = createOutbox({ storage, kv });
    kv.online = false;
    await first.stage('crm:tasks:v1', list(['Call Mei']));
    await first.queue('crm:tasks:v1', list(['Call Mei']));

    // A new session over the same storage: the tab was closed offline.
    const second = createOutbox({ storage, kv });
    expect(await second.ready()).toBe(1);
    expect(second.hasPending()).toBe(true);
    expect(await second.localValue('crm:tasks:v1')).toBe(list(['Call Mei']));

    kv.online = true;
    expect((await second.flush()).synced).toEqual(['crm:tasks:v1']);
  });

  it('forgets everything when told to', async () => {
    const { outbox } = make();
    await outbox.stage('crm:contacts:v1', list(['Mei']));
    await outbox.queue('crm:contacts:v1', list(['Mei']));
    await outbox.clear();
    expect(outbox.hasPending()).toBe(false);
    expect(await outbox.hasLocalData()).toBe(false);
  });

  it('reports whether the local copy is really durable', async () => {
    expect(memoryStorage().durable).toBe(false);
    expect(createOutbox({ storage: memoryStorage(), kv: fakeKV() }).durable).toBe(false);
  });
});

describe('a store working through it', () => {
  it('survives a reload made while offline', async () => {
    // The shape of the promise: what was staged offline is what a cold
    // start reads back, without KV ever having seen it.
    const storage = memoryStorage();
    const kv = fakeKV();
    const outbox = createOutbox({ storage, kv });
    kv.online = false;
    const payload = list(['Logged the call']);
    await outbox.stage('crm:activities:v1', payload);
    await outbox.queue('crm:activities:v1', payload);

    const afterReload = createOutbox({ storage, kv });
    await afterReload.ready();
    expect(await afterReload.localValue('crm:activities:v1')).toBe(payload);
    expect(kv.data.has('crm:activities:v1')).toBe(false);
  });
});

describe('a replay racing a live write', () => {
  const KEY = 'crm:tasks:v1';

  /** A flush whose KV write is held until the test lets it land. */
  async function heldReplay(kv, outbox) {
    let release;
    const gate = new Promise((r) => { release = r; });
    const realSet = kv.set.bind(kv);
    kv.set = async (key, payload) => { await gate; return realSet(key, payload); };
    const flushing = outbox.flush();
    // Let the flush get as far as the write it is now waiting on.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return { flushing, release, realSet };
  }

  async function queuedOffline(kv, outbox, payload) {
    kv.online = false;
    await outbox.stage(KEY, payload);
    await outbox.queue(KEY, payload);
    kv.online = true;
  }

  it('keeps a write queued while the older one was in flight', async () => {
    const { kv, outbox } = make({ [KEY]: list(['A']) });
    await outbox.mirror(KEY, list(['A']));
    await queuedOffline(kv, outbox, list(['A', 'B']));

    const { flushing, release } = await heldReplay(kv, outbox);
    // The connection flaps: the user's next edit is staged and queued
    // while the replay of the previous one is still out.
    await outbox.stage(KEY, list(['A', 'B', 'C']));
    await outbox.queue(KEY, list(['A', 'B', 'C']));
    release();
    await flushing;

    // The newer edit is still owed and still what a reload would read -
    // and the next replay delivers it.
    expect(await outbox.localValue(KEY)).toBe(list(['A', 'B', 'C']));
    expect(kv.data.get(KEY)).toBe(list(['A', 'B', 'C']));
    expect(outbox.hasPending()).toBe(false);
  });

  it('does not let a replay bury a newer write that already landed', async () => {
    const { kv, outbox } = make({ [KEY]: list(['A']) });
    await outbox.mirror(KEY, list(['A']));
    await queuedOffline(kv, outbox, list(['A', 'B']));

    const { flushing, release, realSet } = await heldReplay(kv, outbox);
    // Back online, the store's next write goes straight to KV and lands
    // first; the slower replay of the older copy lands on top of it.
    await outbox.stage(KEY, list(['A', 'B', 'C']));
    await realSet(KEY, list(['A', 'B', 'C']));
    await outbox.confirm(KEY, list(['A', 'B', 'C']));
    release();
    await flushing;

    expect(kv.data.get(KEY)).toBe(list(['A', 'B', 'C']));
    expect(await outbox.localValue(KEY)).toBe(list(['A', 'B', 'C']));
    expect(outbox.hasPending()).toBe(false);
  });

  it('a read that answers after a write was staged does not overwrite it', async () => {
    const { kv, outbox } = make({ [KEY]: list(['A']) });
    await outbox.mirror(KEY, list(['A']));
    // The store stages its write and asks KV; a refresh read that started
    // earlier answers in between with the value KV had before.
    await outbox.stage(KEY, list(['A', 'B']));
    await outbox.mirror(KEY, list(['A']));
    expect(await outbox.localValue(KEY)).toBe(list(['A', 'B']));

    // Once KV has taken the write, reads are trusted again.
    await kv.set(KEY, list(['A', 'B']));
    await outbox.confirm(KEY, list(['A', 'B']));
    await outbox.mirror(KEY, list(['A', 'B', 'X']));
    expect(await outbox.localValue(KEY)).toBe(list(['A', 'B', 'X']));
  });

  it('a chosen version that lands over a newer write owes the newer one again', async () => {
    const { kv, outbox } = make({ [KEY]: list(['A']) });
    await outbox.mirror(KEY, list(['A']));
    await queuedOffline(kv, outbox, list(['A', 'mine']));
    kv.data.set(KEY, list(['A', 'theirs']));
    await outbox.flush();
    expect(await outbox.conflicts()).toEqual([KEY]);

    // While the user is deciding, they edit the same collection again and
    // it lands on its own; then they pick "keep mine" over the conflict.
    let release;
    const gate = new Promise((r) => { release = r; });
    const realSet = kv.set.bind(kv);
    kv.set = async (key, payload) => { await gate; return realSet(key, payload); };
    const resolving = outbox.resolve(KEY, 'mine');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await outbox.stage(KEY, list(['A', 'mine', 'more']));
    await realSet(KEY, list(['A', 'mine', 'more']));
    await outbox.confirm(KEY, list(['A', 'mine', 'more']));
    release();
    expect(await resolving).toBe(true);

    expect(outbox.hasPending()).toBe(true);
    expect((await outbox.flush()).synced).toEqual([KEY]);
    expect(kv.data.get(KEY)).toBe(list(['A', 'mine', 'more']));
  });
});
