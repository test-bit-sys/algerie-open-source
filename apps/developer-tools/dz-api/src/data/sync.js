/**
 * Mirrors the workspace into the user's Puter cloud as plain JSON files in
 * the app's own folder, so the same work shows up on every device:
 *
 *   workspace/collections/<id>.json
 *   workspace/environments/<id>.json
 *   workspace/globals.json
 *   workspace/history.json        (most recent entries only)
 *
 * One file per collection keeps writes small and lets two devices edit
 * different collections without touching each other. Changes upload a moment
 * after they happen; remote changes are picked up on start and whenever the
 * window regains focus, using each file's modified time from one directory
 * listing. When both sides changed the same file, the newer edit wins.
 * Per-file bookkeeping lives in the local 'sync' store.
 */
import { Emitter } from '../lib/emitter.js';

const CLOUD_HISTORY = 200;
const FLUSH_DELAY = 1200;
const HISTORY_DELAY = 10000;
const PULL_INTERVAL = 30000;
const PULL_CONCURRENCY = 4;

export class CloudSync extends Emitter {
  constructor({ ws, db, fs, root = 'workspace' }) {
    super();
    this.ws = ws;
    this.db = db;
    this.fs = fs;
    this.root = root;
    this.meta = new Map();
    this.status = 'idle';
    this.error = null;
    this.timer = 0;
    this.queue = Promise.resolve();
    this.lastPull = 0;
    this.stopped = false;
    this.onChange = (e) => this.#localChange(e);
  }

  path(kind, id) {
    if (kind === 'collection') return `${this.root}/collections/${id}.json`;
    if (kind === 'environment') return `${this.root}/environments/${id}.json`;
    if (kind === 'globals') return `${this.root}/globals.json`;
    return `${this.root}/history.json`;
  }

  #setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.emit('status', { status, error });
  }

  async start() {
    for (const [key, value] of await this.db.all('sync')) this.meta.set(key, value);
    this.ws.on('change', this.onChange);
    await this.pull();
  }

  /**
   * Drops a file's bookkeeping so the next pull merges it like a first sync.
   * For changes made before start(), which never reach #localChange.
   */
  async forget(kind, id) {
    await this.#setMeta(this.path(kind, id), null);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = 0;
    this.ws.off('change', this.onChange);
  }

  async #ensureDirs() {
    for (const dir of [`${this.root}/collections`, `${this.root}/environments`]) {
      try {
        await this.fs.mkdir(dir, { createMissingParents: true });
      } catch {
        // Already there.
      }
    }
  }

  async #setMeta(path, value) {
    if (value) this.meta.set(path, value);
    else this.meta.delete(path);
    await (value ? this.db.put('sync', path, value) : this.db.delete('sync', path));
  }

  #localChange({ kind, id, deleted, remote }) {
    if (remote || this.stopped) return;
    // Collections shared by other people live in their owner's cloud.
    if (kind === 'collection' && this.ws.getCollection(id)?.shared) return;
    const path = this.path(kind, id);
    const prev = this.meta.get(path) || {};
    // ver counts local edits so a flush only clears dirty when nothing changed while it uploaded.
    this.#setMeta(path, { ...prev, kind, id, dirty: true, deleted: !!deleted, ver: (prev.ver || 0) + 1 }).catch((err) => console.warn('Could not record a change for sync', err));
    this.#schedule(kind === 'history' ? HISTORY_DELAY : FLUSH_DELAY);
  }

  #schedule(delay, { retry = false } = {}) {
    if (!retry) this.#setStatus('pending');
    const due = Date.now() + delay;
    // A slower change (history) never postpones a sooner upload already waiting.
    if (this.timer && delay > this.delay && this.due <= due) return;
    clearTimeout(this.timer);
    this.delay = delay;
    this.due = due;
    this.timer = setTimeout(() => this.flush(), delay);
  }

  /** Uploads every pending change. Runs one at a time. */
  flush() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.queue = this.queue.then(() => this.#flush()).catch(() => {});
    return this.queue;
  }

  async #flush() {
    const pending = [...this.meta.entries()].filter(([, m]) => m.dirty);
    if (!pending.length) {
      if (this.status === 'pending') this.#setStatus('synced');
      return;
    }
    this.#setStatus('syncing');
    try {
      await this.#ensureDirs();
      for (const [path, m] of pending) {
        const ver = m.ver || 0;
        const changedSince = () => (this.meta.get(path)?.ver || 0) !== ver;
        if (m.deleted) {
          try {
            await this.fs.delete(path);
          } catch (err) {
            if (!isMissing(err)) throw err;
          }
          if (!changedSince()) await this.#setMeta(path, null);
          continue;
        }
        const data = this.#serialize(m.kind, m.id);
        if (data == null) {
          if (!changedSince()) await this.#setMeta(path, null);
          continue;
        }
        const item = await this.fs.write(path, data, { overwrite: true, createMissingParents: true });
        const now = this.meta.get(path) || {};
        await this.#setMeta(path, { ...now, kind: m.kind, id: m.id, modified: item?.modified ?? Date.now(), dirty: changedSince() });
      }
      if ([...this.meta.values()].some((x) => x.dirty)) this.#schedule(FLUSH_DELAY);
      else this.#setStatus('synced');
    } catch (err) {
      this.#setStatus('error', err);
      this.#schedule(15000, { retry: true });
    }
  }

  #serialize(kind, id) {
    if (kind === 'collection') {
      const c = this.ws.getCollection(id);
      return c && !c.shared ? JSON.stringify(c) : null;
    }
    if (kind === 'environment') {
      const e = this.ws.getEnvironment(id);
      return e ? JSON.stringify(e) : null;
    }
    if (kind === 'globals') return JSON.stringify(this.ws.globals);
    return JSON.stringify({ entries: this.ws.history.slice(0, CLOUD_HISTORY), removed: this.ws.historyRemoved });
  }

  /** Pulls remote changes; call on start and when the app regains focus. */
  pullIfStale() {
    if (Date.now() - this.lastPull < PULL_INTERVAL) return Promise.resolve();
    return this.pull();
  }

  pull() {
    this.queue = this.queue.then(() => this.#pull()).catch(() => {});
    return this.queue;
  }

  async #pull() {
    this.lastPull = Date.now();
    this.#setStatus('syncing');
    try {
      await this.#ensureDirs();
      const [cols, envs, top] = await Promise.all([
        this.fs.readdir(`${this.root}/collections`),
        this.fs.readdir(`${this.root}/environments`),
        this.fs.readdir(this.root),
      ]);
      await this.#reconcile('collection', cols, this.ws.collections.filter((c) => !c.shared).map((c) => c.id));
      await this.#reconcile('environment', envs, [...this.ws.environmentsById.keys()]);
      const globals = top.find((f) => f.name === 'globals.json');
      if (globals) await this.#pullFile('globals', 'globals', globals);
      else if (this.ws.globals.variables.length) await this.#markDirty('globals', 'globals');
      const history = top.find((f) => f.name === 'history.json');
      if (history) await this.#pullFile('history', null, history);
      else if (this.ws.history.length) await this.#markDirty('history', null);
      this.#setStatus('synced');
    } catch (err) {
      this.#setStatus('error', err);
    }
    if ([...this.meta.values()].some((m) => m.dirty)) await this.#flush();
  }

  async #markDirty(kind, id) {
    const path = this.path(kind, id);
    await this.#setMeta(path, { ...(this.meta.get(path) || {}), kind, id, dirty: true, deleted: false });
  }

  async #reconcile(kind, remoteItems, localIds) {
    const remoteIds = new Set();
    const files = (remoteItems || []).filter((f) => !f.isDir && f.name.endsWith('.json'));
    for (const f of files) remoteIds.add(f.name.slice(0, -5));
    // A few downloads at a time, so a first sync on a new device is not one round trip per file.
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const f = files[next++];
        await this.#pullFile(kind, f.name.slice(0, -5), f);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PULL_CONCURRENCY, files.length) }, worker));
    for (const id of localIds) {
      if (remoteIds.has(id)) continue;
      const m = this.meta.get(this.path(kind, id));
      if (m && m.modified && !m.dirty) {
        // It was in the cloud before and is gone now: deleted on another device.
        if (kind === 'collection') await this.ws.deleteCollection(id, { quiet: true });
        else await this.ws.deleteEnvironment(id, { quiet: true });
        await this.#setMeta(this.path(kind, id), null);
      } else if (!m?.deleted) await this.#markDirty(kind, id);
    }
  }

  async #pullFile(kind, id, f) {
    const path = this.path(kind, id);
    const m = this.meta.get(path);
    if (m && m.modified === f.modified) return;
    if (m?.deleted && m.dirty) return;
    const text = await (await this.fs.read(path)).text();
    if (this.meta.get(path)?.dirty && !m?.dirty) return; // Edited while reading; ours uploads next.
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return; // A damaged file is left alone rather than wiping local data.
    }
    if (kind === 'history') {
      const removed = data.removed && typeof data.removed === 'object' ? data.removed : { clearedAt: 0, ids: [] };
      await this.ws.mergeHistory(Array.isArray(data.entries) ? data.entries : [], removed);
      const remoteIds = new Set((data.entries || []).map((e) => e.id));
      const remoteRemoved = new Set(Array.isArray(removed.ids) ? removed.ids : []);
      const mine = this.ws.historyRemoved;
      const ahead = this.ws.history.slice(0, CLOUD_HISTORY).some((h) => !remoteIds.has(h.id))
        || mine.clearedAt > (removed.clearedAt || 0)
        || mine.ids.some((x) => !remoteRemoved.has(x))
        || (data.entries || []).some((e) => e && !this.ws.history.some((h) => h.id === e.id));
      await this.#setMeta(path, { kind, id, modified: f.modified, dirty: ahead || !!m?.dirty });
      return;
    }
    const local = kind === 'collection' ? this.ws.getCollection(id) : kind === 'environment' ? this.ws.getEnvironment(id) : this.ws.globals;
    if (kind === 'collection' && local?.shared) return; // A shared copy with the same id; leave it to SharedCollections.
    const cur = this.meta.get(path) || m;
    if (cur?.dirty && local && (local.updatedAt || 0) > (data.updatedAt || 0)) {
      // Both changed; ours is newer and will overwrite on the next flush.
      await this.#setMeta(path, { ...cur, modified: f.modified });
      return;
    }
    if (kind === 'globals' && !m && local?.variables?.length) {
      // First sync on this device: keep local globals the cloud does not have yet.
      const remoteKeys = new Set((data.variables || []).map((v) => v.key));
      const extra = local.variables.filter((v) => v.key && !remoteKeys.has(v.key));
      await this.ws.putGlobals({ ...data, variables: [...(data.variables || []), ...extra] }, { quiet: true });
      await this.#setMeta(path, { kind, id, modified: f.modified, dirty: extra.length > 0, ver: 1 });
      if (extra.length) this.#schedule(FLUSH_DELAY);
      return;
    }
    const ver = this.meta.get(path)?.ver || 0;
    if (kind === 'collection') await this.ws.putCollection({ ...data, id }, { quiet: true });
    else if (kind === 'environment') await this.ws.putEnvironment({ ...data, id }, { quiet: true });
    else await this.ws.putGlobals(data, { quiet: true });
    // An edit made while the pulled copy was being stored still needs to upload.
    const now = this.meta.get(path) || {};
    await this.#setMeta(path, { ...now, kind, id, modified: f.modified, dirty: (now.ver || 0) !== ver });
  }
}

function isMissing(err) {
  const code = err?.code || err?.error?.code || '';
  return code === 'subject_does_not_exist' || /not.?found|does not exist/i.test(err?.message || '');
}
