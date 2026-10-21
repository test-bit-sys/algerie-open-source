/**
 * The full-screen printable overlay, shared by the invoice and the
 * timesheet that backs it.
 *
 * It is a dialog in every way that matters even though it is not a
 * .modal-root: the app behind it goes inert (no tabbing into a screen the
 * user cannot see), the background stops scrolling, Escape closes it,
 * a route change closes it (a back gesture on a phone belongs to the view
 * that opened it), and focus returns to whatever opened it. Print CSS
 * keyed to .invoice-view then shows the sheet and nothing else, so a new
 * printable layout is a layout rather than a mechanism.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { setToastsTabbable } from './toast.js';

/**
 * openPrintOverlay({ label, actions }) -> { body, close, root }
 *
 * `actions` is called with `close` and returns the toolbar controls to the
 * right of Back; `body` is where the caller puts (and may replace) its
 * sheet.
 */
export function openPrintOverlay({ label, actions = () => [], onClose = null }) {
  const appEl = document.getElementById('app');
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const body = el('div');
  const overlays = () => [...document.querySelectorAll('.invoice-view')];

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onRoute);
    onClose?.();
    /* One printable page can open another (a timesheet from an invoice).
       The one underneath comes back into play: focusable again, and
       printable again, since print shows the topmost page only. */
    const rest = overlays();
    const top = rest[rest.length - 1];
    if (top) {
      top.classList.remove('covered');
      if (!document.querySelector('.modal-root:not(.closing)')) top.removeAttribute('inert');
    } else {
      document.body.classList.remove('invoice-open');
    }
    // A dialog stacked on top keeps the app inert on its own account.
    if (!rest.length && !document.querySelector('.modal-root')) {
      appEl?.removeAttribute('inert');
      setToastsTabbable(true);
    }
    if (opener?.isConnected) opener.focus();
  };

  const openedOn = location.hash;
  const onRoute = () => { if (location.hash !== openedOn) close(); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    // A dialog stacked on top (a confirm, a sheet, another printable
    // page) owns Escape; without this check one keypress would tear down
    // both layers at once.
    if (document.querySelector('.modal-root:not(.closing)')) return;
    if (root.classList.contains('covered')) return;
    close();
  };

  const root = el('div.invoice-view', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
    tabindex: -1,
  },
    el('div.invoice-toolbar', {},
      el('button.btn.btn-ghost.btn-slim', { html: icon('chevL', 15, 2), onclick: close }, ' Back'),
      el('span.grow'),
      actions(close)
    ),
    body
  );

  // Anything already open is now underneath: out of the tab order and out
  // of the printout until it is on top again.
  for (const layer of overlays()) {
    layer.setAttribute('inert', '');
    layer.classList.add('covered');
  }
  document.body.append(root);
  document.body.classList.add('invoice-open');
  appEl?.setAttribute('inert', '');
  setToastsTabbable(false);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onRoute);
  // Focus the page itself: screen readers announce the dialog, and Tab
  // starts at the toolbar instead of somewhere behind the overlay.
  root.focus({ preventScroll: true });

  return { root, body, close };
}

/** A toolbar toggle ("Amounts", "Notes"): pressed state carried in words. */
export function toolbarToggle(label, on, onChange) {
  const btn = el('button.btn.btn-ghost.btn-slim', {
    type: 'button',
    'aria-pressed': on ? 'true' : 'false',
    className: `btn btn-ghost btn-slim${on ? ' active-toggle' : ''}`,
    onclick: () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      btn.classList.toggle('active-toggle', next);
      onChange(next);
    },
  }, label);
  return btn;
}
