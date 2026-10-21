/** Add / edit a time entry: bottom sheet on mobile, dialog on desktop. */

import { el } from './dom.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { field, fieldError, nativeError, projectSelect, switchField, RATE_ERROR } from './fields.js';
import { icon } from './icons.js';
import { invoiceNumber, openInvoiceView } from './invoice.js';
import { store, rateAt } from '../lib/store.js';
import {
  parseDuration, fmtClock, fmtTimer, todayISO, fmtDay, isoOf, addDays,
  fmtTimeRange, timeValueOf, msAt,
} from '../lib/time.js';
import { parseAmount, fmtMoney } from '../lib/util.js';

/* One wording for a bad duration, whether the field was left empty (the
   browser catches that) or holds something unparseable (this file does). */
const DURATION_HINT = 'Enter a duration like 1:30, 90m, or 1.5h';

/**
 * openEntryForm({ date, entry, prefill, onSaved })
 * `entry` set = edit mode; `date` presets the date for new entries.
 * `prefill` presets the fields of a NEW entry from an existing one
 * (duplicate): same work, dated `date`, saved only on submit.
 * Invoiced entries open read-only with a summary and an unlock action.
 */
export function openEntryForm({ date = todayISO(), entry = null, prefill = null, onSaved = null } = {}) {
  if (entry?.invoicedAt) {
    openLockedEntry(entry, onSaved);
    return;
  }
  // Only creating from scratch needs an active project; editing and
  // duplicating must stay possible even when everything is archived (the
  // select keeps the source entry's own project available as
  // "(archived)"), or old entries could never be fixed or reused again.
  if (!entry && !prefill && !store.activeProjects().length) {
    toast('Add a client and a project first', { icon: 'folders' });
    location.hash = '#/projects';
    return;
  }

  const isEdit = !!entry;
  // Field defaults come from the entry being edited or the one being
  // duplicated; the date never comes from `src` (a duplicate lands today).
  const src = entry || prefill;
  const project = projectSelect(store, src?.projectId);
  const task = el('input.input', {
    type: 'text', value: src?.task || '', placeholder: 'e.g. Design review',
    autocomplete: 'off', maxLength: 120, list: 'task-suggestions',
  });
  const taskList = el('datalist', { id: 'task-suggestions' });
  const dateInput = el('input.input', { type: 'date', value: entry?.date || date, required: true });
  const duration = el('input.input', {
    type: 'text', inputmode: 'text', autocomplete: 'off',
    // h:mm:ss when the seconds don't fall on a minute (timer entries):
    // "1:30" would parse back to 1:30:00 and silently shave the rest off.
    value: src ? (src.seconds % 60 ? fmtTimer(src.seconds) : fmtClock(src.seconds)) : '',
    placeholder: 'e.g. 1:30, 90m, or 1.5h',
    required: true,
  });
  const projectErr = fieldError(project);
  const dateErr = fieldError(dateInput);
  const durationErr = fieldError(duration);
  // The browser blocks an empty required field before the submit handler
  // runs, so these are the messages that field actually shows.
  nativeError(project, projectErr, 'Pick a project for this entry');
  nativeError(dateInput, dateErr, 'Pick the date this time was worked');
  nativeError(duration, durationErr, DURATION_HINT);
  /* Optional clock times. Duration stays the source of truth for billing,
     so these only ever derive it (or derive from it): fill in a start and
     an end and the duration follows, change the duration and the end
     moves. An end at or before its start is the small hours of the next
     morning, which is how a night shift is worked. */
  const startTime = el('input.input', {
    type: 'time', value: src?.startedAt ? timeValueOf(src.startedAt) : '',
  });
  const endTime = el('input.input', {
    type: 'time', value: src?.endedAt ? timeValueOf(src.endedAt) : '',
  });

  /** The span the fields describe right now, or nulls. */
  const readTimes = () => {
    const date = dateInput.value || todayISO();
    const startedAt = msAt(date, startTime.value);
    let endedAt = msAt(date, endTime.value);
    if (startedAt && endedAt && endedAt <= startedAt) endedAt = msAt(date, endTime.value, 1);
    return { startedAt, endedAt };
  };

  const setDurationFrom = (startedAt, endedAt) => {
    const secs = Math.round((endedAt - startedAt) / 1000);
    if (secs > 0) duration.value = secs % 60 ? fmtTimer(secs) : fmtClock(secs);
  };

  /* Whichever two of the three are known fill in the third, and the one
     the user just touched is never the one that moves.

     Emptying a time clears its pair instead of deriving it straight back
     from the duration. Times live on an entry as a pair or not at all, so
     clearing both is the only way to take them off again — and deriving
     the emptied field back made the fields labelled "Optional" a one-way
     door: whichever one was cleared reappeared on the spot, and there was
     no order of clearing that ended with both empty. */
  const onTimeEdit = (changed) => {
    durationErr.hide();
    if (!changed.value) {
      (changed === startTime ? endTime : startTime).value = '';
      checkOverlap();
      return;
    }
    const { startedAt, endedAt } = readTimes();
    if (startedAt && endedAt) {
      setDurationFrom(startedAt, endedAt);
    } else {
      const secs = parseDuration(duration.value);
      if (!Number.isFinite(secs) || secs <= 0) {
        checkOverlap();
        return;
      }
      if (startedAt && !endTime.value) endTime.value = timeValueOf(startedAt + secs * 1000);
      else if (endedAt && !startTime.value) startTime.value = timeValueOf(endedAt - secs * 1000);
    }
    checkOverlap();
  };
  const onDurationEdit = () => {
    const secs = parseDuration(duration.value);
    if (!Number.isFinite(secs) || secs <= 0) return;
    const { startedAt, endedAt } = readTimes();
    if (startedAt) endTime.value = timeValueOf(startedAt + secs * 1000);
    else if (endedAt) startTime.value = timeValueOf(endedAt - secs * 1000);
    checkOverlap();
  };
  startTime.addEventListener('change', () => onTimeEdit(startTime));
  endTime.addEventListener('change', () => onTimeEdit(endTime));
  duration.addEventListener('change', onDurationEdit);

  /* A soft warning, never a block: overlapping times are usually a typo
     and occasionally the truth (a call taken during other work), and only
     the person who did the work knows which. */
  const overlapNote = el('p.field-hint.field-warn', { hidden: true, role: 'status' });
  let dayEntries = [];
  const loadDay = async () => {
    const date = dateInput.value || todayISO();
    /* The days either side too, not just this one. An entry whose end
       lands past midnight is stored on the day it started, so a night
       shift covers hours on two calendar days and one day's entries can
       never see it: a 00:30 entry against a 22:00-01:30 shift the evening
       before drew no warning at all. overlappingEntries compares real
       instants, so a neighbouring day that does not reach into this span
       simply never matches. */
    dayEntries = await store
      .entriesBetween(addDays(date, -1), addDays(date, 1))
      .catch(() => []);
    checkOverlap();
  };
  function checkOverlap() {
    const { startedAt, endedAt } = readTimes();
    const clashes = store.overlappingEntries(dayEntries, { startedAt, endedAt, id: entry?.id });
    if (!clashes.length) {
      overlapNote.hidden = true;
      return;
    }
    const first = clashes[0];
    const project = store.project(first.projectId);
    const name = [project?.name || 'another entry', first.task].filter(Boolean).join(' · ');
    overlapNote.hidden = false;
    overlapNote.textContent = clashes.length === 1
      ? `Overlaps ${name}, ${fmtTimeRange(first.startedAt, first.endedAt)}. Saving is fine if that is what happened.`
      : `Overlaps ${clashes.length} entries, starting with ${name}. Saving is fine if that is what happened.`;
  }
  dateInput.addEventListener('change', () => { loadDay().catch(console.error); });
  loadDay().catch(console.error);

  const notes = el('textarea.input.textarea', { rows: 2, maxLength: 500 }, src?.notes || '');
  const billable = switchField('Billable', src ? src.billable : true);
  // Fresh work follows the selected project's default, like the timer
  // and week grid. Editing or duplicating preserves the entry's own
  // billing choice; the switch remains available for explicit overrides.
  if (!src) {
    project.addEventListener('change', () => {
      const selected = store.project(project.value);
      billable.input.checked = selected ? !!selected.billable : true;
    });
  }
  const rate = el('input.input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off',
    value: src?.rate ?? '',
  });
  const rateErr = fieldError(rate);

  // The inherited-rate placeholder follows the selected project AND the
  // entry's date (rates are effective-dated), and names the cascade level
  // the rate actually comes from: a project without a rate of its own
  // bills at the client rate, and claiming "Project rate" would misstate
  // where to go to change it. The amount carries the currency the entry
  // actually bills in, like every other rate in the app: clients can bill
  // in their own, so a bare number says nothing about which.
  const setRatePlaceholder = () => {
    const projectId = project.value || src?.projectId;
    const date = dateInput.value || todayISO();
    const resolved = store.resolveRate({ projectId, rate: null, date });
    const p = store.project(projectId);
    const source = rateAt(p?.rate, date) != null ? 'Project rate'
      : rateAt(store.client(p?.clientId)?.rate, date) != null ? 'Client rate'
        : 'Default rate';
    rate.placeholder = `${source} (${fmtMoney(resolved, store.resolveCurrency({ projectId }))}/h)`;
  };
  project.addEventListener('change', setRatePlaceholder);
  dateInput.addEventListener('change', setRatePlaceholder);
  setRatePlaceholder();

  // Task suggestions for the picked project, refreshed on project change.
  async function refreshSuggestions() {
    const tasks = await store.taskSuggestions(project.value || null).catch(() => []);
    taskList.replaceChildren(...tasks.map((t) => el('option', { value: t })));
  }
  project.addEventListener('change', refreshSuggestions);
  refreshSuggestions();

  const save = el('button.btn.btn-primary.btn-block', { type: 'submit' }, isEdit ? 'Save changes' : 'Log time');

  const form = el('form.form', {
    onsubmit: async (e) => {
      e.preventDefault();
      durationErr.hide();
      rateErr.hide();
      const seconds = parseDuration(duration.value);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        durationErr.show(DURATION_HINT);
        duration.focus();
        return;
      }
      const rateVal = rate.value.trim() === '' ? null : parseAmount(rate.value);
      if (rateVal !== null && !(Number.isFinite(rateVal) && rateVal >= 0)) {
        rateErr.show(RATE_ERROR);
        rate.focus();
        return;
      }
      /* Times are stored as a pair or not at all: with one of them filled
         and a duration to go on, the other is derived rather than left as
         half a fact. */
      let { startedAt, endedAt } = readTimes();
      // The time controls display minutes, while timers retain seconds
      // and milliseconds (and may span more than one day). An unrelated
      // edit must not replace those recorded instants with the controls'
      // less precise representation.
      if (src?.startedAt && src?.endedAt && dateInput.value === src.date
        && seconds === src.seconds
        && startTime.value === timeValueOf(src.startedAt)
        && endTime.value === timeValueOf(src.endedAt)) {
        startedAt = src.startedAt;
        endedAt = src.endedAt;
      }
      if (startedAt && !endedAt) endedAt = startedAt + seconds * 1000;
      else if (endedAt && !startedAt) startedAt = endedAt - seconds * 1000;
      const data = {
        date: dateInput.value,
        projectId: project.value,
        task: task.value,
        notes: notes.value,
        seconds,
        startedAt: startedAt && endedAt ? startedAt : null,
        endedAt: startedAt && endedAt ? endedAt : null,
        billable: billable.input.checked,
        rate: rateVal,
      };
      save.disabled = true;
      try {
        if (isEdit) await store.updateEntry(entry.id, entry.date, data);
        else await store.addEntry(data);
      } catch (err) {
        console.error(err);
        save.disabled = false;
        toast('Could not save, check your connection', { icon: 'wifiOff' });
        return;
      }
      modal.close();
      toast(isEdit ? 'Entry updated' : `Logged ${fmtClock(seconds)}`);
      onSaved?.();
    },
  },
    el('div', {}, field('Project', project), projectErr),
    field('Task', task, { hint: 'Group work inside a project, reports can total by task.' }),
    taskList,
    el('div.form-grid', {},
      el('div', {}, field('Date', dateInput), dateErr),
      el('div', {}, field('Duration', duration), durationErr)
    ),
    el('div.form-grid', {},
      field('Start', startTime),
      field('End', endTime)
    ),
    el('p.field-hint', { style: { marginTop: '-4px' } },
      'Optional. Fill in two of start, end, and duration and the third follows; clearing either time removes both.'),
    overlapNote,
    billable,
    el('div', {}, field('Custom hourly rate', rate, { hint: 'Leave empty to use the project, client, or default rate.' }), rateErr),
    field('Notes', notes),
    save,
    isEdit && el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      style: { marginTop: '6px' },
      html: icon('copy', 15, 2),
      onclick: () => {
        modal.close();
        openEntryForm({ prefill: entry, onSaved });
      },
    }, ' Duplicate'),
    isEdit && el('button.btn.btn-ghost.btn-block.btn-danger-ghost', {
      type: 'button',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Delete entry?',
          message: 'This time entry is removed from your timesheet.',
        });
        if (!ok) return;
        let removed;
        try {
          removed = await store.deleteEntry(entry.id, entry.date);
        } catch (err) {
          console.error(err);
          toast('Could not delete, check your connection', { icon: 'wifiOff' });
          return;
        }
        modal.close();
        toast('Entry deleted', {
          icon: 'trash',
          action: removed && {
            label: 'Undo',
            // Restore the record itself (same id, createdAt, position),
            // like bulk delete does; re-adding through addEntry would
            // mint a new entry that sorts to the top of its day.
            onClick: () => store.restoreEntries([removed]).catch(() => toast('Could not restore, check your connection', { icon: 'wifiOff' })),
          },
        });
        onSaved?.();
      },
    }, 'Delete entry')
  );

  const modal = openModal({
    title: isEdit ? 'Edit entry' : prefill ? 'Duplicate entry' : 'Log time',
    content: form,
  });
}

/** Read-only view of an invoiced entry, with the one door out: un-mark. */
function openLockedEntry(entry, onSaved) {
  const project = store.project(entry.projectId);
  const client = store.client(project?.clientId);
  const currency = store.resolveCurrency(entry);
  // An entry an issued invoice covers only reopens by voiding the
  // invoice: unlocking it here would corrupt the document (line items
  // drift from its frozen totals) and let a second invoice bill the
  // same time again. Hand-marked entries have no document and unlock
  // freely, as they always have.
  const invoice = store.invoiceFor(entry.id);

  const row = (label, value) => el('div.summary-row', {},
    el('span.summary-label', {}, label),
    el('span.summary-value', {}, value)
  );

  const unlock = invoice
    ? el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      style: { marginTop: '10px' },
      onclick: () => {
        modal.close();
        openInvoiceView(invoice);
      },
    }, `View invoice ${invoiceNumber(invoice.number)}`)
    : el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      style: { marginTop: '10px' },
      onclick: async () => {
        unlock.disabled = true;
        try {
          await store.markInvoiced([entry], false);
        } catch (err) {
          console.error(err);
          unlock.disabled = false;
          toast('Could not unlock, check your connection', { icon: 'wifiOff' });
          return;
        }
        modal.close();
        // Straight into the editable form on the thawed entry.
        openEntryForm({ entry: { ...entry, invoicedAt: null, lockedRate: null }, onSaved });
      },
    }, 'Mark as not invoiced');

  const body = el('div', {},
    el('div.locked-note', {},
      el('span.locked-note-ic', { html: icon('checkCheck', 18, 2) }),
      el('div', {},
        el('p.locked-note-title', {}, invoice
          ? `On invoice ${invoiceNumber(invoice.number)}, issued ${fmtDay(invoice.issueDate, { year: true })}`
          : `Invoiced on ${fmtDay(isoOf(new Date(entry.invoicedAt)), { year: true })}`),
        el('p.locked-note-sub', {}, invoice
          ? 'This entry is billed on an issued invoice, so it is locked. Void the invoice to edit or delete it.'
          : 'This entry is part of a billed record, so it is locked. Un-mark it to edit or delete.')
      )
    ),
    el('div.entry-summary', {},
      row('Project', [project?.name || 'No project', entry.task].filter(Boolean).join(' · ')),
      row('Client', client?.name || 'No client'),
      row('Date', fmtDay(entry.date, { year: true })),
      entry.startedAt && entry.endedAt && row('Time', fmtTimeRange(entry.startedAt, entry.endedAt)),
      row('Duration', fmtClock(entry.seconds)),
      entry.billable && row('Rate', `${fmtMoney(store.effectiveRate(entry), currency)}/h (locked)`),
      entry.billable && row('Amount', fmtMoney(store.entryAmount(entry), currency)),
      entry.notes && row('Notes', entry.notes)
    ),
    // Reusing billed work is always allowed: the copy is a fresh,
    // unlocked entry, the billed record itself stays untouched.
    el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      html: icon('copy', 15, 2),
      onclick: () => {
        modal.close();
        openEntryForm({ prefill: entry, onSaved });
      },
    }, ' Duplicate as new entry'),
    unlock
  );

  const modal = openModal({ title: 'Invoiced entry', content: body });
}
