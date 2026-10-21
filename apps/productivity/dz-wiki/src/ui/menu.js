/**
 * Menus: a list of commands with keyboard support (arrows, Home, End,
 * type-ahead, Enter; Right opens a submenu, Left closes it), optional
 * filtering, check marks and section headers.
 *
 *   openMenu(anchor, items, { label, filter })
 *   item: { label, icon, hint, run, danger, checked, disabled, submenu, keep }
 *         { type: 'sep' } | { type: 'header', label }
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { Popover } from './popover.js';

let seq = 0;

export class Menu {
  constructor(items, { label = 'Menu', filter = false, filterPlaceholder = 'Search', empty = 'No results', onChoose = null, external = false, className = '' } = {}) {
    this.allItems = items;
    this.label = label;
    this.onChoose = onChoose;
    this.empty = empty;
    this.external = external;
    this.query = '';
    this.active = -1;
    this.id = `menu-${++seq}`;
    this.list = h('div.menu-list', { role: external ? 'listbox' : 'menu', id: this.id, 'aria-label': label, tabindex: filter || external ? null : '-1' });
    this.el = h(`div.menu${className ? `.${className}` : ''}`);
    if (filter) {
      this.input = h('input.menu-filter', { type: 'text', placeholder: filterPlaceholder, 'aria-label': filterPlaceholder, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': this.id, autocomplete: 'off', spellcheck: false });
      this.input.addEventListener('input', () => this.setQuery(this.input.value));
      this.input.addEventListener('keydown', (e) => this.handleKey(e));
      this.el.append(this.input);
    }
    this.el.append(this.list);
    if (!filter && !external) this.list.addEventListener('keydown', (e) => this.handleKey(e));
    this.render();
  }

  get items() {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.allItems;
    return this.allItems.filter((it) => it.type !== 'sep' && it.type !== 'header' && `${it.label} ${it.keywords || ''}`.toLowerCase().includes(q));
  }

  setQuery(q) {
    this.query = q;
    this.render();
  }

  selectable() {
    return [...this.list.querySelectorAll('[data-index]:not([aria-disabled="true"])')];
  }

  render() {
    const items = this.items;
    this.list.replaceChildren();
    this.nodes = [];
    items.forEach((it, i) => {
      if (it.type === 'sep') return this.list.append(h('div.menu-sep', { role: 'separator' }));
      if (it.type === 'header') return this.list.append(h('div.menu-header', { role: 'presentation' }, it.label));
      const role = this.external ? 'option' : it.checked !== undefined ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem';
      const node = h(
        `div.menu-item${it.danger ? '.danger' : ''}`,
        {
          role,
          id: `${this.id}-${i}`,
          'data-index': i,
          tabindex: '-1',
          'aria-checked': it.checked !== undefined ? String(!!it.checked) : null,
          'aria-disabled': it.disabled ? 'true' : null,
          'aria-haspopup': it.submenu ? 'menu' : null,
          'aria-selected': this.external ? 'false' : null,
        },
        it.render ? it.render() : [it.icon ? (it.icon instanceof Node ? it.icon : icon(it.icon, 16)) : it.checked !== undefined ? h('span.menu-check', it.checked ? icon('check', 15) : null) : null, h('span.menu-label', h('span.menu-name', it.label), it.description ? h('span.menu-desc', it.description) : null)],
        it.hint ? h('span.menu-hint', it.hint) : null,
        it.submenu ? icon('chevronRight', 14, { cls: 'menu-sub' }) : it.checked && it.icon ? icon('check', 15, { cls: 'menu-tick' }) : null,
      );
      node.addEventListener('pointermove', () => {
        if (this.active !== i) this.setActive(i, { scroll: false, focus: false });
      });
      node.addEventListener('click', (e) => {
        e.preventDefault();
        this.choose(i);
      });
      // Keep focus where it is (the editor, a filter field) while clicking.
      node.addEventListener('pointerdown', (e) => e.preventDefault());
      this.nodes[i] = node;
      this.list.append(node);
    });
    if (!this.selectable().length) this.list.append(h('div.menu-empty', this.empty));
    const first = this.selectable()[0];
    this.setActive(first ? Number(first.dataset.index) : -1, { focus: false });
  }

  setActive(i, { scroll = true, focus = true } = {}) {
    this.nodes?.forEach((n) => n?.classList.remove('active'));
    this.active = i;
    const node = this.nodes?.[i];
    const owner = this.input || (this.external ? null : this.list);
    if (node) {
      node.classList.add('active');
      if (this.external) node.setAttribute('aria-selected', 'true');
      if (scroll) node.scrollIntoView({ block: 'nearest' });
      if (owner) owner.setAttribute('aria-activedescendant', node.id);
      if (focus && !this.input && !this.external) node.focus({ preventScroll: !scroll });
    } else owner?.removeAttribute('aria-activedescendant');
    this.nodes?.forEach((n) => n && n !== node && this.external && n.setAttribute('aria-selected', 'false'));
  }

  move(delta) {
    const sel = this.selectable().map((n) => Number(n.dataset.index));
    if (!sel.length) return;
    const pos = sel.indexOf(this.active);
    const next = pos < 0 ? (delta > 0 ? 0 : sel.length - 1) : (pos + delta + sel.length) % sel.length;
    this.setActive(sel[next]);
  }

  /** Handles a key for this menu; returns true when it did something. */
  handleKey(e) {
    const k = e.key;
    let done = true;
    if (k === 'ArrowDown') this.move(1);
    else if (k === 'ArrowUp') this.move(-1);
    else if (k === 'Home' && !this.input) this.setActive(Number(this.selectable()[0]?.dataset.index ?? -1));
    else if (k === 'End' && !this.input) this.setActive(Number(this.selectable().at(-1)?.dataset.index ?? -1));
    else if (k === 'Enter' || (k === ' ' && !this.input && !this.external)) {
      if (this.active >= 0) this.choose(this.active);
      else done = false;
    } else if (k === 'ArrowRight' && this.items[this.active]?.submenu) this.choose(this.active);
    else if (k === 'ArrowLeft' && this.popover?.parent && !this.input) this.popover.close();
    else if (k === 'Tab' && !this.external) {
      this.popover?.close({ focus: true });
      done = false;
    } else if (!this.input && !this.external && k.length === 1 && /\S/.test(k) && !e.metaKey && !e.ctrlKey) {
      this.typeahead = (this.typeahead || '') + k.toLowerCase();
      clearTimeout(this.typeTimer);
      this.typeTimer = setTimeout(() => (this.typeahead = ''), 600);
      const hit = this.selectable().find((n) => n.textContent.trim().toLowerCase().startsWith(this.typeahead));
      if (hit) this.setActive(Number(hit.dataset.index));
    } else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
    return done;
  }

  choose(i) {
    const it = this.items[i];
    if (!it || it.disabled || it.type === 'sep' || it.type === 'header') return;
    if (it.submenu) {
      const node = this.nodes[i];
      const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
      const child = openMenu(node, sub, { label: it.label, placement: 'right-start', filter: it.filter });
      child.parentMenu = this;
      return;
    }
    // Choosing in a submenu closes the whole menu, not just the submenu.
    let top = this;
    while (top.parentMenu?.popover?.open) top = top.parentMenu;
    if (!it.keep) top.popover?.close({ focus: !it.noFocus });
    this.onChoose?.(it);
    it.run?.();
    if (it.keep) this.render();
  }
}

/** Opens a menu next to an anchor (element, point or rect). */
export function openMenu(anchor, items, { label = 'Menu', placement = 'bottom-start', filter = false, filterPlaceholder, onClose, className = '', empty } = {}) {
  const menu = new Menu(items, { label, filter, filterPlaceholder, empty });
  const pop = new Popover({ anchor, content: menu.el, className: `menu-pop ${className}`, placement, onClose, role: null });
  menu.popover = pop;
  if (anchor instanceof Element) {
    anchor.setAttribute('aria-expanded', 'true');
    const prev = pop.onClose;
    pop.onClose = () => {
      anchor.setAttribute('aria-expanded', 'false');
      prev?.();
    };
  }
  queueMicrotask(() => {
    if (menu.input) menu.input.focus();
    else if (menu.active >= 0) menu.setActive(menu.active);
    else menu.list.focus();
  });
  return menu;
}
