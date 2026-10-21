/**
 * Context menu.
 *
 * Per project requirement, this uses Puter's native context-menu API
 * (`puter.ui.contextMenu`) whenever the app is running inside the Puter GUI,
 * where that API is supported. When the app is served as a standalone website
 * (dev server or generic hosting) Puter's UI bridge isn't present, so we render
 * a styled, keyboard-accessible menu that mirrors the same item contract:
 *
 *   items: Array<'-' | {
 *     label: string,
 *     action?: () => void,
 *     disabled?: boolean,
 *     danger?: boolean,      // fallback-only visual emphasis
 *     colorHex?: string,     // fallback-only leading swatch
 *   }>
 */
import { el } from './dom.js';

let activeMenu = null;

function isPuterGui() {
  try {
    return (
      typeof puter !== 'undefined' &&
      puter.ui &&
      typeof puter.ui.contextMenu === 'function' &&
      (puter.env === 'app' || puter.env === 'gui')
    );
  } catch {
    return false;
  }
}

// Told when the fallback menu closes, whichever way — a pick, Escape, a click
// elsewhere, a scroll — so work held back while it was up (the app's
// re-renders, which tear the menu down) can catch up.
const closeListeners = new Set();
export function onContextMenuClose(fn) {
  closeListeners.add(fn);
  return () => closeListeners.delete(fn);
}

export function closeContextMenu() {
  if (activeMenu) {
    activeMenu.cleanup();
    activeMenu = null;
    for (const fn of [...closeListeners]) {
      try {
        fn();
      } catch {
        /* one listener's failure must not silence the rest */
      }
    }
  }
}

/** True while the fallback context menu is on screen. */
export function isContextMenuOpen() {
  return activeMenu !== null;
}

/**
 * Open a context menu at the pointer location of `evt`.
 * @param {MouseEvent} evt
 * @param {Array} items
 */
export function openContextMenu(evt, items) {
  evt.preventDefault();
  closeContextMenu();

  const usable = items.filter(Boolean);
  if (!usable.length) return;

  // Native Puter menu (positions itself at the cursor).
  if (isPuterGui()) {
    const mapped = usable.map((it) =>
      it === '-'
        ? '-'
        : {
            label: it.label,
            disabled: !!it.disabled,
            action: it.action || (() => {}),
          },
    );
    try {
      puter.ui.contextMenu({ items: mapped });
      return;
    } catch {
      /* fall through to the local renderer */
    }
  }

  renderFallback(evt.clientX, evt.clientY, usable);
}

function renderFallback(x, y, items) {
  // The menu is about to steal focus (menu.focus() below, arrows after that);
  // remember where from, so closing can hand it back instead of dropping the
  // keyboard user on <body> to re-Tab from the top of the page.
  const lastFocused = document.activeElement;
  const menu = el('div', { class: 'ctx-menu', role: 'menu', tabindex: '-1' });

  const focusables = [];
  items.forEach((it) => {
    if (it === '-') {
      menu.append(el('div', { class: 'ctx-menu__sep', role: 'separator' }));
      return;
    }
    const item = el('button', {
      class: `ctx-menu__item${it.danger ? ' is-danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      'aria-disabled': it.disabled ? 'true' : null,
    });
    if (it.colorHex) {
      item.append(el('span', { class: 'ctx-menu__swatch', style: { background: it.colorHex } }));
    }
    item.append(el('span', { text: it.label }));
    if (!it.disabled) {
      item.addEventListener('click', () => {
        closeContextMenu();
        it.action && it.action();
      });
      focusables.push(item);
    }
    menu.append(item);
  });

  document.body.append(menu);

  // Clamp within the viewport.
  const rect = menu.getBoundingClientRect();
  const pad = 8;
  const left = Math.min(x, window.innerWidth - rect.width - pad);
  const top = Math.min(y, window.innerHeight - rect.height - pad);
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top = `${Math.max(pad, top)}px`;

  let focusIndex = -1;
  const setFocus = (i) => {
    focusIndex = (i + focusables.length) % focusables.length;
    focusables.forEach((f, idx) => f.classList.toggle('is-focused', idx === focusIndex));
    focusables[focusIndex]?.focus();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeContextMenu();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus(focusIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // From the initial "nothing focused" state (-1), Up selects the last item.
      // Passing (-1 - 1) = -2 would wrap to the second-to-last via setFocus's
      // modulo, so special-case the top of the list.
      setFocus(focusIndex <= 0 ? focusables.length - 1 : focusIndex - 1);
    } else if (e.key === 'Tab') {
      // Trap Tab within the open menu (it has no scrim and lives at the end of
      // <body>, so default tabbing would move focus to the page behind it while
      // the menu stayed up). Cycle like the arrow keys.
      e.preventDefault();
      if (e.shiftKey) setFocus(focusIndex <= 0 ? focusables.length - 1 : focusIndex - 1);
      else setFocus(focusIndex + 1);
    } else if (e.key === 'Enter' && focusIndex >= 0) {
      e.preventDefault();
      focusables[focusIndex].click();
    }
  };

  const onPointerDown = (e) => {
    if (!menu.contains(e.target)) closeContextMenu();
  };
  const onBlurClose = () => closeContextMenu();

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('contextmenu', onPointerDown, true);
  window.addEventListener('blur', onBlurClose);
  window.addEventListener('resize', onBlurClose);
  document.addEventListener('scroll', onBlurClose, true);

  activeMenu = {
    cleanup() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('contextmenu', onPointerDown, true);
      window.removeEventListener('blur', onBlurClose);
      window.removeEventListener('resize', onBlurClose);
      document.removeEventListener('scroll', onBlurClose, true);
      // Restore focus only when the menu still holds it (Escape, Enter, an
      // item click) — if the user is mid-click on another control, the browser
      // is already moving focus there and we must not fight it. The opener may
      // also be gone (a re-render replaced it); focusing a detached node is a
      // silent no-op, so skip it and let the caller's own focus logic apply.
      const hadFocus = menu.contains(document.activeElement);
      menu.remove();
      if (
        hadFocus &&
        lastFocused &&
        lastFocused !== document.body &&
        typeof lastFocused.focus === 'function' &&
        document.contains(lastFocused)
      ) {
        lastFocused.focus();
      }
    },
  };

  menu.focus();
}
