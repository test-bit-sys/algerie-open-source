/**
 * Console panel under the editor: every request sent and everything scripts
 * log. Rows are appended as entries arrive (never rebuilt), entries are capped,
 * and while the panel is closed new rows wait until it opens. Errors that
 * arrive while it is closed show as a badge on the status bar button.
 *
 * Entries:
 *   { kind: 'request', level, method, url, status, timeMs, size, transport, requestHeaders, responseHeaders, error, source?, at }
 *     (source is 'script' for a request a script sent with send())
 *   { kind: 'script', level: 'log'|'info'|'warn'|'error'|'debug', args, source, phase, at }
 */
import { h, fill, domId, announce } from '../lib/dom.js';
import { formatBytes, formatMs, statusClass, statusText } from '../lib/format.js';
import { icon } from './icons.js';
import { menuButton } from './menu.js';
import { prefs } from './prefs.js';

export const CONSOLE_LIMIT = 500;

const FILTERS = [
  ['all', 'All'],
  ['logs', 'Logs'],
  ['warnings', 'Warnings'],
  ['errors', 'Errors'],
  ['requests', 'Requests'],
];

const LEVEL_ICON = { log: 'chevronRight', info: 'info', warn: 'warning', error: 'circleX', debug: 'code' };
const LEVEL_NAME = { log: 'Log', info: 'Info', warn: 'Warning', error: 'Error', debug: 'Debug' };

const pad = (n, w = 2) => String(n).padStart(w, '0');
function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function oneLine(v, max = 120) {
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function pretty(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const pairsOf = (list) => (Array.isArray(list) ? list.map((x) => (Array.isArray(x) ? x : [x?.key, x?.value])).filter((x) => x[0] != null) : []);

/** Whether an entry passes a level filter key. */
export function matchesFilter(entry, filter) {
  switch (filter) {
    case 'logs':
      return entry.kind === 'script' && entry.level !== 'warn' && entry.level !== 'error';
    case 'warnings':
      return entry.level === 'warn';
    case 'errors':
      return entry.level === 'error';
    case 'requests':
      return entry.kind === 'request';
    default:
      return true;
  }
}

export class ConsolePanel {
  constructor(app) {
    this.app = app;
    this.entries = [];
    this.open = false;
    this.unread = 0;
    this.filter = 'all';
    this.query = '';
    this.#build();
  }

  #build() {
    const listId = domId('console-list');
    this.resizer = h('div.resizer.horizontal.con-resizer', {
      role: 'separator',
      'aria-orientation': 'horizontal',
      'aria-label': 'Resize console',
      'aria-controls': 'console',
      tabindex: '0',
    });
    this.search = h('input.input.sm.con-search', {
      type: 'search',
      placeholder: 'Filter',
      'aria-label': 'Filter console entries',
      'aria-controls': listId,
      autocomplete: 'off',
      spellcheck: false,
      oninput: () => {
        this.query = this.search.value.trim().toLowerCase();
        this.#applyFilter(true);
      },
    });
    this.levelBtn = h('button.btn.sm.ghost.con-level', { type: 'button', 'aria-controls': listId });
    menuButton(this.levelBtn, () => [
      { heading: 'Show' },
      ...FILTERS.map(([key, label]) => ({ label, checked: this.filter === key, run: () => this.setFilter(key) })),
    ], { align: 'end', side: 'top', label: 'Show entries' });
    this.countEl = h('span.con-count');
    this.list = h('div.con-list', { id: listId, role: 'log', 'aria-label': 'Console entries', tabindex: '0' });
    this.emptyEl = h('div.con-empty');
    this.el = h(
      'section#console.console',
      { 'aria-label': 'Console', hidden: true },
      this.resizer,
      h(
        'div.con-head',
        h('h2.con-title', icon('terminal', 14), h('span', 'Console')),
        this.countEl,
        h('span.spacer'),
        h('div.con-search-wrap', icon('search', 13), this.search),
        this.levelBtn,
        h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Clear console', title: 'Clear console', onclick: () => this.clear() }, icon('trash', 14)),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Close console', title: 'Close console (Ctrl+`)', onclick: () => this.close({ restoreFocus: true }) }, icon('x', 15)),
      ),
      h('div.con-body', this.list, this.emptyEl),
    );
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.menu')) {
        if (e.target === this.search && this.search.value) return;
        e.preventDefault();
        this.close({ restoreFocus: true });
      }
    });
    const apply = (px) => this.el.style.setProperty('--console-h', `${px}px`);
    // At most 70% of the main area, as its max-height in the stylesheet; 600 until it is on the page.
    const max = () => Math.min(600, this.el.parentElement?.clientHeight * 0.7 || 600);
    if (typeof this.app?.wireResizer === 'function') this.refit = this.app.wireResizer(this.resizer, 'consoleHeight', 120, max, apply, 'y', true);
    else apply(prefs.get('consoleHeight'));
    this.resizer.addEventListener('pointerdown', () => {
      document.body.classList.add('resizing-y');
      const up = () => {
        document.body.classList.remove('resizing-y');
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointerup', up);
    });
    this.#renderLevel();
    this.#renderMeta();
  }

  // Public API ----------------------------------------------------------------------

  add(entry) {
    if (!entry || typeof entry !== 'object') return;
    const e = { ...entry, at: entry.at || Date.now(), level: entry.level || 'log', kind: entry.kind === 'request' ? 'request' : 'script', el: null };
    this.entries.push(e);
    while (this.entries.length > CONSOLE_LIMIT) {
      const old = this.entries.shift();
      old.el?.remove();
    }
    if (e.level === 'error' && !this.open) {
      this.unread++;
      this.#renderBadge();
    }
    if (this.open) this.#appendPending();
    else this.#renderMeta();
  }

  clear() {
    this.entries = [];
    this.list.replaceChildren();
    this.unread = 0;
    this.#renderBadge();
    this.#renderMeta();
    announce('Console cleared');
  }

  toggle() {
    const opening = !this.open;
    // Focus only needs a new home when it was in the panel being hidden.
    const inside = this.el.contains(document.activeElement);
    this.setOpen(opening);
    if (opening) this.search.focus();
    else if (inside) this.#returnFocus();
  }

  close({ restoreFocus = false } = {}) {
    this.setOpen(false);
    if (restoreFocus) this.#returnFocus();
  }

  setOpen(open) {
    this.open = !!open;
    this.el.hidden = !this.open;
    prefs.set('consoleOpen', this.open);
    this.app?.consoleBtn?.setAttribute('aria-pressed', String(this.open));
    if (this.open) {
      this.refit?.();
      this.unread = 0;
      this.#renderBadge();
      this.#appendPending();
      this.list.scrollTop = this.list.scrollHeight;
    }
  }

  setFilter(key) {
    this.filter = FILTERS.some(([k]) => k === key) ? key : 'all';
    this.#renderLevel();
    this.#applyFilter(true);
  }

  /** Entries currently shown (after level and text filters). */
  visibleEntries() {
    return this.entries.filter((e) => this.#passes(e));
  }

  // Rendering -----------------------------------------------------------------------

  #returnFocus() {
    const btn = this.app?.consoleBtn;
    if (btn && document.contains(btn)) btn.focus();
  }

  #renderBadge() {
    const badge = this.app?.consoleBadge;
    const btn = this.app?.consoleBtn;
    if (!badge) return;
    badge.hidden = this.unread === 0;
    badge.textContent = this.unread > 99 ? '99+' : String(this.unread || '');
    if (this.unread) btn?.setAttribute('aria-label', `Console, ${this.unread} new ${this.unread === 1 ? 'error' : 'errors'}`);
    else btn?.removeAttribute('aria-label');
  }

  #renderLevel() {
    const label = FILTERS.find(([k]) => k === this.filter)[1];
    fill(this.levelBtn, icon('filter', 13), h('span', label), icon('chevronDown', 12));
    this.levelBtn.setAttribute('aria-label', `Show: ${label}`);
    this.levelBtn.classList.toggle('on', this.filter !== 'all');
  }

  #renderMeta() {
    const total = this.entries.length;
    const shown = this.open ? this.entries.filter((e) => e.el && !e.el.hidden).length : total;
    const filtered = this.filter !== 'all' || this.query;
    this.countEl.textContent = total ? (filtered ? `${shown} of ${total}` : String(total)) : '';
    this.countEl.title = total ? `${total} ${total === 1 ? 'entry' : 'entries'}` : '';
    if (!total) {
      this.emptyEl.hidden = false;
      fill(this.emptyEl, h('p', 'Nothing logged yet. Requests you send and console.log output from scripts appear here.'));
    } else if (filtered && !shown && this.open) {
      this.emptyEl.hidden = false;
      fill(this.emptyEl, h('p', 'No entries match the filter. '), h('button.link-btn', { type: 'button', onclick: () => this.#resetFilters() }, 'Show everything'));
    } else {
      this.emptyEl.hidden = true;
    }
  }

  #resetFilters() {
    this.search.value = '';
    this.query = '';
    this.setFilter('all');
    this.search.focus();
  }

  #passes(e) {
    if (!matchesFilter(e, this.filter)) return false;
    if (!this.query) return true;
    e.text ??= this.#searchText(e);
    return e.text.includes(this.query);
  }

  #searchText(e) {
    if (e.kind === 'request') return [e.method, e.url, e.status, e.error, e.transport].filter((x) => x != null).join(' ').toLowerCase();
    return [e.source, ...(e.args || []).map((a) => oneLine(a, 4000))].filter(Boolean).join(' ').toLowerCase();
  }

  #applyFilter(announceCount = false) {
    for (const e of this.entries) if (e.el) e.el.hidden = !this.#passes(e);
    this.#renderMeta();
    if (announceCount && this.open) {
      const n = this.entries.filter((e) => e.el && !e.el.hidden).length;
      announce(`${n} ${n === 1 ? 'entry' : 'entries'} shown`);
    }
  }

  #appendPending() {
    const list = this.list;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    const frag = document.createDocumentFragment();
    for (const e of this.entries) {
      if (e.el) continue;
      e.el = this.#row(e);
      e.el.hidden = !this.#passes(e);
      frag.append(e.el);
    }
    list.append(frag);
    if (atBottom) list.scrollTop = list.scrollHeight;
    this.#renderMeta();
  }

  #row(e) {
    const level = e.level in LEVEL_ICON ? e.level : 'log';
    const time = h('time.con-time', { datetime: new Date(e.at).toISOString() }, clock(e.at));
    if (e.kind === 'request') return this.#requestRow(e, time);
    const args = (e.args || []).map((a) => this.#value(a));
    const where = [e.source, e.phase === 'pre' ? 'pre-request' : e.phase === 'post' ? 'post-response' : null].filter(Boolean).join(', ');
    return h(
      'div.con-row',
      { dataset: { level, kind: 'script' } },
      time,
      h('span.con-level', { title: LEVEL_NAME[level] }, icon(LEVEL_ICON[level], 13), h('span.sr-only', `${LEVEL_NAME[level]}:`)),
      h('div.con-msg', args.length ? args : h('span.con-faint', '(empty)')),
      where ? h('span.con-source', { title: `From the ${where} script` }, where) : null,
    );
  }

  #value(v) {
    if (v === null || v === undefined) return h('span.con-arg.con-faint', String(v));
    if (typeof v === 'string') return h('span.con-arg.con-str', v);
    if (typeof v !== 'object') return h('span.con-arg.con-num', String(v));
    const isArr = Array.isArray(v);
    const size = isArr ? v.length : Object.keys(v).length;
    const details = h(
      'details.con-arg.con-obj',
      h('summary', h('span.con-obj-kind', isArr ? `Array(${size})` : 'Object'), ' ', h('span.con-obj-preview', oneLine(v, 100))),
      h('pre.con-pre', pretty(v)),
    );
    return details;
  }

  #requestRow(e, time) {
    const failed = !!e.error;
    const level = failed ? 'error' : e.level === 'warn' ? 'warn' : 'info';
    const detailsId = domId('con-req');
    const toggle = h(
      'button.con-toggle',
      { type: 'button', 'aria-expanded': 'false', 'aria-controls': detailsId },
      icon('chevronRight', 13),
      h('span.method', { dataset: { m: e.method } }, e.method || 'GET'),
      h('span.con-url', { title: e.url }, e.url || ''),
    );
    const status = failed
      ? h('span.status-pill', { dataset: { class: 'none' } }, 'Failed')
      : h('span.status-pill', { dataset: { class: statusClass(e.status) }, title: statusText(e.status) }, String(e.status ?? ''));
    const meta = h('span.con-meta', [e.timeMs != null ? formatMs(e.timeMs) : null, e.size != null ? formatBytes(e.size) : null].filter(Boolean).join('  '));
    let details = null;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      if (open && !details) {
        details = this.#requestDetails(e, detailsId);
        row.append(details);
      }
      if (details) details.hidden = !open;
    });
    const row = h(
      'div.con-row.con-request',
      { dataset: { level, kind: 'request' } },
      time,
      h('span.con-level', { title: failed ? 'Request failed' : 'Request' }, icon(failed ? 'circleX' : level === 'warn' ? 'warning' : 'arrowUpRight', 13), h('span.sr-only', failed ? 'Request failed:' : 'Request:')),
      h('div.con-msg', toggle, status, meta),
    );
    return row;
  }

  #requestDetails(e, id) {
    const table = (title, pairs) =>
      h(
        'div.con-headers',
        h('h3.con-sub', title, h('span.con-faint', ` ${pairs.length}`)),
        pairs.length
          ? h('table.con-table', h('tbody', pairs.map(([k, v]) => h('tr', h('th', { scope: 'row' }, String(k)), h('td', String(v ?? ''))))))
          : h('p.con-faint', 'None'),
      );
    return h(
      'div.con-details',
      { id },
      h('div.con-url-full.mono', `${e.method || 'GET'} ${e.url || ''}`),
      e.error ? h('div.con-error', icon('alert', 13), h('span', e.error)) : null,
      e.source === 'script' ? h('div.con-faint', 'Sent by a script with send()') : null,
      e.transport ? h('div.con-faint', `Sent through: ${e.transport}`) : null,
      table('Request headers', pairsOf(e.requestHeaders)),
      e.error ? null : table('Response headers', pairsOf(e.responseHeaders)),
    );
  }
}
