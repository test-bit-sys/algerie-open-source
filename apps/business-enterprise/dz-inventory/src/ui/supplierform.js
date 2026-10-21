import { el } from './dom.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';

export function openSupplierForm(supplier = null, { onSaved } = {}) {
  const isEdit = !!supplier;
  let fieldN = 0;

  const f = {
    name: el('input.input', { required: true, maxLength: 120, value: supplier?.name || '', placeholder: 'e.g. Apex Electronics' }),
    contact: el('input.input', { maxLength: 120, value: supplier?.contact || '', placeholder: 'Contact person' }),
    email: el('input.input', { type: 'email', maxLength: 120, value: supplier?.email || '', placeholder: 'orders@example.com' }),
    phone: el('input.input', { type: 'tel', maxLength: 40, value: supplier?.phone || '', placeholder: '+1 555 0100' }),
    website: el('input.input', { maxLength: 160, value: supplier?.website || '', placeholder: 'example.com' }),
    leadTimeDays: el('input.input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric',
      value: supplier?.leadTimeDays ?? '', placeholder: 'e.g. 5',
    }),
    minOrder: el('input.input', {
      type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
      value: supplier?.minOrder ?? '', placeholder: 'Optional',
    }),
    notes: el('textarea.textarea', { maxLength: 500, value: supplier?.notes || '', placeholder: 'Terms, delivery days, who to call' }),
  };

  /** A positive whole number of days / amount of money, or null. */
  const posIntOrNull = (v) => (Number.isFinite(v) && Math.round(v) > 0 ? Math.round(v) : null);
  const posMoneyOrNull = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

  const nameErr = el('p.field-error', { id: 'sup-name-error', hidden: true }, 'A supplier name is required.');
  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, isEdit ? 'Save changes' : 'Add supplier');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = f.name.value.trim();
      nameErr.hidden = !!name;
      f.name.setAttribute('aria-invalid', String(!name));
      if (!name) { f.name.focus(); return; }
      const data = {
        name,
        contact: f.contact.value.trim(),
        email: f.email.value.trim(),
        phone: f.phone.value.trim(),
        website: f.website.value.trim(),
        leadTimeDays: posIntOrNull(f.leadTimeDays.valueAsNumber),
        minOrder: posMoneyOrNull(f.minOrder.valueAsNumber),
        notes: f.notes.value.trim(),
      };
      submit.disabled = true;
      try {
        if (isEdit) await store.updateSupplier(supplier.id, data);
        else await store.addSupplier(data);
        toast(isEdit ? 'Supplier saved' : 'Supplier added');
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    field('Name', f.name, { error: nameErr, required: true }),
    el('div.field-grid', {},
      field('Contact person', f.contact),
      field('Phone', f.phone),
      field('Email', f.email),
      field('Website', f.website)
    ),
    el('div.field-grid', {},
      field('Lead time (days)', f.leadTimeDays, { hint: 'How long an order usually takes to arrive' }),
      field('Minimum order', f.minOrder, { hint: `In ${store.settings.currency}; orders below it get flagged` })
    ),
    field('Notes', f.notes),
    submit,
    isEdit && el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      style: { color: 'var(--danger)', marginTop: '8px' },
      onclick: async () => {
        const count = store.products.filter((p) => p.supplierId === supplier.id).length;
        const ok = await confirmDialog({
          title: 'Delete supplier?',
          message: count
            ? `"${supplier.name}" is removed. ${count} product${count === 1 ? ' keeps' : 's keep'} existing without a supplier.`
            : `"${supplier.name}" is removed. This cannot be undone.`,
        });
        if (!ok) return;
        try {
          await store.deleteSupplier(supplier.id);
          toast('Supplier deleted', { icon: 'trash' });
          modal.close();
          onSaved?.();
        } catch (err) {
          console.error(err);
          toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
        }
      },
    }, 'Delete supplier')
  );

  /* Unsaved typing must survive a mistap on the scrim. */
  const state = () => JSON.stringify(Object.values(f).map((n) => n.value));
  const opened = state();

  const modal = openModal({
    title: isEdit ? 'Edit supplier' : 'New supplier',
    content: form,
    unsaved: () => state() !== opened,
  });

  function field(label, control, { error = null, hint = null, required = false } = {}) {
    const id = `sf-${++fieldN}`;
    control.id = id;
    // The hint is what the field means — "In USD; orders below it get
    // flagged" is the only statement of the currency, and of what the
    // number does. Next to the field it reached nobody who can't see it.
    const hintNode = hint ? el('p.hint', { id: `${id}-hint` }, hint) : null;
    const describedBy = [hintNode?.id, error?.id].filter(Boolean).join(' ');
    if (describedBy) control.setAttribute('aria-describedby', describedBy);
    if (required) control.setAttribute('aria-required', 'true');
    return el('div.field', {},
      el('label', { htmlFor: id }, label, required ? el('span', { 'aria-hidden': 'true' }, ' *') : null),
      control, hintNode, error);
  }
}
