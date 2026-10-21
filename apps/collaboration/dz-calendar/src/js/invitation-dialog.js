/** Shared invitation offer after an editor save, drag, or resize. */
import { el } from './dom.js';
import { mountDialog } from './recurrence-dialog.js';
import { isBlocked } from './offline.js';

/** A dismissed question never sends mail; a yes waits for the guest links. */
export function offerInvitations({ eventId, invites, store, canSend = () => true, previousEventId = null }) {
  if (!eventId || !invites || !invites.available() || isBlocked() || !canSend()) return;
  const plan = invites.planFor({ id: eventId });
  const count = plan.pending.length + plan.waiting;
  const previousPlan = previousEventId ? invites.planFor({ id: previousEventId }, { previouslyInvitedOnly: true }) : null;
  const previousCount = previousPlan ? previousPlan.pending.length + previousPlan.waiting : 0;
  if (!count && !previousCount) return;
  openInviteDialog({
    count,
    split: Boolean(previousEventId),
    updating: plan.waiting === 0 && plan.pending.every((r) => r.sentAt),
    onConfirm: () => {
      // An Undo or deletion while the question was open invalidates this offer.
      if (!canSend() || !store.getEvent(eventId)) return;
      if (previousEventId) {
        // Existing invitees need the shortened original UID as well as the
        // new series. Never introduce uninvited guests to the historical half.
        invites.sendWhenReady({ id: previousEventId }, { canSend, previouslyInvitedOnly: true });
        invites.sendWhenReady({ id: eventId }, { canSend });
      } else {
        invites.sendWhenReady({ id: eventId });
      }
    },
  });
}

function openInviteDialog({ count, updating, split, onConfirm }) {
  const who = `${count} guest${count === 1 ? '' : 's'}`;
  const dialog = el('form', {
    class: 'modal rr-modal invite-ask',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'invite-ask-title',
  }, [
    el('div', { class: 'modal__head' }, [
      el('h2', {
        class: 'modal__title',
        id: 'invite-ask-title',
        text: updating || split ? 'Send updated invitations?' : 'Send invitations?',
      }),
    ]),
    el('div', { class: 'modal__body' }, [
      el('p', {
        text: split
          ? 'Previously invited guests will get an update ending the original series before this occurrence. Guests on the future events will get a separate invitation with the new schedule and RSVP links.'
          : updating
          ? `${who} will get an email saying this event changed.`
          : `${who} will get an email with the details and their own Yes / No / Maybe link.`,
      }),
    ]),
    el('div', { class: 'modal__foot' }, [
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn',
        type: 'button',
        text: "Don't send",
        on: { click: () => close() },
      }),
      el('button', { class: 'btn btn--primary', type: 'submit', text: 'Send' }),
    ]),
  ]);

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    close();
    onConfirm();
  });

  const close = mountDialog(dialog);
  requestAnimationFrame(() => dialog.querySelector('.btn--primary').focus());
}
