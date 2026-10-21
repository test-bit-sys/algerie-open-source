import { el } from '../lib/dom.js';
import { icon } from './icons.js';

/* Every open dialog, so navigation can sweep them away (closeAllModals). */
const openDialogs = new Set();

export function closeAllModals() {
  for (const close of [...openDialogs]) close();
}

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide }) → { close(), panel }
 */
export function openModal({ title, content, onClose, wide = false }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => close() }),
    panel
  );

  // Keep keyboard and screen-reader focus inside the dialog, and put it
  // back where it came from on close. The row id rides along because a
  // save re-renders the view and detaches the opener — its stand-in in
  // the fresh DOM is found through the row.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openerRowId = opener?.closest?.('[data-task-id]')?.dataset.taskId || null;
  const appEl = document.getElementById('app');

  panel.append(
    el('div.sheet-handle'),
    el('div.modal-head', {},
      el('h2.modal-title', {}, title),
      el('button.icon-btn', { html: icon('x', 20), 'aria-label': 'Close', onclick: () => close() })
    ),
    content
  );

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    openDialogs.delete(close);
    rootNode.classList.add('closing');
    // Hand interactivity back the moment the exit animation starts — to the
    // dialog now topmost, or to the app when this was the last one. Waiting
    // for the animation would leave the page inert (and the lingering scrim
    // catching pointers) just long enough to eat the tap that follows.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    if (stack.length) stack[stack.length - 1].removeAttribute('inert');
    else appEl?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      if (!document.querySelector('.modal-root')) {
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
      }
      restoreFocus();
    }, 200);
  }

  /**
   * Put focus back where it came from. Saving from a dialog re-renders
   * the view, so the opener is often detached by close time — focus its
   * stand-in in the fresh DOM (same id, or the same control in the same
   * task row) instead of letting focus fall to <body> and making Tab
   * restart from the top of the document.
   */
  function restoreFocus() {
    const top = document.querySelector('.modal-root:not(.closing) .modal-panel');
    if (top) { // a dialog below this one still owns the screen
      if (opener?.isConnected && top.contains(opener)) opener.focus();
      else top.focus({ preventScroll: true });
      return;
    }
    if (!opener) return;
    if (opener.isConnected) { opener.focus(); return; }
    let next = opener.id ? document.getElementById(opener.id) : null;
    if (!next && openerRowId) {
      const row = document.querySelector(`[data-task-id="${CSS.escape(openerRowId)}"]`);
      const classes = String(opener.className).trim().split(/\s+/).filter(Boolean);
      next = row && ((classes.length && row.querySelector('.' + classes.join('.')))
        || row.querySelector('button'));
    }
    if (!next) {
      next = document.getElementById('main');
      if (next && !next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1');
    }
    next?.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // Only the top of a modal stack (e.g. confirm over edit sheet) closes.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] === rootNode) close();
  }

  document.addEventListener('keydown', onKey);
  openDialogs.add(close);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  // Stacked dialogs: only the topmost may hold focus.
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  const focusable = panel.querySelector('input, select, textarea, button:not(.icon-btn)');
  if (focusable && matchMedia('(min-width: 640px)').matches) focusable.focus();
  else panel.focus({ preventScroll: true });

  return { close, panel };
}

/** Simple confirm dialog. Resolves true/false (false on Escape/scrim too). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p', { style: { color: 'var(--ink-2)', marginBottom: '18px', fontSize: '14px' } }, message),
      el('div.row', { style: { justifyContent: 'flex-end' } },
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Cancel'),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          // Resolve before close() — close fires onClose, which resolves false.
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}
