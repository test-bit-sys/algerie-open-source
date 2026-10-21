// Editor panel: shows the active document's view (waveform or multitrack) above
// the transport bar. Views are created per document and cached while it is
// open. A single requestAnimationFrame loop drives drawing while anything is
// dirty or playing.

import { h } from '../lib/dom.js';
import { icon, appIcon } from '../ui/icons.js';
import { WaveformView } from '../editor/waveform-view.js';
import { installPreviewEditor } from '../editor/preview-editor.js';
import { transportButtons, zoomButtons, playheadText, openTimeFormatMenu } from './transport-controls.js';

export function editorPanel(app) {
  const views = new Map();
  const stage = h('div.editor-stage');
  const transport = buildTransport(app);
  const empty = buildEmpty(app);
  const previewHost = h('div.preview-host');
  const el = h('div.editor-panel', stage, previewHost, transport.el);
  installPreviewEditor(app, previewHost);
  let current = null;
  let visible = false;
  let raf = 0;

  const viewFor = (doc) => {
    let v = views.get(doc);
    if (!v) {
      const kind = app.documentKinds.get(doc.kind);
      v = kind?.view ? kind.view(app, doc) : new WaveformView(app, doc);
      views.set(doc, v);
      doc.once('close', () => {
        v.destroy?.();
        views.delete(doc);
      });
    }
    return v;
  };

  const show = () => {
    const doc = app.active;
    const next = doc ? viewFor(doc) : null;
    if (next !== current || !stage.firstChild) {
      current = next;
      stage.replaceChildren(current ? current.el : empty);
      if (current) requestAnimationFrame(() => current?.layout?.());
    }
    transport.update();
    app.requestRender();
  };

  const tick = () => {
    raf = 0;
    if (!visible) return;
    current?.frame?.();
    transport.tick();
    if (app.engine.playing || app.recording) app.requestRender();
  };
  app.requestRender = () => {
    if (!raf && visible) raf = requestAnimationFrame(tick);
  };

  app.on('active', show);
  app.on('transport', () => {
    transport.update();
    app.requestRender();
  });
  app.on('doc-change', (doc, e) => {
    if (doc === app.active && e.kind !== 'view') transport.update();
  });
  app.on('prefs', () => transport.update());
  app.currentView = () => current;

  return {
    el,
    show() {
      visible = true;
      show();
    },
    hide() {
      visible = false;
    },
    focus() {
      current?.focus?.();
    },
  };
}

function buildEmpty(app) {
  const action = (label, cmd, ic) => h('button.btn', { type: 'button', onclick: () => app.commands.run(cmd) }, icon(ic, 16), label);
  return h(
    'div.editor-empty',
    h('div.editor-empty-inner',
      h('div.editor-empty-icon', appIcon(72)),
      h('h2', 'No file open'),
      h('p.muted', 'Open audio from your Puter files or this device, record something new, or start a multitrack session. You can also drop audio files anywhere in the window.'),
      h('div.editor-empty-actions',
        action('Open', 'file.open', 'folder-open'),
        action('New Audio File', 'file.newAudio', 'file-plus'),
        action('New Multitrack Session', 'file.newSession', 'mode-multitrack'),
        action('Record', 'transport.record', 'mic'),
      ),
    ),
  );
}

function buildTransport(app) {
  const time = h('button.time-display', { type: 'button', title: 'Playhead time. Click to choose the time format.', 'aria-label': 'Playhead time' }, '0:00.000');
  time.addEventListener('click', () => openTimeFormatMenu(app, time, { above: true }));
  const buttons = transportButtons(app);
  const zoom = zoomButtons(app);
  const el = h(
    'div.transport',
    { role: 'toolbar', 'aria-label': 'Transport' },
    h('div.transport-time', time),
    h('div.transport-buttons', buttons.list),
    h('div.transport-zoom', zoom.list),
  );
  let lastText = '';
  return {
    el,
    tick() {
      const text = playheadText(app);
      if (text !== lastText) {
        time.textContent = text;
        lastText = text;
      }
      time.classList.toggle('idle', !app.active);
    },
    update() {
      buttons.update();
      zoom.update();
      this.tick();
    },
  };
}
