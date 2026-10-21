/**
 * Trend charts for the Forecast page, cut from the same cloth as
 * forecast-chart.js: HTML columns (no canvas blur, labels stay text),
 * a shared tooltip, legend, and per-month hover/focus targets.
 *
 * flowsChart: grouped monthly bars - pipeline added vs won vs lost - so
 * a shrinking top-of-funnel is visible months before it hits revenue.
 * miniTrend: one compact series (win rate, sales cycle) over the months.
 */

import { el, clear } from '../ui/dom.js';
import { formatMonth, formatMoney } from '../lib/util.js';

const PLOT_H = 150;
const MINI_H = 90;

function tipRow(kind, label, value) {
  return el('div.tip-row', {},
    el('span.tip-swatch', { dataset: { kind }, 'aria-hidden': 'true' }),
    el('span.tip-label', {}, label),
    el('span.tip-value', {}, value)
  );
}

function legendKey(kind, label) {
  return el('span.legend-key', {},
    el('span.tip-swatch', { dataset: { kind }, 'aria-hidden': 'true' }),
    label
  );
}

/**
 * A trend that doesn't fit opens on its newest month. These charts are wider
 * than the card on most windows, and scrollLeft starts at 0 - which parks a
 * "last 12 months" view on last September and hides the month the founder is
 * actually living in. The earlier months are one scroll back.
 */
function showNewest(chart) {
  requestAnimationFrame(() => { chart.scrollLeft = chart.scrollWidth; });
}

/** Clamp-position the shared tooltip over the hovered column. */
function placeTip(tooltip, chart, col) {
  tooltip.hidden = false;
  const colBox = col.getBoundingClientRect();
  const chartBox = chart.getBoundingClientRect();
  tooltip.style.left = '0px';
  const tipW = tooltip.getBoundingClientRect().width || 160;
  // The chart is its own horizontal scroller, and the tooltip lives in its
  // scrolled content - client-rect deltas alone would place the tip a full
  // scroll offset to the left of the column once the user has panned.
  const scroll = chart.scrollLeft;
  const x = scroll + colBox.left - chartBox.left + colBox.width / 2 - tipW / 2;
  tooltip.style.left = `${Math.max(scroll + 4, Math.min(x, scroll + chartBox.width - tipW - 4))}px`;
}

/** Grouped added / won / lost bars, one group per month. */
export function flowsChart(flows, currency) {
  const max = Math.max(
    ...flows.flatMap((r) => [r.added.value, r.won.value, r.lost.value]), 1);
  const px = (v) => Math.round((v / max) * PLOT_H);

  const tooltip = el('div.chart-tip', { role: 'tooltip', hidden: true });
  const chart = el('div.forecast-chart.trend-chart');

  const showTip = (col, r) => {
    clear(tooltip);
    const closed = r.won.count + r.lost.count;
    tooltip.append(
      el('div.tip-title', {}, formatMonth(r.key)),
      tipRow('added', `Added (${r.added.count})`, formatMoney(r.added.value, currency)),
      tipRow('won', `Won (${r.won.count})`, formatMoney(r.won.value, currency)),
      tipRow('lost', `Lost (${r.lost.count})`, formatMoney(r.lost.value, currency)),
      // Native append stringifies a bare false into visible text.
      closed > 0 && el('div.tip-sub', {},
        `Win rate ${Math.round((r.won.count / closed) * 100)}% over ${closed} closed`) || ''
    );
    placeTip(tooltip, chart, col);
  };
  const hideTip = () => { tooltip.hidden = true; };

  const cols = flows.map((r) => {
    const seg = (kind, flow) => (flow.value > 0
      ? el(`div.trend-seg.${kind}`, { style: { height: `${Math.max(px(flow.value), 3)}px` } })
      : el('div.trend-seg.zero'));
    const col = el('button.chart-col', {
      type: 'button',
      'aria-label': `${formatMonth(r.key)}: added ${r.added.count} deal${r.added.count === 1 ? '' : 's'} `
        + `worth ${formatMoney(r.added.value, currency)}, won ${formatMoney(r.won.value, currency)}, `
        + `lost ${formatMoney(r.lost.value, currency)}`,
    },
      el('div.col-plot', { style: { height: `${PLOT_H}px` } },
        el('div.trend-group', {},
          seg('added', r.added),
          seg('won', r.won),
          seg('lost', r.lost)
        )
      ),
      el('div.col-month', {}, formatMonth(r.key).split(' ')[0])
    );
    col.addEventListener('pointerenter', () => showTip(col, r));
    col.addEventListener('focus', () => showTip(col, r));
    col.addEventListener('pointerleave', hideTip);
    col.addEventListener('blur', hideTip);
    return col;
  });

  chart.append(el('div.chart-plot-row.trend-plot', {}, cols), tooltip);
  showNewest(chart);
  // The legend sits outside the scroller. Inside it, showNewest scrolled the
  // legend along with the bars, and the chart arrived with "Pipeline added"
  // - the key for its tallest series - already off the left edge, so the
  // one thing that says what the dark bars are was the one thing missing.
  return el('div.trend-block', {},
    el('div.chart-legend', {},
      legendKey('added', 'Pipeline added'),
      legendKey('won', 'Won'),
      legendKey('lost', 'Lost')
    ),
    chart
  );
}

/**
 * One compact series over the months: rows [{ key, value|null }], value
 * already in display units. `format` renders the cap label and tooltip
 * value ("38%", "24d"); null months show a baseline dot, not a zero.
 */
export function miniTrend(rows, { format, series, ariaLabel }) {
  const max = Math.max(...rows.map((r) => r.value ?? 0), 1);
  const px = (v) => Math.round((v / max) * (MINI_H - 18));

  const tooltip = el('div.chart-tip', { role: 'tooltip', hidden: true });
  const chart = el('div.forecast-chart.trend-chart.mini', { role: 'group', 'aria-label': ariaLabel });

  const showTip = (col, r) => {
    clear(tooltip);
    tooltip.append(
      el('div.tip-title', {}, formatMonth(r.key)),
      el('div.tip-row', {}, el('span.tip-label', {}, series),
        el('span.tip-value', {}, r.value === null ? 'no data' : format(r.value)))
    );
    placeTip(tooltip, chart, col);
  };
  const hideTip = () => { tooltip.hidden = true; };

  const cols = rows.map((r) => {
    const col = el('button.chart-col', {
      type: 'button',
      'aria-label': `${formatMonth(r.key)}: ${r.value === null ? 'no data' : format(r.value)}`,
    },
      el('div.col-plot', { style: { height: `${MINI_H}px` } },
        r.value === null
          ? el('div.col-zero', { 'aria-hidden': 'true' })
          : el('div.col-stack', {},
              el('div.col-cap-label.mini-cap', {}, format(r.value)),
              el('div.trend-seg.mini-seg', { style: { height: `${Math.max(px(r.value), 3)}px` } }))
      ),
      el('div.col-month', {}, formatMonth(r.key).split(' ')[0])
    );
    col.addEventListener('pointerenter', () => showTip(col, r));
    col.addEventListener('focus', () => showTip(col, r));
    col.addEventListener('pointerleave', hideTip);
    col.addEventListener('blur', hideTip);
    return col;
  });

  chart.append(el('div.chart-plot-row.trend-plot', {}, cols), tooltip);
  showNewest(chart);
  return chart;
}
