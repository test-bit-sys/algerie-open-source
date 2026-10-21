/**
 * Activity-log logic: labels, filtering, and day grouping for the
 * history view. Pure — no DOM, no Puter; unit-tested.
 *
 * Entries look like { id, at, kind, productId, name, delta, quantity, note }
 * and are kept newest-first everywhere.
 */

import { formatQtyIn, unitLabel, isCountUnit } from './units.js';
import { UNASSIGNED_LABEL } from './stock.js';

/** Every kind the log can hold, in the order the filter offers them. */
export const ACTIVITY_KINDS = [
  { key: 'add', label: 'Received', icon: 'packagePlus' },
  { key: 'remove', label: 'Removed', icon: 'packageMinus' },
  { key: 'recount', label: 'Recounted', icon: 'clipboard' },
  { key: 'move', label: 'Moved', icon: 'move' },
  { key: 'create', label: 'Created', icon: 'plus' },
  { key: 'archive', label: 'Archived', icon: 'archive' },
  { key: 'restore', label: 'Restored', icon: 'archiveRestore' },
  { key: 'delete', label: 'Deleted', icon: 'trash' },
  { key: 'import', label: 'Import', icon: 'fileUp' },
  { key: 'order', label: 'Ordered', icon: 'cart' },
  { key: 'bulk', label: 'Bulk edit', icon: 'listChecks' },
];

const KIND = new Map(ACTIVITY_KINDS.map((k) => [k.key, k]));

export const kindLabel = (kind) => KIND.get(kind)?.label || 'Activity';
export const kindIcon = (kind) => KIND.get(kind)?.icon || 'history';

/**
 * Why stock was removed, in the order the form offers them. 'sold' is
 * the default — the fast path stays one tap — and the reason lives on
 * the 'remove' entry so shrinkage and demand reports can tell a sale
 * from a write-off. Entries from before reasons existed carry none.
 */
export const REMOVAL_REASONS = [
  { key: 'sold', label: 'Sold' },
  { key: 'damaged', label: 'Damaged' },
  { key: 'expired', label: 'Expired' },
  { key: 'internal', label: 'Internal use' },
  { key: 'lost', label: 'Lost' },
  { key: 'other', label: 'Other' },
];

const REASON = new Map(REMOVAL_REASONS.map((r) => [r.key, r]));

export const reasonLabel = (key) => REASON.get(key)?.label || '';
export const isRemovalReason = (key) => REASON.has(key);

/**
 * The verb a removal reads as: "Sold at Storefront…" says more than
 * "Removed" ever did. 'other' and reason-less entries stay "Removed".
 */
function removalVerb(reason) {
  switch (reason) {
    case 'sold': return 'Sold';
    case 'damaged': return 'Damaged';
    case 'expired': return 'Expired';
    case 'internal': return 'Used internally';
    case 'lost': return 'Lost';
    default: return 'Removed';
  }
}

/**
 * One-line description of what an entry did. Entries carry the unit
 * they were recorded in, so history stays readable even after a product
 * is renamed, re-measured, or deleted.
 *
 * Archiving, restoring, and deleting a selection write one entry for the
 * whole group, named "3 products archived" and pointing at no single
 * product. Those read as the group action they were — the sub-line
 * under "3 products archived" said "Product archived", contradicting
 * the very row it was describing — the same way a bulk edit already
 * reads "Edited together".
 */
export function activityLabel(a) {
  const qty = `${formatQtyIn(a.quantity, a.unit)} ${unitLabel(a.unit, a.quantity)}`;
  // Entries older than per-location stock, and ones in the unassigned
  // bucket, simply don't name a place.
  const at = a.locationName && a.locationName !== UNASSIGNED_LABEL ? ` at ${a.locationName}` : '';
  const group = !a.productId;
  switch (a.kind) {
    case 'add': return `Received${at}, now ${qty} on hand`;
    case 'remove': return `${removalVerb(a.reason)}${at}, now ${qty} on hand`;
    case 'recount': return `Recounted${at} to ${qty}`;
    case 'move': return `Moved ${formatQtyIn(a.moved, a.unit)} ${unitLabel(a.unit, a.moved)} from ${a.locationName} to ${a.toLocationName}`;
    case 'create': return 'Product added';
    case 'archive': return group ? 'Archived together' : 'Product archived';
    case 'restore': return group ? 'Restored together' : 'Product restored';
    case 'delete': return group ? 'Deleted together' : 'Product deleted';
    case 'import': return 'CSV import';
    case 'order': return 'Order placed';
    case 'bulk': return 'Edited together';
    default: return kindLabel(a.kind);
  }
}

/** Local YYYY-MM, the bucket key for archived months. */
export function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Local YYYY-MM-DD, the grouping key for a day. */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "August 2026" for a YYYY-MM bucket key. */
export function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return String(month);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Start of the local day a YYYY-MM-DD string names, or null. */
export function dayStart(value) {
  const [y, m, d] = String(value || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

/** End of the local day a YYYY-MM-DD string names (inclusive), or null. */
export function dayEnd(value) {
  const [y, m, d] = String(value || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  // The moment before the next day starts — not start + 24h, which is an
  // hour off on the two days a year that DST makes 23 or 25 hours long.
  return new Date(y, m - 1, d + 1).getTime() - 1;
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Filter by free text (product name or note), kind, product, removal
 * reason, and an inclusive local date range. Empty filters pass
 * everything. A reason filter implies removals; 'unspecified' matches
 * removals from before reasons existed.
 */
export function filterActivity(entries, { query = '', kind = '', productId = '', reason = '', from = '', to = '' } = {}) {
  const q = norm(query.trim());
  const after = dayStart(from);
  const before = dayEnd(to);
  return entries.filter((a) => {
    if (kind && a.kind !== kind) return false;
    if (reason) {
      if (a.kind !== 'remove') return false;
      if (reason === 'unspecified' ? a.reason : (a.reason || '') !== reason) return false;
    }
    if (productId && a.productId !== productId) return false;
    if (after !== null && a.at < after) return false;
    if (before !== null && a.at > before) return false;
    if (q && !(norm(a.name).includes(q) || norm(a.note).includes(q))) return false;
    return true;
  });
}

/**
 * Group newest-first entries into days, keeping that order within each
 * day. `in`/`out`/`net` total the day's movement for the header — over
 * counted units only, since kilograms and pieces don't add up.
 */
export function groupByDay(entries) {
  const days = new Map();
  for (const a of entries) {
    const key = dayKey(a.at);
    let day = days.get(key);
    if (!day) {
      day = { key, at: a.at, entries: [], net: 0, in: 0, out: 0 };
      days.set(key, day);
    }
    day.entries.push(a);
    if (!isCountUnit(a.unit)) continue;
    const delta = Number(a.delta) || 0;
    day.net = round3(day.net + delta);
    if (delta > 0) day.in = round3(day.in + delta);
    else day.out = round3(day.out - delta);
  }
  return [...days.values()];
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/** "Today", "Yesterday", or "Tuesday, August 4, 2026". */
export function dayLabel(ts, now = Date.now()) {
  const today = dayKey(now);
  const key = dayKey(ts);
  if (key === today) return 'Today';
  // The previous calendar day — not now − 24h, which in the first hour
  // after a 23-hour DST day lands two days back and yesterday's entries
  // lose their label.
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday.getTime())) return 'Yesterday';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

/** Merge live and archived entries, newest first, without duplicates. */
export function mergeEntries(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const a of list || []) {
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}
