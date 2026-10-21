// Workspace panels: Time, Zoom, Transport, Tools, Tracks, Track Panner,
// Playlist, Events, the Track Visibility commands and the event log.
import { describe, it, expect, vi } from 'vitest';
import { Emitter } from '../src/lib/emitter.js';
import { Session } from '../src/model/session.js';
import { AudioFile } from '../src/model/audio-file.js';
import { Channel } from '../src/audio/channel.js';
import * as S from '../src/model/session-edits.js';
import * as V from '../src/multitrack/visibility.js';
import * as P from '../src/model/playlist.js';
import { serializeSession, parseSession } from '../src/model/session-io.js';
import { EventLog, sortEvents } from '../src/lib/event-log.js';
import { WORKSPACES, PHONE, TABLET } from '../src/ui/workspaces.js';
import { MENUS } from '../src/ui/menus.js';
import { panFromPoint, panPoint, balanceGains } from '../src/panels/track-panner.js';

const RATE = 1000;

async function makeApp() {
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
  const { installPanelsExtra } = await import('../src/features/panels-extra.js');
  const app = new App();
  installCore(app);
  installMultitrack(app);
  installPanelsExtra(app);
  app.syncGraph = () => {};
  return app;
}

async function appWithSession() {
  const app = await makeApp();
  const doc = new Session({ name: 'Test.asesx', sampleRate: RATE, template: [{ name: 'Voice' }, { name: 'Music' }, { name: 'Drums' }, { name: 'Verb', type: 'bus' }] });
  const src = doc.addSource({ name: 'dc.wav', channels: [Channel.fromSamples(new Float32Array(RATE * 4).fill(0.25))] });
  const [voice, music] = doc.state.tracks;
  const clips = [
    S.createClip({ trackId: voice.id, sourceId: src, name: 'a', start: 0, length: RATE * 2 }),
    S.createClip({ trackId: music.id, sourceId: src, name: 'b', start: RATE * 3, length: RATE * 2 }),
  ];
  doc.apply('Insert', S.addClips(doc.state, clips));
  app.addDocument(doc);
  return { app, doc };
}

function audioDoc(seconds = 10) {
  return new AudioFile({ name: 'a.wav', sampleRate: RATE, channels: [Channel.fromSamples(new Float32Array(RATE * seconds))] });
}

const create = (app, id) => app.panels.get(id).create(app);
const hidden = (doc) => doc.state.tracks.map((t) => Boolean(t.hidden));

describe('track visibility', () => {
  it('shows only the tracks a filter keeps and leaves buses with the clip filters', () => {
    const state = S.createSessionState({ template: [{ name: 'A' }, { name: 'B' }, { name: 'Bus', type: 'bus' }] });
    const [a, b] = state.tracks;
    const s = S.addClips(state, [S.createClip({ trackId: a.id, sourceId: 'x', start: 100, length: 50 })]);
    expect(V.showOnly(s, (t) => t.type === 'bus').tracks.map((t) => t.hidden)).toEqual([true, true, false]);
    expect(V.tracksWithClipsAt(s, 120)).toEqual(new Set([a.id]));
    expect(V.tracksWithClipsAt(s, 150).size).toBe(0);
    expect(V.tracksWithClipsIn(s, 0, 101)).toEqual(new Set([a.id]));
    expect(V.showAudioTracksIn(s, new Set([a.id])).tracks.map((t) => t.hidden)).toEqual([false, true, false]);
    // Nothing to change returns the same state.
    expect(V.showOnly(s, () => true)).toBe(s);
    expect(V.setHidden(s, b.id, true).tracks[1].hidden).toBe(true);
  });

  it('saves and loads presets and keeps them through a session file', async () => {
    const { app, doc } = await appWithSession();
    await app.commands.run('mt.toggleTrackVisibility', { id: doc.state.tracks[2].id });
    expect(hidden(doc)).toEqual([false, false, true, false]);
    expect(app.commands.isEnabled('mt.loadVisibility4')).toBe(false);
    await app.commands.run('mt.saveVisibility4');
    expect(app.commands.isChecked('mt.saveVisibility4')).toBe(true);
    await app.commands.run('mt.showBusOnly');
    expect(hidden(doc)).toEqual([true, true, true, false]);
    await app.commands.run('mt.loadVisibility4');
    expect(hidden(doc)).toEqual([false, false, true, false]);
    // A view setting: no undo step, and it survives undo.
    expect(doc.history.undoLabel).toBe('Insert');
    doc.history.undo();
    expect(V.hasPreset(doc.state, 4)).toBe(true);
    doc.history.redo();
    const parsed = parseSession(serializeSession(doc).text);
    expect(parsed.state.visibilityPresets).toEqual({ 4: { hidden: [doc.state.tracks[2].id] } });
    expect(parseSession(serializeSession(new Session({ tracks: 1 })).text).state.visibilityPresets).toBeUndefined();
  });

  it('filters by audio type, time selection and playhead', async () => {
    const { app, doc } = await appWithSession();
    await app.commands.run('mt.showAudioOnly');
    expect(hidden(doc)).toEqual([false, false, false, true]);
    expect(app.commands.isEnabled('mt.showWithClipsInSelection')).toBe(false);
    doc.setSelection(RATE * 2.5, RATE * 4);
    await app.commands.run('mt.showWithClipsInSelection');
    expect(hidden(doc)).toEqual([true, false, true, false]);
    doc.setCursor(RATE);
    await app.commands.run('mt.showWithClipsAtPlayhead');
    expect(hidden(doc)).toEqual([false, true, true, false]);
    await app.commands.run('mt.showAll');
    expect(hidden(doc)).toEqual([false, false, false, false]);
  });

  it('lists the commands under Multitrack > Track Visibility', () => {
    const mt = MENUS.find((m) => m.label === 'Multitrack').submenu.find((x) => x.label === 'Track Visibility').submenu;
    for (const id of ['mt.hideTrack', 'mt.showAll', 'mt.showAudioOnly', 'mt.showBusOnly', 'mt.showWithClips', 'mt.showWithClipsInSelection', 'mt.showWithClipsAtPlayhead']) expect(mt).toContain(id);
    const save = mt.find((x) => x.label === 'Save Track Visibility');
    expect(save.submenu).toHaveLength(9);
  });
});

describe('tracks panel', () => {
  it('lists tracks, toggles visibility with the eye, filters and selects', async () => {
    const { app, doc } = await appWithSession();
    const panel = create(app, 'tracks');
    const rows = () => [...panel.el.querySelectorAll('.track-row')];
    expect(rows().map((r) => r.textContent)).toEqual(['Voice', 'Music', 'Drums', 'Verb']);
    rows()[1].querySelector('.track-eye').click();
    expect(doc.state.tracks[1].hidden).toBe(true);
    panel.render();
    expect(rows()[1].classList.contains('hidden-track')).toBe(true);
    rows()[2].click();
    expect(doc.selectedTrack).toBe(doc.state.tracks[2].id);
    const search = panel.el.querySelector('input[type=search]');
    search.value = 'dru';
    search.dispatchEvent(new Event('input'));
    expect(rows().map((r) => r.textContent)).toEqual(['Drums']);
    // The panel menu offers the visibility commands.
    const menu = app.panels.get('tracks').menu(app);
    expect(menu.some((i) => i.id === 'mt.showAudioOnly')).toBe(true);
  });

  it('shows an empty state without a session', async () => {
    const app = await makeApp();
    const panel = create(app, 'tracks');
    expect(panel.el.classList.contains('no-session')).toBe(true);
    app.addDocument(audioDoc());
    panel.render();
    expect(panel.el.classList.contains('no-session')).toBe(true);
  });
});

describe('track panner', () => {
  it('maps points on the stage to pan and back', () => {
    for (const p of [-100, -40, 0, 25, 100]) {
      const [x, y] = panPoint(p);
      expect(panFromPoint(x, y)).toBe(p);
    }
    // Below the listener counts as fully left or right.
    expect(panFromPoint(0, 200)).toBe(-100);
    expect(panFromPoint(200, 200)).toBe(100);
    expect(balanceGains(-50)).toEqual([1, 0.5]);
    expect(balanceGains(0)).toEqual([1, 1]);
  });

  it('pans the selected track through the undoable edit path', async () => {
    const { app, doc } = await appWithSession();
    const t = doc.state.tracks[1];
    doc.selectTrack(t.id);
    const panel = create(app, 'trackPanner');
    expect(panel.el.classList.contains('no-track')).toBe(false);
    const pad = panel.el.querySelector('.panner-pad');
    pad.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(S.findTrack(doc.state, t.id).pan).toBe(-100);
    expect(doc.history.undoLabel).toBe('Track Pan');
    pad.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    expect(S.findTrack(doc.state, t.id).pan).toBe(-90);
    expect(pad.getAttribute('aria-valuetext')).toBe('L90');
    pad.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(S.findTrack(doc.state, t.id).pan).toBe(0);
    doc.history.undo();
    panel.render();
    expect(pad.getAttribute('aria-valuenow')).toBe('-90');
    // The master has no pan: empty state.
    doc.selectTrack(doc.state.master.id);
    panel.render();
    expect(panel.el.classList.contains('no-track')).toBe(true);
  });
});

describe('playlist model', () => {
  const markers = [
    { id: 'a', start: 0, duration: 100 },
    { id: 'b', start: 300, duration: 0 },
    { id: 'c', start: 500, duration: 50 },
  ];

  it('plays range markers over their range and cues up to the next marker', () => {
    expect(P.markerRange(markers[0], markers, 1000)).toEqual([0, 100]);
    expect(P.markerRange(markers[1], markers, 1000)).toEqual([300, 500]);
    expect(P.markerRange({ id: 'z', start: 900, duration: 0 }, markers, 1000)).toEqual([900, 1000]);
    const entries = [{ id: '1', markerId: 'c', loops: 3 }, { id: '2', markerId: 'gone', loops: 1 }, { id: '3', markerId: 'b', loops: 1 }];
    expect(P.totalFrames(entries, markers, 1000)).toBe(150 + 200);
    expect(P.playQueue(entries, markers, 1000, 0).map((s) => [s.start, s.end, s.pass])).toEqual([[500, 550, 1], [500, 550, 2], [500, 550, 3], [300, 500, 1]]);
    expect(P.playQueue(entries, markers, 1000, 2)).toHaveLength(1);
  });

  it('adds markers once and moves entries as a block', () => {
    let list = P.addMarkers([], ['a', 'b']);
    list = P.addMarkers(list, ['b', 'c']);
    expect(list.map((e) => e.markerId)).toEqual(['a', 'b', 'c']);
    expect(P.moveEntries(list, [list[1].id, list[2].id], -1).map((e) => e.markerId)).toEqual(['b', 'c', 'a']);
    expect(P.moveEntries(list, [list[0].id], -1)).toEqual(list);
    expect(P.moveEntries(list, [list[0].id], 1).map((e) => e.markerId)).toEqual(['b', 'a', 'c']);
    expect(P.clampLoops('0')).toBe(1);
    expect(P.clampLoops(500)).toBe(99);
  });

  it('chains segments through engine end events and stops when playback is stopped', async () => {
    const app = new Emitter();
    app.engine = new Emitter();
    app.engine.playing = false;
    const plays = [];
    app.play = vi.fn(async (o) => {
      plays.push([o.from, o.to, o.loop]);
      app.engine.playing = true;
    });
    app.stop = () => {
      app.engine.playing = false;
      app.emit('transport', 'stopped');
    };
    const end = (frame) => {
      app.engine.playing = false;
      app.emit('transport', 'stopped');
      app.engine.emit('ended', frame);
    };
    const doc = { sampleRate: RATE, length: 1000, state: { markers } };
    app.active = doc;
    const player = new P.PlaylistPlayer(app);
    expect(player.start(doc, [{ id: '1', markerId: 'a', loops: 2 }, { id: '2', markerId: 'c', loops: 1 }])).toBe(true);
    await Promise.resolve();
    expect(plays).toEqual([[0, 100, false]]);
    end(100);
    await Promise.resolve();
    end(100);
    await Promise.resolve();
    expect(plays.map((p) => p[0])).toEqual([0, 0, 500]);
    expect(player.current.entryId).toBe('2');
    end(550);
    await Promise.resolve();
    expect(player.running).toBe(false);
    // Stop ends the run instead of moving on.
    player.start(doc, [{ id: '1', markerId: 'a', loops: 3 }]);
    await Promise.resolve();
    app.stop();
    await new Promise((r) => setTimeout(r, 5));
    expect(player.running).toBe(false);
  });
});

describe('playlist panel', () => {
  it('adds range markers, sets loops and shows the total', async () => {
    const app = await makeApp();
    const doc = audioDoc();
    doc.apply('Markers', { ...doc.state, markers: [{ id: 'm1', name: 'One', start: 0, duration: 1000, type: 'cue', description: '' }, { id: 'm2', name: 'Two', start: 2000, duration: 500, type: 'cue', description: '' }, { id: 'm3', name: 'Cue', start: 4000, duration: 0, type: 'cue', description: '' }] });
    app.addDocument(doc);
    const panel = create(app, 'playlist');
    panel.el.querySelector('[aria-label="Add All Range Markers"]').click();
    const rows = () => [...panel.el.querySelectorAll('tbody tr[data-id]')];
    expect(rows().map((r) => r.querySelector('.name-cell').textContent)).toEqual(['One', 'Two']);
    const loops = rows()[1].querySelector('.playlist-loops');
    loops.value = '3';
    loops.dispatchEvent(new Event('change'));
    expect(panel.el.querySelector('.panel-footer').textContent).toContain('0:02.500');
    // Reorder: select Two and move it up.
    rows()[1].click();
    panel.el.querySelector('[aria-label="Move Up"]').click();
    expect(rows().map((r) => r.querySelector('.name-cell').textContent)).toEqual(['Two', 'One']);
    // Add Selected takes the Markers panel's selection.
    app.selectedMarkerIds = () => ['m3'];
    panel.el.querySelector('[aria-label="Add Selected Markers"]').click();
    expect(rows()).toHaveLength(3);
    expect(panel.el.querySelector('.panel-footer').textContent).toContain('0:08.500');
    panel.el.querySelector('[aria-label="Remove from Playlist"]').click();
    expect(rows()).toHaveLength(2);
  });
});

describe('event log', () => {
  it('records, sorts, removes and clears entries', () => {
    let t = 0;
    const log = new EventLog({ limit: 3, now: () => (t += 1000) });
    const onChange = vi.fn();
    log.on('change', onChange);
    log.add({ type: 'info', name: 'b.wav', message: 'Saved' });
    log.add({ type: 'error', name: 'a.wav', message: 'Could not save' });
    log.add({ type: 'warning', name: 'c.wav', message: 'Dropout' });
    expect(log.add({ message: '  ' })).toBe(null);
    log.add({ type: 'bogus', name: 'd', message: 'Fourth' });
    expect(log.entries.map((e) => e.message)).toEqual(['Could not save', 'Dropout', 'Fourth']);
    expect(log.entries[2].type).toBe('info');
    expect(sortEvents(log.entries, 'type').map((e) => e.type)).toEqual(['error', 'warning', 'info']);
    expect(sortEvents(log.entries, 'time', 'desc').map((e) => e.message)[0]).toBe('Fourth');
    expect(sortEvents(log.entries, 'name').map((e) => e.name)).toEqual(['a.wav', 'c.wav', 'd']);
    log.remove([log.entries[0].id]);
    expect(log.entries).toHaveLength(2);
    log.clear();
    expect(log.entries).toHaveLength(0);
    expect(onChange).toHaveBeenCalledTimes(6);
  });

  it('logs notifications, status messages and engine dropouts', async () => {
    const app = await makeApp();
    app.addDocument(audioDoc());
    app.notify('Could not open x.wav', { error: true });
    app.setStatus('Recording...');
    app.setStatus('Recording...');
    app.engine.emit('underrun', { key: 'k', frame: 1500 });
    const types = app.eventLog.entries.map((e) => [e.type, e.name]);
    expect(types).toEqual([['error', 'a.wav'], ['info', 'a.wav'], ['warning', 'a.wav']]);
    expect(app.eventLog.entries[2].message).toContain('0:01.500');
    expect(app.statusMessage).toBe('Recording...');
  });
});

describe('events panel', () => {
  it('sorts by column, deletes the selection and clears', async () => {
    const app = await makeApp();
    const panel = create(app, 'events');
    panel.show();
    app.eventLog.add({ type: 'info', name: 'b', message: 'second' });
    app.eventLog.add({ type: 'error', name: 'a', message: 'first' });
    const names = () => [...panel.el.querySelectorAll('tbody tr[data-id]')].map((r) => r.children[2].textContent);
    expect(names()).toEqual(['b', 'a']);
    const nameHead = panel.el.querySelector('th[data-key=name]');
    nameHead.querySelector('button').click();
    expect(names()).toEqual(['a', 'b']);
    expect(nameHead.getAttribute('aria-sort')).toBe('ascending');
    nameHead.querySelector('button').click();
    expect(names()).toEqual(['b', 'a']);
    panel.el.querySelector('tbody tr[data-id]').click();
    const [del, clear] = panel.el.querySelectorAll('.events-actions button');
    expect(del.disabled).toBe(false);
    del.click();
    expect(names()).toEqual(['a']);
    clear.click();
    expect(names()).toEqual([]);
    expect(clear.disabled).toBe(true);
  });
});

describe('time, zoom, transport and tools panels', () => {
  it('shows the playhead in the current format and steps formats with the arrow keys', async () => {
    const app = await makeApp();
    const doc = audioDoc();
    app.addDocument(doc);
    doc.setCursor(2500);
    const panel = create(app, 'time');
    panel.render();
    const readout = panel.el.querySelector('.time-big');
    expect(readout.textContent).toBe('0:02.500');
    expect(panel.el.style.getPropertyValue('--chars')).toBe('8');
    readout.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(app.prefs.get('timeFormat')).toBe('compact');
    panel.render();
    expect(readout.textContent).toBe('00:00:02.500');
    expect(app.panels.get('time').menu(app).some((i) => i.checked)).toBe(true);
  });

  it('tracks zoom command state and labels', async () => {
    const app = await makeApp();
    const panel = create(app, 'zoom');
    const btn = (cmd) => panel.el.querySelector(`[data-cmd="${cmd}"]`);
    expect(btn('view.zoomInTime').disabled).toBe(true);
    // Frequency zoom is not registered without the spectral feature.
    expect(btn('view.zoomInFreq').hidden).toBe(true);
    const doc = audioDoc();
    app.addDocument(doc);
    panel.render();
    expect(btn('view.zoomInTime').disabled).toBe(false);
    expect(btn('view.zoomSelection').disabled).toBe(true);
    doc.setSelection(100, 200);
    panel.render();
    expect(btn('view.zoomSelection').disabled).toBe(false);
    const span = doc.view.end - doc.view.start;
    btn('view.zoomInTime').click();
    await Promise.resolve();
    expect(doc.view.end - doc.view.start).toBeLessThan(span);
  });

  it('reflects loop and runs transport commands', async () => {
    const app = await makeApp();
    app.addDocument(audioDoc());
    const panel = create(app, 'transport');
    const loop = panel.el.querySelector('[data-cmd="transport.loop"]');
    expect(loop.getAttribute('aria-pressed')).toBe('false');
    loop.click();
    await Promise.resolve();
    panel.render();
    expect(loop.getAttribute('aria-pressed')).toBe('true');
    expect(panel.el.querySelector('[data-cmd="transport.stop"]').disabled).toBe(true);
  });

  it('checks the current tool and switches editors', async () => {
    const { app } = await appWithSession();
    const panel = create(app, 'tools');
    panel.render();
    const move = panel.el.querySelector('[data-cmd="tool.move"]');
    expect(move.disabled).toBe(false);
    expect(panel.el.querySelector('.mode-btn[data-kind=session]').getAttribute('aria-checked')).toBe('true');
    panel.el.querySelector('[data-cmd="tool.razor"]').click();
    await Promise.resolve();
    expect(app.tool).toBe('razor');
    panel.render();
    expect(panel.el.querySelector('[data-cmd="tool.razor"]').getAttribute('aria-pressed')).toBe('true');
    expect(move.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('workspaces and window commands', () => {
  it('registers a Window command per panel and lists it in the Window menu', async () => {
    const app = await makeApp();
    const windowMenu = MENUS.find((m) => m.label === 'Window').submenu;
    for (const id of ['time', 'zoom', 'transport', 'tools', 'tracks', 'trackPanner', 'playlist', 'events']) {
      expect(app.panels.has(id)).toBe(true);
      expect(app.commands.isEnabled(`window.${id}`)).toBe(true);
      expect(windowMenu).toContain(`window.${id}`);
    }
  });

  it('adds the new workspaces with the panels they are built around', () => {
    const ids = (node, out = []) => {
      if (node.t === 'group') out.push(...node.tabs);
      else for (const c of node.c) ids(c, out);
      return out;
    };
    expect(ids(WORKSPACES['Advanced Mixing']())).toEqual(expect.arrayContaining(['mixer', 'tracks', 'trackPanner']));
    expect(ids(WORKSPACES.Loudness())).toEqual(expect.arrayContaining(['loudness', 'levels']));
    expect(ids(WORKSPACES.Restoration())).toEqual(expect.arrayContaining(['diagnostics', 'frequency']));
    expect(ids(WORKSPACES['Simple Editing']())).toEqual(expect.arrayContaining(['editor', 'files', 'transport', 'time']));
    // Every workspace of Window > Workspace, listed alphabetically.
    expect(Object.keys(WORKSPACES)).toEqual([
      'Advanced Mixing',
      'Classic',
      'Default',
      'Edit Audio to Video',
      'Essential Video Mixing',
      'Loudness',
      'Mastering and Analysis',
      'Maximum Editing (Dual Monitor)',
      'Radio Production',
      'Restoration',
      'Simple Editing',
    ]);
    for (const make of [...Object.values(WORKSPACES), PHONE, TABLET]) {
      const list = ids(make());
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
