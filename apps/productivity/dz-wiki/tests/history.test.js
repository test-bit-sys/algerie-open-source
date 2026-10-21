import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { PersonalSpace } from '../src/data/personal.js';
import { memoryBackend } from '../src/data/backend.js';
import { addPage } from '../src/data/tree.js';
import { insertBlock, listBlocks, setText } from '../src/data/page.js';
import { restoreBlocks } from '../src/ui/history.js';
import { deltaText } from '../src/data/richtext.js';
import { fakePuter, alice } from './helpers/puter.js';
import { encode, decode, hash } from '../src/collab/protocol.js';

const texts = (doc) => listBlocks(doc).map((b) => deltaText(b.delta));

afterEach(() => vi.useRealTimers());

describe('page history', () => {
  it('keeps the page as opened, then a version every few minutes', async () => {
    const backend = memoryBackend();
    const s = new PersonalSpace({ backend });
    await s.open();
    const id = addPage(s.tree, { title: 'Doc' });
    const doc = await s.doc(id);
    const b = insertBlock(doc, { text: 'first draft' });
    await s.flushAll();
    let versions = await s.listVersions(id);
    expect(versions).toHaveLength(1);
    // Within ten minutes, no new version.
    setText(doc, b, [{ insert: 'second draft' }]);
    await s.flushAll();
    expect(await s.listVersions(id)).toHaveLength(1);
    // Later, the next save keeps another.
    const later = Date.now() + 11 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    setText(doc, b, [{ insert: 'third draft' }]);
    await s.flushAll();
    versions = await s.listVersions(id);
    expect(versions).toHaveLength(2);
    const old = new Y.Doc();
    Y.applyUpdate(old, await s.versionState(id, versions[0]));
    expect(texts(old)).toEqual(['third draft']);
  });

  it('restores a version as one edit that can be merged and undone', () => {
    const version = new Y.Doc();
    insertBlock(version, { type: 'h1', text: 'Old title' });
    insertBlock(version, { text: 'old body' });
    const doc = new Y.Doc();
    insertBlock(doc, { text: 'new body' });
    const undo = new Y.UndoManager(doc.getMap('blocks'), { trackedOrigins: new Set(['local']) });
    restoreBlocks(doc, version);
    expect(texts(doc)).toEqual(['Old title', 'old body']);
    // Block ids survive, so comments on them still find them.
    expect(listBlocks(doc).map((b) => b.id)).toEqual(listBlocks(version).map((b) => b.id));
    undo.undo();
    expect(texts(doc)).toEqual(['new body']);
  });

  it('keeps shared checkpoints as versions', async () => {
    const env = fakePuter();
    env.forget();
    const room = 'room0000hist';
    const tree = new Y.Doc();
    const page = addPage(tree, { title: 'P' });
    const pdoc = new Y.Doc();
    insertBlock(pdoc, { text: 'v1' });
    await env.service().call(alice, { op: 'create', room, docs: { tree: encode(Y.encodeStateAsUpdate(tree)), [page]: encode(Y.encodeStateAsUpdate(pdoc)) } });
    // An edit more than half an hour later checkpoints and keeps the old one.
    env.now += 31 * 60_000;
    const before = Y.encodeStateVector(pdoc);
    insertBlock(pdoc, { text: 'v2' });
    const update = Y.encodeStateAsUpdate(pdoc, before);
    await env.service().call(alice, { op: 'commit', room, doc: page, update: encode(update), id: await hash(update) });
    const { versions } = await env.service().call(alice, { op: 'history.list', room, doc: page });
    expect(versions).toHaveLength(2);
    const oldest = versions.sort((a, b) => a.at - b.at)[0];
    const { state } = await env.service().call(alice, { op: 'history.get', room, doc: page, at: oldest.at });
    const old = new Y.Doc();
    Y.applyUpdate(old, decode(state));
    expect(texts(old)).toEqual(['v1']);
  });
});
