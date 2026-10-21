import { el } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, compareTasks } from '../lib/store.js';
import { todayISO, monthGrid, monthKeyOf, fmtMonth, fmtDay, weekdayOf } from '../lib/dates.js';
import { taskCard } from '../ui/taskrow.js';
import { openTaskForm } from '../ui/taskform.js';
import { openModal } from '../ui/modal.js';
import { buildICS } from '../lib/ics.js';

/* Viewed month survives store-change re-renders. */
let viewYear = null;
let viewMonth = null;

const DOW_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function calendarView() {
  const today = todayISO();
  if (viewYear === null) {
    viewYear = Number(today.slice(0, 4));
    viewMonth = Number(today.slice(5, 7));
  }

  const startMonday = store.settings.startMonday !== false;
  const grid = monthGrid(viewYear, viewMonth, startMonday);
  const monthKey = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;

  const byDay = new Map();
  for (const t of store.tasks) {
    if (!t.due) continue;
    if (!byDay.has(t.due)) byDay.set(t.due, []);
    byDay.get(t.due).push(t);
  }
  for (const tasks of byDay.values()) tasks.sort(compareTasks);

  function shift(delta) {
    viewMonth += delta;
    if (viewMonth < 1) { viewMonth = 12; viewYear--; }
    if (viewMonth > 12) { viewMonth = 1; viewYear++; }
    rerender();
  }

  let root;
  function rerender() {
    const fresh = calendarView();
    root.replaceWith(fresh);
    root = fresh;
  }

  function openDay(day) {
    const tasks = (byDay.get(day) || []);
    const open = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);
    const body = el('div', {},
      open.length || done.length
        ? el('div', {},
          open.length ? taskCard(open, { showList: true }) : null,
          done.length ? el('div', { style: { marginTop: '10px' } }, taskCard(done, { showList: true })) : null
        )
        : el('p.small.muted', { style: { textAlign: 'center', padding: '10px 0 18px' } }, 'Nothing due this day'),
      el('button.btn.btn-primary.btn-block', {
        style: { marginTop: '14px' },
        html: icon('plus', 15, 2.4),
        onclick: () => { modal.close(); openTaskForm({ due: day }); },
      }, ' Add task for this day')
    );
    const modal = openModal({ title: fmtDay(day), content: body });
  }

  function downloadICS() {
    const dated = store.tasks.filter((t) => t.due && !t.done);
    const ics = buildICS(dated, { calName: 'Tasks', listNameOf: (t) => store.listById(t.listId)?.name || null });
    const blob = new Blob([ics], { type: 'text/calendar' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'tasks.ics' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  root = el('div', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Calendar'),
        el('p.view-sub', {}, 'Everything with a due date')
      ),
      el('div.view-actions', {},
        el('button.icon-btn', {
          html: icon('fileDown', 18), 'aria-label': 'Download .ics calendar file',
          title: 'Download .ics for your calendar app',
          onclick: downloadICS,
        }),
        el('div.cal-nav', {},
          el('button.icon-btn', { html: icon('chevL', 19), 'aria-label': 'Previous month', onclick: () => shift(-1) }),
          el('button.btn.btn-ghost', {
            style: { padding: '7px 10px' },
            onclick: () => {
              viewYear = Number(today.slice(0, 4));
              viewMonth = Number(today.slice(5, 7));
              rerender();
            },
          }, 'Today'),
          el('button.icon-btn', { html: icon('chevR', 19), 'aria-label': 'Next month', onclick: () => shift(1) })
        )
      )
    ),
    el('h2.cal-month', { style: { margin: '4px 2px 10px', textAlign: 'left' } }, fmtMonth(viewYear, viewMonth)),
    el('div.card', {},
      /* Not role=grid: ARIA grids require row wrappers and arrow-key
         navigation. These are plain, fully labelled day buttons. */
      el('div.cal-grid', { 'aria-label': fmtMonth(viewYear, viewMonth) },
        (startMonday ? DOW_MON : DOW_SUN).map((d) => el('div.cal-dow', { 'aria-hidden': 'true' }, d)),
        grid.map((day) => {
          const inMonth = monthKeyOf(day) === monthKey;
          const tasks = byDay.get(day) || [];
          const openCount = tasks.filter((t) => !t.done).length;
          return el('button.cal-cell' + (inMonth ? '' : '.dim') + (day === today ? '.is-today' : ''), {
            'aria-label': `${fmtDay(day)}, ${openCount} open task${openCount === 1 ? '' : 's'}`,
            onclick: () => openDay(day),
          },
            el('span.cal-daynum', {}, String(Number(day.slice(8, 10)))),
            tasks.slice(0, 3).map((t) => el('span.cal-pill' + (t.done ? '.done' : ''), {
              style: { borderLeftColor: `var(--slot-${store.listById(t.listId)?.slot || 1})` },
            }, t.title)),
            tasks.length > 3 ? el('span.cal-more', {}, `+${tasks.length - 3} more`) : null,
            tasks.length ? el('span.cal-dots', { 'aria-hidden': 'true' },
              tasks.slice(0, 4).map(() => el('i'))) : null
          );
        })
      )
    )
  );

  return root;
}
