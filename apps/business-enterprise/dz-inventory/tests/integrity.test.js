import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { kvSet, kvGet, flushQueue, initSync, pendingWrites, syncEvents, lastSyncError } from '../src/lib/cloud.js';
import { __resetMemoryState, queueGet } from '../src/lib/offline.js';
import { OP_PREFIX, Persistence } from '../src/lib/persistence.js';

const Store = store.constructor;
const db = new Map();
const copy = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
let rejectWrite, rejectRead, writes, onSet;
const fresh = async () => { const s = new Store(); await s.init(); return s; };
beforeEach(async () => {
  db.clear(); __resetMemoryState();
  rejectWrite = rejectRead = () => false;
  writes = []; onSet = null;
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('puter', {
    auth: { getUser: async () => ({ username: 'tester' }) },
    kv: {
      get: async (key) => { if (rejectRead(key)) throw new Error('Read rejected'); return copy(db.get(key) ?? null); },
      set: async (key, value) => {
        writes.push(key);
        if (rejectWrite(key)) throw new Error('Write rejected');
        if (onSet) await onSet(key, value);
        db.set(key, copy(value)); return true;
      },
      del: async (key) => { if (rejectWrite(key)) throw new Error('Delete rejected'); db.delete(key); return true; },
      list: async (pattern) => [...db.keys()].filter((key) => key.startsWith(pattern.replace(/\*$/, ''))),
    },
  });
  await initSync();
});
afterEach(async () => { await initSync(); vi.unstubAllGlobals(); });

describe('#34 independent session writes', () => {
  it('does not apply the first journal commit twice when it arrives during initialization', async () => {
    const reader = new Persistence(); await reader.init();
    const s = await fresh();
    const p = await s.addProduct({ name: 'A', quantity: 10 });
    const rows = await reader.read('inv:products:v2');
    rows[0].name = 'Renamed';
    await reader.write('inv:products:v2', rows);
    expect((await fresh()).productById(p.id)).toMatchObject({ name: 'Renamed', quantity: 10 });
  });
  it('keeps stock movements and history from stale sessions editing separate products', async () => {
    const a = await fresh();
    const p = await a.addProduct({ name: 'A', quantity: 10 });
    const q = await a.addProduct({ name: 'B', quantity: 10 });
    const b = await fresh();
    await a.adjustStock(p.id, { delta: -2, reason: 'sold' });
    await b.adjustStock(q.id, { delta: 5 });
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(8);
    expect(loaded.productById(q.id).quantity).toBe(15);
    expect(loaded.activity.filter((row) => ['add', 'remove'].includes(row.kind)).map((r) => r.delta).sort((a,b) => a-b)).toEqual([-2, 5]);
  });

  it('preserves simultaneous movements of the same product across independently loaded sessions', async () => {
    const a = await fresh();
    const p = await a.addProduct({ name: 'A', quantity: 10 });
    const b = await fresh();
    let release;
    const gate = new Promise((r) => { release = r; });
    let entries = 0;
    onSet = async (key) => {
      if (!key.startsWith(OP_PREFIX)) return;
      if (++entries === 2) release();
      if (entries <= 2) await gate;
    };
    await Promise.all([a.adjustStock(p.id, { delta: -2 }), b.adjustStock(p.id, { delta: 5 })]);
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(13);
    expect(Object.values(loaded.productById(p.id).stock)).toEqual([13]);
    expect(loaded.activity.filter((row) => row.kind === 'add' || row.kind === 'remove')).toHaveLength(2);
  });

  it('merges offline replay with newer cloud movements, without replaying a movement twice', async () => {
    const a = await fresh();
    const p = await a.addProduct({ name: 'A', quantity: 10 });
    const b = await fresh();
    await b.adjustStock(p.id, { delta: 5 });
    navigator.onLine = false;
    await a.adjustStock(p.id, { delta: -2 });
    navigator.onLine = true;
    await flushQueue(); await flushQueue();
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(13);
    expect(loaded.activity.filter((row) => row.kind === 'remove')).toHaveLength(1);
  });

  it('preserves products created concurrently in an empty account', async () => {
    const a = await fresh(), b = await fresh();
    await Promise.all([a.addProduct({ name: 'A', quantity: 2 }), b.addProduct({ name: 'B', quantity: 3 })]);
    expect((await fresh()).products.map((p) => p.name).sort()).toEqual(['A', 'B']);
  });

  it('exposes both committed removals for recovery if truly simultaneous sales overdraw stock', async () => {
    const a = await fresh();
    const p = await a.addProduct({ name: 'A', quantity: 10 });
    const b = await fresh();
    let release, entered = 0;
    const gate = new Promise((r) => { release = r; });
    onSet = async (key) => {
      if (!key.startsWith(OP_PREFIX)) return;
      if (++entered === 2) release();
      await gate;
    };
    await Promise.all([a.adjustStock(p.id, { delta: -8 }), b.adjustStock(p.id, { delta: -8 })]);
    const error = await fresh().catch((err) => err);
    expect(error.code).toBe('INVENTORY_CONFLICT');
    expect(error.recovery.operations).toHaveLength(3);
    expect(error.message).toContain('Download the recovery data');
  });

  it('preserves a receipt into a dated lot another session completely consumed', async () => {
    const a = await fresh();
    const p = await a.addProduct({ name: 'Dated', quantity: 5, trackExpiry: true });
    const b = await fresh();
    await a.adjustStock(p.id, { delta: -5 });
    await b.adjustStock(p.id, { delta: 2 });
    __resetMemoryState();
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(2);
    expect(Object.values(loaded.productById(p.id).lots).flat()).toEqual([{ date: '', qty: 2 }]);
  });

  it('rejects a stale removal that would overdraw stock without recording a phantom sale', async () => {
    const a = await fresh();
    const p = await a.addProduct({ name: 'A', quantity: 10 });
    const b = await fresh();
    await a.adjustStock(p.id, { delta: -8, reason: 'sold' });
    await expect(b.adjustStock(p.id, { delta: -8, reason: 'sold' })).rejects.toThrow(/Conflicting/);
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(2);
    expect(loaded.activity.filter((e) => e.kind === 'remove')).toHaveLength(1);
  });
});

describe('#35 receipt recovery', () => {
  it('replays an acknowledged-late receipt with the same commit id exactly once', async () => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Delivery', quantity: 0 });
    const order = await s.placeOrder({ lines: [{ productId: p.id, qty: 5 }] });
    onSet = async (key, value) => {
      if (!key.startsWith(OP_PREFIX)) return;
      db.set(key, copy(value));
      onSet = null;
      throw new TypeError('Response lost after the server committed');
    };
    await s.receiveOrder(order.id);
    expect(pendingWrites()).toBeGreaterThan(0);
    await flushQueue(); await flushQueue();
    __resetMemoryState();
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(5);
    expect(loaded.activity.filter((e) => e.kind === 'add')).toHaveLength(1);
  });
  it.each(['inv:products:v2', 'inv:orders:v1', 'inv:activity:v1'])('recovers the entire receipt after %s rejects', async (key) => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Delivery', quantity: 0 });
    const order = await s.placeOrder({ lines: [{ productId: p.id, qty: 5, price: 2 }] });
    rejectWrite = (k) => k === key;
    await expect(s.receiveOrder(order.id)).rejects.toThrow(/recorded/);
    rejectWrite = () => false;
    __resetMemoryState();
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(5);
    expect(loaded.orderById(order.id)).toMatchObject({ status: 'received', lines: [{ received: 5 }] });
    expect(loaded.activity.filter((e) => e.kind === 'add' && e.productId === p.id)).toHaveLength(1);
    await expect(loaded.receiveOrder(order.id)).rejects.toThrow('Order not found');
    expect((await fresh()).productById(p.id).quantity).toBe(5);
  });

  it('rolls back a rejected commit so a receipt can be retried once', async () => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Delivery', quantity: 0 });
    const order = await s.placeOrder({ lines: [{ productId: p.id, qty: 5 }] });
    rejectWrite = (k) => k.startsWith(OP_PREFIX);
    await expect(s.receiveOrder(order.id)).rejects.toThrow();
    expect(p.quantity).toBe(0);
    expect(order.status).toBe('ordered');
    rejectWrite = () => false;
    await s.receiveOrder(order.id);
    expect((await fresh()).productById(p.id).quantity).toBe(5);
  });
});

describe('#36 rejected offline writes', () => {
  it('retains an API-rejected value and reports only successful siblings', async () => {
    await kvSet('a', 10);
    navigator.onLine = false;
    await kvSet('a', 7); await kvSet('b', 2);
    navigator.onLine = true;
    rejectWrite = (key) => key === 'a';
    const success = vi.fn(); syncEvents.addEventListener('flushed', success);
    try {
      expect(await flushQueue()).toBe(1);
      expect(pendingWrites()).toBe(1);
      expect((await queueGet('a')).value).toBe(7);
      expect(lastSyncError()).toBeInstanceOf(Error);
      expect(success).not.toHaveBeenCalled();
      expect(await kvGet('a')).toBe(7);
      rejectWrite = () => false;
      expect(await flushQueue()).toBe(1);
      expect(pendingWrites()).toBe(0);
      expect(db.get('a')).toBe(7);
      expect(success).toHaveBeenCalledOnce();
    } finally { syncEvents.removeEventListener('flushed', success); }
  });
});

const kitSetup = async () => {
  const s = await fresh();
  const a = await s.addProduct({ name: 'A', quantity: 1, cost: 2 });
  const b = await s.addProduct({ name: 'B', quantity: 10, cost: 3 });
  const kit = await s.addProduct({ name: 'Kit', kit: 'sell', price: 20, components: [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 1 }] });
  return { s, a, b, kit };
};
describe('#37 fulfillable kit sales', () => {
  it.each(['basket', 'individual'])('caps %s sales to the complete recipe and books only fulfilled revenue', async (path) => {
    const { s, a, b, kit } = await kitSetup();
    if (path === 'basket') {
      await s.startTakeout({ reason: 'sold' }); await s.addToTakeout(kit.id, { qty: 5 }); await s.applyTakeout();
    } else await s.adjustStock(kit.id, { delta: -5, reason: 'sold', price: 20 });
    expect(a.quantity).toBe(0); expect(b.quantity).toBe(9);
    expect(s.activity.find((e) => e.productId === kit.id && e.kind === 'remove')).toMatchObject({ delta: -1, price: 20, cost: 5 });
  });
  it('does not consume any parts when the recipe has a missing component', async () => {
    const { s, a, b, kit } = await kitSetup();
    await s.deleteProduct(a.id);
    await s.adjustStock(kit.id, { delta: -1, reason: 'sold' });
    expect(b.quantity).toBe(10);
    expect(s.activity.filter((e) => e.productId === kit.id && e.kind === 'remove')).toHaveLength(0);
  });
  it('reserves shared stock across ordinary and multiple kit basket lines', async () => {
    const { s, a, b, kit } = await kitSetup();
    await s.adjustStock(a.id, { delta: 3 });
    const second = await s.addProduct({ name: 'Second', kit: 'sell', components: kit.components });
    await s.startTakeout({ reason: 'sold' });
    await s.addToTakeout(second.id, { qty: 3 });
    await s.addToTakeout(kit.id, { qty: 2 });
    await s.addToTakeout(a.id, { qty: 1 });
    await s.applyTakeout();
    expect(a.quantity).toBe(0); expect(b.quantity).toBe(7);
    expect(s.activity.find((e) => e.productId === second.id && e.kind === 'remove').delta).toBe(-1);
  });
});

describe('#38 required safety snapshots', () => {
  it.each(['payload', 'manifest', 'archive', 'missing archive', 'offline'])('preserves inventory when the %s cannot be saved/read', async (failure) => {
    const s = await fresh();
    await s.addProduct({ name: 'Only inventory', quantity: 100 });
    if (failure === 'archive' || failure === 'missing archive') {
      s.archives = [{ month: '2020-01', count: 1 }];
      rejectRead = (k) => failure === 'archive' && k === 'inv:activity:v1:2020-01';
    }
    if (failure === 'offline') navigator.onLine = false;
    rejectWrite = (k) => failure === 'payload' ? k.startsWith('inv:backup:') : failure === 'manifest' && k === 'inv:backups:v1';
    writes.length = 0;
    await expect(s.wipeAll()).rejects.toThrow(/safety snapshot/);
    expect(s.products[0].quantity).toBe(100);
    expect(db.get('inv:products:v2')[0].quantity).toBe(100);
    expect(s.latestSnapshot()).toBeNull();
    expect(writes.filter((k) => k.startsWith(OP_PREFIX) || k === 'inv:products:v2')).toEqual([]);
  });
  it.each(['import', 'restore'])('stops %s before mutation if the snapshot fails', async (action) => {
    const s = await fresh();
    await s.addProduct({ name: 'Only inventory', quantity: 100 });
    rejectWrite = (key) => key.startsWith('inv:backup:');
    writes.length = 0;
    await expect(action === 'import' ? s.applyImport([{ name: 'Replacement', quantity: 1 }])
      : s.restoreBackup({ settings: {}, products: [], locations: [], suppliers: [], activity: [] })).rejects.toThrow(/safety snapshot/);
    expect(s.products[0].quantity).toBe(100);
    expect(writes.some((key) => key.startsWith(OP_PREFIX))).toBe(false);
  });
  it('still allows deliberately disposable sample cleanup without a snapshot', async () => {
    const s = await fresh(); await s.addProduct({ name: 'Sample' });
    rejectWrite = (k) => k.startsWith('inv:backup:');
    await s.wipeAll({ snapshot: false });
    expect((await fresh()).products).toEqual([]);
  });
});


describe('stocktake commit recovery', () => {
  it('does not complete a count whose stock commit was rejected', async () => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Counted', quantity: 10 });
    await s.startStocktake();
    await s.setStocktakeCount(p.id, 7);
    onSet = async (key, value) => {
      if (key.startsWith(OP_PREFIX) && value.changes.some((c) => c.key === 'inv:products:v2')) {
        throw new Error('Stock commit rejected');
      }
    };
    await expect(s.applyStocktake()).rejects.toThrow();
    rejectWrite = () => false;
    // Let any sibling writes finish before simulating a reload.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(10);
    expect(loaded.stocktake?.rows[0].counted).toBe(7);
    expect(loaded.stocktakes).toHaveLength(0);
    expect(loaded.activity[0].kind).toBe('create');
  });
});

describe('rejected stock adjustments', () => {
  it('restores stock, lots, valuation and history so a retry applies only once', async () => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Milk', quantity: 10, cost: 2, trackExpiry: true });
    const before = copy(p);
    const activity = copy(s.activity);
    rejectWrite = (key) => key.startsWith(OP_PREFIX);
    await expect(s.adjustStock(p.id, { delta: 5, cost: 8, expiryDate: '2026-09-20' })).rejects.toThrow();
    expect(p).toEqual(before);
    expect(s.activity).toEqual(activity);
    rejectWrite = () => false;
    await s.adjustStock(p.id, { delta: 5, cost: 8, expiryDate: '2026-09-20' });
    const loaded = await fresh();
    expect(loaded.productById(p.id)).toMatchObject({ quantity: 15, cost: 4 });
    expect(loaded.activity.filter((e) => e.kind === 'add')).toHaveLength(1);
  });
});

describe('queued receive-all', () => {
  it('calculates the remainder after an earlier partial receipt finishes', async () => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Delivery', quantity: 0 });
    const order = await s.placeOrder({ lines: [{ productId: p.id, qty: 10 }] });
    await Promise.all([
      s.receiveOrderLines(order.id, [{ productId: p.id, qty: 4 }]),
      s.receiveOrder(order.id),
    ]);
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(10);
    expect(loaded.orderById(order.id)).toMatchObject({ status: 'received', lines: [{ received: 10 }] });
  });
});

describe('rejected batch stock changes', () => {
  it.each(['stocktake', 'takeout'])('keeps a rejected %s available for retry', async (kind) => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Counted', quantity: 10 });
    if (kind === 'stocktake') {
      await s.startStocktake();
      await s.setStocktakeCount(p.id, 7);
    } else {
      await s.startTakeout();
      await s.addToTakeout(p.id, { qty: 3 });
    }
    const session = copy(s[kind]);
    const apply = () => kind === 'stocktake' ? s.applyStocktake() : s.applyTakeout();
    rejectWrite = (key) => key.startsWith(OP_PREFIX);
    await expect(apply()).rejects.toThrow();
    expect(s[kind]).toEqual(session);
    expect(p.quantity).toBe(10);
    expect(s.activity.map((row) => row.kind)).toEqual(['create']);
    expect(s.stocktakes).toEqual([]);
    rejectWrite = () => false;
    await apply();
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(7);
    expect(loaded[kind]).toBeNull();
    expect(loaded.activity).toHaveLength(2);
  });
});

describe('product relocation audit', () => {
  it('does not save a movement whose product edit was rejected', async () => {
    const s = await fresh();
    const location = await s.addLocation({ name: 'Shop' });
    const p = await s.addProduct({ name: 'Moved', quantity: 10 });
    onSet = async (key, value) => {
      if (key.startsWith(OP_PREFIX) && value.changes.some((c) => c.key === 'inv:products:v2')) {
        throw new Error('Product commit rejected');
      }
    };
    await expect(s.updateProduct(p.id, { locationId: location.id })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loaded = await fresh();
    expect(loaded.productById(p.id).stock).toEqual({ '': 10 });
    expect(loaded.activity.filter((row) => row.kind === 'move')).toEqual([]);
  });
});

describe('undo dated replenishment', () => {
  it('returns the dates that moved instead of the destination’s older stock', async () => {
    const s = await fresh();
    const source = await s.addLocation({ name: 'Warehouse' });
    const target = await s.addLocation({ name: 'Shop' });
    const p = await s.addProduct({ name: 'Milk', trackExpiry: true });
    await s.adjustStock(p.id, { delta: 5, locationId: source.id, expiryDate: '2026-10-10' });
    await s.adjustStock(p.id, { delta: 5, locationId: target.id, expiryDate: '2026-09-20' });
    const lots = copy(p.lots);
    const token = await s.transferMany([{ productId: p.id, from: source.id, to: target.id, qty: 3 }]);
    await s.undoTransfers(token);
    expect(p.lots).toEqual(lots);
    expect((await fresh()).productById(p.id).lots).toEqual(lots);
  });
});

describe('receipts from stale sessions', () => {
  it('rejects a stale receipt instead of increasing stock while overwriting received totals', async () => {
    const a = await fresh();
    const p = await a.addProduct({ name: 'Delivery' });
    const order = await a.placeOrder({ lines: [{ productId: p.id, qty: 10 }] });
    const b = await fresh();
    await a.receiveOrderLines(order.id, [{ productId: p.id, qty: 4 }]);
    await expect(b.receiveOrderLines(order.id, [{ productId: p.id, qty: 4 }])).rejects.toThrow(/Order changed/);
    expect(b.productById(p.id).quantity).toBe(0);
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(4);
    expect(loaded.orderById(order.id).lines[0].received).toBe(4);
    await loaded.receiveOrder(order.id);
    expect((await fresh()).productById(p.id).quantity).toBe(10);
  });
});

it('preserves simultaneous receipts for review instead of silently losing a received total', async () => {
  const a = await fresh();
  const p = await a.addProduct({ name: 'Delivery' });
  const order = await a.placeOrder({ lines: [{ productId: p.id, qty: 10 }] });
  const b = await fresh();
  let release, entered = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  onSet = async (key) => {
    if (!key.startsWith(OP_PREFIX)) return;
    if (++entered === 2) release();
    await gate;
  };
  await Promise.all([
    a.receiveOrderLines(order.id, [{ productId: p.id, qty: 4 }]),
    b.receiveOrderLines(order.id, [{ productId: p.id, qty: 4 }]),
  ]);
  const error = await fresh().catch((err) => err);
  expect(error.code).toBe('INVENTORY_CONFLICT');
  expect(error.recovery.operations.filter((op) => op.changes.some((c) => c.key === 'inv:products:v2'))).toHaveLength(3);
});

describe('variant family commit recovery', () => {
  it.each(['create', 'edit', 'dissolve'])('keeps families and products consistent after a rejected %s', async (action) => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Shirt', quantity: 3 });
    const family = action === 'create' ? null : await s.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } });
    const before = copy({ products: s.products, families: s.families, activity: s.activity });
    onSet = async (key, value) => {
      if (key.startsWith(OP_PREFIX) && value.changes.some((c) => c.key === 'inv:products:v2')) {
        throw new Error('Product commit rejected');
      }
    };
    const change = action === 'create'
      ? s.createFamily(p.id, { axes: ['Size'], values: { Size: 'M' } })
      : action === 'edit' ? s.updateFamily(family.id, { name: 'Cotton shirt' }) : s.dissolveFamily(family.id);
    await expect(change).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loaded = await fresh();
    expect(loaded.families).toEqual(before.families);
    expect(loaded.products).toEqual(before.products);
    expect(loaded.activity).toEqual(before.activity);
  });
});

describe('stock edits during a pending receipt', () => {
  it.each(['add', 'move', 'build', 'bulk'])('does not let a %s save include stock from a rejected receipt', async (action) => {
    const s = await fresh();
    const location = await s.addLocation({ name: 'Shop' });
    const p = await s.addProduct({ name: 'Parts', quantity: 10 });
    const kit = await s.addProduct({ name: 'Kit', kit: 'build', components: [{ productId: p.id, qty: 2 }] });
    const order = await s.placeOrder({ lines: [{ productId: p.id, qty: 5 }] });
    let entered, release;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    onSet = async (key) => {
      if (!key.startsWith(OP_PREFIX)) return;
      onSet = null;
      entered();
      await gate;
      throw new Error('Receipt rejected');
    };
    const receipt = expect(s.receiveOrder(order.id)).rejects.toThrow('Receipt rejected');
    await started;
    const pending = action === 'add' ? s.addProduct({ name: 'New product', quantity: 1 })
      : action === 'move' ? s.transferStock(p.id, { from: '', to: location.id, qty: 3 })
      : action === 'build' ? s.buildKit(kit.id, { qty: 1 })
      : s.bulkUpdateProducts([p.id], { category: 'Changed' });
    release();
    await receipt;
    await pending;
    const loaded = await fresh();
    expect(loaded.productById(p.id).quantity).toBe(action === 'build' ? 8 : 10);
    expect(loaded.orderById(order.id).lines[0].received).toBe(0);
    expect(loaded.activity.some((row) => row.kind === 'add' && row.productId === p.id)).toBe(false);
    if (action === 'add') expect(loaded.products.some((row) => row.name === 'New product')).toBe(true);
  });
});

describe('purchase order audit atomicity', () => {
  it.each(['place', 'close', 'cancel'])('does not record a rejected %s operation in history', async (action) => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Delivery' });
    const order = action === 'place' ? null : await s.placeOrder({ lines: [{ productId: p.id, qty: 10 }] });
    const before = copy({ orders: s.orders, activity: s.activity });
    onSet = async (key, value) => {
      if (key.startsWith(OP_PREFIX) && value.changes.some((c) => c.key === 'inv:orders:v1')) {
        throw new Error('Order commit rejected');
      }
    };
    await expect(action === 'place' ? s.placeOrder({ lines: [{ productId: p.id, qty: 10 }] })
      : action === 'close' ? s.closeOrderShort(order.id) : s.cancelOrder(order.id)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loaded = await fresh();
    expect(loaded.orders).toEqual(before.orders);
    expect(loaded.activity).toEqual(before.activity);
  });
});

describe('CSV import commit recovery', () => {
  it('does not save suppliers, locations or history for an import whose products were rejected', async () => {
    const s = await fresh();
    onSet = async (key, value) => {
      if (key.startsWith(OP_PREFIX) && value.changes.some((c) => c.key === 'inv:products:v2')) {
        throw new Error('Import rejected');
      }
    };
    await expect(s.applyImport([{ name: 'Imported', sku: 'IMP', quantity: 3,
      locationName: 'Warehouse', supplierName: 'Supplier' }])).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loaded = await fresh();
    expect(loaded.products).toEqual([]);
    expect(loaded.locations).toEqual([]);
    expect(loaded.suppliers).toEqual([]);
    expect(loaded.activity).toEqual([]);
  });
});

describe('location and supplier deletion recovery', () => {
  it.each(['location', 'supplier'])('keeps a %s when its product reassignment cannot commit', async (kind) => {
    const s = await fresh();
    const location = await s.addLocation({ name: 'Warehouse' });
    const supplier = await s.addSupplier({ name: 'Supplier' });
    const p = await s.addProduct({ name: 'Stock', quantity: 10, locationId: location.id, supplierId: supplier.id });
    const before = copy({ locations: s.locations, suppliers: s.suppliers, product: p, activity: s.activity });
    onSet = async (key, value) => {
      if (key.startsWith(OP_PREFIX) && value.changes.some((c) => c.key === 'inv:products:v2')) {
        throw new Error('Reassignment rejected');
      }
    };
    await expect(kind === 'location' ? s.deleteLocation(location.id) : s.deleteSupplier(supplier.id)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loaded = await fresh();
    expect(loaded.locations).toEqual(before.locations);
    expect(loaded.suppliers).toEqual(before.suppliers);
    expect(loaded.productById(p.id)).toEqual(before.product);
    expect(loaded.activity).toEqual(before.activity);
  });
});

describe('whole inventory replacement recovery', () => {
  it.each(['restore', 'erase'])('keeps the original dataset if a %s commit is rejected', async (action) => {
    const archive = [{ id: 'old-entry', at: 1, kind: 'create', name: 'Old history' }];
    db.set('inv:archives:v1', [{ month: '2026-01', count: 1 }]);
    db.set('inv:activity:v1:2026-01', archive);
    const s = await fresh();
    const loc = await s.addLocation({ name: 'Warehouse' });
    const supplier = await s.addSupplier({ name: 'Supplier' });
    await s.addProduct({ name: 'Original', quantity: 10, locationId: loc.id, supplierId: supplier.id });
    const before = copy({ products: s.products, locations: s.locations, suppliers: s.suppliers, activity: s.activity });
    onSet = async (key, value) => {
      if (key.startsWith(OP_PREFIX) && value.changes.some((c) => c.key === 'inv:products:v2')) {
        throw new Error('Replacement rejected');
      }
    };
    await expect(action === 'erase' ? s.wipeAll() : s.restoreBackup({ products: [{ id: 'new', name: 'Replacement', quantity: 1 }] })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loaded = await fresh();
    for (const key of Object.keys(before)) expect(loaded[key]).toEqual(before[key]);
    expect(await loaded.loadAllArchives()).toEqual({ '2026-01': archive });
  });
});

it('recovers a complete restore, including archived history, after a projection fails', async () => {
  db.set('inv:archives:v1', [{ month: '2026-01', count: 1 }]);
  db.set('inv:activity:v1:2026-01', [{ id: 'old', name: 'Old history', at: 1 }]);
  const s = await fresh();
  await s.addProduct({ name: 'Original', quantity: 10 });
  const archive = [{ id: 'restored-history', at: 2, kind: 'create', name: 'Replacement' }];
  rejectWrite = (key) => key === 'inv:products:v2';
  await expect(s.restoreBackup({
    products: [{ id: 'new', name: 'Replacement', quantity: 1, locationId: 'new-location' }],
    locations: [{ id: 'new-location', name: 'New location' }],
    archives: { '2026-02': archive },
  })).rejects.toMatchObject({ committed: true });
  rejectWrite = () => false;
  const loaded = await fresh();
  expect(loaded.products).toHaveLength(1);
  expect(loaded.products[0]).toMatchObject({ id: 'new', quantity: 1, locationId: 'new-location' });
  expect(loaded.locations.map((row) => row.id)).toEqual(['new-location']);
  expect(await loaded.loadAllArchives()).toEqual({ '2026-02': archive });
  expect(await loaded.loadArchive('2026-01')).toEqual([]);
});

describe('rejected draft session edits', () => {
  it.each(['stocktake', 'takeout'])('rolls back a rejected %s draft edit so repeating it really saves', async (kind) => {
    const s = await fresh();
    const p = await s.addProduct({ name: 'Stock', quantity: 10 });
    let line;
    if (kind === 'stocktake') await s.startStocktake();
    else line = await s.addToTakeout(p.id);
    const before = copy(s[kind]);
    const edit = () => kind === 'stocktake' ? s.setStocktakeCount(p.id, 7) : s.removeTakeoutLine(line.id);
    rejectWrite = (key) => key.startsWith(OP_PREFIX);
    await expect(edit()).rejects.toThrow();
    expect(s[kind]).toEqual(before);
    rejectWrite = () => false;
    await edit();
    const loaded = await fresh();
    if (kind === 'stocktake') expect(loaded.stocktake.rows[0].counted).toBe(7);
    else expect(loaded.takeout.lines).toEqual([]);
  });
});

describe('stock held by sell-as kits', () => {
  it.each(['receipt', 'adjustment', 'stocktake'])('rejects a stale %s after a product becomes a sell-as kit', async (action) => {
    const s = await fresh();
    const part = await s.addProduct({ name: 'Part', quantity: 10 });
    const kit = await s.addProduct({ name: 'Kit' });
    const order = await s.placeOrder({ lines: [{ productId: kit.id, qty: 3 }] });
    if (action === 'stocktake') {
      await s.startStocktake();
      await s.setStocktakeCount(kit.id, 3);
    }
    await s.updateProduct(kit.id, { kit: 'sell', components: [{ productId: part.id, qty: 2 }] });
    const apply = action === 'receipt' ? s.receiveOrder(order.id)
      : action === 'adjustment' ? s.adjustStock(kit.id, { delta: 3 }) : s.applyStocktake();
    await expect(apply).rejects.toThrow(/kit/i);
    const loaded = await fresh();
    expect(loaded.productById(kit.id).quantity).toBe(0);
    expect(loaded.productById(part.id).quantity).toBe(10);
    expect(loaded.orderById(order.id).lines[0].received).toBe(0);
  });
});

it('receives a restored order regardless of JSON property order', async () => {
  const s = await fresh();
  await s.importAll({
    products: [{ name: 'Stock', id: 'restored-product', quantity: 0 }],
    orders: [{ reference: 'Restored order', lines: [{ name: 'Stock', qty: 3, productId: 'restored-product' }], id: 'restored-order', status: 'ordered' }],
  });
  await s.receiveOrder('restored-order');
  const loaded = await fresh();
  expect(loaded.productById('restored-product').quantity).toBe(3);
  expect(loaded.orderById('restored-order').status).toBe('received');
});
