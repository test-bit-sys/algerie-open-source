import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('src/styles');

/** Depth of unclosed blocks at the end of a stylesheet, ignoring comments and strings. Negative means a stray }. */
function openBlocks(css) {
  const text = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, '').replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  let depth = 0;
  for (const c of text) {
    if (c === '{') depth++;
    else if (c === '}' && --depth < 0) return depth;
  }
  return depth;
}

describe('stylesheets', () => {
  // The files are joined into one bundle, so one unclosed block swallows every rule after it.
  it.each(fs.readdirSync(dir).filter((f) => f.endsWith('.css')))('%s closes every block it opens', (file) => {
    expect(openBlocks(fs.readFileSync(path.join(dir, file), 'utf8'))).toBe(0);
  });

  it('counts braces outside comments and strings only', () => {
    expect(openBlocks('a { content: "}"; } /* { */')).toBe(0);
    expect(openBlocks('@media (x) { a { color: red; }')).toBe(1);
    expect(openBlocks('a { } }')).toBe(-1);
  });
});

describe('design tokens', () => {
  const css = fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8');
  const block = (selector) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
  const themes = { light: block(':root'), dark: block(":root[data-theme-resolved='dark']") };
  const token = (theme, name) => (themes[theme].match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i')) || themes.light.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i')))[1];
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  // Text on these pairs must reach WCAG AA (4.5:1) in both themes.
  it.each([
    ['syn-comment', 'bg-sunken'],
    ['syn-comment', 'bg'],
    ['text-inverse', 'danger'],
    ['text-inverse', 'danger-hover'],
    ['text-inverse', 'accent'],
  ])('%s on %s is readable', (fg, bg) => {
    for (const theme of ['light', 'dark']) expect(contrast(token(theme, fg), token(theme, bg)), theme).toBeGreaterThanOrEqual(4.5);
  });
});
