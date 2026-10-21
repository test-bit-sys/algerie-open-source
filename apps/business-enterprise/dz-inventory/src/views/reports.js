/**
 * Reports: what the numbers have been doing, from data the app already
 * keeps — a daily snapshot series, the activity log, and the products
 * themselves. Movement figures state their own window, since the log
 * only reaches so far back.
 */

import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { lineChart, barList } from '../ui/chart.js';
import {
  snapshotSeries, topMovers, deadStock, valueByCategory, valueByLocation,
  marginRows, averageMargin, logReach, reportRows,
  shrinkageRows, shrinkageTotals, unspecifiedRemovals,
  salesRows, salesTotals, topEarners, untrackedSales,
} from '../lib/reports.js';
import { reasonLabel } from '../lib/activity.js';
import { stocktakeHistory, countVarianceTotals, countLabel } from '../lib/stocktake.js';
import { inventoryStats, activeProducts } from '../lib/inventory.js';
import { EACH, formatQtyIn, unitLabel } from '../lib/units.js';
import { formatMoney, formatQty, timeAgo, downloadFile, dateStamp } from '../lib/util.js';
import { toCSV } from '../lib/csv.js';
import { printView } from '../ui/print.js';
import { toast } from '../ui/toast.js';
import { productHref } from './product.js';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const MEASURES = [
  { key: 'value', label: 'Stock value' },
  { key: 'units', label: 'Units on hand' },
];

export function reportsView() {
  const root = el('div.main-inner');
  let days = 30;
  let measure = 'value';

  const render = () => renderInto();
  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);

  // Looking at the report is as good a moment as any to take today's
  // reading, so the last point is never stale while you read it.
  store.recordSnapshot().catch(() => {});

  function renderInto() {
    clear(root);
    const currency = store.settings.currency;
    const money = (n) => formatMoney(n, currency);
    const stats = inventoryStats(store.products, store.settings.defaultLowStock);

    root.append(el('div.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Reports'),
        el('p.view-sub', {}, 'Where the money is, and what actually moves')
      ),
      el('div.view-actions', {},
        segmented('Time range', RANGES.map((r) => ({ key: r.days, label: r.label })), days, (v) => { days = v; render(); }),
        el('button.btn.btn-secondary', { html: icon('fileDown', 16, 2), onclick: exportCSV }, ' Export'),
        el('button.btn.btn-secondary', { html: icon('printer', 16, 2), onclick: () => printView() }, ' Print')
      )
    ));

    if (!store.products.length) {
      root.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('chart', 26) }),
        el('h3', {}, 'Nothing to report yet'),
        el('p', {}, 'Add or import some products; these reports build themselves from your stock and its history.')
      )));
      return;
    }

    /* --- Stock over time --- */
    const series = snapshotSeries(store.snapshots, { days });
    const points = series.map((s) => ({
      label: shortDate(s.date),
      value: measure === 'value' ? s.value : s.units,
      sub: measure === 'value' ? `${formatQty(s.units)} ${unitLabel(EACH, s.units)}` : money(s.value),
    }));

    root.append(
      el('h2.section-title', {}, 'Stock over time',
        el('div.grow'),
        segmented('Measure', MEASURES.map((m) => ({ key: m.key, label: m.label })), measure, (v) => { measure = v; render(); })
      ),
      el('div.card', {},
        lineChart(points, {
          format: measure === 'value' ? money : formatQty,
          caption: `${measure === 'value' ? 'Stock value at purchase cost' : 'Units on hand'}, last ${days} days`,
        }),
        // Where the inventory stands right now, whether or not there is
        // a line yet. The chart's own empty state already explains the
        // missing line ("this fills in a point a day"); this used to say
        // it a second time, in different words, directly underneath —
        // and today's figure is the one thing a single point can tell you.
        el('p.small.muted', { style: { marginTop: '10px' } },
          `Today: ${money(stats.value)} across ${formatQty(stats.products)} product${stats.products === 1 ? '' : 's'}.`)
      )
    );

    /* --- Movement --- */
    const movers = topMovers(store.activity, { days, limit: 8 });
    const dead = deadStock(store.products, store.activity, { days: Math.max(days, 30), limit: 8 });

    root.append(el('h2.section-title', {}, 'Movement'), el('div.report-grid', {},
      el('div.card', {},
        el('h3.report-title', {}, 'Top movers'),
        el('p.small.muted', {}, `Units out in the last ${days} days, not counting write-offs`),
        barList(movers.map((m) => ({
          label: m.name,
          value: m.out,
          display: `${formatQtyIn(m.out, m.unit)} ${unitLabel(m.unit, m.out)}`,
          sub: m.in ? `${formatQtyIn(m.in, m.unit)} received` : null,
        })), { empty: 'No stock has left in this window.' }),
        reachNote()
      ),
      el('div.card', {},
        el('h3.report-title', {}, 'Not moving'),
        el('p.small.muted', {}, `On hand, nothing sold in ${Math.max(days, 30)} days`),
        dead.length
          ? el('div.item-list.flush', {}, dead.map(({ product: p, value }) => el('a.item-row', {
            href: productHref(p.id),
          },
            el('div.grow', {},
              el('div.title', {}, p.name),
              el('div.sub', {}, `${formatQtyIn(p.quantity, p.unit)} ${unitLabel(p.unit, p.quantity)} on hand`)
            ),
            el('strong', {}, money(value))
          )))
          : el('p.chart-empty', {}, 'Everything on hand has moved recently.')
      )
    ));

    /* --- Sales ---
       The only figures on this page that have seen a real sale: revenue
       at the price recorded on each removal, COGS at the cost frozen on
       the same entry. Removals with no price are counted separately and
       never valued at list price. */
    const sales = salesRows(store.products, store.activity, { days });
    const sold = salesTotals(sales);
    const earners = topEarners(sales);
    const unpriced = untrackedSales(store.activity, { days });
    const listMargin = averageMargin(store.products);

    root.append(el('h2.section-title', {}, 'Sales'));
    if (!sales.length) {
      root.append(el('div.card', {},
        el('h3.report-title', {}, 'No sales recorded yet'),
        el('p.small.muted', { style: { marginTop: '4px' } },
          'The Remove form records what each unit sold for when the reason is “Sold”. '
          + 'Once it does, revenue, cost of goods, and real gross profit show up here.'),
        unpriced.count
          ? el('p.small.muted', { style: { marginTop: '8px' } },
            `${formatQty(unpriced.count)} removal${unpriced.count === 1 ? '' : 's'} in this window`
            + ` carr${unpriced.count === 1 ? 'ies' : 'y'} no price.`)
          : null
      ));
    } else {
      root.append(
        el('div.stat-grid', {},
          statTile('cart', 'Revenue', money(sold.revenue),
            `${formatQty(sold.sales)} sale${sold.sales === 1 ? '' : 's'} in ${days} days`),
          statTile('boxes', 'Cost of goods', money(sold.cost), 'At the cost recorded on each sale'),
          statTile('chart', 'Gross profit', money(sold.profit),
            sold.profit < 0 ? 'Sold below cost' : 'Revenue less cost of goods',
            sold.profit < 0 ? 'critical' : ''),
          statTile('percent', 'Realized margin', sold.margin === null ? '–' : percent(sold.margin),
            listMargin === null ? 'On what actually sold' : `List margin averages ${percent(listMargin)}`)
        ),
        el('div.card', { style: { marginTop: '10px' } },
          el('div.report-head', {},
            el('div', {},
              el('h3.report-title', {}, 'Top earners'),
              el('p.small.muted', {}, `Gross profit in the last ${days} days`)
            ),
            sold.units > 0
              ? el('span.badge.ok', { title: 'Units sold across counted products' },
                `${formatQty(sold.units)} ${unitLabel(EACH, sold.units)} sold`)
              : null
          ),
          barList(earners.map((r) => ({
            label: r.name,
            value: r.profit,
            display: money(r.profit),
            sub: `${formatQtyIn(r.units, r.unit)} ${unitLabel(r.unit, r.units)} · ${money(r.revenue)} revenue`,
          })), { empty: 'Nothing has sold at a recorded price in this window.' }),
          sales.length > earners.length
            ? el('p.small.muted', { style: { marginTop: '10px' } }, `Showing the top ${earners.length} of ${sales.length}.`)
            : null,
          unpriced.count
            ? el('p.small.muted', { style: { marginTop: '10px' } },
              `${formatQty(unpriced.count)} removal${unpriced.count === 1 ? '' : 's'} in this window`
              + ` carr${unpriced.count === 1 ? 'ies' : 'y'} no price and ${unpriced.count === 1 ? 'is' : 'are'} not counted here.`)
            : null
        )
      );
    }

    /* --- Shrinkage --- */
    const shrink = shrinkageRows(store.products, store.activity, { days });
    const shrinkTotals = shrinkageTotals(shrink);
    const untagged = unspecifiedRemovals(store.activity, { days });

    root.append(el('h2.section-title', {}, 'Shrinkage'), el('div.card', {},
      el('div.report-head', {},
        el('div', {},
          el('h3.report-title', {}, shrink.length ? `${money(shrinkTotals.value)} written off` : 'No write-offs'),
          el('p.small.muted', {}, `Damaged, expired, or lost in the last ${days} days, at cost`)
        ),
        shrinkTotals.units > 0
          ? el('span.badge.out', { title: 'Units lost across counted products' }, `${formatQty(shrinkTotals.units)} ${unitLabel(EACH, shrinkTotals.units)}`)
          : null
      ),
      shrink.length
        ? barList(shrink.slice(0, 8).map((r) => ({
          label: r.name,
          value: r.value,
          display: money(r.value),
          sub: Object.entries(r.reasons)
            .map(([k, n]) => `${formatQtyIn(n, r.unit)} ${unitLabel(r.unit, n)} ${reasonLabel(k).toLowerCase()}`)
            .join(' · '),
        })))
        : el('p.chart-empty', {}, 'Nothing tagged damaged, expired, or lost in this window. Reasons on the Remove form feed this report.'),
      shrink.length > 8
        ? el('p.small.muted', { style: { marginTop: '10px' } }, `Showing the 8 biggest of ${shrink.length}.`)
        : null,
      untagged
        ? el('p.small.muted', { style: { marginTop: '10px' } },
          `${formatQty(untagged)} removal${untagged === 1 ? '' : 's'} in this window carr${untagged === 1 ? 'ies' : 'y'} no reason and ${untagged === 1 ? 'isn’t' : 'aren’t'} counted here.`)
        : null
    ));

    /* --- What counting found ---
       A write-off is stock somebody wrote off. A count is the only
       moment the app learns what is genuinely missing, so it is the
       only honest source for that trend. */
    const counts = stocktakeHistory(store.stocktakes, { days });
    if (counts.length) {
      const found = countVarianceTotals(counts);
      root.append(el('div.card', { style: { marginTop: '10px' } },
        el('div.report-head', {},
          el('div', {},
            el('h3.report-title', {}, found.short
              ? `${money(found.short)} unaccounted for by counting`
              : 'Counting found nothing missing'),
            el('p.small.muted', {}, `Across ${formatQty(counts.length)} count${counts.length === 1 ? '' : 's'} in the last ${days} days`)
          ),
          found.over
            ? el('span.badge.ok', { title: 'Counted more than expected' }, `${money(found.over)} found`)
            : null
        ),
        barList(counts.slice(0, 8).map((r) => ({
          label: countLabel(r),
          value: Math.abs(Number(r.value) || 0),
          display: `${r.value > 0 ? '+' : ''}${money(r.value)}`,
          sub: [
            `${formatQty(r.counted)} counted`,
            r.skipped ? `${formatQty(r.skipped)} skipped` : null,
            r.unitsShort ? `${formatQty(r.unitsShort)} ${unitLabel(EACH, r.unitsShort)} short` : null,
          ].filter(Boolean).join(' · '),
        })), { empty: 'No counts in this window.' }),
        el('p.small.muted', { style: { marginTop: '10px' } },
          'Each count is one point: what it found, valued at what the stock cost that day. Past counts live on the Stocktake page.')
      ));
    }

    /* --- Where the value sits --- */
    const byCategory = valueByCategory(store.products);
    const byLocation = valueByLocation(store.products, store.locations);

    root.append(el('h2.section-title', {}, 'Where the value sits'), el('div.report-grid', {},
      el('div.card', {},
        el('h3.report-title', {}, 'By category'),
        el('p.small.muted', {}, 'At purchase cost'),
        barList(byCategory.slice(0, 8).map((r) => ({
          label: r.label,
          value: r.value,
          display: money(r.value),
          sub: `${formatQty(r.products)} product${r.products === 1 ? '' : 's'}`,
        })), { empty: 'No categories yet.' })
      ),
      el('div.card', {},
        el('h3.report-title', {}, 'By location'),
        el('p.small.muted', {}, 'At purchase cost'),
        barList(byLocation.slice(0, 8).map((r) => ({
          label: r.label,
          value: r.value,
          display: money(r.value),
          sub: `${formatQty(r.products)} product${r.products === 1 ? '' : 's'}`,
        })), { empty: 'No stock assigned to a location.' })
      )
    ));

    /* --- Margins --- */
    const margins = marginRows(store.products);
    const below = margins.filter((m) => m.belowCost);
    const average = averageMargin(store.products);

    root.append(el('h2.section-title', {}, 'Margins'));
    if (!margins.length) {
      root.append(el('div.card', {}, el('p.small.muted', {},
        'Add a selling price alongside the purchase cost and margins show up here.')));
    } else {
      // Active products only, like the numerator — and every other
      // number on this page. Archived items can't be priced into the
      // margins list, so counting them here overstated how many
      // products "lack" a price. The noun follows the total and the
      // verb follows the count, so one priced product of one doesn't
      // read "1 of 1 products are priced".
      const priceable = activeProducts(store.products).length;
      const priced = `${margins.length} of ${formatQty(priceable)} product${priceable === 1 ? '' : 's'}`
        + ` ${margins.length === 1 ? 'is' : 'are'} priced`;
      root.append(el('div.card', {},
        el('div.report-head', {},
          el('div', {},
            el('h3.report-title', {}, `${percent(average)} average margin`),
            el('p.small.muted', {}, priced)
          ),
          below.length
            ? el('span.badge.out', { title: 'Selling below what it cost' }, `${below.length} below cost`)
            : null
        ),
        el('div.table-wrap', { style: { marginTop: '12px' } }, el('table.table.compact', {},
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Product'),
            el('th.num', { scope: 'col' }, 'Cost'),
            el('th.num', { scope: 'col' }, 'Price'),
            el('th.num', { scope: 'col' }, 'Margin')
          )),
          el('tbody', {}, margins.slice(0, 12).map((m) => el('tr', {},
            el('td', {},
              el('a.cell-link', { href: productHref(m.product.id) }, el('div.cell-main', {}, m.product.name)),
              m.belowCost ? el('div.cell-sub', { style: { color: 'var(--danger)' } }, 'Below cost') : null
            ),
            el('td.num', {}, money(m.cost)),
            el('td.num', {}, money(m.product.price)),
            el('td.num', { style: m.belowCost ? { color: 'var(--danger)', fontWeight: 650 } : null },
              percent(m.percent))
          )))
        )),
        margins.length > 12
          ? el('p.small.muted', { style: { marginTop: '10px' } }, `Showing the 12 thinnest of ${margins.length}.`)
          : null
      ));
    }
  }

  function exportCSV() {
    if (!store.products.length && !store.activity.length) {
      toast('Nothing to export yet', { icon: 'info' });
      return;
    }
    const rows = reportRows({
      products: store.products,
      snapshots: store.snapshots,
      activity: store.activity,
      locations: store.locations,
      defaultLow: store.settings.defaultLowStock,
      days,
    });
    downloadFile(`inventory-report-${days}d-${dateStamp()}.csv`, toCSV(rows));
    toast('Report exported', { icon: 'fileDown' });
  }

  /** How far back the movement numbers can actually see. */
  function reachNote() {
    const oldest = logReach(store.activity);
    if (!oldest) return null;
    const archived = store.archives.length;
    return el('p.small.muted', { style: { marginTop: '10px' } },
      `Counted from the activity log, which reaches back to ${timeAgo(oldest)}`,
      archived ? '; older months are archived and not counted here.' : '.');
  }

  function segmented(label, options, current, onPick) {
    const seg = el('div.segmented', { role: 'group', 'aria-label': label },
      options.map((o) => el('button', {
        type: 'button',
        dataset: { key: String(o.key) },
        'aria-pressed': String(o.key === current),
        onclick: () => {
          // onPick rebuilds the whole view — the charts really do have
          // to re-render — taking this button with it. Focus follows
          // to its replacement instead of falling to <body>.
          onPick(o.key);
          root.querySelector(`.segmented[aria-label="${label}"] button[data-key="${o.key}"]`)?.focus();
        },
      }, o.label))
    );
    return seg;
  }

  render();
  return root;
}

/** A stat tile, the same shape the Overview uses for its headline figures. */
function statTile(ic, label, value, sub, tone = '') {
  return el('div.stat', { className: `stat ${tone}`.trim() },
    el('div.label', { html: icon(ic, 14, 2) }, el('span', {}, label)),
    el('div.value', {}, value),
    el('div.sub', {}, sub)
  );
}

/**
 * A margin, always to one decimal. The maths already rounds there, but
 * a whole number printed itself as "54%" among "42.9%" and "51.9%" —
 * one row per column whose decimal point didn't line up with the rest
 * in a right-aligned, tabular-figure column. Intl, not toFixed, so the
 * separator matches every other number on the page.
 */
const PCT_FMT = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = (n) => `${PCT_FMT.format(Number(n) || 0)}%`;

/** "4 Aug" — short enough for an axis end. */
function shortDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return String(iso);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
