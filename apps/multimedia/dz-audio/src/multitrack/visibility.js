// Track visibility: which audio and bus tracks the Multitrack editor, the
// Mixer and the Tracks panel show. `hidden` is a view setting on each track
// (saved with the session, kept across undo through Session.amendView);
// presets 1-9 remember a set of hidden tracks in state.visibilityPresets as
// { [slot]: { hidden: [trackId...] } }. The master track never hides.

import { clipEnd } from '../model/session-edits.js';

export const PRESET_SLOTS = 9;

/** Shows the tracks for which keep(track) is true and hides the others. */
export function showOnly(state, keep) {
  let changed = false;
  const tracks = state.tracks.map((t) => {
    const hidden = !keep(t);
    if (Boolean(t.hidden) === hidden) return t;
    changed = true;
    return { ...t, hidden };
  });
  return changed ? { ...state, tracks } : state;
}

/** Hides or shows one track. */
export function setHidden(state, id, hidden) {
  return showOnly(state, (t) => (t.id === id ? !hidden : !t.hidden));
}

/** Ids of tracks with a clip overlapping [a, b). */
export function tracksWithClipsIn(state, a, b) {
  return new Set(state.clips.filter((c) => c.start < b && clipEnd(c) > a).map((c) => c.trackId));
}

/** Ids of tracks with a clip under frame `at`. */
export function tracksWithClipsAt(state, at) {
  return new Set(state.clips.filter((c) => c.start <= at && clipEnd(c) > at).map((c) => c.trackId));
}

/**
 * Keeps audio tracks in `ids` (buses stay visible: they carry the audio routed
 * to them, as with Show Only Tracks with Clips).
 */
export function showAudioTracksIn(state, ids) {
  return showOnly(state, (t) => t.type !== 'audio' || ids.has(t.id));
}

export function hasPreset(state, slot) {
  return Boolean(state.visibilityPresets?.[slot]);
}

/** Remembers the current hidden tracks in a preset slot (1-9). */
export function savePreset(state, slot) {
  const hidden = state.tracks.filter((t) => t.hidden).map((t) => t.id);
  return { ...state, visibilityPresets: { ...(state.visibilityPresets || {}), [slot]: { hidden } } };
}

/** Restores a preset: its hidden tracks hide, every other track shows. */
export function loadPreset(state, slot) {
  const preset = state.visibilityPresets?.[slot];
  if (!preset) return state;
  const hidden = new Set(preset.hidden || []);
  return showOnly(state, (t) => !hidden.has(t.id));
}

/** Presets read from a session file: known slots, track ids that still exist. */
export function cleanPresets(presets, trackIds) {
  const out = {};
  if (!presets || typeof presets !== 'object') return out;
  for (let slot = 1; slot <= PRESET_SLOTS; slot++) {
    const p = presets[slot];
    if (p && Array.isArray(p.hidden)) out[slot] = { hidden: p.hidden.filter((id) => trackIds.has(id)) };
  }
  return out;
}

/** Track Visibility commands (Multitrack > Track Visibility and the Tracks panel). */
export function visibilityCommands(app) {
  const session = () => (app.active?.kind === 'session' ? app.active : null);
  const hasSession = () => Boolean(session());
  const amend = (fn) => session().amendView(fn);
  const findTrack = (id) => session()?.state.tracks.find((t) => t.id === id) || null;
  return [
    {
      id: 'mt.toggleTrackVisibility',
      label: 'Show Track',
      enabled: (a, args) => Boolean(findTrack(args?.id ?? session()?.selectedTrack)),
      checked: (a, args) => !findTrack(args?.id ?? session()?.selectedTrack)?.hidden,
      run: (a, args) => {
        const t = findTrack(args?.id ?? session().selectedTrack);
        const hidden = args?.hidden ?? !t.hidden;
        amend((st) => setHidden(st, t.id, hidden));
      },
    },
    {
      id: 'mt.showAudioOnly',
      label: 'Show Only Audio Tracks',
      enabled: hasSession,
      run: () => amend((st) => showOnly(st, (t) => t.type === 'audio')),
    },
    {
      id: 'mt.showBusOnly',
      label: 'Show Only Bus Tracks',
      enabled: () => Boolean(session()?.state.tracks.some((t) => t.type === 'bus')),
      run: () => amend((st) => showOnly(st, (t) => t.type === 'bus')),
    },
    {
      id: 'mt.showWithClipsInSelection',
      label: 'Show Only Tracks with Clips within Time Selection',
      enabled: () => Boolean(session()?.hasSelection),
      run: () => {
        const { start, end } = session().selection;
        const ids = tracksWithClipsIn(session().state, start, end);
        amend((st) => showAudioTracksIn(st, ids));
      },
    },
    {
      id: 'mt.showWithClipsAtPlayhead',
      label: 'Show Only Tracks with Clips at Playhead',
      enabled: hasSession,
      run: () => {
        const ids = tracksWithClipsAt(session().state, Math.round(app.playhead));
        amend((st) => showAudioTracksIn(st, ids));
      },
    },
    ...Array.from({ length: PRESET_SLOTS }, (_, i) => i + 1).flatMap((slot) => [
      {
        id: `mt.saveVisibility${slot}`,
        label: `Preset ${slot}`,
        enabled: hasSession,
        checked: () => hasPreset(session()?.state || {}, slot),
        run: () => {
          amend((st) => savePreset(st, slot));
          app.setStatus(`Track visibility saved to preset ${slot}`);
        },
      },
      {
        id: `mt.loadVisibility${slot}`,
        label: `Preset ${slot}`,
        enabled: () => Boolean(session() && hasPreset(session().state, slot)),
        run: () => amend((st) => loadPreset(st, slot)),
      },
    ]),
  ];
}

/** Menu spec for the Track Visibility submenu (menus.js and the Tracks panel menu). */
export const VISIBILITY_MENU = [
  'mt.hideTrack',
  'mt.showAll',
  '-',
  'mt.showAudioOnly',
  'mt.showBusOnly',
  'mt.showWithClips',
  'mt.showWithClipsInSelection',
  'mt.showWithClipsAtPlayhead',
  '-',
  { label: 'Load Track Visibility', submenu: Array.from({ length: PRESET_SLOTS }, (_, i) => `mt.loadVisibility${i + 1}`) },
  { label: 'Save Track Visibility', submenu: Array.from({ length: PRESET_SLOTS }, (_, i) => `mt.saveVisibility${i + 1}`) },
];
