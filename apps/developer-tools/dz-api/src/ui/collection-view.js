/**
 * Collection and folder editor: overview (description and contents),
 * authorization, scripts and, for collections, variables. Edits save
 * automatically into the workspace a moment after typing stops.
 */
import { h, fill, append, debounce, domId, isComposing } from '../lib/dom.js';
import { normalizeVariables, normalizeAuth, requestsIn, walk, METHODS } from '../core/model.js';
import { relativeDay, timeOfDay } from '../lib/format.js';
import { icon } from './icons.js';
import { menuButton } from './menu.js';
import { toast } from './toast.js';
import { createAuthEditor, AUTH_LABELS } from './auth-editor.js';
import { createScriptsEditor, wireTabs, selectTab } from './scripts-editor.js';
import { createVariablesEditor, createSaveIndicator, precedenceList, SAVE_DELAY } from './environment-view.js';

const CONTENTS_LIMIT = 60;

const canon = (v) => JSON.stringify(v ?? null);
const canonVars = (rows) => JSON.stringify((rows || []).map((r) => [r.id, r.key, r.value, r.enabled !== false, !!r.secret, r.description || '']));

function formatDate(ts) {
  if (!ts) return '';
  return `${relativeDay(ts)}, ${timeOfDay(ts)}`;
}

export class CollectionView {
  constructor(app, tab) {
    this.app = app;
    this.tab = tab;
    this.kind = tab.kind === 'folder' ? 'folder' : 'collection';
    this.id = tab.refId;
    this.pending = {};
    this.built = {};
    this.indicator = createSaveIndicator();
    this.save = debounce(() => this.#write(), SAVE_DELAY);
    this.el = h(`div.req-view.pv-view.collection-view`, { dataset: { kind: this.kind } });
    this.#build();
  }

  get loc() {
    return this.app.ws.locate(this.id);
  }

  get item() {
    return this.loc?.item || null;
  }

  get collectionId() {
    return this.loc?.collection.id || null;
  }

  get noun() {
    return this.kind === 'folder' ? 'folder' : 'collection';
  }

  // Building -------------------------------------------------------------------------

  #build() {
    const item = this.item;
    if (!item) {
      this.el.append(h('div.empty', h('p.empty-title', 'Not found'), h('p', `This ${this.noun} no longer exists.`)));
      return;
    }
    const owner = this.loc?.collection;
    this.viewOnly = !!owner?.shared && !['write', 'manage'].includes(owner.shared.mode);
    this.heading = h('h2.sr-only', item.name);
    this.nameInput = h('input.req-name', {
      type: 'text',
      value: item.name,
      readOnly: this.viewOnly,
      'aria-label': `${this.kind === 'folder' ? 'Folder' : 'Collection'} name`,
      spellcheck: false,
      autocomplete: 'off',
      oninput: () => {
        const v = this.nameInput.value.trim();
        if (!v) return;
        this.heading.textContent = v;
        this.#queue({ name: v });
      },
      onfocus: () => (this.nameAtFocus = this.item?.name || ''),
      onkeydown: (e) => {
        if (isComposing(e)) return;
        if (e.key === 'Enter') this.nameInput.blur();
        else if (e.key === 'Escape') {
          this.#revertName();
          this.nameInput.blur();
        }
      },
      onblur: () => {
        if (!this.nameInput.value.trim()) this.nameInput.value = this.item?.name || '';
      },
    });
    this.crumbs = h('nav.crumbs', { 'aria-label': 'Location' });
    this.#renderCrumbs();

    const runBtn = h('button.btn.sm', { type: 'button', title: `Run every request in this ${this.noun}`, 'aria-label': `Run ${this.noun}`, onclick: () => { this.save.flush(); this.app.runCollection(this.id); } }, icon('play', 14), h('span.pv-btn-label', 'Run'));
    const newReq = h('button.btn.sm', { type: 'button', 'aria-label': 'New request', title: `Add a request to this ${this.noun}`, onclick: () => this.app.addRequestTo(this.collectionId, this.id) }, icon('plus', 14), h('span.pv-btn-label', 'New request'));
    const newFolder = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'New folder', title: 'New folder', onclick: () => this.app.addFolderTo(this.collectionId, this.id) }, icon('folderPlus', 16));
    const more = h('button.icon-btn.sm', { type: 'button', 'aria-label': `More ${this.noun} actions`, title: 'More actions' }, icon('more', 16));
    menuButton(more, () => [
      this.viewOnly ? null : { label: 'Rename', icon: 'pencil', run: () => { this.nameInput.focus(); this.nameInput.select(); } },
      this.kind === 'collection' ? { label: 'Export collection', icon: 'download', run: () => this.#export() } : null,
      '-',
      { label: 'Delete', icon: 'trash', danger: true, run: () => { this.save.flush(); this.app.deleteItem(this.id); } },
    ], { align: 'end', label: `${this.kind === 'folder' ? 'Folder' : 'Collection'} actions` });

    // Section tabs.
    const sections = [
      ['overview', 'Overview'],
      ['auth', 'Authorization'],
      ['scripts', 'Scripts'],
      this.kind === 'collection' ? ['variables', 'Variables'] : null,
    ].filter(Boolean);
    this.sections = sections.map(([key]) => key);
    const baseId = domId('cv');
    this.tabEls = {};
    this.panels = {};
    this.tabExtras = {};
    for (const [key, label] of sections) {
      this.tabExtras[key] = h('span.pv-tab-extra');
      this.tabEls[key] = h('button.tab', { type: 'button', id: `${baseId}-tab-${key}`, 'aria-controls': `${baseId}-panel-${key}` }, h('span', label), this.tabExtras[key]);
      this.panels[key] = h('div.req-panel.pv-panel', { id: `${baseId}-panel-${key}`, role: 'tabpanel', 'aria-labelledby': `${baseId}-tab-${key}`, tabindex: '-1', hidden: true });
    }
    const tabButtons = sections.map(([key]) => this.tabEls[key]);
    const tablist = h('div.tabs', { 'aria-label': `${this.kind === 'folder' ? 'Folder' : 'Collection'} sections` }, tabButtons);
    wireTabs(tablist, tabButtons, { onSelect: (i) => this.select(this.sections[i]) });

    const viewOnly = this.viewOnly;
    const sharedNote = owner?.shared
      ? h(
          'div.callout.shared-banner',
          { dataset: { kind: viewOnly ? 'warning' : 'info' } },
          icon(viewOnly ? 'lock' : 'users', 14),
          h('span', viewOnly ? `Shared with you by ${owner.shared.owner}. You can view and run it, but not change it.` : `Shared with you by ${owner.shared.owner}. Changes you make are saved for everyone with access.`),
        )
      : null;
    // The dom.js append skips the null banner of a collection that is not shared.
    append(this.el, [
      this.heading,
      h('div.req-head', this.crumbs, h('div.req-head-actions', this.indicator.el, runBtn, newReq, newFolder, more)),
      sharedNote,
      h('div.req-tabs-row', tablist),
      ...this.sections.map((k) => this.panels[k]),
    ]);
    this.#renderTabExtras();
    this.select(this.sections.includes(this.tab.section) ? this.tab.section : 'overview');
  }

  #renderCrumbs() {
    const loc = this.loc;
    if (!loc) return;
    const parts = [];
    if (this.kind === 'folder') {
      for (const [i, p] of loc.parents.entries()) {
        const kind = p.type === 'collection' ? 'collection' : 'folder';
        parts.push(
          h(`button.crumb${i ? '' : '.crumb-root'}`, { type: 'button', title: `Open ${p.name}`, style: { '--chars': String(p.name.length) }, onclick: () => this.app.openTab(kind, p.id) }, p.name),
          h('span.sep', { 'aria-hidden': 'true' }, icon('chevronRight', 12)),
        );
      }
    } else {
      parts.push(h('span.crumb.pv-crumb-icon', { 'aria-hidden': 'true' }, icon('collections', 14)));
    }
    fill(this.crumbs, parts, this.nameInput);
  }

  #renderTabExtras() {
    const item = this.item;
    if (!item) return;
    const hasScripts = !!(item.scripts?.pre?.trim() || item.scripts?.post?.trim());
    fill(this.tabExtras.scripts, hasScripts ? [h('span.dot', { 'aria-hidden': 'true' }), h('span.sr-only', ', has scripts')] : null);
    const authOn = item.auth && item.auth.type !== 'none' && item.auth.type !== 'inherit';
    fill(this.tabExtras.auth, authOn ? [h('span.dot', { 'aria-hidden': 'true' }), h('span.sr-only', `, ${AUTH_LABELS[item.auth.type]}`)] : null);
    if (this.tabExtras.variables) {
      const n = (this.pending.variables || item.variables || []).filter((v) => v.key).length;
      fill(this.tabExtras.variables, n ? h('span.count', String(n)) : null);
    }
  }

  select(key, { focus = false } = {}) {
    if (!this.panels?.[key]) return;
    this.section = key;
    this.tab.section = key;
    selectTab(this.sections.map((k) => this.tabEls[k]), this.sections.indexOf(key));
    for (const k of this.sections) this.panels[k].hidden = k !== key;
    if (!this.built[key]) {
      this.built[key] = true;
      this.#buildPanel(key);
    }
    if (focus) this.tabEls[key].focus();
  }

  #buildPanel(key) {
    const item = this.item;
    const panel = this.panels[key];
    if (key === 'overview') {
      this.descInput = h('textarea.textarea.pv-desc', {
        id: domId('cv-desc'),
        rows: 4,
        value: item.description || '',
        readOnly: this.viewOnly,
        placeholder: `What is this ${this.noun} for? Note base URLs, required variables or how to get credentials.`,
        oninput: () => {
          this.#autoGrow();
          this.#queue({ description: this.descInput.value });
        },
      });
      this.statsEl = h('div.pv-stats-wrap');
      this.contentsEl = h('div.pv-contents-wrap');
      fill(
        panel,
        h(
          'div.pv-overview',
          h(
            'section.pv-section',
            h('label.field-label', { for: this.descInput.id }, 'Description'),
            this.descInput,
            h('p.field-hint', 'Plain text. Line breaks and Markdown-style formatting are kept as written.'),
          ),
          this.statsEl,
          this.contentsEl,
        ),
      );
      this.#renderOverview();
      requestAnimationFrame(() => this.#autoGrow());
    } else if (key === 'auth') {
      const vars = this.app.varsFor?.(this.collectionId) || null;
      this.authShown = normalizeAuth(item.auth, this.kind === 'collection' ? 'none' : 'inherit');
      this.authEditor = createAuthEditor({
        auth: this.authShown,
        vars,
        app: this.app,
        allowInherit: this.kind === 'folder',
        readOnly: this.viewOnly,
        inheritFrom: () => this.#inheritedAuth(),
        onChange: (auth) => {
          this.authShown = auth;
          this.#queue({ auth });
          this.#renderTabExtras();
        },
      });
      const hint =
        this.kind === 'collection'
          ? 'Requests and folders in this collection that use "Inherit auth from parent" send this authorization.'
          : 'Requests in this folder that use "Inherit auth from parent" send this authorization. Choose inherit to use the authorization of the parent folder or collection.';
      fill(panel, h('p.pv-muted.pv-panel-intro', hint), this.authEditor.el);
    } else if (key === 'scripts') {
      const vars = this.app.varsFor?.(this.collectionId);
      this.scriptsEditor = createScriptsEditor({
        scripts: item.scripts,
        label: item.name,
        scope: this.kind,
        readOnly: this.viewOnly,
        isVariableDefined: vars ? (name) => !!vars.get(name) : null,
        onChange: (scripts) => {
          this.#queue({ scripts });
          this.#renderTabExtras();
        },
      });
      const order =
        this.kind === 'collection'
          ? 'Collection scripts run for every request in it, first in line: collection, then folders, then the request itself.'
          : 'Folder scripts run for every request in the folder, after the collection script and before the request script.';
      fill(panel, h('p.pv-muted.pv-panel-intro', order), this.scriptsEditor.el);
    } else if (key === 'variables') {
      this.varsEditor = createVariablesEditor({
        rows: item.variables || [],
        vars: this.app.varsFor?.(this.collectionId) || null,
        label: 'Collection variables',
        readOnly: this.viewOnly,
        onChange: (rows) => {
          this.#queue({ variables: rows });
          this.#renderTabExtras();
        },
      });
      fill(
        panel,
        h(
          'div.pv-section.pv-intro',
          h('p', 'Collection variables apply to every request in this collection, whichever environment is active. Use them for values that belong to this API, such as a base URL or a version.'),
          h('p', 'Reference them as ', h('code.pv-code', '{{name}}'), '. When the same name is set in several places, the narrowest scope wins:'),
          precedenceList('collection'),
        ),
        this.varsEditor.el,
      );
    }
  }

  #autoGrow() {
    const ta = this.descInput;
    if (!ta || !ta.isConnected) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight + 2, 96), 480)}px`;
  }

  #inheritedAuth() {
    const loc = this.loc;
    if (!loc) return null;
    for (const p of [...loc.parents].reverse()) {
      const type = p.auth?.type;
      if (type && type !== 'inherit') return { name: p.name, label: AUTH_LABELS[type] || type, type };
    }
    return null;
  }

  #renderOverview() {
    const item = this.item;
    const loc = this.loc;
    if (!item || !this.statsEl) return;
    const requests = requestsIn(item);
    let folders = 0;
    walk(item, (x) => {
      if (x.type === 'folder') folders++;
    });
    const byMethod = new Map();
    for (const { item: r } of requests) byMethod.set(r.method, (byMethod.get(r.method) || 0) + 1);
    const methods = [...byMethod].sort((a, b) => {
      const ia = METHODS.indexOf(a[0]);
      const ib = METHODS.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });

    const stat = (label, value, extra = null) => h('div.pv-stat', h('dt', label), h('dd', value, extra));
    const time = (ts) => (ts ? h('time', { datetime: new Date(ts).toISOString(), title: new Date(ts).toLocaleString() }, formatDate(ts)) : 'Unknown');
    const stats = [stat('Requests', String(requests.length)), stat('Folders', String(folders))];
    if (this.kind === 'collection') {
      stats.push(stat('Created', time(item.createdAt)), stat('Last updated', time(item.updatedAt)));
    } else {
      stats.push(stat('Collection', loc.collection.name), stat('Collection updated', time(loc.collection.updatedAt)));
    }
    const total = requests.length || 1;
    const glanceId = (this.glanceId ||= domId('cv-glance'));
    const focused = this.contentsEl.contains(document.activeElement) ? [...this.contentsEl.querySelectorAll('button')].indexOf(document.activeElement) : -1;
    fill(
      this.statsEl,
      h(
        'section.pv-section',
        { 'aria-labelledby': glanceId },
        h('h3.pv-h', { id: glanceId }, 'At a glance'),
        h('dl.pv-stats', stats),
        methods.length
          ? h(
              'div.pv-methods',
              h('div.pv-method-bar', { 'aria-hidden': 'true' }, methods.map(([m, n]) => h('span.pv-method-seg', { dataset: { m }, style: { flexGrow: String(n / total) } }))),
              h(
                'ul.pv-method-list',
                { 'aria-label': 'Requests by method' },
                methods.map(([m, n]) => h('li.pv-method-chip', h('span.method', { dataset: { m } }, m), h('span.pv-method-n', String(n)), h('span.sr-only', n === 1 ? ' request' : ' requests'))),
              ),
            )
          : null,
      ),
    );

    // Direct children.
    const children = item.items || [];
    const list = children.slice(0, CONTENTS_LIMIT).map((child) => {
      const isFolder = child.type === 'folder';
      const isWs = child.type === 'websocket';
      const inner = isFolder ? requestsIn(child).length : 0;
      return h(
        'li',
        h(
          'button.pv-content-item',
          { type: 'button', onclick: () => this.app.openTab(isFolder ? 'folder' : child.type, child.id, { preview: !isFolder }) },
          isFolder ? h('span.pv-content-icon', icon('folder', 14)) : h('span.method.pv-content-method', { dataset: { m: isWs ? 'WS' : child.method } }, isWs ? 'WS' : child.method),
          h('span.pv-content-name', child.name),
          isFolder ? h('span.pv-content-meta', `${inner} ${inner === 1 ? 'request' : 'requests'}`) : h('span.pv-content-meta.mono', child.url || ''),
        ),
      );
    });
    const more = children.length > CONTENTS_LIMIT ? h('p.pv-muted', `And ${children.length - CONTENTS_LIMIT} more in the sidebar.`) : null;
    const empty = h(
      'div.empty.pv-empty',
      icon(this.kind === 'folder' ? 'folder' : 'collections', 22),
      h('p.empty-title', `This ${this.noun} is empty`),
      h('p', 'Add a request to start building it.'),
      h(
        'div.pv-empty-actions',
        h('button.btn.sm.primary', { type: 'button', onclick: () => this.app.addRequestTo(this.collectionId, this.id) }, icon('plus', 14), h('span', 'New request')),
        h('button.btn.sm', { type: 'button', onclick: () => this.app.addFolderTo(this.collectionId, this.id) }, icon('folderPlus', 14), h('span', 'New folder')),
      ),
    );
    fill(
      this.contentsEl,
      h(
        'section.pv-section',
        h('h3.pv-h', 'Contents', children.length ? h('span.pv-h-count', String(children.length)) : null),
        children.length ? [h('ul.pv-contents', { role: 'list' }, list), more] : empty,
      ),
    );
    if (focused >= 0) {
      const buttons = this.contentsEl.querySelectorAll('button');
      buttons[Math.min(focused, buttons.length - 1)]?.focus();
    }
  }

  // Saving ---------------------------------------------------------------------------

  /** Escape undoes the rename typed since the field got focus, saved or not. */
  #revertName() {
    const saved = this.item?.name || '';
    const original = this.nameAtFocus ?? saved;
    this.nameInput.value = original;
    this.heading.textContent = original;
    if (original !== saved) this.#queue({ name: original });
    else if ('name' in this.pending) {
      delete this.pending.name;
      if (!Object.keys(this.pending).length) {
        this.save.cancel();
        this.indicator.saved();
      }
    }
  }

  #queue(patch) {
    // View-only shared collections cannot be saved; the fields are read-only too.
    if (this.viewOnly) return;
    Object.assign(this.pending, patch);
    this.indicator.saving();
    this.save();
  }

  async #write() {
    const patch = this.pending;
    this.pending = {};
    if (!Object.keys(patch).length || !this.loc) return;
    try {
      await this.app.ws.updateItem(this.id, (item) => {
        if ('name' in patch) item.name = patch.name;
        if ('description' in patch) item.description = patch.description;
        if ('auth' in patch) item.auth = normalizeAuth(patch.auth, this.kind === 'collection' ? 'none' : 'inherit');
        if ('scripts' in patch) item.scripts = { pre: patch.scripts.pre || '', post: patch.scripts.post || '' };
        if ('variables' in patch && item.type === 'collection') item.variables = normalizeVariables(patch.variables);
      });
      this.indicator.saved();
    } catch (err) {
      this.indicator.failed();
      toast({ kind: 'error', title: `Could not save the ${this.noun}`, text: err?.message || '' });
    }
  }

  #export() {
    this.save.flush();
    import('./dialogs.js').then((m) => m.openExportDialog(this.app, { collectionId: this.id }));
  }

  // Lifecycle -------------------------------------------------------------------------

  onShow({ focus = false } = {}) {
    this.#refresh();
    if (focus && this.tabEls?.[this.section]) this.tabEls[this.section].focus();
  }

  onHide() {
    this.save.flush();
  }

  focus() {
    if (!this.tabEls?.[this.section]) return false;
    this.tabEls[this.section].focus();
    return true;
  }

  onVariablesChanged() {
    if (this.section === 'auth' && this.authEditor && !this.panels.auth.contains(document.activeElement)) this.authEditor.refresh();
  }

  onContextChanged(e) {
    if (e && (e.kind !== 'collection' || e.id !== this.collectionId)) return;
    if (!this.loc) return;
    // Write pending local edits first so a remote change does not drop them.
    this.save.flush();
    this.#refresh();
  }

  #refresh() {
    const item = this.item;
    if (!item || !this.nameInput) return;
    const active = document.activeElement;
    if (active !== this.nameInput && this.nameInput.value !== item.name) {
      this.nameInput.value = item.name;
      this.heading.textContent = item.name;
    }
    this.#renderCrumbs();
    if (this.descInput && active !== this.descInput && this.descInput.value !== (item.description || '')) {
      this.descInput.value = item.description || '';
      this.#autoGrow();
    }
    if (this.built.overview) this.#renderOverview();
    if (this.authEditor && !this.panels.auth.contains(active)) {
      const auth = normalizeAuth(item.auth, this.kind === 'collection' ? 'none' : 'inherit');
      if (canon(auth) !== canon(this.authShown)) {
        this.authShown = auth;
        this.authEditor.setAuth(auth);
      } else if (auth.type === 'inherit') this.authEditor.refresh();
    }
    if (this.scriptsEditor && !this.scriptsEditor.contains(active)) {
      const cur = this.scriptsEditor.getScripts();
      if (cur.pre !== (item.scripts?.pre || '') || cur.post !== (item.scripts?.post || '')) this.scriptsEditor.setScripts(item.scripts);
    }
    if (this.varsEditor && !('variables' in this.pending) && canonVars(item.variables) !== canonVars(this.varsEditor.getRows())) {
      this.varsEditor.setRows(item.variables || []);
    }
    this.#renderTabExtras();
  }

  destroy() {
    this.save.flush();
    this.scriptsEditor?.destroy();
    this.varsEditor?.destroy();
  }
}
