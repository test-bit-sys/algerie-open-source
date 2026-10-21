/**
 * The sidebar: workspace menu, search, home, favorites, shared spaces,
 * private pages and trash. Page lists are ARIA trees with a single tab
 * stop; arrow keys move, Right and Left expand and collapse, Enter opens,
 * F2 renames, Delete moves to the trash, and Shift+F10 opens a row's menu.
 * Rows can be dragged to reorder or nest them.
 */
import { h, modLabel, announce } from '../lib/dom.js';
import { icon, pageIcon } from '../lib/icons.js';
import { childrenOf, getPage, displayTitle, movePage, wouldCycle, isTrashed, updatePage } from '../data/tree.js';
import { prefs, setPref } from './prefs.js';
import { openMenu } from './menu.js';
import { avatar } from './avatar.js';

export class Sidebar {
  constructor(app) {
    this.app = app;
    this.ws = app.ws;
    this.el = h('aside.sidebar', { 'aria-label': 'Sidebar' });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.renderSoon = () => {
      if (this.queued) return;
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        this.render();
      });
    };
    this.watched = new Map();
  }

  /** Re-renders when any space's tree changes. */
  watch() {
    for (const space of this.ws.allSpaces()) {
      if (!space.tree || this.watched.get(space.id) === space.tree) continue;
      this.watched.set(space.id, space.tree);
      space.tree.getMap('pages').observeDeep(() => {
        this.renderSoon();
        this.ws.syncRoomTitle(space);
      });
    }
  }

  expanded(spaceId, pageId) {
    return !!prefs().expanded[`${spaceId}|${pageId}`];
  }

  setExpanded(spaceId, pageId, on) {
    const map = { ...prefs().expanded };
    if (on) map[`${spaceId}|${pageId}`] = true;
    else delete map[`${spaceId}|${pageId}`];
    setPref('expanded', map);
  }

  /** Expands every page above the current one so it is visible. */
  reveal(space, pageId) {
    let p = getPage(space.tree, pageId);
    let changed = false;
    while (p?.parent) {
      if (!this.expanded(space.id, p.parent)) {
        this.setExpanded(space.id, p.parent, true);
        changed = true;
      }
      p = getPage(space.tree, p.parent);
    }
    if (changed) this.render();
  }

  render() {
    // A rename in progress is not interrupted; the sidebar catches up after.
    if (this.el.querySelector('.row-rename') === document.activeElement && document.activeElement) {
      this.renderAfterRename = true;
      return;
    }
    this.watch();
    const focusKey = document.activeElement?.closest?.('.sidebar [data-key]')?.dataset.key;
    const ws = this.ws;
    const user = this.app.user;
    const collapsed = prefs().sectionsCollapsed || {};
    const workspaceBtn = h(
      'button.ws-button',
      { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => this.app.openAccountMenu(e.currentTarget) },
      this.app.avatarEl(22),
      h('span.ws-name', user?.username && !(user.sandbox && user.username === 'you') ? `${user.username}’s wiki` : 'My wiki'),
      icon('chevronDown', 14, { cls: 'ws-caret' }),
    );
    const head = h(
      'div.sidebar-head',
      workspaceBtn,
      h('button.icon-btn.sidebar-close', { type: 'button', 'aria-label': 'Close sidebar', 'data-tip': 'Close sidebar', 'data-shortcut': `${modLabel}\\`, onclick: () => this.app.toggleSidebar(false) }, icon('chevronsLeft', 18)),
    );
    const nav = h(
      'nav.sidebar-nav',
      { 'aria-label': 'Workspace' },
      this.navItem('search', 'Search', () => this.app.openSearch(), `${modLabel}K`),
      this.navItem('home', 'Home', () => this.app.go('home'), null, this.app.route?.view === 'home'),
      this.navItem('filePlus', 'New page', () => this.app.newPage(), `${modLabel}Alt+N`),
    );
    const sections = [];
    const favs = ws.favorites.map((f) => ({ space: ws.space(f.space), page: f.page })).filter((f) => f.space?.tree && getPage(f.space.tree, f.page) && !isTrashed(f.space.tree, f.page));
    if (favs.length) {
      sections.push(
        this.section('favorites', 'Favorites', collapsed.favorites, null, () => h('div.tree', { role: 'tree', 'aria-label': 'Favorites' }, ...favs.map((f) => this.item(f.space, getPage(f.space.tree, f.page), 1, 'fav')))),
      );
    }
    const shared = ws.sharedSpaces();
    const pendingRooms = ws.rooms.filter((r) => !ws.space(r.room)?.tree);
    if (shared.length || pendingRooms.length) {
      sections.push(
        this.section('shared', 'Shared', collapsed.shared, null, () =>
          h(
            'div.tree',
            { role: 'tree', 'aria-label': 'Shared pages' },
            ...shared.flatMap((space) => childrenOf(space.tree).map((p) => this.item(space, p, 1, 'tree'))),
            ...pendingRooms.map((r) => this.pendingRoom(r)),
          ),
        ),
      );
    }
    const privatePages = childrenOf(ws.personal.tree);
    sections.push(
      this.section(
        'private',
        'Private',
        collapsed.private,
        h('button.icon-btn.section-add', { type: 'button', 'aria-label': 'Add a private page', 'data-tip': 'Add a page', onclick: () => this.app.newPage() }, icon('plus', 16)),
        () =>
          privatePages.length
            ? h('div.tree', { role: 'tree', 'aria-label': 'Private pages' }, ...privatePages.map((p) => this.item(ws.personal, p, 1, 'tree')))
            : h('button.tree-empty', { type: 'button', onclick: () => this.app.newPage() }, icon('plus', 15), 'Add a page'),
      ),
    );
    const foot = h(
      'div.sidebar-foot',
      this.navItem('layoutTemplate', 'Templates', () => this.app.openTemplates()),
      this.navItem('fileUp', 'Import', () => this.app.importMarkdown()),
      this.navItem('trash', 'Trash', (e) => this.app.openTrash(e.currentTarget)),
      this.navItem('settings', 'Settings', () => this.app.openSettings()),
      h('a.powered', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Powered by Puter'),
    );
    const resizer = this.el.querySelector('.sidebar-resizer');
    this.el.replaceChildren(head, nav, h('div.sidebar-scroll', ...sections), foot);
    if (resizer) this.el.append(resizer);
    this.fixTabStops();
    const target = (focusKey && this.el.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)) || (this.focusAfter && this.el.querySelector(`[data-key="${CSS.escape(this.focusAfter)}"]`));
    if (target && (focusKey || this.focusAfter)) {
      for (const r of this.el.querySelectorAll('.tree-row')) r.tabIndex = -1;
      if (target.classList.contains('tree-row')) target.tabIndex = 0;
      target.focus({ preventScroll: true });
    }
    this.focusAfter = null;
  }

  navItem(ic, label, run, shortcut = null, current = false) {
    const b = h('button.nav-item', { type: 'button', 'aria-current': current ? 'page' : null, 'data-key': `nav-${label}` }, icon(ic, 17), h('span', label), shortcut ? h('kbd.nav-kbd', shortcut) : null);
    b.addEventListener('click', run);
    return b;
  }

  section(key, label, collapsed, extra, body) {
    const toggle = h('button.section-toggle', { type: 'button', 'aria-expanded': String(!collapsed), 'data-key': `sec-${key}` }, h('span', label), icon('chevronDown', 13, { cls: 'section-caret' }));
    toggle.addEventListener('click', () => {
      const map = { ...(prefs().sectionsCollapsed || {}) };
      map[key] = !collapsed;
      setPref('sectionsCollapsed', map);
      this.render();
    });
    return h(`section.side-section${collapsed ? '.collapsed' : ''}`, { 'aria-label': label }, h('div.section-head', toggle, extra), collapsed ? null : body());
  }

  pendingRoom(entry) {
    const lost = !!entry.lost;
    const row = h(
      'div.tree-row.pending',
      { role: 'treeitem', 'aria-level': 1, tabindex: '-1', 'data-key': `room-${entry.room}`, 'aria-disabled': 'true', title: lost ? entry.lost : 'Connecting...' },
      h(
        'div.row-inner',
        { style: { '--depth': 0 } },
        h('span.row-toggle.spacer'),
        lost ? icon('triangleAlert', 16, { cls: 'warn' }) : h('span.spinner.small', { 'aria-hidden': 'true' }),
        h('span.row-title', entry.title || 'Shared space'),
        h('span.row-actions', h('button.icon-btn.row-btn', { type: 'button', tabindex: '-1', 'aria-label': 'Options', onclick: (e) => {
            e.stopPropagation();
            openMenu(e.currentTarget, [
              { label: 'Try again', icon: 'refresh', run: () => this.ws.openRoom(entry).catch((err) => this.app.toast(err.message, { kind: 'error' })) },
              { label: 'Remove from sidebar', icon: 'x', danger: true, run: () => this.ws.leaveRoom(entry.room) },
            ], { label: 'Shared space' });
          } }, icon('more', 16))),
      ),
    );
    return row;
  }

  item(space, page, level, kind) {
    const kids = kind === 'fav' && level > 1 ? childrenOf(space.tree, page.id) : childrenOf(space.tree, page.id);
    const key = `${kind}|${space.id}|${page.id}`;
    const open = kids.length > 0 && this.expanded(space.id, `${kind === 'fav' ? 'f:' : ''}${page.id}`);
    const current = this.app.route?.space === space.id && this.app.route?.page === page.id;
    const title = displayTitle(page);
    const toggle = h('button.row-toggle', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', disabled: !kids.length }, kids.length ? icon('chevronRight', 14) : null);
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle(row, space, page, kind);
    });
    const more = h('button.icon-btn.row-btn', { type: 'button', tabindex: '-1', 'aria-label': `Options for ${title}`, 'data-tip': 'Delete, duplicate and more' }, icon('more', 16));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.openPageMenu(more, space, page.id, { fromSidebar: true });
    });
    const add = space.canEdit ? h('button.icon-btn.row-btn', { type: 'button', tabindex: '-1', 'aria-label': `Add a page inside ${title}`, 'data-tip': 'Add a page inside' }, icon('plus', 16)) : null;
    add?.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.setExpanded(space.id, page.id, true);
      this.app.newPage(space, page.id);
    });
    const sharedBadge = space.kind === 'shared' && level === 1 && kind === 'tree' ? h('span.row-badge', { title: space.role === 'owner' ? 'Shared by you' : `Shared by ${space.owner || 'someone'}` }, icon('users', 13)) : null;
    const row = h(
      `div.tree-row${current ? '.current' : ''}`,
      {
        role: 'treeitem',
        'aria-level': level,
        'aria-expanded': kids.length ? String(open) : null,
        'aria-selected': String(current),
        'aria-label': title,
        'aria-current': current ? 'page' : null,
        tabindex: '-1',
        'data-key': key,
        'data-space': space.id,
        'data-page': page.id,
        'data-kind': kind,
      },
      h('div.row-inner', { style: { '--depth': level - 1 } }, toggle, pageIcon(page, 16), h('span.row-title', title), sharedBadge, h('span.row-actions', more, add)),
    );
    row.querySelector('.row-inner').addEventListener('click', () => this.app.open(space, page.id));
    row.querySelector('.row-inner').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.app.openPageMenu({ x: e.clientX, y: e.clientY }, space, page.id, { fromSidebar: true });
    });
    if (open) row.append(h('div', { role: 'group' }, ...kids.map((k) => this.item(space, k, level + 1, kind))));
    return row;
  }

  toggle(row, space, page, kind) {
    const key = `${kind === 'fav' ? 'f:' : ''}${page.id}`;
    this.setExpanded(space.id, key, !this.expanded(space.id, key));
    this.render();
  }

  rows() {
    return [...this.el.querySelectorAll('.tree-row')].filter((r) => !r.closest('[role="group"]')?.closest('.tree-row:not([aria-expanded="true"])'));
  }

  fixTabStops() {
    const rows = this.rows();
    const current = rows.find((r) => r.classList.contains('current')) || rows[0];
    for (const r of rows) r.tabIndex = r === current ? 0 : -1;
  }

  onKey(e) {
    const row = e.target.closest?.('.tree-row');
    if (!row || e.target !== row) return;
    const rows = this.rows();
    const i = rows.indexOf(row);
    const go = (r) => {
      if (!r) return;
      for (const x of rows) x.tabIndex = -1;
      r.tabIndex = 0;
      r.focus();
    };
    const space = this.ws.space(row.dataset.space);
    const pageId = row.dataset.page;
    const kind = row.dataset.kind;
    const expanded = row.getAttribute('aria-expanded');
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        // Alt+Shift+arrows reorder the page among its siblings.
        if (e.altKey && e.shiftKey && kind === 'tree') this.moveSibling(space, pageId, e.key === 'ArrowUp' ? -1 : 1);
        else go(rows[i + (e.key === 'ArrowDown' ? 1 : -1)]);
        break;
      case 'Home':
        e.preventDefault();
        go(rows[0]);
        break;
      case 'End':
        e.preventDefault();
        go(rows.at(-1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (expanded === 'false') this.toggleKeyed(space, pageId, kind, true);
        else if (expanded === 'true') go(row.querySelector('[role="group"] .tree-row'));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (expanded === 'true') this.toggleKeyed(space, pageId, kind, false);
        else go(row.parentElement.closest('.tree-row'));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (space && pageId) this.app.open(space, pageId);
        break;
      case 'F2':
        e.preventDefault();
        if (space?.canEdit) this.rename(row, space, pageId);
        break;
      case 'Delete':
      case 'Backspace':
        if (space?.canEdit && pageId) {
          e.preventDefault();
          // Focus moves to the next row (or the one before) after the page goes.
          this.focusAfter = (rows[i + 1] || rows[i - 1])?.dataset.key || null;
          this.app.trashPage(space, pageId);
        }
        break;
      case 'ContextMenu':
        e.preventDefault();
        if (space) this.app.openPageMenu(row.querySelector('.row-btn') || row, space, pageId, { fromSidebar: true });
        break;
      default:
        if (e.key === 'F10' && e.shiftKey && space) {
          e.preventDefault();
          this.app.openPageMenu(row.querySelector('.row-btn') || row, space, pageId, { fromSidebar: true });
        }
    }
  }

  toggleKeyed(space, pageId, kind, on) {
    this.setExpanded(space.id, `${kind === 'fav' ? 'f:' : ''}${pageId}`, on);
    this.render();
    announce(on ? 'Expanded' : 'Collapsed');
  }

  /** Inline rename in the tree (F2 or the menu). */
  /** Moves a page up or down among its siblings (the keyboard way to reorder). */
  moveSibling(space, pageId, dir) {
    const page = getPage(space.tree, pageId);
    if (!page || !space.canEdit) return;
    const sibs = childrenOf(space.tree, page.parent ?? null);
    const i = sibs.findIndex((p) => p.id === pageId);
    const other = sibs[i + dir];
    if (!other) return;
    movePage(space.tree, pageId, page.parent ?? null, dir < 0 ? { before: other.id } : { after: other.id });
    announce(dir < 0 ? 'Moved up' : 'Moved down');
  }

  rename(row, space, pageId) {
    const page = getPage(space.tree, pageId);
    if (!page) return;
    const title = row.querySelector('.row-title');
    const input = h('input.row-rename', { type: 'text', value: page.title || '', 'aria-label': 'Page name', placeholder: 'Untitled' });
    title.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      input.blur();
      if (save) updatePage(space.tree, pageId, { title: input.value.trim().slice(0, 300) }, this.ws.by);
      this.render();
      this.el.querySelector(`.tree-row[data-page="${pageId}"]`)?.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  renameById(space, pageId) {
    this.reveal(space, pageId);
    const row = this.el.querySelector(`.tree-row[data-space="${space.id}"][data-page="${pageId}"][data-kind="tree"]`);
    if (row) this.rename(row, space, pageId);
  }

  /* ---------- drag to reorder and nest ---------- */

  onPointerDown(e) {
    const inner = e.target.closest('.row-inner');
    if (!inner || e.button !== 0 || e.target.closest('button, input') || e.pointerType === 'touch') return;
    const row = inner.parentElement;
    const space = this.ws.space(row.dataset.space);
    if (!space?.canEdit || row.dataset.kind !== 'tree') return;
    const pageId = row.dataset.page;
    const startY = e.clientY;
    const startX = e.clientX;
    let dragging = false;
    let target = null;
    const indicator = h('div.tree-drop', { 'aria-hidden': 'true' });
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      if (!dragging) {
        dragging = true;
        row.classList.add('dragging');
        this.el.classList.add('tree-dragging');
        document.body.append(indicator);
      }
      target = this.dropTarget(ev, space, pageId, indicator);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      indicator.remove();
      row.classList.remove('dragging');
      this.el.classList.remove('tree-dragging');
      for (const r of this.el.querySelectorAll('.drop-inside')) r.classList.remove('drop-inside');
      if (!dragging || !target) return;
      // A click that turned into a drag must not also open the page.
      const swallow = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 50);
      if (target.inside) {
        movePage(space.tree, pageId, target.inside);
        this.setExpanded(space.id, target.inside, true);
      } else movePage(space.tree, pageId, target.parent, target.before ? { before: target.before } : { after: target.after });
      announce('Page moved');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  dropTarget(ev, space, dragId, indicator) {
    for (const r of this.el.querySelectorAll('.drop-inside')) r.classList.remove('drop-inside');
    indicator.hidden = true;
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tree-row[data-kind="tree"]');
    if (!el || el.dataset.space !== space.id) return null;
    const id = el.dataset.page;
    if (id === dragId || wouldCycle(space.tree, dragId, id)) return null;
    const inner = el.querySelector('.row-inner');
    const r = inner.getBoundingClientRect();
    const rel = (ev.clientY - r.top) / r.height;
    const page = getPage(space.tree, id);
    if (rel > 0.28 && rel < 0.72) {
      inner.classList.add('drop-inside');
      el.classList.add('drop-inside');
      return { inside: id };
    }
    // Shared spaces keep a single page at their top level.
    if (space.kind === 'shared' && !page.parent) return null;
    indicator.hidden = false;
    const depth = Number(inner.style.getPropertyValue('--depth')) || 0;
    indicator.style.left = `${r.left + 20 + depth * 14}px`;
    indicator.style.width = `${r.width - 24 - depth * 14}px`;
    indicator.style.top = `${(rel <= 0.28 ? r.top : r.bottom) - 1}px`;
    return rel <= 0.28 ? { parent: page.parent ?? null, before: id } : { parent: page.parent ?? null, after: id };
  }
}

export { avatar };
