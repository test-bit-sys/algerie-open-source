// The default favorites: an everyday set built from effects that exist, and
// new defaults reaching saved lists without overwriting them.
import { describe, it, expect } from 'vitest';
import '../src/effects/index.js';
import { getEffect } from '../src/effects/registry.js';
import { seedFavorites, loadFavorites, mergeNewSeeds, saveFavorites, removeFavorite, installFavorites } from '../src/effects/favorites.js';
import { BATCH_COMMANDS } from '../src/batch/process.js';
import { memoryPrefs, fakeApp } from './fx-helpers.js';

const EVERYDAY = [
  'Fade In', 'Fade Out', 'Normalize to -0.1 dB', 'Normalize to -3 dB', 'Hard Limit to -0.1 dB', 'Convert to Mono', 'Convert to Stereo',
  'Repair DC Offset', 'Remove 60 Hz Hum', 'Remove 50 Hz Hum', 'Lower Pitch', 'Raise Pitch', 'Telephone Voice', 'Voice-Over Compressor',
  'De-Esser', 'De-Noise', 'De-Reverb', 'Remove Vocals', 'Auto Heal',
];

/** A list saved by the first release of the default set (ids and actions as it wrote them). */
function firstReleaseList() {
  return [
    { id: 'seed-fade-in', name: 'Fade In', shortcut: '', action: { type: 'command', command: 'fx.fadeIn' } },
    { id: 'seed-denoise-reduce-background-noise', name: 'Reduce Background Noise', shortcut: 'Alt+N', action: { type: 'effect', effect: 'denoise', values: {} } },
    { id: 'seed-deesser-soften-sibilance', name: 'Soften Sibilance', shortcut: '', action: { type: 'effect', effect: 'deesser', values: {} } },
    { id: 'fav1', name: 'My Echo', shortcut: '', action: { type: 'effect', effect: 'echo', values: { mix: 30 } } },
  ];
}

describe('default favorites', () => {
  it('cover the everyday set with effects and commands that exist', () => {
    const seeds = seedFavorites();
    const names = seeds.map((f) => f.name);
    for (const n of EVERYDAY) expect(names, n).toContain(n);
    for (const f of seeds) {
      if (f.action.type === 'effect') expect(getEffect(f.action.effect), f.name).toBeTruthy();
      else expect(f.action.command).toMatch(/^fx\./);
    }
    // One-click fixes that need no editor run in Batch Process too.
    const batchable = seeds.filter((f) => f.action.type === 'effect' || BATCH_COMMANDS[f.action.command]).map((f) => f.name);
    expect(batchable).toContain('Repair DC Offset');
    expect(batchable).toContain('Normalize to -3 dB');
  });

  it('pitch favorites shift by a whole tone and hum favorites target mains frequencies', () => {
    const byName = Object.fromEntries(seedFavorites().map((f) => [f.name, f.action]));
    expect(byName['Lower Pitch'].values.semitones).toBe(-2);
    expect(byName['Raise Pitch'].values.semitones).toBe(2);
    expect(byName['Remove 60 Hz Hum'].values.frequency).toBe(60);
    expect(byName['Remove 50 Hz Hum'].values.frequency).toBe(50);
  });
});

describe('merging new defaults into saved lists', () => {
  it('appends new defaults once, keeps the saved list and skips duplicates of what it has', () => {
    const prefs = memoryPrefs();
    prefs.set('favorites', firstReleaseList());
    expect(mergeNewSeeds(prefs)).toBe(true);
    const list = loadFavorites(prefs);
    // The saved favorites come first, unchanged (names, shortcuts, order).
    expect(list.slice(0, 4)).toEqual(firstReleaseList());
    const names = list.map((f) => f.name);
    for (const n of ['Repair DC Offset', 'Remove 60 Hz Hum', 'Voice-Over Compressor', 'Auto Heal', 'Lower Pitch']) expect(names).toContain(n);
    // Same actions under new names are not added twice.
    expect(names).not.toContain('De-Noise');
    expect(names).not.toContain('De-Esser');
    // Seeds the first release offered and the user removed stay removed.
    expect(names).not.toContain('Fade Out');
    // Running again adds nothing.
    expect(mergeNewSeeds(prefs)).toBe(false);
    expect(loadFavorites(prefs)).toEqual(list);
  });

  it('never brings back a default the user deleted', () => {
    const prefs = memoryPrefs();
    prefs.set('favorites', firstReleaseList());
    mergeNewSeeds(prefs);
    const dc = loadFavorites(prefs).find((f) => f.name === 'Repair DC Offset');
    removeFavorite(prefs, dc.id);
    mergeNewSeeds(prefs);
    expect(loadFavorites(prefs).some((f) => f.name === 'Repair DC Offset')).toBe(false);
  });

  it('leaves the built-in set alone and records it on the first save', () => {
    const prefs = memoryPrefs();
    expect(mergeNewSeeds(prefs)).toBe(false);
    expect(prefs.get('favorites')).toBeFalsy();
    const list = loadFavorites(prefs).filter((f) => f.name !== 'De-Noise');
    saveFavorites(prefs, list);
    expect(mergeNewSeeds(prefs)).toBe(false);
    expect(loadFavorites(prefs).some((f) => f.name === 'De-Noise')).toBe(false);
  });

  it('runs when favorites are installed', () => {
    const app = fakeApp();
    app.prefs.set('favorites', firstReleaseList());
    installFavorites(app);
    expect(loadFavorites(app.prefs).some((f) => f.name === 'Repair DC Offset')).toBe(true);
  });
});
