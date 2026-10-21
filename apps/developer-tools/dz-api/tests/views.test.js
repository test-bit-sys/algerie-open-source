import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Workspace } from '../src/data/workspace.js';
import { request as newRequest, folder as newFolder, variable } from '../src/core/model.js';
import { MemoryDb } from './helpers/memory-db.js';
import { EnvironmentView } from '../src/ui/environment-view.js';
import { CollectionView } from '../src/ui/collection-view.js';
import { ConsolePanel, CONSOLE_LIMIT } from '../src/ui/console-panel.js';
import { createScriptsEditor, SCRIPT_COMPLETIONS, SNIPPETS } from '../src/ui/scripts-editor.js';

// CodeMirror measures text through Range rects, which jsdom does not implement.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [];
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
}

async function makeApp() {
  const ws = new Workspace(new MemoryDb());
  await ws.load();
  const consoleBtn = document.createElement('button');
  const consoleBadge = document.createElement('span');
  consoleBadge.hidden = true;
  consoleBtn.append(consoleBadge);
  document.body.append(consoleBtn);
  const app = {
    ws,
    environmentId: null,
    views: new Map(),
    consoleBtn,
    consoleBadge,
    setEnvironment: vi.fn(async (id) => {
      app.environmentId = id;
    }),
    varsFor: () => ({ get: () => null, list: () => [], resolve: (s) => s }),
    openTab: vi.fn(),
    runCollection: vi.fn(),
    addRequestTo: vi.fn(),
    addFolderTo: vi.fn(),
    renameItem: vi.fn(),
    deleteItem: vi.fn(),
    deleteEnvironment: vi.fn(),
    tabTitle: () => '',
    tabbar: { render() {} },
    sidebar: { render() {} },
    setStatus() {},
    toggleSidebar() {},
    wireResizer: (el, key, min, max, apply) => apply(200),
  };
  return app;
}

const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const settle = () => vi.advanceTimersByTimeAsync(350);

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EnvironmentView', () => {
  it('autosaves the name and new variables into the workspace', async () => {
    const app = await makeApp();
    const env = await app.ws.addEnvironment({ name: 'Staging' });
    const view = new EnvironmentView(app, { id: 't1', kind: 'environment', refId: env.id });
    document.body.append(view.el);
    view.onShow({ focus: false });

    type(view.el.querySelector('input.req-name'), 'Production');
    expect(view.el.querySelector('.pv-save').dataset.state).toBe('saving');
    await settle();
    expect(app.ws.getEnvironment(env.id).name).toBe('Production');
    expect(view.el.querySelector('.pv-save').dataset.state).toBe('saved');

    const ghostKey = view.el.querySelector('tr.ghost [data-field="key"] input');
    type(ghostKey, 'baseUrl');
    await settle();
    const vars = app.ws.getEnvironment(env.id).variables;
    expect(vars).toHaveLength(1);
    expect(vars[0].key).toBe('baseUrl');

    const valueInput = view.el.querySelector(`tr[data-id="${vars[0].id}"] [data-field="value"] input`);
    type(valueInput, 'https://api.example.com');
    await settle();
    expect(app.ws.getEnvironment(env.id).variables[0].value).toBe('https://api.example.com');
    expect(view.el.querySelector('.pv-count').textContent).toBe('1 variable');
    view.destroy();
  });

  it('filters variables and reflects remote changes', async () => {
    const app = await makeApp();
    const env = await app.ws.addEnvironment({ name: 'Dev', variables: [variable('host', 'localhost'), variable('token', 'abc')] });
    const view = new EnvironmentView(app, { id: 't1', kind: 'environment', refId: env.id });
    document.body.append(view.el);

    const search = view.el.querySelector('.pv-search-input');
    type(search, 'tok');
    const visible = [...view.el.querySelectorAll('tbody tr:not(.ghost)')].filter((tr) => !tr.hidden);
    expect(visible).toHaveLength(1);
    expect(view.el.querySelector('.pv-count').textContent).toBe('1 of 2 variables');
    type(search, 'zzz');
    expect(view.el.querySelector('.pv-nomatch').hidden).toBe(false);
    type(search, '');

    // A change made elsewhere (another tab, cloud sync) shows up.
    await app.ws.updateEnvironment(env.id, (e) => {
      e.name = 'Development';
      e.variables.push(variable('port', '8080'));
    });
    view.onContextChanged({ kind: 'environment', id: env.id });
    expect(view.el.querySelector('input.req-name').value).toBe('Development');
    expect(view.el.querySelectorAll('tbody tr:not(.ghost)')).toHaveLength(3);
    // Changes for other environments are ignored.
    view.onContextChanged({ kind: 'environment', id: 'other' });
    view.destroy();
  });

  it('toggles the active environment', async () => {
    const app = await makeApp();
    const env = await app.ws.addEnvironment({ name: 'Dev' });
    const view = new EnvironmentView(app, { id: 't1', kind: 'environment', refId: env.id });
    const btn = view.el.querySelector('.pv-active-btn');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toBe('Set active');
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.setEnvironment).toHaveBeenCalledWith(env.id);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('Active');
    view.destroy();
  });

  it('edits globals without a name field or active button', async () => {
    const app = await makeApp();
    const view = new EnvironmentView(app, { id: 't1', kind: 'environment', refId: 'globals' });
    document.body.append(view.el);
    expect(view.el.querySelector('input.req-name')).toBeNull();
    expect(view.el.querySelector('.pv-active-btn')).toBeNull();
    type(view.el.querySelector('tr.ghost [data-field="key"] input'), 'apiVersion');
    await settle();
    expect(app.ws.globals.variables.map((v) => v.key)).toEqual(['apiVersion']);
    view.destroy();
  });
});

describe('CollectionView', () => {
  async function seeded() {
    const app = await makeApp();
    const c = await app.ws.addCollection({ name: 'Shop' });
    const f = newFolder({ name: 'Orders' });
    await app.ws.addItem(c.id, c.id, f);
    await app.ws.addItem(c.id, f.id, newRequest({ name: 'List orders', method: 'GET', url: '/orders' }));
    await app.ws.addItem(c.id, c.id, newRequest({ name: 'Create item', method: 'POST', url: '/items' }));
    await app.ws.addItem(c.id, c.id, newRequest({ name: 'Get item', method: 'GET', url: '/items/1' }));
    return { app, c, f };
  }

  it('shows stats and autosaves name and description', async () => {
    const { app, c } = await seeded();
    const view = new CollectionView(app, { id: 't1', kind: 'collection', refId: c.id });
    document.body.append(view.el);
    view.onShow({ focus: false });

    const stats = [...view.el.querySelectorAll('.pv-stat')].map((s) => [s.querySelector('dt').textContent, s.querySelector('dd').textContent]);
    expect(stats[0]).toEqual(['Requests', '3']);
    expect(stats[1]).toEqual(['Folders', '1']);
    const chips = [...view.el.querySelectorAll('.pv-method-chip')].map((li) => li.textContent);
    expect(chips).toEqual(['GET2 requests', 'POST1 request']);
    expect(view.el.querySelectorAll('.pv-contents li')).toHaveLength(3);
    // A collection that is not shared has no banner, and no stray text in its place.
    expect(view.el.querySelector('.shared-banner')).toBeNull();
    expect([...view.el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE)).toBe(false);

    type(view.el.querySelector('input.req-name'), 'Storefront');
    type(view.el.querySelector('textarea.pv-desc'), 'Orders and items.');
    await settle();
    const saved = app.ws.getCollection(c.id);
    expect(saved.name).toBe('Storefront');
    expect(saved.description).toBe('Orders and items.');
    view.destroy();
  });

  it('switches tabs with the keyboard and saves collection variables', async () => {
    const { app, c } = await seeded();
    const view = new CollectionView(app, { id: 't1', kind: 'collection', refId: c.id });
    document.body.append(view.el);
    const tabs = [...view.el.querySelectorAll('[role="tab"].tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Authorization', 'Scripts', 'Variables']);
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(tabs[3]);
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    const panel = document.getElementById(tabs[3].getAttribute('aria-controls'));
    expect(panel.hidden).toBe(false);

    type(panel.querySelector('tr.ghost [data-field="key"] input'), 'baseUrl');
    await settle();
    expect(app.ws.getCollection(c.id).variables.map((v) => v.key)).toEqual(['baseUrl']);
    expect(tabs[3].querySelector('.count').textContent).toBe('1');

    tabs[3].focus();
    tabs[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    view.destroy();
  });

  it('saves collection auth and scripts', async () => {
    const { app, c } = await seeded();
    const view = new CollectionView(app, { id: 't1', kind: 'collection', refId: c.id });
    document.body.append(view.el);
    view.select('auth');
    const select = view.panels.auth.querySelector('select');
    expect([...select.options].map((o) => o.value)).not.toContain('inherit');
    select.value = 'bearer';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(app.ws.getCollection(c.id).auth.type).toBe('bearer');

    view.select('scripts');
    const textarea = view.panels.scripts.querySelector('textarea.code-fallback');
    type(textarea, "test('ok', () => {});");
    await settle();
    expect(app.ws.getCollection(c.id).scripts.pre).toBe("test('ok', () => {});");
    view.destroy();
  });

  it('makes every field of a view-only shared collection read-only', async () => {
    const app = await makeApp();
    const c = await app.ws.putCollection(
      { type: 'collection', name: 'Theirs', description: 'Read me', items: [], auth: { type: 'bearer', bearer: { token: 't' } }, variables: [variable({ key: 'base', value: 'x' })], scripts: { pre: 'a()', post: '' }, shared: { path: '/x/y.json', owner: 'x', mode: 'read' } },
      { quiet: true },
    );
    const view = new CollectionView(app, { id: 't1', kind: 'collection', refId: c.id });
    document.body.append(view.el);
    expect(view.el.querySelector('.shared-banner').textContent).toContain('not change it');
    expect(view.el.querySelector('input.req-name').readOnly).toBe(true);
    expect(view.el.querySelector('textarea.pv-desc').readOnly).toBe(true);

    view.select('auth');
    expect(view.panels.auth.querySelector('select').disabled).toBe(true);
    expect([...view.panels.auth.querySelectorAll('input')].every((i) => i.readOnly)).toBe(true);

    view.select('scripts');
    expect(view.panels.scripts.querySelector('textarea.code-fallback').readOnly).toBe(true);
    expect(view.panels.scripts.querySelector('.se-snippets')).toBeNull();

    view.select('variables');
    expect(view.panels.variables.querySelector('tr.ghost')).toBeNull();
    expect([...view.panels.variables.querySelectorAll('tbody input:not([type="checkbox"])')].every((i) => i.readOnly)).toBe(true);

    // Edits that get through anyway are not queued for a save that can only fail.
    type(view.el.querySelector('textarea.pv-desc'), 'Changed');
    expect(view.el.querySelector('.pv-save').dataset.state).not.toBe('saving');
    await settle();
    expect(app.ws.getCollection(c.id).description).toBe('Read me');
    view.destroy();
  });

  it('renders folders with breadcrumbs, inherited auth and no variables tab', async () => {
    const { app, c, f } = await seeded();
    await app.ws.updateCollection(c.id, (col) => {
      col.auth.type = 'basic';
    });
    const view = new CollectionView(app, { id: 't1', kind: 'folder', refId: f.id });
    document.body.append(view.el);
    const tabs = [...view.el.querySelectorAll('[role="tab"].tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['Overview', 'Authorization', 'Scripts']);
    const crumb = view.el.querySelector('button.crumb');
    expect(crumb.textContent).toBe('Shop');
    crumb.click();
    expect(app.openTab).toHaveBeenCalledWith('collection', c.id);

    view.select('auth');
    expect(view.panels.auth.querySelector('select').value).toBe('inherit');
    expect(view.panels.auth.textContent).toContain('Basic Auth');

    view.el.querySelector('button[aria-label="Run folder"]').click();
    expect(app.runCollection).toHaveBeenCalledWith(f.id);

    // A rename elsewhere updates the header.
    await app.ws.updateItem(f.id, (item) => {
      item.name = 'Order history';
    });
    view.onContextChanged({ kind: 'collection', id: c.id });
    expect(view.el.querySelector('input.req-name').value).toBe('Order history');
    view.destroy();
  });
});

describe('createScriptsEditor', () => {
  it('lists completions for the whole script API and phase snippets', () => {
    const labels = SCRIPT_COMPLETIONS.map((c) => c.label);
    for (const name of ['test', 'expect', 'request.headers.set', 'response.json', 'env.get', 'collectionVars.set', 'globals.get', 'vars.set', 'variables.resolve', 'console.log', 'send', 'runner.next', 'info.iteration', 'utils.hmacSha256']) {
      expect(labels).toContain(name);
    }
    expect(SCRIPT_COMPLETIONS.find((c) => c.label === 'env.get')).toMatchObject({ type: 'function', apply: 'env.get()' });
    expect(SNIPPETS.post.map((s) => s.label)).toContain('Status code is 200');
    expect(SNIPPETS.pre.map((s) => s.label)).toContain('Generate a signature');
  });

  it('switches phases, marks non-empty scripts and emits changes', () => {
    const onChange = vi.fn();
    const ed = createScriptsEditor({ scripts: { pre: '', post: 'console.log(1)' }, onChange, label: 'Req' });
    document.body.append(ed.el);
    const [pre, post] = ed.el.querySelectorAll('[role="tab"]');
    // Opens on the phase that has code.
    expect(post.getAttribute('aria-selected')).toBe('true');
    expect(post.querySelector('.se-has').hidden).toBe(false);
    expect(pre.querySelector('.se-has').hidden).toBe(true);
    expect(ed.el.querySelector('.snippet-list').textContent).toContain('Status code is 200');

    post.focus();
    post.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(pre.getAttribute('aria-selected')).toBe('true');
    expect(ed.el.querySelector('.snippet-list').textContent).toContain('Set a timestamp variable');
    expect(ed.el.querySelector('.snippet-list').textContent).not.toContain('Status code is 200');

    const panel = document.getElementById(pre.getAttribute('aria-controls'));
    type(panel.querySelector('textarea'), 'vars.set("a", 1)');
    expect(onChange).toHaveBeenLastCalledWith({ pre: 'vars.set("a", 1)', post: 'console.log(1)' });
    expect(pre.querySelector('.se-has').hidden).toBe(false);
    ed.destroy();
  });
});

describe('script snippets', () => {
  it('appends a snippet to the end of the script', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const ed = createScriptsEditor({ scripts: { pre: '', post: 'const a = 1;' }, onChange, label: 'Req' });
    document.body.append(ed.el);
    const btn = [...ed.el.querySelectorAll('.snippet-list button')].find((b) => b.textContent === 'Status code is 200');
    btn.click();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const { post } = onChange.mock.calls.at(-1)[0];
    expect(post.startsWith('const a = 1;\n\ntest(\'Status code is 200\'')).toBe(true);
    expect(post.endsWith('});\n')).toBe(true);
    ed.destroy();
  });

  it('appends a snippet to a script written with \\r\\n line breaks, keeping them', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const ed = createScriptsEditor({ scripts: { pre: '', post: 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;' }, onChange, label: 'Req' });
    document.body.append(ed.el);
    [...ed.el.querySelectorAll('.snippet-list button')].find((b) => b.textContent === 'Status code is 200').click();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const { post } = onChange.mock.calls.at(-1)[0];
    expect(post.startsWith("const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n\r\ntest('Status code is 200'")).toBe(true);
    expect(post.endsWith('});\r\n')).toBe(true);
    expect(/(?<!\r)\n/.test(post)).toBe(false);
    ed.destroy();
  });
});

describe('ConsolePanel', () => {
  it('appends rows, filters by level and text, and caps entries', async () => {
    const app = await makeApp();
    const panel = new ConsolePanel(app);
    document.body.append(panel.el);
    expect(panel.el.hidden).toBe(true);

    panel.add({ kind: 'request', level: 'info', method: 'GET', url: 'https://api.example.com/users', status: 200, timeMs: 42, size: 512, requestHeaders: [['Accept', '*/*']], responseHeaders: [['Content-Type', 'application/json']], at: Date.now() });
    panel.add({ kind: 'script', level: 'log', args: ['hello', { a: 1, b: [1, 2] }], source: 'Login', phase: 'post', at: Date.now() });
    panel.add({ kind: 'script', level: 'error', args: ['boom'], source: 'Login', phase: 'pre', at: Date.now() });
    // Rows are rendered lazily, once the panel opens.
    expect(panel.list.children).toHaveLength(0);
    expect(app.consoleBadge.hidden).toBe(false);
    expect(app.consoleBadge.textContent).toBe('1');

    panel.setOpen(true);
    expect(panel.el.hidden).toBe(false);
    expect(app.consoleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(app.consoleBadge.hidden).toBe(true);
    expect(panel.list.children).toHaveLength(3);
    expect(panel.list.querySelector('details.con-obj')).not.toBeNull();

    // Request rows expand to show headers.
    const toggle = panel.list.querySelector('.con-toggle');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.list.querySelector('.con-details').textContent).toContain('Content-Type');

    panel.setFilter('errors');
    expect(panel.visibleEntries()).toHaveLength(1);
    expect([...panel.list.children].filter((r) => !r.hidden)).toHaveLength(1);
    panel.setFilter('requests');
    expect(panel.visibleEntries().map((e) => e.kind)).toEqual(['request']);
    panel.setFilter('all');
    type(panel.search, 'hello');
    expect(panel.visibleEntries()).toHaveLength(1);
    type(panel.search, '');

    for (let i = 0; i < CONSOLE_LIMIT + 20; i++) panel.add({ kind: 'script', level: 'log', args: [`line ${i}`] });
    expect(panel.entries).toHaveLength(CONSOLE_LIMIT);
    expect(panel.list.children).toHaveLength(CONSOLE_LIMIT);
    expect(panel.list.lastElementChild.textContent).toContain(`line ${CONSOLE_LIMIT + 19}`);

    panel.clear();
    expect(panel.entries).toHaveLength(0);
    expect(panel.list.children).toHaveLength(0);

    panel.toggle();
    expect(panel.el.hidden).toBe(true);
    panel.add({ kind: 'request', level: 'error', method: 'GET', url: 'https://down.example.com', error: 'Network error' });
    expect(app.consoleBadge.textContent).toBe('1');
    expect(app.consoleBtn.getAttribute('aria-label')).toBe('Console, 1 new error');
  });
});
