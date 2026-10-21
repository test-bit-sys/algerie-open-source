/**
 * In-memory stand-in for src/data/idb.js Db, for tests that need a real
 * Workspace without IndexedDB. Values are structured-cloned on the way in and
 * out, like IndexedDB does, so tests catch accidental shared references.
 *
 *   const ws = new Workspace(new MemoryDb());
 *   await ws.load();
 */
import { STORES } from '../../src/data/idb.js';

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export class MemoryDb {
  constructor(seed = {}) {
    this.stores = new Map(STORES.map((name) => [name, new Map()]));
    for (const [store, entries] of Object.entries(seed)) {
      for (const [key, value] of Object.entries(entries)) this.#store(store).set(key, clone(value));
    }
  }

  #store(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return this.stores.get(name);
  }

  async get(store, key) {
    return clone(this.#store(store).get(key));
  }

  async put(store, key, value) {
    this.#store(store).set(key, clone(value));
    return key;
  }

  async delete(store, key) {
    this.#store(store).delete(key);
  }

  async clear(store) {
    this.#store(store).clear();
  }

  async all(store) {
    return [...this.#store(store)].map(([k, v]) => [k, clone(v)]);
  }

  async keys(store) {
    return [...this.#store(store).keys()];
  }

  async batch(ops) {
    for (const o of ops) {
      if (o.delete) this.#store(o.store).delete(o.key);
      else this.#store(o.store).set(o.key, clone(o.value));
    }
  }

  close() {}
}
