/**
 * Sidebar with three sections: Collections (a tree), Environments and
 * History. The tree follows the ARIA tree pattern with one tab stop, arrow
 * keys, typeahead, F2 rename, Delete, Mod+D duplicate and drag and drop.
 */
import { h, fill, debounce, modKey, shortcut, announce, domId } from '../lib/dom.js';
import { icon } from './icons.js';
import { contextMenu, showMenu, menuButton } from './menu.js';
import { shortMethod } from './tabbar.js';
import { prefs } from './prefs.js';
import { leavesIn, cloneWithNewIds, normalizeRequest } from '../core/model.js';
import { displayUrl } from '../core/url.js';
import { resolveRequest } from '../core/prepare.js';
import { relativeDay, timeOfDay, statusClass } from '../lib/format.js';
import { toast } from './toast.js';
import { confirmDialog } from './dialog.js';

const SECTIONS = { collections: 'Collections', environments: 'Environments', history: 'History' };

export class Sidebar {
  // The row reveal() is drawing the tree for.
  #revealing = null;

  constructor(app) {
    this.app = app;
    this.ws = app.ws;
    this.section = prefs.get('sidebarSection') || 'collections';
    this.expanded = new Set();
    this.filter = { collections: '', environments: '', history: '' };
    this.focusedId = null;
    this.selectedId = null;
    this.saveExpanded = () => this.ws.setMeta('expanded', [...this.expanded]);
    this.saveExpanded.flush = () => {};
    this.renderSoon = debounce(() => this.render(), 30);
    // Typing in the filter redraws once the typing pauses: a large tree takes a while to build.
    this.filterSoon = debounce(() => this.render(), 120);
    // History headings say Today and Yesterday: redrawn at midnight (see #renderHistory) and when a device that slept is back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') this.#refreshDay();
    });

    const panelId = domId('sidebar-panel');
    this.segment = h(
      'div.sidebar-switch.segmented',
      { role: 'tablist', 'aria-label': 'Sidebar sections' },
      Object.entries(SECTIONS).map(([key, label]) =>
        h('button', { type: 'button', role: 'tab', id: `${panelId}-${key}`, dataset: { key }, 'aria-selected': 'false', 'aria-controls': panelId, tabindex: '-1', onclick: () => app.showSection(key) }, label),
      ),
    );
    // Tabs pattern: one Tab stop, arrow keys move between sections.
    this.segment.addEventListener('keydown', (e) => {
      const tabs = [...this.segment.children];
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const next = tabs[(to + tabs.length) % tabs.length];
      app.showSection(next.dataset.key);
      next.focus();
    });
    this.titleEl = h('h2.sidebar-title');
    this.actionsEl = h('div.sidebar-actions');
    this.searchInput = h('input.input.sm.sidebar-filter', { type: 'search', placeholder: 'Filter', 'aria-label': 'Filter', autocomplete: 'off', spellcheck: false });
    this.searchInput.addEventListener('input', () => {
      this.filter[this.section] = this.searchInput.value;
      // A cleared filter shows everything at once.
      if (this.searchInput.value) this.filterSoon();
      else this.render();
    });
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.filterSoon.flush();
        this.focus();
      } else if (e.key === 'Enter') {
        this.filterSoon.flush();
      } else if (e.key === 'Escape' && this.searchInput.value) {
        e.stopPropagation();
        this.searchInput.value = '';
        this.filter[this.section] = '';
        this.render();
      }
    });
    this.body = h('div.sidebar-body', { id: panelId, role: 'tabpanel' });
    // Phones only, where the sidebar is a drawer over the page.
    const close = h('button.icon-btn.sidebar-close', { type: 'button', 'aria-label': 'Close sidebar', title: 'Close sidebar', onclick: () => app.toggleSidebar(false) }, icon('x', 16));
    this.el = h(
      'div.sidebar-inner',
      h('div.sidebar-top', this.segment, close),
      h('div.sidebar-head', this.titleEl, this.actionsEl),
      h('div.sidebar-search', icon('search', 14), this.searchInput),
      this.body,
    );
  }

  async load() {
    const saved = await this.ws.getMeta('expanded');
    if (Array.isArray(saved)) for (const id of saved) this.expanded.add(id);
    this.app.showSection(this.section, { open: false });
  }

  show(key) {
    this.section = key;
    for (const b of this.segment.children) {
      const on = b.dataset.key === key;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) this.body.setAttribute('aria-labelledby', b.id);
    }
    this.searchInput.value = this.filter[key] || '';
    this.searchInput.placeholder = { collections: 'Filter requests', environments: 'Filter environments', history: 'Filter history' }[key];
    this.render();
  }

  focus() {
    const target = this.body.querySelector('[tabindex="0"]') || this.searchInput;
    target?.focus();
  }

  onChange(e) {
    // The tree shows no variables: scripts setting them on every request of a run leave it as it is.
    if (e.variablesOnly) return;
    if (e.kind === 'collection' && e.created) this.expanded.add(e.id);
    if ((e.kind === 'collection' && this.section === 'collections') || ((e.kind === 'environment' || e.kind === 'globals') && this.section === 'environments') || (e.kind === 'history' && this.section === 'history')) {
      this.renderSoon();
    }
  }

  highlight(id) {
    this.selectedId = id;
    for (const el of this.body.querySelectorAll('[role="treeitem"]')) el.setAttribute('aria-selected', String(el.dataset.id === id));
    for (const el of this.body.querySelectorAll('.side-row')) el.classList.toggle('selected', el.dataset.id === id);
  }

  expand(id) {
    if (!this.expanded.has(id)) {
      this.expanded.add(id);
      this.saveExpanded();
    }
  }

  /** Expands every ancestor of an item, renders and scrolls it into view. */
  reveal(id) {
    const loc = this.ws.locate(id);
    if (!loc) return;
    for (const p of loc.parents) this.expanded.add(p.id);
    this.saveExpanded();
    if (this.section === 'collections') {
      this.#revealing = id;
      this.render();
      const row = this.body.querySelector(`[data-id="${CSS.escape(id)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    }
  }

  render() {
    // Drawn now with the current filter: a redraw still waiting for typing to pause is not needed.
    this.filterSoon.cancel();
    this.titleEl.textContent = SECTIONS[this.section];
    if (this.section === 'collections') this.#renderCollections();
    else if (this.section === 'environments') this.#renderEnvironments();
    else this.#renderHistory();
  }

  // Collections ---------------------------------------------------------------

  #renderCollections() {
    const app = this.app;
    fill(
      this.actionsEl,
      h('button.icon-btn.sm', { type: 'button', 'aria-label': 'New collection', title: 'New collection', onclick: () => app.createCollection() }, icon('plus', 16)),
      h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Import', title: `Import (${shortcut('Mod+O')})`, onclick: () => import('./dialogs.js').then((m) => m.openImportDialog(app)) }, icon('import', 16)),
    );
    const cols = this.ws.collections;
    if (!cols.length) {
      fill(
        this.body,
        h(
          'div.empty',
          icon('collections', 28),
          h('p.empty-title', 'No collections yet'),
          h('p', 'Collections group related requests so you can save, share and run them together.'),
          h('div.empty-actions', h('button.btn.sm.primary', { type: 'button', onclick: () => app.createCollection() }, icon('plus', 14), 'New collection'), h('button.btn.sm', { type: 'button', onclick: () => import('./dialogs.js').then((m) => m.openImportDialog(app)) }, icon('import', 14), 'Import')),
        ),
      );
      return;
    }
    const q = (this.filter.collections || '').trim().toLowerCase();
    const rows = [];
    const matches = (item) => item.name.toLowerCase().includes(q) || ((item.type === 'request' || item.type === 'websocket') && item.url.toLowerCase().includes(q));
    // all: inside a folder or collection found by its name, which shows everything in it.
    const visit = (node, level, parents, all = false) => {
      for (const item of node.items || []) {
        if (q) {
          const self = all || matches(item);
          const childHit = item.type === 'folder' && leavesIn(item).some((r) => matches(r.item));
          const folderHit = item.type === 'folder' && hasMatchingFolder(item, q);
          if (!self && !childHit && !folderHit) continue;
          rows.push({ item, level, parents, collection: parents[0] });
          if (item.type === 'folder') visit(item, level + 1, [...parents, item], self);
        } else {
          rows.push({ item, level, parents, collection: parents[0] });
          if (item.type === 'folder' && this.expanded.has(item.id)) visit(item, level + 1, [...parents, item]);
        }
      }
    };
    const ordered = [...cols.filter((c) => !c.shared), ...cols.filter((c) => c.shared)];
    let sharedHeading = false;
    for (const c of ordered) {
      if (q && !matches(c) && !leavesIn(c).some((r) => matches(r.item)) && !hasMatchingFolder(c, q)) continue;
      if (c.shared && !sharedHeading) {
        sharedHeading = true;
        rows.push({ heading: 'Shared with you' });
      }
      rows.push({ item: c, level: 1, parents: [], collection: c });
      if (q || this.expanded.has(c.id)) visit(c, 2, [c], !!q && matches(c));
    }
    this.rows = rows;
    if (!rows.length) {
      fill(this.body, h('div.empty', icon('search', 24), h('p', `Nothing matches "${this.filter.collections}".`)));
      return;
    }
    const items = rows.filter((r) => r.item);
    if (!items.some((r) => r.item.id === this.focusedId)) {
      const has = (id) => id && items.some((r) => r.item.id === id);
      this.focusedId = has(this.focusAfterDelete) ? this.focusAfterDelete : items.find((r) => r.item.id === this.selectedId)?.item.id || items[0]?.item.id;
      this.focusAfterDelete = null;
    }
    const hadFocus = this.body.contains(document.activeElement) || (this.restoreFocus && (document.activeElement === document.body || !document.activeElement));
    this.restoreFocus = false;
    const revealing = this.#revealing;
    this.#revealing = null;
    const near = this.#nearView(rows.length, revealing ? rows.findIndex((r) => r.item?.id === revealing) : -1);
    const tree = h('div.tree', { role: 'tree', 'aria-label': 'Collections' }, rows.map((r, i) => (r.heading ? h('div.tree-heading', { role: 'presentation' }, icon('users', 13), h('span', r.heading)) : this.#treeRow(r, !!q, !near(i)))));
    tree.addEventListener('keydown', (e) => this.#treeKey(e));
    fill(this.body, tree);
    if (hadFocus) tree.querySelector('[tabindex="0"]')?.focus();
  }

  /**
   * Which of the rows about to be drawn can be on screen: one screen up and down from where the
   * list is scrolled to, and around a row being revealed. The others are drawn lazily (see
   * .tree-row.lazy): a lazy row added in view would miss clicks until the next frame is drawn.
   * Returns (row index) => boolean.
   */
  #nearView(count, around = -1) {
    const rowHeight = matchMedia('(pointer: coarse)').matches ? 40 : 30;
    const height = this.body.clientHeight;
    const screen = Math.ceil(height / rowHeight) + 10;
    // A shorter list than before is scrolled up to its end.
    const top = Math.min(this.body.scrollTop, Math.max(0, count * rowHeight - height));
    const first = Math.floor(top / rowHeight);
    return (i) => (i >= first - screen && i <= first + 2 * screen) || (around >= 0 && Math.abs(i - around) <= 2 * screen);
  }

  /** lazy: the row is drawn only once it nears the view (it is not in view when added). */
  #treeRow({ item, level, parents, collection }, filtering, lazy = false) {
    const app = this.app;
    const isLeaf = item.type === 'request' || item.type === 'websocket';
    const isContainer = !isLeaf;
    const open = isContainer && (filtering || this.expanded.has(item.id));
    const lead =
      item.type === 'request'
        ? h('span.method.tree-method', { dataset: { m: item.method } }, shortMethod(item.method))
        : item.type === 'websocket'
          ? h('span.method.tree-method', { dataset: { m: 'WS' } }, 'WS')
          : item.type === 'collection'
          ? icon('collections', 15)
          : icon(open ? 'folderOpen' : 'folder', 15);
    const chevron = isContainer
      ? h('span.tree-chevron', { 'aria-hidden': 'true', onclick: (e) => { e.stopPropagation(); this.#toggle(item.id); } }, icon(open ? 'chevronDown' : 'chevronRight', 14))
      : h('span.tree-chevron.blank', { 'aria-hidden': 'true' });
    const more = h('button.icon-btn.sm.tree-more', { type: 'button', tabindex: '-1', 'aria-label': `Actions for ${item.name}` }, icon('more', 15));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      showMenu(this.#itemMenu(item, collection), { anchor: more, align: 'end', label: `${item.name} actions` });
    });
    // The focused and selected rows are where clicks and keys go next: never lazy.
    const row = h(
      lazy && item.id !== this.focusedId && item.id !== this.selectedId ? 'div.tree-row.lazy' : 'div.tree-row',
      {
        role: 'treeitem',
        'aria-level': String(level),
        'aria-expanded': isContainer ? String(open) : null,
        'aria-selected': String(item.id === this.selectedId),
        tabindex: item.id === this.focusedId ? '0' : '-1',
        draggable: item.type === 'collection' || readOnly(collection) ? 'false' : 'true',
        dataset: { id: item.id, type: item.type },
        style: { '--level': level - 1 },
        title: item.type === 'request' && item.url ? `${item.method} ${item.url}` : item.type === 'websocket' && item.url ? `WebSocket ${item.url}` : item.name,
      },
      chevron,
      h('span.tree-lead', lead),
      h('span.tree-name', item.name),
      item.type === 'collection' && item.shared
        ? h('span.tree-badge', { title: `Shared by ${item.shared.owner}${['write', 'manage'].includes(item.shared.mode) ? '' : ', view only'}` }, icon(['write', 'manage'].includes(item.shared.mode) ? 'users' : 'lock', 13), h('span.sr-only', ['write', 'manage'].includes(item.shared.mode) ? `, shared by ${item.shared.owner}` : `, shared by ${item.shared.owner}, view only`))
        : null,
      more,
    );
    row.addEventListener('click', () => {
      this.focusedId = item.id;
      // A single click previews and keeps focus in the tree, so arrow keys carry on from here;
      // a double click (or a tap on phones, where the drawer closes) moves into the tab.
      if (isLeaf) app.openTab(item.type, item.id, { preview: true, focus: app.compact });
      else if (app.compact) {
        // On small screens a tap expands or collapses; settings open from the menu.
        this.#toggle(item.id);
      } else {
        this.#toggle(item.id, true);
        app.openTab(item.type, item.id, { preview: true, focus: false });
      }
    });
    row.addEventListener('dblclick', () => {
      if (isLeaf) app.openTab(item.type, item.id);
    });
    row.addEventListener('contextmenu', (e) => contextMenu(e, this.#itemMenu(item, collection), { label: `${item.name} actions` }));
    this.#wireDrag(row, item, collection);
    return row;
  }

  #toggle(id, open = !this.expanded.has(id)) {
    if (open) this.expanded.add(id);
    else this.expanded.delete(id);
    this.saveExpanded();
    this.focusedId = id;
    if (!this.#toggleRows(id, open)) this.render();
    this.body.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus();
  }

  /**
   * Shows or hides the rows inside a collection or folder without rebuilding
   * the whole tree. False when the tree has to be rebuilt instead (filtering,
   * or the row is not on screen).
   */
  #toggleRows(id, open) {
    if (this.section !== 'collections' || (this.filter.collections || '').trim()) return false;
    const row = this.body.querySelector(`.tree > [role="treeitem"][data-id="${CSS.escape(id)}"]`);
    const loc = row && this.ws.locate(id);
    if (!loc) return false;
    for (const r of row.parentElement.querySelectorAll('[role="treeitem"][tabindex="0"]')) r.tabIndex = -1;
    if (row.getAttribute('aria-expanded') === String(open)) {
      row.tabIndex = 0;
      return true;
    }
    const level = Number(row.getAttribute('aria-level'));
    while (Number(row.nextElementSibling?.getAttribute('aria-level')) > level) row.nextElementSibling.remove();
    const parents = [...loc.parents, loc.item];
    const collection = parents[0];
    const rows = [];
    // The rows open under the row toggled, which is in view.
    const near = Math.ceil(this.body.clientHeight / 30) + 10;
    const visit = (node, lvl, chain) => {
      for (const item of node.items || []) {
        rows.push(this.#treeRow({ item, level: lvl, parents: chain, collection }, false, rows.length > near));
        if (item.type === 'folder' && this.expanded.has(item.id)) visit(item, lvl + 1, [...chain, item]);
      }
    };
    if (open) visit(loc.item, level + 1, parents);
    row.replaceWith(this.#treeRow({ item: loc.item, level, parents: loc.parents, collection }, false), ...rows);
    return true;
  }

  #itemMenu(item, collection) {
    const app = this.app;
    const cid = collection.id;
    const dialogs = () => import('./dialogs.js');
    if (readOnly(collection)) {
      const copy = { label: 'Duplicate to my collections', icon: 'copy', run: () => this.#duplicate(collection.id) };
      if (item.type === 'request' || item.type === 'websocket') {
        return [
          { label: 'Open in new tab', icon: 'externalLink', run: () => app.openTab(item.type, item.id) },
          item.type === 'request' ? { label: 'Copy as cURL', icon: 'terminal', run: () => this.#copyCurl(item) } : null,
          copy,
        ];
      }
      return [
        { label: item.type === 'collection' ? 'Run collection' : 'Run folder', icon: 'play', run: () => app.runCollection(item.id) },
        { label: 'Open settings', icon: 'settings', run: () => app.openTab(item.type, item.id) },
        copy,
        item.type === 'collection' ? '-' : null,
        item.type === 'collection' ? { label: 'Remove from my list', icon: 'leave', danger: true, run: () => app.leaveShared(item.id) } : null,
      ];
    }
    if (item.type === 'websocket') {
      return [
        { label: 'Open in new tab', icon: 'externalLink', run: () => app.openTab('websocket', item.id) },
        { label: 'Rename', icon: 'pencil', kbd: 'F2', run: () => app.renameItem(item.id) },
        { label: 'Duplicate', icon: 'copy', kbd: shortcut('Mod+D'), run: () => this.#duplicate(item.id) },
        { label: 'Move to...', icon: 'folder', run: () => app.moveItemTo(item.id) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, kbd: 'Del', run: () => app.deleteItem(item.id) },
      ];
    }
    if (item.type === 'request') {
      return [
        { label: 'Open in new tab', icon: 'externalLink', run: () => app.openTab('request', item.id) },
        { label: 'Rename', icon: 'pencil', kbd: 'F2', run: () => app.renameItem(item.id) },
        { label: 'Duplicate', icon: 'copy', kbd: shortcut('Mod+D'), run: () => this.#duplicate(item.id) },
        { label: 'Move to...', icon: 'folder', run: () => app.moveItemTo(item.id) },
        { label: 'Copy as cURL', icon: 'terminal', run: () => this.#copyCurl(item) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, kbd: 'Del', run: () => app.deleteItem(item.id) },
      ];
    }
    return [
      { label: 'Add request', icon: 'plus', run: () => app.addRequestTo(cid, item.id) },
      { label: 'Add WebSocket', icon: 'plug', run: () => app.addWebSocketTo(cid, item.id) },
      { label: 'Add folder', icon: 'folderPlus', run: () => app.addFolderTo(cid, item.id) },
      { label: item.type === 'collection' ? 'Run collection' : 'Run folder', icon: 'play', run: () => app.runCollection(item.id) },
      '-',
      { label: 'Open settings', icon: 'settings', run: () => app.openTab(item.type, item.id) },
      { label: 'Rename', icon: 'pencil', kbd: 'F2', run: () => app.renameItem(item.id) },
      { label: 'Duplicate', icon: 'copy', kbd: shortcut('Mod+D'), run: () => this.#duplicate(item.id) },
      item.type === 'folder' ? { label: 'Move to...', icon: 'folder', run: () => app.moveItemTo(item.id) } : null,
      item.type === 'collection' ? { label: 'Export', icon: 'download', run: () => dialogs().then((m) => m.openExportDialog(app, { collectionId: item.id })) } : null,
      item.type === 'collection' && !item.shared ? { label: 'Share...', icon: 'share', run: () => app.shareCollection(item.id) } : null,
      '-',
      item.type === 'collection' && item.shared
        ? { label: 'Remove from my list', icon: 'leave', danger: true, run: () => app.leaveShared(item.id) }
        : { label: 'Delete', icon: 'trash', danger: true, kbd: 'Del', run: () => app.deleteItem(item.id) },
    ];
  }

  async #duplicate(id) {
    const loc = this.ws.locate(id);
    if (!loc) return;
    const copy = loc.item.type === 'collection' ? await this.ws.duplicateCollection(id) : await this.ws.duplicateItem(id);
    if (copy) {
      this.focusedId = copy.id;
      this.reveal(copy.id);
      announce(`Duplicated ${loc.item.name}`);
    }
  }

  async #copyCurl(item) {
    const loc = this.ws.locate(item.id);
    const { generateCode } = await import('../core/codegen.js');
    const vars = this.app.varsFor(loc.collection.id);
    const { resolved } = resolveRequest(item, { parents: loc.parents, resolver: { resolve: vars.resolve } });
    try {
      await navigator.clipboard.writeText(generateCode('curl', resolved));
      toast({ kind: 'success', title: 'Copied as cURL' });
    } catch {
      toast({ kind: 'error', title: 'Could not copy to the clipboard' });
    }
  }

  #treeKey(e) {
    const rows = [...this.body.querySelectorAll('[role="treeitem"]')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    const row = rows[i];
    const id = row.dataset.id;
    const type = row.dataset.type;
    const focusRow = (r) => {
      if (!r) return;
      this.focusedId = r.dataset.id;
      rows.forEach((x) => x.setAttribute('tabindex', x === r ? '0' : '-1'));
      r.focus();
      r.scrollIntoView({ block: 'nearest' });
    };
    const mod = modKey(e);
    // Rename, delete and duplicate cannot change a view-only collection; removing the collection itself from the list still works.
    const loc = this.ws.locate(id);
    const editKey = e.key === 'F2' || ((e.key === 'Delete' || e.key === 'Backspace') && type !== 'collection') || (mod && e.code === 'KeyD' && type !== 'collection');
    if (editKey && readOnly(loc?.collection)) {
      e.preventDefault();
      toast({ kind: 'warning', title: 'View only', text: `"${loc.collection.name}" is shared with you as view only.` });
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        focusRow(rows[i + 1]);
        break;
      case 'ArrowUp':
        focusRow(rows[i - 1]);
        break;
      case 'Home':
        focusRow(rows[0]);
        break;
      case 'End':
        focusRow(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (type !== 'request' && type !== 'websocket') {
          if (row.getAttribute('aria-expanded') === 'false') this.#toggle(id, true);
          // To the first child; an empty folder has none, so stay put.
          else if (Number(rows[i + 1]?.getAttribute('aria-level')) === Number(row.getAttribute('aria-level')) + 1) focusRow(rows[i + 1]);
        } else return;
        break;
      case 'ArrowLeft':
        if (type !== 'request' && type !== 'websocket' && row.getAttribute('aria-expanded') === 'true' && !this.filter.collections) this.#toggle(id, false);
        else {
          const level = Number(row.getAttribute('aria-level'));
          for (let j = i - 1; j >= 0; j--) {
            if (Number(rows[j].getAttribute('aria-level')) < level) {
              focusRow(rows[j]);
              break;
            }
          }
        }
        break;
      case 'Enter':
      case ' ':
        if (type === 'request' || type === 'websocket') this.app.openTab(type, id, { focus: e.key === 'Enter' });
        else this.#toggle(id);
        break;
      case 'F2':
        this.restoreFocus = true;
        this.app.renameItem(id);
        break;
      case 'Delete':
      case 'Backspace': {
        // If it goes, focus moves to the next row outside it (or the one before), not the top of the tree.
        const level = Number(row.getAttribute('aria-level'));
        const after = rows.slice(i + 1).find((r) => Number(r.getAttribute('aria-level')) <= level);
        this.focusAfterDelete = (after || rows[i - 1])?.dataset.id || null;
        this.focusedId = id;
        this.restoreFocus = true;
        Promise.resolve(this.app.deleteItem(id)).finally(() => {
          if (this.ws.locate(id)) this.focusAfterDelete = null; // Cancelled.
        });
        break;
      }
      case 'ContextMenu':
        this.#openRowMenu(row);
        break;
      default:
        if (e.key === 'F10' && e.shiftKey) {
          this.#openRowMenu(row);
          break;
        }
        if (mod && e.code === 'KeyD') {
          this.restoreFocus = true;
          this.#duplicate(id);
          break;
        }
        if (e.key.length === 1 && !mod && !e.altKey) {
          const ch = e.key.toLowerCase();
          const order = [...rows.slice(i + 1), ...rows.slice(0, i + 1)];
          const hit = order.find((r) => r.querySelector('.tree-name').textContent.toLowerCase().startsWith(ch));
          focusRow(hit);
          break;
        }
        return;
    }
    e.preventDefault();
  }

  #openRowMenu(row) {
    const loc = this.ws.locate(row.dataset.id);
    if (!loc) return;
    showMenu(this.#itemMenu(loc.item, loc.collection), { anchor: row, label: `${loc.item.name} actions` });
  }

  #wireDrag(row, item, collection) {
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-item', item.id);
      this.dragging = item.id;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      this.dragging = null;
      row.classList.remove('dragging');
      this.#clearDrop();
    });
    row.addEventListener('dragover', (e) => {
      if (!this.dragging || this.dragging === item.id) return;
      const zone = this.#dropZone(e, row, item);
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      this.#clearDrop();
      row.classList.add(`drop-${zone}`);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-into'));
    row.addEventListener('drop', async (e) => {
      const id = e.dataTransfer.getData('text/x-item');
      const zone = this.#dropZone(e, row, item);
      this.#clearDrop();
      if (!id || !zone || id === item.id) return;
      e.preventDefault();
      let ok;
      if (zone === 'into') {
        ok = await this.ws.moveItem(id, collection.id, item.id, -1);
        this.expand(item.id);
      } else {
        const loc = this.ws.locate(item.id);
        ok = await this.ws.moveItem(id, collection.id, loc.parent.id, loc.index + (zone === 'after' ? 1 : 0));
      }
      if (ok === false) toast({ kind: 'warning', title: 'A folder cannot be moved into itself' });
      else announce('Moved');
    });
  }

  #dropZone(e, row, item) {
    const owner = item.type === 'collection' ? item : this.ws.locate(item.id)?.collection;
    if (readOnly(owner)) return null;
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (item.type === 'collection') return 'into';
    if (item.type === 'folder') return y < 0.25 ? 'before' : y > 0.75 && !this.expanded.has(item.id) ? 'after' : 'into';
    return y < 0.5 ? 'before' : 'after'; // requests and WebSocket requests
  }

  #clearDrop() {
    for (const el of this.body.querySelectorAll('.drop-before, .drop-after, .drop-into')) el.classList.remove('drop-before', 'drop-after', 'drop-into');
  }

  // Environments --------------------------------------------------------------

  #renderEnvironments() {
    const app = this.app;
    fill(this.actionsEl, h('button.icon-btn.sm', { type: 'button', 'aria-label': 'New environment', title: 'New environment', onclick: () => app.createEnvironment() }, icon('plus', 16)));
    const q = (this.filter.environments || '').trim().toLowerCase();
    const envs = this.ws.environments.filter((e) => !q || e.name.toLowerCase().includes(q));
    const row = (env, { globals = false } = {}) => {
      const active = !globals && env.id === app.environmentId;
      const id = globals ? 'globals' : env.id;
      const count = env.variables.filter((v) => v.key).length;
      const more = h('button.icon-btn.sm.tree-more', { type: 'button', tabindex: '-1', 'aria-label': `Actions for ${env.name}` }, icon('more', 15));
      const items = () =>
        globals
          ? [{ label: 'Open', icon: 'externalLink', run: () => app.openTab('environment', 'globals') }]
          : [
              active ? { label: 'Deactivate', icon: 'circleSlash', run: () => app.setEnvironment(null) } : { label: 'Set as active', icon: 'circleCheck', run: () => app.setEnvironment(env.id) },
              { label: 'Open', icon: 'externalLink', run: () => app.openTab('environment', env.id) },
              { label: 'Duplicate', icon: 'copy', run: () => this.ws.duplicateEnvironment(env.id) },
              { label: 'Export', icon: 'download', run: () => import('./dialogs.js').then((m) => m.openExportDialog(app, { environmentId: env.id })) },
              '-',
              { label: 'Delete', icon: 'trash', danger: true, run: () => app.deleteEnvironment(env.id) },
            ];
      menuButton(more, items, { align: 'end', label: `${env.name} actions` });
      const el = h(
        `div.side-row${id === this.selectedId ? '.selected' : ''}`,
        { dataset: { id } },
        h(
          'button.side-row-main',
          { type: 'button', onclick: () => app.openTab('environment', id, { preview: true }), ondblclick: () => app.openTab('environment', id) },
          globals ? icon('globe', 15) : h('span.env-check', { 'aria-hidden': 'true' }, active ? icon('circleCheck', 15) : icon('circle', 15)),
          h('span.side-row-name', env.name),
          active ? h('span.badge.active-badge', 'Active') : null,
          h('span.side-row-meta', `${count} var${count === 1 ? '' : 's'}`),
        ),
        more,
      );
      el.addEventListener('contextmenu', (e) => contextMenu(e, items(), { label: `${env.name} actions` }));
      return el;
    };
    fill(
      this.body,
      h(
        'div.side-list',
        row(this.ws.globals, { globals: true }),
        h('div.side-divider', { role: 'presentation' }),
        envs.length
          ? envs.map((e) => row(e))
          : h(
              'div.empty.compact',
              h('p', q ? `No environment matches "${this.filter.environments}".` : 'Environments hold sets of variables, like a base URL and keys for development or production.'),
              q ? null : h('button.btn.sm', { type: 'button', onclick: () => app.createEnvironment() }, icon('plus', 14), 'New environment'),
            ),
      ),
    );
  }

  // History -------------------------------------------------------------------

  #renderHistory() {
    const app = this.app;
    const clear = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Clear history', title: 'Clear history', disabled: !this.ws.history.length }, icon('trash', 15));
    clear.addEventListener('click', async () => {
      if (await confirmDialog({ title: 'Clear history?', message: 'Every request in your history will be removed. Saved requests are not affected.', confirmLabel: 'Clear history', danger: true })) {
        await this.ws.clearHistory();
      }
    });
    fill(this.actionsEl, clear);
    const q = (this.filter.history || '').trim().toLowerCase();
    const entries = this.ws.history.filter((e) => !q || e.request.url.toLowerCase().includes(q) || e.request.method.toLowerCase() === q || e.request.name.toLowerCase().includes(q));
    if (!entries.length) {
      fill(
        this.body,
        h('div.empty', icon('history', 28), h('p.empty-title', q ? 'No matches' : 'No history yet'), h('p', q ? `Nothing in your history matches "${this.filter.history}".` : 'Requests you send appear here, so you can open them again.')),
      );
      return;
    }
    const groups = new Map();
    const limit = q ? 500 : 300;
    for (const e of entries.slice(0, limit)) {
      const day = relativeDay(e.at);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(e);
    }
    const open = (entry, pinned) => app.openHistory(entry, { preview: !pinned });
    const list = h(
      'div.history',
      [...groups].map(([day, items]) =>
        h(
          'section.history-group',
          h('h3.history-day', day),
          h(
            'ul.history-list',
            { role: 'list' },
            items.map((entry) => {
              const status = entry.response?.status;
              const more = h('button.icon-btn.sm.tree-more', { type: 'button', tabindex: '-1', 'aria-label': 'Actions for history entry' }, icon('more', 15));
              const items2 = () => [
                { label: 'Open in new tab', icon: 'externalLink', run: () => open(entry, true) },
                {
                  label: 'Save to collection',
                  icon: 'save',
                  run: async () => {
                    const tab = app.openTab('request', null, { draft: normalizeRequest(cloneWithNewIds(entry.request)) });
                    // The tab is only there to be saved: cancelling takes it away again.
                    if (!(await app.saveTabAs(tab))) app.closeTab(tab.id, { force: true });
                  },
                },
                { label: 'Copy URL', icon: 'link', run: () => navigator.clipboard?.writeText(entry.request.url) },
                '-',
                { label: 'Delete', icon: 'trash', danger: true, run: () => this.ws.deleteHistory([entry.id]) },
              ];
              menuButton(more, items2, { align: 'end', label: 'History entry actions' });
              const li = h(
                'li.history-row',
                h(
                  'button.history-main',
                  { type: 'button', onclick: () => open(entry, false), ondblclick: () => open(entry, true), title: `${entry.request.method} ${entry.request.url}` },
                  h('span.method.tree-method', { dataset: { m: entry.request.method } }, shortMethod(entry.request.method)),
                  h('span.history-url', displayUrl(entry.request.url) || entry.request.name),
                  h(
                    'span.history-meta',
                    status ? h('span.history-status', { dataset: { class: statusClass(status) } }, String(status)) : entry.error ? h('span.history-status', { dataset: { class: 'server' } }, 'Error') : null,
                    h('span', timeOfDay(entry.at)),
                  ),
                ),
                more,
              );
              li.addEventListener('contextmenu', (e) => contextMenu(e, items2(), { label: 'History entry actions' }));
              return li;
            }),
          ),
        ),
      ),
      entries.length > limit ? h('p.history-more', `Showing the latest ${limit} of ${entries.length}. Filter to find older requests.`) : null,
    );
    fill(this.body, list);
    this.historyDay = new Date().toDateString();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    clearTimeout(this.dayTimer);
    this.dayTimer = setTimeout(() => this.#refreshDay(), midnight - Date.now() + 1000);
  }

  #refreshDay() {
    if (this.section === 'history' && this.historyDay && this.historyDay !== new Date().toDateString()) this.render();
  }
}

function readOnly(collection) {
  return !!collection?.shared && !['write', 'manage'].includes(collection.shared.mode);
}

function hasMatchingFolder(node, q) {
  for (const item of node.items || []) {
    if (item.type === 'folder' && (item.name.toLowerCase().includes(q) || hasMatchingFolder(item, q))) return true;
  }
  return false;
}
