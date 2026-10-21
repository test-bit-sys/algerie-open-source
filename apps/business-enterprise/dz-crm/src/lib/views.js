/**
 * Saved views: the three or four filter combinations a founder actually
 * works from.
 *
 * Leads, Companies, and the deals list all have real filter machinery -
 * text search, status chips, tags, going cold, stage, close-date window,
 * sort - and none of it survived leaving the page. So "cold leads in SaaS"
 * or "deals closing this month" got rebuilt by hand every time, which
 * mostly means they didn't get used.
 *
 * A view is a *filter set*, not a snapshot: it names conditions and
 * re-evaluates on every visit, so a lead that goes quiet tomorrow shows up
 * in "going cold" tomorrow. A condition that no longer exists - a deleted
 * tag, a removed stage, a custom field that was dropped - is ignored
 * rather than quietly emptying the list, and `applyFilters` reports what it
 * had to drop so the UI can say so.
 *
 * Pure functions over plain objects; definitions live in `crm:settings:v1`.
 */

import { uid } from './util.js';

/** The lists that can carry views, with the words the UI uses for them. */
export const VIEW_KINDS = [
  { key: 'contacts', label: 'Leads', hash: '#/leads' },
  { key: 'companies', label: 'Companies', hash: '#/companies' },
  { key: 'deals', label: 'Deals', hash: '#/pipeline' },
];

const KEYS = VIEW_KINDS.map((k) => k.key);

/** A handful per list: a row of chips, not a second navigation. */
export const MAX_VIEWS = 6;
export const MAX_VIEW_NAME = 40;

/**
 * The sort the deals list opens on. Exported so the list and the
 * "is this filtered?" test read it from one place - they drifted apart
 * once already, and the deals list grew a permanent "Save this view" chip
 * offering to save a page nobody had filtered.
 */
export const DEFAULT_DEAL_SORT = { key: 'updatedAt', dir: 'desc' };

/**
 * The deals list's sortable columns, in table order, with the words the
 * table heading uses for them. One list, for the same reason
 * DEFAULT_DEAL_SORT is one: the sort key a view stores has to be checked
 * against what the table still offers, and named back to the user in the
 * words they clicked on.
 */
export const DEAL_SORT_COLUMNS = [
  { key: 'name', label: 'Deal' },
  { key: 'link', label: 'Company / contact' },
  { key: 'stage', label: 'Stage' },
  { key: 'value', label: 'Value' },
  { key: 'expectedClose', label: 'Expected close' },
  { key: 'updatedAt', label: 'Last updated' },
];

/** A deal sort column's heading, or the raw key when nothing answers to it. */
export function dealSortLabel(key) {
  return DEAL_SORT_COLUMNS.find((c) => c.key === key)?.label || String(key ?? '');
}

export function viewKind(kind) {
  return VIEW_KINDS.find((k) => k.key === kind) || null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const fieldMap = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [key, value] of Object.entries(v)) {
    const clean = str(value);
    if (key && clean) out[key] = clean;
  }
  return out;
};

/**
 * A filter set, shaped for its list. Every list keeps `query`, `tags`, and
 * custom-field filters; the rest is what that list actually offers.
 */
export function normalizeFilters(kind, raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = {
    query: str(source.query),
    tags: strList(source.tags),
    fields: fieldMap(source.fields),
  };
  if (kind === 'contacts') return { ...base, status: str(source.status) || 'all' };
  if (kind === 'deals') {
    const dir = source.sort?.dir === 'asc' ? 'asc' : 'desc';
    const key = str(source.sort?.key);
    return {
      ...base,
      stage: str(source.stage) || 'open',
      closeWindow: str(source.closeWindow) || 'any',
      sort: key ? { key, dir } : null,
    };
  }
  return base;
}

/** The filter set a freshly-opened list has: everything at its default. */
export function emptyFilters(kind) {
  return normalizeFilters(kind, {});
}

/** Is this filter set the same as an unfiltered list? Nothing to save. */
export function isEmptyFilters(kind, filters) {
  return sameFilters(kind, filters, emptyFilters(kind));
}

export function sameFilters(kind, a, b) {
  const left = normalizeFilters(kind, a);
  const right = normalizeFilters(kind, b);
  const canon = (f) => JSON.stringify({
    ...f,
    // Tag order is not part of the filter - the tags are ANDed.
    tags: [...f.tags].sort(),
    // Nor is field-filter order: the filters are ANDed too, and the key
    // order is only the order the selects happened to be picked in.
    fields: Object.fromEntries(Object.entries(f.fields)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    // Naming no sort and naming the one the list already opens on describe
    // the same page, so they have to compare equal - otherwise the
    // unfiltered deals list matches neither its saved views nor the empty
    // set, and reads as filtered when nothing is filtered.
    ...(kind === 'deals' ? { sort: f.sort || DEFAULT_DEAL_SORT } : {}),
  });
  return canon(left) === canon(right);
}

export function normalizeView(kind, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name).slice(0, MAX_VIEW_NAME);
  if (!name) return null;
  return {
    id: str(raw.id) || uid(),
    name,
    default: !!raw.default,
    filters: normalizeFilters(kind, raw.filters),
  };
}

/** One list's views: named, unique by id, capped, at most one default. */
export function normalizeViewList(kind, raw) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const view = normalizeView(kind, item);
    if (!view || seen.has(view.id)) continue;
    seen.add(view.id);
    out.push(view);
    if (out.length >= MAX_VIEWS) break;
  }
  // Two defaults would make "the page opens with" ambiguous; the first wins.
  let claimed = false;
  for (const view of out) {
    if (view.default && !claimed) claimed = true;
    else view.default = false;
  }
  return out;
}

export function normalizeViews(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of KEYS) out[key] = normalizeViewList(key, source[key]);
  return out;
}

export function viewsOf(settings, kind) {
  if (!KEYS.includes(kind)) return [];
  return normalizeViewList(kind, settings?.views?.[kind]);
}

export function viewById(settings, kind, id) {
  return viewsOf(settings, kind).find((v) => v.id === id) || null;
}

/** The view a list opens with, or null. */
export function defaultView(settings, kind) {
  return viewsOf(settings, kind).find((v) => v.default) || null;
}

/** The saved view whose conditions match what is on screen, if any. */
export function matchingView(settings, kind, filters) {
  return viewsOf(settings, kind).find((v) => sameFilters(kind, v.filters, filters)) || null;
}

/**
 * A view's filters, minus anything the app no longer has, plus a plain
 * list of what was dropped:
 *
 *   { filters, dropped: ['the tag “vip”', 'a stage that was removed'] }
 *
 * `context` supplies what currently exists: `tags` (names), `stages`
 * (ids), `fields` (ids). Anything absent from context isn't checked.
 */
export function applyFilters(kind, raw, context = {}) {
  const filters = normalizeFilters(kind, raw);
  const dropped = [];

  if (Array.isArray(context.tags)) {
    const known = new Set(context.tags.map((t) => String(t).toLowerCase()));
    const kept = filters.tags.filter((tag) => known.has(tag.toLowerCase()));
    for (const tag of filters.tags) {
      if (!known.has(tag.toLowerCase())) dropped.push(`the tag “${tag}”`);
    }
    filters.tags = kept;
  }

  if (Array.isArray(context.fields)) {
    const known = new Set(context.fields);
    const next = {};
    for (const [id, value] of Object.entries(filters.fields)) {
      if (known.has(id)) next[id] = value;
      else dropped.push('a field that was removed');
    }
    filters.fields = next;
  }

  if (kind === 'deals' && Array.isArray(context.stages)) {
    const known = new Set([...context.stages, 'open', 'all']);
    if (filters.stage && !known.has(filters.stage)) {
      dropped.push('a stage that was removed');
      filters.stage = 'open';
    }
  }

  if (kind === 'deals' && Array.isArray(context.sortKeys) && filters.sort) {
    if (!context.sortKeys.includes(filters.sort.key)) {
      dropped.push('a sort column that no longer exists');
      filters.sort = null;
    }
  }

  // Duplicates read as nagging: "a field that was removed" twice says
  // nothing the first one didn't.
  return { filters, dropped: [...new Set(dropped)] };
}

/**
 * "2 tags · closing this month" - what a view is, for a tooltip.
 *
 * Every stored condition is an internal value, and this is the one place
 * that reads them back to the user, so each one arrives with the function
 * that names it. Left to speak for themselves they said "active" for the
 * chip labelled In conversation and "sorted by expectedClose" for the
 * column headed Expected close - words nothing else in the app uses.
 */
export function describeFilters(kind, raw, {
  statusLabel = (s) => s,
  stageLabel = (s) => s,
  windowLabel = (w) => w,
  sortLabel = dealSortLabel,
} = {}) {
  const f = normalizeFilters(kind, raw);
  const parts = [];
  if (f.query) parts.push(`“${f.query}”`);
  if (kind === 'contacts' && f.status && f.status !== 'all') parts.push(statusLabel(f.status));
  if (kind === 'deals' && f.stage && f.stage !== 'open') parts.push(stageLabel(f.stage));
  if (kind === 'deals' && f.closeWindow && f.closeWindow !== 'any') {
    parts.push(windowLabel(f.closeWindow));
  }
  if (f.tags.length) parts.push(f.tags.length === 1 ? `tag ${f.tags[0]}` : `${f.tags.length} tags`);
  const fields = Object.keys(f.fields).length;
  if (fields) parts.push(fields === 1 ? '1 field' : `${fields} fields`);
  if (kind === 'deals' && f.sort) parts.push(`sorted by ${sortLabel(f.sort.key)}`);
  return parts.join(' · ') || 'no filters';
}

/** Move a view within its list. Returns a new list. */
export function reorderViews(list, id, delta) {
  const views = [...(Array.isArray(list) ? list : [])];
  const at = views.findIndex((v) => v.id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= views.length) return views;
  [views[at], views[to]] = [views[to], views[at]];
  return views;
}

/** Mark one view the default (or none, when `id` is null). */
export function withDefault(list, id) {
  return (Array.isArray(list) ? list : []).map((v) => ({ ...v, default: v.id === id }));
}
