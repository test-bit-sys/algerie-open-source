/**
 * Collection runner tab: pick requests and options on one side, watch the
 * results arrive on the other. On narrow screens the two stack.
 *
 * Configuration and the last run's results are kept in memory per target
 * (collection or folder id), so closing and reopening the tab keeps them.
 */
import { h, fill, announce, domId, modKey, shortcut } from '../lib/dom.js';
import { formatMs, formatBytes, statusClass, statusText } from '../lib/format.js';
import { runCollection, runnableRequests, planRun, resultOutcome } from '../core/runner.js';
import { parseDataFile, DATA_FILE_ACCEPT } from '../core/data-file.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

const CONFIGS = new Map();
const MAX_DATA_BYTES = 10 * 1048576;
const MAX_ITERATIONS = 10000;
const MAX_DELAY = 600000;
const PAGE = 300;
const PREVIEW_ROWS = 5;
const ANNOUNCE_EVERY_MS = 1500;

function defaultConfig() {
  return {
    iterations: 1,
    iterationsTouched: false,
    iterationsBeforeData: null, // the count a data file replaced, restored when it is removed
    delayMs: 0,
    stopOnError: false,
    keepVariables: true,
    excluded: new Set(),
    order: null,
    dataFile: null, // { name, size, format, rows, columns }
    last: null, // { summary, meta }
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clampInt = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const OUTCOME = {
  passed: { icon: 'circleCheck', label: 'Passed' },
  failed: { icon: 'circleX', label: 'Failed' },
  skipped: { icon: 'circleSlash', label: 'Skipped' },
};

export class RunnerView {
  constructor(app, tab) {
    this.app = app;
    this.tab = tab;
    this.cfg = CONFIGS.get(tab.refId) || defaultConfig();
    CONFIGS.set(tab.refId, this.cfg);
    this.running = false;
    this.controller = null;
    this.filter = 'all';
    this.iterView = 'all';
    this.expanded = new Set();
    this.limit = PAGE;
    this.live = null; // { summary-like object being filled during a run }
    this.progress = { done: 0, total: 0, current: '' };
    this.lastAnnounce = 0;
    this.titleId = domId('runner-title');
    this.#build();
    this.#renderAll();
  }

  // Lifecycle ----------------------------------------------------------------

  onShow({ focus = false } = {}) {
    this.#renderEnv();
    this.#renderHead();
    if (!this.running) this.#renderRequests();
    if (focus) this.focus();
  }

  onHide() {}

  focus() {
    this.runBtn?.focus();
    return true;
  }

  destroy() {
    this.controller?.abort();
    this.controller = null;
  }

  onContextChanged(e) {
    const loc = this.app.ws.locate(this.tab.refId);
    if (!loc) return;
    if (e && e.kind === 'collection' && e.id && e.id !== loc.collection.id) return;
    this.#renderHead();
    // Scripts setting collection variables change the collection on every request of a
    // run: the list is only rebuilt when what it shows changed.
    const list = this.#ordered();
    if (this.#requestsKey(list) !== this.requestsKey) this.#renderRequests(list);
    this.#renderRunMeta(list);
  }

  onVariablesChanged() {
    this.#renderEnv();
  }

  // Data -----------------------------------------------------------------------

  #loc() {
    return this.app.ws.locate(this.tab.refId);
  }

  /** Requests in run order (custom order applied), selected or not. */
  #ordered() {
    return planRun(runnableRequests(this.app.ws, this.tab.refId), { order: this.cfg.order });
  }

  #selected() {
    return this.#ordered().filter((r) => !this.cfg.excluded.has(r.item.id));
  }

  // Build ----------------------------------------------------------------------

  #build() {
    this.crumbsEl = h('nav.crumbs.runner-crumbs', { 'aria-label': 'Location' });
    this.titleEl = h('h2.runner-title', { id: this.titleId });

    // Requests
    this.reqCountEl = h('span.runner-count');
    this.reqListEl = h('ul.runner-reqs', { 'aria-labelledby': `${this.titleId}-reqs` });
    this.resetOrderBtn = h('button.link-btn.runner-reset', { type: 'button', hidden: true, onclick: () => this.#resetOrder() }, 'Reset order');
    const reqSection = h(
      'div.runner-section',
      h(
        'div.runner-section-head',
        h('h3.runner-section-title', { id: `${this.titleId}-reqs` }, 'Requests'),
        this.reqCountEl,
        h('span.spacer'),
        this.resetOrderBtn,
        h('button.btn.sm.ghost', { type: 'button', onclick: () => this.#selectAll(true) }, 'All'),
        h('button.btn.sm.ghost', { type: 'button', onclick: () => this.#selectAll(false) }, 'None'),
      ),
      this.reqListEl,
      h('p.field-hint.runner-reorder-hint', 'Drag the handles, or focus one and press the arrow keys, to change the order.'),
    );

    // Iterations and delay
    const itId = domId('runner-iter');
    const delayId = domId('runner-delay');
    this.iterInput = h('input.input.sm', {
      id: itId, type: 'number', min: '1', max: String(MAX_ITERATIONS), step: '1', inputmode: 'numeric',
      'aria-describedby': `${itId}-hint`,
      oninput: () => {
        this.cfg.iterations = clampInt(this.iterInput.value, 1, MAX_ITERATIONS, this.cfg.iterations);
        this.cfg.iterationsTouched = true;
        this.#renderIterHint();
        this.#renderRunMeta();
      },
      onblur: () => {
        this.iterInput.value = String(this.cfg.iterations);
      },
    });
    this.delayInput = h('input.input.sm', {
      id: delayId, type: 'number', min: '0', max: String(MAX_DELAY), step: '100', inputmode: 'numeric',
      'aria-describedby': `${delayId}-hint`,
      oninput: () => {
        this.cfg.delayMs = clampInt(this.delayInput.value, 0, MAX_DELAY, this.cfg.delayMs);
      },
      onblur: () => {
        this.delayInput.value = String(this.cfg.delayMs);
      },
    });
    this.iterHint = h('p.field-hint', { id: `${itId}-hint` });
    const numbers = h(
      'div.runner-grid',
      h('div.field', h('label', { for: itId }, 'Iterations'), this.iterInput, this.iterHint),
      h('div.field', h('label', { for: delayId }, 'Delay between requests'), h('div.runner-unit', this.delayInput, h('span.runner-unit-label', { 'aria-hidden': 'true' }, 'ms')), h('p.field-hint', { id: `${delayId}-hint` }, 'In milliseconds.')),
    );

    // Data file
    this.fileInput = h('input', { type: 'file', accept: DATA_FILE_ACCEPT, hidden: true, tabindex: '-1', onchange: () => this.#pickFile(this.fileInput.files?.[0]) });
    this.dataErr = h('p.field-error', { role: 'alert' });
    this.dataBody = h('div.runner-data-body');
    this.dataLabelId = domId('runner-data');
    const dataSection = h(
      'div.runner-section',
      { role: 'group', 'aria-labelledby': this.dataLabelId },
      h('div.runner-section-head', h('h3.runner-section-title', { id: this.dataLabelId }, 'Data file'), h('span.runner-optional', 'Optional')),
      this.dataBody,
      this.fileInput,
      this.dataErr,
    );

    // Environment
    this.envEl = h('div.runner-env');
    const envSection = h(
      'div.runner-section',
      h('div.runner-section-head', h('h3.runner-section-title', 'Environment')),
      this.envEl,
      h('p.field-hint', 'Runs use the active environment. Change it with the environment selector in the tab bar.'),
    );

    // Options
    const option = (key, title, desc) => {
      const id = domId('runner-opt');
      const input = h('input.switch', {
        id, type: 'checkbox', role: 'switch', checked: !!this.cfg[key], 'aria-describedby': `${id}-desc`,
        onchange: () => {
          this.cfg[key] = input.checked;
        },
      });
      this[`${key}Input`] = input;
      return h('div.runner-opt', input, h('div.runner-opt-text', h('label', { for: id }, title), h('span.runner-opt-desc', { id: `${id}-desc` }, desc)));
    };
    const optSection = h(
      'div.runner-section',
      h('div.runner-section-head', h('h3.runner-section-title', 'Options')),
      option('stopOnError', 'Stop on first error', 'End the run when a request cannot be sent or a script throws.'),
      option('keepVariables', 'Save variable changes', 'Keep values that scripts set. When off, environment, collection and global variables are restored after the run.'),
    );

    this.fieldset = h('fieldset.runner-fieldset', reqSection, numbers, dataSection, envSection, optSection);

    // Run bar
    this.runBtn = h('button.btn.primary.runner-run-btn', { type: 'submit', 'aria-keyshortcuts': 'Meta+Enter Control+Enter' });
    this.runMeta = h('span.runner-run-meta');
    this.runErr = h('p.field-error.runner-run-err', { role: 'alert' });
    const runBar = h('div.runner-runbar', h('div.runner-runbar-row', this.runBtn, this.runMeta), this.runErr);

    const config = h(
      'section.runner-config',
      { 'aria-labelledby': this.titleId },
      h('div.runner-config-head', this.crumbsEl, this.titleEl),
      h(
        'form.runner-form',
        {
          novalidate: true,
          onsubmit: (e) => {
            e.preventDefault();
            this.toggleRun();
          },
        },
        h('div.runner-config-scroll', { tabindex: '0', role: 'region', 'aria-label': 'Run settings' }, this.fieldset),
        runBar,
      ),
    );

    // Results
    this.progressBar = h('div.runner-progress-fill');
    this.progressEl = h('div.runner-progress', { role: 'progressbar', 'aria-label': 'Run progress', 'aria-valuemin': '0' }, this.progressBar);
    this.progressText = h('span.runner-progress-text');
    this.progressWrap = h('div.runner-progress-wrap', { hidden: true }, this.progressText, this.progressEl);
    this.statsEl = h('ul.runner-stats', { 'aria-label': 'Run summary' });
    this.filterEl = h('div.segmented.runner-filter', { role: 'group', 'aria-label': 'Show results' });
    this.iterSelect = h('select.select.sm.runner-iter-select', { 'aria-label': 'Iteration', onchange: () => {
      this.iterView = this.iterSelect.value;
      this.limit = PAGE;
      this.#renderResults();
    } });
    this.iterWrap = h('div.runner-iter-wrap', { hidden: true }, this.iterSelect);
    this.retryBtn = h('button.btn.sm', { type: 'button', hidden: true, onclick: () => this.#retryFailed() }, icon('refresh', 14), h('span', 'Rerun failed'));
    this.exportBtn = h('button.btn.sm', { type: 'button', onclick: () => this.#export() }, icon('download', 14), h('span', 'Export'));
    this.toolbar = h('div.runner-toolbar', this.filterEl, this.iterWrap, h('span.spacer'), this.retryBtn, this.exportBtn);
    this.noticeEl = h('div.runner-notices');
    this.listEl = h('ol.runner-results-list', { 'aria-label': 'Request results', tabindex: '-1' });
    this.moreBtn = h('button.btn.sm.runner-more', { type: 'button', hidden: true, onclick: () => {
      this.limit += PAGE;
      this.#renderResults();
    } });
    this.emptyEl = h('div.empty.runner-empty');
    this.resultsBody = h('div.runner-results-body', this.statsEl, this.toolbar, this.noticeEl, this.listEl, this.moreBtn);
    this.resultsEl = h(
      'section.runner-results',
      { 'aria-label': 'Run results' },
      this.progressWrap,
      h('div.runner-results-scroll', this.emptyEl, this.resultsBody),
    );

    this.el = h(
      'div.runner-view',
      {
        onkeydown: (e) => {
          if (modKey(e) && !e.altKey && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            this.toggleRun();
          }
        },
      },
      h('div.runner-layout', config, this.resultsEl),
    );
  }

  #renderAll() {
    this.iterInput.value = String(this.cfg.iterations);
    this.delayInput.value = String(this.cfg.delayMs);
    this.#renderHead();
    this.#renderRequests();
    this.#renderData();
    this.#renderEnv();
    this.#renderIterHint();
    this.#renderRunButton();
    this.#renderRunMeta();
    this.#renderResultsArea();
    this.#renderProgress();
  }

  // Header -----------------------------------------------------------------------

  #renderHead() {
    const loc = this.#loc();
    if (!loc) return;
    const chain = [...loc.parents, loc.item];
    const crumbs = [];
    chain.forEach((node, i) => {
      if (i) crumbs.push(h('span.sep', { 'aria-hidden': 'true' }, icon('chevronRight', 12)));
      const kind = node.type === 'collection' ? 'collection' : 'folder';
      crumbs.push(
        i < chain.length - 1 || chain.length === 1
          ? h('button.crumb', { type: 'button', title: `Open ${node.name}`, onclick: () => this.app.openTab(kind, node.id) }, node.name)
          : h('span.crumb', { 'aria-current': 'page' }, node.name),
      );
    });
    fill(this.crumbsEl, crumbs);
    this.titleEl.textContent = `Run ${loc.item.name}`;
  }

  // Requests ---------------------------------------------------------------------

  /** What the request list shows, to tell whether it needs rebuilding. */
  #requestsKey(list) {
    const base = this.#loc()?.parents.length + 1 || 1;
    const rows = list.map(({ item, parents }) => [item.id, item.method, item.name, parents.slice(base).map((p) => p.name).join(' / '), !this.cfg.excluded.has(item.id)]);
    return JSON.stringify([!!this.cfg.order, rows]);
  }

  #renderRequests(list = this.#ordered()) {
    this.requestsKey = this.#requestsKey(list);
    const total = list.length;
    const selected = list.filter((r) => !this.cfg.excluded.has(r.item.id)).length;
    this.reqCountEl.textContent = total ? `${selected} of ${total} selected` : '';
    this.resetOrderBtn.hidden = !this.cfg.order;
    if (!total) {
      fill(this.reqListEl, h('li.runner-reqs-empty', icon('info', 14), h('span', 'There are no requests here yet. Add some to the collection to run them.')));
      return;
    }
    const base = this.#loc()?.parents.length + 1 || 1;
    fill(
      this.reqListEl,
      list.map(({ item, parents }, i) => {
        const path = parents.slice(base).map((p) => p.name).join(' / ');
        const id = domId('runner-req');
        const check = h('input', {
          type: 'checkbox', id, checked: !this.cfg.excluded.has(item.id),
          onchange: () => {
            if (check.checked) this.cfg.excluded.delete(item.id);
            else this.cfg.excluded.add(item.id);
            this.#renderRequestCount();
            this.#renderRunMeta();
          },
        });
        const grip = h(
          'button.runner-grip',
          {
            type: 'button',
            'aria-label': `Move ${item.name}, position ${i + 1} of ${total}`,
            title: 'Drag or use arrow keys to reorder',
            onkeydown: (e) => {
              const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
              if (!d) return;
              e.preventDefault();
              this.#move(item.id, d);
            },
          },
          icon('grip', 14),
        );
        const li = h(
          'li.runner-req',
          { draggable: 'true', dataset: { id: item.id } },
          grip,
          h(
            'label.runner-req-label',
            { for: id },
            check,
            h('span.method', { dataset: { m: item.method } }, item.method),
            h('span.runner-req-name', { title: item.name }, item.name),
            path ? h('span.runner-req-path', { title: path }, path) : null,
          ),
        );
        this.#wireDrag(li, item.id);
        return li;
      }),
    );
  }

  #renderRequestCount() {
    const list = this.#ordered();
    const selected = list.filter((r) => !this.cfg.excluded.has(r.item.id)).length;
    this.reqCountEl.textContent = list.length ? `${selected} of ${list.length} selected` : '';
  }

  #selectAll(on) {
    if (on) this.cfg.excluded.clear();
    else for (const r of this.#ordered()) this.cfg.excluded.add(r.item.id);
    this.#renderRequests();
    this.#renderRunMeta();
    announce(on ? 'All requests selected' : 'No requests selected');
  }

  #move(id, delta, toIndex = null) {
    const ids = this.#ordered().map((r) => r.item.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    let to = toIndex != null ? toIndex : delta === -Infinity ? 0 : delta === Infinity ? ids.length - 1 : from + delta;
    to = Math.max(0, Math.min(ids.length - 1, to));
    if (to === from) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    this.cfg.order = ids;
    this.#renderRequests();
    this.reqListEl.querySelector(`[data-id="${CSS.escape(id)}"] .runner-grip`)?.focus();
    const name = this.app.ws.locate(id)?.item.name || 'Request';
    announce(`${name} moved to position ${to + 1} of ${ids.length}`);
  }

  #resetOrder() {
    this.cfg.order = null;
    this.#renderRequests();
    announce('Order reset to the collection order');
  }

  #wireDrag(li, id) {
    li.addEventListener('dragstart', (e) => {
      if (this.running) return e.preventDefault();
      this.dragId = id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });
    li.addEventListener('dragend', () => {
      this.dragId = null;
      li.classList.remove('dragging');
      for (const el of this.reqListEl.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
    });
    li.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      li.classList.toggle('drop-after', after);
      li.classList.toggle('drop-before', !after);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', (e) => {
      if (!this.dragId || this.dragId === id) return;
      e.preventDefault();
      const after = li.classList.contains('drop-after');
      li.classList.remove('drop-before', 'drop-after');
      const ids = this.#ordered().map((r) => r.item.id);
      const from = ids.indexOf(this.dragId);
      let to = ids.indexOf(id) + (after ? 1 : 0);
      if (from < to) to -= 1;
      this.#move(this.dragId, 0, to);
    });
  }

  // Iterations ---------------------------------------------------------------------

  #renderIterHint() {
    const rows = this.cfg.dataFile?.rows.length || 0;
    const n = this.cfg.iterations;
    if (!rows) {
      fill(this.iterHint, 'Times to run the selected requests.');
      return;
    }
    const text = n === rows ? 'One iteration per data row.' : n < rows ? `Uses the first ${plural(n, 'row')} of ${rows}.` : `Rows repeat after row ${rows}.`;
    // More rows than a run allows: say so rather than offer a count that cannot be set.
    if (rows > MAX_ITERATIONS) {
      fill(this.iterHint, `${text} A run has at most ${MAX_ITERATIONS} iterations.`);
      return;
    }
    fill(
      this.iterHint,
      text,
      n !== rows ? [' ', h('button.link-btn', { type: 'button', onclick: () => this.#setIterations(rows) }, `Use ${rows}`)] : null,
    );
  }

  #setIterations(n) {
    this.cfg.iterations = clampInt(n, 1, MAX_ITERATIONS, 1);
    this.iterInput.value = String(this.cfg.iterations);
    this.#renderIterHint();
    this.#renderRunMeta();
  }

  // Data file -------------------------------------------------------------------------

  #renderData() {
    const df = this.cfg.dataFile;
    if (!df) {
      const choose = h('button.btn.sm', { type: 'button', onclick: () => this.fileInput.click() }, icon('upload', 14), h('span', 'Choose file'));
      const zone = h('div.runner-drop', choose, h('span.runner-drop-text', 'or drop a CSV or JSON file here. Each row becomes one iteration; use columns as {{variables}}.'));
      zone.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        zone.classList.add('over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        zone.classList.remove('over');
        if (!this.running) this.#pickFile(e.dataTransfer.files[0]);
      });
      fill(this.dataBody, zone);
      return;
    }
    const shown = df.rows.slice(0, PREVIEW_ROWS);
    const more = df.rows.length - shown.length;
    const previewId = domId('runner-preview');
    fill(
      this.dataBody,
      h(
        'div.runner-file',
        icon(df.format === 'json' ? 'fileJson' : 'fileText', 18),
        h(
          'div.runner-file-text',
          h('span.runner-file-name', { title: df.name }, df.name),
          h('span.runner-file-meta', `${plural(df.rows.length, 'row')}, ${plural(df.columns.length, 'column')}, ${df.format.toUpperCase()}, ${formatBytes(df.size)}`),
        ),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': `Replace data file ${df.name}`, title: 'Replace', onclick: () => this.fileInput.click() }, icon('refresh', 14)),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove data file ${df.name}`, title: 'Remove', onclick: () => this.#removeFile() }, icon('x', 14)),
      ),
      h(
        'div.runner-preview-wrap',
        { role: 'region', tabindex: '0', 'aria-labelledby': previewId },
        h(
          'table.runner-preview',
          h('caption.sr-only', { id: previewId }, `Preview of the first ${plural(shown.length, 'row')} of ${df.name}`),
          h('thead', h('tr', h('th', { scope: 'col' }, h('span.sr-only', 'Row')), df.columns.map((c) => h('th', { scope: 'col', title: c }, c)))),
          h(
            'tbody',
            shown.map((row, i) => h('tr', h('th.runner-preview-n', { scope: 'row' }, String(i + 1)), df.columns.map((c) => {
              const v = row[c] == null ? '' : String(row[c]);
              return h('td', { title: v }, v);
            }))),
          ),
        ),
      ),
      more > 0 ? h('p.field-hint', `and ${plural(more, 'more row')}`) : null,
      df.columns.length ? h('p.field-hint.runner-vars-hint', 'Variables: ', df.columns.slice(0, 8).map((c, i) => [i ? ', ' : '', h('code', `{{${c}}}`)]), df.columns.length > 8 ? `, and ${df.columns.length - 8} more` : '') : null,
    );
  }

  async #pickFile(file) {
    this.fileInput.value = '';
    if (!file) return;
    this.dataErr.textContent = '';
    if (file.size > MAX_DATA_BYTES) {
      this.dataErr.textContent = `"${file.name}" is larger than ${formatBytes(MAX_DATA_BYTES)}. Use a smaller file.`;
      return;
    }
    let parsed;
    try {
      const text = await file.text();
      parsed = parseDataFile(text, file.name);
    } catch (err) {
      this.dataErr.textContent = `Could not use "${file.name}": ${err.message}`;
      return;
    }
    this.cfg.dataFile = { name: file.name, size: file.size, ...parsed };
    if (!this.cfg.iterationsTouched || this.cfg.iterations === 1) {
      this.cfg.iterationsBeforeData ??= this.cfg.iterations;
      this.#setIterations(parsed.rows.length);
    }
    this.#renderData();
    this.#renderIterHint();
    this.#renderRunMeta();
    announce(`${file.name} loaded: ${plural(parsed.rows.length, 'row')}, ${plural(parsed.columns.length, 'column')}`);
  }

  #removeFile() {
    const name = this.cfg.dataFile?.name;
    const rows = this.cfg.dataFile?.rows.length;
    this.cfg.dataFile = null;
    this.dataErr.textContent = '';
    // Undo the count the file set, unless it has been changed since.
    const before = this.cfg.iterationsBeforeData;
    this.cfg.iterationsBeforeData = null;
    // Unless the count was changed since: a file longer than the limit set it to the limit.
    if (before != null && this.cfg.iterations === Math.min(rows, MAX_ITERATIONS)) this.#setIterations(before);
    this.#renderData();
    this.#renderIterHint();
    this.#renderRunMeta();
    this.dataBody.querySelector('button')?.focus();
    announce(`${name || 'Data file'} removed`);
  }

  // Environment ---------------------------------------------------------------------

  #renderEnv() {
    const id = this.app.environmentId;
    const env = id ? this.app.ws.getEnvironment(id) : null;
    fill(
      this.envEl,
      icon(env ? 'globe' : 'circleSlash', 14),
      h(`span.runner-env-name${env ? '' : '.none'}`, env ? env.name : 'No environment'),
      env ? h('span.runner-env-count', plural(env.variables.filter((v) => v.enabled !== false && v.key).length, 'variable')) : null,
    );
  }

  // Run button ---------------------------------------------------------------------------

  #renderRunButton() {
    if (this.running) {
      fill(this.runBtn, icon('stop', 14), h('span', 'Stop'));
      this.runBtn.classList.add('stop');
      this.runBtn.title = `Stop the run (${shortcut('Mod+Enter')})`;
    } else {
      fill(this.runBtn, icon('play', 14), h('span', 'Run'));
      this.runBtn.classList.remove('stop');
      this.runBtn.title = `Run (${shortcut('Mod+Enter')})`;
    }
    // Disabling the settings (or hiding Rerun failed) would drop focus to the page; Stop is the control that matters now.
    const active = document.activeElement;
    if (this.running && (this.fieldset.contains(active) || active === this.retryBtn)) this.runBtn.focus();
    this.fieldset.disabled = this.running;
  }

  #renderRunMeta(list = this.#ordered()) {
    const n = list.filter((r) => !this.cfg.excluded.has(r.item.id)).length;
    const it = this.cfg.iterations;
    this.runMeta.textContent = !n ? 'No requests selected' : it > 1 ? `${plural(n, 'request')} x ${plural(it, 'iteration')}` : plural(n, 'request');
    if (n) this.runErr.textContent = '';
  }

  toggleRun() {
    if (this.running) {
      this.controller?.abort();
      return;
    }
    this.#run();
  }

  async #run({ only = null } = {}) {
    const loc = this.#loc();
    if (!loc) return;
    // Rerunning failures runs exactly those, even ones unchecked since.
    const selected = only ? this.#ordered().filter((r) => only.has(r.item.id)) : this.#selected();
    if (!selected.length) {
      this.runErr.textContent = only ? 'The failed requests are no longer in this collection.' : 'Select at least one request to run.';
      return;
    }
    this.runErr.textContent = '';
    this.cfg.iterations = clampInt(this.iterInput.value, 1, MAX_ITERATIONS, this.cfg.iterations);
    this.cfg.delayMs = clampInt(this.delayInput.value, 0, MAX_DELAY, this.cfg.delayMs);
    this.iterInput.value = String(this.cfg.iterations);
    this.delayInput.value = String(this.cfg.delayMs);

    const env = this.app.environmentId ? this.app.ws.getEnvironment(this.app.environmentId) : null;
    const meta = {
      target: { id: loc.item.id, type: loc.item.type, name: loc.item.name },
      collection: { id: loc.collection.id, name: loc.collection.name },
      environment: env ? { id: env.id, name: env.name } : null,
      options: {
        iterations: this.cfg.iterations,
        delayMs: this.cfg.delayMs,
        stopOnError: this.cfg.stopOnError,
        keepVariables: this.cfg.keepVariables,
        dataFile: this.cfg.dataFile ? { name: this.cfg.dataFile.name, rows: this.cfg.dataFile.rows.length, columns: this.cfg.dataFile.columns } : null,
        requests: selected.map((r) => r.item.id),
      },
    };
    this.controller = new AbortController();
    this.running = true;
    this.expanded.clear();
    this.filter = 'all';
    this.iterView = 'all';
    this.limit = PAGE;
    this.live = { name: loc.item.name, iterations: [], totals: { requests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, timeMs: 0, responseTimeMs: 0 }, stopped: false, aborted: false, startedAt: Date.now() };
    this.liveMeta = meta;
    // Running tallies per iteration view ('all' or an index), so each new result costs O(1) to show.
    this.liveCounts = new Map();
    this.progress = { done: 0, total: selected.length * this.cfg.iterations, current: '' };
    this.cfg.last = null;
    this.#renderRunButton();
    this.#renderResultsArea();
    this.#renderProgress();
    announce(`Run started: ${plural(this.progress.total, 'request')}`);
    this.app.setStatus?.(`Running ${loc.item.name}`);
    if (this.el.clientWidth && this.el.clientWidth < 720) this.resultsEl.scrollIntoView?.({ block: 'start', behavior: matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

    let summary = null;
    try {
      summary = await runCollection({
        ws: this.app.ws,
        targetId: this.tab.refId,
        environmentId: this.app.environmentId,
        sandbox: this.app.sandbox,
        sendOptions: this.app.sendOptions?.() || {},
        iterations: this.cfg.iterations,
        delayMs: this.cfg.delayMs,
        data: this.cfg.dataFile?.rows || null,
        stopOnError: this.cfg.stopOnError,
        keepVariables: this.cfg.keepVariables,
        local: new Map(),
        signal: this.controller.signal,
        selection: new Set(selected.map((r) => r.item.id)),
        order: this.cfg.order,
        onLog: (entry) => this.app.console?.add?.(entry),
        onEvent: (e) => this.#onEvent(e),
      });
    } catch (err) {
      toast({ kind: 'error', title: 'The run could not finish', text: err?.message || String(err) });
    }
    this.running = false;
    this.controller = null;
    if (summary) this.cfg.last = { summary, meta };
    else if (this.live) this.cfg.last = { summary: { ...this.live, finishedAt: Date.now(), stopped: true }, meta };
    this.live = null;
    this.#renderRunButton();
    this.#renderResultsArea();
    this.#renderProgress();
    const s = this.cfg.last?.summary;
    if (s) {
      const t = s.totals;
      const text = `${s.aborted ? 'Run stopped' : 'Run finished'}. ${plural(t.requests, 'request')}, ${t.passed} tests passed, ${t.failed} failed${t.errors ? `, ${plural(t.errors, 'error')}` : ''}.`;
      announce(text);
      this.app.setStatus?.(text);
    }
  }

  #retryFailed() {
    const s = this.cfg.last?.summary;
    if (!s || this.running) return;
    const ids = new Set();
    for (const it of s.iterations) for (const r of it.results) if (resultOutcome(r) === 'failed') ids.add(r.requestId);
    if (ids.size) this.#run({ only: ids });
  }

  #onEvent(e) {
    const live = this.live;
    if (!live) return;
    if (e.type === 'start') {
      this.progress.total = e.total;
      this.#renderProgress();
    } else if (e.type === 'request-start') {
      this.progress.current = e.request.name;
      this.progress.total = Math.max(this.progress.total, e.total);
      this.#renderProgress();
      const now = Date.now();
      if (now - this.lastAnnounce > ANNOUNCE_EVERY_MS) {
        this.lastAnnounce = now;
        announce(`Running ${e.done + 1} of ${this.progress.total}`);
      }
    } else if (e.type === 'request') {
      this.app.afterRelay?.(e.raw?.response);
      let it = live.iterations[e.iteration];
      if (!it) {
        it = live.iterations[e.iteration] = { index: e.iteration, results: [], warnings: [] };
      }
      it.results.push(e.result);
      const outcome = resultOutcome(e.result);
      for (const key of ['all', String(e.result.iteration)]) {
        const c = this.liveCounts.get(key) || { all: 0, passed: 0, failed: 0, skipped: 0, timed: 0 };
        c.all++;
        c[outcome]++;
        if (e.result.timeMs != null) c.timed++;
        this.liveCounts.set(key, c);
      }
      const t = live.totals;
      t.requests++;
      if (e.result.error) t.errors++;
      if (e.result.timeMs != null) t.responseTimeMs += e.result.timeMs;
      for (const test of e.result.tests) {
        if (test.skipped) t.skipped++;
        else if (test.passed) t.passed++;
        else t.failed++;
      }
      t.timeMs = Date.now() - live.startedAt;
      this.progress.done = e.done;
      this.progress.total = Math.max(this.progress.total, e.total);
      this.#renderProgress();
      this.#renderStats();
      this.#renderFilter();
      this.#renderIterSelect();
      this.#appendResult(e.result);
    } else if (e.type === 'iteration') {
      live.iterations[e.index] = e.iteration;
    }
  }

  // Results ------------------------------------------------------------------------------

  #current() {
    if (this.live) return { summary: this.live, meta: this.liveMeta };
    return this.cfg.last;
  }

  #renderResultsArea() {
    const cur = this.#current();
    const has = !!cur;
    this.resultsBody.hidden = !has;
    this.emptyEl.hidden = has;
    if (!has) {
      fill(
        this.emptyEl,
        icon('listChecks', 28),
        h('p.empty-title', 'No results yet'),
        h('p', 'Choose requests and options, then select Run. Results appear here as each request finishes.'),
        h('p.runner-empty-kbd', h('kbd', shortcut('Mod+Enter')), ' starts the run'),
      );
      return;
    }
    this.#renderStats();
    this.#renderFilter();
    this.#renderIterSelect();
    this.#renderNotices();
    this.#renderResults();
    this.exportBtn.disabled = this.running;
    const failedAny = !this.running && cur.summary.iterations.some((it) => it.results.some((r) => resultOutcome(r) === 'failed'));
    this.retryBtn.hidden = !failedAny;
  }

  #renderProgress() {
    const { current } = this.progress;
    let { done, total } = this.progress;
    const show = this.running || !!this.cfg.last;
    this.progressWrap.hidden = !show;
    if (!show) return;
    const last = this.running ? null : this.cfg.last;
    if (last) {
      // From the kept results: a run that stopped early shows how far it got, a finished one is full.
      const o = last.meta?.options;
      done = last.summary.totals.requests;
      total = last.summary.stopped && o ? Math.max(o.requests.length * o.iterations, done) : done;
    }
    const max = Math.max(total, done, 1);
    const now = last && !last.summary.stopped ? max : done;
    this.progressBar.style.width = `${Math.min(100, (now / max) * 100)}%`;
    this.progressEl.setAttribute('aria-valuemax', String(max));
    this.progressEl.setAttribute('aria-valuenow', String(now));
    this.progressWrap.dataset.state = this.running ? 'running' : this.cfg.last?.summary.aborted ? 'stopped' : 'done';
    let text;
    if (this.running) text = `Running ${Math.min(done + 1, Math.max(total, done + 1))} of ${Math.max(total, done + 1)}${current ? `: ${current}` : ''}`;
    else {
      const s = this.cfg.last?.summary;
      const reason = s?.aborted ? 'Stopped' : s?.stopReason === 'script' ? 'Stopped by a script' : s?.stopReason === 'error' ? 'Stopped after an error' : 'Finished';
      text = `${reason}: ${plural(s?.totals.requests || 0, 'request')} in ${formatMs(s?.totals.timeMs || 0)}`;
    }
    this.progressText.textContent = text;
    this.progressEl.setAttribute('aria-valuetext', text);
  }

  #renderStats() {
    const cur = this.#current();
    if (!cur) return;
    const t = cur.summary.totals;
    const timed = this.#counts('all').timed;
    const avg = timed ? t.responseTimeMs / timed : null;
    const stat = (cls, ic, value, label, title) => h(`li.runner-stat${cls}`, { title }, icon(ic, 14), h('strong', value), h('span', label));
    fill(
      this.statsEl,
      stat('', 'send', String(t.requests), t.requests === 1 ? 'request' : 'requests'),
      stat('.ok', 'circleCheck', String(t.passed), 'passed', 'Tests passed'),
      stat(t.failed ? '.bad' : '', 'circleX', String(t.failed), 'failed', 'Tests failed'),
      t.errors ? stat('.bad', 'alert', String(t.errors), t.errors === 1 ? 'error' : 'errors', 'Requests that could not be sent or whose scripts threw') : null,
      t.skipped ? stat('', 'circleSlash', String(t.skipped), 'skipped', 'Tests skipped') : null,
      stat('', 'clock', formatMs(t.timeMs || 0), 'total', 'Total run time'),
      avg != null ? stat('', 'timer', formatMs(avg), 'average', 'Average response time') : null,
    );
  }

  #allResults() {
    const cur = this.#current();
    if (!cur) return [];
    const out = [];
    for (const it of cur.summary.iterations) if (it) for (const r of it.results) out.push(r);
    return out;
  }

  #matches(r) {
    if (this.iterView !== 'all' && String(r.iteration) !== this.iterView) return false;
    if (this.filter === 'all') return true;
    return resultOutcome(r) === this.filter;
  }

  /** Result tallies for an iteration view: from the running tallies during a run, by scanning otherwise. */
  #counts(view = this.iterView) {
    if (this.live && this.liveCounts) return this.liveCounts.get(view) || { all: 0, passed: 0, failed: 0, skipped: 0, timed: 0 };
    const c = { all: 0, passed: 0, failed: 0, skipped: 0, timed: 0 };
    for (const r of this.#allResults()) {
      if (view !== 'all' && String(r.iteration) !== view) continue;
      c.all++;
      c[resultOutcome(r)]++;
      if (r.timeMs != null) c.timed++;
    }
    return c;
  }

  #renderFilter() {
    const count = this.#counts();
    // Built once and updated in place, so focus and screen reader context survive live updates.
    if (!this.filterBtns || this.filterBtns[0].parentNode !== this.filterEl) {
      const btn = (key, label) =>
        h(
          'button',
          {
            type: 'button',
            dataset: { key },
            onclick: () => {
              this.filter = key;
              this.limit = PAGE;
              this.#renderFilter();
              this.#renderResults();
            },
          },
          key === 'passed' ? icon('circleCheck', 13) : key === 'failed' ? icon('circleX', 13) : null,
          h('span', label),
          h('span.runner-filter-count'),
        );
      this.filterBtns = [btn('all', 'All'), btn('passed', 'Passed'), btn('failed', 'Failed')];
      fill(this.filterEl, this.filterBtns);
    }
    for (const b of this.filterBtns) {
      b.setAttribute('aria-pressed', String(this.filter === b.dataset.key));
      b.querySelector('.runner-filter-count').textContent = String(count[b.dataset.key]);
    }
  }

  #renderIterSelect() {
    const cur = this.#current();
    const n = cur ? Math.max(cur.summary.iterations.length, cur.meta?.options.iterations || 1) : 1;
    this.iterWrap.hidden = n <= 1;
    if (n <= 1) return;
    if (this.iterSelect.options.length === n + 1) {
      this.iterSelect.value = this.iterView;
      return;
    }
    fill(
      this.iterSelect,
      h('option', { value: 'all', selected: this.iterView === 'all' }, 'All iterations'),
      Array.from({ length: n }, (_, i) => h('option', { value: String(i), selected: this.iterView === String(i) }, `Iteration ${i + 1}`)),
    );
  }

  #renderNotices() {
    const cur = this.#current();
    const warnings = [];
    for (const it of cur?.summary.iterations || []) for (const w of it?.warnings || []) warnings.push(w);
    fill(this.noticeEl, warnings.slice(0, 5).map((w) => h('div.callout', { dataset: { kind: 'warning' } }, icon('warning', 14), h('span', w))));
  }

  #renderResults() {
    const cur = this.#current();
    if (!cur) return;
    const rows = this.#allResults().filter((r) => this.#matches(r));
    // Rebuilding drops focus from a row or from Show more as it hides; put it back afterwards.
    const active = document.activeElement;
    const focusKey = this.listEl.contains(active) ? active.closest('.run-row')?.querySelector('.run-row-toggle').dataset.key || '' : null;
    const moreFocused = active === this.moreBtn;
    this.renderedCount = 0;
    this.lastGroup = null;
    this.listEl.replaceChildren();
    if (!rows.length) this.listEl.append(h('li.runner-results-empty', this.#emptyText()));
    for (const r of rows.slice(0, this.limit)) this.#appendRow(r);
    this.#renderMore(rows.length);
    if (focusKey != null || (moreFocused && this.moreBtn.hidden)) {
      (this.listEl.querySelector(`.run-row-toggle[data-key="${focusKey}"]`) || this.listEl).focus();
    }
  }

  /** What an empty list says: waiting only until the first result, whatever the filter. */
  #emptyText() {
    const yet = this.running ? ' yet' : '';
    if (this.running && !this.#counts().all) return 'Waiting for the first result...';
    return this.filter === 'failed' ? `Nothing failed${yet}.` : this.filter === 'passed' ? `Nothing passed${yet}.` : 'No requests ran.';
  }

  #renderMore(total) {
    const rest = total - this.renderedCount;
    this.moreBtn.hidden = rest <= 0;
    if (rest > 0) this.moreBtn.textContent = `Show ${Math.min(PAGE, rest)} more of ${rest}`;
  }

  /** Adds a newly finished result while a run is in progress. */
  #appendResult(r) {
    const empty = this.listEl.querySelector('.runner-results-empty');
    if (!this.#matches(r)) {
      if (empty) empty.textContent = this.#emptyText();
      return;
    }
    empty?.remove();
    const total = this.#counts()[this.filter];
    if (this.renderedCount < this.limit) this.#appendRow(r);
    this.#renderMore(total);
  }

  #appendRow(r) {
    const cur = this.#current();
    const multi = (cur?.meta?.options.iterations || 1) > 1 && this.iterView === 'all';
    if (multi && this.lastGroup !== r.iteration) {
      this.lastGroup = r.iteration;
      const data = cur.summary.iterations[r.iteration]?.data || cur.meta?.options.dataFile ? this.#dataFor(r.iteration) : null;
      this.listEl.append(
        h(
          'li.runner-iter-head',
          h('span.runner-iter-title', `Iteration ${r.iteration + 1}`),
          data ? h('span.runner-iter-data', { title: data }, data) : null,
        ),
      );
    }
    this.listEl.append(this.#row(r));
    this.renderedCount++;
  }

  #dataFor(i) {
    const rows = this.cfg.dataFile?.rows;
    const row = this.#current()?.summary.iterations[i]?.data || (rows?.length ? rows[i % rows.length] : null);
    if (!row) return null;
    return Object.entries(row)
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
  }

  #row(r) {
    const key = `${r.iteration}:${r.step}`;
    const outcome = resultOutcome(r);
    const o = OUTCOME[outcome];
    const detailId = domId('run-detail');
    const open = this.expanded.has(key);
    const testsRun = r.tests.filter((t) => !t.skipped);
    const passedTests = testsRun.filter((t) => t.passed).length;
    const pill = r.status != null
      ? h('span.status-pill', { dataset: { class: statusClass(r.status) }, title: statusText(r.status, r.statusText) }, String(r.status))
      : r.skipped
        ? h('span.badge', 'Skipped')
        : h('span.status-pill', { dataset: { class: 'none' } }, 'Error');
    const detail = h('div.run-detail', { id: detailId, hidden: !open });
    const toggle = h(
      'button.run-row-toggle',
      {
        type: 'button',
        dataset: { key },
        'aria-expanded': String(open),
        'aria-controls': detailId,
        onclick: () => {
          const now = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(now));
          detail.hidden = !now;
          if (now) {
            this.expanded.add(key);
            if (!detail.firstChild) fill(detail, this.#detail(r));
          } else this.expanded.delete(key);
        },
      },
      h('span.run-chevron', icon('chevronRight', 14)),
      h(`span.run-outcome.${outcome}`, icon(o.icon, 15), h('span.sr-only', `${o.label}: `)),
      pill,
      h('span.method', { dataset: { m: r.method } }, r.method),
      h('span.run-name', { title: r.name }, r.name),
      h('span.run-url', { title: r.url }, r.url || 'No URL'),
      h(
        'span.run-meta',
        testsRun.length ? h(`span.run-tests${passedTests < testsRun.length ? '.bad' : ''}`, { title: `${passedTests} of ${testsRun.length} tests passed` }, `${passedTests}/${testsRun.length}`, h('span.sr-only', ' tests passed')) : null,
        r.timeMs != null ? h('span.run-time', formatMs(r.timeMs)) : null,
        r.size != null ? h('span.run-size', formatBytes(r.size)) : null,
      ),
    );
    if (open) fill(detail, this.#detail(r));
    return h(`li.run-row`, { dataset: { outcome } }, toggle, detail);
  }

  #detail(r) {
    const tests = r.tests;
    return [
      r.error
        ? h('div.callout', { dataset: { kind: 'error' } }, icon('alert', 14), h('div', h('div', r.error.message), r.error.hint ? h('div.run-hint', r.error.hint) : null))
        : null,
      tests.length
        ? h(
            'ul.run-tests-list',
            { 'aria-label': 'Tests' },
            tests.map((t) => {
              const kind = t.skipped ? 'skipped' : t.passed ? 'passed' : 'failed';
              return h(
                `li.run-test.${kind}`,
                icon(OUTCOME[kind].icon, 14),
                h('span.sr-only', `${OUTCOME[kind].label}: `),
                h('span.run-test-name', t.name),
                t.error && !t.passed ? h('span.run-test-err', t.error) : null,
              );
            }),
          )
        : r.error ? null : h('p.run-none', 'No tests in this request.'),
      r.warnings?.length ? h('ul.run-warnings', r.warnings.map((w) => h('li', icon('warning', 13), h('span', typeof w === 'string' ? w : w?.message || String(w))))) : null,
      h(
        'div.run-detail-actions',
        h('span.run-detail-url', r.url || 'No URL'),
        this.app.ws.locate(r.requestId)
          ? h('button.link-btn', { type: 'button', onclick: () => this.app.openTab('request', r.requestId) }, 'Open request')
          : null,
      ),
    ];
  }

  // Export ---------------------------------------------------------------------------------

  #export() {
    const cur = this.#current();
    if (!cur) return;
    const { summary, meta } = cur;
    const out = {
      kind: 'run-results',
      exportedAt: new Date().toISOString(),
      ...meta,
      startedAt: new Date(summary.startedAt).toISOString(),
      finishedAt: summary.finishedAt ? new Date(summary.finishedAt).toISOString() : null,
      stopped: !!summary.stopped,
      stopReason: summary.stopReason || null,
      totals: summary.totals,
      iterations: summary.iterations.filter(Boolean).map((it) => ({
        index: it.index,
        data: it.data ?? null,
        warnings: it.warnings || [],
        results: it.results,
      })),
    };
    const slug = (meta.target.name || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
    const stamp = new Date(summary.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `${slug}-run-${stamp}.json`, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Run results exported');
  }
}
