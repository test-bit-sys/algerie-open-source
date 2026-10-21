/**
 * "Send cancellation emails?" — asked right after a host deletes an event
 * whose guests were emailed invitations. The deliberate twin of modal.js's
 * "Send invitations?": asked while the deletion is still the thing the host
 * has in mind, and anything other than pressing Send — Escape, the backdrop,
 * "Don't send" — sends nothing.
 *
 * By the time this shows, the event or occurrence has been deleted; everything the
 * mail needs travels in the `cancel` snapshot (invites.cancellationFor, taken
 * before the delete). The one thing checked back against the store is the
 * delete itself: every delete ships an Undo toast, and a host who pressed it
 * before answering has un-made the premise of the question — confirming then
 * sends nothing rather than telling guests a live event is off.
 */
import { el } from './dom.js';
import { isScheduledOccurrence } from './recurrence.js';
import { mountDialog } from './recurrence-dialog.js';
import { toast as defaultToast } from './toast.js';
import { describeCancelResult } from './invites.js';

/**
 * @param {object} opts
 * @param {object} opts.invites  the invites module (sendCancellation)
 * @param {object} opts.store    to notice an Undo that raced the answer
 * @param {object} opts.cancel   an invites.cancellationFor snapshot
 * @param {function} [opts.toast]
 */
export function offerCancellation({ invites, store, cancel, toast = defaultToast, onClose }) {
  if (!invites || !cancel || !(cancel.recipients || []).length) return;
  const count = cancel.recipients.length;
  const who = `${count} guest${count === 1 ? '' : 's'}`;
  const title = (cancel.details && cancel.details.title) || 'this event';

  const dialog = el('form', {
    class: 'modal rr-modal cancel-ask',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'cancel-ask-title',
  }, [
    el('div', { class: 'modal__head' }, [
      el('h2', { class: 'modal__title', id: 'cancel-ask-title', text: cancel.removedGuests ? 'Notify removed guests?' : 'Send cancellation emails?' }),
    ]),
    el('div', { class: 'modal__body' }, [
      el('p', { text: cancel.removedGuests
        ? `${who} will get an email saying their invitation to “${title}” was cancelled${cancel.recurrenceRange ? ` from ${cancel.details.when} onward` : ''}. The event will stay on the other guests’ calendars.`
        : cancel.recurrenceRange
        ? `${who} will get an email saying this and all following occurrences of “${title}” (${cancel.details.when}) were cancelled. Earlier occurrences will stay on their calendars.`
        : cancel.recurrenceId != null
        ? `${who} will get an email saying this occurrence of “${title}” (${cancel.details.when}) was cancelled. The rest of the series will stay on their calendars.`
        : `${who} will get an email saying “${title}” was cancelled.` }),
      ...(!cancel.removedGuests ? [el('p', { text: 'You’ll receive a cancellation email too, if your email address is available.' })] : []),
    ]),
    el('div', { class: 'modal__foot' }, [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: "Don't send", on: { click: () => close() } }),
      el('button', { class: 'btn btn--primary', type: 'submit', text: 'Send' }),
    ]),
  ]);

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    close();
    const current = store && store.getEvent(cancel.eventId);
    const restored = !cancel.removedGuests && current && (cancel.recurrenceId == null ||
      (cancel.recurrenceRange ? isScheduledOccurrence(current, cancel.recurrenceId)
        : !(current.exdates || []).some((rid) => Number(rid) === cancel.recurrenceId)));
    if (restored) {
      toast('The event was restored — no cancellation was sent.');
      return;
    }
    Promise.resolve(invites.sendCancellation(cancel))
      .then((out) => {
        const { message, variant } = describeCancelResult(out);
        toast(message, { variant });
      })
      .catch((err) => toast(err.message || 'Could not send the cancellation.', { variant: 'danger' }));
  });

  const close = mountDialog(dialog, onClose ? () => queueMicrotask(onClose) : undefined);
  requestAnimationFrame(() => dialog.querySelector('.btn--primary').focus());
}
