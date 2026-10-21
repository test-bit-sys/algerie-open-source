import { el } from './dom.js';
import { icon } from './icons.js';

let root = null;

function ensureRoot() {
  if (!root) {
    root = el('div.toast-root');
    document.body.append(root);
  }
  return root;
}

/* A dialog owns the keyboard while it is open, and the toast stack is not
   covered by the inert that hides the app behind it: the stack has to sit
   above the dialog, so it lives outside #app. Without this, Tab walked out
   of a dialog onto the Undo button of a toast from an earlier action, and
   focus there even pinned the toast on screen (focus pauses dismissal).
   tabindex rather than inert, so the toast still announces itself and still
   takes a click. */
const dialogOpen = () => !!document.querySelector('.modal-root:not(.closing), .invoice-view');

/** Called by the dialog layers as the last one opens and closes. */
export function setToastsTabbable(on) {
  for (const b of document.querySelectorAll('.toast-action')) b.tabIndex = on ? 0 : -1;
}

/**
 * toast('Saved')
 * toast('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and hovering pauses dismissal
 * so the button can't vanish mid-reach.
 */
export function toast(message, { icon: name = 'check', duration, action = null } = {}) {
  const ms = duration ?? (action ? 6000 : 2400);
  let timer = null;
  let gone = false;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    // Backstop: a backgrounded tab pauses CSS animations, so animationend
    // may never fire and the toast would linger on return. Removing twice
    // is harmless.
    setTimeout(() => node.remove(), 600);
  };

  const node = el('div.toast', { role: 'status', html: icon(name, 16, 2.2) },
    el('span', {}, message),
    action && el('button.toast-action', {
      type: 'button',
      // Raised from inside a dialog (a safeguard prompt, say): born
      // untabbable, and put back in the order when that dialog closes.
      tabindex: dialogOpen() ? -1 : 0,
      onclick: () => {
        dismiss();
        action.onClick();
      },
    }, action.label)
  );

  const arm = (t) => { clearTimeout(timer); timer = setTimeout(dismiss, t); };
  node.addEventListener('pointerenter', () => clearTimeout(timer));
  node.addEventListener('pointerleave', () => { if (!gone) arm(1500); });
  // Keyboard reach deserves the same grace as the pointer: a toast must
  // not vanish while its action button holds focus.
  node.addEventListener('focusin', () => clearTimeout(timer));
  node.addEventListener('focusout', () => { if (!gone) arm(1500); });

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
