/**
 * Build a kit: how many to make, where they land, and what it takes out
 * of stock to do it — spelled out before anything moves, because a build
 * is several removals and a receipt in one action.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { componentRows, componentsFor, buildableQty, kitUnitCost, limitingComponent } from '../lib/kits.js';
import { isCountUnit, roundQty, formatQtyIn, unitLabel, qtyWithUnit } from '../lib/units.js';
import { formatMoney } from '../lib/util.js';
import { UNASSIGNED, UNASSIGNED_LABEL } from '../lib/stock.js';

export function openBuildForm(productId, { onSaved } = {}) {
  const product = store.productById(productId);
  if (!product) return;
  const unit = product.unit;
  const counted = isCountUnit(unit);
  const most = buildableQty(product, store.products);
  const limit = limitingComponent(product, store.products);

  const qtyInput = el('input.input', {
    type: 'number', min: 0,
    step: counted ? 1 : 'any',
    inputmode: counted ? 'numeric' : 'decimal',
    value: String(most > 0 ? 1 : 0),
    'aria-label': 'How many to build',
    'data-autofocus': '',
    oninput: update,
  });

  const locSelect = store.locations.length
    ? el('select.select', { 'aria-label': 'Where the built kits land' },
      [...store.locations.map((l) => ({ id: l.id, name: l.name })), { id: UNASSIGNED, name: UNASSIGNED_LABEL }]
        .map((o) => el('option', { value: o.id, selected: o.id === (product.locationId || UNASSIGNED) }, o.name)))
    : null;

  const noteInput = el('input.input', { maxLength: 120, placeholder: 'e.g. Saturday prep' });
  const takes = el('div.item-list', { style: { marginTop: '8px' } });
  const summary = el('p.hint', { 'aria-live': 'polite' });
  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Build');

  const wanted = () => {
    const n = qtyInput.valueAsNumber;
    if (!Number.isFinite(n) || n <= 0) return 0;
    return roundQty(n, unit);
  };

  function update() {
    const n = wanted();
    const parts = componentsFor(product, n || 1, store.products);
    const unitCost = kitUnitCost(product, store.products);
    clear(takes);
    for (const row of componentRows(product, store.products)) {
      const need = parts.find((x) => x.productId === row.productId)?.qty ?? 0;
      const short = row.product && need > row.onHand;
      takes.append(el('div.item-row.row-stacks', {},
        el('span.item-ic', { className: `item-ic${short || row.missing ? ' warn' : ''}`, html: icon(short || row.missing ? 'alert' : 'package', 17) }),
        el('div.grow', {},
          el('div.title', {}, row.product?.name || 'Deleted product'),
          el('div.cell-sub', {}, row.missing
            ? 'No longer in the products list. The recipe can’t be built'
            : `${formatQtyIn(row.onHand, row.product.unit)} on hand · ${formatQtyIn(row.qty, row.product.unit)} per ${unitLabel(unit, 1)}`)
        ),
        el('strong', { style: short ? { color: 'var(--warn)' } : null },
          `${formatQtyIn(need, row.product?.unit)} ${unitLabel(row.product?.unit, need)}`)
      ));
    }
    const enough = n > 0 && n <= most;
    submit.disabled = !enough;
    summary.textContent = !most
      ? (limit?.missing
        ? 'A component is missing from the products list, so this can’t be built.'
        : `Not enough ${limit?.product?.name || 'components'} to build even one.`)
      : n > most
        ? `Only ${formatQtyIn(most, unit)} can be built with what's on hand: ${limit?.product?.name} runs out first.`
        : `Takes ${formatMoney(unitCost * (n || 0), store.settings.currency)} of components, `
          + `and adds ${qtyWithUnit(n, unit)} at ${formatMoney(unitCost, store.settings.currency)} each.`;
  }

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const n = wanted();
      if (!n) return;
      submit.disabled = true;
      try {
        await store.buildKit(product.id, {
          qty: n,
          locationId: locSelect ? locSelect.value : undefined,
          note: noteInput.value,
        });
        toast(`Built ${formatQtyIn(n, unit)} × ${product.name}`, { icon: 'boxes' });
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast(err?.message || 'Couldn’t build. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('p.confirm-message', { style: { marginBottom: '12px' } },
      el('strong', {}, product.name),
      most > 0
        ? `: enough components for ${formatQtyIn(most, unit)}.`
        : ': not enough components to build any.'),
    el('div.field', {},
      el('label', { htmlFor: 'build-qty' }, 'How many'),
      Object.assign(qtyInput, { id: 'build-qty' })
    ),
    locSelect
      ? el('div.field', {},
        el('label', { htmlFor: 'build-loc' }, 'Where they land'),
        el('div.select-wrap', {}, Object.assign(locSelect, { id: 'build-loc' }))
      )
      : null,
    el('div.field', {},
      el('label', {}, 'Takes out of stock'),
      takes
    ),
    el('div.field', {},
      el('label', { htmlFor: 'build-note' }, 'Note'),
      Object.assign(noteInput, { id: 'build-note' })
    ),
    summary,
    submit
  );

  update();
  const modal = openModal({
    title: 'Build',
    content: form,
    unsaved: () => noteInput.value.trim() !== '',
  });
}
