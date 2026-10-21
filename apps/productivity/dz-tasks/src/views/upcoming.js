import { el } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, compareTasks } from '../lib/store.js';
import { todayISO, addDays, relativeDue, fmtDay } from '../lib/dates.js';
import { taskCard } from '../ui/taskrow.js';
import { openTaskForm } from '../ui/taskform.js';

/** Upcoming: the next seven days, day by day, then Later and Someday. */
export function upcomingView() {
  const today = todayISO();
  const horizon = addDays(today, 7);
  const open = store.tasks.filter((t) => !t.done).sort(compareTasks);

  const root = el('div', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Upcoming'),
        el('p.view-sub', {}, 'The next seven days, then everything later')
      ),
      el('div.view-actions', {},
        el('button.btn.btn-primary', {
          html: icon('plus', 15, 2.4),
          onclick: () => openTaskForm({}),
        }, ' New task')
      )
    )
  );

  const overdue = open.filter((t) => t.due && t.due < today);
  if (overdue.length) {
    root.append(
      el('div.section-label.danger', {}, 'Overdue'),
      taskCard(overdue, { showList: true })
    );
  }

  let any = false;
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const tasks = open.filter((t) => t.due === day);
    if (!tasks.length) continue;
    any = true;
    root.append(
      el('div.day-group-head' + (day === today ? '.is-today' : ''), {},
        el('span.d-name', {}, relativeDue(day, today)),
        el('span.d-date', {}, fmtDay(day))
      ),
      taskCard(tasks, { showList: true })
    );
  }

  const later = open.filter((t) => t.due && t.due >= horizon);
  if (later.length) {
    root.append(
      el('div.section-label', {}, 'Later'),
      taskCard(later, { showList: true })
    );
  }

  const someday = open.filter((t) => !t.due);
  if (someday.length) {
    root.append(
      el('div.section-label', {}, 'Someday', el('span.count', {}, 'no date')),
      taskCard(someday, { showList: true })
    );
  }

  if (!any && !later.length && !someday.length && !overdue.length) {
    root.append(el('div.card', { style: { marginTop: '16px' } }, el('div.empty', {},
      el('div.empty-icon', { html: icon('calendarClock', 26) }),
      el('h3', {}, 'Nothing scheduled'),
      el('p', {}, 'Tasks with due dates appear here, grouped by day.')
    )));
  }

  return root;
}
