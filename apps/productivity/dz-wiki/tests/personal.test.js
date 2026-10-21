import { describe, it, expect } from 'vitest';
import { PersonalSpace } from '../src/data/personal.js';
import { memoryBackend } from '../src/data/backend.js';
import { memoryCache } from '../src/data/cache.js';
import { addPage, childrenOf, updatePage, getPage } from '../src/data/tree.js';
import { insertBlock, listBlocks } from '../src/data/page.js';
import { deltaText } from '../src/data/richtext.js';

const texts = (doc) => listBlocks(doc).map((b) => deltaText(b.delta));

describe('private pages', () => {
  it('starts a fresh workspace and saves pages as files', async () => {
    const backend = memoryBackend();
    const s = new PersonalSpace({ backend });
    expect(await s.open()).toBe(true);
    const id = addPage(s.tree, { title: 'Notes' });
    insertBlock(await s.doc(id), { text: 'hi' });
    await s.flushAll();
    expect(backend.files.has('tree.ywk')).toBe(true);
    expect(backend.files.has(`pages/${id}.ywk`)).toBe(true);
    const again = new PersonalSpace({ backend });
    expect(await again.open()).toBe(false);
    expect(childrenOf(again.tree).map((p) => p.title)).toEqual(['Notes']);
    expect(texts(await again.doc(id))).toEqual(['hi']);
  });

  it('never overwrites what another device saved', async () => {
    const backend = memoryBackend();
    const one = new PersonalSpace({ backend, cache: memoryCache() });
    await one.open();
    const id = addPage(one.tree, { title: 'Shared by devices' });
    await one.flushAll();
    const two = new PersonalSpace({ backend, cache: memoryCache() });
    await two.open();
    // Both devices edit before either sees the other's save.
    addPage(one.tree, { title: 'From laptop' });
    updatePage(two.tree, id, { title: 'Renamed on phone' });
    addPage(two.tree, { title: 'From phone' });
    await one.flushAll();
    await two.flushAll();
    await one.refresh();
    const titles = (s) => childrenOf(s.tree).map((p) => p.title).sort();
    expect(titles(one)).toEqual(['From laptop', 'From phone', 'Renamed on phone']);
    expect(titles(two)).toEqual(titles(one));
    expect(getPage(one.tree, id).title).toBe('Renamed on phone');
  });

  it('keeps edits through a failed save and retries', async () => {
    const backend = memoryBackend();
    const cache = memoryCache();
    const s = new PersonalSpace({ backend, cache });
    await s.open();
    addPage(s.tree, { title: 'Draft' });
    backend.fail = 2;
    await s.flushAll();
    expect(s.hasUnsaved()).toBe(true);
    expect(['error', 'offline']).toContain(s.status);
    await s.save(s.entries.get('tree')).catch(() => {});
    await s.flushAll();
    expect(s.hasUnsaved()).toBe(false);
    const again = new PersonalSpace({ backend });
    await again.open();
    expect(childrenOf(again.tree).map((p) => p.title)).toEqual(['Draft']);
  });

  it('opens from the local copy when offline', async () => {
    const backend = memoryBackend();
    const cache = memoryCache();
    const s = new PersonalSpace({ backend, cache });
    await s.open();
    addPage(s.tree, { title: 'Cached' });
    await s.flushAll();
    await new Promise((r) => setTimeout(r, 300));
    backend.fail = 1;
    const offline = new PersonalSpace({ backend, cache });
    await offline.open();
    expect(childrenOf(offline.tree).map((p) => p.title)).toEqual(['Cached']);
  });

  it('stores images by content and deletes page files', async () => {
    const backend = memoryBackend();
    const s = new PersonalSpace({ backend });
    await s.open();
    const hash = await s.putAsset(new Blob([new Uint8Array([9, 9])], { type: 'image/png' }));
    expect(backend.files.has(`assets/${hash}`)).toBe(true);
    const id = addPage(s.tree, { title: 'x' });
    await s.doc(id);
    insertBlock(await s.doc(id), { text: 'x' });
    await s.flushAll();
    await s.deleteDocs([id]);
    expect(backend.files.has(`pages/${id}.ywk`)).toBe(false);
  });
});
