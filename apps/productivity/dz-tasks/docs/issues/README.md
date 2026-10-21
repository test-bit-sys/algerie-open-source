# Feature backlog

Proposed features from a review of the app (2026-08-04), one file per
issue, ordered by priority. Each is written to be filed as-is once the
repo has a tracker:

```sh
gh issue create --title "<first heading>" --body-file docs/issues/00N-*.md
```

| # | Feature | Priority | Why it's next |
|---|---------|----------|---------------|
| [001](001-collaborative-shared-lists.md) | Collaborative shared lists | P1 | Shared lists are the flagship, but read-only; households need both sides to edit |
| [002](002-per-task-reminders.md) | Per-task reminders at due time | P1 | Due times exist but nothing fires; the only reminder is a daily summary on open |
| [003](003-cross-device-freshness.md) | Refresh on focus + conflict-safe writes | P1 | Data loads once per boot; a stale tab's whole-document write loses other devices' edits |
| [004](004-manual-reordering.md) | Manual reordering (drag & drop) | P2 | `order` exists on every task/list but no UI can change it |
| [005](005-quick-add-natural-language.md) | Quick-add with natural-language dates | P2 | Capture always costs a full modal + date picker |
| [006](006-quick-reschedule.md) | Quick reschedule (swipe / row menu) | P2 | Postponing, the second-most-common action, takes four steps |
| [007](007-offline-app-shell.md) | Service worker / offline launch | P2 | Offline data handling exists, but the shell itself can't load offline |
| [008](008-tags.md) | Tags with filtering | P3 | No cross-list organization; users fake it in titles and search |

Considered and deliberately left out for now: bulk multi-select edits,
logbook statistics/streaks, task file attachments via Puter fs, sections
within lists, and a Settings control for `defaultListId` (the setting
exists in the store but nothing writes it — worth a tiny fix-issue if
quick-add doesn't obsolete it).
