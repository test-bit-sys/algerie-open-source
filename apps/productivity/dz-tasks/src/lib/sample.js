/**
 * Sample dataset for "explore with sample data": a believable week of
 * personal + work tasks, shaped exactly like an export so store.importAll()
 * installs it — and wipeAll() removes it — through the normal path.
 */

import { uid } from './util.js';
import { todayISO, addDays } from './dates.js';
import { nextDue } from './recur.js';

export function sampleDataset({ now = new Date() } = {}) {
  const today = todayISO(now);
  const day = (n) => addDays(today, n);
  const ids = { personal: uid(), work: uid(), household: uid(), trip: uid() };
  const ts = now.getTime();
  const sub = (title, done = false) => ({ id: uid(), title, done });

  const lists = [
    { id: ids.personal, name: 'Personal', icon: 'user', slot: 1, order: 0 },
    { id: ids.work, name: 'Work', icon: 'briefcase', slot: 5, order: 1 },
    { id: ids.household, name: 'Household', icon: 'house', slot: 3, order: 2 },
    { id: ids.trip, name: 'Japan trip', icon: 'plane', slot: 7, order: 3 },
  ];

  let n = 0;
  const task = (listId, title, extra = {}) => ({
    id: uid(),
    listId,
    title,
    order: n++,
    createdAt: ts - (20 - n) * 3600000,
    updatedAt: ts,
    ...extra,
  });

  const tasks = [
    // Today and overdue — what the Today view opens on.
    task(ids.personal, 'Renew passport', {
      due: day(-2), priority: 3,
      notes: 'Bring the old passport and one printed photo.',
      subtasks: [sub('Book appointment', true), sub('Print photo'), sub('Fill out form DS-82')],
    }),
    task(ids.work, 'Send Q3 planning doc to Maya', { due: today, priority: 2, tags: ['waiting-on'] }),
    task(ids.personal, 'Pick up dry cleaning', { due: today, dueTime: '17:30', tags: ['errands'] }),
    task(ids.household, 'Water the plants', {
      due: today, repeat: { freq: 'daily', interval: 3, mode: 'due' },
    }),

    // Coming up.
    task(ids.work, 'Prepare demo for design review', {
      due: day(1), dueTime: '10:00', priority: 3,
      subtasks: [sub('Update staging data'), sub('Rehearse the flow'), sub('Charge the spare laptop')],
    }),
    task(ids.personal, 'Call grandma', { due: day(2), priority: 1 }),
    task(ids.work, 'Weekly review', {
      // Due on the rule's own weekday (the next Friday, or today if Friday).
      due: nextDue({ freq: 'weekly', interval: 1, weekdays: [5], mode: 'due' }, day(-1), today),
      priority: 2,
      repeat: { freq: 'weekly', interval: 1, weekdays: [5], mode: 'due' },
      notes: 'Inbox zero, plan next week, update the team board.',
    }),
    task(ids.household, 'Pay rent', {
      due: day(6), priority: 3,
      repeat: { freq: 'monthly', interval: 1, mode: 'due' },
    }),
    task(ids.household, 'Deep-clean the kitchen', {
      due: day(5),
      subtasks: [sub('Oven'), sub('Fridge shelves'), sub('Descale the kettle')],
    }),

    // Someday / undated.
    task(ids.trip, 'Book flights to Tokyo', {
      priority: 2, notes: 'Aim for the second week of October. Check award seats first.',
    }),
    // Tags cut across lists — the same label shows up under Personal too,
    // so the tag view has something to demonstrate.
    task(ids.trip, 'Research Kyoto neighborhoods', { priority: 1, tags: ['15min'] }),
    task(ids.trip, 'Make a packing list', {
      subtasks: [sub('Rail pass documents'), sub('Power adapter'), sub('Walking shoes')],
    }),
    task(ids.personal, 'Read "The Design of Everyday Things"', { priority: 1, tags: ['15min'] }),

    // A little history so Logbook and completed sections feel real.
    task(ids.work, 'File expense report', {
      done: true, completedAt: ts - 86400000, due: day(-1), priority: 2,
    }),
    task(ids.personal, 'Schedule dentist appointment', {
      done: true, completedAt: ts - 2 * 86400000,
    }),
    task(ids.household, 'Replace hallway lightbulb', {
      done: true, completedAt: ts - 3 * 86400000,
    }),
  ];

  return {
    kind: 'tasks.export',
    v: 1,
    settings: { sampleData: true, onboarded: true, defaultListId: ids.personal },
    lists,
    items: { tasks, logMonths: [] },
  };
}
