import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openMenu } from './menu.js';
import { prefs, setPref } from './prefs.js';
import { isMac } from '../lib/platform.js';

/*
 * Ribbon: a role="tablist" of tabs and, for the selected tab, a toolbar of
 * command groups. Items are described by data (see ribbon-def.js) and bound
 * to commands from the registry, so state refreshes come from one place.
 */
export class Ribbon {
  constructor(app, { tabs, commands, galleries }) {
    this.app = app;
    this.tabs = tabs;
    this.commands = commands;
    this.galleries = galleries;
    this.current = 'home';
    this.contextual = null;
    this.controls = [];
    this.el = h('div.ribbon', { role: 'region', 'aria-label': 'Ribbon', dataset: { collapsed: String(prefs().ribbonCollapsed) } });
    this.tabList = h('div.ribbon-tabs', { role: 'tablist', 'aria-label': 'Ribbon tabs' });
    this.panel = h('div.ribbon-panel', { role: 'tabpanel' });
    this.collapseBtn = h('button.icon-btn.ribbon-collapse', { type: 'button', 'data-tip': 'Collapse the Ribbon', 'data-tip-key': 'Mod+F1', 'aria-label': 'Collapse the Ribbon', onclick: () => this.toggleCollapsed() }, icon('chevUp', 16));
    this.tellMe = app.buildTellMe();
    this.el.append(h('div.ribbon-tabs-row', this.tabList, this.tellMe, h('span.ribbon-spacer'), this.collapseBtn), this.panel);
    this.panel.addEventListener('mousedown', (e) => {
      // Keep the caret in the note while clicking ribbon buttons.
      if (e.target.closest('button') && !e.target.closest('input')) e.preventDefault();
    });
    // The collapsed ribbon's floating panel closes once it has been used.
    app.listen(document, 'pointerdown', (e) => {
      if (this.el.classList.contains('peek') && !this.el.contains(e.target) && !e.target.closest?.('.menu')) this.el.classList.remove('peek');
    }, true);
    // When commands overflow a narrow window, a mouse wheel scrolls them
    // sideways, since a plain wheel has no other way to reach them.
    this.panel.addEventListener('wheel', (e) => {
      const p = this.panel;
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || p.scrollWidth <= p.clientWidth) return;
      const before = p.scrollLeft;
      p.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (p.scrollLeft !== before) e.preventDefault();
    }, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.panel);
    this.renderTabs();
    this.renderPanel();
    this.syncCollapsed();
  }

  visibleTabs() {
    return this.tabs.filter((t) => !t.contextual || t.id === this.contextual);
  }

  renderTabs() {
    // Rebuilding the tabs would drop focus from the one just activated.
    const hadFocus = this.tabList.contains(document.activeElement);
    this.tabList.replaceChildren();
    for (const tab of this.visibleTabs()) {
      const selected = tab.id === this.current;
      const btn = h(`button.ribbon-tab${tab.contextual ? '.contextual' : ''}`, {
        type: 'button',
        role: 'tab',
        id: `tab-${tab.id}`,
        'aria-selected': String(selected),
        'aria-controls': 'ribbon-panel',
        tabindex: selected ? '0' : '-1',
      }, tab.label);
      btn.addEventListener('click', () => {
        if (prefs().ribbonCollapsed) {
          if (this.current === tab.id && this.el.classList.contains('peek')) this.el.classList.remove('peek');
          else {
            this.select(tab.id);
            this.el.classList.add('peek');
          }
          return;
        }
        this.select(tab.id);
      });
      btn.addEventListener('dblclick', () => this.toggleCollapsed());
      btn.addEventListener('keydown', (e) => {
        const tabs = [...this.tabList.children];
        const i = tabs.indexOf(btn);
        let next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (prefs().ribbonCollapsed) this.el.classList.add('peek');
          this.focusToolbar();
          return;
        }
        if (next) {
          e.preventDefault();
          this.select(next.id.replace('tab-', ''));
          this.tabList.querySelector(`#${next.id}`)?.focus();
        }
      });
      this.tabList.append(btn);
    }
    if (hadFocus) this.tabList.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
    // Narrow windows scroll the tab row; keep the selected tab, or a
    // contextual tab that just appeared, in view.
    const shown = this.tabList.querySelector(this.contextual && this.contextual !== this.shownContextual ? '.contextual' : '[aria-selected="true"]');
    this.shownContextual = this.contextual;
    if (shown) this.revealTab(shown);
  }

  revealTab(tab) {
    const list = this.tabList;
    if (list.scrollWidth <= list.clientWidth) return;
    const l = list.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    if (r.left < l.left) list.scrollLeft -= l.left - r.left;
    else if (r.right > l.right) list.scrollLeft += r.right - l.right;
  }

  select(id) {
    this.current = id;
    this.renderTabs();
    this.renderPanel();
  }

  /** Shows or hides a contextual tab (such as Table). */
  setContextual(id) {
    if (this.contextual === id) return;
    const wasCurrent = this.current === this.contextual;
    this.contextual = id;
    if (wasCurrent && !id) this.current = 'home';
    this.renderTabs();
    if (wasCurrent && !id) this.renderPanel();
  }

  /** Hides the collapsed ribbon's floating panel, keeping focus out of it. */
  closePeek() {
    if (!this.el.classList.contains('peek')) return;
    const inPanel = this.panel.contains(document.activeElement);
    this.el.classList.remove('peek');
    if (inPanel) this.tabList.querySelector('[aria-selected="true"]')?.focus();
  }

  focusToolbar() {
    const list = this.rovingItems?.() || [];
    (list.find((b) => b.tabIndex === 0) || list[0] || this.panel.querySelector('input:not([disabled])'))?.focus();
  }

  toggleCollapsed(force) {
    const next = force ?? !prefs().ribbonCollapsed;
    setPref('ribbonCollapsed', next);
    this.syncCollapsed();
  }

  syncCollapsed() {
    const collapsed = prefs().ribbonCollapsed;
    this.el.dataset.collapsed = String(collapsed);
    this.el.classList.remove('peek');
    this.collapseBtn.replaceChildren(icon(collapsed ? 'chevDown' : 'chevUp', 16));
    const label = collapsed ? 'Always show the Ribbon' : 'Collapse the Ribbon';
    this.collapseBtn.setAttribute('aria-label', label);
    this.collapseBtn.dataset.tip = label;
    this.collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  }

  renderPanel() {
    const tab = this.tabs.find((t) => t.id === this.current) || this.tabs[0];
    this.panel.id = 'ribbon-panel';
    this.panel.setAttribute('aria-labelledby', `tab-${tab.id}`);
    this.controls = [];
    // Combos register themselves as they are built; drop the old panel's.
    this.app.combos = [];
    const toolbar = h('div.ribbon-toolbar', { role: 'toolbar', 'aria-label': `${tab.label} commands` });
    for (const group of tab.groups) {
      const g = h('div.rb-group', { role: 'group', 'aria-label': group.label });
      for (const item of group.items) {
        const el = this.renderItem(item);
        if (el) g.append(el);
      }
      toolbar.append(g);
    }
    this.panel.replaceChildren(toolbar);
    this.bindRoving(toolbar);
    this.refresh();
    this.fit();
  }

  bindRoving(toolbar) {
    const items = () => [...toolbar.querySelectorAll('button.rb-btn, button.rb-gallery-item, button.rb-gallery-more, .rb-combo button')].filter((b) => b.offsetParent !== null && !b.disabled);
    this.rovingItems = items;
    for (const b of toolbar.querySelectorAll('button')) b.tabIndex = -1;
    toolbar.addEventListener('keydown', (e) => {
      if (e.target.closest('input')) return;
      // Down Arrow opens a dropdown, like the app's other menu buttons.
      if (e.key === 'ArrowDown' && e.target.matches('button[aria-haspopup="menu"]:not(:disabled)')) {
        e.preventDefault();
        e.target.click();
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp'].includes(e.key)) return;
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowUp') {
        if (e.target.closest('.rb-gallery')) return;
        e.preventDefault();
        this.tabList.querySelector('[aria-selected="true"]')?.focus();
        return;
      }
      e.preventDefault();
      let n = i;
      if (e.key === 'ArrowRight') n = (i + 1) % list.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = list.length - 1;
      list.forEach((b) => (b.tabIndex = -1));
      list[n].tabIndex = 0;
      list[n].focus();
    });
    toolbar.addEventListener('focusin', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      for (const x of items()) x.tabIndex = x === b ? 0 : -1;
    });
  }

  cmd(id) {
    const c = this.commands.get(id);
    if (!c) throw new Error(`Unknown command ${id}`);
    return c;
  }

  button(c, { size = 'small', showLabel = false, label, dropdown = false, arg } = {}) {
    const text = label || c.short || c.label;
    const btn = h(`button.rb-btn${size === 'big' ? '.big' : ''}`, {
      type: 'button',
      'aria-label': c.label,
      'data-tip': c.label,
      'data-tip-key': c.key || null,
      'data-tip-desc': c.desc || null,
      'aria-keyshortcuts': c.key ? ariaKeys(c.key) : null,
    });
    if (c.icon) {
      const svg = icon(c.icon, size === 'big' ? 26 : 16, size === 'big' ? 1.5 : 1.75);
      svg.dataset.name = c.icon;
      btn.append(svg);
    }
    if (size === 'big' || showLabel) btn.append(h(`span.rb-label${size !== 'big' && showLabel === 'wide' ? '.hide-phone' : ''}`, text));
    if (dropdown) {
      const label = btn.querySelector('.rb-label');
      if (size === 'big' && label) {
        btn.classList.add('dropdown');
        // Keep the caret on the last word's line so it never wraps alone.
        const words = text.split(' ');
        const last = words.pop();
        label.replaceChildren(words.length ? `${words.join(' ')} ` : '', h('span.rb-nowrap', last, h('span.rb-caret.inline', icon('chevDown', 10))));
      }
      else btn.append(h('span.rb-caret', icon('chevDown', 12)));
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        if (btn._menuJustClosed) return;
        openMenu(btn, c.menu(this.app, arg), { label: c.label });
      });
    } else {
      btn.addEventListener('click', () => this.app.runCommand(c.id, arg));
    }
    if (c.color) {
      btn.classList.add('colored');
      btn.append(h('span.rb-color-bar'));
    }
    this.controls.push({ el: btn, c, arg });
    return btn;
  }

  split(c, { size = 'small', showLabel = false } = {}) {
    const main = this.button(c, { size, showLabel });
    const arrow = h('button.rb-btn', { type: 'button', 'aria-label': `${c.label} options`, 'data-tip': `${c.label} options`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('chevDown', 12));
    arrow.addEventListener('click', () => {
      if (arrow._menuJustClosed) return;
      openMenu(arrow, c.menu(this.app), { label: `${c.label} options` });
    });
    this.controls.push({ el: arrow, c, splitArrow: true });
    if (size === 'big') {
      arrow.replaceChildren(h('span', c.short || c.label), icon('chevDown', 12));
      main.querySelector('.rb-label')?.remove();
    }
    return h(`div.rb-split${size === 'big' ? '.big' : ''}`, main, arrow);
  }

  renderItem(item) {
    // Three rows only fit the panel's height with compact buttons.
    if (item.stack) return h(`div.rb-stack${item.stack.length > 2 ? '.dense' : ''}`, item.stack.map((row) => h('div.rb-row', row.map((i) => this.renderItem(i)))));
    if (item.combo) return this.app.buildCombo(item.combo, this);
    if (item.gallery) return this.renderGallery(item);
    const c = this.cmd(item.cmd);
    if (c.hidden?.(this.app)) return null;
    if (item.split) return this.split(c, item);
    return this.button(c, { size: item.size, showLabel: item.label, dropdown: item.dropdown || (c.menu && !c.run), arg: item.arg });
  }

  renderGallery(item) {
    const gallery = this.galleries[item.gallery];
    const wrap = h(`div.rb-gallery.${item.gallery}-gallery`, { role: 'group', 'aria-label': gallery.label, style: { '--rows': item.rows || 1 } });
    const itemsEl = h('div.rb-gallery-items');
    for (const entry of gallery.items(this.app).slice(0, item.visible || 6)) {
      const b = h('button.rb-gallery-item', { type: 'button', 'aria-label': entry.label, 'data-tip': entry.label, 'data-tip-key': entry.key || null, 'aria-pressed': 'false' }, entry.render());
      b.addEventListener('click', () => entry.run());
      this.controls.push({ el: b, entry, gallery });
      itemsEl.append(b);
    }
    const more = h('button.rb-gallery-more', { type: 'button', 'aria-label': `More ${gallery.label}`, 'data-tip': `More ${gallery.label}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('chevDown', 12));
    more.addEventListener('click', () => {
      if (more._menuJustClosed) return;
      openMenu(more, gallery.menu(this.app), { label: gallery.label });
    });
    wrap.append(itemsEl, more);
    // Narrow windows swap the gallery for a dropdown button.
    const fallback = h('button.rb-btn.rb-gallery-fallback', { type: 'button', 'aria-label': gallery.label, 'data-tip': gallery.label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon(gallery.icon, 16), h('span.rb-label', gallery.short || gallery.label), h('span.rb-caret', icon('chevDown', 12)));
    fallback.addEventListener('click', () => {
      if (fallback._menuJustClosed) return;
      openMenu(fallback, gallery.menu(this.app), { label: gallery.label });
    });
    return h('div.rb-gallery-wrap', { style: { display: 'contents' } }, wrap, fallback);
  }

  /**
   * Keeps the toolbar's one tab stop on a control that can take focus, as
   * commands become disabled and density changes hide controls.
   */
  syncRoving() {
    const stop = this.panel.querySelector('.ribbon-toolbar button[tabindex="0"]');
    if (stop && !stop.disabled && stop.offsetParent !== null) return;
    const list = this.rovingItems?.() || [];
    if (stop) stop.tabIndex = -1;
    if (list[0]) list[0].tabIndex = 0;
  }

  /** Updates pressed / disabled state of every visible control. */
  refresh() {
    const app = this.app;
    for (const ctl of this.controls) {
      const { el, c, entry, gallery } = ctl;
      if (entry) {
        const on = gallery.active?.(app, entry);
        el.setAttribute('aria-pressed', String(Boolean(on)));
        const enabled = gallery.enabled ? gallery.enabled(app) : true;
        el.disabled = !enabled;
        continue;
      }
      const enabled = c.enabled ? c.enabled(app, ctl.arg) : true;
      el.disabled = !enabled;
      if (ctl.splitArrow) continue;
      if (c.active) {
        const on = Boolean(c.active(app, ctl.arg));
        if (!el.hasAttribute('aria-haspopup')) el.setAttribute('aria-pressed', String(on));
      }
      if (c.color) el.style.setProperty('--bar', c.color(app) || 'transparent');
      if (c.dynamicIcon) {
        const cur = el.querySelector('.icon');
        const name = c.dynamicIcon(app);
        if (cur && cur.dataset.name !== name) {
          const next = icon(name, cur.getAttribute('width'), cur.getAttribute('stroke-width'));
          next.dataset.name = name;
          cur.replaceWith(next);
        }
      }
      if (c.dynamicLabel) {
        const l = c.dynamicLabel(app);
        el.setAttribute('aria-label', l);
        el.dataset.tip = l;
      }
    }
    this.app.refreshCombos?.();
    this.syncRoving();
  }

  /** Steps down the ribbon's density until the active tab fits. */
  fit() {
    if (!this.panel.isConnected) return;
    const toolbar = this.panel.firstElementChild;
    if (!toolbar) return;
    const wraps = [...toolbar.querySelectorAll('.rb-gallery-wrap')];
    for (const w of wraps) w.classList.remove('collapsed');
    if (window.innerWidth <= 760) {
      this.panel.dataset.fit = '0';
      this.syncRoving();
      return;
    }
    const fits = () => toolbar.scrollWidth <= toolbar.clientWidth + 1;
    this.panel.dataset.fit = '0';
    // Before shrinking everything, fold galleries into dropdowns one at a
    // time from the right.
    for (let i = wraps.length - 1; i >= 0 && !fits(); i--) wraps[i].classList.add('collapsed');
    if (!fits()) {
      for (const w of wraps) w.classList.remove('collapsed');
      for (const level of ['1', '2', '3']) {
        this.panel.dataset.fit = level;
        if (fits()) break;
      }
    }
    this.syncRoving();
  }
}

// aria-keyshortcuts names keys by their KeyboardEvent.key values.
const ARIA_KEY = { Period: '.', Comma: ',', Slash: '/', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']' };

function ariaKeys(spec) {
  return spec.split('+').map((p) => (p === 'Mod' ? (isMac ? 'Meta' : 'Control') : p === 'Ctrl' ? 'Control' : ARIA_KEY[p] || p)).join('+');
}
