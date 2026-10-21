// Frequency Band Splitter dialog: a frequency display with the bands in
// color and draggable crossovers, band count buttons, a table of each band's
// range, crossover steepness and presets. Splitting itself is splitBands() in
// edit-extra.js.

import { h, announce } from '../lib/dom.js';
import { openDialog, promptDialog } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { defaultCrossovers, crossoverProblem, CROSSOVER_SLOPES } from './edit-extra.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Band colors, low to high. */
export const BAND_COLORS = ['#d9473b', '#e08a2c', '#d8c234', '#7cc243', '#3fae6a', '#3cb9c9', '#4f86e0', '#a35ad8'];

export const MAX_BANDS = 8;
const MIN_HZ = 20;

/** Built-in presets: crossover lists. */
export const BAND_PRESETS = [
  { name: '(Default)', crossovers: [2000] },
  { name: 'Low / Mid / High', crossovers: [250, 4000] },
  { name: 'Four Bands', crossovers: [150, 1000, 6000] },
  { name: 'Speech Bands', crossovers: [300, 1000, 3400] },
  { name: 'Five Bands, Mastering', crossovers: [120, 500, 2500, 8000] },
];

/** Frequency <-> position 0..1 on a log or linear axis between MIN_HZ and Nyquist. */
export function freqScale(nyquist, log = true) {
  if (log) {
    const a = Math.log(MIN_HZ);
    const b = Math.log(nyquist);
    return { toX: (f) => (Math.log(Math.max(MIN_HZ, f)) - a) / (b - a), toHz: (x) => Math.exp(a + x * (b - a)) };
  }
  return { toX: (f) => f / nyquist, toHz: (x) => x * nyquist };
}

/** Rounds a dragged frequency to a tidy value. */
export function tidyHz(f) {
  if (f >= 10000) return Math.round(f / 100) * 100;
  if (f >= 1000) return Math.round(f / 10) * 10;
  if (f >= 100) return Math.round(f);
  return Math.round(f * 10) / 10;
}

/** Each band's { min, max, width } in Hz for sorted crossovers. */
export function bandRanges(crossovers, nyquist) {
  const edges = [0, ...crossovers, nyquist];
  return edges.slice(0, -1).map((min, i) => ({ min, max: edges[i + 1], width: edges[i + 1] - min }));
}

const fmtHz = (f) => `${f >= 1000 ? +f.toFixed(0) : +f.toFixed(1)} Hz`;
const tickLabel = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

/** Opens the dialog; resolves { crossovers, slope } or null. */
export async function bandSplitterDialog(app, doc) {
  const rate = doc.sampleRate;
  const nyq = rate / 2;
  const saved = app.prefs.get('bandSplitter') || {};
  let crossovers = Array.isArray(saved.crossovers) && !crossoverProblem(saved.crossovers, rate) ? saved.crossovers.slice() : BAND_PRESETS[0].crossovers.slice();
  let active = 0; // selected crossover for keyboard nudging
  const userPresets = () => (Array.isArray(app.prefs.get('bandSplitterPresets')) ? app.prefs.get('bandSplitterPresets') : []);

  const scaleSel = h('select.select', { 'aria-label': 'Scale' }, h('option', { value: 'log' }, 'Logarithmic'), h('option', { value: 'linear' }, 'Linear'));
  scaleSel.value = saved.scale === 'linear' ? 'linear' : 'log';
  const slopeSel = h('select.select', { 'aria-label': 'Crossover steepness' }, CROSSOVER_SLOPES.map((s) => h('option', { value: s.id }, s.label)));
  slopeSel.value = String(saved.slope === 48 ? 48 : 24);
  const presetSel = h('select.select.dlg-preset', { 'aria-label': 'Preset' });
  const save = h('button.icon-btn', { type: 'button', title: 'Save as Preset', 'aria-label': 'Save as Preset' }, icon('save', 16));
  const del = h('button.icon-btn', { type: 'button', title: 'Delete Preset', 'aria-label': 'Delete Preset' }, icon('trash-2', 16));

  const W = 640;
  const H = 180;
  const PAD = 8;
  const plot = svg('svg', { class: 'bands-plot', viewBox: `0 0 ${W} ${H + 22}`, role: 'img', 'aria-label': 'Frequency bands' });
  const counts = h('div.bands-count', { role: 'group', 'aria-label': 'Number of bands' });
  const table = h('div.bands-table');
  const error = h('div.dlg-error', { role: 'alert' });
  const io = h('div.muted.bands-io');

  const scale = () => freqScale(nyq, scaleSel.value !== 'linear');
  const xOf = (f) => PAD + scale().toX(f) * (W - PAD * 2);

  const drawPlot = () => {
    plot.replaceChildren();
    const edges = [MIN_HZ, ...crossovers, nyq];
    edges.slice(0, -1).forEach((f, i) => {
      const x0 = xOf(f);
      const x1 = xOf(edges[i + 1]);
      plot.append(svg('rect', { x: x0, y: 0, width: Math.max(0, x1 - x0), height: H, fill: BAND_COLORS[i], 'fill-opacity': 0.32 }));
    });
    // Grid and axis.
    const ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter((f) => f < nyq);
    const linTicks = Array.from({ length: Math.floor(nyq / 2000) }, (_, i) => (i + 1) * 2000).filter((f) => f < nyq);
    for (const f of scaleSel.value === 'linear' ? linTicks : ticks) {
      const x = xOf(f);
      plot.append(svg('line', { x1: x, x2: x, y1: 0, y2: H, class: 'bands-grid' }));
      const t = svg('text', { x, y: H + 15, class: 'bands-tick', 'text-anchor': 'middle' });
      t.textContent = tickLabel(f);
      plot.append(t);
    }
    plot.append(svg('rect', { x: PAD, y: 0, width: W - PAD * 2, height: H, class: 'bands-frame' }));
    // Crossovers: a line with a handle in the middle.
    crossovers.forEach((f, i) => {
      const x = xOf(f);
      const g = svg('g', { class: `bands-xover${i === active ? ' active' : ''}`, tabindex: 0, role: 'slider', 'aria-label': `Crossover ${i + 1}`, 'aria-valuenow': Math.round(f), 'aria-valuemin': MIN_HZ, 'aria-valuemax': Math.round(nyq - 1), 'aria-valuetext': fmtHz(f) });
      g.dataset.index = String(i);
      g.append(svg('line', { x1: x, x2: x, y1: 0, y2: H, stroke: BAND_COLORS[i], 'stroke-width': 2 }), svg('rect', { x: x - 5, y: H / 2 - 5, width: 10, height: 10, class: 'bands-handle' }), svg('rect', { x: x - 8, y: 0, width: 16, height: H, fill: 'transparent' }));
      plot.append(g);
    });
  };

  const drawCounts = () => {
    counts.replaceChildren(
      ...Array.from({ length: MAX_BANDS }, (_, i) => {
        const n = i + 1;
        const on = n <= crossovers.length + 1;
        const b = h('button.bands-n', { type: 'button', 'aria-pressed': String(on), title: n === 1 ? 'At least two bands' : `${n} bands`, disabled: n === 1, style: { '--band': BAND_COLORS[i] } }, String(n));
        b.addEventListener('click', () => setCount(Math.max(2, n === crossovers.length + 1 ? n - 1 : n)));
        return b;
      }),
    );
  };

  const drawTable = () => {
    const ranges = bandRanges(crossovers, nyq);
    const head = (label) => h('div.bands-rowhead', label);
    const maxCells = ranges.map((r, i) => {
      if (i === ranges.length - 1) return h('div.muted', fmtHz(r.max));
      const input = h('input.input.num', { type: 'number', min: MIN_HZ, max: Math.floor(nyq) - 1, step: 'any', value: +r.max.toFixed(1), 'aria-label': `Band ${i + 1} maximum (Hz)` });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) setCrossover(i, v);
      });
      return h('div.row', input, h('span.muted', 'Hz'));
    });
    table.style.setProperty('--cols', String(ranges.length));
    table.replaceChildren(
      head('Band'),
      ...ranges.map((_, i) => h('div.bands-swatch', { style: { '--band': BAND_COLORS[i] } }, String(i + 1))),
      head('Minimum'),
      ...ranges.map((r) => h('div', fmtHz(r.min))),
      head('Maximum'),
      ...maxCells,
      head('Bandwidth'),
      ...ranges.map((r) => h('div', fmtHz(r.width))),
    );
    io.textContent = `In: ${doc.channelCount === 1 ? 'Mono' : 'L, R'}  |  Out: ${ranges.length} new files (${doc.hasSelection ? 'from the selection' : 'whole file'})`;
  };

  const all = () => [...BAND_PRESETS.map((p) => ({ ...p, builtIn: true })), ...userPresets()];
  const same = (p) => p.crossovers.length === crossovers.length && p.crossovers.every((f, i) => Math.abs(f - crossovers[i]) < 0.05) && (p.slope ?? Number(slopeSel.value)) === Number(slopeSel.value);
  const drawPresets = () => {
    const list = all();
    const at = list.findIndex(same);
    presetSel.replaceChildren(...list.map((p, i) => h('option', { value: i, selected: i === at }, p.builtIn ? p.name : `${p.name} (yours)`)));
    if (at < 0) presetSel.append(h('option', { value: '', selected: true }, 'Custom'));
    del.disabled = at < 0 || list[at].builtIn;
    save.disabled = at >= 0;
  };

  const render = () => {
    crossovers.sort((a, b) => a - b);
    active = Math.min(active, crossovers.length - 1);
    drawPlot();
    drawCounts();
    drawTable();
    drawPresets();
    error.textContent = crossoverProblem(crossovers, rate);
  };

  /** Moves crossover i, kept inside its neighbours (5% apart). */
  const setCrossover = (i, f) => {
    const lo = i > 0 ? crossovers[i - 1] * 1.06 : MIN_HZ;
    const hi = i < crossovers.length - 1 ? crossovers[i + 1] / 1.06 : nyq * 0.98;
    crossovers[i] = tidyHz(Math.max(lo, Math.min(hi, f)));
    active = i;
    render();
  };

  const setCount = (n) => {
    if (n === crossovers.length + 1) return;
    if (n < crossovers.length + 1) crossovers = crossovers.slice(0, n - 1);
    else crossovers = defaultCrossovers(n, rate);
    render();
    announce(`${n} bands`);
  };

  // Dragging and keyboard on the crossovers.
  let drag = null;
  const hzAt = (e) => {
    const r = plot.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * W;
    return scale().toHz(Math.max(0, Math.min(1, (x - PAD) / (W - PAD * 2))));
  };
  plot.addEventListener('pointerdown', (e) => {
    const g = e.target.closest?.('.bands-xover');
    if (!g) return;
    drag = Number(g.dataset.index);
    active = drag;
    plot.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  plot.addEventListener('pointermove', (e) => {
    if (drag === null) return;
    setCrossover(drag, hzAt(e));
  });
  const endDrag = () => {
    if (drag === null) return;
    const i = drag;
    drag = null;
    plot.querySelector(`.bands-xover[data-index="${i}"]`)?.focus();
  };
  plot.addEventListener('pointerup', endDrag);
  plot.addEventListener('pointercancel', endDrag);
  plot.addEventListener('keydown', (e) => {
    const g = e.target.closest?.('.bands-xover');
    if (!g) return;
    const i = Number(g.dataset.index);
    const step = e.shiftKey ? 1.12 : 1.02;
    const f = crossovers[i];
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? f * step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? f / step : null;
    if (next === null) return;
    e.preventDefault();
    setCrossover(i, next);
    plot.querySelector(`.bands-xover[data-index="${i}"]`)?.focus();
  });

  presetSel.addEventListener('change', () => {
    const p = all()[Number(presetSel.value)];
    if (!p) return;
    crossovers = p.crossovers.filter((f) => f < nyq * 0.98).slice(0, MAX_BANDS - 1);
    if (!crossovers.length) crossovers = defaultCrossovers(2, rate);
    if (p.slope) slopeSel.value = String(p.slope);
    render();
  });
  save.addEventListener('click', async () => {
    const name = await promptDialog({ title: 'Save Preset', label: 'Preset name:', value: `${crossovers.length + 1} Bands`, validate: (v) => (!v.trim() ? 'Enter a name.' : BAND_PRESETS.some((p) => p.name.toLowerCase() === v.trim().toLowerCase()) ? 'A built-in preset has that name.' : '') });
    if (!name) return;
    const p = { name: name.trim(), crossovers: crossovers.slice(), slope: Number(slopeSel.value) };
    app.prefs.set('bandSplitterPresets', [...userPresets().filter((x) => x.name !== p.name), p]);
    render();
  });
  del.addEventListener('click', () => {
    const p = all()[Number(presetSel.value)];
    if (!p || p.builtIn) return;
    app.prefs.set('bandSplitterPresets', userPresets().filter((x) => x.name !== p.name));
    render();
  });
  scaleSel.addEventListener('change', render);
  slopeSel.addEventListener('change', render);
  render();

  const r = await openDialog({
    title: 'Frequency Band Splitter',
    wide: true,
    className: 'bands-dialog',
    body: h(
      'div.bands',
      h('div.row.dlg-presets', h('label', 'Presets:'), presetSel, save, del),
      h('div.bands-plot-wrap', plot),
      counts,
      table,
      h('div.row.bands-opts', h('label', 'Scale:'), scaleSel, h('div.spacer'), h('label', 'Crossover steepness:'), slopeSel),
      h('p.dlg-note', 'Each band becomes a new file. Played together, the bands add back up to the original sound.'),
      error,
      io,
    ),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Split', value: 'ok', primary: true },
    ],
    onSubmit: () => {
      const msg = crossoverProblem(crossovers, rate);
      error.textContent = msg;
      return !msg;
    },
  });
  if (r !== 'ok') return null;
  const result = { crossovers: crossovers.slice(), slope: Number(slopeSel.value) };
  app.prefs.set('bandSplitter', { ...result, scale: scaleSel.value });
  return result;
}
