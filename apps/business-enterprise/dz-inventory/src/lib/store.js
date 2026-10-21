/**
 * Data layer on top of Puter KV. Everything lives under a handful of
 * collection projections plus immutable inv:op:v1:<uuid> commits.
 * Boot and saves discover journal entries; unchanged entries are cached.
 * The journal merges session changes and recovers incomplete projections:
 *
 *   inv:settings:v1   { theme, currency, defaultLowStock, safetyDays,
 *                       coverageDays, onboarded, sampleData }
 *   inv:products:v2   [{ id, name, sku, barcode, category, unit, packSize, packName,
 *                        stock: { [locationId]: qty }, quantity, locationId,
 *                        supplierId, cost, price, lowStock, reorderQty, notes,
 *                        sources: [{ supplierId, code, price, packSize,
 *                                    leadTimeDays, preferred }],
 *                        trackExpiry, lots: { [locationId]: [{ date, qty }] },
 *                        min: { [locationId]: qty },
 *                        bin: { [locationId]: 'A3-12' },
 *                        kit: 'build' | 'sell',
 *                        components: [{ productId, qty }],
 *                        archived, createdAt, updatedAt }]
 *                     (lots exist only while trackExpiry is on; the stock
 *                      buckets stay the cached per-location totals)
 *                     (v1 held a single quantity/locationId pair and is
 *                      migrated on first read; `quantity` stays as the
 *                      cached total of `stock`.)
 *   inv:families:v1   [{ id, name, axes: ['Size'], category, unit,
 *                        supplierId, price, lowStock, reorderQty, packSize,
 *                        packName, trackExpiry, notes, imagePath,
 *                        locationId, createdAt, updatedAt }]
 *                     a variant family: the half of a product its
 *                     variants share. Each variant is an ordinary product
 *                     carrying `familyId` and `axes: { Size: 'M' }`, so
 *                     stock, history, counting and ordering all work at
 *                     the level of real things.
 *   inv:locations:v1  [{ id, name, note, createdAt }]
 *   inv:suppliers:v1  [{ id, name, contact, email, phone, website,
 *                        leadTimeDays, minOrder, notes, createdAt }]
 *   inv:activity:v1   [{ id, at, kind, productId, name, unit, delta, quantity,
 *                        note, reason, cost, price }]  (reason only on
 *                     'remove' entries; cost is the paid unit cost on an
 *                     'add' and the unit cost at the time on a priced
 *                     'remove'; price — what a unit sold for — only on
 *                     'remove', and only when it was recorded)
 *   inv:activity:v1:YYYY-MM  older activity, rolled into month buckets
 *   inv:archives:v1   [{ month, count }]  manifest of those buckets
 *   inv:orders:v1     [{ id, supplierId, supplierName, reference, status,
 *                        createdAt, orderedAt, receivedAt, closedAt,
 *                        cancelledAt, lines: [{ productId, name, sku, code,
 *                        unit, qty, received, price }] }]
 *                     (code and price are the supplier's own, frozen from
 *                      the product's source when the order was placed)
 *                     (status: ordered | partial | received | closed |
 *                      cancelled — closed means finished with undelivered
 *                      remainders; cancelled orders keep their record)
 *   inv:takeout:v1    one take-out basket in progress, or null:
 *                     { id, startedAt, updatedAt, reason, locationId,
 *                       note, lines: [{ id, productId, name, sku,
 *                       barcode, unit, qty, price, reason, locationId,
 *                       note }] }  (a line's reason/locationId/note
 *                     override the session's; locationId null means each
 *                     product's own default location)
 *   inv:counts:v1     one stocktake session in progress, or null:
 *                     { id, startedAt, updatedAt, scope: { locationId,
 *                       category, label }, blind, sortBy, rows: [{ productId,
 *                       name, sku, barcode, unit, bin, expected, counted }] }
 *   inv:stocktakes:v1 [{ id, startedAt, committedAt, scope, counted,
 *                        skipped, matched, unitsOver, unitsShort, value,
 *                        lines: [...] }]  one per committed count; older
 *                     records keep their totals and drop their lines
 *   inv:snapshots:v1  [{ date, products, units, value, low, out }]  one a day
 *   inv:backups:v1    [{ id, at, reason, counts }]  manifest of auto snapshots
 *   inv:backup:<id>   { app, version, exportedAt, data }  one snapshot
 *
 * The store is an EventTarget; every mutation dispatches 'change' after
 * the optimistic in-memory update, and persistence errors reject so
 * callers can surface them.
 */

import { uid, round2, dateStamp } from './util.js';
import { kvGet, kvDel, kvSetConfirmed } from './cloud.js';
import { Persistence } from './persistence.js';
import { DEFAULT_LOW_STOCK, mergeImport, importedStock, inventoryStats } from './inventory.js';
import { upsertSnapshot, sameSnapshot } from './reports.js';
import { buildBackup, backupCounts, validateBackup } from './backup.js';
import { monthKey, mergeEntries, isRemovalReason } from './activity.js';
import { migrateOrder, lineRemaining, OPEN_ORDER_STATUSES } from './reorder.js';
import { DEFAULT_SAFETY_DAYS } from './demand.js';
import { normalizeSources, sourceFor } from './sources.js';
import {
  SHARED_FIELDS, normalizeAxes, normalizeValues, remapAxisValues, variantName, familyVariants,
} from './variants.js';
import {
  kitMode, normalizeComponents, componentRows, componentsFor, kitUnitCost, kitsUsing, buildableQty,
} from './kits.js';
import { nextInternalCodes } from './barcode.js';
import {
  buildStocktakeRows, stocktakeVariances, buildStocktakeRecord, trimStocktakeHistory,
} from './stocktake.js';
import {
  DEFAULT_TAKEOUT_REASON, buildTakeoutLine, lineLocation as takeoutLocation,
  lineNote as takeoutNote, lineReason as takeoutReason, linePrice as takeoutPrice,
  takeoutLineByCode, takeoutLineFor, takeoutRef,
} from './takeout.js';
import {
  normalizeLots, lotsTotal, addLot, consumeLots, consumeLotAt, resizeLots, lotsAt,
} from './lots.js';
import { normalizeUnit, roundQty } from './units.js';
import { deletePhoto } from './photos.js';
import {
  UNASSIGNED, UNASSIGNED_LABEL, migrateProduct, stockEntries,
  stockAt, totalStock, withStockAt, defaultLocationId, minMap, binMap,
} from './stock.js';

/** Float drift guard for measured deltas (0.3 - 0.1, not money). */
const round3 = (n) => Math.round(n * 1000) / 1000;

/** A count for a log reference: whole for items, three decimals otherwise. */
const formatCountFor = (n, unit) => (normalizeUnit(unit) === 'each' ? String(Math.round(n)) : String(round3(n)));

/** A whole positive day count, or null when unusable. */
const supplierLeadTime = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** A positive order minimum in money, or null when unusable. */
const supplierMinOrder = (v) => {
  const n = round2(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * A per-unit money amount from a caller, or null when it says nothing.
 * Zero is a value — stock given away is a real sale at nothing — so only
 * blanks and nonsense are refused.
 */
const unitMoney = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
};

/**
 * A minimums map the app can trust: positive numbers only, rounded to
 * what the product's unit can express, keyed by bucket. Anything else —
 * a zero, a blank, a string from a hand-made restore — is absence, which
 * is how "no minimum here" is stated.
 */
function normalizeBin(product) {
  return binMap(product);
}

function normalizeMin(product) {
  const out = {};
  for (const [locationId, qty] of Object.entries(minMap(product))) {
    const n = roundQty(qty, product?.unit);
    if (n > 0) out[locationId] = n;
  }
  return out;
}

const KV = {
  settings: 'inv:settings:v1',
  products: 'inv:products:v2',
  families: 'inv:families:v1',
  locations: 'inv:locations:v1',
  suppliers: 'inv:suppliers:v1',
  activity: 'inv:activity:v1',
  archives: 'inv:archives:v1',
  orders: 'inv:orders:v1',
  counts: 'inv:counts:v1',
  stocktakes: 'inv:stocktakes:v1',
  takeout: 'inv:takeout:v1',
  snapshots: 'inv:snapshots:v1',
  backups: 'inv:backups:v1',
};

/** Pre-per-location products, read once so v1 users are carried over. */
const KV_PRODUCTS_V1 = 'inv:products:v1';

const snapshotKey = (id) => `inv:backup:${id}`;
const archiveKey = (month) => `${KV.activity}:${month}`;

/**
 * Entries kept in the hot log. Every stock change rewrites this whole
 * array, so it stays small; anything older rolls into month buckets the
 * history view loads on demand.
 */
const ACTIVITY_MAX = 400;

/** How many automatic pre-danger snapshots to keep, newest first. */
const AUTO_SNAPSHOT_MAX = 3;

export const DEFAULT_SETTINGS = {
  theme: 'system',
  currency: 'DZD',
  defaultLowStock: DEFAULT_LOW_STOCK,
  /* Days of cover to ask for on top of a supplier's lead time when
     suggesting a reorder point. Suggestions are offered, never written,
     so this changes what the app proposes and nothing it holds. */
  safetyDays: DEFAULT_SAFETY_DAYS,
  /* Days of demand a suggested order aims to carry. 0 keeps the
     original behaviour — order back up to roughly twice the threshold. */
  coverageDays: 0,
  onboarded: false,
  sampleData: false,
};

/** Activity kinds: 'add' | 'remove' | 'recount' | 'create' | 'delete' | 'import' */

class Store extends EventTarget {
  settings = { ...DEFAULT_SETTINGS };
  products = [];
  families = [];
  locations = [];
  suppliers = [];
  activity = [];
  archives = [];
  orders = [];
  stocktake = null;
  stocktakes = [];
  takeout = null;
  snapshots = [];
  backups = [];
  user = null;

  /** Entries trimmed off the live log, waiting to reach their bucket. */
  #overflow = [];
  #archiveCache = new Map();
  /** Flushes queue behind this so they never interleave. */
  #flushChain = Promise.resolve();
  #persistence = new Persistence();
  #stockChangeChain = Promise.resolve();

  async init() {
    await this.#persistence.init();
    const [settings, products, families, locations, suppliers, activity, archives, orders, counts, stocktakes, takeout, snapshots, backups, user] = await Promise.all([
      this.#persistence.read(KV.settings),
      this.#persistence.read(KV.products),
      this.#persistence.read(KV.families),
      this.#persistence.read(KV.locations),
      this.#persistence.read(KV.suppliers),
      this.#persistence.read(KV.activity),
      this.#persistence.read(KV.archives),
      this.#persistence.read(KV.orders),
      this.#persistence.read(KV.counts),
      this.#persistence.read(KV.stocktakes),
      this.#persistence.read(KV.takeout),
      this.#persistence.read(KV.snapshots),
      this.#persistence.read(KV.backups),
      puter.auth.getUser().catch(() => null),
    ]);
    this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    this.products = Array.isArray(products) ? products.map(migrateProduct) : [];
    this.families = Array.isArray(families) ? families : [];
    this.locations = Array.isArray(locations) ? locations : [];
    this.suppliers = Array.isArray(suppliers) ? suppliers : [];
    this.activity = Array.isArray(activity) ? activity : [];
    this.archives = Array.isArray(archives) ? archives : [];
    this.orders = Array.isArray(orders) ? orders.map(migrateOrder) : [];
    this.stocktake = counts && Array.isArray(counts.rows) ? counts : null;
    this.stocktakes = Array.isArray(stocktakes) ? stocktakes : [];
    this.takeout = takeout && Array.isArray(takeout.lines) ? takeout : null;
    this.snapshots = Array.isArray(snapshots) ? snapshots : [];
    this.backups = Array.isArray(backups) ? backups : [];
    this.user = user;
    this.#overflow = [];
    this.#archiveCache.clear();

    // Families whose variants have all gone since last time.
    await this.#pruneFamilies().catch((err) => console.error('Family sweep failed', err));

    /* One-time upgrade for accounts written before per-location stock:
       each product's single quantity moves into its location's bucket.
       v1 is left in place — an old build would still find its data. */
    if (!Array.isArray(products)) {
      const legacy = await this.#persistence.read(KV_PRODUCTS_V1).catch(() => null);
      if (Array.isArray(legacy) && legacy.length) {
        this.products = legacy.map(migrateProduct);
        await this.#save('products', this.products).catch((err) => console.error('Migration failed', err));
      }
    }
  }

  #emit() {
    this.dispatchEvent(new Event('change'));
  }

  async #save(key, value) {
    await this.#persistence.write(KV[key], value);
  }

  /* ---------- Settings ---------- */

  /**
   * Settings apply optimistically so the UI answers immediately, but a
   * write that never lands is rolled back: continuing to show a currency
   * or threshold the account doesn't hold is worse than not applying it,
   * because a reload silently undoes it.
   */
  updateSettings(patch) {
    return this.#stockChange(() => this.#updateSettings(patch), ['settings']);
  }

  async #updateSettings(patch) {
    const before = this.settings;
    this.settings = { ...before, ...patch };
    this.#emit();
    try {
      await this.#save('settings', this.settings);
    } catch (err) {
      if (!err.committed) this.settings = before;
      this.#emit();
      throw err;
    }
  }

  /* ---------- Activity ---------- */

  #log(entry) {
    const row = { id: uid(), at: Date.now(), ...entry };
    this.activity.unshift(row);
    if (this.activity.length > ACTIVITY_MAX) {
      this.#overflow.push(...this.activity.splice(ACTIVITY_MAX));
    }
    return row;
  }

  /** Persist the live log, rolling anything trimmed into month buckets. */
  async #saveActivity() {
    // Archive first, then write the log: entries whose bucket write
    // failed are still queued, so they ride along in the persisted log
    // rather than existing only in this tab's memory — a reload can't
    // lose them, and the next mutation trims and flushes them again.
    await this.#flushOverflow();
    const rows = this.#overflow.length ? mergeEntries(this.activity, this.#overflow) : this.activity;
    await this.#save('activity', rows);
  }

  /** Stock and its audit entries share a durable commit. */
  async #saveStock(extra = []) {
    await this.#flushOverflow();
    await this.#persistence.writeMany([
      [KV.products, this.products],
      [KV.activity, this.#overflow.length ? mergeEntries(this.activity, this.#overflow) : this.activity],
      ...extra,
    ]);
  }

  /** Undo can reach entries already rolled out of the 400-row live log. */
  #retractActivity(ids = []) {
    const drop = new Set(ids);
    if (!drop.size) return Promise.resolve();
    const run = this.#flushChain.then(async () => {
      const missing = new Set(drop);
      const months = new Set();
      for (const row of [...this.activity, ...this.#overflow]) {
        if (!drop.has(row.id)) continue;
        missing.delete(row.id);
        months.add(monthKey(row.at));
      }
      // Read before removing anything. A failed archive read must not
      // turn an unreadable month into an empty one, or partly undo stock.
      const updates = [];
      for (const archive of this.archives) {
        if (!missing.size && !months.has(archive.month)) continue;
        const rows = await this.loadArchive(archive.month);
        const kept = rows.filter((row) => !drop.has(row.id));
        if (kept.length === rows.length) continue;
        for (const row of rows) if (drop.has(row.id)) missing.delete(row.id);
        updates.push({ archive, kept });
      }
      for (const { archive, kept } of updates) {
        await this.#persistence.write(archiveKey(archive.month), kept);
        this.#archiveCache.set(archive.month, kept);
        archive.count = kept.length;
      }
      if (updates.length) {
        this.archives = this.archives.filter((archive) => archive.count > 0);
        await this.#save('archives', this.archives);
      }
      this.activity = this.activity.filter((row) => !drop.has(row.id));
      this.#overflow = this.#overflow.filter((row) => !drop.has(row.id));
    });
    this.#flushChain = run.catch(() => {});
    return run;
  }

  /**
   * Move trimmed entries into their YYYY-MM bucket and update the
   * manifest. A failure re-queues the batch instead of dropping it, so
   * the audit trail survives a flaky connection.
   *
   * One at a time: a flush reads a bucket, merges, and writes it back,
   * so two in flight would each merge into the same stale base and the
   * second write would erase the first one's batch.
   */
  #flushOverflow() {
    const run = this.#flushChain.then(() => this.#flushNow());
    // #flushNow never throws, but one rejection must not wedge the queue.
    this.#flushChain = run.catch(() => {});
    return run;
  }

  async #flushNow() {
    if (!this.#overflow.length) return;
    const batch = this.#overflow;
    this.#overflow = [];
    try {
      const byMonth = new Map();
      for (const e of batch) {
        const m = monthKey(e.at);
        if (!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m).push(e);
      }
      for (const [month, rows] of byMonth) {
        const merged = mergeEntries(rows, await this.loadArchive(month));
        await this.#persistence.write(archiveKey(month), merged);
        this.#archiveCache.set(month, merged);
        const hit = this.archives.find((a) => a.month === month);
        if (hit) hit.count = merged.length;
        else this.archives.push({ month, count: merged.length });
      }
      this.archives.sort((a, b) => (a.month < b.month ? 1 : -1));
      await this.#save('archives', this.archives);
    } catch (err) {
      console.error('Archiving activity failed', err);
      this.#overflow.unshift(...batch);
    }
  }

  /**
   * Read one archived month (cached). Missing buckets read as empty,
   * but a read that *failed* stays a failure: swallowing it to an empty
   * list — and caching that for the session — would let the next
   * overflow flush merge into a false-empty base and rewrite the bucket
   * on the server without the entries it actually holds, and would let
   * a backup silently omit whole months of history.
   */
  async loadArchive(month) {
    if (this.#archiveCache.has(month)) return this.#archiveCache.get(month);
    const rows = await this.#persistence.read(archiveKey(month));
    if (!Array.isArray(rows) && this.archives.some((a) => a.month === month && a.count > 0)) {
      throw new Error('Archived history is missing. Reconnect before replacing inventory.');
    }
    const list = Array.isArray(rows) ? rows : [];
    this.#archiveCache.set(month, list);
    return list;
  }

  /** Every archived month as { 'YYYY-MM': entries }, for a full backup. */
  async loadAllArchives() {
    const out = {};
    for (const a of this.archives) {
      const rows = await this.loadArchive(a.month);
      if (rows.length) out[a.month] = rows;
    }
    return out;
  }

  /** Replace collections and archive buckets under the same durable commit. */
  #replaceData(entries, map = null) {
    const run = this.#flushChain.then(async () => {
      const buckets = Object.entries(map || {}).filter(([, rows]) => Array.isArray(rows) && rows.length);
      const months = new Set(buckets.map(([month]) => month));
      const stale = this.archives.filter((a) => !months.has(a.month)).map((a) => archiveKey(a.month));
      const manifest = buckets.map(([month, rows]) => ({ month, count: rows.length }))
        .sort((a, b) => b.month.localeCompare(a.month));
      let savedError;
      try {
        await this.#persistence.writeMany([
          ...entries,
          [KV.archives, manifest],
          ...buckets.map(([month, rows]) => [archiveKey(month), rows]),
          ...stale.map((key) => [key, null]),
        ], { deletes: stale });
      } catch (err) {
        if (!err.committed) throw err;
        savedError = err;
      }
      this.archives = manifest;
      this.#overflow = [];
      this.#archiveCache = new Map(buckets);
      this.#emit();
      if (savedError) throw savedError;
    });
    this.#flushChain = run.catch(() => {});
    return run;
  }

  /* ---------- Products ---------- */

  productById(id) {
    return this.products.find((p) => p.id === id) || null;
  }

  /**
   * The product already holding this SKU, if any (case-insensitive).
   * Archived products still hold their SKU — the form offers to restore
   * that one instead of reporting a duplicate the user can't see.
   */
  productBySku(sku, exceptId = null) {
    const k = String(sku ?? '').trim().toLowerCase();
    if (!k) return null;
    return this.products.find((p) => p.id !== exceptId && String(p.sku ?? '').trim().toLowerCase() === k) || null;
  }

  /** Reject a SKU already used by another product (case-insensitive). */
  skuTaken(sku, exceptId = null) {
    return !!this.productBySku(sku, exceptId);
  }

  /**
   * Find a product by a scanned code. Barcodes win over SKUs: a shop
   * that keeps both wants the code on the box to be authoritative.
   */
  productByCode(code) {
    const k = String(code ?? '').trim().toLowerCase();
    if (!k) return null;
    const match = (value) => String(value ?? '').trim().toLowerCase() === k;
    return this.products.find((p) => match(p.barcode))
      || this.products.find((p) => match(p.sku))
      || null;
  }

  addProduct(...args) {
    return this.#stockChange(() => this.#addProduct(...args));
  }

  async #addProduct(data) {
    const now = Date.now();
    const product = {
      id: uid(),
      name: String(data.name || '').trim(),
      sku: String(data.sku || '').trim(),
      barcode: String(data.barcode || '').trim(),
      category: String(data.category || '').trim(),
      unit: normalizeUnit(data.unit),
      packSize: Math.max(0, Number(data.packSize) || 0),
      packName: String(data.packName || '').trim(),
      stock: {},
      quantity: 0,
      locationId: data.locationId || null,
      supplierId: data.supplierId || null,
      cost: Math.max(0, round2(Number(data.cost) || 0)),
      price: data.price === null || data.price === undefined || data.price === '' ? null : Math.max(0, round2(Number(data.price) || 0)),
      lowStock: data.lowStock === null || data.lowStock === undefined || data.lowStock === '' ? null : roundQty(data.lowStock, data.unit),
      reorderQty: data.reorderQty === null || data.reorderQty === undefined || data.reorderQty === '' ? null : roundQty(data.reorderQty, data.unit),
      trackExpiry: !!data.trackExpiry,
      notes: String(data.notes || '').trim(),
      archived: !!data.archived,
      createdAt: now,
      updatedAt: now,
    };
    // What each place should hold, if the form said. Normalized here so
    // a blank, a zero, or junk never becomes a minimum to compare
    // against — absence is how "no minimum" is stated.
    const min = normalizeMin({ ...product, min: data.min });
    if (Object.keys(min).length) product.min = min;
    const bin = normalizeBin({ ...product, bin: data.bin });
    if (Object.keys(bin).length) product.bin = bin;
    this.#writeSources(product, data.sources);
    // Opening stock lands in the product's own location, so the
    // single-location workflow never has to think about buckets.
    this.#setStock(product, product.locationId || UNASSIGNED, data.quantity);
    // Apply the kit rule after opening stock: sell-as-kits derive their
    // availability from components and must not keep stock of their own.
    this.#writeKit(product, data.kit, data.components);
    // Opening stock predates any receipt, so its expiry is unknown.
    this.#syncLotsShape(product);
    // A variant is born into its family, in the same write as the rest
    // of it: written first as a loose product and joined to the family
    // afterwards, it flashed through every list as a standalone row —
    // and a second write that failed left it one for good.
    const family = typeof data.familyId === 'string' ? this.familyById(data.familyId) : null;
    if (family) {
      product.familyId = family.id;
      product.axes = normalizeValues(data.axes, family.axes);
    }
    this.products.unshift(product);
    this.#log({
      kind: 'create',
      productId: product.id,
      name: product.name,
      unit: product.unit,
      quantity: product.quantity,
      locationName: this.locationName(product.locationId),
    });
    this.#emit();
    await this.#saveStock();
    return product;
  }

  /** Human name for a bucket key, for logs and lists. */
  locationName(locationId) {
    if (!locationId) return UNASSIGNED_LABEL;
    return this.locationById(locationId)?.name || UNASSIGNED_LABEL;
  }

  /** Write one bucket and keep the cached total in step. */
  #setStock(product, locationId, qty) {
    if (kitMode(product) === 'sell' && roundQty(qty, product.unit) > 0) {
      throw new Error('Sell-as kits hold component stock only. Receive or count their components instead.');
    }
    product.stock = withStockAt(product, locationId, qty);
    product.quantity = totalStock(product);
  }

  /**
   * Write one location's lots for a tracked product; the stock bucket
   * follows as their total, so the two can never disagree through this
   * path.
   */
  #writeLots(product, locationId, lots) {
    const key = locationId ?? UNASSIGNED;
    const clean = normalizeLots(lots);
    if (!product.lots || typeof product.lots !== 'object') product.lots = {};
    if (clean.length) product.lots[key] = clean;
    else delete product.lots[key];
    this.#setStock(product, key, lotsTotal(clean));
  }

  /**
   * Bring the lots map back in line with tracking and the buckets:
   * turning tracking on gives existing stock undated lots, turning it
   * off drops them, and any bucket a lot-blind path resized gets its
   * lots resized to match (growth undated, shrinkage FEFO).
   */
  #syncLotsShape(product) {
    if (!product.trackExpiry) {
      delete product.lots;
      return;
    }
    const map = {};
    for (const [locationId, qty] of stockEntries(product)) {
      map[locationId] = resizeLots(product.lots?.[locationId], qty);
    }
    product.lots = map;
  }

  /**
   * Re-round every bucket to what the product's unit can express, after
   * the unit itself changed. Without this a counted product could hold
   * 2.5 items: displayed as 3, stored as 2.5, and back to 2.5 on reload.
   */
  #reroundStock(product) {
    for (const [locationId, qty] of stockEntries(product)) this.#setStock(product, locationId, qty);
    product.quantity = totalStock(product);
    // A minimum is a quantity too: re-measuring a product (kg → each)
    // has to leave its minimums expressible in the new unit, or a shelf
    // would be judged against 2.5 items.
    this.#writeMin(product, product.min);
    // CSV metadata-only edits also use this path and may never write
    // stock again. Resize dated lots to the rounded buckets now.
    this.#syncLotsShape(product);
  }

  /** Write a normalized minimums map, dropping it when it says nothing. */
  #writeMin(product, raw) {
    const map = normalizeMin({ ...product, min: raw });
    if (Object.keys(map).length) product.min = map;
    else delete product.min;
  }

  /** Write a normalized bin map, dropping it when it says nothing. */
  #writeBin(product, raw) {
    const map = normalizeBin({ ...product, bin: raw });
    if (Object.keys(map).length) product.bin = map;
    else delete product.bin;
  }

  /**
   * Write a recipe and its mode, or clear both. One level deep is
   * enforced here, where recipes are written: a component can't be a
   * kit, and a product other kits are made of can't become one.
   *
   * Returns the buckets a sell-as-kit conversion emptied, as
   * [{ locationId, qty }], so the caller can put them in the log.
   */
  #writeKit(product, mode, components) {
    const wanted = String(mode ?? '');
    const list = normalizeComponents(components, this.products, { selfId: product.id });
    if (!list.length || (wanted !== 'build' && wanted !== 'sell')) {
      delete product.kit;
      delete product.components;
      return [];
    }
    if (kitsUsing(product.id, this.products).length) {
      throw new Error('That product is a component of another kit, so it can’t be a kit itself');
    }
    product.kit = wanted;
    product.components = list;
    // A sell-as-kit holds no stock of its own; whatever it had goes back
    // to being nothing, because its availability comes from its parts.
    const emptied = [];
    if (wanted === 'sell') {
      for (const [locationId, qty] of stockEntries(product)) {
        this.#setStock(product, locationId, 0);
        emptied.push({ locationId, qty });
      }
      this.#syncLotsShape(product);
    }
    return emptied;
  }

  /**
   * Write a normalized source list, and keep `supplierId` pointing at
   * the preferred one — everything that groups, filters, and reports by
   * supplier reads that field, so the two can never disagree through
   * this path. A single source is left implicit: it's exactly what
   * `supplierId` alone already says, and storing it twice is a second
   * copy to keep in step.
   */
  #writeSources(product, raw) {
    if (raw === undefined) return;
    const list = normalizeSources(raw, { unit: product.unit });
    if (!list.length) {
      delete product.sources;
      return;
    }
    const preferred = list.find((s) => s.preferred) || list[0];
    product.supplierId = preferred.supplierId;
    // One source with nothing else recorded about it says no more than
    // supplierId does; keep it only once it carries a code, a price, a
    // pack size or a lead time of its own.
    const carries = (s) => !!s.code || s.price !== null || s.packSize > 0 || s.leadTimeDays !== null;
    if (list.length === 1 && !carries(list[0])) delete product.sources;
    else product.sources = list;
  }

  /**
   * Point an existing source list at the supplier something just named.
   *
   * `supplierId` and `sources` are two halves of one fact — every filter,
   * report and reorder group reads the first, every order sheet reads the
   * second — and a change that moved one without restating the other (a
   * bulk edit, a CSV row) left the list showing one supplier while every
   * order went to another. A supplier that isn't on the list yet joins it
   * as a bare entry rather than throwing the codes and prices away.
   */
  #repointSources(product, supplierId) {
    if (!supplierId) {
      // “No supplier” must also clear the sources that reorder uses.
      delete product.sources;
      return;
    }
    if (!product.sources?.length) return;
    const list = product.sources.map((s) => ({ ...s, preferred: s.supplierId === supplierId }));
    if (!list.some((s) => s.preferred)) list.unshift({ supplierId, preferred: true });
    this.#writeSources(product, list);
  }

  updateProduct(id, patch) {
    return this.#stockChange(() => this.#updateProduct(id, patch));
  }

  async #updateProduct(id, patch) {
    const p = this.productById(id);
    if (!p) throw new Error('Product not found');
    const logged = this.#patchProduct(p, patch);
    this.#emit();
    // Editing a product doesn't touch the log — unless it relocated the
    // stock, which is a movement like any other.
    if (logged) await this.#saveStock();
    else await this.#save('products', this.products);
    return p;
  }

  /**
   * Apply a patch to one product in memory. Returns whether it wrote an
   * activity entry, so the caller knows to persist the log too.
   *
   * Moving a single-location product's home moves its stock with it —
   * otherwise the list would name one place while the units sat in
   * another. Products split across locations are left alone; those need
   * a deliberate transfer.
   *
   * Re-measuring a product (kg → each) re-rounds what's on hand to what
   * the new unit can express, bucket by bucket: a counted product holding
   * 2.5 items would print one number and store another.
   */
  #patchProduct(product, patch) {
    // Validate and normalize a draft first. A refused kit edit must not
    // leave changed fields on the live product for the next save to keep.
    const p = { ...product };
    if (p.lots) p.lots = { ...p.lots };
    const from = p.locationId || UNASSIGNED;
    const wasUnit = normalizeUnit(p.unit);
    Object.assign(p, patch, { updatedAt: Date.now() });
    // A threshold or reorder amount is a quantity of this product, so it
    // lands the way addProduct lands one: rounded to what the unit can
    // express. A bulk edit reaches counted and measured products with
    // one number; rounding it once, as items, gave a product sold by
    // the kilo a threshold it can't hold.
    if ('lowStock' in patch) {
      const v = patch.lowStock;
      p.lowStock = v === null || v === undefined || v === '' ? null : roundQty(v, p.unit);
    }
    if ('reorderQty' in patch) {
      const v = patch.reorderQty;
      p.reorderQty = v === null || v === undefined || v === '' ? null : roundQty(v, p.unit) || null;
    }
    if ('min' in patch) this.#writeMin(p, patch.min);
    if ('bin' in patch) this.#writeBin(p, patch.bin);
    if ('sources' in patch) this.#writeSources(p, patch.sources);
    // A patch that moves the supplier without restating the sources —
    // a bulk edit, a family's shared supplier — has to move the list
    // with it, or the row names one place and the order goes to another.
    else if ('supplierId' in patch) this.#repointSources(p, p.supplierId);
    let logged = false;
    if ('kit' in patch || 'components' in patch) {
      const emptied = this.#writeKit(p, 'kit' in patch ? patch.kit : p.kit, 'components' in patch ? patch.components : p.components);
      // Becoming a sell-as-kit takes whatever was on hand off the books,
      // since the product no longer holds stock of its own. That is a
      // count going to zero, and the log has to say so: the last entry
      // otherwise read "now 9 on hand" over a product showing none,
      // with nothing between the two to explain the difference.
      for (const { locationId, qty } of emptied) {
        this.#log({
          kind: 'recount',
          productId: p.id,
          name: p.name,
          unit: normalizeUnit(p.unit),
          delta: -qty,
          quantity: 0,
          locationId: locationId || null,
          locationName: this.locationName(locationId),
          note: 'Now sold as a kit. Its stock is its components’',
        });
        logged = true;
      }
    }
    if (normalizeUnit(p.unit) !== wasUnit) this.#reroundStock(p);
    const to = p.locationId || UNASSIGNED;
    const entries = stockEntries(p);
    if (to !== from && entries.length === 1 && entries[0][0] === from) {
      const qty = entries[0][1];
      const moved = p.trackExpiry ? lotsAt(p, from) : null;
      this.#setStock(p, from, 0);
      this.#setStock(p, to, qty);
      // The dated lots ride along with the stock they describe. Only
      // when there are any: tracking enabled in this same patch has no
      // lots yet, and writing the empty list would zero the bucket the
      // stock just moved into — #syncLotsShape below dates it instead.
      if (moved?.length) {
        delete p.lots?.[from];
        this.#writeLots(p, to, moved);
      }
      // The units really did change shelves, so the log has to say so.
      // Stock found at a place nobody remembers putting it has to be
      // explainable — the same reason deleting a location logs its
      // forced move rather than quietly reassigning the buckets.
      this.#log({
        kind: 'move',
        productId: p.id,
        name: p.name,
        unit: normalizeUnit(p.unit),
        moved: qty,
        quantity: p.quantity,
        locationId: from || null,
        locationName: this.locationName(from),
        toLocationId: to || null,
        toLocationName: this.locationName(to),
        note: 'Location changed',
      });
      logged = true;
    }
    // Tracking toggled, unit re-rounded, or home moved: whatever
    // happened, lots and buckets leave this function agreeing.
    this.#syncLotsShape(p);
    for (const key of Object.keys(product)) {
      if (!(key in p)) delete product[key];
    }
    Object.assign(product, p);
    return logged;
  }

  /**
   * Give products with no scannable code at all — no barcode, no SKU —
   * a generated internal barcode, so their labels can join the
   * scan-to-adjust flow. One KV write, one summarizing log entry.
   * Returns how many were assigned.
   */
  assignBarcodes(...args) {
    return this.#stockChange(() => this.#assignBarcodes(...args));
  }

  async #assignBarcodes(ids) {
    const wanted = new Set(ids);
    const targets = this.products.filter((p) => wanted.has(p.id)
      && !String(p.barcode ?? '').trim() && !String(p.sku ?? '').trim());
    if (!targets.length) return 0;
    const codes = nextInternalCodes(this.products, targets.length);
    const now = Date.now();
    targets.forEach((p, i) => {
      p.barcode = codes[i];
      p.updatedAt = now;
    });
    this.#log({
      kind: 'bulk',
      name: `${targets.length} product${targets.length === 1 ? '' : 's'} updated`,
      note: `Barcode${targets.length === 1 ? '' : 's'} assigned for labels`,
    });
    this.#emit();
    await this.#saveStock();
    return targets.length;
  }

  /* ---------- Variant families ---------- */

  familyById(id) {
    return this.families.find((f) => f.id === id) || null;
  }

  /** This family's variants, in axis order. */
  variantsOf(familyId) {
    return familyVariants(this.products, familyId);
  }

  /** The family a product belongs to, or null for a standalone product. */
  familyOf(product) {
    return product?.familyId ? this.familyById(product.familyId) : null;
  }

  /**
   * Turn one product into the first variant of a new family. Conversion,
   * not migration: the product keeps its id, its stock, and its whole
   * history — it just gains a family and an axis value, and its name
   * becomes the family's name plus what makes it different.
   *
   * The shared fields come off the product itself, so the family starts
   * out describing exactly what was already true.
   */
  createFamily(productId, options = {}) {
    return this.#stockChange(() => this.#createFamily(productId, options), ['families']);
  }

  async #createFamily(productId, { name = '', axes = [], values = {} } = {}) {
    const p = this.productById(productId);
    if (!p) throw new Error('Product not found');
    if (p.familyId) throw new Error('That product is already part of a family');
    const axisNames = normalizeAxes(axes);
    if (!axisNames.length) throw new Error('A family needs at least one axis');
    const now = Date.now();
    const family = {
      id: uid(),
      name: String(name || p.name || '').trim(),
      axes: axisNames,
      createdAt: now,
      updatedAt: now,
    };
    for (const key of SHARED_FIELDS) family[key] = p[key] ?? null;
    this.families.push(family);
    p.familyId = family.id;
    p.axes = normalizeValues(values, axisNames);
    p.name = variantName(family, p.axes);
    p.updatedAt = now;
    this.#log({
      kind: 'bulk',
      productId: p.id,
      name: family.name,
      note: `Made a variant family (${axisNames.join(', ')})`,
    });
    this.#emit();
    await this.#saveStock([[KV.families, this.families]]);
    return family;
  }

  /**
   * Add a variant, seeded from the family's shared half — which is what
   * makes a second size two fields of typing instead of a duplicate to
   * clean up. Its own SKU, barcode, cost and opening stock are its own.
   */
  addVariant(...args) {
    return this.#stockChange(() => this.#addVariant(...args));
  }

  async #addVariant(familyId, { values = {}, sku = '', barcode = '', cost, quantity = 0, locationId } = {}) {
    const family = this.familyById(familyId);
    if (!family) throw new Error('Family not found');
    const axisValues = normalizeValues(values, family.axes);
    const shared = {};
    for (const key of SHARED_FIELDS) {
      if (family[key] !== null && family[key] !== undefined) shared[key] = family[key];
    }
    return this.#addProduct({
      ...shared,
      locationId: locationId === undefined ? family.locationId ?? null : locationId,
      name: variantName(family, axisValues),
      sku,
      barcode,
      cost: cost === undefined ? 0 : cost,
      quantity,
      familyId: family.id,
      axes: axisValues,
    });
  }

  /**
   * Edit the family: the shared fields land on every variant and their
   * names follow, in one write and under one log entry — the four edits
   * this whole idea exists to collapse.
   */
  updateFamily(id, patch = {}) {
    return this.#stockChange(() => this.#updateFamily(id, patch), ['families']);
  }

  async #updateFamily(id, patch = {}) {
    const family = this.familyById(id);
    if (!family) throw new Error('Family not found');
    const before = { ...family };
    if (patch.name !== undefined) family.name = String(patch.name || '').trim();
    if (patch.axes !== undefined) family.axes = normalizeAxes(patch.axes);
    for (const key of SHARED_FIELDS) {
      if (key in patch) family[key] = patch[key];
    }
    family.updatedAt = Date.now();

    const shared = {};
    for (const key of SHARED_FIELDS) {
      if (key in patch) shared[key] = patch[key];
    }
    const variants = this.variantsOf(id);
    for (const p of variants) {
      // Axis names may have changed under the values; re-key them
      // before the name is rebuilt, so a dropped axis doesn't live on
      // in the name for ever — and a renamed one doesn't take every
      // variant's value with it, leaving four shirts all called
      // "Cotton Shirt".
      p.axes = remapAxisValues(p.axes, before.axes, family.axes);
      this.#patchProduct(p, { ...shared, name: variantName(family, p.axes) });
    }
    if (before.name !== family.name || Object.keys(shared).length) {
      this.#log({
        kind: 'bulk',
        name: family.name,
        note: `Family updated: ${variants.length} variant${variants.length === 1 ? '' : 's'}`,
      });
    }
    this.#emit();
    await this.#saveStock([[KV.families, this.families]]);
    return family;
  }

  /** One variant's axis values, and the name that follows from them. */
  setVariantAxes(...args) {
    return this.#stockChange(() => this.#setVariantAxes(...args));
  }

  async #setVariantAxes(productId, values = {}) {
    const p = this.productById(productId);
    const family = this.familyOf(p);
    if (!p || !family) throw new Error('Not a variant');
    p.axes = normalizeValues(values, family.axes);
    p.name = variantName(family, p.axes);
    p.updatedAt = Date.now();
    this.#emit();
    await this.#save('products', this.products);
    return p;
  }

  /**
   * Break a family up: its variants stay exactly as they are — same
   * ids, same stock, same history, same names — as standalone products.
   * Nothing is deleted but the grouping.
   */
  dissolveFamily(id) {
    return this.#stockChange(() => this.#dissolveFamily(id), ['families']);
  }

  async #dissolveFamily(id) {
    const family = this.familyById(id);
    if (!family) return 0;
    const variants = this.variantsOf(id);
    const now = Date.now();
    for (const p of variants) {
      delete p.familyId;
      delete p.axes;
      p.updatedAt = now;
    }
    this.families = this.families.filter((f) => f.id !== id);
    this.#log({
      kind: 'bulk',
      name: family.name,
      note: `Family split into ${variants.length} standalone product${variants.length === 1 ? '' : 's'}`,
    });
    this.#emit();
    await this.#saveStock([[KV.families, this.families]]);
    return variants.length;
  }

  /**
   * A family with no variants left describes nothing. Swept at boot
   * rather than on delete: undo can put the last variant straight back,
   * and it has to find its family still there when it does. Nothing
   * renders an empty family in the meantime — list rows are built from
   * products.
   */
  async #pruneFamilies() {
    const live = new Set(this.products.map((p) => p.familyId).filter(Boolean));
    const kept = this.families.filter((f) => live.has(f.id));
    if (kept.length === this.families.length) return;
    this.families = kept;
    await this.#save('families', this.families);
  }

  /* ---------- Bulk edits ---------- */

  /**
   * Apply one patch to many products in a single KV write, with a
   * single summarizing activity entry. Doing this as N calls would mean
   * N full rewrites of the products array — the reason this exists.
   */
  bulkUpdateProducts(...args) {
    return this.#stockChange(() => this.#bulkUpdateProducts(...args));
  }

  async #bulkUpdateProducts(ids, patch, { summary = '' } = {}) {
    const wanted = new Set(ids);
    const touched = this.products.filter((p) => wanted.has(p.id));
    if (!touched.length) return 0;
    for (const p of touched) this.#patchProduct(p, patch);
    this.#log({
      kind: 'bulk',
      name: `${touched.length} product${touched.length === 1 ? '' : 's'} updated`,
      note: summary,
    });
    this.#emit();
    await this.#saveStock();
    return touched.length;
  }

  /**
   * Apply a *different* patch to each of many products, in one KV write
   * and under one summarizing activity entry. What bulkUpdateProducts is
   * for a shared value, this is for a per-product one — accepting a
   * threshold suggested from each product's own demand, where every
   * number is different by definition.
   *
   * `patches` is [{ id, patch }]; empty patches are skipped rather than
   * bumping updatedAt on a product nothing was decided about.
   */
  bulkUpdateEach(...args) {
    return this.#stockChange(() => this.#bulkUpdateEach(...args));
  }

  async #bulkUpdateEach(patches = [], { summary = '' } = {}) {
    const wanted = new Map();
    for (const { id, patch } of patches) {
      if (!id || !patch || !Object.keys(patch).length) continue;
      wanted.set(id, patch);
    }
    const touched = this.products.filter((p) => wanted.has(p.id));
    if (!touched.length) return 0;
    for (const p of touched) this.#patchProduct(p, wanted.get(p.id));
    this.#log({
      kind: 'bulk',
      name: `${touched.length} product${touched.length === 1 ? '' : 's'} updated`,
      note: summary,
    });
    this.#emit();
    await this.#saveStock();
    return touched.length;
  }

  /** Archive or restore many products at once, in one write. */
  bulkSetArchived(...args) {
    return this.#stockChange(() => this.#bulkSetArchived(...args));
  }

  async #bulkSetArchived(ids, archived) {
    const wanted = new Set(ids);
    const touched = this.products.filter((p) => wanted.has(p.id) && !!p.archived !== !!archived);
    if (!touched.length) return 0;
    const now = Date.now();
    for (const p of touched) {
      p.archived = !!archived;
      p.updatedAt = now;
    }
    this.#log({
      kind: archived ? 'archive' : 'restore',
      name: `${touched.length} product${touched.length === 1 ? '' : 's'} ${archived ? 'archived' : 'restored'}`,
    });
    this.#emit();
    await this.#saveStock();
    return touched.length;
  }

  /**
   * Delete many products in one write, returning the same undo token
   * shape as deleteProduct so one toast can put them all back.
   */
  bulkDeleteProducts(...args) {
    return this.#stockChange(() => this.#bulkDeleteProducts(...args));
  }

  async #bulkDeleteProducts(ids) {
    const wanted = new Set(ids);
    const removed = [];
    // Walk backwards so the recorded indexes stay valid for reinsertion.
    for (let i = this.products.length - 1; i >= 0; i--) {
      if (!wanted.has(this.products[i].id)) continue;
      removed.unshift({ product: this.products[i], index: i });
      this.products.splice(i, 1);
    }
    if (!removed.length) return null;
    const entry = this.#log({
      kind: 'delete',
      name: removed.length === 1
        ? removed[0].product.name
        : `${removed.length} products deleted`,
      productId: removed.length === 1 ? removed[0].product.id : null,
    });
    this.#emit();
    await this.#saveStock();
    return { products: removed, activityIds: [entry.id] };
  }

  /**
   * Archive (or restore) a product. Archiving keeps every detail, its
   * threshold, its SKU, and its history, but takes it out of the list,
   * the totals, and the alerts.
   */
  setArchived(...args) {
    return this.#stockChange(() => this.#setArchived(...args));
  }

  async #setArchived(id, archived) {
    const p = this.productById(id);
    if (!p) throw new Error('Product not found');
    if (!!p.archived === !!archived) return p;
    p.archived = !!archived;
    p.updatedAt = Date.now();
    this.#log({
      kind: archived ? 'archive' : 'restore',
      productId: id,
      name: p.name,
      unit: normalizeUnit(p.unit),
      quantity: Number(p.quantity) || 0,
    });
    this.#emit();
    await this.#saveStock();
    return p;
  }

  /**
   * Remove a product. Returns an undo token (the product, where it sat,
   * and the log entry to retract) so a toast can put it straight back.
   */
  deleteProduct(...args) {
    return this.#stockChange(() => this.#deleteProduct(...args));
  }

  async #deleteProduct(id) {
    const index = this.products.findIndex((x) => x.id === id);
    if (index === -1) return null;
    const [p] = this.products.splice(index, 1);
    const entry = this.#log({ kind: 'delete', productId: id, name: p.name });
    this.#emit();
    await this.#saveStock();
    return { products: [{ product: p, index }], activityIds: [entry.id] };
  }

  /**
   * Put deleted products back where they were and retract the log entries
   * the delete wrote, so an undone delete leaves no trace in the history.
   */
  undoDelete(...args) {
    return this.#stockChange(() => this.#undoDelete(...args));
  }

  async #undoDelete(token) {
    if (!token?.products?.length) return;
    await this.#retractActivity(token.activityIds);
    for (const { product, index } of [...token.products].sort((a, b) => a.index - b.index)) {
      if (this.productById(product.id)) continue; // already back
      this.products.splice(Math.min(index, this.products.length), 0, product);
    }
    this.#emit();
    await this.#saveStock();
  }

  /**
   * Change stock by a signed delta ('add'/'remove') or set an absolute
   * count ('recount'), at one location. Stock never goes below zero, and
   * lands on a value the product's unit can express (whole items, or 3
   * decimals). `quantity` in the log is the resulting total on hand.
   * `reason` (sold, damaged, …) is kept only when the change really is
   * a removal — a delta that clamps into an add must not claim one.
   *
   * `cost` is what each received unit cost this time. On an add it folds
   * into the product cost as a moving average — stock value then reflects
   * what the stock actually cost — and lands on the log entry so history
   * can answer "what did I pay last time?". Absent, nothing about cost
   * changes; it never applies to removals or recounts, which don't buy
   * anything.
   *
   * `price` is the mirror image: what each unit sold for on the way out.
   * It lands on the 'remove' entry together with the product's cost at
   * that moment — the moving average will have moved on by the time
   * anyone reads a report, so freezing it here is what makes COGS
   * honest later. Absent, the removal is recorded exactly as before and
   * the sales reports count it as unpriced rather than valuing it at
   * list price.
   *
   * For products tracking expiry, `expiryDate` dates what an add
   * received (blank = unknown), and removals leave in FEFO order unless
   * `lotDate` names the lot reality actually took from. A recount keeps
   * the dates it can: growth is undated, shrinkage leaves FEFO.
   */
  adjustStock(id, options = {}) {
    return this.#stockChange(() => this.#adjustStock(id, options));
  }

  async #adjustStock(id, { delta = 0, set = null, note = '', locationId, reason = '', cost = null, price = null, expiryDate = '', lotDate = undefined } = {}) {
    const p = this.productById(id);
    if (!p) throw new Error('Product not found');
    // A sell-as-kit holds no stock of its own: taking one out takes its
    // components out instead. Doing it here means every path that
    // removes stock — the dialog, a basket, a scan — gets it for free.
    if (kitMode(p) === 'sell' && set === null && Number(delta) < 0) {
      return this.#sellKit(p, { qty: -Number(delta), note, reason, price });
    }
    const loc = locationId === undefined ? defaultLocationId(p) : (locationId || UNASSIGNED);
    const before = stockAt(p, loc);
    const totalBefore = Number(p.quantity) || 0;
    const raw = set !== null ? Number(set) || 0 : before + Number(delta || 0);
    const after = roundQty(Math.max(0, raw), p.unit);
    if (after === before) return p;
    if (p.trackExpiry) {
      const held = lotsAt(p, loc);
      if (after > before) this.#writeLots(p, loc, addLot(held, expiryDate, round3(after - before)));
      else if (set !== null) this.#writeLots(p, loc, resizeLots(held, after));
      else if (lotDate !== undefined && lotDate !== null) this.#writeLots(p, loc, consumeLotAt(held, lotDate, round3(before - after)).lots);
      else this.#writeLots(p, loc, consumeLots(held, round3(before - after)).lots);
    } else {
      this.#setStock(p, loc, after);
    }
    p.updatedAt = Date.now();
    const kind = set !== null ? 'recount' : (after > before ? 'add' : 'remove');
    let receiptCost = null;
    if (kind === 'add' && cost !== null && cost !== undefined && cost !== '' && Number.isFinite(Number(cost)) && Number(cost) >= 0) {
      receiptCost = round2(Number(cost));
      const added = round3(after - before);
      const oldCost = Number(p.cost) || 0;
      // Weighted over everything on hand, not just this location's
      // bucket: the product has one cost however it's shelved.
      p.cost = totalBefore > 0
        ? round2((totalBefore * oldCost + added * receiptCost) / (totalBefore + added))
        : receiptCost;
    }
    // What the units leaving were sold for, and what they had cost us.
    // Only on a real removal: a delta that clamped into an add sold
    // nothing, and a recount is not a sale however it moved.
    const sale = kind === 'remove' ? unitMoney(price) : null;
    this.#log({
      kind,
      productId: id,
      name: p.name,
      unit: normalizeUnit(p.unit),
      delta: round3(after - before),
      quantity: p.quantity,
      locationId: loc || null,
      locationName: this.locationName(loc),
      note: String(note || '').trim(),
      ...(kind === 'remove' && isRemovalReason(reason) ? { reason } : {}),
      ...(receiptCost !== null ? { cost: receiptCost } : {}),
      ...(sale !== null ? { price: sale, cost: round2(Number(p.cost) || 0) } : {}),
    });
    this.#emit();
    await this.#saveStock();
    return p;
  }

  /**
   * Take `qty` of one component out of stock for a kit, from wherever it
   * actually sits — its own place first, then whichever bucket holds the
   * most — logging each bucket it came out of. Selling a kit and
   * building one are both a single action, not a location decision, so
   * both take stock the same way: a component homed at the warehouse
   * with all of its stock on the shop floor used to give nothing at all,
   * and the sale went in the log with the parts still on the shelf.
   *
   * Returns `{ took, from, activityIds }`: how much actually left (less
   * than asked for when the shelves can't cover it), which bucket each
   * part of it came out of — dated lots included, so an undo can put
   * back the same dates rather than undated stock — and the entries it
   * wrote, so an undo can retract them.
   */
  #takeComponent(component, qty, { note = '', reason = '', at = Date.now(), kitId = null } = {}) {
    const wanted = roundQty(qty, component.unit);
    let left = wanted;
    const from = [];
    const activityIds = [];
    const buckets = [defaultLocationId(component), ...stockEntries(component).map(([loc]) => loc)];
    for (const loc of [...new Set(buckets)]) {
      if (left <= 0) break;
      const before = stockAt(component, loc);
      const taken = roundQty(Math.min(before, left), component.unit);
      if (!taken) continue;
      let lots = null;
      if (component.trackExpiry) {
        const res = consumeLots(lotsAt(component, loc), taken);
        lots = res.taken;
        this.#writeLots(component, loc, res.lots);
      } else {
        this.#setStock(component, loc, before - taken);
      }
      left = round3(left - taken);
      const entry = this.#log({
        kind: 'remove',
        productId: component.id,
        name: component.name,
        unit: normalizeUnit(component.unit),
        delta: -taken,
        quantity: component.quantity,
        locationId: loc || null,
        locationName: this.locationName(loc),
        note,
        ...(isRemovalReason(reason) ? { reason } : {}),
        // Which kit took it, when one did. The reason travels down from
        // the kit — a sold set sells its parts — so without this the
        // sales report reads each component as a sale of its own with
        // no price recorded, and reports the whole day's baskets as
        // takings it couldn't see.
        ...(kitId ? { kitId } : {}),
      });
      activityIds.push(entry.id);
      from.push({ productId: component.id, locationId: loc, qty: taken, lots });
    }
    const took = round3(wanted - left);
    if (took > 0) component.updatedAt = at;
    return { took, from, activityIds };
  }

  /**
   * Take `qty` kits out by taking their components out: one 'remove' per
   * component and one for the kit itself, all sharing a reference, so
   * History reads the sale as the single event it was.
   *
   * The kit's own entry carries the money (its price, and what its parts
   * cost) with a zero delta, because there is no stock of it to move —
   * which is exactly what "sell as a kit" means.
   */
  async #sellKit(p, { qty, note = '', reason = '', price = null }) {
    const wanted = Math.min(roundQty(qty, p.unit), buildableQty(p, this.products));
    if (!wanted) return p;
    const parts = componentsFor(p, wanted, this.products);
    if (!parts.length) throw new Error('This kit has no components to take out');
    const now = Date.now();
    const ref = `${p.name} × ${formatCountFor(wanted, p.unit)}`;
    const unitCost = kitUnitCost(p, this.products);

    for (const part of parts) {
      const component = this.productById(part.productId);
      if (!component) continue;
      this.#takeComponent(component, part.qty, {
        note: note ? `${ref}: ${note}` : ref,
        reason,
        at: now,
        kitId: p.id,
      });
    }

    const sale = unitMoney(price);
    p.updatedAt = now;
    this.#log({
      kind: 'remove',
      productId: p.id,
      name: p.name,
      unit: normalizeUnit(p.unit),
      delta: -wanted,
      // It never holds any, and saying "0 on hand" is the truth here.
      quantity: 0,
      locationId: null,
      locationName: UNASSIGNED_LABEL,
      note: note ? `Kit sold: ${note}` : 'Kit sold',
      ...(isRemovalReason(reason) ? { reason } : {}),
      ...(sale !== null ? { price: sale, cost: unitCost } : {}),
    });
    this.#emit();
    await this.#saveStock();
    return p;
  }

  /**
   * Make `qty` of a build-mode kit: its components come out of stock and
   * the kits go in, valued at what the parts cost today, which folds
   * into the kit's own moving average exactly as a receipt does.
   *
   * Refuses to build more than the parts allow — a kit built out of
   * stock that isn't there would put the shortage somewhere else.
   */
  buildKit(...args) {
    return this.#stockChange(() => this.#buildKit(...args));
  }

  async #buildKit(id, { qty = 1, locationId, note = '' } = {}) {
    const p = this.productById(id);
    if (!p) throw new Error('Product not found');
    if (kitMode(p) !== 'build') throw new Error('That product isn’t built from components');
    const wanted = roundQty(qty, p.unit);
    if (!wanted) throw new Error('Nothing to build');
    // componentsFor resolves only existing products; validate the full
    // recipe before that projection can hide a deleted component.
    if (componentRows(p, this.products).some((row) => row.missing)) {
      throw new Error('A component has been deleted; update the recipe before building');
    }
    const parts = componentsFor(p, wanted, this.products);
    if (!parts.length) throw new Error('This kit has no components');
    for (const part of parts) {
      const component = this.productById(part.productId);
      const available = component ? Number(component.quantity) || 0 : 0;
      if (available < part.qty) {
        throw new Error(`Not enough ${part.name}: ${part.qty} needed, ${available} on hand`);
      }
    }

    const now = Date.now();
    const ref = `Built ${formatCountFor(wanted, p.unit)} × ${p.name}`;
    const unitCost = kitUnitCost(p, this.products);
    const totalBefore = Number(p.quantity) || 0;

    for (const part of parts) {
      const component = this.productById(part.productId);
      if (!component) continue;
      this.#takeComponent(component, part.qty, {
        note: note ? `${ref}: ${note}` : ref,
        reason: 'internal',
        at: now,
      });
    }

    const loc = locationId === undefined ? defaultLocationId(p) : (locationId || UNASSIGNED);
    if (p.trackExpiry) this.#writeLots(p, loc, addLot(lotsAt(p, loc), '', wanted));
    else this.#setStock(p, loc, stockAt(p, loc) + wanted);
    // What it cost to make is what it cost: straight into the average.
    p.cost = totalBefore > 0
      ? round2((totalBefore * (Number(p.cost) || 0) + wanted * unitCost) / (totalBefore + wanted))
      : unitCost;
    p.updatedAt = now;
    this.#log({
      kind: 'add',
      productId: p.id,
      name: p.name,
      unit: normalizeUnit(p.unit),
      delta: wanted,
      quantity: p.quantity,
      locationId: loc || null,
      locationName: this.locationName(loc),
      note: note ? `${ref}: ${note}` : ref,
      cost: unitCost,
    });
    this.#emit();
    await this.#saveStock();
    return p;
  }

  /**
   * Move stock between two locations. The total on hand doesn't change,
   * so the entry carries the amount moved and both ends instead of a
   * delta. Moving more than is there moves what is there.
   */
  transferStock(...args) {
    return this.#stockChange(() => this.#transferStock(...args));
  }

  async #transferStock(id, { from, to, qty, note = '' } = {}) {
    const p = this.productById(id);
    if (!p) throw new Error('Product not found');
    const fromKey = from || UNASSIGNED;
    const toKey = to || UNASSIGNED;
    if (fromKey === toKey) return p;
    const available = stockAt(p, fromKey);
    const moved = roundQty(Math.min(Math.max(0, Number(qty) || 0), available), p.unit);
    if (!moved) throw new Error('Nothing to move');
    if (p.trackExpiry) {
      // The moved units keep their dates: FEFO out of one bucket, the
      // same lots into the other.
      const { lots, taken } = consumeLots(lotsAt(p, fromKey), moved);
      this.#writeLots(p, fromKey, lots);
      this.#writeLots(p, toKey, normalizeLots([...lotsAt(p, toKey), ...taken]));
    } else {
      this.#setStock(p, fromKey, available - moved);
      this.#setStock(p, toKey, stockAt(p, toKey) + moved);
    }
    p.updatedAt = Date.now();
    this.#log({
      kind: 'move',
      productId: id,
      name: p.name,
      unit: normalizeUnit(p.unit),
      moved,
      quantity: p.quantity,
      locationId: fromKey || null,
      locationName: this.locationName(fromKey),
      toLocationId: toKey || null,
      toLocationName: this.locationName(toKey),
      note: String(note || '').trim(),
    });
    this.#emit();
    await this.#saveStock();
    return p;
  }

  /**
   * Move several products at once — the replenish list's "move it all",
   * where every line is a different product from a different shelf. One
   * products write and one activity write, the same shape applyStocktake
   * and applyTakeout use; N calls to transferStock would mean N full
   * rewrites of the products array.
   *
   * `moves` is [{ productId, from, to, qty }]. A move of more than the
   * source holds moves what it holds; a move of nothing is skipped, so a
   * plan built a moment ago against stock that has since left doesn't
   * fail as a whole.
   *
   * Returns an undo token: the reverse moves and the entries to retract,
   * so one toast can put a whole replenishment back.
   */
  transferMany(...args) {
    return this.#stockChange(() => this.#transferMany(...args));
  }

  async #transferMany(moves = [], { note = '' } = {}) {
    const now = Date.now();
    const done = [];
    const activityIds = [];
    for (const move of moves) {
      const p = this.productById(move.productId);
      if (!p) continue;
      const fromKey = move.from || UNASSIGNED;
      const toKey = move.to || UNASSIGNED;
      if (fromKey === toKey) continue;
      const available = stockAt(p, fromKey);
      const moved = roundQty(Math.min(Math.max(0, Number(move.qty) || 0), available), p.unit);
      if (!moved) continue;
      let movedLots = null;
      if (p.trackExpiry) {
        const { lots, taken } = consumeLots(lotsAt(p, fromKey), moved);
        movedLots = taken;
        this.#writeLots(p, fromKey, lots);
        this.#writeLots(p, toKey, normalizeLots([...lotsAt(p, toKey), ...taken]));
      } else {
        this.#setStock(p, fromKey, available - moved);
        this.#setStock(p, toKey, stockAt(p, toKey) + moved);
      }
      p.updatedAt = now;
      const entry = this.#log({
        kind: 'move',
        productId: p.id,
        name: p.name,
        unit: normalizeUnit(p.unit),
        moved,
        quantity: p.quantity,
        locationId: fromKey || null,
        locationName: this.locationName(fromKey),
        toLocationId: toKey || null,
        toLocationName: this.locationName(toKey),
        note: String(note || '').trim(),
      });
      activityIds.push(entry.id);
      done.push({ productId: p.id, from: toKey, to: fromKey, qty: moved, ...(movedLots ? { lots: movedLots } : {}) });
    }
    if (!done.length) return null;
    this.#emit();
    await this.#saveStock();
    return { moves: done, activityIds, count: done.length };
  }

  /**
   * Put a batch of moves back where they came from and retract the
   * entries they wrote — an undone replenishment leaves no trace, the
   * same contract undoDelete and undoTakeout keep.
   */
  undoTransfers(...args) {
    return this.#stockChange(() => this.#undoTransfers(...args));
  }

  async #undoTransfers(token) {
    if (!token?.moves?.length) return;
    await this.#retractActivity(token.activityIds);
    const now = Date.now();
    for (const move of token.moves) {
      const p = this.productById(move.productId);
      if (!p) continue;
      const fromKey = move.from || UNASSIGNED;
      const toKey = move.to || UNASSIGNED;
      const available = stockAt(p, fromKey);
      const moved = roundQty(Math.min(move.qty, available), p.unit);
      if (!moved) continue;
      if (p.trackExpiry) {
        let lots = lotsAt(p, fromKey);
        const taken = [];
        let remaining = moved;
        // Reverse the original lots, not unrelated older stock already
        // at the destination. Old tokens without dates retain FEFO.
        for (const lot of move.lots || [{ qty: moved }]) {
          const qty = Math.min(lot.qty, remaining);
          const result = lot.date === undefined
            ? consumeLots(lots, qty) : consumeLotAt(lots, lot.date, qty);
          lots = result.lots;
          taken.push(...result.taken);
          remaining = round3(remaining - lotsTotal(result.taken));
          if (remaining <= 0) break;
        }
        this.#writeLots(p, fromKey, lots);
        this.#writeLots(p, toKey, normalizeLots([...lotsAt(p, toKey), ...taken]));
      } else {
        this.#setStock(p, fromKey, available - moved);
        this.#setStock(p, toKey, stockAt(p, toKey) + moved);
      }
      p.updatedAt = now;
    }
    this.#emit();
    await this.#saveStock();
  }

  /* ---------- Locations ---------- */

  locationById(id) {
    return this.locations.find((l) => l.id === id) || null;
  }

  addLocation(...args) {
    return this.#stockChange(() => this.#addLocation(...args), ['locations']);
  }

  async #addLocation(data) {
    const loc = {
      id: uid(),
      name: String(data.name || '').trim(),
      note: String(data.note || '').trim(),
      createdAt: Date.now(),
    };
    this.locations.push(loc);
    this.#emit();
    await this.#save('locations', this.locations);
    return loc;
  }

  updateLocation(...args) {
    return this.#stockChange(() => this.#updateLocation(...args), ['locations']);
  }

  async #updateLocation(id, patch) {
    const l = this.locationById(id);
    if (!l) throw new Error('Location not found');
    Object.assign(l, patch);
    this.#emit();
    await this.#save('locations', this.locations);
    return l;
  }

  /**
   * Why this location can't be deleted right now, or '' when it can.
   *
   * A count in progress froze its rows and expected quantities against
   * a bucket, so deleting a location out from under one corrupts the
   * apply — in both directions, since deleting a location moves its
   * stock into the unassigned bucket. Asked before the confirmation as
   * well as enforced in deleteLocation, so the refusal is stated in its
   * own words rather than surfacing as a failed write.
   */
  locationDeleteBlocker(id) {
    // Applying a count scoped here after the stock moved to Unassigned
    // would write the counts into a dead key and double what's on hand.
    if (this.stocktake?.scope?.locationId === id) {
      return 'This location is being counted; finish or cancel the stocktake first';
    }
    // The same corruption the other way: a session scoped on "No
    // location" froze its counts before this location's stock arrived
    // there, so applying it would recount the moved units out of
    // existence.
    if (this.stocktake?.scope?.locationId === UNASSIGNED
        && this.products.some((p) => stockAt(p, id) > 0)) {
      return 'This location’s stock would join “No location”, which is being counted; finish or cancel the stocktake first';
    }
    return '';
  }

  /**
   * Products in a deleted location keep existing, just unassigned —
   * including whatever stock was sitting there, which moves into the
   * unassigned bucket rather than vanishing from the totals. Each move
   * lands in the activity log like any other: stock found "at No
   * location" months later has to be explainable.
   */
  deleteLocation(...args) {
    return this.#stockChange(() => this.#deleteLocation(...args), ['locations', 'takeout']);
  }

  async #deleteLocation(id) {
    const blocked = this.locationDeleteBlocker(id);
    if (blocked) throw new Error(blocked);
    const name = this.locationName(id);
    this.locations = this.locations.filter((l) => l.id !== id);
    let touched = false;
    let moved = false;
    // A basket pointing here would silently take nothing out: its
    // stock is about to become unassigned, so the lines follow it
    // rather than aiming at a dead key.
    const basket = this.takeout;
    let basketTouched = false;
    if (basket) {
      if (basket.locationId === id) { basket.locationId = UNASSIGNED; basketTouched = true; }
      for (const line of basket.lines) {
        if (line.locationId === id) { line.locationId = UNASSIGNED; basketTouched = true; }
      }
    }
    for (const p of this.products) {
      if (p.locationId === id) { p.locationId = null; touched = true; }
      // A minimum for a place that no longer exists would keep a
      // product on the replenish list forever, short of a shelf nobody
      // can fill.
      if (p.min && p.min[id] !== undefined) {
        delete p.min[id];
        this.#writeMin(p, p.min);
        touched = true;
      }
      // And a shelf code inside a room that's gone names nowhere.
      if (p.bin && p.bin[id] !== undefined) {
        delete p.bin[id];
        this.#writeBin(p, p.bin);
        touched = true;
      }
      const held = stockAt(p, id);
      if (held > 0) {
        if (p.trackExpiry) {
          const taken = lotsAt(p, id);
          delete p.lots?.[id];
          this.#setStock(p, id, 0);
          this.#writeLots(p, UNASSIGNED, normalizeLots([...lotsAt(p, UNASSIGNED), ...taken]));
        } else {
          this.#setStock(p, id, 0);
          this.#setStock(p, UNASSIGNED, stockAt(p, UNASSIGNED) + held);
        }
        p.updatedAt = Date.now();
        this.#log({
          kind: 'move',
          productId: p.id,
          name: p.name,
          unit: normalizeUnit(p.unit),
          moved: held,
          quantity: p.quantity,
          locationId: null,
          locationName: name,
          toLocationId: null,
          toLocationName: UNASSIGNED_LABEL,
          note: `"${name}" deleted`,
        });
        moved = true;
        touched = true;
      }
    }
    this.#emit();
    const entries = [[KV.locations, this.locations]];
    if (basketTouched) entries.push([KV.takeout, basket]);
    if (touched || moved) await this.#saveStock(entries);
    else await this.#persistence.writeMany(entries);
  }

  /* ---------- Suppliers ---------- */

  supplierById(id) {
    return this.suppliers.find((s) => s.id === id) || null;
  }

  addSupplier(...args) {
    return this.#stockChange(() => this.#addSupplier(...args), ['suppliers']);
  }

  async #addSupplier(data) {
    const sup = {
      id: uid(),
      name: String(data.name || '').trim(),
      contact: String(data.contact || '').trim(),
      email: String(data.email || '').trim(),
      phone: String(data.phone || '').trim(),
      website: String(data.website || '').trim(),
      leadTimeDays: supplierLeadTime(data.leadTimeDays),
      minOrder: supplierMinOrder(data.minOrder),
      notes: String(data.notes || '').trim(),
      createdAt: Date.now(),
    };
    this.suppliers.push(sup);
    this.#emit();
    await this.#save('suppliers', this.suppliers);
    return sup;
  }

  updateSupplier(...args) {
    return this.#stockChange(() => this.#updateSupplier(...args), ['suppliers']);
  }

  async #updateSupplier(id, patch) {
    const s = this.supplierById(id);
    if (!s) throw new Error('Supplier not found');
    Object.assign(s, patch);
    this.#emit();
    await this.#save('suppliers', this.suppliers);
    return s;
  }

  /**
   * Products from a deleted supplier keep existing, just unassigned —
   * and the supplier leaves their source lists too. `supplierId` and
   * `sources` are two halves of one fact (see #repointSources), so a
   * list still naming a deleted supplier as its default left the row
   * reading "no supplier" while Reorder grouped the line under a
   * nameless heading and offered to order from a record that is gone.
   * Whoever is left on the list becomes the default; a product with
   * nobody left simply has no supplier.
   */
  deleteSupplier(...args) {
    return this.#stockChange(() => this.#deleteSupplier(...args), ['suppliers']);
  }

  async #deleteSupplier(id) {
    this.suppliers = this.suppliers.filter((s) => s.id !== id);
    let touched = false;
    for (const p of this.products) {
      if (p.supplierId === id) { p.supplierId = null; touched = true; }
      if (!p.sources?.some((s) => s.supplierId === id)) continue;
      // #writeSources re-points supplierId at whoever is preferred once
      // the dead entry is gone, keeping the two halves in step; the
      // codes and prices of the remaining sources survive untouched.
      this.#writeSources(p, p.sources.filter((s) => s.supplierId !== id));
      touched = true;
    }
    this.#emit();
    await this.#persistence.writeMany([
      [KV.suppliers, this.suppliers],
      ...(touched ? [[KV.products, this.products]] : []),
    ]);
  }

  /* ---------- Daily snapshots ---------- */

  /**
   * Record where the inventory stands today, for the value-over-time
   * chart. One row per day, refreshed while the day is still running,
   * and skipped entirely when nothing has changed — this runs on every
   * app open and shouldn't cost a write for it.
   */
  async recordSnapshot() {
    const stats = inventoryStats(this.products, this.settings.defaultLowStock);
    const row = {
      date: dateStamp(),
      products: stats.products,
      units: stats.units,
      value: stats.value,
      low: stats.low,
      out: stats.out,
    };
    if (sameSnapshot(this.snapshots[this.snapshots.length - 1], row)) return;
    this.snapshots = upsertSnapshot(this.snapshots, row);
    this.#emit();
    await this.#save('snapshots', this.snapshots).catch((err) => console.error('Snapshot failed', err));
  }

  /* ---------- Purchase orders ---------- */

  orderById(id) {
    return this.orders.find((o) => o.id === id) || null;
  }

  /** Orders placed and not yet fully resolved, newest first. */
  openOrders() {
    return this.orders.filter((o) => OPEN_ORDER_STATUSES.has(o.status)).sort((a, b) => (b.orderedAt || 0) - (a.orderedAt || 0));
  }

  /**
   * A reference no other order is already using. Local date: one dated
   * tomorrow because of UTC would be wrong on every piece of paper it
   * ends up on. Two orders the same day get -2, -3… — the reference is
   * what a delivery note is matched against, and what the history entry
   * for each received line says, so it has to name one order.
   */
  #nextReference(at) {
    const base = `PO-${dateStamp(new Date(at))}`;
    const taken = new Set(this.orders.map((o) => o.reference));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
    }
  }

  /**
   * Record that an order was placed. The lines carry the product's name,
   * SKU, and unit as they were, so the order still reads correctly after
   * a rename — and still shows something if a product is later deleted.
   */
  placeOrder(...args) {
    return this.#stockChange(() => this.#placeOrder(...args));
  }

  async #placeOrder({ supplierId = null, lines = [], reference = '' } = {}) {
    const rows = lines
      .map((l) => {
        const p = this.productById(l.productId);
        if (!p) return null;
        const qty = roundQty(l.qty, p.unit);
        if (qty <= 0) return null;
        // The supplier's own code and price, frozen as they were: the
        // paper goes to them, and receiving values the delivery at what
        // was agreed rather than at whatever the price list says later.
        const source = sourceFor(p, supplierId);
        return {
          productId: p.id,
          name: p.name,
          sku: p.sku || '',
          code: source?.code || '',
          unit: normalizeUnit(p.unit),
          qty,
          received: 0,
          ...(source?.price !== null && source?.price !== undefined ? { price: source.price } : {}),
        };
      })
      .filter(Boolean);
    if (!rows.length) throw new Error('Nothing to order');

    const now = Date.now();
    const order = {
      id: uid(),
      supplierId,
      supplierName: this.supplierById(supplierId)?.name || '',
      reference: String(reference || '').trim() || this.#nextReference(now),
      status: 'ordered',
      createdAt: now,
      orderedAt: now,
      receivedAt: null,
      lines: rows,
    };
    this.orders.unshift(order);
    this.#log({
      kind: 'order',
      name: `${order.reference}${order.supplierName ? `: ${order.supplierName}` : ''}`,
      note: `${rows.length} line${rows.length === 1 ? '' : 's'} ordered`,
    });
    this.#emit();
    await this.#saveStock([[KV.orders, this.orders]]);
    return order;
  }

  /**
   * Receive against an order, line by line. `arrived` is
   * [{ productId, qty }] in each product's own unit — what was actually
   * in the van, which may be less or more than ordered. Each amount
   * lands as normal stock at the product's usual location (or
   * `locationId`), noted with the order reference, and adds to the
   * line's running `received`. Lines still short keep the order open as
   * 'partial'; everything delivered closes it as 'received'.
   */
  receiveOrderLines(id, arrived = [], { locationId } = {}) {
    return this.#stockChange(() => this.#receiveOrderLines(id, arrived, { locationId }));
  }

  /** Serialize stock edits and restore optimistic state if no commit was saved. */
  #stockChange(change, sessionKeys = []) {
    const run = this.#stockChangeChain.then(async () => {
      const before = JSON.parse(JSON.stringify({ products: this.products, orders: this.orders,
        activity: this.activity, overflow: this.#overflow,
        sessions: Object.fromEntries(sessionKeys.map((key) => [key, this[key]])) }));
      try {
        return await change();
      } catch (err) {
        if (!err.committed) {
          for (const key of ['products', 'orders']) {
            const current = new Map(this[key].map((row) => [row.id, row]));
            this[key] = before[key].map((row) => {
              const target = current.get(row.id) || {};
              for (const field of Object.keys(target)) if (!Object.hasOwn(row, field)) delete target[field];
              return Object.assign(target, row);
            });
          }
          Object.assign(this, before.sessions);
          this.activity = before.activity;
          this.#overflow = before.overflow;
          this.#emit();
        }
        throw err;
      }
    });
    this.#stockChangeChain = run.catch(() => {});
    return run;
  }

  async #receiveOrderLines(id, arrived = [], { locationId } = {}) {
    const order = this.orderById(id);
    if (!order || !OPEN_ORDER_STATUSES.has(order.status)) throw new Error('Order not found');
    const now = Date.now();
    const wanted = new Map((arrived || []).map((a) => [a.productId, Number(a.qty) || 0]));
    // A line may state what it actually cost this time; without one the
    // price the order was placed at stands.
    const costs = new Map((arrived || []).filter((a) => a.cost !== undefined).map((a) => [a.productId, a.cost]));
    let received = 0;

    for (const line of order.lines) {
      const p = this.productById(line.productId);
      const qty = roundQty(wanted.get(line.productId) ?? 0, p?.unit);
      if (!p || !qty) continue;
      const totalBefore = Number(p.quantity) || 0;
      line.received = round3((Number(line.received) || 0) + qty);
      const loc = locationId === undefined ? defaultLocationId(p) : (locationId || UNASSIGNED);
      // Order receipts don't ask for dates; the lot lands undated and
      // a recount or the stock form can date what matters.
      if (p.trackExpiry) this.#writeLots(p, loc, addLot(lotsAt(p, loc), '', qty));
      else this.#setStock(p, loc, stockAt(p, loc) + qty);
      p.updatedAt = now;
      // What this delivery cost: the price the order was placed at, or
      // whatever the caller says arrived instead. It folds into the
      // moving average exactly as a receipt through the stock form does,
      // so ordering from a cheaper source shows up in the stock value.
      // A stated null is "don't revalue"; only a line that says nothing
      // at all falls back to the price the order was placed at.
      const paid = costs.has(line.productId)
        ? unitMoney(costs.get(line.productId))
        : unitMoney(line.price);
      if (paid !== null) {
        const oldCost = Number(p.cost) || 0;
        p.cost = totalBefore > 0
          ? round2((totalBefore * oldCost + qty * paid) / (totalBefore + qty))
          : paid;
      }
      this.#log({
        kind: 'add',
        productId: p.id,
        name: p.name,
        unit: normalizeUnit(p.unit),
        delta: qty,
        quantity: p.quantity,
        locationId: loc || null,
        locationName: this.locationName(loc),
        note: order.reference,
        ...(paid !== null ? { cost: paid } : {}),
      });
      received++;
    }

    // A line whose product was deleted can never arrive; it doesn't get
    // to hold the whole order open forever.
    const open = order.lines.some((l) => lineRemaining(l) > 0 && this.productById(l.productId));
    order.status = open ? 'partial' : 'received';
    order.receivedAt = open ? order.receivedAt ?? null : now;
    this.#emit();
    await this.#saveStock([[KV.orders, this.orders]]);
    return received;
  }

  /**
   * Receive everything still due on an order in one go — the common
   * all-arrived case, and the pre-partial-receiving behavior.
   */
  async receiveOrder(id, { locationId } = {}) {
    return this.#stockChange(() => {
      const order = this.orderById(id);
      if (!order || !OPEN_ORDER_STATUSES.has(order.status)) throw new Error('Order not found');
      const rest = order.lines
        .map((l) => ({ productId: l.productId, qty: lineRemaining(l) }))
        .filter((l) => l.qty > 0);
      return this.#receiveOrderLines(id, rest, { locationId });
    });
  }

  /**
   * Close an order whose remainder is never coming. Nothing about
   * stock changes: what arrived was received line by line, and what
   * didn't is recorded as undelivered instead of pretended in.
   */
  closeOrderShort(...args) {
    return this.#stockChange(() => this.#closeOrderShort(...args));
  }

  async #closeOrderShort(id) {
    const order = this.orderById(id);
    if (!order || !OPEN_ORDER_STATUSES.has(order.status)) throw new Error('Order not found');
    const short = order.lines.filter((l) => lineRemaining(l) > 0).length;
    order.status = 'closed';
    order.closedAt = Date.now();
    this.#log({
      kind: 'order',
      name: `${order.reference}${order.supplierName ? `: ${order.supplierName}` : ''}`,
      note: `Closed short; ${short} line${short === 1 ? '' : 's'} undelivered`,
    });
    this.#emit();
    await this.#saveStock([[KV.orders, this.orders]]);
    return order;
  }

  /**
   * Cancel an order that nothing has arrived against. The record stays,
   * marked cancelled, so the reference trail survives — history entries
   * and printed papers may still name it.
   */
  cancelOrder(...args) {
    return this.#stockChange(() => this.#cancelOrder(...args));
  }

  async #cancelOrder(id) {
    const order = this.orderById(id);
    if (!order || !OPEN_ORDER_STATUSES.has(order.status)) return;
    order.status = 'cancelled';
    order.cancelledAt = Date.now();
    this.#log({
      kind: 'order',
      name: `${order.reference}${order.supplierName ? `: ${order.supplierName}` : ''}`,
      note: 'Order cancelled',
    });
    this.#emit();
    await this.#saveStock([[KV.orders, this.orders]]);
  }

  /* ---------- Stocktake sessions ---------- */

  /**
   * Start a count. The session freezes the product list and expected
   * quantities for the scope now; counting can then pause and resume —
   * it persists under its own key — without losing progress. One
   * session at a time.
   */
  startStocktake(...args) {
    return this.#stockChange(() => this.#startStocktake(...args), ['stocktake']);
  }

  async #startStocktake({ locationId = null, category = '', blind = false, sortBy = 'name' } = {}) {
    if (this.stocktake) throw new Error('A stocktake is already in progress');
    const rows = buildStocktakeRows(this.products, { locationId, category });
    if (!rows.length) throw new Error('Nothing to count in that scope');
    const label = [
      locationId === null ? '' : this.locationName(locationId),
      category,
    ].filter(Boolean).join(' · ') || 'Everything';
    const now = Date.now();
    this.stocktake = {
      id: uid(),
      startedAt: now,
      updatedAt: now,
      scope: { locationId, category, label },
      blind: !!blind,
      // Sheet order: by name to read, by bin to walk. Kept on the
      // session so a reload mid-count resumes the same walk.
      sortBy: sortBy === 'bin' ? 'bin' : 'name',
      rows,
    };
    this.#emit();
    await this.#save('counts', this.stocktake);
    return this.stocktake;
  }

  /** Record one row's count; null clears it back to "not counted". */
  setStocktakeCount(...args) {
    return this.#stockChange(() => this.#setStocktakeCount(...args), ['stocktake']);
  }

  async #setStocktakeCount(productId, counted) {
    const row = this.stocktake?.rows.find((r) => r.productId === productId);
    if (!row) return;
    const value = counted === null || counted === undefined || counted === ''
      ? null
      : roundQty(Math.max(0, Number(counted) || 0), row.unit);
    if (row.counted === value) return;
    row.counted = value;
    this.stocktake.updatedAt = Date.now();
    this.#emit();
    await this.#save('counts', this.stocktake);
  }

  /** Flip the blind-count option mid-session. */
  setStocktakeBlind(...args) {
    return this.#stockChange(() => this.#setStocktakeBlind(...args), ['stocktake']);
  }

  async #setStocktakeBlind(blind) {
    if (!this.stocktake) return;
    this.stocktake.blind = !!blind;
    this.#emit();
    await this.#save('counts', this.stocktake);
  }

  /** Re-order the sheet mid-count: by name, or by the walk through the room. */
  setStocktakeSort(...args) {
    return this.#stockChange(() => this.#setStocktakeSort(...args), ['stocktake']);
  }

  async #setStocktakeSort(sortBy) {
    if (!this.stocktake) return;
    const mode = sortBy === 'bin' ? 'bin' : 'name';
    if (this.stocktake.sortBy === mode) return;
    this.stocktake.sortBy = mode;
    this.#emit();
    await this.#save('counts', this.stocktake);
  }

  /** Abandon the session; nothing about stock changes. */
  cancelStocktake(...args) {
    return this.#stockChange(() => this.#cancelStocktake(...args), ['stocktake']);
  }

  async #cancelStocktake() {
    if (!this.stocktake) return;
    this.stocktake = null;
    this.#emit();
    await this.#save('counts', null);
  }

  /**
   * Commit the session: every counted row becomes a recount adjustment
   * carrying the session reference, written in one pass after an
   * automatic snapshot. Uncounted rows are left untouched — skipped is
   * never zero. Returns how many products were adjusted.
   */
  applyStocktake() {
    return this.#stockChange(() => this.#applyStocktake(), ['stocktake', 'stocktakes']);
  }

  async #applyStocktake() {
    const session = this.stocktake;
    if (!session) throw new Error('No stocktake in progress');
    await this.saveSnapshot('stocktake');
    const now = Date.now();
    // Worked out before anything moves: the variances are measured
    // against what the app expected and valued at what the stock cost
    // when the count ran, which is what the record has to preserve.
    const variances = stocktakeVariances(session, this.products);
    const ref = `Stocktake ${dateStamp(new Date(session.startedAt))}${session.scope.label && session.scope.label !== 'Everything' ? `: ${session.scope.label}` : ''}`;
    const scopeLoc = session.scope.locationId;
    let adjusted = 0;

    for (const row of session.rows) {
      if (row.counted === null || row.counted === undefined) continue;
      const p = this.productById(row.productId);
      if (!p) continue;
      const counted = roundQty(Math.max(0, Number(row.counted) || 0), p.unit);
      let before;
      let loc = null;
      if (scopeLoc !== null && scopeLoc !== undefined) {
        // A located count states that bucket's absolute number.
        loc = scopeLoc;
        before = stockAt(p, loc);
        if (counted === before) continue;
        if (p.trackExpiry) this.#writeLots(p, loc, resizeLots(lotsAt(p, loc), counted));
        else this.#setStock(p, loc, counted);
      } else {
        // A whole-store count states the total; the difference lands in
        // the default bucket, draining others largest-first only when
        // the default can't absorb a shortfall.
        before = totalStock(p);
        if (counted === before) continue;
        this.#setTotalStock(p, counted);
        this.#syncLotsShape(p);
      }
      p.updatedAt = now;
      adjusted++;
      this.#log({
        kind: 'recount',
        productId: p.id,
        name: p.name,
        unit: normalizeUnit(p.unit),
        delta: round3(counted - before),
        quantity: p.quantity,
        locationId: loc || null,
        locationName: loc !== null ? this.locationName(loc) : undefined,
        note: ref,
      });
    }

    // The count itself is worth keeping, not just the adjustments it
    // made: everything the review screen showed used to be computed for
    // one screen and thrown away.
    const record = buildStocktakeRecord(session, variances, { at: now, adjusted });
    this.stocktakes = trimStocktakeHistory([record, ...this.stocktakes]);

    this.stocktake = null;
    this.#emit();
    await this.#saveStock([
      [KV.counts, null],
      [KV.stocktakes, this.stocktakes],
    ]);
    return adjusted;
  }

  /** One kept count, or null. */
  stocktakeRecord(id) {
    return this.stocktakes.find((r) => r.id === id) || null;
  }

  /**
   * Make a product's total equal `counted` without inventing locations:
   * growth goes to the default bucket, shrinkage drains buckets
   * largest-first until absorbed.
   */
  #setTotalStock(p, counted) {
    const before = totalStock(p);
    const delta = round3(counted - before);
    if (delta >= 0) {
      const home = defaultLocationId(p);
      this.#setStock(p, home, stockAt(p, home) + delta);
      return;
    }
    let need = -delta;
    for (const [loc, qty] of stockEntries(p)) {
      const take = Math.min(qty, need);
      this.#setStock(p, loc, qty - take);
      need = round3(need - take);
      if (need <= 0) break;
    }
  }

  /* ---------- Take-out sessions ---------- */

  /**
   * Start a basket. One at a time, like a count: two open baskets over
   * the same shelf would each promise stock the other is about to take.
   */
  startTakeout(...args) {
    return this.#stockChange(() => this.#startTakeout(...args), ['takeout']);
  }

  async #startTakeout({ reason = DEFAULT_TAKEOUT_REASON, locationId = null, note = '' } = {}) {
    if (this.takeout) return this.takeout;
    const now = Date.now();
    this.takeout = {
      id: uid(),
      startedAt: now,
      updatedAt: now,
      reason: isRemovalReason(reason) ? reason : DEFAULT_TAKEOUT_REASON,
      locationId: typeof locationId === 'string' ? locationId : null,
      note: String(note || '').trim(),
      lines: [],
    };
    this.#emit();
    await this.#save('takeout', this.takeout);
    return this.takeout;
  }

  /** What the whole basket leaves under, unless a line says otherwise. */
  setTakeoutDefaults(...args) {
    return this.#stockChange(() => this.#setTakeoutDefaults(...args), ['takeout']);
  }

  async #setTakeoutDefaults({ reason, locationId, note } = {}) {
    const session = this.takeout;
    if (!session) return null;
    if (reason !== undefined && isRemovalReason(reason)) session.reason = reason;
    if (locationId !== undefined) session.locationId = typeof locationId === 'string' ? locationId : null;
    if (note !== undefined) session.note = String(note || '').trim();
    session.updatedAt = Date.now();
    this.#emit();
    await this.#save('takeout', session);
    return session;
  }

  /**
   * Put a product in the basket, or add to the line it already has —
   * which is what makes a second scan of the same item count two rather
   * than opening a second row for it. Returns the line.
   */
  addToTakeout(...args) {
    return this.#stockChange(() => this.#addToTakeout(...args), ['takeout']);
  }

  async #addToTakeout(productId, { qty = 1 } = {}) {
    const session = this.takeout || await this.#startTakeout();
    const product = this.productById(productId);
    if (!product) throw new Error('Product not found');
    const existing = takeoutLineFor(session, productId);
    if (existing) {
      existing.qty = roundQty((Number(existing.qty) || 0) + (Number(qty) || 0), product.unit);
      // A cleared quantity that rounds to nothing would leave a row
      // asking for zero units; the line is at least one of whatever it
      // measures in.
      if (!existing.qty) existing.qty = roundQty(qty, product.unit);
    } else {
      session.lines.unshift(buildTakeoutLine(product, { id: uid(), qty }));
    }
    session.updatedAt = Date.now();
    this.#emit();
    await this.#save('takeout', session);
    return takeoutLineFor(session, productId);
  }

  /**
   * A scanned code straight into the basket: the line it belongs to goes
   * up by one, an unknown-to-the-basket product joins it. Returns the
   * line, or null when the code names nothing in the account.
   */
  scanIntoTakeout(...args) {
    return this.#stockChange(() => this.#scanIntoTakeout(...args), ['takeout']);
  }

  async #scanIntoTakeout(code) {
    const session = this.takeout;
    const known = session ? takeoutLineByCode(session, code) : null;
    const product = known ? this.productById(known.productId) : this.productByCode(code);
    if (!product) return null;
    return this.#addToTakeout(product.id, { qty: 1 });
  }

  /** Edit one line: quantity, price, or its own reason/location/note. */
  setTakeoutLine(...args) {
    return this.#stockChange(() => this.#setTakeoutLine(...args), ['takeout']);
  }

  async #setTakeoutLine(lineId, patch = {}) {
    const session = this.takeout;
    const line = session?.lines.find((l) => l.id === lineId);
    if (!line) return null;
    const product = this.productById(line.productId);
    if (patch.qty !== undefined) {
      line.qty = roundQty(Math.max(0, Number(patch.qty) || 0), product?.unit ?? line.unit);
    }
    if (patch.price !== undefined) {
      line.price = unitMoney(patch.price);
    }
    if (patch.reason !== undefined) {
      line.reason = isRemovalReason(patch.reason) ? patch.reason : '';
    }
    if (patch.locationId !== undefined) {
      line.locationId = typeof patch.locationId === 'string' ? patch.locationId : null;
    }
    if (patch.note !== undefined) line.note = String(patch.note || '').trim();
    session.updatedAt = Date.now();
    this.#emit();
    await this.#save('takeout', session);
    return line;
  }

  /** Take a line back out of the basket. */
  removeTakeoutLine(...args) {
    return this.#stockChange(() => this.#removeTakeoutLine(...args), ['takeout']);
  }

  async #removeTakeoutLine(lineId) {
    const session = this.takeout;
    if (!session) return;
    const before = session.lines.length;
    session.lines = session.lines.filter((l) => l.id !== lineId);
    if (session.lines.length === before) return;
    session.updatedAt = Date.now();
    this.#emit();
    await this.#save('takeout', session);
  }

  /** Abandon the basket; nothing about stock changes. */
  cancelTakeout(...args) {
    return this.#stockChange(() => this.#cancelTakeout(...args), ['takeout']);
  }

  async #cancelTakeout() {
    if (!this.takeout) return;
    this.takeout = null;
    this.#emit();
    await this.#save('takeout', null);
  }

  /**
   * Commit the basket: one snapshot, one `remove` per line, one products
   * write — the same shape as applyStocktake. Every entry carries the
   * same reference, so History reads a day's till as one event rather
   * than a wall of unrelated removals.
   *
   * A line asking for more than its location holds takes what is there;
   * stock never goes negative, and the entry records what actually left.
   *
   * Returns an undo token: enough to put every unit back where it came
   * from — dated lots included — and to retract the entries, so the
   * commit toast can undo the whole session rather than line by line.
   */
  applyTakeout() {
    return this.#stockChange(() => this.#applyTakeout(), ['takeout']);
  }

  async #applyTakeout() {
    const session = this.takeout;
    if (!session) throw new Error('No take-out in progress');
    if (!session.lines.length) throw new Error('Nothing in the basket');
    await this.saveSnapshot('takeout');
    const now = Date.now();
    const ref = takeoutRef(session);
    const undone = [];
    const activityIds = [];
    let committed = 0;

    for (const line of session.lines) {
      const p = this.productById(line.productId);
      if (!p) continue;
      const reason = takeoutReason(session, line);
      const price = takeoutPrice(session, line);
      const note = takeoutNote(session, line);
      const lineNote = note ? `${ref}: ${note}` : ref;
      const wanted = roundQty(Math.max(0, Number(line.qty) || 0), p.unit);
      if (!wanted) continue;

      /* A sell-as-kit holds no stock of its own, so there is no bucket
         here to take one out of: its components leave instead, exactly
         as they do through the stock dialog. Without this the basket
         happily scanned, priced and reviewed a breakfast set and then
         took nothing out at all — or refused the whole basket when it
         was the only line. */
      if (kitMode(p) === 'sell') {
        // Earlier basket lines have already reserved their components.
        const fulfilled = Math.min(wanted, buildableQty(p, this.products));
        if (!fulfilled) continue;
        const parts = componentsFor(p, fulfilled, this.products);
        let took = false;
        for (const part of parts) {
          const component = this.productById(part.productId);
          if (!component) continue;
          const res = this.#takeComponent(component, part.qty, {
            note: lineNote, reason, at: now, kitId: p.id,
          });
          if (res.took > 0) took = true;
          undone.push(...res.from);
          activityIds.push(...res.activityIds);
        }
        if (!took) continue;
        p.updatedAt = now;
        // The kit's own entry carries the money with a stock figure of
        // zero, because there is no stock of it to move — which is what
        // "sell as a kit" means. Its cost is what its parts cost, since
        // it has no moving average of its own.
        const entry = this.#log({
          kind: 'remove',
          productId: p.id,
          name: p.name,
          unit: normalizeUnit(p.unit),
          delta: -fulfilled,
          quantity: 0,
          locationId: null,
          locationName: UNASSIGNED_LABEL,
          note: lineNote,
          reason,
          ...(price !== null ? { price, cost: kitUnitCost(p, this.products) } : {}),
        });
        activityIds.push(entry.id);
        committed++;
        continue;
      }

      const loc = takeoutLocation(session, line, p);
      const available = stockAt(p, loc);
      const taken = roundQty(Math.min(wanted, available), p.unit);
      if (!taken) continue;
      let lots = null;
      if (p.trackExpiry) {
        // FEFO, and the lots that actually left are remembered so undo
        // can put back the same dates rather than undated stock.
        const res = consumeLots(lotsAt(p, loc), taken);
        lots = res.taken;
        this.#writeLots(p, loc, res.lots);
      } else {
        this.#setStock(p, loc, available - taken);
      }
      p.updatedAt = now;
      const entry = this.#log({
        kind: 'remove',
        productId: p.id,
        name: p.name,
        unit: normalizeUnit(p.unit),
        delta: -taken,
        quantity: p.quantity,
        locationId: loc || null,
        locationName: this.locationName(loc),
        note: lineNote,
        reason,
        ...(price !== null ? { price, cost: round2(Number(p.cost) || 0) } : {}),
      });
      activityIds.push(entry.id);
      undone.push({ productId: p.id, locationId: loc, qty: taken, lots });
      committed++;
    }

    if (!undone.length) throw new Error('Nothing in the basket could be taken out');

    this.takeout = null;
    this.#emit();
    await this.#saveStock([[KV.takeout, null]]);
    // `lines` is what an undo has to put back, which for a kit line is
    // one entry per component bucket; `count` is how many basket lines
    // actually went out, which is what the toast is counting.
    return { ref, lines: undone, activityIds, session, count: committed };
  }

  /**
   * Put a committed basket back: every unit returns to the bucket it
   * left, with the dates it left under, and the entries it wrote are
   * retracted — an undone take-out leaves no trace in the history, the
   * same contract undoDelete keeps.
   *
   * The basket itself comes back too when nothing else is in progress,
   * so a mistake can be fixed and re-committed instead of re-scanned.
   */
  undoTakeout(...args) {
    return this.#stockChange(() => this.#undoTakeout(...args), ['takeout']);
  }

  async #undoTakeout(token) {
    if (!token?.lines?.length) return;
    await this.#retractActivity(token.activityIds);
    const now = Date.now();
    for (const { productId, locationId, qty, lots } of token.lines) {
      const p = this.productById(productId);
      if (!p) continue;
      if (p.trackExpiry && lots?.length) {
        this.#writeLots(p, locationId, normalizeLots([...lotsAt(p, locationId), ...lots]));
      } else {
        this.#setStock(p, locationId, stockAt(p, locationId) + qty);
        if (p.trackExpiry) this.#syncLotsShape(p);
      }
      p.updatedAt = now;
    }
    const restored = !this.takeout && token.session ? token.session : null;
    if (restored) this.takeout = restored;
    this.#emit();
    await Promise.all([
      this.#save('products', this.products),
      this.#saveActivity(),
      ...(restored ? [this.#save('takeout', restored)] : []),
    ]);
    return restored;
  }

  /* ---------- CSV import ---------- */

  #ensureLocation(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    let loc = this.locations.find((l) => l.name.toLowerCase() === n.toLowerCase());
    if (!loc) {
      loc = { id: uid(), name: n, note: '', createdAt: Date.now() };
      this.locations.push(loc);
    }
    return loc.id;
  }

  #ensureSupplier(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    let sup = this.suppliers.find((s) => s.name.toLowerCase() === n.toLowerCase());
    if (!sup) {
      sup = {
        id: uid(), name: n, contact: '', email: '', phone: '', website: '',
        leadTimeDays: null, minOrder: null, notes: '', createdAt: Date.now(),
      };
      this.suppliers.push(sup);
    }
    return sup.id;
  }

  /**
   * Lead time and minimum from an import row land on the product's
   * supplier. Only readable values write — the row is about a product,
   * and a blank supplier cell must not erase what the supplier record
   * already knows.
   */
  #applySupplierDetails(supplierId, draft = {}) {
    const sup = this.supplierById(supplierId);
    if (!sup) return;
    if (draft.supplierLeadTime !== null && draft.supplierLeadTime !== undefined) {
      sup.leadTimeDays = supplierLeadTime(draft.supplierLeadTime);
    }
    if (draft.supplierMinOrder !== null && draft.supplierMinOrder !== undefined) {
      sup.minOrder = supplierMinOrder(draft.supplierMinOrder);
    }
  }

  /**
   * Put imported amounts into buckets. `list` is [{ name, qty }] with an
   * empty name meaning the product's own location; 'set' replaces the
   * whole map, 'add' tops each bucket up.
   */
  #applyImportedStock(p, list, mode = 'set') {
    if (!list?.length) return;
    // A sell-as-kit holds no stock of its own, whatever a file says: a
    // quantity landed here sat in its buckets for ever — counted into
    // the stock value, exported back out, and reachable by nothing
    // that could take it out again, since every path that removes
    // stock from such a kit takes its components instead. The merge
    // may already have copied the file's number onto the cached total;
    // the buckets are the truth, so it goes back to what they say.
    if (kitMode(p) === 'sell') {
      p.quantity = totalStock(p);
      return;
    }
    if (mode === 'set') {
      p.stock = {};
      p.quantity = 0;
    }
    for (const entry of list) {
      const amount = Number(entry.qty) || 0;
      if (amount <= 0) continue;
      const key = entry.unassigned
        ? UNASSIGNED
        : (entry.name ? this.#ensureLocation(entry.name) : (p.locationId || UNASSIGNED));
      this.#setStock(p, key, stockAt(p, key) + amount);
    }
    // Imported quantities carry no dates; tracked products keep their
    // lots resized to the new buckets (growth undated, shrinkage FEFO).
    this.#syncLotsShape(p);
  }

  /**
   * Put imported shelf codes on a product: a breakdown by place when the
   * file carries one, else the single Bin cell at the product's own
   * location. A stated blank clears the code there, which is how a
   * spreadsheet says "not on that shelf any more".
   */
  #applyImportedBins(p, draft) {
    if (draft.bins !== undefined && Array.isArray(draft.bins)) {
      const map = {};
      for (const entry of draft.bins) {
        const key = entry.unassigned ? UNASSIGNED : (entry.name ? this.#ensureLocation(entry.name) : (p.locationId || UNASSIGNED));
        if (entry.code) map[key] = entry.code;
      }
      this.#writeBin(p, map);
      return;
    }
    if (draft.bin === undefined) return;
    const key = p.locationId || UNASSIGNED;
    const map = { ...binMap(p) };
    if (String(draft.bin).trim()) map[key] = String(draft.bin).trim();
    else delete map[key];
    this.#writeBin(p, map);
  }

  /**
   * Apply reviewed import drafts. Location and supplier names are
   * resolved to records (created on first sight). Returns the merge
   * summary { created, updated, skipped } with counts for the toast.
   */
  applyImport(drafts, mode = 'update') {
    return this.#stockChange(() => this.#applyImport(drafts, mode), ['locations', 'suppliers']);
  }

  async #applyImport(drafts, mode = 'update') {
    await this.saveSnapshot('import');
    const { created, updated, skipped } = mergeImport(this.products, drafts, mode);
    const now = Date.now();

    for (const d of created) {
      const product = {
        id: uid(),
        name: d.name,
        sku: d.sku || '',
        barcode: d.barcode || '',
        category: d.category || '',
        unit: normalizeUnit(d.unit),
        packSize: Math.max(0, Number(d.packSize) || 0),
        packName: String(d.packName || '').trim(),
        stock: {},
        quantity: 0,
        locationId: this.#ensureLocation(d.locationName),
        supplierId: this.#ensureSupplier(d.supplierName),
        cost: Math.max(0, round2(Number(d.cost) || 0)),
        price: d.price === null || d.price === undefined ? null : Math.max(0, round2(d.price)),
        lowStock: d.lowStock === null || d.lowStock === undefined ? null : Math.max(0, d.lowStock),
        reorderQty: d.reorderQty === null || d.reorderQty === undefined ? null : Math.max(0, d.reorderQty) || null,
        notes: d.notes || '',
        archived: d.archived === true,
        createdAt: now,
        updatedAt: now,
      };
      // Duplicate in-file rows collapse into one draft carrying every
      // row's buckets in stockByName; a single row states its stock
      // directly.
      this.#applyImportedStock(product, d.stockByName ?? importedStock(d), 'set');
      this.#applyImportedBins(product, d);
      this.#applySupplierDetails(product.supplierId, d);
      this.products.unshift(product);
    }

    for (const u of updated) {
      const p = this.productById(u.id);
      if (!p) continue;
      const {
        locationName, supplierName, stockByName, stockMode,
        supplierLeadTime, supplierMinOrder, bin, bins, ...fields
      } = u;
      const wasUnit = normalizeUnit(p.unit);
      Object.assign(p, fields, {
        updatedAt: now,
        locationId: locationName ? this.#ensureLocation(locationName) : p.locationId,
        supplierId: supplierName ? this.#ensureSupplier(supplierName) : p.supplierId,
      });
      for (const key of ['locationName', 'supplierName', 'stockByName', 'stockMode', 'supplierLeadTime', 'supplierMinOrder', 'bins']) delete p[key];
      this.#applyImportedBins(p, { bin, bins });
      // The row named a supplier; the product's own source list has to
      // follow, the same as it does through every other edit path.
      if (supplierName) this.#repointSources(p, p.supplierId);
      this.#applySupplierDetails(p.supplierId, { supplierLeadTime, supplierMinOrder });
      // A file that re-measures a product (kg → each) re-rounds what's on
      // hand, before anything the file adds on top of it.
      if (normalizeUnit(p.unit) !== wasUnit) this.#reroundStock(p);
      if (stockByName) this.#applyImportedStock(p, stockByName, stockMode);
    }

    if (created.length || updated.length) {
      this.#log({ kind: 'import', name: `${created.length} added, ${updated.length} updated`, quantity: null });
    }
    this.#emit();
    await this.#saveStock([
      [KV.locations, this.locations],
      [KV.suppliers, this.suppliers],
    ]);
    return { created: created.length, updated: updated.length, skipped };
  }

  /* ---------- Bulk (sample data, wipe) ---------- */

  /**
   * Install a full dataset (sample data, backup restore). Archived
   * activity is replaced too: leaving old buckets behind would show a
   * history that belongs to data no longer here.
   *
   * Products go through the same migration as a boot-time read: a backup
   * written before per-location stock carries only quantity/locationId,
   * and installing it without buckets would zero the very stock the file
   * was keeping safe on the first adjustment after the restore.
   */
  importAll(...args) {
    return this.#stockChange(() => this.#importAll(...args), ['settings', 'families', 'locations', 'suppliers', 'stocktake', 'stocktakes', 'takeout', 'snapshots', 'archives']);
  }

  async #importAll({ settings = {}, products = [], families = [], locations = [], suppliers = [], activity = [], orders = [], snapshots = [], stocktakes = [], archives = null }) {
    this.settings = { ...this.settings, ...settings };
    this.products = products.map(migrateProduct);
    this.families = Array.isArray(families) ? families : [];
    this.locations = locations;
    this.suppliers = suppliers;
    this.activity = activity;
    this.orders = Array.isArray(orders) ? orders.map(migrateOrder) : [];
    // A count in progress froze rows for data that just got replaced,
    // and a basket names products that may no longer exist.
    this.stocktake = null;
    this.stocktakes = trimStocktakeHistory(Array.isArray(stocktakes) ? stocktakes : []);
    this.takeout = null;
    this.snapshots = Array.isArray(snapshots) ? snapshots : [];
    this.#emit();
    await this.#replaceData([
      [KV.settings, this.settings],
      [KV.products, this.products],
      [KV.families, this.families],
      [KV.locations, this.locations],
      [KV.suppliers, this.suppliers],
      [KV.activity, this.activity],
      [KV.orders, this.orders],
      [KV.counts, null],
      [KV.stocktakes, this.stocktakes],
      [KV.takeout, null],
      [KV.snapshots, this.snapshots],
    ], archives);
  }

  /**
   * Remove all inventory data; settings (minus sample flag) survive.
   * Snapshots first, unless the caller knows the data is disposable
   * (wiping sample data would only evict a real snapshot).
   */
  wipeAll(...args) {
    return this.#stockChange(() => this.#wipeAll(...args), ['settings', 'families', 'locations', 'suppliers', 'stocktake', 'stocktakes', 'takeout', 'snapshots', 'archives']);
  }

  async #wipeAll({ snapshot = true } = {}) {
    if (snapshot) await this.saveSnapshot('erase');
    // Only disposable data (a sample wipe) takes its photos with it.
    // When a snapshot was kept, the pictures stay: the snapshot holds
    // paths, not image bytes, and "you can restore afterwards" has to
    // include the photos — a few orphaned files are cheaper than losing
    // every picture behind an erase the user then undoes.
    const photos = snapshot ? [] : this.products.filter((p) => p.imagePath);
    this.products = [];
    this.families = [];
    this.locations = [];
    this.suppliers = [];
    this.activity = [];
    this.orders = [];
    this.stocktake = null;
    this.stocktakes = [];
    this.takeout = null;
    this.snapshots = [];
    this.settings = { ...this.settings, sampleData: false };
    this.#emit();
    await this.#replaceData([
      [KV.settings, this.settings],
      [KV.products, this.products],
      [KV.families, this.families],
      [KV.locations, this.locations],
      [KV.suppliers, this.suppliers],
      [KV.activity, this.activity],
      [KV.orders, this.orders],
      [KV.counts, null],
      [KV.stocktakes, this.stocktakes],
      [KV.takeout, null],
      [KV.snapshots, this.snapshots],
    ], null);
    await Promise.allSettled(photos.map((p) => deletePhoto(p)));
  }

  /* ---------- Automatic snapshots ---------- */

  /** Is there anything worth snapshotting? */
  get hasData() {
    return !!(this.products.length || this.locations.length || this.suppliers.length
      || this.activity.length || this.archives.length || this.orders.length || this.stocktakes.length);
  }

  /**
   * Store a full copy under its own KV key before a destructive step
   * (erase, CSV import, restore), keeping the newest few. Both the payload
   * and its recovery manifest must be persisted before proceeding.
   */
  async saveSnapshot(reason = 'auto') {
    if (!this.hasData) return null;
    const entry = { id: uid(), at: Date.now(), reason, counts: backupCounts(this) };
    try {
      await kvSetConfirmed(snapshotKey(entry.id), buildBackup(this, entry.at, await this.loadAllArchives()));
      const dropped = [entry, ...this.backups].slice(AUTO_SNAPSHOT_MAX);
      const backups = [entry, ...this.backups].slice(0, AUTO_SNAPSHOT_MAX);
      await kvSetConfirmed(KV.backups, backups);
      this.backups = backups;
      // Evicted snapshots are dead weight in the account; deleting them
      // is housekeeping, so a missing kv.del is not an error.
      for (const old of dropped) {
        try { await kvDel(snapshotKey(old.id)); } catch {}
      }
      this.#emit();
      return entry;
    } catch (err) {
      throw new Error('Could not save the safety snapshot. Your data has not been replaced.', { cause: err });
    }
  }

  /** Newest automatic snapshot, or null. */
  latestSnapshot() {
    return this.backups[0] || null;
  }

  /** Read a stored snapshot back; null when it's gone or unreadable. */
  async readSnapshot(id) {
    const raw = await kvGet(snapshotKey(id)).catch(() => null);
    const res = validateBackup(raw);
    return res.ok ? res.data : null;
  }

  /**
   * Replace every collection with a validated backup body, keeping a
   * snapshot of what was there first so a wrong restore is recoverable.
   */
  restoreBackup(...args) {
    return this.#stockChange(() => this.#restoreBackup(...args), ['settings', 'families', 'locations', 'suppliers', 'stocktake', 'stocktakes', 'takeout', 'snapshots', 'archives']);
  }

  async #restoreBackup(data) {
    await this.saveSnapshot('restore');
    await this.#importAll({ ...data, settings: { ...data.settings, sampleData: false } });
  }
}

export const store = new Store();
