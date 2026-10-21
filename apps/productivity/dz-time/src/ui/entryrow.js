/** One time entry in a list: identity, duration, money, edit on tap. */

import { el } from './dom.js';
import { icon } from './icons.js';
import { colorDot } from './fields.js';
import { openEntryForm } from './entryform.js';
import { store } from '../lib/store.js';
import { fmtClock, fmtTimeRange } from '../lib/time.js';
import { fmtMoney } from '../lib/util.js';

/**
 * entryRow(entry, { onResume, select })
 * - onResume(entry) shows a play button that restarts the timer on the
 *   same project/task (used on the Timer view).
 * - select = { checked, disabled, onToggle } renders a leading checkbox
 *   and the row toggles selection instead of opening the edit sheet
 *   (used by the timesheet search's bulk-edit mode).
 */
export function entryRow(entry, { onResume = null, select = null } = {}) {
  const project = store.project(entry.projectId);
  const client = store.client(project?.clientId);
  const amount = store.entryAmount(entry);

  const title = [project?.name || 'No project', entry.task].filter(Boolean).join(' · ');
  // When the entry knows its clock times, they belong in the row: a day
  // nobody can reconstruct is unauditable even to the person who worked it.
  const times = fmtTimeRange(entry.startedAt, entry.endedAt);
  const what = `${title}, ${fmtClock(entry.seconds)}${times ? `, ${times}` : ''}`;
  // Bulk edit cannot touch an invoiced entry, so its row says so instead
  // of offering a selection it will not make.
  const locked = !!(select && select.disabled);

  const checkbox = select && el('input.entry-check', {
    type: 'checkbox',
    checked: !!select.checked,
    disabled: !!select.disabled,
    'aria-label': locked ? `Invoiced, cannot select: ${what}` : `Select entry: ${what}`,
    onchange: () => select.onToggle(checkbox.checked),
  });

  return el('div.entry-row', {},
    checkbox,
    el('button.entry-main', {
      type: 'button',
      'aria-label': !select ? `Edit entry: ${what}`
        : locked ? `Invoiced and locked: ${what}` : `Toggle selection: ${what}`,
      onclick: () => {
        // A locked row opens read-only, which explains the lock and links
        // to the invoice, rather than swallowing the tap.
        if (!select || locked) {
          openEntryForm({ entry });
        } else {
          checkbox.checked = !checkbox.checked;
          select.onToggle(checkbox.checked);
        }
      },
    },
      colorDot(client?.slot),
      el('div.entry-text', {},
        el('div.entry-title', {},
          project?.name || 'No project',
          entry.task && el('span.entry-task', {}, ` · ${entry.task}`)
        ),
        el('div.entry-sub', {},
          client?.name || 'No client',
          times && el('span.entry-times', {}, ` · ${times}`),
          entry.notes && ` · ${entry.notes}`,
          !entry.billable && el('span.chip.chip-plain', {}, 'Non-billable'),
          entry.invoicedAt && el('span.chip.chip-plain.chip-invoiced', {}, 'Invoiced')
        )
      ),
      el('div.entry-nums', {},
        el('div.entry-duration', {}, fmtClock(entry.seconds)),
        entry.billable && amount > 0 && el('div.entry-amount', {}, fmtMoney(amount, store.resolveCurrency(entry)))
      )
    ),
    onResume && el('button.icon-btn.entry-resume', {
      html: icon('play', 17, 2),
      'aria-label': `Start timer for ${title}`,
      title: 'Start timer for this work',
      onclick: () => onResume(entry),
    })
  );
}
