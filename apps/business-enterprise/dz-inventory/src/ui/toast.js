import { el } from './dom.js';
import { icon } from './icons.js';

let root = null;

function ensureRoot() {
  if (!root) {
    root = el('div.toast-root', { 'aria-live': 'polite' });
    document.body.append(root);
  }
  return root;
}

/* The live region has to be registered before anything lands in it:
   a region inserted together with its first message is routinely not
   announced at all. Created at load, it sits empty until needed —
   additions to it are what screen readers read out. */
if (typeof document !== 'undefined') ensureRoot();

/**
 * toast('Saved')
 * toast('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and hovering pauses dismissal
 * so the button can't vanish mid-reach.
 *
 * `onExpire` fires when the toast goes away without the action being
 * used — the moment an undoable step becomes final.
 */
export function toast(message, { icon: name = 'check', duration, action = null, onExpire = null } = {}) {
  const ms = duration ?? (action ? 6000 : 2400);
  let timer = null;
  let gone = false;
  let undone = false;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    if (!undone) onExpire?.();
  };

  // No role/live attributes here: the root is the live region, and a
  // toast added to it is announced as an addition. A second region on
  // the toast itself — populated before insertion — would be the very
  // pattern screen readers skip.
  const node = el('div.toast', { html: icon(name, 16, 2.2) },
    el('span', {}, message),
    action && el('button.toast-action', {
      type: 'button',
      onclick: () => {
        // The button remains in the DOM during the exit animation.
        // A second click must not repeat a stock-restoring action.
        if (gone) return;
        undone = true;
        dismiss();
        action.onClick();
      },
    }, action.label)
  );

  /* The timer never removes a toast that holds focus: a keyboard user
     who reached the Undo button must not have it vanish mid-press —
     losing both the button and their focus to <body>. It re-checks
     until focus moves on; the action's own click still dismisses. */
  const expire = () => {
    if (node.contains(document.activeElement)) { arm(1500); return; }
    dismiss();
  };
  const arm = (t) => { clearTimeout(timer); timer = setTimeout(expire, t); };
  node.addEventListener('pointerenter', () => clearTimeout(timer));
  node.addEventListener('pointerleave', () => { if (!gone) arm(1500); });
  /* Focus pauses dismissal the same way hovering does. */
  node.addEventListener('focusin', () => clearTimeout(timer));
  node.addEventListener('focusout', (e) => {
    if (!gone && !node.contains(e.relatedTarget)) arm(1500);
  });

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
