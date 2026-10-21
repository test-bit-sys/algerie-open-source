/**
 * Two chart shapes, hand-drawn in SVG and HTML — a line over time and a
 * ranked bar list. Both are single-measure by design: two scales on one
 * pair of axes is the fastest way to mislead someone, so a second
 * measure gets its own chart.
 *
 * Colour is one accent hue from the app's tokens, so both themes are
 * already accounted for; every value is also written as text, so the
 * charts read the same in greyscale, in print, and to a screen reader.
 */

import { el } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

const W = 720;
const H = 180;
const PAD = { top: 14, right: 12, bottom: 22, left: 12 };

/**
 * A line over time with a soft area under it, a crosshair on hover, and
 * the first, last, and peak values labelled — never a number on every
 * point.
 *
 * points: [{ label, value, sub }] in chronological order.
 */
export function lineChart(points, { format = String, caption = '' } = {}) {
  const figure = el('figure.chart');
  if (points.length < 2) {
    figure.append(el('p.chart-empty', {}, 'Not enough history yet. This fills in a point a day.'));
    return figure;
  }

  const values = points.map((p) => Number(p.value) || 0);
  const peak = Math.max(...values);
  // Zero baseline — a truncated axis turns a flat month into a cliff —
  // with a little headroom so the line isn't glued to the ceiling.
  const min = Math.min(...values, 0);
  const max = peak + (peak - min) * 0.08 || 1;
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (i / (points.length - 1)) * innerW;
  const y = (v) => PAD.top + innerH - ((v - min) / span) * innerH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart-svg',
    role: 'img',
    'aria-label': caption || 'Line chart',
  });

  // Recessive grid: three lines, no box, no ticks.
  for (const t of [0, 0.5, 1]) {
    const gy = PAD.top + innerH * t;
    svg.append(svgEl('line', { x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy, class: 'chart-grid' }));
  }

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(' ');
  svg.append(svgEl('path', {
    d: `${line} L${x(points.length - 1).toFixed(1)},${PAD.top + innerH} L${x(0).toFixed(1)},${PAD.top + innerH} Z`,
    class: 'chart-area',
  }));
  svg.append(svgEl('path', { d: line, class: 'chart-line' }));

  const marker = svgEl('circle', { r: 4.5, class: 'chart-marker', opacity: 0 });
  const crosshair = svgEl('line', { y1: PAD.top, y2: PAD.top + innerH, class: 'chart-crosshair', opacity: 0 });
  svg.append(crosshair, marker);

  const tip = el('div.chart-tip', { hidden: true });

  const axis = el('div.chart-axis', {},
    el('span', {}, points[0].label),
    el('span.chart-peak', {}, `Peak ${format(peak)}`),
    el('span', {}, points[points.length - 1].label)
  );

  /* Hover anywhere along the chart snaps to the nearest day. */
  let shownIndex = -1;
  function moveTo(clientX, rect) {
    const ratio = (clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    // Snapping means most moves land on the point already shown; going
    // on anyway would rewrite the tip and re-measure it (a forced
    // reflow) for every pixel the pointer travels.
    if (i === shownIndex) return;
    shownIndex = i;
    const px = (x(i) / W) * rect.width;
    marker.setAttribute('cx', x(i));
    marker.setAttribute('cy', y(values[i]));
    marker.setAttribute('opacity', 1);
    crosshair.setAttribute('x1', x(i));
    crosshair.setAttribute('x2', x(i));
    crosshair.setAttribute('opacity', 1);
    tip.hidden = false;
    tip.replaceChildren(
      el('strong', {}, format(values[i])),
      el('span', {}, points[i].label + (points[i].sub ? ` · ${points[i].sub}` : ''))
    );
    // The tip is centered on `left`, so clamp by its own half-width —
    // clamping only the centre lets half of it spill past the card and
    // hand the page a horizontal scrollbar at the newest point.
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = `${Math.max(half, Math.min(rect.width - half, px))}px`;
  }

  const hide = () => {
    shownIndex = -1;
    marker.setAttribute('opacity', 0);
    crosshair.setAttribute('opacity', 0);
    tip.hidden = true;
  };

  const plot = el('div.chart-plot', {
    onpointermove: (e) => moveTo(e.clientX, plot.getBoundingClientRect()),
    onpointerleave: hide,
  }, svg, tip);

  figure.append(plot, axis);
  if (caption) figure.append(el('figcaption', {}, caption));
  return figure;
}

/**
 * A ranked list of horizontal bars. Every row carries its own value as
 * text, so the bar is a comparison aid rather than the only encoding.
 *
 * rows: [{ label, value, sub, display }]
 */
export function barList(rows, { format = String, empty = 'Nothing to show yet.' } = {}) {
  if (!rows.length) return el('p.chart-empty', {}, empty);
  const max = Math.max(...rows.map((r) => Math.abs(Number(r.value) || 0)), 1);
  return el('div.bar-list', {}, rows.map((r) => {
    const pct = Math.max(2, (Math.abs(Number(r.value) || 0) / max) * 100);
    return el('div.bar-row', {},
      el('div.bar-head', {},
        el('span.bar-label', { title: r.label }, r.label),
        el('span.bar-value', {}, r.display ?? format(r.value))
      ),
      el('div.bar-track', {}, el('div.bar-fill', { style: { width: `${pct}%` } })),
      r.sub ? el('div.bar-sub', {}, r.sub) : null
    );
  }));
}
