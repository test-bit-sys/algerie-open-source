/**
 * Browser reminders for follow-ups.
 *
 * A reminder that only works when you remember to open the app isn't a
 * reminder, so while any tab is open this fires a once-a-day digest of what
 * is due, plus a notification the moment a timed follow-up comes due.
 * Native push while the app is closed needs a server; the .ics export
 * covers that gap.
 *
 * What has already been announced lives in localStorage, not KV: it is a
 * property of this device, and two devices should each get their own
 * morning nudge.
 */

import { todayISO, formatClock } from './util.js';

const SEEN_KEY = 'crm:notified:v1';
const CHECK_MS = 60_000;
/** Don't dump a whole backlog into the notification centre at once. */
const MAX_PER_CHECK = 3;

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** Ask once; browsers only show the prompt on a user gesture. */
export async function requestNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function loadSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveSeen(seen, today) {
  // Yesterday's keys are dead weight; keep the store to today's marks.
  const kept = Object.fromEntries(Object.entries(seen).filter(([, day]) => day === today));
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept));
  } catch {}
}

function show(title, body, hash) {
  try {
    const n = new Notification(title, { body, icon: './icon-192.png', tag: hash });
    n.onclick = () => {
      window.focus();
      location.hash = hash;
      n.close();
    };
  } catch {
    // Some engines (mobile Chrome) only allow notifications from a service
    // worker. Nothing to do but stay quiet.
  }
}

const hhmm = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** One pass: the daily digest, then any timed follow-up that has come due. */
export function checkReminders(store, now = new Date()) {
  if (!store.settings.notifications) return 0;
  if (notificationPermission() !== 'granted') return 0;

  const today = todayISO(now);
  const seen = loadSeen();
  const open = store.openTasks();
  let sent = 0;

  const digestKey = `digest:${today}`;
  if (!seen[digestKey]) {
    seen[digestKey] = today;
    const overdue = open.filter((t) => t.due < today).length;
    const dueToday = open.filter((t) => t.due === today).length;
    if (overdue || dueToday) {
      const parts = [
        overdue && `${overdue} overdue`,
        dueToday && `${dueToday} due today`,
      ].filter(Boolean).join(' · ');
      show('Follow-ups need you', parts, '#/followups');
      sent++;
    }
  }

  // Timed follow-ups due today: fire at the minute they come due. Overdue
  // days are the digest's job - nobody needs yesterday's 2pm call at 9am.
  const nowHM = hhmm(now);
  for (const task of open) {
    if (sent >= MAX_PER_CHECK) break;
    if (!task.dueTime || task.due !== today || task.dueTime > nowHM) continue;
    const key = `task:${task.id}:${today}`;
    if (seen[key]) continue;
    seen[key] = today;
    // Same clock the rest of the app speaks ("2:30pm", not "14:30").
    show(task.title, `Due at ${formatClock(task.dueTime)}`, `#/followups?task=${task.id}`);
    sent++;
  }

  saveSeen(seen, today);
  return sent;
}

/**
 * Run the check on a timer, when the tab comes back to the foreground, and
 * whenever the data changes (a follow-up added for 10 minutes from now
 * should still fire). Returns a stop function.
 */
export function startReminders(store) {
  const run = () => {
    try {
      checkReminders(store);
    } catch (err) {
      console.error(err);
    }
  };
  const timer = setInterval(run, CHECK_MS);
  const onVisible = () => { if (!document.hidden) run(); };
  document.addEventListener('visibilitychange', onVisible);
  // Without this the data-change half of the promise above was the timer's
  // to keep, so switching reminders on in Settings sat silent for up to a
  // minute before the first digest. A check with reminders off is an early
  // return, and what has already been announced is deduplicated, so running
  // one per mutation costs nothing.
  store.addEventListener('change', run);
  run();
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    store.removeEventListener('change', run);
  };
}
