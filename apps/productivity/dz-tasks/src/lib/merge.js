/**
 * Conflict-safe merging for multi-device (and multi-member) sync.
 *
 * Documents are whole-KV-value writes, so two devices editing concurrently
 * would clobber each other. Instead of replacing state with whatever was
 * fetched, records merge by id: the newer `updatedAt` wins per record, and
 * deletions carry tombstones ({ id, at }) so a merge can tell "deleted
 * elsewhere" apart from "added here". A record edited after its deletion
 * outlives the tombstone.
 *
 * Merges are commutative and idempotent, and their output is canonically
 * ordered (by id), so two devices that have seen the same writes converge
 * to byte-identical documents and stop writing.
 */

/** Envelope around each cloud document: { v: 2, rev, epoch, at, device, data }. */
export function unwrapDoc(raw) {
  if (raw && typeof raw === 'object' && raw.v === 2 && 'data' in raw) {
    return {
      v: 2,
      rev: Number(raw.rev) || 0,
      epoch: raw.epoch ? String(raw.epoch) : null,
      // When the dataset was minted (import/wipe), as opposed to `at`,
      // when this document was last written. Older envelopes lack it.
      epochAt: Number(raw.epochAt) || 0,
      at: Number(raw.at) || 0,
      device: raw.device ? String(raw.device) : null,
      data: raw.data ?? null,
    };
  }
  // Legacy documents (pre-envelope) are the bare payload.
  return { v: 1, rev: 0, epoch: null, epochAt: 0, at: 0, device: null, data: raw ?? null };
}

/** Cheap identity of a fetched envelope, to skip no-op merges. */
export function sigOf(env) {
  return `${env.rev}:${env.device || ''}:${env.at || 0}`;
}

export function normalizeTombstones(list) {
  return (Array.isArray(list) ? list : [])
    .filter((d) => d && d.id)
    .map((d) => {
      const t = { id: String(d.id), at: Number(d.at) || 0 };
      // Task tombstones carry the list they belonged to, so collab replicas
      // can ship only their own list's deletions (legacy ones have none).
      if (d.listId) t.listId = String(d.listId);
      return t;
    });
}

/** The record that survives a same-id conflict. Ties break deterministically. */
function newer(a, b) {
  const au = a.updatedAt || 0;
  const bu = b.updatedAt || 0;
  if (au !== bu) return au > bu ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

const byIdAsc = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Merge two sets of records (tasks or lists) plus their tombstones.
 * Records must carry `id` and `updatedAt`. Returns canonical (id-sorted)
 * `records` and surviving `deleted` tombstones; tombstones whose fire date
 * is before `pruneBefore` are dropped (their echo window has passed).
 */
export function mergeRecords(localRecs, remoteRecs, localDel, remoteDel, { pruneBefore = 0 } = {}) {
  const del = new Map();
  for (const d of [...normalizeTombstones(localDel), ...normalizeTombstones(remoteDel)]) {
    const prev = del.get(d.id);
    // Same fire time: prefer the listId-stamped copy so devices holding a
    // stamped and an unstamped version of one tombstone still converge.
    if (!prev || d.at > prev.at || (d.at === prev.at && d.listId && !prev.listId)) del.set(d.id, d);
  }

  const winners = new Map();
  for (const rec of [...(localRecs || []), ...(remoteRecs || [])]) {
    if (!rec || !rec.id) continue;
    const cur = winners.get(rec.id);
    winners.set(rec.id, cur ? newer(cur, rec) : rec);
  }

  const records = [];
  for (const rec of winners.values()) {
    const d = del.get(rec.id);
    if (d && d.at >= (rec.updatedAt || 0)) continue; // deletion wins
    if (d) del.delete(rec.id); // edited after deletion → the record lives
    records.push(rec);
  }

  return {
    records: records.sort(byIdAsc),
    deleted: [...del.values()].filter((d) => d.at >= pruneBefore).sort(byIdAsc),
  };
}

/** Union of archived-month keys, sorted. Keys become fs paths — strict shape only. */
export function mergeMonths(a, b) {
  return [...new Set([...(a || []), ...(b || [])])]
    .filter((k) => /^\d{4}-\d{2}$/.test(String(k))).sort();
}

/** Canonical deep equality for merge outputs (already id-sorted). */
export function sameData(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
