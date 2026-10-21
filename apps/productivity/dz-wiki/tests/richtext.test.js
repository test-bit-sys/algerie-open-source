import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { domToDelta, renderDelta, applyDelta, deltaToHtml, htmlToDelta, splitDelta, formatAt, getSelectionOffsets, setSelectionOffsets, deltaToMarkdown, markdownToDelta } from '../src/data/richtext.js';

const el = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};

function ytext(delta) {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  if (delta) t.applyDelta(delta);
  return { doc, t };
}

describe('DOM and deltas', () => {
  it('reads formatting from the DOM', () => {
    expect(domToDelta(el('a<b>b<i>c</i></b><a href="https://x.y">d</a>'))).toEqual([
      { insert: 'a' },
      { insert: 'b', attributes: { bold: true } },
      { insert: 'c', attributes: { bold: true, italic: true } },
      { insert: 'd', attributes: { link: 'https://x.y' } },
    ]);
  });

  it('drops unsafe links and unknown colors', () => {
    expect(domToDelta(el('<a href="javascript:x">d</a><span data-color="evil">e</span>'))).toEqual([{ insert: 'de' }]);
  });

  it('treats the trailing placeholder break as nothing', () => {
    expect(domToDelta(el('abc<br>'))).toEqual([{ insert: 'abc' }]);
    expect(domToDelta(el('<br>'))).toEqual([]);
    expect(domToDelta(el('abc<br><br>'))).toEqual([{ insert: 'abc\n' }]);
  });

  it('round-trips through rendering', () => {
    const delta = [{ insert: 'one ' }, { insert: 'two', attributes: { bold: true, color: 'red' } }, { insert: '\nthree\n' }];
    const d = document.createElement('div');
    renderDelta(d, delta);
    expect(domToDelta(d)).toEqual(delta);
  });

  it('round-trips through HTML', () => {
    const delta = [{ insert: 'x', attributes: { code: true } }, { insert: ' & ' }, { insert: 'p', attributes: { page: 'abc' } }];
    expect(htmlToDelta(deltaToHtml(delta))).toEqual(delta);
  });
});

describe('applyDelta', () => {
  it('keeps unchanged text so concurrent edits merge', () => {
    const a = ytext([{ insert: 'hello world' }]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    const tb = b.getText('t');
    // A types at the start, B at the end, each through the diff.
    applyDelta(a.t, [{ insert: 'Oh, hello world' }]);
    applyDelta(tb, [{ insert: 'hello world!' }]);
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    expect(a.t.toString()).toBe('Oh, hello world!');
    expect(tb.toString()).toBe('Oh, hello world!');
  });

  it('applies formatting changes without retyping text', () => {
    const { t } = ytext([{ insert: 'abc' }]);
    applyDelta(t, [{ insert: 'a' }, { insert: 'b', attributes: { bold: true } }, { insert: 'c' }]);
    expect(t.toDelta()).toEqual([{ insert: 'a' }, { insert: 'b', attributes: { bold: true } }, { insert: 'c' }]);
    applyDelta(t, [{ insert: 'abc' }]);
    expect(t.toDelta()).toEqual([{ insert: 'abc' }]);
  });

  it('does not let inserted text inherit formatting it should not have', () => {
    const { t } = ytext([{ insert: 'ab', attributes: { bold: true } }]);
    applyDelta(t, [{ insert: 'ab', attributes: { bold: true } }, { insert: 'c' }]);
    expect(t.toDelta()).toEqual([{ insert: 'ab', attributes: { bold: true } }, { insert: 'c' }]);
  });

  it('handles emoji-free surrogate text and deletes', () => {
    const { t } = ytext([{ insert: 'abcdef' }]);
    applyDelta(t, [{ insert: 'abef' }]);
    expect(t.toString()).toBe('abef');
  });
});

describe('helpers', () => {
  it('splits a delta at an offset', () => {
    const [l, r] = splitDelta([{ insert: 'ab' }, { insert: 'cd', attributes: { bold: true } }], 3);
    expect(l).toEqual([{ insert: 'ab' }, { insert: 'c', attributes: { bold: true } }]);
    expect(r).toEqual([{ insert: 'd', attributes: { bold: true } }]);
  });

  it('reports formatting common to a range', () => {
    const { t } = ytext([{ insert: 'ab', attributes: { bold: true } }, { insert: 'c', attributes: { bold: true, italic: true } }]);
    expect(formatAt(t, 0, 3)).toEqual({ bold: true });
    expect(formatAt(t, 2, 3)).toEqual({ bold: true, italic: true });
  });

  it('maps caret offsets across formatting and line breaks', () => {
    const d = document.createElement('div');
    document.body.append(d);
    renderDelta(d, [{ insert: 'ab' }, { insert: 'cd', attributes: { bold: true } }, { insert: '\nef' }]);
    for (const [s, e] of [[0, 0], [3, 3], [5, 6], [1, 6]]) {
      setSelectionOffsets(d, s, e);
      expect(getSelectionOffsets(d)).toEqual({ start: s, end: e });
    }
    d.remove();
  });
});

describe('inline Markdown', () => {
  it('converts both ways', () => {
    const delta = [{ insert: 'a ' }, { insert: 'bold', attributes: { bold: true } }, { insert: ' and ' }, { insert: 'code', attributes: { code: true } }, { insert: ' ' }, { insert: 'link', attributes: { link: 'https://x.y' } }];
    const md = deltaToMarkdown(delta);
    expect(md).toBe('a **bold** and `code` [link](https://x.y)');
    expect(markdownToDelta(md)).toEqual(delta);
  });

  it('escapes Markdown characters in plain text', () => {
    expect(deltaToMarkdown([{ insert: '2*3 [x]' }])).toBe('2\\*3 \\[x\\]');
    expect(markdownToDelta('2\\*3 \\[x\\]')).toEqual([{ insert: '2*3 [x]' }]);
  });
});
