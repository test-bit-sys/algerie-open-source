/**
 * Enter/Space on a task's nested check control must toggle the task, not open
 * its editor. The row/chip-level keydown handler used to preventDefault() and
 * openTask() whatever the target was, cancelling the focused check button's
 * native activation — leaving keyboard users no way to mark a task done from
 * any view (mouse users were unaffected: the check's click stops propagation).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderMonth } from '../src/js/views/month.js';
import { renderAgenda } from '../src/js/views/agenda.js';
import { renderDay } from '../src/js/views/day.js';

const DAY = new Date(2026, 7, 19); // Wed Aug 19 2026

const task = {
  id: 'task-1',
  title: 'Water plants',
  due: new Date(2026, 7, 19, 9, 0).getTime(),
  allDay: false,
  done: false,
  color: 'red',
};

function makeCtx() {
  return {
    store: {
      getEventsInRange: () => [],
      getTasksInRange: () => [task],
      getEvent: () => null,
    },
    settings: { weekStartsOn: 0, hour12: true },
    cursor: DAY,
    now: DAY,
    actions: { openTask: vi.fn(), toggleTask: vi.fn(), taskContextMenu: vi.fn() },
  };
}

function press(target, key) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

const VIEWS = [
  ['month', renderMonth, '.chip--task', '.chip__check'],
  ['agenda', renderAgenda, '.agenda__task', '.agenda__task-check'],
  ['day', renderDay, '.task-chip', '.chip__check'],
];

describe.each(VIEWS)('%s view task keyboard handling', (name, render, chipSel, checkSel) => {
  it('Enter on the check control is left to the button — no editor, no preventDefault', () => {
    const ctx = makeCtx();
    const { node } = render(ctx);
    const check = node.querySelector(`${chipSel} ${checkSel}`);
    expect(check).toBeTruthy();
    for (const key of ['Enter', ' ']) {
      const e = press(check, key);
      // Cancelling the keydown would suppress the button's native activation.
      expect(e.defaultPrevented, `${key} defaultPrevented`).toBe(false);
    }
    expect(ctx.actions.openTask).not.toHaveBeenCalled();
  });

  it('Enter on the chip itself still opens the task', () => {
    const ctx = makeCtx();
    const { node } = render(ctx);
    const chip = node.querySelector(chipSel);
    expect(chip).toBeTruthy();
    const e = press(chip, 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(ctx.actions.openTask).toHaveBeenCalledTimes(1);
  });
});
