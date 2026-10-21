/**
 * The people on a deal.
 *
 * A deal used to link exactly one contact, and real B2B deals - even at
 * founder scale - involve two to four: the champion who replies, the
 * person who signs, the one who can quietly veto. The second and third
 * lived in the notes, so their calls never counted toward the deal's
 * history and "have I ever spoken to the person who signs?" had no answer.
 *
 * A deal now carries `contacts: [{ contactId, role }]`, and `contactId`
 * stays as the primary - always the first entry - so CSV, dupe-merge, and
 * the trash restore path keep working on it unchanged.
 *
 * Pure functions over plain objects: no Puter, no DOM.
 */

/**
 * The roles a deal's people can hold. A fixed short list on purpose -
 * tags already cover ad-hoc labels, and a role only earns its place if
 * every deal can be read against the same handful.
 */
export const DEAL_ROLES = [
  { value: 'champion', label: 'Champion', hint: 'Pushing this internally' },
  { value: 'decision-maker', label: 'Decision maker', hint: 'Signs it off' },
  { value: 'influencer', label: 'Influencer', hint: 'Has a say' },
  { value: 'blocker', label: 'Blocker', hint: 'Can stop it' },
  { value: 'other', label: 'Other' },
];

const ROLE_IDS = new Set(DEAL_ROLES.map((r) => r.value));

/** The role that answers "who signs?" - the one the dashboard chases. */
export const DECIDER_ROLE = 'decision-maker';

/** More people than this on one founder-scale deal is a committee, not a deal. */
export const MAX_DEAL_CONTACTS = 8;

/** A well-formed role, or '' for "no role given". */
export function normalizeRole(value) {
  return ROLE_IDS.has(value) ? value : '';
}

export function roleLabel(role) {
  return DEAL_ROLES.find((r) => r.value === role)?.label || '';
}

/**
 * A deal's contact list: `[{ contactId, role }]`, deduped, primary first,
 * capped. Accepts bare id strings too, so a hand-written export or an
 * older record reads fine.
 *
 * `primaryId` (the deal's own `contactId`) is pulled to the front, and
 * added when the list doesn't mention it - that is the migration for every
 * deal written before this existed, and it keeps the two fields agreeing.
 */
export function normalizeDealContacts(raw, primaryId = null) {
  const out = [];
  const seen = new Set();
  const push = (contactId, role) => {
    if (typeof contactId !== 'string' || !contactId || seen.has(contactId)) return;
    seen.add(contactId);
    out.push({ contactId, role: normalizeRole(role) });
  };
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (typeof entry === 'string') push(entry, '');
    else if (entry && typeof entry === 'object') push(entry.contactId, entry.role);
  }
  const primary = typeof primaryId === 'string' && primaryId ? primaryId : null;
  if (primary) {
    const at = out.findIndex((e) => e.contactId === primary);
    if (at > 0) out.unshift(...out.splice(at, 1));
    else if (at < 0) out.unshift({ contactId: primary, role: '' });
  }
  return out.slice(0, MAX_DEAL_CONTACTS);
}

/** Every contact id on a deal, primary first. */
export function dealContactIds(deal) {
  return (Array.isArray(deal?.contacts) ? deal.contacts : [])
    .map((e) => e?.contactId)
    .filter(Boolean);
}

/** The role a given contact holds on a deal ('' when none was given). */
export function roleOf(deal, contactId) {
  const entry = (Array.isArray(deal?.contacts) ? deal.contacts : [])
    .find((e) => e?.contactId === contactId);
  return normalizeRole(entry?.role);
}

/** Is anyone on this deal named as the person who signs? */
export function hasDecisionMaker(deal) {
  return (Array.isArray(deal?.contacts) ? deal.contacts : [])
    .some((e) => normalizeRole(e?.role) === DECIDER_ROLE);
}

/**
 * The list with `contactId` as its primary. A null id detaches the current
 * primary and leaves the others; a contact already further down the list
 * keeps the role it was given.
 */
export function replacePrimary(list, contactId) {
  const entries = Array.isArray(list) ? list : [];
  const rest = entries.slice(1).filter((e) => e?.contactId !== contactId);
  if (!contactId) return rest;
  const existing = entries.find((e) => e?.contactId === contactId);
  return [{ contactId, role: normalizeRole(existing?.role) }, ...rest];
}

/** The list without a contact - what deleting that contact leaves behind. */
export function withoutContact(list, contactId) {
  return (Array.isArray(list) ? list : []).filter((e) => e?.contactId !== contactId);
}

/**
 * The list with `fromId` re-pointed at `toId` - a duplicate contact merged
 * into its survivor. The survivor keeps whichever role it already had; two
 * entries collapsing into one must not leave the same person on the deal
 * twice.
 */
export function repointContact(list, fromId, toId) {
  const entries = Array.isArray(list) ? list : [];
  if (!entries.some((e) => e?.contactId === fromId)) return entries;
  const survivorRole = entries.find((e) => e?.contactId === toId)?.role;
  const mergedRole = entries.find((e) => e?.contactId === fromId)?.role;
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const id = entry?.contactId === fromId ? toId : entry?.contactId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      contactId: id,
      role: id === toId ? normalizeRole(survivorRole || mergedRole) : normalizeRole(entry.role),
    });
  }
  return out;
}

/** Add a contact to a deal's list (no-op when already there or at the cap). */
export function withContact(list, contactId, role = '') {
  const entries = Array.isArray(list) ? list : [];
  if (!contactId || entries.some((e) => e?.contactId === contactId)) return entries;
  if (entries.length >= MAX_DEAL_CONTACTS) return entries;
  return [...entries, { contactId, role: normalizeRole(role) }];
}
