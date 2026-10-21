// Zoom panel: a row of zoom buttons running the View menu's zoom commands.
// Buttons follow each command's enabled state and its label in the active
// editor (in a session, amplitude zoom changes track height); the frequency
// zooms apply while the spectral display is on.

import { h } from '../lib/dom.js';
import { zoomButtons, syncButtons } from './transport-controls.js';

export const ZOOM_PANEL_BUTTONS = [
  ['view.zoomInAmp', 'zoom-in-amp', 'Zoom In (Amplitude)'],
  ['view.zoomOutAmp', 'zoom-out-amp', 'Zoom Out (Amplitude)'],
  ['view.zoomInTime', 'zoom-in-time', 'Zoom In (Time)'],
  ['view.zoomOutTime', 'zoom-out-time', 'Zoom Out (Time)'],
  ['view.zoomInFreq', 'zoom-in-freq', 'Zoom In (Frequency)'],
  ['view.zoomOutFreq', 'zoom-out-freq', 'Zoom Out (Frequency)'],
  ['view.zoomFull', 'zoom-full', 'Zoom Out Full (All Axes)'],
  ['view.zoomSelection', 'zoom-selection', 'Zoom to Selection'],
  ['view.zoomInPoint', 'zoom-in-point', 'Zoom In at In Point'],
  ['view.zoomOutPoint', 'zoom-out-point', 'Zoom In at Out Point'],
];

export function zoomPanel(app) {
  const zoom = zoomButtons(app, ZOOM_PANEL_BUTTONS, { cls: '.tool-panel-btn', size: 18 });
  const el = h('div.button-panel.zoom-panel', h('div.button-panel-row', { role: 'toolbar', 'aria-label': 'Zoom' }, zoom.list));
  let pending = 0;

  const render = () => {
    syncButtons(app, zoom.list, { pressed: false });
    for (const b of zoom.list) {
      const label = app.commands.label(b.dataset.cmd);
      const key = app.commands.shortcutLabel(b.dataset.cmd);
      const text = key ? `${label} (${key})` : label;
      if (b.title !== text) {
        b.title = text;
        b.setAttribute('aria-label', text);
      }
    }
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(() => {
      pending = 0;
      render();
    });
  };
  for (const ev of ['active', 'prefs', 'tool', 'documents']) app.on(ev, schedule);
  app.on('doc-change', (doc, e) => doc === app.active && e.kind !== 'cursor' && schedule());
  render();
  return { el, render, show: render };
}
