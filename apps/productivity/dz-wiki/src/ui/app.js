/**
 * The app shell: sidebar, top bar (breadcrumbs, who is here, save status,
 * share, favorite, page menu) and the open page. Routes live in the URL
 * hash: #/<space>/<page>, or #/home.
 */
import { h, modKey, modLabel, announce, isMac, fill } from '../lib/dom.js';
import { icon, pageIcon } from '../lib/icons.js';
import { getPage, ancestors, displayTitle, updatePage, restorePage, isTrashed, childrenOf, allPages } from '../data/tree.js';
import { listBlocks } from '../data/page.js';
import { isDatabase, listProps, listViews, queryRows, formatValue, cellValue } from '../data/database.js';
import { blocksToMarkdown, blocksToHtml, markdownToBlocks } from '../data/markdown.js';
import { insertBlocks } from '../data/page.js';
import { Sidebar } from './sidebar.js';
import { PageView } from './pageview.js';
import { openMenu } from './menu.js';
import { toast } from './toast.js';
import { confirmDialog } from './dialog.js';
import { prefs, setPref, getTheme, setTheme } from './prefs.js';
import { avatar, personAvatar, setPictureSource } from './avatar.js';
import { openSearch } from './search.js';
import { openShare } from './share.js';
import { openTrash, openSettings, openTemplates, openMoveTo, openShortcuts } from './dialogs.js';
import { HomeView } from './home.js';
import { openHistory } from './history.js';
import { closeAllPopovers, hasOpenPopover } from './popover.js';
import { installTooltips } from './tooltip.js';
import { shareLink } from '../collab/protocol.js';
import { CommentsPanel } from './comments.js';
import { openCount } from '../data/comments.js';

const STATUS = {
  saved: { icon: 'cloudCheck', label: 'Saved' },
  saving: { icon: 'cloud', label: 'Saving...' },
  offline: { icon: 'cloudOff', label: 'Offline. Changes are kept on this device.' },
  error: { icon: 'cloudOff', label: 'Not saved yet. Retrying...' },
};

export class App {
  constructor(root, { ws, user, env, onSignOut = null, picture = null, puter = null }) {
    this.root = root;
    this.ws = ws;
    this.user = user;
    this.env = env;
    this.onSignOut = onSignOut;
    this.picture = picture;
    this.puter = puter;
    this.route = null;
    this.view = null;
    this.mobile = matchMedia('(max-width: 760px)');
  }

  async start() {
    if (this.puter?.auth?.getProfilePicture) setPictureSource((name) => (name === this.user?.username ? this.puter.auth.getProfilePicture() : this.puter.auth.getProfilePicture(name)));
    this.build();
    installTooltips(document);
    this.ws.on('spaces', () => {
      this.sidebar.renderSoon();
      this.updateTopbar();
    });
    this.ws.on('favorites', () => {
      this.sidebar.renderSoon();
      this.updateTopbar();
    });
    this.ws.on('status', (s) => this.showStatus(s));
    this.ws.on('presence', (space) => {
      if (space.id === this.route?.space) this.renderPresence();
    });
    this.ws.on('error', (msg) => this.toast(msg, { kind: 'error' }));
    this.ws.on('reset', (space, id) => {
      // A document went back to the server's copy: reopen what shows it.
      if (id === 'tree') this.sidebar.renderSoon();
      const view = this.view;
      if (!(view instanceof PageView) || view.space !== space) return;
      const page = getPage(space.tree, view.pageId);
      if (id === 'tree' || id === view.pageId || id === `${view.pageId}.c` || id === page?.parent) this.showPage(space, view.pageId, { force: true });
    });
    this.ws.on('lost', (space, err) => {
      this.toast(err.message || 'You no longer have access to a shared space.', { kind: 'error' });
      if (this.route?.space === space.id) this.go('home');
    });
    window.addEventListener('hashchange', () => this.fromHash());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('beforeunload', (e) => {
      if (this.ws.hasUnsaved()) {
        this.ws.flushAll();
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.ws.flushAll();
      else this.ws.personal.refresh();
    });
    window.addEventListener('focus', () => this.ws.personal.refresh());
    this.refreshTimer = setInterval(() => document.visibilityState === 'visible' && this.ws.personal.refresh(), 30000);
    this.mobile.addEventListener('change', () => this.applySidebar());
    this.sidebar.render();
    await this.fromHash();
    this.root.removeAttribute('aria-busy');
    this.ws.ready?.then(() => {
      this.sidebar.renderSoon();
      if (this.route?.missing) this.fromHash();
    });
    // Index pages that were never opened so search covers them.
    this.indexAbort = new AbortController();
    setTimeout(() => this.ws.indexInBackground(this.indexAbort.signal), 4000);
  }

  build() {
    this.sidebar = new Sidebar(this);
    this.resizer = h('div.sidebar-resizer', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize sidebar', tabindex: '0', 'aria-valuemin': 200, 'aria-valuemax': 480 });
    this.resizer.addEventListener('pointerdown', (e) => this.startResize(e));
    this.resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      this.setSidebarWidth(prefs().sidebarWidth + (e.key === 'ArrowRight' ? 16 : -16));
    });
    this.resizer.addEventListener('dblclick', () => this.setSidebarWidth(264));
    this.scrim = h('div.scrim', { onclick: () => this.toggleSidebar(false) });
    this.openBtn = h('button.icon-btn.sidebar-open', { type: 'button', 'aria-label': 'Open sidebar', 'data-tip': 'Open sidebar', 'data-shortcut': `${modLabel}\\`, onclick: () => this.toggleSidebar(true) }, icon('menu', 18));
    this.crumbs = h('nav.crumbs', { 'aria-label': 'Breadcrumb' });
    this.presence = h('div.presence', { 'aria-label': 'People here', role: 'group' });
    this.status = h('div.save-status', { role: 'status', 'aria-live': 'polite' });
    this.shareBtn = h('button.btn.small.share-btn', { type: 'button', onclick: (e) => this.share(e.currentTarget) }, icon('share', 15), h('span', 'Share'));
    this.starBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Add to favorites', 'aria-pressed': 'false', 'data-tip': 'Favorite', onclick: () => this.toggleFavorite() }, icon('star', 17));
    this.commentsBtn = h('button.icon-btn.comments-btn', { type: 'button', 'aria-label': 'Comments', 'aria-pressed': 'false', 'data-tip': 'Comments', onclick: () => this.comments.toggle() }, icon('messageSquare', 17), h('span.comments-count'));
    this.moreBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Page options', 'aria-haspopup': 'menu', 'data-tip': 'Page options', onclick: (e) => this.openPageMenu(e.currentTarget, this.space(), this.route?.page) }, icon('more', 18));
    this.topbar = h('header.topbar', this.openBtn, this.crumbs, h('div.topbar-right', this.presence, this.status, this.shareBtn, this.commentsBtn, this.starBtn, this.moreBtn));
    this.scroll = h('div.page-scroll', { id: 'main-scroll' });
    this.comments = new CommentsPanel(this);
    this.main = h('main.main', { id: 'main', tabindex: '-1' }, this.topbar, h('div.main-body', this.scroll, this.comments.el));
    this.scroll.addEventListener('click', (e) => {
      // A click in the empty space below the content puts the caret at the end.
      if (e.target === this.scroll || e.target.classList.contains('page') || e.target.classList.contains('page-body')) {
        const ed = this.view?.editor;
        const host = this.view?.el.querySelector('.editor-host');
        if (ed && !ed.readOnly && host && e.clientY > host.getBoundingClientRect().bottom - 8) ed.focusEnd();
      }
    });
    this.shell = h('div.app-shell', h('a.skip-link', { href: '#main', onclick: (e) => {
        e.preventDefault();
        this.main.focus();
      } }, 'Skip to page'), this.sidebar.el, this.scrim, this.main);
    // The resize handle lives inside the sidebar landmark, on its right edge.
    this.sidebar.el.append(this.resizer);
    this.root.replaceChildren(this.shell);
    this.applySidebar();
    this.showStatus(this.ws.status());
  }

  /* ---------- sidebar ---------- */

  applySidebar() {
    const p = prefs();
    const mobile = this.mobile.matches;
    const open = mobile ? !!this.drawerOpen : p.sidebarOpen;
    this.shell.classList.toggle('sidebar-hidden', !open);
    this.shell.classList.toggle('mobile', mobile);
    this.shell.style.setProperty('--sidebar-w', `${Math.max(200, Math.min(480, p.sidebarWidth))}px`);
    this.resizer.setAttribute('aria-valuenow', String(p.sidebarWidth));
    this.sidebar.el.toggleAttribute('inert', !open);
    this.openBtn.hidden = open && !mobile;
  }

  toggleSidebar(open) {
    const mobile = this.mobile.matches;
    if (mobile) {
      this.drawerOpen = open ?? !this.drawerOpen;
      this.applySidebar();
      if (this.drawerOpen) this.sidebar.el.querySelector('.tree-row[tabindex="0"], .nav-item')?.focus();
      else this.openBtn.focus();
      return;
    }
    setPref('sidebarOpen', open ?? !prefs().sidebarOpen);
    this.applySidebar();
    if (!prefs().sidebarOpen) this.openBtn.focus();
  }

  setSidebarWidth(w) {
    setPref('sidebarWidth', Math.max(200, Math.min(480, Math.round(w))));
    this.applySidebar();
  }

  startResize(e) {
    e.preventDefault();
    const move = (ev) => this.setSidebarWidth(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.shell.classList.remove('resizing');
    };
    this.shell.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---------- routing ---------- */

  space() {
    return this.route?.space ? this.ws.space(this.route.space) : null;
  }

  go(view) {
    if (view === 'home') location.hash = '#/home';
  }

  /** Opens a page in a space (pushing a history entry). */
  open(space, pageId, opts = {}) {
    if (this.mobile.matches && this.drawerOpen) this.toggleSidebar(false);
    this.pendingOpen = opts;
    const hash = `#/${space.id}/${pageId}${opts.block ? `/${opts.block}` : ''}`;
    if (location.hash === hash) this.fromHash();
    else location.hash = hash;
  }

  /** Opens a page by id, looking in the given space first. */
  openById(pageId, opts = {}, prefer = null) {
    const space = prefer && getPage(prefer.tree, pageId) ? prefer : this.ws.locate(pageId);
    if (!space) return this.toast('That page does not exist or you no longer have access.', { kind: 'error' });
    this.open(space, pageId, opts);
  }

  async fromHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const opts = this.pendingOpen || {};
    this.pendingOpen = null;
    if (parts[0] === 'home' || !parts.length) {
      if (!parts.length) {
        const last = prefs().lastPage;
        const space = last && this.ws.space(last.space);
        if (space?.tree && getPage(space.tree, last.page) && !isTrashed(space.tree, last.page)) {
          history.replaceState(null, '', `#/${space.id}/${last.page}`);
          return this.fromHash();
        }
        const first = childrenOf(this.ws.personal.tree)[0];
        if (first) {
          history.replaceState(null, '', `#/personal/${first.id}`);
          return this.fromHash();
        }
      }
      return this.showHome();
    }
    const [spaceId, pageId, block] = parts;
    const space = this.ws.space(spaceId);
    if (!space?.tree || !getPage(space.tree, pageId)) {
      // A shared space may still be connecting.
      if (!space && this.ws.rooms.some((r) => r.room === spaceId && !r.lost)) {
        this.route = { space: spaceId, page: pageId, missing: true };
        this.showMessage('Opening shared page...', 'Connecting to the shared space.', 'cloud');
        return;
      }
      this.route = { space: spaceId, page: pageId, missing: true };
      this.showMessage('Page not found', 'It may have been deleted, moved, or you no longer have access.', 'fileText');
      return;
    }
    await this.showPage(space, pageId, { ...opts, block });
  }

  clearView() {
    closeAllPopovers();
    this.view?.destroy();
    this.view = null;
    this.comments?.bind(null, null, null);
  }

  showHome() {
    this.clearView();
    this.route = { view: 'home' };
    this.view = new HomeView(this);
    this.scroll.replaceChildren(this.view.el);
    this.view.render();
    this.setDocumentTitle('Home');
    this.updateTopbar();
    this.sidebar.render();
    this.scroll.scrollTop = 0;
  }

  showMessage(title, text, ic) {
    this.clearView();
    this.scroll.replaceChildren(h('div.empty-page', icon(ic, 28), h('h1', title), h('p', text), h('button.btn', { type: 'button', onclick: () => this.go('home') }, 'Go home')));
    this.setDocumentTitle(title);
    this.updateTopbar();
    this.sidebar.render();
  }

  async showPage(space, pageId, opts = {}) {
    if (!opts.force && this.view instanceof PageView && this.view.space === space && this.view.pageId === pageId) {
      if (opts.block) this.view.editor?.els.get(opts.block)?.scrollIntoView({ block: 'center' });
      return;
    }
    this.clearView();
    this.route = { space: space.id, page: pageId };
    const view = new PageView(this, space, pageId, { focusTitle: opts.focusTitle, block: opts.block });
    this.view = view;
    this.scroll.replaceChildren(view.el);
    this.scroll.scrollTop = 0;
    this.setDocumentTitle(displayTitle(getPage(space.tree, pageId)));
    this.updateTopbar();
    this.sidebar.reveal(space, pageId);
    this.sidebar.render();
    setPref('lastPage', { space: space.id, page: pageId });
    this.ws.visited(space, pageId);
    if (space.kind === 'shared') space.setPage(pageId);
    for (const s of this.ws.sharedSpaces()) if (s !== space) s.setPage(null);
    await view.mount();
    if (this.view === view) {
      this.comments.bind(space, pageId, view.commentsDoc);
      if (!view.commentsDoc && this.comments.isOpen) this.comments.close();
      this.updateCommentButton();
    }
    if (this.view === view && !opts.focusTitle && !opts.block) {
      // A brand-new empty page starts in its title; others leave focus alone.
      const page = getPage(space.tree, pageId);
      if (!page?.title && !view.readOnly && view.editor && view.editor.visibleIds().length <= 1) view.focusTitle();
    }
  }

  pageGone(space, pageId) {
    if (this.route?.space !== space.id || this.route?.page !== pageId) return;
    // Moved to another space (shared, or back to private): follow it there.
    const moved = this.ws.locate(pageId);
    if (moved && moved !== space) return this.open(moved, pageId);
    this.toast('This page was deleted or moved.');
    this.go('home');
  }

  setDocumentTitle(t) {
    document.title = `${t} - Wiki`;
    this.puter?.ui?.setWindowTitle?.(`${t} - Wiki`);
  }

  /* ---------- top bar ---------- */

  updateTopbar() {
    const space = this.space();
    const page = space?.tree && this.route?.page ? getPage(space.tree, this.route.page) : null;
    this.crumbs.replaceChildren();
    if (!page) {
      if (this.route?.view === 'home') this.crumbs.append(h('span.crumb.current', icon('home', 15), h('span', 'Home')));
      for (const el of [this.shareBtn, this.starBtn, this.moreBtn, this.commentsBtn]) el.hidden = true;
      this.presence.replaceChildren();
      if (this.comments?.isOpen) this.comments.close();
      return;
    }
    for (const el of [this.shareBtn, this.starBtn, this.moreBtn]) el.hidden = false;
    this.updateCommentButton();
    const chain = ancestors(space.tree, page.id);
    const list = h('ol.crumb-list');
    if (space.kind === 'shared') list.append(h('li.crumb-space', { title: space.role === 'owner' ? 'Shared by you' : `Shared by ${space.owner || 'someone'}` }, icon('users', 14)));
    // Long paths collapse their middle into an ellipsis.
    const show = chain.length > 3 ? [chain[0], null, ...chain.slice(-2)] : chain;
    show.forEach((p, i) => {
      if (!p) {
        const hidden = chain.slice(1, -2);
        const more = h('button.crumb', { type: 'button', 'aria-label': 'Show more of the path' }, '...');
        more.addEventListener('click', () => openMenu(more, hidden.map((x) => ({ label: displayTitle(x), icon: pageIcon(x, 16), run: () => this.open(space, x.id) })), { label: 'Path' }));
        list.append(h('li', more));
        return;
      }
      const last = i === show.length - 1;
      const btn = h(`button.crumb${last ? '.current' : ''}`, { type: 'button', 'aria-current': last ? 'page' : null }, pageIcon(p, 15), h('span', displayTitle(p)));
      btn.addEventListener('click', () => (last ? this.view?.focusTitle?.() : this.open(space, p.id)));
      list.append(h('li', btn));
    });
    this.crumbs.append(list);
    const fav = this.ws.isFavorite(space, page.id);
    this.starBtn.setAttribute('aria-pressed', String(fav));
    this.starBtn.setAttribute('aria-label', fav ? 'Remove from favorites' : 'Add to favorites');
    this.starBtn.classList.toggle('on', fav);
    this.shareBtn.classList.toggle('shared', space.kind === 'shared');
    this.shareBtn.querySelector('span').textContent = space.kind === 'shared' ? 'Shared' : 'Share';
    this.renderPresence();
  }

  updateCommentButton() {
    const doc = this.view?.commentsDoc;
    const n = doc ? openCount(doc) : 0;
    this.commentsBtn.hidden = !doc;
    this.commentsBtn.querySelector('.comments-count').textContent = n ? String(n) : '';
    this.commentsBtn.setAttribute('aria-label', n ? `Comments, ${n} open` : 'Comments');
    this.commentsBtn.setAttribute('aria-pressed', String(!!this.comments?.isOpen));
  }

  updateTopbarSoon() {
    if (this.topbarQueued) return;
    this.topbarQueued = true;
    queueMicrotask(() => {
      this.topbarQueued = false;
      this.updateTopbar();
    });
  }

  renderPresence() {
    const space = this.space();
    if (!space || space.kind !== 'shared') return this.presence.replaceChildren();
    const seen = new Map();
    for (const p of space.roster || []) {
      if (p.uuid === this.user?.uuid || seen.has(p.uuid)) continue;
      seen.set(p.uuid, p);
    }
    const people = [...seen.values()].sort((a, b) => (b.page === this.route.page) - (a.page === this.route.page));
    const max = this.mobile.matches ? 2 : 4;
    fill(
      this.presence,
      ...people.slice(0, max).map((p) => {
        const here = p.page === this.route.page;
        const where = here ? 'on this page' : p.page && getPage(space.tree, p.page) ? `on ${displayTitle(getPage(space.tree, p.page))}` : 'in this space';
        const el = personAvatar(p.username, { size: 26, label: `${p.username}, ${where}` });
        el.classList.toggle('away', !here);
        el.dataset.tip = `${p.username} is ${where}`;
        el.tabIndex = 0;
        return el;
      }),
      people.length > max ? h('span.avatar.more', { style: { '--size': '26px' }, 'aria-label': `${people.length - max} more people` }, `+${people.length - max}`) : null,
    );
  }

  showStatus(status) {
    const s = STATUS[status] || STATUS.saved;
    this.status.replaceChildren(icon(s.icon, 16), h('span.status-text', status === 'saved' ? '' : s.label));
    this.status.dataset.status = status;
    this.status.dataset.tip = s.label;
    this.status.setAttribute('aria-label', s.label);
  }

  toast(message, opts) {
    return toast(message, opts);
  }

  avatarEl(size) {
    return avatar(this.user?.username || 'You', { picture: this.picture, size });
  }

  setPicture(picture) {
    this.picture = picture;
    this.sidebar.renderSoon();
  }

  /* ---------- commands ---------- */

  async newPage(space = this.ws.personal, parent = null, opts = {}) {
    if (!space.canEdit) return this.toast('You can view this space but not add pages to it.');
    // A shared space has one page at its top; everything else goes inside it.
    if (space.kind === 'shared' && !parent) parent = childrenOf(space.tree)[0]?.id || null;
    const id = await this.ws.createPage(space, { parent, ...opts });
    if (parent) this.sidebar.setExpanded(space.id, parent, true);
    this.open(space, id, { focusTitle: true });
    return id;
  }

  async trashPage(space, pageId, { quiet = false } = {}) {
    if (!space?.canEdit) return;
    const page = getPage(space.tree, pageId);
    if (!page) return;
    // The page that holds a shared space cannot go to the trash on its own.
    if (space.kind === 'shared' && !page.parent && childrenOf(space.tree).length <= 1) {
      if (space.canManage) return this.deleteSharedSpace(space);
      return this.toast('Only the owner can delete this shared space.');
    }
    this.ws.trash(space, pageId);
    if (!quiet) {
      this.toast(`Moved ${displayTitle(page)} to the trash`, { action: { label: 'Undo', run: () => restorePage(space.tree, pageId) } });
    }
    if (this.route?.space === space.id && ancestors(space.tree, this.route.page).some((p) => p.id === pageId)) {
      if (page.parent && !isTrashed(space.tree, page.parent)) this.open(space, page.parent);
      else this.go('home');
    }
  }

  restorePage(space, pageId) {
    restorePage(space.tree, pageId);
    this.toast(`Restored ${displayTitle(getPage(space.tree, pageId))}`);
  }

  async deleteForever(space, pageId) {
    const page = getPage(space.tree, pageId);
    if (!page) return;
    const ok = await confirmDialog({ title: `Delete ${displayTitle(page)} forever?`, message: 'This page and everything inside it will be gone for good. This cannot be undone.', confirm: 'Delete forever', danger: true });
    if (!ok) return;
    await this.ws.deleteForever(space, pageId);
    this.toast('Deleted forever');
    if (this.route?.page === pageId) this.go('home');
  }

  async deleteSharedSpace(space) {
    const ok = await confirmDialog({ title: `Delete ${space.title || 'this shared space'}?`, message: 'Everyone loses access and every page in it is deleted. This cannot be undone.', confirm: 'Delete for everyone', danger: true });
    if (!ok) return;
    try {
      await this.ws.deleteRoom(space.id);
      this.toast('Shared space deleted');
      this.go('home');
    } catch (err) {
      this.toast(err.message, { kind: 'error' });
    }
  }

  async toggleFavorite(space = this.space(), pageId = this.route?.page) {
    if (!space || !pageId) return;
    const was = this.ws.isFavorite(space, pageId);
    await this.ws.toggleFavorite(space, pageId);
    announce(was ? 'Removed from favorites' : 'Added to favorites');
  }

  pageTitle(id, prefer = null) {
    const space = prefer && getPage(prefer.tree, id) ? prefer : this.ws.locate(id);
    return space ? displayTitle(getPage(space.tree, id)) : 'Page not found';
  }

  linkFor(space, pageId, block = null) {
    if (space.kind === 'shared') return shareLink(space.server, space.room, null, pageId);
    const url = new URL(location.href);
    url.hash = `#/${space.id}/${pageId}${block ? `/${block}` : ''}`;
    return url.href;
  }

  async copyLink(space, pageId, block = null) {
    const link = this.linkFor(space, pageId, block);
    try {
      await navigator.clipboard.writeText(link);
      this.toast(space.kind === 'shared' ? 'Link copied. It opens for people who have access.' : 'Link copied. Private pages open only for you.');
    } catch {
      this.toast(link);
    }
  }

  async duplicate(space, pageId) {
    const id = await this.ws.duplicate(space, pageId);
    this.toast('Page duplicated');
    this.open(space, id);
  }

  share(anchor) {
    const space = this.space();
    if (!space || !this.route?.page) return;
    openShare(this, anchor, space, this.route.page);
  }

  async fetchTitle(url) {
    if (!this.puter?.net?.fetch) return null;
    try {
      const res = await Promise.race([this.puter.net.fetch(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
      const html = (await res.text()).slice(0, 200000);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return (doc.querySelector('meta[property="og:title"]')?.content || doc.title || '').trim() || null;
    } catch {
      return null;
    }
  }

  openPageMenu(anchor, space, pageId, { fromSidebar = false } = {}) {
    if (!space || !pageId) return;
    const page = getPage(space.tree, pageId);
    if (!page) return;
    const edit = space.canEdit;
    const fav = this.ws.isFavorite(space, pageId);
    const items = [];
    if (fromSidebar) {
      items.push(
        { label: 'Open', icon: 'arrowUpRight', run: () => this.open(space, pageId) },
        ...(edit ? [{ label: 'Rename', icon: 'pencil', hint: 'F2', run: () => this.sidebar.renameById(space, pageId) }] : []),
      );
    }
    items.push(
      { label: fav ? 'Remove from favorites' : 'Add to favorites', icon: fav ? 'starOff' : 'star', run: () => this.toggleFavorite(space, pageId) },
      { label: 'Copy link', icon: 'link', run: () => this.copyLink(space, pageId) },
    );
    if (edit) {
      items.push({ label: 'Duplicate', icon: 'copy', run: () => this.duplicate(space, pageId) });
      // Rows belong to their database.
      if (!page.row) items.push({ label: 'Move to', icon: 'folderInput', run: () => openMoveTo(this, space, pageId) });
      if (fromSidebar && !page.row) {
        const sibs = childrenOf(space.tree, page.parent ?? null);
        const i = sibs.findIndex((p) => p.id === pageId);
        items.push(
          { label: 'Move up', icon: 'arrowUp', hint: 'Alt+Shift+\u2191', disabled: i <= 0, run: () => this.sidebar.moveSibling(space, pageId, -1) },
          { label: 'Move down', icon: 'arrowDown', hint: 'Alt+Shift+\u2193', disabled: i < 0 || i >= sibs.length - 1, run: () => this.sidebar.moveSibling(space, pageId, 1) },
        );
      }
    }
    if (!fromSidebar) {
      items.push(
        { type: 'sep' },
        { label: 'Full width', icon: 'fullWidth', checked: !!page.fullWidth, disabled: !edit, run: () => updatePage(space.tree, pageId, { fullWidth: !page.fullWidth }, this.ws.by) },
        { label: 'Small text', icon: 'smallText', checked: !!page.smallText, disabled: !edit, run: () => updatePage(space.tree, pageId, { smallText: !page.smallText }, this.ws.by) },
        { label: page.locked ? 'Unlock page' : 'Lock page', icon: page.locked ? 'lockOpen' : 'lock', disabled: !edit, run: () => updatePage(space.tree, pageId, { locked: !page.locked }, this.ws.by) },
        { type: 'sep' },
        {
          label: 'Export',
          icon: 'download',
          submenu: () => [
            { label: 'Markdown', icon: 'fileText', run: () => this.exportPage(space, pageId, 'md') },
            { label: 'Web page (HTML)', icon: 'codeXml', run: () => this.exportPage(space, pageId, 'html') },
            { label: 'Print or save as PDF', icon: 'printer', run: () => window.print() },
          ],
        },
      );
      if (page.kind !== 'database') items.push({ label: 'Page history', icon: 'history', run: () => openHistory(this, space, pageId) });
      if (edit && page.kind !== 'database') items.push({ label: 'Import Markdown here', icon: 'fileUp', run: () => this.importMarkdown(space, pageId) });
    }
    if (edit) items.push({ type: 'sep' }, { label: space.kind === 'shared' && !page.parent && childrenOf(space.tree).length <= 1 ? 'Delete shared space' : 'Move to trash', icon: 'trash', danger: true, hint: fromSidebar ? 'Del' : null, run: () => this.trashPage(space, pageId) });
    if (space.kind === 'shared' && !page.parent && !space.canManage) items.push({ type: 'sep' }, { label: 'Leave shared space', icon: 'logOut', danger: true, run: () => this.leaveSpace(space) });
    if (!fromSidebar) {
      const editedBy = page.updatedBy ? ` by ${page.updatedBy}` : '';
      items.push({ type: 'sep' }, { type: 'header', label: `Edited ${new Date(page.updated || page.created || Date.now()).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${editedBy}` });
    }
    openMenu(anchor, items, { label: `${displayTitle(page)} options` });
  }

  async leaveSpace(space) {
    const ok = await confirmDialog({ title: `Leave ${space.title || 'this shared space'}?`, message: 'It disappears from your sidebar. You need a new invitation to come back.', confirm: 'Leave', danger: true });
    if (!ok) return;
    await this.ws.leaveRoom(space.id);
    this.go('home');
  }

  async exportPage(space, pageId, format) {
    const page = getPage(space.tree, pageId);
    const doc = await space.doc(pageId);
    let blocks = listBlocks(doc);
    const title = displayTitle(page);
    const opts = { pageTitle: (id) => this.pageTitle(id, space) };
    // A database exports as a table of its rows (as its first view shows them).
    if (page.kind === 'database' && isDatabase(doc)) {
      const props = listProps(doc);
      const view = listViews(doc)[0];
      const rows = queryRows(doc, view, (id) => getPage(space.tree, id));
      blocks = [{ type: 'table', table: { header: true, rows: [props.map((p) => p.name), ...rows.map((r) => props.map((p) => formatValue(p, cellValue(r, p, r.page)) || (p.type === 'title' ? displayTitle(r.page) : '')))] }, delta: [] }];
    }
    let blob;
    let name = title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'page';
    if (format === 'md') {
      blob = new Blob([`# ${title}\n\n${blocksToMarkdown(blocks, opts)}`], { type: 'text/markdown' });
      name += '.md';
    } else {
      const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 16px;color:#1d1d20}pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto}blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px}aside{background:#f4f4f5;padding:12px;border-radius:6px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}img{max-width:100%}</style></head><body><h1>${esc(title)}</h1>${blocksToHtml(blocks, opts)}</body></html>`;
      blob = new Blob([html], { type: 'text/html' });
      name += '.html';
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.toast(`Exported ${name}`);
  }

  /** Imports Markdown files: into a page, or as new private pages. */
  importMarkdown(space = null, pageId = null) {
    const input = h('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', multiple: !pageId, hidden: true });
    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.remove();
      let last = null;
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          this.toast(`${file.name} is larger than 5 MB.`, { kind: 'error' });
          continue;
        }
        const text = await file.text();
        let blocks = markdownToBlocks(text);
        let title = file.name.replace(/\.(md|markdown|txt)$/i, '');
        if (blocks[0]?.type === 'h1') {
          title = blocks[0].delta.map((op) => op.insert).join('');
          blocks = blocks.slice(1);
        }
        if (pageId && space) {
          insertBlocks(await space.doc(pageId), blocks);
          last = pageId;
        } else {
          const target = this.ws.personal;
          const id = await this.ws.createPage(target, { title });
          insertBlocks(await target.doc(id), blocks);
          last = id;
          space = target;
        }
      }
      if (last) {
        this.toast(files.length > 1 ? `Imported ${files.length} files` : 'Imported');
        if (!pageId) this.open(space, last);
      }
    });
    document.body.append(input);
    input.click();
  }

  openSearch() {
    openSearch(this);
  }

  openTrash(anchor) {
    openTrash(this, anchor);
  }

  openSettings() {
    openSettings(this);
  }

  openTemplates() {
    openTemplates(this);
  }

  openAccountMenu(anchor) {
    const theme = getTheme();
    const items = [
      { type: 'header', label: this.user?.username || 'Signed in' },
      { label: 'Theme', icon: theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor', submenu: () => [
          { label: 'System', icon: 'monitor', checked: getTheme() === 'system', radio: true, run: () => setTheme('system') },
          { label: 'Light', icon: 'sun', checked: getTheme() === 'light', radio: true, run: () => setTheme('light') },
          { label: 'Dark', icon: 'moon', checked: getTheme() === 'dark', radio: true, run: () => setTheme('dark') },
        ] },
      { label: 'Settings', icon: 'settings', run: () => this.openSettings() },
      { label: 'Keyboard shortcuts', icon: 'keyboard', hint: `${modLabel}/`, run: () => openShortcuts() },
    ];
    // Inside the Puter desktop the session belongs to Puter, so there is no sign-out here.
    if (this.env !== 'app' && this.onSignOut) items.push({ type: 'sep' }, { label: 'Sign out', icon: 'logOut', run: () => this.signOut() });
    openMenu(anchor, items, { label: 'Account' });
  }

  async signOut() {
    await this.ws.flushAll().catch(() => {});
    this.onSignOut?.();
  }

  /** Opens a shared space from an invitation or a link. */
  async join(link) {
    const progress = this.toast('Opening shared space...', { duration: 20000 });
    try {
      const space = await this.ws.joinLink(link);
      progress();
      this.sidebar.render();
      const root = link.page && getPage(space.tree, link.page) ? link.page : childrenOf(space.tree)[0]?.id;
      if (root) this.open(space, root);
      this.toast(link.token ? `You joined ${space.title || 'a shared space'}` : `Opened ${space.title || 'shared space'}`, { kind: 'success' });
    } catch (err) {
      progress();
      this.toast(err.message || 'This link could not be opened.', { kind: 'error', duration: 8000 });
      this.go('home');
    }
  }

  /* ---------- keyboard ---------- */

  onKey(e) {
    // The editor (and fields) handle their own shortcuts first, like Ctrl/Cmd+K for a link.
    if (e.defaultPrevented) return;
    const mod = modKey(e);
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K' || e.key === 'p')) {
      e.preventDefault();
      if (!document.querySelector('dialog[open]')) this.openSearch();
    } else if (mod && e.altKey && (e.code === 'KeyN')) {
      e.preventDefault();
      const space = this.space();
      // In a shared space a new page goes inside the current one; elsewhere it is private.
      if (space?.kind === 'shared' && space.canEdit && this.route?.page) this.newPage(space, this.route.page);
      else this.newPage(this.ws.personal, null);
    } else if (mod && e.key === '\\') {
      e.preventDefault();
      this.toggleSidebar();
    } else if (mod && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      const next = { system: 'light', light: 'dark', dark: 'system' }[getTheme()];
      setTheme(next);
      this.toast(`Theme: ${next[0].toUpperCase()}${next.slice(1)}`);
    } else if (mod && e.key === '/' && !e.target.closest?.('.editor')) {
      e.preventDefault();
      openShortcuts();
    } else if (e.key === 'Escape' && this.mobile.matches && this.drawerOpen && !hasOpenPopover()) {
      this.toggleSidebar(false);
    } else if (e.altKey && e.key === 'F10') {
      e.preventDefault();
      this.view?.editor?.toolbar.focus();
    }
  }
}

export { isMac, allPages };
