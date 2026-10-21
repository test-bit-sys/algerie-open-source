/**
 * Bulk edit sheet: change one or more fields across a selection.
 *
 * Every control defaults to "Leave unchanged", so the dialog can only
 * ever do what was explicitly asked — the safe default when the action
 * lands on forty products at once.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { categoriesOf } from '../lib/inventory.js';
import { formatQtyIn, isCountUnit } from '../lib/units.js';
import { demandRates, suggestedThreshold } from '../lib/demand.js';

const KEEP = '__keep__';
const NONE = '__none__';
const NEW = '__new__';

export function openBulkEditForm(ids, { onSaved } = {}) {
  const count = ids.length;
  const wanted = new Set(ids);
  const products = store.products.filter((p) => wanted.has(p.id));
  const label = `${count} product${count === 1 ? '' : 's'}`;

  const categorySelect = pick('Category', [
    ...categoriesOf(store.products).map((c) => ({ value: c, label: c })),
    { value: NEW, label: 'New category…' },
    { value: NONE, label: 'No category' },
  ]);
  const newCategory = el('input.input', {
    // The placeholder alone would be the accessible name — and it
    // disappears the moment the user types.
    maxLength: 60, placeholder: 'New category name', 'aria-label': 'New category name',
    hidden: true, style: { marginTop: '6px' },
  });
  categorySelect.addEventListener('change', () => {
    newCategory.hidden = categorySelect.value !== NEW;
    if (!newCategory.hidden) newCategory.focus();
  });

  const locationSelect = pick('Location', [
    ...store.locations.map((l) => ({ value: l.id, label: l.name })),
    { value: NONE, label: 'No location' },
  ]);
  locationSelect.setAttribute('aria-describedby', 'bulk-location-hint');
  const supplierSelect = pick('Supplier', [
    ...store.suppliers.map((s) => ({ value: s.id, label: s.name })),
    { value: NONE, label: 'No supplier' },
  ]);

  const measured = products.some((p) => !isCountUnit(p.unit));
  const threshold = el('input.input', {
    type: 'number', min: 0, step: measured ? 'any' : 1,
    inputmode: measured ? 'decimal' : 'numeric',
    placeholder: 'Leave unchanged',
  });
  const useDefault = el('input', {
    type: 'checkbox',
    id: 'bulk-default-threshold',
    onchange: () => { threshold.disabled = useDefault.checked || useSuggested.checked; syncThresholdRow(); },
  });

  /* --- Suggested reorder points ---
     One patch per product, because every number is different by
     definition: each product's own rate of sale times its own restock
     time. Products the log can't speak for are left exactly as they
     are, and the sheet says how many that is before anything is
     applied. */
  const demand = demandRates(store.activity);
  const suggestions = new Map();
  /* Products whose threshold is already the suggested one: nothing to
     apply, but a different thing to say than "no suggestion". */
  let matching = 0;
  for (const p of products) {
    const value = suggestedThreshold(p, {
      perDay: demand.rates.get(p.id) || 0,
      leadTimeDays: store.supplierById(p.supplierId)?.leadTimeDays,
      safetyDays: store.settings.safetyDays,
    });
    if (value === null) continue;
    if (value === (p.lowStock ?? null)) matching++;
    else suggestions.set(p.id, value);
  }
  const useSuggested = el('input', {
    type: 'checkbox',
    id: 'bulk-suggest-threshold',
    disabled: !suggestions.size,
    onchange: () => {
      threshold.disabled = useDefault.checked || useSuggested.checked;
      useDefault.disabled = useSuggested.checked;
      syncThresholdRow();
    },
  });
  const suggestHint = el('p.hint');

  /** What the two threshold shortcuts would do, in the sheet's words. */
  function syncThresholdRow() {
    if (!suggestions.size) {
      if (!demand.enough) {
        suggestHint.textContent = 'No suggestions yet: the activity log is too short to say how fast anything sells.';
      } else if (matching) {
        suggestHint.textContent = `Nothing to change: ${matching === count ? 'all' : `all ${matching}`}`
          + ` of these already sit at the reorder point their demand implies.`;
      } else {
        suggestHint.textContent = 'No suggestions: nothing in this selection has sold recently enough to imply a threshold.';
      }
      return;
    }
    const list = products
      .filter((p) => suggestions.has(p.id))
      .slice(0, 3)
      .map((p) => `${p.name} → ${formatQtyIn(suggestions.get(p.id), p.unit)}`)
      .join(', ');
    suggestHint.textContent = `${suggestions.size} of ${count} would change: ${list}`
      + (suggestions.size > 3 ? `, and ${suggestions.size - 3} more.` : '.');
  }

  function pick(name, options) {
    return el('select.select', { 'aria-label': name },
      el('option', { value: KEEP }, 'Leave unchanged'),
      options.map((o) => el('option', { value: o.value }, o.label))
    );
  }

  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, `Apply to ${label}`);

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const patch = {};
      const changes = [];

      if (categorySelect.value !== KEEP) {
        const value = categorySelect.value === NONE ? ''
          : (categorySelect.value === NEW ? newCategory.value.trim() : categorySelect.value);
        if (categorySelect.value === NEW && !value) { newCategory.focus(); return; }
        patch.category = value;
        changes.push(`category ${value ? `→ ${value}` : 'cleared'}`);
      }
      if (locationSelect.value !== KEEP) {
        patch.locationId = locationSelect.value === NONE ? null : locationSelect.value;
        changes.push(`location → ${store.locationName(patch.locationId)}`);
      }
      if (supplierSelect.value !== KEEP) {
        patch.supplierId = supplierSelect.value === NONE ? null : supplierSelect.value;
        changes.push(`supplier → ${store.supplierById(patch.supplierId)?.name || 'none'}`);
      }
      if (useSuggested.checked) {
        changes.push(`threshold → suggested from demand (${suggestions.size} product${suggestions.size === 1 ? '' : 's'})`);
      } else if (useDefault.checked) {
        patch.lowStock = null;
        changes.push('threshold → store default');
      } else if (threshold.value.trim() !== '') {
        // Rounded per product by the store, to what each one's unit can
        // hold — one number here reaches pieces and kilos alike.
        patch.lowStock = Math.max(0, Number.isFinite(threshold.valueAsNumber) ? threshold.valueAsNumber : 0);
        changes.push(`threshold → ${patch.lowStock}`);
      }

      if (!changes.length) {
        toast('Nothing to change yet', { icon: 'info' });
        return;
      }

      submit.disabled = true;
      try {
        const summary = changes.join(', ');
        // A suggested threshold is a different number per product, so it
        // goes through the per-product path — still one write, still one
        // log entry. Products with no suggestion keep the threshold they
        // have and take only what the rest of the sheet asked for.
        const n = useSuggested.checked
          ? await store.bulkUpdateEach(
            ids.map((id) => ({
              id,
              patch: suggestions.has(id) ? { ...patch, lowStock: suggestions.get(id) } : { ...patch },
            })),
            { summary }
          )
          : await store.bulkUpdateProducts(ids, patch, { summary });
        toast(`Updated ${n} product${n === 1 ? '' : 's'}`, { icon: 'listChecks' });
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('p.confirm-message', { style: { marginBottom: '14px' } },
      'Editing ', el('strong', {}, label), '. Anything left as “Leave unchanged” stays as it is.'),
    el('div.field-grid', {},
      el('div.field', {},
        el('label', { htmlFor: 'bulk-category' }, 'Category'),
        el('div.select-wrap', {}, Object.assign(categorySelect, { id: 'bulk-category' })),
        newCategory
      ),
      el('div.field', {},
        el('label', { htmlFor: 'bulk-location' }, 'Location'),
        el('div.select-wrap', {}, Object.assign(locationSelect, { id: 'bulk-location' })),
        // What this pick does to the stock itself, across the whole
        // selection — worth hearing before choosing, not after.
        el('p.hint', { id: 'bulk-location-hint' }, 'Stock at a single location moves with it.')
      )
    ),
    el('div.field-grid', {},
      el('div.field', {},
        el('label', { htmlFor: 'bulk-supplier' }, 'Supplier'),
        el('div.select-wrap', {}, Object.assign(supplierSelect, { id: 'bulk-supplier' }))
      ),
      el('div.field', {},
        el('label', { htmlFor: 'bulk-threshold' }, 'Low stock alert at'),
        Object.assign(threshold, { id: 'bulk-threshold' }),
        el('label.check-row', { htmlFor: 'bulk-default-threshold' },
          useDefault, el('span', {}, `Use the store default (${store.settings.defaultLowStock})`)),
        el('label.check-row', { htmlFor: 'bulk-suggest-threshold' },
          useSuggested, el('span', {}, 'Use each product’s suggested reorder point')),
        suggestHint
      )
    ),
    products.length ? el('p.hint', { style: { marginBottom: '14px' } },
      products.slice(0, 6).map((p) => p.name).join(', ')
      + (products.length > 6 ? `, and ${products.length - 6} more` : '')) : null,
    submit
  );

  syncThresholdRow();

  const modal = openModal({
    title: 'Edit products',
    content: form,
    // Anything picked here lands on the whole selection; losing it to a
    // stray tap means setting it all up again.
    unsaved: () => [categorySelect, locationSelect, supplierSelect].some((s) => s.value !== KEEP)
      || useDefault.checked || useSuggested.checked || threshold.value.trim() !== '',
  });
}
