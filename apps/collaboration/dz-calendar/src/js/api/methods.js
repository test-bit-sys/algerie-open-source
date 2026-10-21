/**
 * The Calendar API's method implementations, over the same store the UI uses.
 * Kept transport-free (no postMessage, no AppConnection) so every method is a
 * plain async function of its params and can be unit-tested.
 *
 * Two ideas shape everything here:
 *
 *   - A caller asks about *time*, not about storage. `list` and `search` take a
 *     window and answer with occurrences: a recurring series is expanded, a
 *     per-occurrence edit is applied, and a cancelled occurrence is simply not
 *     there. Nobody outside this app should have to learn what a recurrence
 *     rule, an exdate or an override is to find out when the standup is.
 *   - An occurrence's id is a real handle. `<seriesId>::<recurrenceId>` comes
 *     back from a read and can be passed straight to `update` or `delete`,
 *     where it means "this occurrence" — the same distinction the UI offers,
 *     without a scope dialog to negotiate over a wire.
 */
import { normalizeRecurrence } from '../recurrence.js';
import { normalizeEvent } from '../store.js';
import { ApiError, ERRORS, HAS_FIELDS, METHODS } from './protocol.js';

const MS_PER_DAY = 86_400_000;

/** Window used when a caller names neither end of one. */
const RANGE_DEFAULT_MS = 31 * MS_PER_DAY;

/** The widest window one request may ask for. Expansion cost scales with the
 *  window, and no caller needs more of the future than this in one go. */
const RANGE_MAX_MS = 400 * MS_PER_DAY;
// The furthest instant a Date can hold, either way (ECMA-262: ±100,000,000
// days from the epoch). A bound beyond it names no window at all.
const MAX_TIME_MS = 8.64e15;

const LIMIT_DEFAULT = 100;
const LIMIT_MAX = 500;

/** How many guest addresses one `search` may filter on. */
const GUEST_MAX = 50;

/**
 * How old the in-memory calendar may be when a request arrives before we re-read
 * it from the cloud.
 *
 * This matters because of how the API is served: an instance can stay open for
 * minutes (a headless service instance, or the user's own window when it serves
 * the caller that launched it) while the *user* edits events in a different
 * window. Nothing tells this process about that. Without an age bound, a caller
 * that asked two minutes ago and asks again now would get the identical stale
 * answer.
 *
 * The window is short enough that "I just moved that meeting" always works, and
 * long enough that a burst of calls costs one read rather than one per request.
 */
const FRESH_MS = 10_000;

/** After a failed re-read, how long we keep answering from the calendar we have
 *  before trying the cloud again. */
const FAILED_RETRY_MS = 15_000;

/**
 * Fields a caller may write. Anything else in a payload is ignored, so ids and
 * timestamps can never be steered from outside — and neither can the calendar's
 * own bookkeeping: `exdates` and `overrides` belong to the series (edit an
 * occurrence by its own id instead), and `ooo` / `declined` are states the
 * calendar puts an event into, not fields another app sets.
 */
const WRITABLE = [
  'title',
  'description',
  'location',
  'start',
  'end',
  'allDay',
  'color',
  'reminders',
  'guests',
  'organizer',
  'recurrence',
];

/**
 * The subset of WRITABLE that a *single occurrence* can carry. An occurrence is
 * stored as a patch on its series, and the fields it can override are exactly
 * these — RSVP state and the repeat rule belong to the series as a whole. A
 * caller that asks for one of the others is told so rather than getting an `ok`
 * for a change the store would quietly drop.
 */
const OCCURRENCE_WRITABLE = [
  'title',
  'description',
  'location',
  'start',
  'end',
  'allDay',
  'color',
  'reminders',
];

const OCC_SEP = '::';

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/**
 * What it means for an event to *have* each of HAS_FIELDS: present and
 * non-empty, on a stored event or an expanded occurrence (both carry these
 * fields the same way). Also run against a create payload, where the same
 * test decides whether the new event would fall inside a scoped caller's
 * grant — `meeting` is not writable, so a meeting-scoped caller can never
 * create, which is the right answer.
 */
const HAS = {
  meeting: (ev) => Boolean(ev.meeting && ev.meeting.url),
  location: (ev) => Boolean(str(ev.location).trim()),
  description: (ev) => Boolean(str(ev.description).trim()),
  guests: (ev) => Array.isArray(ev.guests) && ev.guests.length > 0,
  reminders: (ev) => Array.isArray(ev.reminders) && ev.reminders.length > 0,
  organizer: (ev) => Boolean(ev.organizer && str(ev.organizer.email).trim()),
};

/**
 * A request's `has` as a clean list of field names. One string or an array;
 * an unknown name is a `bad_request` that says which names exist — a filter
 * silently ignored would answer a question the caller did not ask.
 */
function requestedHas(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const each of list) {
    const name = str(each).trim();
    if (!name) continue;
    if (!HAS_FIELDS.includes(name)) {
      throw new ApiError(
        ERRORS.BAD_REQUEST,
        `\`has\` names an unknown field "${name}" (one of: ${HAS_FIELDS.join(', ')})`,
      );
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * A predicate: does an event have *every* field in `names`? A name with no
 * test — only reachable through a mistyped grant, since requests are
 * validated — matches nothing, so a broken scope fails closed.
 */
function hasAll(names) {
  const tests = names.map((name) => HAS[name] || (() => false));
  return (ev) => tests.every((test) => test(ev));
}

function clampLimit(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const email = (v) => str(v).trim().toLowerCase();

/** Keep only the writable fields a caller actually supplied. */
function pickWritable(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of WRITABLE) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

/**
 * The half-open window [from, to) a read covers. Both ends are optional: with
 * neither, a caller gets the next month, which is what "what's coming up?"
 * means often enough to be the default. An over-wide window is clamped rather
 * than refused — the answer is still true, just shorter than asked for.
 */
function resolveRange({ from, to } = {}, now) {
  // A bound counts as given only when it is a finite number (an explicit 0 is
  // fine) or a non-empty numeric string. null / '' / [] must read as "absent"
  // and fall to the default — Number() would otherwise coerce them to 0 and
  // silently answer with the 1970 window (or reject null/null as `to<=from`).
  const provided = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return undefined;
  };
  const f = provided(from);
  const t = provided(to);
  const start = f !== undefined ? Math.round(f) : now;
  let end = t !== undefined ? Math.round(t) : start + RANGE_DEFAULT_MS;
  if (end <= start) {
    throw new ApiError(ERRORS.BAD_REQUEST, '`to` must be after `from`');
  }
  // A bound a Date cannot hold is a bad request, not a window. Every bound
  // ends up in `new Date(...)` somewhere — and the recurrence engine reads
  // the Invalid Date a huge `from` makes as "start from the first
  // occurrence", then can never reach a `to` past the last representable
  // instant: every never-ending series on the calendar walks its whole
  // expansion cap to answer nothing, and the calendar window this API is
  // served from is frozen for the duration.
  if (Math.abs(start) > MAX_TIME_MS || Math.abs(end) > MAX_TIME_MS) {
    throw new ApiError(ERRORS.BAD_REQUEST, '`from` and `to` must be within the range a date can hold');
  }
  if (end - start > RANGE_MAX_MS) end = start + RANGE_MAX_MS;
  return { from: start, to: end };
}

/** The addresses a `guest` filter names, or null when it names none. */
function guestFilter(value) {
  if (value === undefined || value === null || value === '') return null;
  const list = Array.isArray(value) ? value : [value];
  const out = new Set();
  for (const each of list) {
    const address = email(each);
    if (address) out.add(address);
    if (out.size >= GUEST_MAX) break;
  }
  return out.size ? out : null;
}

/**
 * The API's projection of an event or occurrence. Deliberately flat: whether it
 * came from a plain event, a series master or an expanded occurrence, a caller
 * reads the same fields — plus `seriesId`/`recurrenceId` when there is a series
 * behind it, which is the only thing that changes what an id *means*.
 */
export function toEvent(ev) {
  const out = {
    id: ev.id,
    title: ev.title || '',
    description: ev.description || '',
    location: ev.location || '',
    start: ev.start,
    end: ev.end,
    allDay: Boolean(ev.allDay),
    color: ev.color,
    reminders: [...(ev.reminders || [])],
    organizer: ev.organizer || null,
    guests: (ev.guests || []).map((g) => ({ ...g })),
    declined: Boolean(ev.declined),
    recurring: Boolean(ev.recurrence || ev.seriesId),
    createdAt: ev.createdAt,
    updatedAt: ev.updatedAt,
  };
  if (ev.seriesId) {
    out.seriesId = ev.seriesId;
    out.recurrenceId = ev.recurrenceId;
  }
  // The rule itself only travels with the master, where it is the thing you
  // would patch. An occurrence just says `recurring: true`.
  if (ev.recurrence) out.recurrence = { ...ev.recurrence };
  if (ev.ooo) out.ooo = true;
  // The attached meeting link, read-only: it is attached by the user's own
  // action in the editor, not a field another app writes (see WRITABLE).
  if (ev.meeting && ev.meeting.url) out.meeting = { ...ev.meeting };
  return out;
}

/** Everything in `ev` a text query is matched against, lowercased once. */
function haystack(ev) {
  const people = (ev.guests || []).map((g) => `${g.name || ''} ${g.email || ''}`).join(' ');
  const organizer = ev.organizer ? `${ev.organizer.name || ''} ${ev.organizer.email || ''}` : '';
  return `${ev.title || ''}\n${ev.location || ''}\n${ev.description || ''}\n${people}\n${organizer}`.toLowerCase();
}

/** True when `ev` involves any of `addresses` — as a guest or as the organizer.
 *  The organizer counts because an invitation someone sent you is as much "an
 *  event with them" as one you sent. */
function involves(ev, addresses) {
  if (ev.organizer && addresses.has(email(ev.organizer.email))) return true;
  return (ev.guests || []).some((g) => addresses.has(email(g.email)));
}

/** Chronological, the way a caller reading an agenda expects. (The store sorts
 *  all-day events first for *rendering*, which would interleave a distant
 *  all-day event into a list of upcoming meetings.) */
function byStart(a, b) {
  return a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.end - b.end;
}

/**
 * Build the API's method table.
 *
 * @param {object} deps
 * @param {object} deps.store the app's event store (the offline-gated one where
 *   there is a UI, so a write while offline is refused rather than half-applied)
 * @param {{ has?: string[] }|null} [deps.scope] the slice of the calendar this
 *   caller may work with (see protocol.js `grantedScope`). Every read is
 *   narrowed to events that have the named fields, an event outside the slice
 *   is `not_found` by id, and a create that would land outside it is refused.
 *   Null (the default) is the whole calendar.
 * @param {() => number} [deps.now]
 */
export function createMethods({
  store,
  scope = null,
  now = () => Date.now(),
  freshMs = FRESH_MS,
  retryAfterMs = FAILED_RETRY_MS,
}) {
  let loadedAt = 0;
  let loading = null;
  let failedAt = 0; // when a re-read last failed, so we don't retry it per call

  // The caller's scope, fixed for the life of this table. Applied to every
  // read here rather than by the transport so that it cannot be forgotten by
  // a method added later, and so a caller cannot opt out by leaving `has` off.
  const scopeHas = scope && Array.isArray(scope.has) ? scope.has.map(str).filter(Boolean) : [];
  const inScope = scopeHas.length ? hasAll(scopeHas) : () => true;

  /** The events in a window that a caller may see, given its scope and the
   *  `has` it asked for on top — one filter pass, or none when neither applies. */
  function visibleInRange(range, has) {
    const found = store.getEventsInRange(range.from, range.to, { includeHidden: true });
    const required = [...new Set([...scopeHas, ...requestedHas(has)])];
    return required.length ? found.filter(hasAll(required)) : found;
  }

  /**
   * Make sure the store holds a calendar we're willing to answer from: read from
   * the cloud at least once, and no older than `freshMs` (see FRESH_MS — a
   * long-lived instance cannot see another window's writes any other way).
   * Concurrent callers share one read.
   *
   * A re-read that fails is only fatal when there is nothing to fall back on. If
   * we already hold a calendar, the caller gets it: a slightly stale answer beats
   * an error, and beats making them wait out our cloud timeout — theirs is
   * shorter than ours, so a doomed read is also not retried on every request.
   */
  async function ensureLoaded() {
    if (loadedAt && now() - loadedAt < freshMs) return;
    const canFallBack = loadedAt > 0;
    if (canFallBack && failedAt && now() - failedAt < retryAfterMs) return;
    if (!loading) {
      loading = Promise.resolve(store.load())
        .then(
          () => {
            loadedAt = now();
            failedAt = 0;
          },
          (err) => {
            failedAt = now();
            throw err;
          },
        )
        .finally(() => {
          loading = null;
        });
    }
    try {
      await loading;
    } catch (err) {
      if (canFallBack) return;
      throw new ApiError(ERRORS.STORAGE, `Could not read the calendar: ${err.message}`);
    }
  }

  /** Note that our copy is current again after a write of our own, so the next
   *  request doesn't pay for a re-read we know it doesn't need. */
  function markFresh() {
    loadedAt = now();
  }

  /** The event `id` names, as this caller is allowed to see it. Outside the
   *  caller's scope reads as `not_found`: to a meetings-only caller the dentist
   *  appointment does not exist, and it must not be able to tell otherwise by
   *  guessing ids. `scoped: false` is for re-reading an event this caller has
   *  just written, which its own change may have moved out of scope. */
  function requireEvent(id, { scoped = true } = {}) {
    const found = store.getEvent(str(id).trim());
    if (!found || (scoped && !inScope(found))) {
      throw new ApiError(ERRORS.NOT_FOUND, `No event with id "${str(id)}"`);
    }
    return found;
  }

  /** `<seriesId>::<recurrenceId>` split, or null for a plain event id. */
  function parseOccurrenceId(id) {
    const value = str(id).trim();
    const at = value.indexOf(OCC_SEP);
    if (at === -1) return null;
    const seriesId = value.slice(0, at);
    const ridStr = value.slice(at + OCC_SEP.length).trim();
    const recurrenceId = ridStr ? Number(ridStr) : NaN; // Number('') is 0 — never a real rid
    if (!seriesId || !Number.isFinite(recurrenceId)) return null;
    return { seriesId, recurrenceId };
  }

  /** Validate the fields of a create/update payload that the store would
   *  otherwise quietly repair. A silently-dropped recurrence rule or a start
   *  defaulted to "now" is the kind of thing a caller should hear about. */
  function validate(fields, { requireStart }) {
    if (requireStart && fields.start === undefined) {
      throw new ApiError(ERRORS.BAD_REQUEST, '`start` is required (epoch milliseconds)');
    }
    // A real number, not something that merely converts to one: the store tests
    // these with Number.isFinite, so `"1735689600000"` would be dropped and the
    // event silently stamped at "now" instead.
    for (const key of ['start', 'end']) {
      if (fields[key] !== undefined && !Number.isFinite(fields[key])) {
        throw new ApiError(ERRORS.INVALID, `\`${key}\` must be epoch milliseconds`);
      }
      // Same bound as the read side: past it `new Date()` is Invalid, the
      // store writes an event with a null end and a rule with a null weekday,
      // and every later range query walks that series' whole expansion cap
      // to draw nothing.
      if (fields[key] !== undefined && Math.abs(fields[key]) > MAX_TIME_MS) {
        throw new ApiError(ERRORS.INVALID, `\`${key}\` must be within the range a date can hold`);
      }
    }
    if (fields.guests !== undefined && !Array.isArray(fields.guests)) {
      throw new ApiError(ERRORS.INVALID, '`guests` must be an array of { email, name? }');
    }
    if (fields.recurrence !== undefined && fields.recurrence !== null) {
      const anchor = Number.isFinite(fields.start) ? fields.start : now();
      if (!normalizeRecurrence(fields.recurrence, anchor)) {
        throw new ApiError(
          ERRORS.INVALID,
          '`recurrence.freq` must be one of daily, weekly, monthly, yearly',
        );
      }
    }
  }

  async function persist(run, what) {
    try {
      const saved = await run();
      markFresh();
      return saved;
    } catch (err) {
      // An offline write-gate rejection lands here too, which is the right
      // answer for a caller: the change did not happen, and why is in the text.
      throw new ApiError(ERRORS.STORAGE, `Could not ${what}: ${err.message}`);
    }
  }

  const methods = {
    /** Cheap liveness/capability probe; also the handshake a client can await.
     *  `methods` is the whole table here; the server narrows it to the
     *  caller's grant before it goes out. */
    async ping() {
      return { app: 'calendar', methods: [...METHODS], time: now() };
    },

    /**
     * Everything on the calendar in a window, as occurrences, earliest first.
     * `has` keeps only events that have the named fields (see HAS_FIELDS):
     * `has: ['meeting']` is the day's video calls, `has: ['location']` the
     * places to be.
     * @param {{ from?: number, to?: number, has?: string|string[], limit?: number }} params
     */
    async list({ from, to, has, limit } = {}) {
      await ensureLoaded();
      const range = resolveRange({ from, to }, now());
      const found = visibleInRange(range, has).sort(byStart);
      const take = clampLimit(limit, LIMIT_DEFAULT, LIMIT_MAX);
      return {
        events: found.slice(0, take).map(toEvent),
        total: found.length,
        from: range.from,
        to: range.to,
      };
    },

    /**
     * The events in a window that match a text query, or involve given people,
     * or both. At least one of `query` / `guest` is required — a search with
     * neither is `list`, and going through the wrong door for it would make an
     * accidental "give me everything" too easy to write by mistake.
     *
     * @param {{ query?: string, guest?: string|string[], from?: number, to?: number, has?: string|string[], limit?: number }} params
     */
    async search({ query, guest, from, to, has, limit } = {}) {
      await ensureLoaded();
      const q = str(query).trim().toLowerCase();
      const addresses = guestFilter(guest);
      if (!q && !addresses) {
        throw new ApiError(ERRORS.BAD_REQUEST, 'Pass `query`, `guest`, or both');
      }
      const range = resolveRange({ from, to }, now());
      const matched = visibleInRange(range, has)
        .filter((ev) => (!addresses || involves(ev, addresses)) && (!q || haystack(ev).includes(q)))
        .sort(byStart);
      const take = clampLimit(limit, LIMIT_DEFAULT, LIMIT_MAX);
      return {
        events: matched.slice(0, take).map(toEvent),
        total: matched.length,
        from: range.from,
        to: range.to,
      };
    },

    /** One event, by the id of a stored event or of an occurrence. */
    async get({ id } = {}) {
      await ensureLoaded();
      if (!str(id).trim()) throw new ApiError(ERRORS.BAD_REQUEST, '`id` is required');
      return { event: toEvent(requireEvent(id)) };
    },

    /**
     * Add an event. Any `id` in the payload is ignored — a create always mints a
     * new event, so it can never overwrite one. Pass `recurrence` to create a
     * repeating series in a single call.
     * @param {{ event?: object }} params
     */
    async create({ event } = {}) {
      await ensureLoaded();
      const fields = pickWritable(event);
      if (!Object.keys(fields).length) {
        throw new ApiError(ERRORS.BAD_REQUEST, '`event` is required');
      }
      validate(fields, { requireStart: true });
      // Judged on what the store would KEEP, not on the payload as sent: the
      // store drops a guest without a valid address, an organizer without one,
      // a reminder out of range — so `guests: [{}]` is non-empty here and
      // empty once saved, and a check on the raw fields would let it through.
      if (!inScope(normalizeEvent(fields))) {
        // A scoped caller may only add what it could then see. Refused up
        // front — not saved and hidden — so nothing lands on the calendar
        // that the app which put it there can neither show nor take back.
        throw new ApiError(
          ERRORS.FORBIDDEN,
          `This app may only add events that have: ${scopeHas.join(', ')}`,
        );
      }
      const saved = await persist(() => store.saveEvent({ ...fields, id: undefined }), 'save the event');
      return { event: toEvent(saved) };
    },

    /**
     * Patch an event. Only the fields present in `patch` change.
     *
     * The id decides the scope, so there is nothing extra to pass: a stored
     * event's id patches that event (for a series master, the whole series),
     * while an occurrence id writes a single-occurrence exception — the same two
     * outcomes the app's own scope dialog offers, minus the dialog.
     *
     * @param {{ id?: string, patch?: object }} params
     */
    async update({ id, patch } = {}) {
      await ensureLoaded();
      if (!str(id).trim()) throw new ApiError(ERRORS.BAD_REQUEST, '`id` is required');
      const existing = requireEvent(id);
      const fields = pickWritable(patch);
      if (!Object.keys(fields).length) {
        throw new ApiError(ERRORS.BAD_REQUEST, '`patch` must set at least one field');
      }
      validate(fields, { requireStart: false });

      const occurrence = parseOccurrenceId(id);
      if (occurrence) {
        const seriesOnly = Object.keys(fields).filter((f) => !OCCURRENCE_WRITABLE.includes(f));
        if (seriesOnly.length) {
          throw new ApiError(
            ERRORS.BAD_REQUEST,
            `${seriesOnly.map((f) => `\`${f}\``).join(', ')} belongs to the whole series — patch \`${occurrence.seriesId}\` instead`,
          );
        }
        const result = await persist(
          () => store.updateOccurrence(occurrence.seriesId, occurrence.recurrenceId, fields),
          'save the occurrence',
        );
        if (!result) throw new ApiError(ERRORS.NOT_FOUND, `No event with id "${str(id)}"`);
        return { event: toEvent(requireEvent(id, { scoped: false })) };
      }

      if (existing.recurrence) {
        // A series master goes through the store's series editor, not a raw
        // overwrite. updateSeries reprojects a time change onto the master's
        // own date (the pattern owns the dates — the same contract occurrence
        // reads follow) and clears per-occurrence exceptions when the time or
        // rule changes; a raw saveEvent carried exdates and overrides keyed
        // to the OLD schedule into the new one, cancelling and rewriting
        // occurrences the caller never touched.
        const timed = { ...fields };
        if ('start' in timed !== 'end' in timed) {
          // updateSeries applies a time change only when both bounds are
          // present; fill the missing one so a lone-bound patch still moves
          // the time instead of being silently ignored.
          if (!('start' in timed)) timed.start = existing.start;
          if (!('end' in timed)) timed.end = existing.end;
        }
        const result = await persist(() => store.updateSeries(existing.id, timed), 'save the event');
        if (!result) throw new ApiError(ERRORS.NOT_FOUND, `No event with id "${str(id)}"`);
        return { event: toEvent(result.event) };
      }

      const saved = await persist(
        () => store.saveEvent({ ...existing, ...fields, id: existing.id }),
        'save the event',
      );
      return { event: toEvent(saved) };
    },

    /**
     * Remove an event. Like `update`, the id decides the scope: a stored event's
     * id deletes it (a series and all of its occurrences), an occurrence id
     * cancels that one occurrence. `scope` in the reply says which happened, so
     * a caller never has to infer it from the id it sent.
     * @param {{ id?: string }} params
     */
    async delete({ id } = {}) {
      await ensureLoaded();
      if (!str(id).trim()) throw new ApiError(ERRORS.BAD_REQUEST, '`id` is required');
      const existing = requireEvent(id);
      const occurrence = parseOccurrenceId(id);
      if (occurrence) {
        const result = await persist(
          () => store.deleteOccurrence(occurrence.seriesId, occurrence.recurrenceId),
          'cancel the occurrence',
        );
        if (!result) throw new ApiError(ERRORS.NOT_FOUND, `No event with id "${str(id)}"`);
        return { deleted: true, id: existing.id, scope: 'occurrence' };
      }
      await persist(() => store.deleteEvent(existing.id), 'delete the event');
      return { deleted: true, id: existing.id, scope: 'event' };
    },
  };

  return methods;
}
