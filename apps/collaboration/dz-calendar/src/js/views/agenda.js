/**
 * Agenda view: a scrollable, grouped-by-day list of upcoming events over a
 * 60-day window starting from the cursor date. Ideal on small screens.
 */
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { colorHex, colorFg } from '../colors.js';
import {
  startOfDay,
  addDays,
  isToday,
  formatTime,
  formatTimeRange,
  WEEKDAYS_SHORT,
  MONTHS_SHORT,
} from '../date-utils.js';

const WINDOW_DAYS = 60;

export function renderAgenda(ctx) {
  const { store, settings, cursor, now, actions } = ctx;
  const rangeStart = startOfDay(cursor).getTime();
  const rangeEnd = addDays(cursor, WINDOW_DAYS).getTime();
  const events = store.getEventsInRange(rangeStart, rangeEnd, { includeHolidays: true });
  const tasks = store.getTasksInRange(rangeStart, rangeEnd);
  // The empty state is about the user's OWN agenda being empty, so it is
  // measured without the public-holiday overlay: sixty days of holidays and no
  // "New event" button is not an emptier-feeling answer to "what's coming up?",
  // it is just a list of days the user did not ask about.
  const ownEvents = events.filter((ev) => !ev.readOnly);

  const root = el('div', { class: 'view agenda' });
  const inner = el('div', { class: 'agenda__inner' });
  root.append(inner);

  if (ownEvents.length === 0 && tasks.length === 0) {
    // "Nothing coming up" must not be said when the CATEGORY FILTER is what
    // emptied the list. The events are still there — the user hid their
    // colours — so claiming the next sixty days are empty is simply false, and
    // it reads as data loss: this is the only view that makes such a claim (the
    // grids just draw nothing), and on a phone the checkboxes that caused it
    // are behind the drawer. Counted only on this already-empty path, so the
    // common case pays nothing for it.
    const hiddenEvents = store
      .getEventsInRange(rangeStart, rangeEnd, { includeHidden: true })
      .filter((ev) => !ev.readOnly).length;
    // Tasks go through the same filter (getTasksInRange), so a list emptied
    // by hiding the only color the tasks used needs the same explanation —
    // and it should say "task", not call them events.
    const hiddenTasks = store.getTasksInRange(rangeStart, rangeEnd, { includeHidden: true }).length;
    const hiddenCount = hiddenEvents + hiddenTasks;
    const counted = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
    const hiddenWhat = [
      hiddenEvents ? counted(hiddenEvents, 'event') : '',
      hiddenTasks ? counted(hiddenTasks, 'task') : '',
    ]
      .filter(Boolean)
      .join(' and ');
    root.append(
      el('div', { class: 'empty' }, [
        el('span', { class: 'icon icon--lg', html: icon('calendar-blank') }),
        el('p', {
          text: hiddenCount
            ? `${hiddenWhat} in the next 60 days ${
                hiddenCount === 1 ? 'is' : 'are'
              } hidden by your category filter.`
            : 'No upcoming events in the next 60 days.',
        }),
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          html: hiddenCount
            ? icon('check', { size: 'sm' }) + '<span>Show all categories</span>'
            : icon('plus', { size: 'sm' }) + '<span>New event</span>',
          on: {
            click: () =>
              hiddenCount
                ? actions.showAllCategories()
                : actions.createAt({ start: defaultTime(cursor) }),
          },
        }),
      ]),
    );
    inner.remove();
    return { node: root, afterMount() {} };
  }

  // Group events and tasks together by day within the window.
  const groups = new Map();
  const push = (key, item) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  };
  // An event is listed under EVERY day it covers, not just the one it starts
  // on. Month and week both draw a multi-day event on each of its days; the
  // list left it under day one only, so "what's on Thursday?" silently omitted
  // the conference that had been running since Monday. Stepping by calendar day
  // (not a fixed 24h) keeps the keys on local midnight across a DST boundary,
  // and the half-open `cur < end` matches getEventsInRange — an event ending
  // exactly at midnight does not spill onto the next day.
  events.forEach((ev) => {
    const last = Math.min(ev.end, rangeEnd);
    let cur = startOfDay(new Date(Math.max(ev.start, rangeStart)));
    while (cur.getTime() < last) {
      push(cur.getTime(), { kind: ev.readOnly ? 'holiday' : 'event', item: ev, when: ev.start, allDay: ev.allDay });
      cur = addDays(cur, 1);
    }
  });
  tasks.forEach((t) => {
    push(startOfDay(new Date(t.due)).getTime(), { kind: 'task', item: t, when: t.due, allDay: t.allDay });
  });

  [...groups.keys()]
    .sort((a, b) => a - b)
    .forEach((key) => {
      const day = new Date(key);
      const list = el('div', { class: 'agenda__events' });
      groups
        .get(key)
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.when - b.when)
        .forEach((entry) => {
          if (entry.kind === 'task') list.append(buildTaskRow(entry.item, ctx));
          else if (entry.kind === 'holiday') list.append(buildHolidayRow(entry.item, ctx));
          else list.append(buildRow(entry.item, key, ctx));
        });

      inner.append(
        el('div', { class: 'agenda__day' }, [
          el('div', { class: 'agenda__date' }, [
            el('div', {
              class: `agenda__date-num${isToday(day, now) ? ' is-today' : ''}`,
              'aria-current': isToday(day, now) ? 'date' : null,
              text: String(day.getDate()),
            }),
            el('div', {
              class: 'agenda__date-dow',
              text: `${WEEKDAYS_SHORT[day.getDay()]} · ${MONTHS_SHORT[day.getMonth()]}`,
            }),
          ]),
          list,
        ]),
      );
    });

  return { node: root, afterMount() {} };
}

function defaultTime(day) {
  const d = startOfDay(day);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/** The row's time column: "9 AM – 10:30 AM", or "9 AM – Sep 5, 8 AM" when the
 *  event runs on past the row's day. Without the date, an event saved as
 *  9 AM to 8 AM the next morning (how the editor reads an end time earlier
 *  than the start — see timeOrderProblem in modal.js) shows as a backwards
 *  range, and nothing on the row says otherwise. The date is named only when
 *  the end is past the midnight that closes the row's day — the same
 *  half-open test that files the event under the next day — so "9 PM – 12 AM"
 *  stays as everyone reads it. Date-then-time for the far endpoint follows
 *  the details card and invitation emails. The end's date and time are
 *  joined with no-break spaces so that, in the fixed-width column, a long
 *  label wraps after the dash and never inside "Sep 5". */
function rowTimeRange(start, end, dayStart, hour12) {
  const opts = { hour12 };
  const nextMidnight = addDays(new Date(dayStart), 1).getTime();
  if (end <= nextMidnight) return formatTimeRange(new Date(start), new Date(end), opts);
  const e = new Date(end);
  const NBSP = '\u00a0';
  const endDate = `${MONTHS_SHORT[e.getMonth()]}${NBSP}${e.getDate()}`;
  return `${formatTime(new Date(start), opts)} – ${endDate},${NBSP}${formatTime(e, opts)}`;
}

function buildRow(event, dayStart, ctx) {
  const { hour12 } = ctx.settings;
  // On a day the event was already running, it is present from midnight — so
  // the row reads "12 AM", not the misleading original start (the same rule the
  // month chip follows). The END stays the event's real one, so a continued row
  // still says when the thing actually finishes. On its first day this is just
  // event.start, so nothing changes there.
  const shownStart = Math.max(event.start, dayStart);
  const timeText = event.allDay ? 'All day' : rowTimeRange(shownStart, event.end, dayStart, hour12);

  const row = el('div', {
    class: `agenda__event${event.ooo ? ' is-ooo' : ''}${event.declined ? ' is-declined' : ''}`,
    tabindex: '0',
    role: 'button',
    dataset: { focusKey: `ev:${event.id}` },
    title: event.title || '(Untitled)',
    'aria-label': `${event.ooo ? 'Out of office: ' : ''}${event.title || 'Untitled'}${event.declined ? ' (declined)' : ''}, ${timeText}`,
  });
  row.append(
    event.ooo
      // The plane replaces the color dot on an away row, so it has to carry the
      // color the dot would have — nothing else on the row can.
      ? el('span', {
          class: 'agenda__event-icon',
          style: { '--chip-color': colorHex(event.color) },
          html: icon('plane', { size: 'sm' }),
        })
      : el('span', { class: 'agenda__event-dot', style: { '--chip-color': colorHex(event.color) } }),
    el('span', { class: 'agenda__event-time', text: timeText }),
    el('span', { class: 'agenda__event-title', text: event.title || '(Untitled)' }),
  );

  row.addEventListener('click', () => ctx.actions.openEvent(event));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ctx.actions.openEvent(event);
    }
  });
  row.addEventListener('contextmenu', (e) => ctx.actions.eventContextMenu(e, event));
  return row;
}

/**
 * A read-only overlay row — a public holiday (holidays.js) or a clock change
 * (dst.js). Opens the read-only details card like its month and week
 * counterparts; no context menu, because there is no stored event behind it
 * to edit or delete.
 */
function buildHolidayRow(item, ctx) {
  const kind = item.dst ? 'Clock change' : 'Public holiday';
  const row = el(
    'div',
    {
      class: 'agenda__event agenda__event--holiday',
      tabindex: '0',
      role: 'button',
      dataset: { focusKey: item.id },
      title: item.dst ? item.title : `${item.title} · ${item.countryName}`,
      'aria-label': `${kind}: ${item.title}`,
    },
    [
      el('span', { class: 'agenda__event-icon', html: icon(item.dst ? 'clock' : 'flag', { size: 'sm' }), 'aria-hidden': 'true' }),
      // The time column names the kind, as "All day" would for an event.
      el('span', { class: 'agenda__event-time', text: item.dst ? 'Clocks' : 'Holiday' }),
      el('span', { class: 'agenda__event-title', text: item.title }),
    ],
  );
  row.addEventListener('click', () => ctx.actions.openEvent(item));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ctx.actions.openEvent(item);
    }
  });
  return row;
}

function buildTaskRow(task, ctx) {
  const { hour12 } = ctx.settings;
  const timeText = task.allDay ? 'To-do' : formatTime(new Date(task.due), { hour12 });

  const row = el('div', {
    class: `agenda__event agenda__task${task.done ? ' is-done' : ''}`,
    tabindex: '0',
    role: 'button',
    dataset: { focusKey: `task:${task.id}` },
    title: task.title || '(Untitled task)',
    'aria-label': `Task: ${task.title || 'Untitled'}, ${timeText}${task.done ? ', done' : ''}`,
  });

  const check = el('button', {
    class: `agenda__task-check${task.done ? ' is-checked' : ''}`,
    type: 'button',
    role: 'checkbox',
    'aria-checked': String(task.done),
    'aria-label': task.done ? 'Mark as not done' : 'Mark as done',
    style: { '--chip-color': colorHex(task.color), '--ev-fg': colorFg(task.color) },
    html: task.done ? icon('check', { size: 'sm' }) : '',
    on: {
      click: (e) => {
        e.stopPropagation();
        ctx.actions.toggleTask(task);
      },
    },
  });

  row.append(
    check,
    el('span', { class: 'agenda__event-time', text: timeText }),
    el('span', { class: 'agenda__event-title agenda__task-title', text: task.title || '(Untitled task)' }),
  );

  row.addEventListener('click', () => ctx.actions.openTask(task));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      // The nested check button handles its own keys: preventDefault here
      // would cancel its activation and open the editor over a toggle.
      if (e.target.closest('.agenda__task-check')) return;
      e.preventDefault();
      ctx.actions.openTask(task);
    }
  });
  row.addEventListener('contextmenu', (e) => ctx.actions.taskContextMenu(e, task));
  return row;
}
