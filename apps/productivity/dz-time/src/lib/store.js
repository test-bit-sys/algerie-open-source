/**
 * Data layer on top of Puter.
 *
 * Storage design, chosen for cost/scale characteristics:
 *
 *  KV (small, hot, single-key reads, never kv.list() scans):
 *    hourly:settings:v1  { currency, defaultRate, rounding, weekStart, theme,
 *                          onboarded, sampleData }
 *    hourly:clients:v1   [{ id, name, slot, rate (number, dated list, or
 *                          null), currency (or null = the global
 *                          default), billing rules (rounding, taxRate,
 *                          paymentTermsDays, minimumMinutes; null = the
 *                          global default), archived, createdAt }]
 *    hourly:projects:v1  [{ id, clientId, name, rate, billable, archived,
 *                          budget: { kind 'hours'|'amount', value,
 *                                    period 'total'|'monthly' } | null,
 *                          createdAt }]
 *    hourly:months:v1    ["2026-08", ...]   (index of month files)
 *    hourly:timer:v1     { startedAt, projectId, task, notes, billable } | null
 *
 *  FS (bulky, grows unbounded, one JSON file per month):
 *    hourly-data/entries-YYYY-MM.json  [entry, ...]
 *    hourly-data/logo-<ms>.<ext>       invoice logo (one file per upload,
 *                                      never overwritten: issued invoices
 *                                      point at the file they were issued
 *                                      with, so a rebrand cannot rewrite
 *                                      an old invoice's header)
 *
 *  Entry: { id, date "YYYY-MM-DD", projectId, task, notes, seconds,
 *           startedAt / endedAt (clock times in ms, or null: optional,
 *           and never the source of truth for billing — `seconds` is),
 *           billable, rate (override or null), invoicedAt (ms or null),
 *           lockedRate (rate frozen at invoicing, or null),
 *           lockedRounding (rounding minutes frozen at invoicing, or null),
 *           lockedMinimum (minimum billable minutes frozen at invoicing),
 *           lockedCurrency (currency frozen at invoicing, or null),
 *           createdAt, updatedAt }
 *
 *  Reads scale with the months you look at, not with total entries,
 *  and no KV listing is ever required.
 *
 *  One account, several devices: every document is written whole, so each
 *  write reconciles with the server copy first (by record id, newest write
 *  winning) instead of overwriting it, and refresh() pulls the other
 *  device's work in. See "reconciling two copies of the same list" below
 *  for how deletes stay deleted.
 */

import { uid, round2, sum, textMatches } from './util.js';
import { monthKeyOf, monthDays, isoOf, addDays, daysApart, todayISO, roundSeconds, toHours } from './time.js';
import { offline, isNetworkError } from './offline.js';

/* ---------- effective-dated rates ----------
   A rate on a client, project, or the default is either a plain number
   ("always this rate", the historical shape) or a list of periods
   [{ from: 'YYYY-MM-DD' | null, rate }], where a null `from` means
   "since the beginning". Resolution picks the period in effect on a
   given date; a date before every period falls through to the next
   level of the cascade. A period whose `rate` is null means "no rate of
   my own from here on", so it falls through the same way. Per-entry
   overrides stay plain numbers. */

/** The rate a number-or-period-list yields on `date`, or null. */
export function rateAt(value, dateISO) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  let best = null;
  for (const p of value) {
    if (p.from && dateISO < p.from) continue;
    if (best == null || (p.from || '') >= (best.from || '')) best = p;
  }
  return best ? best.rate : null;
}

/**
 * Merge one rate edit into an effective-dated value. `from` null edits
 * the period in effect today in place (the historical behavior); a date
 * starts a new period that day (or updates the one already starting
 * then). A null `rate` without a date clears the whole history; with a
 * date it starts a "no rate of my own" period there, which is the only
 * honest way to stop billing at this level without repricing the earlier
 * work the date was chosen to protect. Single always-periods collapse
 * back to a plain number so untouched data keeps its shape.
 */
export function withRateFrom(current, rate, from = null) {
  if (rate == null && from == null) return null;
  const list = current == null ? []
    : typeof current === 'number' ? [{ from: null, rate: current }]
      : current.map((p) => ({ ...p }));
  if (from == null) {
    if (!list.length) return rate;
    // The period a today-dated entry resolves to is the one edited.
    const today = todayISO();
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i].from && today < list[i].from) continue;
      if (idx === -1 || (list[i].from || '') >= (list[idx].from || '')) idx = i;
    }
    if (idx === -1) idx = 0; // every period starts in the future: edit the earliest
    list[idx].rate = rate;
  } else {
    const existing = list.findIndex((p) => p.from === from);
    if (existing !== -1) list[existing].rate = rate;
    else list.push({ from, rate });
  }
  list.sort((a, b) => (a.from || '').localeCompare(b.from || ''));
  // A history that never names a rate is just no rate at all; storing the
  // empty periods would only make the cascade harder to read.
  if (list.every((p) => p.rate == null)) return null;
  if (list.length === 1 && list[0].from == null) return list[0].rate;
  return list;
}

/** Periods of a rate value for display, oldest first (empty for none). */
export function ratePeriods(value) {
  if (value == null) return [];
  if (typeof value === 'number') return [{ from: null, rate: value }];
  return value.slice().sort((a, b) => (a.from || '').localeCompare(b.from || ''));
}

const KV = {
  settings: 'hourly:settings:v1',
  clients: 'hourly:clients:v1',
  projects: 'hourly:projects:v1',
  months: 'hourly:months:v1',
  timer: 'hourly:timer:v1',
  backups: 'hourly:backups:v1',
  invoices: 'hourly:invoices:v1',
};

/* Which KV documents are id-keyed lists, and the store field each one
   lives in: the two facts every reconciliation needs. */
const LIST_PROP = {
  'hourly:clients:v1': 'clients',
  'hourly:projects:v1': 'projects',
  'hourly:invoices:v1': 'invoices',
};

const DATA_DIR = 'hourly-data';
const monthPath = (key) => `${DATA_DIR}/entries-${key}.json`;
const backupPath = (date) => `${DATA_DIR}/backups/backup-${date}.json`;
const BACKUP_KEEP = 8;

/* Logos are content the user replaces, not edits: every upload gets its
   own file so an issued invoice's snapshotted path keeps resolving to the
   logo it was issued with. Nothing deletes an old one for the same reason
   (a few kilobytes against a rewritten billing record is no trade at
   all). The extension is picked from the stored blob's type, never from
   the file the user chose, so no name from outside reaches a path. */
const LOGO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const logoPath = (stamp, ext) => `${DATA_DIR}/logo-${stamp}.${ext}`;

/* ---------- reconciling two copies of the same list ----------
   One Puter account, several devices: the phone tracks, the laptop
   reviews. Every document here is written whole, so a stale copy used to
   overwrite whatever the other device had done. Reconciliation is per
   record, by id, newest write winning, with one extra piece of knowledge
   that makes deletes work: `base`, the ids this device last saw on the
   server. A record missing here but present there was deleted locally if
   it is in `base`, and is new there if it is not; a record present here
   but missing there was deleted remotely if it is in `base`, and is new
   here if it is not. Without `base` (a device that has never reached the
   server for this document) nothing is ever dropped: resurrecting a
   deleted row is a nuisance, losing a new one is not recoverable. */

/** When a record was last written, for newest-wins. */
function recordStamp(r) {
  return Number(r?.updatedAt ?? r?.createdAt ?? 0) || 0;
}

/**
 * The stamp a write to `record` carries: now, or a tick past whatever the
 * record already claims. Newest-wins is the whole of the reconciliation
 * rule, so a record stamped ahead of this clock could not be edited at
 * all — the merge kept the stored copy and the edit disappeared while the
 * UI reported success. Records do arrive stamped ahead: a device whose
 * clock runs a few minutes fast, or a file that filled the field in with
 * something other than a write time. An edit happened after the version it
 * edited by definition, so it says so, and nothing else about newest-wins
 * changes: a device editing a copy it has not caught up with still stamps
 * plain now and still loses.
 */
function stampFor(record) {
  return Math.max(Date.now(), (Number(record?.updatedAt) || 0) + 1);
}

/** Of two versions of one record, the one written last (ties keep local). */
function newerRecord(local, remote) {
  return recordStamp(remote) > recordStamp(local) ? remote : local;
}

/**
 * Merge two lists of id-carrying records. Returns { list, changed } where
 * `changed` counts the records this device did not already have in that
 * state, so a quiet "picked up N changes" can be honest about N.
 */
export function mergeById(local, remote, base = null) {
  const localList = Array.isArray(local) ? local : [];
  const remoteList = Array.isArray(remote) ? remote : [];
  const byId = new Map(localList.map((r) => [r.id, r]));
  const out = [];
  const handled = new Set();
  let changed = 0;

  for (const r of remoteList) {
    if (!r?.id) continue;
    handled.add(r.id);
    const mine = byId.get(r.id);
    if (mine) {
      const winner = newerRecord(mine, r);
      if (winner !== mine) changed += 1;
      out.push(winner);
    } else if (base && base.has(r.id)) {
      // Deleted here since the last time this device saw the server.
      changed += 1;
    } else {
      out.push(r);
      changed += 1;
    }
  }
  for (const mine of localList) {
    if (!mine?.id || handled.has(mine.id)) continue;
    // Deleted on the other device, or created here since; only `base`
    // tells the two apart.
    if (base && base.has(mine.id)) changed += 1;
    else out.push(mine);
  }
  return { list: out, changed };
}

const idSet = (list) => new Set((list || []).map((r) => r?.id).filter(Boolean));

/* ---------- manual invoice lines ----------
   An invoice is not only tracked time: real ones carry a fixed fee, a
   pass-through expense, or a discount. Those are stored as explicit lines
   on the invoice record and frozen with the rest of it, while time lines
   stay derived from the entries the invoice locked. A discount is simply a
   negative amount, so there is no second concept to maintain. */

const LINE_KINDS = ['fee', 'expense', 'discount'];
const LINE_FALLBACK_LABEL = { fee: 'Fixed fee', expense: 'Expense', discount: 'Discount' };

/**
 * Clean up lines coming from the create sheet: a known kind, a label, a
 * positive quantity, and an amount that is negative exactly when the line
 * is a discount. Lines worth nothing are dropped, because a zero line
 * prints noise and bills nothing. `amount` is stored rather than derived
 * so the frozen record cannot drift by a rounding step later.
 */
export function normalizeInvoiceLines(lines) {
  const out = [];
  for (const l of lines || []) {
    const kind = LINE_KINDS.includes(l?.kind) ? l.kind : 'fee';
    const label = String(l?.label ?? '').trim().slice(0, 120) || LINE_FALLBACK_LABEL[kind];
    // A discount is one deduction, never a quantity of them.
    const quantity = kind === 'discount' ? 1
      : (Number(l?.quantity) > 0 ? round2(Number(l.quantity)) : 1);
    const unit = round2(Number(l?.unitAmount) || 0);
    const unitAmount = kind === 'discount' ? -Math.abs(unit) : unit;
    const amount = round2(quantity * unitAmount);
    if (!amount) continue;
    out.push({ id: uid(), kind, label, quantity, unitAmount, taxable: l?.taxable !== false, amount });
  }
  return out;
}

/** What the manual lines of an invoice add (or take) off the subtotal. */
export function linesTotal(lines) {
  return round2(sum(lines || [], (l) => Number(l.amount) || 0));
}

/**
 * Totals for an invoice built from time plus manual lines. Tax follows the
 * invoice rate over the taxable part only: pass-through expenses are
 * commonly zero-rated, and a taxable discount has to reduce the tax with
 * the price it reduces. A discount deep enough to wipe out the taxable
 * base leaves no tax rather than negative tax.
 */
export function invoiceTotals(timeSubtotal, lines, taxRatePercent) {
  const rate = Number(taxRatePercent) || 0;
  const manual = linesTotal(lines);
  const subtotal = round2(timeSubtotal + manual);
  const taxable = round2(timeSubtotal + sum((lines || []).filter((l) => l.taxable), (l) => l.amount));
  const tax = round2(Math.max(0, taxable) * (rate / 100));
  return { subtotal, tax, total: round2(subtotal + tax), taxable: Math.max(0, taxable) };
}

/* ---------- invoice payment state ----------
   State is derived from the numbers, never stored: `payments` is the only
   record, so nothing can drift out of agreement with what was actually
   received. */

/** The due date `days` net terms give an invoice, or null for no terms. */
export function dueDateFor(issueDateISO, days) {
  // No terms is not "due the same day": Number(null) is 0, and a due date
  // equal to the issue date would call every invoice late by tomorrow.
  if (days == null || days === '') return null;
  const n = Number(days);
  if (!issueDateISO || !Number.isFinite(n) || n < 0) return null;
  return addDays(issueDateISO, Math.round(n));
}

/** What has been received against an invoice. */
export function paidAmount(invoice) {
  return round2(sum(invoice?.payments || [], (p) => Number(p.amount) || 0));
}

/**
 * What is still owed, never below zero: a client who rounded the transfer
 * up has not created a negative debt.
 */
export function outstandingAmount(invoice) {
  return Math.max(0, round2((invoice?.total || 0) - paidAmount(invoice)));
}

/**
 * 'paid' | 'partial' | 'overdue' | 'open'. Money settled to the cent
 * counts as paid (two-decimal amounts can leave a rounding crumb behind);
 * an invoice with no due date is never overdue, only open.
 */
export function invoiceState(invoice, todayISODate = todayISO()) {
  if (outstandingAmount(invoice) <= 0.004) return 'paid';
  if (invoice?.dueDate && invoice.dueDate < todayISODate) return 'overdue';
  return paidAmount(invoice) > 0 ? 'partial' : 'open';
}

/** The day the last payment landed, for "Paid <date>" on the sheet. */
export function lastPaymentDate(invoice) {
  return (invoice?.payments || []).map((p) => p.date).sort().at(-1) || null;
}

/* ---------- what invoicing freezes on an entry ----------
   markInvoiced stamps these and clears them again on reopen, and anything
   that has to put a billing record back exactly as it was (the undo behind
   Reports' "mark not invoiced") has to restore all of them. Naming the set
   once means a lock added later cannot be remembered in one place and
   forgotten in the other, which silently reprices billed work. */

export const INVOICE_LOCK_FIELDS = [
  'invoicedAt', 'lockedRate', 'lockedRounding', 'lockedMinimum', 'lockedCurrency',
];

/**
 * The locks an entry holds right now, shaped as a patch that puts them
 * back. A lock a record predates reads as null, which is what the billing
 * rules already treat "no frozen value" as.
 */
export function invoiceLocksOf(entry) {
  const patch = {};
  for (const key of INVOICE_LOCK_FIELDS) patch[key] = entry?.[key] ?? null;
  return patch;
}

/** True when a stored logo path is one this app wrote. */
export function isLogoPath(path) {
  return typeof path === 'string' && /^hourly-data\/logo-\d+\.(png|jpg|webp)$/.test(path);
}

export const DEFAULT_SETTINGS = {
  currency: 'USD',
  defaultRate: 0, // number or effective-dated [{ from, rate }] list

  rounding: 0, // minutes; billable time rounds UP to this increment
  weekStart: 1, // 1 Monday, 0 Sunday
  theme: 'system',
  onboarded: false,
  sampleData: false,
  longTimerHours: 8, // warn when a timer runs past this; 0 disables
  idleGapMinutes: 10, // sleep/away gap that triggers the trim prompt; 0 disables
  dailyNudgeHour: null, // weekday hour to nudge when nothing is tracked; null disables
  unbilledReminderDay: null, // day of the month to mention aging unbilled time; null disables
  unbilledAgeDays: 30, // how old unbilled time has to be to be worth mentioning
  notifyNative: false, // system notifications on top of in-app toasts
  weeklyTargetHours: 0, // personal weekly goal in hours; 0 disables
  weeklyTargetKind: 'billable', // what the target counts: 'billable' | 'tracked'
  backupInterval: 'weekly', // automatic snapshot cadence: 'off' | 'weekly' | 'monthly'
  updatedAt: 0, // when these settings were last written, for cross-device merges
  // Business details printed on invoices; all optional.
  businessName: '',
  businessAddress: '',
  businessTaxId: '',
  invoiceTerms: '', // default payment terms line, e.g. "Payment due within 14 days"
  paymentTermsDays: null, // net days used to date invoices; null = no due date
  taxRate: 0, // default tax percentage prefilled on new invoices
  paymentDetails: '', // how to pay: account or IBAN, BIC, a payment link
  businessLogo: '', // path of the logo file in the user's own Puter files
};

/**
 * True when an fs read failed because the file doesn't exist rather than a
 * transport/API failure. Puter rejects missing paths with
 * { code: 'subject_does_not_exist' }; the message match covers other SDK
 * builds and the dev mock.
 */
function isMissingFileError(err) {
  const code = err?.code ?? err?.error?.code;
  if (typeof code === 'string' && /does_not_exist|not_found/.test(code)) return true;
  const msg = String(err?.message ?? err?.error?.message ?? '');
  return /no such file|not found|does not exist/i.test(msg);
}

class Store extends EventTarget {
  settings = { ...DEFAULT_SETTINGS };
  clients = [];
  projects = [];
  months = []; // sorted "YYYY-MM" keys that have (or had) a file
  backups = []; // [{ date "YYYY-MM-DD", size }] snapshot index, oldest first
  invoices = []; // invoice records, ascending by number
  timer = null;
  user = null;

  #monthCache = new Map(); // "YYYY-MM" -> entries array (shared reference)
  #monthLoads = new Map(); // "YYYY-MM" -> in-flight read promise
  #writeQueues = new Map(); // "YYYY-MM" -> tail of that month's write chain
  #monthMutations = new Map(); // "YYYY-MM" -> tail of that month's mutation chain
  /* What this device last saw on the server, per document: the ids that
     make a delete tellable from an addition when two copies are merged. */
  #monthBase = new Map(); // "YYYY-MM" -> Set of entry ids
  #kvBase = new Map(); // kv key -> Set of record ids
  #monthTouched = new Map(); // "YYYY-MM" -> ms of last read, for "what is on screen"
  #refreshing = false;

  async init() {
    // Resolve the user before any reads: the offline mirror is namespaced
    // per user, and a cache left by a different account must never be
    // served (or flushed) into this one.
    let user = null;
    try {
      user = await puter.auth.getUser();
    } catch {
      user = null;
    }
    if (user?.uuid) {
      if (offline.hasCache() && !offline.matches(user)) offline.clearAll();
      offline.setUser(user);
    }

    const [settings, clients, projects, months, timer, backups, invoices] = await Promise.all([
      this.#kvGet(KV.settings),
      this.#kvGet(KV.clients),
      this.#kvGet(KV.projects),
      this.#kvGet(KV.months),
      this.#kvGet(KV.timer),
      this.#kvGet(KV.backups),
      this.#kvGet(KV.invoices),
    ]);
    this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    this.clients = clients || [];
    this.projects = projects || [];
    this.months = (months || []).slice().sort();
    this.backups = (backups || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    this.invoices = (invoices || []).slice().sort((a, b) => a.number - b.number);
    this.timer = timer || null;
    this.user = user || (offline.user ? { username: offline.user.username } : null);
    // Queued lists include records the server has never seen. After a
    // reload their server baseline is unknown, so do not mistake those
    // local additions for records deleted remotely during the next merge.
    for (const [key, prop] of Object.entries(LIST_PROP)) {
      if (!offline.isDirty(`kv:${key}`)) this.#kvBase.set(key, idSet(this[prop]));
    }
  }

  #emit() {
    this.dispatchEvent(new Event('change'));
  }

  /* ---------- offline-aware transport ---------- */

  /**
   * KV read with the mirror as fallback. A key with a queued local write
   * is served from the mirror even online (the local copy is newer); an
   * unreachable network falls back to the cached copy; an uncached
   * failure still fails loudly so defaults never overwrite real data.
   */
  async #kvGet(key) {
    const decode = (raw) => (raw == null ? null : JSON.parse(raw));
    if (offline.isDirty(`kv:${key}`)) {
      const cached = offline.getKV(key);
      if (cached !== undefined) return decode(cached);
    }
    let value;
    try {
      value = await puter.kv.get(key);
    } catch (err) {
      const cached = offline.getKV(key);
      if (cached === undefined) throw err;
      return decode(cached);
    }
    offline.setKV(key, value == null ? null : JSON.stringify(value));
    return value ?? null;
  }

  /**
   * Straight-from-the-server read of one KV document, for reconciling
   * against it. Returns undefined when the server cannot be reached or
   * answers with an error: a merge that cannot see the other copy simply
   * does not happen, which leaves the old whole-document behavior.
   */
  async #kvReadRemote(key) {
    try {
      const value = await puter.kv.get(key);
      // A queued write's only durable copy lives in the mirror. Reading
      // the server for reconciliation must not replace it before the
      // merged write succeeds: a failed sync still needs that payload.
      if (!offline.isDirty(`kv:${key}`)) {
        offline.setKV(key, value == null ? null : JSON.stringify(value));
      }
      return value ?? null;
    } catch {
      return undefined;
    }
  }

  /**
   * KV write mirrored into the offline cache, serialized per key (like
   * month files) so two racing writes land in call order and a queued
   * replay can never clobber a fresher value. Unreachable network: the
   * write is queued (cache + dirty mark) and resolves as success, syncing
   * on reconnect. Real API errors still propagate to the caller.
   *
   * `merge` makes the write a reconciliation rather than an overwrite: it
   * is handed the server's current copy inside the write queue and returns
   * what should actually be stored. The value that landed is returned, so
   * the caller can adopt it as its own state.
   */
  async #kvSet(key, value, merge = null) {
    let payload = value;
    await this.#queueWrite(`kv:${key}`, async () => {
      if (merge) {
        const remote = await this.#kvReadRemote(key);
        if (remote !== undefined) payload = merge(remote);
      }
      const str = payload == null ? null : JSON.stringify(payload);
      try {
        await puter.kv.set(key, payload);
      } catch (err) {
        if (!isNetworkError(err) || !offline.setKV(key, str)) throw err;
        offline.markDirty(`kv:${key}`, { replace: key === KV.months && !merge });
        return;
      }
      offline.setKV(key, str);
      offline.clearDirty(`kv:${key}`);
    });
    return payload;
  }

  /**
   * Write one of the id-keyed KV lists (clients, projects, invoices),
   * reconciled with the server first: adding a client on the phone and
   * renaming one on the laptop must not cancel each other out. The merged
   * result becomes this device's state, and the new baseline.
   */
  async #setList(key, prop, next) {
    const prev = this[prop];
    this[prop] = next;
    try {
      const written = await this.#kvSet(key, next, (remote) =>
        mergeById(this[prop], remote, this.#kvBase.get(key)).list);
      this[prop] = written;
      /* The baseline is what the SERVER has seen. A write that only made
         it into the offline queue has not been seen there, and counting it
         as seen would make the flush read this device's own new records as
         records the other device had deleted. */
      if (!offline.isDirty(`kv:${key}`)) this.#kvBase.set(key, idSet(written));
      return written;
    } catch (err) {
      this[prop] = prev;
      throw err;
    }
  }

  /** Serialize writes per month file so rapid edits can't clobber each other. */
  #queueWrite(key, fn) {
    const prev = this.#writeQueues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.#writeQueues.set(key, next);
    return next;
  }

  /**
   * Write one month file, mirroring into the offline cache. Unreachable
   * network: queued locally and resolved as success; failing to queue
   * rethrows so callers roll back. `replace` marks a queued write as one
   * that replaces the server's copy rather than reconciling with it (a
   * backup restore), the same intent the month index records.
   */
  async #writeMonthFile(key, text, { replace = false } = {}) {
    try {
      await puter.fs.write(monthPath(key), text, { createMissingParents: true });
    } catch (err) {
      if (!isNetworkError(err) || !offline.setMonth(key, text)) throw err;
      offline.markDirty(`fs:${key}`, { replace });
      return;
    }
    offline.setMonth(key, text);
    offline.clearDirty(`fs:${key}`);
  }

  /** How many local writes are queued waiting for the network. */
  pendingWrites() {
    return offline.pendingCount();
  }

  /* ---------- picking up another device's work ---------- */

  /**
   * Re-read from Puter and reconcile: the whole point of one account
   * holding the data is tracking on a phone and reviewing on a laptop, and
   * until now nothing here ever looked at the server again after boot.
   *
   * Returns how many changes were taken in, so the caller can say so
   * quietly, and emits `change` only when something actually differed —
   * every view rebuilds from that event, so a needless one would fight
   * whatever the user is doing.
   *
   * A document with a queued local write is skipped: the local copy is the
   * newer one, and the flush will reconcile it on its way out.
   */
  async refresh({ months = 3 } = {}) {
    if (this.#refreshing) return 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    this.#refreshing = true;
    let changed = 0;
    try {
      changed += await this.#refreshKV();
      changed += await this.#refreshMonths(months);
    } catch (err) {
      console.error('refresh', err);
    } finally {
      this.#refreshing = false;
    }
    if (changed) this.#emit();
    return changed;
  }

  async #refreshKV() {
    const keys = [KV.settings, KV.clients, KV.projects, KV.months, KV.timer, KV.backups, KV.invoices];
    const values = await Promise.all(keys.map((key) => (offline.isDirty(`kv:${key}`)
      ? Promise.resolve(undefined)
      : this.#kvReadRemote(key))));
    const remote = Object.fromEntries(keys.map((key, i) => [key, values[i]]));
    let changed = 0;

    // The id-keyed lists reconcile record by record.
    for (const [key, prop] of Object.entries(LIST_PROP)) {
      const value = remote[key];
      if (value === undefined) continue;
      const merged = mergeById(this[prop], value, this.#kvBase.get(key));
      if (merged.changed) {
        this[prop] = prop === 'invoices'
          ? merged.list.slice().sort((a, b) => a.number - b.number)
          : merged.list;
        changed += merged.changed;
      }
      this.#kvBase.set(key, idSet(value));
    }

    /* Settings are one document, so the newest write wins whole rather
       than field by field. An older copy on the server (this device wrote
       last) is left alone. */
    const settings = remote[KV.settings];
    if (settings && typeof settings === 'object') {
      const mine = Number(this.settings.updatedAt) || 0;
      const theirs = Number(settings.updatedAt) || 0;
      if (theirs > mine) {
        this.settings = { ...DEFAULT_SETTINGS, ...settings };
        changed += 1;
      }
    }

    // Month index and backup index are sets: two devices' copies only add.
    const monthIndex = remote[KV.months];
    if (Array.isArray(monthIndex)) {
      const union = [...new Set([...this.months, ...monthIndex])].sort();
      if (union.length !== this.months.length) {
        this.months = union;
        changed += 1;
      }
    }
    const backups = remote[KV.backups];
    if (Array.isArray(backups)) {
      const byDate = new Map(this.backups.map((b) => [b.date, b]));
      let added = 0;
      for (const b of backups) {
        if (b?.date && !byDate.has(b.date)) {
          byDate.set(b.date, b);
          added += 1;
        }
      }
      if (added) {
        this.backups = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        changed += added;
      }
    }

    /* The timer key is already shared across devices; refreshing it is
       what makes that visible. Stopping on the phone should stop the
       laptop's clock, not leave it running against nothing. */
    const timer = remote[KV.timer];
    if (timer !== undefined && JSON.stringify(timer ?? null) !== JSON.stringify(this.timer ?? null)) {
      this.timer = timer || null;
      changed += 1;
    }
    return changed;
  }

  /**
   * Re-read the months most recently looked at, which is the closest thing
   * to "what is on screen", and reconcile each in its own mutation queue so
   * a refresh can never interleave with a write to the same month.
   */
  async #refreshMonths(limit) {
    const keys = [...this.#monthCache.keys()]
      .filter((key) => !offline.isDirty(`fs:${key}`))
      .sort((a, b) => (this.#monthTouched.get(b) || 0) - (this.#monthTouched.get(a) || 0))
      .slice(0, Math.max(0, limit));
    let changed = 0;
    for (const key of keys) {
      let remote;
      try {
        const blob = await puter.fs.read(monthPath(key));
        remote = JSON.parse(await blob.text());
      } catch {
        continue; // unreachable or not written yet: nothing to reconcile
      }
      if (!Array.isArray(remote)) continue;
      await this.#mutateMonth(key, (local) => {
        const merged = mergeById(local, remote, this.#monthBase.get(key));
        this.#monthBase.set(key, idSet(remote));
        if (!merged.changed) return undefined;
        changed += merged.changed;
        // In memory only: everything here is already on the server, and a
        // write would just be this device echoing it back.
        this.#monthCache.set(key, merged.list.sort(byEntryOrder));
        offline.setMonth(key, JSON.stringify(merged.list));
        return undefined;
      });
    }
    return changed;
  }

  /**
   * Push queued offline writes to Puter. Every queued document's newest
   * version lives in the mirror, so replaying just re-sends those values
   * in the order they were queued. Stops at the first failure (order
   * matters: the month index precedes month files). Returns how many
   * writes landed.
   */
  async flushPending() {
    let flushed = 0;
    for (const entry of offline.dirtyList()) {
      try {
        if (entry.startsWith('kv:')) {
          const key = entry.slice(3);
          // Resolve the payload inside the per-key queue at execution
          // time, like the month replay below: a user write racing this
          // flush lands first and clears the dirty mark; replaying the
          // older snapshot after it would clobber the fresher value.
          // Straight to the network inside the queue: a re-queueing
          // wrapper would report success while offline and wrongly
          // clear the dirty mark.
          await this.#queueWrite(entry, async () => {
            if (!offline.isDirty(entry)) return undefined;
            const raw = offline.getKV(key);
            if (raw === undefined) return undefined;
            let value = raw === null ? null : JSON.parse(raw);
            /* The id-keyed lists reconcile on replay for the same reason
               month files do; the rest are whole documents whose newest
               writer wins, as they always have. */
            const prop = LIST_PROP[key];
            let merged = false;
            if (prop && Array.isArray(value)) {
              const remote = await this.#kvReadRemote(key);
              if (remote !== undefined) {
                value = mergeById(value, remote, this.#kvBase.get(key)).list;
                merged = true;
              }
            }
            if (key === KV.months && Array.isArray(value) && !offline.isReplacement(entry)) {
              const remote = await this.#kvReadRemote(key);
              if (Array.isArray(remote)) value = [...new Set([...remote, ...value])].sort();
            }
            await puter.kv.set(key, value);
            if (key === KV.months) {
              this.months = value;
              offline.setKV(key, JSON.stringify(value));
            }
            if (merged) {
              this[prop] = prop === 'invoices'
                ? value.slice().sort((a, b) => a.number - b.number)
                : value;
              this.#kvBase.set(key, idSet(value));
              offline.setKV(key, JSON.stringify(value));
            }
            return undefined;
          });
        } else if (entry.startsWith('fs:')) {
          const key = entry.slice(3);
          // Resolve the payload inside the per-month queue at execution
          // time: a user write racing this flush lands first, updates the
          // mirror, and clears the dirty mark; replaying the older
          // snapshot here would clobber it.
          await this.#queueWrite(key, async () => {
            if (!offline.isDirty(entry)) return undefined;
            const text = offline.getMonth(key);
            if (typeof text !== 'string') return undefined;
            /* Replaying a queued write is still a write, so it reconciles
               too: coming back online must not push a phone's offline day
               over a laptop's afternoon. A mirror this cannot parse is
               sent as it stands rather than dropped. The exception is a
               backup restore made offline: it replaced the month on
               purpose, and merging the server's older copy back in on the
               way out would quietly resurrect exactly the entries it
               removed, while its index (already replayed as a replacement)
               said the restore had landed. */
            let merged = null;
            let payload = text;
            try {
              const local = JSON.parse(text);
              merged = offline.isReplacement(entry)
                ? (Array.isArray(local) ? local.sort(byEntryOrder) : null)
                : await this.#mergeMonthWithRemote(key, local);
              if (merged) payload = JSON.stringify(merged);
            } catch {
              merged = null; // fall through with the mirrored text
            }
            await puter.fs.write(monthPath(key), payload, { createMissingParents: true });
            // Landed: what was written is now both this device's copy and
            // its picture of the server.
            if (merged) {
              if (this.#monthCache.has(key)) this.#monthCache.set(key, merged);
              this.#monthBase.set(key, idSet(merged));
              offline.setMonth(key, payload);
            }
            return undefined;
          });
        }
        offline.clearDirty(entry);
        flushed += 1;
      } catch (err) {
        console.error('Sync failed for', entry, err);
        break;
      }
    }
    return flushed;
  }

  /* ---------- settings ---------- */

  /* Settings, clients, and projects all roll back on a failed write,
     like the timer does: the UI reports the failure, so it must never
     keep showing state that exists nowhere but this tab's memory. */

  async updateSettings(patch) {
    const prev = this.settings;
    // Settings are one document with no ids, so they reconcile as a whole:
    // the stamp is what lets a refresh tell a newer copy from an older one.
    // stampFor for the same reason every record write uses it: a copy
    // stamped ahead of this clock would outlive the edit made to it, and
    // the next refresh would quietly put the old settings back.
    this.settings = { ...this.settings, ...patch, updatedAt: stampFor(this.settings) };
    try {
      await this.#kvSet(KV.settings, this.settings);
    } catch (err) {
      this.settings = prev;
      throw err;
    }
    this.#emit();
  }

  /* ---------- clients ---------- */

  client(id) {
    return this.clients.find((c) => c.id === id) || null;
  }

  activeClients() {
    return this.clients.filter((c) => !c.archived);
  }

  async addClient({
    name, slot = 1, rate = null, currency = null,
    billingEmail = '', billingAddress = '', taxId = '',
    rounding = null, taxRate = null, paymentTermsDays = null, minimumMinutes = null,
  }) {
    const c = {
      id: uid(), name: name.trim(), slot, rate, currency,
      billingEmail, billingAddress, taxId,
      // Billing rules: null at every one of them means "whatever the
      // global setting says", exactly like a client without a rate.
      rounding, taxRate, paymentTermsDays, minimumMinutes,
      archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    };
    await this.#setClients([...this.clients, c]);
    this.#emit();
    return c;
  }

  async updateClient(id, patch) {
    // Stamped, so a merge with another device can tell which edit is the
    // newer one rather than guessing.
    await this.#setClients(this.clients.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: stampFor(c) } : c)));
    this.#emit();
  }

  async #setClients(next) {
    await this.#setList(KV.clients, 'clients', next);
  }

  /** Deleting a client archives it and its projects; history stays intact. */
  async archiveClient(id, archived = true) {
    const prevClients = this.clients;
    const prevProjects = this.projects;
    try {
      // Through the reconciling setters, like every other write: archiving
      // on one device must not undo an edit made on another.
      await Promise.all([
        this.#setClients(this.clients.map((c) => (c.id === id ? { ...c, archived, updatedAt: stampFor(c) } : c))),
        this.#setProjects(this.projects.map((p) => (p.clientId === id ? { ...p, archived, updatedAt: stampFor(p) } : p))),
      ]);
    } catch (err) {
      this.clients = prevClients;
      this.projects = prevProjects;
      throw err;
    }
    this.#emit();
  }

  /* ---------- projects ---------- */

  project(id) {
    return this.projects.find((p) => p.id === id) || null;
  }

  activeProjects() {
    return this.projects.filter((p) => !p.archived);
  }

  projectsOf(clientId, { includeArchived = false } = {}) {
    return this.projects.filter((p) => p.clientId === clientId && (includeArchived || !p.archived));
  }

  async addProject({ clientId, name, rate = null, billable = true, budget = null }) {
    const now = Date.now();
    const p = {
      id: uid(), clientId, name: name.trim(), rate, billable, budget,
      archived: false, createdAt: now, updatedAt: now,
    };
    await this.#setProjects([...this.projects, p]);
    this.#emit();
    return p;
  }

  async updateProject(id, patch) {
    await this.#setProjects(this.projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: stampFor(p) } : p)));
    this.#emit();
  }

  async #setProjects(next) {
    await this.#setList(KV.projects, 'projects', next);
  }

  async archiveProject(id, archived = true) {
    await this.updateProject(id, { archived });
  }

  /**
   * Effective hourly rate for an entry: entry override, then project rate,
   * then client rate, then the default rate from settings. Project,
   * client, and default rates are effective-dated: the period in effect
   * on the entry's date applies (a missing date means today, for the
   * timer and form placeholders), and a level whose history starts after
   * the date falls through to the next level.
   */
  resolveRate(entry) {
    if (entry?.rate != null) return entry.rate;
    const date = entry?.date || todayISO();
    const project = this.project(entry?.projectId);
    const projectRate = rateAt(project?.rate, date);
    if (projectRate != null) return projectRate;
    const client = this.client(project?.clientId);
    const clientRate = rateAt(client?.rate, date);
    if (clientRate != null) return clientRate;
    return rateAt(this.settings.defaultRate, date) ?? 0;
  }

  /**
   * The currency an entry's amount is denominated in: the currency
   * frozen at invoicing, otherwise the client's currency, otherwise the
   * global default. There is no per-project or per-entry override and no
   * conversion anywhere; totals never mix currencies.
   */
  resolveCurrency(entry) {
    if (entry?.invoicedAt && entry.lockedCurrency) return entry.lockedCurrency;
    const project = this.project(entry?.projectId);
    const client = this.client(project?.clientId);
    return client?.currency || this.settings.currency || 'USD';
  }

  /** The client an entry bills to, through its project, or null. */
  clientOf(entry) {
    return this.client(this.project(entry?.projectId)?.clientId);
  }

  /**
   * Billing rounding for an entry: the client's rule, else the global
   * setting. Zero is a real answer at either level ("bill exact time"),
   * so only null and undefined mean "inherit" — the same distinction the
   * rate cascade makes.
   */
  resolveRounding(entry) {
    const own = this.clientOf(entry)?.rounding;
    return own == null ? (Number(this.settings.rounding) || 0) : (Number(own) || 0);
  }

  /**
   * Minimum billable minutes for an entry: a per-client term (support and
   * legal work commonly bill any contact at 15 minutes), with no global
   * counterpart, so no minimum is the default everywhere.
   */
  resolveMinimumMinutes(entry) {
    return Number(this.clientOf(entry)?.minimumMinutes) || 0;
  }

  /** Tax percentage a client's invoices start at: theirs, else the global. */
  resolveTaxRate(clientId) {
    const own = this.client(clientId)?.taxRate;
    return own == null ? (Number(this.settings.taxRate) || 0) : (Number(own) || 0);
  }

  /**
   * Payment terms in net days for a client, else the global setting;
   * null at both levels means invoices for them carry no due date.
   */
  resolvePaymentTermsDays(clientId) {
    const own = this.client(clientId)?.paymentTermsDays;
    if (own != null) return Number(own);
    const global = this.settings.paymentTermsDays;
    return global == null ? null : Number(global);
  }

  /**
   * Billable amounts of a set of entries, one bucket per currency:
   * [{ currency, amount }], largest first. This is the only honest way
   * to total across clients; nothing here converts or adds across
   * currencies.
   */
  amountsByCurrency(entries) {
    const map = new Map();
    for (const e of entries) {
      if (!e.billable) continue;
      const amount = this.entryAmount(e);
      if (!amount) continue;
      const cur = this.resolveCurrency(e);
      map.set(cur, round2((map.get(cur) || 0) + amount));
    }
    return [...map.entries()]
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  /**
   * Billable seconds of an entry after billing rounding and any client
   * minimum. Invoiced entries use what was frozen when they were invoiced
   * (entries invoiced before a value was recorded follow the live rule for
   * rounding, as they always have, and bill at no minimum, which is what
   * actually happened to them); everything else resolves live.
   *
   * The minimum applies to the rounded time rather than the raw seconds,
   * so a 15-minute minimum and 10-minute rounding bill a 3-minute call at
   * 15 minutes, not 20: the two rules are a floor and an increment, not
   * two things to charge for in sequence.
   */
  billedSeconds(entry) {
    if (!entry.billable || entry.seconds <= 0) return 0;
    const invoiced = !!entry.invoicedAt;
    const rounding = invoiced && entry.lockedRounding != null
      ? entry.lockedRounding
      : this.resolveRounding(entry);
    const minimum = invoiced
      ? (Number(entry.lockedMinimum) || 0)
      : this.resolveMinimumMinutes(entry);
    return Math.max(roundSeconds(entry.seconds, rounding), minimum * 60);
  }

  /**
   * The rate an entry actually bills at: the rate frozen when it was
   * invoiced, otherwise the live resolution. Rate changes must never
   * rewrite already-billed history.
   */
  effectiveRate(entry) {
    if (entry.invoicedAt && entry.lockedRate != null) return entry.lockedRate;
    return this.resolveRate(entry);
  }

  /** Money an entry earns: rounded billable hours times the effective rate. */
  entryAmount(entry) {
    if (!entry.billable) return 0;
    return round2(toHours(this.billedSeconds(entry), 4) * this.effectiveRate(entry));
  }

  /* ---------- entries ---------- */

  /**
   * Entries of one month, cached after first read. Sorted newest first.
   * Concurrent callers (e.g. two ranges covering the current month loaded
   * with Promise.all) share one read instead of racing duplicate fetches.
   */
  async loadMonth(key) {
    // What the app has looked at most recently is what is on screen, which
    // is what a background refresh should bother re-reading.
    this.#monthTouched.set(key, Date.now());
    if (this.#monthCache.has(key)) return this.#monthCache.get(key);
    let load = this.#monthLoads.get(key);
    if (!load) {
      load = this.#readMonth(key).finally(() => this.#monthLoads.delete(key));
      this.#monthLoads.set(key, load);
    }
    return load;
  }

  async #readMonth(key) {
    let text;
    if (this.months.includes(key)) {
      // A month with a queued local write is newer in the mirror than on
      // the server; read it from there even online.
      if (offline.isDirty(`fs:${key}`)) {
        const cached = offline.getMonth(key);
        if (typeof cached === 'string') text = cached;
      }
      if (text === undefined) {
        try {
          const blob = await puter.fs.read(monthPath(key));
          text = await blob.text();
          offline.setMonth(key, text);
        } catch (err) {
          if (isMissingFileError(err)) {
            // Indexed but never written (a crash between index and file
            // write) reads as empty.
            offline.setMonth(key, null);
          } else {
            const cached = offline.getMonth(key);
            if (cached === undefined) throw err;
            if (typeof cached === 'string') text = cached;
          }
        }
      }
    }
    const entries = text ? JSON.parse(text) : [];
    entries.sort(byEntryOrder);
    this.#monthCache.set(key, entries);
    // The copy just read is this device's picture of the server: later
    // merges tell deletes from additions against it. A mirror with queued
    // writes in it is not that picture, so the older baseline stands.
    if (!offline.isDirty(`fs:${key}`)) this.#monthBase.set(key, idSet(entries));
    return entries;
  }

  /**
   * Serialize read-modify-write cycles per month: `fn` gets the month's
   * current entries only after every earlier mutation of that month has
   * finished. Without this, two overlapping edits (say, stopping the
   * timer while an undo re-adds a deleted entry) both compute from the
   * same stale snapshot and the later write silently drops the earlier
   * one. The write queue below cannot prevent that; it only orders the
   * file writes themselves.
   */
  #mutateMonth(key, fn) {
    const run = async () => fn(await this.loadMonth(key));
    const prev = this.#monthMutations.get(key) || Promise.resolve();
    const next = prev.then(run, run);
    this.#monthMutations.set(key, next);
    return next;
  }

  /**
   * The month file this device is about to write, reconciled with what the
   * server holds right now. Reads inside the per-month write queue, so a
   * second write cannot interleave with this one's read.
   *
   * A read that fails (offline, or a transport blip) falls back to writing
   * what this device has, which is exactly the behavior before merging
   * existed: the alternative would be refusing to save a user's work
   * because another copy could not be checked.
   */
  async #mergeMonthWithRemote(key, entries) {
    if (!this.months.includes(key)) return entries;
    let remote;
    try {
      const blob = await puter.fs.read(monthPath(key));
      remote = JSON.parse(await blob.text());
    } catch {
      return entries;
    }
    if (!Array.isArray(remote)) return entries;
    const { list } = mergeById(entries, remote, this.#monthBase.get(key));
    return list.sort(byEntryOrder);
  }

  async #persistMonth(key, entries) {
    entries.sort(byEntryOrder);
    if (!this.months.includes(key)) {
      // Index first: a file without an index entry would be invisible.
      // Roll the index back if it cannot be recorded anywhere.
      const prev = this.months;
      this.months = [...this.months, key].sort();
      try {
        // The index is a set of month keys, so two devices' indexes only
        // ever add up; a union can never be wrong.
        const written = await this.#kvSet(KV.months, this.months,
          (remote) => [...new Set([...(Array.isArray(remote) ? remote : []), ...this.months])].sort());
        this.months = written;
      } catch (err) {
        this.months = prev;
        throw err;
      }
    }
    /* The write reconciles rather than overwrites: a tab holding a stale
       month must not wipe out entries another device added to it. The
       merged result is what lands, and what this device then holds. */
    let stored = entries;
    await this.#queueWrite(key, async () => {
      stored = await this.#mergeMonthWithRemote(key, entries);
      await this.#writeMonthFile(key, JSON.stringify(stored));
    });
    // Cache only after the write confirmed (or queued): a failed write
    // must not leave entries that exist on screen but nowhere else.
    this.#monthCache.set(key, stored);
    // Baseline only when it really landed: see #setList.
    if (!offline.isDirty(`fs:${key}`)) this.#monthBase.set(key, idSet(stored));
  }

  async addEntry({
    date, projectId, task = '', notes = '', seconds, billable = true, rate = null,
    startedAt = null, endedAt = null,
  }) {
    const now = Date.now();
    const entry = {
      id: uid(),
      date,
      projectId,
      task: task.trim(),
      notes: notes.trim(),
      seconds: Math.max(0, Math.round(seconds)),
      // Optional clock times. A duration-only entry stays the fast path,
      // and every entry written before these existed stays valid.
      startedAt: startedAt || null,
      endedAt: endedAt || null,
      billable,
      rate,
      invoicedAt: null,
      lockedRate: null,
      lockedRounding: null,
      lockedMinimum: null,
      lockedCurrency: null,
      createdAt: now,
      updatedAt: now,
    };
    const key = monthKeyOf(date);
    await this.#mutateMonth(key, (entries) => this.#persistMonth(key, [...entries, entry]));
    this.#emit();
    return entry;
  }

  async updateEntry(id, oldDate, patch) {
    const oldKey = monthKeyOf(oldDate);
    const updated = await this.#mutateMonth(oldKey, async (entries) => {
      const existing = entries.find((e) => e.id === id);
      if (!existing) throw new Error('Entry not found');
      // Invoiced entries are billing records: read-only until un-marked
      // (markInvoiced is the only door in or out of that state).
      if (existing.invoicedAt) throw new Error('Entry is invoiced and locked');
      const next = { ...existing, ...patch, updatedAt: stampFor(existing) };
      if (monthKeyOf(next.date) === oldKey) {
        await this.#persistMonth(oldKey, entries.map((e) => (e.id === id ? next : e)));
      }
      return next;
    });
    const newKey = monthKeyOf(updated.date);
    if (newKey !== oldKey) {
      // The entry moved across a month boundary: add there, then remove
      // here, as two chained mutations (never nested, so two opposite
      // moves cannot deadlock waiting on each other's month).
      await this.#mutateMonth(newKey, (target) => this.#persistMonth(newKey, [...target, updated]));
      await this.#mutateMonth(oldKey, (entries) => this.#persistMonth(oldKey, entries.filter((e) => e.id !== id)));
    }
    this.#emit();
    return updated;
  }

  /**
   * The patch that gives an entry a new duration without letting its clock
   * times contradict it. An entry that knows when it happened has to keep
   * saying the same thing as the number that gets billed, so the end moves
   * to where the new duration lands and the start — the fact the user
   * actually observed — stays put. This is the rule stopTimer and the
   * entry sheet already follow; anything else that edits a duration on its
   * own (the week grid) goes through here so there is one of them.
   * An entry carrying no times is just its duration.
   */
  durationPatch(entry, seconds) {
    const next = Math.max(0, Math.round(seconds));
    if (!entry?.startedAt || !entry?.endedAt) return { seconds: next };
    return { seconds: next, endedAt: entry.startedAt + next * 1000 };
  }

  async deleteEntry(id, date) {
    const key = monthKeyOf(date);
    const entry = await this.#mutateMonth(key, async (entries) => {
      const found = entries.find((e) => e.id === id) || null;
      if (found?.invoicedAt) throw new Error('Entry is invoiced and locked');
      await this.#persistMonth(key, entries.filter((e) => e.id !== id));
      return found;
    });
    this.#emit();
    return entry;
  }

  /**
   * Apply per-entry patches in one pass, batched per month file like
   * markInvoiced. Items: [{ id, date, patch }]. Invoiced entries are
   * skipped (they are locked billing records), never failed, and `date`
   * cannot be patched here (a bulk cross-month move is a different
   * operation). Returns { changed, skipped, inverse } where `inverse`
   * is the item list that restores each changed entry's prior values.
   */
  async bulkPatch(items) {
    const byMonth = new Map();
    for (const it of items) {
      const key = monthKeyOf(it.date);
      if (!byMonth.has(key)) byMonth.set(key, new Map());
      const { date: _stripped, ...patch } = it.patch;
      byMonth.get(key).set(it.id, patch);
    }
    let changed = 0;
    let skipped = 0;
    const inverse = [];
    for (const [key, patches] of byMonth) {
      await this.#mutateMonth(key, (monthEntries) => {
        let touched = false;
        const next = monthEntries.map((e) => {
          const patch = patches.get(e.id);
          if (!patch) return e;
          if (e.invoicedAt) {
            skipped += 1;
            return e;
          }
          const prior = {};
          for (const k of Object.keys(patch)) prior[k] = e[k];
          inverse.push({ id: e.id, date: e.date, patch: prior });
          changed += 1;
          touched = true;
          return { ...e, ...patch, updatedAt: stampFor(e) };
        });
        return touched ? this.#persistMonth(key, next) : undefined;
      });
    }
    if (changed) this.#emit();
    return { changed, skipped, inverse };
  }

  /**
   * Delete many entries, batched per month file. Invoiced entries are
   * skipped, not failed. Returns { deleted, skipped, removed } with the
   * removed entries intact for undo via restoreEntries().
   */
  async bulkDelete(items) {
    const byMonth = new Map();
    for (const it of items) {
      const key = monthKeyOf(it.date);
      if (!byMonth.has(key)) byMonth.set(key, new Set());
      byMonth.get(key).add(it.id);
    }
    let skipped = 0;
    const removed = [];
    for (const [key, ids] of byMonth) {
      await this.#mutateMonth(key, (monthEntries) => {
        const keep = [];
        let touched = false;
        for (const e of monthEntries) {
          if (!ids.has(e.id)) {
            keep.push(e);
          } else if (e.invoicedAt) {
            skipped += 1;
            keep.push(e);
          } else {
            removed.push(e);
            touched = true;
          }
        }
        return touched ? this.#persistMonth(key, keep) : undefined;
      });
    }
    if (removed.length) this.#emit();
    return { deleted: removed.length, skipped, removed };
  }

  /**
   * Re-insert previously deleted entries (bulk-delete undo), batched per
   * month. Entries that somehow already exist again are left alone.
   */
  async restoreEntries(entries) {
    const byMonth = new Map();
    for (const e of entries) {
      const key = monthKeyOf(e.date);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(e);
    }
    let restored = 0;
    for (const [key, list] of byMonth) {
      await this.#mutateMonth(key, (monthEntries) => {
        const have = new Set(monthEntries.map((e) => e.id));
        const back = list.filter((e) => !have.has(e.id));
        if (!back.length) return undefined;
        restored += back.length;
        return this.#persistMonth(key, [...monthEntries, ...back]);
      });
    }
    if (restored) this.#emit();
    return restored;
  }

  /**
   * Mark entries as invoiced (freezing each entry's currently resolved
   * rate and the billing rounding) or back to unbilled. Batched per month
   * file; already-matching entries are left untouched. Returns how many
   * entries changed.
   */
  async markInvoiced(entries, invoiced = true) {
    const now = Date.now();
    const byMonth = new Map();
    for (const e of entries) {
      const key = monthKeyOf(e.date);
      if (!byMonth.has(key)) byMonth.set(key, new Set());
      byMonth.get(key).add(e.id);
    }
    let changed = 0;
    for (const [key, ids] of byMonth) {
      await this.#mutateMonth(key, (monthEntries) => {
        let touched = false;
        const next = monthEntries.map((e) => {
          if (!ids.has(e.id) || !!e.invoicedAt === invoiced) return e;
          changed += 1;
          touched = true;
          return invoiced
            ? {
              ...e,
              invoicedAt: now,
              lockedRate: this.resolveRate(e),
              lockedRounding: this.resolveRounding(e),
              lockedMinimum: this.resolveMinimumMinutes(e),
              lockedCurrency: this.resolveCurrency(e),
              updatedAt: stampFor(e),
            }
            : {
              ...e,
              invoicedAt: null,
              lockedRate: null,
              lockedRounding: null,
              lockedMinimum: null,
              lockedCurrency: null,
              updatedAt: stampFor(e),
            };
        });
        /* A month nothing changed in is not written, like bulkPatch and
           bulkDelete already do it. Every row already marked (a second
           tap on an Undo, a reopen of time that is unbilled anyway) used
           to spend a file write on identical content, and offline that
           write queued: the banner counted a change that did not exist
           and the flush pushed this device's month back over whatever
           another one had done to it. */
        return touched ? this.#persistMonth(key, next) : undefined;
      });
    }
    if (changed) this.#emit();
    return changed;
  }

  /* ---------- invoices ---------- */

  /**
   * Create an invoice from unbilled billable entries of one client.
   * Marking-as-invoiced happens under the hood (locking each entry's
   * rate, rounding, and currency), then the invoice document freezes
   * everything it prints: sequential number, totals, and snapshots of
   * the business and client billing details, so later profile edits
   * never rewrite an issued invoice. Rolls the marks back if the
   * invoice itself cannot be recorded.
   */
  async createInvoice({
    clientId, entries, taxRate = 0, notes = '', issueDate = null,
    dueDate = undefined, lines = [],
  }) {
    const client = this.client(clientId);
    if (!client) throw new Error('Client not found');
    // Filter on the STORED copies, not the caller's: a stale list must
    // never sweep an entry that is already on another invoice.
    const fresh = await this.#entriesByRef(entries || []);
    const targets = fresh.filter((e) => e.billable && !e.invoicedAt);
    const manual = normalizeInvoiceLines(lines);
    // A fixed-fee project has no tracked time to bill, so lines alone are
    // a complete invoice; nothing at all is still nothing.
    if (!targets.length && !manual.length) throw new Error('Nothing to invoice');

    await this.markInvoiced(targets, true);
    // Read the locked copies back so totals reflect exactly what froze.
    const locked = await this.#entriesByRef(targets);
    const seconds = sum(locked, (e) => this.billedSeconds(e));
    const timeSubtotal = round2(sum(locked, (e) => this.entryAmount(e)));
    const rate = Number(taxRate) || 0;
    const { subtotal, tax, total } = invoiceTotals(timeSubtotal, manual, rate);
    const dates = locked.map((e) => e.date).sort();
    const s = this.settings;

    const issued = issueDate || isoOf(new Date());
    const invoice = {
      id: uid(),
      updatedAt: Date.now(),
      number: this.invoices.reduce((m, i) => Math.max(m, i.number), 0) + 1,
      clientId,
      issueDate: issued,
      // A due date makes "overdue" a fact rather than a feeling. Passed in
      // explicitly (the create sheet shows and can change it), or derived
      // from the payment terms; without terms there is simply none, and
      // nothing about the invoice is ever late.
      dueDate: dueDate === undefined
        ? dueDateFor(issued, this.resolvePaymentTermsDays(clientId))
        : (dueDate || null),
      // Payments are a list, not a status: one entry covers "mark as
      // paid", several cover a deposit plus a balance, and no stored
      // status can ever disagree with the numbers.
      payments: [],
      createdAt: Date.now(),
      currency: client.currency || s.currency,
      taxRate: rate,
      notes: notes.trim(),
      terms: s.invoiceTerms || '',
      seconds,
      // Manual lines are frozen with everything else; time lines stay
      // derived from the entries this invoice locked.
      lines: manual,
      subtotal,
      tax,
      total,
      // A lines-only invoice covers no period of work at all.
      periodFrom: dates[0] || null,
      periodTo: dates.length ? dates[dates.length - 1] : null,
      entries: locked.map((e) => ({ id: e.id, date: e.date })),
      // The whole business block is frozen here, branding included, so a
      // rebrand (or a new payment account) never rewrites an issued
      // invoice: the logo path names one immutable file per upload.
      business: {
        name: s.businessName || '',
        address: s.businessAddress || '',
        taxId: s.businessTaxId || '',
        payment: s.paymentDetails || '',
        logo: s.businessLogo || '',
      },
      billTo: {
        name: client.name,
        address: client.billingAddress || '',
        email: client.billingEmail || '',
        taxId: client.taxId || '',
      },
    };
    try {
      await this.#setInvoices([...this.invoices, invoice]);
    } catch (err) {
      await this.markInvoiced(targets, false).catch(() => {});
      throw err;
    }
    this.#emit();
    return invoice;
  }

  /**
   * Void an invoice: its entries return to unbilled (rates unlock), the
   * document disappears, and its number is free for the next invoice.
   * Reopening runs first, so a failure part-way leaves a voidable
   * invoice rather than orphaned locked entries.
   */
  async voidInvoice(id) {
    const invoice = this.invoices.find((i) => i.id === id);
    if (!invoice) return;
    await this.markInvoiced(invoice.entries, false);
    await this.#setInvoices(this.invoices.filter((i) => i.id !== id));
    this.#emit();
  }

  /**
   * Record money received against an invoice. Several payments are the
   * normal case (a deposit, then the balance), so nothing here replaces
   * an earlier one; state is recomputed from the list.
   */
  async addPayment(invoiceId, { date, amount, note = '' }) {
    const invoice = this.invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new Error('Invoice not found');
    const value = round2(Number(amount));
    if (!Number.isFinite(value) || value <= 0) throw new Error('Enter the amount received');
    const payment = { id: uid(), date: date || isoOf(new Date()), amount: value, note: note.trim() };
    // stampFor, not plain now: an invoice stamped ahead of this clock
    // (another device's, a restored backup's) would otherwise win the
    // merge and the money received would vanish while the sheet said it
    // was recorded. See stampFor above.
    const next = { ...invoice, payments: [...(invoice.payments || []), payment], updatedAt: stampFor(invoice) };
    await this.#setInvoices(this.invoices.map((i) => (i.id === invoiceId ? next : i)));
    this.#emit();
    return payment;
  }

  /** Undo a recorded payment (a mistyped amount, a bounced transfer). */
  async removePayment(invoiceId, paymentId) {
    const invoice = this.invoices.find((i) => i.id === invoiceId);
    if (!invoice) return;
    const next = {
      ...invoice,
      payments: (invoice.payments || []).filter((p) => p.id !== paymentId),
      updatedAt: stampFor(invoice),
    };
    await this.#setInvoices(this.invoices.map((i) => (i.id === invoiceId ? next : i)));
    this.#emit();
  }

  /**
   * What is owed to you, one bucket per currency (the app never mixes
   * them): [{ currency, open, overdue, oldestOverdue, count, overdueCount }],
   * largest open amount first. `open` covers everything unpaid, overdue
   * included, so it is the whole debt rather than a slice of it.
   */
  outstandingByCurrency(todayISODate = todayISO()) {
    const map = new Map();
    for (const inv of this.invoices) {
      const state = invoiceState(inv, todayISODate);
      if (state === 'paid') continue;
      const cur = inv.currency || this.settings.currency;
      const agg = map.get(cur) || { currency: cur, open: 0, overdue: 0, oldestOverdue: null, count: 0, overdueCount: 0 };
      const left = outstandingAmount(inv);
      agg.open = round2(agg.open + left);
      agg.count += 1;
      if (state === 'overdue') {
        agg.overdue = round2(agg.overdue + left);
        agg.overdueCount += 1;
        if (!agg.oldestOverdue || inv.dueDate < agg.oldestOverdue) agg.oldestOverdue = inv.dueDate;
      }
      map.set(cur, agg);
    }
    return [...map.values()].sort((a, b) => b.open - a.open);
  }

  /** Full entry records an invoice covers, for rendering line items. */
  async invoiceEntries(invoice) {
    return this.#entriesByRef(invoice.entries);
  }

  /**
   * The invoice document covering an entry, or null. Hand-marked entries
   * (invoiced without a document) have none. Entries an invoice covers
   * must only reopen by voiding it: unlocking one behind the document's
   * back would let its line items drift from the frozen totals and put
   * the entry back in "unbilled", where a second invoice could bill it
   * again.
   */
  invoiceFor(entryId) {
    return this.invoices.find((inv) => inv.entries.some((r) => r.id === entryId)) || null;
  }

  /** Load entries by { id, date } refs, tolerating missing ones. */
  async #entriesByRef(refs) {
    const byMonth = new Map();
    for (const r of refs) {
      const key = monthKeyOf(r.date);
      if (!byMonth.has(key)) byMonth.set(key, new Set());
      byMonth.get(key).add(r.id);
    }
    const out = [];
    for (const [key, ids] of byMonth) {
      const monthEntries = await this.loadMonth(key);
      for (const e of monthEntries) if (ids.has(e.id)) out.push(e);
    }
    return out;
  }

  async #setInvoices(next) {
    const written = await this.#setList(KV.invoices, 'invoices',
      next.slice().sort((a, b) => a.number - b.number));
    // A merge can bring another device's invoice in out of order.
    this.invoices = written.slice().sort((a, b) => a.number - b.number);
  }

  /**
   * Unbilled work per client across all history: billable, not yet
   * invoiced. Map of clientId ('none' for orphans) to
   * { seconds, amount, count, oldest, newest, currency }.
   *
   * The dates are the point: four hours logged yesterday and fourteen
   * sitting unbilled since last quarter are not the same debt, and only
   * the second one quietly stops being collectable. Reads every indexed
   * month once; the cache absorbs repeat calls.
   */
  async unbilledByClient() {
    const chunks = await Promise.all(this.months.map((k) => this.loadMonth(k)));
    const map = new Map();
    for (const e of chunks.flat()) {
      if (!e.billable || e.invoicedAt) continue;
      const clientId = this.project(e.projectId)?.clientId || 'none';
      let agg = map.get(clientId);
      if (!agg) {
        agg = {
          seconds: 0, amount: 0, count: 0, oldest: e.date, newest: e.date,
          currency: this.resolveCurrency(e),
        };
        map.set(clientId, agg);
      }
      agg.seconds += this.billedSeconds(e);
      agg.amount = round2(agg.amount + this.entryAmount(e));
      agg.count += 1;
      if (e.date < agg.oldest) agg.oldest = e.date;
      if (e.date > agg.newest) agg.newest = e.date;
    }
    return map;
  }

  /**
   * Clients holding unbilled time, oldest first, then largest: the list
   * of work that is ready to invoice and quietly waiting. Archived
   * clients are included (their history still bills) and orphaned entries
   * are not, since there is nobody to send that invoice to.
   */
  async readyToInvoice({ minAgeDays = 0, now = todayISO() } = {}) {
    const map = await this.unbilledByClient();
    const out = [];
    for (const [clientId, agg] of map) {
      if (clientId === 'none') continue;
      const client = this.client(clientId);
      if (!client) continue;
      const ageDays = daysApart(agg.oldest, now);
      if (ageDays < minAgeDays) continue;
      out.push({ client, ageDays, ...agg });
    }
    return out.sort((a, b) => b.ageDays - a.ageDays || b.amount - a.amount);
  }

  /** All entries with `fromISO <= date <= toISO`, newest first. */
  async entriesBetween(fromISO, toISO) {
    const keys = monthKeysBetweenIndexed(this.months, fromISO, toISO);
    const chunks = await Promise.all(keys.map((k) => this.loadMonth(k)));
    return chunks.flat()
      .filter((e) => e.date >= fromISO && e.date <= toISO)
      .sort(byEntryOrder);
  }

  /**
   * Most recent distinct (projectId, task) pairs, for quick resume.
   * A month the mirror cannot serve offline contributes nothing rather
   * than failing the whole list; suggestions are a convenience, not a
   * record.
   */
  async recentWork(limit = 6) {
    const seen = new Set();
    const out = [];
    for (let i = this.months.length - 1; i >= 0 && out.length < limit; i--) {
      let entries;
      try {
        entries = await this.loadMonth(this.months[i]);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!this.project(e.projectId) || this.project(e.projectId).archived) continue;
        // A restored backup may carry entries without a task field.
        const sig = `${e.projectId} ${(e.task || '').toLowerCase()}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(e);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** Distinct task names seen recently, for the task input's suggestions. */
  async taskSuggestions(projectId = null, limit = 8) {
    const seen = new Set();
    const out = [];
    for (let i = this.months.length - 1; i >= 0 && out.length < limit; i--) {
      let entries;
      try {
        entries = await this.loadMonth(this.months[i]);
      } catch {
        continue; // same tolerance as recentWork above
      }
      for (const e of entries) {
        if (!e.task || (projectId && e.projectId !== projectId)) continue;
        const k = e.task.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e.task);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /**
   * Spent vs budget for a project that has one, or null. Monthly budgets
   * (retainers) look at the current month only; total budgets scan all
   * history. Hours budgets count every tracked second; amount budgets
   * count billable money. A running timer on the project counts live.
   * Returns { kind, period, spent, value, ratio } with hours normalized
   * to seconds.
   */
  async budgetProgress(project, now = Date.now()) {
    const b = project?.budget;
    if (!b || !(b.value > 0)) return null;
    /* The whole period, not just up to today. Work is dated when it
       happened, not when it was typed, and the week grid exists so a
       Friday can be filled in on Wednesday; a delivery booked a day ahead
       is ordinary too. Measuring only to today left that work out of the
       bar and out of the 80%/100% warning, so a retainer could read as
       half spent while it was already over — and then jump when the date
       caught up. Every other range in the app covers its whole period. */
    const today = isoOf(new Date(now));
    const monthKey = monthKeyOf(today);
    const [from, to] = b.period === 'monthly'
      ? [`${monthKey}-01`, monthDays(monthKey).at(-1)]
      : ['2000-01-01', '9999-12-31'];
    const entries = (await this.entriesBetween(from, to)).filter((e) => e.projectId === project.id);
    let spent = b.kind === 'amount'
      ? round2(sum(entries, (e) => this.entryAmount(e)))
      : sum(entries, (e) => e.seconds);
    if (this.timer?.projectId === project.id) {
      const sec = this.elapsedSeconds(now);
      if (b.kind === 'amount') {
        if (this.timer.billable) {
          spent = round2(spent + toHours(sec, 4) * this.resolveRate({ projectId: project.id, rate: null }));
        }
      } else {
        spent += sec;
      }
    }
    const value = b.kind === 'amount' ? b.value : b.value * 3600;
    return { kind: b.kind, period: b.period, spent, value, ratio: spent / value };
  }

  /* ---------- timer ---------- */

  get running() {
    return !!this.timer;
  }

  elapsedSeconds(now = Date.now()) {
    if (!this.timer) return 0;
    return Math.max(0, Math.floor((now - this.timer.startedAt) / 1000));
  }

  async startTimer({ projectId, task = '', notes = '', billable = true }) {
    this.timer = { startedAt: Date.now(), projectId, task: task.trim(), notes, billable };
    try {
      await this.#kvSet(KV.timer, this.timer);
    } catch (err) {
      // Roll back so the UI never shows a timer that would not survive
      // a reload.
      this.timer = null;
      throw err;
    }
    this.#emit();
  }

  /**
   * Update the running timer without restarting it. `startedAt` moves are
   * validated: never into the future, and never off the calendar day the
   * timer started on (the entry lands on that day).
   */
  async retagTimer(patch) {
    if (!this.timer) return null;
    const prev = this.timer;
    const next = { ...prev, ...patch, task: String(patch.task ?? prev.task).trim() };
    if (patch.startedAt != null) {
      if (next.startedAt > Date.now()) throw new Error('Start time is in the future');
      if (isoOf(new Date(next.startedAt)) !== isoOf(new Date(prev.startedAt))) {
        throw new Error('Start time must stay on the same day');
      }
    }
    this.timer = next;
    try {
      await this.#kvSet(KV.timer, this.timer);
    } catch (err) {
      this.timer = prev;
      throw err;
    }
    this.#emit();
    return this.timer;
  }

  /**
   * Stop the running timer and record an entry on the day it started.
   * Sub-minute accidents still record (1 minute floor) so a tap-tap
   * mistake is visible and deletable rather than silently dropped.
   * `capSeconds` trims a forgotten timer to a sane duration.
   */
  async stopTimer({ capSeconds = null } = {}) {
    if (!this.timer) return null;
    const t = this.timer;
    const elapsed = this.elapsedSeconds();
    const seconds = Math.max(60, capSeconds != null ? Math.min(elapsed, capSeconds) : elapsed);
    // Cleared synchronously so a double-tap cannot record twice, and
    // restored if the entry cannot be written, so tracked time is never
    // thrown away by a network failure.
    this.timer = null;
    let entry;
    try {
      entry = await this.addEntry({
        date: isoOf(new Date(t.startedAt)),
        projectId: t.projectId,
        task: t.task,
        notes: t.notes,
        seconds,
        billable: t.billable,
        // The timer knew exactly when the work started; keep it, and put
        // the end where the recorded duration actually lands, so the
        // times can never disagree with the number that gets billed (a
        // trimmed forgotten timer ends at its trim, not at "now").
        startedAt: t.startedAt,
        endedAt: t.startedAt + seconds * 1000,
      });
    } catch (err) {
      this.timer = t;
      this.#emit();
      throw err;
    }
    // The entry is safe; failing to clear the timer key must not undo
    // that. Worst case the stale key resurrects a running timer on the
    // next load, which is visible and discardable.
    await this.#kvSet(KV.timer, null).catch(() => {});
    return entry;
  }

  async discardTimer() {
    const t = this.timer;
    this.timer = null;
    try {
      await this.#kvSet(KV.timer, null);
    } catch (err) {
      this.timer = t;
      this.#emit();
      throw err;
    }
    this.#emit();
  }

  /**
   * Entries in `entries` whose clock times overlap the given span, ignoring
   * the entry being edited. Only entries that actually carry times can
   * clash: a duration-only entry says nothing about when it happened, so
   * it can never be double-booked. Touching ends (one starts exactly when
   * the other ends) are not an overlap.
   */
  overlappingEntries(entries, { startedAt, endedAt, id = null }) {
    if (!startedAt || !endedAt) return [];
    return entries.filter((e) => e.id !== id && e.startedAt && e.endedAt
      && e.startedAt < endedAt && startedAt < e.endedAt);
  }

  /**
   * Filter entries for search: free text matches task, notes, project,
   * and client names (case- and accent-insensitive); `clientId` narrows
   * to one client; `billing` is 'all' | 'billable' | 'nonbillable' |
   * 'unbilled' | 'invoiced'.
   */
  filterEntries(entries, { query = '', clientId = '', billing = 'all' } = {}) {
    return entries.filter((e) => {
      const project = this.project(e.projectId);
      if (clientId && project?.clientId !== clientId) return false;
      if (billing === 'billable' && !e.billable) return false;
      if (billing === 'nonbillable' && e.billable) return false;
      if (billing === 'unbilled' && !(e.billable && !e.invoicedAt)) return false;
      if (billing === 'invoiced' && !e.invoicedAt) return false;
      if (query) {
        const client = this.client(project?.clientId);
        if (![e.task, e.notes, project?.name, client?.name].some((t) => t && textMatches(t, query))) {
          return false;
        }
      }
      return true;
    });
  }

  /* ---------- aggregation ---------- */

  /**
   * Total seconds and billable amount of a set of entries.
   * `billableSeconds` is what gets billed, so it carries billing rounding
   * and can exceed the tracked total; `trackedBillableSeconds` is the raw
   * time on billable entries, which is the only honest numerator for a
   * "share of tracked time" ratio.
   */
  totals(entries) {
    return {
      seconds: sum(entries, (e) => e.seconds),
      billableSeconds: sum(entries, (e) => this.billedSeconds(e)),
      trackedBillableSeconds: sum(entries, (e) => (e.billable ? e.seconds : 0)),
      amount: round2(sum(entries, (e) => this.entryAmount(e))),
    };
  }

  /**
   * Group entries for reports. `by` is 'client', 'project', or 'task'.
   * Returns [{ key, label, sublabel, slot, entries, seconds, billableSeconds,
   * amount, amounts }] sorted by seconds, largest first. `amounts` is the
   * per-currency split (a task group can span clients billing in
   * different currencies; client and project groups have at most one).
   */
  groupEntries(entries, by) {
    const groups = new Map();
    for (const e of entries) {
      const project = this.project(e.projectId);
      const client = this.client(project?.clientId);
      let key, label, sublabel = '', slot = 0;
      if (by === 'client') {
        key = client?.id || 'none';
        label = client?.name || 'No client';
        slot = client?.slot || 0;
      } else if (by === 'project') {
        key = project?.id || 'none';
        label = project?.name || 'No project';
        sublabel = client?.name || '';
        slot = client?.slot || 0;
      } else {
        // Prefixed so a task literally named "none" cannot collide with
        // the group holding untasked entries.
        key = e.task ? `task:${e.task.toLowerCase()}` : 'none';
        label = e.task || 'No task';
        slot = client?.slot || 0;
      }
      let g = groups.get(key);
      if (!g) {
        g = { key, label, sublabel, slot, entries: [], seconds: 0, billableSeconds: 0, amount: 0 };
        groups.set(key, g);
      }
      g.entries.push(e);
      g.seconds += e.seconds;
      g.billableSeconds += this.billedSeconds(e);
      g.amount = round2(g.amount + this.entryAmount(e));
    }
    for (const g of groups.values()) g.amounts = this.amountsByCurrency(g.entries);
    return [...groups.values()].sort((a, b) => b.seconds - a.seconds);
  }

  /**
   * Bulk-import entries from another tracker. Items carry client and
   * project NAMES; existing records match case-insensitively and missing
   * ones are created (projects of unnamed clients land under "Imported").
   * Rows identical to an existing entry (same day, project, task,
   * duration, notes) are skipped, so re-importing the same file is a
   * no-op. Returns { added, skipped, clientsCreated, projectsCreated }.
   */
  async importEntries(items) {
    const now = Date.now();
    let clientsCreated = 0;
    let projectsCreated = 0;
    const findClient = (name) => this.clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const findProject = (clientId, name) => this.projects.find((p) =>
      (clientId ? p.clientId === clientId : true) && p.name.toLowerCase() === name.toLowerCase());

    const resolved = [];
    for (const item of items) {
      let client = item.client ? findClient(item.client) : null;
      let project = item.client
        ? (client && findProject(client.id, item.project))
        : findProject(null, item.project);
      if (!project) {
        if (!client) {
          const name = item.client || 'Imported';
          client = findClient(name);
          if (!client) {
            client = await this.addClient({ name, slot: (this.clients.length % 8) + 1 });
            clientsCreated += 1;
          }
        }
        project = await this.addProject({ clientId: client.id, name: item.project, billable: item.billable });
        projectsCreated += 1;
      }
      resolved.push({ item, projectId: project.id });
    }

    const signature = (e, projectId) =>
      `${e.date}|${projectId}|${(e.task || '').trim().toLowerCase()}|${e.seconds}|${(e.notes || '').trim().toLowerCase()}`;
    const byMonth = new Map();
    for (const r of resolved) {
      const key = monthKeyOf(r.item.date);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(r);
    }

    let added = 0;
    let skipped = 0;
    for (const [key, rs] of byMonth) {
      await this.#mutateMonth(key, async (existing) => {
        const seen = new Set(existing.map((e) => signature(e, e.projectId)));
        const additions = [];
        for (const { item, projectId } of rs) {
          const sig = signature(item, projectId);
          if (seen.has(sig)) {
            skipped += 1;
            continue;
          }
          seen.add(sig);
          // Anchor createdAt to the entry's day so imported history sorts
          // sensibly among itself.
          const ts = new Date(`${item.date}T12:00:00`).getTime();
          additions.push({
            id: uid(),
            date: item.date,
            projectId,
            task: (item.task || '').trim(),
            notes: (item.notes || '').trim(),
            seconds: Math.round(item.seconds),
            startedAt: item.startedAt || null,
            endedAt: item.endedAt || null,
            billable: !!item.billable,
            rate: null,
            invoicedAt: null,
            lockedRate: null,
            lockedRounding: null,
            lockedMinimum: null,
            lockedCurrency: null,
            createdAt: ts,
            updatedAt: now,
          });
          added += 1;
        }
        if (additions.length) await this.#persistMonth(key, [...existing, ...additions]);
      });
    }
    this.#emit();
    return { added, skipped, clientsCreated, projectsCreated };
  }

  /* ---------- invoice logo ---------- */

  /**
   * Store an image as the invoice logo and point the settings at it.
   * Goes straight to the network like backups do: the offline mirror only
   * carries KV documents and month files, so a queued logo would be a
   * path resolving to nothing. Offline, the caller reports the failure and
   * the old logo (or none) stays in force.
   */
  async saveLogo(blob) {
    const ext = LOGO_EXT[blob?.type];
    if (!ext) throw new Error('Unsupported image type');
    // Two saves inside one millisecond would otherwise name the same file
    // and overwrite the logo an invoice issued a moment ago points at.
    let stamp = Date.now();
    if (this.settings.businessLogo === logoPath(stamp, ext)) stamp += 1;
    const path = logoPath(stamp, ext);
    await puter.fs.write(path, blob, { createMissingParents: true });
    await this.updateSettings({ businessLogo: path });
    return path;
  }

  /**
   * The stored logo as a Blob, or null when there is none, the path is not
   * one this app wrote, or it cannot be read (offline, or a file removed
   * outside the app). A missing logo is never an error: the invoice header
   * simply renders without one.
   */
  async readLogo(path) {
    if (!isLogoPath(path)) return null;
    try {
      const out = await puter.fs.read(path);
      return out instanceof Blob ? out : null;
    } catch {
      return null;
    }
  }

  /* ---------- backups ---------- */

  /**
   * Write a full-export snapshot to hourly-data/backups/, keeping the
   * newest BACKUP_KEEP and pruning older files. Goes straight to the
   * network on purpose: a backup that exists only in this device's
   * offline mirror protects nothing, so offline callers skip instead.
   */
  async writeBackup(now = Date.now()) {
    const date = isoOf(new Date(now));
    const text = JSON.stringify(await this.exportAll());
    await puter.fs.write(backupPath(date), text, { createMissingParents: true });
    const entry = { date, size: text.length };
    // A second snapshot on the same day overwrites the same file, so the
    // index keeps one row per day.
    const next = [...this.backups.filter((b) => b.date !== date), entry]
      .sort((a, b) => a.date.localeCompare(b.date));
    const pruned = next.splice(0, Math.max(0, next.length - BACKUP_KEEP));
    const prev = this.backups;
    this.backups = next;
    try {
      await this.#kvSet(KV.backups, this.backups);
    } catch (err) {
      this.backups = prev;
      throw err;
    }
    // Delete pruned files only after the index stopped referencing them:
    // a leftover file is harmless, a listed-but-missing one is a scare.
    for (const b of pruned) {
      await puter.fs.delete(backupPath(b.date)).catch(() => {});
    }
    this.#emit();
    return entry;
  }

  /**
   * Auto-snapshot on app open once the configured interval has passed.
   * Quiet by design: offline or a failed write just means the next open
   * tries again. Sample data never spends a retention slot.
   */
  async maybeAutoBackup(now = Date.now()) {
    const interval = this.settings.backupInterval || 'weekly';
    if (interval === 'off' || this.settings.sampleData) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const days = interval === 'monthly' ? 30 : 7;
    const last = this.backups.at(-1);
    if (last && addDays(last.date, days) > isoOf(new Date(now))) return null;
    return this.writeBackup(now);
  }

  /** Parsed contents of one stored snapshot. */
  async readBackup(date) {
    const blob = await puter.fs.read(backupPath(date));
    return JSON.parse(await blob.text());
  }

  /* ---------- import / export ---------- */

  async exportAll() {
    const transactions = {};
    for (const key of this.months) {
      transactions[key] = await this.loadMonth(key);
    }
    return {
      app: 'hourly',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.settings,
      clients: this.clients,
      projects: this.projects,
      invoices: this.invoices,
      entries: transactions,
    };
  }

  /**
   * Replace the whole dataset with `data` (an exportAll() shape). Used by
   * backup restore, sample data install, and sample wipe, so all of those
   * flow through one hardened path.
   */
  async importAll(data) {
    if (data?.app !== 'hourly') throw new Error('Not an Hourly export');
    // The version field is the migration hook: refuse data written by a
    // newer schema instead of silently mangling it. Older exports (and a
    // missing or garbled field) stay welcome, the shapes below tolerate
    // them.
    const version = Number(data.version ?? 1);
    if (Number.isFinite(version) && version > 1) {
      throw new Error('This backup is from a newer version of Hourly');
    }
    // Backups are user-supplied files: take only the shapes this app
    // wrote. Month keys become file paths, so anything that is not a
    // plain YYYY-MM key is dropped rather than interpolated into a path.
    const asArray = (v) => (Array.isArray(v) ? v : []);
    const entriesByMonth = (data.entries && typeof data.entries === 'object') ? data.entries : {};
    const months = Object.keys(entriesByMonth)
      .filter((k) => /^\d{4}-(0[1-9]|1[0-2])$/.test(k))
      .sort();
    // Write files first, then indexes: a crash mid-way leaves orphan files
    // (harmless) rather than an index pointing at nothing.
    for (const key of months) {
      const entries = asArray(entriesByMonth[key]).slice().sort(byEntryOrder);
      // A restore replaces rather than reconciles, so it writes straight
      // through and resets the baseline to exactly what it wrote; queued
      // offline, it stays a replacement when it is replayed.
      await this.#queueWrite(key, () => this.#writeMonthFile(key, JSON.stringify(entries), { replace: true }));
      this.#monthCache.set(key, entries);
      this.#monthBase.set(key, idSet(entries));
    }
    // Delete files for months that existed before but not in the import,
    // and drop their mirror copies so the cache matches the new dataset.
    for (const key of this.months.filter((k) => !months.includes(k))) {
      this.#monthCache.delete(key);
      offline.setMonth(key, null);
      offline.clearDirty(`fs:${key}`);
      await puter.fs.delete(monthPath(key)).catch(() => {});
    }
    const settings = (data.settings && typeof data.settings === 'object') ? data.settings : {};
    /* Stamped as a write, not with whatever the file carried. Settings
       reconcile as one document by newest write, so a restore that kept the
       backup's old stamp is not the newest write: the next refresh sees a
       higher stamp on the server (another device's, or this account's from
       after the backup was taken) and quietly puts those settings back,
       undoing the restore with nobody touching anything. Through stampFor,
       so it outranks the copy it replaces even when that one is stamped
       ahead of this clock. */
    this.settings = { ...DEFAULT_SETTINGS, ...settings, updatedAt: stampFor(this.settings) };
    this.clients = asArray(data.clients);
    this.projects = asArray(data.projects);
    this.invoices = asArray(data.invoices);
    this.months = months;
    // A timer left running on a project the import removed would keep
    // ticking and log an entry no client bill can ever pick up; discard
    // it (a failed key delete only resurrects it visibly on next load).
    if (this.timer && !this.projects.some((p) => p.id === this.timer.projectId)) {
      this.timer = null;
      await this.#kvSet(KV.timer, null).catch(() => {});
    }
    await Promise.all([
      this.#kvSet(KV.settings, this.settings),
      this.#kvSet(KV.clients, this.clients),
      this.#kvSet(KV.projects, this.projects),
      this.#kvSet(KV.invoices, this.invoices),
      this.#kvSet(KV.months, this.months),
    ]);
    this.#monthCache = new Map(months.map((k) => [k, this.#monthCache.get(k) || []]));
    for (const key of Object.keys(LIST_PROP)) {
      this.#kvBase.set(key, idSet(this[LIST_PROP[key]]));
    }
    this.#emit();
  }
}

/** Newest first: by date, then by creation time within a day. */
function byEntryOrder(a, b) {
  return b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
}

/** Month keys of the index that fall inside the range (avoids empty reads). */
function monthKeysBetweenIndexed(index, fromISO, toISO) {
  const from = fromISO.slice(0, 7);
  const to = toISO.slice(0, 7);
  return index.filter((k) => k >= from && k <= to);
}

export const store = new Store();

/** Fresh instance for tests; the app itself uses the singleton above. */
export function createStore() {
  return new Store();
}
