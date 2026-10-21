/**
 * Data layer on top of Puter.
 *
 * Everything lives in KV, one key per collection - small, hot, single-key
 * reads and no kv.list() scans. A founder-scale CRM (hundreds of contacts,
 * not hundreds of thousands) fits comfortably inside KV value limits, and
 * whole-collection writes keep the code simple and the export format exact:
 *
 *   crm:settings:v1    { currency, theme, onboarded, sampleData, stageProbabilities,
 *                        stages, customFields }
 *   crm:companies:v1   [{ id, name, industry, website, size, notes, tags,
 *                         custom: { [fieldId]: value }, createdAt }]
 *   crm:contacts:v1    [{ id, name, title, email, phone, companyId, source,
 *                         status: lead|active|customer|lost, notes, tags,
 *                         custom: { [fieldId]: value }, createdAt }]
 *   crm:deals:v1       [{ id, name, value, stage, contactId (primary), companyId,
 *                         contacts: [{ contactId, role }] (primary first),
 *                         expectedClose, notes, tags, createdAt, updatedAt,
 *                         closedAt, closeReason, closeReasonNote,
 *                         confidence: 0..1 | null (per-deal forecast override),
 *                         billing: one-time|monthly|annual,
 *                         term: months | null (recurring deals only),
 *                         custom: { [fieldId]: value },
 *                         stageHistory: [{ stage, at }] }]
 *   crm:activities:v1  [{ id, type: meeting|call|email|note, date, summary,
 *                         notes, contactId, companyId, dealId, createdAt }]
 *   crm:tasks:v1       [{ id, title, due, dueTime, done, doneAt, contactId,
 *                         dealId, createdAt, templateId (email to send),
 *                         repeat: { every, unit: day|week|month } | null,
 *                         spawnedId }]
 *   crm:templates:v1   [{ id, name, subject, body, createdAt }]
 *   crm:attachments:v1 [{ id, name, path, size, type, contactId, companyId,
 *                         dealId, uploadedAt }]  (bytes live in puter.fs)
 *   crm:trash:v1       [{ id, kind, at, name, record, refs }]  (30-day undo)
 *   crm:backup:v1      { at, reason, data }  (pre-import safety snapshot)
 *
 * Mutations update memory first and emit 'change' (instant UI), then await
 * the KV write. A write that cannot reach KV is not lost: it is staged in
 * the local outbox (lib/outbox.js) and replayed when the connection comes
 * back, so the record survives a reload. Reads fall back to the same local
 * copy, which is what lets a cold start work with no network at all.
 */

import { uid, todayISO, isValidISODate } from './util.js';
import { normalizeRepeat, nextRepeatDue } from './repeat.js';
import { normalizeTags, splitTags, cleanTag } from './tags.js';
import { deleteStoredFile, isAppFilePath } from './files.js';
import {
  resolveStages, firstStageId, isTerminalStage, stageEnteredAt, DEFAULT_STALE_DAYS,
  normalizeConfidence,
} from './forecast.js';
import { normalizeBilling, normalizeTerm } from './recurring.js';
import {
  normalizeDealContacts, dealContactIds, replacePrimary, withoutContact, repointContact,
  withContact,
} from './deal-contacts.js';
import {
  customFieldsOf, normalizeCustomFields, normalizeFieldList, normalizeCustomValues,
  isCustomKind, dropFieldValues, coerceFieldValue, retypeReport,
} from './fields.js';
import { normalizePlaybooks, playbookTasks } from './playbooks.js';
import { createOutbox, idbStorage } from './outbox.js';
import { normalizeViews, normalizeViewList, MAX_VIEWS } from './views.js';
import { DEFAULT_COLD_DAYS } from './attention.js';
import { CONTACT_STATUSES, ACTIVITY_TYPES } from './statuses.js';
import {
  parseMoney, parseDateLoose, matchStatus, matchStage, matchBilling, parseTerm,
  customCellValues,
} from './csv.js';

const KV = {
  settings: 'crm:settings:v1',
  companies: 'crm:companies:v1',
  contacts: 'crm:contacts:v1',
  deals: 'crm:deals:v1',
  activities: 'crm:activities:v1',
  tasks: 'crm:tasks:v1',
  templates: 'crm:templates:v1',
  attachments: 'crm:attachments:v1',
  trash: 'crm:trash:v1',
  backup: 'crm:backup:v1',
};

/** Not a collection: the signed-in user, kept locally for offline starts. */
const KV_USER = 'crm:user:v1';

/** The collection key behind a record-type name, for the shared paths. */
const KV_BY_KIND = {
  contacts: KV.contacts,
  companies: KV.companies,
  deals: KV.deals,
};

/** How long a deleted record stays restorable. */
export const TRASH_TTL = 30 * 86400000;
/** Bound on trash size, so a bulk cleanup can't balloon the KV value.
    Public so bulk delete can warn when a selection outruns restorability. */
export const TRASH_MAX = 200;

/** A stored KV value as data: a JSON string, an object, or nothing. */
function parseStored(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

function isLiveTrashEntry(e) {
  return e && typeof e === 'object' && e.record && typeof e.kind === 'string'
    && Number.isFinite(e.at) && Date.now() - e.at < TRASH_TTL;
}

/** The attachment records carried by a set of trash entries losing their slot. */
function attachmentRecordsOf(entries) {
  return entries
    .filter((e) => e?.kind === 'attachment' && e.record?.path)
    .map((e) => e.record);
}

export { CONTACT_STATUSES } from './statuses.js';
export { normalizeRepeat, nextRepeatDue, repeatLabel } from './repeat.js';

export const LEAD_SOURCES = [
  'Referral', 'Website', 'Cold outreach', 'Conference', 'Social', 'Inbound', 'Other',
];

export { ACTIVITY_TYPES, activityTypeInfo } from './statuses.js';

const DEFAULT_SETTINGS = {
  currency: 'DZD',
  theme: 'system',
  onboarded: false,
  sampleData: false,
  // Per-stage win-probability overrides ({ qualified: 0.3, ... }); stage
  // defaults from forecast.js apply where a stage has no entry.
  stageProbabilities: {},
  // The user's open stages ({ id, label, probability }), or null for the
  // default funnel. Won and Lost are always appended and never stored.
  stages: null,
  // Saved follow-up cadences ({ id, name, trigger, steps }), or null for
  // none. See lib/playbooks.js.
  playbooks: null,
  // Saved filter sets per list ({ contacts: [], companies: [], deals: [] }),
  // or null for none. See lib/views.js.
  views: null,
  // Per-record-type field definitions, or null for none. See lib/fields.js;
  // null rather than a shared {} so no two Store instances can end up
  // mutating the same default object.
  customFields: null,
  // Days a deal may sit in one stage before the board flags it (0 = never).
  staleDays: DEFAULT_STALE_DAYS,
  // Preferred pipeline layout: 'board' or 'list'.
  dealView: 'board',
  // Preferred follow-up layout: 'list' (the default), 'week', or 'month'.
  followupView: 'list',
  // Monthly revenue target in the app currency (0 = no goal set).
  revenueGoal: 0,
  // Weekly touch target: { all, meeting, call, email, note }, each 0 for
  // "no target". See lib/activity.js - the leading number to the revenue
  // goal's lagging one.
  touchTargets: null,
  // Days of silence before a lead or deal is flagged (0 = never).
  coldDays: DEFAULT_COLD_DAYS,
  // Browser notifications for follow-ups (needs the OS permission too).
  notifications: false,
  // Offer to schedule the next step after completing a follow-up, logging
  // an activity, or moving a deal, when the record has nothing else booked.
  nextStepNudges: true,
  // Days between automatic backups to Puter FS (0 = off). See lib/backups.js.
  autoBackupDays: 7,
  // AI assist (paste to create, draft an email, catch me up) on Puter's
  // built-in models. See lib/ai.js: false turns every control off, and so
  // does a platform without puter.ai.
  aiAssist: true,
};

/* ---------- import normalization ----------
   Identity for well-formed data; coerces the fields views sort and
   render on, so a hand-edited export can't crash the app. */

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
/**
 * Only a number, or a string that spells one, counts. Number() would take
 * null, '', true, and [] for 0 - and 0 is a finite timestamp, so a
 * hand-edited export with "createdAt": null would date the record to 1970
 * instead of falling back to now.
 */
const num = (v, fallback = 0) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v !== 'string' || !v.trim()) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const idOrNull = (v) => (typeof v === 'string' && v ? v : null);
const isoDate = (v, fallback) => (isValidISODate(v) ? v : fallback);

/** Due date, then time of day - an untimed task is "sometime that day". */
const byDue = (a, b) =>
  a.due.localeCompare(b.due) || (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99');

function normalizeAll(list, normalize) {
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && typeof r === 'object').map(normalize);
}

function normalizeCompany(c) {
  return {
    ...c, id: str(c.id) || uid(), name: str(c.name), industry: str(c.industry),
    website: str(c.website), size: str(c.size), notes: str(c.notes),
    tags: normalizeTags(c.tags), custom: normalizeCustomValues(c.custom),
    createdAt: num(c.createdAt, Date.now()),
  };
}

function normalizeContact(c) {
  return {
    ...c, id: str(c.id) || uid(), name: str(c.name), title: str(c.title),
    email: str(c.email), phone: str(c.phone), companyId: idOrNull(c.companyId),
    source: str(c.source),
    status: CONTACT_STATUSES.some((s) => s.value === c.status) ? c.status : 'lead',
    notes: str(c.notes), tags: normalizeTags(c.tags),
    custom: normalizeCustomValues(c.custom),
    createdAt: num(c.createdAt, Date.now()),
  };
}

function normalizeDeal(d, { stageIds, fallbackStage } = {}) {
  const stage = stageIds?.has(d.stage) ? d.stage : fallbackStage;
  const closed = stage === 'won' || stage === 'lost';
  const createdAt = num(d.createdAt, Date.now());
  const updatedAt = num(d.updatedAt, createdAt);
  // An absent (or unrecognized) billing mode reads as one-time, so every
  // deal written before subscriptions existed - and every export of one -
  // keeps the value, the forecast, and the CSV it always had. A term only
  // means something while the deal recurs; see clearTerm below.
  const billing = normalizeBilling(d.billing);
  // The people on the deal, primary first. A deal written before this
  // existed carries only contactId, and normalizeDealContacts turns that
  // into the one-entry list - so the two fields always agree and nothing
  // downstream has to know which era a record came from.
  const contacts = normalizeDealContacts(d.contacts, idOrNull(d.contactId));
  return {
    ...d, id: str(d.id) || uid(), name: str(d.name), value: num(d.value),
    billing, term: normalizeTerm(d.term, billing),
    stage, contacts, contactId: contacts[0]?.contactId ?? null,
    companyId: idOrNull(d.companyId),
    expectedClose: isoDate(d.expectedClose, null), notes: str(d.notes),
    tags: normalizeTags(d.tags), custom: normalizeCustomValues(d.custom),
    // Why it closed only means something while it is closed - see
    // clearCloseRecord below.
    closeReason: closed ? str(d.closeReason) : '',
    closeReasonNote: closed ? str(d.closeReasonNote) : '',
    // Closed deals need no probability - won is 1 and lost is 0 forever.
    confidence: closed ? null : normalizeConfidence(d.confidence),
    createdAt, updatedAt,
    closedAt: closed ? num(d.closedAt, Date.now()) : null,
    stageHistory: normalizeStageHistory(d.stageHistory, { stage, createdAt, updatedAt }),
  };
}

/**
 * A deal is back in play: drop everything that described a close that no
 * longer stands.
 *
 * The close date was already cleared here; the recorded reason was not, and
 * it outlived the close in three visible ways. An open deal exported a
 * "Close reason" column. Closing it again pre-selected the old answer, so a
 * one-click Skip filed it unchanged. And a deal won, reopened, then lost
 * reported its *winning* reason in the Lost column of the forecast - the one
 * report whose whole job is telling the two apart.
 */
function clearCloseRecord(deal) {
  deal.closedAt = null;
  deal.closeReason = '';
  deal.closeReasonNote = '';
}

/**
 * Custom-field values on a merge: the survivor keeps everything it has,
 * and fills its blanks from the record being merged away. The merge dialog
 * only asks about built-in fields, so without this a field only the
 * duplicate had answered went to the trash with it.
 */
function mergeCustomValues(survivor, merged) {
  const out = { ...normalizeCustomValues(survivor) };
  for (const [key, value] of Object.entries(normalizeCustomValues(merged))) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/**
 * Keep a deal's primary contact and its contact list agreeing after a patch.
 *
 * `contacts` in a patch is the whole list - that is what the form sends,
 * with the primary select as its first entry. A patch carrying only
 * `contactId` is changing who the primary is, which swaps the first entry
 * and leaves the others where they are. `before` is the list as it stood
 * before the patch landed on the deal.
 */
function settleDealContacts(deal, patch, before) {
  const list = 'contacts' in patch ? patch.contacts
    : ('contactId' in patch ? replacePrimary(before, patch.contactId) : before);
  const primary = 'contacts' in patch && 'contactId' in patch ? patch.contactId : null;
  deal.contacts = normalizeDealContacts(list, primary);
  deal.contactId = deal.contacts[0]?.contactId ?? null;
}

/** Take a contact off a deal, promoting the next one when they led it. */
function detachDealContact(deal, contactId) {
  const next = withoutContact(deal.contacts, contactId);
  if (next.length === (deal.contacts?.length ?? 0)) return false;
  deal.contacts = next;
  deal.contactId = deal.contacts[0]?.contactId ?? null;
  return true;
}

/**
 * Keep billing and term consistent on a deal being written.
 *
 * A term is meaningful only while the deal recurs: switching a $2k/mo
 * 12-month deal back to one-time and leaving `term: 12` on it would export
 * a term column for a deal that has none, and switching back would silently
 * restore a contract length the user never re-confirmed. A deal that starts
 * recurring with no term gets the default one rather than NaN months.
 */
function settleBilling(deal) {
  deal.billing = normalizeBilling(deal.billing);
  deal.term = normalizeTerm(deal.term, deal.billing);
}

/* ---------- stage history ----------
   Every stage change appends { stage, at }. Deals from before the feature
   (and hand-edited exports) are backfilled with a single entry from
   createdAt, so time-in-stage has something honest to read. */

const MAX_STAGE_HISTORY = 50;
/** A stage change reversed inside this window rewrites the last hop. */
const STAGE_UNDO_WINDOW = 30_000;

function normalizeStageHistory(raw, { stage, createdAt, updatedAt }) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e !== 'object' || typeof e.stage !== 'string' || !e.stage) continue;
    out.push({ stage: e.stage, at: num(e.at, createdAt) });
  }
  out.sort((a, b) => a.at - b.at);
  if (!out.length) out.push({ stage, at: createdAt });
  // The tail has to agree with the deal's stage or time-in-stage lies.
  if (out[out.length - 1].stage !== stage) out.push({ stage, at: updatedAt });
  return out.slice(-MAX_STAGE_HISTORY);
}

function recordStageEntry(deal, stage, at, fromStage) {
  // The backfill needs the stage the deal held *before* this move, passed
  // in by the caller - by now deal.stage already carries the new one, and
  // seeding that at createdAt would swallow the hop below and hand
  // stageEnteredAt (so closedAt too) the deal's creation date.
  if (!Array.isArray(deal.stageHistory) || !deal.stageHistory.length) {
    deal.stageHistory = [{ stage: fromStage, at: num(deal.createdAt, at) }];
  }
  const hist = deal.stageHistory;
  const last = hist[hist.length - 1];
  if (last?.stage === stage) return;
  // A hop reversed inside the window is erased rather than logged as a
  // round trip nobody made - that is what Undo does. Moving on to a
  // *different* stage that quickly is a second real move (working a
  // backfilled deal up the board), and keeps its own entry.
  if (hist.length > 1 && hist[hist.length - 2].stage === stage
      && at - last.at < STAGE_UNDO_WINDOW) {
    hist.pop();
    return;
  }
  hist.push({ stage, at });
  if (hist.length > MAX_STAGE_HISTORY) hist.splice(0, hist.length - MAX_STAGE_HISTORY);
}

function normalizeActivity(a) {
  return {
    ...a, id: str(a.id) || uid(),
    type: ACTIVITY_TYPES.some((t) => t.value === a.type) ? a.type : 'note',
    date: isoDate(a.date, todayISO()), summary: str(a.summary), notes: str(a.notes),
    contactId: idOrNull(a.contactId), companyId: idOrNull(a.companyId),
    dealId: idOrNull(a.dealId), createdAt: num(a.createdAt, Date.now()),
  };
}

const clockTime = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '');

function normalizeAttachment(a) {
  return {
    ...a, id: str(a.id) || uid(), name: str(a.name),
    // A path is the one field that names something outside this app's own
    // data, and an import brings it in verbatim. Anything but a file this
    // app wrote is dropped rather than stored, so the orphan purge can
    // never be pointed at a backup or a neighbouring app's file.
    path: isAppFilePath(a.path) ? a.path : '',
    size: num(a.size), type: str(a.type),
    contactId: idOrNull(a.contactId), companyId: idOrNull(a.companyId),
    dealId: idOrNull(a.dealId), uploadedAt: num(a.uploadedAt, Date.now()),
  };
}

function normalizeTemplate(t) {
  return {
    ...t, id: str(t.id) || uid(), name: str(t.name), subject: str(t.subject),
    body: str(t.body), createdAt: num(t.createdAt, Date.now()),
  };
}

function normalizeTask(t) {
  return {
    ...t, id: str(t.id) || uid(), title: str(t.title),
    due: isoDate(t.due, todayISO()), dueTime: clockTime(t.dueTime), done: !!t.done,
    doneAt: t.done ? num(t.doneAt, Date.now()) : null,
    contactId: idOrNull(t.contactId), dealId: idOrNull(t.dealId),
    // The email a playbook step meant this follow-up to send. A hint for
    // the Email button on the row, not a link to anything: the template
    // can be deleted and the follow-up still stands.
    templateId: idOrNull(t.templateId),
    repeat: normalizeRepeat(t.repeat), spawnedId: idOrNull(t.spawnedId),
    createdAt: num(t.createdAt, Date.now()),
  };
}

class Store extends EventTarget {
  settings = { ...DEFAULT_SETTINGS };
  companies = [];
  contacts = [];
  deals = [];
  activities = [];
  tasks = [];
  /** Reusable email templates, edited in Settings. */
  templates = [];
  /** Attachment metadata; the bytes live in puter.fs under attachments/. */
  attachments = [];
  /** Recently deleted records, newest first. See TRASH_TTL. */
  trash = [];
  /** One-slot snapshot taken before a destructive bulk operation. */
  backup = null;
  user = null;

  /** Per-key write chains: a later save of a collection waits for the earlier one. */
  #writes = new Map();

  /**
   * The durable local copy and the queue of writes KV hasn't taken. Swapped
   * for an in-memory one in tests through `useOutbox`.
   */
  #outbox = createOutbox({
    storage: idbStorage(),
    kv: {
      get: (key) => puter.kv.get(key),
      set: (key, payload) => puter.kv.set(key, payload),
    },
  });

  /**
   * What the UI needs to be honest about where the data is:
   *   offline  - the last KV call failed, so we are working locally
   *   queued   - writes owed to KV
   *   conflicts- queued writes blocked on a decision
   *   durable  - whether the local copy really survives a reload
   */
  offline = { offline: false, queued: 0, conflicts: 0, durable: true };

  /** Swap the outbox (tests, and the in-memory fallback). */
  useOutbox(outbox) {
    this.#outbox = outbox;
    this.offline = { ...this.offline, durable: outbox.durable !== false };
  }

  outbox() {
    return this.#outbox;
  }

  /** Bumped on every emit, so refresh() can tell when it raced a mutation. */
  #mutations = 0;

  /** KV writes not yet settled; refresh() must never swap out from under one. */
  #pendingWrites = 0;

  /** Memo for stages(): re-resolved only when the configured list changes. */
  #stageCache = { key: undefined, value: null };

  /**
   * The configured stage list (open stages then Won/Lost). Every view reads
   * stages from here rather than the module defaults, so renaming or
   * reordering in Settings reaches the whole app.
   */
  stages() {
    if (this.#stageCache.key !== this.settings.stages) {
      this.#stageCache = { key: this.settings.stages, value: resolveStages(this.settings) };
    }
    return this.#stageCache.value;
  }

  /** Stage a deal falls back to: the first open stage. */
  firstStage() {
    return firstStageId(this.stages());
  }

  #dealStageContext() {
    const stages = this.stages();
    return { stageIds: new Set(stages.map((s) => s.id)), fallbackStage: firstStageId(stages) };
  }

  async init() {
    // What the last session couldn't deliver: read before anything else, so
    // a queued write is known about before the first read decides whether
    // to trust KV or this device.
    await this.#outbox.ready().catch(() => {});
    this.offline = {
      ...this.offline,
      queued: this.#outbox.pendingCount(),
      conflicts: (await this.#outbox.conflicts().catch(() => [])).length,
      durable: this.#outbox.durable !== false,
    };
    const [settings, companies, contacts, deals, activities, tasks, templates, attachments, trash, backup] = await Promise.all([
      this.#read(KV.settings),
      this.#read(KV.companies),
      this.#read(KV.contacts),
      this.#read(KV.deals),
      this.#read(KV.activities),
      this.#read(KV.tasks),
      this.#read(KV.templates),
      this.#read(KV.attachments),
      this.#read(KV.trash),
      this.#read(KV.backup),
    ]);
    // Shape-check what comes back: one corrupt KV value must not brick the
    // whole app at boot (every view calls .filter/.sort on these), and the
    // trash and backup below already get the same treatment.
    const list = (v) => (Array.isArray(v) ? v : []);
    const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    this.settings = { ...DEFAULT_SETTINGS, ...record(settings) };
    this.companies = list(companies);
    this.contacts = list(contacts);
    this.deals = list(deals);
    this.activities = list(activities);
    this.tasks = list(tasks);
    this.templates = list(templates);
    this.attachments = list(attachments);
    this.backup = backup && typeof backup === 'object' ? backup : null;
    // Expired entries are dropped on the way in, so the trash empties
    // itself without a scheduler. An expired attachment entry takes its
    // stored file with it - that was the 30-day deal - unless something
    // else still answers for the file, which #reclaimFiles settles.
    const rawTrash = Array.isArray(trash) ? trash : [];
    const kept = rawTrash.filter(isLiveTrashEntry);
    this.trash = kept;
    if (kept.length !== rawTrash.length) {
      this.#reclaimFiles(attachmentRecordsOf(rawTrash.filter((e) => !kept.includes(e))));
      this.#save(KV.trash, this.trash).catch(() => {});
    }
    this.#purgeOrphanAttachments();
    // The collections above were replaced wholesale, so anything derived
    // from the old ones is answering about data that is gone.
    this.#lastContact = null;
    this.#links = null;
    // The signed-in user, remembered locally: an offline start can't ask
    // the platform who this is, and "Puter user" in the sidebar of your own
    // CRM reads like a different account.
    try {
      this.user = await puter.auth.getUser();
      await this.#outbox.mirror(KV_USER, JSON.stringify(this.user)).catch(() => {});
    } catch {
      this.user = parseStored(await this.#outbox.localValue(KV_USER).catch(() => null));
    }
  }

  /**
   * Pull in what another session wrote - the phone that logged calls all
   * week while this laptop tab sat in the background. Every mutation here
   * writes whole collections from memory, so that stale tab's first edit
   * would otherwise hand KV a copy of last week and erase the phone's work
   * without an error anywhere.
   *
   * Strictly read-and-compare: nothing is written, and the swap is skipped
   * whenever it could lose something this session knows - a write still in
   * flight, or a mutation landing while the reads were out. A skipped
   * refresh costs nothing; the next foreground moment tries again.
   * Two sessions both actively writing can still race - that needs a
   * server to referee - but the stale-tab case is the one that eats real
   * work, and it ends here. Returns whether anything changed.
   */
  refresh() {
    // Focus and visibility fire together on an ordinary tab switch; one
    // round of reads answers both.
    this.#refreshing ??= this.#refresh().finally(() => { this.#refreshing = null; });
    return this.#refreshing;
  }

  #refreshing = null;

  async #refresh() {
    // A write of ours still owed to KV means KV is behind this device, not
    // ahead of it: swapping now would drop the very change that is queued.
    if (this.#pendingWrites || this.#outbox.hasPending()) return false;
    const stamp = this.#mutations;
    let values;
    try {
      values = await Promise.all([
        KV.settings, KV.companies, KV.contacts, KV.deals, KV.activities,
        KV.tasks, KV.templates, KV.attachments, KV.trash, KV.backup,
      ].map((key) => this.#readRemote(key)));
    } catch {
      // Offline: nothing was read, so nothing is swapped, and what is on
      // screen stays exactly as it is.
      this.#markOffline(true);
      return false;
    }
    this.#markOffline(false);
    const [settings, companies, contacts, deals, activities, tasks, templates, attachments, trash, backup] = values;
    if (this.#pendingWrites || this.#mutations !== stamp) return false;
    const list = (v) => (Array.isArray(v) ? v : []);
    const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    let changed = false;
    const swap = (name, value) => {
      if (JSON.stringify(this[name]) === JSON.stringify(value)) return;
      this[name] = value;
      changed = true;
    };
    swap('settings', { ...DEFAULT_SETTINGS, ...record(settings) });
    swap('companies', list(companies));
    swap('contacts', list(contacts));
    swap('deals', list(deals));
    swap('activities', list(activities));
    swap('tasks', list(tasks));
    swap('templates', list(templates));
    swap('attachments', list(attachments));
    const rawTrash = list(trash);
    const liveTrash = rawTrash.filter(isLiveTrashEntry);
    swap('trash', liveTrash);
    swap('backup', backup && typeof backup === 'object' ? backup : null);
    if (changed) this.#emit();
    // An entry that aged out between boot and now is dropped here exactly
    // as init drops it - and its stored file has to go with it for the
    // same reason. Without this the 30 days could run out on a tab that
    // was already open: the entry vanished from memory, the next mutation
    // wrote the shortened trash to KV, and the only record of that path
    // went with it, stranding the bytes in FS where nothing could name
    // them again. Run after every swap has landed, so the live manifest
    // and the snapshot both get their say on what stays.
    this.#reclaimFiles(attachmentRecordsOf(rawTrash.filter((e) => !liveTrash.includes(e))));
    return changed;
  }

  /**
   * Attachments whose owner exists neither live nor in the trash belong
   * to a record that is gone for good - drop them, and reclaim the bytes
   * nothing else answers for. While the owner sits in the trash the files
   * wait, so restoring it brings its attachments back intact.
   *
   * The bytes go through #reclaimFiles like every other reclaim, because
   * the safety snapshot can still name the same path: delete the record,
   * empty the trash, and this purge would take the file of an attachment
   * "Restore previous data" was about to bring back - a live row with a
   * broken download and no way to undo it.
   */
  #purgeOrphanAttachments() {
    if (!this.attachments.length) return;
    const owners = new Set();
    for (const list of [this.contacts, this.companies, this.deals]) {
      for (const r of list) owners.add(r.id);
    }
    for (const e of this.trash) if (e.record?.id) owners.add(e.record.id);
    const kept = this.attachments.filter((a) =>
      owners.has(a.contactId) || owners.has(a.companyId) || owners.has(a.dealId));
    if (kept.length === this.attachments.length) return;
    const dropped = this.attachments.filter((a) => !kept.includes(a));
    // Dropped from the manifest first, so the records on their way out
    // cannot vouch for their own files.
    this.attachments = kept;
    this.#reclaimFiles(dropped);
    this.#save(KV.attachments, this.attachments).catch(() => {});
  }

  /**
   * Read a collection: KV when it answers, the durable local copy when it
   * doesn't. A successful read also refreshes that local copy, which is
   * both the offline boot data and the base a queued write is checked
   * against.
   */
  async #read(key) {
    try {
      return await this.#readRemote(key);
    } catch {
      this.#markOffline(true);
      return parseStored(await this.#outbox.localValue(key).catch(() => null));
    }
  }

  /**
   * Strictly KV: throws when it can't be reached, so refresh() can tell a
   * real remote answer from the local copy. Swapping the local copy in
   * would be pointless at best - and at worst it would replace a
   * collection in memory with the empty value of a key never written.
   */
  async #readRemote(key) {
    const raw = await puter.kv.get(key);
    await this.#outbox.mirror(key, raw).catch(() => {});
    return parseStored(raw);
  }

  /** Note that KV is (or isn't) answering, and tell the UI when it changes. */
  #markOffline(offline) {
    if (this.offline.offline === offline) return;
    this.offline = { ...this.offline, offline };
    this.#emitOffline();
  }

  #emitOffline() {
    this.dispatchEvent(new Event('offline'));
  }

  /** Re-read the outbox's own counters and announce them. */
  async #syncOfflineState({ conflicts = null } = {}) {
    const queued = this.#outbox.pendingCount();
    const blocked = conflicts ?? (await this.#outbox.conflicts().catch(() => [])).length;
    if (this.offline.queued === queued && this.offline.conflicts === blocked) return;
    this.offline = { ...this.offline, queued, conflicts: blocked };
    this.#emitOffline();
  }

  /**
   * Persist a collection. The local copy is written first and always, so
   * the record survives a reload whatever the network does; then KV is
   * asked, and a refusal queues the write rather than dropping it.
   *
   * This resolves either way - the data is safe in both cases, and the
   * difference is reported through the `offline` state rather than as a
   * failure the caller has to translate. A genuine programming error still
   * rejects, which is what the forms' catch is for.
   */
  #save(key, value) {
    const prev = this.#writes.get(key) || Promise.resolve();
    // Serialize now: the write carries the state at mutation time even if
    // another mutation lands while an earlier write is still in flight.
    const payload = JSON.stringify(value);
    this.#pendingWrites++;
    const next = prev.catch(() => {}).then(async () => {
      await this.#outbox.stage(key, payload).catch(() => {});
      try {
        await puter.kv.set(key, payload);
      } catch {
        await this.#outbox.queue(key, payload).catch(() => {});
        this.#markOffline(true);
        await this.#syncOfflineState({ conflicts: this.offline.conflicts });
        return;
      }
      await this.#outbox.confirm(key, payload).catch(() => {});
      this.#markOffline(false);
      await this.#syncOfflineState();
    });
    const settle = () => { this.#pendingWrites--; };
    next.then(settle, settle);
    this.#writes.set(key, next);
    return next;
  }

  /**
   * Replay whatever KV hasn't taken. Called at boot, when the browser says
   * it is back online, and from the Settings row. Returns the outbox
   * result so the caller can report conflicts.
   */
  async syncNow() {
    const result = await this.#outbox.flush();
    // A conflict is KV answering, not KV missing: the outbox read the
    // remote value and found it moved on. Left out of this, the indicator
    // kept telling a reconnected user they were working offline - the one
    // thing this whole feature exists to be honest about - until some
    // other write happened to land.
    if (result.synced.length || result.conflicts.length) this.#markOffline(false);
    if (result.failed.length) this.#markOffline(true);
    await this.#syncOfflineState({ conflicts: result.conflicts.length });
    // A queued write that landed changes nothing on screen, but a resolved
    // conflict might: re-read once the queue is empty.
    if (result.synced.length && !this.#outbox.hasPending()) await this.refresh().catch(() => {});
    return result;
  }

  /** Settle one conflicted collection: 'mine' or 'theirs'. */
  async resolveConflict(key, choice) {
    const done = await this.#outbox.resolve(key, choice);
    // A resolution that landed means KV answered - the indicator should
    // stop saying otherwise.
    if (done) this.#markOffline(false);
    await this.#syncOfflineState();
    if (done && choice === 'theirs') await this.refresh().catch(() => {});
    return done;
  }

  /** What is waiting, for the Settings row. */
  pendingWrites() {
    return this.#outbox.pending();
  }

  #emit() {
    this.#mutations++;
    this.#lastContact = null;
    this.#links = null;
    this.dispatchEvent(new Event('change'));
  }

  /** Memo for lastContact(); dropped on every mutation. */
  #lastContact = null;

  /** Memo for the id and owner lookups below; dropped on every mutation. */
  #links = null;

  /**
   * Records by id, and the deals and people hanging off each owner.
   *
   * These are the lookups the list views make once per row, and a
   * scan-per-row is what turns a search box into contacts times deals of
   * work on every keystroke. Built in one pass per change instead, the
   * same bargain lastContact() strikes.
   */
  #linkIndex() {
    if (!this.#links) {
      const push = (map, key, value) => {
        if (!key) return;
        const list = map.get(key);
        if (list) list.push(value);
        else map.set(key, [value]);
      };
      const idx = {
        contacts: new Map(), companies: new Map(), deals: new Map(),
        dealsByContact: new Map(), dealsByCompany: new Map(), contactsByCompany: new Map(),
      };
      for (const c of this.companies) idx.companies.set(c.id, c);
      for (const c of this.contacts) {
        idx.contacts.set(c.id, c);
        push(idx.contactsByCompany, c.companyId, c);
      }
      for (const d of this.deals) {
        idx.deals.set(d.id, d);
        // Every person on the deal, not only the primary: a lead's page
        // shows the deals they are on, whatever their role.
        for (const contactId of dealContactIds(d)) push(idx.dealsByContact, contactId, d);
        push(idx.dealsByCompany, d.companyId, d);
      }
      this.#links = idx;
    }
    return this.#links;
  }

  /**
   * Newest activity date per contact, company, and deal - built once per
   * change instead of scanned per row, so a list of 200 leads stays one
   * pass over the activities rather than 200.
   */
  lastContact() {
    if (!this.#lastContact) {
      const idx = { contacts: new Map(), companies: new Map(), deals: new Map() };
      const put = (map, id, date) => {
        if (id && date && (!map.has(id) || map.get(id) < date)) map.set(id, date);
      };
      for (const a of this.activities) {
        put(idx.contacts, a.contactId, a.date);
        put(idx.companies, a.companyId, a.date);
        put(idx.deals, a.dealId, a.date);
      }
      this.#lastContact = idx;
    }
    return this.#lastContact;
  }

  /** Last activity date on a contact (ISO), or null. */
  lastContactedAt(contactId) {
    return this.lastContact().contacts.get(contactId) || null;
  }

  /**
   * Last activity date touching a deal: its own history, or any of its
   * people's - a call logged against the champion still moved the deal,
   * and so did one logged against the person who signs.
   */
  lastTouchedDeal(deal) {
    if (!deal) return null;
    const idx = this.lastContact();
    let latest = idx.deals.get(deal.id) || null;
    for (const id of dealContactIds(deal)) {
      const at = idx.contacts.get(id) || null;
      if (at && (!latest || at > latest)) latest = at;
    }
    return latest;
  }

  /** Does this deal have an open follow-up - any next step at all? */
  hasOpenTask(dealId) {
    return this.tasks.some((t) => !t.done && t.dealId === dealId);
  }

  /* ---------- settings ---------- */

  async updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this.#emit();
    await this.#save(KV.settings, this.settings);
  }

  /**
   * Replace the configured open stages (null restores the defaults). Deals
   * whose stage no longer exists move to `remap[oldStage]` when that is
   * still a real open stage, else to the first open stage - a removed stage
   * must never leave deals stranded off the board.
   *
   * A removed stage also takes its win-probability override with it. The
   * override is keyed by stage id, and Settings mints the same "new-stage"
   * id for every stage the Add button creates - so a stage set to 90% and
   * then removed handed its 90% to the next one added, which arrived
   * labelled "New stage" and quietly weighted every deal in it at the
   * setting of a stage that no longer exists.
   */
  async setStages(list, remap = {}) {
    const settings = { ...this.settings, stages: list };
    const stages = resolveStages(settings);
    const ids = new Set(stages.map((s) => s.id));
    settings.stageProbabilities = Object.fromEntries(
      Object.entries(this.settings.stageProbabilities || {}).filter(([id]) => ids.has(id)));
    const openIds = new Set(stages.filter((s) => !isTerminalStage(s.id)).map((s) => s.id));
    const fallback = firstStageId(stages);
    const moved = [];
    for (const d of this.deals) {
      if (ids.has(d.stage)) continue;
      const target = remap[d.stage];
      const fromStage = d.stage;
      d.stage = openIds.has(target) ? target : fallback;
      d.updatedAt = Date.now();
      recordStageEntry(d, d.stage, d.updatedAt, fromStage);
      moved.push(d);
    }
    this.settings = settings;
    this.#emit();
    const writes = [this.#save(KV.settings, this.settings)];
    if (moved.length) writes.push(this.#save(KV.deals, this.deals));
    await Promise.all(writes);
    return moved.length;
  }

  /* ---------- custom fields ----------
     Definitions in settings, values on the records. The memo is the same
     bargain stages() strikes: list views ask for these once per row. */

  #fieldCache = { key: undefined, value: null };

  /** Every configured field list, shaped: { contacts, companies, deals }. */
  customFieldsAll() {
    if (this.#fieldCache.key !== this.settings.customFields) {
      this.#fieldCache = {
        key: this.settings.customFields,
        value: normalizeCustomFields(this.settings.customFields),
      };
    }
    return this.#fieldCache.value;
  }

  /** Fields for one record type; [] for a type that can't carry them. */
  customFields(kind) {
    return this.customFieldsAll()[kind] || [];
  }

  /**
   * Replace the field definitions for one record type.
   *
   * Removing a field takes its stored values with it - that is what the
   * confirmation in Settings is about. Changing a type converts what is
   * already stored, and refuses (throwing `custom-field-type`) when even
   * one value can't be read as the new type: dropping a value the user
   * typed is the one thing this must never do quietly.
   *
   * Returns { removed, converted } - how many values went, how many moved.
   */
  async setCustomFields(kind, list) {
    if (!isCustomKind(kind)) return { removed: 0, converted: 0 };
    const before = customFieldsOf(this.settings, kind);
    const next = normalizeFieldList(list);
    const records = this[kind];
    const removedIds = before.filter((f) => !next.some((n) => n.id === f.id)).map((f) => f.id);
    const retyped = next
      .map((f) => ({ field: f, from: before.find((b) => b.id === f.id) }))
      .filter((r) => r.from && r.from.type !== r.field.type);

    for (const { field } of retyped) {
      if (retypeReport(records, field, field.type).blocked.length) {
        throw new Error('custom-field-type');
      }
    }

    let removed = 0;
    let converted = 0;
    for (const record of records) {
      if (removedIds.length && dropFieldValues(record, removedIds)) removed++;
      for (const { field } of retyped) {
        const raw = record.custom?.[field.id];
        if (raw === null || raw === undefined || raw === '') continue;
        const value = coerceFieldValue(field, raw);
        if (value === null) delete record.custom[field.id];
        else record.custom[field.id] = value;
        converted++;
      }
    }

    const all = { ...this.customFieldsAll(), [kind]: next };
    this.settings = { ...this.settings, customFields: all };
    this.#emit();
    const writes = [this.#save(KV.settings, this.settings)];
    if (removed || converted) writes.push(this.#save(KV_BY_KIND[kind], records));
    await Promise.all(writes);
    return { removed, converted };
  }

  /* ---------- companies ---------- */

  async addCompany(data) {
    const company = {
      id: uid(), name: '', industry: '', website: '', size: '', notes: '',
      tags: [], custom: {}, createdAt: Date.now(), ...data,
    };
    company.custom = normalizeCustomValues(company.custom);
    this.companies.push(company);
    this.#emit();
    await this.#save(KV.companies, this.companies);
    return company;
  }

  async updateCompany(id, patch) {
    const company = this.companyById(id);
    if (!company) return null;
    Object.assign(company, patch);
    company.custom = normalizeCustomValues(company.custom);
    this.#emit();
    await this.#save(KV.companies, this.companies);
    return company;
  }

  /**
   * Removing a company detaches it everywhere; people, deals, and history
   * stay. Returns the trash entry so the caller can offer Undo.
   */
  async deleteCompany(id) {
    const company = this.companyById(id);
    if (!company) return null;
    const refs = {
      contacts: this.contacts.filter((c) => c.companyId === id).map((c) => c.id),
      deals: this.deals.filter((d) => d.companyId === id).map((d) => d.id),
      activities: this.activities.filter((a) => a.companyId === id).map((a) => a.id),
    };
    this.companies = this.companies.filter((c) => c.id !== id);
    for (const c of this.contacts) if (c.companyId === id) c.companyId = null;
    for (const d of this.deals) if (d.companyId === id) d.companyId = null;
    for (const a of this.activities) if (a.companyId === id) a.companyId = null;
    const entry = this.#toTrash('company', company, refs);
    this.#emit();
    await Promise.all([
      this.#save(KV.companies, this.companies),
      this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals),
      this.#save(KV.activities, this.activities),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  companyById(id) {
    return (id && this.#linkIndex().companies.get(id)) || null;
  }

  /* ---------- contacts (leads) ---------- */

  async addContact(data) {
    const contact = {
      id: uid(), name: '', title: '', email: '', phone: '', companyId: null,
      source: '', status: 'lead', notes: '', tags: [], custom: {},
      createdAt: Date.now(), ...data,
    };
    contact.custom = normalizeCustomValues(contact.custom);
    this.contacts.push(contact);
    this.#emit();
    await this.#save(KV.contacts, this.contacts);
    return contact;
  }

  async updateContact(id, patch) {
    const contact = this.contactById(id);
    if (!contact) return null;
    Object.assign(contact, patch);
    contact.custom = normalizeCustomValues(contact.custom);
    this.#emit();
    await this.#save(KV.contacts, this.contacts);
    return contact;
  }

  /** Deals and history survive a deleted contact - money and record-keeping outlive people churn. */
  async deleteContact(id) {
    const contact = this.contactById(id);
    if (!contact) return null;
    const refs = {
      // Every deal the person is on, not only the ones they lead: restore
      // has to be able to put them back wherever they were.
      deals: this.deals.filter((d) => dealContactIds(d).includes(id)).map((d) => d.id),
      activities: this.activities.filter((a) => a.contactId === id).map((a) => a.id),
      tasks: this.tasks.filter((t) => t.contactId === id).map((t) => t.id),
    };
    this.contacts = this.contacts.filter((c) => c.id !== id);
    for (const d of this.deals) detachDealContact(d, id);
    for (const a of this.activities) if (a.contactId === id) a.contactId = null;
    for (const t of this.tasks) if (t.contactId === id) t.contactId = null;
    const entry = this.#toTrash('contact', contact, refs);
    this.#emit();
    await Promise.all([
      this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals),
      this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  contactById(id) {
    return (id && this.#linkIndex().contacts.get(id)) || null;
  }

  /** A fresh array each time: callers sort and filter what they are given. */
  contactsOf(companyId) {
    return [...(this.#linkIndex().contactsByCompany.get(companyId) || [])];
  }

  /* ---------- deals ---------- */

  async addDeal(data) {
    const now = Date.now();
    const deal = {
      id: uid(), name: '', value: 0, stage: this.firstStage(), contactId: null,
      companyId: null, expectedClose: null, notes: '', tags: [],
      closeReason: '', closeReasonNote: '', confidence: null,
      billing: 'one-time', term: null, custom: {}, contacts: [],
      createdAt: now, updatedAt: now, closedAt: null, ...data,
    };
    deal.custom = normalizeCustomValues(deal.custom);
    deal.contacts = normalizeDealContacts(deal.contacts, deal.contactId);
    deal.contactId = deal.contacts[0]?.contactId ?? null;
    settleBilling(deal);
    if (deal.stage === 'won' || deal.stage === 'lost') {
      deal.closedAt ??= now;
      deal.confidence = null;
    }
    if (!Array.isArray(deal.stageHistory) || !deal.stageHistory.length) {
      deal.stageHistory = [{ stage: deal.stage, at: deal.createdAt }];
    }
    this.deals.push(deal);
    this.#emit();
    await this.#save(KV.deals, this.deals);
    return deal;
  }

  async updateDeal(id, patch) {
    const deal = this.dealById(id);
    if (!deal) return null;
    const fromStage = deal.stage;
    const beforeContacts = deal.contacts;
    Object.assign(deal, patch, { updatedAt: Date.now() });
    deal.custom = normalizeCustomValues(deal.custom);
    settleDealContacts(deal, patch, beforeContacts);
    settleBilling(deal);
    if (deal.stage !== fromStage) recordStageEntry(deal, deal.stage, deal.updatedAt, fromStage);
    const isClosed = deal.stage === 'won' || deal.stage === 'lost';
    // The close date is when the deal entered the stage it is in, which
    // recordStageEntry has just settled. That matters for the move it
    // erases: reopening a deal won months ago clears the stamp, and undoing
    // that misclick has to put the original month back, not book an old win
    // into this one's revenue. Reading Date.now() here would.
    //
    // Any move into a terminal stage re-dates it, not only the first: a deal
    // won in June and corrected to Lost in August closed in August, and
    // leaving June on it would rewrite June's win rate and hide the loss
    // from the month it happened in.
    if (isClosed && deal.stage !== fromStage) deal.closedAt = stageEnteredAt(deal) || Date.now();
    if (!isClosed) clearCloseRecord(deal);
    // Closing settles the question the confidence override answered.
    if (isClosed) deal.confidence = null;
    this.#emit();
    await this.#save(KV.deals, this.deals);
    return deal;
  }

  /** Stage moves route through updateDeal so closedAt stays consistent. */
  moveDeal(id, stage) {
    return this.updateDeal(id, { stage });
  }

  async deleteDeal(id) {
    const deal = this.dealById(id);
    if (!deal) return null;
    const refs = {
      activities: this.activities.filter((a) => a.dealId === id).map((a) => a.id),
      tasks: this.tasks.filter((t) => t.dealId === id).map((t) => t.id),
    };
    this.deals = this.deals.filter((d) => d.id !== id);
    for (const a of this.activities) if (a.dealId === id) a.dealId = null;
    for (const t of this.tasks) if (t.dealId === id) t.dealId = null;
    const entry = this.#toTrash('deal', deal, refs);
    this.#emit();
    await Promise.all([
      this.#save(KV.deals, this.deals),
      this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  dealById(id) {
    return (id && this.#linkIndex().deals.get(id)) || null;
  }

  /**
   * Deals on a contact, a company, or either. A fresh array each time, in
   * the order the deals are stored - callers sort and filter what they get.
   */
  dealsFor({ contactId, companyId } = {}) {
    const idx = this.#linkIndex();
    if (contactId && !companyId) return [...(idx.dealsByContact.get(contactId) || [])];
    if (companyId && !contactId) return [...(idx.dealsByCompany.get(companyId) || [])];
    if (!contactId && !companyId) return [];
    return this.deals.filter((d) =>
      dealContactIds(d).includes(contactId) || d.companyId === companyId);
  }

  /* ---------- activities (meetings, calls, emails, notes) ---------- */

  async addActivity(data) {
    const activity = {
      id: uid(), type: 'note', date: todayISO(), summary: '', notes: '',
      contactId: null, companyId: null, dealId: null, createdAt: Date.now(), ...data,
    };
    this.activities.push(activity);
    this.#emit();
    await this.#save(KV.activities, this.activities);
    return activity;
  }

  async updateActivity(id, patch) {
    const activity = this.activities.find((a) => a.id === id);
    if (!activity) return null;
    Object.assign(activity, patch);
    this.#emit();
    await this.#save(KV.activities, this.activities);
    return activity;
  }

  async deleteActivity(id) {
    const activity = this.activities.find((a) => a.id === id);
    if (!activity) return null;
    this.activities = this.activities.filter((a) => a.id !== id);
    const entry = this.#toTrash('activity', activity);
    this.#emit();
    await Promise.all([
      this.#save(KV.activities, this.activities),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  /** History for an entity, newest first (by activity date, then created order). */
  activitiesFor({ contactId, companyId, dealId } = {}) {
    return this.activities
      .filter((a) =>
        (contactId && a.contactId === contactId) ||
        (companyId && a.companyId === companyId) ||
        (dealId && a.dealId === dealId))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  /**
   * Everything on a deal's timeline: activity logged against the deal, plus
   * activity logged against one of its people that isn't already filed
   * under another deal. A call with the champion belongs on the deal they
   * champion; one they had about a different deal belongs on that one.
   */
  dealActivities(deal) {
    if (!deal) return [];
    const people = new Set(dealContactIds(deal));
    return this.activities
      .filter((a) => a.dealId === deal.id || (!a.dealId && people.has(a.contactId)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  recentActivities(limit = 8) {
    return [...this.activities]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /* ---------- tasks (follow-ups) ---------- */

  async addTask(data) {
    const task = {
      id: uid(), title: '', due: todayISO(), dueTime: '', done: false, doneAt: null,
      contactId: null, dealId: null, templateId: null, repeat: null, spawnedId: null,
      createdAt: Date.now(), ...data,
    };
    this.tasks.push(task);
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return task;
  }

  async updateTask(id, patch) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return null;
    Object.assign(task, patch);
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return task;
  }

  /**
   * Check a follow-up off (or back on). Completing a repeating one mints
   * the next occurrence - due the interval from today, not from the old
   * due date, so an overdue "every 30 days" doesn't come back already
   * late. Unchecking within the same session takes the minted occurrence
   * back with it, as long as it hasn't been completed itself.
   */
  async toggleTask(id, done) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return null;
    if (done && !task.done && task.repeat) {
      const next = {
        id: uid(), title: task.title,
        due: nextRepeatDue(todayISO(), task.repeat), dueTime: task.dueTime,
        done: false, doneAt: null, contactId: task.contactId, dealId: task.dealId,
        // The email this step stands for is part of the cadence, not part
        // of one occurrence of it: a monthly "send the check-in" that lost
        // its template on the first tick offered the Email button once and
        // never again.
        templateId: task.templateId || null,
        repeat: task.repeat, spawnedId: null, createdAt: Date.now(),
      };
      this.tasks.push(next);
      task.spawnedId = next.id;
    } else if (!done && task.done && task.spawnedId) {
      const spawned = this.tasks.find((t) => t.id === task.spawnedId);
      if (spawned && !spawned.done) this.tasks = this.tasks.filter((t) => t.id !== spawned.id);
      task.spawnedId = null;
    }
    task.done = done;
    task.doneAt = done ? Date.now() : null;
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return task;
  }

  async deleteTask(id) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return null;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    const entry = this.#toTrash('task', task);
    this.#emit();
    await Promise.all([
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  /** Open follow-ups, soonest due first (timed ones ahead of "sometime today"). */
  openTasks() {
    return this.tasks.filter((t) => !t.done).sort(byDue);
  }

  tasksFor({ contactId, dealId } = {}) {
    return this.tasks
      .filter((t) => (contactId && t.contactId === contactId) || (dealId && t.dealId === dealId))
      .sort((a, b) => Number(a.done) - Number(b.done) || byDue(a, b));
  }

  /* ---------- saved views ----------
     Filter sets per list, kept in settings. The list views own the
     filters; this only stores and orders them. */

  views(kind) {
    return normalizeViews(this.settings.views)[kind] || [];
  }

  /** Replace one list's views (capped and normalized on the way in). */
  async setViews(kind, list) {
    const all = { ...normalizeViews(this.settings.views) };
    if (!(kind in all)) return [];
    all[kind] = normalizeViewList(kind, list).slice(0, MAX_VIEWS);
    this.settings = { ...this.settings, views: all };
    this.#emit();
    await this.#save(KV.settings, this.settings);
    return all[kind];
  }

  /* ---------- playbooks ----------
     Definitions in settings; applying one writes plain follow-ups. */

  playbooks() {
    return normalizePlaybooks(this.settings.playbooks);
  }

  /** Replace the saved playbooks. */
  async setPlaybooks(list) {
    this.settings = { ...this.settings, playbooks: normalizePlaybooks(list) };
    this.#emit();
    await this.#save(KV.settings, this.settings);
    return this.playbooks();
  }

  /**
   * Apply a playbook to a lead or a deal: every step becomes a follow-up,
   * dated from `from`, in one write and one emit - so the whole thing is
   * one Undo rather than five toasts. Returns the tasks created.
   */
  async applyPlaybook(playbook, { contactId = null, dealId = null, from = todayISO() } = {}) {
    const now = Date.now();
    const created = playbookTasks(playbook, from).map((step) => normalizeTask({
      id: uid(), title: step.title, due: step.due, done: false, doneAt: null,
      contactId, dealId, templateId: step.templateId || null, createdAt: now,
    }));
    if (!created.length) return [];
    this.tasks.push(...created);
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return created;
  }

  /**
   * Take back a batch of follow-ups that were just created - the Undo for
   * applying a playbook. Deliberately not the trash: these records are
   * seconds old and were never worked, so filing five of them under
   * Recently deleted would bury the deletes that matter.
   */
  async undoAddedTasks(ids) {
    const wanted = new Set(ids);
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => !wanted.has(t.id));
    if (this.tasks.length === before) return 0;
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return before - this.tasks.length;
  }

  /* ---------- email templates ---------- */

  async addTemplate(data) {
    const template = {
      id: uid(), name: '', subject: '', body: '', createdAt: Date.now(), ...data,
    };
    this.templates.push(template);
    this.#emit();
    await this.#save(KV.templates, this.templates);
    return template;
  }

  async updateTemplate(id, patch) {
    const template = this.templates.find((t) => t.id === id);
    if (!template) return null;
    Object.assign(template, patch);
    this.#emit();
    await this.#save(KV.templates, this.templates);
    return template;
  }

  async deleteTemplate(id) {
    const template = this.templates.find((t) => t.id === id);
    if (!template) return null;
    this.templates = this.templates.filter((t) => t.id !== id);
    const entry = this.#toTrash('template', template);
    this.#emit();
    await Promise.all([
      this.#save(KV.templates, this.templates),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  templateById(id) {
    return this.templates.find((t) => t.id === id) || null;
  }

  /* ---------- attachments ----------
     Metadata only; lib/files.js owns the bytes. Deleting one is a trash
     entry like any other - the stored file is reclaimed when the entry
     expires, overflows, or the trash is emptied, never before. */

  async addAttachment(data) {
    const attachment = normalizeAttachment({ id: uid(), uploadedAt: Date.now(), ...data });
    this.attachments.push(attachment);
    this.#emit();
    await this.#save(KV.attachments, this.attachments);
    return attachment;
  }

  async deleteAttachment(id) {
    const attachment = this.attachments.find((a) => a.id === id);
    if (!attachment) return null;
    this.attachments = this.attachments.filter((a) => a.id !== id);
    const entry = this.#toTrash('attachment', attachment);
    this.#emit();
    await Promise.all([
      this.#save(KV.attachments, this.attachments),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  /** Files on one record, newest first. */
  attachmentsFor({ contactId, companyId, dealId } = {}) {
    return this.attachments
      .filter((a) =>
        (contactId && a.contactId === contactId) ||
        (companyId && a.companyId === companyId) ||
        (dealId && a.dealId === dealId))
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  /* ---------- bulk operations ----------
     One pass, one emit, one KV write per touched collection - a hundred
     status changes must not mean a hundred round trips. Deletes reuse the
     trash exactly like single deletes: one entry per record, links
     detached, everything restorable (up to TRASH_MAX entries). */

  /** Apply `patch` to every listed contact. Returns how many changed. */
  async bulkUpdateContacts(ids, patch) {
    const wanted = new Set(ids);
    let n = 0;
    for (const c of this.contacts) {
      if (!wanted.has(c.id)) continue;
      Object.assign(c, patch);
      n++;
    }
    if (!n) return 0;
    this.#emit();
    await this.#save(KV.contacts, this.contacts);
    return n;
  }

  /** Add one tag to every listed record of a collection. */
  async bulkTag(kind, ids, tag) {
    const byKind = {
      contacts: [this.contacts, KV.contacts],
      companies: [this.companies, KV.companies],
      deals: [this.deals, KV.deals],
    };
    const [list, key] = byKind[kind] || [];
    const clean = cleanTag(tag);
    if (!list || !clean) return 0;
    const wanted = new Set(ids);
    let n = 0;
    for (const r of list) {
      if (!wanted.has(r.id)) continue;
      r.tags = normalizeTags([...(r.tags || []), clean]);
      n++;
    }
    if (!n) return 0;
    this.#emit();
    await this.#save(key, list);
    return n;
  }

  /** Move every listed deal to `stage`, with the same close-date care as updateDeal. */
  async bulkMoveDeals(ids, stage) {
    const wanted = new Set(ids);
    const now = Date.now();
    let n = 0;
    for (const d of this.deals) {
      if (!wanted.has(d.id) || d.stage === stage) continue;
      const fromStage = d.stage;
      d.stage = stage;
      d.updatedAt = now;
      recordStageEntry(d, stage, now, fromStage);
      const closed = isTerminalStage(stage);
      // The stage always changed by here, so every close re-dates - see
      // the note in updateDeal about a won deal corrected to lost.
      if (closed) d.closedAt = stageEnteredAt(d) || now;
      if (!closed) clearCloseRecord(d);
      if (closed) d.confidence = null;
      n++;
    }
    if (!n) return 0;
    this.#emit();
    await this.#save(KV.deals, this.deals);
    return n;
  }

  /**
   * Delete every listed record of one kind ('contacts' | 'companies' |
   * 'deals') through the trash - one restorable entry each, links
   * detached the same way the single deletes do. Returns entries created.
   */
  async bulkDelete(kind, ids) {
    const wanted = new Set(ids);
    const writes = new Set([KV.trash]);
    const entries = [];

    if (kind === 'contacts') {
      for (const c of this.contacts) {
        if (!wanted.has(c.id)) continue;
        entries.push(this.#toTrash('contact', c, {
          deals: this.deals.filter((d) => dealContactIds(d).includes(c.id)).map((d) => d.id),
          activities: this.activities.filter((a) => a.contactId === c.id).map((a) => a.id),
          tasks: this.tasks.filter((t) => t.contactId === c.id).map((t) => t.id),
        }));
      }
      if (!entries.length) return [];
      this.contacts = this.contacts.filter((c) => !wanted.has(c.id));
      for (const d of this.deals) {
        for (const id of dealContactIds(d)) {
          if (!wanted.has(id)) continue;
          detachDealContact(d, id);
          writes.add(KV.deals);
        }
      }
      for (const a of this.activities) if (wanted.has(a.contactId)) { a.contactId = null; writes.add(KV.activities); }
      for (const t of this.tasks) if (wanted.has(t.contactId)) { t.contactId = null; writes.add(KV.tasks); }
      writes.add(KV.contacts);
    } else if (kind === 'companies') {
      for (const c of this.companies) {
        if (!wanted.has(c.id)) continue;
        entries.push(this.#toTrash('company', c, {
          contacts: this.contacts.filter((x) => x.companyId === c.id).map((x) => x.id),
          deals: this.deals.filter((d) => d.companyId === c.id).map((d) => d.id),
          activities: this.activities.filter((a) => a.companyId === c.id).map((a) => a.id),
        }));
      }
      if (!entries.length) return [];
      this.companies = this.companies.filter((c) => !wanted.has(c.id));
      for (const c of this.contacts) if (wanted.has(c.companyId)) { c.companyId = null; writes.add(KV.contacts); }
      for (const d of this.deals) if (wanted.has(d.companyId)) { d.companyId = null; writes.add(KV.deals); }
      for (const a of this.activities) if (wanted.has(a.companyId)) { a.companyId = null; writes.add(KV.activities); }
      writes.add(KV.companies);
    } else if (kind === 'deals') {
      for (const d of this.deals) {
        if (!wanted.has(d.id)) continue;
        entries.push(this.#toTrash('deal', d, {
          activities: this.activities.filter((a) => a.dealId === d.id).map((a) => a.id),
          tasks: this.tasks.filter((t) => t.dealId === d.id).map((t) => t.id),
        }));
      }
      if (!entries.length) return [];
      this.deals = this.deals.filter((d) => !wanted.has(d.id));
      for (const a of this.activities) if (wanted.has(a.dealId)) { a.dealId = null; writes.add(KV.activities); }
      for (const t of this.tasks) if (wanted.has(t.dealId)) { t.dealId = null; writes.add(KV.tasks); }
      writes.add(KV.deals);
    } else {
      return [];
    }

    this.#emit();
    const byKey = {
      [KV.companies]: this.companies, [KV.contacts]: this.contacts,
      [KV.deals]: this.deals, [KV.activities]: this.activities,
      [KV.tasks]: this.tasks, [KV.trash]: this.trash,
    };
    await Promise.all([...writes].map((k) => this.#save(k, byKey[k])));
    return entries;
  }

  /* ---------- merge (duplicates) ----------
     Two records that are the same real-world thing become one: the
     survivor keeps its id (so nothing pointing at it moves), takes the
     chosen field values plus both tag sets, and every deal, activity,
     follow-up, and file on the merged-away record is re-pointed at it. The
     files matter as much as the rest: an attachment left pointing at a
     record that no longer exists is invisible at once, and the orphan
     purge reclaims its bytes for good once the trash entry ages out. The merged
     record goes to the trash exactly like a delete, so a bad merge is
     walk-backable for 30 days - links stay with the survivor on restore. */

  /**
   * Merge `mergedId` into `survivorId`. `patch` carries the field values
   * the user picked from the merged record. Returns the trash entry.
   */
  async mergeContacts(survivorId, mergedId, patch = {}) {
    const survivor = this.contactById(survivorId);
    const merged = this.contactById(mergedId);
    if (!survivor || !merged || survivorId === mergedId) return null;
    const refs = {
      deals: this.deals.filter((d) => dealContactIds(d).includes(mergedId)).map((d) => d.id),
      activities: this.activities.filter((a) => a.contactId === mergedId).map((a) => a.id),
      tasks: this.tasks.filter((t) => t.contactId === mergedId).map((t) => t.id),
    };
    const entry = this.#toTrash('contact', merged, refs);
    this.contacts = this.contacts.filter((c) => c.id !== mergedId);
    Object.assign(survivor, patch);
    survivor.tags = normalizeTags([...(survivor.tags || []), ...(merged.tags || [])]);
    survivor.custom = mergeCustomValues(survivor.custom, merged.custom);
    // The book knew this person from whichever record came first.
    survivor.createdAt = Math.min(num(survivor.createdAt, Date.now()), num(merged.createdAt, Date.now()));
    for (const d of this.deals) {
      const next = repointContact(d.contacts, mergedId, survivorId);
      if (next === d.contacts) continue;
      d.contacts = next;
      d.contactId = d.contacts[0]?.contactId ?? null;
    }
    for (const a of this.activities) if (a.contactId === mergedId) a.contactId = survivorId;
    for (const t of this.tasks) if (t.contactId === mergedId) t.contactId = survivorId;
    for (const a of this.attachments) if (a.contactId === mergedId) a.contactId = survivorId;
    this.#emit();
    await Promise.all([
      this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals),
      this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.attachments, this.attachments),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  async mergeCompanies(survivorId, mergedId, patch = {}) {
    const survivor = this.companyById(survivorId);
    const merged = this.companyById(mergedId);
    if (!survivor || !merged || survivorId === mergedId) return null;
    const refs = {
      contacts: this.contacts.filter((c) => c.companyId === mergedId).map((c) => c.id),
      deals: this.deals.filter((d) => d.companyId === mergedId).map((d) => d.id),
      activities: this.activities.filter((a) => a.companyId === mergedId).map((a) => a.id),
    };
    const entry = this.#toTrash('company', merged, refs);
    this.companies = this.companies.filter((c) => c.id !== mergedId);
    Object.assign(survivor, patch);
    survivor.tags = normalizeTags([...(survivor.tags || []), ...(merged.tags || [])]);
    survivor.custom = mergeCustomValues(survivor.custom, merged.custom);
    survivor.createdAt = Math.min(num(survivor.createdAt, Date.now()), num(merged.createdAt, Date.now()));
    for (const c of this.contacts) if (c.companyId === mergedId) c.companyId = survivorId;
    for (const d of this.deals) if (d.companyId === mergedId) d.companyId = survivorId;
    for (const a of this.activities) if (a.companyId === mergedId) a.companyId = survivorId;
    for (const a of this.attachments) if (a.companyId === mergedId) a.companyId = survivorId;
    this.#emit();
    await Promise.all([
      this.#save(KV.companies, this.companies),
      this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals),
      this.#save(KV.activities, this.activities),
      this.#save(KV.attachments, this.attachments),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  /* ---------- tags ----------
     Tags live on the records, nowhere else - the "registry" below is
     derived, so there is no second list to fall out of step. */

  /** Every collection that can carry tags, named, with its KV key. */
  #taggedCollections() {
    return [
      ['contacts', this.contacts, KV.contacts],
      ['companies', this.companies, KV.companies],
      ['deals', this.deals, KV.deals],
    ];
  }

  /**
   * Every tag in use, with how many records wear it - usage first, so
   * autocomplete and filters lead with the labels that matter. Case
   * variants group under whichever spelling appeared first.
   *
   * `kind` ('contacts' | 'companies' | 'deals') narrows the count to one
   * collection. A list's tag filter asks for its own kind: the vocabulary
   * is shared across record types, so the whole-book list offered Companies
   * labels only leads wear, and every one of them was a filter that could
   * only ever empty the page.
   */
  allTags(kind = null) {
    const groups = new Map();
    for (const [name, list] of this.#taggedCollections()) {
      if (kind && kind !== name) continue;
      for (const r of list) {
        for (const tag of Array.isArray(r.tags) ? r.tags : []) {
          const key = tag.toLowerCase();
          const g = groups.get(key) || { name: tag, count: 0 };
          g.count++;
          groups.set(key, g);
        }
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  /** Rewrite a tag on every record wearing it. Returns records touched. */
  async renameTag(from, to) {
    const next = cleanTag(to);
    const key = String(from || '').toLowerCase();
    if (!next || !key) return 0;
    let touched = 0;
    const writes = [];
    for (const [, list, kvKey] of this.#taggedCollections()) {
      let changed = false;
      for (const r of list) {
        if (!Array.isArray(r.tags) || !r.tags.some((t) => t.toLowerCase() === key)) continue;
        // Replace in place, then dedupe - renaming "vip" to an existing
        // "VIP" must merge them, not leave the record wearing it twice.
        r.tags = normalizeTags(r.tags.map((t) => (t.toLowerCase() === key ? next : t)));
        touched++;
        changed = true;
      }
      if (changed) writes.push(this.#save(kvKey, list));
    }
    if (!touched) return 0;
    this.#emit();
    await Promise.all(writes);
    return touched;
  }

  /** Strip a tag from every record wearing it. Returns records touched. */
  async deleteTag(name) {
    const key = String(name || '').toLowerCase();
    if (!key) return 0;
    let touched = 0;
    const writes = [];
    for (const [, list, kvKey] of this.#taggedCollections()) {
      let changed = false;
      for (const r of list) {
        if (!Array.isArray(r.tags) || !r.tags.some((t) => t.toLowerCase() === key)) continue;
        r.tags = r.tags.filter((t) => t.toLowerCase() !== key);
        touched++;
        changed = true;
      }
      if (changed) writes.push(this.#save(kvKey, list));
    }
    if (!touched) return 0;
    this.#emit();
    await Promise.all(writes);
    return touched;
  }

  /* ---------- trash ----------
     Deletes move the record - plus the ids it was detached from - into a
     30-day trash instead of vanishing. Restore puts the record back and
     re-attaches the references whose other half still exists. */

  #toTrash(kind, record, refs = {}) {
    const entry = {
      id: uid(),
      kind,
      at: Date.now(),
      name: str(record.name) || str(record.title) || str(record.summary) || 'Untitled',
      record: JSON.parse(JSON.stringify(record)),
      refs,
    };
    this.trash.unshift(entry);
    if (this.trash.length > TRASH_MAX) {
      // Entries pushed off the end lose restorability; an attachment
      // entry takes its stored file with it rather than leaking bytes.
      // Truncate first, so the entries on their way out are not counted
      // among the holders that could keep their own files alive.
      const evicted = this.trash.slice(TRASH_MAX);
      this.trash.length = TRASH_MAX;
      this.#reclaimFiles(attachmentRecordsOf(evicted));
    }
    return entry;
  }

  /**
   * Put a restored contact back on the deals they were on. Additive, like
   * every other restore: they rejoin the list wherever it stands, and only
   * take the primary slot back if the deal has nobody in it - a deal whose
   * lead contact changed after the delete keeps the newer decision.
   */
  #relinkDealContacts(ids, contactId) {
    if (!Array.isArray(ids) || !ids.length) return false;
    const wanted = new Set(ids);
    let touched = false;
    for (const deal of this.deals) {
      if (!wanted.has(deal.id)) continue;
      const next = withContact(deal.contacts, contactId);
      if (next === deal.contacts) continue;
      deal.contacts = next;
      if (!deal.contactId) deal.contactId = deal.contacts[0]?.contactId ?? null;
      touched = true;
    }
    return touched;
  }

  /** Re-attach `field` on every listed record that is still unassigned. */
  #reattach(list, ids, field, value) {
    if (!Array.isArray(ids) || !ids.length) return false;
    const wanted = new Set(ids);
    let touched = false;
    for (const r of list) {
      if (wanted.has(r.id) && !r[field]) {
        r[field] = value;
        touched = true;
      }
    }
    return touched;
  }

  /**
   * Put a deleted record back. Links are restored only where the other
   * record still exists and has not been re-pointed since - undo should
   * never overwrite a decision made after the delete.
   */
  async restoreTrash(entryId) {
    const index = this.trash.findIndex((t) => t.id === entryId);
    if (index < 0) return null;
    const entry = this.trash[index];
    const { record, refs = {} } = entry;
    const writes = new Set([KV.trash]);
    const add = (list, key) => {
      if (!list.some((r) => r.id === record.id)) list.push(record);
      writes.add(key);
    };

    if (entry.kind === 'company') {
      add(this.companies, KV.companies);
      if (this.#reattach(this.contacts, refs.contacts, 'companyId', record.id)) writes.add(KV.contacts);
      if (this.#reattach(this.deals, refs.deals, 'companyId', record.id)) writes.add(KV.deals);
      if (this.#reattach(this.activities, refs.activities, 'companyId', record.id)) writes.add(KV.activities);
    } else if (entry.kind === 'contact') {
      add(this.contacts, KV.contacts);
      if (this.#relinkDealContacts(refs.deals, record.id)) writes.add(KV.deals);
      if (this.#reattach(this.activities, refs.activities, 'contactId', record.id)) writes.add(KV.activities);
      if (this.#reattach(this.tasks, refs.tasks, 'contactId', record.id)) writes.add(KV.tasks);
    } else if (entry.kind === 'deal') {
      // A stage removed while the deal sat in the trash must not leave it
      // stranded off the board - the rule setStages applies to live deals.
      if (!this.stages().some((s) => s.id === record.stage)) {
        const fromStage = record.stage;
        record.stage = this.firstStage();
        record.updatedAt = Date.now();
        recordStageEntry(record, record.stage, record.updatedAt, fromStage);
      }
      add(this.deals, KV.deals);
      if (this.#reattach(this.activities, refs.activities, 'dealId', record.id)) writes.add(KV.activities);
      if (this.#reattach(this.tasks, refs.tasks, 'dealId', record.id)) writes.add(KV.tasks);
    } else if (entry.kind === 'activity') {
      add(this.activities, KV.activities);
    } else if (entry.kind === 'task') {
      add(this.tasks, KV.tasks);
    } else if (entry.kind === 'template') {
      add(this.templates, KV.templates);
    } else if (entry.kind === 'attachment') {
      add(this.attachments, KV.attachments);
    } else {
      return null;
    }

    this.trash.splice(index, 1);
    this.#emit();
    const byKey = {
      [KV.companies]: this.companies, [KV.contacts]: this.contacts,
      [KV.deals]: this.deals, [KV.activities]: this.activities,
      [KV.tasks]: this.tasks, [KV.templates]: this.templates,
      [KV.attachments]: this.attachments, [KV.trash]: this.trash,
    };
    await Promise.all([...writes].map((k) => this.#save(k, byKey[k])));
    return entry;
  }

  async emptyTrash() {
    // Emptying is the user saying "gone for good" - attachment entries
    // give their stored files back now rather than at expiry. Cleared
    // first, so the entries about to go cannot vouch for their own files;
    // #reclaimFiles then spares whatever the live manifest or the safety
    // snapshot still points at.
    const dropped = attachmentRecordsOf(this.trash);
    this.trash = [];
    this.#reclaimFiles(dropped);
    this.#emit();
    await this.#save(KV.trash, this.trash);
  }

  /* ---------- safety snapshot ----------
     One slot, written before any bulk replace, so a bad import or a
     mistaken erase is one click from being undone. */

  hasData() {
    // Templates count: they are authored work an import replaces, and an
    // account holding only them still deserves the snapshot and the
    // weekly backup. Attachments don't - their metadata can't outlive the
    // records above, and the bytes live in FS untouched by any replace.
    return this.companies.length + this.contacts.length + this.deals.length
      + this.activities.length + this.tasks.length + this.templates.length > 0;
  }

  /** Public so bulk operations outside importAll (CSV) can guard themselves. */
  async saveSnapshot(reason) {
    // Rotating the one-slot snapshot is the moment the previous snapshot's
    // attachment manifest loses its last holder - reclaim what nothing
    // else still references, or the bytes sit in FS forever, invisible.
    const dropped = this.backup?.data?.attachments || [];
    await this.#saveBackup(reason);
    this.#reclaimFiles(dropped);
  }

  #saveBackup(reason) {
    // Deep copy, not the live collections: a CSV merge appends to and edits
    // those arrays in place, so an aliased snapshot would quietly grow into
    // a copy of the very import it is meant to undo.
    this.backup = { at: Date.now(), reason, data: JSON.parse(JSON.stringify(this.exportAll())) };
    return this.#save(KV.backup, this.backup);
  }

  /**
   * Delete the stored files of dropped attachment records that nothing
   * answers for anymore. A file must stay as long as anything can still
   * bring its metadata back - the live manifest, a trash entry awaiting
   * restore, or the safety snapshot - so the check runs against all three
   * at call time, after the drop has settled.
   *
   * Every path that reclaims bytes goes through here, because the same path
   * can legitimately be named twice. Restoring the safety snapshot over a
   * deleted attachment is the case that bit: the snapshot brings the record
   * back to the live manifest while the delete's trash entry still names the
   * same file, so emptying the trash was deleting the bytes of a live
   * attachment - a broken download and no way back.
   */
  #reclaimFiles(dropped) {
    if (!Array.isArray(dropped) || !dropped.length) return;
    const kept = new Set();
    for (const a of this.attachments) if (a?.path) kept.add(a.path);
    for (const e of this.trash) if (e?.kind === 'attachment' && e.record?.path) kept.add(e.record.path);
    for (const a of this.backup?.data?.attachments || []) if (a?.path) kept.add(a.path);
    const seen = new Set();
    for (const a of dropped) {
      const path = a?.path;
      if (!path || kept.has(path) || seen.has(path)) continue;
      seen.add(path);
      deleteStoredFile(path);
    }
  }

  /**
   * Swap the current data for the snapshot - and snapshot what was there,
   * so the restore itself can be undone if it was the wrong call.
   */
  async restoreBackup() {
    const snapshot = this.backup;
    if (!snapshot?.data) return false;
    await this.importAll(snapshot.data, { reason: 'restore' });
    return true;
  }

  /* ---------- CSV merge ----------
     Additive, not a replace: rows are appended, and a row that matches an
     existing record by email (leads) or name (companies, deals) updates it
     in place instead of creating a twin. Blank cells never wipe a value
     that is already there. */

  #findCompanyByName(name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    return this.companies.find((c) => c.name.trim().toLowerCase() === wanted) || null;
  }

  /**
   * Import mapped rows. Returns { added, updated, skipped, companiesCreated }.
   * Every record goes through the same normalization as a JSON import, so a
   * malformed row cannot poison the stored data.
   */
  async importRecords(kind, rows, { update = true } = {}) {
    const summary = { added: 0, updated: 0, skipped: 0, companiesCreated: 0 };
    const now = Date.now();
    const touched = new Set();
    const stages = this.stages();
    const stageCtx = this.#dealStageContext();

    /** Company by name, creating it if this is the first time we've seen it. */
    const companyFor = (name) => {
      const clean = String(name || '').trim();
      if (!clean) return null;
      const existing = this.#findCompanyByName(clean);
      if (existing) return existing;
      const company = normalizeCompany({ id: uid(), name: clean, createdAt: now });
      this.companies.push(company);
      summary.companiesCreated++;
      touched.add(KV.companies);
      return company;
    };

    /** Copy only the fields the row actually filled in. */
    const assignFilled = (target, patch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') continue;
        target[key] = value;
      }
    };

    /** Row tags join a matched record's own - an import must not strip labels. */
    const mergeTags = (target, rowTags) => {
      if (rowTags.length) target.tags = normalizeTags([...(target.tags || []), ...rowTags]);
    };

    /* Custom-field cells follow the same rule as every other column: a
       blank (or unreadable) cell leaves what the record already holds. */
    const fields = this.customFields(kind);
    const mergeCustom = (target, values) => {
      if (!Object.keys(values).length) return;
      target.custom = normalizeCustomValues({ ...(target.custom || {}), ...values });
    };

    for (const row of Array.isArray(rows) ? rows : []) {
      const name = String(row?.name || '').trim();
      if (!name) { summary.skipped++; continue; }

      if (kind === 'companies') {
        const rowTags = splitTags(row.tags);
        const patch = {
          name,
          industry: row.industry, website: row.website, size: row.size, notes: row.notes,
        };
        const custom = customCellValues(fields, row);
        const existing = update ? this.#findCompanyByName(name) : null;
        if (existing) {
          assignFilled(existing, patch);
          mergeTags(existing, rowTags);
          mergeCustom(existing, custom);
          summary.updated++;
        } else {
          this.companies.push(normalizeCompany({
            id: uid(), createdAt: now, ...patch, tags: rowTags, custom,
          }));
          summary.added++;
        }
        touched.add(KV.companies);
        continue;
      }

      if (kind === 'contacts') {
        const email = String(row.email || '').trim();
        const company = companyFor(row.company);
        const rowTags = splitTags(row.tags);
        const patch = {
          name, email, phone: row.phone, title: row.title, source: row.source,
          notes: row.notes, companyId: company?.id || null,
          // A status we don't recognize stays blank: a matched lead keeps
          // the status it has (new rows fall back to 'lead' below) rather
          // than a "VIP" cell quietly downgrading a customer.
          status: matchStatus(row.status, ''),
        };
        const key = email.toLowerCase();
        const existing = update && key
          ? this.contacts.find((c) => c.email.trim().toLowerCase() === key)
          : null;
        const custom = customCellValues(fields, row);
        if (existing) {
          assignFilled(existing, patch);
          mergeTags(existing, rowTags);
          mergeCustom(existing, custom);
          summary.updated++;
        } else {
          this.contacts.push(normalizeContact({
            id: uid(), createdAt: now, ...patch, status: patch.status || 'lead',
            tags: rowTags, custom,
          }));
          summary.added++;
        }
        touched.add(KV.contacts);
        continue;
      }

      if (kind === 'deals') {
        const company = companyFor(row.company);
        const contactName = String(row.contact || '').trim().toLowerCase();
        // Only an unambiguous name links a contact; two Mei Tanakas mean
        // neither, rather than the wrong one.
        const matches = contactName
          ? this.contacts.filter((c) => c.name.trim().toLowerCase() === contactName)
          : [];
        const contact = matches.length === 1 ? matches[0] : null;
        // A blank or unrecognized stage cell stays blank so a matched deal
        // keeps the stage it has - otherwise a re-import with no Stage
        // column (or one naming stages this funnel doesn't have) would
        // drag every deal (won ones included) back to the top of the
        // funnel. New rows land on the first stage via normalizeDeal.
        const stage = matchStage(row.stage, stages, '');
        const rowTags = splitTags(row.tags);
        const patch = {
          name,
          // A money cell with no digit in it ("TBD", "n/a") is blank, not
          // zero: parseMoney would read it as 0, and a re-import would wipe
          // a matched deal's real value with it. Dates already fail this
          // way (parseDateLoose returns null for junk); money follows suit.
          value: /\d/.test(String(row.value ?? '')) ? parseMoney(row.value) : '',
          // Same rule as every other cell: a blank (or unrecognizable)
          // billing cell leaves a matched deal on the plan it already has,
          // so a re-import of a file with no Billing column can't quietly
          // turn a book of subscriptions into one-time sales.
          billing: matchBilling(row.billing, ''),
          term: parseTerm(row.term),
          stage,
          companyId: company?.id || null,
          contactId: contact?.id || null,
          expectedClose: parseDateLoose(row.expectedClose),
          notes: row.notes,
        };
        const existing = update
          ? this.deals.find((d) => d.name.trim().toLowerCase() === name.toLowerCase())
          : null;
        if (existing) {
          // Read the stage before the patch lands: comparing after the
          // assignment always says "unchanged", which left the history
          // pointing at a stage the deal had already left.
          const fromStage = existing.stage;
          assignFilled(existing, patch);
          mergeTags(existing, rowTags);
          mergeCustom(existing, customCellValues(fields, row));
          // A row that switches a deal to monthly without naming a term
          // needs the default one, and one that switches it back to
          // one-time has to drop the term it no longer has.
          settleBilling(existing);
          existing.updatedAt = now;
          if (existing.stage !== fromStage) {
            recordStageEntry(existing, existing.stage, now, fromStage);
            // Closing (or reopening) from a spreadsheet has to move the
            // close date with it, the same way updateDeal does - and
            // closing settles the confidence override the same way too.
            const closed = isTerminalStage(existing.stage);
            if (closed) {
              existing.closedAt = now;
              existing.confidence = null;
            } else {
              clearCloseRecord(existing);
            }
          }
          summary.updated++;
        } else {
          const deal = normalizeDeal({
            id: uid(), createdAt: now, updatedAt: now, ...patch,
            value: patch.value === '' ? 0 : patch.value, tags: rowTags,
            custom: customCellValues(fields, row),
          }, stageCtx);
          this.deals.push(deal);
          summary.added++;
        }
        touched.add(KV.deals);
        continue;
      }

      summary.skipped++;
    }

    if (!touched.size) return summary;
    this.#emit();
    const byKey = {
      [KV.companies]: this.companies,
      [KV.contacts]: this.contacts,
      [KV.deals]: this.deals,
    };
    await Promise.all([...touched].map((k) => this.#save(k, byKey[k])));
    return summary;
  }

  /* ---------- export / import ---------- */

  exportAll() {
    return {
      app: 'crm',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.settings,
      companies: this.companies,
      contacts: this.contacts,
      deals: this.deals,
      activities: this.activities,
      tasks: this.tasks,
      templates: this.templates,
      // The manifest only: the files themselves stay in Puter FS, and the
      // paths here say exactly where.
      attachments: this.attachments,
    };
  }

  /**
   * Replace everything with an export-shaped payload (also installs/wipes
   * sample data). Records are normalized on the way in - a hand-edited
   * export with a missing name or due date must not poison the stored data
   * and crash every view that sorts on those fields.
   */
  async importAll(data, { reason = 'import' } = {}) {
    if (!data || data.app !== 'crm' || !Number.isInteger(data.version)) {
      throw new Error('Not a CRM export file');
    }
    // Snapshot first: everything below is a replace, and the user's only
    // other copy is whatever they remembered to export.
    const droppedBackup = this.backup?.data?.attachments || [];
    const outgoing = this.attachments;
    if (this.hasData()) await this.#saveBackup(reason);
    this.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    // Deals are checked against the *incoming* stage configuration, so an
    // export of a custom funnel imports with its stages intact.
    const stageCtx = this.#dealStageContext();
    this.companies = normalizeAll(data.companies, normalizeCompany);
    this.contacts = normalizeAll(data.contacts, normalizeContact);
    this.deals = normalizeAll(data.deals, (d) => normalizeDeal(d, stageCtx));
    this.activities = normalizeAll(data.activities, normalizeActivity);
    this.tasks = normalizeAll(data.tasks, normalizeTask);
    this.templates = normalizeAll(data.templates, normalizeTemplate);
    this.attachments = normalizeAll(data.attachments, normalizeAttachment);
    // Two manifests may have just lost their holder: the previous
    // snapshot's (the slot rotated above) and the outgoing live one (now
    // in the new snapshot - or nowhere, when there was nothing to
    // snapshot). Reclaim what nothing references anymore. Checked after
    // the replace, so restoring the snapshot keeps every file it brings
    // back to life.
    this.#reclaimFiles([...droppedBackup, ...outgoing]);
    this.#emit();
    await Promise.all([
      this.#save(KV.settings, this.settings),
      this.#save(KV.companies, this.companies),
      this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals),
      this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.templates, this.templates),
      this.#save(KV.attachments, this.attachments),
    ]);
  }
}

export const store = new Store();
export { Store };
