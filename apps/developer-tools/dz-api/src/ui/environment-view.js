/**
 * Environment (and Globals) editor. Edits save automatically into the
 * workspace a moment after typing stops.
 *
 * Also exports small pieces shared with the collection view: the variables
 * editor (search, count, bulk edit, table), the save indicator and the
 * precedence explainer.
 */
import { h, fill, debounce, domId, isComposing } from '../lib/dom.js';
import { normalizeVariables } from '../core/model.js';
import { icon } from './icons.js';
import { createKvTable } from './kv-table.js';
import { menuButton } from './menu.js';
import { toast } from './toast.js';

export const SAVE_DELAY = 300;

// Shared pieces ------------------------------------------------------------------

/** Subtle "Saving / Saved" state shown in view headers. */
export function createSaveIndicator() {
  const el = h('span.pv-save', { dataset: { state: 'idle' }, title: 'Changes save automatically' });
  let timer = 0;
  const set = (state, ic, text) => {
    clearTimeout(timer);
    el.dataset.state = state;
    fill(el, ic ? icon(ic, 13) : null, h('span', text));
  };
  set('idle', null, '');
  return {
    el,
    saving: () => set('saving', 'refresh', 'Saving'),
    saved() {
      set('saved', 'check', 'Saved');
      timer = setTimeout(() => (el.dataset.state = 'idle'), 2500);
    },
    failed: () => set('error', 'alert', 'Not saved'),
  };
}

const SCOPES = [
  ['local', 'Script variables'],
  ['environment', 'Environment'],
  ['collection', 'Collection'],
  ['globals', 'Globals'],
];

/** "Script variables > Environment > Collection > Globals" with the current scope marked. */
export function precedenceList(current) {
  const items = [];
  SCOPES.forEach(([key, label], i) => {
    if (i) items.push(h('li.pv-prec-sep', { 'aria-hidden': 'true' }, icon('chevronRight', 12)));
    items.push(
      h(
        `li.pv-prec-item${key === current ? '.current' : ''}`,
        key === current ? { 'aria-current': 'true' } : {},
        label,
        key === current ? h('span.pv-prec-here', ' (here)') : null,
      ),
    );
  });
  return h('ol.pv-prec', { 'aria-label': 'Variable precedence, highest first' }, items);
}

const canonVars = (rows) => JSON.stringify((rows || []).map((r) => [r.id, r.key, r.value, r.enabled !== false, !!r.secret, r.description || '']));

/**
 * Variables table with a search filter, a count, duplicate warnings and bulk
 * edit. onChange(rows) fires on every edit.
 */
export function createVariablesEditor({ rows = [], onChange, vars = null, label = 'Variables', readOnly = false } = {}) {
  let current = rows.map((r) => ({ ...r }));
  const searchId = domId('var-search');
  const search = h('input.input.sm.pv-search-input', {
    id: searchId,
    type: 'search',
    placeholder: 'Filter variables',
    autocomplete: 'off',
    spellcheck: false,
    'aria-label': `Filter ${label.toLowerCase()}`,
  });
  const count = h('span.pv-count', { 'aria-live': 'polite' });
  const warn = h('div.callout.pv-dupes', { dataset: { kind: 'warning' }, role: 'status', hidden: true });
  const noMatch = h('p.pv-muted.pv-nomatch', { hidden: true });
  const table = createKvTable({
    rows: current,
    vars,
    label,
    keyLabel: 'Variable',
    keyPlaceholder: 'Variable name',
    valueLabel: 'Value',
    valuePlaceholder: 'Value',
    description: true,
    secret: true,
    readOnly,
    onChange: (next) => {
      current = next;
      renderMeta();
      onChange?.(next);
    },
  });
  const tbody = table.el.querySelector('tbody');
  const toolbar = h(
    'div.pv-toolbar',
    h('div.pv-search', icon('search', 14), search),
    count,
    h('span.spacer'),
    table.bulkToggle,
  );
  const el = h('div.pv-vars', toolbar, warn, table.el, noMatch);

  const filterRows = () => {
    const q = search.value.trim().toLowerCase();
    const byId = new Map(current.map((r) => [r.id, r]));
    let shown = 0;
    for (const tr of tbody.children) {
      const row = byId.get(tr.dataset.id);
      if (!row) {
        tr.hidden = false;
        continue;
      }
      const hay = [row.key, row.secret ? '' : row.value, row.description].join('\n').toLowerCase();
      const match = !q || hay.includes(q);
      tr.hidden = !match && !tr.contains(document.activeElement);
      if (!tr.hidden) shown++;
    }
    noMatch.hidden = !q || shown > 0;
    noMatch.textContent = q ? `No variables match "${search.value.trim()}".` : '';
    return shown;
  };

  function renderMeta() {
    const n = current.length;
    const disabled = current.filter((r) => r.enabled === false).length;
    const q = search.value.trim();
    const total = `${n} ${n === 1 ? 'variable' : 'variables'}${disabled ? `, ${disabled} disabled` : ''}`;
    const shown = filterRows();
    count.textContent = q ? `${shown} of ${total}` : total;
    const seen = new Set();
    const dupes = new Set();
    for (const r of current) {
      if (!r.key || r.enabled === false) continue;
      if (seen.has(r.key)) dupes.add(r.key);
      seen.add(r.key);
    }
    warn.hidden = !dupes.size;
    if (dupes.size) {
      fill(warn, icon('warning', 14), h('div', `${[...dupes].join(', ')} ${dupes.size === 1 ? 'is' : 'are'} defined more than once. The last enabled row is used.`));
    }
  }

  search.addEventListener('input', () => renderMeta());
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      e.stopPropagation();
      search.value = '';
      renderMeta();
    }
  });
  // The table rebuilds its rows when rows are added or removed; keep the filter applied.
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => filterRows()) : null;
  observer?.observe(tbody, { childList: true });
  renderMeta();

  return {
    el,
    search,
    getRows: () => current.map((r) => ({ ...r })),
    /** Replaces rows (remote change) unless they already match; keeps focus on the same cell. */
    setRows(next) {
      if (canonVars(next) === canonVars(current)) return;
      const active = document.activeElement;
      const tr = active && tbody.contains(active) ? active.closest('tr') : null;
      const field = active?.closest?.('[data-field]')?.dataset.field;
      const caret = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
      current = next.map((r) => ({ ...r }));
      table.setRows(current);
      if (tr?.dataset.id && field) {
        const row = tbody.querySelector(`tr[data-id="${CSS.escape(tr.dataset.id)}"]`);
        const target = row?.querySelector(`[data-field="${field}"] input, input[data-field="${field}"]`);
        if (target) {
          target.focus();
          if (caret != null) target.setSelectionRange?.(Math.min(caret, target.value.length), Math.min(caret, target.value.length));
        }
      }
      renderMeta();
    },
    focus() {
      if (current.length) search.focus();
      else tbody.querySelector('tr [data-field="key"] input')?.focus();
    },
    destroy: () => observer?.disconnect(),
  };
}

// View ---------------------------------------------------------------------------

export class EnvironmentView {
  constructor(app, tab) {
    this.app = app;
    this.tab = tab;
    this.id = tab.refId;
    this.isGlobals = this.id === 'globals';
    this.pending = {};
    this.indicator = createSaveIndicator();
    this.save = debounce(() => this.#write(), SAVE_DELAY);
    this.el = h('div.req-view.pv-view.env-view');
    this.#build();
  }

  get env() {
    return this.app.ws.getEnvironment(this.id);
  }

  get isActive() {
    return !this.isGlobals && this.app.environmentId === this.id;
  }

  #build() {
    const env = this.env || { name: 'Environment', variables: [] };
    this.heading = h('h2.sr-only', env.name);
    this.nameInput = null;
    let title;
    if (this.isGlobals) {
      title = h('span.pv-title', icon('globe', 15), h('span', 'Globals'));
    } else {
      this.nameInput = h('input.req-name', {
        type: 'text',
        value: env.name,
        'aria-label': 'Environment name',
        spellcheck: false,
        autocomplete: 'off',
        oninput: () => {
          const v = this.nameInput.value.trim();
          if (!v) return;
          this.#queue({ name: v });
          this.heading.textContent = v;
        },
        onfocus: () => (this.nameAtFocus = this.env?.name || ''),
        onkeydown: (e) => {
          if (isComposing(e)) return;
        if (e.key === 'Enter') this.nameInput.blur();
          else if (e.key === 'Escape') {
            this.#revertName();
            this.nameInput.blur();
          }
        },
        onblur: () => {
          if (!this.nameInput.value.trim()) this.nameInput.value = this.env?.name || '';
        },
      });
      title = h(
        'div.crumbs',
        h('span.crumb.pv-crumb-icon', { 'aria-hidden': 'true' }, icon('globe', 14)),
        h('button.crumb', { type: 'button', title: 'Show environments in the sidebar', onclick: () => this.app.showSection?.('environments') }, 'Environments'),
        h('span.sep', { 'aria-hidden': 'true' }, icon('chevronRight', 12)),
        this.nameInput,
      );
    }

    const actions = [this.indicator.el];
    if (!this.isGlobals) {
      this.activeBtn = h('button.btn.sm.pv-active-btn', { type: 'button', onclick: () => this.#toggleActive() });
      const more = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'More environment actions', title: 'More actions' }, icon('more', 16));
      menuButton(more, () => [
        { label: 'Rename', icon: 'pencil', run: () => { this.nameInput.focus(); this.nameInput.select(); } },
        { label: 'Duplicate', icon: 'copy', run: () => this.#duplicate() },
        { label: 'Export', icon: 'download', run: () => this.#export() },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, run: () => this.app.deleteEnvironment(this.id) },
      ], { align: 'end', label: 'Environment actions' });
      actions.push(this.activeBtn, more);
    }

    this.inactiveNote = h('div.callout.pv-note', { dataset: { kind: 'info' }, hidden: true });
    this.vars = createVariablesEditor({
      rows: env.variables,
      vars: this.app.varsFor?.(null) || null,
      label: this.isGlobals ? 'Global variables' : 'Environment variables',
      onChange: (rows) => this.#queue({ variables: rows }),
    });

    const intro = this.isGlobals
      ? 'Globals apply to every request, whichever environment is active. Use them for values shared by all your work.'
      : 'Variables here apply to every request while this environment is active. Switch environments to send the same requests to another server.';

    this.el.append(
      this.heading,
      h('div.req-head', title, h('div.req-head-actions', actions)),
      h(
        'div.pv-body',
        h(
          'div.pv-section.pv-intro',
          h('p', intro),
          h('p', 'Reference a variable in the URL, params, headers, body or auth as ', h('code.pv-code', '{{name}}'), '. When the same name is set in several places, the narrowest scope wins:'),
          precedenceList(this.isGlobals ? 'globals' : 'environment'),
        ),
        this.inactiveNote,
        this.vars.el,
      ),
    );
    this.#renderActive();
  }

  /** Escape undoes the rename typed since the field got focus, saved or not. */
  #revertName() {
    const saved = this.env?.name || '';
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
    Object.assign(this.pending, patch);
    this.indicator.saving();
    this.save();
  }

  async #write() {
    const patch = this.pending;
    this.pending = {};
    if (!Object.keys(patch).length || !this.env) return;
    try {
      await this.app.ws.updateEnvironment(this.id, (e) => {
        if ('name' in patch) e.name = patch.name;
        if ('variables' in patch) e.variables = normalizeVariables(patch.variables);
      });
      this.indicator.saved();
    } catch (err) {
      this.indicator.failed();
      toast({ kind: 'error', title: 'Could not save the environment', text: err?.message || '' });
    }
  }

  #renderActive() {
    if (this.isGlobals) return;
    const active = this.isActive;
    this.activeBtn.setAttribute('aria-pressed', String(active));
    this.activeBtn.title = active ? 'This environment is active. Click to stop using it.' : 'Use this environment for requests';
    this.activeBtn.classList.toggle('on', active);
    fill(this.activeBtn, icon(active ? 'circleCheck' : 'circle', 14), h('span', active ? 'Active' : 'Set active'));
    this.inactiveNote.hidden = active;
    if (!active) {
      fill(
        this.inactiveNote,
        icon('info', 14),
        h('div', 'This environment is not active, so requests do not use its variables. ', h('button.link-btn', { type: 'button', onclick: () => this.#toggleActive() }, 'Set it active')),
      );
    }
  }

  async #toggleActive() {
    const wasActive = this.isActive;
    await this.app.setEnvironment(wasActive ? null : this.id);
    this.#renderActive();
    if (!wasActive) this.activeBtn.focus();
  }

  async #duplicate() {
    this.save.flush();
    const copy = await this.app.ws.duplicateEnvironment(this.id);
    toast({ kind: 'success', title: 'Environment duplicated', text: `Created "${copy.name}".` });
    this.app.openTab('environment', copy.id);
  }

  #export() {
    this.save.flush();
    import('./dialogs.js').then((m) => m.openExportDialog(this.app, { environmentId: this.id }));
  }

  // Lifecycle ----------------------------------------------------------------------

  onShow({ focus = false } = {}) {
    this.#refresh();
    if (focus) this.vars.focus();
  }

  onHide() {
    this.save.flush();
  }

  focus() {
    this.vars.focus();
    return true;
  }

  onVariablesChanged() {
    this.#renderActive();
  }

  onContextChanged(e) {
    if (e) {
      const mine = this.isGlobals ? e.kind === 'globals' : e.kind === 'environment' && e.id === this.id;
      if (!mine || e.deleted) return;
    }
    // Pending local edits are written first so they are not lost.
    this.save.flush();
    this.#refresh();
  }

  #refresh() {
    const env = this.env;
    if (!env) return;
    if (this.nameInput && document.activeElement !== this.nameInput && this.nameInput.value !== env.name) {
      this.nameInput.value = env.name;
      this.heading.textContent = env.name;
    }
    if (!('variables' in this.pending)) this.vars.setRows(env.variables);
    this.#renderActive();
  }

  destroy() {
    this.save.flush();
    this.vars.destroy();
  }
}

