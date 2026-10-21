// Transport panel: the editor's transport buttons in a frame of their own, so
// a workspace can place them anywhere (or hide the editor's bar behind a
// maximized editor). Buttons reflect playing, recording, loop and skip state.

import { h } from '../lib/dom.js';
import { transportButtons } from './transport-controls.js';

export function transportPanel(app) {
  const buttons = transportButtons(app, { size: 18 });
  for (const b of buttons.list) b.classList.add('tool-panel-btn');
  const el = h('div.button-panel.transport-panel', h('div.button-panel-row', { role: 'toolbar', 'aria-label': 'Transport' }, buttons.list));
  let pending = 0;

  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(() => {
      pending = 0;
      buttons.update();
    });
  };
  for (const ev of ['active', 'transport', 'prefs', 'documents']) app.on(ev, schedule);
  app.on('doc-change', (doc, e) => doc === app.active && e.kind !== 'view' && schedule());
  buttons.update();
  return { el, render: buttons.update, show: buttons.update };
}
