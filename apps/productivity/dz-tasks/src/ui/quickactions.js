import { todayISO, addDays, nextWeekday, weekdayOf, fmtDay, relativeDue } from '../lib/dates.js';
import { store } from '../lib/store.js';
import { toast } from './toast.js';
import { openTaskForm } from './taskform.js';

/** "This weekend": the coming Saturday — or today, mid-weekend. */
function weekendOf(today) {
  const dow = weekdayOf(today);
  return dow === 6 || dow === 0 ? today : nextWeekday(today, 6);
}

/**
 * Quick reschedule entries for a row's action menu: the postpones people
 * reach for constantly, one tap instead of a trip through the edit form.
 * Every reschedule gets an Undo toast.
 */
export function quickRescheduleActions(task, {
  today = todayISO(),
  startMonday = store.settings.startMonday !== false,
} = {}) {
  const options = [
    { label: 'Due today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'This weekend', date: weekendOf(today) },
    { label: 'Next week', date: nextWeekday(today, startMonday ? 1 : 0) },
  ].filter((o, i, all) =>
    // Skip the task's current date, and days already offered under an
    // earlier label (Fri: "Tomorrow" and "This weekend" are both Saturday).
    o.date !== task.due && all.findIndex((x) => x.date === o.date) === i);

  const actions = options.map((o) => ({
    icon: 'calendarClock',
    label: o.label,
    sub: fmtDay(o.date),
    date: o.date,
    onClick: () => reschedule(task, o.date),
  }));

  if (task.repeat && task.due) {
    actions.push({
      icon: 'skip',
      label: 'Skip this occurrence',
      sub: 'Move to the next repeat without completing',
      onClick: async () => {
        const next = await store.skipOccurrence(task.id);
        if (next) toast(`Skipped. Next: ${relativeDue(next)}`, { icon: 'repeat' });
      },
    });
  }
  actions.push({
    icon: 'calendar',
    label: 'Pick a date…',
    sub: 'Any day, in the edit form',
    onClick: () => openTaskForm({ task }),
  });
  if (task.due) {
    actions.push({
      icon: 'x',
      label: 'Remove due date',
      onClick: () => reschedule(task, null),
    });
  }
  return actions;
}

async function reschedule(task, due) {
  const undo = await store.rescheduleTasks([task.id], due);
  if (!undo.length) return;
  // Relative words read as words ("due tomorrow"); weekday and month
  // abbreviations keep their capitals ("Due Fri").
  const rel = due ? relativeDue(due) : '';
  const when = rel === 'Today' || rel === 'Tomorrow' ? rel.toLowerCase() : rel;
  toast(due ? `Due ${when}` : 'Due date removed', {
    icon: 'calendarClock',
    action: { label: 'Undo', onClick: () => store.restoreDues(undo) },
  });
}

/** Shared by the Today view: everything overdue lands on today, undoable. */
export async function moveOverdueToToday(tasks) {
  const undo = await store.rescheduleTasks(tasks.map((t) => t.id), todayISO());
  if (!undo.length) return;
  toast(`${undo.length} task${undo.length === 1 ? '' : 's'} moved to today`, {
    icon: 'calendarClock',
    action: { label: 'Undo', onClick: () => store.restoreDues(undo) },
  });
}
