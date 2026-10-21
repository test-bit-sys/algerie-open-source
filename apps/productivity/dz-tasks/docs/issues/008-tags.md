# Tags: cross-list labels with filtering

Labels: enhancement, organization
Priority: P3
Status: Implemented

## Problem

Lists are the only organizational axis, and a task lives in exactly one.
Anything that cuts across lists — `@errands` across Personal and Work,
`waiting-on`, `15min` fillers — has no home. Users coming from Todoist,
TickTick, or Things expect labels for this, and the current workarounds
(duplicating tasks, encoding markers in titles or notes and relying on
search) fight the data model. Search (`openSearch` in `src/ui/shell.js`)
already matches notes, which is how power users will fake tags until this
exists.

## Proposal

- `tags: []` on the task model (`normalizeTask`, `src/lib/store.js`):
  lowercase, trimmed, deduped, capped (e.g. 5 tags × 24 chars) in keeping
  with the model's existing defensive normalization.
- Task form: a tag input with autocomplete over tags already in use (the
  set is derivable from tasks; no separate KV document needed).
- Task rows render tags as small chips in the existing meta line; tapping
  a chip opens a filtered view (`#/tag/<name>`) listing open tasks with
  that tag across all lists, grouped like Upcoming.
- Search treats `#name` as a tag filter; quick-add (issue 005) reuses the
  same syntax.
- Tags ride along in share payloads and list exports (they're on the task
  objects already; `publicTask` in `src/lib/share.js` decides visibility —
  include them, they're content, not metadata).

## Acceptance criteria

- Tags can be added and removed in the task form and survive
  normalization round-trips, export/import, and recurrence roll-forward.
- Tapping a tag chip anywhere shows every open task with that tag, with
  list labels shown (`showList` mode already exists in `taskRow`).
- Autocomplete never offers duplicates and handles case-insensitivity
  ("Errands" and "errands" are one tag).
- A tag with no remaining tasks simply disappears from autocomplete — no
  orphan management UI needed.

## Out of scope

- Tag colors/icons, tag renaming across all tasks, and saved filter
  combinations — all fine as later follow-ups.
