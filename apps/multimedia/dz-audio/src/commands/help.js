// Help menu: a Getting Started guide, the event log, and links to the
// project's source and issue tracker.

import { h } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';

const REPO = 'https://github.com/HeyPuter/everything';
export const SOURCE_URL = `${REPO}/tree/main/src/audio-studio`;
export const ISSUES_URL = `${REPO}/issues/new?labels=audio-studio&title=${encodeURIComponent('Audio Studio: ')}`;

/** Getting Started topics: a title, an icon and a few steps, each naming the commands it uses. */
export const GUIDE = [
  {
    title: 'Edit a single file',
    icon: 'mode-waveform',
    steps: [
      ['Open audio with File > Open, or drop files anywhere in the window.', 'file.open'],
      ['Drag across the waveform to select time; drag near the top or bottom of a channel to select just that channel.', null],
      ['Cut, copy, paste and delete work on the selection; every step can be undone in the History panel.', 'edit.undo'],
      ['Save back to Puter with File > Save, or export another format with File > Export.', 'file.save'],
    ],
  },
  {
    title: 'Mix several tracks',
    icon: 'mode-multitrack',
    steps: [
      ['Start a session with File > New > Multitrack Session.', 'file.newSession'],
      ['Drag files from the Files or Media Browser panels onto tracks.', null],
      ['Use the Move tool to arrange clips and the Razor tool to split them; drag clip corners to fade.', 'tool.move'],
      ['Balance tracks in the Mixer, then render with Multitrack > Mixdown Session to New File.', 'window.mixer'],
    ],
  },
  {
    title: 'Clean up and enhance',
    icon: 'sparkles',
    steps: [
      ['Pick an audio type in the Sound Assistant panel for one-click repair and loudness.', 'window.assistant'],
      ['For noise, select a noise-only stretch, capture a noise print, then run Noise Reduction.', 'fx.captureNoisePrint'],
      ['Stack effects in the Effects Rack to hear them live before applying.', 'window.effects'],
      ['Show the spectral display to see and paint out clicks, hum and other sounds.', 'view.spectral'],
    ],
  },
  {
    title: 'Record',
    icon: 'mic',
    steps: [
      ['Press Record in the transport. In a session, arm tracks with their R button first.', 'transport.record'],
      ['Choose the input device in Preferences > Audio Hardware.', 'edit.preferences'],
      ['Turn on View > Metering > Meter Input Signal to check levels before recording.', 'transport.meterInput'],
    ],
  },
];

function guideDialog(app) {
  const shortcut = (id) => (id && app.commands.commands.has(id) ? app.commands.shortcutLabel(id) : '');
  const topics = GUIDE.map((t) =>
    h(
      'section.guide-topic',
      h('h3.guide-title', icon(t.icon, 16), t.title),
      h(
        'ol.guide-steps',
        t.steps.map(([text, cmd]) => {
          const keys = shortcut(cmd);
          return h('li', text, keys ? h('kbd.guide-kbd', keys) : null);
        }),
      ),
    ),
  );
  return openDialog({
    title: 'Getting Started',
    wide: true,
    body: h(
      'div.guide',
      h('p.muted', 'Audio Studio has two editors: the Waveform editor for changing one file sample by sample, and the Multitrack editor for arranging and mixing many clips without changing the source files. Switch between them with the buttons at the top left.'),
      h('div.guide-grid', topics),
      h('p.faint', 'Search commands with the box in the toolbar, and see every shortcut in Help > Keyboard Shortcuts.'),
    ),
    footerStart: h('button.btn', { type: 'button', onclick: () => app.commands.run('help.shortcuts') }, 'Keyboard Shortcuts'),
    buttons: [{ label: 'Close', value: true, primary: true }],
  });
}

export function installHelpCommands(app) {
  app.commands.register([
    { id: 'help.gettingStarted', label: 'Getting Started', shortcut: 'F1', run: () => guideDialog(app) },
    { id: 'help.events', label: 'Show Event Log', enabled: (a) => a.panels.has('events'), run: () => app.dock.openPanel('events') },
    { id: 'help.reportIssue', label: 'Report a Problem...', run: () => window.open(ISSUES_URL, '_blank', 'noopener') },
    { id: 'help.source', label: 'Source Code', run: () => window.open(SOURCE_URL, '_blank', 'noopener') },
  ]);
}
