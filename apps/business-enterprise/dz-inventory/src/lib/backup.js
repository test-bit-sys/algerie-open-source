/**
 * Full-account backup: build, validate, and describe the JSON file that
 * carries every collection (settings, products, locations, suppliers,
 * activity). CSV covers products only and loses history, notes, and
 * settings; this is the lossless path — and the only way to move an
 * inventory between accounts.
 */

import { dateStamp, uid } from './util.js';

export const BACKUP_APP = 'puter-inventory';
export const BACKUP_VERSION = 1;

const COLLECTIONS = ['products', 'locations', 'suppliers', 'activity', 'orders'];

/**
 * Carried in the file, not counted at anyone in a restore dialog: a
 * variant family is the shared half of products that are counted
 * already, and a backup that dropped it would scatter every family it
 * restored back into loose products.
 */
const EXTRAS = ['families', 'stocktakes'];

/** Snapshot of every collection, as stored (no ids rewritten). */
export function backupData(store) {
  return {
    settings: { ...store.settings },
    products: store.products,
    locations: store.locations,
    suppliers: store.suppliers,
    activity: store.activity,
    orders: store.orders,
    // Not in COLLECTIONS: worth carrying, not worth counting at someone
    // in a restore dialog.
    families: store.families,
    stocktakes: store.stocktakes,
    snapshots: store.snapshots,
  };
}

/**
 * The downloadable file: data plus provenance. `archives` is the map of
 * month buckets older activity was rolled into ({ 'YYYY-MM': entries }),
 * loaded by the caller since reading it is async.
 */
export function buildBackup(store, at = Date.now(), archives = null) {
  const data = backupData(store);
  if (archives && Object.keys(archives).length) data.archives = archives;
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: at, data };
}

export function backupFilename(at = new Date()) {
  return `inventory-backup-${dateStamp(at)}.json`;
}

export function backupCounts(data) {
  const counts = {};
  for (const key of COLLECTIONS) counts[key] = Array.isArray(data?.[key]) ? data[key].length : 0;
  return counts;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "312 products, 4 locations, 2 suppliers, 180 history entries" */
export function describeBackup(data) {
  const c = backupCounts(data);
  return [
    plural(c.products, 'product'),
    plural(c.locations, 'location'),
    plural(c.suppliers, 'supplier'),
    plural(c.activity, 'history entry', 'history entries'),
  ].join(', ');
}

/**
 * Accept a parsed backup file. Tolerant of a bare `{ products: [...] }`
 * body (an older or hand-made file) but never of something that carries
 * no recognizable collection — restoring that would silently wipe data.
 * Returns { ok, data, exportedAt } or { ok: false, error }.
 */
export function validateBackup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'That file isn’t an Inventory backup.' };
  }
  const body = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
  const present = COLLECTIONS.filter((k) => Array.isArray(body[k]));
  if (!present.length) {
    return { ok: false, error: 'That file doesn’t contain any inventory data.' };
  }
  if (raw.version && Number(raw.version) > BACKUP_VERSION) {
    return { ok: false, error: 'That backup was made by a newer version of Inventory.' };
  }
  const data = {
    settings: body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : {},
  };
  // A hand-made or truncated file can hold rows that aren't records at
  // all (null, a stray string); once restored they crash every render
  // that touches the collection — a null order breaks the nav badge, a
  // null activity entry the dashboard — so they never get in.
  const records = (list) => list.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  for (const key of COLLECTIONS) data[key] = Array.isArray(body[key]) ? records(body[key]) : [];
  data.snapshots = Array.isArray(body.snapshots) ? records(body.snapshots) : [];
  for (const key of EXTRAS) data[key] = Array.isArray(body[key]) ? records(body[key]) : [];
  // Views sort and label these by name; a bare JSON number there would
  // crash the first localeCompare it meets.
  const named = (list) => list.map((r) => (typeof r.name === 'string' ? r : { ...r, name: String(r.name ?? '') }));
  data.locations = named(data.locations);
  data.suppliers = named(data.suppliers);
  // A family is named, sorted, and printed like the rest, and its axes
  // are walked as an array wherever a variant is built from it.
  data.families = named(data.families)
    .map((f) => (Array.isArray(f.axes) ? f : { ...f, axes: [] }));
  // Every row needs its own id: hand-made files may omit them, and
  // id-less records all answer to a lookup by `undefined` — deleting or
  // cancelling one would take every id-less record with it, and the
  // history view's duplicate check keeps only the first id-less entry.
  const withIds = (list) => list.map((r) => (r.id ? r : { ...r, id: uid() }));
  for (const key of COLLECTIONS) data[key] = withIds(data[key]);
  // A family with no id can't be pointed at; without one, every variant
  // naming it would read as a loose product anyway.
  data.families = data.families.filter((f) => f.id);
  // Archived activity months, if the file carries any.
  if (body.archives && typeof body.archives === 'object' && !Array.isArray(body.archives)) {
    data.archives = {};
    for (const [month, rows] of Object.entries(body.archives)) {
      if (/^\d{4}-\d{2}$/.test(month) && Array.isArray(rows)) data.archives[month] = withIds(records(rows));
    }
  }
  // A product without a name can't be rendered; drop the unusable rows
  // rather than importing a broken list. A row with only a SKU is worth
  // keeping, but it has to be callable something — the app sorts,
  // labels, and announces products by name throughout.
  data.products = data.products
    .filter((p) => p.name || p.sku)
    .map((p) => (typeof p.name === 'string' && p.name ? p : { ...p, name: String(p.name || p.sku) }));
  // A category is a name too: the products list, the stocktake scope, and
  // the bulk-edit sheet all build their category picker by sorting these
  // with localeCompare, which a bare JSON number crashes — taking the
  // whole view with it, not just the picker. Filters also compare a
  // category against the string the picker holds, so coercing here is
  // what makes a restored row filterable at all.
  data.products = data.products
    .map((p) => (p.category === undefined || typeof p.category === 'string'
      ? p
      : { ...p, category: p.category === null ? '' : String(p.category) }));
  // Fields the app does arithmetic on and the CSV exporters write raw:
  // every path that builds them coerces to numbers, and a file that
  // doesn't (hand-made, or crafted to smuggle spreadsheet formulas into
  // "numeric" cells — CWE-1236) must not be the one exception. Only
  // keys the row actually carries are touched; null stays the app's
  // own "unset". `spec` maps key → fallback for unreadable values.
  const coerceNums = (list, spec) => list.map((r) => {
    let out = r;
    for (const [key, fallback] of Object.entries(spec)) {
      const v = r[key];
      if (!(key in r) || v === null || (typeof v === 'number' && Number.isFinite(v))) continue;
      const n = Number(v);
      if (out === r) out = { ...r };
      out[key] = v !== '' && Number.isFinite(n) ? n : fallback;
    }
    return out;
  });
  data.products = coerceNums(data.products, { cost: 0, price: null, lowStock: null, reorderQty: null, packSize: 0 });
  data.suppliers = coerceNums(data.suppliers, { leadTimeDays: null, minOrder: null });
  const entrySpec = { at: 0, delta: null, quantity: null };
  data.activity = coerceNums(data.activity, entrySpec);
  if (data.archives) {
    for (const month of Object.keys(data.archives)) data.archives[month] = coerceNums(data.archives[month], entrySpec);
  }
  data.snapshots = coerceNums(data.snapshots, { products: 0, units: 0, value: 0, low: 0, out: 0 });
  return { ok: true, data, exportedAt: Number(raw.exportedAt) || null };
}
