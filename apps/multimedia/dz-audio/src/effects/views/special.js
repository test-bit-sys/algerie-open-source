// Dialog views for Special effects: Mastering (EQ graph and module boxes),
// Doppler Shifter (path type and a top-down path graph), Vocal Enhancer
// (mode buttons) and Guitar Suite (module boxes).

import { h } from '../../lib/dom.js';
import { cssVar } from '../../ui/theme.js';
import { plot, labelText, registerEditor } from '../editors.js';
import { controlsFor, groupBox, radioChoice, checkbox, numberField, showWhen, enableWhen, glyph } from '../layout.js';
import { responseEditor } from './common.js';

// ------------------------------------------------------------- Mastering

const MASTER_BANDS = [
  { label: 'Low Shelf', on: 'lowShelfOn', freq: 'lowShelfFreq', gain: 'lowShelfGain', q: 'lowShelfQ' },
  { label: 'Peak', on: 'peakOn', freq: 'peakFreq', gain: 'peakGain', q: 'peakQ' },
  { label: 'High Shelf', on: 'highShelfOn', freq: 'highShelfFreq', gain: 'highShelfGain', q: 'highShelfQ' },
];

function masteringView(ctx) {
  const masteringEq = responseEditor({
    label: 'Mastering equalizer curve',
    span: [-18, 18],
    handles: (v) => MASTER_BANDS.map((b) => ({ label: b.label, freq: v[b.freq], gain: v[b.gain], q: b.q ? v[b.q] : null, enabled: v[b.on], ids: { freq: b.freq, gain: b.gain, q: b.q } })),
  });
  const rows = MASTER_BANDS.map((b) =>
    h('div.ms-band', checkbox(ctx, b.on, { label: b.label }), numberField(ctx, b.freq), numberField(ctx, b.gain), numberField(ctx, b.q)),
  );
  const eq = groupBox('Equalizer', masteringEq(ctx), h('div.ms-bands', h('div.ms-band.ms-band-head', h('span'), h('span', 'Frequency'), h('span', 'Gain'), h('span', 'Q')), rows));
  const amount = (id) => controlsFor(ctx, [id], { labels: { [id]: 'Amount' } });
  const side = h(
    'div.fx-stack',
    groupBox('Reverb', amount('reverb')),
    groupBox('Exciter', radioChoice(ctx, 'exciterMode', { label: null }), amount('exciter')),
    groupBox('Widener', amount('width')),
    groupBox('Loudness Maximizer', amount('loudness')),
    groupBox('Output Gain', amount('output')),
  );
  return h('div.fx-split', eq, side);
}
masteringView.hides = true;
masteringView.dialogClass = 'fx-wide';

// -------------------------------------------------------- Doppler Shifter

const SPEED_OF_SOUND = 343;

/** Source position { x: right, y: front } in metres at t seconds (mirrors fx/special/offline.rs Path::position). */
export function dopplerPosition(v, t) {
  if (v.path === 1) {
    const a = (v.startAngle * Math.PI) / 180 + (v.velocity / Math.max(0.1, v.radius)) * t;
    return { x: v.centerRight + v.radius * Math.sin(a), y: v.centerFront + v.radius * Math.cos(a) };
  }
  const a = (v.comingFrom * Math.PI) / 180;
  const s = v.startDistance - v.velocity * t;
  return { x: v.passRight + s * Math.sin(a), y: v.passFront + s * Math.cos(a) };
}

/** Pitch ratio heard at the listener at t seconds (radial velocity of the source). */
export function dopplerRatio(v, t, dt = 0.01) {
  const d = (p) => Math.hypot(p.x, p.y);
  const vr = (d(dopplerPosition(v, t + dt)) - d(dopplerPosition(v, t - dt))) / (2 * dt);
  return SPEED_OF_SOUND / (SPEED_OF_SOUND + vr);
}

function dopplerGraph(ctx) {
  const rate = ctx.doc?.sampleRate || 48000;
  const seconds = ctx.range ? Math.max(0.1, (ctx.range[1] - ctx.range[0]) / rate) : 5;
  const view = plot('dp-graph', 'Source path seen from above, listener at the centre', (g, W, H) => {
    const v = ctx.values;
    const steps = 96;
    const pts = Array.from({ length: steps + 1 }, (_, i) => dopplerPosition(v, (i / steps) * seconds));
    // Frame the neighbourhood of the listener: the start and the closest pass (long paths run off the edge).
    const reach = v.path === 1 ? v.radius + Math.hypot(v.centerFront, v.centerRight) : Math.max(v.startDistance, Math.hypot(v.passFront, v.passRight));
    const extent = Math.max(2, reach) * 1.15;
    const cx = W / 2;
    const cy = H / 2;
    const scale = (Math.min(W, H) / 2 - 18) / extent;
    const px = (p) => [cx + p.x * scale, cy - p.y * scale];
    g.strokeStyle = cssVar('--grid-strong');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx + 0.5, 14);
    g.lineTo(cx + 0.5, H - 14);
    g.moveTo(14, cy + 0.5);
    g.lineTo(W - 14, cy + 0.5);
    g.stroke();
    labelText(g, '0° front', cx + 4, 2);
    labelText(g, '180°', cx + 4, H - 14);
    labelText(g, '90°', W - 30, cy + 3);
    labelText(g, '270°', 2, cy + 3);
    labelText(g, `${Math.round(extent)} m`, W - 44, H - 14);
    // The listener: a head facing front.
    g.fillStyle = cssVar('--text-dim');
    g.beginPath();
    g.arc(cx, cy, 4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = cssVar('--hot');
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = px(p);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.stroke();
    g.fillStyle = cssVar('--hot');
    for (let k = 0; k < 4; k++) {
      const [x, y] = px(pts[Math.round((k / 4) * steps)]);
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
    // Arrow head at the end of the path.
    const [x1, y1] = px(pts[steps]);
    const [x0, y0] = px(pts[steps - 2]);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x1 - 9 * Math.cos(ang - 0.45), y1 - 9 * Math.sin(ang - 0.45));
    g.lineTo(x1 - 9 * Math.cos(ang + 0.45), y1 - 9 * Math.sin(ang + 0.45));
    g.closePath();
    g.fill();
  });
  const status = h('div.faint.dp-status', { 'aria-live': 'off' });
  const update = () => {
    const v = ctx.values;
    const ratios = [0, 0.25, 0.5, 0.75, 1].map((f) => dopplerRatio(v, f * seconds));
    const st = (r) => (12 * Math.log2(r)).toFixed(1);
    const hi = Math.max(...ratios);
    const lo = Math.min(...ratios);
    status.textContent = `Pitch shift across ${seconds.toFixed(1)} s: ${hi > 1 ? '+' : ''}${st(hi)} to ${lo > 1 ? '+' : ''}${st(lo)} semitones`;
    view.redraw();
  };
  ctx.subscribe(update);
  update();
  return h('div.dp-graph-wrap', view.el, status);
}

function dopplerView(ctx) {
  const PATH_ICONS = {
    0: glyph(['M4 12h14', 'M14 8l4 4-4 4', 'M4 9v6']),
    1: glyph(['M20 12a8 8 0 1 1-3-6.2', 'M17 2v4h4']),
  };
  const straight = showWhen(ctx, controlsFor(ctx, ['startDistance', 'velocity', 'comingFrom', 'passFront', 'passRight']), (v) => v.path === 0);
  const circular = showWhen(ctx, controlsFor(ctx, ['radius', 'velocity', 'startAngle', 'centerFront', 'centerRight']), (v) => v.path === 1);
  const left = h(
    'div.fx-stack',
    radioChoice(ctx, 'path', { icons: PATH_ICONS, className: 'fx-segmented' }),
    straight,
    circular,
    h('div.fx-label', 'Adjust volume by:'),
    h('div.fx-checks', checkbox(ctx, 'distanceVolume', { label: 'Distance' }), checkbox(ctx, 'directionVolume', { label: 'Direction' })),
    controlsFor(ctx, ['quality']),
  );
  return groupBox('', h('div.fx-split', left, dopplerGraph(ctx)));
}
dopplerView.hides = true;
dopplerView.dialogClass = 'fx-wide';

// --------------------------------------------------------- Vocal Enhancer

function vocalView(ctx) {
  return h('div.fx-stack', radioChoice(ctx, 'mode', { label: null }), controlsFor(ctx, ['amount']));
}
vocalView.hides = true;

// ----------------------------------------------------------- Guitar Suite

function guitarView(ctx) {
  const amount = (id) => controlsFor(ctx, [id], { labels: { [id]: 'Amount' } });
  // Each module box: its controls (dimmed while bypassed) and a Bypass box.
  const module = (title, bypass, body) => groupBox(title, enableWhen(ctx, body, (v) => !v[bypass]), h('div.fx-bypass', checkbox(ctx, bypass, { label: 'Bypass' })));
  const filterBody = h('div', controlsFor(ctx, ['filterType'], { labels: { filterType: 'Type' } }), enableWhen(ctx, controlsFor(ctx, ['filterFreq', 'resonance']), (v) => v.filterType !== 0));
  const ampBody = h('div', controlsFor(ctx, ['amp'], { labels: { amp: 'Cabinet' } }), enableWhen(ctx, amount('ampAmount'), (v) => v.amp !== 0));
  const left = h('div.fx-stack', module('Compressor', 'compBypass', amount('compressor')), module('Filter', 'filterBypass', filterBody));
  const right = h(
    'div.fx-stack',
    module('Distortion', 'distBypass', controlsFor(ctx, ['distType', 'distAmount'], { labels: { distType: 'Type', distAmount: 'Amount' } })),
    module('Amplifier', 'ampBypass', ampBody),
    groupBox('Output', controlsFor(ctx, ['mix', 'output'])),
  );
  return h('div.fx-split.fx-split-even', left, right);
}
guitarView.hides = true;
guitarView.dialogClass = 'fx-wide';

registerEditor('mastering', masteringView);
registerEditor('dopplerShifter', dopplerView);
registerEditor('vocalEnhancer', vocalView);
registerEditor('guitarSuite', guitarView);
