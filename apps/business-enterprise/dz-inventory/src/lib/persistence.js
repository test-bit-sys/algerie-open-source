/**
 * Immutable, uniquely keyed commits are the source of truth. The old KV
 * collections are projections for compatibility, never a basis for replacing
 * a commit already made by another session. A receipt uses one commit for all
 * its collections, so interrupted projection writes are harmless on reload.
 *
 * Each change describes only what this session changed from what it read.
 * Independent records/fields merge; stock movements accumulate. Logical clocks
 * order causally later edits ahead of earlier ones without relying on wall time.
 * Do not compact/delete this journal without a coordinated checkpoint protocol.
 */
import { kvGet, kvSet, kvDel, kvList } from './cloud.js';

export const OP_PREFIX = 'inv:op:v1:';
const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round = (n) => Math.round(n * 1000) / 1000;
const conflict = (message) => Object.assign(new Error(message), { code: 'INVENTORY_CONFLICT' });

/** JSON object property order is not an order-state change. */
function sameState(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => sameState(value, b[i]));
  }
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Object.hasOwn(b, key) && sameState(a[key], b[key]));
}

function identity(rows) {
  for (const key of ['id', 'productId', 'month', 'date']) {
    if (rows.length && rows.every((v) => object(v) && typeof v[key] === 'string')
      && new Set(rows.map((v) => v[key])).size === rows.length) return key;
  }
  return null;
}

/** A compact patch; stock buckets use deltas even when zero removes a key. */
function diff(before, after, path = []) {
  if (equal(before, after)) return null;
  const absent = after === undefined;
  const lotPath = path.includes('lots');
  if (lotPath && after === undefined && Array.isArray(before)) after = [];
  if (lotPath && after === undefined && object(before)) after = {};
  if (before == null && Array.isArray(after)) before = [];
  if (before == null && object(after)) before = {};
  if (path.at(-1) === 'quantity' || path.at(-2) === 'stock'
    || (path.includes('lots') && path.at(-1) === 'qty')) {
    return { add: round((Number(after) || 0) - (Number(before) || 0)), absent: after === undefined };
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const by = identity(before) || identity(after);
    if (by && (!before.length || identity(before) === by) && (!after.length || identity(after) === by)) {
      const old = new Map(before.map((v) => [v[by], v]));
      const next = new Map(after.map((v) => [v[by], v]));
      const lotArray = lotPath && by === 'date';
      const changedRows = lotArray
        ? [...after, ...before.filter((v) => !next.has(v[by])).map((v) => ({ ...v, qty: 0 }))]
        : after;
      const keptBefore = [...old.keys()].filter((id) => next.has(id));
      const keptAfter = [...next.keys()].filter((id) => old.has(id));
      return { by, lotArray, absent, remove: lotArray ? [] : [...old.keys()].filter((id) => !next.has(id)),
        rows: changedRows.flatMap((row) => {
          const patch = diff(old.get(row[by]), row, [...path, row[by]]);
          return patch ? [[row[by], patch, old.has(row[by])]] : [];
        }), insert: after.flatMap((row, i) => old.has(row[by]) ? [] : [[row[by], after[i + 1]?.[by] ?? null]]),
        ...(!equal(keptBefore, keptAfter) ? { order: after.map((v) => v[by]) } : {}),
      };
    }
  }
  if (object(before) && object(after)) {
    const fields = Object.create(null);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const patch = diff(before[key], after[key], [...path, key]);
      if (patch) fields[key] = patch;
    }
    // Receiving is based on the order the operator reviewed. Rebasing
    // stock while overwriting a newer receipt total would book units
    // that the order no longer accounts for. Preserve this precondition
    // in the journal so simultaneous receipts also surface a conflict.
    const order = path.length === 2 && path[0] === 'inv:orders:v1' && before.id;
    return { fields, absent, ...(order ? { expected: clone(before) } : {}) };
  }
  return after === undefined ? { remove: true } : { value: clone(after) };
}

function apply(value, patch) {
  if ('expected' in patch && !sameState(value, patch.expected)) {
    throw conflict('Order changed in another session. Reload before retrying.');
  }
  if ('add' in patch) {
    const n = round((Number(value) || 0) + patch.add);
    if (n < 0) throw conflict('Conflicting stock removals exceed available stock. Reload before retrying.');
    return patch.absent && n === 0 ? undefined : n;
  }
  if (patch.by) {
    const rows = new Map((Array.isArray(value) ? value : []).map((v) => [v[patch.by], v]));
    for (const id of patch.remove) rows.delete(id);
    for (const [id, change, existed] of patch.rows) {
      if (existed && !rows.has(id) && !patch.lotArray) throw conflict('A record changed in another session. Reload before retrying.');
      rows.set(id, apply(rows.get(id) ?? { [patch.by]: id }, change));
    }
    const order = patch.order ? [...new Set([...patch.order, ...rows.keys()])]
      : (Array.isArray(value) ? value : []).map((v) => v[patch.by]).filter((id) => rows.has(id));
    for (const [id, anchor] of [...patch.insert].reverse()) {
      const existing = order.indexOf(id);
      if (existing >= 0) order.splice(existing, 1);
      const at = order.indexOf(anchor);
      order.splice(at < 0 ? order.length : at, 0, id);
    }
    let result = order.filter((id) => rows.has(id)).map((id) => rows.get(id));
    if (patch.lotArray) {
      // A concurrent receipt may recreate a lot consumed by this session.
      for (const [id, row] of rows) if (!order.includes(id)) result.push(row);
      result = result.filter((row) => row.qty > 0);
    }
    return patch.absent && !result.length ? undefined : result;
  }
  if (patch.fields) {
    const out = { ...(value || {}) };
    for (const [key, change] of Object.entries(patch.fields)) {
      const next = apply(out[key], change);
      if (next === undefined) delete out[key];
      else Object.defineProperty(out, key, { value: next, enumerable: true, writable: true, configurable: true });
    }
    return patch.absent && !Object.keys(out).length ? undefined : out;
  }
  return patch.remove ? undefined : clone(patch.value);
}

function materialize(ops, key, fallback) {
  let value = clone(fallback);
  let started = false;
  for (const op of ops) for (const change of op.changes) {
    if (change.key !== key) continue;
    if (!started) { value = clone(change.base); started = true; }
    value = apply(value, change.patch);
  }
  return value ?? null;
}

export class Persistence {
  #ops = [];
  #seen = new Map();
  #views = new Map();
  #tail = Promise.resolve();

  async init() {
    await this.#tail;
    this.#ops = await this.#load();
    this.#seen.clear();
    this.#views.clear();
  }

  async #load() {
    const rows = await kvList(OP_PREFIX, this.#ops.map((op) => ({ key: OP_PREFIX + op.id, value: op })));
    return rows.map((row) => row.value).sort((a, b) => a.clock - b.clock || a.id.localeCompare(b.id));
  }

  async read(key) {
    try {
      const value = this.#view(this.#ops, key, await kvGet(key));
      this.#seen.set(key, clone(value));
      return clone(value);
    } catch (err) {
      if (err.code === 'INVENTORY_CONFLICT') {
        err.message = 'Concurrent inventory changes need review. Download the recovery data to preserve every recorded change.';
        err.recovery = { app: 'inventory-operation-recovery', version: 1, operations: this.#ops };
      }
      throw err;
    }
  }

  #view(ops, key, fallback) {
    const cached = this.#views.get(key);
    let value;
    if (cached && cached.ops.every((op, i) => ops[i]?.id === op.id)) {
      value = cached.value;
      let started = cached.ops.some((op) => op.changes.some((change) => change.key === key));
      for (const op of ops.slice(cached.ops.length)) for (const change of op.changes) {
        if (change.key !== key) continue;
        if (!started) { value = clone(change.base); started = true; }
        value = apply(value, change.patch);
      }
    } else value = materialize(ops, key, fallback);
    this.#views.set(key, { ops, value });
    return value;
  }

  write(key, value) { return this.writeMany([[key, value]]); }
  delete(key) { return this.writeMany([[key, null]], { deletes: [key] }); }

  writeMany(entries, { deletes = [] } = {}) {
    const values = entries.map(([key, value]) => [key, clone(value)]);
    const run = this.#tail.then(async () => {
      const changes = [];
      for (const [key, value] of values) {
        if (!this.#seen.has(key)) await this.read(key);
        const base = this.#seen.get(key);
        const patch = diff(base, value, [key]);
        if (patch) changes.push({ key, base, patch });
      }
      if (!changes.length) return;
      const ops = await this.#load();
      const id = globalThis.crypto.randomUUID();
      // Only a collection's first commit needs its legacy starting value.
      const committedChanges = changes.map(({ key, base, patch }) => ({ key, patch,
        ...(!ops.some((op) => op.changes.some((c) => c.key === key)) ? { base } : {}),
      }));
      const op = { id, clock: (ops.at(-1)?.clock || 0) + 1, changes: committedChanges };
      const next = [...ops, op].sort((a, b) => a.clock - b.clock || a.id.localeCompare(b.id));
      // Validate before committing; in particular don't silently clamp a
      // rebased stock movement that the other session has made impossible.
      const projections = changes.map(({ key, base }) => [key, this.#view(next, key, base)]);
      await kvSet(OP_PREFIX + id, op);
      this.#ops = next;
      for (const [key, value] of values) this.#seen.set(key, value);
      // Journal persistence is the commit point. If any projection fails,
      // reads recover all collections from the same immutable operation.
      const results = await Promise.allSettled(projections.map(([key, value]) =>
        deletes.includes(key) ? kvDel(key) : kvSet(key, value ?? null)));
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        const error = new Error('Change recorded; reload to recover the saved operation.', { cause: failed.reason });
        error.committed = true;
        throw error;
      }
    });
    this.#tail = run.catch(() => {});
    return run;
  }
}
