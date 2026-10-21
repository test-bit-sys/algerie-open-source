import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderTimeGrid } from '../src/js/views/timegrid.js';
import { startOfDay, endOfDay } from '../src/js/date-utils.js';

const DAY = new Date(2026, 7, 19); // Wed 19 Aug 2026

function makeCtx({ events = [], tasks = [] } = {}) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const store = {
    getEventsInRange: (from, to) => events.filter((e) => e.start < to && e.end > from),
    getTasksInRange: (from, to) => tasks.filter((t) => t.due >= from && t.due < to),
    getEvent: (id) => byId.get(id) || null,
    getSettings: () => ({ hour12: true }),
  };
  return {
    store,
    settings: { hour12: true, weekStartsOn: 0, secondaryTz: '' },
    now: DAY,
    actions: {
      gotoDayView() {},
      createAt() {},
      slotContextMenu() {},
      openEvent() {},
      openTask() {},
      toggleTask() {},
      eventContextMenu() {},
      taskContextMenu() {},
      moveEvent() {},
      moveTask() {},
      edgePage() {},
    },
  };
}

/** The band class of each direct child of the grid root, top to bottom. */
function bandOrder(node) {
  return [...node.children].map((child) => {
    if (child.classList.contains('timegrid__head')) return 'head';
    if (child.classList.contains('timegrid__tasks')) return 'tasks';
    if (child.classList.contains('timegrid__allday')) return 'allday';
    if (child.classList.contains('timegrid__scroll')) return 'scroll';
    return child.className;
  });
}

/** Give an element the offsetWidth/clientWidth jsdom never computes. */
function fakeScrollbar(el, width) {
  Object.defineProperty(el, 'offsetWidth', { value: 200, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 200 - width, configurable: true });
}

describe('the header holds back the hour scroller’s scrollbar', () => {
  // The header and the rails are siblings of the scroller, not children, so
  // only the body loses width to its scrollbar. Both bands are
  // `var(--gutter) 1fr` grids, so without this the 1fr track came out a
  // scrollbar wider up top and every day separator drifted — a whole
  // scrollbar's worth by the last column.
  const days = [...Array(7)].map((_, i) => new Date(2026, 7, 16 + i));

  it('publishes the width the scroller actually reserved', () => {
    const { node, afterMount } = renderTimeGrid(days, makeCtx());
    fakeScrollbar(node.querySelector('.timegrid__scroll'), 15);
    afterMount();
    expect(node.style.getPropertyValue('--sbw')).toBe('15px');
  });

  it('reserves nothing where scrollbars are overlays', () => {
    const { node, afterMount } = renderTimeGrid(days, makeCtx());
    fakeScrollbar(node.querySelector('.timegrid__scroll'), 0);
    afterMount();
    // macOS by default: no width to hold back, so the header stays full width.
    expect(node.style.getPropertyValue('--sbw')).toBe('0px');
  });

  it('re-measures on every mount, so a zoom change is picked up', () => {
    const { node, afterMount } = renderTimeGrid(days, makeCtx());
    const scroll = node.querySelector('.timegrid__scroll');
    fakeScrollbar(scroll, 15);
    afterMount();
    expect(node.style.getPropertyValue('--sbw')).toBe('15px');
    fakeScrollbar(scroll, 11);
    afterMount();
    expect(node.style.getPropertyValue('--sbw')).toBe('11px');
  });

  it('spends it through the stylesheet, on the header and the rails', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/views.css'),
      'utf8',
    );
    // The header is not a scroll container, so it pays with padding…
    expect(css).toMatch(/\.timegrid__head \{[^}]*padding-right: var\(--sbw, 0px\);/s);
    // …while a rail is one, and reserves its own gutter whether or not it has
    // overflowed — otherwise its columns sit a scrollbar wide of the body's on
    // every ordinary day.
    expect(css).toMatch(/\.timegrid__allday \{[^}]*scrollbar-gutter: stable;/s);
  });
});

describe('time grid band order', () => {
  it('puts the day headers above the all-day and task rails', () => {
    const dayStart = startOfDay(DAY).getTime();
    const dayEnd = endOfDay(DAY).getTime();
    const { node } = renderTimeGrid([DAY], makeCtx({
      events: [
        { id: 'a', title: 'Conference', start: dayStart, end: dayEnd, allDay: true, color: 'blue', reminders: [] },
      ],
      tasks: [{ id: 't', title: 'Pay invoice', due: dayStart, allDay: true, done: false, color: 'pink', isTask: true }],
    }));
    // The date row is what every chip below it is filed under, so it comes first.
    expect(bandOrder(node)).toEqual(['head', 'allday', 'tasks', 'scroll']);
  });

  it('keeps the headers first when there is nothing in the rails', () => {
    const { node } = renderTimeGrid([DAY], makeCtx());
    expect(bandOrder(node)).toEqual(['head', 'scroll']);
  });
});
