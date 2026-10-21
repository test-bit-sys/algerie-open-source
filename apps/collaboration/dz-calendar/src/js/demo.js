import { addDays, startOfDay } from './date-utils.js';

/** Local dates keep the demo on the current week across month/year and DST boundaries. */
export function sampleCalendar(now = new Date()) {
  const monday = startOfDay(now);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const at = (day, hour, minute = 0) => {
    const date = addDays(monday, day);
    date.setHours(hour, minute, 0, 0);
    return date.getTime();
  };
  const meetings = [
    [0, 9, 30, 'Weekly planning', 'indigo', 'Studio table'],
    [0, 14, 60, 'Brand direction review', 'violet', 'Design room'],
    [1, 10, 60, 'Customer discovery', 'blue', 'Research studio'],
    [1, 13, 45, 'Lunch with Amelia', 'orange', 'Garden cafe'],
    [2, 9, 45, 'Product walkthrough', 'indigo', 'Studio table'],
    [2, 15, 60, 'Website design critique', 'violet', 'Design room'],
    [3, 10, 90, 'Launch campaign workshop', 'pink', 'Workshop space'],
    [3, 14, 30, 'Partner catch-up', 'teal', 'Studio table'],
    [4, 9, 45, 'Team demo & coffee', 'indigo', 'Lounge'],
    [4, 14, 60, 'Weekly reflection', 'green', 'Quiet room'],
    [5, 10, 120, 'Coastal trail walk', 'green', 'Trailhead'],
    [6, 11, 90, 'Sunday brunch', 'orange', 'Garden cafe'],
    [-7, 9, 60, 'Project kickoff', 'blue', 'Studio table'],
    [-4, 14, 90, 'Creative exploration', 'violet', 'Design room'],
    [7, 10, 60, 'Prototype review', 'blue', 'Design room'],
    [9, 14, 60, 'Launch readiness', 'pink', 'Studio table'],
    [11, 15, 60, 'Studio showcase', 'teal', 'Lounge'],
    [16, 10, 60, 'Next chapter planning', 'indigo', 'Studio table'],
  ];
  const events = meetings.map(([day, hour, minutes, title, color, location]) => ({
    title, color, location, start: at(day, hour), end: at(day, hour, minutes),
    description: 'Fictional sample event for the Northwind Studio demo.', reminders: [],
  }));
  events.push({
    title: 'Focus time', color: 'teal', start: at(0, 11), end: at(0, 12),
    description: 'Fictional sample series. A quiet hour for meaningful work.', reminders: [],
    recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5], count: 20 },
  }, {
    title: 'Northwind launch week', color: 'pink', allDay: true,
    start: at(7, 0), end: at(12, 0), reminders: [],
    description: 'Fictional sample milestone. No invitations are sent.',
  });
  const tasks = ['Share the creative brief', 'Review homepage copy', 'Approve the launch checklist', 'Send workshop notes', 'Prepare next week’s priorities']
    .map((title, i) => ({ title, due: at(i, 16), allDay: false, done: i === 0,
      color: 'green', notes: 'Fictional sample task for the Northwind Studio demo.' }));
  return { events, tasks };
}

export function createSampleDataPopulator(getSession) {
  let pending = null;
  return function populateSampleData() {
    if (!pending) pending = Promise.resolve().then(async () => {
      const session = getSession();
      if (!session) throw new Error('Sign in and wait for Calendar to finish loading before populating sample data.');
      const { store, app } = session;
      const now = new Date();
      const { events, tasks } = sampleCalendar(now);
      const eventIds = [], taskIds = [];
      try {
        for (const event of events) {
          if (getSession() !== session) throw new Error('The Calendar session changed.');
          eventIds.push((await store.saveEvent(event)).id);
        }
        for (const task of tasks) {
          if (getSession() !== session) throw new Error('The Calendar session changed.');
          taskIds.push((await store.saveTask(task)).id);
        }
      } catch (cause) {
        throw new Error(`Sample data stopped after ${eventIds.length} events and ${taskIds.length} tasks were saved. Those records remain in your calendar.`, { cause });
      }
      app.showDate(now, 'week');
      return { events: eventIds.length, tasks: taskIds.length, eventIds, taskIds };
    }).finally(() => { pending = null; });
    return pending;
  };
}
