# Quick reschedule: swipe / row menu to postpone without opening the form

Labels: enhancement, ui, mobile
Priority: P2
Status: Implemented

## Problem

Rescheduling is the second-most-common task action after completing, and
overdue tasks are the app's own headline section (Today view opens with
them). But moving a task to tomorrow currently takes four steps: open the
edit modal, open the date picker, pick a day, save. There is no row-level
affordance at all — `taskRow` (`src/ui/taskrow.js`) offers only
complete/reopen and open-the-form. Users with a pile of overdue tasks
churn through this modal repeatedly, which is exactly when the app feels
slowest.

## Proposal

- **Mobile:** swipe a task row left to reveal quick actions —
  "Tomorrow", "Weekend", "Next week", "Pick date…". Swipe right toggles
  complete (mirrors the checkbox for one-thumb use).
- **Desktop:** the same actions in a small overflow menu on row hover
  (this menu also hosts "Move up/down" from issue 004, so rows grow one
  menu, not two).
- The quick-date options reuse the shortcuts already defined in the task
  form's quick row (`renderQuick`, `src/ui/taskform.js`).
- **Today view:** a one-tap "Move all overdue to today" action on the
  Overdue section header, with an Undo toast (the toast/undo pattern
  already exists for complete and delete).
- Postponing a recurring task calls the existing `skipOccurrence` /
  due-shift semantics rather than editing the rule.

## Acceptance criteria

- A dated task can be moved to tomorrow in one gesture on mobile and two
  clicks on desktop, with an Undo toast.
- Swipe actions don't fire on accidental scrolls (threshold + axis lock)
  and don't appear in the read-only shared viewer.
- All quick actions are reachable by keyboard and labelled for screen
  readers.
- "Move all overdue to today" updates every overdue task in one store
  write and one re-render.

## Out of scope

- Snooze-by-time-of-day (tonight/this evening) — needs per-task reminder
  times from issue 002 to mean anything.
