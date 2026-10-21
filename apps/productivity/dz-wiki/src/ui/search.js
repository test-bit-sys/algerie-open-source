/** Quick find (Ctrl/Cmd+K): pages by title and content across spaces. */
import { h, debounce } from '../lib/dom.js';
import { icon, pageIcon } from '../lib/icons.js';
import { openDialog } from './dialog.js';

export function openSearch(app) {
  const input = h('input.search-input', { type: 'search', placeholder: 'Search pages', 'aria-label': 'Search pages', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'search-results', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: false });
  const list = h('div.search-results', { id: 'search-results', role: 'listbox', 'aria-label': 'Results' });
  const count = h('p.sr-only', { role: 'status', 'aria-live': 'polite' });
  let results = [];
  let active = 0;
  const setActive = (i) => {
    active = Math.max(0, Math.min(results.length - 1, i));
    for (const [j, el] of [...list.querySelectorAll('.search-item')].entries()) {
      el.classList.toggle('active', j === active);
      el.setAttribute('aria-selected', String(j === active));
      if (j === active) {
        input.setAttribute('aria-activedescendant', el.id);
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  };
  const highlight = (text, q) => {
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return text;
    return [text.slice(0, i), h('mark', text.slice(i, i + q.length)), text.slice(i + q.length)];
  };
  const render = () => {
    const q = input.value.trim();
    results = q ? app.ws.search(q, { limit: 40 }) : app.ws.recentPages().slice(0, 12).map((r) => ({ ...r, title: r.page.title || 'Untitled', snippet: '', path: [] }));
    list.replaceChildren(
      h('p.search-group', { role: 'presentation' }, q ? 'Results' : 'Recent'),
      ...results.map((r, i) =>
        h(
          'div.search-item',
          { id: `sr-${i}`, role: 'option', 'aria-selected': 'false', onclick: () => choose(i), onpointermove: () => active !== i && setActive(i) },
          pageIcon(r.page, 18),
          h('div.search-text', h('span.search-title', highlight(r.title, q)), r.snippet ? h('span.search-snippet', highlight(r.snippet, q)) : null, r.path?.length || r.space.kind === 'shared' ? h('span.search-path', [r.space.kind === 'shared' ? 'Shared' : 'Private', ...(r.path || [])].join(' / ')) : null),
          icon('cornerDownRight', 14, { cls: 'search-enter' }),
        ),
      ),
    );
    if (!results.length) list.append(h('div.search-empty', icon('search', 20), h('p', q ? `No pages match "${q}"` : 'Pages you open show up here.')));
    count.textContent = q ? `${results.length} result${results.length === 1 ? '' : 's'}` : '';
    setActive(0);
  };
  const choose = (i) => {
    const r = results[i];
    if (!r) return;
    dlg.close();
    app.open(r.space, r.page.id);
  };
  const renderSoon = debounce(render, 80);
  input.addEventListener('input', renderSoon);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    // Results always match what is typed before a key acts on them.
    renderSoon.flush();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  });
  const foot = h('div.search-foot', h('span', h('kbd', '↑'), h('kbd', '↓'), ' to move'), h('span', h('kbd', 'Enter'), ' to open'), h('span', h('kbd', 'Esc'), ' to close'));
  const dlg = openDialog({ title: 'Search', className: 'search-dialog', body: h('div.search-box', h('div.search-field', icon('search', 18), input), list, count, foot), initialFocus: input });
  render();
}
