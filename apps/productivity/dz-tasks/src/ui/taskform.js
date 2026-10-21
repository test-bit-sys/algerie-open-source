import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store, PRIORITIES } from '../lib/store.js';
import { todayISO, addDays, nextWeekday, relativeDue } from '../lib/dates.js';
import { FREQS, WEEKDAY_LABELS } from '../lib/recur.js';
import { REMINDER_OFFSETS, describeReminder } from '../lib/reminders.js';
import { uid } from '../lib/util.js';

/**
 * Add/edit sheet. openTaskForm({ task })   → edit
 *                 openTaskForm({ listId, due }) → new, prefilled
 *                 openTaskForm({ prefill })  → new, from a parsed draft
 */
export function openTaskForm({ task = null, listId = null, due = null, prefill = null } = {}) {
  const editing = !!task;
  const base = task || prefill || {};
  const draft = {
    title: base.title || '',
    notes: base.notes || '',
    listId: base.listId || listId || store.settings.defaultListId || store.lists[0]?.id,
    due: base.due || due,
    dueTime: base.dueTime || null,
    reminder: base.reminder ?? null,
    priority: base.priority ?? 0,
    tags: (base.tags || []).slice(),
    repeat: base.repeat ? { ...base.repeat, weekdays: base.repeat.weekdays?.slice() } : null,
    subtasks: (base.subtasks || []).map((s) => ({ ...s })),
  };

  // The rejection notice sits with the field, not in a toast: it belongs to
  // one input and has to stay put while it is corrected.
  const titleError = el('p.field-error', { id: 'tf-title-error', hidden: true, html: icon('alert', 14, 2.4) },
    el('span', {}, 'A task needs a title'));

  const titleInput = el('input.input', {
    value: draft.title,
    placeholder: 'What needs doing?',
    maxlength: 300,
    'aria-label': 'Task title',
    'aria-describedby': 'tf-title-error',
    oninput: (e) => {
      draft.title = e.target.value;
      if (e.target.value.trim()) clearTitleError();
    },
    // isComposing: an IME's confirm-candidate Enter must not submit the form
    // with the pre-composition text.
    onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } },
  });

  function showTitleError() {
    titleInput.setAttribute('aria-invalid', 'true');
    titleError.hidden = false;
  }

  function clearTitleError() {
    titleInput.removeAttribute('aria-invalid');
    titleError.hidden = true;
  }

  /* --- due date --- */
  const dateInput = el('input.input', {
    type: 'date', value: draft.due || '', 'aria-label': 'Due date',
    onchange: (e) => {
      draft.due = e.target.value || null;
      // Same rule as the "No date" chip (and the store): a time without a
      // date is meaningless, so clearing the date takes the time with it.
      if (!draft.due && draft.dueTime) {
        draft.dueTime = null;
        timeInput.value = '';
      }
      renderQuick();
      renderReminder();
    },
  });
  const timeInput = el('input.input', {
    type: 'time', value: draft.dueTime || '', 'aria-label': 'Due time',
    onchange: (e) => {
      draft.dueTime = e.target.value || null;
      // A time with no date would be silently dropped on save; quick-add's
      // rule applies here too — a time means "that time today" until a
      // date says otherwise.
      if (draft.dueTime && !draft.due) {
        draft.due = todayISO();
        dateInput.value = draft.due;
        renderQuick();
      }
      renderReminder();
    },
  });
  const quickRow = el('div.row', { style: { flexWrap: 'wrap', gap: '6px', marginTop: '8px' } });
  function renderQuick() {
    const today = todayISO();
    const options = [
      ['Today', today],
      ['Tomorrow', addDays(today, 1)],
      // "Next week" means what it means everywhere else in the app (row
      // menu, quick-add parsing): the start of next week, not 7 days out.
      ['Next week', nextWeekday(today, store.settings.startMonday !== false ? 1 : 0)],
      ['No date', null],
    ].filter(([, v], i, all) =>
      // On a Sunday, "Tomorrow" and "Next week" are the same day; one chip.
      all.findIndex(([, x]) => x === v) === i);
    clear(quickRow);
    quickRow.append(...options.map(([label, value]) =>
      el('button.chip' + (draft.due === value ? '.on' : ''), {
        type: 'button',
        'aria-pressed': String(draft.due === value),
        onclick: () => {
          draft.due = value;
          dateInput.value = value || '';
          if (!value) { draft.dueTime = null; timeInput.value = ''; }
          renderQuick();
          renderReminder();
        },
      }, label)));
  }
  renderQuick();

  /* --- reminder --- */
  const reminderWrap = el('div');
  function reminderHint() {
    if (!draft.due) return 'Set a due date to add a reminder.';
    if (draft.reminder === null) return '';
    return draft.dueTime ? 'Fires while Tasks is open; missed ones are summarized on your next visit.'
      : 'Reminds at 9:00 (all-day). Fires while Tasks is open; missed ones are summarized on your next visit.';
  }
  function renderReminder() {
    if (!draft.due) draft.reminder = null;
    clear(reminderWrap);
    const hint = el('p.small.muted', { style: { margin: '6px 2px 0' } }, reminderHint());
    const select = el('select.select', {
      id: 'tf-reminder', disabled: !draft.due,
      onchange: (e) => {
        draft.reminder = e.target.value === '' ? null : Number(e.target.value);
        hint.textContent = reminderHint();
      },
    },
      el('option', { value: '', selected: draft.reminder === null }, 'No reminder'),
      REMINDER_OFFSETS.map((o) =>
        el('option', { value: String(o.value), selected: draft.reminder === o.value }, o.label)),
      // A non-preset offset (import, another client) must show what is
      // actually set — otherwise the browser falls back to displaying
      // "No reminder" while the reminder silently stays armed.
      draft.reminder !== null && !REMINDER_OFFSETS.some((o) => o.value === draft.reminder)
        ? el('option', { value: String(draft.reminder), selected: true }, describeReminder(draft.reminder))
        : null
    );
    reminderWrap.append(el('div.select-wrap', {}, select), hint);
  }
  renderReminder();

  /* --- priority --- */
  const prioritySeg = el('div.segment', { role: 'group', 'aria-label': 'Priority' });
  function renderPriority() {
    clear(prioritySeg);
    prioritySeg.append(...[...PRIORITIES].reverse().map((p) =>
      el('button', {
        type: 'button',
        'aria-pressed': String(draft.priority === p.value),
        onclick: () => { draft.priority = p.value; renderPriority(); },
        html: p.value ? icon('flag', 13, 2.4) : '',
        style: draft.priority === p.value && p.value ? { color: `var(--${p.class})` } : null,
      }, ` ${p.label}`)));
  }
  renderPriority();

  /* --- tags --- */
  const tagsWrap = el('div');
  const slugTag = (s) => String(s || '').trim().replace(/^#+/, '').toLowerCase()
    .replace(/\s+/g, '-').slice(0, 24);

  function renderTagEditor() {
    clear(tagsWrap);
    const suggestions = el('div.tag-suggestions');
    const input = el('input.tag-input', {
      id: 'tf-tags',
      placeholder: draft.tags.length ? 'Add another' : 'errands, waiting-on…',
      'aria-label': 'Add a tag',
      maxlength: 25,
      oninput: () => renderSuggestions(input.value),
      onkeydown: (e) => {
        if (e.isComposing) return; // mid-IME: not a tag delimiter yet
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          if (input.value.trim()) commit(input.value);
        } else if (e.key === 'Backspace' && !input.value && draft.tags.length) {
          draft.tags.pop();
          renderTagEditor();
          tagsWrap.querySelector('input')?.focus();
        }
      },
      onblur: (e) => {
        // Focus moving into the suggestions (Tab) must not commit the
        // half-typed prefix — choosing the suggestion is the commit.
        if (suggestions.contains(e.relatedTarget)) return;
        if (input.value.trim()) commit(input.value, { keepFocus: false });
      },
    });

    function commit(text, { keepFocus = true } = {}) {
      const tag = slugTag(text);
      // Empty the input before re-rendering: detaching a focused element
      // fires its blur, whose handler would commit the leftover prefix as
      // a second tag ("err" alongside the chosen "errands").
      input.value = '';
      if (tag && !draft.tags.includes(tag) && draft.tags.length < 5) draft.tags.push(tag);
      renderTagEditor();
      if (keepFocus) tagsWrap.querySelector('input')?.focus();
    }

    function renderSuggestions(q) {
      clear(suggestions);
      const needle = slugTag(q);
      if (!needle) return;
      const known = store.allTags()
        .filter(({ tag }) => tag.startsWith(needle) && !draft.tags.includes(tag))
        .slice(0, 6);
      suggestions.append(...known.map(({ tag }) =>
        el('button.chip', {
          type: 'button',
          // Keep the input focused through the press: its blur would
          // commit the half-typed prefix and rebuild this row, destroying
          // the button before the click could land — the autocomplete was
          // effectively display-only.
          onpointerdown: (e) => e.preventDefault(),
          onclick: () => commit(tag),
        }, `#${tag}`)));
    }

    tagsWrap.append(
      el('div.tag-box', { onclick: (e) => { if (e.target === e.currentTarget) input.focus(); } },
        draft.tags.map((tag, i) => el('span.chip.on', {},
          `#${tag}`,
          el('button.chip-x', {
            type: 'button', html: icon('x', 11, 3), 'aria-label': `Remove tag ${tag}`,
            onclick: () => { draft.tags.splice(i, 1); renderTagEditor(); },
          })
        )),
        draft.tags.length < 5 ? input : null
      ),
      suggestions
    );
  }
  renderTagEditor();

  /* --- repeat --- */
  const repeatBody = el('div');
  const repeatSelect = el('select.select', {
    id: 'tf-repeat',
    onchange: (e) => {
      const v = e.target.value;
      draft.repeat = v === 'never' ? null
        : { freq: v, interval: draft.repeat?.interval || 1, mode: draft.repeat?.mode || 'due', weekdays: draft.repeat?.weekdays };
      if (v !== 'weekly' && draft.repeat) delete draft.repeat.weekdays;
      renderRepeat();
    },
  },
    el('option', { value: 'never', selected: !draft.repeat }, 'Never'),
    FREQS.map((f) => el('option', { value: f.value, selected: draft.repeat?.freq === f.value },
      `Every ${f.label}`))
  );

  function renderRepeat() {
    clear(repeatBody);
    if (!draft.repeat) return;
    const r = draft.repeat;
    const unitText = () => `${FREQS.find((f) => f.value === r.freq).label}${r.interval > 1 ? 's' : ''}`;
    const unit = el('span.muted.small', {}, unitText());
    repeatBody.append(
      el('div.field-grid', { style: { marginTop: '10px' } },
        el('div.field', {},
          el('label', { for: 'rep-int' }, 'Every'),
          el('div.row', {},
            el('input.input', {
              id: 'rep-int', type: 'number', min: 1, max: 365, value: r.interval,
              style: { width: '76px' },
              onchange: (e) => {
                // Whole numbers only (the store floors them anyway), shown
                // back in the field; the unit follows ("1 week" → "2 weeks")
                // instead of keeping the singular it was rendered with.
                r.interval = Math.max(1, Math.floor(Number(e.target.value)) || 1);
                e.target.value = r.interval;
                unit.textContent = unitText();
              },
            }),
            unit
          )
        ),
        el('div.field', {},
          el('label', { for: 'rep-mode' }, 'Repeat from'),
          el('div.select-wrap', {},
            el('select.select', {
              id: 'rep-mode',
              onchange: (e) => { r.mode = e.target.value; },
            },
              el('option', { value: 'due', selected: r.mode !== 'done' }, 'Due date'),
              el('option', { value: 'done', selected: r.mode === 'done' }, 'Completion day')
            )
          )
        )
      ),
      r.freq === 'weekly' && el('div.field', {},
        el('span.field-label', {}, 'On days'),
        el('div.weekdays', { role: 'group', 'aria-label': 'Repeat on weekdays' },
          // Display order follows the week-start setting (the calendar
          // already does); the underlying day numbers stay real weekdays.
          (store.settings.startMonday !== false ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6])
            .map((d) =>
              el('button', {
                type: 'button',
                'aria-pressed': String(!!r.weekdays?.includes(d)),
                onclick: (e) => {
                  const set = new Set(r.weekdays || []);
                  set.has(d) ? set.delete(d) : set.add(d);
                  r.weekdays = [...set].sort((a, b) => a - b);
                  if (!r.weekdays.length) delete r.weekdays;
                  e.target.setAttribute('aria-pressed', String(set.has(d)));
                },
              }, WEEKDAY_LABELS[d].slice(0, 2))))
      )
    );
  }
  renderRepeat();

  /* --- subtasks --- */
  const subtaskWrap = el('div');
  function renderSubtasks() {
    clear(subtaskWrap);
    subtaskWrap.append(
      ...draft.subtasks.map((s, i) => el('div.inline-add', { style: { marginBottom: '6px' } },
        el('button.task-check', {
          type: 'button', role: 'checkbox', 'aria-checked': String(!!s.done),
          'aria-label': `Mark subtask ${s.title || i + 1} done`,
          html: icon('check', 12, 3.5),
          onclick: (e) => {
            s.done = !s.done;
            e.currentTarget.setAttribute('aria-checked', String(s.done));
          },
        }),
        el('input.input.grow', {
          value: s.title, placeholder: 'Subtask', maxlength: 300,
          'aria-label': `Subtask ${i + 1}`,
          oninput: (e) => { s.title = e.target.value; },
          onkeydown: (e) => {
            if (e.key === 'Enter' && !e.isComposing && i === draft.subtasks.length - 1) {
              e.preventDefault();
              addSubtask();
            }
          },
        }),
        el('button.icon-btn', {
          type: 'button', html: icon('x', 16), 'aria-label': 'Remove subtask',
          onclick: () => { draft.subtasks.splice(i, 1); renderSubtasks(); },
        })
      )),
      el('button.btn.btn-ghost', { type: 'button', html: icon('plus', 15, 2.4), onclick: addSubtask },
        ' Add subtask')
    );
  }
  function addSubtask() {
    draft.subtasks.push({ id: uid(), title: '', done: false });
    renderSubtasks();
    const inputs = subtaskWrap.querySelectorAll('input');
    inputs[inputs.length - 1]?.focus();
  }
  renderSubtasks();

  /* --- assemble --- */
  const saveBtn = el('button.btn.btn-primary', { onclick: save }, editing ? 'Save changes' : 'Add task');

  // Enter in the title input calls save() directly, so disabling the
  // button alone doesn't stop key auto-repeat from filing the task twice.
  let saving = false;
  async function save() {
    if (saving) return;
    if (!titleInput.value.trim()) {
      showTitleError();
      titleInput.focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    const data = {
      ...draft,
      title: titleInput.value,
      subtasks: draft.subtasks.filter((s) => s.title.trim()),
    };
    try {
      if (editing) await store.updateTask(task.id, data);
      else await store.addTask(data);
    } catch (err) {
      console.error(err);
      // A full cloud still keeps (and queues) the change, so the form is
      // done: leaving it open to be submitted again would file the task
      // twice. Every other failure means nothing was saved.
      if (!err?.quota) {
        saving = false;
        saveBtn.disabled = false;
        toast('Could not save. Check your connection', { icon: 'wifiOff' });
        return;
      }
      modal.close();
      toast(err.message, { icon: 'cloud', duration: 5000 });
      return;
    }
    modal.close();
    if (!editing) toast('Task added');
  }

  const footer = el('div.row', { style: { marginTop: '18px', justifyContent: 'space-between' } },
    editing ? el('div.row', {},
      el('button.icon-btn', {
        html: icon('trash', 18), 'aria-label': 'Delete task',
        style: { color: 'var(--danger)' },
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Delete task?',
            message: `"${task.title}" will be removed${task.repeat ? ', including its repeat rule' : ''}.`,
          });
          if (!ok) return;
          const copy = { ...task };
          await store.deleteTask(task.id);
          modal.close();
          toast('Task deleted', {
            icon: 'trash',
            action: { label: 'Undo', onClick: () => store.restoreTask(copy) },
          });
        },
      }),
      task?.repeat && task?.due && !task.done && el('button.btn.btn-ghost', {
        html: icon('skip', 15, 2.2),
        onclick: async () => {
          const next = await store.skipOccurrence(task.id);
          modal.close();
          if (next) toast(`Skipped. Next: ${relativeDue(next)}`, { icon: 'repeat' });
        },
      }, ' Skip')
    ) : el('span'),
    el('div.row', {},
      el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Cancel'),
      saveBtn
    )
  );

  const body = el('div', {},
    el('div.field', {}, titleInput, titleError),
    el('div.field', {},
      el('label', { for: 'tf-notes' }, 'Notes'),
      el('textarea.textarea', {
        id: 'tf-notes', maxlength: 4000, placeholder: 'Details, links, phone numbers…',
        value: draft.notes,
        oninput: (e) => { draft.notes = e.target.value; },
      })
    ),
    el('div.field', {},
      el('label', { for: 'tf-list' }, 'List'),
      el('div.select-wrap', {},
        el('select.select', {
          id: 'tf-list',
          // Moving a task out of a collaborative list would leave the other
          // members' copies behind; the task stays where everyone shares it.
          disabled: editing && !!store.listById(task.listId)?.collab,
          title: editing && store.listById(task.listId)?.collab ? 'Tasks in a shared list stay there' : null,
          onchange: (e) => { draft.listId = e.target.value; },
        },
          store.lists.length
            ? store.lists.map((l) => el('option', { value: l.id, selected: l.id === draft.listId }, l.name))
            // No lists yet (fresh wipe): the store creates this on save.
            : el('option', { value: '' }, 'Personal (created for you)'))
      )
    ),
    el('div.field-grid', {},
      el('div.field', {},
        el('label', { for: 'tf-date' }, 'Due date'),
        dateInput
      ),
      el('div.field', {},
        el('label', { for: 'tf-time' }, 'Time'),
        timeInput
      )
    ),
    quickRow,
    el('div.field', { style: { marginTop: '16px' } },
      el('label', { for: 'tf-reminder' }, 'Remind me'),
      reminderWrap
    ),
    el('div.field', {},
      el('span.field-label', {}, 'Priority'),
      prioritySeg
    ),
    el('div.field', {},
      el('label', { for: 'tf-tags' }, 'Tags'),
      tagsWrap
    ),
    el('div.field', {},
      el('label', { for: 'tf-repeat' }, 'Repeat'),
      el('div.select-wrap', {}, repeatSelect),
      repeatBody
    ),
    el('div.field', {},
      el('span.field-label', {}, 'Subtasks'),
      subtaskWrap
    ),
    footer
  );
  dateInput.id = 'tf-date';
  timeInput.id = 'tf-time';

  const modal = openModal({ title: editing ? 'Edit task' : 'New task', content: body });
  return modal;
}
