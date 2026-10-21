/**
 * Everything the signed-in person can open: their private pages, the shared
 * spaces they own or joined, and small per-person lists (favorites, recent
 * pages, joined spaces) kept in puter.kv. Page content never goes in kv.
 */
import { Y, makeDoc, local } from './ydoc.js';
import { Emitter } from '../lib/emitter.js';
import { PersonalSpace } from './personal.js';
import { SharedSpace } from './shared.js';
import { memoryCache } from './cache.js';
import { addPage, getPage, allPages, deletePage, descendants, ancestors, isTrashed, displayTitle, trashPage, updatePage, childrenOf } from './tree.js';
import { insertBlocks, pageText } from './page.js';
import { initDatabase, addView, listProps, addRow, ensureOption, updateView, listViews, listRows, deleteRows } from './database.js';
import { exportSubtree, importSubtree, treeFromBundle, cloneSubtree, copyAssets, cloneDocContent } from './transfer.js';
import { templateById, welcomeBlocks } from './templates.js';
import { uid } from '../lib/ids.js';
import { encodeBase64 } from './ydoc.js';
import { debounce } from '../lib/dom.js';

const KEYS = { rooms: 'wiki:rooms', favorites: 'wiki:favorites', recents: 'wiki:recents' };
const MAX_RECENTS = 30;

export class Workspace extends Emitter {
  /**
   * @param backend  storage for private pages (see backend.js)
   * @param kv       small settings store ({ get, set })
   * @param collab   sharing: { request(server, op, data), deploy(progress), events, permsRequest } or null
   */
  constructor({ backend, kv, cache = memoryCache(), user = null, collab = null }) {
    super();
    this.user = user;
    this.kv = kv;
    this.cache = cache;
    this.collab = collab;
    this.personal = new PersonalSpace({ backend, cache, user });
    this.spaces = new Map([['personal', this.personal]]);
    this.rooms = [];
    this.favorites = [];
    this.recents = [];
    this.index = new Map();
    this.saveRecents = debounce(() => this.kv.set(KEYS.recents, this.recents).catch(() => {}), 1500);
    this.wire(this.personal);
  }

  get by() {
    return this.user?.username || null;
  }

  async start() {
    const fresh = await this.personal.open();
    const [rooms, favorites, recents, index] = await Promise.all([
      this.kv.get(KEYS.rooms).catch(() => null),
      this.kv.get(KEYS.favorites).catch(() => null),
      this.kv.get(KEYS.recents).catch(() => null),
      this.cache.get(this.indexKey()).catch(() => null),
    ]);
    this.rooms = Array.isArray(rooms) ? rooms.filter((r) => r?.room && r?.server) : [];
    this.favorites = Array.isArray(favorites) ? favorites : [];
    this.recents = Array.isArray(recents) ? recents : [];
    if (index && typeof index === 'object') for (const [k, v] of Object.entries(index)) this.index.set(k, v);
    if (fresh && !allPages(this.personal.tree).length) await this.seed();
    // Shared spaces open in the background so private pages show at once.
    this.ready = Promise.allSettled(this.rooms.map((r) => this.openRoom(r)));
    return { fresh };
  }

  indexKey() {
    return `${this.user?.uuid || this.user?.username || 'me'}/index`;
  }

  wire(space) {
    space.on('status', () => this.emit('status', this.status()));
    space.on('role', () => this.emit('spaces'));
    space.on('meta', () => this.emit('spaces'));
    space.on('presence', (roster) => this.emit('presence', space, roster));
    space.on('refused', (err) => this.emit('error', err.message || 'A change could not be saved.'));
    space.on('lost', (err) => this.roomLost(space, err));
    space.on('reset', (id) => this.emit('reset', space, id));
  }

  /** Overall save status across spaces. */
  status() {
    const all = [...this.spaces.values()].map((s) => s.status);
    for (const s of ['error', 'offline', 'saving']) if (all.includes(s)) return s;
    return 'saved';
  }

  allSpaces() {
    return [...this.spaces.values()];
  }

  /** Shared spaces that have finished opening (their tree is loaded). */
  sharedSpaces() {
    return [...this.spaces.values()].filter((s) => s.kind === 'shared' && s.tree);
  }

  space(id) {
    return this.spaces.get(id) || null;
  }

  /** Finds a page in any open space. */
  locate(pageId) {
    for (const space of this.spaces.values()) {
      if (space.tree && getPage(space.tree, pageId)) return space;
    }
    return null;
  }

  /* ---------- seeding and templates ---------- */

  async seed() {
    const tree = this.personal.tree;
    const welcome = addPage(tree, { title: 'Getting started', icon: { name: 'sparkles', color: 'purple' }, by: this.by });
    insertBlocks(await this.personal.doc(welcome), welcomeBlocks());
    await this.createFromTemplate(this.personal, 'tasks', { title: 'Tasks' });
    const notes = addPage(tree, { title: 'Notes', icon: { name: 'notebookPen', color: 'yellow' }, by: this.by });
    insertBlocks(await this.personal.doc(notes), [{ type: 'paragraph', text: 'A place for quick notes. Add subpages with the + next to this page in the sidebar.' }]);
  }

  /** Creates a page (optionally from a template). Returns its id. */
  async createPage(space, { parent = null, title = '', kind = 'page', template = null, after = null, icon = null } = {}) {
    if (template) return this.createFromTemplate(space, template, { parent, title, after });
    const id = addPage(space.tree, { parent, title, kind, icon, after, by: this.by });
    if (kind === 'database') {
      const doc = await space.doc(id);
      initDatabase(doc, { props: [{ name: 'Tags', type: 'multi' }] });
    }
    return id;
  }

  async createFromTemplate(space, templateId, { parent = null, title = '', after = null } = {}) {
    const tpl = templateById(templateId);
    if (!tpl) return this.createPage(space, { parent, title, after });
    const kind = tpl.database ? 'database' : 'page';
    const id = addPage(space.tree, { parent, title: title || tpl.name, icon: tpl.icon, kind, after, by: this.by });
    const doc = await space.doc(id);
    if (tpl.database) {
      const spec = tpl.database;
      initDatabase(doc, { props: spec.props.map(({ options, ...p }) => p), view: spec.views[0] });
      const props = listProps(doc);
      for (const p of spec.props) {
        if (!Array.isArray(p.options)) continue;
        const prop = props.find((x) => x.name === p.name);
        for (const o of p.options) ensureOption(doc, prop.id, o);
      }
      for (const v of spec.views.slice(1)) addView(doc, { type: v });
      const status = listProps(doc).find((p) => p.type === 'status');
      for (const r of spec.rows) {
        const values = {};
        if (status && r.status !== undefined) values[status.id] = status.options[r.status]?.id;
        const rowId = addRow(doc, { values });
        addPage(space.tree, { id: rowId, parent: id, title: r.title, row: true, by: this.by });
      }
      // Boards group by status.
      for (const v of listViews(doc)) if (v.type === 'board' && !v.groupBy && status) updateView(doc, v.id, { groupBy: status.id });
    } else {
      insertBlocks(doc, tpl.blocks());
    }
    return id;
  }

  /** Adds a database row and its page. */
  async addRow(space, dbId, { values = {}, title = '', after = null } = {}) {
    const doc = await space.doc(dbId);
    const id = addRow(doc, { values, after });
    addPage(space.tree, { id, parent: dbId, title, row: true, by: this.by });
    return id;
  }

  /* ---------- trash ---------- */

  trash(space, pageId) {
    trashPage(space.tree, pageId, this.by);
    this.favorites = this.favorites.filter((f) => !(f.space === space.id && descendants(space.tree, pageId).includes(f.page)));
    this.kv.set(KEYS.favorites, this.favorites).catch(() => {});
    this.emit('favorites');
  }

  async deleteForever(space, pageId) {
    const page = getPage(space.tree, pageId);
    // A row also leaves its database.
    if (page?.row && page.parent) deleteRows(await space.doc(page.parent), [pageId]);
    const ids = deletePage(space.tree, pageId);
    await space.deleteDocs(ids);
    for (const id of ids) this.index.delete(`${space.id}|${id}`);
    this.recents = this.recents.filter((r) => !(r.space === space.id && ids.includes(r.page)));
    this.saveRecents();
  }

  /* ---------- favorites and recents ---------- */

  isFavorite(space, pageId) {
    return this.favorites.some((f) => f.space === space.id && f.page === pageId);
  }

  async toggleFavorite(space, pageId) {
    if (this.isFavorite(space, pageId)) this.favorites = this.favorites.filter((f) => !(f.space === space.id && f.page === pageId));
    else this.favorites = [...this.favorites, { space: space.id, page: pageId }];
    this.emit('favorites');
    await this.kv.set(KEYS.favorites, this.favorites).catch(() => {});
  }

  moveFavorite(from, to) {
    const list = [...this.favorites];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    this.favorites = list;
    this.emit('favorites');
    this.kv.set(KEYS.favorites, this.favorites).catch(() => {});
  }

  visited(space, pageId) {
    this.recents = [{ space: space.id, page: pageId, at: Date.now() }, ...this.recents.filter((r) => !(r.space === space.id && r.page === pageId))].slice(0, MAX_RECENTS);
    this.saveRecents();
  }

  /** Recent pages that still exist. */
  recentPages() {
    return this.recents
      .map((r) => {
        const space = this.space(r.space);
        const page = space?.tree && getPage(space.tree, r.page);
        return page && !isTrashed(space.tree, r.page) ? { space, page, at: r.at } : null;
      })
      .filter(Boolean);
  }

  /* ---------- search ---------- */

  noteText(space, pageId, doc) {
    const key = `${space.id}|${pageId}`;
    const text = pageText(doc, { limit: 20000 }).slice(0, 20000);
    if (this.index.get(key)?.text === text) return;
    this.index.set(key, { text, at: Date.now() });
    clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => this.cache.set(this.indexKey(), Object.fromEntries(this.index)).catch(() => {}), 2000);
  }

  /** Reads pages that are not indexed yet, slowly, so search covers them. */
  async indexInBackground(signal) {
    for (const space of this.spaces.values()) {
      for (const p of allPages(space.tree || new Y.Doc())) {
        if (signal?.aborted) return;
        const key = `${space.id}|${p.id}`;
        if (this.index.has(key) || p.kind === 'database') continue;
        try {
          const doc = await space.doc(p.id);
          this.noteText(space, p.id, doc);
        } catch {
          /* try again another time */
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  /** Pages matching a query, best first: title matches, then text matches. */
  search(query, { limit = 50 } = {}) {
    const q = query.trim().toLowerCase();
    const results = [];
    for (const space of this.spaces.values()) {
      if (!space.tree) continue;
      for (const page of allPages(space.tree)) {
        if (isTrashed(space.tree, page.id)) continue;
        const title = displayTitle(page);
        const lower = title.toLowerCase();
        let score = 0;
        let snippet = '';
        if (!q) score = page.updated || 1;
        else if (lower === q) score = 4e15;
        else if (lower.startsWith(q)) score = 3e15;
        else if (lower.includes(q)) score = 2e15;
        else {
          const text = this.index.get(`${space.id}|${page.id}`)?.text || '';
          const i = text.toLowerCase().indexOf(q);
          if (i >= 0) {
            score = 1e15;
            const start = Math.max(0, i - 40);
            snippet = `${start ? '...' : ''}${text.slice(start, i + q.length + 80).replace(/\s+/g, ' ')}`;
          }
        }
        if (!score) continue;
        results.push({ space, page, title, snippet, score: score + (page.updated || 0) / 1e3, path: ancestors(space.tree, page.id).slice(0, -1).map(displayTitle) });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /* ---------- copy and move ---------- */

  async duplicate(space, pageId) {
    const page = getPage(space.tree, pageId);
    if (page?.row) return this.duplicateRow(space, pageId);
    return cloneSubtree(space, pageId, { by: this.by });
  }

  /** A copy of a database row, with its values and content, right below it. */
  async duplicateRow(space, rowId) {
    const page = getPage(space.tree, rowId);
    const db = await space.doc(page.parent);
    const values = listRows(db).find((r) => r.id === rowId)?.values || {};
    const id = addRow(db, { values, after: rowId });
    addPage(space.tree, { id, parent: page.parent, title: `${page.title || 'Untitled'} (copy)`, icon: page.icon || null, row: true, by: this.by });
    const content = new Y.Doc();
    cloneDocContent(await space.doc(rowId), content, new Map());
    if (content.getMap('blocks').size) await space.putDoc(id, Y.encodeStateAsUpdate(content));
    return id;
  }

  /** Moves a page (with its subpages) to another space, under a parent. */
  async moveToSpace(from, pageId, to, parent = null) {
    if (from === to) return false;
    if (getPage(from.tree, pageId)?.row) throw new Error('Database rows stay in their database.');
    await from.ensureSaved();
    const bundle = await exportSubtree(from, pageId);
    await importSubtree(from, to, bundle, parent);
    // The source goes only once the copy is confirmed saved.
    await to.ensureSaved();
    await this.removeMoved(from, pageId, to);
    return true;
  }

  async removeMoved(from, pageId, to) {
    const ids = deletePage(from.tree, pageId);
    await from.deleteDocs(ids);
    const moved = new Set(ids);
    const remap = (list) => list.map((x) => (x.space === from.id && moved.has(x.page) ? { ...x, space: to.id } : x));
    this.favorites = remap(this.favorites);
    this.recents = remap(this.recents);
    for (const id of ids) {
      const v = this.index.get(`${from.id}|${id}`);
      if (v) {
        this.index.delete(`${from.id}|${id}`);
        this.index.set(`${to.id}|${id}`, v);
      }
    }
    this.kv.set(KEYS.favorites, this.favorites).catch(() => {});
    this.saveRecents();
    this.emit('favorites');
  }

  /* ---------- shared spaces ---------- */

  get canShare() {
    return !!this.collab;
  }

  roomSpace(entry, role = entry.role || 'viewer') {
    const space = new SharedSpace({
      server: entry.server,
      room: entry.room,
      request: (op, data) => this.collab.request(entry.server, op, data),
      events: this.collab.events,
      cache: this.cache,
      user: this.user,
      title: entry.title,
      icon: entry.icon,
      role,
    });
    this.wire(space);
    return space;
  }

  async openRoom(entry, token) {
    if (!this.collab) return null;
    const existing = this.spaces.get(entry.room);
    if (existing) return existing;
    const space = this.roomSpace(entry);
    this.spaces.set(entry.room, space);
    try {
      await space.open({ token });
      entry.lost = null;
      // The owner's server picks up this build of the worker in the background.
      if (space.role === 'owner') Promise.resolve(this.collab.refresh?.(entry.server)).catch(() => {});
      if (space.title !== entry.title || space.role !== entry.role || space.owner !== entry.owner) {
        Object.assign(entry, { title: space.title, role: space.role, owner: space.owner });
        this.saveRooms();
      }
      this.emit('spaces');
      return space;
    } catch (err) {
      this.spaces.delete(entry.room);
      space.close();
      if (err.status === 403 || err.status === 404) {
        entry.lost = err.message;
        this.emit('spaces');
      }
      throw err;
    }
  }

  saveRooms() {
    return this.kv.set(KEYS.rooms, this.rooms.map(({ lost, ...r }) => r)).catch(() => {});
  }

  /** Opens a shared space from a link, joining it if needed. */
  async joinLink({ server, room, token }) {
    let entry = this.rooms.find((r) => r.room === room);
    const isNew = !entry;
    if (!entry) entry = { server, room, title: '', role: 'viewer', joined: Date.now() };
    const space = this.spaces.get(room) || (await this.openRoom(entry, token));
    if (isNew) {
      this.rooms.push(entry);
      await this.saveRooms();
    }
    this.emit('spaces');
    return space;
  }

  roomLost(space, err) {
    const entry = this.rooms.find((r) => r.room === space.id);
    if (entry) entry.lost = err.message;
    this.emit('lost', space, err);
    this.emit('spaces');
  }

  /** Removes a shared space from this person's list (and leaves it). */
  async leaveRoom(roomId) {
    const space = this.spaces.get(roomId);
    if (space && space.kind === 'shared') {
      if (space.role !== 'owner') await space.request('forget').catch(() => {});
      space.close();
      this.spaces.delete(roomId);
    }
    this.rooms = this.rooms.filter((r) => r.room !== roomId);
    this.favorites = this.favorites.filter((f) => f.space !== roomId);
    this.recents = this.recents.filter((r) => r.space !== roomId);
    await this.saveRooms();
    this.kv.set(KEYS.favorites, this.favorites).catch(() => {});
    this.saveRecents();
    this.emit('favorites');
    this.emit('spaces');
  }

  /** Deletes a shared space for everyone (owner only). */
  async deleteRoom(roomId) {
    const space = this.spaces.get(roomId);
    if (!space?.canManage) throw new Error('Only the owner can delete this space.');
    await space.request('delete');
    await this.leaveRoom(roomId);
  }

  /**
   * Shares a private page: the page and everything under it move to a new
   * shared space on this person's collaboration server. Returns the space.
   */
  async sharePage(pageId, progress = () => {}) {
    if (!this.collab) throw new Error('Sharing needs a Puter account.');
    const from = this.personal;
    const root = getPage(from.tree, pageId);
    if (!root) throw new Error('This page no longer exists.');
    if (root.row) throw new Error('Share the database this row belongs to instead.');
    await from.ensureSaved();
    const server = await this.collab.deploy(progress);
    progress('Copying pages...');
    const bundle = await exportSubtree(from, pageId);
    const tree = treeFromBundle(bundle);
    const docs = { tree: encodeBase64(Y.encodeStateAsUpdate(tree)) };
    for (const [id, state] of Object.entries(bundle.docs)) docs[id] = encodeBase64(state);
    const room = uid(16);
    await this.collab.request(server, 'create', { room, docs, title: displayTitle(root), icon: root.icon || null });
    const entry = { server, room, title: displayTitle(root), icon: root.icon || null, role: 'owner', owner: this.user?.username || null, joined: Date.now() };
    const space = await this.openRoom(entry);
    this.rooms.push(entry);
    await this.saveRooms();
    progress('Copying images...');
    const failed = await copyAssets(from, space, bundle.assets);
    if (failed.length) {
      // Keep the private copy rather than lose images.
      this.emit('error', `${failed.length} image${failed.length === 1 ? '' : 's'} could not be copied to the shared space, so your private copy was kept too.`);
    } else await this.removeMoved(from, pageId, space);
    this.emit('spaces');
    return space;
  }

  /** Keeps a shared space's listed title in step with its root page. */
  syncRoomTitle(space) {
    if (space.kind !== 'shared' || !space.canEdit) return;
    const root = childrenOf(space.tree)[0];
    if (!root) return;
    const title = displayTitle(root);
    const entry = this.rooms.find((r) => r.room === space.id);
    if (entry && (entry.title !== title || JSON.stringify(entry.icon) !== JSON.stringify(root.icon || null))) {
      entry.title = title;
      entry.icon = root.icon || null;
      space.title = title;
      this.saveRooms();
      space.request('meta', { title, icon: root.icon || null }).catch(() => {});
    }
  }

  hasUnsaved() {
    return [...this.spaces.values()].some((s) => s.hasUnsaved());
  }

  async flushAll() {
    await Promise.allSettled([...this.spaces.values()].map((s) => s.flushAll()));
  }

  close() {
    for (const s of this.spaces.values()) s.close();
  }
}

export { makeDoc, local, updatePage };
