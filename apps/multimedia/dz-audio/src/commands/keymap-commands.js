// Commands that exist mainly to be reached from the keyboard: fine playhead
// and selection-edge moves, view scrolling, channel enables, track switches,
// file switching, preference toggles, workspace slots and a few panel
// actions. installKeymap() registers them before it assigns default keys.

import { announce } from '../lib/dom.js';
import { promptDialog } from '../ui/dialog.js';
import { parseTime, TIME_FORMATS } from '../lib/time.js';
import * as S from '../model/session-edits.js';
import { settings as spectralSettings, setSettings as setSpectralSettings, displayOn, logScale, FFT_SIZES } from '../spectral/state.js';
import { rackFor, setRack, applyRack } from '../effects/rack-panel.js';
import { createRack, rackActive } from '../effects/rack.js';
import { orderedNames } from '../ui/workspace-manager.js';

const doc = (app) => app.active;
const anyDoc = (app) => Boolean(app.active);
const audio = (app) => (app.active?.kind === 'audio' ? app.active : null);
const session = (app) => (app.active?.kind === 'session' ? app.active : null);
const limit = (d) => d.extent ?? d.length;

/** Frames for one small keyboard step: ten screen pixels at the current zoom, at most 5% of the view. */
export function stepFrames(app, d = doc(app)) {
  const span = d.view.end - d.view.start;
  const fpp = app.currentView?.()?.fpp || span / 1000;
  return Math.max(1, Math.round(Math.min(fpp * 10, span / 20)));
}

/** Scrolls the view (keeping its zoom) so `frame` is visible. */
function reveal(d, frame) {
  const { start, end } = d.view;
  if (frame >= start && frame <= end) return;
  const span = end - start;
  d.setView(frame - span / 2, frame + span / 2);
}

function seek(app, frame) {
  const d = doc(app);
  frame = Math.max(0, Math.min(limit(d), Math.round(frame)));
  const view = app.currentView?.();
  if (view?.seek) view.seek(frame);
  else d.setCursor(frame);
  reveal(d, frame);
}

/**
 * Moves one edge of the time selection to `to`; with no selection both edges
 * start at the playhead. Edges that cross swap roles.
 */
export function moveEdge(app, edge, to) {
  const d = doc(app);
  const p = Math.round(app.playhead);
  let a = d.hasSelection ? d.selection.start : p;
  let b = d.hasSelection ? d.selection.end : p;
  to = Math.max(0, Math.min(limit(d), Math.round(to)));
  if (edge === 'in') a = to;
  else b = to;
  d.setSelection(Math.min(a, b), Math.max(a, b));
  reveal(d, to);
}

const edgeAt = (app, edge) => {
  const d = doc(app);
  if (!d.hasSelection) return Math.round(app.playhead);
  return edge === 'in' ? d.selection.start : d.selection.end;
};

function scrollBy(app, fraction) {
  const d = doc(app);
  const span = d.view.end - d.view.start;
  d.setView(d.view.start + span * fraction, d.view.end + span * fraction);
}

/** Zooms so roughly four screen pixels show one sample, centred on `frame`. */
function zoomWayIn(app, frame) {
  const d = doc(app);
  const width = app.currentView?.()?.width || 1000;
  const span = Math.max(16, Math.round(width / 4));
  d.setView(frame - span / 2, frame + span / 2);
}

// Multichannel order of WAV files: L, R, C, LFE, Ls, Rs.
const CHANNELS = [
  ['left', 'Left', 0],
  ['right', 'Right', 1],
  ['center', 'Center', 2],
  ['lfe', 'LFE', 3],
  ['leftSurround', 'Left Surround', 4],
  ['rightSurround', 'Right Surround', 5],
];

/** Boolean preferences worth a keyboard toggle: [id, pref key, label]. */
const PREF_TOGGLES = [
  ['prefs.toggleSpectralPlaySelected', 'spectralPlaySelected', 'Play Only Selected Frequencies'],
  ['prefs.toggleReturnToStart', 'returnToStart', 'Return Playhead to Start on Stop'],
  ['prefs.toggleStopAtSelectionEnd', 'stopAtSelectionEnd', 'Stop Playback at Selection End'],
  ['prefs.toggleSyncFiles', 'syncFiles', 'Keep Playhead, Selection and Zoom in Sync Across Files'],
  ['prefs.toggleScrubAudio', 'scrubAudio', 'Play Audio While Scrubbing'],
];

const SESSION_EXT = /\.(asesx|sesx|session\.json)$/i;

/** The most recent entry of the Open Recent list that is a session (or a file). */
export function latestRecent(list, wantSession) {
  return (list || []).find((r) => SESSION_EXT.test(r.name || '') === wantSession) || null;
}

/** The document after (dir 1) or before (dir -1) the active one, wrapping around. */
export function cycleDocument(documents, active, dir) {
  if (documents.length < 2) return null;
  const i = documents.indexOf(active);
  return documents[(i + dir + documents.length) % documents.length];
}

/** Next FFT size up (dir 1) or down (dir -1), or null at the end of the range. */
export function nextFftSize(size, dir) {
  const i = FFT_SIZES.indexOf(size);
  const j = (i < 0 ? FFT_SIZES.indexOf(2048) : i) + dir;
  return j >= 0 && j < FFT_SIZES.length ? FFT_SIZES[j] : null;
}

export function installKeymapCommands(app) {
  const C = app.commands;
  const hasAudio = (a) => Boolean(audio(a));
  const selTrack = (a) => {
    const d = session(a);
    return d ? S.findTrack(d.state, d.selectedTrack) : null;
  };
  const switchable = (t) => t && t.type !== 'master';
  const toggleTrack = (key) => () => {
    const d = session(app);
    const t = selTrack(app);
    if (d.controls) d.controls.toggle(t.id, key);
    else d.apply('Track', S.updateTrack(d.state, t.id, { [key]: !t[key] }));
  };
  // "for All": switches every eligible track on, or off when all already are.
  const toggleAll = (key, label, pick) => () => {
    const d = session(app);
    const tracks = S.allTracks(d.state).filter(pick);
    const on = !tracks.every((t) => t[key]);
    let state = d.state;
    for (const t of tracks) state = S.updateTrack(state, t.id, { [key]: on });
    d.apply(`${label} ${on ? 'On' : 'Off'}`, state);
  };
  const audioTrack = (t) => t.type === 'audio';
  const mixTrack = (t) => t.type === 'audio' || t.type === 'bus';
  const spectralOn = (a) => hasAudio(a) && displayOn(a);
  const status = (text) => {
    app.setStatus?.(text);
    announce(text);
  };

  C.register([
    // ------------------------------------------------------------ Transport
    { id: 'transport.left', label: 'Move Playhead Left', enabled: anyDoc, run: () => seek(app, app.playhead - stepFrames(app)) },
    { id: 'transport.right', label: 'Move Playhead Right', enabled: anyDoc, run: () => seek(app, app.playhead + stepFrames(app)) },
    {
      id: 'transport.jumpToTime',
      label: 'Jump to Time...',
      enabled: anyDoc,
      run: async () => {
        const d = doc(app);
        const fmt = app.prefs.get('timeFormat');
        const opts = app.timeOptions?.() || {};
        const read = (v) => parseTime(v, d.sampleRate, fmt, opts);
        const text = await promptDialog({
          title: 'Jump to Time',
          label: 'Time:',
          value: app.formatTime(app.playhead, d.sampleRate),
          confirm: 'Jump',
          validate: (v) => (Number.isFinite(read(v)) ? '' : 'Enter a time in the current time display format.'),
        });
        if (text === null || text === undefined) return;
        seek(app, read(text));
      },
    },

    // ----------------------------------------------------- Selection edges
    { id: 'edit.inPointLeft', label: 'Move In Point Left', enabled: anyDoc, run: () => moveEdge(app, 'in', edgeAt(app, 'in') - stepFrames(app)) },
    { id: 'edit.inPointRight', label: 'Move In Point Right', enabled: anyDoc, run: () => moveEdge(app, 'in', edgeAt(app, 'in') + stepFrames(app)) },
    { id: 'edit.inPointToStart', label: 'Move In Point to Beginning', enabled: anyDoc, run: () => moveEdge(app, 'in', 0) },
    { id: 'edit.inPointToEnd', label: 'Move In Point to End', enabled: anyDoc, run: () => moveEdge(app, 'in', limit(doc(app))) },
    { id: 'edit.outPointLeft', label: 'Move Out Point Left', enabled: anyDoc, run: () => moveEdge(app, 'out', edgeAt(app, 'out') - stepFrames(app)) },
    { id: 'edit.outPointRight', label: 'Move Out Point Right', enabled: anyDoc, run: () => moveEdge(app, 'out', edgeAt(app, 'out') + stepFrames(app)) },
    { id: 'edit.outPointToStart', label: 'Move Out Point to Beginning', enabled: anyDoc, run: () => moveEdge(app, 'out', 0) },
    { id: 'edit.outPointToEnd', label: 'Move Out Point to End', enabled: anyDoc, run: () => moveEdge(app, 'out', limit(doc(app))) },

    // ------------------------------------------------------------ Channels
    {
      id: 'channel.all',
      label: 'Enable All Channels',
      enabled: (a) => audio(a)?.channelCount > 1,
      checked: (a) => Boolean(audio(a)?.selection.channels.every((c) => c !== false)),
      run: () => {
        const d = audio(app);
        d.setSelection(d.selection.start, d.selection.end, { channels: d.state.channels.map(() => true) });
      },
    },
    ...CHANNELS.map(([key, name, i]) => ({
      id: `channel.${key}`,
      label: `Toggle ${name} Channel`,
      enabled: (a) => audio(a)?.channelCount > Math.max(1, i),
      checked: (a) => audio(a)?.selection.channels[i] !== false,
      run: () => {
        const d = audio(app);
        d.setChannelEnabled(i, d.selection.channels[i] === false);
        announce(`${name} channel ${d.selection.channels[i] === false ? 'disabled' : 'enabled'}`);
      },
    })),

    // ------------------------------------------------------------ Markers
    { id: 'marker.addPoint', label: 'Add Point Marker', enabled: hasAudio, run: () => app.currentView?.()?.addMarker?.({ range: false }) },

    // ---------------------------------------------------------------- View
    { id: 'view.scrollLeft', label: 'Scroll Left', enabled: anyDoc, run: () => scrollBy(app, -0.1) },
    { id: 'view.scrollRight', label: 'Scroll Right', enabled: anyDoc, run: () => scrollBy(app, 0.1) },
    { id: 'view.scrollPageLeft', label: 'Scroll Page Left', enabled: anyDoc, run: () => scrollBy(app, -1) },
    { id: 'view.scrollPageRight', label: 'Scroll Page Right', enabled: anyDoc, run: () => scrollBy(app, 1) },
    {
      id: 'view.scrollToSelection',
      label: 'Scroll to Selection',
      enabled: (a) => Boolean(a.active?.hasSelection),
      run: () => {
        const d = doc(app);
        const span = d.view.end - d.view.start;
        const mid = (d.selection.start + d.selection.end) / 2;
        d.setView(mid - span / 2, mid + span / 2);
      },
    },
    {
      id: 'view.scrollToStart',
      label: 'Scroll to Start',
      enabled: anyDoc,
      run: () => {
        const d = doc(app);
        d.setView(0, d.view.end - d.view.start);
      },
    },
    { id: 'view.zoomWayInPoint', label: 'Zoom Way In at In Point', enabled: anyDoc, run: () => zoomWayIn(app, edgeAt(app, 'in')) },
    { id: 'view.zoomWayOutPoint', label: 'Zoom Way In at Out Point', enabled: anyDoc, run: () => zoomWayIn(app, edgeAt(app, 'out')) },
    { id: 'view.zoomResetAmp', label: 'Zoom Reset (Amplitude)', enabled: (a) => Boolean(a.active?.setAmp), run: () => doc(app).setAmp(1) },
    ...[-1, 1].map((dir) => ({
      id: dir > 0 ? 'view.nextTimeFormat' : 'view.previousTimeFormat',
      label: dir > 0 ? 'Next Time Display Format' : 'Previous Time Display Format',
      run: () => {
        const i = TIME_FORMATS.findIndex((f) => f.id === app.prefs.get('timeFormat'));
        const f = TIME_FORMATS[(i + dir + TIME_FORMATS.length) % TIME_FORMATS.length];
        app.prefs.set('timeFormat', f.id);
        status(`Time display: ${f.label}`);
      },
    })),
    ...[1, -1].map((dir) => ({
      id: dir > 0 ? 'view.specResolutionUp' : 'view.specResolutionDown',
      label: dir > 0 ? 'Increase Spectral Resolution' : 'Decrease Spectral Resolution',
      enabled: (a) => spectralOn(a) && nextFftSize(spectralSettings(a).fft, dir) !== null,
      run: () => {
        const fft = nextFftSize(spectralSettings(app).fft, dir);
        setSpectralSettings(app, { fft });
        status(`Spectral resolution: ${fft} bands`);
      },
    })),
    // The frequency axis has two scales, so a step either way reaches the end.
    { id: 'view.specMoreLog', label: 'Spectral Scale One Step More Logarithmic', enabled: (a) => spectralOn(a) && !logScale(a), run: () => app.prefs.set('spectralLog', true) },
    { id: 'view.specMoreLinear', label: 'Spectral Scale One Step More Linear', enabled: (a) => spectralOn(a) && logScale(a), run: () => app.prefs.set('spectralLog', false) },
    {
      id: 'view.videoFullScreen',
      label: 'Full Screen Video',
      enabled: (a) => a.panels?.has('video') && typeof document !== 'undefined' && Boolean(document.fullscreenEnabled),
      run: () => {
        if (document.fullscreenElement) return document.exitFullscreen();
        app.dock?.openPanel('video', { focus: false });
        const el = app.dock?.instances.get('video')?.el;
        return el?.requestFullscreen?.().catch(() => app.notify('Full screen is not available here.', { error: true }));
      },
    },

    // ---------------------------------------------------------------- File
    ...[1, -1].map((dir) => ({
      id: dir > 0 ? 'file.nextDocument' : 'file.previousDocument',
      label: dir > 0 ? 'Switch to Next File' : 'Switch to Previous File',
      enabled: (a) => a.documents.length > 1,
      run: () => {
        const next = cycleDocument(app.documents, app.active, dir);
        if (next) app.activate(next);
      },
    })),
    ...[false, true].map((wantSession) => ({
      id: wantSession ? 'file.openRecentSession' : 'file.openRecentFile',
      label: wantSession ? 'Open Most Recent Session' : 'Open Most Recent File',
      enabled: (a) => Boolean(latestRecent(a.prefs.get('recent'), wantSession)),
      run: () => {
        const r = latestRecent(app.prefs.get('recent'), wantSession);
        const item = (app.recentMenuItems?.() || []).find((it) => it.label === r.name && it.run);
        return item?.run();
      },
    })),

    // ---------------------------------------------------------- Multitrack
    { id: 'mt.toggleMute', label: 'Mute Selected Track', enabled: (a) => switchable(selTrack(a)), checked: (a) => Boolean(selTrack(a)?.mute), run: toggleTrack('mute') },
    { id: 'mt.toggleSolo', label: 'Solo Selected Track', enabled: (a) => switchable(selTrack(a)), checked: (a) => Boolean(selTrack(a)?.solo), run: toggleTrack('solo') },
    {
      id: 'mt.soloExclusive',
      label: 'Solo Selected Track Only',
      enabled: (a) => switchable(selTrack(a)),
      run: () => {
        const d = session(app);
        let state = d.state;
        for (const t of S.allTracks(state)) if (t.solo !== (t.id === d.selectedTrack)) state = S.updateTrack(state, t.id, { solo: t.id === d.selectedTrack });
        d.apply('Solo', state);
      },
    },
    { id: 'mt.toggleArm', label: 'Arm Selected Track for Recording', enabled: (a) => selTrack(a)?.type === 'audio', checked: (a) => Boolean(selTrack(a)?.arm), run: toggleTrack('arm') },
    { id: 'mt.toggleMonitor', label: 'Monitor Input of Selected Track', enabled: (a) => selTrack(a)?.type === 'audio', checked: (a) => Boolean(selTrack(a)?.monitor), run: toggleTrack('monitor') },
    { id: 'mt.toggleMuteAll', label: 'Mute All Tracks', enabled: (a) => Boolean(session(a)), run: toggleAll('mute', 'Mute All', mixTrack) },
    { id: 'mt.toggleSoloAll', label: 'Solo All Tracks', enabled: (a) => Boolean(session(a)), run: toggleAll('solo', 'Solo All', mixTrack) },
    { id: 'mt.toggleArmAll', label: 'Arm All Tracks for Recording', enabled: (a) => Boolean(session(a)), run: toggleAll('arm', 'Record Arm All', audioTrack) },
    { id: 'mt.toggleMonitorAll', label: 'Monitor Input of All Tracks', enabled: (a) => Boolean(session(a)), run: toggleAll('monitor', 'Monitor Input All', audioTrack) },

    // ------------------------------------------------------------ Analysis
    {
      id: 'analysis.scanAmplitude',
      label: 'Scan Amplitude Statistics',
      enabled: (a) => Boolean(audio(a)?.length) && a.panels?.has('amplitude'),
      run: () => {
        app.dock?.openPanel('amplitude', { focus: false });
        return app.dock?.instances.get('amplitude')?.scan?.(audio(app).hasSelection);
      },
    },
    {
      id: 'analysis.scanFrequency',
      label: 'Scan Frequency Analysis',
      enabled: (a) => Boolean(audio(a)?.length) && a.panels?.has('frequency'),
      run: () => {
        app.dock?.openPanel('frequency', { focus: false });
        return app.dock?.instances.get('frequency')?.scan?.();
      },
    },

    // ------------------------------------------------------------- Effects
    {
      id: 'fx.rackPower',
      label: 'Turn Effects Rack On or Off',
      enabled: hasAudio,
      checked: (a) => rackFor(audio(a))?.power !== false,
      run: () => {
        const d = audio(app);
        const r = rackFor(d);
        setRack(app, d, { ...r, power: !r.power });
        status(r.power ? 'Effects Rack off' : 'Effects Rack on');
      },
    },
    {
      id: 'fx.rackClear',
      label: 'Clear Effects Rack',
      enabled: (a) => Boolean(audio(a) && rackFor(audio(a)).slots.some(Boolean)),
      run: () => {
        const d = audio(app);
        const r = rackFor(d);
        setRack(app, d, { ...createRack(), power: r.power, process: r.process });
        status('Effects Rack cleared');
      },
    },
    { id: 'fx.rackApply', label: 'Apply Effects Rack', enabled: (a) => Boolean(audio(a)?.length && rackActive(rackFor(audio(a)))), run: () => applyRack(app) },

    // --------------------------------------------------------- Preferences
    ...PREF_TOGGLES.map(([id, key, label]) => ({
      id,
      label,
      checked: (a) => Boolean(a.prefs.get(key)),
      run: () => {
        app.prefs.toggle(key);
        status(`${label}: ${app.prefs.get(key) ? 'on' : 'off'}`);
      },
    })),
    ...[
      ['prefs.toggleScrollWave', 'scrollWave', 'Waveform'],
      ['prefs.toggleScrollMulti', 'scrollMulti', 'Multitrack'],
    ].map(([id, key, where]) => ({
      id,
      label: `Center Playhead While Scrolling (${where})`,
      checked: (a) => a.prefs.get(key) === 'center',
      run: () => {
        app.prefs.set(key, app.prefs.get(key) === 'center' ? 'page' : 'center');
        status(`${where} editor scrolls ${app.prefs.get(key) === 'center' ? 'with the playhead centred' : 'a page at a time'}`);
      },
    })),

    // ----------------------------------------------------------- Workspace
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
      const nameOf = (a) => orderedNames(a.workspaceNames?.() || [], a.prefs.get('workspaceOrder'))[n - 1];
      return {
        id: `workspace.select${n}`,
        label: (a) => (nameOf(a) ? `Workspace ${n}: ${nameOf(a)}` : `Workspace ${n}`),
        enabled: (a) => a.layoutMode === 'desktop' && Boolean(nameOf(a)),
        checked: (a) => Boolean(nameOf(a)) && a.prefs.get('workspace') === nameOf(a),
        run: () => app.setWorkspace(nameOf(app)),
      };
    }),
  ]);

  // Edit Original also opens a selected clip's source file in the Multitrack editor.
  const original = C.commands.get('edit.editOriginal');
  if (original && C.commands.get('clip.editSource')) {
    C.register({
      ...original,
      enabled: (a, args) => (session(a) ? C.isEnabled('clip.editSource', args) : Boolean(original.enabled ? original.enabled(a, args) : true)),
      run: (a, args) => (session(a) ? C.run('clip.editSource', args) : original.run(a, args)),
    });
  }
}
