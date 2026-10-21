/**
 * Variant families, in three small sheets:
 *
 *   openMakeFamilyForm(product)  — turn a product into the first variant
 *                                  of a family (conversion, not
 *                                  migration: same id, same stock, same
 *                                  history).
 *   openVariantForm(family)      — add a variant, seeded from the shared
 *                                  half so a second size is two fields.
 *   openFamilyForm(family)       — edit the shared half once instead of
 *                                  four times, or split the family up.
 *
 * Everything else in the app goes on treating a variant as the ordinary
 * product it is.
 */

import { el, clear, CODE_FIELD } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { MAX_AXES, normalizeAxes, variantName, variantLabel } from '../lib/variants.js';
import { normalizeUnit, roundQty, isCountUnit, formatQtyIn, unitLabel } from '../lib/units.js';

/** Axis names people actually use, offered as a starting point. */
const AXIS_SUGGESTIONS = ['Size', 'Colour', 'Flavour', 'Grind', 'Length', 'Pack'];

/* ---------- Make a family out of a product ---------- */

export function openMakeFamilyForm(product, { onSaved } = {}) {
  if (!product || product.familyId) return;

  const nameInput = el('input.input', {
    maxLength: 120,
    value: product.name,
    'aria-label': 'Family name',
    placeholder: 'e.g. Cotton Shirt',
    oninput: syncPreview,
  });

  /* Up to two axes: a family with an "Add variant" row covers what a
     small shop keeps, and stops this becoming a merchandising system. */
  const axisInputs = [axisInput('Size'), axisInput('')];
  function axisInput(value) {
    return el('input.input', {
      ...CODE_FIELD,
      maxLength: 24,
      value,
      list: 'family-axes',
      placeholder: 'e.g. Size',
      'aria-label': 'Axis name',
      oninput: () => { renderValues(); syncPreview(); },
    });
  }

  const valuesWrap = el('div.field-grid');
  const valueInputs = new Map();
  function renderValues() {
    const axes = axes_();
    clear(valuesWrap);
    for (const axis of axes) {
      const existing = valueInputs.get(axis);
      const input = existing || el('input.input', {
        maxLength: 40,
        placeholder: axis === 'Size' ? 'e.g. M' : 'e.g. Navy',
        'aria-label': `${axis} of this one`,
        oninput: syncPreview,
      });
      valueInputs.set(axis, input);
      valuesWrap.append(el('div.field', {}, el('label', {}, `This one’s ${axis.toLowerCase()}`), input));
    }
  }

  const axes_ = () => normalizeAxes(axisInputs.map((i) => i.value));
  const values_ = () => {
    const out = {};
    for (const axis of axes_()) out[axis] = valueInputs.get(axis)?.value || '';
    return out;
  };

  const preview = el('p.hint', { 'aria-live': 'polite' });
  function syncPreview() {
    const axes = axes_();
    const family = { name: nameInput.value.trim() || product.name, axes };
    const label = variantLabel(values_(), axes);
    preview.textContent = axes.length
      ? `This product becomes “${variantName(family, values_())}”${label ? '' : '. Give it a value to tell it apart'}.`
      : 'Name at least one axis: what makes your variants different.';
    submit.disabled = !axes.length;
  }

  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Make it a family');
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const family = await store.createFamily(product.id, {
          name: nameInput.value,
          axes: axes_(),
          values: values_(),
        });
        modal.close();
        onSaved?.(family);
        toast('Family created. Add the next variant', {
          icon: 'boxes',
          action: { label: 'Add variant', onClick: () => openVariantForm(family) },
        });
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast(err?.message || 'Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('datalist', { id: 'family-axes' }, AXIS_SUGGESTIONS.map((a) => el('option', { value: a }))),
    el('p.confirm-message', { style: { marginBottom: '14px' } },
      el('strong', {}, product.name),
      ' keeps its stock, its history, and its codes. It just becomes the first variant of a family, '
      + 'and the details its variants share move to the family.'),
    el('div.field', {}, el('label', {}, 'Family name'), nameInput),
    el('div.field-grid', {},
      el('div.field', {}, el('label', {}, 'First axis'), axisInputs[0]),
      el('div.field', {}, el('label', {}, `Second axis (optional, max ${MAX_AXES})`), axisInputs[1])
    ),
    valuesWrap,
    preview,
    submit
  );

  renderValues();
  syncPreview();
  const modal = openModal({ title: 'Make this a family', content: form });
}

/* ---------- Add a variant ---------- */

export function openVariantForm(family, { onSaved } = {}) {
  if (!family) return;
  const unit = normalizeUnit(family.unit);
  const counted = isCountUnit(unit);

  const valueInputs = new Map();
  const valuesWrap = el('div.field-grid', {}, family.axes.map((axis) => {
    const input = el('input.input', {
      maxLength: 40,
      'aria-label': axis,
      placeholder: axis === 'Size' ? 'e.g. L' : 'e.g. Navy',
      oninput: syncPreview,
    });
    valueInputs.set(axis, input);
    return el('div.field', {}, el('label', {}, axis), input);
  }));

  const sku = el('input.input', { ...CODE_FIELD, maxLength: 60, placeholder: 'e.g. SHIRT-L' });
  const barcode = el('input.input', { ...CODE_FIELD, maxLength: 60, inputmode: 'numeric', placeholder: 'Scan or type' });
  const cost = el('input.input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', placeholder: '0.00' });
  const quantity = el('input.input', {
    type: 'number', min: 0, step: counted ? 1 : 'any',
    inputmode: counted ? 'numeric' : 'decimal', value: '0',
  });

  const values_ = () => {
    const out = {};
    for (const axis of family.axes) out[axis] = valueInputs.get(axis)?.value || '';
    return out;
  };

  const preview = el('p.hint', { 'aria-live': 'polite' });
  const skuErr = el('p.field-error', { hidden: true });
  const barcodeErr = el('p.field-error', { hidden: true });
  function syncPreview() {
    const label = variantLabel(values_(), family.axes);
    preview.textContent = label
      ? `Adds “${variantName(family, values_())}”, sharing the family’s category, unit, supplier, price and threshold.`
      : `Give it ${family.axes.length > 1 ? 'its values' : `a ${family.axes[0].toLowerCase()}`}. That’s what tells it apart.`;
    submit.disabled = !label;
  }

  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Add variant');
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const code = sku.value.trim();
      const clash = code ? store.productBySku(code) : null;
      skuErr.hidden = !clash;
      if (clash) {
        skuErr.textContent = `"${clash.name}" already uses this SKU.`;
        sku.focus();
        return;
      }
      /* The same rule the product sheet applies: a barcode has to point
         at one product, and a scan resolves against barcodes and SKUs
         alike — so a code another product already answers to, under
         either name, would make one of them unfindable by the code
         printed on it. This sheet let it through. */
      const scanned = barcode.value.trim();
      const owner = scanned ? store.productByCode(scanned) : null;
      barcodeErr.hidden = !owner;
      if (owner) {
        const asBarcode = String(owner.barcode ?? '').trim().toLowerCase() === scanned.toLowerCase();
        barcodeErr.textContent = asBarcode
          ? `"${owner.name}" already uses this barcode.`
          : `"${owner.name}" uses this as its SKU, and a scan matches either. This would hide it.`;
        barcode.focus();
        return;
      }
      submit.disabled = true;
      try {
        const created = await store.addVariant(family.id, {
          values: values_(),
          sku: code,
          barcode: barcode.value.trim(),
          cost: cost.value.trim() === '' ? undefined : Math.max(0, cost.valueAsNumber || 0),
          quantity: quantity.value.trim() === '' ? 0 : roundQty(quantity.valueAsNumber, unit),
        });
        toast(`${created.name} added`, { icon: 'boxes' });
        modal.close();
        onSaved?.(created);
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast(err?.message || 'Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('p.confirm-message', { style: { marginBottom: '14px' } },
      'A new variant of ', el('strong', {}, family.name),
      '. Only what differs is asked for; the rest comes from the family.'),
    valuesWrap,
    el('div.field-grid', {},
      el('div.field', {}, el('label', {}, 'SKU'), sku, skuErr),
      el('div.field', {}, el('label', {}, 'Barcode'), barcode, barcodeErr)
    ),
    el('div.field-grid', {},
      el('div.field', {}, el('label', {}, 'Purchase cost per unit'), cost),
      el('div.field', {}, el('label', {}, 'Opening stock'), quantity)
    ),
    preview,
    submit
  );

  syncPreview();
  const modal = openModal({
    title: 'Add a variant',
    content: form,
    unsaved: () => [...valueInputs.values()].some((i) => i.value.trim() !== '')
      || sku.value.trim() !== '' || barcode.value.trim() !== ''
      || cost.value.trim() !== '' || quantity.value.trim() !== '0',
  });
}

/* ---------- Edit the family ---------- */

export function openFamilyForm(family, { onSaved } = {}) {
  if (!family) return;
  const variants = store.variantsOf(family.id);

  const f = {
    name: el('input.input', { maxLength: 120, value: family.name, required: true }),
    category: el('input.input', { maxLength: 60, value: family.category || '', placeholder: 'e.g. Clothing' }),
    unit: el('input.input', { ...CODE_FIELD, maxLength: 12, value: normalizeUnit(family.unit), placeholder: 'each' }),
    price: el('input.input', {
      type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
      value: family.price ?? '', placeholder: 'Optional',
    }),
    lowStock: el('input.input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric',
      value: family.lowStock ?? '', placeholder: `Default (${store.settings.defaultLowStock})`,
    }),
    supplier: el('select.select', {}),
    notes: el('textarea.textarea', { maxLength: 500, value: family.notes || '' }),
  };
  f.supplier.append(el('option', { value: '' }, 'No supplier'));
  for (const s of store.suppliers) {
    f.supplier.append(el('option', { value: s.id, selected: s.id === family.supplierId }, s.name));
  }

  const axisInputs = [0, 1].map((i) => el('input.input', {
    ...CODE_FIELD, maxLength: 24, value: family.axes[i] || '',
    list: 'family-axes-edit', placeholder: i ? 'Optional' : 'e.g. Size',
    'aria-label': `Axis ${i + 1}`,
  }));

  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, `Save: ${variants.length} variant${variants.length === 1 ? '' : 's'}`);
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = f.name.value.trim();
      if (!name) { f.name.focus(); return; }
      submit.disabled = true;
      try {
        await store.updateFamily(family.id, {
          name,
          axes: normalizeAxes(axisInputs.map((i) => i.value)),
          category: f.category.value.trim(),
          unit: normalizeUnit(f.unit.value),
          supplierId: f.supplier.value || null,
          price: f.price.value.trim() === '' ? null : Math.max(0, f.price.valueAsNumber || 0),
          lowStock: f.lowStock.value.trim() === '' ? null : Math.max(0, f.lowStock.valueAsNumber || 0),
          notes: f.notes.value.trim(),
        });
        toast('Family saved: every variant updated', { icon: 'boxes' });
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('datalist', { id: 'family-axes-edit' }, AXIS_SUGGESTIONS.map((a) => el('option', { value: a }))),
    el('p.confirm-message', { style: { marginBottom: '14px' } },
      'These are the details every variant shares. Saving writes them to all ',
      el('strong', {}, `${variants.length} variant${variants.length === 1 ? '' : 's'}`),
      ' at once.'),
    el('div.field', {}, el('label', {}, 'Family name'), f.name),
    el('div.field-grid', {},
      el('div.field', {}, el('label', {}, 'First axis'), axisInputs[0]),
      el('div.field', {}, el('label', {}, 'Second axis'), axisInputs[1])
    ),
    el('div.field-grid', {},
      el('div.field', {}, el('label', {}, 'Category'), f.category),
      el('div.field', {}, el('label', {}, 'Unit of measure'), f.unit)
    ),
    el('div.field-grid', {},
      el('div.field', {}, el('label', {}, 'Selling price'), f.price),
      el('div.field', {}, el('label', {}, 'Low stock alert at'), f.lowStock)
    ),
    el('div.field', {}, el('label', {}, 'Supplier'), el('div.select-wrap', {}, f.supplier)),
    el('div.field', {}, el('label', {}, 'Notes'), f.notes),
    variantList(),
    submit,
    el('div.form-actions', {},
      el('button.btn.btn-secondary', {
        type: 'button', html: icon('plus', 16, 2.2),
        onclick: () => { modal.close(); openVariantForm(family, { onSaved }); },
      }, ' Add variant'),
      el('button.btn.btn-secondary', {
        type: 'button', html: icon('move', 16, 2),
        onclick: dissolve,
      }, ' Split up')
    )
  );

  /** What's in the family now, read-only: the edit is per variant. */
  function variantList() {
    if (!variants.length) return null;
    return el('div.field', {},
      el('label', {}, 'Variants'),
      el('div.stock-split', {}, variants.map((p) => el('div', {},
        el('span.grow', {}, variantLabel(p.axes, family.axes) || p.name,
          p.sku ? el('span.small.muted.mono', {}, ` ${p.sku}`) : null),
        el('strong', {}, `${formatQtyIn(p.quantity, p.unit)} ${unitLabel(p.unit, p.quantity)}`)
      )))
    );
  }

  async function dissolve() {
    const ok = await confirmDialog({
      title: 'Split this family up?',
      message: `Its ${variants.length} variant${variants.length === 1 ? '' : 's'} stay as standalone products with the same stock, codes, and history. Only the grouping goes.`,
      confirmLabel: 'Split up',
      danger: false,
    });
    if (!ok) return;
    try {
      const n = await store.dissolveFamily(family.id);
      toast(`Split into ${n} product${n === 1 ? '' : 's'}`, { icon: 'boxes' });
      modal.close();
      onSaved?.();
    } catch (err) {
      console.error(err);
      toast('Couldn’t split. Check your connection', { icon: 'wifiOff' });
    }
  }

  const state = () => JSON.stringify([
    f.name.value, f.category.value, f.unit.value, f.price.value, f.lowStock.value,
    f.supplier.value, f.notes.value, axisInputs.map((i) => i.value),
  ]);
  const opened = state();
  const modal = openModal({
    title: 'Edit family',
    content: form,
    unsaved: () => state() !== opened,
  });
}
