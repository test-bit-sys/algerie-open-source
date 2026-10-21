// Surround panner for the Track Panner panel in 5.1 sessions: a top view of
// the room with the five main speakers, the listener in the middle and the
// track's position as a puck (its left and right inputs as smaller dots for a
// stereo track). Drag to set angle and radius; the fields set angle, stereo
// spread, radius, centre share and LFE level, and the speaker levels the
// settings produce are listed underneath. Edits are undoable; a drag or a
// field scrub is one step.

import { h } from '../lib/dom.js';
import { hotNumber } from '../ui/controls.js';
import { updateTrack } from '../model/session-edits.js';
import { normSurround, surroundMatrix, SPEAKERS, SURROUND_LABELS, SURROUND_DEFAULTS } from '../engine/surround.js';
import { formatDb, gainToDb } from '../lib/time.js';

const NS = 'http://www.w3.org/2000/svg';
const C = 100;
const R = 78;

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** Stage point for an angle (degrees, 0 = front) and radius (0..100). */
export function surroundPoint(angle, radius, r = R) {
  const a = (angle * Math.PI) / 180;
  const d = (radius / 100) * r;
  return [C + d * Math.sin(a), C - d * Math.cos(a)];
}

/** Angle and radius for a stage point. */
export function surroundFromPoint(x, y) {
  const dx = x - C;
  const dy = C - y;
  const radius = Math.max(0, Math.min(100, Math.round((Math.hypot(dx, dy) / R) * 100)));
  const angle = radius ? Math.round((Math.atan2(dx, dy) * 180) / Math.PI) : 0;
  return { angle, radius };
}

/** Speaker levels in dB for panner settings: [[label, dB]], LFE included (the loudest input feeding each speaker). */
export function speakerLevels(s, inputs = 2) {
  const m = surroundMatrix(s, inputs);
  return SURROUND_LABELS.map((label, c) => [label, gainToDb(Math.max(...m.map((g) => g[c])))]);
}

/** The surround panner body. `target()` gives { doc, track } or null. */
export function surroundPanner(app, target) {
  const stage = svg('svg', { viewBox: '0 0 200 200', class: 'panner-stage surround-stage', 'aria-hidden': 'true' });
  const guides = svg('g', { class: 'panner-guides' });
  for (const f of [0.33, 0.66]) guides.append(svg('circle', { cx: C, cy: C, r: (R * f).toFixed(1), fill: 'none' }));
  guides.append(svg('circle', { cx: C, cy: C, r: R, class: 'major', fill: 'none' }));
  for (let a = 0; a < 360; a += 30) {
    const [x, y] = surroundPoint(a, 100);
    guides.append(svg('line', { x1: C, y1: C, x2: x.toFixed(1), y2: y.toFixed(1) }));
  }
  const speakers = svg('g', { class: 'surround-speakers' });
  for (const [ch, az] of SPEAKERS) {
    const [x, y] = surroundPoint(az, 100, R + 11);
    const g = svg('g', { class: 'surround-speaker' });
    g.append(svg('rect', { x: (x - 8).toFixed(1), y: (y - 6).toFixed(1), width: 16, height: 12, rx: 2 }));
    const t = svg('text', { x: x.toFixed(1), y: (y + 0.5).toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = SURROUND_LABELS[ch];
    g.append(t);
    speakers.append(g);
  }
  const ray = svg('line', { x1: C, y1: C, class: 'panner-ray' });
  const inL = svg('circle', { r: 4, class: 'surround-input' });
  const inR = svg('circle', { r: 4, class: 'surround-input' });
  const listener = svg('circle', { cx: C, cy: C, r: 4, class: 'surround-listener' });
  const puck = svg('circle', { r: 7.5, class: 'panner-puck' });
  stage.append(guides, speakers, ray, listener, inL, inR, puck);
  const pad = h('div.panner-pad.surround-pad', { role: 'group', tabindex: '0', 'aria-label': 'Surround position: arrow keys turn and move the source' }, stage);

  let current = { ...SURROUND_DEFAULTS };
  const commit = (patch, phase = 'change') => {
    const tg = target();
    if (!tg) return;
    const next = normSurround({ ...current, ...patch });
    current = next;
    draw();
    tg.doc.apply('Surround Pan', updateTrack(tg.doc.state, tg.track.id, { surround: next }), { coalesce: `surround:${tg.track.id}` });
    if (phase === 'change') tg.doc.endGesture?.();
  };
  const field = (key, label, o) => hotNumber({ value: SURROUND_DEFAULTS[key], defaultValue: SURROUND_DEFAULTS[key], label, onInput: (v) => commit({ [key]: v }, 'input'), onChange: (v) => commit({ [key]: v }), ...o });
  const angle = field('angle', 'Angle', { min: -180, max: 180, step: 1, format: (v) => `${v}°` });
  const spread = field('spread', 'Stereo Spread', { min: 0, max: 180, step: 1, format: (v) => `${v}°` });
  const radius = field('radius', 'Radius', { min: 0, max: 100, step: 1, format: (v) => `${v} %` });
  const center = field('center', 'Center', { min: 0, max: 100, step: 1, format: (v) => `${v} %` });
  const lfe = field('lfe', 'LFE', { min: 0, max: 100, step: 1, format: (v) => `${v} %` });
  const spreadRow = h('label.panner-field', h('span.prop-label', 'Stereo Spread'), spread);
  const levels = h('div.surround-levels', { 'aria-label': 'Speaker levels' });
  const reset = h('button.btn.panner-reset', { type: 'button', onclick: () => commit({ ...SURROUND_DEFAULTS }) }, 'Reset');
  const fields = h(
    'div.panner-fields.surround-fields',
    h('label.panner-field', h('span.prop-label', 'Angle'), angle),
    spreadRow,
    h('label.panner-field', h('span.prop-label', 'Radius'), radius),
    h('label.panner-field', h('span.prop-label', 'Center'), center),
    h('label.panner-field', h('span.prop-label', 'LFE'), lfe),
    reset,
  );
  const el = h('div.surround-panner', pad, fields, levels);
  let stereo = true;

  function draw() {
    const s = current;
    const [x, y] = surroundPoint(s.angle, s.radius);
    puck.setAttribute('cx', x.toFixed(2));
    puck.setAttribute('cy', y.toFixed(2));
    ray.setAttribute('x2', x.toFixed(2));
    ray.setAttribute('y2', y.toFixed(2));
    for (const [dot, sign] of [[inL, -1], [inR, 1]]) {
      const [a, b] = surroundPoint(s.angle + (sign * s.spread) / 2, s.radius);
      dot.setAttribute('cx', a.toFixed(2));
      dot.setAttribute('cy', b.toFixed(2));
      dot.style.display = stereo ? '' : 'none';
    }
    angle.setValue(s.angle);
    spread.setValue(s.spread);
    radius.setValue(s.radius);
    center.setValue(s.center);
    lfe.setValue(s.lfe);
    spreadRow.hidden = !stereo;
    levels.replaceChildren(...speakerLevels(s, stereo ? 2 : 1).map(([label, db]) => h('span.surround-level', h('span.prop-label', label), h('span.tabular', formatDb(db)))));
  }

  // Pointer: angle and radius from the listener.
  let drag = false;
  const fromEvent = (e) => {
    const r = stage.getBoundingClientRect();
    if (!r.width) return null;
    const scale = Math.min(r.width / 200, r.height / 200);
    const ox = r.left + (r.width - 200 * scale) / 2;
    const oy = r.top + (r.height - 200 * scale) / 2;
    return surroundFromPoint((e.clientX - ox) / scale, (e.clientY - oy) / scale);
  };
  pad.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !target()) return;
    e.preventDefault();
    pad.focus();
    pad.setPointerCapture?.(e.pointerId);
    drag = true;
    const p = fromEvent(e);
    if (p) commit(p, 'input');
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = fromEvent(e);
    if (p) commit(p, 'input');
  });
  const end = () => {
    if (!drag) return;
    drag = false;
    target()?.doc.endGesture?.();
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  pad.addEventListener('dblclick', () => commit({ angle: 0, radius: SURROUND_DEFAULTS.radius }));
  pad.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowLeft') commit({ angle: ((current.angle - step + 540) % 360) - 180 });
    else if (e.key === 'ArrowRight') commit({ angle: ((current.angle + step + 540) % 360) - 180 });
    else if (e.key === 'ArrowUp') commit({ radius: current.radius + step });
    else if (e.key === 'ArrowDown') commit({ radius: current.radius - step });
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  return {
    el,
    /** Shows a track's settings. */
    render(track) {
      if (drag) return;
      stereo = track.channels !== 1;
      current = normSurround(track.surround);
      draw();
    },
  };
}

/** Whether the Track Panner shows the surround panner for this session and track. */
export function usesSurround(doc, track) {
  return doc?.state?.master?.channels === 6 && track && track.type !== 'master' && track.channels !== 6;
}
