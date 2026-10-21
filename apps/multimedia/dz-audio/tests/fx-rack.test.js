import { describe, it, expect, vi } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { registerEffect } from '../src/effects/registry.js';
import { createRack, makeSlot, setSlot, moveSlot, toggleSlot, removeSlot, slotSpecs, rackActive, decorateGraph, renderRack, rackTiming, groupedEffects, createRackEditor, fitSlots } from '../src/effects/rack.js';
import { rackSnapshot, rackFromSnapshot, saveRackPreset, rackPresets, deleteRackPreset } from '../src/effects/rack-panel.js';
import { fakeApp, filled, memoryPrefs } from './fx-helpers.js';

registerEffect({ id: 'rtA', name: 'Realtime A', group: 'Modulation', kind: 50, params: [{ id: 'x', min: 0, max: 1, default: 0.5 }], tail: () => 7, latency: () => 3 });
registerEffect({ id: 'rtB', name: 'Realtime B', group: 'Reverb', kind: 51, params: [] });
registerEffect({ id: 'offC', name: 'Offline C', group: 'Special', kind: null, params: [], process: async ({ channels }) => channels });

const graph = () => ({ rate: 1000, tracks: [{ id: 'file', gain: 1, pan: 0, clips: [], fx: [{ key: 'preview', kind: 1, params: [0, 0, 1] }] }], master: { gain: 1 } });

describe('rack model', () => {
  it('starts with 16 empty slots and sensible defaults', () => {
    const r = createRack();
    expect(r.slots).toHaveLength(16);
    expect(r.slots.every((s) => s === null)).toBe(true);
    expect(r).toMatchObject({ power: true, input: 0, output: 0, mix: 1, process: 'selection' });
    expect(rackActive(r)).toBe(false);
  });
  it('sets, toggles, removes and reorders slots', () => {
    let slots = createRack().slots;
    const a = makeSlot('rtA');
    const b = makeSlot('rtB');
    slots = setSlot(setSlot(slots, 0, a), 3, b);
    expect(slots[0].values).toEqual({ x: 0.5 });
    slots = moveSlot(slots, 3, 0);
    expect(slots[0]).toBe(b);
    expect(slots[1]).toBe(a);
    expect(slots).toHaveLength(16);
    slots = moveSlot(slots, 0, 15);
    expect(slots[15]).toBe(b);
    expect(slots[0]).toBe(a);
    expect(moveSlot(slots, 0, 16)).toBe(slots);
    slots = toggleSlot(slots, 0);
    expect(slots[0].enabled).toBe(false);
    slots = removeSlot(slots, 15);
    expect(slots[15]).toBeNull();
    expect(fitSlots([a], 4)).toEqual([a, null, null, null]);
  });
  it('turns enabled realtime slots into keyed slot specs', () => {
    const slots = [makeSlot('rtA', { x: 0.25 }), null, makeSlot('rtB', {}, false), makeSlot('offC'), makeSlot('missing')];
    const specs = slotSpecs(slots, 'trk1');
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ key: `trk1:${slots[0].id}`, kind: 50, params: [0.25], enabled: true });
  });
  it('sums tails and latencies of the chain', () => {
    const r = { ...createRack(), slots: fitSlots([makeSlot('rtA'), makeSlot('rtA'), makeSlot('rtB')]) };
    expect(rackTiming(r, 1000)).toEqual({ tail: 14, latency: 6 });
  });
  it('groups effects like the Effects menu, including unlisted groups', () => {
    const groups = groupedEffects();
    expect(groups.find((g) => g.label === 'Amplitude and Compression').defs.map((d) => d.id)).toContain('amplify');
    expect(groups.find((g) => g.label === 'Modulation').defs.map((d) => d.id)).toContain('rtA');
  });
});

describe('rack playback graph', () => {
  it('leaves the graph alone when the rack is off or empty', () => {
    const g = graph();
    decorateGraph(g, createRack());
    expect(g.tracks[0].fx).toHaveLength(1);
    const r = { ...createRack(), power: false, slots: fitSlots([makeSlot('rtA')]) };
    decorateGraph(g, r);
    expect(g.tracks[0].fx).toHaveLength(1);
  });
  it('appends rack slots after preview slots with input gain first', () => {
    const r = { ...createRack(), input: 6, slots: fitSlots([makeSlot('rtA')]) };
    const g = decorateGraph(graph(), r);
    expect(g.tracks[0].fx.map((s) => s.key)).toEqual(['preview', 'rack:in', `rack:${r.slots[0].id}`]);
    expect(g.tracks[0].fx[1]).toMatchObject({ kind: 1, params: [6, 6, 1] });
    expect(g.tracks).toHaveLength(1);
  });
  it('adds a parallel dry track for wet/dry mix and applies output gain', () => {
    const r = { ...createRack(), output: -6.0206, mix: 0.25, slots: fitSlots([makeSlot('rtB')]) };
    const g = decorateGraph(graph(), r);
    expect(g.tracks).toHaveLength(2);
    const [wet, dry] = g.tracks;
    expect(wet.gain).toBeCloseTo(0.5 * 0.25, 4);
    expect(dry.id).toBe('file-dry');
    expect(dry.gain).toBeCloseTo(0.5 * 0.75, 4);
    expect(dry.fx.map((s) => s.key)).toEqual(['dry:preview']);
  });
});

describe('rack render', () => {
  it('mixes wet and dry, applies gains, passes tail and latency', async () => {
    const calls = [];
    const applyChain = vi.fn(async (channels, rate, specs, o) => {
      calls.push({ specs, ...o });
      return channels.map(() => new Float32Array(o.end - o.start + o.tail).fill(1));
    });
    const state = { sampleRate: 1000, channels: [Channel.fromSamples(filled(100, 0.2))], markers: [] };
    const rack = { ...createRack(), mix: 0.5, output: 0, slots: fitSlots([makeSlot('rtA')]) };
    const next = await renderRack({ rack, state, start: 10, end: 20, applyChain });
    expect(calls[0]).toMatchObject({ start: 10, end: 20, tail: 7, latency: 3 });
    expect(next.channels[0].toArray(15, 16)[0]).toBeCloseTo(0.5 * 1 + 0.5 * 0.2);
    expect(next.channels[0].toArray(22, 23)[0]).toBeCloseTo(0.2 + 0.5); // tail: wet only, mixed into the following audio
    expect(next.channels[0].toArray(5, 6)[0]).toBeCloseTo(0.2);
  });
  it('refuses an inactive rack', async () => {
    await expect(renderRack({ rack: createRack(), state: { sampleRate: 1, channels: [], markers: [] }, start: 0, end: 1 })).rejects.toThrow(/no enabled/);
  });
});

describe('rack presets', () => {
  it('saves snapshots without slot ids and restores fresh slots', () => {
    const prefs = memoryPrefs();
    const rack = { ...createRack(), input: 2, mix: 0.7, slots: fitSlots([makeSlot('rtA', { x: 0.9 })]) };
    saveRackPreset(prefs, 'Voice', rack);
    const [p] = rackPresets(prefs);
    expect(p.rack.slots[0]).toEqual({ effect: 'rtA', values: { x: 0.9 }, enabled: true });
    const restored = rackFromSnapshot(p.rack);
    expect(restored.slots[0].values).toEqual({ x: 0.9 });
    expect(restored.slots[0].id).not.toBe(rack.slots[0].id);
    expect(restored).toMatchObject({ input: 2, mix: 0.7 });
    expect(rackSnapshot(restored)).toEqual(p.rack);
    deleteRackPreset(prefs, 'Voice');
    expect(rackPresets(prefs)).toEqual([]);
  });
});

describe('createRackEditor', () => {
  it('renders 16 slots and supports keyboard reordering and removal', () => {
    const app = fakeApp();
    let slots = fitSlots([makeSlot('rtA'), makeSlot('rtB')]);
    const ed = createRackEditor({ app, getSlots: () => slots, setSlots: (s) => (slots = s) });
    document.body.append(ed.el);
    const rows = ed.el.querySelectorAll('.rack-slot');
    expect(rows).toHaveLength(16);
    expect(rows[0].querySelector('.rack-label').textContent).toBe('Realtime A');
    expect(rows[2].classList.contains('empty')).toBe(true);
    const name0 = rows[0].querySelector('.rack-name');
    name0.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    expect(slots[0].effect).toBe('rtB');
    expect(slots[1].effect).toBe('rtA');
    ed.el.querySelectorAll('.rack-power')[0].click();
    expect(slots[0].enabled).toBe(false);
    expect(ed.el.querySelectorAll('.rack-slot')[0].classList.contains('bypassed')).toBe(true);
    ed.el.querySelectorAll('.rack-name')[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(slots[1]).toBeNull();
    ed.el.remove();
  });
  it('offers grouped realtime effects in the slot menu', () => {
    const app = fakeApp();
    let menu = null;
    app.openMenu = (items) => (menu = items);
    let slots = fitSlots([]);
    const ed = createRackEditor({ app, getSlots: () => slots, setSlots: (s) => (slots = s) });
    ed.el.querySelector('.rack-name').click();
    const labels = menu.map((m) => m.label);
    expect(labels).toContain('Modulation');
    expect(labels).not.toContain('Special'); // only an offline effect there
    menu.find((m) => m.label === 'Modulation').items.find((i) => i.label === 'Realtime A').run();
    expect(slots[0].effect).toBe('rtA');
  });
});
