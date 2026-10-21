/**
 * Year view: a scrollable grid of twelve mini-months for the cursor's year.
 * Clicking a day opens the day view; clicking a month heading opens that month.
 * Days that carry at least one event get a dot, from a single whole-year query.
 */
import { el } from '../dom.js';
import {
  getMonthGrid,
  orderedWeekdays,
  startOfDay,
  addDays,
  isSameDay,
  isSameMonth,
  isToday,
  MONTHS_LONG,
  WEEKDAYS_NARROW,
} from '../date-utils.js';

export function renderYear(ctx) {
  const { store, cursor } = ctx;
  const year = cursor.getFullYear();

  // One event query for the whole year → set of local-midnight ms with events.
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const eventDays = daysWithEvents(store, yearStart, yearEnd);

  const root = el('div', { class: 'view year' });
  const grid = el('div', { class: 'year__grid' });
  for (let m = 0; m < 12; m++) {
    grid.append(buildMiniMonth(new Date(year, m, 1), ctx, eventDays));
  }
  root.append(grid);
  return { node: root };
}

function buildMiniMonth(monthDate, ctx, eventDays) {
  const { settings, cursor, now, actions } = ctx;
  const card = el('div', { class: 'year__month' });

  card.append(
    el('button', {
      class: 'year__month-name',
      type: 'button',
      text: MONTHS_LONG[monthDate.getMonth()],
      title: `Open ${MONTHS_LONG[monthDate.getMonth()]}`,
      on: { click: () => actions.gotoMonthView(monthDate) },
    }),
  );

  const grid = el('div', { class: 'year__days' });
  orderedWeekdays(settings.weekStartsOn).forEach((idx) => {
    grid.append(el('div', { class: 'year__dow', text: WEEKDAYS_NARROW[idx] }));
  });

  getMonthGrid(monthDate, settings.weekStartsOn).forEach((day) => {
    // Adjacent-month cells are shown dimmed for context, but only interactive in
    // their own month's card so every real date is clickable in exactly one place.
    if (!isSameMonth(day, monthDate)) {
      grid.append(el('div', { class: 'year__day is-muted', 'aria-hidden': 'true', text: String(day.getDate()) }));
      return;
    }
    const classes = ['year__day'];
    if (isToday(day, now)) classes.push('is-today');
    if (isSameDay(day, cursor)) classes.push('is-selected');
    if (eventDays.has(startOfDay(day).getTime())) classes.push('has-events');
    grid.append(
      el('button', {
        class: classes.join(' '),
        type: 'button',
        text: String(day.getDate()),
        // Today and the selected day are painted; say them too.
        'aria-label': `${day.toDateString()}${isSameDay(day, cursor) ? ', selected' : ''}`,
        'aria-current': isToday(day, now) ? 'date' : null,
        on: { click: () => actions.gotoDayView(day) },
      }),
    );
  });

  card.append(grid);
  return card;
}

/** Local-midnight ms of every day in [from, to) with at least one event. Steps
 *  by calendar day so keys stay aligned to local midnight across DST. */
function daysWithEvents(store, from, to) {
  const set = new Set();
  // Respect hidden calendars like every other visual surface (month/week/day/
  // agenda/mini-calendar all use the default includeHidden:false). Only the
  // non-visual features — reminders and search — deliberately include hidden.
  for (const ev of store.getEventsInRange(from, to)) {
    let cur = startOfDay(new Date(Math.max(ev.start, from)));
    const end = Math.min(ev.end, to);
    while (cur.getTime() < end) {
      set.add(cur.getTime());
      cur = addDays(cur, 1);
    }
  }
  return set;
}
