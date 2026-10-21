# Manual reordering of tasks and lists (drag and drop)

Labels: enhancement, ui
Priority: P2
Status: Implemented

## Problem

Every task and list already carries an `order` field
(`normalizeTask`/`normalizeList`, `src/lib/store.js`) and `compareTasks`
uses it as the final tiebreaker — but no UI ever changes it. Tasks are
locked into due-date/priority order and new tasks always sink to the
bottom of their tier; lists are frozen in creation order in the sidebar
and on the Lists page. "Drag the important thing to the top" is a baseline
expectation in every mainstream to-do app, and the data model is already
prepared for it.

## Proposal

- **Tasks:** pointer-based drag-and-drop within the open-tasks card in
  list detail view (`listDetailView`, `src/views/lists.js`), writing new
  `order` values on drop. In that view, manual order becomes the primary
  sort; smart views (Today/Upcoming) keep their date-first grouping and
  use manual order within a group.
- **Lists:** the same interaction in the Lists grid and the sidebar.
- **Accessibility:** drag handles must not be the only path — add
  "Move up / Move down" to a small row overflow menu, keyboard-reachable,
  since the checkbox/row are already proper buttons.
- Use scattered `order` values (e.g. midpoints) so a drop writes only the
  moved item, not the whole set.
- No new dependency: pointer events + the existing `el()` helpers are
  sufficient at this app's size.

## Acceptance criteria

- Dragging a task within its list persists across reload and across
  devices (order survives `normalizeTask` round-trips — it already does).
- Dragging works with touch on mobile widths (long-press to lift, page
  doesn't scroll-fight) and with a mouse on desktop.
- Reordering is possible with keyboard alone and is announced to screen
  readers.
- Sidebar list order matches Lists-page order everywhere, including the
  task form's list dropdown.
- Shared-list snapshots and the .ics feed reflect the new order.

## Out of scope

- Dragging tasks between lists (moving lists is already in the edit form).
- Custom sort menus (by title, by created date) — separate, smaller issue
  if requested.
