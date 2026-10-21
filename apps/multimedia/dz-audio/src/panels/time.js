// Time panel: a large readout of the playhead in the current time format.
// It follows playback through requestAnimationFrame only while the panel is
// visible and audio is playing or recording. Click the readout (or use the
// panel menu) to choose the time format; the text scales with the panel.

import { h } from '../lib/dom.js';
import { playheadText, openTimeFormatMenu } from './transport-controls.js';
import { TIME_FORMATS, TIME_DISPLAY_KEYS } from '../lib/time.js';

export function timePanel(app) {
  const readout = h('button.time-big', { type: 'button', 'aria-label': 'Playhead time', title: 'Playhead time. Click to choose the time format.', 'aria-haspopup': 'menu' }, '0:00.000');
  const format = h('div.time-big-format', { 'aria-hidden': 'true' });
  const el = h('div.time-panel', readout, format);
  let visible = false;
  let raf = 0;
  let last = '';

  readout.addEventListener('click', () => openTimeFormatMenu(app, readout));
  readout.addEventListener('keydown', (e) => {
    // Up and Down step through the formats without opening the menu.
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const ids = TIME_FORMATS.map((f) => f.id);
    const i = Math.max(0, ids.indexOf(app.prefs.get('timeFormat')));
    app.prefs.set('timeFormat', ids[(i + (e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length]);
  });

  const render = () => {
    const text = playheadText(app);
    if (text !== last) {
      readout.textContent = text;
      // Font size follows the panel and the length of the text (see .time-big).
      el.style.setProperty('--chars', String(Math.max(6, text.length)));
      last = text;
    }
    const label = TIME_FORMATS.find((f) => f.id === app.prefs.get('timeFormat'))?.label || '';
    if (format.textContent !== label) format.textContent = label;
  };

  const tick = () => {
    raf = 0;
    if (!visible) return;
    render();
    if (app.engine.playing || app.recording) raf = requestAnimationFrame(tick);
  };
  const schedule = () => {
    if (!raf && visible) raf = requestAnimationFrame(tick);
  };

  app.on('transport', schedule);
  app.on('active', schedule);
  app.on('prefs', (key) => TIME_DISPLAY_KEYS.has(key) && schedule());
  app.on('doc-change', (doc, e) => doc === app.active && (e.kind === 'cursor' || e.kind === 'edit' || e.kind === 'history') && schedule());
  render();
  return {
    el,
    render,
    show() {
      visible = true;
      schedule();
    },
    hide() {
      visible = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    focus() {
      readout.focus();
    },
  };
}
