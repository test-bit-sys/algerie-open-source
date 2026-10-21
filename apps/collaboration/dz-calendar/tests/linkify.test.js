import { describe, it, expect } from 'vitest';
import { linkify } from '../src/js/dom.js';

/** Render linkify()'s parts into a container for easy assertions. */
function render(text) {
  const box = document.createElement('div');
  for (const p of linkify(text)) box.append(p.nodeType ? p : document.createTextNode(p));
  return box;
}

describe('linkify', () => {
  it('leaves plain text untouched', () => {
    const box = render('lunch at noon, bring slides');
    expect(box.querySelector('a')).toBeNull();
    expect(box.textContent).toBe('lunch at noon, bring slides');
  });

  it('links http(s) URLs and opens them in a new tab', () => {
    const box = render('docs: https://example.com/spec?v=2 tomorrow');
    const a = box.querySelector('a');
    expect(a.href).toBe('https://example.com/spec?v=2');
    expect(a.textContent).toBe('https://example.com/spec?v=2');
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
    expect(box.textContent).toBe('docs: https://example.com/spec?v=2 tomorrow');
  });

  it('prefixes bare www. hosts with https', () => {
    const a = render('see www.example.com/a').querySelector('a');
    expect(a.getAttribute('href')).toBe('https://www.example.com/a');
    expect(a.textContent).toBe('www.example.com/a');
  });

  it('turns email addresses into mailto links', () => {
    const a = render('ping nj@puter.com about this').querySelector('a');
    expect(a.getAttribute('href')).toBe('mailto:nj@puter.com');
  });

  it('keeps sentence punctuation out of the link', () => {
    const box = render('read https://example.com/a. Then reply!');
    expect(box.querySelector('a').textContent).toBe('https://example.com/a');
    expect(box.textContent).toBe('read https://example.com/a. Then reply!');
  });

  it('balances parentheses around and inside URLs', () => {
    const wrapped = render('(see https://example.com/a)').querySelector('a');
    expect(wrapped.textContent).toBe('https://example.com/a');
    const wiki = render('https://en.wikipedia.org/wiki/Foo_(bar)').querySelector('a');
    expect(wiki.textContent).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });

  it('handles multiple links and multi-line text', () => {
    const box = render('a https://x.com/1\nb www.y.com/2');
    const links = box.querySelectorAll('a');
    expect(links.length).toBe(2);
    expect(box.textContent).toBe('a https://x.com/1\nb www.y.com/2');
  });

  it('never emits a non-http(s)/mailto scheme', () => {
    const box = render('javascript:alert(1) data:text/html,x https://ok.com');
    const links = [...box.querySelectorAll('a')];
    expect(links.length).toBe(1);
    expect(links[0].href).toBe('https://ok.com/');
  });

  it('treats markup in text as inert text', () => {
    const box = render('<img src=x onerror=alert(1)> https://ok.com');
    expect(box.querySelector('img')).toBeNull();
    expect(box.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
