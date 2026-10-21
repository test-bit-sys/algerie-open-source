import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryDb } from './helpers/memory-db.js';
import { Workspace } from '../src/data/workspace.js';
import { folder, request, requestsIn } from '../src/core/model.js';
import { exportNative } from '../src/core/io/native.js';
import { SCHEMA_V21 } from '../src/core/io/collection-v2.js';
import { score, highlight, search } from '../src/ui/palette.js';
import { openSaveDialog, openImportDialog, openExportDialog } from '../src/ui/dialogs.js';
import { openDialog } from '../src/ui/dialog.js';
import { toast } from '../src/ui/toast.js';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** Waits until fn() is truthy (polling), so tests do not depend on debounce timings. */
async function until(fn, timeout = 2000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition');
    await wait(10);
  }
  return fn();
}

const openDialogEl = () => document.querySelector('dialog[open]');
const buttonByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

async function makeWorkspace() {
  const ws = new Workspace(new MemoryDb());
  await ws.load();
  return ws;
}

function fakeApp(ws) {
  return {
    ws,
    session: { signedIn: false, user: null, puter: null },
    environmentId: null,
    tabs: [],
    activeId: null,
    activeTab: null,
    newRequest: vi.fn(),
    openTab: vi.fn(),
    openHistory: vi.fn(),
    showSection: vi.fn(),
    sidebar: { reveal: vi.fn() },
  };
}

afterEach(() => {
  for (const d of document.querySelectorAll('dialog')) d.remove();
  document.querySelector('.toasts')?.replaceChildren();
});

// Palette matching ------------------------------------------------------------

describe('palette score()', () => {
  it('matches everything with an empty query', () => {
    expect(score('', 'Anything')).toEqual({ score: 0, positions: [] });
    expect(score('   ', 'Anything')).toEqual({ score: 0, positions: [] });
  });

  it('returns null when the characters are not all present in order', () => {
    expect(score('xyz', 'Get users')).toBeNull();
    expect(score('sru', 'users')).toBeNull();
  });

  it('is case-insensitive and reports matched positions', () => {
    const m = score('USR', 'list users');
    expect(m).not.toBeNull();
    expect(m.positions).toEqual([5, 6, 8]);
  });

  it('ranks a contiguous match above a scattered one', () => {
    const contiguous = score('user', 'Get user profile');
    const scattered = score('user', 'Update some event rules');
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it('prefers matches at the start of words', () => {
    const wordStart = score('del', 'Delete item');
    const inside = score('del', 'Model update');
    expect(wordStart.score).toBeGreaterThan(inside.score);
  });

  it('prefers word-initial letters for abbreviations (camelCase and spaces)', () => {
    const acronym = score('gup', 'getUserProfile');
    expect(acronym.positions).toEqual([0, 3, 7]);
    const spaced = score('ne', 'New environment');
    expect(spaced.positions).toEqual([0, 1]); // contiguous "Ne" beats N + e(nvironment)
  });

  it('requires every word of the query and merges positions', () => {
    const m = score('post order', 'Create order (POST)');
    expect(m).not.toBeNull();
    expect(m.positions).toEqual([7, 8, 9, 10, 11, 14, 15, 16, 17]);
    expect(score('post invoice', 'Create order (POST)')).toBeNull();
  });

  it('ranks shorter texts higher when the match is otherwise equal', () => {
    expect(score('users', 'Users').score).toBeGreaterThan(score('users', 'Users and everything else about them').score);
  });

  it('highlight() wraps runs of matched characters in <mark>', () => {
    const el = document.createElement('span');
    el.append(...highlight('Get users', score('use', 'Get users').positions));
    expect(el.innerHTML).toBe('Get <mark>use</mark>rs');
  });
});

describe('palette search()', () => {
  let ws;
  let app;
  beforeEach(async () => {
    ws = await makeWorkspace();
    await ws.addCollection({
      name: 'Pet Store',
      items: [request({ name: 'List pets', method: 'GET', url: 'https://pets.example/pets' }), folder({ name: 'Admin', items: [request({ name: 'Delete pet', method: 'DELETE', url: 'https://pets.example/pets/1' })] })],
    });
    await ws.addEnvironment({ name: 'Production' });
    app = fakeApp(ws);
  });

  it('groups results and puts the best group first', () => {
    const groups = search(app, 'delete pet');
    expect(groups[0].group).toBe('requests');
    expect(groups[0].items[0].entry.label).toBe('Delete pet');
    expect(groups[0].items[0].entry.detail).toBe('Pet Store / Admin');
  });

  it('does not match letters scattered across paths and URLs', async () => {
    await ws.addCollection({ name: 'C', items: [request({ name: 'Zed', url: 'https://a.test' })] });
    const req = search(app, 'chat').find((g) => g.group === 'requests');
    expect(req?.items.map((i) => i.entry.label) ?? []).not.toContain('Zed');
  });

  it('finds WebSocket requests and opens them as WebSockets', async () => {
    const { websocketRequest } = await import('../src/core/websocket.js');
    const c = ws.collections[0];
    const sock = await ws.addItem(c.id, c.id, websocketRequest({ name: 'Chat stream', url: 'ws://localhost:9' }));
    const entry = search(app, 'chat stream').find((g) => g.group === 'requests').items[0].entry;
    expect(entry).toMatchObject({ label: 'Chat stream', method: 'WS' });
    const opened = [];
    app.openTab = (...args) => opened.push(args);
    entry.run();
    expect(opened[0].slice(0, 2)).toEqual(['websocket', sock.id]);
  });

  it('finds requests by collection path through keywords without highlighting them', () => {
    const groups = search(app, 'admin');
    const req = groups.find((g) => g.group === 'requests');
    expect(req.items.map((i) => i.entry.label)).toEqual(['Delete pet']);
    expect(req.items[0].positions).toEqual([]);
  });

  it('finds requests and history entries by their HTTP method', async () => {
    await ws.addHistory({ request: request({ name: 'Old call', method: 'PUT', url: 'https://x.test/old' }), response: { status: 200 } });
    const labels = (q, group) => search(app, q).find((g) => g.group === group)?.items.map((i) => i.entry.label) ?? [];
    expect(labels('get pets', 'requests')).toEqual(['List pets']);
    expect(labels('delete pets', 'requests')).toEqual(['Delete pet']);
    expect(labels('put old', 'history')).toEqual(['https://x.test/old']);
  });

  it('limits results to commands after ">"', () => {
    const groups = search(app, '>production');
    expect(groups.map((g) => g.group)).toEqual(['commands']);
    expect(groups[0].items[0].entry.label).toBe('Select environment: Production');
  });

  it('shows top commands for an empty query', () => {
    const groups = search(app, '');
    const cmds = groups.find((g) => g.group === 'commands');
    expect(cmds.items.map((i) => i.entry.label)).toContain('New request');
  });
});

// Save dialog ---------------------------------------------------------------

describe('openSaveDialog', () => {
  let ws;
  let app;
  let col;
  let sub;
  beforeEach(async () => {
    ws = await makeWorkspace();
    sub = folder({ name: 'Users' });
    col = await ws.addCollection({ name: 'Billing', items: [folder({ name: 'Invoices' }), sub] });
    await ws.addCollection({ name: 'Auth' });
    app = fakeApp(ws);
  });

  it('keeps Save disabled until a destination is chosen, then drills into folders', async () => {
    const result = openSaveDialog(app, { name: 'Get user' });
    const dlg = openDialogEl();
    const save = buttonByText(dlg, 'Save');
    const name = dlg.querySelector('input[type="text"]');
    expect(name.value).toBe('Get user');
    expect(save.disabled).toBe(true);

    const options = () => [...dlg.querySelectorAll('[role="option"]')];
    const names = () => options().map((o) => o.querySelector('.save-opt-name').textContent);
    expect(names()).toEqual(['Auth', 'Billing']);
    expect(options()[1].querySelector('.save-opt-detail').textContent).toBe('0 requests');

    options()[1].click(); // Billing
    expect(save.disabled).toBe(false);
    expect(dlg.querySelector('.save-dest').textContent).toContain('Billing');
    // Inside a collection: a Back entry and its folders.
    expect(names()).toEqual(['Back', 'Invoices', 'Users']);

    options()[2].click(); // Users
    expect(dlg.querySelector('.save-dest').textContent).toContain('Billing / Users');
    name.value = '  Renamed  ';
    name.dispatchEvent(new Event('input'));
    save.click();
    await expect(result).resolves.toEqual({ name: 'Renamed', collectionId: col.id, folderId: sub.id, newCollection: null });
  });

  it('supports keyboard navigation through the filter combobox', async () => {
    const result = openSaveDialog(app, { name: 'X', collectionId: null });
    const dlg = openDialogEl();
    const filter = dlg.querySelector('input[role="combobox"]');
    filter.value = 'inv';
    filter.dispatchEvent(new Event('input'));
    const opts = [...dlg.querySelectorAll('[role="option"]')];
    expect(opts.map((o) => o.querySelector('.save-opt-name').textContent)).toEqual(['Invoices']);
    expect(filter.getAttribute('aria-activedescendant')).toBe(opts[0].id);
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(dlg.querySelector('.save-dest').textContent).toContain('Billing / Invoices');
    // Backspace on an empty filter goes up one level.
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(dlg.querySelector('.save-dest').textContent).toMatch(/Billing$/);
    buttonByText(dlg, 'Save').click();
    const v = await result;
    expect(v).toMatchObject({ collectionId: col.id, folderId: null });
  });

  it('saves with Enter in a folder that has no subfolders', async () => {
    const result = openSaveDialog(app, { name: 'X', collectionId: null });
    const dlg = openDialogEl();
    const filter = dlg.querySelector('input[role="combobox"]');
    const enter = () => filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    enter(); // into Billing
    expect(dlg.querySelector('.save-dest').textContent).toMatch(/Billing$/);
    expect(dlg.querySelector('[aria-selected="true"] .save-opt-name').textContent).toBe('Invoices');
    enter(); // into Invoices, which has no folders
    expect(dlg.querySelector('.save-dest').textContent).toContain('Billing / Invoices');
    expect(dlg.querySelector('[aria-selected="true"]')).toBeNull();
    enter(); // saves
    await expect(result).resolves.toMatchObject({ collectionId: col.id, folderId: col.items[0].id });
  });

  it('returns newCollection when creating a collection', async () => {
    const result = openSaveDialog(app, { name: 'Ping' });
    const dlg = openDialogEl();
    buttonByText(dlg, 'New collection').click();
    const input = [...dlg.querySelectorAll('input')].find((i) => i.closest('.save-new'));
    input.value = 'Health checks';
    input.dispatchEvent(new Event('input'));
    buttonByText(dlg, 'Save').click();
    await expect(result).resolves.toEqual({ name: 'Ping', collectionId: null, folderId: null, newCollection: 'Health checks' });
  });

  it('asks only where to move a folder, never into itself, what is inside it or a view-only collection', async () => {
    const inner = folder({ name: 'Drafts' });
    await ws.addItem(col.id, sub.id, inner);
    await ws.putCollection({ type: 'collection', name: 'Theirs', items: [], shared: { path: '/x/y.json', owner: 'x', mode: 'read' } }, { quiet: true });
    const result = openSaveDialog(app, { collectionId: col.id, moving: ws.locate(sub.id).item });
    const dlg = openDialogEl();
    const names = () => [...dlg.querySelectorAll('[role="option"] .save-opt-name')].map((o) => o.textContent);
    expect(dlg.querySelector('input[type="text"]:not(.save-new input)')).toBeNull();
    expect(names()).toEqual(['Back', 'Invoices']);
    const filter = dlg.querySelector('input[role="combobox"]');
    expect(document.activeElement).toBe(filter);
    filter.value = 'r';
    filter.dispatchEvent(new Event('input'));
    expect(names()).not.toContain('Drafts');
    expect(names()).not.toContain('Theirs');
    filter.value = '';
    filter.dispatchEvent(new Event('input'));
    dlg.querySelectorAll('[role="option"]')[0].click(); // Back to all collections
    expect(names()).toEqual(['Auth', 'Billing']);
    dlg.querySelectorAll('[role="option"]')[0].click(); // Auth
    expect(dlg.querySelector('.save-dest').textContent).toBe('Move to Auth');
    buttonByText(dlg, 'Move').click();
    await expect(result).resolves.toMatchObject({ collectionId: (await ws.collections).find((c) => c.name === 'Auth').id, folderId: null });
  });

  it('never offers or starts in a view-only collection when saving a copy', async () => {
    const theirs = await ws.putCollection({ type: 'collection', name: 'Theirs', items: [], shared: { path: '/x/y.json', owner: 'x', mode: 'read' } }, { quiet: true });
    const result = openSaveDialog(app, { name: 'Copy', collectionId: theirs.id });
    const dlg = openDialogEl();
    const names = () => [...dlg.querySelectorAll('[role="option"] .save-opt-name')].map((o) => o.textContent);
    expect(names()).toEqual(['Auth', 'Billing']);
    expect(buttonByText(dlg, 'Save').disabled).toBe(true);
    buttonByText(dlg, 'Cancel').click();
    await expect(result).resolves.toBeNull();
  });

  it('moves an item whose name is empty', async () => {
    const a = await ws.addCollection({ name: 'A', items: [request({ name: '' })] });
    const b = await ws.addCollection({ name: 'B', items: [] });
    const result = openSaveDialog(app, { collectionId: a.id, moving: ws.collections.find((c) => c.id === a.id).items[0] });
    const dlg = openDialogEl();
    dlg.querySelectorAll('[role="option"]')[0].click(); // Back to all collections
    [...dlg.querySelectorAll('[role="option"]')].find((o) => o.querySelector('.save-opt-name')?.textContent === 'B').click();
    expect(dlg.querySelector('.save-dest').textContent).toBe('Move to B');
    buttonByText(dlg, 'Move').click();
    await expect(result).resolves.toMatchObject({ collectionId: b.id, name: '' });
  });

  it('starts in create mode when there are no collections, and resolves null on cancel', async () => {
    const empty = fakeApp(await makeWorkspace());
    const result = openSaveDialog(empty, { name: 'A' });
    const dlg = openDialogEl();
    expect(dlg.querySelector('.save-picker').hidden).toBe(true);
    expect(dlg.querySelector('.save-new').hidden).toBe(false);
    buttonByText(dlg, 'Cancel').click();
    await expect(result).resolves.toBeNull();
  });
});

// Import dialog -----------------------------------------------------------------

describe('openImportDialog paste flow', () => {
  let ws;
  let app;
  beforeEach(async () => {
    ws = await makeWorkspace();
    app = fakeApp(ws);
  });

  function paste(dlg, text) {
    buttonByText(dlg, 'Paste text').click();
    const ta = dlg.querySelector('textarea');
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
    return ta;
  }

  it('detects a cURL command and opens it as a new request tab', async () => {
    openImportDialog(app);
    const dlg = openDialogEl();
    paste(dlg, "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{\"name\":\"Ada\"}'");
    await until(() => dlg.querySelector('.imp-detected').textContent.includes('curl command'));
    const btn = dlg.querySelector('.dialog-foot .btn.primary');
    await until(() => !btn.disabled);
    expect(btn.textContent).toBe('Open request');
    expect(dlg.querySelector('.imp-req-url').textContent).toBe('https://api.example.com/users');
    btn.click();
    expect(app.newRequest).toHaveBeenCalledTimes(1);
    const fields = app.newRequest.mock.calls[0][0];
    expect(fields.method).toBe('POST');
    expect(fields.url).toBe('https://api.example.com/users');
    expect(fields.name).toBeTruthy();
    expect(ws.collections).toHaveLength(0);
    expect(openDialogEl()).toBeNull();
  });

  it('names the format once typing pauses, not on every keystroke', async () => {
    openImportDialog(app);
    const dlg = openDialogEl();
    const label = () => dlg.querySelector('.imp-detected').textContent;
    const ta = paste(dlg, '{"info": {"name": "Shop", "schema": "' + SCHEMA_V21 + '"}, "item": []');
    expect(label()).toBe('');
    await until(() => label().includes('Format not recognized yet.'));
    for (const v of [`${ta.value}}`, `${ta.value} `, `${ta.value}}`]) {
      ta.value = v;
      ta.dispatchEvent(new Event('input'));
    }
    expect(label()).toContain('Format not recognized yet.');
    await until(() => label().includes('Postman Collection v2.1'));
    // Clearing the box clears it at once.
    ta.value = '  ';
    ta.dispatchEvent(new Event('input'));
    expect(label()).toBe('');
  });

  it('says when only the first of several cURL commands will open', async () => {
    openImportDialog(app);
    const dlg = openDialogEl();
    paste(dlg, 'curl https://a.example/one ;\ncurl https://b.example/two');
    const btn = dlg.querySelector('.dialog-foot .btn.primary');
    await until(() => !btn.disabled);
    expect(dlg.querySelector('.imp-req-url').textContent).toBe('https://a.example/one');
    expect(dlg.querySelector('.imp-warnings').textContent).toMatch(/more than one curl command/);
  });

  it('imports from a link whose file name has a stray %', async () => {
    const v21 = { info: { name: 'Shop', schema: SCHEMA_V21 }, item: [{ name: 'Health', request: { method: 'GET', url: 'https://shop.example/health' } }] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(v21), { status: 200 })));
    openImportDialog(app, { tab: 'link' });
    const dlg = openDialogEl();
    const input = dlg.querySelector('input[type="url"]');
    input.value = 'https://files.example/100%.json';
    input.closest('form').dispatchEvent(new Event('submit', { cancelable: true }));
    const btn = dlg.querySelector('.dialog-foot .btn.primary');
    await until(() => !btn.disabled);
    expect(dlg.querySelector('.imp-summary').textContent).toBe('Will add 1 collection.');
    vi.unstubAllGlobals();
  });

  it('does not add anything twice when an import is retried after a failure', async () => {
    const backup = exportNative({ collections: [{ type: 'collection', name: 'One', items: [] }, { type: 'collection', name: 'Two', items: [] }], environments: [] });
    const add = ws.addCollection.bind(ws);
    let calls = 0;
    ws.addCollection = async (c) => {
      if (++calls === 2) throw new Error('Disk full');
      return add(c);
    };
    openImportDialog(app);
    const dlg = openDialogEl();
    paste(dlg, backup);
    const btn = dlg.querySelector('.dialog-foot .btn.primary');
    await until(() => !btn.disabled);
    btn.click();
    await until(() => !btn.disabled && calls === 2);
    btn.click();
    await until(() => ws.collections.length === 2);
    await wait(20);
    expect(ws.collections.map((c) => c.name).sort()).toEqual(['One', 'Two']);
  });

  it('includes global variables when exporting everything', async () => {
    await ws.updateGlobals((g) => g.variables.push({ id: 'g', key: 'host', value: 'h', enabled: true }, { id: 's', key: 'secret', value: 'x', enabled: true, secret: true }));
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
    openExportDialog(app);
    const dlg = openDialogEl();
    expect(dlg.textContent).toContain('2 global variables');
    [...dlg.querySelectorAll('button')].find((b) => /copy/i.test(b.textContent)).click();
    await until(() => copied);
    expect(JSON.parse(copied).globals.variables.map((v) => [v.key, v.value])).toEqual([['host', 'h'], ['secret', 'x']]);
  });

  it('leaves secret variables and auth credentials out when secrets are not included', async () => {
    const auth = { type: 'bearer', bearer: { token: 'live-token' } };
    const c = await ws.addCollection({
      name: 'Secret API',
      auth: { type: 'basic', basic: { username: 'ada', password: 'hunter2' } },
      variables: [{ key: 'key', value: 'k', secret: true }],
      items: [folder({ name: 'F', items: [request({ name: 'R', auth })] }), request({ name: 'Ref', auth: { type: 'apikey', apikey: { key: 'X-Key', value: '{{apiKey}}', in: 'header' } } })],
    });
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
    openExportDialog(app, { collectionId: c.id });
    const dlg = openDialogEl();
    const box = [...dlg.querySelectorAll('input[type="checkbox"]')].find((i) => /secrets/i.test(i.closest('label').textContent));
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    [...dlg.querySelectorAll('button')].find((b) => /copy/i.test(b.textContent)).click();
    await until(() => copied);
    const out = JSON.parse(copied).collections[0];
    expect(out.auth.basic).toEqual({ username: 'ada', password: '' });
    expect(out.variables[0].value).toBe('');
    expect(out.items[0].items[0].auth.bearer.token).toBe('');
    expect(out.items[1].auth.apikey.value).toBe('{{apiKey}}');
    expect(ws.getCollection(c.id).items[0].items[0].auth.bearer.token).toBe('live-token');
  });

  it('restores global variables from a full backup', async () => {
    await ws.updateGlobals((g) => g.variables.push({ id: 'k', key: 'keep', value: 'mine', enabled: true }));
    const backup = exportNative({ collections: [], environments: [], globals: { variables: [{ key: 'keep', value: 'theirs' }, { key: 'token', value: 'abc' }] } });
    openImportDialog(app);
    const dlg = openDialogEl();
    paste(dlg, backup);
    const btn = dlg.querySelector('.dialog-foot .btn.primary');
    await until(() => !btn.disabled);
    expect(dlg.querySelector('.imp-summary').textContent).toBe('Will add 2 global variables.');
    btn.click();
    await until(() => ws.globals.variables.length === 2);
    expect(ws.globals.variables.map((v) => [v.key, v.value])).toEqual([['keep', 'mine'], ['token', 'abc']]);
  });

  it('detects a JSON collection, summarizes it and imports it', async () => {
    const v21 = {
      info: { name: 'Shop', schema: SCHEMA_V21 },
      item: [
        { name: 'Orders', item: [{ name: 'List orders', request: { method: 'GET', url: 'https://shop.example/orders' } }] },
        { name: 'Health', request: { method: 'GET', url: 'https://shop.example/health' } },
      ],
    };
    openImportDialog(app);
    const dlg = openDialogEl();
    paste(dlg, JSON.stringify(v21));
    await until(() => dlg.querySelector('.imp-detected').textContent.includes('Postman Collection v2.1'));
    const btn = dlg.querySelector('.dialog-foot .btn.primary');
    await until(() => !btn.disabled);
    expect(btn.textContent).toBe('Import');
    expect(dlg.querySelector('.imp-summary').textContent).toBe('Will add 1 collection.');
    expect(dlg.querySelector('.imp-list').textContent).toContain('2 requests, 1 folder');
    btn.click();
    await until(() => ws.collections.length === 1);
    expect(ws.collections[0].name).toBe('Shop');
    expect(requestsIn(ws.collections[0])).toHaveLength(2);
    await until(() => app.sidebar.reveal.mock.calls.length);
    expect(app.showSection).toHaveBeenCalledWith('collections');
    expect(app.sidebar.reveal).toHaveBeenCalledWith(ws.collections[0].id);
    expect(app.newRequest).not.toHaveBeenCalled();
  });

  it('never overwrites: importing the same export twice adds copies with fresh ids', async () => {
    const existing = await ws.addCollection({ name: 'Mine', items: [request({ name: 'One' })] });
    const env = await ws.addEnvironment({ name: 'Dev' });
    const text = exportNative({ collections: [structuredClone(existing)], environments: [structuredClone(env)] });

    openImportDialog(app);
    const dlg = openDialogEl();
    paste(dlg, text);
    await until(() => dlg.querySelector('.imp-detected').textContent.includes('API Client export'));
    const btn = dlg.querySelector('.dialog-foot .btn.primary');
    await until(() => !btn.disabled);
    expect(dlg.querySelector('.imp-summary').textContent).toBe('Will add 1 collection and 1 environment.');
    btn.click();
    await until(() => ws.collections.length === 2 && ws.environments.length === 2);

    const ids = ws.collections.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(ws.getCollection(existing.id).name).toBe('Mine');
    const copy = ws.collections.find((c) => c.id !== existing.id);
    expect(copy.items[0].id).not.toBe(existing.items[0].id);
    expect(ws.locate(existing.items[0].id).collection.id).toBe(existing.id);
    expect(new Set(ws.environments.map((e) => e.id)).size).toBe(2);
  });

  it('drops a pasted text preview that finishes after leaving the Paste tab', async () => {
    openImportDialog(app);
    const dlg = openDialogEl();
    paste(dlg, 'curl https://api.example.com/users');
    buttonByText(dlg, 'File').click();
    await new Promise((r) => setTimeout(r, 400));
    expect(dlg.querySelector('.imp-preview').textContent).toBe('');
    expect(dlg.querySelector('.dialog-foot .btn.primary').disabled).toBe(true);
    // Going back analyzes the text again.
    buttonByText(dlg, 'Paste text').click();
    await until(() => !dlg.querySelector('.dialog-foot .btn.primary').disabled);
  });

  it('shows an error for text it cannot read and keeps Import disabled', async () => {
    openImportDialog(app);
    const dlg = openDialogEl();
    paste(dlg, '{"hello": "world"}');
    await until(() => dlg.querySelector('.imp-item.error'));
    expect(dlg.querySelector('.imp-item.error').textContent).toContain('not in a supported format');
    expect(dlg.querySelector('.dialog-foot .btn.primary').disabled).toBe(true);
  });
});

// Other dialogs and the palette UI --------------------------------------------------

describe('dialog smoke tests', () => {
  let ws;
  let app;
  beforeEach(async () => {
    const { CookieJar } = await import('../src/core/cookies.js');
    ws = await makeWorkspace();
    app = {
      ...fakeApp(ws),
      cookieJar: new CookieJar(),
      persistCookies: vi.fn(),
      setTheme: vi.fn(),
      setLayout: vi.fn(),
      setTransport: vi.fn(),
      tabTitle: (t) => t.draft?.name || 'Tab',
    };
  });

  it('settings opens every section and switches with the keyboard', async () => {
    const { openSettingsDialog } = await import('../src/ui/dialogs.js');
    openSettingsDialog(app, 'requests');
    const dlg = openDialogEl();
    const tabs = [...dlg.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Requests', 'Data', 'About']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    // The relay needs an account.
    const relay = dlg.querySelector('input[type="radio"][value="relay"]');
    expect(relay.disabled).toBe(true);
    dlg.querySelector('input[type="radio"][value="browser"]').click();
    expect(app.setTransport).toHaveBeenCalledWith('browser');
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(dlg.textContent).toContain('Saved in this browser only');
    // Theme radios.
    tabs[0].click();
    const dark = [...dlg.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Dark');
    dark.click();
    expect(app.setTheme).toHaveBeenCalledWith('dark');
    expect(dlg.textContent).not.toMatch(/\u2014/);
  });

  it('says that turning off Follow redirects applies to every request', async () => {
    // Requests follow redirects only when both the app setting and their own are on.
    const { openSettingsDialog } = await import('../src/ui/dialogs.js');
    openSettingsDialog(app, 'requests');
    const text = openDialogEl().textContent;
    expect(text).not.toContain('Default for new requests');
    expect(text).toContain('When off, no request follows redirects');
  });

  it('export downloads a single collection in the chosen format', async () => {
    const { openExportDialog } = await import('../src/ui/dialogs.js');
    const c = await ws.addCollection({ name: 'My API', items: [request({ name: 'Ping' })] });
    const clicks = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicks.push(this.download);
    });
    openExportDialog(app, { collectionId: c.id });
    const dlg = openDialogEl();
    const v21 = dlg.querySelector('input[type="radio"][value="collection-v2.1"]');
    expect(v21).not.toBeNull();
    v21.click();
    v21.dispatchEvent(new Event('change'));
    buttonByText(dlg, 'Download').click();
    expect(clicks).toEqual(['my-api.collection.json']);
    spy.mockRestore();
  });

  it('cookies dialog adds, edits and deletes cookies and persists', async () => {
    const { openCookiesDialog } = await import('../src/ui/dialogs.js');
    openCookiesDialog(app);
    const dlg = openDialogEl();
    expect(dlg.textContent).toContain('No cookies yet');
    buttonByText(dlg, 'Add cookie').click();
    const form = dlg.querySelector('form.ck-add');
    const [domain, path, name, value] = form.querySelectorAll('input.input');
    domain.value = 'api.example.com';
    path.value = '/';
    name.value = 'sid';
    value.value = 'abc';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(app.cookieJar.list()).toMatchObject([{ name: 'sid', value: 'abc', domain: 'api.example.com', hostOnly: true }]);
    expect(app.persistCookies).toHaveBeenCalled();
    expect(dlg.querySelector('.ck-table tbody th').textContent).toBe('sid');

    dlg.querySelector('.ck-edit').click();
    const edit = dlg.querySelector('.ck-value-cell input');
    edit.value = 'xyz';
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(app.cookieJar.list()[0].value).toBe('xyz');

    dlg.querySelector('button[aria-label="Delete cookie sid"]').click();
    expect(app.cookieJar.size).toBe(0);
  });

  it('cookies dialog moves focus to the next domain, or Add cookie, when a domain goes', async () => {
    const { openCookiesDialog } = await import('../src/ui/dialogs.js');
    for (const domain of ['a.test', 'b.test', 'c.test']) app.cookieJar.set({ domain, path: '/', name: 'sid', value: '1', hostOnly: true });
    openCookiesDialog(app);
    const dlg = openDialogEl();
    const current = () => dlg.querySelector('.ck-domain[aria-current="true"] .ck-domain-name')?.textContent;
    [...dlg.querySelectorAll('.ck-domain')][1].click(); // b.test
    dlg.querySelector('button[aria-label="Delete cookie sid"]').click();
    expect(current()).toBe('c.test');
    expect(document.activeElement).toBe(dlg.querySelector('.ck-domain[aria-current="true"]'));
    buttonByText(dlg, 'Clear domain').click();
    await new Promise((r) => setTimeout(r, 0));
    buttonByText([...document.querySelectorAll('dialog[open]')].at(-1), 'Clear').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(current()).toBe('a.test');
    expect(document.activeElement).toBe(dlg.querySelector('.ck-domain[aria-current="true"]'));
    dlg.querySelector('button[aria-label="Delete cookie sid"]').click();
    expect(document.activeElement).toBe(buttonByText(dlg, 'Add cookie'));
  });

  it('shortcuts dialog lists grouped shortcuts', async () => {
    const { openShortcutsDialog } = await import('../src/ui/dialogs.js');
    openShortcutsDialog();
    const dlg = openDialogEl();
    expect([...dlg.querySelectorAll('h3')].map((x) => x.textContent)).toEqual(['General', 'Requests', 'Tabs', 'In the sidebar', 'In editors']);
    expect(dlg.querySelectorAll('kbd').length).toBeGreaterThan(15);
  });

  it('palette opens a request with the keyboard and a history entry', async () => {
    const { openPalette } = await import('../src/ui/palette.js');
    const c = await ws.addCollection({ name: 'Store', items: [request({ name: 'List orders', url: 'https://x.test/orders' })] });
    await ws.addHistory({ request: request({ name: 'Old call', method: 'PUT', url: 'https://x.test/old' }), response: { status: 200 } });

    let p = openPalette(app);
    const input = p.input;
    expect(input.getAttribute('role')).toBe('combobox');
    input.value = 'list ord';
    input.dispatchEvent(new Event('input'));
    const first = p.el.querySelector('[role="option"]');
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.querySelector('mark')).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(5);
    expect(app.openTab).toHaveBeenCalledWith('request', c.items[0].id);

    p = openPalette(app);
    p.input.value = 'x.test/old';
    p.input.dispatchEvent(new Event('input'));
    const opts = [...p.el.querySelectorAll('[role="option"]')];
    const hist = opts.findIndex((o) => o.textContent.includes('https://x.test/old'));
    expect(hist).toBeGreaterThanOrEqual(0);
    opts[hist].click();
    await wait(5);
    expect(app.openHistory).toHaveBeenCalledWith(ws.history[0]);
  });
});

describe('toasts and dialogs', () => {
  // Outside an open modal dialog they would be inert: unclickable and hidden from screen readers.
  it('shows toasts inside the open dialog and back in the page once it closes', async () => {
    const earlier = toast({ title: 'Earlier', duration: 0 });
    const dlg = openDialog({ title: 'First', body: 'x' });
    await wait();
    expect(document.querySelector('.toasts').parentElement).toBe(dlg.el);
    const top = openDialog({ title: 'Second', body: 'y' });
    toast({ title: 'Failed', kind: 'error' });
    const host = document.querySelector('.toasts');
    expect(host.parentElement).toBe(top.el);
    expect([...host.querySelectorAll('[role=alert], [role=status]')].map((t) => t.textContent)).toEqual(['Earlier', 'Failed']);
    top.close();
    await wait();
    expect(host.parentElement).toBe(dlg.el);
    dlg.close();
    await wait();
    expect(host.parentElement).toBe(document.body);
    earlier();
  });
});
