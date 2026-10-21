/**
 * Private pages, saved as files in the user's own Puter cloud:
 *
 *   wiki/tree.ywk            the page tree
 *   wiki/pages/<id>.ywk      one file per page (Yjs state)
 *   wiki/pages/<id>.c.ywk    a page's comments
 *   wiki/assets/<sha256>     images and covers, by content hash
 *   wiki/history/<id>/<t>.ywk earlier versions of a page (page history)
 *
 * Saving never overwrites what another device wrote: if the file changed
 * since this device last read it, the two copies are merged first (Yjs
 * merges are lossless), then the result is written. A local copy in
 * IndexedDB keeps unsaved edits through reloads and offline spells.
 */
import { Y, REMOTE, makeDoc } from './ydoc.js';
import { Space, DOC_ID } from './space.js';
import { memoryCache } from './cache.js';
import { sha256Hex } from '../lib/hash.js';

const SAVE_DELAY = 900;
/** A page version is kept at most this often while someone edits. */
const VERSION_EVERY = 10 * 60_000;
const VERSIONS_KEPT = 30;
const MAX_WAIT = 5000;
const RETRY = [3000, 6000, 15000, 30000, 60000];
const LOAD = 'load';

/**
 * What identifies one saved version of a file. Puter reports modification
 * times in whole seconds, so the size is part of it too.
 */
const versionOf = (info) => (info ? `${info.modified ?? ''}|${info.size ?? ''}` : null);

export function docPath(id) {
  if (!DOC_ID.test(id)) throw new Error(`bad document id ${id}`);
  return id === 'tree' ? 'tree.ywk' : `pages/${id}.ywk`;
}

export class PersonalSpace extends Space {
  constructor({ backend, cache = memoryCache(), user = null }) {
    super({ id: 'personal', kind: 'personal', role: 'owner' });
    this.backend = backend;
    this.cache = cache;
    this.user = user;
    this.entries = new Map();
    this.assetUrls = new Map();
    this.failures = 0;
    this.closed = false;
  }

  /** Loads the tree. Returns true when this is a brand new workspace. */
  async open() {
    const entry = await this.load('tree');
    this.tree = entry.doc;
    this.watching = this.backend.watch?.((event) => this.onRemoteEvent(event));
    return entry.fresh;
  }

  /** The document for a page (loaded once, then kept up to date). */
  async doc(id) {
    const entry = this.entries.get(id) || (await this.load(id));
    return entry.doc;
  }

  hasDoc(id) {
    return this.entries.has(id);
  }

  async load(id) {
    if (this.entries.has(id)) return this.entries.get(id);
    if (this.loading?.has(id)) return this.loading.get(id);
    this.loading ||= new Map();
    const promise = (async () => {
      const doc = new Y.Doc();
      const entry = { id, doc, known: undefined, dirty: false, timer: 0, firstDirty: 0, saving: null, fresh: false };
      // The local copy first, so the page shows at once and offline edits survive.
      const cached = await this.cache.get(this.cacheKey(id));
      if (cached?.state) {
        Y.applyUpdate(doc, cached.state, LOAD);
        if (cached.unsaved) entry.dirty = true;
      }
      try {
        // Stat first: if another device saves in between, the version noted
        // is older than what is read, and the next save merges again.
        const st = await this.backend.stat(docPath(id));
        const remote = st ? await this.backend.read(docPath(id)) : null;
        if (remote) {
          Y.applyUpdate(doc, remote.bytes, LOAD);
          entry.known = versionOf(st);
        } else {
          entry.known = null;
          entry.fresh = !cached?.state;
        }
      } catch (err) {
        if (!cached?.state) throw err;
        // Offline with a local copy: keep working, save later.
        this.setStatus('offline');
        entry.known = undefined;
      }
      entry.loadedState = Y.encodeStateAsUpdate(doc);
      doc.on('update', (update, origin) => this.onUpdate(entry, update, origin));
      this.entries.set(id, entry);
      if (entry.dirty) this.schedule(entry);
      return entry;
    })();
    this.loading.set(id, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(id);
    }
  }

  cacheKey(id) {
    return `${this.user?.uuid || this.user?.username || 'me'}/personal/${id}`;
  }

  onUpdate(entry, _update, origin) {
    if (origin === LOAD) return;
    this.cacheSoon(entry, origin !== REMOTE || entry.dirty);
    if (origin === REMOTE) return;
    entry.dirty = true;
    this.schedule(entry);
  }

  cacheSoon(entry, unsaved) {
    clearTimeout(entry.cacheTimer);
    entry.cacheTimer = setTimeout(() => {
      this.cache.set(this.cacheKey(entry.id), { state: Y.encodeStateAsUpdate(entry.doc), unsaved: unsaved && entry.dirty });
    }, 250);
  }

  schedule(entry, delay = SAVE_DELAY) {
    if (this.closed) return;
    this.setStatus('saving');
    entry.firstDirty ||= Date.now();
    clearTimeout(entry.timer);
    // Keep typing from postponing the save forever.
    const wait = Math.max(0, Math.min(delay, entry.firstDirty + MAX_WAIT - Date.now()));
    entry.timer = setTimeout(() => this.save(entry).catch(() => {}), wait);
  }

  async save(entry) {
    if (entry.saving) {
      entry.again = true;
      return entry.saving;
    }
    if (!entry.dirty) return;
    entry.saving = (async () => {
      const path = docPath(entry.id);
      entry.dirty = false;
      entry.firstDirty = 0;
      try {
        await this.mergeRemote(entry);
        await this.keepVersion(entry).catch(() => {});
        const result = await this.backend.write(path, Y.encodeStateAsUpdate(entry.doc));
        entry.known = versionOf(result);
        this.failures = 0;
        this.cache.set(this.cacheKey(entry.id), { state: Y.encodeStateAsUpdate(entry.doc), unsaved: entry.dirty });
      } catch (err) {
        entry.dirty = true;
        this.failures++;
        this.setStatus(navigator.onLine === false ? 'offline' : 'error', err?.message || null);
        const delay = RETRY[Math.min(this.failures - 1, RETRY.length - 1)];
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this.save(entry).catch(() => {}), delay);
        throw err;
      } finally {
        entry.saving = null;
      }
      if (entry.again || entry.dirty) {
        entry.again = false;
        if (entry.dirty) this.schedule(entry);
      }
      this.updateStatus();
    })();
    return entry.saving;
  }

  /** Merges in what another device saved since this one last read the file. */
  async mergeRemote(entry) {
    const path = docPath(entry.id);
    const st = await this.backend.stat(path);
    if (!st) return false;
    if (entry.known !== undefined && entry.known !== null && versionOf(st) === entry.known) return false;
    const remote = await this.backend.read(path);
    if (!remote) return false;
    Y.applyUpdate(entry.doc, remote.bytes, REMOTE);
    entry.known = versionOf(st);
    return true;
  }

  /**
   * Keeps an earlier version of a page for page history: the page as it
   * was opened, then at most every few minutes while it is edited.
   */
  async keepVersion(entry) {
    if (entry.id === 'tree' || entry.id.endsWith('.c')) return;
    if (entry.versionAt === undefined) {
      const versions = await this.listVersions(entry.id).catch(() => []);
      entry.versionAt = versions[0]?.at || 0;
    }
    if (Date.now() - entry.versionAt < VERSION_EVERY) return;
    // The first version of a session is how the page looked when opened.
    const state = entry.loadedState?.length > 2 ? entry.loadedState : Y.encodeStateAsUpdate(entry.doc);
    entry.loadedState = null;
    const at = Date.now();
    await this.backend.write(`history/${entry.id}/${at}.ywk`, state);
    entry.versionAt = at;
    const versions = await this.listVersions(entry.id).catch(() => []);
    for (const old of versions.slice(VERSIONS_KEPT)) await this.backend.remove(`history/${entry.id}/${old.name}`).catch(() => {});
  }

  async listVersions(id) {
    if (!/^[a-z0-9]{1,40}$/.test(id)) return [];
    const items = await this.backend.list(`history/${id}`);
    return items
      .map((it) => ({ name: it.name, at: Number(/^(\d+)\.ywk$/.exec(it.name)?.[1]) }))
      .filter((v) => v.at)
      .sort((a, b) => b.at - a.at);
  }

  async versionState(id, version) {
    const file = await this.backend.read(`history/${id}/${version.at}.ywk`);
    if (!file) throw new Error('This version is no longer available.');
    return file.bytes;
  }

  updateStatus() {
    const busy = [...this.entries.values()].some((e) => e.dirty || e.saving);
    this.setStatus(busy ? 'saving' : 'saved');
  }

  /** Checks open documents for changes from other devices. */
  async refresh() {
    if (this.closed || this.refreshing) return;
    this.refreshing = true;
    try {
      for (const entry of this.entries.values()) {
        if (entry.saving || !this.isHeld(entry.id)) continue;
        await this.mergeRemote(entry).catch(() => {});
      }
    } finally {
      this.refreshing = false;
    }
  }

  onRemoteEvent(event) {
    if (!event || event.op === 'gap') return void this.refresh();
    const m = /(?:^|\/)wiki\/(tree\.ywk|pages\/([a-z0-9]+(?:\.c)?)\.ywk)$/.exec(event.path || '');
    if (!m) return;
    const entry = this.entries.get(m[2] || 'tree');
    if (entry && !entry.saving) this.mergeRemote(entry).catch(() => {});
  }

  /** Saves everything now (before closing or signing out). */
  async flushAll() {
    const pending = [];
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      if (entry.dirty || entry.saving) pending.push(entry.saving || this.save(entry));
    }
    await Promise.allSettled(pending);
  }

  hasUnsaved() {
    return [...this.entries.values()].some((e) => e.dirty || e.saving);
  }

  /** Writes a whole document at once (for import, copy and move). */
  async putDoc(id, state) {
    const entry = this.entries.get(id);
    if (entry) {
      Y.applyUpdate(entry.doc, state, 'import');
      entry.dirty = true;
      return this.save(entry);
    }
    const doc = makeDoc(state);
    const result = await this.backend.write(docPath(id), Y.encodeStateAsUpdate(doc));
    doc.destroy();
    return result;
  }

  /** A document's full state, including edits kept on this device but not saved yet. */
  async docState(id) {
    const entry = await this.load(id);
    return Y.encodeStateAsUpdate(entry.doc);
  }

  /** Saves everything, and fails if something could not be saved. */
  async ensureSaved() {
    await this.flushAll();
    if (this.hasUnsaved()) throw new Error('Some changes could not be saved yet. Check your connection and try again.');
  }

  async deleteDocs(ids) {
    for (const id of ids) {
      for (const docId of [id, `${id}.c`]) {
        const entry = this.entries.get(docId);
        if (entry) {
          clearTimeout(entry.timer);
          entry.doc.destroy();
          this.entries.delete(docId);
        }
        await this.backend.remove(docPath(docId)).catch(() => {});
        await this.cache.del(this.cacheKey(docId));
      }
      await this.backend.remove(`history/${id}`).catch(() => {});
    }
  }

  /* ---------- images and covers ---------- */

  async putAsset(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = await sha256Hex(bytes);
    if (!(await this.backend.stat(`assets/${hash}`))) await this.backend.write(`assets/${hash}`, new Blob([bytes], { type: blob.type }));
    this.assetUrls.set(hash, Promise.resolve(URL.createObjectURL(new Blob([bytes], { type: blob.type }))));
    return hash;
  }

  async assetBlob(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    return this.backend.readBlob(`assets/${hash}`);
  }

  assetUrl(hash, type = '') {
    if (!this.assetUrls.has(hash)) {
      const p = this.assetBlob(hash).then((blob) => (blob ? URL.createObjectURL(type && !blob.type ? new Blob([blob], { type }) : blob) : null));
      p.catch(() => this.assetUrls.delete(hash));
      this.assetUrls.set(hash, p);
    }
    return this.assetUrls.get(hash);
  }

  close() {
    this.closed = true;
    for (const e of this.entries.values()) clearTimeout(e.timer);
    Promise.resolve(this.watching).then((off) => off?.());
  }
}
