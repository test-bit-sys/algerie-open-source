import { el } from './dom.js';
import { icon } from './icons.js';

let root = null;

/**
 * One live region for the whole app, put in place before anything can post
 * to it, so screen readers announce changes to a region that already exists.
 */
function ensureRoot() {
  if (!root) {
    root = el('div.toast-root', {
      role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false',
    });
    document.body.append(root);
  }
  return root;
}

if (document.body) ensureRoot();
else document.addEventListener('DOMContentLoaded', ensureRoot, { once: true });

/**
 * toast('Saved')
 * toast('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and hovering or focusing pauses
 * dismissal so the button can't vanish mid-reach.
 */
export function toast(message, { icon: name = 'check', duration, action = null } = {}) {
  const ms = duration ?? (action ? 6000 : 2600);
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
  const hold = () => clearTimeout(timer);
  const release = () => { if (!gone) arm(1500); };
  node.addEventListener('pointerenter', hold);
  node.addEventListener('pointerleave', release);
  node.addEventListener('focusin', hold);
  node.addEventListener('focusout', release);

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
