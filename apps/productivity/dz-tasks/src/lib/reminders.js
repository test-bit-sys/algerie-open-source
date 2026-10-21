/**
 * Reminders via the Notification API.
 *
 * Two layers, both gated on the same setting + permission:
 *  - A daily summary of due/overdue tasks, shown on boot at most once a day
 *    (deduped through localStorage).
 *  - Per-task reminders: tasks with a due date can carry `reminder`, minutes
 *    before the due time (0 = at it; all-day tasks anchor to 09:00). While
 *    the app is open, timers fire them; reminders missed while it was closed
 *    are summarized on the next boot. Recurring tasks re-arm themselves
 *    simply by rolling forward, so "every Monday" reminds every Monday.
 */

import { todayISO, isOverdue, isDueToday, parseISO, fmtTime } from './dates.js';

const LS_KEY = 'tasks:lastReminder';
const LS_FIRED = 'tasks:firedReminders:v1';
const LS_LAST_CHECK = 'tasks:lastReminderCheck';

/** All-day tasks remind at this local time. */
export const DEFAULT_REMIND_TIME = '09:00';

export const REMINDER_OFFSETS = [
  { value: 0, label: 'At due time' },
  { value: 10, label: '10 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

export function describeReminder(minutes) {
  const preset = REMINDER_OFFSETS.find((o) => o.value === minutes);
  if (preset) return preset.label;
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
}

/** Epoch ms when a task's reminder fires, or null when it has none. */
export function reminderFireAt(task) {
  if (!task || task.done || task.reminder === null || task.reminder === undefined) return null;
  if (!task.due) return null;
  const [h, m] = (task.dueTime || DEFAULT_REMIND_TIME).split(':').map(Number);
  const at = parseISO(task.due);
  at.setHours(h, m, 0, 0);
  return at.getTime() - task.reminder * 60000;
}

export function remindersSupported() {
  return typeof Notification !== 'undefined';
}

export async function requestReminderPermission() {
  if (!remindersSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const res = await Notification.requestPermission();
  return res === 'granted';
}

function canNotify(store) {
  return store.settings.reminders && remindersSupported() && Notification.permission === 'granted';
}

async function show(title, body, { tag, onclick } = {}) {
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
      onclick?.();
    };
    return true;
  } catch { /* fall through */ }
  // Some platforms (notably Chrome on Android) only allow notifications
  // from a service worker. Clicks focus the app (see sw.template.js).
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (!reg?.showNotification) return false;
    await reg.showNotification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}

export async function maybeNotifyDue(store, { today = todayISO() } = {}) {
  if (!canNotify(store)) return null;
  try {
    if (localStorage.getItem(LS_KEY) === today) return null;
  } catch { /* still notify */ }

  const open = store.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => isOverdue(t, today));
  const dueToday = open.filter((t) => isDueToday(t, today));
  if (!overdue.length && !dueToday.length) return null;

  const parts = [];
  if (dueToday.length) parts.push(`${dueToday.length} due today`);
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  const first = (dueToday[0] || overdue[0]).title;

  if (!await show('Tasks', `${parts.join(', ')}. Starting with "${first}"`, { tag: 'tasks-due-summary' })) {
    return null;
  }
  try { localStorage.setItem(LS_KEY, today); } catch {}
  return { overdue: overdue.length, dueToday: dueToday.length };
}

/* ---------- per-task reminders ---------- */

/* Fired-key ledger so a reschedule (every store change) never re-fires a
   reminder, and boot catch-up never repeats one. Keys are task@fireTime, so
   editing the due date arms a fresh key on purpose. */
function readFired() {
  try {
    return JSON.parse(localStorage.getItem(LS_FIRED)) || {};
  } catch {
    return {};
  }
}

function markFired(keys, { now = Date.now() } = {}) {
  const fired = readFired();
  for (const k of keys) fired[k] = now;
  // Prune entries once their fire time is safely in the past — but never
  // inside the window catch-up can still look back over, which starts at
  // the last checkpoint. A tab left open past the prune age keeps firing
  // timers without ever advancing that checkpoint (it moves on boot and
  // on visibility), so pruning on age alone let the next catch-up
  // re-notify reminders this session had already shown.
  let checkpoint = 0;
  try { checkpoint = Number(localStorage.getItem(LS_LAST_CHECK)) || 0; } catch {}
  const cutoff = Math.min(now - 7 * 86400000, checkpoint);
  for (const [k, at] of Object.entries(fired)) {
    if (at < cutoff) delete fired[k];
  }
  try { localStorage.setItem(LS_FIRED, JSON.stringify(fired)); } catch {}
}

const firedKey = (task, fireAt) => `${task.id}@${fireAt}`;

/**
 * Open tasks whose reminder fell inside (since, now] and has not fired.
 * Pure selection logic, exported for tests.
 */
export function missedReminders(tasks, since, now, fired = {}) {
  const out = [];
  for (const t of tasks) {
    const at = reminderFireAt(t);
    if (at === null || at <= since || at > now) continue;
    // A task created after its own fire time never had a reminder armed —
    // "missed" would be a lie (add at 14:00, due today 09:00).
    if ((t.createdAt || 0) > at) continue;
    if (fired[firedKey(t, at)]) continue;
    out.push({ task: t, fireAt: at });
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

/**
 * Boot/on-focus catch-up: one summary for reminders missed while the app
 * was closed (or the tab throttled). Advances the checkpoint even when
 * notifications are off, so enabling them later doesn't dump history.
 */
export async function catchUpMissedReminders(store, { now = Date.now() } = {}) {
  let since = null;
  try { since = Number(localStorage.getItem(LS_LAST_CHECK)) || null; } catch {}
  try { localStorage.setItem(LS_LAST_CHECK, String(now)); } catch {}
  if (since === null || !canNotify(store)) return null;

  const missed = missedReminders(store.tasks.filter((t) => !t.done), since, now, readFired());
  if (!missed.length) return null;

  // Claim the reminders only once something was actually shown — a failed
  // notification must not silently consume them.
  const shown = missed.length === 1
    ? await notifyTask(missed[0].task, { prefix: 'Missed reminder' })
    : await show('Tasks', `${missed.length} reminders while you were away. First: "${missed[0].task.title}"`,
      { tag: 'tasks-missed-reminders' });
  if (!shown) return null;
  markFired(missed.map((m) => firedKey(m.task, m.fireAt)), { now });
  return { missed: missed.length };
}

function notifyTask(task, { prefix = 'Reminder' } = {}) {
  const when = task.dueTime ? ` · due ${fmtTime(task.dueTime)}` : '';
  return show(`${prefix}: ${task.title}`, `${describeReminder(task.reminder)}${when}`, {
    tag: `tasks-reminder-${task.id}`,
    onclick: () => window.dispatchEvent(new CustomEvent('tasks:open-task', { detail: { id: task.id } })),
  });
}

const timers = new Map();

/** Timers are armed this far ahead (and re-armed at half of it). */
const HORIZON_MS = 86400000;

/**
 * (Re)arm timers for every upcoming reminder in the next 24h. Cheap and
 * idempotent — call it on boot, on store changes, and when the tab becomes
 * visible again (background tabs throttle timers; catch-up covers the gap).
 */
export function scheduleTaskReminders(store, { now = Date.now() } = {}) {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (!canNotify(store)) return 0;

  const fired = readFired();
  let armed = 0;
  for (const t of store.tasks) {
    if (t.done) continue;
    const at = reminderFireAt(t);
    if (at === null || at <= now || at > now + HORIZON_MS) continue;
    if (fired[firedKey(t, at)]) continue;
    timers.set(t.id, setTimeout(async () => {
      timers.delete(t.id);
      // Re-check at fire time: the task may have been completed, deleted,
      // or rescheduled since this timer was armed.
      const live = store.taskById(t.id);
      if (!live || live.done || reminderFireAt(live) !== at) return;
      if (readFired()[firedKey(live, at)]) return;
      // Claim it only once shown; a platform where showing fails leaves
      // the reminder for catch-up instead of consuming it silently.
      if (await notifyTask(live)) markFired([firedKey(live, at)]);
    }, at - now));
    armed++;
  }
  // A tab that stays open (and visible) past the horizon gets no store
  // change or visibility event to re-arm it — do so on a timer, well
  // before the armed window runs dry.
  timers.set('#horizon', setTimeout(() => {
    timers.delete('#horizon');
    scheduleTaskReminders(store);
  }, HORIZON_MS / 2));
  return armed;
}
