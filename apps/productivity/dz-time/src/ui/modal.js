import { el } from './dom.js';
import { icon } from './icons.js';
import { setToastsTabbable } from './toast.js';

/* Every layer a dialog can stack on top of, in document (and stacking)
   order: other dialogs and the full-screen invoice page, which is modal
   too even though it is not a .modal-root. Only the topmost layer may
   hold focus. */
const LAYERS = '.modal-root:not(.closing), .invoice-view';
const layers = () => [...document.querySelectorAll(LAYERS)];

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose }) returns { close, panel }.
 */
export function openModal({ title, content, onClose }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => close() }),
    panel
  );

  // Keep keyboard and screen-reader focus inside the dialog, and put it
  // back where it came from on close.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    rootNode.classList.add('closing');
    // Hand focusability back to the layer that is now topmost: a stacked
    // dialog, or the invoice page underneath it. The .closing class above
    // already drops this dialog out of that list.
    const stack = layers();
    stack[stack.length - 1]?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onRoute);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      if (!document.querySelector('.modal-root')) {
        document.body.classList.remove('modal-open');
        // The invoice page keeps the app inert on its own account.
        if (!document.querySelector('.invoice-view')) {
          appEl?.removeAttribute('inert');
          setToastsTabbable(true);
        }
      }
      if (opener?.isConnected) opener.focus();
    }, 200);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // Only the top of a modal stack (e.g. confirm over edit sheet) closes.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] === rootNode) close();
  }

  /* A back gesture is how a sheet gets dismissed on a phone, and the route
     lives in the hash: back used to change the view underneath and leave
     the sheet sitting over a screen it did not come from, with the app
     behind it inert. A dialog belongs to the view that opened it, so it
     goes when that view does. It compares against the route it opened on
     rather than closing on any event, so a dialog opened right after a
     jump (Settings wipes the sample data, lands on the timer and reopens
     the wizard) survives the event that jump is still queueing. */
  const openedOn = location.hash;
  const onRoute = () => { if (location.hash !== openedOn) close(); };

  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onRoute);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  setToastsTabbable(false);
  // Stacked layers (confirm over the edit sheet, or over the invoice
  // page): only the topmost may hold focus, Tab must not reach what is
  // covered. Run before appending, so this dialog is not in the list.
  for (const layer of layers()) layer.setAttribute('inert', '');
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
      el('p.confirm-message', {}, message),
      el('div.row.row-end', {},
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Cancel'),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          // Resolve before close(): close fires onClose, which resolves false.
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}
