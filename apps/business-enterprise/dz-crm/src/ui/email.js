/**
 * The "Email…" flow on lead and deal pages, and the template editor
 * Settings uses.
 *
 * Pick a template (or start blank), preview it with the merge fields
 * filled from the record and edit freely, hand the draft to the user's
 * own mail client via mailto:, then offer to log it as an email activity
 * - which feeds last-contacted and going-cold without manual bookkeeping.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import {
  MERGE_FIELDS, fillTemplate, templateContext, buildMailto,
} from '../lib/templates.js';
import { maybeNudgeNextStep } from './nudge.js';
import { wireForm } from './forms.js';
import { requiredMark } from './bits.js';
import { draftEmailButton } from './ai.js';
import { todayISO } from '../lib/util.js';

/* ---------- template editor (Settings) ---------- */

export function openTemplateForm(template = null, { onSaved = null } = {}) {
  const name = el('input.input', {
    type: 'text', value: template?.name || '', required: true, maxlength: 80,
    id: 'tpl-name', placeholder: 'e.g. Proposal follow-up', autocomplete: 'off',
  });
  const subject = el('input.input', {
    type: 'text', value: template?.subject || '', maxlength: 200,
    id: 'tpl-subject', placeholder: 'e.g. Next steps for {{company}}', autocomplete: 'off',
  });
  const body = el('textarea.input.textarea', {
    rows: 8, value: template?.body || '', id: 'tpl-body',
    placeholder: 'Hi {{firstName}},\n\n…',
  });

  /* Merge-field chips insert at the caret of whichever text field was
     last in use, so building a template never means typing braces. */
  let target = body;
  for (const field of [subject, body]) {
    field.addEventListener('focus', () => { target = field; });
  }
  const chips = el('div.chip-row.tpl-chips', {}, MERGE_FIELDS.map((f) =>
    el('button.filter-chip', {
      type: 'button',
      title: `Insert ${f.token}`,
      onclick: () => {
        const at = target.selectionStart ?? target.value.length;
        target.setRangeText(f.token, at, target.selectionEnd ?? at, 'end');
        target.focus();
      },
    }, f.label)));

  const form = el('form.form', {},
    el('div.field', {},
      el('label.field-label', { for: 'tpl-name' }, 'Template name', requiredMark()), name),
    el('div.field', {}, el('label.field-label', { for: 'tpl-subject' }, 'Subject'), subject),
    el('div.field', {},
      el('label.field-label', { for: 'tpl-body' }, 'Body'),
      body,
      el('p.field-hint', {}, 'Click to insert a merge field. It fills from the lead or deal when you use the template:'),
      chips
    ),
    el('div.form-actions', {},
      el('div.grow'),
      el('button.btn.btn-primary', { type: 'submit' }, template ? 'Save changes' : 'Add template')
    )
  );

  const modal = openModal({ title: template ? 'Edit template' : 'New email template', content: form, guardUnsaved: true });

  // The same wiring every other form in the app uses, for the same reason:
  // it disables the submit button before awaiting the save, so a second
  // click (or Enter) while the write is in flight can't file a second copy.
  wireForm(form, async () => {
    const data = { name: name.value.trim(), subject: subject.value.trim(), body: body.value };
    const saved = template
      ? await store.updateTemplate(template.id, data)
      : await store.addTemplate(data);
    modal.close();
    toast(template ? 'Template updated' : 'Template added');
    onSaved?.(saved);
  });
  return modal;
}

/* ---------- send flow ---------- */

/** Log the sent email without a form - the subject is the summary. */
async function logEmail({ subject, contact, deal }) {
  try {
    await store.addActivity({
      type: 'email',
      date: todayISO(),
      summary: subject.trim() || `Email to ${contact.name}`,
      contactId: contact.id,
      dealId: deal?.id || null,
      companyId: contact.companyId || deal?.companyId || null,
    });
  } catch {
    toast('Couldn’t log it. Check your connection', { icon: 'wifiOff' });
    return;
  }
  const nudged = maybeNudgeNextStep({
    contactId: contact.id, dealId: deal?.id || null, lead: 'Email logged',
  });
  if (!nudged) toast('Email logged', { icon: 'mail' });
}

/** Compose: filled subject/body, editable, then off to the mail client. */
function openCompose({ template, contact, deal }) {
  const company = store.companyById(contact.companyId || deal?.companyId);
  const ctx = templateContext({ contact, company, deal, currency: store.settings.currency });
  const subject = el('input.input', {
    type: 'text', id: 'compose-subject', maxlength: 300,
    value: fillTemplate(template?.subject || '', ctx),
  });
  const body = el('textarea.input.textarea', {
    rows: 10, id: 'compose-body',
    value: fillTemplate(template?.body || '', ctx),
  });

  const form = el('form.form', {},
    el('div.compose-to', {},
      el('span.field-label', {}, 'To'),
      el('span.compose-addr', {}, contact.email)
    ),
    el('div.field', {}, el('label.field-label', { for: 'compose-subject' }, 'Subject'), subject),
    el('div.field', {},
      el('label.field-label', { for: 'compose-body' }, 'Body'),
      body,
      // A first pass from what the record says, into this same field - the
      // founder edits it and still sends from their own mail client.
      draftEmailButton({ contact, deal, subject, body })
    ),
    el('div.form-actions', {},
      // Through the unsaved-work guard, like Escape and the scrim: Cancel
      // is a dismissing gesture, not a decision to discard the draft.
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.requestClose() }, 'Cancel'),
      el('div.grow'),
      el('button.btn.btn-primary', { type: 'submit', html: icon('mail', 15, 2) }, ' Open in mail app')
    )
  );

  const modal = openModal({ title: `Email ${contact.name}`, content: form, wide: true, guardUnsaved: true });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const subjectText = subject.value;
    location.href = buildMailto(contact.email, subjectText, body.value);
    modal.close();
    // The draft is in their mail client now; one click books the record.
    toast('Draft opened in your mail app', {
      icon: 'mail',
      duration: 10000,
      action: {
        label: 'Log it',
        onClick: () => logEmail({ subject: subjectText, contact, deal }),
      },
    });
  });
  return modal;
}

/**
 * Entry point from lead and deal pages. `deal` gives the merge fields a
 * deal to speak about; from a lead page the newest open deal rides along.
 *
 * `template` skips the picker: a follow-up created by a playbook step
 * already knows which email it stands for, and asking again would be
 * asking a question that has been answered.
 */
export function openEmailFlow({ contact, deal = null, template = undefined }) {
  if (!contact?.email) return null;
  if (template !== undefined) return openCompose({ template, contact, deal });

  const templates = [...store.templates].sort((a, b) => a.name.localeCompare(b.name));
  const pick = (template) => {
    modal.close();
    setTimeout(() => openCompose({ template, contact, deal }), 120);
  };

  const modal = openModal({
    title: `Email ${contact.name}`,
    content: el('div', {},
      templates.length
        ? el('div.settings-list', {}, templates.map((t) => el('button.settings-row', {
            type: 'button',
            onclick: () => pick(t),
          },
            el('span.row-ic', { html: icon('mail', 20, 1.8) }),
            el('div.grow.min0', {},
              el('div.title', {}, t.name),
              t.subject && el('div.sub', {}, fillTemplate(t.subject, templateContext({
                contact,
                company: store.companyById(contact.companyId || deal?.companyId),
                deal,
                currency: store.settings.currency,
              })))
            ),
            el('span.row-chev', { html: icon('chevR', 18) })
          )))
        : el('p.settings-note.sheet-note', {},
            'No templates yet. The ones you create in Settings appear here with their merge fields filled from this record.'),
      el('div.settings-body', {},
        el('button.btn.btn-ghost.btn-sm.btn-dashed', {
          type: 'button',
          html: icon('pencil', 14, 2),
          onclick: () => pick(null),
        }, ' Blank email')
      )
    ),
  });
  return modal;
}
