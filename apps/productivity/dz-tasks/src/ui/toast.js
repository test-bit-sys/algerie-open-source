import { el } from '../lib/dom.js';
import { icon } from './icons.js';

let root = null;

function ensureRoot() {
  if (!root) {
    // The live region has to be in the DOM before its content changes —
    // a region inserted together with its text is not reliably announced.
    // So the persistent root carries it, not each toast. aria-atomic=false
    // (role=status implies true) keeps a new toast from re-announcing the
    // ones already on screen.
    root = el('div.toast-root', {
      role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false',
    });
    document.body.append(root);
  }
  return root;
}

/**
 * toast('Saved')
 * toast('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and hovering or focusing it
 * pauses dismissal.
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
  };

  const node = el('div.toast', { html: icon(name, 16, 2.2) },
    el('span', {}, message),
    action && el('button.toast-action', {
      type: 'button',
      onclick: () => {
        dismiss();
        action.onClick();
      },
    }, action.label)
  );

  const arm = (t) => { clearTimeout(timer); timer = setTimeout(dismiss, t); };
  node.addEventListener('pointerenter', () => clearTimeout(timer));
  node.addEventListener('pointerleave', () => { if (!gone) arm(1500); });
  // Keyboard users reach Undo by tabbing: hold the toast while it has focus,
  // or the only undo path vanishes out from under them.
  node.addEventListener('focusin', () => clearTimeout(timer));
  node.addEventListener('focusout', () => { if (!gone) arm(1500); });

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
