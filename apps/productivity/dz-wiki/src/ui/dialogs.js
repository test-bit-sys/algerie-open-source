/** Trash, settings, templates, move-to and keyboard shortcut dialogs. */
import { h, modLabel, isMac } from '../lib/dom.js';
import { icon, pageIcon } from '../lib/icons.js';
import { trashedPages, displayTitle, ancestors, childrenOf, getPage, isTrashed, wouldCycle, movePage, descendants } from '../data/tree.js';
import { TEMPLATES } from '../data/templates.js';
import { openDialog } from './dialog.js';
import { Popover } from './popover.js';
import { getTheme, setTheme } from './prefs.js';
import { avatar } from './avatar.js';

export function openTrash(app, anchor) {
  const ws = app.ws;
  const input = h('input.field.picker-search', { type: 'search', placeholder: 'Search the trash', 'aria-label': 'Search the trash' });
  const list = h('ul.trash-list', { 'aria-label': 'Pages in the trash' });
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const items = [];
    for (const space of ws.allSpaces()) {
      if (!space.tree) continue;
      for (const p of trashedPages(space.tree)) {
        if (q && !displayTitle(p).toLowerCase().includes(q)) continue;
        items.push({ space, p });
      }
    }
    items.sort((a, b) => b.p.trashed - a.p.trashed);
    list.replaceChildren(
      ...items.map(({ space, p }) => {
        const where = ancestors(space.tree, p.id).slice(0, -1).map(displayTitle).join(' / ');
        return h(
          'li.trash-item',
          h('button.trash-open', { type: 'button', onclick: () => {
              pop.close({ focus: false });
              app.open(space, p.id);
            } }, pageIcon(p, 16), h('span.trash-text', h('span.trash-title', displayTitle(p)), h('span.trash-meta', [space.kind === 'shared' ? space.title || 'Shared' : 'Private', where].filter(Boolean).join(' / ')))),
          space.canEdit ? h('button.icon-btn', { type: 'button', 'aria-label': `Restore ${displayTitle(p)}`, 'data-tip': 'Restore', onclick: () => {
              app.restorePage(space, p.id);
              render();
            } }, icon('rotateCcw', 15)) : null,
          space.canEdit ? h('button.icon-btn', { type: 'button', 'aria-label': `Delete ${displayTitle(p)} forever`, 'data-tip': 'Delete forever', onclick: async () => {
              await app.deleteForever(space, p.id);
              if (pop.open) render();
            } }, icon('trash', 15)) : null,
        );
      }),
    );
    if (!items.length) list.append(h('li.picker-empty', q ? 'Nothing in the trash matches.' : 'The trash is empty. Deleted pages stay here until you delete them forever.'));
  };
  input.addEventListener('input', render);
  const pop = new Popover({ anchor, content: h('div.trash-pop', h('p.picker-label', 'Trash'), input, list), className: 'picker-pop wide', label: 'Trash', placement: 'right-end' });
  render();
  input.focus();
}

export function openSettings(app) {
  const theme = getTheme();
  const themeGroup = h(
    'div.segmented',
    { role: 'radiogroup', 'aria-label': 'Theme' },
    ...[
      ['system', 'System', 'monitor'],
      ['light', 'Light', 'sun'],
      ['dark', 'Dark', 'moon'],
    ].map(([value, label, ic]) => {
      const b = h('button.segment', { type: 'button', role: 'radio', 'aria-checked': String(theme === value), tabindex: theme === value ? '0' : '-1' }, icon(ic, 16), label);
      b.addEventListener('click', () => {
        setTheme(value);
        for (const s of themeGroup.children) {
          s.setAttribute('aria-checked', String(s === b));
          s.tabIndex = s === b ? 0 : -1;
        }
      });
      return b;
    }),
  );
  themeGroup.addEventListener('keydown', (e) => {
    const btns = [...themeGroup.children];
    const i = btns.indexOf(document.activeElement);
    if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
    next.focus();
    next.click();
  });
  const user = app.user;
  const sandbox = !!user?.sandbox;
  const pages = app.ws.allSpaces().reduce((n, s) => n + (s.tree ? s.tree.getMap('pages').size : 0), 0);
  const body = h(
    'div.settings',
    h('section.settings-section', h('h3', 'Appearance'), h('p.settings-hint', 'System follows your device’s light or dark setting.'), themeGroup),
    h(
      'section.settings-section',
      h('h3', 'Account'),
      h('div.account-row', avatar(user?.username || 'You', { picture: app.picture, size: 40 }), h('div', h('strong', sandbox || !user?.username ? 'Local sandbox' : user.username), h('p.settings-hint', sandbox || !user?.username ? 'Pages are kept in this browser only.' : app.env === 'app' ? 'Signed in through Puter.' : 'Signed in with Puter.'))),
      app.env !== 'app' && app.onSignOut ? h('button.btn.small', { type: 'button', onclick: () => app.signOut() }, icon('logOut', 15), 'Sign out') : null,
    ),
    h(
      'section.settings-section',
      h('h3', 'Your data'),
      h('p.settings-hint', `${pages} page${pages === 1 ? '' : 's'} across ${app.ws.allSpaces().length} space${app.ws.allSpaces().length === 1 ? '' : 's'}. Private pages are files in the Wiki folder of your Puter cloud. Shared spaces are stored on the account of the person who shared them.`),
      h('button.btn.small', { type: 'button', onclick: () => {
          dlg.close();
          app.importMarkdown();
        } }, icon('fileUp', 15), 'Import Markdown files'),
    ),
    h('section.settings-section', h('h3', 'About'), h('p.settings-hint', 'Wiki is part of the Everything project: free, open-source software built on Puter.'), h('a.settings-link', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Powered by Puter', icon('externalLink', 13))),
  );
  const dlg = openDialog({ title: 'Settings', body, className: 'settings-dialog' });
}

export function openTemplates(app) {
  const grid = h(
    'div.template-grid',
    h('button.template', { type: 'button', onclick: () => {
        dlg.close();
        app.newPage();
      } }, icon('filePlus', 22), h('span.template-name', 'Empty page'), h('span.template-desc', 'Start from a blank page')),
    ...TEMPLATES.map((t) =>
      h('button.template', { type: 'button', onclick: () => {
          dlg.close();
          app.newPage(app.ws.personal, null, { template: t.id });
        } }, h('span.page-icon', { 'data-color': t.icon.color }, icon(t.icon.name, 22)), h('span.template-name', t.name), h('span.template-desc', t.description)),
    ),
  );
  const dlg = openDialog({ title: 'Templates', description: 'Start a new private page from a template.', body: grid, wide: true });
}

/** Moves a page under another page, in the same space or another one. */
export function openMoveTo(app, space, pageId) {
  const ws = app.ws;
  const page = getPage(space.tree, pageId);
  const input = h('input.field', { type: 'search', placeholder: 'Search for a page', 'aria-label': 'Search for a page to move to' });
  const list = h('div.move-list', { role: 'listbox', 'aria-label': 'Destinations' });
  let options = [];
  const render = () => {
    const q = input.value.trim().toLowerCase();
    options = [];
    const moving = new Set(descendants(space.tree, pageId));
    for (const s of ws.allSpaces()) {
      if (!s.tree || !s.canEdit) continue;
      if (s.kind === 'personal') options.push({ space: s, parent: null, label: 'Private pages', sub: 'Top level', icon: icon('lock', 16) });
      for (const p of [...s.tree.getMap('pages').keys()].map((id) => getPage(s.tree, id))) {
        if (!p || p.row || p.kind === 'database' || isTrashed(s.tree, p.id)) continue;
        if (s === space && (moving.has(p.id) || wouldCycle(s.tree, pageId, p.id))) continue;
        const path = ancestors(s.tree, p.id).map(displayTitle);
        if (q && !path.join(' ').toLowerCase().includes(q)) continue;
        options.push({ space: s, parent: p.id, label: displayTitle(p), sub: [s.kind === 'shared' ? 'Shared' : 'Private', ...path.slice(0, -1)].join(' / '), icon: pageIcon(p, 16) });
      }
    }
    options = options.slice(0, 60);
    list.replaceChildren(
      ...options.map((o, i) =>
        h('button.move-option', { type: 'button', role: 'option', 'aria-selected': 'false', onclick: () => choose(i) }, o.icon, h('span.move-text', h('span', o.label), h('span.move-sub', o.sub))),
      ),
    );
    if (!options.length) list.append(h('p.picker-empty', 'No pages match.'));
  };
  const choose = async (i) => {
    const o = options[i];
    if (!o) return;
    if (o.space === space) {
      if (space.kind === 'shared' && !page.parent && o.parent === null) return;
      movePage(space.tree, pageId, o.parent);
      dlg.close();
      app.toast(`Moved to ${o.label}`);
      app.open(space, pageId);
      return;
    }
    dlg.busy(true);
    try {
      await ws.moveToSpace(space, pageId, o.space, o.parent);
      dlg.close();
      app.toast(`Moved to ${o.label}`);
      app.open(o.space, pageId);
    } catch (err) {
      dlg.error(err.message || 'The page could not be moved.');
      dlg.busy(false);
    }
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.querySelector('.move-option')?.focus();
    }
  });
  list.addEventListener('keydown', (e) => {
    const opts = [...list.querySelectorAll('.move-option')];
    const i = opts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = opts[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
      else if (e.key === 'ArrowUp') input.focus();
    }
  });
  const dlg = openDialog({ title: `Move ${displayTitle(page)}`, description: 'Choose where this page and its subpages go.', body: h('div.move-box', input, list) });
  render();
}

export function openShortcuts() {
  const k = (...keys) => h('span.keys', ...keys.map((x) => h('kbd', x)));
  const mod = isMac ? '⌘' : 'Ctrl';
  const alt = isMac ? '⌥' : 'Alt';
  const rows = [
    ['General', [
      ['Search', k(mod, 'K')],
      ['New page', k(mod, alt, 'N')],
      ['Show or hide the sidebar', k(mod, '\\')],
      ['Switch theme', k(mod, 'Shift', 'L')],
      ['Keyboard shortcuts', k(mod, '/')],
    ]],
    ['Writing', [
      ['Insert a block', k('/')],
      ['Link to a page', k('@')],
      ['Bold, italic, underline', k(mod, 'B'), k(mod, 'I'), k(mod, 'U')],
      ['Strikethrough', k(mod, 'Shift', 'S')],
      ['Inline code', k(mod, 'E')],
      ['Add a link', k(mod, 'K')],
      ['Highlight', k(mod, 'Shift', 'H')],
      ['Line break in a block', k('Shift', 'Enter')],
      ['Formatting toolbar', k(alt, 'F10')],
    ]],
    ['Blocks', [
      ['Select the current block', k('Esc')],
      ['Block actions', k(mod, '/')],
      ['Indent, outdent', k('Tab'), k('Shift', 'Tab')],
      ['Move up or down', k(mod, 'Shift', '↑'), k(mod, 'Shift', '↓')],
      ['Duplicate', k(mod, 'D')],
      ['Check a to-do', k(mod, 'Enter')],
      ['Turn into text, heading 1 to 3', k(mod, alt, '0'), k(mod, alt, '1..3')],
      ['Undo, redo', k(mod, 'Z'), k(mod, 'Shift', 'Z')],
    ]],
    ['Markdown', [
      ['Headings', k('#'), k('##'), k('###')],
      ['Bulleted and numbered lists', k('-'), k('1.')],
      ['To-do, toggle, quote', k('[]'), k('>'), k('"')],
      ['Code block, divider', k('```'), k('---')],
      ['Bold, italic, code, strikethrough', k('**text**'), k('*text*'), k('`text`'), k('~~text~~')],
    ]],
  ];
  const body = h(
    'div.shortcuts',
    ...rows.map(([title, items]) => h('section', h('h3', title), h('dl', ...items.flatMap(([label, ...keys]) => [h('dt', label), h('dd', ...keys)])))),
  );
  openDialog({ title: 'Keyboard shortcuts', body, wide: true, className: 'shortcuts-dialog' });
}

export { modLabel, childrenOf };
