// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { printSheet } from '../src/ui/print.js';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  document.body.className = '';
  vi.stubGlobal('matchMedia', () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  window.dispatchEvent(new Event('afterprint'));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('does not let an older print cleanup hide a newer sheet', () => {
  printSheet('First labels');
  vi.advanceTimersByTime(30000);
  printSheet('Second labels');
  vi.advanceTimersByTime(30000);
  expect(document.getElementById('print-sheet').textContent).toBe('Second labels');
  expect(document.body.classList.contains('printing')).toBe(true);
});
