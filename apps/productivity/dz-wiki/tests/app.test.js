import { describe, it, expect, afterEach } from 'vitest';
import axe from 'axe-core';
import { Workspace } from '../src/data/workspace.js';
import { memoryBackend, memoryKv } from '../src/data/backend.js';
import { App } from '../src/ui/app.js';
import { closeAllPopovers } from '../src/ui/popover.js';
import { childrenOf, getPage } from '../src/data/tree.js';
import { resetPrefs } from '../src/ui/prefs.js';

// jsdom has no layout, so contrast and landmark checks run in the browser instead.
const AXE = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, resultTypes: ['violations'] };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let app;

async function mount({ env = 'web', onSignOut = () => {} } = {}) {
  document.body.innerHTML = '<div id="app"></div><div id="live-region"></div>';
  localStorage.clear();
  resetPrefs();
  location.hash = '';
  const ws = new Workspace({ backend: memoryBackend(), kv: memoryKv(), user: { username: 'sam', uuid: 'u1' } });
  await ws.start();
  app = new App(document.getElementById('app'), { ws, user: ws.user, env, onSignOut });
  await app.start();
  await tick(10);
  return app;
}

async function violations() {
  // Optional parts of the UI must never render as the text "null" or "undefined".
  expect(document.body.textContent).not.toMatch(/\bnull\b|\bundefined\b/);
  const r = await axe.run(document.body, AXE);
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

afterEach(() => {
  closeAllPopovers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  app?.ws.close();
  clearInterval(app?.refreshTimer);
  app?.indexAbort?.abort();
});

describe('app shell', () => {
  it('opens the first page and lists pages in an accessible tree', async () => {
    await mount();
    const tree = document.querySelector('[role="tree"][aria-label="Private pages"]');
    expect([...tree.querySelectorAll('[role="treeitem"]')].map((r) => r.getAttribute('aria-label'))).toEqual(['Getting started', 'Tasks', 'Notes']);
    expect(document.querySelector('.page-title').textContent).toBe('Getting started');
    expect(document.querySelector('.tree-row.current').getAttribute('aria-current')).toBe('page');
    expect(document.title).toBe('Getting started - Wiki');
  });

  it('creates a page and opens it with the title ready to type', async () => {
    await mount();
    const id = await app.newPage();
    await tick(10);
    expect(location.hash).toBe(`#/personal/${id}`);
    expect(getPage(app.ws.personal.tree, id).title).toBe('');
    expect(document.activeElement.classList.contains('page-title')).toBe(true);
  });

  it('renames a page from its title and updates the sidebar and breadcrumb', async () => {
    await mount();
    const title = document.querySelector('.page-title');
    title.textContent = 'Welcome aboard';
    title.dispatchEvent(new Event('input'));
    app.view.saveTitle.flush();
    await tick(10);
    expect(document.querySelector('.tree-row.current').getAttribute('aria-label')).toBe('Welcome aboard');
    expect(document.querySelector('.crumb.current').textContent).toBe('Welcome aboard');
  });

  it('moves pages to the trash with undo', async () => {
    await mount();
    const space = app.ws.personal;
    const notes = childrenOf(space.tree).find((p) => p.title === 'Notes');
    await app.trashPage(space, notes.id);
    expect(childrenOf(space.tree).map((p) => p.title)).not.toContain('Notes');
    document.querySelector('.toast-action').click();
    expect(childrenOf(space.tree).map((p) => p.title)).toContain('Notes');
  });

  it('offers sign-out on the web but not inside the Puter desktop', async () => {
    await mount({ env: 'web' });
    app.openAccountMenu(document.querySelector('.ws-button'));
    expect([...document.querySelectorAll('.menu-item')].map((m) => m.textContent)).toContain('Sign out');
    closeAllPopovers();
    app.ws.close();
    await mount({ env: 'app', onSignOut: null });
    app.openAccountMenu(document.querySelector('.ws-button'));
    expect([...document.querySelectorAll('.menu-item')].map((m) => m.textContent).join(' ')).not.toContain('Sign out');
  });

  it('finds pages with quick search', async () => {
    await mount();
    app.openSearch();
    const input = document.querySelector('.search-input');
    input.value = 'tas';
    input.dispatchEvent(new Event('input'));
    await tick(120);
    expect(document.querySelector('.search-item .search-title').textContent).toBe('Tasks');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick(10);
    expect(document.querySelector('.page-title').textContent).toBe('Tasks');
    expect(document.querySelector('.database')).toBeTruthy();
  });

  it('expands and collapses tree rows from the keyboard', async () => {
    await mount();
    const space = app.ws.personal;
    const parent = childrenOf(space.tree)[0];
    await app.ws.createPage(space, { parent: parent.id, title: 'Child' });
    await tick(10);
    const row = document.querySelector(`.tree-row[data-page="${parent.id}"]`);
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await tick(10);
    const again = document.querySelector(`.tree-row[data-page="${parent.id}"]`);
    expect(again.getAttribute('aria-expanded')).toBe('true');
    expect(again.querySelector('[role="group"] .tree-row').getAttribute('aria-label')).toBe('Child');
  });
});

describe('accessibility (axe)', () => {
  it('has no violations on a page, the home view and a database', async () => {
    await mount();
    expect(await violations()).toEqual([]);
    app.go('home');
    await tick(10);
    expect(await violations()).toEqual([]);
    const tasks = childrenOf(app.ws.personal.tree).find((p) => p.title === 'Tasks');
    app.open(app.ws.personal, tasks.id);
    await tick(20);
    expect(await violations()).toEqual([]);
    document.querySelectorAll('.view-tab')[1].click();
    await tick(10);
    expect(await violations()).toEqual([]);
  });

  it('has no violations in menus and dialogs', async () => {
    await mount();
    app.openPageMenu(document.querySelector('[aria-label="Page options"]'), app.ws.personal, app.route.page);
    expect(await violations()).toEqual([]);
    closeAllPopovers();
    app.comments.open();
    expect(await violations()).toEqual([]);
    app.comments.close();
    for (const open of [() => app.openSearch(), () => app.openSettings(), () => app.openTemplates(), () => app.share(document.querySelector('.share-btn'))]) {
      open();
      await tick(10);
      expect(await violations()).toEqual([]);
      document.querySelectorAll('dialog').forEach((d) => d.remove());
    }
  });
});

describe('shared spaces at startup', () => {
  it('shows a shared space that is still connecting without breaking the sidebar', async () => {
    document.body.innerHTML = '<div id="app"></div><div id="live-region"></div>';
    localStorage.clear();
    resetPrefs();
    location.hash = '';
    const kv = memoryKv();
    await kv.set('wiki:rooms', [{ server: 'https://x.puter.work', room: 'room0000slow', title: 'Team space', role: 'editor' }]);
    let release;
    const gate = new Promise((r) => (release = r));
    // A worker that answers only when released.
    const collab = { request: async () => { await gate; throw Object.assign(new Error('gone'), { status: 404 }); }, deploy: async () => 'https://x.puter.work', events: null };
    const ws = new Workspace({ backend: memoryBackend(), kv, user: { username: 'sam', uuid: 'u1' }, collab });
    await ws.start();
    app = new App(document.getElementById('app'), { ws, user: ws.user, env: 'web', onSignOut: () => {} });
    await app.start();
    expect(document.querySelector('.tree-row.pending').textContent).toContain('Team space');
    expect(document.querySelector('.page-title').textContent).toBe('Getting started');
    release();
    await ws.ready;
    await tick(10);
    // Now marked as unavailable rather than crashing.
    expect(document.querySelector('.tree-row.pending').getAttribute('title')).toBe('gone');
  });
});

describe('review fixes', () => {
  it('leaves Ctrl/Cmd+K in the editor to the editor', async () => {
    await mount();
    const text = document.querySelector('.blk-text');
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
    expect(document.querySelector('.search-dialog')).toBe(null);
  });

  it('keeps a typed filter value when its condition changes', async () => {
    await mount();
    const tasks = childrenOf(app.ws.personal.tree).find((p) => p.title === 'Tasks');
    app.open(app.ws.personal, tasks.id);
    await tick(20);
    app.view.db.openFilters(document.querySelector('[data-fkey="filter"]'));
    document.querySelector('.filter-editor .btn').click();
    await tick(10);
    const row = document.querySelector('.filter-row');
    const value = row.querySelector('input');
    value.value = 'foo';
    value.dispatchEvent(new Event('input'));
    await tick(350);
    const op = row.querySelectorAll('select')[1];
    op.value = 'is';
    op.dispatchEvent(new Event('change'));
    await tick(10);
    expect(app.view.db.view.filters[0]).toMatchObject({ op: 'is', value: 'foo' });
  });

  it('keeps holding a page that was left and reopened quickly', async () => {
    await mount();
    const space = app.ws.personal;
    const [a, b] = childrenOf(space.tree);
    app.open(space, b.id);
    app.open(space, a.id);
    await tick(30);
    expect(space.isHeld(a.id)).toBe(true);
    expect(space.isHeld(b.id)).toBe(false);
  });
});

describe('review fixes, round two', () => {
  it('closes the whole menu when a submenu item is chosen', async () => {
    await mount();
    const { openMenu } = await import('../src/ui/menu.js');
    let ran = false;
    openMenu(document.querySelector('.ws-button'), [{ label: 'More', submenu: () => [{ label: 'Leaf', run: () => (ran = true) }] }], { label: 'Test' });
    document.querySelector('.menu-item').click();
    const leaf = [...document.querySelectorAll('.menu-item')].find((m) => m.textContent === 'Leaf');
    leaf.click();
    expect(ran).toBe(true);
    expect(document.querySelectorAll('.popover')).toHaveLength(0);
  });

  it('does not wipe a sidebar rename when the page tree changes', async () => {
    await mount();
    const space = app.ws.personal;
    const [first, second] = childrenOf(space.tree);
    app.sidebar.renameById(space, second.id);
    const input = document.querySelector('.row-rename');
    input.value = 'Half typed';
    const { updatePage } = await import('../src/data/tree.js');
    updatePage(space.tree, first.id, { title: 'Changed elsewhere' });
    await tick(10);
    expect(document.querySelector('.row-rename')).toBe(input);
    expect(input.value).toBe('Half typed');
  });

  it('reorders sibling pages from the keyboard', async () => {
    await mount();
    const space = app.ws.personal;
    const [first, second] = childrenOf(space.tree);
    app.sidebar.moveSibling(space, second.id, -1);
    expect(childrenOf(space.tree).slice(0, 2).map((p) => p.id)).toEqual([second.id, first.id]);
  });
});
