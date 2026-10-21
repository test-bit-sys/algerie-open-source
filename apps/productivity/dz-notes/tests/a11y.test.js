import { describe, it, expect, afterEach } from 'vitest';
import axe from 'axe-core';
import { Store } from '../src/data/store.js';
import { memoryBackend } from '../src/data/backend.js';
import { App } from '../src/ui/app.js';
import { closeAllMenus } from '../src/ui/menu.js';

// jsdom has no layout, so contrast and visibility checks run in the browser instead.
const OPTIONS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, resultTypes: ['violations'] };

let app;

async function mount() {
  document.body.innerHTML = '<div id="app"></div><div id="live-region"></div>';
  localStorage.clear();
  const store = new Store(memoryBackend(), { saveDelay: 0 });
  await store.load();
  app = new App(document.getElementById('app'), { store, user: { username: 'sam' }, env: 'web', onSignOut: () => {} });
  await app.start();
  return app;
}

async function violations() {
  const r = await axe.run(document.body, OPTIONS);
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe('accessibility (axe)', () => {
  afterEach(() => {
    closeAllMenus();
    document.querySelectorAll('dialog').forEach((d) => d.remove());
    app?.destroy();
  });

  it('has no violations in the main window', async () => {
    await mount();
    app.editor.createOutlineAt(100, 200).querySelector('.outline-body').innerHTML = '<p><span class="nt-tag" data-tag="todo" data-done="false" contenteditable="false" role="checkbox" aria-checked="false" aria-label="To Do" tabindex="-1"></span>Task</p>';
    expect(await violations()).toEqual([]);
  });

  it('has no violations on any ribbon tab', async () => {
    await mount();
    for (const tab of ['insert', 'draw', 'view', 'help']) {
      app.ribbon.select(tab);
      expect(await violations()).toEqual([]);
    }
  });

  it('has no violations in menus and dialogs', async () => {
    await mount();
    app.nav.nbButton.click();
    expect(await violations()).toEqual([]);
    closeAllMenus();
    for (const cmd of ['shortcuts', 'deletedNotes', 'help', 'insertLink', 'pageTemplates']) {
      app.runCommand(cmd);
      await new Promise((r) => setTimeout(r, 0));
      expect(await violations(), cmd).toEqual([]);
      document.querySelectorAll('dialog').forEach((d) => d.remove());
    }
  });

  it('has no violations in the side panels and task panes', async () => {
    await mount();
    app.setRailView('search');
    expect(await violations()).toEqual([]);
    app.setRailView('recent');
    expect(await violations()).toEqual([]);
    app.setRailView('notebooks');
    app.toggleTaskPane('tags');
    await new Promise((r) => setTimeout(r, 20));
    expect(await violations()).toEqual([]);
  });
});
