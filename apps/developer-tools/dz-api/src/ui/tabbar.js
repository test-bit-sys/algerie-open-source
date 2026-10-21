/**
 * Open tabs strip plus the environment picker. Tabs can be reordered by
 * dragging, closed with the middle button, and managed from a context menu.
 */
import { h, fill, shortcut } from '../lib/dom.js';
import { icon } from './icons.js';
import { contextMenu, menuButton } from './menu.js';
import { showPopover, closePopover } from './popover.js';

const KIND_ICON = { collection: 'collections', folder: 'folder', environment: 'globe', runner: 'play' };

export class TabBar {
  constructor(app) {
    this.app = app;
    this.list = h('div.doc-tabs', { role: 'tablist', 'aria-label': 'Open tabs' });
    this.list.addEventListener('keydown', (e) => this.#onKey(e));
    this.newBtn = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'New request', title: `New request (${shortcut('Mod+Alt+N')})`, onclick: () => app.newRequest() }, icon('plus', 16));
    this.overflowBtn = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'All open tabs', title: 'All open tabs' }, icon('chevronDown', 16));
    menuButton(this.overflowBtn, () => this.#overflowItems(), { align: 'end', label: 'Open tabs' });
    this.envBtn = h('button.env-select', { type: 'button' });
    menuButton(this.envBtn, () => this.#envItems(), { align: 'end', label: 'Environment' });
    this.eyeBtn = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Quick look at variables', title: 'Quick look at variables', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => this.#quickLook() }, icon('eye', 16));
    this.el = h(
      'div.tabbar',
      this.list,
      h('div.tabbar-actions', this.newBtn, this.overflowBtn),
      h('div.tabbar-spacer'),
      h('div.env-picker', this.envBtn, this.eyeBtn),
    );
    this.renderEnv();
  }

  render() {
    const app = this.app;
    const nodes = app.tabs.map((tab, index) => {
      const active = tab.id === app.activeId;
      const dirty = app.isDirty(tab);
      const title = app.tabTitle(tab);
      const lead =
        tab.kind === 'request'
          ? h('span.method', { dataset: { m: tab.draft.method } }, shortMethod(tab.draft.method))
          : tab.kind === 'websocket'
            ? h('span.method', { dataset: { m: 'WS' } }, 'WS')
            : h('span.tab-icon', icon(KIND_ICON[tab.kind] || 'fileText', 14));
      const btn = h(
        'button.doc-tab-btn',
        {
          type: 'button',
          role: 'tab',
          id: `tab-${tab.id}`,
          'aria-selected': String(active),
          // One panel shows the active tab's view.
          'aria-controls': active ? app.content.id : null,
          tabindex: active ? '0' : '-1',
          title: `${title}${dirty ? ' (unsaved)' : ''}`,
          'aria-keyshortcuts': 'Delete',
          'aria-description': 'Press Delete to close',
          onclick: () => app.activate(tab.id, { focus: false }),
          ondblclick: () => {
            tab.preview = false;
            this.render();
            app.persistTabs();
          },
        },
        lead,
        h('span.doc-tab-name', title),
        dirty ? h('span.sr-only', ', unsaved changes') : null,
      );
      const close = h(
        'button.doc-tab-close',
        { type: 'button', tabindex: '-1', 'aria-hidden': 'true', title: `Close (${shortcut('Mod+Alt+W')})`, onclick: (e) => { e.stopPropagation(); app.closeTab(tab.id); } },
        icon('x', 13),
      );
      const el = h(`div.doc-tab${active ? '.active' : ''}${dirty ? '.dirty' : ''}${tab.preview ? '.preview' : ''}`, { role: 'presentation', draggable: 'true', dataset: { id: tab.id } }, btn, close);
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          app.closeTab(tab.id);
        }
      });
      el.addEventListener('contextmenu', (e) => contextMenu(e, this.#tabMenu(tab, index), { label: 'Tab actions' }));
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-tab', tab.id);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      // The half of the tab under the pointer decides the side, so a tab can also go last.
      const after = (e) => {
        const r = el.getBoundingClientRect();
        return e.clientX > r.left + r.width / 2;
      };
      const clear = () => el.classList.remove('drop-before', 'drop-after');
      el.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('text/x-tab')) return;
        e.preventDefault();
        const side = after(e);
        el.classList.toggle('drop-after', side);
        el.classList.toggle('drop-before', !side);
      });
      el.addEventListener('dragleave', clear);
      el.addEventListener('drop', (e) => {
        clear();
        const id = e.dataTransfer.getData('text/x-tab');
        if (!id || id === tab.id) return;
        e.preventDefault();
        const from = app.tabs.findIndex((t) => t.id === id);
        const to = after(e) ? index + 1 : index;
        app.moveTab(id, from < to ? to - 1 : to);
      });
      return el;
    });
    fill(this.list, nodes);
    this.overflowBtn.hidden = false;
    const active = this.list.querySelector('.doc-tab.active');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  #tabMenu(tab, index) {
    const app = this.app;
    const others = app.tabs.filter((t) => t.id !== tab.id).map((t) => t.id);
    const right = app.tabs.slice(index + 1).map((t) => t.id);
    return [
      tab.draft ? { label: 'Duplicate tab', icon: 'copy', run: () => app.openTab(tab.kind, null, { draft: { ...structuredClone(tab.draft), id: undefined, name: `${tab.draft.name} Copy` } }) } : null,
      tab.draft && tab.refId ? { label: 'Reveal in sidebar', icon: 'tree', run: () => { app.showSection('collections'); app.sidebar.reveal(tab.refId); } } : null,
      tab.draft ? '-' : null,
      { label: 'Close', icon: 'x', kbd: shortcut('Mod+Alt+W'), run: () => app.closeTab(tab.id) },
      { label: 'Close other tabs', disabled: !others.length, run: () => app.closeTabs(others) },
      { label: 'Close tabs to the right', disabled: !right.length, run: () => app.closeTabs(right) },
      { label: 'Close all tabs', run: () => app.closeTabs(app.tabs.map((t) => t.id)) },
    ];
  }

  #overflowItems() {
    const app = this.app;
    return [
      { heading: `${app.tabs.length} open tabs` },
      ...app.tabs.map((t) => ({
        label: app.tabTitle(t),
        render: () => h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, t.kind === 'request' ? h('span.method', { dataset: { m: t.draft.method } }, shortMethod(t.draft.method)) : t.kind === 'websocket' ? h('span.method', { dataset: { m: 'WS' } }, 'WS') : icon(KIND_ICON[t.kind] || 'fileText', 14), h('span', app.tabTitle(t))),
        checked: t.id === app.activeId,
        run: () => app.activate(t.id, { focus: true }),
      })),
      '-',
      { label: 'New WebSocket request', icon: 'plug', run: () => app.newWebSocket() },
      { label: 'Close all tabs', icon: 'x', run: () => app.closeTabs(app.tabs.map((t) => t.id)) },
    ];
  }

  #onKey(e) {
    const tabs = [...this.list.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else if (e.key === 'Delete') {
      e.preventDefault();
      // Focus stays in the tab list, or moves to the launch screen once no tab is left.
      this.app.closeTab(this.app.tabs[i].id, { focus: false }).then((closed) => {
        if (closed) (this.list.querySelector('[aria-selected="true"]') || this.app.content.querySelector('.launch-card'))?.focus();
      });
      return;
    } else return;
    e.preventDefault();
    tabs[next].focus();
    this.app.activate(this.app.tabs[next].id);
    this.list.querySelector('[aria-selected="true"]')?.focus();
  }

  // Environments -------------------------------------------------------------

  renderEnv() {
    const app = this.app;
    const env = app.environmentId ? app.ws.getEnvironment(app.environmentId) : null;
    this.envBtn.classList.toggle('none', !env);
    fill(this.envBtn, env ? h('span.env-dot', { 'aria-hidden': 'true' }) : icon('globe', 14), h('span.env-name', env ? env.name : 'No environment'), icon('chevronDown', 14));
    this.envBtn.setAttribute('aria-label', `Environment: ${env ? env.name : 'none'}`);
    this.envBtn.title = env ? env.name : 'No environment'; // the name is cut short on phones
  }

  #envItems() {
    const app = this.app;
    const envs = app.ws.environments;
    return [
      { heading: 'Environment' },
      { label: 'No environment', checked: !app.environmentId, run: () => app.setEnvironment(null) },
      ...envs.map((e) => ({ label: e.name, checked: e.id === app.environmentId, run: () => app.setEnvironment(e.id) })),
      '-',
      { label: 'New environment', icon: 'plus', run: () => app.createEnvironment() },
      { label: 'Manage environments', icon: 'settings', run: () => app.showSection('environments') },
    ];
  }

  #quickLook() {
    const app = this.app;
    if (this.eyeBtn.getAttribute('aria-expanded') === 'true') {
      closePopover();
      return;
    }
    const env = app.environmentId ? app.ws.getEnvironment(app.environmentId) : null;
    const tab = app.activeTab;
    const loc = tab?.refId ? app.ws.locate(tab.refId) : null;
    const coll = loc?.collection || null;
    const section = (title, vars, open) =>
      h(
        'section',
        h('h3', h('span', title), open ? h('button.link-btn', { type: 'button', onclick: () => { closePopover(); open(); } }, 'Edit') : null),
        vars && vars.filter((v) => v.enabled !== false && v.key).length
          ? h(
              'table',
              h(
                'tbody',
                vars
                  .filter((v) => v.enabled !== false && v.key)
                  .map((v) => h('tr', h('td.mono', { title: v.key }, v.key), h('td.mono', { title: v.secret ? '' : v.value }, v.secret ? '••••••••' : v.value))),
              ),
            )
          : h('p.muted', vars ? 'No variables yet.' : 'No environment selected.'),
      );
    showPopover(
      this.eyeBtn,
      h(
        'div.env-quick',
        section(env ? env.name : 'Environment', env ? env.variables : null, env ? () => app.openTab('environment', env.id) : null),
        coll ? section(`Collection: ${coll.name}`, coll.variables, () => app.openTab('collection', coll.id)) : null,
        section('Globals', app.ws.globals.variables, () => app.openTab('environment', 'globals')),
      ),
      { align: 'end', label: 'Variables in scope', className: 'env-quick-pop' },
    );
  }
}

export function shortMethod(m) {
  return { DELETE: 'DEL', OPTIONS: 'OPT', PATCH: 'PATCH' }[m] || (m.length > 6 ? m.slice(0, 5) : m);
}

