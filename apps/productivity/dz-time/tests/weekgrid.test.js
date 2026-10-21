// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPuterMock } from './puter-mock.js';

const DAYS = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
let store;
let weekGrid;
let captureGridFocus;
let restoreGridFocus;
let alpha;
let beta;

beforeEach(async () => {
  // The grid renders from the app's store singleton, whose month cache
  // outlives init(); a fresh module graph per test keeps one test's
  // entries out of the next one's grid.
  vi.resetModules();
  ({ store } = await import('../src/lib/store.js'));
  ({ weekGrid, captureGridFocus, restoreGridFocus } = await import('../src/ui/weekgrid.js'));
  vi.stubGlobal('puter', createPuterMock());
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<main id="app"></main>';
  await store.init();
  const client = await store.addClient({ name: 'Acme' });
  alpha = await store.addProject({ clientId: client.id, name: 'Alpha' });
  beta = await store.addProject({ clientId: client.id, name: 'Beta' });
  // Two entries on Beta's Monday make that cell read-only.
  await store.addEntry({ date: DAYS[0], projectId: beta.id, seconds: 1800 });
  await store.addEntry({ date: DAYS[0], projectId: beta.id, seconds: 1800 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Mount a fresh grid over the current entries, the way the view does. */
async function mount() {
  const entries = await store.entriesBetween(DAYS[0], DAYS[6]);
  const grid = weekGrid({
    days: DAYS, entries, extra: [alpha.id, beta.id], onAddRow: () => {}, onJump: () => {},
  });
  document.getElementById('app').replaceChildren(grid);
  return grid;
}

const cell = (project, day) => document.querySelector(`input[data-cell="${project.id}|${day}"]`);
const key = (node, k) => node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('week grid keyboard', () => {
  it('keeps focus on a read-only cell that Enter stepped onto across the save', async () => {
    await mount();
    const added = vi.spyOn(store, 'addEntry');
    const input = cell(alpha, DAYS[0]);
    input.focus();
    input.value = '1:00';
    key(input, 'Enter');
    // Alpha's Monday has Beta's read-only Monday below it.
    const locked = document.activeElement;
    expect(locked.classList.contains('grid-locked')).toBe(true);
    expect(locked.dataset.pos).toBe('1,0');
    await vi.waitFor(() => expect(added).toHaveBeenCalledTimes(1));

    // The save re-renders the view; what it captured has to find the same
    // cell in the fresh grid.
    const focus = captureGridFocus();
    expect(focus).toEqual({ pos: '1,0' });
    await mount();
    restoreGridFocus(focus);
    expect(document.activeElement.classList.contains('grid-locked')).toBe(true);
    expect(document.activeElement.dataset.pos).toBe('1,0');
  });

  it('commits the last row in place, once, and keeps the cell focused', async () => {
    await mount();
    const added = vi.spyOn(store, 'addEntry');
    const input = cell(beta, DAYS[1]);
    input.focus();
    input.value = '60m';
    key(input, 'Enter');
    expect(document.activeElement).toBe(input);
    await vi.waitFor(() => expect(added).toHaveBeenCalledTimes(1));
    expect(added.mock.calls[0][0]).toMatchObject({ projectId: beta.id, date: DAYS[1], seconds: 3600 });
    await vi.waitFor(async () => expect((await store.entriesBetween(DAYS[1], DAYS[1])).length).toBe(1));

    // The save re-renders the view around the cell. Chrome blurs a focused
    // element it removes, so that blur must not write the hour again, and
    // the cell comes back focused, reading the way the grid writes it.
    const focus = captureGridFocus();
    input.dispatchEvent(new Event('blur'));
    await mount();
    restoreGridFocus(focus);
    await new Promise((r) => setTimeout(r, 20));
    expect(added).toHaveBeenCalledTimes(1);
    expect((await store.entriesBetween(DAYS[1], DAYS[1])).length).toBe(1);
    expect(document.activeElement).toBe(cell(beta, DAYS[1]));
    expect(document.activeElement.value).toBe('1:00');

    // Leaving the restored cell finds nothing left to write either.
    document.activeElement.blur();
    await new Promise((r) => setTimeout(r, 20));
    expect(added).toHaveBeenCalledTimes(1);
  });

  it('does not save a half-typed value when a re-render removes the cell', async () => {
    await mount();
    const added = vi.spyOn(store, 'addEntry');
    const input = cell(alpha, DAYS[4]);
    input.focus();
    input.value = '2:';
    // Another device's change lands and the view rebuilds under the user.
    const focus = captureGridFocus();
    input.dispatchEvent(new Event('blur'));
    await mount();
    restoreGridFocus(focus);
    await new Promise((r) => setTimeout(r, 20));
    expect(added).not.toHaveBeenCalled();
    expect(document.activeElement.value).toBe('2:');

    // Finishing the value and leaving the cell saves it once.
    document.activeElement.value = '2:00';
    document.activeElement.blur();
    await vi.waitFor(() => expect(added).toHaveBeenCalledTimes(1));
    expect(added.mock.calls[0][0]).toMatchObject({ projectId: alpha.id, date: DAYS[4], seconds: 7200 });
  });

  it('keeps an arrow at the grid\u2019s edge from reaching the page shortcuts', async () => {
    await mount();
    // Beta's Monday is read-only and sits in the first column.
    const locked = document.querySelector('.grid-locked[data-pos="1,0"]');
    locked.focus();
    const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    locked.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(locked);
    // Inside the grid the arrows still move between cells.
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    locked.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cell(beta, DAYS[1]));
  });

  it('puts the cell back on Escape without leaving it', async () => {
    await mount();
    const input = cell(alpha, DAYS[2]);
    input.focus();
    input.value = '2:30';
    key(input, 'Escape');
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('still restores a half-typed value into the cell that holds focus', async () => {
    await mount();
    const input = cell(alpha, DAYS[3]);
    input.focus();
    input.value = '1:';
    const focus = captureGridFocus();
    await mount();
    restoreGridFocus(focus);
    expect(document.activeElement).toBe(cell(alpha, DAYS[3]));
    expect(document.activeElement.value).toBe('1:');
  });
});
