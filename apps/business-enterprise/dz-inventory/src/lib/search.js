/**
 * Quick-search matching for the command palette: plain substring
 * matching with sensible ranking — prefix beats word-start beats
 * substring — over accent- and case-folded text. No fuzzy-search
 * machinery; a shop's product names don't need it.
 *
 * Pure; unit-tested.
 */

const fold = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * How well `hay` matches `query`: 3 prefix, 2 word-start, 1 substring,
 * 0 miss. Both sides are folded.
 */
export function rankMatch(hay, query) {
  const h = fold(hay);
  const q = fold(query).trim();
  if (!q || !h) return 0;
  const at = h.indexOf(q);
  if (at === -1) return 0;
  if (at === 0) return 3;
  if (/[\s\-_./(]/.test(h[at - 1])) return 2;
  return 1;
}

/** The best rank across several fields, each weighted the same. */
export function rankFields(fields, query) {
  let best = 0;
  for (const f of fields) {
    const r = rankMatch(f, query);
    if (r > best) best = r;
  }
  return best;
}

/**
 * Rank a list by `fields(item)`, best first, stable within equal ranks
 * (input order is the caller's tiebreak), capped at `limit`.
 */
export function searchRank(items, query, fields, { limit = 8 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  return items
    .map((item, i) => ({ item, i, rank: rankFields(fields(item), q) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => (b.rank - a.rank) || (a.i - b.i))
    .slice(0, limit)
    .map((x) => x.item);
}
