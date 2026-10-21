/**
 * The one question worth asking when a deal closes: why?
 *
 * Opened right after a won/lost transition (and from the deal page later),
 * it is skippable in one click - a prompt that blocks the flow is a prompt
 * that gets answered with garbage.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { reasonsForStage } from '../lib/forecast.js';

/**
 * openCloseReasonForm(deal, { onClose, confirm })
 * `onClose` runs once the sheet is gone, saved or skipped - the caller uses
 * it to fire its own follow-up (the Undo toast) without racing the dialog.
 * `confirm: false` is for the caller that already reports the outcome
 * itself: moving a deal to Won or Lost raises "Deal won · Undo" the moment
 * this sheet closes, and two toasts about one action is one too many.
 */
export function openCloseReasonForm(deal, { onClose = null, confirm = true } = {}) {
  const won = deal.stage === 'won';
  const options = reasonsForStage(deal.stage);
  // A reason recorded earlier (or a custom one from an import) stays
  // selectable even when it is not in the starter list.
  const existing = String(deal.closeReason || '').trim();
  const all = existing && !options.includes(existing) ? [existing, ...options] : options;
  let picked = existing;

  const chips = el('div.reason-chips', { role: 'group', 'aria-label': 'Reason' },
    all.map((r) => el('button.filter-chip', {
      type: 'button',
      'aria-pressed': String(picked === r),
      // Tapping the selected chip clears it - no dead-end selection.
      onclick: () => { picked = picked === r ? '' : r; syncChips(); },
    }, r)));

  /* Move the selection across the chips rather than rebuilding them: a
     rebuild throws away the chip the keyboard is on, and focus lands on
     the dialog's body instead of the choice just made. */
  function syncChips() {
    all.forEach((r, i) => {
      const chip = chips.children[i];
      chip.classList.toggle('active', picked === r);
      chip.setAttribute('aria-pressed', String(picked === r));
    });
  }
  syncChips();

  const note = el('textarea.input.textarea', {
    rows: 3, maxlength: 500, value: deal.closeReasonNote || '',
    id: 'close-reason-note',
    placeholder: won ? 'What tipped it over the line?' : 'What would have changed the outcome?',
  });

  const form = el('form.form', {},
    el('p.settings-note', {}, won
      ? 'What made this one land? A few seconds now is a pattern in three months.'
      : 'What happened? Lost deals are the cheapest lessons you will ever buy.'),
    chips,
    el('div.field', {},
      el('label.field-label', { for: 'close-reason-note' }, 'Detail (optional)'),
      note
    ),
    el('div.form-actions', {},
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Skip'),
      el('div.grow'),
      el('button.btn.btn-primary', { type: 'submit' }, 'Save reason')
    )
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await store.updateDeal(deal.id, {
        closeReason: picked,
        closeReasonNote: note.value.trim(),
      });
    } catch {
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      btn.disabled = false;
      return;
    }
    modal.close();
    // Opened from the deal page, this sheet used to just vanish: every
    // other save in the app says it landed, and the chip it writes is
    // often below the fold on a phone.
    if (confirm) {
      const kept = picked || note.value.trim();
      toast(kept ? 'Reason saved' : 'Reason cleared');
    }
  });

  const modal = openModal({
    title: won ? 'Why did this one land?' : 'Why was it lost?',
    content: form,
    onClose,
  });
  return modal;
}

/** The recorded reason as a chip, or null when nothing was captured. */
export function closeReasonChip(deal) {
  if (!deal.closeReason) return null;
  return el('span.chip.static', {},
    el('span', { html: icon(deal.stage === 'won' ? 'trophy' : 'circleX', 13, 2) }),
    deal.closeReason
  );
}
