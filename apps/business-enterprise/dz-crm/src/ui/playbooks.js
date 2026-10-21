/**
 * Playbooks in the UI: the editor Settings uses, the "Apply playbook…"
 * flow on a lead or deal, and the offer a stage arrival makes.
 *
 * Applying always shows the dates it is about to create before it commits,
 * and always lands as one Undo - five follow-ups appearing out of one
 * click is only comfortable if one click takes them back.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { wireForm } from './forms.js';
import { requiredMark } from './bits.js';
import { formatDate, todayISO } from '../lib/util.js';
import {
  MAX_PLAYBOOKS, MAX_PLAYBOOK_STEPS, MAX_STEP_OFFSET, MAX_PLAYBOOK_NAME, MAX_STEP_TITLE,
  blankPlaybook, playbookSummary, playbookTasks, playbookForStage,
} from '../lib/playbooks.js';
import { openStages } from '../lib/forecast.js';

/* ---------- editor (Settings) ---------- */

const templateOptions = () => [
  { value: '', label: 'No email' },
  ...[...store.templates].sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.name })),
];

function select(options, value, props = {}) {
  const node = el('select.select', props,
    options.map((o) => el('option', { value: o.value, selected: o.value === value }, o.label)));
  return { wrap: el('div.select-wrap', {}, node), node };
}

export function openPlaybookForm(playbook = null, { onSaved = null } = {}) {
  const source = playbook || blankPlaybook();
  const name = el('input.input', {
    type: 'text', value: source.name, required: true, maxlength: MAX_PLAYBOOK_NAME,
    id: 'pb-name', autocomplete: 'off', placeholder: 'e.g. Proposal chase',
  });

  const stages = openStages(store.stages());
  const trigger = select([
    { value: '', label: 'Only when I ask' },
    ...stages.map((s) => ({ value: s.id, label: `When a deal enters ${s.label}` })),
  ], source.trigger, { id: 'pb-trigger' });

  const stepsWrap = el('div.playbook-steps');
  const rows = [];
  const addBtn = el('button.btn.btn-ghost.btn-sm.btn-dashed', {
    type: 'button',
    html: icon('plus', 14, 2.2),
    onclick: () => addRow({}, { focus: true }),
  }, ' Add step');

  function syncRows() {
    addBtn.disabled = rows.length >= MAX_PLAYBOOK_STEPS;
    addBtn.title = addBtn.disabled ? `A playbook holds at most ${MAX_PLAYBOOK_STEPS} steps` : null;
    for (const row of rows) row.remove.disabled = rows.length <= 1;
    renderPreview();
  }

  function addRow(step = {}, { focus = false } = {}) {
    const title = el('input.input.playbook-title', {
      type: 'text', value: step.title || '', maxlength: MAX_STEP_TITLE,
      autocomplete: 'off', placeholder: 'e.g. Send the recap email',
      'aria-label': 'Step',
    });
    const offset = el('input.input.prob-input.playbook-offset', {
      type: 'number', min: '0', max: String(MAX_STEP_OFFSET), step: '1', inputmode: 'numeric',
      value: String(step.offset ?? 0),
      'aria-label': 'Days after the playbook is applied',
    });
    const template = select(templateOptions(), step.templateId || '',
      { 'aria-label': 'Email template for this step' });
    const remove = el('button.icon-btn', {
      type: 'button',
      html: icon('x', 16, 2.2),
      'aria-label': 'Remove this step',
      onclick: () => {
        rows.splice(rows.indexOf(row), 1);
        node.remove();
        syncRows();
      },
    });
    const row = { title, offset, template, remove };
    const node = el('div.playbook-step', {},
      title,
      el('div.playbook-step-meta', {},
        el('span.stage-prob-field', {}, offset, el('span.prob-unit', { 'aria-hidden': 'true' }, 'days')),
        template.wrap,
        remove
      )
    );
    for (const input of [title, offset]) input.addEventListener('input', renderPreview);
    rows.push(row);
    stepsWrap.append(node);
    syncRows();
    if (focus) title.focus();
  }

  const preview = el('div.playbook-preview');
  const read = () => ({
    id: source.id,
    name: name.value.trim(),
    trigger: trigger.node.value,
    steps: rows.map((r) => ({
      title: r.title.value.trim(),
      offset: Number(r.offset.value) || 0,
      templateId: r.template.node.value,
    })),
  });

  function renderPreview() {
    clear(preview);
    const tasks = playbookTasks(read());
    if (!tasks.length) {
      preview.append(el('p.field-hint', {}, 'Give each step a title to see the dates it would create.'));
      return;
    }
    preview.append(
      el('p.field-hint', {}, 'Applied today, this would book:'),
      el('ul.playbook-dates', {}, tasks.map((t) =>
        el('li', {}, el('span.grow.min0', {}, t.title), el('span.playbook-date', {}, formatDate(t.due)))))
    );
  }

  for (const step of source.steps.length ? source.steps : [{ title: '', offset: 0 }]) addRow(step);

  const form = el('form.form', {},
    el('div.field', {},
      el('label.field-label', { for: 'pb-name' }, 'Playbook name', requiredMark()), name),
    el('div.field', {},
      el('label.field-label', {}, 'Steps'),
      stepsWrap,
      addBtn,
      el('p.field-hint', {}, 'Days are counted from the day you apply the playbook. 0 means the same day.')
    ),
    el('div.field', {},
      el('label.field-label', { for: 'pb-trigger' }, 'Offer it automatically'),
      trigger.wrap,
      el('p.field-hint', {}, 'A deal arriving in that stage offers this playbook - it always asks first, and only when nothing else is booked.')
    ),
    preview,
    el('div.form-actions', {},
      playbook && el('button.btn.btn-ghost.btn-danger-ghost', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Delete “${playbook.name}”?`,
            message: 'Follow-ups it already created stay exactly as they are.',
          });
          if (!ok) return;
          try {
            await store.setPlaybooks(store.playbooks().filter((p) => p.id !== playbook.id));
          } catch {
            toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
            return;
          }
          modal.close();
          toast('Playbook deleted', { icon: 'trash' });
          onSaved?.(null);
        },
      }, 'Delete'),
      el('div.grow'),
      el('button.btn.btn-primary', { type: 'submit' }, playbook ? 'Save changes' : 'Add playbook')
    )
  );

  const modal = openModal({
    title: playbook ? 'Edit playbook' : 'New playbook',
    content: form,
    guardUnsaved: true,
  });

  wireForm(form, async () => {
    const next = read();
    const list = store.playbooks();
    const at = list.findIndex((p) => p.id === next.id);
    if (at >= 0) list[at] = next;
    else list.push(next);
    const saved = await store.setPlaybooks(list.slice(0, MAX_PLAYBOOKS));
    modal.close();
    toast(playbook ? 'Playbook updated' : 'Playbook added');
    onSaved?.(saved.find((p) => p.id === next.id) || null);
  });
  return modal;
}

/* ---------- applying ---------- */

/** Who the follow-ups will hang off, in words. */
function targetName({ contactId, dealId }) {
  return store.dealById(dealId)?.name || store.contactById(contactId)?.name || '';
}

/**
 * The preview, and the commit. Shows every follow-up it would create with
 * its date, so nothing appears that wasn't agreed to first.
 */
export function openPlaybookPreview(playbook, { contactId = null, dealId = null, title = null } = {}) {
  const tasks = playbookTasks(playbook, todayISO());
  const who = targetName({ contactId, dealId });

  const apply = async () => {
    modal.close();
    let created;
    try {
      created = await store.applyPlaybook(playbook, { contactId, dealId });
    } catch {
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      return;
    }
    const n = created.length;
    toast(`${n} follow-up${n === 1 ? '' : 's'} added`, {
      icon: 'followups',
      action: {
        label: 'Undo',
        onClick: () => store.undoAddedTasks(created.map((t) => t.id))
          .catch(() => toast('Couldn’t undo. Check your connection', { icon: 'wifiOff' })),
      },
    });
  };

  const modal = openModal({
    title: title || `Apply “${playbook.name}”`,
    content: el('div', {},
      el('p.settings-note.sheet-note', {}, tasks.length
        ? `${tasks.length} follow-up${tasks.length === 1 ? '' : 's'}${who ? ` on ${who}` : ''}, dated from today:`
        : 'This playbook has no steps yet. Add some in Settings.'),
      tasks.length > 0 && el('div.settings-body', {},
        el('ul.playbook-dates', {}, tasks.map((t) => el('li', {},
          el('span.grow.min0', {}, t.title),
          el('span.playbook-date', {}, formatDate(t.due))
        )))
      ),
      el('div.form-actions', {},
        el('div.grow'),
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Not now'),
        tasks.length > 0 && el('button.btn.btn-primary', { type: 'button', onclick: apply },
          `Add ${tasks.length} follow-up${tasks.length === 1 ? '' : 's'}`)
      )
    ),
  });
  return modal;
}

/** Pick a playbook to apply to this record, then preview it. */
export function openPlaybookPicker({ contactId = null, dealId = null } = {}) {
  const books = store.playbooks();
  const who = targetName({ contactId, dealId });

  const modal = openModal({
    title: 'Apply playbook',
    content: el('div', {},
      books.length
        ? el('div', {},
            el('p.settings-note.sheet-note', {},
              who ? `The cadence you run, booked against ${who}.` : 'The cadence you run, booked from today.'),
            el('div.settings-list', {}, books.map((book) => el('button.settings-row', {
              type: 'button',
              onclick: () => {
                modal.close();
                setTimeout(() => openPlaybookPreview(book, { contactId, dealId }), 120);
              },
            },
              el('span.row-ic', { html: icon('listChecks', 20, 1.8) }),
              el('div.grow.min0', {},
                el('div.title', {}, book.name),
                el('div.sub', {}, playbookSummary(book))
              ),
              el('span.row-chev', { html: icon('chevR', 18) })
            )))
          )
        : el('p.settings-note.sheet-note', {},
            'No playbooks yet. Save the follow-up cadence you run in Settings, and it appears here.')
    ),
  });
  return modal;
}

/**
 * A deal has arrived in a stage. If a playbook is waiting on that stage,
 * offer it - always asking, never applying on its own, and only when the
 * deal has nothing else booked, so working a deal back and forth doesn't
 * turn into a queue of dialogs. Returns whether anything was offered, so
 * the caller can skip its own next-step nudge.
 */
export function maybeOfferPlaybook(deal, stage) {
  if (!deal) return false;
  const book = playbookForStage(store.settings, stage);
  if (!book || !book.steps.length) return false;
  if (store.hasOpenTask(deal.id)) return false;
  openPlaybookPreview(book, {
    dealId: deal.id,
    contactId: deal.contactId,
    title: `Apply “${book.name}”?`,
  });
  return true;
}

/** The button a lead or deal page shows when there is a playbook to apply. */
export function playbookButton({ contactId = null, dealId = null } = {}) {
  if (!store.playbooks().length) return null;
  return el('button.btn.btn-ghost.btn-sm', {
    type: 'button',
    html: icon('listChecks', 14, 2),
    'aria-haspopup': 'dialog',
    onclick: () => openPlaybookPicker({ contactId, dealId }),
  }, ' Playbook');
}

export { MAX_PLAYBOOKS };
