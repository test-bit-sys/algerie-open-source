import { describe, it, expect, beforeEach } from 'vitest';
import { Workspace } from '../src/data/workspace.js';
import { memoryBackend, memoryKv } from '../src/data/backend.js';
import { memoryCache } from '../src/data/cache.js';
import { childrenOf, getPage, allPages, isTrashed, addPage } from '../src/data/tree.js';
import { listBlocks, insertBlocks } from '../src/data/page.js';
import { listRows, listViews, listProps } from '../src/data/database.js';
import { deltaText } from '../src/data/richtext.js';
import { fakePuter, alice, bob } from './helpers/puter.js';

const titles = (doc, parent = null) => childrenOf(doc, parent).map((p) => p.title);

async function workspace(opts = {}) {
  const ws = new Workspace({ backend: memoryBackend(), kv: memoryKv(), cache: memoryCache(), user: alice, ...opts });
  await ws.start();
  return ws;
}

/** Sharing wired to an in-memory collaboration worker. */
function collabFor(env, user) {
  const request = env.requester(user);
  return {
    request: (_server, op, data) => request(op, data),
    deploy: async () => 'https://wiki-test.puter.work',
    refresh: async () => {},
    events: null,
  };
}

describe('workspace', () => {
  it('starts a new workspace with sample pages', async () => {
    const ws = await workspace();
    expect(titles(ws.personal.tree)).toEqual(['Getting started', 'Tasks', 'Notes']);
    const tasks = childrenOf(ws.personal.tree).find((p) => p.title === 'Tasks');
    const doc = await ws.personal.doc(tasks.id);
    expect(listRows(doc).length).toBe(3);
    expect(listViews(doc).map((v) => v.type)).toEqual(['board', 'table']);
    expect(listViews(doc)[0].groupBy).toBe(listProps(doc).find((p) => p.type === 'status').id);
  });

  it('does not seed a workspace that already has pages', async () => {
    const backend = memoryBackend();
    const one = new Workspace({ backend, kv: memoryKv(), user: alice });
    await one.start();
    await one.personal.flushAll();
    const two = new Workspace({ backend, kv: memoryKv(), user: alice });
    const { fresh } = await two.start();
    expect(fresh).toBe(false);
    expect(allPages(two.personal.tree).length).toBe(allPages(one.personal.tree).length);
  });

  it('creates pages from templates', async () => {
    const ws = await workspace();
    const id = await ws.createPage(ws.personal, { template: 'meeting' });
    expect(getPage(ws.personal.tree, id).title).toBe('Meeting notes');
    const blocks = listBlocks(await ws.personal.doc(id));
    expect(blocks.some((b) => b.type === 'todo')).toBe(true);
    const db = await ws.createPage(ws.personal, { template: 'reading' });
    const props = listProps(await ws.personal.doc(db));
    expect(props.find((p) => p.name === 'Type').options.map((o) => o.name)).toEqual(['Book', 'Article', 'Paper']);
  });

  it('finds pages by title and by content', async () => {
    const ws = await workspace();
    const id = await ws.createPage(ws.personal, { title: 'Quarterly goals' });
    const doc = await ws.personal.doc(id);
    insertBlocks(doc, [{ text: 'Ship the zebra feature' }]);
    ws.noteText(ws.personal, id, doc);
    expect(ws.search('quarterly')[0].page.id).toBe(id);
    const hit = ws.search('zebra')[0];
    expect(hit.page.id).toBe(id);
    expect(hit.snippet).toContain('zebra');
  });

  it('keeps favorites and recent pages per person', async () => {
    const kv = memoryKv();
    const ws = await workspace({ kv });
    const [first] = childrenOf(ws.personal.tree);
    await ws.toggleFavorite(ws.personal, first.id);
    ws.visited(ws.personal, first.id);
    ws.saveRecents.flush();
    expect(ws.isFavorite(ws.personal, first.id)).toBe(true);
    expect(await kv.get('wiki:favorites')).toEqual([{ space: 'personal', page: first.id }]);
    expect((await kv.get('wiki:recents'))[0].page).toBe(first.id);
  });

  it('trashes, restores and deletes pages for good', async () => {
    const ws = await workspace();
    const parent = await ws.createPage(ws.personal, { title: 'Parent' });
    const child = await ws.createPage(ws.personal, { title: 'Child', parent });
    await ws.toggleFavorite(ws.personal, child);
    ws.trash(ws.personal, parent);
    expect(isTrashed(ws.personal.tree, child)).toBe(true);
    // Favorites under a trashed page go away.
    expect(ws.isFavorite(ws.personal, child)).toBe(false);
    await ws.deleteForever(ws.personal, parent);
    expect(getPage(ws.personal.tree, child)).toBe(null);
  });

  it('duplicates a page tree and rewrites links between its pages', async () => {
    const ws = await workspace();
    const a = await ws.createPage(ws.personal, { title: 'A' });
    const b = await ws.createPage(ws.personal, { title: 'B', parent: a });
    insertBlocks(await ws.personal.doc(a), [{ type: 'page', page: b }, { delta: [{ insert: 'see B', attributes: { page: b } }] }]);
    const copy = await ws.duplicate(ws.personal, a);
    expect(getPage(ws.personal.tree, copy).title).toBe('A (copy)');
    const [childCopy] = childrenOf(ws.personal.tree, copy);
    expect(childCopy.title).toBe('B');
    const blocks = listBlocks(await ws.personal.doc(copy));
    expect(blocks[0].page).toBe(childCopy.id);
    expect(blocks[1].delta[0].attributes.page).toBe(childCopy.id);
  });
});

describe('sharing through the workspace', () => {
  let env;
  beforeEach(() => {
    env = fakePuter();
    env.forget();
  });

  it('moves a private page and its subpages into a shared space', async () => {
    const ws = await workspace({ collab: collabFor(env, alice) });
    const page = await ws.createPage(ws.personal, { title: 'Team handbook' });
    const sub = await ws.createPage(ws.personal, { title: 'Onboarding', parent: page });
    insertBlocks(await ws.personal.doc(sub), [{ text: 'Day one checklist' }]);
    await ws.toggleFavorite(ws.personal, page);
    const shared = await ws.sharePage(page);
    expect(shared.kind).toBe('shared');
    expect(shared.role).toBe('owner');
    expect(getPage(ws.personal.tree, page)).toBe(null);
    expect(titles(shared.tree)).toEqual(['Team handbook']);
    expect(titles(shared.tree, page)).toEqual(['Onboarding']);
    expect(deltaText(listBlocks(await shared.doc(sub))[0].delta)).toBe('Day one checklist');
    // The favorite follows the page.
    expect(ws.isFavorite(shared, page)).toBe(true);
    expect(ws.rooms).toHaveLength(1);
    shared.close();
  });

  it('lets an invited person join from a link and see the pages', async () => {
    const owner = await workspace({ collab: collabFor(env, alice) });
    const page = await owner.createPage(owner.personal, { title: 'Roadmap' });
    const shared = await owner.sharePage(page);
    const { token } = await shared.request('invite', { role: 'commenter' });
    const guest = await workspace({ user: bob, collab: collabFor(env, bob) });
    const joined = await guest.joinLink({ server: shared.server, room: shared.room, token });
    expect(joined.role).toBe('commenter');
    expect(titles(joined.tree)).toEqual(['Roadmap']);
    expect(guest.rooms.map((r) => r.room)).toEqual([shared.room]);
    // Leaving removes the space and the membership.
    await guest.leaveRoom(shared.room);
    expect(guest.sharedSpaces()).toEqual([]);
    await expect(env.service().call(bob, { op: 'sync', room: shared.room, docs: {} })).rejects.toMatchObject({ status: 403 });
    shared.close();
  });

  it('moves a page from a shared space back to private pages', async () => {
    const ws = await workspace({ collab: collabFor(env, alice) });
    const page = await ws.createPage(ws.personal, { title: 'Handbook' });
    const shared = await ws.sharePage(page);
    const sub = addPage(shared.tree, { title: 'Policies', parent: page });
    insertBlocks(await shared.doc(sub), [{ text: 'Be kind' }]);
    await shared.flushAll();
    await ws.moveToSpace(shared, sub, ws.personal, null);
    expect(getPage(shared.tree, sub)).toBe(null);
    expect(getPage(ws.personal.tree, sub).title).toBe('Policies');
    expect(deltaText(listBlocks(await ws.personal.doc(sub))[0].delta)).toBe('Be kind');
    shared.close();
  });

  it('needs a Puter account to share', async () => {
    const ws = await workspace();
    const page = await ws.createPage(ws.personal, { title: 'x' });
    await expect(ws.sharePage(page)).rejects.toThrow(/Puter account/);
  });
});
