import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { insertBlock, insertBlocks, listBlocks, splitBlock, mergeIntoPrevious, indentBlocks, moveBlocks, visibleIds, setType, setBlock, duplicateBlocks, listNumber, withChildren, canIndent, pageText, ensureBlock } from '../src/data/page.js';
import { deltaText } from '../src/data/richtext.js';

const texts = (doc) => listBlocks(doc).map((b) => deltaText(b.delta));

describe('blocks', () => {
  it('inserts in order before and after', () => {
    const doc = new Y.Doc();
    const a = insertBlock(doc, { text: 'a' });
    const c = insertBlock(doc, { text: 'c' }, { after: a });
    insertBlock(doc, { text: 'b' }, { after: a });
    insertBlock(doc, { text: '0' }, { before: a });
    insertBlock(doc, { text: 'd' }, { after: c });
    expect(texts(doc)).toEqual(['0', 'a', 'b', 'c', 'd']);
  });

  it('splits and merges blocks', () => {
    const doc = new Y.Doc();
    const a = insertBlock(doc, { type: 'h1', delta: [{ insert: 'hel' }, { insert: 'lo', attributes: { bold: true } }] });
    const b = splitBlock(doc, a, 4);
    expect(texts(doc)).toEqual(['hell', 'o']);
    expect(listBlocks(doc)[1]).toMatchObject({ id: b, type: 'paragraph', delta: [{ insert: 'o', attributes: { bold: true } }] });
    const res = mergeIntoPrevious(doc, b);
    expect(res).toEqual({ id: a, offset: 4 });
    expect(texts(doc)).toEqual(['hello']);
  });

  it('continues lists and to-dos when splitting', () => {
    const doc = new Y.Doc();
    const a = insertBlock(doc, { type: 'todo', text: 'x', checked: true });
    const b = splitBlock(doc, a, 1);
    expect(listBlocks(doc).find((x) => x.id === b)).toMatchObject({ type: 'todo', checked: false });
  });

  it('nests a new line inside an open toggle', () => {
    const doc = new Y.Doc();
    const t = insertBlock(doc, { type: 'toggle', text: 'more' });
    const n = splitBlock(doc, t, 4);
    expect(listBlocks(doc).find((x) => x.id === n)).toMatchObject({ type: 'paragraph', indent: 1 });
  });

  it('hides blocks inside a collapsed toggle', () => {
    const doc = new Y.Doc();
    const [t, x, y, z] = insertBlocks(doc, [{ type: 'toggle', text: 't' }, { text: 'x', indent: 1 }, { text: 'y', indent: 2 }, { text: 'z' }]);
    expect(visibleIds(doc)).toEqual([t, x, y, z]);
    setBlock(doc, t, { collapsed: true });
    expect(visibleIds(doc)).toEqual([t, z]);
    expect(withChildren(doc, t)).toEqual([t, x, y]);
  });

  it('indents with nested blocks and limits indenting', () => {
    const doc = new Y.Doc();
    const [a, b, c] = insertBlocks(doc, [{ text: 'a' }, { text: 'b' }, { text: 'c', indent: 1 }]);
    expect(canIndent(doc, a)).toBe(false);
    expect(canIndent(doc, b)).toBe(true);
    indentBlocks(doc, [b], 1);
    expect(listBlocks(doc).map((x) => x.indent)).toEqual([0, 1, 2]);
    indentBlocks(doc, [b], -5);
    expect(listBlocks(doc).map((x) => x.indent)).toEqual([0, 0, 1]);
    expect(c).toBeTruthy();
  });

  it('moves a block with its children', () => {
    const doc = new Y.Doc();
    const [a, , , d] = insertBlocks(doc, [{ text: 'a' }, { text: 'a1', indent: 1 }, { text: 'b' }, { text: 'c' }]);
    moveBlocks(doc, [a], { after: d });
    expect(texts(doc)).toEqual(['b', 'c', 'a', 'a1']);
    moveBlocks(doc, [a], { before: listBlocks(doc)[0].id });
    expect(texts(doc)).toEqual(['a', 'a1', 'b', 'c']);
  });

  it('refuses to move a block into itself', () => {
    const doc = new Y.Doc();
    const [a, a1] = insertBlocks(doc, [{ text: 'a' }, { text: 'a1', indent: 1 }]);
    expect(moveBlocks(doc, [a], { after: a1 })).toBe(false);
  });

  it('merges concurrent inserts from two people', () => {
    const one = new Y.Doc();
    const a = insertBlock(one, { text: 'a' });
    const two = new Y.Doc();
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
    insertBlock(one, { text: 'from one' }, { after: a });
    insertBlock(two, { text: 'from two' }, { after: a });
    Y.applyUpdate(one, Y.encodeStateAsUpdate(two));
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
    expect(texts(one)).toEqual(texts(two));
    expect(texts(one).sort()).toEqual(['a', 'from one', 'from two']);
  });

  it('changes type and drops fields that no longer apply', () => {
    const doc = new Y.Doc();
    const a = insertBlock(doc, { type: 'todo', text: 'x', checked: true });
    setType(doc, a, 'h2');
    expect(listBlocks(doc)[0].checked).toBeUndefined();
    setType(doc, a, 'code');
    expect(listBlocks(doc)[0].type).toBe('code');
  });

  it('duplicates blocks after the originals', () => {
    const doc = new Y.Doc();
    const [a] = insertBlocks(doc, [{ text: 'a' }, { text: 'a1', indent: 1 }, { text: 'b' }]);
    duplicateBlocks(doc, [a]);
    expect(texts(doc)).toEqual(['a', 'a1', 'a', 'a1', 'b']);
  });

  it('numbers lists by level', () => {
    const list = [
      { type: 'numbered', indent: 0 },
      { type: 'numbered', indent: 0 },
      { type: 'numbered', indent: 1 },
      { type: 'numbered', indent: 1 },
      { type: 'numbered', indent: 0 },
      { type: 'paragraph', indent: 0 },
      { type: 'numbered', indent: 0 },
    ];
    expect(list.map((b, i) => (b.type === 'numbered' ? listNumber(list, i) : null))).toEqual([1, 2, 1, 2, 3, null, 1]);
  });

  it('collects page text and adds a first block when empty', () => {
    const doc = new Y.Doc();
    expect(ensureBlock(doc)).toBeTruthy();
    expect(ensureBlock(doc)).toBe(null);
    insertBlock(doc, { type: 'image', caption: 'cap' });
    expect(pageText(doc)).toContain('cap');
  });
});
