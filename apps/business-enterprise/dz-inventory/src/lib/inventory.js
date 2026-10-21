/**
 * Pure inventory logic: stock status, dashboard stats, list filtering
 * and sorting, and the CSV import merge. No DOM, no Puter; unit-tested.
 */

import { round2 } from './util.js';
import { isCountUnit } from './units.js';
import { isAtLocation, stockAt, bucketKey, shortfallAt, belowMinimumAnywhere, binMap } from './stock.js';
import { isExpiring } from './lots.js';
import { holdsStock, availableQty } from './kits.js';

export const DEFAULT_LOW_STOCK = 5;

/**
 * 'out' at zero, 'low' at or below the threshold, 'ok' above it.
 * A per-product threshold overrides the store default; a threshold of 0
 * means "never warn" (only out-of-stock still shows).
 */
export function stockStatus(product, defaultLow = DEFAULT_LOW_STOCK) {
  const qty = Number(product.quantity) || 0;
  if (qty <= 0) return 'out';
  const low = product.lowStock ?? defaultLow;
  return low > 0 && qty <= low ? 'low' : 'ok';
}

/**
 * The status a product actually reads as, given the catalogue around
 * it. A sell-as-kit holds no stock of its own by design, so it is
 * judged on what its components allow — otherwise it would read "out of
 * stock" for ever while its parts sat on the shelf. Everything else is
 * plain stockStatus.
 *
 * This is the one answer the badge, the filter chips, and the product
 * page all have to give: a row listed under "Out of stock" wearing an
 * "In stock" badge is the app contradicting itself.
 */
export function statusOf(product, products = [], defaultLow = DEFAULT_LOW_STOCK) {
  return stockStatus({ ...product, quantity: availableQty(product, products) }, defaultLow);
}

export const STATUS_LABELS = { out: 'Out of stock', low: 'Low stock', ok: 'In stock', archived: 'Archived' };

/**
 * Products still in play. Archived ones are kept for their details,
 * thresholds, and history, but they are not stock you hold: they stay
 * out of totals, alerts, and the default list.
 */
export function activeProducts(products) {
  return products.filter((p) => !p.archived);
}

/**
 * Totals for the dashboard, over active products. Value is at cost.
 *
 * `units` counts only products measured in items: adding kilograms to
 * pieces would produce a number that means nothing. `measured` says how
 * many products were left out of that total for exactly that reason.
 */
export function inventoryStats(allProducts, defaultLow = DEFAULT_LOW_STOCK) {
  const products = activeProducts(allProducts);
  const stats = { products: products.length, units: 0, measured: 0, value: 0, low: 0, out: 0 };
  for (const p of products) {
    const qty = Number(p.quantity) || 0;
    if (isCountUnit(p.unit)) stats.units += qty;
    else stats.measured++;
    stats.value += qty * (Number(p.cost) || 0);
    // A sell-as-kit is a way of selling other stock, not stock itself:
    // counting it as permanently out of stock would put a number on the
    // dashboard that nothing can ever fix.
    if (!holdsStock(p)) continue;
    const st = stockStatus(p, defaultLow);
    if (st === 'out') stats.out++;
    else if (st === 'low') stats.low++;
  }
  stats.value = round2(stats.value);
  return stats;
}

/**
 * Totals for what one location actually holds, counting each product's
 * stock in that bucket rather than its whole quantity — the point of
 * per-location stock.
 */
export function locationTotals(allProducts, locationId) {
  const totals = { products: 0, units: 0, measured: 0, value: 0 };
  for (const p of activeProducts(allProducts)) {
    // Membership matches the products view's location filter — stock
    // here, or homed here with nothing on hand anywhere — so a card's
    // product count is the count its "See what's here" link opens,
    // and a shelf of out-of-stock products doesn't read "0 products"
    // with no way in. Units and value still sum what's actually here.
    if (!isAtLocation(p, locationId)) continue;
    totals.products++;
    const qty = stockAt(p, locationId);
    if (qty <= 0) continue;
    if (isCountUnit(p.unit)) totals.units += qty;
    else totals.measured++;
    totals.value += qty * (Number(p.cost) || 0);
  }
  totals.value = round2(totals.value);
  return totals;
}

/**
 * Units, value, and measured-product count for any subset (a location,
 * a supplier). Same rule as inventoryStats: only counted units add up.
 */
export function subsetTotals(products) {
  const totals = { products: products.length, units: 0, measured: 0, value: 0 };
  for (const p of products) {
    const qty = Number(p.quantity) || 0;
    if (isCountUnit(p.unit)) totals.units += qty;
    else totals.measured++;
    totals.value += qty * (Number(p.cost) || 0);
  }
  totals.value = round2(totals.value);
  return totals;
}

/**
 * Active products needing attention, out-of-stock first, then lowest
 * cover.
 *
 * A sell-as-kit is left out: it holds no stock of its own by design, so
 * it would sit at "out of stock" for ever while its components are what
 * actually need watching. Alerts see through a kit to its parts.
 */
export function alertProducts(products, defaultLow = DEFAULT_LOW_STOCK) {
  return activeProducts(products)
    .filter(holdsStock)
    .map((p) => ({ product: p, status: stockStatus(p, defaultLow) }))
    .filter((x) => x.status !== 'ok')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'out' ? -1 : 1;
      return (a.product.quantity || 0) - (b.product.quantity || 0);
    });
}

/** Case- and accent-insensitive haystack match. */
function matches(hay, needle) {
  return String(hay ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .includes(needle);
}

/**
 * Filter by free-text query (name, SKU, barcode, category, bin), stock status
 * ('low' | 'out' | 'alerts' for both, 'expiring' for dated stock due
 * within 30 days, 'cover' for stock running out before a restock could
 * land, 'belowmin' for a place holding less than it should, or
 * 'archived'), location, supplier, and category. Empty/absent filters
 * pass everything.
 *
 * 'belowmin' reads against the location filter when one is on — "below
 * minimum *here*" is the only version of that question a location view
 * can ask — and against any place with a minimum otherwise.
 *
 * The 'cover' status is the one thing here the products themselves can't
 * answer: it comes from the activity log, so the caller passes the set
 * of ids it worked out (see demandRates/runningOut) rather than this
 * function growing a second data source.
 *
 * Archived products are hidden unless asked for, either by the
 * 'archived' status or by `archived: 'only' | 'all'`.
 */
export function filterProducts(products, { query = '', status = '', locationId = '', supplierId = '', category = '', archived = 'active', runningOut = null, now = Date.now() } = {}, defaultLow = DEFAULT_LOW_STOCK) {
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const onlyArchived = status === 'archived' || archived === 'only';
  const statusFilter = status === 'archived' ? '' : status;
  return products.filter((p) => {
    if (onlyArchived ? !p.archived : (archived !== 'all' && p.archived)) return false;
    // Shelf codes are searched like every other code on the product:
    // "A3" is how someone standing at the shelf asks what's on it.
    if (q && !(matches(p.name, q) || matches(p.sku, q) || matches(p.barcode, q)
      || matches(p.category, q) || Object.values(binMap(p)).some((code) => matches(code, q)))) return false;
    if (statusFilter === 'expiring') {
      if (!isExpiring(p, { now })) return false;
    } else if (statusFilter === 'cover') {
      if (!runningOut?.has(p.id)) return false;
    } else if (statusFilter === 'belowmin') {
      // Same rule the replenish list keeps: a sell-as-kit holds no stock
      // anywhere, so it can never stop being below a minimum.
      if (!holdsStock(p)) return false;
      const here = locationId ? bucketKey(locationId) : null;
      if (here === null ? !belowMinimumAnywhere(p) : shortfallAt(p, here) <= 0) return false;
    } else {
      // Through statusOf, so a sell-as-kit is measured against what its
      // components allow — the same rule its own badge, the dashboard
      // alerts and Reorder already apply to it.
      const st = statusFilter && statusOf(p, products, defaultLow);
      if (statusFilter === 'alerts' ? st === 'ok' : (statusFilter && st !== statusFilter)) return false;
    }
    // A location filter means "what's at this location", so it matches
    // any product holding stock there, not just ones homed there.
    if (locationId && !isAtLocation(p, bucketKey(locationId))) return false;
    if (supplierId && p.supplierId !== supplierId) return false;
    if (category && (p.category || '') !== category) return false;
    return true;
  });
}

const nameOf = (p) => String(p?.name ?? '');

export const SORTS = {
  // Tolerant of a missing name: sorting is not the place to find out that
  // a restored file had a row without one.
  name: (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }),
  quantity: (a, b) => (a.quantity || 0) - (b.quantity || 0),
  cost: (a, b) => (a.cost || 0) - (b.cost || 0),
  value: (a, b) => (a.quantity || 0) * (a.cost || 0) - (b.quantity || 0) * (b.cost || 0),
  updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
};

/**
 * Stable sort helper; `dir` is 1 or -1.
 *
 * 'cover' — days of stock left at the current rate of sale — is sorted
 * from a map the caller derived from the activity log, for the same
 * reason the filter takes a set: it isn't a field on the product.
 * Products the log can say nothing about sort as unbounded cover, so
 * ascending puts the shelves about to empty first.
 */
export function sortProducts(products, key = 'name', dir = 1, { cover = null } = {}) {
  const coverOf = (p) => {
    const v = cover?.get(p.id);
    return v === null || v === undefined ? Infinity : v;
  };
  const cmp = key === 'cover'
    ? (a, b) => coverOf(a) - coverOf(b)
    : (SORTS[key] || SORTS.name);
  return [...products].sort((a, b) => {
    const by = cmp(a, b);
    // Infinity − Infinity is NaN, which a comparator must never return:
    // two products with no demand data would sort at random.
    return (Number.isNaN(by) ? 0 : by) * dir || SORTS.name(a, b);
  });
}

/** Distinct, sorted category names across products. */
export function categoriesOf(products) {
  const set = new Set();
  for (const p of products) if (p.category) set.add(p.category);
  return [...set].sort((a, b) => a.localeCompare(b));
}

const skuKey = (sku) => String(sku ?? '').trim().toLowerCase();

/**
 * Merge import drafts into existing products.
 *
 * Identity is the SKU (case-insensitive); drafts without a SKU always
 * create. `mode` decides what an SKU match does:
 *   'update'  — overwrite the fields the file actually carries, and only
 *               those: a sheet of names and prices leaves cost, stock,
 *               and categories exactly as they were
 *   'add'     — add the draft quantity to the matched product's stock
 *               (a receiving list), other fields updated only if provided
 *   'skip'    — leave matched products untouched
 *
 * Pure: returns { created, updated, skipped } without touching inputs.
 */
export function mergeImport(existing, drafts, mode = 'update') {
  const bySku = new Map();
  for (const p of existing) {
    const k = skuKey(p.sku);
    if (k && !bySku.has(k)) bySku.set(k, p);
  }

  const created = [];
  const updated = new Map(); // id → updated copy (dupe SKUs in-file collapse)
  let skipped = 0;

  for (const d of drafts) {
    const k = skuKey(d.sku);
    const hit = k ? bySku.get(k) : null;
    if (!hit) {
      const prev = k ? created.find((c) => skuKey(c.sku) === k) : null;
      if (prev) {
        // In add mode the first row's stock has to be in the running
        // list before this row tops it up, or "5 at A" + "3 at B"
        // collapses into 8 at wherever the last row pointed.
        if (mode === 'add' && !prev.stockByName) {
          const seed = importedStock(prev);
          if (seed.length) {
            prev.stockByName = seed;
            prev.stockMode = 'add';
          }
        }
        applyDraft(prev, d, mode === 'skip' ? 'update' : mode);
      } else created.push({ ...d });
      continue;
    }
    if (mode === 'skip') { skipped++; continue; }
    const copy = updated.get(hit.id) ?? { ...hit };
    applyDraft(copy, d, mode);
    updated.set(hit.id, copy);
  }

  return { created, updated: [...updated.values()], skipped };
}

/**
 * Where a draft's stock goes, as [{ name, qty }]. A file with a stock
 * breakdown wins; otherwise the row's single quantity lands at the row's
 * location (an empty name meaning the product's own location).
 *
 * Empty when the file says nothing about quantities at all — a price list
 * must not read as "every one of these is now zero".
 */
export function importedStock(d) {
  if (Array.isArray(d.stock) && d.stock.length) return d.stock;
  if (d.quantity === null || d.quantity === undefined) return [];
  return [{ name: d.locationName || '', qty: Number(d.quantity) || 0 }];
}

/** Copy only the fields the file actually stated (see rowsToDrafts). */
function assignStated(target, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) target[key] = value;
  }
}

function applyDraft(target, d, mode) {
  const list = importedStock(d);
  if (list.length) {
    // In add mode a second row for the same SKU tops the product up again,
    // so its buckets accumulate rather than replace.
    target.stockByName = mode === 'add' && target.stockByName ? [...target.stockByName, ...list] : list;
    target.stockMode = mode === 'add' ? 'add' : 'set';
  }

  if (mode === 'add') {
    target.quantity = (Number(target.quantity) || 0) + (Number(d.quantity) || 0);
    // A receiving list often carries only SKU and quantity; keep existing
    // details unless the file provides a value.
    if (d.name) target.name = d.name;
    if (d.category) target.category = d.category;
    if (d.cost) target.cost = d.cost;
    if (d.price !== null && d.price !== undefined) target.price = d.price;
    if (d.lowStock !== null && d.lowStock !== undefined) target.lowStock = d.lowStock;
    if (d.reorderQty !== null && d.reorderQty !== undefined) target.reorderQty = d.reorderQty;
    if (d.notes) target.notes = d.notes;
    if (d.barcode) target.barcode = d.barcode;
    if (d.locationName) target.locationName = d.locationName;
    if (d.supplierName) target.supplierName = d.supplierName;
    // Receiving stock never un-archives: bringing a retired product back
    // is a decision, not a side effect of a delivery file.
    if (d.archived === true) target.archived = true;
  } else {
    // Only what the file states: a column the file doesn't have must not
    // clear a cost, a category, or a shelf full of stock.
    assignStated(target, {
      name: d.name,
      barcode: d.barcode,
      category: d.category,
      quantity: d.quantity,
      cost: d.cost,
      price: d.price,
      lowStock: d.lowStock,
      reorderQty: d.reorderQty,
      notes: d.notes,
      locationName: d.locationName,
      supplierName: d.supplierName,
    });
    // An empty cell in a present column means "not archived", so exports
    // round-trip; an absent column leaves the flag as it is.
    if (d.archived !== null && d.archived !== undefined) target.archived = d.archived;
  }
  // Shelf codes ride along in either mode: a sheet of bins is exactly
  // the file people keep in a spreadsheet, and it says nothing about
  // quantities either way. The store resolves the names to places.
  if (d.bin !== undefined) target.bin = d.bin;
  if (d.bins !== undefined) target.bins = d.bins;
  // Unit and pack details apply in either mode, but only when the file
  // actually carries them: a blank column must never silently redefine
  // what a product's quantities mean.
  if (d.unit) target.unit = d.unit;
  if (d.packSize) target.packSize = d.packSize;
  if (d.packName) target.packName = d.packName;
  // Supplier details ride along in either mode for the store to apply
  // to the supplier record itself; they are never product fields.
  if (d.supplierLeadTime !== null && d.supplierLeadTime !== undefined) target.supplierLeadTime = d.supplierLeadTime;
  if (d.supplierMinOrder !== null && d.supplierMinOrder !== undefined) target.supplierMinOrder = d.supplierMinOrder;
}

/**
 * How many drafts state a quantity for a product sold as a kit. Such a
 * kit holds no stock of its own — its availability is its components' —
 * so the store leaves those amounts out, and the importer says so before
 * the import rather than importing a number that then goes nowhere.
 */
export function kitStockMatches(existing, drafts) {
  const kits = new Set(existing.filter((p) => !holdsStock(p) && skuKey(p.sku)).map((p) => skuKey(p.sku)));
  if (!kits.size) return 0;
  const hits = new Set();
  for (const d of drafts) {
    const k = skuKey(d.sku);
    if (k && kits.has(k) && importedStock(d).length) hits.add(k);
  }
  return hits.size;
}

/**
 * How many drafts would land on an archived product. Receiving stock
 * into something hidden from every list is almost always a mistake, so
 * the importer warns before it happens.
 */
export function archivedMatches(existing, drafts) {
  const archived = new Set(existing.filter((p) => p.archived && skuKey(p.sku)).map((p) => skuKey(p.sku)));
  const hits = new Set();
  for (const d of drafts) {
    const k = skuKey(d.sku);
    if (k && archived.has(k)) hits.add(k);
  }
  return hits.size;
}
