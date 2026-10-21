// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { initPublicNavigation, initResourceSearch } from '../site/client.js';
import { renderPage } from '../site/render.js';
import { articles } from '../site/content.js';

const docCount = articles.filter(a => a.collection === 'docs').length;
let dispose;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
it('filters by all search terms, announces results, and clears an empty search', () => {
  document.body.innerHTML = renderPage('/docs/');
  const root = document.querySelector('.site-public');
  dispose = initPublicNavigation(root);
  initResourceSearch(root);
  const input = root.querySelector('[data-resource-search]');
  const visible = () => [...root.querySelectorAll('[data-resource]')].filter(card => !card.hidden);
  const search = value => { input.value = value; input.dispatchEvent(new Event('input')); };
  search('supplier orders');
  expect(visible().length).toBeGreaterThan(0);
  expect(visible().every(card => /supplier/i.test(card.textContent) && /orders/i.test(card.textContent))).toBe(true);
  search('there-is-no-such-topic');
  expect(visible()).toHaveLength(0);
  expect(root.querySelector('[data-search-empty]').hidden).toBe(false);
  expect(root.querySelector('[data-search-status]').textContent).toBe('0 articles found');
  root.querySelector('[data-search-clear]').click();
  expect(visible()).toHaveLength(docCount);
  expect(document.activeElement).toBe(input);
});
