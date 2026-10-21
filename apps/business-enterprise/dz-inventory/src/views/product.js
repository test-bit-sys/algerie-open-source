/**
 * One product, read first: `#/product/<id>`.
 *
 * Every fact on this page is already stored somewhere — stock per
 * location in the edit form's read-only block, lots in the expiry
 * section, on-order units on the products row, movement in Reports, the
 * log behind a query string. Answering "what's going on with this one?"
 * meant visiting four screens, and every drill-down in the app ended in
 * a form full of inputs the user didn't come to change.
 *
 * So this is a view, not a form: it states, and it offers the actions
 * that belong to the thing it's stating. Editing still happens in the
 * sheet, opened on top.
 */

import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { stockStatus, statusOf, STATUS_LABELS } from '../lib/inventory.js';
import { stockEntries, stockAt, minAt, shortfallAt, minMap, binAt, UNASSIGNED } from '../lib/stock.js';
import { allLots, lotsAt, lotDateLabel, expiryStatus, dayStamp, dayStampIn } from '../lib/lots.js';
import { onOrderQty, lineRemaining, OPEN_ORDER_STATUSES } from '../lib/reorder.js';
import { demandRates, coverDays, coverLabel, rateLabel, runningOut } from '../lib/demand.js';
import { sourcesOf, cheapestSource, leadTimeFrom, packSizeFrom } from '../lib/sources.js';
import { familyTotals, variantLabel } from '../lib/variants.js';
import {
  kitMode, componentRows, buildableQty, kitUnitCost, limitingComponent, kitsUsing, isKit,
} from '../lib/kits.js';
import { openBuildForm } from '../ui/buildform.js';
import { openVariantForm, openFamilyForm } from '../ui/familyform.js';
import { movementSeries, salesRows, salesTotals, marginFor } from '../lib/reports.js';
import { activityLabel, kindIcon, kindLabel } from '../lib/activity.js';
import { formatQtyIn, unitLabel, qtyWithUnit, packSizeOf, packLabel, qtyValue } from '../lib/units.js';
import { formatMoney, timeAgo, round2 } from '../lib/util.js';
import { lineChart } from '../ui/chart.js';
import { productThumb, resetLazyThumbs } from '../ui/photo.js';
import { openProductForm } from '../ui/productform.js';
import { openStockForm } from '../ui/stockform.js';
import { openLabelForm } from '../ui/labelform.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

/** The id in `#/product/<id>`, or '' when the hash names none. */
export function productIdFromHash(hash = location.hash) {
  const path = String(hash || '').split('?')[0];
  const match = /^#\/product\/(.+)$/.exec(path);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A truncated or hand-typed link can hold a percent that decodes to
    // nothing ("#/product/%"). decodeURIComponent throws on that, and it
    // threw out of the router — so the app stopped dead on whatever view
    // was already up, naming the wrong thing in the tab, instead of
    // reaching the "not found" state this page has for exactly this.
    // Undecodable is still an id: it just isn't one in the account.
    return match[1];
  }
}

/** Where a product's page lives, for every row and card that links here. */
export const productHref = (id) => `#/product/${encodeURIComponent(id)}`;

const MOVEMENT_DAYS = 30;

export function productView() {
  const root = el('div.main-inner.product-page');
  const id = productIdFromHash();

  const render = () => renderInto();
  store.addEventListener('change', render);
  root.destroy = () => {
    store.removeEventListener('change', render);
    // The photo leaving with this page shouldn't stay alive in the
    // lazy-thumbnail observer.
    resetLazyThumbs();
  };

  function renderInto() {
    resetLazyThumbs();
    clear(root);
    const p = store.productById(id);
    if (!p) {
      // A bookmark can outlive the thing it points at; say so rather
      // than showing an empty page.
      append(root, [
        el('div.view-head', {}, el('div', {},
          el('h1.view-title', {}, 'Product not found'),
          el('p.view-sub', {}, 'It may have been deleted.')
        )),
        el('div.card', {}, el('div.empty', {},
          el('div.empty-icon', { html: icon('package', 26) }),
          el('h3', {}, 'Nothing here'),
          el('p', {}, 'This product isn’t in the account any more.'),
          el('a.btn.btn-primary', { href: '#/products' }, 'Back to products')
        )),
      ]);
      return;
    }

    const currency = store.settings.currency;
    const money = (n) => formatMoney(n, currency);
    // A sell-as-kit is judged on what its components allow, not on the
    // stock it never holds.
    const status = p.archived
      ? 'archived'
      : statusOf(p, store.products, store.settings.defaultLowStock);
    const onOrder = onOrderQty(store.orders).get(p.id) || 0;
    const demand = demandRates(store.activity);
    const perDay = demand.rates.get(p.id) || 0;
    const cover = coverDays(p, perDay);
    const leadTimeDays = store.supplierById(p.supplierId)?.leadTimeDays;
    const urgent = runningOut(p, { perDay, leadTimeDays, safetyDays: store.settings.safetyDays });

    append(root, [
      el('a.back-link', { href: '#/products' }, el('span', { html: icon('chevL', 16, 2.2) }), ' Products'),
      header(p, status, urgent),
      tiles(p, { money, onOrder, perDay, cover, urgent }),
      familyCard(p),
      kitCard(p),
      stockCard(p),
      usedInCard(p),
      lotsCard(p),
      sourcesCard(p),
      ordersCard(p, onOrder),
      movementCard(p, { money, perDay, cover, demand }),
      activityCard(p),
      p.notes ? el('div.card', {},
        el('h3.report-title', {}, 'Notes'),
        el('p.small', { style: { marginTop: '6px', whiteSpace: 'pre-wrap' } }, p.notes)
      ) : null,
    ]);
  }

  /* ---------- Header ---------- */

  function header(p, status, urgent) {
    const supplier = store.supplierById(p.supplierId);
    return el('div.card.product-hero', {},
      el('div.product-hero-main', {},
        productThumb(p, { size: 88 }),
        el('div.grow', {},
          el('h1.view-title', {}, p.name),
          el('p.product-hero-meta', {}, [
            p.sku ? el('span.mono', {}, p.sku) : null,
            p.barcode ? el('span.mono', {}, p.barcode) : null,
            p.category || null,
            supplier
              ? el('a', { href: `#/products?supplier=${encodeURIComponent(supplier.id)}` }, supplier.name)
              : null,
            packSizeOf(p) ? `${formatQtyIn(packSizeOf(p), p.unit)} per ${packLabel(p, 1)}` : null,
          ].filter(Boolean).flatMap((part, i) => (i ? [' · ', part] : [part]))),
          el('div.product-hero-badges', {},
            el('span.badge', { className: `badge ${status}` }, STATUS_LABELS[status]),
            urgent && status === 'ok' ? el('span.badge.low', {}, 'Running out') : null,
            p.trackExpiry ? el('span.badge', {}, 'Expiry tracked') : null
          )
        )
      ),
      el('div.product-hero-actions', {},
        el('button.btn.btn-primary', {
          type: 'button', html: icon('packagePlus', 16, 2),
          onclick: () => openStockForm(p.id),
        }, ' Adjust stock'),
        kitMode(p) === 'build'
          ? el('button.btn.btn-secondary', {
            type: 'button', html: icon('boxes', 16, 2),
            onclick: () => openBuildForm(p.id),
          }, ' Build')
          : null,
        el('button.btn.btn-secondary', {
          type: 'button', html: icon('pencil', 16, 2),
          onclick: () => openProductForm(p),
        }, ' Edit'),
        el('button.btn.btn-secondary', {
          type: 'button', html: icon('barcode', 16, 2),
          onclick: () => openLabelForm([p.id]),
        }, ' Label'),
        el('button.btn.btn-secondary', {
          type: 'button', html: icon('copy', 16, 2),
          onclick: () => openProductForm(null, {
            // SKU and barcode identify one product each, so the copy
            // starts without them rather than opening with a clash.
            prefill: { ...p, name: `${p.name} copy`, sku: '', barcode: '', quantity: 0, archived: false },
          }),
        }, ' Duplicate'),
        el('button.btn.btn-secondary', {
          type: 'button',
          html: icon(p.archived ? 'archiveRestore' : 'archive', 16, 2),
          onclick: () => archiveOrRestore(p),
        }, p.archived ? ' Restore' : ' Archive')
      ),
      p.archived
        ? el('p.form-banner', { html: icon('archive', 15, 2) },
          el('span', {}, 'Archived: out of the products list, the totals, and the alerts. Its SKU stays reserved.'))
        : null
    );
  }

  async function archiveOrRestore(p) {
    if (!p.archived) {
      const ok = await confirmDialog({
        title: 'Archive product?',
        message: `"${p.name}" leaves the products list, totals, and alerts, but keeps its details, threshold, SKU, and history. You can restore it anytime.`,
        confirmLabel: 'Archive',
        danger: false,
      });
      if (!ok) return;
    }
    try {
      await store.setArchived(p.id, !p.archived);
      toast(p.archived ? 'Product restored' : 'Product archived', {
        icon: p.archived ? 'archiveRestore' : 'archive',
      });
    } catch (err) {
      console.error(err);
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
    }
  }

  /* ---------- Headline figures ---------- */

  function tiles(p, { money, onOrder, perDay, cover, urgent }) {
    const margin = marginFor(p, store.products)?.percent ?? null;
    // A sell-as-kit holds nothing on purpose; what it can do comes from
    // its components, so that's the number in the first tile.
    if (kitMode(p) === 'sell') {
      const can = buildableQty(p, store.products);
      const limit = limitingComponent(p, store.products);
      return el('div.stat-grid', {},
        tile('boxes', 'Can sell', formatQtyIn(can, p.unit),
          limit?.product ? `${limit.product.name} runs out first` : 'From its components',
          can <= 0 ? 'critical' : ''),
        tile('package', 'Components', String(componentRows(p, store.products).length), 'It holds no stock of its own'),
        tile('percent', 'Margin',
          margin === null ? '–' : `${margin}%`,
          p.price ? `${money(p.price)} price, ${money(kitUnitCost(p, store.products))} of components` : 'No selling price set',
          margin !== null && margin < 0 ? 'critical' : ''),
        tile('chart', 'Cover',
          cover === null ? '–' : `${cover >= 10 ? Math.round(cover) : cover}d`,
          perDay ? rateLabel(perDay, p.unit) : 'Nothing has sold recently')
      );
    }
    return el('div.stat-grid', {},
      tile('package', 'On hand', formatQtyIn(p.quantity, p.unit), [
        unitLabel(p.unit, p.quantity),
        onOrder ? `${formatQtyIn(onOrder, p.unit)} on order` : null,
      ].filter(Boolean).join(' · '), p.quantity <= 0 ? 'critical' : ''),
      tile('boxes', 'Stock value', money(qtyValue(p.quantity, p.cost)),
        `${money(p.cost)} per ${unitLabel(p.unit, 1)} at cost`),
      tile('percent', 'Margin',
        margin === null ? '–' : `${margin}%`,
        p.price ? `${money(p.price)} price, ${money(round2(p.price - p.cost))} per ${unitLabel(p.unit, 1)}` : 'No selling price set',
        margin !== null && margin < 0 ? 'critical' : ''),
      tile('chart', 'Cover',
        cover === null ? '–' : `${cover >= 10 ? Math.round(cover) : cover}d`,
        perDay ? rateLabel(perDay, p.unit) : 'Nothing has sold recently',
        urgent ? 'attention' : '')
    );
  }

  function tile(ic, label, value, sub, tone = '') {
    return el('div.stat', { className: `stat ${tone}`.trim() },
      el('div.label', { html: icon(ic, 14, 2) }, el('span', {}, label)),
      el('div.value', {}, value),
      el('div.sub', {}, sub)
    );
  }

  /* ---------- The family it belongs to ---------- */

  /**
   * A variant's siblings, and what the family adds up to — the one line
   * of money for the thing the owner actually thinks of as a product.
   */
  function familyCard(p) {
    const family = store.familyOf(p);
    if (!family) return null;
    const variants = store.variantsOf(family.id);
    const totals = familyTotals(variants, store.settings.defaultLowStock);
    const currency = store.settings.currency;
    return el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, family.name),
          el('p.small.muted', {}, [
            `${totals.variants} variant${totals.variants === 1 ? '' : 's'}`,
            `${formatQtyIn(totals.units, family.unit || p.unit)} ${unitLabel(family.unit || p.unit, totals.units)} across the family`,
            `${formatMoney(totals.value, currency)} at cost`,
          ].join(' · '))
        ),
        el('span.badge', { className: `badge ${totals.status}` }, STATUS_LABELS[totals.status])
      ),
      el('div.item-list', { style: { marginTop: '12px' } }, variants.map((v) => {
        const here = v.id === p.id;
        const status = v.archived ? 'archived' : stockStatus(v, store.settings.defaultLowStock);
        return el(here ? 'div.item-row' : 'a.item-row', {
          href: here ? null : productHref(v.id),
          className: `item-row${here ? ' is-current' : ''}`,
        },
          el('span.item-ic', { className: `item-ic${here ? ' accent' : ''}`, html: icon('boxes', 17) }),
          el('div.grow', {},
            el('div.title', {}, variantLabel(v.axes, family.axes) || v.name,
              here ? el('span.small.muted', {}, ' (this one)') : null),
            el('div.cell-sub', {}, [v.sku, STATUS_LABELS[status]].filter(Boolean).join(' · '))
          ),
          el('strong', {}, `${formatQtyIn(v.quantity, v.unit)} ${unitLabel(v.unit, v.quantity)}`)
        );
      })),
      el('div.product-hero-actions', { style: { marginTop: '12px' } },
        el('button.btn.btn-secondary', {
          type: 'button', html: icon('plus', 16, 2.2),
          onclick: () => openVariantForm(family),
        }, ' Add variant'),
        el('button.btn.btn-secondary', {
          type: 'button', html: icon('boxes', 16, 2),
          onclick: () => openFamilyForm(family),
        }, ' Edit the family')
      )
    );
  }

  /* ---------- Stock by location ---------- */

  function stockCard(p) {
    // A sell-as-kit's stock is its components', and the card above says so.
    if (kitMode(p) === 'sell') return null;
    const entries = stockEntries(p);
    const mins = minMap(p);
    /* Places holding stock, plus places that should hold some and
       don't — an empty shelf with a minimum is exactly what needs
       looking at. */
    const keys = [...new Set([...entries.map(([k]) => k), ...Object.keys(mins)])];
    if (!keys.length) keys.push(p.locationId || UNASSIGNED);

    return el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, 'Stock by location'),
          el('p.small.muted', {}, `${qtyWithUnit(p.quantity, p.unit)} in total`)
        ),
        store.locations.length > 1 && p.quantity > 0
          ? el('button.btn.btn-secondary', {
            type: 'button', html: icon('move', 15, 2),
            onclick: () => openStockForm(p.id, { mode: 'move' }),
          }, ' Move')
          : null
      ),
      el('div.item-list', { style: { marginTop: '12px' } }, keys.map((key) => {
        const qty = stockAt(p, key);
        const min = minAt(p, key);
        const short = shortfallAt(p, key);
        const lots = p.trackExpiry ? lotsAt(p, key) : [];
        const bin = binAt(p, key);
        return el('div.item-row.row-stacks', {},
          el('span.item-ic', { className: `item-ic${short ? ' warn' : ''}`, html: icon(key ? 'warehouse' : 'circleAlert', 17) }),
          el('div.grow', {},
            el('div.title', {}, store.locationName(key),
              bin ? el('span.cell-bin.mono', {}, bin) : null),
            el('div.cell-sub', {}, [
              min ? `min ${formatQtyIn(min, p.unit)}` : null,
              short ? `${formatQtyIn(short, p.unit)} short` : null,
              lots.length ? lots.map((l) => `${formatQtyIn(l.qty, p.unit)} × ${lotDateLabel(l.date)}`).join(' · ') : null,
            ].filter(Boolean).join(' · '))
          ),
          el('strong.product-qty', {}, `${formatQtyIn(qty, p.unit)} ${unitLabel(p.unit, qty)}`),
          el('div.product-row-actions', {},
            el('button.icon-btn', {
              type: 'button', html: icon('packagePlus', 17),
              'aria-label': `Receive into ${store.locationName(key)}`,
              title: 'Receive',
              onclick: () => openStockForm(p.id, { mode: 'add', locationId: key }),
            }),
            el('button.icon-btn', {
              type: 'button', html: icon('packageMinus', 17),
              'aria-label': `Remove from ${store.locationName(key)}`,
              title: 'Remove',
              onclick: () => openStockForm(p.id, { mode: 'remove', locationId: key }),
            }),
            store.locations.length
              ? el('button.icon-btn', {
                type: 'button', html: icon('move', 17),
                'aria-label': `Move stock out of ${store.locationName(key)}`,
                title: 'Move',
                onclick: () => openStockForm(p.id, { mode: 'move', locationId: key }),
              })
              : null
          )
        );
      }))
    );
  }

  /* ---------- Lots ---------- */

  function lotsCard(p) {
    if (!p.trackExpiry) return null;
    const lots = allLots(p);
    const status = expiryStatus(p, { days: 30 });
    const today = dayStamp();
    const horizon = dayStampIn(30);
    return el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, 'Expiry'),
          el('p.small.muted', {}, 'Earliest date first, matching the order of removals')
        ),
        status && (status.expired > 0 || status.soon > 0)
          ? el('span.badge', { className: `badge ${status.expired > 0 ? 'out' : 'low'}` },
            status.expired > 0
              ? `${formatQtyIn(status.expired, p.unit)} expired`
              : `${formatQtyIn(status.soon, p.unit)} due within 30 days`)
          : null
      ),
      lots.length
        ? el('div.item-list', { style: { marginTop: '12px' } }, lots.map((lot) => {
          const expired = lot.date && lot.date < today;
          const soon = lot.date && !expired && lot.date <= horizon;
          return el('div.item-row', {},
            el('span.item-ic', { className: `item-ic${expired ? ' danger' : (soon ? ' warn' : '')}`, html: icon(expired ? 'circleAlert' : 'clipboard', 17) }),
            el('div.grow', {},
              el('div.title', {}, lotDateLabel(lot.date)),
              el('div.cell-sub', {}, expired ? 'Expired' : (soon ? 'Expiring soon' : (lot.date ? 'In date' : 'No date recorded')))
            ),
            el('strong', {}, `${formatQtyIn(lot.qty, p.unit)} ${unitLabel(p.unit, lot.qty)}`)
          );
        }))
        : el('p.small.muted', { style: { marginTop: '10px' } },
          'No dated stock on hand. Receiving asks for a date.')
    );
  }

  /* ---------- What it's made of ---------- */

  /**
   * A kit's recipe, what it can make from what's on hand, and what
   * limits it — so an empty shelf has a reason on screen. Built kits get
   * the button that makes them.
   */
  function kitCard(p) {
    const mode = kitMode(p);
    if (!mode) return null;
    const rows = componentRows(p, store.products);
    const can = buildableQty(p, store.products);
    const unitCost = kitUnitCost(p, store.products);
    const limit = limitingComponent(p, store.products);
    const currency = store.settings.currency;
    return el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, mode === 'build' ? 'Built from' : 'Sold as a kit of'),
          el('p.small.muted', {}, [
            mode === 'build' ? `${formatQtyIn(can, p.unit)} can be built now` : `${formatQtyIn(can, p.unit)} can be sold now`,
            limit?.product ? `${limit.product.name} runs out first` : null,
            `${formatMoney(unitCost, currency)} of components each`,
          ].filter(Boolean).join(' · '))
        ),
        mode === 'build'
          ? el('button.btn.btn-primary', {
            type: 'button', html: icon('boxes', 15, 2),
            disabled: can <= 0,
            onclick: () => openBuildForm(p.id),
          }, ' Build')
          : el('span.badge', {}, 'No stock of its own')
      ),
      el('div.item-list', { style: { marginTop: '12px' } }, rows.map((row) => el(row.product ? 'a.item-row' : 'div.item-row', {
        href: row.product ? productHref(row.product.id) : null,
        className: 'item-row row-stacks',
      },
        el('span.item-ic', { className: `item-ic${row.missing || row.allows <= 0 ? ' warn' : ''}`, html: icon(row.missing ? 'alert' : 'package', 17) }),
        el('div.grow', {},
          el('div.title', {}, row.product?.name || 'Deleted product'),
          el('div.cell-sub', {}, row.missing
            ? 'No longer in the products list'
            : [
              `${formatQtyIn(row.onHand, row.product.unit)} ${unitLabel(row.product.unit, row.onHand)} on hand`,
              `enough for ${formatQtyIn(row.allows, p.unit)}`,
            ].join(' · '))
        ),
        el('strong', {}, `${formatQtyIn(row.qty, row.product?.unit)} ${unitLabel(row.product?.unit, row.qty)} each`)
      )))
    );
  }

  /**
   * The kits this product is a part of — what a shortage here breaks,
   * and why its stock leaves without anyone touching it directly.
   */
  function usedInCard(p) {
    if (isKit(p)) return null;
    const kits = kitsUsing(p.id, store.products);
    if (!kits.length) return null;
    return el('div.card', {},
      el('h3.report-title', {}, `Part of ${kits.length} kit${kits.length === 1 ? '' : 's'}`),
      el('div.item-list', { style: { marginTop: '10px' } }, kits.map((kit) => {
        const need = componentRows(kit, store.products).find((r) => r.productId === p.id);
        const can = buildableQty(kit, store.products);
        return el('a.item-row', { href: productHref(kit.id) },
          el('span.item-ic', { html: icon('boxes', 17) }),
          el('div.grow', {},
            el('div.title', {}, kit.name),
            el('div.cell-sub', {}, [
              `takes ${formatQtyIn(need?.qty ?? 0, p.unit)} ${unitLabel(p.unit, need?.qty ?? 0)}`,
              kitMode(kit) === 'build' ? `${formatQtyIn(can, kit.unit)} buildable` : `${formatQtyIn(can, kit.unit)} sellable`,
            ].join(' · '))
          ),
          el('span', { html: icon('chevR', 16), style: { color: 'var(--ink-3)' } })
        );
      }))
    );
  }

  /* ---------- Where it's bought ---------- */

  /**
   * Every place this can be bought, preferred first, with their code,
   * their price and their lead time. The cheapest is marked, never
   * chosen — the app doesn't re-source anything on its own.
   */
  function sourcesCard(p) {
    const sources = sourcesOf(p);
    if (!sources.length) return null;
    const cheapest = cheapestSource(p);
    const compared = sources.filter((s) => s.price !== null).length > 1;
    const currency = store.settings.currency;
    return el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, sources.length > 1 ? 'Bought from' : 'Supplier'),
          el('p.small.muted', {}, sources.length > 1
            ? 'Reorder groups by the default; a line can be switched before the sheet is made'
            : 'Where this one comes from')
        ),
        el('a.btn.btn-secondary', { href: '#/suppliers' }, 'Suppliers')
      ),
      el('div.item-list', { style: { marginTop: '12px' } }, sources.map((source) => {
        const supplier = store.supplierById(source.supplierId);
        const lead = leadTimeFrom(source, supplier);
        const pack = packSizeFrom(source, p);
        const best = compared && cheapest && cheapest.supplierId === source.supplierId;
        return el('div.item-row.row-stacks', {},
          el('span.item-ic', { className: `item-ic${source.preferred ? ' accent' : ''}`, html: icon('truck', 17) }),
          el('div.grow', {},
            el('div.title', {}, supplier?.name || 'No supplier'),
            el('div.cell-sub', {}, [
              source.preferred ? 'default' : null,
              source.code ? `their code ${source.code}` : null,
              lead ? `~${lead} day${lead === 1 ? '' : 's'} to arrive` : null,
              pack ? `${formatQtyIn(pack, p.unit)} per pack` : null,
              best ? 'cheapest on file' : null,
            ].filter(Boolean).join(' · '))
          ),
          source.price === null
            ? el('span.small.muted', {}, 'No price on file')
            : el('strong', {}, `${formatMoney(source.price, currency)} per ${unitLabel(p.unit, 1)}`)
        );
      }))
    );
  }

  /* ---------- Open orders ---------- */

  function ordersCard(p, onOrder) {
    if (!onOrder) return null;
    const owed = store.orders.filter((o) => OPEN_ORDER_STATUSES.has(o.status)
      && o.lines.some((l) => l.productId === p.id && lineRemaining(l) > 0));
    return el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, `${formatQtyIn(onOrder, p.unit)} ${unitLabel(p.unit, onOrder)} on order`),
          el('p.small.muted', {}, 'Still due on orders you have placed')
        ),
        el('a.btn.btn-secondary', { href: '#/reorder' }, 'Reorder')
      ),
      el('div.item-list', { style: { marginTop: '12px' } }, owed.map((o) => {
        const line = o.lines.find((l) => l.productId === p.id);
        const due = lineRemaining(line);
        return el('a.item-row', { href: '#/reorder' },
          el('span.item-ic', { html: icon('cart', 17) }),
          el('div.grow', {},
            el('div.title', {}, `${o.reference}${o.supplierName ? `: ${o.supplierName}` : ''}`),
            el('div.cell-sub', {}, [
              `placed ${timeAgo(o.orderedAt)}`,
              o.status === 'partial' ? 'partly received' : null,
            ].filter(Boolean).join(' · '))
          ),
          el('strong', {}, `${formatQtyIn(due, p.unit)} due`)
        );
      }))
    );
  }

  /* ---------- Movement ---------- */

  function movementCard(p, { money, perDay, cover, demand }) {
    const series = movementSeries(store.activity, p.id, { days: MOVEMENT_DAYS });
    const points = series.map((d) => ({
      label: shortDate(d.date),
      value: d.out,
      sub: d.in ? `${formatQtyIn(d.in, p.unit)} received` : null,
    }));
    const totalOut = series.reduce((n, d) => n + d.out, 0);
    const totalIn = series.reduce((n, d) => n + d.in, 0);
    const sales = salesRows([p], store.activity, { days: MOVEMENT_DAYS }).find((r) => r.productId === p.id);
    const sold = sales ? salesTotals([sales]) : null;

    return el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, 'Movement'),
          el('p.small.muted', {}, `Units out per day, last ${MOVEMENT_DAYS} days`)
        ),
        el('a.btn.btn-secondary', { href: '#/reports' }, 'Reports')
      ),
      totalOut || totalIn
        ? lineChart(points, {
          format: (n) => `${formatQtyIn(n, p.unit)} ${unitLabel(p.unit, n)}`,
          caption: `${formatQtyIn(totalOut, p.unit)} out, ${formatQtyIn(totalIn, p.unit)} in over ${MOVEMENT_DAYS} days`,
        })
        : el('p.chart-empty', {}, 'Nothing has moved in this window.'),
      el('p.small.muted', { style: { marginTop: '10px' } }, [
        perDay ? `Sells ${rateLabel(perDay, p.unit)} over the last ${demand.days} days` : 'Not enough demand yet to state a rate',
        cover !== null ? coverLabel(cover) : null,
        sold ? `${money(sold.revenue)} taken in, ${money(sold.profit)} gross profit` : null,
      ].filter(Boolean).join(' · '))
    );
  }

  /* ---------- Recent activity ---------- */

  function activityCard(p) {
    const rows = store.activity.filter((a) => a.productId === p.id).slice(0, 6);
    return el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, 'Recent activity'),
          el('p.small.muted', {}, 'What has happened to this one')
        ),
        el('a.btn.btn-secondary', { href: `#/history?product=${encodeURIComponent(p.id)}` }, 'See all')
      ),
      rows.length
        ? el('div.item-list', { style: { marginTop: '12px' } }, rows.map((a) => el('div.item-row', {},
          el('span.item-ic', { html: icon(kindIcon(a.kind), 17) }),
          el('div.grow', {},
            el('div.title', {}, kindLabel(a.kind)),
            el('div.cell-sub', {}, [activityLabel(a), a.note].filter(Boolean).join(' · '))
          ),
          a.delta
            ? el('span.activity-delta', { className: `activity-delta ${a.delta > 0 ? 'pos' : 'neg'}` },
              `${a.delta > 0 ? '+' : ''}${formatQtyIn(a.delta, a.unit)}`)
            : null,
          el('span.small.muted', { style: { whiteSpace: 'nowrap' } }, timeAgo(a.at))
        )))
        : el('p.small.muted', { style: { marginTop: '10px' } }, 'Nothing recorded for this product yet.')
    );
  }

  render();
  return root;
}

/** "4 Aug" — short enough for an axis end. */
function shortDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return String(iso);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
