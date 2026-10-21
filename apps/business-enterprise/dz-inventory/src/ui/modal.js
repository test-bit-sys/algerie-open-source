import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide, unsaved }) → { close(), panel }
 * `wide` widens the desktop dialog (e.g. the CSV import review table).
 * `unsaved` is asked, on every way a person can dismiss the dialog,
 * whether anything would be thrown away — the scrim is a big target
 * next to a bottom sheet, and a mistap should not cost a filled-in
 * form. The returned close() is the programmatic one and never asks:
 * callers use it once the work is saved.
 */
export function openModal({ title, content, onClose, wide = false, unsaved = null }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => requestClose() }),
    panel
  );

  // Keep keyboard and screen-reader focus inside the dialog, and put it
  // back where it came from on close.
  let opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // A dialog opened from a button inside a *closing* sheet (Duplicate,
  // Move stock, "Restore it instead") outlives that sheet: its button
  // is gone before this dialog closes, so restoring focus there would
  // be a silent no-op and keyboard users would land on <body>. Inherit
  // the closing sheet's own opener — the chain hands focus back to
  // where the first dialog came from. A sheet merely stacked under a
  // confirm isn't closing, and keeps its normal restore.
  const parentRoot = opener?.closest('.modal-root');
  if (parentRoot?.classList.contains('closing') && parentRoot.__opener) opener = parentRoot.__opener;
  rootNode.__opener = opener;
  const appEl = document.getElementById('app');

  panel.append(
    el('div.sheet-handle'),
    el('div.modal-head', {},
      el('h2.modal-title', {}, title),
      el('button.icon-btn', { html: icon('x', 20), 'aria-label': 'Close', onclick: () => requestClose() })
    ),
    content
  );

  let closed = false;
  /* A discard prompt is up; further dismissals wait for its answer. */
  let asking = false;
  function close() {
    if (closed) return;
    closed = true;
    rootNode.classList.add('closing');
    // Hand focusability back to the dialog that is now topmost.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    // Release the page the moment the dialog is dismissed, not after
    // its exit animation. Controls that close-and-navigate (the sheet's
    // History button, the More sheet's links) focus #main right away,
    // and focus() against a still-inert app is silently ignored — the
    // route change went unannounced. And a palette opened during the
    // animation owns the lock and inert now; a deferred cleanup would
    // strip them out from under it.
    if (!stack.length && !document.querySelector('.palette-root')) {
      document.body.classList.remove('modal-open');
      appEl?.removeAttribute('inert');
    }
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      // Focus that moved on — a navigation landed it on #main, a
      // palette owns it — is not this dialog's to take back. Removing
      // the node just dropped any focus it held to <body>.
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (opener?.isConnected) {
        opener.focus();
        return;
      }
      // Saving re-rendered the view wholesale, so the row button that
      // opened this dialog is gone and focusing it is a silent no-op —
      // after every save a keyboard user restarted Tabbing from the top
      // of the document. Hand focus to the dialog now topmost, else to
      // the same main region navigation announces itself through.
      const panels = document.querySelectorAll('.modal-root:not(.closing) .modal-panel');
      const top = panels[panels.length - 1];
      (top || document.getElementById('main'))?.focus({ preventScroll: true });
    }, 200);
  }

  /** Someone asked to dismiss this: check nothing is being thrown away. */
  async function requestClose() {
    if (closed || asking) return;
    if (!unsaved?.()) { close(); return; }
    asking = true;
    const ok = await confirmDiscard();
    asking = false;
    if (ok) close();
    else panel.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // Only the top of a modal stack (e.g. confirm over edit sheet) closes.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] === rootNode) requestClose();
  }

  document.addEventListener('keydown', onKey);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  // Stacked dialogs (confirm over the edit sheet): only the topmost may
  // hold focus — Tab must not reach the covered form.
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  // Where the user is meant to start typing. A dialog can say so with
  // [data-autofocus]; otherwise it's the first visible enabled control,
  // skipping hidden ones (the importer's display:none file input), the
  // read-only ones (a variant's name, which its family writes — a field
  // that can't be typed in is the wrong place to start typing), and the
  // buttons that sit above a form's first field — landing on "Add
  // photo" means the first thing typed goes nowhere and Space opens a
  // file picker.
  const candidates = [...panel.querySelectorAll('input, select, textarea, button:not(.icon-btn)')]
    .filter((n) => !n.disabled && !n.readOnly && n.offsetParent !== null);
  const focusable = panel.querySelector('[data-autofocus]')
    || candidates.find((n) => n.tagName !== 'BUTTON')
    || candidates[0];
  if (focusable && matchMedia('(min-width: 640px)').matches) focusable.focus();
  else panel.focus({ preventScroll: true });

  return { close, panel };
}

/**
 * The question every dismissal asks when a form has been filled in.
 * Exported so a dialog's own controls that leave for somewhere else —
 * the product sheet's History, Duplicate, and Move stock buttons — can
 * ask it in the same words, rather than closing with close(), which is
 * the programmatic exit and never asks.
 */
export function confirmDiscard() {
  return confirmDialog({
    title: 'Discard changes?',
    message: 'What you have entered here isn’t saved yet and will be lost.',
    confirmLabel: 'Discard',
  });
}

/**
 * Simple confirm dialog. Resolves true/false (false on Escape/scrim/close too).
 * `cancelLabel` names the way out in the dialog's own words, for the
 * questions where "Cancel" would be the other answer to what was asked —
 * cancelling an order being the obvious one.
 */
export function confirmDialog({ title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p.confirm-message', {}, message),
      el('div.row.row-end', {},
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, cancelLabel),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          // Resolve before close() — close fires onClose, which resolves false.
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}
