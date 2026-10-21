# Per-task reminders at the due time

Labels: enhancement, reminders
Priority: P1
Status: Implemented

## Problem

Tasks can carry a due *time* (`dueTime` in `normalizeTask`,
`src/lib/store.js`), but nothing ever fires at that time. The only
notification the app produces is a single daily summary, shown only if the
user happens to open the app that day (`src/lib/reminders.js`). A task due
at 15:00 produces no signal at 15:00 — for a to-do app aimed at personal
reminders (recurring meds, calls, pickups), this is the biggest gap between
what users expect and what the app does. Today the workaround is the .ics
feed plus a calendar app's alarms, which most users won't set up.

## Proposal

- Add an optional reminder to the task form: "At due time", "10 min /
  1 hour / 1 day before" (stored as e.g. `reminder: { offsetMin }` on the
  task, normalized in `normalizeTask`).
- While the app is open (tab or installed PWA), schedule pending
  notifications with timers; reschedule on store changes and on
  `visibilitychange`. Clicking the notification opens the task.
- On boot, show a catch-up notification for reminders missed while the app
  was closed (folds naturally into the existing daily-summary logic).
- Include a `VALARM` in `buildICS` (`src/lib/ics.js`) for tasks with a
  reminder, so calendar subscribers get the same alert.
- Be honest in Settings about the platform limit: without a push server,
  reminders fire only while the app is open. (Service-worker
  `showTrigger`/periodic sync can extend this on supporting browsers once
  issue 007 lands.)

## Acceptance criteria

- A reminder can be set, edited, and cleared from the task form, and shows
  in the task row's meta line.
- With the app open and permission granted, the notification fires within
  a minute of the chosen time and opens the task when clicked.
- Recurring tasks re-arm their reminder for the next occurrence when
  completed or skipped (rolls with `nextDue`, no extra state).
- Reminders missed while closed are summarized on next open, at most once.
- Tasks with reminders export with a `VALARM` in both the .ics download
  and the live feed.

## Out of scope

- Server-side push notifications (would require infrastructure the app
  deliberately avoids).
- Location-based reminders.
