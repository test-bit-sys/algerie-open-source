import { describe, it, expect } from 'vitest';
import { blocksToMarkdown, markdownToBlocks, htmlToBlocks, blocksToHtml } from '../src/data/markdown.js';
import { deltaText } from '../src/data/richtext.js';

const strip = (blocks) => blocks.map((b) => ({ type: b.type, text: b.text ?? deltaText(b.delta || []), indent: b.indent || 0, ...(b.checked !== undefined ? { checked: b.checked } : {}) }));

describe('Markdown', () => {
  it('imports common Markdown', () => {
    const md = '# Title\n\nSome **bold** text\n\n- one\n  - nested\n1. first\n2. second\n- [x] done\n- [ ] todo\n\n> quote\n\n```js\nlet a = 1;\n```\n\n---\n';
    expect(strip(markdownToBlocks(md))).toEqual([
      { type: 'h1', text: 'Title', indent: 0 },
      { type: 'paragraph', text: 'Some bold text', indent: 0 },
      { type: 'bulleted', text: 'one', indent: 0 },
      { type: 'bulleted', text: 'nested', indent: 1 },
      { type: 'numbered', text: 'first', indent: 0 },
      { type: 'numbered', text: 'second', indent: 0 },
      { type: 'todo', text: 'done', indent: 0, checked: true },
      { type: 'todo', text: 'todo', indent: 0, checked: false },
      { type: 'quote', text: 'quote', indent: 0 },
      { type: 'code', text: 'let a = 1;', indent: 0 },
      { type: 'divider', text: '', indent: 0 },
    ]);
  });

  it('imports tables and images, refusing unsafe image links', () => {
    const blocks = markdownToBlocks('| a | b |\n| - | - |\n| 1 | 2 |\n\n![cat](https://x.y/c.png)\n\n![bad](javascript:alert(1))');
    expect(blocks[0]).toMatchObject({ type: 'table', table: { rows: [['a', 'b'], ['1', '2']], header: true } });
    expect(blocks[1]).toMatchObject({ type: 'image', url: 'https://x.y/c.png', caption: 'cat' });
    expect(blocks.filter((b) => b.type === 'image').length).toBe(1);
    expect(markdownToBlocks('![bad](javascript:x)')).toEqual([]);
  });

  it('exports pages and reimports them unchanged', () => {
    const blocks = [
      { type: 'h2', delta: [{ insert: 'Plan' }] },
      { type: 'paragraph', delta: [{ insert: 'A ' }, { insert: 'key', attributes: { bold: true } }, { insert: ' point' }] },
      { type: 'numbered', delta: [{ insert: 'one' }] },
      { type: 'numbered', delta: [{ insert: 'two' }] },
      { type: 'todo', checked: true, delta: [{ insert: 'ship' }], indent: 1 },
      { type: 'code', language: 'py', delta: [{ insert: 'print(1)\nprint(2)' }] },
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain('1. one\n2. two\n  - [x] ship');
    expect(strip(markdownToBlocks(md))).toEqual(strip(blocks));
  });

  it('keeps the text of indented code blocks through export and import', () => {
    const blocks = [
      { type: 'bulleted', delta: [{ insert: 'setup' }] },
      { type: 'code', language: 'py', delta: [{ insert: 'if x:\n    run()' }], indent: 1 },
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain('  ```py\n  if x:\n      run()\n  ```');
    expect(strip(markdownToBlocks(md))).toEqual(strip(blocks));
  });

  it('keeps every line of a multi-line quote inside the quote', () => {
    const blocks = [{ type: 'quote', delta: [{ insert: 'first\nsecond' }], indent: 1 }];
    const md = blocksToMarkdown(blocks);
    expect(md).toBe('  > first  \n  > second\n');
    expect(strip(markdownToBlocks(md))).toEqual(strip(blocks));
  });

  it('numbers list items after nested children like the editor does', () => {
    const md = blocksToMarkdown([
      { type: 'numbered', delta: [{ insert: 'one' }] },
      { type: 'bulleted', delta: [{ insert: 'detail' }], indent: 1 },
      { type: 'numbered', delta: [{ insert: 'two' }] },
      { type: 'paragraph', delta: [{ insert: 'break' }] },
      { type: 'numbered', delta: [{ insert: 'again' }] },
    ]);
    expect(md).toBe('1. one\n  - detail\n2. two\n\nbreak\n\n1. again\n');
  });
});

describe('pasted HTML', () => {
  it('turns structure into blocks and keeps inline formatting', () => {
    const blocks = htmlToBlocks('<h2>Head</h2><p>Hello <b>world</b></p><ul><li>a<ul><li>b</li></ul></li></ul><blockquote>q</blockquote><pre>x\ny</pre><hr>');
    expect(strip(blocks)).toEqual([
      { type: 'h2', text: 'Head', indent: 0 },
      { type: 'paragraph', text: 'Hello world', indent: 0 },
      { type: 'bulleted', text: 'a', indent: 0 },
      { type: 'bulleted', text: 'b', indent: 1 },
      { type: 'quote', text: 'q', indent: 0 },
      { type: 'code', text: 'x\ny', indent: 0 },
      { type: 'divider', text: '', indent: 0 },
    ]);
    expect(blocks[1].delta).toEqual([{ insert: 'Hello ' }, { insert: 'world', attributes: { bold: true } }]);
  });

  it('drops scripts and unsafe content', () => {
    const blocks = htmlToBlocks('<p onclick="x()">ok</p><script>alert(1)</script><img src="javascript:alert(1)">');
    expect(strip(blocks)).toEqual([{ type: 'paragraph', text: 'ok', indent: 0 }]);
  });

  it('exports HTML with nested lists', () => {
    const html = blocksToHtml([
      { type: 'bulleted', delta: [{ insert: 'a' }] },
      { type: 'bulleted', delta: [{ insert: 'b' }], indent: 1 },
      { type: 'paragraph', delta: [{ insert: '<x>' }] },
    ]);
    expect(html).toBe('<ul><li>a</li><ul><li>b</li></ul></ul><p>&lt;x&gt;</p>');
  });
});
