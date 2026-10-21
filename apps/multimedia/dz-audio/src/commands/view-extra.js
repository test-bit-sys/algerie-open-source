// View menu extras: waveform channel display (layered, uniquely colored),
// editor panel controls, clip gain controls, and the multitrack zoom
// commands that fit tracks and clips to the editor.

import * as S from '../model/session-edits.js';

const session = (app) => (app.active?.kind === 'session' ? app.active : null);
const mtView = (app) => (session(app) ? app.currentView?.() : null);
const selTrack = (app) => {
  const doc = session(app);
  return doc ? S.allTracks(doc.state).find((t) => t.id === doc.selectedTrack) || null : null;
};

/** Default track height (px at amplitude zoom 1) that `mt.zoomOutTrack` returns a track to. */
const DEFAULT_TRACK_HEIGHT = 120;

/** Time range covering clips, padded by 2% each side. */
export function clipsSpan(clips) {
  if (!clips.length) return null;
  const a = Math.min(...clips.map((c) => c.start));
  const b = Math.max(...clips.map((c) => c.start + c.length));
  const pad = (b - a) * 0.02;
  return [a - pad, b + pad];
}

/** Amplitude (track height) zoom that makes `heights` (px at zoom 1) fill `available` px. */
export function fitZoom(heights, available, { min = 0.25, max = 8 } = {}) {
  const total = heights.reduce((s, x) => s + x, 0);
  if (!total || available <= 0) return 1;
  return Math.max(min, Math.min(max, available / total));
}

export function installViewCommands(app) {
  const prefs = app.prefs;
  const syncEditorControls = () => {
    document.documentElement.dataset.editorControls = prefs.get('editorControls') === false ? 'off' : 'on';
  };
  syncEditorControls();
  prefs.on('change', (key) => key === 'editorControls' && syncEditorControls());

  app.commands.register([
    { id: 'view.waveLayered', label: 'Layered', checked: () => Boolean(prefs.get('waveLayered')), run: () => prefs.toggle('waveLayered') },
    { id: 'view.waveUniqueColors', label: 'Uniquely Colored', checked: () => Boolean(prefs.get('waveUniqueColors')), run: () => prefs.toggle('waveUniqueColors') },
    { id: 'view.editorControls', label: 'Show Editor Panel Controls', checked: () => prefs.get('editorControls') !== false, run: () => prefs.set('editorControls', prefs.get('editorControls') === false) },
    {
      id: 'view.clipGainControls',
      label: 'Show Clip Gain Controls',
      checked: () => prefs.get('clipGainControls') !== false,
      run: () => prefs.set('clipGainControls', prefs.get('clipGainControls') === false),
    },
    {
      id: 'view.zoomResetTime',
      label: 'Zoom Reset (Time)',
      enabled: (a) => Boolean(a.active),
      run: () => {
        // The whole document in time; sessions show at least 30 seconds. Amplitude stays as is.
        const doc = app.active;
        const span = doc.kind === 'session' ? Math.max(doc.length * 1.05, doc.sampleRate * 30) : Math.max(doc.length, doc.sampleRate);
        doc.setView(0, span);
      },
    },
    {
      id: 'view.zoomSelectedClips',
      label: 'Zoom to Selected Clips',
      enabled: (a) => Boolean(session(a)?.selectedClips.size),
      run: () => {
        const doc = session(app);
        const [a, b] = clipsSpan(doc.state.clips.filter((c) => doc.selectedClips.has(c.id)));
        doc.setView(a, b);
      },
    },
    {
      id: 'view.zoomInTrack',
      label: 'Zoom In Full (Selected Track)',
      enabled: (a) => Boolean(selTrack(a) && mtView(a)),
      run: () => {
        const doc = session(app);
        const view = mtView(app);
        const t = selTrack(app);
        const amp = doc.view.amp || 1;
        // Track heights scale with the amplitude zoom, so divide it back out.
        view.setTrackHeight(t.id, Math.max(40, Math.round((view.height - 2) / amp)));
        requestAnimationFrame(() => view.revealTrack?.(t.id));
      },
    },
    {
      id: 'view.zoomOutTrack',
      label: 'Zoom Out Full (Selected Track)',
      enabled: (a) => Boolean(selTrack(a) && mtView(a)),
      run: () => mtView(app).setTrackHeight(selTrack(app).id, DEFAULT_TRACK_HEIGHT, { minimize: true }),
    },
    {
      id: 'view.zoomOutAllTracks',
      label: 'Zoom Out Full (All Tracks)',
      enabled: (a) => Boolean(mtView(a)),
      run: () => {
        const doc = session(app);
        const view = mtView(app);
        const tracks = S.allTracks(doc.state).filter((t) => !t.hidden && !t.minimized);
        doc.setAmp(fitZoom(tracks.map((t) => t.height), view.height - 2));
        view.setScroll?.(0);
      },
    },
  ]);
}
