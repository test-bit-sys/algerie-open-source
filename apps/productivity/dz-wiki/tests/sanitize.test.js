import { describe, it, expect } from 'vitest';
import { sanitizeInline, safeUrl, textOf } from '../src/lib/sanitize.js';

describe('sanitizeInline', () => {
  it('keeps allowed inline formatting and normalizes synonyms', () => {
    expect(sanitizeInline('<strong>a</strong><em>b</em><u>c</u><del>d</del><code>e</code>')).toBe('<b>a</b><i>b</i><u>c</u><s>d</s><code>e</code>');
  });

  it('drops scripts, handlers and styles', () => {
    const out = sanitizeInline('<img src=x onerror=alert(1)><script>alert(1)</script><b onclick="x()" style="color:red">ok</b>');
    expect(out).toBe('<b>ok</b>');
  });

  it('only keeps safe links and opens them in a new tab', () => {
    expect(sanitizeInline('<a href="javascript:alert(1)">x</a>')).toBe('x');
    expect(sanitizeInline('<a href="java\tscript:alert(1)">x</a>')).toBe('x');
    expect(sanitizeInline('<a href="https://example.com">x</a>')).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it('keeps page links and known colors only', () => {
    expect(sanitizeInline('<a data-page="abc123">P</a>')).toBe('<a data-page="abc123">P</a>');
    expect(sanitizeInline('<a data-page="../../x">P</a>')).toBe('P');
    expect(sanitizeInline('<span data-color="red">r</span><span data-color="evil">e</span>')).toBe('<span data-color="red">r</span>e');
  });

  it('flattens pasted blocks into line breaks', () => {
    expect(sanitizeInline('<p>one</p><p>two</p>')).toBe('one<br>two');
  });

  it('escapes plain text', () => {
    expect(sanitizeInline('a > b')).toBe('a &gt; b');
    expect(sanitizeInline('a < b & c')).toBe('a &lt; b &amp; c');
  });

  it('drops a trailing break left by contenteditable', () => {
    expect(sanitizeInline('hello<br>')).toBe('hello');
  });
});

describe('safeUrl', () => {
  it('accepts web, mail and phone links and bare domains', () => {
    expect(safeUrl('https://a.com')).toBe('https://a.com');
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeUrl('example.com/x')).toBe('https://example.com/x');
  });
  it('refuses other schemes', () => {
    expect(safeUrl('data:text/html,x')).toBe(null);
    expect(safeUrl('vbscript:x')).toBe(null);
    expect(safeUrl('//evil.com')).toBe(null);
  });
});

describe('textOf', () => {
  it('returns text with line breaks', () => {
    expect(textOf('a<br><b>b</b> &amp; c')).toBe('a\nb & c');
  });
});

import { renderDelta, deltaToHtml, cleanDelta } from '../src/data/richtext.js';
import { blocksToHtml } from '../src/data/markdown.js';
import { hasIcon, icon, pageIcon } from '../src/lib/icons.js';

describe('untrusted document content', () => {
  const evil = [
    { insert: 'click', attributes: { link: 'javascript:alert(1)' } },
    { insert: 'x', attributes: { color: 'red" onmouseover="alert(1)', bg: 'url(x)', page: '../../etc' } },
  ];

  it('never renders unsafe links or attributes', () => {
    const el = document.createElement('div');
    renderDelta(el, evil);
    expect(el.innerHTML).toBe('clickx');
    expect(deltaToHtml(evil)).toBe('clickx');
    expect(cleanDelta(evil)).toEqual([{ insert: 'click' }, { insert: 'x' }]);
  });

  it('exports only safe URLs', () => {
    const html = blocksToHtml([
      { type: 'bookmark', url: 'javascript:alert(1)', name: 'b' },
      { type: 'image', url: 'javascript:alert(1)', caption: 'c' },
      { type: 'page', page: '"><script>' },
    ]);
    expect(html).not.toContain('javascript');
    expect(html).not.toContain('<script');
  });

  it('ignores icon names that are not icons', () => {
    expect(hasIcon('constructor')).toBe(false);
    expect(hasIcon('__proto__')).toBe(false);
    expect(() => icon('constructor')).not.toThrow();
    expect(() => pageIcon({ icon: { name: 'toString', color: 'red' } })).not.toThrow();
  });
});
