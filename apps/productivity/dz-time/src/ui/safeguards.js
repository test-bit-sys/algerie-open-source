/**
 * Tracking safeguards: the timer that runs through a sleeping laptop, the
 * timer that runs all night, the workday that was never tracked, and the
 * work that was tracked and never billed. A detected sleep/away gap
 * prompts to keep, trim, or split the session; a long-running timer
 * prompts once (keep it, stop at the threshold, or stop with full time);
 * an optional weekday nudge fires when nothing is tracked by a chosen
 * hour; an optional monthly one mentions unbilled time that is getting
 * old. All stay in-app unless the user opted into system notifications in
 * Settings.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { fmtDuration, fmtClock, todayISO, isoOf } from '../lib/time.js';

const NUDGE_LS = 'hourly:nudged';
const UNBILLED_LS = 'hourly:unbilled-nudged';
const HEARTBEAT_LS = 'hourly:heartbeat';
let prompting = false;
/* Like the budget warnings: the first pass after boot is silent, so
   opening the app is never a wall of things that were already true. */
let unbilledSeeded = false;

export function initSafeguards() {
  // The shell lives for the whole session; a slow heartbeat is plenty.
  // Hidden tabs are throttled to about one tick a minute, which still
  // beats far more often than any gap worth prompting about.
  setInterval(() => check().catch((e) => console.error('safeguards', e)), 30 * 1000);
  // Wake-from-sleep and tab refocus should be caught right away, not up
  // to half a minute later.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check().catch((e) => console.error('safeguards', e));
  });
  store.addEventListener('change', writeBeat);
  check().catch((e) => console.error('safeguards', e));
}

async function check() {
  await checkIdleGap();
  await checkLongTimer();
  await checkDailyNudge();
  await checkUnbilledReminder();
}

/* ---------- idle / sleep-gap detection ---------- */

/* While a timer runs, a heartbeat timestamp keyed to the timer's start
   lands in localStorage on every tick. A large gap between the last beat
   and now means this device slept or the app was closed while the timer
   kept counting; the user decides what happens to that time. The key is
   per-device on purpose: another device continuing to work is not a gap
   it can see, and a beat from a previous timer never matches the current
   one (different startedAt). */

function readBeat() {
  try {
    const b = JSON.parse(localStorage.getItem(HEARTBEAT_LS) || 'null');
    return b && typeof b.at === 'number' && typeof b.startedAt === 'number' ? b : null;
  } catch {
    return null;
  }
}

function writeBeat() {
  try {
    if (store.running) {
      localStorage.setItem(HEARTBEAT_LS, JSON.stringify({ startedAt: store.timer.startedAt, at: Date.now() }));
    } else {
      localStorage.removeItem(HEARTBEAT_LS);
    }
  } catch {}
}

async function checkIdleGap() {
  if (!store.running) {
    writeBeat(); // clear a stale beat so it can never haunt a later timer
    return;
  }
  const mins = Number(store.settings.idleGapMinutes) || 0;
  const t = store.timer;
  const now = Date.now();
  const beat = readBeat();
  const gapStart = beat && beat.startedAt === t.startedAt ? beat.at : null;
  if (!prompting && mins > 0 && gapStart != null && now - gapStart >= mins * 60000) {
    prompting = true;
    promptIdleGap(t, gapStart, now);
  }
  writeBeat();
}

function promptIdleGap(t, gapStart, now) {
  const project = store.project(t.projectId);
  const preGapSeconds = Math.max(0, Math.floor((gapStart - t.startedAt) / 1000));
  const sameDay = isoOf(new Date(gapStart)) === isoOf(new Date(now));
  const gapStartText = new Intl.DateTimeFormat(undefined,
    sameDay ? { hour: 'numeric', minute: '2-digit' }
      : { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(gapStart);

  /* 'split': log the pre-gap time and restart the timer fresh from now.
     'trim': log the pre-gap time and stop. */
  const finish = async (mode, modal) => {
    try {
      const entry = await store.stopTimer({ capSeconds: preGapSeconds });
      if (mode === 'split') {
        await store.startTimer({ projectId: t.projectId, task: t.task, notes: t.notes, billable: t.billable });
      }
      toast(`Logged ${fmtClock(entry.seconds)}${mode === 'split' ? ', timer restarted' : ''}`, { icon: 'check' });
      modal.close();
    } catch (err) {
      console.error(err);
      toast('Could not update the timer, check your connection', { icon: 'wifiOff' });
    }
  };

  const modal = openModal({
    title: 'Were you away?',
    content: el('div', {},
      el('p.confirm-message', {},
        `The timer on ${project?.name || 'your work'} kept counting through a ${fmtDuration((now - gapStart) / 1000)} gap since ${gapStartText}, while this device was asleep or the app was closed. Before the gap it had tracked ${fmtDuration(preGapSeconds)}.`),
      el('button.btn.btn-primary.btn-block', {
        onclick: () => finish('split', modal),
      }, 'Remove the gap and keep going'),
      el('button.btn.btn-ghost.btn-block', {
        style: { marginTop: '10px' },
        onclick: () => finish('trim', modal),
      }, `Stop at the gap start (${fmtDuration(preGapSeconds)})`),
      el('button.btn.btn-ghost.btn-block', {
        style: { marginTop: '10px' },
        onclick: () => modal.close(),
      }, 'Keep the full time')
    ),
    onClose: () => { prompting = false; },
  });
}

async function checkLongTimer() {
  const hours = Number(store.settings.longTimerHours) || 0;
  if (!hours || !store.running || store.timer.longPrompted || prompting) return;
  const cap = hours * 3600;
  if (store.elapsedSeconds() < cap) return;

  prompting = true;
  // Persist the prompt marker first, so a reload (or a second tab) never
  // re-asks about the same timer; failing to persist retries next beat.
  try {
    await store.retagTimer({ longPrompted: true });
  } catch {
    prompting = false;
    return;
  }

  notifyNative('Timer still running', `Your Hourly timer passed ${hours}h. Still working?`);

  const project = store.project(store.timer?.projectId);
  const running = fmtDuration(store.elapsedSeconds());
  const modal = openModal({
    title: 'Still working?',
    content: el('div', {},
      el('p.confirm-message', {},
        `The timer on ${project?.name || 'your work'} has been running for ${running}. If it was left on by mistake, stop it at a duration that reflects real work.`),
      el('button.btn.btn-primary.btn-block', {
        onclick: () => stopWith(cap, modal),
      }, `Stop and keep ${hours}h`),
      el('button.btn.btn-ghost.btn-block', {
        style: { marginTop: '10px' },
        onclick: () => stopWith(null, modal),
      }, `Stop with the full ${running}`),
      el('button.btn.btn-ghost.btn-block', {
        style: { marginTop: '10px' },
        onclick: () => modal.close(),
      }, 'Keep running')
    ),
    onClose: () => { prompting = false; },
  });
}

async function stopWith(capSeconds, modal) {
  try {
    const entry = await store.stopTimer({ capSeconds });
    toast(`Logged ${fmtClock(entry.seconds)}`, { icon: 'check' });
    modal.close();
  } catch (err) {
    console.error(err);
    toast('Could not stop, check your connection', { icon: 'wifiOff' });
  }
}

async function checkDailyNudge() {
  const hour = store.settings.dailyNudgeHour;
  if (hour == null) return;
  const now = new Date();
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return; // weekdays only
  if (now.getHours() < Number(hour)) return;
  if (store.running) return;
  const today = todayISO();
  try {
    if (localStorage.getItem(NUDGE_LS) === today) return;
  } catch {
    return;
  }
  const entries = await store.entriesBetween(today, today);
  if (entries.length) return;
  try { localStorage.setItem(NUDGE_LS, today); } catch {}
  toast('Nothing tracked yet today. Start a timer?', { icon: 'timer', duration: 6000 });
  notifyNative('Nothing tracked today', 'Your Hourly timesheet is still empty for today.');
}

/**
 * Once a month, on or after the chosen day: which clients are holding
 * unbilled time older than the threshold. Opt-in, quiet, and recorded per
 * month, so a reminder that has been seen is never repeated. Nothing is
 * said when there is nothing old enough to mention, and that silence is
 * not recorded either: work that ages later this month still gets its one
 * reminder.
 */
async function checkUnbilledReminder() {
  const day = store.settings.unbilledReminderDay;
  if (day == null) return;
  if (!unbilledSeeded) {
    unbilledSeeded = true;
    return;
  }
  const now = new Date();
  if (now.getDate() < Number(day)) return;
  const month = isoOf(now).slice(0, 7);
  try {
    if (localStorage.getItem(UNBILLED_LS) === month) return;
  } catch {
    return; // no storage means no way to keep this to once a month
  }
  const minAgeDays = Number(store.settings.unbilledAgeDays) || 30;
  const ready = await store.readyToInvoice({ minAgeDays });
  if (!ready.length) return;
  try { localStorage.setItem(UNBILLED_LS, month); } catch {}

  const oldest = ready[0];
  const message = ready.length === 1
    ? `${oldest.client.name} has ${fmtDuration(oldest.seconds)} unbilled, oldest ${oldest.ageDays} days`
    : `${ready.length} clients hold unbilled time older than ${minAgeDays} days`;
  toast(message, {
    icon: 'receipt',
    duration: 8000,
    action: {
      label: 'Review',
      // Straight to the surface that lists it, with the tab named in the
      // URL so the view opens on the right one.
      onClick: () => { location.hash = '#/reports?view=invoices'; },
    },
  });
  notifyNative('Unbilled time is aging', message);
}

function notifyNative(title, body) {
  if (!store.settings.notifyNative) return;
  // The setting promises notifications "when the app is in the background";
  // with the app focused, the in-app prompt or toast is already on screen.
  if (document.hasFocus()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: './icons/icon-192.png' });
  } catch {}
}
