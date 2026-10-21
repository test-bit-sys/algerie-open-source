/**
 * Tags: flat, free-form labels on contacts, companies, and deals - the
 * segmentation no fixed field anticipates ("YC W26", "champion",
 * "met-at-conference"). Case is preserved as typed but never duplicated:
 * comparisons, dedupe, and filtering all fold case, so "VIP" and "vip"
 * are one tag wearing whichever spelling came first.
 *
 * Kept apart from the store - like statuses.js - so the CSV layer can
 * split a tags cell without importing the data layer it feeds.
 */

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_RECORD = 20;

/** One tag as stored: trimmed, single-spaced, bounded. */
export function cleanTag(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
}

/** First spelling wins; later case-variants of the same tag are dropped. */
export function dedupeTags(list) {
  const seen = new Set();
  const out = [];
  for (const tag of list) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** A record's tags array, whatever shape an import handed us. */
export function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  return dedupeTags(raw.map(cleanTag).filter(Boolean)).slice(0, MAX_TAGS_PER_RECORD);
}

/** A CSV cell ("vip, expansion; champion") as a tags array. */
export function splitTags(text) {
  return normalizeTags(String(text ?? '').split(/[,;]/));
}

/** Case-insensitive membership test. */
export function hasTag(tags, name) {
  const key = String(name || '').toLowerCase();
  return Array.isArray(tags) && tags.some((t) => t.toLowerCase() === key);
}
