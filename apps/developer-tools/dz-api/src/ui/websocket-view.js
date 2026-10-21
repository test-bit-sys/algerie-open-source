/**
 * WebSocket request tab: name and breadcrumb, URL with Connect, section tabs
 * (Message, Params, Settings, Docs) and the live message log, side by side or
 * stacked with a draggable divider like the HTTP request editor.
 *
 * The live connection is kept on the tab (tab.session) so switching tabs or
 * rebuilding the view keeps it open; it is closed when the tab closes.
 */
import { h, fill, domId, debounce, shortcut, announce, modKey, isComposing } from '../lib/dom.js';
import { icon } from './icons.js';
import { normalizeWebSocket, WebSocketSession, wsUrl, wsMessage, parseProtocols, closeCodeText } from '../core/websocket.js';
import { paramsFromUrl, urlWithParams } from '../core/url.js';
import { findVariables, DYNAMIC } from '../core/variables.js';
import { prettyJson } from '../core/pretty.js';
import { createVarInput, isVariableDefined, refreshVarInputs } from './var-input.js';
import { createKvTable } from './kv-table.js';
import { codeEditor, refreshEditorVariables } from './code-editor.js';
import { menuButton } from './menu.js';
import { showPopover } from './popover.js';
import { promptDialog, confirmDialog } from './dialog.js';
import { prefs } from './prefs.js';
import { SIDE_BY_SIDE_MIN } from './request-view.js';
import { toast } from './toast.js';
import { formatBytes, formatMs } from '../lib/format.js';
import { uid } from '../lib/ids.js';

const SECTIONS = [
  ['message', 'Message'],
  ['params', 'Params'],
  ['settings', 'Settings'],
  ['docs', 'Docs'],
];

/** Rows kept in the DOM; the session keeps more. */
export const MAX_ROWS = 500;
const PREVIEW_CHARS = 240;
const DETAIL_CHARS = 512 * 1024;
const ANNOUNCE_EVERY_MS = 2000;
const FILTERS = [
  ['all', 'All'],
  ['out', 'Sent'],
  ['in', 'Received'],
];

const pad = (n, w = 2) => String(n).padStart(w, '0');
const clock = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
/** 65000 -> "1:05", 3723000 -> "1:02:03" */
export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Left and right arrows move between the options of a segmented radio group. */
function radioKeys(seg) {
  seg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const btns = [...seg.children];
    const i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
    next.click();
    next.focus();
  });
  return seg;
}

export class WebSocketView {
  #vars = null;
  #collectionId = null;

  constructor(app, tab) {
    this.app = app;
    this.tab = tab;
    this.section = tab.section || 'message';
    this.id = domId('ws');
    this.editors = [];
    this.visible = false;
    this.filter = tab.wsFilter || 'all';
    this.query = '';
    this.autoScroll = tab.wsAutoScroll !== false;
    this.queue = [];
    this.frame = 0;
    this.unseen = 0;
    this.expanded = new Set();
    this.incoming = 0;
    this.persist = debounce(() => {
      app.draftChanged(tab);
      // Save turns on with the first edit (and off when edits are undone) without rebuilding the header.
      if (this.saveBtn) this.saveBtn.disabled = !!tab.refId && !app.isDirty(tab);
    }, 120);
    this.validate = debounce(() => this.#renderJsonState(), 250);
    this.el = h('div.req-view.ws-view');
    this.el.addEventListener('keydown', (e) => this.#onKey(e));
    this.build();
    this.#attach();
  }

  get draft() {
    return this.tab.draft;
  }

  get loc() {
    return this.tab.refId ? this.app.ws.locate(this.tab.refId) : null;
  }

  /**
   * Variables in reach. Fields keep this one object, which looks up the
   * request's collection on each call, so they follow the request when it moves.
   */
  get vars() {
    const scope = () => this.app.varsFor(this.loc?.collection.id || null);
    return (this.#vars ||= { get: (n) => scope().get(n), list: () => scope().list(), resolve: (t) => scope().resolve(t) });
  }

  /** Repaints variables when the request has moved to another collection since it was last drawn. */
  #followCollection() {
    const id = this.loc?.collection.id || null;
    if (id === this.#collectionId) return;
    this.#collectionId = id;
    refreshVarInputs();
    refreshEditorVariables();
    this.onVariablesChanged();
  }

  get session() {
    return this.tab.session || null;
  }

  get state() {
    return this.session?.state || 'idle';
  }

  get message() {
    const list = this.draft.messages;
    return list.find((m) => m.id === this.tab.wsMessageId) || list[0];
  }

  /** Records an edit to the draft. */
  changed({ head = false } = {}) {
    this.persist();
    if (head) this.#renderHead();
    this.#renderTabCounts();
  }

  build() {
    for (const ed of this.editors) ed.destroy();
    this.editors = [];
    this.msgEditor?.destroy();
    this.msgEditor = null;
    this.head = h('div.req-head');
    this.nameInput = null;
    this.#collectionId = this.loc?.collection.id || null;
    this.#renderHead();

    // Badge + URL + Connect.
    const badge = h('span.ws-badge', { title: 'WebSocket', 'aria-hidden': 'true' }, 'WS');
    this.url = createVarInput({
      value: this.draft.url,
      placeholder: 'wss://example.com/socket',
      label: 'WebSocket URL',
      vars: this.vars,
      onInput: (v) => this.#onUrlInput(v),
      onEnter: () => this.#onUrlEnter(),
    });
    this.connectBtn = h('button.btn.primary.send-btn.ws-connect', {
      type: 'button',
      'aria-keyshortcuts': 'Control+Enter Meta+Enter',
      onclick: () => this.toggleConnection(),
    });
    const connectMore = h('button.btn.primary.ws-connect-more', { type: 'button', 'aria-label': 'More connection options' }, icon('chevronDown', 15));
    menuButton(connectMore, () => {
      const st = this.state;
      const live = st === 'open' || st === 'connecting';
      return [
        live ? { label: 'Reconnect', icon: 'refresh', run: () => this.connect() } : { label: 'Connect', icon: 'plug', kbd: shortcut('Mod+Enter'), run: () => this.connect() },
        live ? { label: 'Disconnect', icon: 'unplug', run: () => this.disconnect() } : null,
        live ? { label: 'Disconnect with code...', icon: 'pencil', disabled: st !== 'open', run: () => this.#disconnectWithCode() } : null,
        '-',
        { label: 'Copy URL', icon: 'link', run: () => this.#copy(wsUrl(this.vars.resolve(this.draft.url)), 'URL copied') },
        { label: 'Clear messages', icon: 'trash', disabled: !this.session?.messages.length, run: () => this.clearLog() },
      ];
    }, { align: 'end', label: 'Connection options' });
    this.applyBtn = h('button.link-btn.ws-apply', { type: 'button', hidden: true, onclick: () => this.connect() }, 'Reconnect to apply');
    this.urlBox = h('div.url-box', badge, this.url.el, this.applyBtn);
    const urlRow = h('div.url-row', this.urlBox, h('div.split-btn.ws-connect-group', this.connectBtn, connectMore));

    // Section tabs.
    this.tabsEl = h('div.tabs', { role: 'tablist', 'aria-label': 'WebSocket sections' });
    this.tabsEl.addEventListener('keydown', (e) => this.#tabKeys(e));
    this.panels = {};
    for (const [key] of SECTIONS) this.panels[key] = h('div.req-panel', { role: 'tabpanel', id: `${this.id}-${key}-panel`, 'aria-labelledby': `${this.id}-${key}`, hidden: true, tabindex: '-1' });
    this.#renderTabs();

    this.top = h('div.req-pane.top', h('div.req-tabs-row', this.tabsEl), ...Object.values(this.panels));
    this.resizer = h('div.resizer.horizontal', { role: 'separator', 'aria-label': 'Resize editor and messages', tabindex: '0', 'aria-orientation': 'horizontal' });
    this.bottom = h('div.req-pane.bottom', this.#buildLog());
    this.split = h('div.req-split', { dataset: { mobile: this.tab.mobilePane || 'request' } }, this.top, this.resizer, this.bottom);
    this.mobileSwitch = h('div.mobile-switch', this.#mobileSwitch());
    this.#wireSplit();
    this.setLayout(prefs.get('layout'));
    this.splitObserver = new ResizeObserver(() => this.#fitLayout());
    this.splitObserver.observe(this.split);
    fill(this.el, this.head, urlRow, this.mobileSwitch, this.split);
    this.showSection(this.section);
    this.#renderState();
    this.#renderLog();
  }

  // Header --------------------------------------------------------------------

  #renderHead() {
    if (!this.nameInput) this.#buildHead();
    const loc = this.loc;
    const name = this.nameInput;
    // Updated in place, never rebuilt: a focused name keeps its caret and what is being typed.
    if (name.value !== this.draft.name) {
      name.value = this.draft.name;
      name.size = Math.max(8, Math.min(48, name.value.length + 1));
    }
    for (const node of [...this.crumbsEl.childNodes]) if (node !== name) node.remove();
    if (loc) {
      loc.parents.forEach((p, i) => {
        // The collection gives way first; --chars lets each keep a few letters (editor.css).
        const crumb = h(`button.crumb${i ? '' : '.crumb-root'}`, { type: 'button', title: `Open ${p.name}`, style: { '--chars': String(p.name.length) }, onclick: () => this.app.openTab(p.type, p.id) }, p.name);
        name.before(crumb, h('span.sep', { 'aria-hidden': 'true' }, '/'));
      });
    } else name.before(h('span.crumb.unsaved', 'Unsaved'), h('span.sep', { 'aria-hidden': 'true' }, '/'));
    const shared = loc?.collection.shared;
    if (shared) {
      const viewOnly = !['write', 'manage'].includes(shared.mode);
      name.after(h('span.badge.shared-badge', { title: `Shared by ${shared.owner}${viewOnly ? '. Save a copy to keep changes.' : ''}` }, icon(viewOnly ? 'lock' : 'users', 12), viewOnly ? 'View only' : `Shared by ${shared.owner}`));
    }
    this.saveBtn.disabled = !!this.tab.refId && !this.app.isDirty(this.tab);
  }

  /** The name field and the Save and actions buttons, made once per build. */
  #buildHead() {
    const name = h('input.req-name', { type: 'text', value: this.draft.name, 'aria-label': 'WebSocket request name', spellcheck: false, size: Math.max(8, Math.min(48, this.draft.name.length + 1)) });
    name.addEventListener('input', () => {
      this.draft.name = name.value;
      name.size = Math.max(8, Math.min(48, name.value.length + 1));
      this.changed();
    });
    name.addEventListener('blur', () => {
      if (!name.value.trim()) {
        name.value = this.draft.name = 'Untitled WebSocket';
        this.changed();
      }
    });
    name.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === 'Escape') && !isComposing(e)) {
        e.preventDefault();
        this.url.focus();
      }
    });
    this.nameInput = name;
    this.crumbsEl = h('nav.crumbs', { 'aria-label': 'Location' }, name);
    const save = h('button.btn.sm', { type: 'button', title: `Save (${shortcut('Mod+S')})`, onclick: () => this.app.saveTab(this.tab) }, icon('save', 14), h('span', 'Save'));
    this.saveBtn = save;
    const saveMore = h('button.btn.sm', { type: 'button', 'aria-label': 'More save options' }, icon('chevronDown', 14));
    menuButton(saveMore, () => [
      { label: 'Save', icon: 'save', kbd: shortcut('Mod+S'), run: () => this.app.saveTab(this.tab) },
      { label: 'Save as...', icon: 'copy', kbd: shortcut('Mod+Shift+S'), run: () => this.app.saveTabAs(this.tab) },
      this.tab.refId && this.app.isDirty(this.tab) ? { label: 'Revert changes', icon: 'refresh', run: () => this.revert() } : null,
    ], { align: 'end', label: 'Save options' });
    const more = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'WebSocket actions' }, icon('more', 16));
    menuButton(more, () => [
      { label: 'Duplicate', icon: 'copy', run: () => this.#duplicate() },
      { label: 'Copy URL', icon: 'link', run: () => this.#copy(wsUrl(this.vars.resolve(this.draft.url)), 'URL copied') },
      { label: 'Clear messages', icon: 'x', disabled: !this.session?.messages.length, run: () => this.clearLog() },
      this.tab.refId ? '-' : null,
      this.tab.refId ? { label: 'Delete', icon: 'trash', danger: true, run: () => this.app.deleteItem(this.tab.refId) } : null,
    ], { align: 'end', label: 'WebSocket actions' });
    fill(this.head, this.crumbsEl, h('div.req-head-actions', h('div.split-btn', save, saveMore), more));
  }

  #duplicate() {
    const copy = structuredClone(this.draft);
    copy.id = undefined;
    copy.name = `${this.draft.name} Copy`;
    for (const m of copy.messages) m.id = uid();
    for (const p of copy.params) p.id = uid();
    this.app.openTab('websocket', null, { draft: normalizeWebSocket(copy) });
  }

  onSaved() {
    this.#renderHead();
  }

  revert() {
    const saved = this.loc?.item;
    if (!saved) return;
    this.tab.draft = normalizeWebSocket(structuredClone(saved));
    this.tab.savedKey = null;
    this.reload();
    this.app.draftChanged(this.tab);
  }

  /** Rebuilds from the draft (after revert or a remote change). The connection stays open. */
  reload() {
    const focusUrl = document.activeElement === this.url?.input;
    this.build();
    if (focusUrl) this.url.focus();
  }

  onContextChanged() {
    this.#renderHead();
    this.#followCollection();
  }

  onVariablesChanged() {
    this.#renderJsonState();
  }

  // URL ---------------------------------------------------------------------------

  #onUrlInput(v) {
    this.draft.url = v;
    this.draft.params = paramsFromUrl(v, this.draft.params);
    if (this.section === 'params') this.paramsTable?.setRows(this.draft.params);
    this.changed();
    this.#renderState();
  }

  #onUrlEnter() {
    const s = this.session;
    if (s && (s.state === 'open' || s.state === 'connecting')) {
      if (this.#resolvedUrl() !== s.url) this.connect();
      else this.msgEditor?.focus();
      return;
    }
    this.connect();
  }

  #resolvedUrl() {
    return wsUrl(this.vars.resolve(this.draft.url));
  }

  focusUrl() {
    this.url.focus();
    this.url.input.select();
  }

  focus() {
    this.url.focus();
    return true;
  }

  // Connection ----------------------------------------------------------------------

  #ensureSession() {
    if (!this.tab.session) this.tab.session = new WebSocketSession({ reconnect: this.draft.settings.reconnect });
    this.#attach();
    return this.tab.session;
  }

  #attach() {
    const s = this.session;
    if (!s || this.attached === s) return;
    this.#detach();
    this.attached = s;
    this.lastState = s.state;
    this.unsubs = [s.on('state', (st) => this.#onState(st)), s.on('message', (e) => this.#onEntry(e)), s.on('clear', () => this.#renderLog())];
  }

  #detach() {
    for (const off of this.unsubs || []) off();
    this.unsubs = [];
    this.attached = null;
  }

  /** Mod+Enter: connect when disconnected, send the current message when connected. */
  primaryAction() {
    const st = this.state;
    if (st === 'open') this.sendMessage(this.message);
    else if (st !== 'connecting' && st !== 'closing') this.connect();
  }

  toggleConnection() {
    const s = this.session;
    const st = this.state;
    if (st === 'open' || st === 'connecting') this.disconnect();
    else if (s?.reconnecting) s.close();
    else if (st !== 'closing') this.connect();
  }

  connect() {
    if (!this.draft.url.trim()) {
      toast({ kind: 'error', title: 'Enter a WebSocket URL', text: 'For example wss://example.com/socket' });
      this.url.focus();
      return false;
    }
    const url = this.#resolvedUrl();
    const missing = this.#missingVars([this.draft.url, this.draft.protocols]);
    if (missing.length) toast({ kind: 'warning', title: `${plural(missing.length, 'variable')} not defined`, text: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set in the active environment, the collection or globals.` });
    const protocols = parseProtocols(this.vars.resolve(this.draft.protocols));
    const s = this.#ensureSession();
    s.reconnect = this.draft.settings.reconnect;
    this.announceState = true;
    s.connect({ url, protocols });
    this.app.keepTab(this.tab);
    this.#setMobile('response');
    return true;
  }

  disconnect(code = 1000, reason = '') {
    this.pendingSend = null;
    this.session?.close(code, reason);
  }

  async #disconnectWithCode() {
    const value = await promptDialog({
      title: 'Disconnect with code',
      label: 'Close code and optional reason, for example "4000 done"',
      value: '1000',
      confirmLabel: 'Disconnect',
      validate: (v) => {
        const m = v.trim().match(/^(\d+)(?:\s+(.*))?$/);
        if (!m) return 'Start with a number.';
        const code = Number(m[1]);
        if (code !== 1000 && (code < 3000 || code > 4999)) return 'Browsers allow 1000 or a code from 3000 to 4999.';
        if (new TextEncoder().encode(m[2] || '').length > 123) return 'The reason can be at most 123 bytes.';
        return '';
      },
    });
    if (!value) return;
    const m = value.trim().match(/^(\d+)(?:\s+(.*))?$/);
    this.disconnect(Number(m[1]), m[2] || '');
  }

  clearLog() {
    this.session?.clear();
  }

  #missingVars(texts) {
    const names = new Set();
    for (const t of texts) for (const v of findVariables(t)) if (!this.vars.get(v.name) && !DYNAMIC[v.name]) names.add(v.name);
    return [...names];
  }

  #onState(st) {
    const s = this.session;
    this.#renderState();
    if (st === 'open') {
      this.app.console?.add({ kind: 'request', level: 'info', method: 'WS', url: s.url, status: 101, timeMs: s.connectedAt - s.startedAt, at: Date.now() });
      if (this.visible) announce(`Connected to ${s.url}`);
      if (this.pendingSend) {
        const msg = this.draft.messages.find((m) => m.id === this.pendingSend);
        this.pendingSend = null;
        if (msg) this.sendMessage(msg);
      }
    } else if (st === 'closed' && this.lastState && this.lastState !== 'closed') {
      this.pendingSend = null;
      const code = s.closeCode;
      const text = code != null ? `code ${code}${closeCodeText(code) ? ` (${closeCodeText(code)})` : ''}${s.closeReason ? `: ${s.closeReason}` : ''}` : 'cancelled';
      if (this.lastState === 'connecting' && code != null) {
        this.app.console?.add({ kind: 'request', level: 'error', method: 'WS', url: s.url, error: `Could not connect, ${text}`, at: Date.now() });
      } else {
        this.app.console?.add({ kind: 'script', level: s.wasClean === false ? 'warn' : 'info', args: [`WebSocket disconnected from ${s.url}, ${text}`], source: 'WebSocket', at: Date.now() });
      }
      // The session schedules a reconnect only after reporting the close, so check once it has.
      if (this.visible) queueMicrotask(() => announce(s.reconnecting ? `Disconnected, ${text}. Reconnecting.` : `Disconnected, ${text}`));
    }
    this.lastState = st;
  }

  // Sending --------------------------------------------------------------------------

  /** Sends a saved message, connecting first when needed. */
  sendMessage(msg = this.message) {
    if (!msg) return;
    const s = this.session;
    if (!s || s.state !== 'open') {
      this.pendingSend = msg.id;
      if (this.state !== 'connecting') {
        if (!this.connect()) this.pendingSend = null;
      }
      return;
    }
    const missing = this.#missingVars([msg.body]);
    const text = this.vars.resolve(msg.body);
    try {
      s.send(text);
    } catch (err) {
      toast({ kind: 'error', title: 'Could not send the message', text: err.message });
      return;
    }
    if (missing.length) toast({ kind: 'warning', title: 'Sent with undefined variables', text: missing.join(', ') });
    announce('Message sent');
  }

  #resend(entry) {
    try {
      this.session.send(entry.data);
      announce('Message sent again');
    } catch (err) {
      toast({ kind: 'error', title: 'Could not send the message', text: err.message });
    }
  }

  // Section tabs ----------------------------------------------------------------------

  #counts() {
    const d = this.draft;
    return {
      message: d.messages.length > 1 ? d.messages.length : null,
      params: d.params.filter((x) => x.enabled && x.key).length || null,
      settings: d.protocols.trim() || d.settings.reconnect ? 'dot' : null,
      docs: d.description.trim() ? 'dot' : null,
    };
  }

  #renderTabs() {
    const counts = this.#counts();
    fill(
      this.tabsEl,
      SECTIONS.map(([key, label]) => {
        const c = counts[key];
        return h(
          'button.tab',
          {
            type: 'button',
            role: 'tab',
            id: `${this.id}-${key}`,
            'aria-selected': String(this.section === key),
            'aria-controls': `${this.id}-${key}-panel`,
            tabindex: this.section === key ? '0' : '-1',
            dataset: { key },
            onclick: () => this.showSection(key),
          },
          label,
          c === 'dot' ? h('span.dot', { 'aria-label': 'has content' }) : c ? h('span.count', String(c)) : null,
        );
      }),
    );
  }

  #renderTabCounts() {
    const counts = this.#counts();
    for (const btn of this.tabsEl.children) {
      const c = counts[btn.dataset.key];
      btn.querySelector('.dot, .count')?.remove();
      if (c === 'dot') btn.append(h('span.dot', { 'aria-label': 'has content' }));
      else if (c) btn.append(h('span.count', String(c)));
    }
  }

  #tabKeys(e) {
    const keys = SECTIONS.map((s) => s[0]);
    const i = keys.indexOf(this.section);
    let next = null;
    if (e.key === 'ArrowRight') next = keys[(i + 1) % keys.length];
    else if (e.key === 'ArrowLeft') next = keys[(i - 1 + keys.length) % keys.length];
    else if (e.key === 'Home') next = keys[0];
    else if (e.key === 'End') next = keys[keys.length - 1];
    if (!next) return;
    e.preventDefault();
    this.showSection(next);
    this.tabsEl.querySelector(`[data-key="${next}"]`)?.focus();
  }

  showSection(key) {
    if (!this.panels[key]) key = 'message';
    this.section = key;
    this.tab.section = key;
    for (const btn of this.tabsEl.children) {
      const on = btn.dataset.key === key;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
    for (const [k, panel] of Object.entries(this.panels)) panel.hidden = k !== key;
    const panel = this.panels[key];
    if (!panel.dataset.built) {
      panel.dataset.built = '1';
      this[`render_${key}`](panel);
    }
    if (this.tab.mobilePane === 'response') this.#setMobile('request');
  }

  // Message ----------------------------------------------------------------------------

  render_message(panel) {
    this.msgList = h('ul.ws-msg-list', { 'aria-label': 'Saved messages' });
    this.msgList.addEventListener('keydown', (e) => this.#msgListKeys(e));
    const add = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Add message', title: 'Add message', onclick: () => this.#addMessage() }, icon('plus', 15));
    const nav = h('div.ws-msg-nav', h('div.ws-msg-nav-head', h('span.panel-title', 'Messages'), h('span.spacer'), add), this.msgList);
    this.formatSeg = radioKeys(h('div.segmented', { role: 'radiogroup', 'aria-label': 'Message format' }));
    this.beautifyBtn = h('button.btn.sm', { type: 'button', onclick: () => this.#beautify() }, icon('braces', 14), 'Beautify');
    this.jsonState = h('span.ws-json-state', { 'aria-live': 'polite' });
    this.sendBtn = h('button.btn.primary.sm.ws-send', { type: 'button', 'aria-keyshortcuts': 'Control+Enter Meta+Enter', onclick: () => this.sendMessage(this.message) });
    this.msgEditorEl = h('div.ws-msg-editor');
    const main = h(
      'div.ws-msg-main',
      h('div.ws-msg-tools', this.formatSeg, this.beautifyBtn, this.jsonState, h('span.spacer'), this.sendBtn),
      this.msgEditorEl,
      h('p.field-hint.ws-msg-hint', 'Variables such as {{token}} are filled in when the message is sent. ', h('kbd', shortcut('Mod+Enter')), ' sends while connected.'),
    );
    fill(panel, h('div.ws-compose', nav, main));
    panel.classList.add('ws-message-panel');
    this.#renderMessageList();
    this.#mountMessage();
    this.#renderSendBtn();
  }

  #renderMessageList() {
    if (!this.msgList) return;
    const current = this.message;
    const only = this.draft.messages.length === 1;
    fill(
      this.msgList,
      this.draft.messages.map((m) => {
        const more = h('button.icon-btn.sm.ws-msg-more', { type: 'button', 'aria-label': `Actions for ${m.name}` }, icon('more', 14));
        menuButton(more, () => [
          { label: 'Send', icon: 'sendH', run: () => this.sendMessage(m) },
          '-',
          { label: 'Rename...', icon: 'pencil', run: () => this.#renameMessage(m) },
          { label: 'Duplicate', icon: 'copy', run: () => this.#addMessage({ name: `${m.name} Copy`, body: m.body, format: m.format }) },
          { label: 'Delete', icon: 'trash', danger: true, disabled: only, run: () => this.#deleteMessage(m) },
        ], { align: 'end', label: `Actions for ${m.name}` });
        const on = m.id === current.id;
        const btn = h(
          'button.ws-msg-item',
          { type: 'button', 'aria-current': on ? 'true' : null, dataset: { id: m.id }, title: m.name, onclick: () => this.#selectMessage(m.id), ondblclick: () => this.#renameMessage(m) },
          h('span.ws-msg-name', m.name),
          h('span.ws-msg-format', { 'aria-label': `format ${m.format === 'json' ? 'JSON' : 'text'}` }, m.format === 'json' ? 'JSON' : 'Text'),
        );
        return h(`li.ws-msg-row${on ? '.on' : ''}`, btn, more);
      }),
    );
  }

  #msgListKeys(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...this.msgList.querySelectorAll('.ws-msg-item')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }

  #selectMessage(id, { focus = false } = {}) {
    this.tab.wsMessageId = id;
    this.#renderMessageList();
    this.#mountMessage();
    if (focus) this.msgEditor?.focus();
    else this.msgList.querySelector(`[data-id="${id}"]`)?.focus();
  }

  #mountMessage() {
    const m = this.message;
    this.msgEditor?.destroy();
    this.msgEditor = codeEditor({
      doc: m.body,
      language: m.format === 'json' ? 'json' : 'text',
      wrap: true,
      label: `Message body: ${m.name}`,
      placeholder: m.format === 'json' ? '{\n  "type": "subscribe"\n}' : 'Type a message',
      onChange: (v) => {
        m.body = v;
        this.changed();
        this.validate();
      },
      onSubmit: () => this.primaryAction(),
      isVariableDefined: (n) => isVariableDefined(this.vars, n),
    });
    fill(this.msgEditorEl, this.msgEditor.el);
    fill(
      this.formatSeg,
      [['text', 'Text'], ['json', 'JSON']].map(([k, label]) =>
        h('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(m.format === k),
          dataset: { k },
          onclick: () => {
            if (m.format === k) return;
            m.format = k;
            this.msgEditor.setLanguage(k === 'json' ? 'json' : 'text');
            for (const b of this.formatSeg.children) b.setAttribute('aria-checked', String(b.dataset.k === k));
            this.#renderMessageList();
            this.#renderJsonState();
            this.changed();
          },
        }, label),
      ),
    );
    this.#renderJsonState();
  }

  #renderJsonState() {
    if (!this.jsonState) return;
    const m = this.message;
    this.beautifyBtn.hidden = m.format !== 'json';
    if (m.format !== 'json' || !m.body.trim()) {
      fill(this.jsonState);
      this.jsonState.dataset.state = '';
      return;
    }
    let error = null;
    try {
      JSON.parse(this.vars.resolve(m.body));
    } catch (err) {
      error = err;
    }
    const state = error ? 'error' : 'ok';
    // The element is a live region: refill it only when the verdict changes, so it is not announced on every pause.
    if (this.jsonState.dataset.state === state) {
      if (error) this.jsonState.querySelector('span[title]')?.setAttribute('title', error.message);
      return;
    }
    this.jsonState.dataset.state = state;
    if (error) fill(this.jsonState, icon('alert', 13), h('span', { title: error.message }, 'Invalid JSON'));
    else fill(this.jsonState, icon('circleCheck', 13), h('span', 'Valid JSON'));
  }

  #beautify() {
    const m = this.message;
    const text = this.msgEditor.getValue();
    const out = prettyJson(text);
    if (out === text) {
      if (!/^\s*[[{]/.test(text)) toast({ kind: 'info', title: 'Nothing to format', text: 'Beautify formats JSON objects and arrays.' });
      return;
    }
    this.msgEditor.setValue(out);
    m.body = out;
    this.changed();
  }

  #renderSendBtn() {
    if (!this.sendBtn) return;
    const st = this.state;
    const open = st === 'open';
    fill(this.sendBtn, icon('sendH', 14), h('span', open ? 'Send' : st === 'connecting' ? 'Send when connected' : 'Connect and send'));
    this.sendBtn.title = open ? `Send (${shortcut('Mod+Enter')})` : 'Connects first, then sends this message';
    this.sendBtn.disabled = st === 'closing';
  }

  #nextMessageName() {
    const used = new Set(this.draft.messages.map((m) => m.name));
    let n = this.draft.messages.length + 1;
    while (used.has(`Message ${n}`)) n++;
    return `Message ${n}`;
  }

  #addMessage(fields = {}) {
    const m = wsMessage({ name: this.#nextMessageName(), format: this.message?.format || 'text', ...fields });
    const at = this.draft.messages.indexOf(this.message);
    this.draft.messages.splice(at + 1, 0, m);
    this.changed();
    this.#selectMessage(m.id, { focus: true });
    announce(`${m.name} added`);
  }

  async #renameMessage(m) {
    const name = await promptDialog({ title: 'Rename message', label: 'Name', value: m.name, confirmLabel: 'Rename', validate: (v) => (v.trim() ? '' : 'Enter a name.') });
    if (!name || name === m.name) return;
    m.name = name.trim();
    this.changed();
    this.#renderMessageList();
    this.msgList.querySelector(`[data-id="${m.id}"]`)?.focus();
  }

  async #deleteMessage(m) {
    const list = this.draft.messages;
    if (list.length <= 1) return;
    if (m.body.trim()) {
      const ok = await confirmDialog({ title: 'Delete message?', message: `"${m.name}" will be removed from this request.`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    const i = list.indexOf(m);
    list.splice(i, 1);
    this.changed();
    const next = list[Math.min(i, list.length - 1)];
    this.#selectMessage(next.id);
    announce(`${m.name} deleted`);
  }

  /** Puts a logged message into a new draft message. */
  #useAsDraft(entry) {
    let format = 'text';
    try {
      JSON.parse(entry.data);
      format = 'json';
    } catch {}
    this.showSection('message');
    this.#addMessage({ body: format === 'json' ? prettyJson(entry.data) : entry.data, format });
  }

  // Params --------------------------------------------------------------------------------

  render_params(panel) {
    this.paramsTable = createKvTable({
      rows: this.draft.params,
      vars: this.vars,
      label: 'Query parameters',
      onChange: (rows) => {
        this.draft.params = rows;
        this.draft.url = urlWithParams(this.draft.url, rows);
        this.url.setValue(this.draft.url);
        this.changed();
      },
    });
    fill(
      panel,
      h('div.panel-head', h('span.panel-title', 'Query Params'), h('span.spacer'), this.paramsTable.bulkToggle),
      this.paramsTable.el,
      h('p.field-hint', 'Query parameters are part of the connection URL. Changes apply the next time you connect.'),
    );
  }

  // Settings -------------------------------------------------------------------------------

  render_settings(panel) {
    const s = this.draft.settings;
    const row = (id, title, desc, control) => h('div.setting-row', h('div.setting-text', h('label.setting-title', { for: id, id: `${id}-l` }, title), h('span.setting-desc', { id: `${id}-d` }, desc)), control);
    const protoId = domId('set');
    const protocols = h('input.input.ws-protocols.mono', {
      type: 'text',
      id: protoId,
      value: this.draft.protocols,
      placeholder: 'graphql-ws, json',
      spellcheck: false,
      autocomplete: 'off',
      'aria-describedby': `${protoId}-d`,
      oninput: (e) => {
        this.draft.protocols = e.target.value;
        this.changed();
      },
    });
    const recId = domId('set');
    const reconnect = h('input.switch', {
      type: 'checkbox',
      id: recId,
      role: 'switch',
      checked: s.reconnect,
      'aria-describedby': `${recId}-d`,
      onchange: (e) => {
        s.reconnect = e.target.checked;
        if (this.session) this.session.reconnect = s.reconnect;
        this.changed();
      },
    });
    fill(
      panel,
      h(
        'div.settings-list',
        row(protoId, 'Subprotocols', 'Comma separated, in order of preference. The server picks one; it is shown in the message log.', protocols),
        row(recId, 'Reconnect automatically', 'When the connection drops, try again after 1, 2, 4 seconds and so on, up to 30 seconds between attempts.', reconnect),
      ),
      h(
        'div.callout.ws-help',
        { dataset: { kind: 'info' } },
        icon('info', 14),
        h(
          'div',
          h('strong', 'Authentication. '),
          'Browsers cannot set custom headers such as Authorization on WebSocket connections. Pass a token in a query parameter (see Params) or as a subprotocol instead. Cookies the browser holds for the server are sent automatically.',
        ),
      ),
    );
  }

  // Docs -----------------------------------------------------------------------------------

  render_docs(panel) {
    const id = domId('docs');
    const area = h('textarea.textarea.docs-area', { id, value: this.draft.description, placeholder: 'Describe what this connection is for, the messages it accepts and what it sends back.', oninput: (e) => { this.draft.description = e.target.value; this.changed(); } });
    fill(panel, h('div.field', h('label.field-label', { for: id }, 'Description'), area));
  }

  // Message log --------------------------------------------------------------------------

  #buildLog() {
    this.statusEl = h('span.status-pill.ws-status');
    this.durationEl = h('span.ws-duration', { hidden: true });
    this.statsBtn = h('button.resp-metric.ws-stats', { type: 'button', 'aria-haspopup': 'dialog', title: 'Connection details' });
    this.statsBtn.addEventListener('click', () => showPopover(this.statsBtn, this.#details(), { align: 'end', label: 'Connection details', focus: false }));
    const filterSeg = h('div.segmented.ws-filter', { role: 'radiogroup', 'aria-label': 'Show messages' });
    for (const [k, label] of FILTERS) {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(this.filter === k), dataset: { k } }, label);
      b.addEventListener('click', () => {
        this.filter = this.tab.wsFilter = k;
        for (const x of filterSeg.children) x.setAttribute('aria-checked', String(x === b));
        this.#renderLog();
      });
      filterSeg.append(b);
    }
    radioKeys(filterSeg);
    this.searchEl = h('input.input.sm.ws-search', { type: 'search', placeholder: 'Search messages', 'aria-label': 'Search messages', value: this.query });
    const runSearch = debounce(() => {
      this.query = this.searchEl.value.trim().toLowerCase();
      this.#renderLog();
    }, 150);
    this.searchEl.addEventListener('input', runSearch);
    this.searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.searchEl.value) {
        e.preventDefault();
        e.stopPropagation();
        this.searchEl.value = '';
        runSearch.cancel();
        this.query = '';
        this.#renderLog();
      }
    });
    this.autoBtn = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Scroll to new messages', title: 'Scroll to new messages', 'aria-pressed': String(this.autoScroll), onclick: () => this.#toggleAutoScroll() }, icon('toBottom', 15));
    const clear = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Clear messages', title: 'Clear messages', onclick: () => this.clearLog() }, icon('trash', 15));
    this.noteEl = h('p.ws-log-note', { hidden: true });
    this.listEl = h('ol.ws-log-list', { 'aria-label': 'Message log', tabindex: '-1' });
    this.listEl.addEventListener('scroll', () => {
      if (this.#atBottom()) this.#hideJump();
    });
    this.emptyEl = h('div.resp-empty.ws-empty');
    this.jumpBtn = h('button.btn.sm.ws-jump', { type: 'button', hidden: true, onclick: () => this.#scrollToEnd(true) }, icon('arrowDown', 14), h('span'));
    this.logBody = h('div.ws-log-body', this.noteEl, this.listEl, this.emptyEl, this.jumpBtn);
    return h(
      'section.resp.ws-log',
      { 'aria-label': 'Messages' },
      h('div.resp-bar', h('h2.resp-title', 'Messages'), h('div.resp-meta.ws-meta', { role: 'group', 'aria-label': 'Connection status' }, this.statusEl, this.durationEl, this.statsBtn)),
      h('div.resp-tools.ws-tools', filterSeg, this.searchEl, h('span.spacer'), this.autoBtn, clear),
      this.logBody,
    );
  }

  #toggleAutoScroll() {
    this.autoScroll = !this.autoScroll;
    this.tab.wsAutoScroll = this.autoScroll;
    this.autoBtn.setAttribute('aria-pressed', String(this.autoScroll));
    if (this.autoScroll) this.#scrollToEnd();
  }

  #details() {
    const s = this.session;
    const st = s?.stats || { sent: 0, received: 0, bytesSent: 0, bytesReceived: 0 };
    const rows = [
      ['URL', s?.url || this.#resolvedUrl() || 'Not set'],
      ['Subprotocol', s?.protocol || 'None'],
      s?.extensions ? ['Extensions', s.extensions] : null,
      s?.connectedAt && this.state === 'open' ? ['Connected at', new Date(s.connectedAt).toLocaleTimeString()] : null,
      s?.connectedAt && s.startedAt ? ['Handshake', formatMs(s.connectedAt - s.startedAt)] : null,
      ['Sent', `${plural(st.sent, 'message')}, ${formatBytes(st.bytesSent)}`],
      ['Received', `${plural(st.received, 'message')}, ${formatBytes(st.bytesReceived)}`],
      s?.closeCode != null && this.state === 'closed' ? ['Last close', `${s.closeCode} ${closeCodeText(s.closeCode)}${s.closeReason ? `: ${s.closeReason}` : ''}`] : null,
    ].filter(Boolean);
    return h(
      'div.metric-pop.ws-details',
      h('div.metric-head', h('span', 'Connection')),
      rows.map(([k, v]) => h('div.metric-row.plain', h('span', k), h('span.mono', v))),
      h('p.metric-note', 'Measured in this browser. Browsers do not expose handshake headers for WebSocket connections.'),
    );
  }

  #renderState() {
    if (!this.connectBtn) return;
    const s = this.session;
    const st = this.state;
    const reconnecting = !!s?.reconnecting;
    let label = 'Not connected';
    let cls = 'idle';
    let title = '';
    if (st === 'open') {
      label = 'Connected';
      cls = 'success';
    } else if (st === 'connecting') {
      label = s?.reconnectAttempt ? 'Reconnecting' : 'Connecting';
      cls = 'info';
    } else if (st === 'closing') {
      label = 'Disconnecting';
      cls = 'info';
    } else if (st === 'closed') {
      const code = s?.closeCode;
      label = reconnecting ? 'Waiting to reconnect' : code != null ? `Disconnected ${code}` : 'Disconnected';
      title = code != null ? closeCodeText(code) : '';
      cls = reconnecting ? 'client' : code == null || code === 1000 || code === 1001 || code === 1005 ? 'idle' : 'server';
    }
    this.statusEl.dataset.class = cls;
    this.statusEl.dataset.state = st;
    this.statusEl.title = title;
    fill(this.statusEl, h('span.ws-dot', { 'aria-hidden': 'true' }), h('span', label), title ? h('span.sr-only', `, ${title}`) : null);

    // Connect button.
    const busy = st === 'connecting' || st === 'open' || reconnecting;
    this.connectBtn.classList.toggle('sending', busy);
    // Not disabled while closing: that would drop keyboard focus. Clicks are ignored then (toggleConnection).
    if (st === 'closing') this.connectBtn.setAttribute('aria-disabled', 'true');
    else this.connectBtn.removeAttribute('aria-disabled');
    const [ic, text, aria] =
      st === 'open' ? ['unplug', 'Disconnect', 'Disconnect']
        : st === 'connecting' ? ['x', 'Cancel', 'Cancel connecting']
          : st === 'closing' ? ['unplug', 'Disconnecting', 'Disconnecting']
            : reconnecting ? ['x', 'Stop', 'Stop reconnecting']
              : ['plug', 'Connect', 'Connect'];
    fill(this.connectBtn, icon(ic, 15), h('span', text));
    this.connectBtn.setAttribute('aria-label', aria);
    this.connectBtn.title = st === 'open' ? 'Disconnect' : st === 'idle' || st === 'closed' ? `Connect (${shortcut('Mod+Enter')})` : text;
    // A changed URL while connected: hint that reconnecting applies it.
    const stale = st === 'open' && s && this.draft.url.trim() && this.#resolvedUrl() !== s.url;
    this.applyBtn.hidden = !stale;
    this.applyBtn.title = stale ? `Connected to ${s.url}. Reconnect to use the edited URL.` : '';

    this.#renderStats();
    this.#renderSendBtn();
    this.#renderEmpty();
    for (const btn of this.el.querySelectorAll('.ws-resend')) this.#syncResend(btn);
    this.#tick();
  }

  /** Resend works only while connected; details stay open across state changes, so this runs on each one. */
  #syncResend(btn) {
    btn.disabled = this.state !== 'open';
    btn.title = this.state === 'open' ? 'Send this message again' : 'Connect to send again';
    return btn;
  }

  #renderStats() {
    const st = this.session?.stats || { sent: 0, received: 0 };
    fill(
      this.statsBtn,
      h('span.ws-stat', { title: 'Sent' }, icon('arrowUp', 12), h('span.sr-only', 'Sent: '), String(st.sent)),
      h('span.ws-stat', { title: 'Received' }, icon('arrowDown', 12), h('span.sr-only', 'Received: '), String(st.received)),
    );
    this.statsBtn.setAttribute('aria-label', `${plural(st.sent, 'message')} sent, ${st.received} received. Connection details`);
  }

  /** Updates the connected-for clock once a second while visible and open. */
  #tick() {
    clearInterval(this.timer);
    this.timer = 0;
    const s = this.session;
    const on = this.state === 'open' && s?.connectedAt;
    this.durationEl.hidden = !on;
    if (!on) return;
    const draw = () => {
      fill(this.durationEl, icon('clock', 12), h('span.sr-only', 'Connected for '), h('span', formatDuration(Date.now() - s.connectedAt)));
    };
    draw();
    if (this.visible) this.timer = setInterval(draw, 1000);
  }

  #matches(e) {
    if (this.filter !== 'all' && e.dir !== this.filter) return false;
    return !this.query || e.data.toLowerCase().includes(this.query);
  }

  /** Full rebuild from the session log: on show, filter, search and clear. */
  #renderLog() {
    if (!this.listEl) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.queue = [];
    this.stale = false;
    const all = this.session?.messages || [];
    const matching = all.filter((e) => this.#matches(e));
    const shown = matching.slice(-MAX_ROWS);
    const frag = document.createDocumentFragment();
    for (const e of shown) frag.append(this.#row(e));
    this.listEl.replaceChildren(frag);
    this.#renderNote(matching.length);
    this.#renderEmpty();
    this.#renderStats();
    this.#hideJump();
    this.#scrollToEnd();
  }

  #onEntry(entry) {
    if (entry.dir === 'in') this.#countIncoming();
    if (!this.visible) {
      this.stale = true;
      return;
    }
    // Frames pause in background tabs, so the queue keeps only what the list could show:
    // the latest rows that match the filter. Appending them later keeps the reading position.
    if (!this.stale && this.#matches(entry)) {
      this.queue.push(entry);
      if (this.queue.length > 2 * MAX_ROWS) this.queue.splice(0, this.queue.length - MAX_ROWS);
    }
    if (!this.frame) this.frame = requestAnimationFrame(() => this.#flush());
  }

  /** Appends queued entries in one batch per frame. */
  #flush() {
    this.frame = 0;
    if (this.stale) {
      this.#renderLog();
      return;
    }
    const queue = this.queue.slice(-MAX_ROWS);
    this.queue = [];
    if (!this.listEl) return;
    const atBottom = this.#atBottom();
    const frag = document.createDocumentFragment();
    let added = 0;
    for (const e of queue) {
      if (!this.#matches(e)) continue;
      frag.append(this.#row(e));
      added++;
    }
    if (added) {
      this.listEl.append(frag);
      let extra = this.listEl.children.length - MAX_ROWS;
      while (extra-- > 0) {
        const first = this.listEl.firstElementChild;
        this.expanded.delete(first.dataset.id);
        first.remove();
      }
      if (this.listEl.children.length >= MAX_ROWS) this.#renderNote((this.session?.messages || []).filter((e) => this.#matches(e)).length);
      if (this.autoScroll && atBottom) this.#scrollToEnd();
      else {
        this.unseen += added;
        this.#showJump();
      }
    }
    this.#renderEmpty();
    this.#renderStats();
  }

  #renderNote(total) {
    const over = total > MAX_ROWS;
    this.noteEl.hidden = !over;
    if (over) fill(this.noteEl, icon('info', 12), h('span', `Showing the latest ${MAX_ROWS} of ${total} messages. Search or filter to narrow the list.`));
  }

  #renderEmpty() {
    if (!this.emptyEl) return;
    const has = this.listEl.children.length > 0;
    this.emptyEl.hidden = has;
    this.listEl.hidden = !has;
    if (has) return;
    const total = this.session?.messages.length || 0;
    if (total) {
      fill(this.emptyEl, icon('search', 24), h('p', 'No messages match.'), h('button.btn.sm', { type: 'button', onclick: () => this.#resetFilters() }, 'Show all messages'));
      return;
    }
    const st = this.state;
    fill(
      this.emptyEl,
      icon(st === 'open' ? 'sendH' : 'plug', 28),
      h('p', st === 'open' ? 'Connected. Send a message to get started.' : st === 'connecting' ? 'Connecting...' : 'Connect to start exchanging messages.'),
      h('p.resp-hint', h('kbd', shortcut('Mod+Enter')), h('span', st === 'open' ? ' to send' : ' to connect')),
    );
  }

  #resetFilters() {
    this.filter = this.tab.wsFilter = 'all';
    this.query = '';
    this.searchEl.value = '';
    for (const b of this.bottom.querySelectorAll('.ws-filter button')) b.setAttribute('aria-checked', String(b.dataset.k === 'all'));
    this.#renderLog();
  }

  #atBottom() {
    const l = this.listEl;
    return l.scrollHeight - l.scrollTop - l.clientHeight < 32;
  }

  #scrollToEnd(focus = false) {
    this.listEl.scrollTop = this.listEl.scrollHeight;
    this.#hideJump();
    if (focus) this.listEl.lastElementChild?.querySelector('button')?.focus();
  }

  #showJump() {
    this.jumpBtn.hidden = false;
    fill(this.jumpBtn, icon('arrowDown', 14), h('span', `${plural(this.unseen, 'new message')}`));
  }

  #hideJump() {
    this.unseen = 0;
    if (this.jumpBtn) this.jumpBtn.hidden = true;
  }

  /** Throttled announcement of incoming messages. */
  #countIncoming() {
    this.incoming++;
    if (this.announceTimer) return;
    this.announceTimer = setTimeout(() => {
      this.announceTimer = 0;
      const n = this.incoming;
      this.incoming = 0;
      if (n && this.visible) announce(`${plural(n, 'message')} received`);
    }, ANNOUNCE_EVERY_MS);
  }

  #row(e) {
    const time = h('time.ws-time', { datetime: new Date(e.at).toISOString() }, clock(e.at));
    if (e.dir === 'system') {
      const ic = e.kind === 'open' ? 'plug' : e.kind === 'close' ? 'unplug' : e.kind === 'error' ? 'alert' : 'info';
      const name = e.kind === 'error' ? 'Error' : 'Event';
      return h(
        'li.ws-row.ws-system',
        { dataset: { id: e.id, dir: 'system', kind: e.kind } },
        h('div.ws-row-main', h('span.ws-dir', icon(ic, 13), h('span.sr-only', `${name}:`)), time, h('span.ws-system-text', e.data)),
      );
    }
    const detailId = `${this.id}-d-${e.id}`;
    const out = e.dir === 'out';
    const preview = e.data.length > PREVIEW_CHARS ? `${e.data.slice(0, PREVIEW_CHARS)}...` : e.data;
    const toggle = h(
      'button.ws-row-main',
      { type: 'button', 'aria-expanded': 'false', 'aria-controls': detailId },
      h('span.ws-dir', { title: out ? 'Sent' : 'Received' }, icon(out ? 'arrowUp' : 'arrowDown', 13), h('span.sr-only', out ? 'Sent:' : 'Received:')),
      time,
      h('span.ws-preview', e.binary ? h('span.ws-tag', 'Binary') : null, preview.replace(/\s+/g, ' ') || h('span.ws-faint', '(empty)')),
      h('span.ws-size', formatBytes(e.size)),
    );
    const li = h('li.ws-row', { dataset: { id: e.id, dir: e.dir } }, toggle);
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      li.classList.toggle('open', open);
      let detail = li.querySelector('.ws-detail');
      if (open && !detail) {
        detail = this.#detail(e, detailId);
        li.append(detail);
      }
      if (detail) detail.hidden = !open;
      if (open) this.expanded.add(e.id);
      else this.expanded.delete(e.id);
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    if (this.expanded.has(e.id)) setOpen(true);
    return li;
  }

  #detail(e, id) {
    let body = e.data;
    let isJson = false;
    if (!e.binary) {
      try {
        JSON.parse(e.data);
        body = prettyJson(e.data);
        isJson = /^\s*[[{]/.test(e.data);
      } catch {}
    }
    const cut = body.length > DETAIL_CHARS;
    const tools = h(
      'div.ws-detail-tools',
      h('span.ws-detail-kind', [e.binary ? 'Binary, shown as hex' : isJson ? 'JSON' : 'Text', `${formatBytes(e.size)}`, new Date(e.at).toLocaleString()].join(', ')),
      h('span.spacer'),
      !e.binary && e.dir === 'out' ? this.#syncResend(h('button.btn.sm.ws-resend', { type: 'button', onclick: () => this.#resend(e) }, icon('refresh', 13), 'Resend')) : null,
      !e.binary ? h('button.btn.sm', { type: 'button', title: 'Copy into a new message draft', onclick: () => this.#useAsDraft(e) }, icon('pencil', 13), 'Edit as new') : null,
      h('button.btn.sm', { type: 'button', onclick: () => this.#copy(e.data, 'Message copied') }, icon('copy', 13), 'Copy'),
    );
    return h(
      'div.ws-detail',
      { id },
      tools,
      h('pre.ws-detail-body', { tabindex: '0', 'aria-label': 'Message content' }, cut ? `${body.slice(0, DETAIL_CHARS)}\n...` : body),
      cut ? h('p.field-hint', 'Long message shortened. Copy to get all of it.') : null,
    );
  }

  async #copy(text, title) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ kind: 'success', title });
    } catch {
      toast({ kind: 'error', title: 'Could not copy to the clipboard' });
    }
  }

  // Keyboard ---------------------------------------------------------------------------------

  #onKey(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (e.key !== 'Enter' || e.altKey) return;
    if (!(modKey(e) || e.ctrlKey)) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    this.primaryAction();
  }

  // Layout ----------------------------------------------------------------------------------

  #wireSplit() {
    const key = 'split';
    let start = 0;
    let startRatio = 0;
    const apply = (ratio) => {
      const r = Math.min(0.85, Math.max(0.15, ratio));
      this.top.style.flex = `0 0 ${r * 100}%`;
      this.resizer.setAttribute('aria-valuenow', String(Math.round(r * 100)));
    };
    this.resizer.setAttribute('aria-valuemin', '15');
    this.resizer.setAttribute('aria-valuemax', '85');
    const side = () => this.split.classList.contains('side');
    const onMove = (e) => {
      const rect = this.split.getBoundingClientRect();
      const d = side() ? (e.clientX - start) / rect.width : (e.clientY - start) / rect.height;
      const r = Math.min(0.85, Math.max(0.15, startRatio + d));
      apply(r);
      prefs.set(key, r);
    };
    const stop = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', stop);
      document.body.classList.remove('resizing', 'resizing-y');
    };
    this.resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      start = side() ? e.clientX : e.clientY;
      startRatio = prefs.get(key);
      document.body.classList.add(side() ? 'resizing' : 'resizing-y');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', stop);
    });
    this.resizer.addEventListener('keydown', (e) => {
      const dec = side() ? 'ArrowLeft' : 'ArrowUp';
      const inc = side() ? 'ArrowRight' : 'ArrowDown';
      if (e.key !== dec && e.key !== inc) return;
      e.preventDefault();
      const r = Math.min(0.85, Math.max(0.15, prefs.get(key) + (e.key === inc ? 0.05 : -0.05)));
      apply(r);
      prefs.set(key, r);
    });
    this.applySplit = () => apply(prefs.get(key));
    this.applySplit();
  }

  setLayout(layout) {
    this.layout = layout;
    this.#fitLayout();
  }

  /** Side by side needs room for both panes: a narrower split shows the response below, as Settings says. */
  #fitLayout() {
    const width = this.split.clientWidth;
    const side = this.layout === 'side' && !(width && width < SIDE_BY_SIDE_MIN);
    if (this.split.classList.contains('side') === side) return;
    this.split.classList.toggle('side', side);
    this.resizer.setAttribute('aria-orientation', side ? 'vertical' : 'horizontal');
    this.applySplit?.();
  }

  #mobileSwitch() {
    const seg = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Show' });
    for (const [k, label] of [['request', 'Request'], ['response', 'Messages']]) {
      seg.append(h('button', { type: 'button', role: 'radio', dataset: { k }, 'aria-checked': String((this.tab.mobilePane || 'request') === k), onclick: () => this.#setMobile(k) }, label));
    }
    this.mobileSeg = seg;
    return seg;
  }

  #setMobile(k) {
    this.tab.mobilePane = k;
    this.split.dataset.mobile = k;
    for (const b of this.mobileSeg.children) b.setAttribute('aria-checked', String(b.dataset.k === k));
  }

  // Lifecycle ---------------------------------------------------------------------------------

  onShow({ focus } = {}) {
    this.visible = true;
    this.#attach();
    this.#renderHead();
    this.#renderState();
    if (this.stale) this.#renderLog();
    if (focus) setTimeout(() => (this.draft.url ? this.tabsEl.querySelector('[aria-selected="true"]') : this.url.input)?.focus(), 0);
  }

  onHide() {
    this.visible = false;
    clearInterval(this.timer);
    this.timer = 0;
  }

  destroy() {
    this.visible = false;
    clearInterval(this.timer);
    clearTimeout(this.announceTimer);
    this.splitObserver.disconnect();
    cancelAnimationFrame(this.frame);
    this.persist.cancel();
    this.validate.cancel();
    this.#detach();
    for (const ed of this.editors) ed.destroy();
    this.msgEditor?.destroy();
    // The view is also rebuilt while the tab stays open (for example after
    // Save as); only close the connection when the tab itself is gone.
    const open = Array.isArray(this.app.tabs) && this.app.tabs.includes(this.tab);
    if (!open && this.tab.session) {
      this.tab.session.dispose();
      this.tab.session = null;
    }
  }
}

