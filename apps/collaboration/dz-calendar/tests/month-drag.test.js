import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderMonth } from '../src/js/views/month.js';
import { startOfDay } from '../src/js/date-utils.js';

const CURSOR = new Date(2026, 7, 19); // Wed 19 Aug 2026

function makeCtx(events, moved) {
  return {
    store: {
      getEventsInRange: (from, to) => events.filter((e) => e.start < to && e.end > from),
      getTasksInRange: () => [],
      getEvent: (id) => events.find((e) => e.id === id) || null,
      getAllEvents: () => events,
      getSettings: () => ({ hour12: true }),
    },
    settings: { hour12: true, weekStartsOn: 0 },
    cursor: CURSOR,
    miniCursor: CURSOR,
    now: CURSOR,
    actions: {
      createAt() {},
      gotoDayView() {},
      slotContextMenu() {},
      openEvent() {},
      openTask() {},
      toggleTask() {},
      eventContextMenu() {},
      taskContextMenu() {},
      moveEvent: (...args) => moved.push(args),
      moveTask() {},
      edgePage() {},
    },
  };
}

/** Fake a rect for every cell so cellAt() can hit-test under jsdom (which
 *  lays nothing out and reports zeros for every element). */
function stubCellRects(root) {
  const cells = [...root.querySelectorAll('.month__cell')];
  cells.forEach((cell, i) => {
    cell.getBoundingClientRect = () => ({
      left: (i % 7) * 100,
      right: (i % 7) * 100 + 100,
      top: Math.floor(i / 7) * 100,
      bottom: Math.floor(i / 7) * 100 + 100,
      width: 100,
      height: 100,
    });
  });
  return cells;
}

const pointer = (type, x, y, buttons = 1) => {
  const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 7 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  Object.defineProperty(e, 'buttons', { value: buttons });
  return e;
};

describe('month chip drag', () => {
  let root;
  let moved;

  beforeEach(() => {
    moved = [];
    const start = startOfDay(CURSOR).getTime() + 14 * 3_600_000;
    const events = [
      { id: 'e1', title: 'Design review', start, end: start + 3_600_000, allDay: false, color: 'green', reminders: [] },
    ];
    const rendered = renderMonth(makeCtx(events, moved));
    root = rendered.node;
    document.body.append(root);
  });

  afterEach(() => {
    root.remove();
    document.body.classList.remove('is-dragging');
  });

  it('rings the cell the chip would land on, and only that one', () => {
    const cells = stubCellRects(root);
    const chip = root.querySelector('.chip');
    chip.dispatchEvent(pointer('pointerdown', 5, 5));
    window.dispatchEvent(pointer('pointermove', 20, 20)); // past the drag threshold
    window.dispatchEvent(pointer('pointermove', 250, 350)); // a cell three rows down

    const lit = cells.filter((c) => c.classList.contains('is-drop-target'));
    expect(lit).toHaveLength(1);
    expect(lit[0]).toBe(cells[3 * 7 + 2]);

    // Moving on hands the ring to the new cell rather than leaving a trail.
    window.dispatchEvent(pointer('pointermove', 450, 350));
    const still = cells.filter((c) => c.classList.contains('is-drop-target'));
    expect(still).toHaveLength(1);
    expect(still[0]).toBe(cells[3 * 7 + 4]);

    window.dispatchEvent(pointer('pointerup', 450, 350, 0));
    expect(cells.some((c) => c.classList.contains('is-drop-target'))).toBe(false);
    expect(moved).toHaveLength(1);
  });

  it('clears the ring when the drag is cancelled', () => {
    const cells = stubCellRects(root);
    const chip = root.querySelector('.chip');
    chip.dispatchEvent(pointer('pointerdown', 5, 5));
    window.dispatchEvent(pointer('pointermove', 20, 20));
    window.dispatchEvent(pointer('pointermove', 250, 350));
    expect(cells.some((c) => c.classList.contains('is-drop-target'))).toBe(true);

    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cells.some((c) => c.classList.contains('is-drop-target'))).toBe(false);
    expect(moved).toHaveLength(0);
  });
});
