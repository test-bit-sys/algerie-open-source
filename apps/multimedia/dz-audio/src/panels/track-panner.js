// Track Panner panel: pan for the selected multitrack track on a half-circle
// stage. The listener sits at the centre of the flat edge; the puck rides the
// arc from hard left through centre to hard right (pan -100..100). Drag
// anywhere on the stage, use the arrow keys, or type a value; double-click
// resets to centre. Changes go through the session's TrackControls, so they
// are undoable and write automation exactly like the track header pan knob.
// In a 5.1 session mono and stereo tracks get the surround panner instead
// (surround-panner.js); 5.1 tracks play each channel to its own speaker.

import { h } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { hotNumber } from '../ui/controls.js';
import { findTrack } from '../model/session-edits.js';
import { formatPan, parsePan } from '../multitrack/levels.js';
import { formatDb, gainToDb } from '../lib/time.js';
import { surroundPanner, usesSurround } from './surround-panner.js';

const NS = 'http://www.w3.org/2000/svg';
// Stage geometry in SVG user units.
const W = 200;
const CX = 100;
const CY = 104;
const R = 84;

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** Point on the arc for pan p (-100..100). */
export function panPoint(p, r = R) {
  const a = ((90 - (p / 100) * 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

/** Pan (-100..100) for a point in stage units: the angle seen from the listener. */
export function panFromPoint(x, y) {
  const dx = x - CX;
  const dy = Math.max(0, CY - y);
  if (!dx && !dy) return 0;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 right .. 180 left
  return Math.max(-100, Math.min(100, Math.round(((90 - deg) / 90) * 100)));
}

/** Left and right gains of the balance law the mixer uses. */
export function balanceGains(p) {
  const v = p / 100;
  return [v > 0 ? 1 - v : 1, v < 0 ? 1 + v : 1];
}

export function trackPannerPanel(app) {
  const stage = svg('svg', { viewBox: `0 0 ${W} 116`, class: 'panner-stage', 'aria-hidden': 'true' });
  const arcPath = (from, to, r) => {
    const [x0, y0] = panPoint(from, r);
    const [x1, y1] = panPoint(to, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 ${to > from ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  // Background: concentric guides, spokes every 25, the arc and its labels.
  const guides = svg('g', { class: 'panner-guides' });
  for (const r of [R * 0.35, R * 0.7]) guides.append(svg('path', { d: arcPath(-100, 100, r) }));
  for (let p = -100; p <= 100; p += 25) {
    const [x, y] = panPoint(p, R);
    guides.append(svg('line', { x1: CX, y1: CY, x2: x.toFixed(2), y2: y.toFixed(2), class: p % 100 === 0 || p === 0 ? 'major' : '' }));
  }
  guides.append(svg('line', { x1: CX - R - 6, y1: CY, x2: CX + R + 6, y2: CY, class: 'major' }));
  const rail = svg('path', { d: arcPath(-100, 100, R), class: 'panner-rail' });
  const fillArc = svg('path', { class: 'panner-fill' });
  const ray = svg('line', { x1: CX, y1: CY, class: 'panner-ray' });
  const labels = svg('g', { class: 'panner-labels' });
  for (const [p, text] of [[-100, 'L'], [0, 'C'], [100, 'R']]) {
    // C sits above the puck's travel; L and R below the ends of the arc.
    const [x, y] = panPoint(p, R + (p === 0 ? 15 : 9));
    const t = svg('text', { x: x.toFixed(1), y: (p === 0 ? y : y + 10).toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = text;
    labels.append(t);
  }
  const listener = svg('g', { class: 'panner-listener' });
  listener.append(svg('circle', { cx: CX, cy: CY, r: 5 }), svg('path', { d: `M${CX - 9} ${CY}a9 9 0 0 1 18 0` }));
  const puck = svg('circle', { r: 7.5, class: 'panner-puck' });
  stage.append(guides, rail, fillArc, ray, labels, listener, puck);

  const pad = h('div.panner-pad', { role: 'slider', tabindex: '0', 'aria-label': 'Pan', 'aria-valuemin': '-100', 'aria-valuemax': '100' }, stage);
  const trackSelect = h('select.select.panner-track', { 'aria-label': 'Track' });
  const auto = h('span.panner-auto', { hidden: true, title: 'Pan follows the automation lane in this mode' }, 'Automated');
  const panNum = hotNumber({ value: 0, min: -100, max: 100, step: 1, defaultValue: 0, label: 'Pan', format: formatPan, parse: parsePan, onInput: (v) => set(v, 'input'), onChange: (v) => set(v, 'change') });
  const leftOut = h('span.panner-gain.tabular');
  const rightOut = h('span.panner-gain.tabular');
  const reset = h('button.btn.panner-reset', { type: 'button', onclick: () => set(0, 'change') }, icon('rotate-ccw', 13), 'Center');
  const fields = h(
    'div.panner-fields',
    h('label.panner-field', h('span.prop-label', 'Pan'), panNum),
    h('div.panner-field', h('span.prop-label', 'Left'), leftOut),
    h('div.panner-field', h('span.prop-label', 'Right'), rightOut),
    reset,
  );
  const surround = surroundPanner(app, () => target());
  const sixNote = h('p.muted.panner-note', { hidden: true }, 'This 5.1 track plays each of its channels to the matching speaker. Its volume and the master fader set its level.');
  surround.el.hidden = true;
  const body = h('div.panner-body', h('div.panner-head', trackSelect, auto), pad, fields, surround.el, sixNote);
  const empty = h('div.empty-state.panner-empty', h('p', 'Select an audio or bus track in a multitrack session to pan it here.'));
  const el = h('div.track-panner-panel', body, empty);
  let visible = false;
  let raf = 0;
  let shown = null;
  let optionsKey = '';

  const session = () => (app.active?.kind === 'session' ? app.active : null);
  /** The track being panned: the session's selected track unless it is the master. */
  const target = () => {
    const doc = session();
    const t = doc && findTrack(doc.state, doc.selectedTrack);
    return t && t.type !== 'master' ? { doc, track: t } : null;
  };

  function set(v, phase) {
    const tg = target();
    if (!tg) return;
    v = Math.max(-100, Math.min(100, Math.round(v)));
    tg.doc.controls?.set(tg.track.id, 'pan', v, phase);
    if (phase === 'input') draw(v);
  }

  function draw(p) {
    shown = p;
    const [x, y] = panPoint(p);
    puck.setAttribute('cx', x.toFixed(2));
    puck.setAttribute('cy', y.toFixed(2));
    ray.setAttribute('x2', x.toFixed(2));
    ray.setAttribute('y2', y.toFixed(2));
    fillArc.setAttribute('d', p ? arcPath(0, p, R) : '');
    pad.setAttribute('aria-valuenow', String(p));
    pad.setAttribute('aria-valuetext', formatPan(p));
    if (panNum.getValue() !== p) panNum.setValue(p);
    const [l, r] = balanceGains(p);
    leftOut.textContent = formatDb(gainToDb(l));
    rightOut.textContent = formatDb(gainToDb(r));
  }

  const render = () => {
    const tg = target();
    const doc = session();
    el.classList.toggle('no-track', !tg);
    if (doc) {
      // Rebuild the options only when the track list changes (an open list stays open).
      const key = `${doc.id}|${tg ? '' : 'none'}|${doc.state.tracks.map((t) => `${t.id}:${t.name}`).join('|')}`;
      if (key !== optionsKey) {
        optionsKey = key;
        trackSelect.replaceChildren(...doc.state.tracks.map((t) => h('option', { value: t.id }, t.type === 'bus' ? `${t.name} (Bus)` : t.name)));
        if (!tg) trackSelect.append(h('option', { value: '', disabled: true }, 'Mix (no pan)'));
      }
      trackSelect.value = tg ? tg.track.id : '';
    }
    if (!tg) return;
    el.style.setProperty('--track-color', tg.track.color);
    const sur = usesSurround(tg.doc, tg.track);
    const six = tg.doc.state.master.channels === 6 && tg.track.channels === 6;
    pad.hidden = fields.hidden = sur || six;
    surround.el.hidden = !sur;
    sixNote.hidden = !six;
    if (sur) {
      auto.hidden = true;
      surround.render(tg.track);
      return;
    }
    if (six) return;
    const c = tg.doc.controls;
    const automated = Boolean(c?.automated(tg.track, 'pan'));
    auto.hidden = !automated;
    draw(Math.round(c ? c.value(tg.track, 'pan') : tg.track.pan));
  };

  // Pointer: the angle from the listener sets pan; Shift skips the snap to centre.
  let drag = false;
  const fromEvent = (e) => {
    const r = stage.getBoundingClientRect();
    if (!r.width) return shown ?? 0;
    // The SVG keeps its aspect ratio centred in the pad (meet).
    const scale = Math.min(r.width / W, r.height / 116);
    const ox = r.left + (r.width - W * scale) / 2;
    const oy = r.top + (r.height - 116 * scale) / 2;
    const p = panFromPoint((e.clientX - ox) / scale, (e.clientY - oy) / scale);
    return !e.shiftKey && Math.abs(p) <= 3 ? 0 : p;
  };
  pad.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !target()) return;
    e.preventDefault();
    pad.focus();
    pad.setPointerCapture?.(e.pointerId);
    drag = true;
    set(fromEvent(e), 'input');
  });
  pad.addEventListener('pointermove', (e) => drag && set(fromEvent(e), 'input'));
  const end = () => {
    if (!drag) return;
    drag = false;
    set(shown ?? 0, 'change');
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  pad.addEventListener('dblclick', () => set(0, 'change'));
  pad.addEventListener('keydown', (e) => {
    const cur = shown ?? 0;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(cur - step, 'change');
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(cur + step, 'change');
    else if (e.key === 'PageDown') set(cur - 10, 'change');
    else if (e.key === 'PageUp') set(cur + 10, 'change');
    else if (e.key === 'Home') set(-100, 'change');
    else if (e.key === 'End') set(100, 'change');
    else if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '0' || e.key === 'c' || e.key === 'C') set(0, 'change');
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  trackSelect.addEventListener('change', () => session()?.selectTrack(trackSelect.value));

  // Automation moves the puck during playback.
  const tick = () => {
    raf = 0;
    if (!visible || !app.engine.playing) return;
    const tg = target();
    if (tg && !drag) {
      const p = Math.round(tg.doc.controls ? tg.doc.controls.value(tg.track, 'pan') : tg.track.pan);
      if (p !== shown) draw(p);
    }
    raf = requestAnimationFrame(tick);
  };
  app.on('transport', () => {
    if (!raf && visible && app.engine.playing) raf = requestAnimationFrame(tick);
    render();
  });
  app.on('active', render);
  app.on('doc-change', (doc, e) => {
    if (doc !== app.active || doc.kind !== 'session' || drag) return;
    if (e.kind === 'edit' || e.kind === 'history' || e.kind === 'clip-selection' || e.kind === 'cursor' || e.kind === 'automation') render();
  });
  render();
  return {
    el,
    render,
    show() {
      visible = true;
      render();
      if (app.engine.playing && !raf) raf = requestAnimationFrame(tick);
    },
    hide() {
      visible = false;
    },
  };
}
