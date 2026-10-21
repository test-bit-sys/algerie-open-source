/**
 * Edit the running timer in place: project, task, billable, start time.
 * Fixes the classic "started the timer wrong or late" without making the
 * user discard elapsed time or stop-and-edit.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, fieldError, nativeError, projectSelect, switchField } from './fields.js';
import { store } from '../lib/store.js';

const pad2 = (n) => String(n).padStart(2, '0');

export function openTimerEdit() {
  const t = store.timer;
  if (!t) return;

  const started = new Date(t.startedAt);
  const project = projectSelect(store, t.projectId, { allowEmpty: false });
  const task = el('input.input', {
    type: 'text', value: t.task, placeholder: 'e.g. Design review',
    autocomplete: 'off', maxLength: 120,
  });
  const startInput = el('input.input', {
    type: 'time',
    value: `${pad2(started.getHours())}:${pad2(started.getMinutes())}`,
    required: true,
  });
  const startErr = fieldError(startInput);
  // An empty or half-typed time never reaches the handler below: the
  // browser stops the submit first, so it needs its own wording here.
  nativeError(startInput, startErr, 'Enter the time the timer started');
  const billable = switchField('Billable', t.billable);
  const save = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Save changes');

  const form = el('form.form', {
    onsubmit: async (e) => {
      e.preventDefault();
      startErr.hide();
      const [hh, mm] = startInput.value.split(':').map(Number);
      // Unchanged time keeps the exact original start (seconds included);
      // a moved time starts clean on the minute.
      let startedAt = t.startedAt;
      if (hh !== started.getHours() || mm !== started.getMinutes()) {
        startedAt = new Date(started.getFullYear(), started.getMonth(), started.getDate(), hh, mm, 0).getTime();
      }
      if (startedAt > Date.now()) {
        startErr.show('The start time cannot be in the future');
        startInput.focus();
        return;
      }
      save.disabled = true;
      try {
        await store.retagTimer({
          projectId: project.value,
          task: task.value,
          billable: billable.input.checked,
          startedAt,
        });
      } catch (err) {
        console.error(err);
        save.disabled = false;
        toast('Could not save, check your connection', { icon: 'wifiOff' });
        return;
      }
      modal.close();
      toast('Timer updated');
    },
  },
    field('Project', project),
    field('Task', task),
    el('div', {},
      field('Started at', startInput, { hint: 'Moves within the day the timer started; the entry lands on that day.' }),
      startErr
    ),
    billable,
    save
  );

  const modal = openModal({ title: 'Edit timer', content: form });
}
