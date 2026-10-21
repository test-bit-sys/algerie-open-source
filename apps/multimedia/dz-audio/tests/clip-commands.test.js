// Clip, Multitrack and Edit > Select commands in a running app.
import { describe, it, expect } from 'vitest';
import { Session } from '../src/model/session.js';
import * as S from '../src/model/session-edits.js';
import { Channel } from '../src/audio/channel.js';
import { buildSessionGraph, metronomeBar } from '../src/model/session-graph.js';
import { renderBlock, ChunkStore, createScratch, CHUNK } from '../src/engine/mixcore.js';
import { serializeSession, parseSession } from '../src/model/session-io.js';
import { METRONOME_SOUNDS, clickSound } from '../src/multitrack/metronome-sounds.js';
import { MENUS } from '../src/ui/menus.js';

const RATE = 8000;

async function appWithSession() {
  HTMLCanvasElement.prototype.getContext = () => null;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
  localStorage.clear();
  const { App } = await import('../src/app.js');
  const { installCore } = await import('../src/features/core.js');
  const { installMultitrack } = await import('../src/features/multitrack.js');
  const app = new App();
  installCore(app);
  installMultitrack(app);
  app.syncGraph = () => {};
  const doc = new Session({ name: 'Test.asesx', sampleRate: RATE, tracks: 3 });
  const src = doc.addSource({ name: 'tone.wav', channels: [Channel.fromSamples(new Float32Array(RATE * 4).fill(0.25))] });
  const t = doc.state.tracks;
  const a = S.createClip({ trackId: t[0].id, sourceId: src, name: 'A', start: 0, length: RATE * 2 });
  const b = S.createClip({ trackId: t[0].id, sourceId: src, name: 'B', start: RATE * 1.5, length: RATE * 2 });
  const c = S.createClip({ trackId: t[1].id, sourceId: src, name: 'C', start: RATE * 3, length: RATE });
  doc.apply('Insert', S.addClips(doc.state, [a, b, c]));
  app.addDocument(doc);
  return { app, doc, a, b, c, src };
}

describe('fade commands', () => {
  it('offers Crossfade only where clips overlap and checks the kind of fade heard', async () => {
    const { app, doc, a, b } = await appWithSession();
    doc.selectClips([b.id]);
    expect(app.commands.isEnabled('clip.fadeInCrossfade')).toBe(true);
    expect(app.commands.isChecked('clip.fadeInCrossfade')).toBe(true);
    await app.commands.run('clip.fadeInNone');
    expect(app.commands.isChecked('clip.fadeInNone')).toBe(true);
    expect(app.commands.isChecked('clip.fadeInCrossfade')).toBe(false);
    await app.commands.run('clip.fadeInCosine');
    expect(S.findClip(doc.state, b.id).fadeIn.curve).toBe(2);
    expect(app.commands.isChecked('clip.fadeInCosine')).toBe(true);
    expect(app.commands.isChecked('clip.fadeInOn')).toBe(true);
    await app.commands.run('clip.fadeInCrossfade');
    expect(app.commands.isChecked('clip.fadeInCrossfade')).toBe(true);
    doc.selectClips([a.id]);
    expect(app.commands.isEnabled('clip.fadeInCrossfade')).toBe(false);
    expect(app.commands.isChecked('clip.fadeOutCrossfade')).toBe(true);
    doc.history.undo();
    doc.history.undo();
    doc.history.undo();
    expect(S.findClip(doc.state, b.id).fadeIn).toEqual({ length: 0, curve: 0 });
  });
});

describe('groups', () => {
  it('selects grouped clips one by one while groups are suspended, and removes the focus clip from its group', async () => {
    const { app, doc, a, b, c } = await appWithSession();
    doc.selectClips([a.id, b.id, c.id]);
    await app.commands.run('clip.group');
    doc.selectClips([b.id]);
    expect(doc.selectedClips.size).toBe(3);
    await app.commands.run('clip.suspendGroups');
    expect(app.commands.isChecked('clip.suspendGroups')).toBe(true);
    expect([...doc.selectedClips]).toEqual([b.id]);
    doc.selectClips([c.id]);
    expect([...doc.selectedClips]).toEqual([c.id]);
    expect(app.commands.isEnabled('clip.removeFromGroup')).toBe(true);
    await app.commands.run('clip.removeFromGroup');
    expect(S.findClip(doc.state, c.id).groupId).toBe(null);
    expect(S.findClip(doc.state, a.id).groupId).toBeTruthy();
    await app.commands.run('clip.suspendGroups');
    doc.selectClips([a.id]);
    expect(new Set(doc.selectedClips)).toEqual(new Set([a.id, b.id]));
  });
});

describe('unique copy, silence and reveal', () => {
  it('gives a clip its own copy of its source as a new file, undoably', async () => {
    const { app, doc, a, b, src } = await appWithSession();
    doc.selectClips([a.id]);
    const files = app.documents.length;
    await app.commands.run('clip.uniqueCopy');
    const copy = S.findClip(doc.state, a.id);
    expect(copy.sourceId).not.toBe(src);
    expect(S.findClip(doc.state, b.id).sourceId).toBe(src);
    expect(app.documents.length).toBe(files + 1);
    const file = app.documents.find((d) => d.id === doc.pool.get(copy.sourceId).docId);
    expect(file.name).toBe('tone Copy.wav');
    expect(file.length).toBe(RATE * 4);
    expect(app.active).toBe(doc);
    doc.history.undo();
    expect(S.findClip(doc.state, a.id).sourceId).toBe(src);
  });

  it('silences the time selection in the selected clips with their envelopes', async () => {
    const { app, doc, a, c } = await appWithSession();
    doc.selectClips([a.id]);
    expect(app.commands.isEnabled('clip.silenceTime')).toBe(false);
    doc.setSelection(RATE * 0.5, RATE);
    await app.commands.run('clip.silenceTime');
    const env = S.findClip(doc.state, a.id).volumeEnv;
    expect(S.envelopeValue(env, RATE * 0.75, 0)).toBe(S.SILENT_DB);
    expect(S.envelopeValue(env, RATE * 1.5, 0)).toBe(0);
    expect(S.findClip(doc.state, c.id).volumeEnv).toEqual([]);
    expect(doc.history.entries[doc.history.index].label).toBe('Silence Time in Clips');
  });

  it('reveals the files behind the selected clips in the Files panel', async () => {
    const { app, doc, a } = await appWithSession();
    doc.selectClips([a.id]);
    let revealed = null;
    app.on('reveal-files', (ids) => (revealed = ids));
    await app.commands.run('clip.revealInFiles');
    expect(revealed).toHaveLength(1);
    const file = app.documents.find((d) => d.id === revealed[0]);
    expect(file.kind).toBe('audio');
    expect(doc.pool.get(S.findClip(doc.state, a.id).sourceId).docId).toBe(file.id);
    // The same file again next time.
    await app.commands.run('clip.revealInFiles');
    expect(revealed[0]).toBe(file.id);
  });
});

describe('nudge between tracks', () => {
  it('moves the selected clip to the next and previous track', async () => {
    const { app, doc, c } = await appWithSession();
    doc.selectClips([c.id]);
    await app.commands.run('clip.nudgeDown');
    expect(S.findClip(doc.state, c.id).trackId).toBe(doc.state.tracks[2].id);
    await app.commands.run('clip.nudgeUp');
    await app.commands.run('clip.nudgeUp');
    expect(S.findClip(doc.state, c.id).trackId).toBe(doc.state.tracks[0].id);
  });
});

describe('mono bus tracks', () => {
  it('adds mono and stereo buses; a mono bus sums its input to mono', async () => {
    const { app, doc } = await appWithSession();
    await app.commands.run('mt.addMonoBus');
    const bus = doc.state.tracks.find((t) => t.type === 'bus');
    expect(bus.channels).toBe(1);
    await app.commands.run('mt.addBus');
    expect(doc.state.tracks.filter((t) => t.type === 'bus').map((t) => t.channels).sort()).toEqual([1, 2]);

    // A hard-left stereo source through the mono bus comes out in both channels.
    let s = S.updateTrack(doc.state, doc.state.tracks[0].id, { output: bus.id });
    s = { ...s, clips: s.clips.filter((c) => c.trackId === doc.state.tracks[0].id).slice(0, 1) };
    const left = Channel.fromSamples(new Float32Array(1000).fill(0.5));
    const right = Channel.fromSamples(new Float32Array(1000));
    const pool = new Map([[s.clips[0].sourceId, { channels: [left, right] }]]);
    const { graph, sources } = buildSessionGraph(s, pool);
    expect(graph.tracks.find((t) => t.id === bus.id).mono).toBe(true);
    const store = new ChunkStore();
    for (const [key, chs] of sources) store.put(key, 0, chs.map((ch) => ch.toArray(0, Math.min(CHUNK, ch.length))));
    const out = [new Float32Array(128), new Float32Array(128)];
    renderBlock(graph, store, 100, 128, out, createScratch(128));
    expect(out[0][10]).toBeCloseTo(0.25, 5);
    expect(out[1][10]).toBeCloseTo(0.25, 5);
  });
});

describe('bounce variants', () => {
  it('offers all four bounces, Selected Clips in Time Selection only with clips inside the time selection', async () => {
    const { app, doc, c } = await appWithSession();
    const bounce = MENUS.find((m) => m.label === 'Multitrack').submenu.find((x) => x.label === 'Bounce to New Track').submenu;
    expect(bounce).toEqual(['mt.bounceTrack', 'mt.bounceTime', 'mt.bounceClipsInTime', 'mt.bounceClips']);
    for (const id of bounce) expect(app.commands.get(id)).toBeTruthy();
    doc.selectClips([c.id]);
    doc.setSelection(0, RATE);
    expect(app.commands.isEnabled('mt.bounceClipsInTime')).toBe(false);
    doc.setSelection(RATE * 2, RATE * 3.5);
    expect(app.commands.isEnabled('mt.bounceClipsInTime')).toBe(true);
  });
});

describe('metronome sounds', () => {
  it('has ten distinct, bounded sound sets with accented and normal clicks', () => {
    expect(METRONOME_SOUNDS).toHaveLength(10);
    const seen = new Set();
    for (const { id } of METRONOME_SOUNDS) {
      const acc = clickSound(id, 48000, true);
      const norm = clickSound(id, 48000, false);
      for (const x of [acc, norm]) {
        expect(x.length).toBeGreaterThan(10);
        let peak = 0;
        for (const v of x) {
          expect(Number.isFinite(v)).toBe(true);
          peak = Math.max(peak, Math.abs(v));
        }
        expect(peak).toBeGreaterThan(0.05);
        expect(peak).toBeLessThanOrEqual(0.8);
      }
      // Deterministic, and the accent differs from the other beats.
      expect(clickSound(id, 48000, true)).toEqual(acc);
      expect(acc).not.toEqual(norm);
      seen.add(Array.from(acc.subarray(0, 64)).join(','));
    }
    expect(seen.size).toBe(10);
  });

  it('builds a bar in the chosen sound', () => {
    const beep = metronomeBar(Channel, { sampleRate: 8000, tempo: 120, beatsPerBar: 4 })[0].toArray();
    const wood = metronomeBar(Channel, { sampleRate: 8000, tempo: 120, beatsPerBar: 4, sound: 'woodblock' })[0].toArray();
    expect(beep.length).toBe(16000);
    expect(wood.length).toBe(16000);
    expect(wood).not.toEqual(beep);
    expect(Math.abs(wood[4000 + 20])).toBeGreaterThan(0);
  });

  it('changes the sound type per session, remembers it, and saves it', async () => {
    const { app, doc } = await appWithSession();
    expect(app.commands.isChecked('mt.metronomeSoundBeep')).toBe(true);
    const index = doc.history.index;
    await app.commands.run('mt.metronomeSoundCowbell');
    expect(doc.state.metronomeSound).toBe('cowbell');
    expect(doc.history.index).toBe(index);
    expect(app.commands.isChecked('mt.metronomeSoundCowbell')).toBe(true);
    expect(app.commands.isChecked('mt.metronomeSoundBeep')).toBe(false);
    expect(app.prefs.get('metronomeSound')).toBe('cowbell');
    const parsed = parseSession(serializeSession(doc).text);
    expect(parsed.state.metronomeSound).toBe('cowbell');
  });
});

describe('Edit > Select', () => {
  it('selects clips from the playhead to the track end, session start and session end', async () => {
    const { app, doc, a, b, c } = await appWithSession();
    doc.setCursor(RATE * 1.8);
    doc.selectTrack(doc.state.tracks[0].id);
    await app.commands.run('edit.selectClipsToTrackEnd');
    expect(new Set(doc.selectedClips)).toEqual(new Set([a.id, b.id]));
    doc.setCursor(RATE * 2.5);
    await app.commands.run('edit.selectClipsToTrackEnd');
    expect([...doc.selectedClips]).toEqual([b.id]);
    await app.commands.run('edit.selectClipsToEnd');
    expect(new Set(doc.selectedClips)).toEqual(new Set([b.id, c.id]));
    await app.commands.run('edit.selectClipsToStart');
    expect(new Set(doc.selectedClips)).toEqual(new Set([a.id, b.id]));
  });

  it('selects clips by Sound Assistant audio type', async () => {
    const { app, doc, a, c } = await appWithSession();
    expect(app.commands.isEnabled('edit.selectClipsOfTypeMusic')).toBe(false);
    doc.apply('Type', S.updateClips(doc.state, [a.id, c.id], { soundAssistant: { type: 'music' } }));
    expect(app.commands.label('edit.selectClipsOfTypeSfx')).toBe('Sound Effects');
    await app.commands.run('edit.selectClipsOfTypeMusic');
    expect(new Set(doc.selectedClips)).toEqual(new Set([a.id, c.id]));
  });

  it('selects all time, the time around the selected clips, and clears the time selection', async () => {
    const { app, doc, c } = await appWithSession();
    await app.commands.run('edit.selectAllTime');
    expect([doc.selection.start, doc.selection.end]).toEqual([0, doc.length]);
    doc.selectClips([c.id]);
    await app.commands.run('edit.selectTimeAroundClips');
    expect([doc.selection.start, doc.selection.end]).toEqual([RATE * 3, RATE * 4]);
    expect(doc.selection.tracks).toEqual([c.trackId]);
    await app.commands.run('edit.clearTimeSelection');
    expect(doc.hasSelection).toBe(false);
    expect(app.commands.isEnabled('edit.clearTimeSelection')).toBe(false);
  });
});
