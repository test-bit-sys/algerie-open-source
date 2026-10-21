// Default keyboard map: playhead navigation commands (in/out points, page
// left/right), the editor toggle, and the default keys of commands defined
// elsewhere, chosen to match the layout that audio editors commonly share so
// people switching tools keep their habits. Users remap any of them in
// Edit > Keyboard Shortcuts; their choices take precedence.

import { installKeymapCommands } from './keymap-commands.js';

const doc = (app) => app.active;
const hasSel = (app) => Boolean(app.active?.hasSelection);

function seek(app, frame) {
  const d = doc(app);
  frame = Math.max(0, Math.min(d.length, Math.round(frame)));
  const view = app.currentView?.();
  if (view?.seek) view.seek(frame);
  else d.setCursor(frame);
  const v = d.view;
  if (frame < v.start || frame > v.end) d.setView(frame - (v.end - v.start) / 2, frame + (v.end - v.start) / 2);
}

/** Default keys by command id: [primary, ...alternatives]; an empty list leaves a command unbound. */
export const DEFAULT_KEYS = {
  // Transport
  'transport.toStart': ['Home'],
  'transport.toEnd': ['End'],
  'transport.left': ['ArrowLeft'],
  'transport.right': ['ArrowRight'],
  'transport.previous': ['Alt+ArrowLeft'],
  'transport.next': ['Alt+ArrowRight'],
  'transport.pause': ['Mod+Shift+Space'],
  'transport.jumpToTime': ['Mod+J'],
  'transport.punchRoll': ['Alt+Shift+Space'],
  'transport.rewind': ['Alt+Shift+['],
  'transport.forward': ['Alt+Shift+]'],
  'transport.meterInput': ['F10', 'Alt+I'],
  'marker.previous': ['Mod+Alt+ArrowLeft'],
  'marker.next': ['Mod+Alt+ArrowRight'],
  // Edit
  'edit.repeat': ['F2', 'Mod+R'],
  'edit.repeatNoDialog': ['F3', 'Shift+R'],
  'edit.deselect': ['Mod+D', 'Mod+Shift+A'],
  'edit.copyToNew': ['Alt+Shift+C', 'Mod+Alt+C'],
  'edit.insertIntoSession': ['Mod+Shift+I'],
  'edit.editOriginal': ['Mod+E'],
  'clip.editSource': [],
  'edit.crop': ['Mod+T', 'Alt+Shift+T'],
  'edit.convertSampleType': ['Shift+T', 'F11'],
  'edit.clearTimeSelection': ['G'],
  'edit.selectNextClip': ['.'],
  'edit.selectClipsToTrackEnd': ['Mod+Alt+T'],
  'edit.rippleClips': ['Shift+Delete', 'Shift+Backspace'],
  'edit.rippleTimeAll': ['Mod+Shift+Delete', 'Mod+Shift+Backspace'],
  'edit.rippleTimeClips': ['Alt+Delete', 'Alt+Backspace'],
  'edit.inPointLeft': ['Shift+ArrowLeft'],
  'edit.inPointRight': ['Shift+ArrowRight'],
  'edit.inPointToStart': ['Shift+Home'],
  'edit.inPointToEnd': ['Shift+End'],
  'edit.outPointLeft': ['Mod+Shift+ArrowLeft'],
  'edit.outPointRight': ['Mod+Shift+ArrowRight'],
  'edit.outPointToStart': ['Mod+Shift+Home'],
  'edit.outPointToEnd': ['Mod+Shift+End'],
  'zero.inward': ['Shift+I'],
  'zero.outward': ['Shift+O'],
  'zero.leftToLeft': ['Shift+H'],
  'zero.leftToRight': ['Shift+J'],
  'zero.rightToLeft': ['Shift+K'],
  'zero.rightToRight': ['Shift+L'],
  'channel.all': ['Mod+B', 'Mod+Shift+B'],
  'channel.left': ['Mod+Shift+L'],
  'channel.right': ['Mod+Shift+R'],
  'channel.center': ['Mod+Shift+C'],
  'channel.lfe': ['Mod+Shift+F'],
  'channel.leftSurround': ['Alt+Shift+L'],
  'channel.rightSurround': ['Alt+Shift+R'],
  'marker.add': ['M', 'F8', 'Shift+8'],
  'marker.addPoint': ['Mod+F8', 'Mod+Shift+8'],
  'marker.addRange': ['Mod+Shift+M', 'Mod+Shift+F8', 'Shift+M'],
  'marker.addCart': ['C'],
  'marker.rename': ['/'],
  'marker.deleteSelected': ['Mod+0'],
  'marker.deleteAll': ['Mod+Alt+0'],
  // Clip
  'clip.gain': ['Shift+G'],
  'clip.nudgeLeft5': ['Alt+Shift+,'],
  'clip.nudgeRight5': ['Alt+Shift+.'],
  'clip.splitAll': ['Mod+Alt+Shift+K'],
  'clip.suspendGroups': ['Mod+Shift+G'],
  'clip.ungroup': [],
  'clip.trimToSelection': ['Alt+T'],
  // File (browsers keep Mod+N, Mod+W and the like for themselves, so these have a second key)
  'file.newSession': ['Mod+N', 'Alt+N'],
  'file.newAudio': ['Mod+Shift+N', 'Alt+Shift+N'],
  'file.close': ['Mod+W', 'Alt+W'],
  'file.closeAll': ['Mod+Shift+W', 'Alt+Shift+W'],
  'file.openRecentFile': ['Mod+Alt+Shift+O'],
  'file.openRecentSession': ['Mod+Alt+O'],
  'file.nextDocument': ['Ctrl+Tab', 'Mod+Alt+]'],
  'file.previousDocument': ['Ctrl+Shift+Tab', 'Mod+Alt+['],
  // Multitrack
  'mt.addTracks': ['Shift+A'],
  'mt.deleteEmpty': ['Shift+E'],
  'mt.deleteTrack': ['Mod+Alt+Backspace', 'Mod+Alt+Delete'],
  'mt.hideTrack': ['Alt+H'],
  'mt.showAll': ['Alt+Shift+A'],
  'mt.selectNextTrack': ['ArrowDown'],
  'mt.selectPreviousTrack': ['ArrowUp'],
  ...Object.fromEntries([1, 2, 3, 4, 5].flatMap((n) => [
    [`mt.loadVisibility${n}`, [`Shift+${n}`]],
    [`mt.saveVisibility${n}`, [`Alt+Shift+${n}`]],
  ])),
  // View
  'view.autoScroll': ['A'],
  'view.spectral': ['Shift+D', 'F9'],
  'view.zoomResetTime': ['\\'],
  'view.zoomFull': ['Mod+\\'],
  'view.zoomSelection': ['Shift+S'],
  'view.zoomOutTrack': ['Shift+\\'],
  'view.zoomInTrack': ['Shift+/'],
  'view.zoomInPoint': ['Alt+Home'],
  'view.zoomOutPoint': ['Alt+End'],
  'view.zoomWayInPoint': ['Alt+Shift+Home'],
  'view.zoomWayOutPoint': ['Alt+Shift+End'],
  'view.zoomResetAmp': ['Alt+\\'],
  'view.zoomFullFreq': ['Mod+Alt+\\'],
  'view.zoomInFreq': ['Mod+Alt+=', 'Alt+Shift+='],
  'view.zoomOutFreq': ['Mod+Alt+-', 'Alt+Shift+-'],
  'view.specResolutionUp': ['Mod+Shift+ArrowUp'],
  'view.specResolutionDown': ['Mod+Shift+ArrowDown'],
  'view.specMoreLog': ['Mod+Alt+ArrowUp'],
  'view.specMoreLinear': ['Mod+Alt+ArrowDown'],
  'view.specLog': ['Mod+Alt+PageUp'],
  'view.specLinear': ['Mod+Alt+PageDown'],
  'view.scrollLeft': ['Mod+ArrowLeft'],
  'view.scrollRight': ['Mod+ArrowRight'],
  'view.scrollPageLeft': ['Mod+PageUp', 'Shift+PageUp'],
  'view.scrollPageRight': ['Mod+PageDown', 'Shift+PageDown'],
  'view.videoFullScreen': ['Mod+`', 'Alt+`'],
  // Tools
  'spectral.opacityDown': ['Alt+[', 'Shift+['],
  'spectral.opacityUp': ['Alt+]', 'Shift+]'],
  // Analysis, effects and windows
  'analysis.scanAmplitude': ['Mod+Alt+A'],
  'analysis.scanFrequency': ['Mod+Alt+F'],
  'fx.noiseReduction': ['Mod+Shift+P'],
  'window.loudness': ['Alt+5'],
  'window.selection': ['Alt+6'],
  'window.phase': ['Alt+X'],
  'window.metadata': ['Mod+P'],
  // Preferences
  'prefs.general': ['Mod+,', 'Mod+Shift+K'],
  'edit.preferences': ['Mod+Alt+K', 'F4'],
  'prefs.toggleSpectralPlaySelected': ['Shift+Z'],
  'prefs.toggleReturnToStart': ['Shift+X'],
  'prefs.toggleStopAtSelectionEnd': ['Shift+V'],
  'prefs.toggleSyncFiles': ['Mod+Shift+Y'],
};

export function installKeymap(app) {
  const C = app.commands;
  installKeymapCommands(app);
  C.register([
    { id: 'transport.toInPoint', label: 'Move Playhead to In Point', shortcut: 'Q', enabled: hasSel, run: () => seek(app, doc(app).selection.start) },
    { id: 'transport.toOutPoint', label: 'Move Playhead to Out Point', shortcut: 'W', enabled: hasSel, run: () => seek(app, doc(app).selection.end) },
    {
      id: 'transport.pageLeft',
      label: 'Move Playhead Page Left',
      shortcut: 'PageUp',
      enabled: (a) => Boolean(a.active),
      run: () => {
        const d = doc(app);
        const span = d.view.end - d.view.start;
        d.setView(d.view.start - span, d.view.end - span);
        seek(app, app.playhead - span);
      },
    },
    {
      id: 'transport.pageRight',
      label: 'Move Playhead Page Right',
      shortcut: 'PageDown',
      enabled: (a) => Boolean(a.active),
      run: () => {
        const d = doc(app);
        const span = d.view.end - d.view.start;
        d.setView(d.view.start + span, d.view.end + span);
        seek(app, app.playhead + span);
      },
    },
    {
      id: 'edit.setInPoint',
      label: 'Set In Point to Playhead',
      shortcut: 'I',
      enabled: (a) => Boolean(a.active?.setSelection),
      run: () => {
        const d = doc(app);
        const at = Math.round(app.playhead);
        d.setSelection(at, d.hasSelection && d.selection.end > at ? d.selection.end : d.length);
      },
    },
    {
      id: 'edit.setOutPoint',
      label: 'Set Out Point to Playhead',
      shortcut: 'O',
      enabled: (a) => Boolean(a.active?.setSelection),
      run: () => {
        const d = doc(app);
        const at = Math.round(app.playhead);
        d.setSelection(d.hasSelection && d.selection.start < at ? d.selection.start : 0, at);
      },
    },
    {
      id: 'view.toggleEditor',
      label: 'Toggle Waveform and Multitrack Editors',
      shortcut: 'F12',
      altShortcuts: ['1'],
      run: () => C.run(app.active?.kind === 'session' ? 'view.waveform' : 'view.multitrack'),
    },
  ]);
  // Re-register existing commands with their default keys (skipping ones another feature left out).
  for (const [id, keys] of Object.entries(DEFAULT_KEYS)) {
    const def = C.commands.get(id);
    if (!def) continue;
    C.register({ ...def, shortcut: keys[0], altShortcuts: keys.slice(1) });
  }
  C.reloadShortcuts();
}
