/**
 * Text ON an event fill must actually read: chips and timed events run their
 * labels at 12–13px, where WCAG AA wants 4.5:1 — and white ink over the
 * lighter palette fills bottomed out at 2.15:1 (orange), with a text-shadow
 * standing in for contrast. Every fill now carries a per-color ink (--ev-fg),
 * and this suite is the runnable validator: change a palette hex and the
 * pairing must still clear AA.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EVENT_COLORS, colorFg, colorHex } from '../src/js/colors.js';
import { renderMonth } from '../src/js/views/month.js';
import { renderDay } from '../src/js/views/day.js';

const luminance = (hex) => {
  const c = hex
    .slice(1)
    .match(/../g)
    .map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('event fill/ink pairings', () => {
  it('every palette color meets WCAG AA (4.5:1) for its ink', () => {
    for (const c of EVENT_COLORS) {
      expect(contrast(c.hex, c.fg), `${c.key} ${c.hex} on ${c.fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('colorFg answers for every color and falls back like colorHex', () => {
    for (const c of EVENT_COLORS) expect(colorFg(c.key)).toBe(c.fg);
    expect(colorFg('chartreuse')).toBe(colorFg('indigo')); // DEFAULT_COLOR fallback
  });
});

describe('the ink reaches the DOM beside the fill', () => {
  const DAY = new Date(2026, 7, 19);
  function makeCtx(events) {
    return {
      store: {
        getEventsInRange: () => events,
        getTasksInRange: () => [],
        getEvent: (id) => events.find((e) => e.id === id) || null,
      },
      settings: { weekStartsOn: 0, hour12: true },
      cursor: DAY,
      now: DAY,
      actions: {},
    };
  }

  it('a filled month chip carries --ev-fg for its color', () => {
    const allDay = {
      id: 'e1',
      title: 'Retreat',
      start: new Date(2026, 7, 19).getTime(),
      end: new Date(2026, 7, 20).getTime() - 1,
      allDay: true,
      color: 'orange',
    };
    const { node } = renderMonth(makeCtx([allDay]));
    const chip = node.querySelector('.chip--filled');
    expect(chip.style.getPropertyValue('--ev-fg')).toBe(colorFg('orange'));
    expect(chip.style.getPropertyValue('--chip-color')).toBe(colorHex('orange'));
  });

  it('a timed event on the hour grid carries --ev-fg for its color', () => {
    const timed = {
      id: 'e2',
      title: 'Sync',
      start: new Date(2026, 7, 19, 10, 0).getTime(),
      end: new Date(2026, 7, 19, 11, 0).getTime(),
      allDay: false,
      color: 'teal',
    };
    const { node } = renderDay(makeCtx([timed]));
    const ev = node.querySelector('.tevent');
    expect(ev.style.getPropertyValue('--ev-fg')).toBe(colorFg('teal'));
    expect(ev.style.getPropertyValue('--ev-fill')).toBe(colorHex('teal'));
  });
});

describe('the stylesheet consumes the ink instead of hardcoding white', () => {
  const css = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/views.css'),
    'utf8',
  );

  it('no fill rule hardcodes white ink or leans on the text-shadow crutch', () => {
    expect(css).not.toMatch(/^\s*color: #fff;$/m);
    expect(css).not.toContain('text-shadow: 0 1px 2px');
    expect(css).toContain('var(--ev-fg, #fff)');
  });
});
