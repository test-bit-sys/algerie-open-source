/**
 * Sharing collections between Puter users with Puter's file sharing.
 *
 * Owners share the collection's own cloud file (workspace/collections/<id>.json)
 * with people by username or email, as view or edit. People it was shared with
 * see it under "Shared with you": the app reads the file at the path Puter
 * gives it, keeps a local copy marked with `shared: { path, owner, mode }`, and,
 * for edit access, writes changes back to the same file. Changes from others
 * are picked up when the app starts or regains focus, newest edit winning.
 */
import { Emitter } from '../lib/emitter.js';
import { walk } from '../core/model.js';

const ID_FILE = /^[a-z0-9]{6,40}\.json$/;
const WRITE_DELAY = 1200;
const REFRESH_INTERVAL = 30000;

export const canEdit = (mode) => mode === 'write' || mode === 'manage';

export class ReadOnlyError extends Error {
  constructor(name) {
    super(`"${name}" is shared with you as view only.`);
    this.name = 'ReadOnlyError';
  }
}

export class SharedCollections extends Emitter {
  constructor({ ws, fs, sync = null, self = null }) {
    super();
    this.ws = ws;
    this.fs = fs;
    this.sync = sync;
    this.self = self;
    this.timers = new Map();
    this.retrying = new Set(); // waiting after a failed write (offline), not on a fresh edit
    this.writing = 0;
    this.lastRefresh = 0;
    this.status = 'idle';
    this.onChange = (e) => this.#localChange(e);
    ws.on('change', this.onChange);
  }

  /** True while an edit is waiting to upload or uploading. A write that failed and waits to retry does not count. */
  get pending() {
    return this.writing > 0 || [...this.timers.keys()].some((id) => !this.retrying.has(id));
  }

  stop() {
    this.ws.off('change', this.onChange);
    for (const t of this.timers.values()) clearTimeout(t);
  }

  /** Cloud path of one of the user's own collections. */
  ownPath(collectionId) {
    return `workspace/collections/${collectionId}.json`;
  }

  // Owner ---------------------------------------------------------------------

  async share(collectionId, recipient, mode = 'read') {
    const c = this.ws.getCollection(collectionId);
    if (!c) throw new Error('Collection not found');
    if (c.shared) throw new Error('Only the owner can share this collection.');
    // The file must exist before it can be shared.
    if (this.sync) await this.sync.flush();
    await this.fs.write(this.ownPath(collectionId), JSON.stringify(c), { overwrite: true, createMissingParents: true });
    const result = await this.fs.share(this.ownPath(collectionId), recipient, mode);
    this.emit('shares', collectionId);
    return Array.isArray(result) ? result : [result];
  }

  async shares(collectionId) {
    try {
      const list = await this.fs.getShares(this.ownPath(collectionId));
      return Array.isArray(list) ? list : list?.items || [];
    } catch (err) {
      if (/not.?found|does not exist|subject_does_not_exist/i.test(`${err?.code} ${err?.message}`)) return [];
      throw err;
    }
  }

  async unshare(collectionId, recipient) {
    await this.fs.unshare(this.ownPath(collectionId), recipient);
    this.emit('shares', collectionId);
  }

  // People it was shared with --------------------------------------------------

  /** Leaves a collection someone shared, removing the local copy. */
  async leave(collectionId) {
    const c = this.ws.getCollection(collectionId);
    if (!c?.shared) return;
    if (this.self) await this.fs.unshare(c.shared.path, this.self).catch(() => {});
    await this.ws.deleteCollection(collectionId, { quiet: true });
  }

  refreshIfStale() {
    if (Date.now() - this.lastRefresh < REFRESH_INTERVAL) return Promise.resolve();
    return this.refresh();
  }

  /** Lists what was shared with the user and brings local copies up to date. */
  async refresh() {
    this.lastRefresh = Date.now();
    let items = [];
    try {
      let cursor = null;
      do {
        const page = await this.fs.listShared({ limit: 100, ...(cursor ? { cursor } : {}) });
        items.push(...(page?.items || []));
        cursor = page?.cursor || null;
      } while (cursor && items.length < 1000);
    } catch (err) {
      this.status = 'error';
      this.emit('status', { status: 'error', error: err });
      return;
    }
    items = items.filter((i) => !i.isDir && ID_FILE.test(i.name || ''));
    const byId = new Map();
    for (const i of items) {
      const id = i.name.slice(0, -5);
      byId.set(id, [...(byId.get(id) || []), i]);
    }
    const seen = new Set();
    for (const [id, found] of byId) {
      seen.add(id);
      const local = this.ws.getCollection(id);
      if (local && !local.shared) continue; // One of the user's own collections has this id; keep it.
      // Two people shared files with the same name: only the one already here is trusted, if any.
      const item = found.length === 1 ? found[0] : found.find((i) => i.path === local?.shared?.path);
      if (!item) continue;
      if (local?.shared && local.shared.modified === item.modified && local.shared.mode === item.mode) {
        if (local.shared.dirty && canEdit(item.mode)) this.#scheduleWrite(id, 0);
        continue;
      }
      try {
        const data = JSON.parse(await (await this.fs.read(item.path)).text());
        if (data?.type !== 'collection') continue;
        // Never let it take over the ids of requests and folders in another collection: opening or saving those would act on this one.
        if (this.#takesIds(id, data)) continue;
        // Newer local edits win while they can still be written; after losing edit access, the owner's copy does.
        if (local?.shared?.dirty && canEdit(item.mode) && (local.updatedAt || 0) > (data.updatedAt || 0)) {
          this.#scheduleWrite(id, 0);
          continue;
        }
        await this.ws.putCollection(
          { ...data, id, shared: { path: item.path, owner: item.owner?.username || item.owner || ownerFromPath(item.path), mode: item.mode || 'read', modified: item.modified } },
          { quiet: true },
        );
      } catch {
        // Unreadable or not one of ours: skip it.
      }
    }
    for (const c of this.ws.collections) if (c.shared && !seen.has(c.id)) await this.ws.deleteCollection(c.id, { quiet: true });
    this.status = 'synced';
    this.emit('status', { status: 'synced' });
  }

  #localChange({ kind, id, remote, deleted }) {
    if (kind !== 'collection' || remote || deleted) return;
    const c = this.ws.getCollection(id);
    if (!c?.shared || !canEdit(c.shared.mode)) return;
    // ver counts local edits so a write only clears dirty when nothing changed while it uploaded.
    c.shared = { ...c.shared, dirty: true, ver: (c.shared.ver || 0) + 1 };
    this.ws.db.put('collections', id, c).catch(() => {});
    this.retrying.delete(id);
    this.#scheduleWrite(id, WRITE_DELAY);
  }

  #scheduleWrite(id, delay) {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => this.#writeBack(id), delay),
    );
  }

  async #writeBack(id) {
    this.timers.delete(id);
    const c = this.ws.getCollection(id);
    if (!c?.shared || !canEdit(c.shared.mode)) return;
    const { shared, ...data } = c;
    this.writing++;
    try {
      const item = await this.fs.write(shared.path, JSON.stringify(data), { overwrite: true });
      this.retrying.delete(id);
      const now = this.ws.getCollection(id);
      if (!now?.shared) return;
      now.shared = { ...now.shared, dirty: (now.shared.ver || 0) !== (shared.ver || 0), modified: item?.modified ?? shared.modified };
      await this.ws.db.put('collections', id, now);
      this.emit('status', { status: 'synced' });
    } catch (err) {
      this.emit('status', { status: 'error', error: err });
      this.retrying.add(id);
      this.#scheduleWrite(id, 15000);
    } finally {
      this.writing--;
    }
  }

  #takesIds(id, data) {
    let taken = false;
    walk(data, (item) => {
      const owner = this.ws.index.get(item.id);
      if (owner && owner !== id) taken = true;
    });
    return taken;
  }

  flush() {
    const ids = [...this.timers.keys()];
    return Promise.all(ids.map((id) => {
      clearTimeout(this.timers.get(id));
      return this.#writeBack(id);
    }));
  }
}

function ownerFromPath(path) {
  return String(path || '').split('/').filter(Boolean)[0] || '';
}
