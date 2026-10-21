/**
 * Duplicate detection for contacts and companies.
 *
 * A duplicate contact splits deals, activities, and follow-ups across two
 * half-histories, quietly corrupting last-contacted, going-cold, and the
 * per-record timeline. Matching is exact-after-normalization - case,
 * whitespace, accents, phone punctuation, protocol/www on domains - no
 * fuzzy scoring engine. Pure functions over plain records.
 */

import { normalizeText } from './util.js';

/** "  Dana  FOX " and "dana fox" are the same name. */
export const normName = (s) => normalizeText(s).replace(/\s+/g, ' ').trim();

export const normEmail = (s) => String(s || '').trim().toLowerCase();

/**
 * Digits only; anything shorter than 7 is too little signal to pair on
 * (extensions, "911", a lone country code).
 */
export function normPhone(s) {
  const digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : '';
}

/** "https://www.Acme.com/about" and "acme.com" are the same domain. */
export function normDomain(s) {
  const raw = String(s || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .trim();
}

/** Pairs beyond this stop being a review and start being an import redo. */
const MAX_PAIRS = 50;

/**
 * Group records by key and pair each member of a group with the group's
 * oldest record - the one a merge naturally keeps - collecting the reasons
 * a given pair matched, since one pair can match by email and phone at once.
 *
 * Anchoring on the oldest rather than crossing every member with every
 * other loses nothing: merging B and C into A settles B against C too, so
 * the cross pairs were rows the review could never act on. It also keeps
 * the scan linear in the size of a group. Crossing them was quadratic, and
 * this runs on every render of the leads list: one botched import landing
 * three hundred rows called "Sales Team" built forty-five thousand pairs
 * to throw all but fifty of them away, every time.
 */
function collectPairs(records, keyers, out) {
  for (const [reason, keyOf] of keyers) {
    const groups = new Map();
    for (const r of records) {
      const key = keyOf(r);
      if (!key) continue;
      const group = groups.get(key);
      if (group) group.push(r);
      else groups.set(key, [r]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const oldest = group.reduce((best, r) =>
        ((r.createdAt || 0) < (best.createdAt || 0) ? r : best));
      for (const r of group) {
        if (r === oldest) continue;
        const pairKey = [oldest.id, r.id].sort().join(':');
        const hit = out.get(pairKey) || { a: oldest, b: r, reasons: [] };
        if (!hit.reasons.includes(reason)) hit.reasons.push(reason);
        out.set(pairKey, hit);
      }
    }
  }
}

/**
 * Possible duplicate contacts: identical email, normalized name, or phone.
 *   [{ a, b, reasons: ['email' | 'name' | 'phone', ...] }]
 * `a` is always the older record (the natural survivor).
 */
export function contactDuplicates(contacts) {
  const out = new Map();
  collectPairs(contacts, [
    ['email', (c) => normEmail(c.email)],
    ['name', (c) => normName(c.name)],
    ['phone', (c) => normPhone(c.phone)],
  ], out);
  return finishPairs(out);
}

/** Possible duplicate companies: normalized name or website domain. */
export function companyDuplicates(companies) {
  const out = new Map();
  collectPairs(companies, [
    ['name', (c) => normName(c.name)],
    ['domain', (c) => normDomain(c.website)],
  ], out);
  return finishPairs(out);
}

function finishPairs(out) {
  return [...out.values()]
    .map(({ a, b, reasons }) => ((a.createdAt || 0) <= (b.createdAt || 0)
      ? { a, b, reasons } : { a: b, b: a, reasons }))
    .sort((x, y) => (x.a.createdAt || 0) - (y.a.createdAt || 0))
    .slice(0, MAX_PAIRS);
}

/**
 * The contact a typed email already belongs to, for the new-lead form's
 * "Looks like Dana Fox - open instead?" hint. `excludeId` keeps an edit
 * form from flagging the very record being edited.
 */
export function contactByEmail(contacts, email, excludeId = null) {
  const key = normEmail(email);
  if (!key || !key.includes('@')) return null;
  return contacts.find((c) => c.id !== excludeId && normEmail(c.email) === key) || null;
}
