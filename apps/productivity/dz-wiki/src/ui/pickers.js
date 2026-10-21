/** The icon picker (for pages and callouts) and the cover picker. */
import { h } from '../lib/dom.js';
import { icon, PAGE_ICONS, iconLabel } from '../lib/icons.js';
import { COLORS } from '../lib/sanitize.js';
import { Popover } from './popover.js';

const ICON_COLORS = ['', ...COLORS];
const name = (c) => (c ? c[0].toUpperCase() + c.slice(1) : 'Default');

export function openIconPicker(anchor, current, onPick, { allowRemove = true, colors = true } = {}) {
  let color = current?.color || '';
  const search = h('input.field.picker-search', { type: 'search', placeholder: 'Search icons', 'aria-label': 'Search icons', autocomplete: 'off' });
  const swatches = h('div.picker-colors', { role: 'radiogroup', 'aria-label': 'Icon color' });
  const grid = h('div.icon-grid', { role: 'listbox', 'aria-label': 'Icons' });
  const renderColors = () => {
    swatches.replaceChildren(
      ...ICON_COLORS.map((c) =>
        h('button.color-dot', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(c === color),
          'aria-label': name(c),
          'data-tip': name(c),
          'data-c': c || 'default',
          onclick: () => {
            color = c;
            renderColors();
            renderGrid();
          },
        }),
      ),
    );
  };
  let active = 0;
  const renderGrid = () => {
    const q = search.value.trim().toLowerCase();
    const list = PAGE_ICONS.filter((n) => !q || iconLabel(n).includes(q));
    grid.replaceChildren(
      ...list.map((n, i) => {
        const b = h('button.icon-choice', { type: 'button', role: 'option', 'aria-label': iconLabel(n), 'aria-selected': String(current?.name === n), tabindex: i === active ? '0' : '-1', 'data-c': color || null, 'data-name': n }, icon(n, 20));
        b.addEventListener('click', () => pick({ name: n, color: color || null }));
        return b;
      }),
    );
    if (!list.length) grid.append(h('p.picker-empty', 'No icons match'));
  };
  const pick = (value) => {
    pop.close();
    onPick(value);
  };
  grid.addEventListener('keydown', (e) => {
    const btns = [...grid.querySelectorAll('.icon-choice')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, Math.round(grid.clientWidth / (btns[0]?.offsetWidth || 36)));
    const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: btns.length - 1 - i };
    if (map[e.key] === undefined) return;
    e.preventDefault();
    const next = btns[Math.max(0, Math.min(btns.length - 1, i + map[e.key]))];
    btns[i].tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });
  search.addEventListener('input', () => {
    active = 0;
    renderGrid();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      grid.querySelector('.icon-choice')?.focus();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      grid.querySelector('.icon-choice')?.click();
    }
  });
  renderColors();
  renderGrid();
  const head = h('div.picker-head', search, allowRemove && current?.name ? h('button.btn.small.ghost', { type: 'button', onclick: () => pick(null) }, 'Remove') : null);
  const pop = new Popover({ anchor, content: h('div.icon-picker', head, colors ? swatches : null, grid), className: 'picker-pop', label: 'Choose an icon' });
  search.focus();
  return pop;
}

const COVER_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export function openCoverPicker(anchor, current, { onPick, onUpload }) {
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.addEventListener('change', () => {
    if (file.files[0]) {
      pop.close();
      onUpload(file.files[0]);
    }
  });
  const swatches = COVER_COLORS.map((c) =>
    h('button.cover-swatch', { type: 'button', 'data-c': c, 'aria-label': `${name(c)} cover`, 'aria-pressed': String(current?.color === c), onclick: () => {
        pop.close();
        onPick({ color: c });
      } }),
  );
  const body = h(
    'div.cover-picker',
    h('p.picker-label', 'Color'),
    h('div.cover-swatches', ...swatches),
    h('p.picker-label', 'Image'),
    h('div.cover-actions', h('button.btn.small', { type: 'button', onclick: () => file.click() }, icon('upload', 15), 'Upload an image'), current ? h('button.btn.small.ghost', { type: 'button', onclick: () => {
        pop.close();
        onPick(null);
      } }, 'Remove cover') : null),
    file,
  );
  const pop = new Popover({ anchor, content: body, className: 'picker-pop', label: 'Choose a cover' });
  swatches[0].focus();
  return pop;
}
