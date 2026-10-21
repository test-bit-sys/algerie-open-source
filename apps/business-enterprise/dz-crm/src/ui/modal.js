import { el } from './dom.js';
import { icon } from './icons.js';

/** Every dialog on screen, oldest first - see closeAllModals below. */
const openDialogs = new Set();

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide, variant, head, focusFirst,
 *   guardUnsaved }) → { close(), panel }
 *
 * `variant` stamps a class on the root and panel for a different shape
 * (the command palette drops from the top); `head` replaces the default
 * title bar; `focusFirst: true` focuses the first control at any width,
 * for dialogs that exist to be typed into. `guardUnsaved` asks before
 * throwing away typing - see requestClose below.
 */
export function openModal({
  title, content, onClose, wide = false, variant = null, head = null, focusFirst = 'auto',
  guardUnsaved = false,
}) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => requestClose() }),
    panel
  );

  // Keep keyboard and screen-reader focus inside the dialog, and put it
  // back where it came from on close. The body is never a real opener: a
  // dialog opened in another's close-then-open handoff (palette action,
  // quick add) finds focus already pushed there by the closing dialog's
  // inert, and restoring focus to the body on close would strand the
  // keyboard at the top of the document instead of the #main fallback.
  const active = document.activeElement;
  const opener = active instanceof HTMLElement && active !== document.body ? active : null;
  const appEl = document.getElementById('app');

  if (variant) {
    rootNode.classList.add(variant);
    panel.classList.add(variant);
  }

  panel.append(
    el('div.sheet-handle'),
    head || el('div.modal-head', {},
      el('h2.modal-title', {}, title),
      el('button.icon-btn', { html: icon('x', 20), 'aria-label': 'Close', onclick: () => requestClose() })
    ),
    content
  );

  let closed = false;
  /** This dialog's handle, held in the registry above while it is open. */
  let handle = null;
  function close() {
    if (closed) return;
    closed = true;
    if (handle) openDialogs.delete(handle);
    rootNode.classList.add('closing');
    // A dialog that is on its way out must not take another answer. It
    // stays on screen for the leave animation, and handlers written as
    // "close, then act" - the next-step presets, quick add - are not
    // idempotent: a second click on "In a week" booked a second follow-up.
    // inert stops pointer and keyboard both; focus moves on to the body
    // and the restore below puts it where it belongs.
    panel.setAttribute('inert', '');
    // Hand focusability back to the dialog that is now topmost.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      const stack = document.querySelectorAll('.modal-root:not(.closing)');
      const top = stack[stack.length - 1];
      if (top) {
        // A dialog this one stacked on is still open (confirm over an edit
        // sheet): focus returns to the control that opened this one, not
        // the document body. When the opener lives elsewhere - a palette
        // row that already handed off - the open dialog keeps its focus.
        if (opener?.isConnected && top.contains(opener)) opener.focus();
        return;
      }
      if (document.querySelector('.modal-root')) return;   // a closing sibling restores focus
      document.body.classList.remove('modal-open');
      appEl?.removeAttribute('inert');
      for (const t of document.querySelectorAll('.toast')) t.removeAttribute('inert');
      // The opener is often gone by now - a palette row, a sheet button, a
      // row the store rerendered. Land on the content region rather than
      // dropping the keyboard user at the top of the document.
      if (opener?.isConnected) opener.focus();
      else document.getElementById('main')?.focus({ preventScroll: true });
    }, 200);
  }

  /* ---------- unsaved work ----------
     Every entity form lives in one of these, and a dialog is dismissed by
     the two easiest gestures there are: a click anywhere outside it, and
     Escape. That threw away a half-written deal, or a drafted email, with
     no warning and nothing to undo. Saving still closes straight through,
     because it calls close() directly - only the dismissing gestures ask,
     and only when something was actually typed. */

  // Two of a form's answers aren't held in a field's value. Committed tags
  // live as chips - the tag input clears as each one commits - and a yes/no
  // custom field is a switch, which carries its answer in aria-checked. A
  // form whose only edit was one of those read identical to pristine, so
  // Escape threw it away without asking.
  const STATEFUL = 'input, select, textarea, .tag-chip, [role="switch"]';
  const valueOf = (f) => {
    if (f.classList.contains('tag-chip')) return f.textContent;
    if (f.getAttribute('role') === 'switch') return f.getAttribute('aria-checked');
    if (f.type === 'checkbox' || f.type === 'radio') return String(f.checked);
    return f.value;
  };
  const fieldState = () => [...panel.querySelectorAll(STATEFUL)].map(valueOf).join('\0');

  let pristine = null;
  let asking = false;

  async function requestClose() {
    if (closed || asking) return;
    if (!guardUnsaved || pristine === null || fieldState() === pristine) {
      close();
      return;
    }
    asking = true;
    const discard = await confirmDialog({
      title: 'Discard your changes?',
      message: 'This form has changes that haven’t been saved. Closing it now loses them.',
      confirmLabel: 'Discard',
    });
    asking = false;
    if (discard) close();
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
  /* Toasts are appended to the body, so #app's inert doesn't reach them:
     without this, Tab could land on an Undo floating above the dialog and
     change the data underneath it.

     Only the ones already on screen. A toast raised *after* this opened is
     reporting what the dialog just did, and its action is the point of it:
     merging a duplicate re-renders the review and leaves "Merged into
     Dana Fox · Undo" behind, above a scrim that has no idea what that
     button is for. Inerting that one didn't grey it out - it stays drawn
     on top, at z-index 70 - it just made the click land on the scrim, so
     Undo silently dismissed the review and left the merge standing. */
  for (const t of document.querySelectorAll('.toast')) t.setAttribute('inert', '');
  // Stacked dialogs (confirm over the edit sheet): only the topmost may
  // hold focus - Tab must not reach the covered form.
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  const focusable = panel.querySelector('input, select, textarea, button:not(.icon-btn)');
  if (focusable && (focusFirst === true || matchMedia('(min-width: 640px)').matches)) focusable.focus();
  else panel.focus({ preventScroll: true });

  // What the form looked like before the user touched it, for the guard above.
  if (guardUnsaved) pristine = fieldState();

  handle = { close, requestClose, panel };
  openDialogs.add(handle);
  return handle;
}

/**
 * Close every dialog on screen. The router calls this when the route
 * changes, because a dialog belongs to the page it was opened from and
 * two things move that page out from under it: a link inside the dialog
 * itself (the lead chip on a follow-up in the calendar's day sheet), and
 * Back - the gesture that dismisses a sheet on every phone there is.
 * Either one used to leave a sheet about Thursday floating over somebody's
 * lead page, over a page held inert until the X was found.
 *
 * Not requestClose: the unsaved-work guard is for the gestures that mean
 * "put this away", and it has a Cancel that keeps the form. Here the page
 * behind it has already gone, so there is nothing to keep it for.
 */
export function closeAllModals() {
  for (const dialog of [...openDialogs].reverse()) dialog.close();
}

/**
 * Simple confirm dialog. Resolves true/false (false on Escape/scrim/close
 * too). `cancelLabel: null` drops the second button, for the dialogs that
 * only have news to deliver - a refusal has nothing to cancel.
 */
export function confirmDialog({
  title, message, confirmLabel = 'Delete', danger = true, cancelLabel = 'Cancel',
}) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p.confirm-message', {}, message),
      el('div.row.row-end', {},
        cancelLabel && el('button.btn.btn-ghost', { onclick: () => modal.close() }, cancelLabel),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          // Resolve before close() - close fires onClose, which resolves false.
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}
