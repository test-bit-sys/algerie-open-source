import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { inventoryStats, alertProducts, STATUS_LABELS } from '../lib/inventory.js';
import { stocktakeProgress } from '../lib/stocktake.js';
import { expiringProducts, lotDateLabel } from '../lib/lots.js';
import { activityLabel, kindIcon } from '../lib/activity.js';
import { EACH, formatQtyIn, qtyWithUnit, unitLabel } from '../lib/units.js';
import { productThumb, resetLazyThumbs } from '../ui/photo.js';
import { onOrderQty, reorderAlerts } from '../lib/reorder.js';
import { demandRates } from '../lib/demand.js';
import { replenishRows, replenishTotals } from '../lib/replenish.js';
import { formatMoney, formatQty, timeAgo } from '../lib/util.js';
import { openStockForm } from '../ui/stockform.js';
import { openProductForm } from '../ui/productform.js';
import { openImporter } from '../ui/importer.js';
import { openLocationForm } from '../ui/locationform.js';
import { productHref } from './product.js';
import { openSupplierForm } from '../ui/supplierform.js';

export function dashboardView() {
  const root = el('div.main-inner');
  const render = () => renderInto(root);
  store.addEventListener('change', render);
  render();
  root.destroy = () => {
    store.removeEventListener('change', render);
    // Alert rows that never scrolled into view are still held by the
    // lazy-thumbnail observer; leaving the view has to release them.
    resetLazyThumbs();
  };
  return root;
}

function renderInto(root) {
  // The alert rows about to be replaced take their pending thumbnails
  // with them, or every store change leaves nodes behind in the observer.
  resetLazyThumbs();
  clear(root);
  const s = store.settings;
  const stats = inventoryStats(store.products, s.defaultLowStock);
  const alerts = alertProducts(store.products, s.defaultLowStock);

  root.append(el('div.view-head', {},
    el('div', {},
      el('h1.view-title', {}, 'Overview'),
      el('p.view-sub', {}, greeting())
    )
  ));

  /* A basket half-scanned is the most interruptible thing in the app —
     a customer walks up, the phone locks — so it gets the same
     resume-me card a count does. */
  if (store.takeout) {
    const lines = store.takeout.lines.length;
    root.append(el('div.card', { style: { marginBottom: '16px' } }, el('div.row.row-stacks', {},
      el('span.item-ic.accent', { html: icon('packageMinus', 18) }),
      el('div.grow', {},
        el('div', { style: { fontWeight: 600, fontSize: '14.5px' } }, 'Take-out in progress'),
        el('div.small.muted', {},
          `${lines} line${lines === 1 ? '' : 's'} in the basket · started ${timeAgo(store.takeout.startedAt)}`)
      ),
      el('a.btn.btn-primary', { href: '#/takeout' }, 'Resume')
    )));
  }

  /* A count in progress is the day's main thread; keep it in reach. */
  if (store.stocktake) {
    const progress = stocktakeProgress(store.stocktake);
    root.append(el('div.card', { style: { marginBottom: '16px' } }, el('div.row.row-stacks', {},
      el('span.item-ic.accent', { html: icon('clipboard', 18) }),
      el('div.grow', {},
        el('div', { style: { fontWeight: 600, fontSize: '14.5px' } }, 'Stocktake in progress'),
        el('div.small.muted', {},
          `${store.stocktake.scope.label} · ${formatQty(progress.counted)} of ${formatQty(progress.total)} counted · started ${timeAgo(store.stocktake.startedAt)}`)
      ),
      el('a.btn.btn-primary', { href: '#/stocktake' }, 'Resume')
    )));
  }

  /* Stat tiles */
  root.append(el('div.stat-grid', {},
    stat('package', 'Products', formatQty(stats.products),
      `${formatQty(stats.units)} ${unitLabel(EACH, stats.units)} on hand${stats.measured ? ` · ${formatQty(stats.measured)} measured` : ''}`),
    stat('boxes', 'Stock value', formatMoney(stats.value, s.currency), 'At purchase cost'),
    stat('alert', 'Low stock', formatQty(stats.low), stats.low ? 'At or below threshold' : 'All above thresholds', stats.low ? 'attention' : ''),
    stat('circleAlert', 'Out of stock', formatQty(stats.out), stats.out ? 'Restock needed' : 'Nothing missing', stats.out ? 'critical' : '')
  ));

  /* Getting started (empty state) */
  if (!store.products.length) {
    root.append(
      el('h2.section-title', {}, 'Get started'),
      el('div.item-list', {},
        starterRow('plus', 'Add your first product', 'Name, SKU, cost, and where it lives', () => openProductForm()),
        starterRow('fileUp', 'Import a CSV', 'Bring an existing sheet; columns are detected automatically', () => openImporter()),
        starterRow('pin', 'Create locations', 'Warehouse, storefront, shelf, or bin', () => openLocationForm()),
        starterRow('truck', 'Add suppliers', 'Keep contacts and order notes at hand', () => openSupplierForm())
      )
    );
    return;
  }

  /* Stock in the wrong place — the daily job of moving things forward,
     which no total can show: a shelf can be empty while the stockroom is
     full, and both are "in stock". */
  const short = replenishRows(store.products);
  if (short.length) {
    const shortTotals = replenishTotals(short);
    const movable = short.filter((r) => r.moves.length).length;
    root.append(el('div.card', { style: { marginBottom: '16px' } }, el('div.row.row-stacks', {},
      el('span.item-ic.warn', { html: icon('move', 18) }),
      el('div.grow', {},
        el('div', { style: { fontWeight: 600, fontSize: '14.5px' } },
          `${formatQty(short.length)} ${short.length === 1 ? 'place is' : 'places are'} below minimum`),
        el('div.small.muted', {}, [
          movable ? `${formatQty(movable)} can be filled from stock you already have` : 'nothing on hand to move',
          shortTotals.buyRows ? `${formatQty(shortTotals.buyRows)} need buying` : null,
        ].filter(Boolean).join(' · '))
      ),
      el('a.btn.btn-secondary', { href: '#/locations' }, 'Replenish')
    )));
  }

  /* Low-stock alerts */
  root.append(el('h2.section-title', {},
    'Needs attention',
    alerts.length ? el('span.badge.low', {}, String(alerts.length)) : null
  ));
  if (!alerts.length) {
    root.append(el('div.card', {},
      el('div.row', {},
        el('span.item-ic.ok', { html: icon('check', 19) }),
        el('div.grow', {},
          el('div', { style: { fontWeight: 600, fontSize: '14.5px' } }, 'All stocked up'),
          el('div.small.muted', {}, 'No products are at or below their low-stock threshold.')
        )
      )
    ));
  } else {
    const incoming = onOrderQty(store.orders);
    /* What Reorder would still ask you to buy, worked out the way that
       page works it out — a badge here saying an order covers something
       has to mean the page agrees, coverage horizon and all. */
    const stillWanted = new Set(reorderAlerts(store.products, {
      defaultLow: s.defaultLowStock,
      incoming,
      rates: demandRates(store.activity).rates,
      coverageDays: s.coverageDays,
    }).map((line) => line.product.id));
    root.append(el('div.item-list', {},
      alerts.slice(0, 6).map(({ product: p, status }) => {
        const loc = store.locationById(p.locationId);
        const tone = status === 'out' ? 'danger' : 'warn';
        const inbound = incoming.get(p.id) || 0;
        // Enough already on its way to cover the shortfall: say so
        // instead of nagging.
        const covered = inbound > 0 && !stillWanted.has(p.id);
        return el('div.item-row.row-stacks', {},
          p.imagePath
            ? productThumb(p, { size: 36, tone })
            : el('span.item-ic', { className: `item-ic ${tone}`, html: icon(status === 'out' ? 'circleAlert' : 'alert', 18) }),
          el('div.grow', {},
            el('a.cell-link', { href: productHref(p.id) }, el('div.title', {}, p.name)),
            el('div.sub', {}, [
              STATUS_LABELS[status],
              inbound ? `${formatQtyIn(inbound, p.unit)} on order` : null,
              loc?.name,
              p.sku,
            ].filter(Boolean).join(' · '))
          ),
          el('span.alert-row-qty', {}, `${qtyWithUnit(p.quantity, p.unit)} left`),
          covered
            ? el('span.badge.ordered', { title: 'An open order covers this' }, 'Ordered')
            : el('button.btn.btn-secondary', {
              style: { padding: '6px 12px', fontSize: '13px' },
              'aria-label': `Restock ${p.name}`,
              onclick: () => openStockForm(p.id, { mode: 'add' }),
            }, 'Restock')
        );
      }),
      alerts.length > 6 && el('a.item-row', { href: '#/reorder', style: { justifyContent: 'center', color: 'var(--accent-text)', fontWeight: 600, fontSize: '13.5px' } },
        `View all ${alerts.length} in Reorder`)
    ));
  }

  /* Expiring soon — dated stock that needs selling or tossing. */
  const expiring = expiringProducts(store.products, { days: 30 });
  if (expiring.length) {
    root.append(el('h2.section-title', {},
      'Expiring soon',
      el('span.badge.low', {}, String(expiring.length))
    ));
    root.append(el('div.item-list', {},
      expiring.slice(0, 6).map(({ product: p, expired, soon, soonest, value }) => el('div.item-row.row-stacks', {},
        el('span.item-ic', { className: `item-ic ${expired > 0 ? 'danger' : 'warn'}`, html: icon('alert', 18) }),
        el('div.grow', {},
          el('div.title', {}, p.name),
          el('div.sub', {}, [
            expired > 0 ? `${qtyWithUnit(expired, p.unit)} expired` : null,
            soon > 0 ? `${qtyWithUnit(soon, p.unit)} expiring within 30 days` : null,
            expired <= 0 && soonest ? `earliest ${lotDateLabel(soonest)}` : null,
            formatMoney(value, s.currency),
          ].filter(Boolean).join(' · '))
        ),
        el('button.btn.btn-secondary', {
          style: { padding: '6px 12px', fontSize: '13px' },
          'aria-label': `Remove expiring stock of ${p.name}`,
          // Straight into a write-off, pre-tagged as expired.
          onclick: () => openStockForm(p.id, { mode: 'remove', reason: 'expired' }),
        }, 'Remove…')
      )),
      expiring.length > 6 && el('a.item-row', { href: '#/products?status=expiring', style: { justifyContent: 'center', color: 'var(--accent-text)', fontWeight: 600, fontSize: '13.5px' } },
        `View all ${expiring.length} in Products`)
    ));
  }

  /* Recent activity */
  root.append(el('h2.section-title', {}, 'Recent activity'));
  if (!store.activity.length) {
    root.append(el('div.card', {}, el('p.small.muted', {}, 'Stock changes will appear here.')));
  } else {
    root.append(el('div.item-list', {},
      store.activity.slice(0, 8).map((a) => {
        const exists = a.productId && store.productById(a.productId);
        const open = exists ? () => openStockForm(a.productId) : null;
        return el(open ? 'button.item-row' : 'div.item-row', { onclick: open },
          el('span.item-ic', { html: icon(kindIcon(a.kind), 17) }),
          el('div.grow', {},
            el('div.title', {}, a.name),
            el('div.sub', {}, [activityLabel(a), a.note].filter(Boolean).join(' · '))
          ),
          a.delta ? el('span.activity-delta', { className: `activity-delta ${a.delta > 0 ? 'pos' : 'neg'}` },
            `${a.delta > 0 ? '+' : ''}${formatQtyIn(a.delta, a.unit)}`) : null,
          el('span.small.muted', { style: { whiteSpace: 'nowrap' } }, timeAgo(a.at))
        );
      }),
      el('a.item-row', { href: '#/history', style: { justifyContent: 'center', color: 'var(--accent-text)', fontWeight: 600, fontSize: '13.5px' } },
        'View all history')
    ));
  }
}

function stat(ic, label, value, sub, tone = '') {
  return el('div.stat', { className: `stat ${tone}`.trim() },
    el('div.label', { html: icon(ic, 14, 2) }, el('span', {}, label)),
    el('div.value', {}, value),
    el('div.sub', {}, sub)
  );
}

function starterRow(ic, title, sub, onclick) {
  return el('button.item-row', { type: 'button', onclick },
    el('span.item-ic.accent', { html: icon(ic, 18) }),
    el('div.grow', {},
      el('div.title', {}, title),
      el('div.sub', {}, sub)
    ),
    el('span', { html: icon('chevR', 18), style: { color: 'var(--ink-3)' } })
  );
}

function greeting() {
  const h = new Date().getHours();
  const day = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return `Good ${part}. ${day}.`;
}
