/**
 * Entity forms, each opened in a modal. Every form works for create and
 * edit (pass the existing record), accepts presets (e.g. a deal form opened
 * from a company page arrives with that company selected), and reports the
 * saved record to an optional onSaved callback so detail views can refresh.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { deletedToast, requiredMark } from './bits.js';
import { maybeNudgeNextStep } from './nudge.js';
import { tagInput } from './tag-input.js';
import { customFieldInputs } from './custom-fields.js';
import { pasteToFillButton, fillSummary } from './ai.js';
import { downloadTaskICS } from './calendar.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store, CONTACT_STATUSES, LEAD_SOURCES, ACTIVITY_TYPES, repeatLabel } from '../lib/store.js';
import { isOpen, CONFIDENCE_LEVELS } from '../lib/forecast.js';
import {
  BILLING_MODES, DEFAULT_TERM, MAX_TERM, normalizeBilling, rateText, contractText,
} from '../lib/recurring.js';
import {
  DEAL_ROLES, MAX_DEAL_CONTACTS, dealContactIds, roleOf, roleLabel,
} from '../lib/deal-contacts.js';
import { contactByEmail } from '../lib/dupes.js';
import { openCloseReasonForm } from './close-reason.js';
import { todayISO, clamp } from '../lib/util.js';

/* ---------- field helpers ---------- */

let fieldSeq = 0;
const fid = () => `f-${++fieldSeq}`;

function field(label, input, { hint = null, grow = false } = {}) {
  const id = fid();
  // `input` may be a wrapper (e.g. .select-wrap around a <select>); the
  // label must point at the actual control or it has no accessible name.
  const control = input.matches('input, select, textarea')
    ? input
    : input.querySelector('input, select, textarea') || input;
  control.id = id;
  return el(`div.field${grow ? '.grow' : ''}`, {},
    el('label.field-label', { for: id }, label, control.required && requiredMark()),
    input,
    hint && el('p.field-hint', {}, hint)
  );
}

function textInput(props = {}) {
  return el('input.input', { type: 'text', ...props });
}

/**
 * A select. An entry carrying `options` becomes an <optgroup>, so a picker
 * can lead with the choices that belong to the record it was opened from.
 */
function makeSelect(options, value, props = {}) {
  const select = el('select.select', props, optionNodes(options, value));
  return { wrap: el('div.select-wrap', {}, select), select };
}

/** The <option>/<optgroup> nodes for a select, new or refilled in place. */
function optionNodes(options, value) {
  const option = (o) => el('option', { value: o.value, selected: o.value === value }, o.label);
  return options.map((o) => (o.options
    ? el('optgroup', { label: o.label }, o.options.map(option))
    : option(o)));
}

/**
 * Options plus the record's current value when the starter list doesn't
 * have it - a CSV import can carry any text in these fields. Without it
 * the select silently falls back to its first option, and saving the form
 * untouched wipes the stored value.
 */
function withCurrent(options, current) {
  if (!current || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: current }];
}

function textArea(props = {}) {
  return el('textarea.input.textarea', { rows: 3, ...props });
}

function submitRow(label, { onDelete = null } = {}) {
  return el('div.form-actions', {},
    onDelete && el('button.btn.btn-ghost.btn-danger-ghost', { type: 'button', onclick: onDelete }, 'Delete'),
    el('div.grow'),
    el('button.btn.btn-primary', { type: 'submit' }, label)
  );
}

/** Delete button handler for edit forms: confirm, delete, close, undo toast. */
function deleteAction({ title, message, run, done, closeModal }) {
  return async () => {
    const ok = await confirmDialog({ title, message });
    if (!ok) return;
    let entry;
    try {
      entry = await run();
    } catch {
      toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
      return;
    }
    closeModal();
    deletedToast(done, entry);
  };
}

/** Wire a form: native validation, double-submit guard, one save path. */
export function wireForm(form, save) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await save();
    } catch (err) {
      console.error(err);
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      btn.disabled = false;
    }
  });
}

const companyOptions = () => [
  { value: '', label: 'No company' },
  ...[...store.companies].sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name })),
  { value: '__new', label: 'New company…' },
];

const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Every contact, or - when a deal is in play - that deal's people first
 * under their own heading. Logging a call from a deal page almost always
 * means one of the two or three people on it, and hunting for them in a
 * list of two hundred is how activities end up linked to nobody.
 */
const contactOptions = (dealId = null) => {
  const all = byName(store.contacts).map((c) => ({ value: c.id, label: c.name }));
  const deal = dealId ? store.dealById(dealId) : null;
  const ids = deal ? dealContactIds(deal) : [];
  if (ids.length < 1) return [{ value: '', label: 'No contact' }, ...all];
  const onDeal = new Set(ids);
  return [
    { value: '', label: 'No contact' },
    {
      label: `On ${deal.name}`,
      options: ids.map((id) => ({
        value: id,
        label: [store.contactById(id)?.name, roleLabel(roleOf(deal, id))].filter(Boolean).join(' · '),
      })).filter((o) => o.label),
    },
    { label: 'Everyone else', options: all.filter((o) => !onDeal.has(o.value)) },
  ];
};

const dealOptions = () => [
  { value: '', label: 'No deal' },
  ...[...store.deals].sort((a, b) => b.updatedAt - a.updatedAt)
    .map((d) => ({ value: d.id, label: d.name })),
];

/**
 * A company select that can mint a company on the spot: choosing
 * "New company…" stacks the company form, and the fresh id comes back
 * selected. Falls back to the previous value if that form is dismissed.
 */
function companySelect(value) {
  const { wrap, select } = makeSelect(companyOptions(), value || '', { 'aria-label': 'Company' });
  let prev = value || '';
  select.addEventListener('change', () => {
    if (select.value !== '__new') { prev = select.value; return; }
    select.value = prev;
    openCompanyForm(null, {
      onSaved: (company) => {
        select.replaceChildren(...companyOptions().map((o) =>
          el('option', { value: o.value, selected: o.value === company.id }, o.label)));
        prev = company.id;
      },
    });
  });
  return { wrap, select };
}

/* ---------- company ---------- */

export function openCompanyForm(company = null, { onSaved = null } = {}) {
  const name = textInput({ value: company?.name || '', required: true, autocomplete: 'off', maxlength: 120 });
  const industry = textInput({ value: company?.industry || '', autocomplete: 'off', maxlength: 80 });
  const website = textInput({ value: company?.website || '', inputmode: 'url', autocomplete: 'off', maxlength: 200, placeholder: 'example.com' });
  const size = makeSelect(withCurrent([
    { value: '', label: 'Unknown' },
    { value: '1-10', label: '1-10 people' },
    { value: '10-50', label: '10-50 people' },
    { value: '50-200', label: '50-200 people' },
    { value: '200-500', label: '200-500 people' },
    { value: '500+', label: '500+ people' },
  ], company?.size), company?.size || '');
  const tags = tagInput(company?.tags);
  const notes = textArea({ value: company?.notes || '' });
  // Whatever this business also tracks per account, defined in Settings.
  const custom = customFieldInputs('companies', company);

  /* Paste an About page or a footer and have the fields read out of it -
     into empty fields only, for review, saving nothing on its own. */
  const paste = pasteToFillButton({
    kind: 'companies',
    fields: { name, industry, website },
    onFilled: (result) => toast(fillSummary(result), { icon: 'sparkle' }),
  });

  const form = el('form.form', { novalidate: false },
    paste,
    field('Name', name),
    el('div.form-grid', {},
      field('Industry', industry),
      field('Company size', size.wrap)
    ),
    field('Website', website),
    field('Tags', tags.el),
    field('Notes', notes),
    custom?.nodes,
    submitRow(company ? 'Save changes' : 'Add company')
  );

  const modal = openModal({ title: company ? 'Edit company' : 'New company', content: form, guardUnsaved: true });

  wireForm(form, async () => {
    const data = {
      name: name.value.trim(), industry: industry.value.trim(),
      website: website.value.trim(), size: size.select.value, notes: notes.value.trim(),
      tags: tags.get(),
      // Only when there are fields to read: sending an empty bag would
      // erase values stored under a field this form never showed.
      ...(custom ? { custom: custom.get() } : {}),
    };
    const saved = company
      ? await store.updateCompany(company.id, data)
      : await store.addCompany(data);
    modal.close();
    toast(company ? 'Company updated' : 'Company added');
    onSaved?.(saved);
  });
  return modal;
}

/* ---------- contact (lead) ---------- */

export function openContactForm(contact = null, { presets = {}, onSaved = null } = {}) {
  const name = textInput({ value: contact?.name || '', required: true, autocomplete: 'off', maxlength: 120 });
  const title = textInput({ value: contact?.title || '', autocomplete: 'off', maxlength: 120, placeholder: 'e.g. Head of Operations' });
  const email = textInput({ value: contact?.email || '', type: 'email', autocomplete: 'off', maxlength: 200 });
  const phone = textInput({ value: contact?.phone || '', type: 'tel', autocomplete: 'off', maxlength: 40 });
  const company = companySelect(contact?.companyId ?? presets.companyId ?? '');
  const source = makeSelect(
    withCurrent([{ value: '', label: 'Unknown' }, ...LEAD_SOURCES.map((s) => ({ value: s, label: s }))],
      contact?.source),
    contact?.source || '');
  const status = makeSelect(CONTACT_STATUSES, contact?.status || 'lead');
  const tags = tagInput(contact?.tags);
  const notes = textArea({ value: contact?.notes || '' });
  const custom = customFieldInputs('contacts', contact);

  // The cheapest duplicate to prevent is the one about to be typed in:
  // an email that already belongs to a contact points there instead.
  const emailField = field('Email', email);
  const dupeHint = el('div.dupe-inline');
  emailField.append(dupeHint);
  const syncDupeHint = () => {
    clear(dupeHint);
    const existing = contactByEmail(store.contacts, email.value, contact?.id || null);
    if (!existing) return;
    dupeHint.append(el('button.btn-inline', {
      type: 'button',
      onclick: () => {
        modal.close();
        location.hash = `#/leads?id=${existing.id}`;
      },
    }, `Looks like ${existing.name}. Open instead?`));
  };
  email.addEventListener('input', syncDupeHint);
  syncDupeHint();

  /* Paste a signature, a LinkedIn blurb, or notes from the call, and have
     the fields read out of it. Company is a picker, so a name that matches
     one you already have selects it; one that doesn't is reported rather
     than quietly creating an account. */
  const paste = pasteToFillButton({
    kind: 'contacts',
    fields: {
      name, title, email, phone,
      company: {
        apply: (value) => {
          if (company.select.value) return false;
          const wanted = value.trim().toLowerCase();
          const match = store.companies.find((c) => c.name.trim().toLowerCase() === wanted);
          if (!match) return false;
          company.select.value = match.id;
          return true;
        },
      },
    },
    onFilled: ({ filled, skipped, draft }) => {
      const unknown = skipped.find(([key]) => key === 'company');
      toast(fillSummary({ filled, skipped }), { icon: 'sparkle' });
      if (unknown && !company.select.value) {
        toast(`“${draft.company}” isn’t in your companies yet`, { icon: 'company' });
      }
    },
  });

  const form = el('form.form', {},
    paste,
    field('Name', name),
    field('Job title', title),
    el('div.form-grid', {},
      emailField,
      field('Phone', phone)
    ),
    field('Company', company.wrap),
    el('div.form-grid', {},
      field('Source', source.wrap),
      field('Status', status.wrap)
    ),
    field('Tags', tags.el),
    field('Notes', notes),
    custom?.nodes,
    submitRow(contact ? 'Save changes' : 'Add lead')
  );

  const modal = openModal({ title: contact ? 'Edit lead' : 'New lead', content: form, guardUnsaved: true });

  wireForm(form, async () => {
    const data = {
      name: name.value.trim(), title: title.value.trim(), email: email.value.trim(),
      phone: phone.value.trim(), companyId: company.select.value || null,
      source: source.select.value, status: status.select.value, notes: notes.value.trim(),
      tags: tags.get(),
      ...(custom ? { custom: custom.get() } : {}),
    };
    const saved = contact
      ? await store.updateContact(contact.id, data)
      : await store.addContact(data);
    modal.close();
    toast(contact ? 'Lead updated' : 'Lead added');
    onSaved?.(saved);
  });
  return modal;
}

/* ---------- the people on a deal ----------
   The primary contact keeps its own field (and its own role); everyone
   else is a row you add. The whole set saves as one `contacts` list with
   the primary first, which is the shape the store stores. */

const roleOptions = () => [
  { value: '', label: 'No role' },
  ...DEAL_ROLES.map((r) => ({ value: r.value, label: r.label })),
];

function dealPeopleEditor(deal, presets = {}) {
  const primaryId = deal?.contactId ?? presets.contactId ?? '';
  const contact = makeSelect(contactOptions(), primaryId);
  const primaryRole = makeSelect(roleOptions(), deal ? roleOf(deal, primaryId) : '');
  const extraWrap = el('div.people-rows');
  const rows = [];

  const addRow = ({ contactId = '', role = '' } = {}, { focus = false } = {}) => {
    const who = makeSelect(contactOptions(), contactId, { 'aria-label': 'Another contact' });
    const what = makeSelect(roleOptions(), role, { 'aria-label': 'Their role' });
    const row = { who, what };
    const node = el('div.people-row', {},
      el('div.select-wrap.people-who', {}, who.select),
      el('div.select-wrap.people-role', {}, what.select),
      el('button.icon-btn', {
        type: 'button',
        html: icon('x', 16, 2.2),
        'aria-label': 'Remove this contact from the deal',
        onclick: () => {
          rows.splice(rows.indexOf(row), 1);
          node.remove();
          syncAdd();
        },
      })
    );
    rows.push(row);
    extraWrap.append(node);
    syncAdd();
    if (focus) who.select.focus();
  };

  const addBtn = el('button.btn.btn-ghost.btn-sm.btn-dashed.people-add', {
    type: 'button',
    html: icon('userPlus', 14, 2),
    onclick: () => addRow({}, { focus: true }),
  }, ' Add another contact');

  function syncAdd() {
    // One person is the field above; the rest are these rows.
    addBtn.disabled = rows.length + 1 >= MAX_DEAL_CONTACTS;
    addBtn.title = addBtn.disabled
      ? `A deal holds at most ${MAX_DEAL_CONTACTS} contacts` : null;
  }

  // An existing deal opens with the people it already has - and only
  // those: a one-contact deal's form looks exactly as it used to.
  for (const contactId of dealContactIds(deal || {}).slice(1)) {
    addRow({ contactId, role: roleOf(deal, contactId) });
  }
  syncAdd();

  return {
    contact,
    primaryRole,
    nodes: [extraWrap, addBtn],
    /** The whole set, primary first, blanks dropped. */
    get: () => {
      const out = [];
      if (contact.select.value) {
        out.push({ contactId: contact.select.value, role: primaryRole.select.value });
      }
      for (const row of rows) {
        if (row.who.select.value) {
          out.push({ contactId: row.who.select.value, role: row.what.select.value });
        }
      }
      return out;
    },
  };
}

/* ---------- deal ---------- */

export function openDealForm(deal = null, { presets = {}, onSaved = null } = {}) {
  const name = textInput({ value: deal?.name || '', required: true, autocomplete: 'off', maxlength: 160, placeholder: 'e.g. Acme - annual license' });
  const value = el('input.input', {
    type: 'number', min: '0', step: 'any', inputmode: 'decimal',
    value: deal ? String(deal.value) : '', required: true, placeholder: '0',
  });
  const stages = store.stages();

  /* Billing: what the value in the field above actually means. One-time is
     the default and behaves exactly as it always did; monthly and annual
     make the value a rate, and the term says how long it runs. */
  const billing = makeSelect(
    BILLING_MODES.map((m) => ({ value: m.value, label: m.label })),
    normalizeBilling(deal?.billing));
  const term = el('input.input.prob-input.term-input', {
    type: 'number', min: '1', max: String(MAX_TERM), step: '1', inputmode: 'numeric',
    value: String(deal?.term || DEFAULT_TERM),
    'aria-label': 'Contract term, months',
  });
  const termWrap = el('span.stage-prob-field.term-field', {},
    term, el('span.prob-unit', { 'aria-hidden': 'true' }, 'mo'));
  const billingHint = el('p.field-hint.billing-hint');
  const valueField = field(`Value (${store.settings.currency})`, value);
  const valueLabel = valueField.querySelector('.field-label');

  /** The deal as the form currently reads, for the derived figures below. */
  const draftDeal = () => ({
    value: Number(value.value) || 0,
    billing: billing.select.value,
    term: Number(term.value) || DEFAULT_TERM,
  });

  const syncBilling = () => {
    const mode = BILLING_MODES.find((m) => m.value === billing.select.value) || BILLING_MODES[0];
    // The label has to say what the number means, or a monthly deal's
    // "Value" is read as the whole contract by the person typing it.
    valueLabel.replaceChildren(
      document.createTextNode(`${mode.valueLabel} (${store.settings.currency})`), requiredMark());
    const recurring = mode.value !== 'one-time';
    // Same reason the confidence percent is disabled rather than hidden:
    // a display:none field is still validated, and an invalid one the
    // browser can't show leaves Save dead with no message anywhere.
    termWrap.hidden = !recurring;
    term.disabled = !recurring;
    const draft = draftDeal();
    billingHint.textContent = recurring
      ? `${rateText(draft, store.settings.currency)} · ${contractText(draft, store.settings.currency)}`
      : 'A single payment. Choose Monthly or Annual for a subscription.';
  };
  syncBilling();
  billing.select.addEventListener('change', () => {
    syncBilling();
    if (!termWrap.hidden) term.focus();
  });
  term.addEventListener('input', syncBilling);
  value.addEventListener('input', syncBilling);
  const stage = makeSelect(stages.map((s) => ({ value: s.id, label: s.label })),
    deal?.stage ?? presets.stage ?? store.firstStage());
  const people = dealPeopleEditor(deal, presets);
  const contact = people.contact;
  const company = companySelect(deal?.companyId ?? presets.companyId ?? '');
  const expectedClose = el('input.input', { type: 'date', value: deal?.expectedClose || presets.expectedClose || '' });
  const tags = tagInput(deal?.tags);
  const notes = textArea({ value: deal?.notes || '' });
  const custom = customFieldInputs('deals', deal);

  /* Forecast confidence: the founder's own call on this deal, overriding
     the stage weight. A category or a custom percent; empty = stage. */
  const current = typeof deal?.confidence === 'number' ? deal.confidence : null;
  const isLevel = CONFIDENCE_LEVELS.some((l) => l.value === current);
  const confidence = makeSelect([
    { value: '', label: 'Stage weight (default)' },
    ...CONFIDENCE_LEVELS.map((l) => ({ value: String(l.value), label: `${l.label} · ${Math.round(l.value * 100)}%` })),
    { value: 'custom', label: 'Custom %…' },
  ], current === null ? '' : (isLevel ? String(current) : 'custom'));
  const confidencePct = el('input.input.prob-input', {
    // Whole percents. A step of five reads as a spinner nicety and lands
    // as validation: this field exists precisely because the stage weight
    // is too coarse, so "33" is the whole point of typing in it, and the
    // form refused to save with "the two nearest valid values are 30 and
    // 35" - about a number the user chose deliberately.
    type: 'number', min: '0', max: '100', step: '1',
    value: current !== null ? String(Math.round(current * 100)) : '50',
    'aria-label': 'Confidence, percent',
  });
  const confidencePctWrap = el('span.stage-prob-field.conf-pct', {},
    confidencePct, el('span.prob-unit', { 'aria-hidden': 'true' }, '%'));
  /* Hidden is not enough: a display:none field is still validated, and an
     invalid one the browser cannot show has nowhere to put its message -
     reportValidity() just returns false and wireForm returns. Pick Custom,
     type something out of range, pick Stage weight again, and Save was a
     dead button with no explanation anywhere. Disabled bars the field from
     validation while it is out of play, and its value goes unread there. */
  const syncConfidencePct = () => {
    const custom = confidence.select.value === 'custom';
    confidencePctWrap.hidden = !custom;
    confidencePct.disabled = !custom;
  };
  syncConfidencePct();
  confidence.select.addEventListener('change', () => {
    syncConfidencePct();
    if (!confidencePctWrap.hidden) confidencePct.focus();
  });

  // Picking a contact fills an empty company from that contact - the common
  // case - without overriding an explicit choice.
  contact.select.addEventListener('change', () => {
    const c = store.contactById(contact.select.value);
    if (c?.companyId && !company.select.value) company.select.value = c.companyId;
  });

  const form = el('form.form', {},
    field('Deal name', name),
    el('div.form-grid', {},
      valueField,
      field('Stage', stage.wrap)
    ),
    field('Billing', el('div.conf-field', {}, billing.wrap, termWrap)),
    billingHint,
    // The contact and their role take the whole row: sharing it with
    // Company squeezed two selects into half a modal, where "Mei Tanaka"
    // read "Mei Tar" and "Decision maker" read "Decisio".
    field('Contact', el('div.conf-field', {}, contact.wrap, people.primaryRole.wrap)),
    people.nodes,
    field('Company', company.wrap),
    el('div.form-grid', {},
      field('Expected close', expectedClose, { hint: 'Drives the monthly forecast.' }),
      field('Forecast confidence', el('div.conf-field', {}, confidence.wrap, confidencePctWrap), {
        hint: 'Your call on this deal, over the stage weight. Clears when it closes.',
      })
    ),
    field('Tags', tags.el),
    field('Notes', notes),
    custom?.nodes,
    submitRow(deal ? 'Save changes' : 'Add deal')
  );

  const modal = openModal({ title: deal ? 'Edit deal' : 'New deal', content: form, guardUnsaved: true });

  wireForm(form, async () => {
    const data = {
      name: name.value.trim(), value: Number(value.value) || 0,
      billing: billing.select.value,
      term: billing.select.value === 'one-time'
        ? null
        : clamp(Math.round(Number(term.value) || DEFAULT_TERM), 1, MAX_TERM),
      stage: stage.select.value, contactId: contact.select.value || null,
      contacts: people.get(),
      companyId: company.select.value || null,
      expectedClose: expectedClose.value || null, notes: notes.value.trim(),
      tags: tags.get(),
      ...(custom ? { custom: custom.get() } : {}),
      confidence: confidence.select.value === ''
        ? null
        : confidence.select.value === 'custom'
          ? clamp(Math.round(Number(confidencePct.value) || 0), 0, 100) / 100
          : Number(confidence.select.value),
    };
    // Closing a deal from the form asks why, same as the board does.
    // Creating one that is already closed doesn't - backfilling history
    // shouldn't be interrogated.
    const closing = deal && isOpen(deal) && !isOpen(data);
    const saved = deal
      ? await store.updateDeal(deal.id, data)
      : await store.addDeal(data);
    modal.close();
    toast(deal ? 'Deal updated' : 'Deal added');
    onSaved?.(saved);
    if (closing) setTimeout(() => openCloseReasonForm(saved), 220);
  });
  return modal;
}

/* ---------- activity (meeting / call / email / note) ---------- */

export function openActivityForm(activity = null, { presets = {}, onSaved = null } = {}) {
  const summary = textInput({ value: activity?.summary || '', required: true, maxlength: 200, placeholder: 'e.g. Demo call with Mei' });
  const type = makeSelect(ACTIVITY_TYPES, activity?.type ?? presets.type ?? 'meeting');
  const date = el('input.input', { type: 'date', value: activity?.date || todayISO(), required: true });
  const dealId = activity?.dealId ?? presets.dealId ?? '';
  const contact = makeSelect(contactOptions(dealId), activity?.contactId ?? presets.contactId ?? '');
  const dealSel = makeSelect(dealOptions(), dealId);
  // Picking a deal re-groups the contact list around its people, keeping
  // whoever is already chosen selected.
  dealSel.select.addEventListener('change', () => {
    const keep = contact.select.value;
    contact.select.replaceChildren(...optionNodes(contactOptions(dealSel.select.value), keep));
  });
  const notes = textArea({ value: activity?.notes || '', rows: 4, placeholder: 'What was said, what happens next…' });

  const form = el('form.form', {},
    el('div.form-grid', {},
      field('Type', type.wrap),
      field('Date', date)
    ),
    field('Summary', summary),
    el('div.form-grid', {},
      field('Contact', contact.wrap),
      field('Deal', dealSel.wrap)
    ),
    field('Notes', notes),
    submitRow(activity ? 'Save changes' : 'Log it', {
      onDelete: activity && deleteAction({
        title: 'Delete this activity?',
        message: 'It is removed from every lead, company, and deal history, and goes to Recently deleted for 30 days.',
        run: () => store.deleteActivity(activity.id),
        done: 'Activity deleted',
        closeModal: () => modal.close(),
      }),
    })
  );

  const modal = openModal({ title: activity ? 'Edit activity' : 'Log activity', content: form, guardUnsaved: true });

  wireForm(form, async () => {
    const linkedContact = store.contactById(contact.select.value);
    const data = {
      type: type.select.value, date: date.value, summary: summary.value.trim(),
      notes: notes.value.trim(), contactId: contact.select.value || null,
      dealId: dealSel.select.value || null,
      // Company follows the linked contact (or deal) so company pages see
      // their history without a third picker in the form. With neither
      // linked, keep the page's preset or the record's existing company
      // rather than silently detaching it.
      companyId: linkedContact?.companyId
        || store.dealById(dealSel.select.value)?.companyId
        || presets.companyId || activity?.companyId || null,
    };
    const saved = activity
      ? await store.updateActivity(activity.id, data)
      : await store.addActivity(data);
    modal.close();
    // Logging a touch on a record with nothing else booked is the moment
    // to book the next one; the nudge replaces the plain confirmation.
    const nudged = !activity && maybeNudgeNextStep({
      contactId: data.contactId, dealId: data.dealId, lead: 'Logged',
    });
    if (!nudged) toast(activity ? 'Activity updated' : 'Activity logged');
    onSaved?.(saved);
  });
  return modal;
}

/* ---------- task (follow-up) ---------- */

/* Cadences founders actually run; the model takes any N + unit, so an
   imported oddball ("every 5 days") keeps its own entry via repeatLabel. */
const REPEAT_OPTIONS = [
  { value: '', label: 'Doesn’t repeat' },
  { value: '1:day', label: 'Every day' },
  { value: '1:week', label: 'Every week' },
  { value: '2:week', label: 'Every 2 weeks' },
  { value: '1:month', label: 'Every month' },
  { value: '2:month', label: 'Every 2 months' },
  { value: '3:month', label: 'Every 3 months' },
  { value: '6:month', label: 'Every 6 months' },
];

export function openTaskForm(task = null, { presets = {}, onSaved = null } = {}) {
  const title = textInput({ value: task?.title || presets.title || '', required: true, maxlength: 200, placeholder: 'e.g. Send the proposal' });
  const due = el('input.input', { type: 'date', value: task?.due || presets.due || todayISO(), required: true });
  // No step. A five-minute one reads as a spinner nicety and lands as
  // validation: "call at 2:37" - typed here, or carried in by an import
  // through a store that accepts any HH:MM - was refused with "the two
  // nearest valid values are 2:35 PM and 2:40 PM", about a field the user
  // may never have touched. Every minute is a real time to be reminded
  // at, and the reminder check already runs to the minute.
  const dueTime = el('input.input', { type: 'time', value: task?.dueTime || '' });
  const taskDealId = task?.dealId ?? presets.dealId ?? '';
  const contact = makeSelect(contactOptions(taskDealId), task?.contactId ?? presets.contactId ?? '');
  const dealSel = makeSelect(dealOptions(), taskDealId);
  dealSel.select.addEventListener('change', () => {
    const keep = contact.select.value;
    contact.select.replaceChildren(...optionNodes(contactOptions(dealSel.select.value), keep));
  });
  const repeatValue = task?.repeat ? `${task.repeat.every}:${task.repeat.unit}` : '';
  const repeatChoices = repeatValue && !REPEAT_OPTIONS.some((o) => o.value === repeatValue)
    ? [...REPEAT_OPTIONS, { value: repeatValue, label: repeatLabel(task.repeat) }]
    : REPEAT_OPTIONS;
  const repeat = makeSelect(repeatChoices, repeatValue);

  const form = el('form.form', {},
    field('What needs doing?', title),
    el('div.form-grid', {},
      field('Due', due),
      field('Time', dueTime, { hint: 'Optional. Set one to get a reminder at that hour.' })
    ),
    field('Repeat', repeat.wrap, {
      hint: 'Checking it off schedules the next one, counted from that day.',
    }),
    el('div.form-grid', {},
      field('Contact', contact.wrap),
      field('Deal', dealSel.wrap)
    ),
    // Existing follow-ups can leave for the calendar the user actually
    // checks; a new one has no id to name the event with yet. The event
    // reads the fields as they are on screen - exporting next to an
    // edited date must not download the old one - falling back to the
    // stored values where a field sits empty mid-edit.
    task && el('button.btn.btn-ghost.btn-sm.btn-dashed.calendar-btn', {
      type: 'button',
      html: icon('calendar', 14, 2),
      onclick: () => downloadTaskICS({
        ...task,
        title: title.value.trim() || task.title,
        due: due.value || task.due,
        dueTime: dueTime.value || '',
        contactId: contact.select.value || null,
        dealId: dealSel.select.value || null,
      }),
    }, ' Add to calendar'),
    submitRow(task ? 'Save changes' : 'Add follow-up', {
      onDelete: task && deleteAction({
        title: 'Delete this follow-up?',
        message: 'The reminder goes to Recently deleted for 30 days. Done follow-ups can simply stay checked off instead.',
        run: () => store.deleteTask(task.id),
        done: 'Follow-up deleted',
        closeModal: () => modal.close(),
      }),
    })
  );

  const modal = openModal({ title: task ? 'Edit follow-up' : 'New follow-up', content: form, guardUnsaved: true });

  wireForm(form, async () => {
    const [every, unit] = repeat.select.value.split(':');
    const data = {
      title: title.value.trim(), due: due.value, dueTime: dueTime.value || '',
      contactId: contact.select.value || null, dealId: dealSel.select.value || null,
      repeat: repeat.select.value ? { every: Number(every), unit } : null,
    };
    const saved = task
      ? await store.updateTask(task.id, data)
      : await store.addTask(data);
    modal.close();
    toast(task ? 'Follow-up updated' : 'Follow-up added');
    onSaved?.(saved);
  });
  return modal;
}
