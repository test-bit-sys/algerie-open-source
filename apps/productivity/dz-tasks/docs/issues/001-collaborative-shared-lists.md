# Collaborative shared lists (invite people to edit, not just view)

Labels: enhancement, sharing, epic
Priority: P1
Status: Implemented

## Problem

Sharing is the app's flagship feature, but a shared list is strictly
read-only: the owner publishes a snapshot (`src/lib/share.js`,
`Store#writeShareFile` in `src/lib/store.js`) and viewers get a live copy
they cannot touch. The most common real-world use of a shared to-do list —
a household groceries list, a couple planning a trip, two people splitting
chores — needs both sides to add and check off items. Today the non-owner
has to message the owner to change anything, which defeats the purpose.

The README already names this as the known limitation: "True multi-writer
lists would need per-member op-logs or a worker."

## Proposal

Add an "Invite to edit" option to the share sheet alongside the existing
view-only link. Two viable architectures, in order of preference:

1. **Per-member op-logs (no server).** Each member appends operations
   (add/complete/edit/delete, with task id + `updatedAt`) to a log file in
   *their own* Puter drive and shares its read URL with the group. Every
   member's app merges all logs on load and on focus. Last-writer-wins per
   task field, ids generated with `uid()` so adds never collide. The owner
   remains the source of truth for the list's metadata.
2. **A Puter worker** owning the list document, accepting authenticated
   writes from members. Simpler merge story, but introduces the app's
   first server-side component and an availability dependency.

Membership flow: the invite link carries the owner's list id plus where to
publish the invitee's op-log; accepting adds the list to the invitee's
Lists view marked "Shared with you".

## Acceptance criteria

- Owner can generate an edit invite from the share sheet; existing
  view-only links keep working unchanged.
- An invited member sees the list among their own lists and can add,
  complete, edit, and delete tasks in it.
- Changes from any member reach the others without manual export/import
  (on next load/focus is acceptable; live push is not required).
- Concurrent edits to *different* tasks never lose data; concurrent edits
  to the *same* task resolve deterministically (latest `updatedAt` wins).
- Owner can revoke a member; revoked members lose access on next sync.
- Offline edits by a member are queued and merged when back online,
  consistent with the app's existing offline-mirror behavior.

## Out of scope

- Per-task assignees and comments (worth separate issues once this lands).
- Real-time presence/cursors.
