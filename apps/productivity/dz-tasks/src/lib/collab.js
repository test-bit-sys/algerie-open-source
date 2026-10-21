/**
 * Collaborative (multi-writer) lists without a server.
 *
 * Puter storage is strictly per-account, so members cannot write into each
 * other's drives. Instead, every participant publishes a *replica* of the
 * list — its tasks plus deletion tombstones — as a public-URL file in their
 * own drive, and a *manifest* in the owner's drive names the members and
 * where their replicas live. Each participant's app fetches the others'
 * replicas and merges them with the same id/updatedAt/tombstone rules used
 * for multi-device sync (merge.js), then republishes its own replica.
 * Merges are commutative, so everyone converges without coordination.
 *
 * Membership is a two-link handshake (no inbox exists to automate it):
 *   1. The owner shares an invite link carrying the manifest URL.
 *   2. The invitee's app publishes their replica and hands back a
 *      confirmation link carrying its URL; the owner opens it to approve,
 *      which adds the member to the manifest.
 *
 * Revoking removes the member from the manifest: their edits stop flowing
 * to the group and their app converts the list back to a private copy on
 * its next sync. (Like read-only share links, data they already fetched
 * stays with them, and minted URLs live for up to a year.)
 */

export const MANIFEST_KIND = 'tasks.collab-manifest';
export const REPLICA_KIND = 'tasks.collab-replica';
export const COLLAB_VERSION = 1;

const COLLAB_DIR = 'tasks-data/collab';

/* The list id comes from a foreign manifest when joining; encode both path
   components so a crafted invite ('../../apps/x' as listId) cannot point
   the joiner's replica write outside the app's directory in their drive. */
const fsName = (s) => encodeURIComponent(String(s));
export const manifestPath = (listId) => `${COLLAB_DIR}/${fsName(listId)}.manifest.json`;
export const replicaPath = (listId, memberId) => `${COLLAB_DIR}/${fsName(listId)}.${fsName(memberId)}.replica.json`;

function cleanMember(m) {
  if (!m || !m.id || !m.replicaUrl) return null;
  return {
    id: String(m.id).slice(0, 80),
    name: String(m.name || m.id).slice(0, 80),
    replicaUrl: String(m.replicaUrl),
    addedAt: Number(m.addedAt) || 0,
  };
}

export function buildManifest(list, owner, members, { updatedAt = Date.now() } = {}) {
  return {
    kind: MANIFEST_KIND,
    v: COLLAB_VERSION,
    listId: list.id,
    name: list.name,
    icon: list.icon,
    slot: list.slot,
    owner,
    members,
    updatedAt,
  };
}

export function parseManifest(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.kind !== MANIFEST_KIND) throw new Error('Not a shared-list invite');
  if (Number(data.v) > COLLAB_VERSION) throw new Error('This invite needs a newer app version');
  const owner = cleanMember(data.owner);
  if (!data.listId || !owner) throw new Error('Malformed invite');
  return {
    listId: String(data.listId),
    name: String(data.name || 'Shared list').slice(0, 80),
    icon: String(data.icon || 'list'),
    // Clamp to the real slot range: this styles var(--slot-N) lookups.
    slot: Math.min(8, Math.max(1, Math.floor(Number(data.slot)) || 1)),
    owner,
    members: (Array.isArray(data.members) ? data.members : []).map(cleanMember).filter(Boolean),
    updatedAt: Number(data.updatedAt) || 0,
  };
}

/** Everyone who publishes a replica: the owner plus approved members. */
export function participantsOf(manifest) {
  const seen = new Set();
  return [manifest.owner, ...manifest.members].filter((m) => {
    if (!m || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

export function buildReplica(list, tasks, deleted, member, { updatedAt = Date.now() } = {}) {
  return {
    kind: REPLICA_KIND,
    v: COLLAB_VERSION,
    listId: list.id,
    member: { id: member.id, name: member.name },
    updatedAt,
    tasks,
    deleted,
  };
}

export function parseReplica(json, listId) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.kind !== REPLICA_KIND) throw new Error('Not a list replica');
  if (Number(data.v) > COLLAB_VERSION) throw new Error('Replica needs a newer app version');
  if (listId && data.listId !== listId) throw new Error('Replica is for a different list');
  return {
    listId: String(data.listId),
    member: data.member || null,
    updatedAt: Number(data.updatedAt) || 0,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    deleted: Array.isArray(data.deleted) ? data.deleted : [],
  };
}

/* ---------- links ---------- */

const appUrl = () => location.origin + location.pathname;

export function inviteLink(manifestUrl) {
  return `${appUrl()}#/join?m=${encodeURIComponent(manifestUrl)}`;
}

export function confirmLink(payload) {
  return `${appUrl()}#/approve?d=${encodeURIComponent(JSON.stringify(payload))}`;
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    // blob: covers the dev mock; real URLs are always https.
    return ['https:', 'http:', 'blob:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseJoinHash(hash) {
  const q = (hash || '').split('?')[1];
  const m = q ? new URLSearchParams(q).get('m') : null;
  return m ? safeUrl(m) : null;
}

export function parseConfirmHash(hash) {
  const q = (hash || '').split('?')[1];
  const d = q ? new URLSearchParams(q).get('d') : null;
  if (!d) return null;
  try {
    const data = JSON.parse(d);
    const member = cleanMember(data.member);
    if (!data.listId || !member || !safeUrl(member.replicaUrl)) return null;
    return { listId: String(data.listId), member };
  } catch {
    return null;
  }
}
