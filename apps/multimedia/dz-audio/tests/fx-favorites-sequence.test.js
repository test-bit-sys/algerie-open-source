import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { registerEffect } from '../src/effects/registry.js';
import * as E from '../src/model/edits.js';
import { loadFavorites, applyFavorite, installFavorites, favoritesPanel, favoriteProblem, describeFavorite, editFavoriteDialog } from '../src/effects/favorites.js';
import { placeSelection, actionFromSteps, applyStepsToState, batchStepsProblem } from '../src/effects/favorite-sequence.js';
import { batchFavoriteProblem, applyFavoriteToState } from '../src/batch/process.js';
import { installEffectCommands } from '../src/effects/commands.js';
import { fakeApp, filled } from './fx-helpers.js';

registerEffect({ id: 'seqGain', name: 'Seq Gain', group: 'Special', kind: null, params: [{ id: 'gain', min: 0, max: 4, step: 0.5, default: 1 }], process: async ({ channels, values }) => channels.map((c) => c.map((v) => v * values.gain)) });

const tick = () => new Promise((r) => setTimeout(r, 0));
const at = (doc, i) => doc.state.channels[0].toArray(i, i + 1)[0];

function setup(n = 1000) {
  const app = fakeApp();
  installEffectCommands(app);
  // A Delete like the editor's (selection only).
  app.commands.register({
    id: 'edit.delete',
    label: 'Delete',
    enabled: (a) => a.active?.hasSelection,
    run: (a) => {
      const d = a.active;
      d.apply('Delete', E.deleteRange(d.state, d.selection.start, d.selection.end, null), { selection: { start: d.selection.start, end: d.selection.start } });
    },
  });
  installFavorites(app);
  const doc = new AudioFile({ name: 'a.wav', sampleRate: 1000, channels: [Channel.fromSamples(filled(n, 0.25))] });
  app.active = doc;
  return { app, doc };
}

async function record(app, fn) {
  const run = app.commands.run('fav.recordStart');
  await tick();
  [...document.querySelectorAll('.dialog')].pop().querySelector('.btn.primary').click();
  await run;
  await fn();
  const steps = app.favorites.recordedSteps();
  const stop = app.commands.run('fav.recordStop');
  await tick();
  const dialog = [...document.querySelectorAll('.dialog')].pop();
  dialog.querySelector('input').value = 'My Chain';
  dialog.querySelector('.btn.primary').click();
  await stop;
  return steps;
}

describe('recording multi-step favorites', () => {
  it('records effects, edits and selection changes until stopped, then replays them', async () => {
    const { app, doc } = setup();
    const steps = await record(app, async () => {
      await app.runEffect('seqGain', { values: { gain: 2 } }); // whole file: 0.5
      doc.setSelection(0, 100);
      await app.commands.run('fx.normalizePeak', { peak: 0 }); // first 10% -> 1.0
      doc.setSelection(900, 1000);
      await app.commands.run('edit.delete'); // last 10% removed
    });
    expect(steps.map((s) => s.effect || s.command)).toEqual(['seqGain', 'fx.normalizePeak', 'edit.delete']);
    expect(steps[0].select).toBe(null);
    expect(steps[1].select).toMatchObject({ start: 0, end: 100, length: 1000, mode: 'relative' });
    expect(steps[2].select).toMatchObject({ start: 900, end: 1000, length: 1000 });
    const fav = loadFavorites(app.prefs).at(-1);
    expect(fav.name).toBe('My Chain');
    expect(fav.action.type).toBe('sequence');
    expect(describeFavorite(app, fav)).toMatch(/^3 steps: Seq Gain, Normalize Peak \(0 dB\), Delete/);

    // Replay on a file twice as long: selections land at the same fractions.
    const other = new AudioFile({ name: 'b.wav', sampleRate: 1000, channels: [Channel.fromSamples(filled(2000, 0.25))] });
    app.active = other;
    expect(favoriteProblem(app, fav)).toBe('');
    expect(await applyFavorite(app, fav)).toBe(true);
    expect(other.length).toBe(1800);
    expect(at(other, 50)).toBeCloseTo(1);
    expect(at(other, 500)).toBeCloseTo(0.5);
    expect(other.history.entries.length).toBe(4);
  });

  it('a single recorded step saves as a plain favorite that uses the current selection', async () => {
    const { app, doc } = setup();
    await record(app, async () => {
      doc.setSelection(10, 20);
      await app.runEffect('seqGain', { values: { gain: 3 } });
    });
    const fav = loadFavorites(app.prefs).at(-1);
    expect(fav.action).toEqual({ type: 'effect', effect: 'seqGain', values: { gain: 3 } });
  });

  it('ignores commands that change nothing or cannot be replayed', async () => {
    const { app } = setup();
    app.commands.register({ id: 'view.thing', label: 'Thing', run: () => {} });
    const steps = await record(app, async () => {
      await app.commands.run('view.thing');
      await app.commands.run('fx.fadeIn');
    });
    expect(steps.map((s) => s.command)).toEqual(['fx.fadeIn']);
  });
});

describe('sequence selections', () => {
  it('places recorded ranges relatively or by time', () => {
    const sel = { start: 100, end: 200, length: 1000, rate: 1000, mode: 'relative' };
    expect(placeSelection(sel, 2000, 1000)).toEqual([200, 400]);
    expect(placeSelection({ ...sel, mode: 'absolute' }, 2000, 2000)).toEqual([200, 400]);
    expect(placeSelection({ ...sel, mode: 'absolute' }, 150, 1000)).toEqual([100, 150]);
    expect(placeSelection(null, 10, 10)).toBe(null);
    expect(actionFromSteps([{ type: 'command', command: 'fx.invert', select: sel }])).toEqual({ type: 'command', command: 'fx.invert' });
  });
});

describe('sequences in Batch Process', () => {
  it('applies supported steps to a whole state', async () => {
    const steps = [
      { type: 'effect', effect: 'seqGain', values: { gain: 2 }, select: null },
      { type: 'command', command: 'fx.normalizePeak', args: { peak: 0 }, select: { start: 0, end: 50, length: 100, rate: 1000, mode: 'relative' } },
      { type: 'command', command: 'edit.delete', select: { start: 90, end: 100, length: 100, rate: 1000, mode: 'relative' } },
      { type: 'command', command: 'edit.insertSilence', args: { seconds: 0.1 }, select: { start: 0, end: 0, length: 100, rate: 1000, mode: 'relative' } },
    ];
    expect(batchStepsProblem(steps)).toBe('');
    const fav = { action: { type: 'sequence', steps } };
    expect(batchFavoriteProblem(fav)).toBe('');
    const state = { sampleRate: 1000, channels: [Channel.fromSamples(filled(1000, 0.25))], markers: [], meta: {} };
    const out = await applyFavoriteToState(fav, state);
    const x = out.channels[0].toArray();
    expect(x.length).toBe(1000); // -100 deleted, +100 silence
    expect(x[50]).toBe(0);
    expect(x[200]).toBeCloseTo(1);
    expect(x[800]).toBeCloseTo(0.5);
    expect(batchStepsProblem([{ type: 'command', command: 'fx.autoHeal' }])).toMatch(/cannot run/);
  });
});

describe('Edit Favorite with steps', () => {
  it('shows the steps in the panel and lets a step use the current selection or be removed', async () => {
    const { app, doc } = setup();
    await record(app, async () => {
      await app.commands.run('fx.fadeIn');
      doc.setSelection(0, 100);
      await app.commands.run('fx.fadeOut');
    });
    const fav = loadFavorites(app.prefs).at(-1);
    const panel = favoritesPanel(app);
    panel.el.querySelector(`tr[data-id="${fav.id}"]`).click();
    const rows = [...panel.el.querySelectorAll('.fav-actions tbody tr')].map((r) => [...r.cells].map((c) => c.textContent));
    expect(rows).toEqual([
      ['Fade In', 'Current', '', ''],
      ['Fade Out', 'Relative range', '0.0%', '10.0%'],
    ]);
    const run = editFavoriteDialog(app, fav);
    await tick();
    const dialog = [...document.querySelectorAll('.dialog')].pop();
    const sel = dialog.querySelectorAll('.fav-steps-edit select')[1];
    sel.value = 'absolute';
    sel.dispatchEvent(new Event('change'));
    dialog.querySelectorAll('.fav-steps-edit button')[0].click();
    dialog.querySelector('.btn.primary').click();
    await run;
    const saved = loadFavorites(app.prefs).find((f) => f.id === fav.id);
    expect(saved.action.steps).toHaveLength(1);
    expect(saved.action.steps[0]).toMatchObject({ command: 'fx.fadeOut', select: { mode: 'absolute' } });
  });
});
