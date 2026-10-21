/**
 * Booking links — Calendly-style "book time with me" pages.
 *
 * The host designs one or more booking pages (a title, a duration, weekly
 * hours, a rolling window, buffers…) and shares a link; anyone with it books a
 * slot without an account. Guests can't read the host's calendar, so the same
 * per-user worker that serves RSVP links (rsvp-worker.js, deployed by
 * rsvp-links.js) serves the booking API too — and this module is the host's
 * side of that conversation:
 *
 *   PUSH  — the page configs plus a merged list of BUSY intervals derived from
 *           the calendar (timed events and out-of-office blocks; declined
 *           events and ordinary all-day events count as free, like Google's
 *           default transparency), plus the host's stamp — name, address, and
 *           their profile picture for the pages that opted into showing it.
 *           Debounced off store changes and digest-gated, so an unchanged
 *           calendar costs nothing.
 *   PULL  — bookings guests made, merged back as real calendar events. The
 *           event's id IS the booking id, so applying the same booking twice
 *           (second device, replayed pull) overwrites one key instead of
 *           duplicating. Nothing in the app announces a booking — it happened
 *           outside — so the pull is the only thing that can, and it is what a
 *           host watching for one is actually waiting on: it runs on
 *           store-change passes, on a half-minute poll while the window is
 *           visible, and the moment the host comes back to it.
 *
 * Cancelling is deliberately explicit: the details card offers "Cancel
 * booking", which tells the worker (which emails the guest) and then removes
 * the event. Deleting the event by any other path is caught by a safety net —
 * a confirmed future booking whose event stays missing for a grace period is
 * cancelled with notice — the grace exists so a delete followed by Undo never
 * fires a cancellation email the host didn't mean.
 *
 * What v1 deliberately does NOT do is propagate a host-side reschedule: the
 * created event is an ordinary editable event, and moving it never rewrites
 * the worker's booking record — the guest's confirmation, manage page, and
 * .ics keep the original time, and the original slot stays blocked. Both the
 * drag handler and the editor warn the host about exactly that when they move
 * a booked event, and the honest path for a real change is Cancel booking +
 * a fresh booking (which is also all Calendly's reschedule does under the
 * hood).
 *
 * Division of state (mirrors rsvp-links.js):
 *   - App KV: `cal:book:pages` (the configs — the editable source of truth)
 *     and `cal:book:state` (which bookings were applied to the calendar).
 *   - Worker KV: the bookings themselves, manage-token hashes, slot claims.
 *
 * Offline, this module does nothing at all: passes are gated like every other
 * network path, and page edits refuse with the standard offline message.
 */
import { DEFAULT_COLOR, isValidColor } from './colors.js';
import { isValidTimeZone, startOfDay, MS_PER_DAY, formatFullDate, formatTime } from './date-utils.js';
import { getUser } from './auth.js';
import { isBlocked } from './offline.js';
import { isMeetingUrl } from './meetings.js';
import { fetchSharePicture } from './profile.js';
import { toast as defaultToast } from './toast.js';

const PAGES_KEY = 'cal:book:pages';
const STATE_KEY = 'cal:book:state';
const MAX_PAGES = 25;
const MAX_ADVANCE_CAP = 90; // days — the furthest ahead a page may be booked
// A booking is someone asking for the host's time, so it is worth noticing
// while they are still at their desk: the poll is what turns a booking into a
// calendar event, and nothing else announces one. Both numbers are per open,
// VISIBLE window and cost one GET to the host's own worker, so a cadence in
// the tens of seconds is cheap — where two minutes read, fairly, as "my
// calendar doesn't update".
const PULL_MIN_MS = 25_000;
const POLL_MS = 30_000;
const USER_RETRY_MS = 5 * 60_000; // how often to re-ask getUser() for a still-missing email
const ORPHAN_GRACE_MS = 10 * 60_000;
// How often the host's profile picture is re-read for the pages that publish
// it. It lives in their Puter drive and changes almost never, while a pass runs
// on every calendar change — so a settled answer is reused for half an hour,
// and only an inconclusive one is retried soon.
const PICTURE_TTL_MS = 30 * 60_000;
const PICTURE_RETRY_MS = 2 * 60_000;

/** Duration choices offered by the editor (minutes). */
export const BOOKING_DURATIONS = [15, 30, 45, 60, 90, 120];

function coerce(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function randomId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** A page id is the last segment of the link a host hands out, so it is held
 *  to what reads and travels well: 4–32 of [a-z0-9], hyphens allowed inside.
 *  Kept in step with the same test in rsvp-worker.js and public/book.html. */
const PAGE_ID_RE = /^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/;

/** The worker a share link names, by label: `https://cal-nj.puter.work`
 *  captures `nj`. Every worker this app has ever deployed is `cal-…` (see
 *  workerNameCandidates in rsvp-links.js), and the label is what travels in
 *  the link — index.html and public/book.html put `cal-` and `.puter.work`
 *  back with this same grammar, so a link can only ever name a calendar
 *  worker. The label length keeps the DNS label at 63 with its prefix.
 *  Kept in step with the route test in index.html and public/book.html. */
const FRIENDLY_WORKER_RE = /^https:\/\/cal-([a-z0-9][a-z0-9-]{0,58})\.puter\.work$/;

const PRODUCTION_ORIGIN = 'https://calendar.puter.com';

/** Where the guest pages are served from: this app's own origin — book.html
 *  ships in public/ beside it — or production when there is no usable one
 *  (file://, tests). The same rule rsvp-links.js freezes into the worker as
 *  the page its redirects land on. */
export function defaultPageOrigin() {
  try {
    const origin = typeof location !== 'undefined' && location ? String(location.origin || '') : '';
    return /^https?:\/\/[^/]+$/.test(origin) ? origin : PRODUCTION_ORIGIN;
  } catch {
    return PRODUCTION_ORIGIN;
  }
}

/** The slug a title would make, or '' when it can't make a usable one (a
 *  title with no Latin letters or digits at all — Cyrillic, CJK, emoji). */
export function slugifyPageId(title) {
  const slug = String(title == null ? '' : title)
    // NFKD splits the accent off its letter so the class below can drop it;
    // "Café" becomes "cafe" rather than losing the é and reading "caf".
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, ''); // the slice can land mid-separator
  return PAGE_ID_RE.test(slug) ? slug : '';
}

function localTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function clampInt(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanText(v, cap) {
  return typeof v === 'string' ? v.slice(0, cap) : '';
}

/** The longest name a host can show guests. Well under the worker's own cap
 *  (200): a name is a kicker line on the page and a phrase in every email. */
export const DISPLAY_NAME_MAX = 80;

/**
 * A host's public name as typed, made fit to publish: one line, single
 * spaces, no control characters, capped. '' when nothing usable remains —
 * which is also what "use my username" is stored as.
 */
export function normalizeDisplayName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DISPLAY_NAME_MAX)
    .trim();
}

/** The default working week — Mon–Fri, 9:00–17:00 (what Calendly/cal.com seed). */
export function defaultHours() {
  const hours = {};
  for (const day of [1, 2, 3, 4, 5]) hours[day] = [{ start: 9 * 60, end: 17 * 60 }];
  return hours;
}

/** Weekday → sorted, merged minute-intervals; days with none are absent. */
export function normalizeHours(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (let day = 0; day < 7; day++) {
    const raw = input[day] != null ? input[day] : input[String(day)];
    if (!Array.isArray(raw)) continue;
    const intervals = [];
    for (const iv of raw.slice(0, 6)) {
      if (!iv || typeof iv !== 'object') continue;
      const start = clampInt(iv.start, 0, 1439, NaN);
      const end = clampInt(iv.end, 1, 1440, NaN);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      intervals.push({ start, end });
    }
    if (!intervals.length) continue;
    intervals.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
      else merged.push(iv);
    }
    out[day] = merged;
  }
  return out;
}

/** Validate + fill defaults for a booking page, mirroring normalizeEvent's
 *  role for events. Always returns a well-formed page. */
export function normalizePage(input = {}, now = Date.now()) {
  const durationMin = clampInt(input.durationMin, 5, 720, 30);
  return {
    id: typeof input.id === 'string' && PAGE_ID_RE.test(input.id) ? input.id : randomId(),
    title: cleanText(input.title, 200).trim() || `${durationMin} minute meeting`,
    description: cleanText(input.description, 2000).trim(),
    location: cleanText(input.location, 500).trim(),
    durationMin,
    // 0 / absent means "same as the duration" — resolved here (via the falsy
    // check, so a stored 0 is never clamped up to the 5-minute floor), and the
    // worker and the UI always see a concrete step.
    incrementMin: clampInt(input.incrementMin || durationMin, 5, 720, durationMin),
    bufferBeforeMin: clampInt(input.bufferBeforeMin, 0, 240, 0),
    bufferAfterMin: clampInt(input.bufferAfterMin, 0, 240, 0),
    minNoticeMin: clampInt(input.minNoticeMin, 0, 40320, 120),
    maxAdvanceDays: clampInt(input.maxAdvanceDays, 1, MAX_ADVANCE_CAP, 60),
    maxPerDay: clampInt(input.maxPerDay, 0, 50, 0),
    tz: isValidTimeZone(input.tz) ? input.tz : localTz() || 'UTC',
    hours: normalizeHours(input.hours == null ? defaultHours() : input.hours),
    color: isValidColor(input.color) ? input.color : DEFAULT_COLOR,
    // Mint a Puter Meetings link for each booking (the worker does the
    // minting — see rsvp-worker.js). Absent means ON, so pages saved before
    // the field existed start attaching links without being re-saved.
    meet: input.meet !== false,
    // Show the host's Puter profile picture to guests. Absent means OFF — the
    // opposite of `meet`, and deliberately: this publishes the host's face on
    // a page strangers hold the link to, so a page saved before the field
    // existed must not start doing it unasked. (The editor defaults it ON for
    // a NEW page, where the switch is right there to be seen.)
    avatar: input.avatar === true,
    enabled: input.enabled !== false,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: now,
  };
}

/**
 * The host's busy time over the next `horizonDays`, merged and clipped to
 * whole-day bounds so the digest only churns when the calendar (or the day)
 * actually changes. What counts as busy:
 *   - every timed event that isn't declined (hidden colors included — hiding
 *     a category is a display choice, not free time);
 *   - all-day OUT-OF-OFFICE blocks (that is their whole purpose);
 * and what doesn't:
 *   - ordinary all-day events (birthdays, holidays — "free", Google's default
 *     transparency for them);
 *   - declined events and tasks;
 *   - events the worker already knows as its own confirmed bookings, when
 *     `alreadyKnown` says so (see the caller for why).
 */
export function computeBusy(store, horizonDays, now = Date.now(), { alreadyKnown } = {}) {
  const from = startOfDay(new Date(now)).getTime();
  const to = from + (horizonDays + 1) * MS_PER_DAY;
  const raw = [];
  for (const ev of store.getEventsInRange(from, to, { includeHidden: true })) {
    if (ev.declined) continue;
    if (ev.allDay && !ev.ooo) continue;
    if (alreadyKnown && alreadyKnown(ev)) continue;
    const s = Math.max(ev.start, from);
    const e = Math.min(ev.end, to);
    if (e > s) raw.push([s, e]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push(iv);
  }
  return merged;
}

export function createBooking({
  kv,
  store,
  rsvp,
  user,
  toast = defaultToast,
  blocked = isBlocked,
  requestUser = getUser,
  readPicture = fetchSharePicture,
  syncDelayMs = 1500,
  pullMinMs = PULL_MIN_MS,
  pollMs = POLL_MS,
  orphanGraceMs = ORPHAN_GRACE_MS,
  now = () => Date.now(),
  // Where share links point: the app hosting public/book.html. See linkFor.
  pageOrigin = defaultPageOrigin(),
}) {
  const pages = new Map(); // id -> page
  // Normalised once — a trailing slash would read `…com//#/…`.
  const guestOrigin = String(pageOrigin || '').replace(/\/+$/, '') || PRODUCTION_ORIGIN;
  let pageMutations = 0; // bumped on every local page write (see reloadPages)
  let state = { applied: {} }; // bookingId -> { status, at, eventId, start, pageId, name, email, missingSince? }
  // False until the applied map has actually been READ. An unread map looks
  // exactly like an empty one, and applyBookings reads "no entry" as "never
  // applied" — so it would recreate the calendar event for every booking the
  // host had deliberately deleted. Nothing that consumes the map runs until
  // this is true.
  let stateLoaded = false;
  let started = false;
  let timer = null;
  let pollTimer = null;
  let unsubStore = () => {};
  let unsubRsvp = () => {};
  let chain = Promise.resolve(); // serializes every network pass
  let lastPullAt = 0;
  let lastDigest = '';
  let selfEmail = user && typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  const selfName = (user && typeof user.username === 'string' && user.username) || '';
  // The host's profile picture as last resolved for publishing, and when that
  // was (see organizerPicture).
  let selfPicture = '';
  let pictureAt = 0;
  let pictureSettled = false;
  const updateCbs = new Set();

  const offline = () =>
    blocked() || (typeof navigator !== 'undefined' && navigator.onLine === false);

  function notify() {
    for (const cb of updateCbs) {
      try {
        cb();
      } catch {
        /* a listener bug must not break syncing */
      }
    }
  }

  /* ---- Pages (the editable configs) ------------------------------------- */

  /**
   * Refresh the in-memory pages from the stored map. Every persist writes the
   * WHOLE map, so a device holding a stale copy would silently erase pages
   * created elsewhere — the reload before each local write is what prevents
   * that. Two modes:
   *   - merge (before a local write): union by id, newest `updatedAt` wins,
   *     and a page only we know about is KEPT — losing another device's page
   *     is the failure being defended against, so this path never drops one.
   *   - authoritative (background passes): the stored map replaces memory, so
   *     a deletion made on another device propagates here too. Safe because
   *     every local mutation persists before the next pass runs.
   * Returns true when memory changed.
   */
  async function reloadPages({ authoritative = false } = {}) {
    const mutationsAtRead = pageMutations;
    const raw = coerce(await kv.get(PAGES_KEY));
    // A local save/delete landed while this read was in flight (page edits
    // don't run on the pass chain), so the snapshot may predate its persist —
    // applying it would clobber the fresher memory: a just-created page would
    // flicker out of the sidebar and the next push would carry the stale map.
    // Skip; the mutation already scheduled a pass that will re-read.
    if (pageMutations !== mutationsAtRead) return false;
    // A read that comes back with nothing while we hold pages is never the
    // truth: persistPages writes `{}` for the last deletion, never null, so an
    // absent/unparseable value means the read itself failed. Taking it at face
    // value on a background pass would clear memory and push an EMPTY page
    // list — every link a host has ever shared answering "this link isn't
    // active" until some later pass happened to dirty the digest again. On the
    // merge path it is worse than that: the caller is about to rewrite the
    // whole map, and doing so over a snapshot we could not read is how another
    // device's page gets silently erased. That one refuses out loud.
    if (raw == null && pages.size) {
      if (!authoritative) throw new Error('booking: could not read the page map');
      return false;
    }
    const stored = raw && typeof raw === 'object' ? raw : {};
    const fresh = new Map();
    for (const value of Object.values(stored)) {
      if (!value || typeof value !== 'object') continue;
      const page = normalizePage(value, value.updatedAt || Date.now());
      fresh.set(page.id, page);
    }
    let changed = false;
    if (authoritative) {
      changed = fresh.size !== pages.size;
      for (const [id, page] of fresh) {
        const known = pages.get(id);
        if (!known || known.updatedAt !== page.updatedAt) changed = true;
      }
      pages.clear();
      for (const [id, page] of fresh) pages.set(id, page);
    } else {
      for (const [id, page] of fresh) {
        const known = pages.get(id);
        if (!known || (page.updatedAt || 0) >= (known.updatedAt || 0)) {
          if (!known || known.updatedAt !== page.updatedAt) changed = true;
          pages.set(id, page);
        }
      }
    }
    return changed;
  }

  async function persistPages() {
    await kv.set(PAGES_KEY, Object.fromEntries(pages));
  }

  /** Reads answered from the offline snapshot so far, when the kv is the
   *  offline wrapper (the app's shape). It serves a stale copy — or null for a
   *  key the snapshot lacks — in place of a failed cloud read, and never
   *  rejects; for the reads below that is a wrong answer, not a safe one, so
   *  they bracket themselves with this and treat a fallback as a failure. */
  const fallbacksSoFar = () => (kv && typeof kv.fallbackCount === 'function' ? kv.fallbackCount() : 0);

  /**
   * Re-read the calendar from the cloud before acting on it. The store is
   * read at boot, on reconnect and when the API asks — not because another
   * window of this account edited it. A second window therefore keeps the
   * calendar it booted with, and two things here must not run on that copy:
   * publishing busy time (a meeting added elsewhere would be missing from
   * the worker's list, and a guest could book over it) and creating the
   * event for a booking this window has never seen (another window may have
   * created — and the host since edited — that very event). Returns false
   * when the read did not reach the cloud, so the caller can decide. One
   * read serves a whole pass (passNo is bumped by pass()).
   */
  let passNo = 0;
  let refreshedInPass = 0;
  let userAskedAt = -Infinity; // see pass(): getUser() is re-asked at most every USER_RETRY_MS
  async function refreshCalendar() {
    if (typeof store.load !== 'function') return true;
    if (refreshedInPass === passNo) return true;
    const fallbacksBefore = fallbacksSoFar();
    try {
      await store.load();
    } catch {
      return false;
    }
    refreshedInPass = passNo;
    eventIndex = null;
    return fallbacksSoFar() === fallbacksBefore;
  }

  /** Load the applied map once. An absent key is a real answer (a host who has
   *  never taken a booking); only a FAILED read leaves stateLoaded false, and
   *  the caller retries. A read the offline wrapper answered from its snapshot
   *  counts as failed: on a device that never read this key it answers null,
   *  which would read as "never took a booking" and let the next pull
   *  recreate an event the host deleted on purpose. */
  async function loadState() {
    if (stateLoaded) return;
    const fallbacksBefore = fallbacksSoFar();
    const rawState = coerce(await kv.get(STATE_KEY));
    if (fallbacksSoFar() !== fallbacksBefore) {
      throw new Error('booking: the applied-state read did not reach the cloud');
    }
    if (rawState && rawState.applied && typeof rawState.applied === 'object') {
      state = { applied: rawState.applied };
    }
    stateLoaded = true;
  }

  async function persistState() {
    // Every write rewrites the WHOLE map, so a device holding a partial copy
    // would erase what another recorded — and a lost entry is not cosmetic:
    // it reads as "never applied", which recreates a deleted booking's event.
    // Merge the stored map in first; ours wins for every id we know about.
    try {
      const stored = coerce(await kv.get(STATE_KEY));
      const theirs =
        stored && stored.applied && typeof stored.applied === 'object' ? stored.applied : null;
      if (theirs) {
        const cutoff = now() - 200 * MS_PER_DAY; // same horizon pruneApplied uses
        for (const [id, entry] of Object.entries(theirs)) {
          if (!entry || typeof entry !== 'object' || id in state.applied) continue;
          if ((Number.isFinite(entry.start) ? entry.start : 0) < cutoff) continue;
          state.applied[id] = entry;
        }
      }
    } catch {
      /* an unreadable map only costs this write its merge; ours still lands */
    }
    await kv.set(STATE_KEY, state);
  }

  function getPages() {
    return [...pages.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  }

  function getPage(id) {
    return pages.get(id) || null;
  }

  /** Save (create or update) a booking page. Rejects offline — the page only
   *  works once the worker has it, so a local-only save would be a lie. */
  async function savePage(input) {
    if (offline()) throw new Error("You're offline — reconnect to change booking links.");
    // Persisting rewrites the whole map — never do that over a stale copy. A
    // FAILED read refuses the save: "couldn't save" is recoverable, silently
    // erasing another device's live booking page is not.
    try {
      await reloadPages();
    } catch {
      throw new Error('Could not save the booking link. Please try again.');
    }
    const existing = input && input.id ? pages.get(input.id) : null;
    if (!existing && pages.size >= MAX_PAGES) {
      throw new Error(`You can have at most ${MAX_PAGES} booking links.`);
    }
    const page = normalizePage({ ...existing, ...input }, now());
    // Only ever at creation. An id is the shared link's last segment, so it
    // outlives the title it came from: re-slugging a renamed page would break
    // every link already sent and orphan its bookings, which the worker keys
    // by page id. Renaming "Intro call" to "Discovery call" keeps /intro-call.
    if (!existing) page.id = mintPageId(page.title);
    pages.set(page.id, page);
    pageMutations += 1;
    await persistPages();
    notify();
    schedule();
    return page;
  }

  /** An unused id for a new page: its title as a slug where that yields one,
   *  else the random hex that every page created before slugs still carries. */
  function mintPageId(title) {
    const base = slugifyPageId(title);
    if (!base) return randomId();
    if (!pages.has(base)) return base;
    // Two pages can share a title ("30 minute meeting" is the default one);
    // the second gets -2. Trimmed so the suffix can't push past 32 chars.
    for (let n = 2; n <= MAX_PAGES + 1; n++) {
      const suffix = `-${n}`;
      const stem = base.slice(0, 32 - suffix.length).replace(/-+$/, '');
      const candidate = stem + suffix;
      if (PAGE_ID_RE.test(candidate) && !pages.has(candidate)) return candidate;
    }
    return randomId();
  }

  async function deletePage(id) {
    if (offline()) throw new Error("You're offline — reconnect to change booking links.");
    try {
      await reloadPages(); // same stale-map guard as savePage
    } catch {
      throw new Error('Could not delete the booking link. Please try again.');
    }
    const existing = pages.get(id);
    if (!existing) return null;
    pages.delete(id);
    pageMutations += 1;
    await persistPages();
    notify();
    schedule();
    return existing;
  }

  /** The worker origin our share links hang off, or null while none serves
   *  them yet. */
  function workerOrigin() {
    return rsvp && typeof rsvp.workerOrigin === 'function' ? rsvp.workerOrigin() : null;
  }

  /**
   * The shareable URL for a page, or null while the worker hasn't been
   * deployed yet (the first sync does that).
   *
   * `<app origin>/#/<host>/<slug>` — the worker's label and the page's slug,
   * nothing else. index.html recognises the route and forwards the visitor
   * to the guest page (public/book.html) before the calendar itself loads,
   * and that page rebuilds `https://cal-<host>.puter.work` from the same
   * grammar. The link is DERIVED, never registered: no directory to keep,
   * nothing central to go down, and nothing in the path but the host's own
   * worker. Both halves are fixed for life — a worker can't be renamed (so a
   * changed username changes nothing, for links already out or new ones),
   * and a slug outlives its title (see savePage) — so every link ever handed
   * out keeps resolving.
   *
   * A worker whose origin the grammar can't carry (none this app deploys,
   * but the platform owns the URL it hands back) keeps the worker's own
   * redirect link, which works for any worker. That older form —
   * `…puter.work/book/<slug>`, what every link was before this — stays valid
   * regardless: the worker still serves it.
   */
  function linkFor(id) {
    const origin = workerOrigin();
    if (!origin || !pages.has(id) || !PAGE_ID_RE.test(id)) return null;
    const m = FRIENDLY_WORKER_RE.exec(origin);
    return m ? `${guestOrigin}/#/${m[1]}/${id}` : `${origin}/book/${id}`;
  }

  /* ---- The host's public name ------------------------------------------- */

  /**
   * The name guests see — on every booking page, on the manage page, and in
   * the emails the worker sends. The host's own choice (a calendar setting,
   * so it follows them across devices like the rest), else their username,
   * which is all a page ever showed before there was a choice.
   */
  function displayName() {
    return normalizeDisplayName(store.getSettings().bookingName) || selfName;
  }

  /**
   * Set the name guests see; resolves to what it became. Stored as a calendar
   * setting, whose change the store announces like any other — the sync pass
   * that follows pushes it (the organizer name is part of the digest), so
   * every page and every email picks it up without a page being re-saved.
   * A name that is just the username, or nothing, is stored as '' — "use my
   * username" — so a later rename of the account is followed rather than
   * frozen at whatever it was the day the field was touched.
   */
  async function setDisplayName(raw) {
    if (offline()) throw new Error("You're offline — reconnect to change your name.");
    const name = normalizeDisplayName(raw);
    const value = name === selfName ? '' : name;
    if (value !== (store.getSettings().bookingName || '')) await store.saveSettings({ bookingName: value });
    return displayName();
  }

  /** Confirmed future bookings on this page — what the delete confirm cites. */
  function upcomingCount(pageId) {
    let count = 0;
    for (const entry of Object.values(state.applied)) {
      if (!entry || entry.status !== 'confirmed') continue;
      if (entry.pageId !== pageId) continue;
      if (Number.isFinite(entry.start) && entry.start > now()) count++;
    }
    return count;
  }

  /* ---- Bookings → calendar events ---------------------------------------- */

  /**
   * bookingId -> the calendar event carrying it, from ONE pass over the
   * calendar. Dropped the moment the store changes (see start()), so it never
   * describes a calendar that has moved on.
   *
   * The applied record's eventId is the normal fast path; this index is the
   * fallback for records that don't name one — a calendar restored from a JSON
   * backup (the events survived, the applied state didn't), and every
   * cancelled booking, which the worker keeps listing for 200 days after its
   * meeting. Each of those used to cost its own full scan on every pull.
   */
  let eventIndex = null;

  function bookingEventIndex() {
    if (eventIndex) return eventIndex;
    eventIndex = new Map();
    for (const ev of store.getAllEvents()) {
      const id = ev.booking && ev.booking.id;
      // First match wins, exactly as the find() this replaces did.
      if (typeof id === 'string' && !eventIndex.has(id)) eventIndex.set(id, ev);
    }
    return eventIndex;
  }

  /** The calendar event holding this booking, or null. */
  function findBookingEvent(bookingId) {
    const entry = state.applied[bookingId];
    if (entry && entry.eventId) {
      const ev = store.getEvent(entry.eventId);
      if (ev) return ev;
    }
    return bookingEventIndex().get(bookingId) || null;
  }

  function bookingDescription(b) {
    const who = b.name ? `${b.name} (${b.email})` : b.email;
    const lines = [`Booked by ${who} via your "${b.pageTitle || 'booking'}" link.`];
    if (b.notes) lines.push('', b.notes);
    return lines.join('\n');
  }

  function toastWhen(startMs) {
    const opts = { hour12: store.getSettings().hour12 !== false };
    return `${formatFullDate(new Date(startMs))}, ${formatTime(new Date(startMs), opts)}`;
  }

  /** Merge pulled bookings into the calendar. Per booking, all-or-nothing:
   *  a failed write leaves its applied entry untouched so the next pull
   *  retries it. Returns true when anything changed. */
  async function applyBookings(bookings) {
    eventIndex = null; // a sweep always starts from the calendar as it is now
    let changed = false;
    const created = [];
    const cancelled = [];
    for (const b of Array.isArray(bookings) ? bookings : []) {
      if (!b || typeof b.id !== 'string' || !/^[a-z0-9]{6,64}$/.test(b.id)) continue;
      if (!Number.isFinite(b.start) || !Number.isFinite(b.end)) continue;
      const prev = state.applied[b.id];
      const entryBase = {
        status: b.status,
        at: Number.isFinite(b.updatedAt) ? b.updatedAt : 0,
        start: b.start,
        // The booked span, so a later pass can tell an untouched booking event
        // from one the host has since moved or resized (see workerKnows).
        end: b.end,
        pageId: typeof b.pageId === 'string' ? b.pageId : '',
        name: typeof b.name === 'string' ? b.name : '',
        email: typeof b.email === 'string' ? b.email : '',
      };
      try {
        if (b.status === 'confirmed') {
          if (prev && prev.status === 'confirmed') {
            // Already on the calendar — nothing to apply. If it ISN'T on this
            // window's calendar, the orphan net owns it from here: it re-reads
            // the cloud and either finds the event (a window that had simply
            // fallen behind catches up) or, after the grace, cancels with
            // notice. That is why this branch can return early without
            // stranding anyone.
            //
            // But records written before `end` existed can't be matched
            // against their event's span, so workerKnows would report their
            // busy interval forever, and those are exactly the bookings a
            // guest might still cancel. Fill it in from this pull.
            if (prev.end !== b.end) {
              prev.end = b.end;
              changed = true;
            }
            continue;
          }
          let existing = findBookingEvent(b.id);
          if (!existing && !prev) {
            // Nothing local says anything about this booking. Another window
            // may have applied it since our calendar was read — adopt its
            // event rather than write a fresh one over the host's edits.
            await refreshCalendar();
            existing = findBookingEvent(b.id);
          }
          if (existing) {
            state.applied[b.id] = { ...entryBase, eventId: existing.id };
            changed = true;
            continue;
          }
          if (prev) continue; // applied once and since removed by the host — never resurrect
          const page = pages.get(b.pageId) || null;
          const ev = await store.saveEvent({
            id: b.id, // deterministic: applying twice overwrites one key
            title: `${b.name || b.email} — ${b.pageTitle || (page && page.title) || 'Booking'}`,
            start: b.start,
            end: b.end,
            location: (typeof b.location === 'string' && b.location) || (page && page.location) || '',
            description: bookingDescription(b),
            // The worker minted the room, but its pull payload is still input:
            // hold the URL to the exact Puter Meetings shape (like the email
            // worker does) so nothing else can land on the calendar as a
            // clickable Join row.
            meeting: isMeetingUrl(b.meetingUrl) ? { url: b.meetingUrl } : null,
            color: (page && page.color) || DEFAULT_COLOR,
            guests: [{ email: b.email, name: b.name || '', status: 'accepted' }],
            organizer: selfEmail ? { email: selfEmail } : null,
            booking: {
              id: b.id,
              pageId: b.pageId,
              pageTitle: b.pageTitle || (page && page.title) || '',
              name: b.name || '',
              email: b.email || '',
            },
          });
          state.applied[b.id] = { ...entryBase, eventId: ev.id };
          changed = true;
          created.push(b);
        } else if (b.status === 'cancelled') {
          const ev = findBookingEvent(b.id);
          if (ev) {
            await store.deleteEvent(ev.id);
            if (b.cancelledBy === 'guest' && b.start > now()) cancelled.push(b);
          }
          if (!prev || prev.status !== 'cancelled') changed = true;
          state.applied[b.id] = { ...entryBase, eventId: null };
        }
      } catch (err) {
        console.warn('booking: could not apply booking', b.id, err);
      }
    }
    if (pruneApplied()) changed = true;
    if (created.length === 1) {
      const b = created[0];
      toast(`New booking: ${b.name || b.email} · ${toastWhen(b.start)}`, { variant: 'success' });
    } else if (created.length > 1) {
      toast(`${created.length} new bookings added to your calendar`, { variant: 'success' });
    }
    for (const b of cancelled.slice(0, 3)) {
      toast(`${b.name || b.email} cancelled their booking for ${toastWhen(b.start)}.`);
    }
    if (changed) {
      await persistState();
      notify();
    }
    return changed;
  }

  /**
   * Safety net for bookings whose event the host removed WITHOUT the explicit
   * "Cancel booking" action (a swipe-delete, another device). The guest is
   * owed the truth, so after a grace period the booking is cancelled with
   * notice. The grace — and requiring the event to be missing on a LOADED
   * store — is what keeps a delete-then-Undo, or a partially-loaded boot,
   * from ever firing a cancellation the host didn't mean.
   *
   * It is also where a window that has fallen behind catches up, because both
   * jobs turn on the same question: the event is not in OUR copy of the
   * calendar — is it really gone, or have we just never seen it?
   */
  async function checkOrphans() {
    if (!stateLoaded || store.revision() === null || offline()) return;
    eventIndex = null;
    const missingHere = () =>
      Object.entries(state.applied).filter(
        ([id, entry]) =>
          entry &&
          entry.status === 'confirmed' &&
          Number.isFinite(entry.start) &&
          entry.start > now() &&
          !findBookingEvent(id),
      );
    // Read the calendar from the cloud before trusting "the event is gone",
    // at both of the moments that answer matters.
    const needsCloudLook = () =>
      missingHere().some(
        ([, entry]) =>
          // The first time we notice. The applied map is shared across the
          // host's devices, so another window can apply a booking — writing
          // the event to the cloud and the entry to the map — and this window
          // then adopts the entry (persistState merges the stored map) without
          // ever having the event: the store only reads the calendar at boot.
          // From then on the pull skips the booking as "already applied" and
          // the event stays invisible here until the app is restarted, which
          // is exactly the bug this look closes. It also keeps a window that
          // is merely behind from starting a countdown toward cancelling a
          // live booking.
          !Number.isFinite(entry.missingSince) ||
          // About to cancel — the most destructive thing in this module: it
          // tells a stranger their meeting is off and cannot be taken back.
          // One incomplete read is enough for our copy to be wrong (a
          // truncated key listing drops events with no error at all), so never
          // fire on a copy we haven't just refreshed. A read that fails is a
          // reason to wait, never to guess in this direction.
          now() - entry.missingSince >= orphanGraceMs,
      );
    if (typeof store.load === 'function' && needsCloudLook()) {
      const fallbacksBefore = fallbacksSoFar();
      try {
        await store.load();
      } catch {
        return;
      }
      // The offline wrapper answers a failed cloud read from its snapshot
      // without rejecting — a copy that cannot know about an event another
      // window wrote. That is not the cloud look this decision needs.
      if (fallbacksSoFar() !== fallbacksBefore) return;
      eventIndex = null;
    }
    let dirty = false;
    for (const [id, entry] of Object.entries(state.applied)) {
      if (!entry || entry.status !== 'confirmed') continue;
      if (!Number.isFinite(entry.start) || entry.start <= now()) continue;
      if (findBookingEvent(id)) {
        if (entry.missingSince) {
          delete entry.missingSince;
          dirty = true;
        }
        continue;
      }
      if (!entry.missingSince) {
        entry.missingSince = now();
        dirty = true;
        continue;
      }
      if (now() - entry.missingSince < orphanGraceMs) continue;
      try {
        const result = await rsvp.adminRequest('/admin/booking/cancel', { id, notify: true });
        entry.status = 'cancelled';
        delete entry.missingSince;
        dirty = true;
        toast(
          result && result.emailed === true
            ? `Cancelled ${entry.name || entry.email || 'the guest'}'s booking and let them know.`
            : `Cancelled ${entry.name || entry.email || 'the guest'}'s booking, but no cancellation email was sent.`,
        );
      } catch (err) {
        if (err && err.status === 404) {
          // The worker has no such booking — pruned long ago, or this record
          // came from a calendar restored out of a backup the worker never
          // saw. There is no slot to free and no one to write to, and asking
          // again on every pass for the rest of the session would only repeat
          // the same 404. Settle it locally, silently: nobody was told
          // anything, so there is nothing to tell the host either.
          entry.status = 'cancelled';
          delete entry.missingSince;
          dirty = true;
        } else {
          console.warn('booking: orphan cancel failed', id, err);
        }
      }
    }
    if (dirty) {
      await persistState();
      notify();
    }
  }

  /** Explicitly cancel a booking (the details card's action): the worker
   *  records it and emails the guest, then the event leaves the calendar.
   *  Resolves { notified } — true only when the worker confirms email was sent. */
  async function cancelBooking(id) {
    if (offline()) throw new Error("You're offline — reconnect to cancel this booking.");
    let notified = false;
    try {
      const result = await rsvp.adminRequest('/admin/booking/cancel', { id, notify: true });
      notified = Boolean(result && result.emailed === true);
    } catch (err) {
      // A 404 means the worker holds no such booking, so there is nothing to
      // free and no one to write to — but the host is looking at the event and
      // asked for it to go. Refusing would leave them an event they can never
      // cancel; take it off the calendar and say no one was told.
      if (!err || err.status !== 404) throw err;
      notified = false;
    }
    const prev = state.applied[id] || {};
    const ev = findBookingEvent(id);
    if (ev) await store.deleteEvent(ev.id);
    state.applied[id] = { ...prev, status: 'cancelled', at: now(), eventId: null };
    delete state.applied[id].missingSince;
    await persistState();
    notify();
    return { notified };
  }

  /* ---- Sync passes -------------------------------------------------------- */

  /**
   * The host's profile picture as the worker should publish it, or '' for
   * "publish none". Pages opt in one at a time (`page.avatar`), but the picture
   * itself is the account's, so one copy is pushed with the config and each
   * page's switch decides whether guests see it.
   *
   * `wanted` false answers '' without a read, so switching the last page off
   * genuinely takes the picture down — while the resolved copy is kept in
   * memory, so switching one back on doesn't wait on another read.
   *
   * An inconclusive read (offline mid-pass, a thrown SDK error) keeps publishing
   * whatever was published before rather than blanking a live page, and is
   * retried on the next pass; an SDK "no picture available" result clears it.
   */
  async function organizerPicture(wanted) {
    if (!wanted) return '';
    const ttl = pictureSettled ? PICTURE_TTL_MS : PICTURE_RETRY_MS;
    if (pictureAt && now() - pictureAt < ttl) return selfPicture;
    pictureAt = now();
    const res = await Promise.resolve(readPicture(user)).catch(() => null);
    const state = res && res.state;
    if (state === 'found') selfPicture = res.picture;
    else if (state === 'none') selfPicture = '';
    pictureSettled = state === 'found' || state === 'none';
    return selfPicture;
  }

  /**
   * True when this event IS one of the worker's own confirmed bookings, still
   * sitting exactly where the booking says. Such an event needs no busy
   * interval from us: the worker blocks its time from its own booking record,
   * and with both pages' buffers, which a bare interval cannot carry.
   *
   * Reporting it anyway is what left a cancelled slot unbookable — the guest
   * cancels, the worker frees the booking and tells the host "the time is open
   * again", and it isn't, because `busy` still covers it until this device
   * happens to run another pass. A host who has never reopened the calendar
   * could leave that slot dead for days, including for the "pick a new time"
   * link the cancellation email sends the guest to.
   *
   * The span test is the whole safety of this: a booking event the host MOVED
   * or RESIZED occupies time the worker has no record of, so it keeps its busy
   * interval. So does anything we can't match to a live booking — a restored
   * backup, an entry we never recorded — because the default has to be "block
   * it".
   */
  function workerKnows(ev) {
    const id = ev.booking && ev.booking.id;
    if (!id) return false;
    const entry = state.applied[id];
    return Boolean(
      entry &&
        entry.status === 'confirmed' &&
        entry.start === ev.start &&
        entry.end === ev.end,
    );
  }

  function digestOf(payload) {
    return JSON.stringify([
      payload.pages,
      payload.busy,
      payload.organizerName,
      payload.organizerEmail,
      payload.organizerPicture,
      payload.hour12,
    ]);
  }

  /** Drop applied entries for bookings the worker itself has long pruned
   *  (200 days past their meeting) — the map must not grow forever. Safe:
   *  the orphan check and upcomingCount only care about FUTURE bookings. */
  function pruneApplied() {
    let changed = false;
    for (const [id, entry] of Object.entries(state.applied)) {
      const start = entry && Number.isFinite(entry.start) ? entry.start : 0;
      if (start < now() - 200 * MS_PER_DAY) {
        delete state.applied[id];
        changed = true;
      }
    }
    return changed;
  }

  async function pass() {
    if (offline()) return 0;
    passNo += 1;
    // Nothing in a pass is safe against a calendar that has not been read yet.
    // Busy time would come back EMPTY — a config telling every guest the host
    // is free all week — and a pull would find no events to match its bookings
    // against, so it would recreate the ones the host deleted. The app awaits
    // store.load() before this module exists, so this is the guard for a
    // future boot order rather than today's; failing the pass re-runs it.
    if (store.revision() === null) return 1;
    let failed = 0;
    if (!stateLoaded) {
      try {
        await loadState();
      } catch (err) {
        failed += 1;
        console.warn('booking: applied-state read failed', err);
      }
    }
    // Pick up pages edited on other devices (and their deletions) so this
    // device's next whole-map persist can't resurrect or clobber them.
    try {
      if (await reloadPages({ authoritative: true })) notify();
    } catch {
      /* an unreadable map only delays the refresh until the next pass */
    }
    // The organizer stamp needs my email; if Puter's grant landed since boot,
    // getUser() now includes it (no prompt is triggered). It is a network
    // call, and passes run every half-minute: for a host who has simply not
    // granted their email that was two requests a minute for the whole
    // session. Ask again every few minutes instead.
    if (!selfEmail && now() - userAskedAt >= USER_RETRY_MS) {
      userAskedAt = now();
      const fresh = await Promise.resolve(requestUser()).catch(() => null);
      if (fresh && typeof fresh.email === 'string' && fresh.email) {
        selfEmail = fresh.email.trim().toLowerCase();
      }
    }

    const list = getPages();
    const hasWorker = Boolean(workerOrigin());
    // Nothing to serve and no worker to update: never deploy one just to store
    // an empty config.
    if (!list.length && !hasWorker && !Object.keys(state.applied).length) return 0;

    const enabled = list.filter((p) => p.enabled);
    // A day past the furthest bookable START, so a slot sitting at the very
    // edge of the window still has its own length and after-buffer covered by
    // busy time. maxAdvanceDays is already clamped to MAX_ADVANCE_CAP, so the
    // ceiling here has to leave room for that margin: capping AT the same
    // number swallowed it on a 90-day page — the longest the editor offers —
    // and computeBusy clips to whole local days, so from mid-morning onward
    // the tail of the last day went unreported and a slot could be offered
    // over a real event.
    const horizon = Math.min(
      MAX_ADVANCE_CAP + 1,
      enabled.length ? Math.max(...enabled.map((p) => p.maxAdvanceDays)) + 1 : 1,
    );
    const payload = {
      pages: list,
      busy: computeBusy(store, horizon, now(), { alreadyKnown: workerKnows }),
      organizerName: displayName(),
      organizerEmail: selfEmail,
      // Read only for the pages that publish it, and only as often as its TTL
      // allows — a host with no such page never requests their profile picture.
      organizerPicture: await organizerPicture(list.some((p) => p.avatar)),
      hour12: store.getSettings().hour12 !== false,
    };
    let digest = digestOf(payload);
    if (digest !== lastDigest && (list.length || hasWorker)) {
      // About to publish: the busy list is a claim about the whole calendar,
      // so make it from the cloud's copy, not this window's (see
      // refreshCalendar). A page edit or the day rolling over on a window
      // that had fallen behind otherwise pushed a busy list missing every
      // event another window added — and A, whose digest hadn't changed,
      // never pushed again. A read that did not reach the cloud still
      // pushes what we have: an old busy list beats one that stays wrong.
      await refreshCalendar();
      payload.busy = computeBusy(store, horizon, now(), { alreadyKnown: workerKnows });
      digest = digestOf(payload);
    }
    if (digest !== lastDigest && (list.length || hasWorker)) {
      try {
        await rsvp.adminRequest('/admin/booking/sync', payload);
        lastDigest = digest;
        // The first successful sync is also the moment share links exist
        // (the worker just deployed) — let the sidebar re-render its buttons.
        notify();
      } catch (err) {
        failed += 1;
        console.warn('booking: sync failed', err);
      }
    }

    // Never pull against an unread applied map (see stateLoaded).
    const canPull = stateLoaded && Boolean(workerOrigin());
    if (canPull && (pages.size || Object.keys(state.applied).length) && now() - lastPullAt > pullMinMs) {
      try {
        const data = await rsvp.adminRequest('/admin/booking/list');
        lastPullAt = now();
        await applyBookings((data && data.bookings) || []);
      } catch (err) {
        failed += 1;
        console.warn('booking: pull failed', err);
      }
    }

    try {
      await checkOrphans();
    } catch (err) {
      failed += 1;
      console.warn('booking: orphan check failed', err);
    }
    return failed;
  }

  let failStreak = 0;
  let retryTimer = null;

  function run() {
    chain = chain
      .then(async () => {
        const failed = await pass();
        if (!failed) {
          failStreak = 0;
          return;
        }
        // Bounded backoff — a just-deployed worker's propagation window heals
        // without waiting for the next user action (mirrors rsvp-links).
        if (failStreak >= 6) return;
        failStreak += 1;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          run();
        }, Math.min(30_000, 5_000 * failStreak));
      })
      .catch(() => {});
    return chain;
  }

  function schedule() {
    failStreak = 0;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, syncDelayMs);
  }

  /** Coming back to the calendar is the moment to have the latest bookings.
   *  Two events, because they fire in different worlds: `visibilitychange`
   *  covers a hidden/restored browser tab, and `focus` covers coming back to
   *  the calendar's own window — inside the Puter desktop, moving between app
   *  windows never hides the tab, so visibilitychange alone never fires. Both
   *  are cheap: the pull floor throttles what they can actually ask for. */
  function onVisible() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (offline()) return;
    run();
  }

  /* ---- Public API --------------------------------------------------------- */

  async function start() {
    if (started) return;
    started = true;
    try {
      // reloadPages preserves each stored updatedAt — re-stamping "now" on
      // every boot would churn the sync digest for nothing.
      await reloadPages();
    } catch {
      /* offline boot — every pass is gated anyway, and re-reads the map */
    }
    // Its own try: a failed page read used to skip this one too, which is the
    // worst of both — no pages AND an unread applied map.
    try {
      await loadState();
    } catch {
      /* the next pass retries; nothing reads the map until it lands */
    }
    unsubStore = store.subscribe(() => {
      eventIndex = null; // the calendar the index described just changed
      schedule();
    });
    // The share links come from the RSVP worker, so they turn on when THAT
    // module learns its config — the stored one at boot, or a freshly verified
    // deploy — not when our own sync round-trips. Relay that moment: without
    // it the sidebar's copy buttons stayed disabled until the next successful
    // sync POST notified, which is a network round trip after the link already
    // worked, and up to a whole poll interval when the POST itself failed.
    if (rsvp && typeof rsvp.onUpdate === 'function') {
      let hadWorker = Boolean(workerOrigin());
      unsubRsvp = rsvp.onUpdate(() => {
        const ready = Boolean(workerOrigin());
        if (ready === hadWorker) return;
        hadWorker = ready;
        notify();
      });
    }
    // Bookings arrive from outside; poll gently while the tab is visible.
    pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (offline()) return;
      run();
    }, pollMs);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onVisible);
    }
    notify();
    schedule();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    if (retryTimer) clearTimeout(retryTimer);
    if (pollTimer) clearInterval(pollTimer);
    timer = retryTimer = pollTimer = null;
    unsubStore();
    unsubStore = () => {};
    unsubRsvp();
    unsubRsvp = () => {};
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onVisible);
    }
  }

  function onUpdate(cb) {
    updateCbs.add(cb);
    return () => updateCbs.delete(cb);
  }

  return {
    start,
    stop,
    getPages,
    getPage,
    savePage,
    deletePage,
    linkFor,
    displayName,
    setDisplayName,
    upcomingCount,
    cancelBooking,
    onUpdate,
    /** Run a pass now (push if dirty, pull, orphan check) — what the poll and
     *  the visibility handler do on their own schedule. */
    refresh: run,
    /** Tests: resolves when every queued network pass has settled. */
    whenIdle: () => chain,
  };
}
