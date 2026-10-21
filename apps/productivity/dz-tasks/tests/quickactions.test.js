import { describe, it, expect, beforeAll } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';

let quickRescheduleActions;

beforeAll(async () => {
  installMockPuter(); // the module pulls in the store singleton
  ({ quickRescheduleActions } = await import('../src/ui/quickactions.js'));
});

/** label → date for the reschedule entries only. */
function dateOptions(task, today) {
  return Object.fromEntries(
    quickRescheduleActions(task, { today })
      .filter((a) => a.date !== undefined)
      .map((a) => [a.label, a.date])
  );
}

const task = { id: 't1', due: null, repeat: null };

describe('quick reschedule dates', () => {
  it('offers today, tomorrow, the coming Saturday, and Monday midweek', () => {
    const opts = dateOptions(task, '2026-08-05'); // Wednesday
    expect(opts).toEqual({
      'Due today': '2026-08-05',
      'Tomorrow': '2026-08-06',
      'This weekend': '2026-08-08',
      'Next week': '2026-08-10',
    });
  });

  it('"Next week" respects the week-start setting', () => {
    expect(dateOptions(task, '2026-08-05')['Next week']).toBe('2026-08-10'); // Monday default
    const sundayStart = Object.fromEntries(
      quickRescheduleActions(task, { today: '2026-08-05', startMonday: false })
        .filter((a) => a.date !== undefined).map((a) => [a.label, a.date]));
    expect(sundayStart['Next week']).toBe('2026-08-09'); // Sunday
  });

  it('on Friday, "This weekend" folds into "Tomorrow" instead of duplicating it', () => {
    const opts = dateOptions(task, '2026-08-07'); // Friday
    expect(opts['Tomorrow']).toBe('2026-08-08');
    expect(opts['This weekend']).toBeUndefined();
  });

  it('on Saturday, "This weekend" is today — never a week-long postponement', () => {
    const opts = dateOptions(task, '2026-08-08'); // Saturday
    expect(opts['This weekend']).toBeUndefined(); // folded into "Due today"
    expect(opts['Due today']).toBe('2026-08-08');
    expect(Object.values(opts)).not.toContain('2026-08-15');
  });

  it('on Sunday, "This weekend" does not skip past the current weekend', () => {
    const opts = dateOptions(task, '2026-08-09'); // Sunday
    expect(Object.values(opts)).not.toContain('2026-08-15');
  });

  it('drops the option matching the task\'s current due date', () => {
    const opts = dateOptions({ ...task, due: '2026-08-05' }, '2026-08-05');
    expect(opts['Due today']).toBeUndefined();
    expect(opts['Tomorrow']).toBe('2026-08-06');
  });
});
