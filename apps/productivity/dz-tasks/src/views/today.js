import { el } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, compareTasks } from '../lib/store.js';
import { todayISO, isOverdue, fmtDay } from '../lib/dates.js';
import { taskCard } from '../ui/taskrow.js';
import { openTaskForm } from '../ui/taskform.js';
import { quickAddBar } from '../ui/quickadd.js';
import { moveOverdueToToday } from '../ui/quickactions.js';
import { plural } from '../lib/util.js';

/** Today: overdue first, then due today, then today's completions. */
export function todayView() {
  const today = todayISO();
  const open = store.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => isOverdue(t, today)).sort(compareTasks);
  const dueToday = open.filter((t) => t.due === today).sort(compareTasks);
  const doneToday = store.completedTasks().filter((t) =>
    t.completedAt && todayISO(new Date(t.completedAt)) === today);

  const total = overdue.length + dueToday.length + doneToday.length;
  const doneShare = total ? doneToday.length / total : 0;

  const root = el('div', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Today'),
        el('p.view-sub', {}, fmtDay(today))
      ),
      el('div.view-actions', {},
        el('button.btn.btn-primary', {
          html: icon('plus', 15, 2.4),
          onclick: () => openTaskForm({ due: today }),
        }, ' Add for today')
      )
    ),
    quickAddBar({ defaultDue: today })
  );

  if (total > 0) {
    root.append(el('div.card', {},
      el('div.day-progress', {},
        el('div.progress', { role: 'progressbar', 'aria-valuenow': Math.round(doneShare * 100), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Today progress' },
          el('div', { style: { width: `${doneShare * 100}%` } })),
        el('span.label', {}, `${doneToday.length}/${total} done`)
      )
    ));
  }

  if (overdue.length) {
    root.append(
      el('div.section-label.danger', {}, 'Overdue', el('span.count', {}, plural(overdue.length, 'task')),
        el('button.section-action', {
          onclick: () => moveOverdueToToday(overdue),
        }, 'Move all to today')),
      taskCard(overdue, { showList: true })
    );
  }

  if (dueToday.length) {
    root.append(
      el('div.section-label', {}, 'Due today', el('span.count', {}, plural(dueToday.length, 'task'))),
      taskCard(dueToday, { showList: true })
    );
  }

  if (!overdue.length && !dueToday.length) {
    root.append(el('div.card', { style: { marginTop: '16px' } }, el('div.empty', {},
      el('div.empty-icon', { html: icon('checkBig', 26) }),
      el('h3', {}, doneToday.length ? 'All clear' : 'Nothing due today'),
      el('p', {}, doneToday.length
        ? 'Everything due today is done. Enjoy the calm.'
        : 'Add a task for today, or check Upcoming for what is ahead.')
    )));
  }

  if (doneToday.length) {
    root.append(
      el('div.section-label', {}, 'Completed today', el('span.count', {}, plural(doneToday.length, 'task'))),
      taskCard(doneToday, { showList: true })
    );
  }

  return root;
}
