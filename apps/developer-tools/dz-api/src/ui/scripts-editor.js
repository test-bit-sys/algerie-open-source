/**
 * Pre-request and post-response script editor shared by requests, folders
 * and collections: a vertical tab list for the two phases, a JavaScript
 * editor with completions for the script API, and a list of snippets that
 * append common code to the end of the script.
 *
 * createScriptsEditor({ scripts: { pre, post }, onChange(scripts), label, isVariableDefined, scope })
 *   scope: 'request' | 'folder' | 'collection' (only changes the help text)
 * Returns { el, setScripts, getScripts, select(phase), focus(), destroy() }.
 */
import { h, fill, domId, announce } from '../lib/dom.js';
import { icon } from './icons.js';
import { codeEditor } from './code-editor.js';
import { menuButton } from './menu.js';
import { openDialog } from './dialog.js';

// Script API completions ------------------------------------------------------

const fn = (label, detail) => ({ label, detail, type: 'function', apply: `${label}()` });
const prop = (label, detail) => ({ label, detail, type: 'property' });
const ns = (label, detail) => ({ label, detail, type: 'namespace' });

function scopeEntries(name, what, intro) {
  return [
    ns(name, intro),
    fn(`${name}.get`, `(name) Read ${what} variable`),
    fn(`${name}.set`, `(name, value) Set ${what} variable; objects are stored as JSON`),
    fn(`${name}.unset`, `(name) Remove ${what} variable`),
    fn(`${name}.has`, `(name) True when ${what} variable is set`),
    fn(`${name}.clear`, `() Remove every variable in this scope`),
    fn(`${name}.toObject`, `() Every variable in this scope as an object`),
  ];
}

/** Completions offered in script editors: { label, detail, type, apply }. */
export const SCRIPT_COMPLETIONS = [
  fn('test', '(name, fn) Define a named test; fn may be async'),
  fn('test.skip', '(name) Record a skipped test'),
  fn('expect', '(value) Start an assertion, then chain a matcher'),
  prop('.not', 'Negate the next matcher'),
  prop('.resolves', 'Assert on the value a promise resolves with'),
  prop('.rejects', 'Assert on the error a promise rejects with'),
  fn('.toBe', '(expected) Same value (Object.is)'),
  fn('.toEqual', '(expected) Deep equality'),
  fn('.toStrictEqual', '(expected) Deep equality including types and undefined keys'),
  fn('.toBeTruthy', '() Truthy value'),
  fn('.toBeFalsy', '() Falsy value'),
  fn('.toBeNull', '() Exactly null'),
  fn('.toBeUndefined', '() Exactly undefined'),
  fn('.toBeDefined', '() Anything but undefined'),
  fn('.toBeNaN', '() NaN'),
  fn('.toBeGreaterThan', '(number) Greater than'),
  fn('.toBeGreaterThanOrEqual', '(number) Greater than or equal to'),
  fn('.toBeLessThan', '(number) Less than'),
  fn('.toBeLessThanOrEqual', '(number) Less than or equal to'),
  fn('.toBeCloseTo', '(number, digits) Approximately equal'),
  fn('.toContain', '(item) String contains text, or list contains item'),
  fn('.toContainEqual', '(item) List contains an item deeply equal to this'),
  fn('.toMatch', '(pattern) String matches a regular expression or text'),
  fn('.toHaveLength', '(n) Has a length of n'),
  fn('.toHaveProperty', '(path, value?) Has a property, optionally equal to value'),
  fn('.toBeInstanceOf', '(Class) Instance of a class'),
  fn('.toBeOneOf', '(list) Equal to one of the options'),
  fn('.toBeType', '(type) string, number, boolean, object, array, null, ...'),
  fn('.toMatchObject', '(object) Contains these properties'),
  fn('.toThrow', '(expected?) Function throws'),

  ns('request', 'The request being sent (editable before it is sent)'),
  prop('request.method', 'HTTP method'),
  prop('request.url', 'URL, with {{variables}} not yet resolved'),
  ns('request.headers', 'Request headers'),
  fn('request.headers.get', '(name) Header value, or null'),
  fn('request.headers.has', '(name) True when the header is present'),
  fn('request.headers.set', '(name, value) Add or replace a header'),
  fn('request.headers.remove', '(name) Remove a header'),
  fn('request.headers.toObject', '() Headers as an object'),
  fn('request.headers.list', '() Headers as [{ key, value, enabled }]'),
  ns('request.body', 'Request body'),
  prop('request.body.mode', 'none, raw, form, urlencoded, binary or graphql'),
  prop('request.body.raw', 'Raw body text'),
  fn('request.body.json', '() Raw body parsed as JSON'),

  ns('response', 'The response (post-response scripts only)'),
  prop('response.status', 'Status code, for example 200'),
  prop('response.code', 'Same as response.status'),
  prop('response.statusText', 'Status text, for example OK'),
  prop('response.ok', 'True for 2xx status codes'),
  ns('response.headers', 'Response headers'),
  fn('response.headers.get', '(name) Header value, or null'),
  fn('response.headers.has', '(name) True when the header is present'),
  fn('response.headers.toObject', '() Headers as an object'),
  fn('response.headers.list', '() Headers as [{ key, value }]'),
  fn('response.text', '() Body as text'),
  fn('response.json', '() Body parsed as JSON'),
  prop('response.time', 'Response time in milliseconds'),
  prop('response.size', 'Body size in bytes'),

  ...scopeEntries('env', 'an environment', 'Variables of the active environment'),
  ...scopeEntries('collectionVars', 'a collection', 'Variables of this collection'),
  ...scopeEntries('globals', 'a global', 'Global variables'),
  ...scopeEntries('vars', 'a script', 'Temporary variables for this run; they take precedence over every other scope'),
  ns('variables', 'Read across all scopes, narrowest first'),
  fn('variables.get', '(name) Value from the first scope that has it'),
  fn('variables.has', '(name) True when any scope has the variable'),
  fn('variables.resolve', '(text) Replace {{variables}} in text'),
  fn('variables.toObject', '() Every visible variable as an object'),

  ns('console', 'Write to the app console'),
  fn('console.log', '(...values) Log values'),
  fn('console.info', '(...values) Log at info level'),
  fn('console.warn', '(...values) Log a warning'),
  fn('console.error', '(...values) Log an error'),
  fn('console.debug', '(...values) Log at debug level'),
  fn('console.table', '(value) Log a value'),
  fn('console.dir', '(value) Log a value'),
  fn('console.assert', '(condition, ...values) Log an error when condition is false'),

  fn('send', '(request) Send another request; await it for a response'),

  ns('runner', 'Control a collection run'),
  fn('runner.next', '(name) Continue with the request with this name; null ends this iteration'),
  fn('runner.stop', '() Stop the run after this request'),

  ns('info', 'Details about the current run'),
  prop('info.requestName', 'Name of the request'),
  prop('info.requestId', 'Id of the request'),
  prop('info.phase', 'pre or post'),
  prop('info.source', 'Name of the item this script belongs to'),
  prop('info.iteration', 'Iteration number in a collection run, from 0'),
  prop('info.iterationCount', 'Number of iterations in a collection run'),

  ns('utils', 'Encoding, hashing and ids'),
  fn('utils.base64', '(text) Base64-encode text'),
  fn('utils.base64Decode', '(text) Decode Base64 to text'),
  fn('utils.sha256', '(text) SHA-256 hex digest; await it'),
  fn('utils.hmacSha256', '(key, message) HMAC-SHA256 hex digest; await it'),
  fn('utils.uuid', '() Random UUID'),
];

// Snippets --------------------------------------------------------------------

export const SNIPPETS = {
  pre: [
    {
      label: 'Set a timestamp variable',
      code: "// Use {{timestamp}} in the URL, headers or body.\nvars.set('timestamp', String(Date.now()));",
    },
    {
      label: 'Set a random id variable',
      code: "// Use {{requestId}} anywhere in the request.\nvars.set('requestId', utils.uuid());",
    },
    {
      label: 'Add a header',
      code: "request.headers.set('X-Request-Id', utils.uuid());",
    },
    {
      label: 'Generate a signature',
      code:
        "// Signs method, URL and body with a secret from the environment.\nconst secret = env.get('apiSecret') || '';\nconst payload = request.method + '\\n' + variables.resolve(request.url) + '\\n' + variables.resolve(request.body.raw);\nconst signature = await utils.hmacSha256(secret, payload);\nrequest.headers.set('X-Signature', signature);",
    },
    {
      label: 'Basic auth header from variables',
      code: "const credentials = utils.base64(env.get('username') + ':' + env.get('password'));\nrequest.headers.set('Authorization', 'Basic ' + credentials);",
    },
    {
      label: 'Fetch a token first',
      code:
        "const res = await send({\n  url: env.get('tokenUrl'),\n  method: 'POST',\n  body: { clientId: env.get('clientId'), clientSecret: env.get('clientSecret') },\n});\nenv.set('token', res.json().access_token);",
    },
    {
      label: 'Log the request',
      code: 'console.log(request.method, variables.resolve(request.url));',
    },
  ],
  post: [
    {
      label: 'Status code is 200',
      code: "test('Status code is 200', () => {\n  expect(response.status).toBe(200);\n});",
    },
    {
      label: 'Response time below 500 ms',
      code: "test('Response time is below 500 ms', () => {\n  expect(response.time).toBeLessThan(500);\n});",
    },
    {
      label: 'Body contains text',
      code: "test('Body contains text', () => {\n  expect(response.text()).toContain('expected text');\n});",
    },
    {
      label: 'JSON value check',
      code: "test('JSON value is correct', () => {\n  const data = response.json();\n  expect(data.id).toBe(1);\n});",
    },
    {
      label: 'Header present',
      code: "test('Content-Type header is present', () => {\n  expect(response.headers.has('Content-Type')).toBe(true);\n});",
    },
    {
      label: 'Set an environment variable from the response',
      code: "const data = response.json();\nenv.set('token', data.token);",
    },
    {
      label: 'Set a global',
      code: "globals.set('lastStatus', response.status);",
    },
    {
      label: 'Log the response',
      code: 'console.log(response.status, response.text());',
    },
    {
      label: 'Send another request',
      code:
        "const res = await send({\n  url: 'https://example.com/api/items',\n  method: 'GET',\n  headers: { Accept: 'application/json' },\n});\nconsole.log(res.status, res.json());",
    },
    {
      label: 'Skip to a request (runner.next)',
      code: "// In a collection run, continue with the request named here.\n// runner.next(null) ends this iteration; runner.stop() ends the run.\nrunner.next('Request name');",
    },
  ],
};

const PHASES = ['pre', 'post'];
const PHASE_LABEL = { pre: 'Pre-request', post: 'Post-response' };
const PHASE_DESC = {
  request: {
    pre: 'Runs before this request is sent. Change the request, set variables or fetch a token.',
    post: 'Runs after the response arrives. Write tests and save values from the response.',
  },
  folder: {
    pre: 'Runs before every request in this folder, after the collection script and before the request script.',
    post: 'Runs after every response in this folder, after the collection script and before the request script.',
  },
  collection: {
    pre: 'Runs before every request in this collection, ahead of folder and request scripts.',
    post: 'Runs after every response in this collection, ahead of folder and request scripts.',
  },
};
const PLACEHOLDER = {
  pre: '// Runs before the request is sent. Start typing for the script API, or add a snippet.',
  post: '// Runs after the response arrives. Use test() and expect() to check it.',
};

// Tabs helper (shared with collection view) ------------------------------------

/**
 * Wires roving focus and arrow-key navigation on a tablist. tabs: the tab
 * buttons in order. onSelect(index) runs when a tab is activated.
 */
export function wireTabs(tablist, tabs, { orientation = 'horizontal', onSelect } = {}) {
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-orientation', orientation);
  const prev = orientation === 'vertical' ? ['ArrowUp', 'ArrowLeft'] : ['ArrowLeft', 'ArrowUp'];
  const next = orientation === 'vertical' ? ['ArrowDown', 'ArrowRight'] : ['ArrowRight', 'ArrowDown'];
  tabs.forEach((tab, i) => {
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => onSelect?.(i));
  });
  tablist.addEventListener('keydown', (e) => {
    const visible = tabs.filter((t) => !t.hidden);
    const i = visible.indexOf(document.activeElement);
    if (i < 0) return;
    let to = -1;
    if (prev.includes(e.key)) to = (i - 1 + visible.length) % visible.length;
    else if (next.includes(e.key)) to = (i + 1) % visible.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = visible.length - 1;
    else return;
    e.preventDefault();
    visible[to].focus();
    onSelect?.(tabs.indexOf(visible[to]));
  });
}

/** Marks one tab selected (aria-selected, roving tabindex). */
export function selectTab(tabs, index) {
  tabs.forEach((t, i) => {
    t.setAttribute('aria-selected', String(i === index));
    t.tabIndex = i === index ? 0 : -1;
  });
}

// Reference ---------------------------------------------------------------------

const GROUPS = [
  ['Tests', ['test', 'expect']],
  ['Assertions', ['.']],
  ['Request', ['request']],
  ['Response (post-response only)', ['response']],
  ['Variables', ['env', 'collectionVars', 'globals', 'vars', 'variables']],
  ['Sending requests', ['send']],
  ['Collection runs', ['runner', 'info']],
  ['Console', ['console']],
  ['Utilities', ['utils']],
];

function groupOf(entry) {
  if (entry.label.startsWith('.')) return 'Assertions';
  const root = entry.label.split('.')[0];
  return GROUPS.find(([, roots]) => roots.includes(root))?.[0] || 'Other';
}

function signature(entry) {
  const m = /^(\([^)]*\))?\s*(.*)$/.exec(entry.detail || '');
  const args = m?.[1] || '';
  const text = m?.[2] || '';
  let code = entry.label;
  if (entry.type === 'function') code += args || '()';
  if (code.startsWith('.')) code = `expect(value)${code}`;
  return { code, text };
}

/** Opens a searchable reference of the script API. */
export function openScriptReference() {
  const search = h('input.input', { type: 'search', placeholder: 'Filter the reference', 'aria-label': 'Filter the script reference', autocomplete: 'off', spellcheck: false });
  const list = h('div.se-ref-list');
  const status = h('p.sr-only', { role: 'status' });
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const sections = [];
    let shown = 0;
    for (const [title] of GROUPS) {
      const entries = SCRIPT_COMPLETIONS.filter((e) => groupOf(e) === title && e.type !== 'namespace').filter((e) => !q || e.label.toLowerCase().includes(q) || (e.detail || '').toLowerCase().includes(q));
      if (!entries.length) continue;
      shown += entries.length;
      sections.push(
        h(
          'section.se-ref-group',
          h('h3.se-ref-title', title),
          h(
            'dl.se-ref-items',
            entries.map((e) => {
              const s = signature(e);
              return h('div.se-ref-item', h('dt', h('code', s.code)), h('dd', s.text));
            }),
          ),
        ),
      );
    }
    fill(list, sections.length ? sections : h('p.pv-muted', `Nothing matches "${search.value.trim()}".`));
    status.textContent = q ? `${shown} matching entries` : '';
  };
  search.addEventListener('input', render);
  render();
  const intro = h(
    'p.pv-muted',
    'Scripts are plain JavaScript and run in an isolated sandbox with no access to this page, your cookies or storage. ',
    'Top-level await works, so you can await send() and utils.sha256(). Values set with env, collectionVars and globals are saved when the script finishes.',
  );
  openDialog({ title: 'Script reference', body: [intro, search, status, list], wide: true, className: 'se-ref', initialFocus: search });
}

// Editor ------------------------------------------------------------------------

export function createScriptsEditor({ scripts = {}, onChange, label = 'Scripts', isVariableDefined = null, scope = 'request', readOnly = false } = {}) {
  const state = { pre: scripts.pre || '', post: scripts.post || '' };
  let phase = !state.pre.trim() && state.post.trim() ? 'post' : 'pre';
  const editors = {};
  const descs = PHASE_DESC[scope] || PHASE_DESC.request;
  const baseId = domId('scripts');

  const tabs = {};
  const dots = {};
  const panels = {};
  for (const p of PHASES) {
    dots[p] = h('span.se-has', { hidden: true }, h('span.dot', { 'aria-hidden': 'true' }), h('span.sr-only', ', has a script'));
    tabs[p] = h(
      'button',
      { type: 'button', id: `${baseId}-tab-${p}`, 'aria-controls': `${baseId}-panel-${p}`, title: descs[p] },
      h('span', PHASE_LABEL[p]),
      dots[p],
    );
    panels[p] = h('div.se-panel', { id: `${baseId}-panel-${p}`, role: 'tabpanel', 'aria-labelledby': `${baseId}-tab-${p}`, hidden: true });
  }
  const tabList = [tabs.pre, tabs.post];
  const named = /scripts?$/i.test(label.trim());
  const nav = h('div.script-nav', { 'aria-label': named ? label : `${label} scripts` }, tabList);
  wireTabs(nav, tabList, { orientation: 'vertical', onSelect: (i) => select(PHASES[i]) });

  const snippetList = h('ul.snippet-list', { role: 'list' });
  const snippetHint = h('p.se-snippets-hint', 'Adds code to the end of the script.');
  const snippets = h('aside.se-snippets', { 'aria-labelledby': `${baseId}-snip` }, h('h3.se-snippets-title', { id: `${baseId}-snip` }, 'Snippets'), snippetHint, snippetList);
  const snippetBtn = h('button.btn.sm.ghost.se-snippet-btn', { type: 'button' }, icon('listChecks', 14), h('span', 'Snippets'));
  menuButton(snippetBtn, () => [{ heading: `${PHASE_LABEL[phase]} snippets` }, ...SNIPPETS[phase].map((s) => ({ label: s.label, run: () => insertSnippet(s) }))], { align: 'end', label: 'Snippets' });

  const help = h(
    'p.se-help',
    icon('lock', 13),
    h('span', 'Scripts run in an isolated sandbox.'),
    h('button.link-btn', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => openScriptReference() }, 'Script reference'),
    h('span.se-help-keys', 'Press Esc then Tab to leave the editor.'),
  );

  // Read-only scripts have nothing to add snippets to.
  const head = h('div.panel-head.se-head', h('span.panel-title', { id: `${baseId}-title` }), h('span.se-desc', { id: `${baseId}-desc` }), h('span.spacer'), readOnly ? null : snippetBtn);
  const main = h('div.se-main', head, PHASES.map((p) => panels[p]), help);
  const el = h(`div.scripts-grid.se${readOnly ? '.se-readonly' : ''}`, h('div.se-side', nav), main, readOnly ? null : snippets);

  function ensureEditor(p) {
    if (editors[p]) return editors[p];
    const ed = codeEditor({
      doc: state[p],
      language: 'javascript',
      label: named ? `${PHASE_LABEL[p]} script` : `${PHASE_LABEL[p]} script for ${label}`,
      placeholder: PLACEHOLDER[p],
      isVariableDefined,
      completions: SCRIPT_COMPLETIONS,
      className: 'se-editor',
      readOnly,
      onChange: (v) => {
        if (state[p] === v) return;
        state[p] = v;
        renderDots();
        onChange?.({ ...state });
      },
    });
    ed.el.setAttribute('aria-describedby', `${baseId}-desc`);
    panels[p].append(ed.el);
    editors[p] = ed;
    return ed;
  }

  function renderDots() {
    for (const p of PHASES) dots[p].hidden = !state[p].trim();
  }

  function renderSnippets() {
    fill(
      snippetList,
      SNIPPETS[phase].map((s) => h('li', h('button', { type: 'button', title: s.code, onclick: () => insertSnippet(s) }, icon('plus', 13), h('span', s.label)))),
    );
  }

  function select(p, { focus = false } = {}) {
    phase = p;
    selectTab(tabList, PHASES.indexOf(p));
    for (const q of PHASES) panels[q].hidden = q !== p;
    ensureEditor(p);
    head.querySelector('.panel-title').textContent = PHASE_LABEL[p];
    head.querySelector('.se-desc').textContent = descs[p];
    if (!readOnly) renderSnippets();
    if (focus) editors[p].focus();
  }

  async function insertSnippet(snippet) {
    const p = phase;
    const ed = ensureEditor(p);
    const cur = state[p];
    const next = `${cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n` : ''}${snippet.code}\n`;
    const view = await cmView(ed);
    if (view) {
      // The editor counts a \r\n line break as one character.
      const doc = view.state.doc.toString();
      const text = next.replace(/\r\n?/g, '\n');
      let from = 0;
      while (from < doc.length && from < text.length && doc[from] === text[from]) from++;
      view.dispatch({ changes: { from, to: doc.length, insert: text.slice(from) }, selection: { anchor: text.length - 1 }, scrollIntoView: true });
    } else {
      ed.setValue(next);
      if (state[p] !== next) {
        state[p] = next;
        renderDots();
        onChange?.({ ...state });
      }
    }
    ed.focus();
    announce(`Added snippet: ${snippet.label}`);
  }

  renderDots();
  select(phase);

  return {
    el,
    getScripts: () => ({ ...state }),
    setScripts(next) {
      for (const p of PHASES) {
        const v = next?.[p] || '';
        if (state[p] === v) continue;
        state[p] = v;
        editors[p]?.setValue(v);
      }
      renderDots();
    },
    select: (p, opts) => select(p, opts),
    get phase() {
      return phase;
    },
    focus: () => editors[phase]?.focus(),
    contains: (node) => el.contains(node),
    destroy() {
      for (const p of PHASES) editors[p]?.destroy();
    },
  };
}

/** The CodeMirror view behind a code editor handle, once loaded, or null. */
async function cmView(ed) {
  try {
    await ed.ready;
    const dom = ed.el.querySelector('.cm-editor');
    if (!dom) return null;
    const { EditorView } = await import('@codemirror/view');
    return EditorView.findFromDOM(dom);
  } catch {
    return null;
  }
}
