/**
 * Command palette (Mod+K): one search box over saved requests, collections,
 * environments, recent history and app commands. The input is a combobox
 * that drives a listbox through aria-activedescendant, so focus never leaves
 * the text field while arrows move the highlighted result.
 *
 * Typing ">" first limits results to commands.
 */
import { h, fill, shortcut, domId } from '../lib/dom.js';
import { requestsIn, leavesIn } from '../core/model.js';
import { relativeDay, timeOfDay } from '../lib/format.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';
import { openImportDialog, openExportDialog, openSettingsDialog, openShortcutsDialog, openCookiesDialog } from './dialogs.js';

const MAX_RESULTS = 50;
const GROUP_LIMIT = { requests: 25, collections: 10, environments: 10, history: 10, commands: 15, tabs: 8, recent: 6 };

// Matching ------------------------------------------------------------------

const isWordChar = (c) => /[a-z0-9]/i.test(c);

function isBoundary(text, i) {
  if (i === 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  if (!isWordChar(prev)) return true;
  // camelCase and letter/digit transitions start a new word.
  if (/[a-z]/.test(prev) && /[A-Z]/.test(cur)) return true;
  if (/[a-z]/i.test(prev) !== /[a-z]/i.test(cur)) return true;
  return false;
}

function matchToken(tok, text, lower) {
  // Contiguous matches beat scattered ones; prefer an occurrence that starts a word.
  let best = -1;
  for (let at = lower.indexOf(tok); at >= 0; at = lower.indexOf(tok, at + 1)) {
    if (best < 0) best = at;
    if (isBoundary(text, at)) {
      best = at;
      break;
    }
  }
  if (best >= 0) {
    const positions = Array.from({ length: tok.length }, (_, k) => best + k);
    let s = 100 + tok.length * 12 - Math.min(best, 40) * 0.5;
    if (isBoundary(text, best)) s += 30;
    if (best === 0) s += 20;
    return { score: s, positions };
  }
  // Subsequence: walk left to right, but take a word-start occurrence of the
  // next character when one exists before the following query character needs it.
  const positions = [];
  let from = 0;
  for (let k = 0; k < tok.length; k++) {
    const ch = tok[k];
    let at = lower.indexOf(ch, from);
    if (at < 0) return null;
    const prevMatched = positions.length ? positions[positions.length - 1] : -2;
    if (at !== prevMatched + 1 && !isBoundary(text, at)) {
      // Look for a better (word-start) occurrence that still leaves room for the rest.
      for (let j = at + 1; j < lower.length; j++) {
        if (lower[j] === ch && isBoundary(text, j) && fits(tok, k + 1, lower, j + 1)) {
          at = j;
          break;
        }
      }
    }
    positions.push(at);
    from = at + 1;
  }
  // Letters scattered across the text are noise unless they start words (an acronym).
  const spread = positions[positions.length - 1] - positions[0] + 1;
  const wordStarts = positions.filter((p, k) => isBoundary(text, p) || (k > 0 && positions[k - 1] === p - 1)).length;
  if (spread > tok.length * 3 + 4 && wordStarts < positions.length) return null;
  let s = 0;
  for (let k = 0; k < positions.length; k++) {
    const p = positions[k];
    s += 4;
    if (isBoundary(text, p)) s += 10;
    if (k > 0) {
      const gap = p - positions[k - 1] - 1;
      if (gap === 0) s += 8;
      else s -= Math.min(gap, 12) * 0.6;
    }
  }
  if (positions[0] === 0) s += 6;
  return { score: s, positions };
}

function fits(tok, k, lower, from) {
  for (; k < tok.length; k++) {
    const at = lower.indexOf(tok[k], from);
    if (at < 0) return false;
    from = at + 1;
  }
  return true;
}

/**
 * Fuzzy match of `query` against `text`. Every whitespace-separated word of
 * the query must appear in the text, either as a substring or as a
 * subsequence. Returns { score, positions } (higher is better; positions are
 * the matched character indexes) or null when there is no match.
 */
export function score(query, text) {
  const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const t = String(text ?? '');
  if (!tokens.length) return { score: 0, positions: [] };
  const lower = t.toLowerCase();
  let total = 0;
  const all = new Set();
  for (const tok of tokens) {
    const m = matchToken(tok, t, lower);
    if (!m) return null;
    total += m.score;
    for (const p of m.positions) all.add(p);
  }
  // Shorter texts are closer matches when everything else is equal.
  total -= Math.min(t.length, 200) * 0.05;
  return { score: total, positions: [...all].sort((a, b) => a - b) };
}

/** Text with matched characters wrapped in <mark>. */
export function highlight(text, positions = []) {
  if (!positions.length) return [text];
  const out = [];
  const set = new Set(positions);
  let i = 0;
  while (i < text.length) {
    const marked = set.has(i);
    let j = i;
    while (j < text.length && set.has(j) === marked) j++;
    const chunk = text.slice(i, j);
    out.push(marked ? h('mark', chunk) : chunk);
    i = j;
  }
  return out;
}

/** Scores an entry on its label first, then on label plus its extra keywords. */
function rank(query, entry) {
  const direct = score(query, entry.label);
  if (direct) return { score: direct.score + 10, positions: direct.positions };
  if (!entry.keywords) return null;
  // Paths and URLs are full of word starts, so letters scattered across them match almost anything:
  // there, every word of the query has to appear as typed.
  const text = `${entry.label} ${entry.keywords}`;
  const lower = text.toLowerCase();
  if (!String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean).every((tok) => lower.includes(tok))) return null;
  const wide = score(query, text);
  if (!wide) return null;
  return { score: wide.score - 25, positions: wide.positions.filter((p) => p < entry.label.length) };
}

// Sources ---------------------------------------------------------------------

function requestEntries(app) {
  const out = [];
  for (const c of app.ws.collections) {
    for (const { item, parents } of leavesIn(c)) {
      const path = [c.name, ...parents.map((p) => p.name)].join(' / ');
      const ws = item.type === 'websocket';
      out.push({
        group: 'requests',
        key: `r:${item.id}`,
        label: item.name,
        method: ws ? 'WS' : item.method,
        detail: path,
        keywords: `${ws ? 'WS' : item.method} ${path} ${item.url}`,
        run: () => app.openTab(ws ? 'websocket' : 'request', item.id),
      });
    }
  }
  return out;
}

function collectionEntries(app) {
  return app.ws.collections.map((c) => {
    const n = requestsIn(c).length;
    return {
      group: 'collections',
      key: `c:${c.id}`,
      label: c.name,
      icon: 'collections',
      detail: `${n} request${n === 1 ? '' : 's'}`,
      run: () => app.openTab('collection', c.id),
    };
  });
}

function environmentEntries(app) {
  const list = app.ws.environments.map((e) => ({
    group: 'environments',
    key: `e:${e.id}`,
    label: e.name,
    icon: 'globe',
    detail: e.id === app.environmentId ? 'Active' : `${e.variables.length} variable${e.variables.length === 1 ? '' : 's'}`,
    run: () => app.openTab('environment', e.id),
  }));
  list.push({ group: 'environments', key: 'e:globals', label: 'Globals', icon: 'globe', detail: 'Variables for every request', run: () => app.openTab('environment', 'globals') });
  return list;
}

function historyEntries(app, limit = 20) {
  const out = [];
  const seen = new Set();
  for (const entry of app.ws.history || []) {
    const r = entry.request;
    if (!r) continue;
    const sig = `${r.method} ${r.url}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const status = entry.response?.status ? String(entry.response.status) : entry.error ? 'Failed' : '';
    const when = `${relativeDay(entry.at)} ${timeOfDay(entry.at)}`;
    out.push({
      group: 'history',
      key: `h:${entry.id}`,
      label: r.url || r.name || 'Untitled request',
      method: r.method,
      detail: [status, when].filter(Boolean).join(', '),
      keywords: `${r.method} ${r.name}`,
      run: () => app.openHistory(entry),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function tabEntries(app) {
  return (app.tabs || [])
    .filter((t) => t.id !== app.activeId)
    .map((t) => ({
      group: 'tabs',
      key: `t:${t.id}`,
      label: app.tabTitle ? app.tabTitle(t) : t.draft?.name || 'Tab',
      method: t.kind === 'request' ? t.draft?.method : null,
      icon: t.kind === 'request' ? null : t.kind === 'environment' ? 'globe' : t.kind === 'runner' ? 'play' : 'collections',
      detail: 'Open tab',
      run: () => app.activate(t.id, { focus: true }),
    }));
}

function activeCollectionId(app) {
  const tab = app.activeTab;
  if (!tab?.refId) return null;
  if (tab.kind === 'environment') return null;
  return app.ws.locate?.(tab.refId)?.collection?.id || null;
}

function commandEntries(app) {
  const cmd = (key, label, ic, run, extra = {}) => ({ group: 'commands', key: `cmd:${key}`, label, icon: ic, run, ...extra });
  const signedIn = !!app.session?.signedIn;
  const tab = app.activeTab;
  const list = [
    cmd('new-request', 'New request', 'plus', () => app.newRequest(), { kbd: 'Mod+Alt+N', top: true }),
    cmd('new-collection', 'New collection', 'folderPlus', () => app.createCollection(), { top: true }),
    cmd('new-environment', 'New environment', 'globe', () => app.createEnvironment(), { top: true }),
    cmd('import', 'Import', 'import', () => openImportDialog(app), { kbd: 'Mod+O', keywords: 'open file curl paste link', top: true }),
    cmd('export', 'Export everything', 'download', () => openExportDialog(app), { keywords: 'backup download' }),
  ];
  if (tab?.kind === 'request') {
    list.push(cmd('send', 'Send request', 'sendH', () => app.sendTab(app.activeTab), { kbd: 'Mod+Enter' }));
    list.push(cmd('save', 'Save request', 'save', () => app.saveTab(), { kbd: 'Mod+S' }));
    list.push(cmd('save-as', 'Save request as', 'save', () => app.saveTabAs(), { kbd: 'Mod+Shift+S' }));
  }
  const colId = activeCollectionId(app);
  const col = colId ? app.ws.getCollection(colId) : null;
  if (col) list.push(cmd('run', `Run collection: ${col.name}`, 'play', () => app.runCollection(col.id), { keywords: 'runner tests' }));
  const theme = prefs.get('theme');
  for (const [t, label, ic] of [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]) {
    list.push(cmd(`theme-${t}`, `Theme: ${label}`, ic, () => app.setTheme(t), { keywords: 'appearance color mode', detail: theme === t ? 'Current' : '' }));
  }
  list.push(cmd('sidebar', 'Toggle sidebar', 'panelLeft', () => app.toggleSidebar(), { kbd: 'Mod+\\', top: true }));
  list.push(cmd('console', 'Toggle console', 'terminal', () => app.console?.toggle(), { kbdText: 'Ctrl+`', keywords: 'logs' }));
  const layout = prefs.get('layout');
  list.push(cmd('layout-stacked', 'Response layout: Below the request', 'rows', () => app.setLayout('stacked'), { detail: layout !== 'side' ? 'Current' : '' }));
  list.push(cmd('layout-side', 'Response layout: Beside the request', 'columns', () => app.setLayout('side'), { detail: layout === 'side' ? 'Current' : '' }));
  const transport = prefs.get('transport');
  list.push(cmd('transport-auto', 'Send through: Automatic', 'zap', () => app.setTransport('auto'), { keywords: 'transport relay browser cors', detail: transport === 'auto' ? 'Current' : '' }));
  list.push(cmd('transport-browser', 'Send through: Browser only', 'globe', () => app.setTransport('browser'), { keywords: 'transport cors', detail: transport === 'browser' ? 'Current' : '' }));
  if (signedIn) list.push(cmd('transport-relay', 'Send through: Puter relay', 'server', () => app.setTransport('relay'), { keywords: 'transport cors proxy', detail: transport === 'relay' ? 'Current' : '' }));
  list.push(cmd('cookies', 'Manage cookies', 'cookie', () => openCookiesDialog(app)));
  list.push(cmd('settings', 'Settings', 'settings', () => openSettingsDialog(app), { keywords: 'preferences options', top: true }));
  list.push(cmd('shortcuts', 'Keyboard shortcuts', 'keyboard', () => openShortcutsDialog(), { kbd: 'Mod+/', keywords: 'keys help', top: true }));
  list.push(cmd('env-none', 'Select environment: No environment', 'circleSlash', () => app.setEnvironment(null), { keywords: 'switch', detail: app.environmentId ? '' : 'Active' }));
  for (const e of app.ws.environments) {
    list.push(cmd(`env-${e.id}`, `Select environment: ${e.name}`, 'globe', () => app.setEnvironment(e.id), { keywords: 'switch use', detail: e.id === app.environmentId ? 'Active' : '' }));
  }
  if (app.session?.puter && !signedIn) list.push(cmd('sign-in', 'Sign in to Puter', 'logIn', () => app.signIn(), { keywords: 'account sync login' }));
  return list;
}

const GROUP_TITLES = {
  tabs: 'Open tabs',
  recent: 'Recent',
  requests: 'Requests',
  collections: 'Collections',
  environments: 'Environments',
  history: 'History',
  commands: 'Commands',
};
const GROUP_ORDER = ['requests', 'collections', 'environments', 'history', 'commands'];

/** Builds grouped results: [{ group, items: [{ entry, positions }] }]. */
export function search(app, query) {
  const raw = String(query || '');
  const commandsOnly = raw.trimStart().startsWith('>');
  const q = commandsOnly ? raw.trimStart().slice(1).trim() : raw.trim();

  if (!q && !commandsOnly) {
    const groups = [];
    const tabs = tabEntries(app).slice(0, GROUP_LIMIT.tabs);
    if (tabs.length) groups.push({ group: 'tabs', items: tabs.map((entry) => ({ entry, positions: [] })) });
    const recent = historyEntries(app, GROUP_LIMIT.recent).map((e) => ({ ...e, group: 'recent' }));
    if (recent.length) groups.push({ group: 'recent', items: recent.map((entry) => ({ entry, positions: [] })) });
    const top = commandEntries(app).filter((c) => c.top);
    groups.push({ group: 'commands', items: top.map((entry) => ({ entry, positions: [] })) });
    return groups;
  }

  const sources = commandsOnly
    ? { commands: commandEntries(app) }
    : {
        requests: requestEntries(app),
        collections: collectionEntries(app),
        environments: environmentEntries(app),
        history: historyEntries(app, 20),
        commands: commandEntries(app),
      };

  const groups = [];
  for (const g of GROUP_ORDER) {
    const list = sources[g];
    if (!list) continue;
    const scored = [];
    for (const entry of list) {
      const m = q ? rank(q, entry) : { score: 0, positions: [] };
      if (m) scored.push({ entry, positions: m.positions, score: m.score });
    }
    if (!scored.length) continue;
    scored.sort((a, b) => b.score - a.score);
    const items = scored.slice(0, GROUP_LIMIT[g]);
    groups.push({ group: g, items, best: items[0].score });
  }
  // The group holding the best match comes first; ties keep the natural order.
  groups.sort((a, b) => b.best - a.best || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  let budget = MAX_RESULTS;
  const out = [];
  for (const g of groups) {
    if (budget <= 0) break;
    const items = g.items.slice(0, budget);
    budget -= items.length;
    out.push({ group: g.group, items });
  }
  return out;
}

// UI ----------------------------------------------------------------------------

let current = null;

export function openPalette(app) {
  if (current) {
    current.input.focus();
    current.input.select();
    return current;
  }
  const returnFocus = document.activeElement;
  const listId = domId('palette-list');
  const input = h('input.palette-input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Search requests, collections, environments and commands',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    spellcheck: false,
    placeholder: 'Search requests, collections and commands',
  });
  const list = h('div.palette-list', { id: listId, role: 'listbox', 'aria-label': 'Results' });
  const status = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  const foot = h(
    'div.palette-foot',
    { 'aria-hidden': 'true' },
    h('span', h('kbd', '↑'), h('kbd', '↓'), ' to move'),
    h('span', h('kbd', 'Enter'), ' to open'),
    h('span', h('kbd', 'Esc'), ' to close'),
    h('span.palette-foot-tip', 'Type ', h('kbd', '>'), ' for commands'),
  );
  const el = h(
    'dialog.dialog.palette',
    { 'aria-label': 'Search' },
    h('div.palette-search', icon('search', 16), input, h('kbd.palette-esc', { 'aria-hidden': 'true' }, 'Esc')),
    list,
    foot,
    status,
  );

  let options = [];
  let active = -1;
  let pendingRun = null;

  const setActive = (i, { scroll = true } = {}) => {
    if (!options.length) {
      active = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    active = (i + options.length) % options.length;
    options.forEach((o, k) => o.el.setAttribute('aria-selected', String(k === active)));
    const o = options[active];
    input.setAttribute('aria-activedescendant', o.el.id);
    if (scroll) o.el.scrollIntoView({ block: 'nearest' });
  };

  const render = () => {
    const groups = search(app, input.value);
    options = [];
    const nodes = [];
    for (const g of groups) {
      const headId = domId('palette-group');
      const opts = g.items.map(({ entry, positions }) => {
        const id = domId('palette-opt');
        const lead = entry.method
          ? h('span.method.palette-method', { dataset: { m: entry.method } }, entry.method.length > 6 ? entry.method.slice(0, 6) : entry.method)
          : h('span.palette-icon', icon(entry.icon || 'fileText', 15));
        const kbd = entry.kbdText || (entry.kbd ? shortcut(entry.kbd) : null);
        const optEl = h(
          'div.palette-opt',
          { id, role: 'option', 'aria-selected': 'false' },
          lead,
          h('span.palette-text', h('span.palette-label', { title: entry.label }, highlight(entry.label, positions)), entry.detail ? h('span.palette-detail', { title: entry.detail }, entry.detail) : null),
          kbd ? h('kbd.palette-kbd', kbd) : null,
        );
        const index = options.length;
        optEl.addEventListener('pointermove', () => {
          if (active !== index) setActive(index, { scroll: false });
        });
        optEl.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
        optEl.addEventListener('click', () => choose(index));
        options.push({ el: optEl, entry });
        return optEl;
      });
      nodes.push(h('div.palette-group', { role: 'group', 'aria-labelledby': headId }, h('div.palette-group-title', { id: headId, role: 'presentation' }, GROUP_TITLES[g.group] || g.group), opts));
    }
    if (!options.length) {
      nodes.push(
        h(
          'div.palette-empty',
          { role: 'presentation' },
          h('p', `No results for "${input.value.trim()}"`),
          h('p.palette-empty-hint', 'Try fewer letters, or type > to search commands only.'),
        ),
      );
    }
    fill(list, nodes);
    setActive(0);
    const n = options.length;
    status.textContent = input.value.trim() ? (n ? `${n} result${n === 1 ? '' : 's'}` : 'No results') : '';
  };

  const close = () => {
    if (el.open) el.close();
  };

  const choose = (i) => {
    const o = options[i];
    if (!o) return;
    pendingRun = o.entry.run;
    close();
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') setActive(active + 1);
    else if (e.key === 'ArrowUp') setActive(active - 1);
    else if (e.key === 'PageDown') setActive(Math.min(options.length - 1, active + 8));
    else if (e.key === 'PageUp') setActive(Math.max(0, active - 8));
    else if (e.key === 'Home' && e.ctrlKey) setActive(0);
    else if (e.key === 'End' && e.ctrlKey) setActive(options.length - 1);
    else if (e.key === 'Enter') choose(active);
    else if (e.key === 'Escape') {
      if (input.value) {
        input.value = '';
        render();
      } else close();
    } else if (e.key === 'Tab') {
      // Keep focus on the field: Tab moves through results like the arrows.
      setActive(active + (e.shiftKey ? -1 : 1));
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  // Escape on the dialog itself (cancel) is handled by the input; this covers other focus.
  el.addEventListener('cancel', (e) => {
    if (input.value && document.activeElement === input) {
      e.preventDefault();
      input.value = '';
      render();
    }
  });
  el.addEventListener('pointerdown', (e) => {
    if (e.target !== el) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  el.addEventListener('close', () => {
    el.remove();
    current = null;
    const run = pendingRun;
    pendingRun = null;
    if (run) {
      // Run after the palette is gone so dialogs and tabs take focus cleanly.
      setTimeout(() => {
        try {
          const r = run();
          r?.catch?.((err) => console.error(err));
        } catch (err) {
          console.error(err);
        }
      }, 0);
    } else if (returnFocus && document.contains(returnFocus)) returnFocus.focus?.();
  });

  document.body.append(el);
  el.showModal();
  render();
  input.focus();
  current = { el, input, close, render };
  return current;
}
