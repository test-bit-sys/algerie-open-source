import { describe, it, expect } from 'vitest';
import { selectionPanel } from '../src/panels/selection.js';
import { formatTime } from '../src/lib/time.js';

function fakeApp(doc) {
  const prefs = new Map([['timeFormat', 'decimal']]);
  return {
    active: doc,
    prefs: { get: (k) => prefs.get(k) },
    formatTime: (f, rate) => formatTime(f, rate, 'decimal'),
    on() {},
  };
}

function fakeDoc() {
  return {
    sampleRate: 1000,
    selection: { start: 0, end: 0 },
    cursor: 0,
    view: { start: 0, end: 60000 },
    setSelection(start, end) {
      this.selection = { start: Math.min(start, end), end: Math.max(start, end) };
    },
    setCursor(f) {
      this.cursor = f;
    },
    setView(start, end) {
      this.view = { start, end };
    },
  };
}

describe('selection panel', () => {
  it('types a duration from the cursor when there is no selection', () => {
    const doc = fakeDoc();
    // The cursor moved (ruler click, arrow keys) without touching the empty selection.
    doc.cursor = 10000;
    const panel = selectionPanel(fakeApp(doc));
    const [, , duration] = panel.el.querySelectorAll('input');
    expect(panel.el.querySelectorAll('input')[0].value).toBe('0:10.000');
    duration.value = '5';
    duration.dispatchEvent(new Event('change'));
    expect(doc.selection).toEqual({ start: 10000, end: 15000 });
  });

  it('types an end from the cursor when there is no selection', () => {
    const doc = fakeDoc();
    doc.cursor = 10000;
    const panel = selectionPanel(fakeApp(doc));
    const end = panel.el.querySelectorAll('input')[1];
    end.value = '12';
    end.dispatchEvent(new Event('change'));
    expect(doc.selection).toEqual({ start: 10000, end: 12000 });
  });
});
