import { el, fieldId } from './dom.js';
import { icon } from './icons.js';

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide }) -> { close(), lock(), panel }
 * `wide` widens the desktop dialog (e.g. the document preview). `lock()` takes
 * away the casual ways out (scrim, Escape, the X) for a dialog whose contents
 * are shown once and only leave by its own button; `close()` still works.
 */
export function openModal({ title, content, onClose, wide = false }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  let locked = false;
  const dismiss = () => { if (!locked) close(); };
  const closeBtn = el('button.icon-btn', { type: 'button', html: icon('x', 20), 'aria-label': 'Close', onclick: dismiss });
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: dismiss }),
    panel
  );

  // Keep keyboard and screen-reader focus inside the dialog, and put it
  // back where it came from on close.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // A dialog that changes something rebuilds the view behind it, which throws
  // the very control it was opened from away — so "back where it came from"
  // was the body, and Tab restarted at the top of the page. Controls that
  // survive a rebuild carry a stable key; the replacement is found by it.
  const openerKey = (opener && opener.dataset && opener.dataset.act) || '';
  const appEl = document.getElementById('app');

  panel.append(
    el('div.sheet-handle'),
    el('div.modal-head', {},
      el('h2.modal-title', {}, title),
      closeBtn
    ),
    content
  );

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    rootNode.classList.add('closing');
    // Hand focusability back to the dialog that is now topmost.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      if (!document.querySelector('.modal-root')) {
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
      }
      if (opener?.isConnected) opener.focus();
      else if (openerKey) document.querySelector(`[data-act="${openerKey}"]`)?.focus();
    }, 200);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // Only the top of a modal stack (e.g. confirm over an edit sheet) closes.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] === rootNode) dismiss();
  }

  /**
   * For a dialog showing something that exists nowhere else once it is gone
   * (an access code: the app keeps only its hash). A tap beside the sheet or
   * a reflex Escape must not be the last anyone sees of it, so from here on
   * only the dialog's own button closes it.
   */
  function lock() {
    locked = true;
    closeBtn.hidden = true;
  }

  // Scrolling the page behind an open dialog is disorienting, and it came
  // back at a different offset once the dialog closed. Hiding overflow on the
  // root element does not stop a wheel gesture and strips the sticky offsets
  // out of the layout underneath, so the gesture is blocked here instead:
  // inside the panel it scrolls the panel (which contains its own overscroll),
  // anywhere else it does nothing.
  const holdScroll = (e) => {
    if (!panel.contains(e.target)) e.preventDefault();
  };
  rootNode.addEventListener('wheel', holdScroll, { passive: false });
  rootNode.addEventListener('touchmove', holdScroll, { passive: false });

  document.addEventListener('keydown', onKey);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  // Stacked dialogs: only the topmost may hold focus.
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  const focusable = panel.querySelector('input, select, textarea, button:not(.icon-btn)');
  if (focusable && matchMedia('(min-width: 640px)').matches) focusable.focus();
  else panel.focus({ preventScroll: true });

  return { close, lock, panel };
}

/** Simple confirm dialog. Resolves true/false (false on Escape/scrim/close too). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p.modal-message', {}, message),
      el('div.row.end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          type: 'button',
          // Resolve before close(): close fires onClose, which resolves false.
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}

/**
 * One-button dialog: something has already happened and all that is left is
 * to read it (an access code, shown once). A confirm's "Cancel" would offer
 * to call off an action that has already taken effect. `extra` is rendered
 * under the message. Resolves when it is dismissed; with `sticky`, only its
 * own button dismisses it (see openModal's lock).
 */
export function alertDialog({ title, message, confirmLabel = 'Done', extra = null, sticky = false }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p.modal-message', {}, message),
      extra,
      el('div.row.end', {},
        el('button.btn.btn-primary', { type: 'button', onclick: () => modal.close() }, confirmLabel))
    );
    const modal = openModal({ title, content, onClose: () => resolve() });
    if (sticky) modal.lock();
  });
}

/**
 * One-field text dialog: naming a template, renaming one. Resolves the
 * trimmed value, or null if the dialog was dismissed. An empty value can't
 * be confirmed, so there is no way to end up with a blank name.
 */
export function promptDialog({
  title, label, value = '', placeholder = '', confirmLabel = 'Save', hint = '', maxLength = 120,
}) {
  return new Promise((resolve) => {
    const id = fieldId('prompt');
    const input = el('input.input', { id, type: 'text', value, placeholder, maxLength });
    const submit = () => {
      const text = input.value.trim();
      if (!text) {
        input.focus();
        return;
      }
      // Resolve before close(): close fires onClose, which resolves null.
      resolve(text);
      modal.close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      submit();
    });
    const content = el('div', {},
      el('div.field', {},
        el('label', { for: id }, label),
        input,
        hint && el('p.small.faint', { style: { marginTop: '5px' } }, hint)),
      el('div.row.end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        el('button.btn.btn-primary', { type: 'button', onclick: submit }, confirmLabel))
    );
    const modal = openModal({ title, content, onClose: () => resolve(null) });
    input.select?.();
  });
}
