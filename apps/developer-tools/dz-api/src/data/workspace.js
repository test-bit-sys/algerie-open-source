/**
 * The workspace: collections, environments, globals and history, kept in
 * memory and written through to IndexedDB. Every change emits 'change' with
 * { kind, id } so the UI can refresh and the cloud sync can upload.
 *
 * kinds: 'collection' | 'environment' | 'globals' | 'history'
 */
import { Emitter } from '../lib/emitter.js';
import { ReadOnlyError, canEdit } from './shared.js';
import { uid } from '../lib/ids.js';
import {
  cloneWithNewIds, collection as newCollection, environment as newEnvironment, findItem, normalizeCollection,
  normalizeEnvironment, normalizeRequest, normalizeDraft, walk,
} from '../core/model.js';

export const HISTORY_LIMIT = 1000;
const REMOVED_LIMIT = 2000;
const MAX_SNAPSHOT_BODY = 64 * 1024;
const MAX_SAVED_RESPONSE = 2 * 1048576;
// Scripts can set collection variables on every request of a run: the collection is stored once they pause.
export const VARIABLES_WRITE_DELAY = 250;

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

export class Workspace extends Emitter {
  #deferredWrites = new Map(); // collection id -> timer, see #writeSoon

  constructor(db) {
    super();
    this.db = db;
    this.collectionsById = new Map();
    this.environmentsById = new Map();
    this.globals = normalizeEnvironment({ id: 'globals', name: 'Globals' });
    this.history = [];
    // What was deleted from history, so other devices' copies do not bring it back.
    this.historyRemoved = { clearedAt: 0, ids: [] };
    this.index = new Map(); // item id -> collection id
  }

  async load() {
    const [cols, envs, hist, globals, removed] = await Promise.all([
      this.db.all('collections'),
      this.db.all('environments'),
      this.db.all('history'),
      this.db.get('meta', 'globals'),
      this.db.get('meta', 'historyRemoved'),
    ]);
    if (removed) this.historyRemoved = { clearedAt: removed.clearedAt || 0, ids: removed.ids || [] };
    for (const [, c] of cols) this.collectionsById.set(c.id, normalizeCollection(c));
    for (const [, e] of envs) this.environmentsById.set(e.id, normalizeEnvironment(e));
    if (globals) this.globals = normalizeEnvironment({ ...globals, id: 'globals', name: 'Globals' });
    this.history = hist.map(([, h]) => h).sort((a, b) => b.at - a.at);
    this.#reindex();
  }

  #reindex() {
    this.index.clear();
    // Should two collections share an id, it stays with the first: the user's own before shared ones.
    const all = [...this.collectionsById.values()];
    for (const c of [...all.filter((x) => !x.shared), ...all.filter((x) => x.shared)]) {
      if (!this.index.has(c.id)) this.index.set(c.id, c.id);
      walk(c, (item) => {
        if (!this.index.has(item.id)) this.index.set(item.id, c.id);
      });
    }
  }

  #changed(kind, id, extra = {}) {
    this.emit('change', { kind, id, ...extra });
  }

  /**
   * Waits for a write to this device's storage. The edit is already in memory and still syncs
   * to the cloud, so a failed write (a full disk) is reported instead of dropping the edit.
   */
  async #persist(write) {
    try {
      await write;
    } catch (error) {
      this.emit('storage-error', error);
    }
  }

  // Collections ------------------------------------------------------------

  get collections() {
    return [...this.collectionsById.values()].sort(byName);
  }

  getCollection(id) {
    return this.collectionsById.get(id) || null;
  }

  async addCollection(fields = {}) {
    const c = fields.type === 'collection' ? normalizeCollection(fields) : newCollection(fields);
    this.collectionsById.set(c.id, c);
    this.#reindex();
    await this.#persist(this.db.put('collections', c.id, c));
    this.#changed('collection', c.id, { created: true });
    return c;
  }

  /** Replaces a collection wholesale (cloud sync, import). Does not re-emit to the sync engine when quiet. */
  async putCollection(c, { quiet = false } = {}) {
    const norm = normalizeCollection(c);
    this.collectionsById.set(norm.id, norm);
    this.#reindex();
    await this.#persist(this.db.put('collections', norm.id, norm));
    this.#changed('collection', norm.id, { remote: quiet });
    return norm;
  }

  /** mutate(collection) edits in place; the result is saved. */
  updateCollection(id, mutate) {
    return this.#updateCollection(id, mutate);
  }

  /** variablesOnly: mutate changes nothing but the collection's variables, so no item id moves. */
  async #updateCollection(id, mutate, { variablesOnly = false } = {}) {
    const c = this.collectionsById.get(id);
    if (!c) throw new Error('Collection not found');
    if (c.shared && !canEdit(c.shared.mode)) throw new ReadOnlyError(c.name);
    mutate(c);
    c.updatedAt = Date.now();
    if (variablesOnly) this.#writeSoon(id);
    else {
      this.#reindex();
      await this.#persist(this.db.put('collections', id, c));
    }
    this.#changed('collection', id, variablesOnly ? { variablesOnly } : {});
    return c;
  }

  /**
   * Stores a collection after a short pause instead of now: writing a large collection takes a
   * while, and a run whose scripts set collection variables would wait for it after every
   * request. The change is already in memory (and syncs from there). flushWrites() stores it at once.
   */
  #writeSoon(id) {
    if (!this.#deferredWrites.has(id)) this.#deferredWrites.set(id, setTimeout(() => this.#writeNow(id), VARIABLES_WRITE_DELAY));
  }

  #writeNow(id) {
    clearTimeout(this.#deferredWrites.get(id));
    this.#deferredWrites.delete(id);
    // The collection as it is now, with any edits since; one deleted meanwhile is not brought back.
    const c = this.collectionsById.get(id);
    if (!c) return Promise.resolve();
    let write;
    try {
      write = this.db.put('collections', id, c);
    } catch (error) {
      write = Promise.reject(error); // The connection closed (the database is being deleted).
    }
    return this.#persist(write);
  }

  /** Stores collections still waiting on a pause, before the page goes away. */
  flushWrites() {
    return Promise.all([...this.#deferredWrites.keys()].map((id) => this.#writeNow(id)));
  }

  async deleteCollection(id, { quiet = false } = {}) {
    if (!this.collectionsById.delete(id)) return;
    this.#reindex();
    await this.#persist(this.db.delete('collections', id));
    this.#changed('collection', id, { deleted: true, remote: quiet });
  }

  async duplicateCollection(id) {
    const c = this.getCollection(id);
    const copy = cloneWithNewIds(c);
    delete copy.shared;
    copy.name = `${c.name} Copy`;
    copy.createdAt = copy.updatedAt = Date.now();
    return this.addCollection(copy);
  }

  /** True when the collection (or anything in it) reuses an id the workspace already has. */
  collides(c) {
    if (this.getCollection(c.id) || this.index.has(c.id)) return true;
    let hit = false;
    walk(c, (item) => {
      if (!hit && this.index.has(item.id)) hit = true;
    });
    return hit;
  }

  /** Locates any item: { collection, item, parent, parents } where parents are [collection, ...folders]. */
  locate(id) {
    const cid = this.index.get(id);
    if (!cid) return null;
    const c = this.collectionsById.get(cid);
    if (!c) return null;
    const found = findItem(c, id);
    if (!found) return null;
    return { collection: c, ...found };
  }

  async addItem(collectionId, parentId, item, index = -1) {
    await this.updateCollection(collectionId, (c) => {
      const parent = parentId && parentId !== collectionId ? findItem(c, parentId)?.item : c;
      if (!parent || !Array.isArray(parent.items)) throw new Error('Folder not found');
      if (index < 0 || index > parent.items.length) parent.items.push(item);
      else parent.items.splice(index, 0, item);
    });
    return item;
  }

  async updateItem(id, mutate) {
    const loc = this.locate(id);
    if (!loc) throw new Error('Item not found');
    if (loc.item.type === 'collection') return this.updateCollection(id, mutate);
    await this.updateCollection(loc.collection.id, (c) => mutate(findItem(c, id).item));
    return this.locate(id)?.item;
  }

  /** Saves a request draft over the stored request with the same id. */
  async saveRequest(draft) {
    const clean = normalizeDraft(draft);
    return this.updateItem(clean.id, (item) => {
      for (const k of Object.keys(item)) delete item[k];
      Object.assign(item, clean);
    });
  }

  async removeItem(id) {
    const loc = this.locate(id);
    if (!loc) return;
    if (loc.item.type === 'collection') return this.deleteCollection(id);
    await this.updateCollection(loc.collection.id, (c) => {
      const f = findItem(c, id);
      f.parent.items.splice(f.index, 1);
    });
  }

  async duplicateItem(id) {
    const loc = this.locate(id);
    if (!loc || loc.item.type === 'collection') return null;
    const copy = cloneWithNewIds(loc.item);
    copy.name = `${loc.item.name} Copy`;
    await this.addItem(loc.collection.id, loc.parent.id, copy, loc.index + 1);
    return copy;
  }

  /**
   * Moves an item into a folder or collection at an index. Refuses to move a
   * folder into itself or its own descendants.
   */
  async moveItem(id, toCollectionId, toParentId, index = -1) {
    const loc = this.locate(id);
    if (!loc || loc.item.type === 'collection') return false;
    const target = this.getCollection(toCollectionId);
    if (!target) return false;
    // Check both ends first so a refused move never removes the item.
    for (const c of [loc.collection, target]) if (c.shared && !canEdit(c.shared.mode)) throw new ReadOnlyError(c.name);
    const parentId = toParentId || toCollectionId;
    if (loc.item.type === 'folder' && (parentId === id || findItem(loc.item, parentId))) return false;
    const item = structuredClone(loc.item);
    const sameParent = loc.collection.id === toCollectionId && loc.parent.id === parentId;
    if (sameParent && index > loc.index) index -= 1;
    if (loc.collection.id === toCollectionId) {
      await this.updateCollection(toCollectionId, (c) => {
        const f = findItem(c, id);
        f.parent.items.splice(f.index, 1);
        const parent = parentId === c.id ? c : findItem(c, parentId).item;
        if (index < 0 || index > parent.items.length) parent.items.push(item);
        else parent.items.splice(index, 0, item);
      });
    } else {
      // Both collections change before either is announced, so listeners (open tabs) never see the item gone.
      const parent = parentId === toCollectionId ? target : findItem(target, parentId)?.item;
      if (!parent || !Array.isArray(parent.items)) throw new Error('Folder not found');
      loc.parent.items.splice(loc.index, 1);
      if (index < 0 || index > parent.items.length) parent.items.push(item);
      else parent.items.splice(index, 0, item);
      loc.collection.updatedAt = target.updatedAt = Date.now();
      this.#reindex();
      await this.#persist(this.db.batch([loc.collection, target].map((c) => ({ store: 'collections', key: c.id, value: c }))));
      this.#changed('collection', loc.collection.id);
      this.#changed('collection', toCollectionId);
    }
    return true;
  }

  // Environments -----------------------------------------------------------

  get environments() {
    return [...this.environmentsById.values()].sort(byName);
  }

  getEnvironment(id) {
    if (id === 'globals') return this.globals;
    return this.environmentsById.get(id) || null;
  }

  async addEnvironment(fields = {}) {
    const e = fields.id ? normalizeEnvironment(fields) : newEnvironment(fields);
    this.environmentsById.set(e.id, e);
    await this.#persist(this.db.put('environments', e.id, e));
    this.#changed('environment', e.id, { created: true });
    return e;
  }

  async putEnvironment(e, { quiet = false } = {}) {
    const norm = normalizeEnvironment(e);
    if (norm.id === 'globals') return this.putGlobals(norm, { quiet });
    this.environmentsById.set(norm.id, norm);
    await this.#persist(this.db.put('environments', norm.id, norm));
    this.#changed('environment', norm.id, { remote: quiet });
    return norm;
  }

  async updateEnvironment(id, mutate) {
    if (id === 'globals') return this.updateGlobals(mutate);
    const e = this.environmentsById.get(id);
    if (!e) throw new Error('Environment not found');
    mutate(e);
    e.updatedAt = Date.now();
    await this.#persist(this.db.put('environments', id, e));
    this.#changed('environment', id);
    return e;
  }

  async deleteEnvironment(id, { quiet = false } = {}) {
    if (!this.environmentsById.delete(id)) return;
    await this.#persist(this.db.delete('environments', id));
    this.#changed('environment', id, { deleted: true, remote: quiet });
  }

  async duplicateEnvironment(id) {
    const e = this.getEnvironment(id);
    const copy = structuredClone(e);
    copy.id = uid();
    copy.name = `${e.name} Copy`;
    for (const v of copy.variables) v.id = uid();
    return this.addEnvironment(copy);
  }

  async updateGlobals(mutate) {
    mutate(this.globals);
    this.globals.updatedAt = Date.now();
    await this.#persist(this.db.put('meta', 'globals', this.globals));
    this.#changed('globals', 'globals');
    return this.globals;
  }

  async putGlobals(g, { quiet = false } = {}) {
    this.globals = normalizeEnvironment({ ...g, id: 'globals', name: 'Globals' });
    await this.#persist(this.db.put('meta', 'globals', this.globals));
    this.#changed('globals', 'globals', { remote: quiet });
    return this.globals;
  }

  /**
   * Writes variable changes made by scripts back to their scopes. changes:
   * { environment: {k: v|null}, collection: {...}, globals: {...} } where null unsets.
   */
  async applyVariableChanges({ environmentId, collectionId, changes }) {
    // Reads use the last enabled entry for a key, so writes target that one too.
    const apply = (list, delta) => {
      for (const [k, v] of Object.entries(delta || {})) {
        if (v === null) {
          for (let j = list.length - 1; j >= 0; j--) if (list[j].key === k && list[j].enabled !== false) list.splice(j, 1);
          continue;
        }
        const i = list.findLastIndex((x) => x.key === k && x.enabled !== false);
        const j = i >= 0 ? i : list.findLastIndex((x) => x.key === k);
        if (j >= 0) Object.assign(list[j], { value: v, enabled: true });
        else list.push({ id: uid(), key: k, value: v, enabled: true, secret: false, description: '' });
      }
    };
    const has = (d) => d && Object.keys(d).length;
    if (has(changes.environment) && environmentId && this.getEnvironment(environmentId)) {
      await this.updateEnvironment(environmentId, (e) => apply(e.variables, changes.environment));
    }
    const col = collectionId && this.getCollection(collectionId);
    if (has(changes.collection) && col) {
      // View-only shared collections keep script changes in memory for this session.
      if (col.shared && !canEdit(col.shared.mode)) apply(col.variables, changes.collection);
      else await this.#updateCollection(collectionId, (c) => apply(c.variables, changes.collection), { variablesOnly: true });
    }
    if (has(changes.globals)) await this.updateGlobals((g) => apply(g.variables, changes.globals));
  }

  // History ----------------------------------------------------------------

  async addHistory({ request, response, collectionId = null, transport = null }) {
    const snapshot = normalizeRequest(structuredClone(request));
    if (snapshot.body.raw.length > MAX_SNAPSHOT_BODY) snapshot.body.raw = snapshot.body.raw.slice(0, MAX_SNAPSHOT_BODY);
    snapshot.examples = [];
    const entry = {
      id: uid(),
      at: Date.now(),
      requestId: request.id,
      collectionId,
      request: snapshot,
      response: response ? { status: response.status, statusText: response.statusText, timeMs: response.timeMs, size: response.size } : null,
      error: response?.error || null,
      transport,
    };
    this.history.unshift(entry);
    const removed = this.history.splice(HISTORY_LIMIT);
    await this.#persist(this.db.batch([
      { store: 'history', key: entry.id, value: entry },
      ...removed.map((h) => ({ store: 'history', key: h.id, delete: true })),
    ]));
    this.#changed('history', entry.id);
    return entry;
  }

  /** Merges entries from another device, applying what was deleted there (removed: { clearedAt, ids }). */
  async mergeHistory(entries, removed = null) {
    const ops = [];
    if (removed) {
      const clearedAt = Math.max(this.historyRemoved.clearedAt, removed.clearedAt || 0);
      const ids = [...new Set([...(removed.ids || []), ...this.historyRemoved.ids])].slice(0, REMOVED_LIMIT);
      if (clearedAt !== this.historyRemoved.clearedAt || ids.length !== this.historyRemoved.ids.length) {
        this.historyRemoved = { clearedAt, ids };
        ops.push({ store: 'meta', key: 'historyRemoved', value: this.historyRemoved });
      }
    }
    const gone = this.#historyGone();
    for (const h of this.history) if (gone(h)) ops.push({ store: 'history', key: h.id, delete: true });
    const known = new Set(this.history.map((h) => h.id));
    this.history = this.history.filter((h) => !gone(h));
    const fresh = entries.filter((e) => e && e.id && !known.has(e.id) && !gone(e));
    if (!fresh.length && !ops.length) return;
    this.history = [...this.history, ...fresh].sort((a, b) => b.at - a.at);
    const dropped = this.history.splice(HISTORY_LIMIT);
    const droppedIds = new Set(dropped.map((r) => r.id));
    await this.#persist(this.db.batch([
      ...ops,
      ...fresh.filter((e) => !droppedIds.has(e.id)).map((e) => ({ store: 'history', key: e.id, value: e })),
      ...dropped.filter((r) => known.has(r.id)).map((h) => ({ store: 'history', key: h.id, delete: true })),
    ]));
    this.#changed('history', null, { remote: true });
  }

  #historyGone() {
    const { clearedAt, ids } = this.historyRemoved;
    const set = new Set(ids);
    return (h) => set.has(h.id) || (h.at || 0) <= clearedAt;
  }

  async deleteHistory(ids) {
    const set = new Set(ids);
    this.history = this.history.filter((h) => !set.has(h.id));
    this.historyRemoved = { ...this.historyRemoved, ids: [...new Set([...ids, ...this.historyRemoved.ids])].slice(0, REMOVED_LIMIT) };
    await this.#persist(this.db.batch([
      ...ids.map((id) => ({ store: 'history', key: id, delete: true })),
      { store: 'meta', key: 'historyRemoved', value: this.historyRemoved },
    ]));
    this.#changed('history', null);
  }

  async clearHistory() {
    this.history = [];
    // Entries made since the last clear are tracked by time, so the id list starts over.
    this.historyRemoved = { clearedAt: Date.now(), ids: [] };
    await this.#persist(this.db.clear('history'));
    await this.#persist(this.db.put('meta', 'historyRemoved', this.historyRemoved));
    this.#changed('history', null, { cleared: true });
  }

  // Files and saved responses (this device only) ---------------------------

  async putFile(blob) {
    const ref = uid();
    await this.db.put('files', ref, blob);
    return ref;
  }

  getFile(ref) {
    return ref ? this.db.get('files', ref) : Promise.resolve(null);
  }

  /** Map of fileRef -> Blob for every file a request body references. */
  async filesFor(request) {
    const refs = [];
    if (request.body.mode === 'binary' && request.body.binary?.ref) refs.push(request.body.binary.ref);
    if (request.body.mode === 'form') for (const f of request.body.form) if (f.kind === 'file' && f.file?.ref) refs.push(f.file.ref);
    const out = new Map();
    for (const ref of refs) {
      const blob = await this.getFile(ref);
      if (blob) out.set(ref, blob);
    }
    return out;
  }

  async saveResponse(requestId, response) {
    if (!response || response.body?.length > MAX_SAVED_RESPONSE) {
      await this.db.delete('responses', requestId);
      return;
    }
    await this.db.put('responses', requestId, { ...response, savedAt: Date.now() });
  }

  getResponse(requestId) {
    return this.db.get('responses', requestId);
  }

  // Small per-owner state ---------------------------------------------------

  getMeta(key) {
    return this.db.get('meta', key);
  }

  setMeta(key, value) {
    return this.db.put('meta', key, value);
  }

  /** Everything, for export or for moving guest data into an account. */
  snapshot() {
    return {
      collections: structuredClone(this.collections),
      environments: structuredClone(this.environments),
      globals: structuredClone(this.globals),
      history: structuredClone(this.history),
    };
  }
}
