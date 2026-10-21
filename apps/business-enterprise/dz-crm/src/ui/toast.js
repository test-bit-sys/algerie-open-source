import { el } from './dom.js';
import { icon } from './icons.js';

let root = null;

/**
 * The container is the live region, not the toast.
 *
 * A live region only announces changes made to a region already in the
 * accessibility tree; one that arrives carrying its own message has no
 * change to report, and assistive tech is free to say nothing. Every
 * confirmation in this app is a toast - "Deal updated", "Couldn't save.
 * Check your connection", the Undo behind a delete - so a screen reader
 * user was relying on the announcement most likely to be dropped. The
 * region is put in place as the shell mounts (mountToastRoot below) and
 * each message is added into it afterwards.
 */
function ensureRoot() {
  if (!root) {
    root = el('div.toast-root', { role: 'status', 'aria-live': 'polite' });
    document.body.append(root);
  }
  // Toasts live outside #app, so an open dialog's inert doesn't reach them.
  // modal.js puts the ones already on screen out of reach while a dialog
  // is up, and lets a toast raised after that stay live - see the note
  // there. A toast is never born unreachable.
  return root;
}

/** Put the live region in the document before anything has to be said. */
export function mountToastRoot() {
  ensureRoot();
}

/**
 * The bulk actions bar occupies the same corner of the screen. Most bulk
 * actions clear the selection on the way out, but Export keeps it - so at
 * the window widths where the two offsets collide, the confirmation
 * covered the Delete, Tag, and Clear controls the selection was kept for.
 *
 * Step over the bar, but only when the toast would really land on it: the
 * resting positions clear each other on a wide window, and a toast that
 * floated for no reason would be its own small wrongness. Both boxes are
 * measured, since the bar wraps to two rows as the window narrows.
 */
function clearOfBulkBar(node) {
  node.style.bottom = '';
  const bar = document.querySelector('.bulk-bar');
  if (!bar) return;
  const barBox = bar.getBoundingClientRect();
  const own = node.getBoundingClientRect();
  if (!own.height || own.bottom <= barBox.top || own.top >= barBox.bottom) return;
  const lifted = Math.round(window.innerHeight - barBox.top) + 10;
  // A bar that isn't where it claims to be gets no say; the stylesheet's
  // resting position is the safe answer.
  if (lifted > 0 && lifted < window.innerHeight) node.style.bottom = `${lifted}px`;
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
  let fired = false;

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
        // The toast lingers for its leave animation, so the button is still
        // there to be clicked a second time. Undo is not always idempotent:
        // undoing an import swaps the live data with the one-slot snapshot,
        // so a second call swaps the import straight back in while both
        // toasts say it was undone.
        if (fired) return;
        fired = true;
        dismiss();
        action.onClick();
      },
    }, action.label)
  );

  const arm = (t) => { clearTimeout(timer); timer = setTimeout(dismiss, t); };
  node.addEventListener('pointerenter', () => clearTimeout(timer));
  node.addEventListener('pointerleave', () => { if (!gone) arm(1500); });
  // The keyboard gets the same grace the pointer does: Tab reaching for
  // Undo must not have the button dismissed out from under it.
  node.addEventListener('focusin', () => clearTimeout(timer));
  node.addEventListener('focusout', () => { if (!gone) arm(1500); });

  const host = ensureRoot();
  host.append(node);
  // Measured with the toast in place, since the check is whether these two
  // boxes actually meet.
  clearOfBulkBar(host);
  arm(ms);
  return { dismiss };
}
