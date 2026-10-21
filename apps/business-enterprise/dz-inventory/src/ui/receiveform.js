/**
 * Receive a purchase order line by line. Every line still due is listed
 * with an editable arrived quantity, prefilled with the outstanding
 * amount so the common everything-arrived case stays two taps. Amounts
 * land through the store's receiving path (product's usual location,
 * noted with the order reference); lines left short keep the order open
 * as partial.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { lineRemaining } from '../lib/reorder.js';
import { isCountUnit, roundQty, formatQtyIn, unitLabel } from '../lib/units.js';
import { formatMoney } from '../lib/util.js';

export function openReceiveForm(orderId, { onSaved } = {}) {
  const order = store.orderById(orderId);
  if (!order) return;

  /** Editable rows: lines still due whose product still exists. */
  const rows = order.lines
    .map((line) => ({ line, product: store.productById(line.productId), remaining: lineRemaining(line) }))
    .filter((r) => r.remaining > 0);
  const gone = rows.filter((r) => !r.product);
  const due = rows.filter((r) => r.product);

  const inputs = new Map();
  const costs = new Map();
  /* Each line's prefill (the outstanding amount, and the price the order
     was placed at); a value that differs is an edit the scrim must not
     silently discard. */
  const prefills = new Map();

  function lineRow({ line, product, remaining }) {
    const counted = isCountUnit(product.unit);
    const input = el('input.input.order-qty', {
      type: 'number', min: 0,
      step: counted ? 1 : 'any',
      inputmode: counted ? 'numeric' : 'decimal',
      value: String(remaining),
      'aria-label': `Arrived quantity for ${line.name}`,
      oninput: update,
    });
    inputs.set(line.productId, input);
    prefills.set(line.productId, input.value);
    /* What each unit cost, prefilled from the price the order was placed
       at — the supplier's own, from the source it went to. It folds into
       the moving average, so buying from a cheaper source shows up in
       the stock value; cleared, nothing about cost changes. */
    const cost = el('input.input.order-qty', {
      type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
      value: line.price === null || line.price === undefined ? '' : String(line.price),
      placeholder: 'Cost',
      'aria-label': `Cost per ${unitLabel(line.unit, 1)} of ${line.name}`,
      oninput: update,
    });
    costs.set(line.productId, cost);
    prefills.set(`${line.productId}:cost`, cost.value);
    const already = Number(line.received) || 0;
    return el('div.order-line.row-stacks', {},
      el('div.grow', {},
        el('div.cell-main', {}, line.name),
        el('div.cell-sub', {}, [
          `${formatQtyIn(line.qty, line.unit)} ${unitLabel(line.unit, line.qty)} ordered`,
          already ? `${formatQtyIn(already, line.unit)} already received` : null,
          line.price !== null && line.price !== undefined
            ? `ordered at ${formatMoney(line.price, store.settings.currency)}`
            : null,
          line.code || line.sku,
        ].filter(Boolean).join(' · '))
      ),
      el('div.order-qty-wrap', {}, input, el('span.small.muted', {}, unitLabel(line.unit, remaining))),
      el('div.order-qty-wrap', {}, cost, el('span.small.muted', {}, 'each'))
    );
  }

  /** The entered amounts, dropping blanks and zeros. */
  function entered() {
    const out = [];
    for (const { line, product } of due) {
      const input = inputs.get(line.productId);
      const n = input.valueAsNumber;
      if (!Number.isFinite(n) || n <= 0) continue;
      const qty = roundQty(n, product.unit);
      if (qty <= 0) continue;
      const cost = costs.get(line.productId);
      const paid = cost.value.trim() === '' ? null : cost.valueAsNumber;
      // null is a value here — "the field was cleared, don't revalue" —
      // so it travels as one rather than being left out.
      out.push({ productId: line.productId, qty, cost: Number.isFinite(paid) && paid >= 0 ? paid : null });
    }
    return out;
  }

  const summary = el('p.hint', { 'aria-live': 'polite' });
  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Receive');

  function update() {
    if (!due.length) {
      submit.disabled = true;
      summary.textContent = 'Nothing here can be received anymore.';
      return;
    }
    const list = entered();
    const shortLines = due.filter(({ line, product }) => {
      const n = inputs.get(line.productId).valueAsNumber;
      const qty = Number.isFinite(n) && n > 0 ? roundQty(n, product.unit) : 0;
      return qty < lineRemaining(line);
    }).length;
    submit.disabled = !list.length;
    summary.textContent = !list.length
      ? 'Enter what actually arrived; a line left at 0 stays on order.'
      : shortLines
        ? `${shortLines} line${shortLines === 1 ? '' : 's'} short. The order stays open for the rest.`
        : 'Everything still due arrives; the order is complete.';
  }

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const list = entered();
      if (!list.length) return;
      submit.disabled = true;
      try {
        const n = await store.receiveOrderLines(order.id, list);
        const done = store.orderById(order.id)?.status === 'received';
        toast(done
          ? `${order.reference} received in full`
          : `Received ${n} line${n === 1 ? '' : 's'}; the rest stays on order`, { icon: 'packagePlus' });
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        if (err.committed) {
          modal.close();
          onSaved?.();
        } else submit.disabled = false;
        toast(err.message || 'Couldn’t receive. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('p.confirm-message', { style: { marginBottom: '12px' } },
      'Each amount is added to stock at its usual location and noted as ',
      el('strong', {}, order.reference),
      '. Adjust a line down if the delivery came short, or its cost if the invoice says otherwise.'
    ),
    el('div.order-lines', { style: { marginBottom: '10px' } }, due.map(lineRow)),
    gone.length
      ? el('p.small.muted', { style: { margin: '0 0 10px' } },
        `${gone.length} line${gone.length === 1 ? ' is' : 's are'} no longer in the products list and can’t be received.`)
      : null,
    summary,
    submit
  );

  update();
  const modal = openModal({
    title: `Receive ${order.reference}`,
    content: form,
    unsaved: () => due.some(({ line }) => inputs.get(line.productId).value !== prefills.get(line.productId)
      || costs.get(line.productId).value !== prefills.get(`${line.productId}:cost`)),
  });
  // The dialog opens with focus in the first line's amount, prefilled
  // with what's outstanding. That prefill is there to be typed over when
  // the delivery came short — with the caret merely parked after it, a
  // line of 12 due became 125 on the first keystroke.
  const first = due.length ? inputs.get(due[0].line.productId) : null;
  if (first && document.activeElement === first) first.select();
}
