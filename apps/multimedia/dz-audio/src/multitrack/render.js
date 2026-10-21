// Offline renders of a session (mixdowns and bounces) through the shared
// render worker, so the result matches playback.

import { buildSessionGraph } from '../model/session-graph.js';
import { AudioFile } from '../model/audio-file.js';
import { Channel } from '../audio/channel.js';
import * as S from '../model/session-edits.js';

/**
 * Renders [start, end) of a session to stereo Float32Arrays (six channels for a 5.1 mix).
 * @param {object} o
 * @param {object} [o.state] state to render (defaults to the current one)
 * @param {Set<string>} [o.clipIds] only these clips
 * @param {string} [o.trackId] only this track, before its output routing and the master
 */
export async function renderSession(app, session, { state = session.state, start = 0, end = session.length, clipIds = null, trackId = null, label = 'Rendering' } = {}) {
  if (end <= start) throw new Error('There is nothing to render in that range.');
  // Stretched and remixed clips render with their finished audio, not the preview.
  if (session.stretcher?.busy) await session.stretcher.whenIdle();
  if (session.remixer?.busy) await session.remixer.whenIdle();
  const { graph, sources } = buildSessionGraph(state, session.pool, { clipIds, panLaw: { mode: app.prefs?.get('panLaw'), centerDb: app.prefs?.get('panLawDb') } });
  if (trackId) {
    // The track plus everything routed into it (for a bus), ignoring solo.
    const keep = new Set([trackId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of graph.tracks) {
        if (!keep.has(t.id) && t.output && keep.has(t.output)) {
          keep.add(t.id);
          grew = true;
        }
      }
    }
    graph.tracks = graph.tracks.filter((t) => keep.has(t.id)).map((t) => (t.id === trackId ? { ...t, output: undefined, mute: false, solo: false } : { ...t, solo: false }));
    graph.master = { gain: 1 };
    // A bounce keeps the track's own width: six channels only for a 5.1 track.
    if (!graph.tracks.find((t) => t.id === trackId)?.six) delete graph.surround;
  }
  app.setStatus(`${label}...`);
  // Loaded on first use, like the effect renders, so the render worker code stays out of the startup bundle.
  const { renderGraph } = await import('../engine/offline.js');
  let last = -1;
  const out = await renderGraph(graph, sources, {
    start,
    end,
    onProgress: (p) => {
      const pct = Math.floor(p * 100);
      if (pct !== last && pct % 5 === 0) {
        last = pct;
        app.setStatus(`${label} ${pct}%`);
      }
    },
  });
  app.setStatus(`${label} done`);
  return out;
}

/** Wraps rendered stereo data in a new AudioFile document (not yet added). */
export function renderedDoc(app, session, data, name, markers = []) {
  return new AudioFile({
    name: app.uniqueName(name, '.wav'),
    sampleRate: session.sampleRate,
    channels: data.map((d) => Channel.fromSamples(d)),
    markers,
    info: { bitDepth: 32, format: 'wav' },
    // Edit > Edit Original goes back to the session this audio came from.
    origin: { sessionId: session.id, name: session.name, path: session.source?.type === 'puter' ? session.source.path : null },
  });
}

/** Time range covered by clips (for "selected clips" renders). */
export function clipsRange(clips) {
  if (!clips.length) return [0, 0];
  return [Math.min(...clips.map((c) => c.start)), Math.max(...clips.map(S.clipEnd))];
}
