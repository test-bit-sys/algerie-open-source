import { describe, it, expect } from 'vitest';
import { renderAgenda } from '../src/js/views/agenda.js';
import { startOfDay, endOfDay, addDays } from '../src/js/date-utils.js';

const CURSOR = new Date(2026, 7, 17); // Mon 17 Aug 2026
const day = (n, h = 0, m = 0) => new Date(2026, 7, n, h, m).getTime();

function makeCtx(events, tasks = [], settings = {}) {
  return {
    store: {
      getEventsInRange: (from, to) => events.filter((e) => e.start < to && e.end > from),
      getTasksInRange: (from, to) => tasks.filter((t) => t.due >= from && t.due < to),
      getEvent: (id) => events.find((e) => e.id === id) || null,
      getSettings: () => ({ hour12: true, ...settings }),
    },
    settings: { hour12: true, weekStartsOn: 0, ...settings },
    cursor: CURSOR,
    now: CURSOR,
    actions: {
      createAt() {},
      openEvent() {},
      openTask() {},
      toggleTask() {},
      eventContextMenu() {},
      taskContextMenu() {},
    },
  };
}

/** [{ dayNumber, rows: [[time, title]] }] as the list renders it. */
function readList(node) {
  return [...node.querySelectorAll('.agenda__day')].map((d) => ({
    day: Number(d.querySelector('.agenda__date-num').textContent),
    rows: [...d.querySelectorAll('.agenda__event')].map((r) => [
      // A time holds its AM/PM with a no-break space (see date-utils); these
      // rows are about which event lands on which day, so read it as a plain
      // space and leave the character itself to the formatter's own test.
      r.querySelector('.agenda__event-time').textContent.replace(/\u00a0/g, ' '),
      r.querySelector('.agenda__event-title').textContent,
    ]),
  }));
}

describe('agenda view — multi-day events', () => {
  it('lists an all-day event under every day it covers', () => {
    const trip = {
      id: 'trip',
      title: 'Conference trip',
      start: startOfDay(new Date(day(17))).getTime(),
      end: endOfDay(new Date(day(19))).getTime(),
      allDay: true,
      color: 'violet',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([trip]));
    expect(readList(node)).toEqual([
      { day: 17, rows: [['All day', 'Conference trip']] },
      { day: 18, rows: [['All day', 'Conference trip']] },
      { day: 19, rows: [['All day', 'Conference trip']] },
    ]);
  });

  it('reads a cross-midnight event from midnight on its second day', () => {
    const deploy = {
      id: 'd',
      title: 'Late night deploy',
      start: day(18, 23, 0),
      end: day(19, 1, 30),
      allDay: false,
      color: 'red',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([deploy]));
    expect(readList(node)).toEqual([
      // The end is named with its date on the day the event starts: it is
      // past the midnight that closes the 18th, so a bare "1:30 AM" would
      // read as a range running backwards.
      { day: 18, rows: [['11 PM – Aug 19, 1:30 AM', 'Late night deploy']] },
      // Present from midnight on the 19th — the original 11 PM start would file
      // a row under the 19th claiming it begins the night before. The end is
      // on this row's own day, so it needs no date.
      { day: 19, rows: [['12 AM – 1:30 AM', 'Late night deploy']] },
    ]);
  });

  it('names the end date of an event saved as 9 AM to 8 AM the next morning', () => {
    // The editor reads an end time earlier than the start on the same date as
    // the next morning (timeOrderProblem in modal.js). The reported reading
    // of the result — "List view shows 09:00 – 08:00" — is what the date is
    // here to prevent.
    const ev = {
      id: 'e',
      title: 'Overnight',
      start: day(18, 9),
      end: day(19, 8),
      allDay: false,
      color: 'blue',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([ev]));
    expect(readList(node)).toEqual([
      { day: 18, rows: [['9 AM – Aug 19, 8 AM', 'Overnight']] },
      { day: 19, rows: [['12 AM – 8 AM', 'Overnight']] },
    ]);
  });

  it('keeps naming the end date on a middle day of a longer timed event', () => {
    const ev = {
      id: 'e',
      title: 'Hackathon',
      start: day(18, 9),
      end: day(20, 8),
      allDay: false,
      color: 'blue',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([ev]));
    expect(readList(node)).toEqual([
      { day: 18, rows: [['9 AM – Aug 20, 8 AM', 'Hackathon']] },
      { day: 19, rows: [['12 AM – Aug 20, 8 AM', 'Hackathon']] },
      { day: 20, rows: [['12 AM – 8 AM', 'Hackathon']] },
    ]);
  });

  it('names the end date on a 24-hour clock too', () => {
    const ev = {
      id: 'e',
      title: 'Overnight',
      start: day(18, 9),
      end: day(19, 8),
      allDay: false,
      color: 'blue',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([ev], [], { hour12: false }));
    expect(readList(node)[0].rows).toEqual([['09:00 – Aug 19, 08:00', 'Overnight']]);
  });

  it('joins the end date and its time with no-break spaces so the label wraps only at the dash', () => {
    const ev = {
      id: 'e',
      title: 'Overnight',
      start: day(18, 22, 30),
      end: day(19, 1, 30),
      allDay: false,
      color: 'blue',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([ev]));
    // The fixed-width time column cannot hold "10:30 PM – Aug 19, 1:30 AM" on
    // one line; the only plain spaces are the ones around the dash.
    expect(node.querySelector('.agenda__event-time').textContent).toBe(
      '10:30\u00a0PM – Aug\u00a019,\u00a01:30\u00a0AM',
    );
  });

  it('lists an ordinary same-day event exactly once', () => {
    const ev = {
      id: 'e',
      title: 'Standup',
      start: day(18, 9),
      end: day(18, 9, 30),
      allDay: false,
      color: 'blue',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([ev]));
    expect(readList(node)).toEqual([{ day: 18, rows: [['9 AM – 9:30 AM', 'Standup']] }]);
  });

  it('does not spill an event that ends exactly at midnight onto the next day', () => {
    const ev = {
      id: 'e',
      title: 'Evening shift',
      start: day(18, 21),
      end: day(19, 0, 0),
      allDay: false,
      color: 'blue',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([ev]));
    expect(readList(node).map((d) => d.day)).toEqual([18]);
    // And its end needs no date: "9 PM – 12 AM" is read as tonight's midnight
    // by everyone, and the event is not filed under the 19th either.
    expect(readList(node)[0].rows).toEqual([['9 PM – 12 AM', 'Evening shift']]);
  });

  it('stops at the end of the 60-day window', () => {
    const start = startOfDay(addDays(CURSOR, 58)).getTime();
    const long = {
      id: 'long',
      title: 'Sabbatical',
      start,
      end: endOfDay(addDays(CURSOR, 90)).getTime(),
      allDay: true,
      color: 'teal',
      reminders: [],
    };
    const { node } = renderAgenda(makeCtx([long]));
    // Days 58 and 59 of the window, and no further.
    expect(readList(node)).toHaveLength(2);
  });
});

describe('agenda view — the empty state', () => {
  /** ctx whose store hides everything unless `includeHidden` is passed — the
   *  shape a category filter produces. */
  function filteredCtx(events, shown = []) {
    const ctx = makeCtx(events);
    const all = ctx.store.getEventsInRange;
    ctx.store.getEventsInRange = (from, to, opts = {}) =>
      opts.includeHidden ? all(from, to) : shown;
    ctx.actions.showAllCategories = () => {
      ctx.actions.showAllCategories.calls = (ctx.actions.showAllCategories.calls || 0) + 1;
    };
    return ctx;
  }

  const ev = {
    id: 'e1',
    title: 'Dentist',
    start: day(18, 9),
    end: day(18, 10),
    allDay: false,
    color: 'blue',
    reminders: [],
  };

  it('says the calendar is empty only when it really is', () => {
    const { node } = renderAgenda(makeCtx([]));
    expect(node.querySelector('.empty p').textContent).toBe(
      'No upcoming events in the next 60 days.',
    );
    expect(node.querySelector('.empty .btn').textContent).toContain('New event');
  });

  it('blames the category filter instead of claiming there is nothing on', () => {
    // Every event hidden: "No upcoming events in the next 60 days" would be
    // false, and reads as data loss.
    const ctx = filteredCtx([ev]);
    const { node } = renderAgenda(ctx);
    expect(node.querySelector('.empty p').textContent).toBe(
      '1 event in the next 60 days is hidden by your category filter.',
    );
    const btn = node.querySelector('.empty .btn');
    expect(btn.textContent).toContain('Show all categories');
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(ctx.actions.showAllCategories.calls).toBe(1);
  });

  it('pluralises the count', () => {
    const second = { ...ev, id: 'e2', start: day(19, 9), end: day(19, 10) };
    const { node } = renderAgenda(filteredCtx([ev, second]));
    expect(node.querySelector('.empty p').textContent).toBe(
      '2 events in the next 60 days are hidden by your category filter.',
    );
  });

  /** A task the category filter hid: the range query returns it only when
   *  asked to include hidden items, exactly as the store now behaves. */
  const hiddenTask = {
    id: 't1',
    title: 'Buy milk',
    due: day(18, 9),
    allDay: false,
    done: false,
    color: 'indigo',
    isTask: true,
  };
  const hideTasks = (ctx) => {
    ctx.store.getTasksInRange = (from, to, opts = {}) => (opts.includeHidden ? [hiddenTask] : []);
    return ctx;
  };

  it('counts a hidden task, and calls it a task rather than an event', () => {
    const ctx = hideTasks(filteredCtx([]));
    const { node } = renderAgenda(ctx);
    expect(node.querySelector('.empty p').textContent).toBe(
      '1 task in the next 60 days is hidden by your category filter.',
    );
    expect(node.querySelector('.empty .btn').textContent).toContain('Show all categories');
  });

  it('names both events and tasks when the filter hid some of each', () => {
    const { node } = renderAgenda(hideTasks(filteredCtx([ev])));
    expect(node.querySelector('.empty p').textContent).toBe(
      '1 event and 1 task in the next 60 days are hidden by your category filter.',
    );
  });

  it('does not count public holidays as hidden events', () => {
    // Holidays carry no palette colour, so the filter never touches them —
    // offering "Show all categories" over them would fix nothing.
    const holiday = { id: 'h', title: 'Labour Day', start: day(20), end: day(21), allDay: true, holiday: true, readOnly: true };
    const { node } = renderAgenda(filteredCtx([holiday]));
    expect(node.querySelector('.empty p').textContent).toBe(
      'No upcoming events in the next 60 days.',
    );
  });
});
