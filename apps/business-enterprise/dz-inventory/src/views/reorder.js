/**
 * Reorder: the alerts, grouped by who you buy them from, with a
 * suggested quantity per line and one tap to turn a group into an order
 * sheet — copied, downloaded, or emailed. Placed orders move to "On
 * order" and can be received in one go when the delivery lands.
 */

import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { reorderGroups, onOrderQty, lineRemaining, orderToText, orderRows, packNote } from '../lib/reorder.js';
import { demandRates, coverLabel, rateLabel } from '../lib/demand.js';
import { codeFor } from '../lib/sources.js';
import { STATUS_LABELS } from '../lib/inventory.js';
import { formatQtyIn, unitLabel, roundQty, isCountUnit } from '../lib/units.js';
import { toCSV } from '../lib/csv.js';
import { formatMoney, downloadFile, dateStamp, timeAgo } from '../lib/util.js';
import { productHref } from './product.js';
import { openReceiveForm } from '../ui/receiveform.js';
import { printSheet, printTable } from '../ui/print.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

export function reorderView() {
  const root = el('div.main-inner');

  /* Edited quantities, by product id, so typing survives a re-render. */
  const edits = new Map();
  /* Lines the user took out of this order. */
  const dropped = new Set();
  /* Lines switched to another supplier before the sheet is made, by
     product id. The choice is the user's and lives until it's used. */
  const sourcePick = new Map();

  const render = () => renderInto();
  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);

  function qtyFor(line) {
    return edits.has(line.product.id) ? edits.get(line.product.id) : line.suggested;
  }

  function renderInto() {
    clear(root);
    const currency = store.settings.currency;
    const demand = demandRates(store.activity);
    const groups = reorderGroups(store.products, {
      defaultLow: store.settings.defaultLowStock,
      suppliers: store.suppliers,
      incoming: onOrderQty(store.orders),
      // What the log knows: the list is ordered by how soon each shelf
      // empties, and — with a coverage horizon set — the suggested
      // quantity aims at that many days of demand instead of twice a
      // threshold.
      rates: demand.rates,
      coverageDays: store.settings.coverageDays,
      safetyDays: store.settings.safetyDays,
      sources: sourcePick,
    }).map((g) => ({ ...g, lines: g.lines.filter((l) => !dropped.has(l.product.id)) }))
      .filter((g) => g.lines.length);
    const open = store.openOrders();

    root.append(el('div.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Reorder'),
        el('p.view-sub', {}, 'What to buy, and who to buy it from')
      )
    ));

    if (!groups.length && !open.length) {
      // With lines set aside this is not "all clear" — saying so would
      // be false, and returning here would strand the only control
      // that brings them back.
      root.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('check', 26) }),
        el('h3', {}, dropped.size ? 'All lines set aside' : 'Nothing to reorder'),
        el('p', {}, dropped.size
          ? 'Every low-stock line here was set aside for now. They return on your next visit, or right away below.'
          : 'Everything is above its low-stock threshold. This list fills itself from the alerts.')
      )));
      if (!dropped.size) return;
    }

    if (groups.length) {
      const total = groups.reduce((n, g) => n + g.lines.length, 0);
      root.append(el('h2.section-title', {}, 'Needs ordering', el('span.badge.low', {}, String(total))));
      for (const group of groups) root.append(groupCard(group, currency));
      // Say what the order is, since it isn't alphabetical any more.
      const horizon = Math.max(0, Math.round(Number(store.settings.coverageDays) || 0));
      root.append(el('p.small.muted', { style: { margin: '10px 2px' } }, [
        'Most urgent first: empty shelves, then the least days of cover left.',
        horizon ? `Quantities aim at ${horizon} days of demand where the log knows the rate.` : null,
      ].filter(Boolean).join(' ')));
    }

    if (dropped.size) {
      root.append(el('p.small.muted', { style: { margin: '10px 2px' } },
        `${dropped.size} line${dropped.size === 1 ? '' : 's'} set aside. `,
        el('button.link-btn', { type: 'button', onclick: () => { dropped.clear(); render(); } }, 'Bring back')
      ));
    }

    if (open.length) {
      root.append(el('h2.section-title', {}, 'On order'));
      for (const order of open) root.append(orderCard(order));
    }
  }

  /* --- A supplier's draft order --- */

  function groupCard(group, currency) {
    const name = group.supplierId ? group.name : 'No supplier';
    const supplier = group.supplierId ? store.supplierById(group.supplierId) : null;
    const meta = el('div.small.muted');
    const minWarn = el('p.order-min-warning', { hidden: true, html: icon('alert', 14, 2) });
    const minWarnText = el('span');
    minWarn.append(minWarnText);
    const mailLink = supplier?.email
      ? el('a.btn.btn-secondary', { html: icon('send', 15, 2) }, ' Email')
      : null;

    /**
     * What a unit on this line will actually be billed at: the source's
     * own price where one is on file — the very number placeOrder
     * freezes onto the line, and receiving values the delivery at — and
     * the product's average cost only where nobody has written one down.
     *
     * The average cost is what stock happened to cost us last time,
     * possibly from a different supplier: checking a minimum order
     * against it reported a £500 order as £400 short of a £500 minimum,
     * which is the one question `minOrder` exists to answer.
     */
    const unitPrice = (l) => (l.source?.price ?? (Number(l.product.cost) || 0));
    const priced = group.lines.filter((l) => l.source?.price !== null && l.source?.price !== undefined).length;
    const basis = priced === group.lines.length
      ? 'at their prices'
      : (priced ? 'at their prices where known' : 'at cost');

    /* An edited quantity has to reach the summary, the minimum-order
       check, and the mailto link the moment it's typed: re-rendering the
       card would take the focus out of the field being used. */
    function syncTotals() {
      const total = group.lines.reduce((n, l) => n + qtyFor(l) * unitPrice(l), 0);
      meta.textContent = [
        `${group.lines.length} line${group.lines.length === 1 ? '' : 's'}`,
        `about ${formatMoney(total, currency)} ${basis}`,
        supplier?.leadTimeDays ? `usually arrives in ~${supplier.leadTimeDays} day${supplier.leadTimeDays === 1 ? '' : 's'}` : null,
        supplier?.email,
      ].filter(Boolean).join(' · ');
      if (mailLink) mailLink.href = mailtoFor(group, name, supplier);
      const min = Number(supplier?.minOrder) || 0;
      minWarn.hidden = !min || total >= min;
      if (!minWarn.hidden) {
        minWarnText.textContent = ` About ${formatMoney(min - total, currency)} short of the ${formatMoney(min, currency)} minimum ${name} asks for.`;
      }
    }
    syncTotals();

    return el('div.card.order-card', {},
      el('div.order-head', {},
        el('span.item-ic.accent', { html: icon('truck', 18) }),
        el('div.grow', {},
          el('h3', {}, name),
          meta
        )
      ),
      el('div.order-lines', {}, group.lines.map((line) => lineRow(line, syncTotals))),
      minWarn,
      el('div.order-actions', {},
        el('button.btn.btn-secondary', { type: 'button', html: icon('copy', 15, 2), onclick: () => copyOrder(group, name) }, ' Copy'),
        el('button.btn.btn-secondary', { type: 'button', html: icon('fileDown', 15, 2), onclick: () => downloadOrder(group, name) }, ' CSV'),
        el('button.btn.btn-secondary', { type: 'button', html: icon('printer', 15, 2), onclick: () => printOrder(group, name) }, ' Print'),
        mailLink,
        el('div.grow'),
        el('button.btn.btn-primary', { type: 'button', html: icon('cart', 15, 2), onclick: () => placeOrder(group, name) }, ' Mark as ordered')
      )
    );
  }

  function lineRow(line, onQtyChange) {
    const p = line.product;
    const qty = qtyFor(line);
    const input = el('input.input.order-qty', {
      type: 'number', min: 0,
      step: isCountUnit(p.unit) ? 1 : 'any',
      inputmode: isCountUnit(p.unit) ? 'numeric' : 'decimal',
      value: String(qty),
      'aria-label': `Order quantity for ${p.name}`,
      oninput: () => {
        const n = input.valueAsNumber;
        edits.set(p.id, Number.isFinite(n) && n > 0 ? roundQty(n, p.unit) : 0);
        note.textContent = packNote(edits.get(p.id), p, line.source);
        onQtyChange();
      },
    });
    const note = el('span.small.muted', {}, packNote(qty, p, line.source));

    /* More than one place to buy it: switch before the sheet is made,
       with what each one charges on the option itself. The app shows the
       cheapest; it never re-sources anything on its own. */
    const sourceSelect = line.sources.length > 1
      ? el('select.select.order-source', {
        'aria-label': `Buy ${p.name} from`,
        onchange: () => {
          sourcePick.set(p.id, sourceSelect.value);
          render();
        },
      }, line.sources.map((s) => {
        const supplier = store.supplierById(s.supplierId);
        const price = s.price === null ? null : formatMoney(s.price, store.settings.currency);
        const best = line.cheapest && line.cheapest.supplierId === s.supplierId && line.sources.some((x) => x.price !== null && x.supplierId !== s.supplierId);
        return el('option', { value: s.supplierId, selected: s.supplierId === line.source?.supplierId },
          [supplier?.name || 'No supplier', price, best ? 'cheapest' : null].filter(Boolean).join(' · '));
      }))
      : null;

    return el('div.order-line.row-stacks', {},
      el('div.grow', {},
        el('a.cell-link', { href: productHref(p.id) }, el('div.cell-main', {}, p.name)),
        el('div.cell-sub', {}, [
          STATUS_LABELS[line.status],
          `${formatQtyIn(p.quantity, p.unit)} ${unitLabel(p.unit, p.quantity)} on hand`,
          // Why this line is where it is in the list. An empty shelf
          // already says so in its status; what it hasn't said is how
          // much demand is going unmet while it stays empty.
          line.cover > 0
            ? `${coverLabel(line.cover)} at ${rateLabel(line.perDay, p.unit)}`
            : (line.perDay ? `selling ${rateLabel(line.perDay, p.unit)}` : null),
          line.incoming ? `${formatQtyIn(line.incoming, p.unit)} already on order` : null,
          // Their code, where we have one — it's what the order says.
          line.source?.code ? `their code ${line.source.code}` : p.sku,
        ].filter(Boolean).join(' · ')),
        sourceSelect ? el('div.select-wrap.order-source-wrap', {}, sourceSelect) : null
      ),
      note,
      el('div.order-qty-wrap', {}, input, el('span.small.muted', {}, unitLabel(p.unit, qty))),
      el('button.icon-btn', {
        type: 'button',
        html: icon('x', 16),
        'aria-label': `Leave ${p.name} out of this order`,
        title: 'Not this time',
        onclick: () => { dropped.add(p.id); render(); },
      })
    );
  }

  /** The group as an order object the sheet builders understand. */
  function sheetFor(group, name) {
    return {
      supplierName: group.supplierId ? name : '',
      lines: group.lines
        .map((l) => ({
          name: l.product.name,
          sku: l.product.sku,
          code: l.source?.code || codeFor(l.product, group.supplierId),
          unit: l.product.unit,
          qty: qtyFor(l),
        }))
        .filter((l) => l.qty > 0),
    };
  }

  async function copyOrder(group, name) {
    const text = orderToText(sheetFor(group, name), { title: 'Order', date: Date.now() });
    try {
      await navigator.clipboard.writeText(text);
      toast('Order copied', { icon: 'copy' });
    } catch {
      // Clipboard access can be denied; a file always works.
      downloadFile(`order-${dateStamp()}.txt`, text, 'text/plain');
      toast('Couldn’t copy, so it downloaded instead', { icon: 'fileDown' });
    }
  }

  function downloadOrder(group, name) {
    downloadFile(`order-${slug(name)}-${dateStamp()}.csv`, toCSV(orderRows(sheetFor(group, name))));
    toast('Order downloaded', { icon: 'fileDown' });
  }

  /** A paper order sheet: what to hand the supplier rep. */
  function printOrder(group, name) {
    const sheet = sheetFor(group, name);
    if (!sheet.lines.length) {
      toast('Nothing to print yet', { icon: 'info' });
      return;
    }
    const supplier = group.supplierId ? store.supplierById(group.supplierId) : null;
    const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    printSheet(
      printTable(
        [{ label: 'Qty', num: true }, { label: 'Unit' }, { label: 'Product' },
          { label: 'Their code' }, { label: 'Our SKU' }],
        sheet.lines.map((l) => [formatQtyIn(l.qty, l.unit), unitLabel(l.unit, l.qty), l.name, l.code || '', l.sku || ''])
      ),
      {
        title: `Order${sheet.supplierName ? `: ${sheet.supplierName}` : ''}`,
        subtitle: [date, `${sheet.lines.length} line${sheet.lines.length === 1 ? '' : 's'}`, supplier?.email].filter(Boolean).join(' · '),
        foot: supplier?.leadTimeDays ? `Usually arrives in ~${supplier.leadTimeDays} day${supplier.leadTimeDays === 1 ? '' : 's'}.` : '',
      }
    );
  }

  function mailtoFor(group, name, supplier) {
    const sheet = sheetFor(group, name);
    const subject = `Order: ${sheet.lines.length} item${sheet.lines.length === 1 ? '' : 's'}`;
    const body = orderToText(sheet, { title: 'Order', date: Date.now() });
    return `mailto:${encodeURIComponent(supplier.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function placeOrder(group, name) {
    const lines = group.lines.map((l) => ({ productId: l.product.id, qty: qtyFor(l) })).filter((l) => l.qty > 0);
    if (!lines.length) {
      toast('Nothing to order yet', { icon: 'info' });
      return;
    }
    try {
      const order = await store.placeOrder({ supplierId: group.supplierId, lines });
      for (const l of lines) { edits.delete(l.productId); sourcePick.delete(l.productId); }
      toast(`${order.reference} placed`, { icon: 'cart' });
    } catch (err) {
      console.error(err);
      toast('Couldn’t save the order. Check your connection', { icon: 'wifiOff' });
    }
  }

  /* --- A placed order --- */

  /** "expected ~Aug 10", from the supplier's usual lead time. */
  function expectedNote(order) {
    const days = Number(store.supplierById(order.supplierId)?.leadTimeDays) || 0;
    if (!days || !order.orderedAt) return null;
    // Calendar arithmetic, not orderedAt + days × 24h: the hour the
    // clocks give back in autumn makes that land short, and an order
    // placed in the small hours then reads as arriving a day early.
    const eta = new Date(order.orderedAt);
    eta.setDate(eta.getDate() + days);
    return `expected ~${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }

  function orderCard(order) {
    const partial = order.status === 'partial';
    const touched = order.lines.some((l) => (Number(l.received) || 0) > 0);
    return el('div.card.order-card', {},
      el('div.order-head', {},
        el('span.item-ic', { html: icon('cart', 18) }),
        el('div.grow', {},
          el('h3', {}, `${order.reference}${order.supplierName ? `: ${order.supplierName}` : ''}`),
          el('div.small.muted', {}, [
            `Placed ${timeAgo(order.orderedAt)}`,
            `${order.lines.length} line${order.lines.length === 1 ? '' : 's'}`,
            expectedNote(order),
          ].filter(Boolean).join(' · '))
        ),
        partial ? el('span.badge.low', { title: 'Some lines are still due' }, 'Partial') : null
      ),
      el('div.order-lines', {}, order.lines.map((l) => {
        const live = store.productById(l.productId);
        const got = Number(l.received) || 0;
        const remaining = lineRemaining(l);
        return el('div.order-line.row-stacks', {},
          el('div.grow', {},
            el('div.cell-main', {}, l.name),
            el('div.cell-sub', {}, [
              live
                ? `${formatQtyIn(live.quantity, live.unit)} ${unitLabel(live.unit, live.quantity)} on hand`
                : 'No longer in the products list',
              got ? `${formatQtyIn(got, l.unit)} of ${formatQtyIn(l.qty, l.unit)} received` : null,
            ].filter(Boolean).join(' · '))
          ),
          remaining > 0
            ? el('strong', {}, `${formatQtyIn(remaining, l.unit)} ${unitLabel(l.unit, remaining)}${got ? ' due' : ''}`)
            : el('span.badge.ok', {}, 'Received')
        );
      })),
      el('div.order-actions', {},
        // Cancelling implies nothing came; once something has, the honest
        // way out of a dead order is closing it short.
        touched
          ? el('button.btn.btn-ghost', { type: 'button', onclick: () => closeShort(order) }, 'Close short')
          : el('button.btn.btn-ghost', { type: 'button', onclick: () => cancel(order) }, 'Cancel order'),
        el('div.grow'),
        el('button.btn.btn-primary', {
          type: 'button', html: icon('packagePlus', 15, 2), onclick: () => openReceiveForm(order.id),
        }, ' Receive…')
      )
    );
  }

  async function closeShort(order) {
    const short = order.lines.filter((l) => lineRemaining(l) > 0).length;
    const ok = await confirmDialog({
      title: 'Close this order short?',
      message: `${order.reference} is marked finished with ${short} line${short === 1 ? '' : 's'} undelivered. What arrived stays received; the rest is recorded as never coming and goes back to the reorder list.`,
      confirmLabel: 'Close short',
      danger: false,
    });
    if (!ok) return;
    try {
      await store.closeOrderShort(order.id);
      toast(`${order.reference} closed short`, { icon: 'cart' });
    } catch (err) {
      console.error(err);
      toast('Couldn’t close. Check your connection', { icon: 'wifiOff' });
    }
  }

  async function cancel(order) {
    const ok = await confirmDialog({
      title: 'Cancel this order?',
      message: `${order.reference} is kept on record as cancelled, and its products go back to the reorder list. No stock changes.`,
      confirmLabel: 'Cancel order',
      // "Cancel" here would be the other answer to the question.
      cancelLabel: 'Keep order',
    });
    if (!ok) return;
    try {
      await store.cancelOrder(order.id);
      toast('Order cancelled', { icon: 'trash' });
    } catch (err) {
      console.error(err);
      toast('Couldn’t cancel. Check your connection', { icon: 'wifiOff' });
    }
  }

  render();
  return root;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'order';
