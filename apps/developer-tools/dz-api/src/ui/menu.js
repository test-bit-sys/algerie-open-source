/**
 * Dropdown and context menus with full keyboard support: arrows, Home/End,
 * type-ahead, Enter/Space to run, Escape to close and return focus.
 *
 * items: [{ label, icon, run, kbd, danger, disabled, checked } | '-' | { heading }]
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

let open = null;

export function closeMenu() {
  if (!open) return;
  const { el, anchor, onClose, cleanup } = open;
  open = null;
  cleanup();
  el.remove();
  anchor?.setAttribute?.('aria-expanded', 'false');
  onClose?.();
}

/** Places a fixed-position element next to a rect, keeping it on screen. */
export function place(el, rect, { align = 'start', side = 'bottom', gap = 4 } = {}) {
  el.style.left = '0px';
  el.style.top = '0px';
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = align === 'end' ? rect.right - w : rect.left;
  let y = side === 'top' ? rect.top - hgt - gap : rect.bottom + gap;
  if (side === 'right') {
    x = rect.right + gap;
    y = rect.top;
  }
  if (y + hgt > vh - 8) y = Math.max(8, side === 'bottom' ? rect.top - hgt - gap : vh - hgt - 8);
  if (y < 8) y = 8;
  x = Math.min(Math.max(8, x), vw - w - 8);
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

export function showMenu(items, { anchor = null, rect = null, align = 'start', side = 'bottom', label = 'Menu', onClose, focusFirst = true } = {}) {
  closeMenu();
  // Where focus goes back to: the menu button, or for context menus whatever had focus.
  const active = document.activeElement;
  const returnTo = anchor || (active && active !== document.body ? active : null);
  const el = h('div.menu', { role: 'menu', 'aria-label': label, tabindex: '-1' });
  const restoreFocus = () => {
    const now = document.activeElement;
    if (returnTo?.isConnected && (!now || now === document.body || !now.isConnected || el.contains(now))) returnTo.focus?.({ preventScroll: true });
  };
  const buttons = [];
  for (const item of items.filter(Boolean)) {
    if (item === '-') {
      el.append(h('div.menu-sep', { role: 'separator' }));
      continue;
    }
    if (item.heading) {
      el.append(h('div.menu-label', { role: 'presentation' }, item.heading));
      continue;
    }
    const role = item.checked === undefined ? 'menuitem' : 'menuitemradio';
    const btn = h(
      `button.menu-item${item.danger ? '.danger' : ''}`,
      {
        type: 'button',
        role,
        tabindex: '-1',
        'aria-checked': item.checked === undefined ? null : String(!!item.checked),
        'aria-disabled': item.disabled ? 'true' : null,
        onclick: () => {
          if (item.disabled) return;
          closeMenu();
          // Before running, so a dialog the item opens returns focus here when it closes.
          restoreFocus();
          item.run?.();
        },
      },
      item.icon ? (typeof item.icon === 'string' ? icon(item.icon, 15) : item.icon) : null,
      item.render ? item.render() : h('span', item.label),
      item.kbd ? h('span.menu-kbd', item.kbd) : null,
      item.checked ? h('span.menu-check', icon('check', 14)) : null,
    );
    btn.dataset.label = (item.label || '').toLowerCase();
    buttons.push(btn);
    el.append(btn);
  }
  document.body.append(el);
  const r = rect || anchor.getBoundingClientRect();
  place(el, r, { align, side });
  anchor?.setAttribute?.('aria-expanded', 'true');
  const enabled = () => buttons.filter((b) => b.getAttribute('aria-disabled') !== 'true');
  const focusAt = (i) => {
    const list = enabled();
    if (!list.length) return;
    list[(i + list.length) % list.length].focus();
  };
  let typed = '';
  let typedAt = 0;
  el.addEventListener('keydown', (e) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') focusAt(i + 1);
    else if (e.key === 'ArrowUp') focusAt(i < 0 ? -1 : i - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(-1);
    else if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
      restoreFocus();
    } else if (e.key === 'Tab') {
      // Removing the focused item would send focus to the top of the page, so
      // put it back on the button first and let the browser tab on from there.
      closeMenu();
      restoreFocus();
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed = now - typedAt > 600 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const match = list.find((b) => b.dataset.label.startsWith(typed));
      match?.focus();
    } else return;
    e.preventDefault();
  });
  const onDown = (e) => {
    if (!el.contains(e.target) && !anchor?.contains?.(e.target)) closeMenu();
  };
  const onBlurWindow = () => closeMenu();
  // Added a tick later so the click that opened it does not close it, unless it closed first.
  let closed = false;
  setTimeout(() => closed || document.addEventListener('pointerdown', onDown, true));
  window.addEventListener('blur', onBlurWindow);
  window.addEventListener('resize', onBlurWindow);
  open = {
    el,
    anchor,
    onClose,
    cleanup() {
      closed = true;
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlurWindow);
      window.removeEventListener('resize', onBlurWindow);
    },
  };
  // focusAt counts enabled items only, so look the checked one up among those.
  if (focusFirst) focusAt(Math.max(0, enabled().findIndex((b) => b.getAttribute('aria-checked') === 'true')));
  else el.focus();
  return el;
}

/** Wires a button to toggle a menu built by getItems(). */
export function menuButton(button, getItems, opts = {}) {
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open?.anchor === button) return closeMenu();
    showMenu(getItems(), { anchor: button, ...opts });
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && open?.anchor !== button) {
      e.preventDefault();
      showMenu(getItems(), { anchor: button, ...opts });
    }
  });
  return button;
}

export function contextMenu(e, items, opts = {}) {
  e.preventDefault();
  const rect = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
  return showMenu(items, { rect, ...opts });
}
