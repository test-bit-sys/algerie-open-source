import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { locationTotals } from '../lib/inventory.js';
import { UNASSIGNED, UNASSIGNED_LABEL, NO_LOCATION, bucketKey } from '../lib/stock.js';
import { replenishRows, replenishTotals, rowMoves } from '../lib/replenish.js';
import { EACH, formatQtyIn, unitLabel } from '../lib/units.js';
import { formatMoney, formatQty } from '../lib/util.js';
import { openLocationForm } from '../ui/locationform.js';
import { openStockForm } from '../ui/stockform.js';
import { openProductForm } from '../ui/productform.js';
import { productHref } from './product.js';
import { toast } from '../ui/toast.js';

export function locationsView() {
  const root = el('div.main-inner');
  /* Which bucket the replenish list is filtered to; null is everywhere.
     It can't be '' for that — '' is the unassigned bucket's own key. */
  const state = { locationId: null };
  const render = () => renderInto(root, state, render);
  store.addEventListener('change', render);
  render();
  root.destroy = () => store.removeEventListener('change', render);
  return root;
}

function renderInto(root, state, render) {
  clear(root);

  root.append(el('div.view-head', {},
    el('div', {},
      el('h1.view-title', {}, 'Locations'),
      el('p.view-sub', {}, 'Where your stock lives, and what each place should hold')
    ),
    el('div.view-actions', {},
      el('button.btn.btn-primary', { html: icon('plus', 16, 2.2), onclick: () => openLocationForm() }, ' Add location')
    )
  ));

  if (!store.locations.length) {
    root.append(el('div.card', {}, el('div.empty', {},
      el('div.empty-icon', { html: icon('pin', 26) }),
      el('h3', {}, 'No locations yet'),
      el('p', {}, 'Create warehouses, rooms, shelves, or bins, then assign products to them.'),
      el('button.btn.btn-primary', { onclick: () => openLocationForm() }, 'Add location')
    )));
    return;
  }

  const sorted = [...store.locations].sort((a, b) => a.name.localeCompare(b.name));
  const loose = locationTotals(store.products, UNASSIGNED);
  /* Every shortfall in the account, so each card can count its own
     without asking the same question once per card. */
  const allShort = replenishRows(store.products);
  const shortBy = new Map();
  for (const row of allShort) shortBy.set(row.locationId, (shortBy.get(row.locationId) || 0) + 1);

  /* The card's shortfall count and the replenish list below are the same
     question; the link narrows the list rather than leaving the page. */
  const showShort = (id) => {
    state.locationId = id;
    render();
    document.getElementById('replenish')?.scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  root.append(el('div.entity-grid', {},
    sorted.map((l) => card({
      icon: 'warehouse',
      accent: true,
      title: l.name,
      sub: l.note,
      totals: locationTotals(store.products, l.id),
      short: shortBy.get(l.id) || 0,
      onShort: () => showShort(l.id),
      locationId: l.id,
      onEdit: () => openLocationForm(l),
    })),
    loose.products ? card({
      icon: 'circleAlert',
      title: UNASSIGNED_LABEL,
      sub: 'Stock not assigned anywhere yet',
      totals: loose,
      short: shortBy.get(UNASSIGNED) || 0,
      onShort: () => showShort(UNASSIGNED),
      locationId: NO_LOCATION,
    }) : null
  ));

  renderReplenish(root, state, render, allShort);
}

/* ---------- Replenish ---------- */

/**
 * What to move where: every place holding less than its minimum, with
 * the transfer that would fix it and a source picked from wherever the
 * stock actually sits. Buying is Reorder's job — a shortfall no shelf
 * can supply says so and links there instead of suggesting an
 * impossible move.
 */
function renderReplenish(root, state, render, allRows) {
  const rows = state.locationId === null
    ? allRows
    : replenishRows(store.products, { locationId: state.locationId });
  const anyMinimums = allRows.length > 0 || store.products.some((p) => p.min && Object.keys(p.min).length);
  if (!anyMinimums) {
    root.append(
      el('h2.section-title', { id: 'replenish' }, 'Replenish'),
      el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('move', 26) }),
        el('h3', {}, 'No minimums set yet'),
        el('p', {}, 'Give a product a minimum for a place (on its edit sheet, under “Minimums per location”) '
          + 'and anything below it shows up here with a suggested transfer.')
      ))
    );
    return;
  }

  const totals = replenishTotals(rows);
  const currency = store.settings.currency;

  const filter = el('select.select', {
    'aria-label': 'Filter the replenish list by location',
    onchange: () => {
      state.locationId = filter.value === '*' ? null : bucketKey(filter.value);
      render();
    },
  },
    el('option', { value: '*', selected: state.locationId === null }, 'Everywhere'),
    [...store.locations]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => el('option', { value: l.id, selected: state.locationId === l.id }, l.name)),
    // NO_LOCATION, not '': the unassigned bucket's real key is the empty
    // string, which is also how "no filter" would read.
    el('option', { value: NO_LOCATION, selected: state.locationId === UNASSIGNED }, UNASSIGNED_LABEL)
  );

  const movable = rows.filter((r) => r.moves.length);
  const moveAll = el('button.btn.btn-primary', {
    type: 'button',
    disabled: !movable.length,
    html: icon('move', 15, 2),
    onclick: () => applyMoves(movable),
  }, ` Move ${movable.length ? formatQty(movable.length) : ''} ${movable.length === 1 ? 'line' : 'lines'}`);

  root.append(
    el('h2.section-title', { id: 'replenish' }, 'Replenish',
      rows.length ? el('span.badge.low', {}, String(rows.length)) : null,
      el('div.grow'),
      el('div.select-wrap', {}, filter)
    ),
    !rows.length
      ? el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('check', 26) }),
        el('h3', {}, 'Every place has what it should'),
        el('p', {}, state.locationId === null
          ? 'Nothing anywhere is below its minimum.'
          : 'Nothing here is below its minimum.')
      ))
      : el('div.card', {},
        el('div.report-head', {},
          el('div', {},
            el('h3.report-title', {},
              `${formatQty(totals.rows)} ${totals.rows === 1 ? 'place' : 'places'} short`),
            el('p.small.muted', {}, [
              totals.units ? `${formatQty(totals.units)} ${unitLabel(EACH, totals.units)} to make up` : null,
              `${formatMoney(totals.value, currency)} at cost`,
              totals.buyRows ? `${totals.buyRows} need buying, not moving` : null,
            ].filter(Boolean).join(' · '))
          ),
          moveAll
        ),
        el('div.item-list', { style: { marginTop: '12px' } }, rows.map(replenishRow))
      )
  );
}

function replenishRow(row) {
  const p = row.product;
  const from = row.moves
    .map((m) => `${formatQtyIn(m.qty, p.unit)} from ${store.locationName(m.from)}`)
    .join(' + ');

  return el('div.item-row.row-stacks.replenish-row', {},
    el('span.item-ic', { className: `item-ic ${row.moves.length ? 'warn' : 'danger'}`, html: icon(row.moves.length ? 'move' : 'cart', 17) }),
    el('div.grow', {},
      el('a.cell-link', { href: productHref(p.id) }, el('div.title', {}, p.name)),
      el('div.cell-sub', {}, [
        `${formatQtyIn(row.need, p.unit)} ${unitLabel(p.unit, row.need)} short at ${store.locationName(row.locationId)}`,
        from || null,
        row.buy > 0 ? `${formatQtyIn(row.buy, p.unit)} nowhere in stock` : null,
      ].filter(Boolean).join(' · '))
    ),
    // A shortfall nothing can cover is a purchase, and Reorder is where
    // purchases live — saying so beats offering a move that can't happen.
    row.moves.length
      ? el('button.btn.btn-secondary', {
        type: 'button',
        html: icon('move', 15, 2),
        onclick: () => applyMoves([row]),
      }, ' Move')
      : el('a.btn.btn-secondary', { href: '#/reorder', html: icon('cart', 15, 2) }, ' Buy it'),
    el('button.icon-btn', {
      type: 'button',
      html: icon('pencil', 16),
      'aria-label': `Edit ${p.name}`,
      title: 'Edit the product and its minimums',
      onclick: () => openProductForm(p),
    }),
    el('button.icon-btn', {
      type: 'button',
      html: icon('packagePlus', 16),
      'aria-label': `Adjust stock of ${p.name}`,
      title: 'Adjust stock',
      onclick: () => openStockForm(p.id),
    })
  );
}

/** Perform a plan through the store, with one undo for the whole batch. */
async function applyMoves(rows) {
  const moves = rows.flatMap(rowMoves);
  if (!moves.length) {
    toast('Nothing left to move', { icon: 'info' });
    return;
  }
  try {
    const token = await store.transferMany(moves, { note: 'Replenishment' });
    if (!token) {
      toast('Nothing left to move. That stock has already gone', { icon: 'info' });
      return;
    }
    toast(`${token.count} move${token.count === 1 ? '' : 's'} done`, {
      icon: 'move',
      action: {
        label: 'Undo',
        onClick: () => store.undoTransfers(token).catch(() => {
          toast('Couldn’t undo. Check your connection', { icon: 'wifiOff' });
        }),
      },
    });
  } catch (err) {
    console.error(err);
    toast('Couldn’t move it. Check your connection', { icon: 'wifiOff' });
  }
}

/* ---------- Location cards ---------- */

function card({ icon: ic, accent = false, title, sub, totals, short = 0, onShort = null, locationId, onEdit = null }) {
  return el('div.card.entity-card', {},
    el('div.head', {},
      el('span.item-ic', { className: `item-ic${accent ? ' accent' : ''}`, html: icon(ic, 18) }),
      el('div.grow', {},
        el('h3', {}, title),
        sub ? el('div.small.muted', {}, sub) : null
      ),
      onEdit && el('div.actions', {},
        el('button.icon-btn', {
          html: icon('pencil', 16),
          'aria-label': `Edit ${title}`,
          onclick: onEdit,
        })
      )
    ),
    el('div.entity-stats', {},
      el('span', {}, el('strong', {}, formatQty(totals.products)), ` product${totals.products === 1 ? '' : 's'}`),
      el('span', {}, el('strong', {}, formatQty(totals.units)), ` ${unitLabel(EACH, totals.units)}`),
      totals.measured ? el('span', {}, el('strong', {}, formatQty(totals.measured)), ' measured') : null,
      el('span', {}, el('strong', {}, formatMoney(totals.value, store.settings.currency)), ' at cost')
    ),
    // What this place is missing, as a way into the list that fixes it.
    short
      ? el('button.entity-link.warn-link', { type: 'button', onclick: onShort },
        el('span', { html: icon('alert', 15) }),
        ` ${formatQty(short)} below minimum`)
      : null,
    totals.products ? el('a.entity-link', { href: `#/products?location=${encodeURIComponent(locationId)}` },
      'See what’s here', el('span', { html: icon('chevR', 15) })) : null
  );
}
