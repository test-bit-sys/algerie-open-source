# Refresh from cloud on focus + conflict-safe writes across devices

Labels: enhancement, data-integrity, sync
Priority: P1
Status: Implemented

## Problem

The store reads the three KV documents exactly once, at boot
(`Store.init`, `src/lib/store.js`), and every save rewrites a whole
document. Using the app on a phone and a desktop — the normal pattern for
a tasks app — has two consequences:

1. **Staleness:** a task added on the phone never appears in an
   already-open desktop tab until a manual reload.
2. **Silent data loss:** the stale desktop tab's next save overwrites the
   entire `tasks:items:v1` document, discarding the phone's changes.
   Worse, the offline flush (`#flushDirty`) and the mirror-restore path
   can push an old localStorage copy over newer cloud data.

Nothing in the codebase listens to `visibilitychange` or polls; there is
no revision tracking beyond per-task `updatedAt`.

## Proposal

- Re-fetch the KV documents on `visibilitychange`/`focus` (and optionally
  a slow poll while visible), then **merge by task id** instead of
  replacing state: newer `updatedAt` wins per task; lists merge the same
  way. Show a subtle toast when remote changes arrive.
- Stamp each document with a monotonically increasing `rev` and the
  writing device id. Before any full-document write, if the cloud `rev` is
  ahead of the one last read, fetch-and-merge first, then write.
- Apply the same guard to `#flushDirty` and the boot-time mirror restore,
  so an offline device coming back never clobbers newer cloud edits.
- Deletions need a small tombstone list (id + time, pruned after
  `ARCHIVE_DAYS`) so a merge doesn't resurrect a task deleted elsewhere.

## Acceptance criteria

- Add a task on device A; an open tab on device B shows it after the tab
  next gains focus, without a reload.
- Edit different tasks on two devices while both are open: both edits
  survive on both devices.
- A device that was offline for a day merges its queued changes into
  current cloud data instead of replacing it; a task completed elsewhere
  stays completed, a task deleted elsewhere stays deleted.
- No extra KV reads while the tab stays hidden (respects the existing
  "small, hot" storage-cost design).

## Out of scope

- Real-time push between devices (no server; focus/poll is enough).
- Multi-user merging (issue 001 builds on the same merge primitives).
