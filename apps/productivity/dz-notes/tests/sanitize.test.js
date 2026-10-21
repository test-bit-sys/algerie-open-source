import { describe, it, expect } from 'vitest';
import { sanitizeHtml, safeUrl, htmlToText } from '../src/lib/sanitize.js';

describe('sanitizeHtml', () => {
  it('drops scripts, handlers, frames and forms', () => {
    const out = sanitizeHtml('<p onclick="x()">Hi<script>alert(1)</script></p><iframe src="x"></iframe><form><input></form><img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/script|onclick|onerror|iframe|form|input/i);
    expect(out).toContain('<p>Hi</p>');
  });

  it('removes javascript: and data: links but keeps safe ones', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">a</a><a href="java\tscript:alert(1)">b</a><a href="data:text/html,x">c</a><a href="https://example.com">d</a><a href="#page=p1">e</a>');
    expect(out).not.toMatch(/javascript|data:text/i);
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="#page=p1"');
    expect(out).not.toContain('<a href="#page=p1" target');
  });

  it('keeps only safe style properties', () => {
    const out = sanitizeHtml('<span style="color: red; position: fixed; background-image: url(evil); font-size: 12pt">x</span>');
    expect(out).toContain('color: red');
    expect(out).toContain('font-size: 12pt');
    expect(out).not.toMatch(/position|url\(/);
  });

  it('keeps note markup: tags, attachments, equations', () => {
    const html = '<p><span class="nt-tag" data-tag="todo" data-done="true" contenteditable="false"></span>Do it</p><span class="nt-file" data-asset="a1.pdf" data-name="Plan.pdf" contenteditable="false"></span><span class="nt-math" data-tex="x^2" contenteditable="false"></span>';
    const out = sanitizeHtml(html);
    expect(out).toContain('data-tag="todo"');
    expect(out).toContain('data-done="true"');
    expect(out).toContain('data-asset="a1.pdf"');
    expect(out).toContain('data-tex="x^2"');
  });

  it('strips unknown classes and unwraps unknown elements', () => {
    const out = sanitizeHtml('<section class="evil nt-cite"><article>Text</article></section>');
    expect(out).toBe('Text');
  });

  it('turns legacy <font> into styled spans', () => {
    expect(sanitizeHtml('<font color="#ff0000" face="Arial">x</font>')).toBe('<span style="color: #ff0000; font-family: Arial">x</span>');
  });

  it('only allows image data URLs for images', () => {
    expect(safeUrl('data:image/png;base64,AAAA', { image: true })).toBeTruthy();
    expect(safeUrl('data:text/html;base64,AAAA', { image: true })).toBeNull();
    expect(safeUrl('data:image/png;base64,AAAA')).toBeNull();
  });
});

describe('htmlToText', () => {
  it('puts blocks on their own lines and cells apart', () => {
    expect(htmlToText('<h1>Title</h1><p>One</p><ul><li>A</li><li>B</li></ul><table><tr><td>x</td><td>y</td></tr></table>')).toBe('Title\nOne\nA\nB\nx\ty');
  });
});
