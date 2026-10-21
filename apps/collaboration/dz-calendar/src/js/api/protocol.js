/**
 * Wire protocol and access control for the Calendar app-to-app API.
 *
 * The Calendar exposes a small RPC surface to *other Puter apps* over an
 * AppConnection (https://docs.puter.com/Objects/AppConnection/). A caller
 * launches us with `puter.ui.launchApp('calendar', { service: 'calendar-api' })`
 * and then talks to the returned connection with `postMessage`; we answer on the
 * connection we get back from `puter.ui.parentApp()`.
 *
 * This is the mirror image of the API the Contacts app serves us (see
 * `src/js/contacts.js`), and it is deliberately the same shape: same message
 * envelope, same `ready`/`changed` notices, same allowlist model. Two apps that
 * talk to each other should not need two different vocabularies to do it.
 *
 * ── Access control ───────────────────────────────────────────────────────────
 * Someone's calendar is private data, so the API is closed by default: only the
 * apps in ALLOWED_CALLERS may use it, and each one only gets the methods its
 * entry grants. The caller's identity is NOT taken from the message — a caller
 * could claim anything — but from the `puter.source_app.name` query parameter,
 * which the Puter desktop stamps onto our iframe URL from the *calling process*.
 * An app cannot set it for a window it did not launch, and cannot change ours
 * after the fact.
 *
 * Residual limitation, stated plainly: the iframe/postMessage model gives a
 * child no way to cryptographically verify its parent, so these checks hold
 * inside a genuine Puter desktop session (the environment they're written for)
 * and are not a defence against a page that embeds this app itself and forges
 * launch parameters. The env guard in `readLaunchContext` is what keeps the API
 * from being served on the open web at all.
 *
 * NOTE: a caller carries a copy of the constants below (CHANNEL,
 * PROTOCOL_VERSION, SERVICE_ARG, method names) — the Contacts app does, in
 * `contacts/src/calendar.js`. They are a published contract between two repos:
 * change them together, and bump PROTOCOL_VERSION when the shape changes
 * incompatibly.
 */

/** Marker on every message, so unrelated postMessage traffic is ignored. */
export const CHANNEL = 'calendar-api';

/** Bumped only for incompatible changes to the message shape. */
export const PROTOCOL_VERSION = 1;

/** `args.service` value that asks the Calendar to boot as a headless API server. */
export const SERVICE_ARG = 'calendar-api';

/**
 * Every `args.service` value that asks for a headless boot. Keep `calendar-api`
 * first and permanent: it is the value callers have a copy of. index.html
 * matches this list too, to hide the window before the bundle loads.
 */
export const SERVICE_ARGS = [SERVICE_ARG];

/**
 * Every method the API can expose.
 *
 * Events only, on purpose. Tasks, out-of-office blocks, settings, colors and
 * RSVP state are the calendar's own business; a second app asking "what is on
 * their calendar" or "put this on it" wants events, and every method here
 * earns its place by answering one of those two questions. `list` and `search`
 * both expand recurring series, so a caller never has to know what a
 * recurrence rule is.
 */
export const METHODS = ['ping', 'list', 'search', 'get', 'create', 'update', 'delete'];

/**
 * The fields a read may require an event to *have* — `has: ['meeting']` on
 * `list` or `search` keeps only events with a meeting link, `has: ['guests']`
 * only events with people on them, and so on. Each name is a field of the
 * API's event projection (see methods.js `toEvent`) that can be empty; "has"
 * means present and non-empty. The same names pin a grant's scope, below.
 *
 * A filter rather than a method per question, because every such question
 * has the same answer shape: an app that shows video meetings, one that maps
 * where you have to be, one that lists who you are meeting — each wants the
 * calendar's occurrences in a window minus the events that are none of its
 * business, and the store does the filtering once rather than shipping the
 * whole window across the connection to be filtered there.
 */
export const HAS_FIELDS = ['meeting', 'location', 'description', 'guests', 'reminders', 'organizer'];

/**
 * Which apps may call us, and what each may do. Keys are Puter app *names*
 * (as published, e.g. `contacts` for contacts.puter.com). A grant is one of:
 *
 *   '*'                           every method in METHODS, the whole calendar
 *   ['search', 'create', …]       exactly those methods, the whole calendar
 *   { methods, has: ['meeting'] } those methods, but only over the events
 *                                 that have every field named — a *scope*.
 *                                 Reads return nothing else, an event outside
 *                                 it is `not_found` by id, and a create that
 *                                 would fall outside it is refused.
 *
 * A scope says what an integration is *for* in the same place the method list
 * does. Meetings is the case in point: it shows the day's video meetings with
 * a Join button, which takes `list` — and nothing about that needs the dentist
 * appointment, so the grant pins `has: ['meeting']` and the calendar never
 * sends it. (Checked from the caller's identity, server-side; a caller cannot
 * widen its own scope by omitting `has`.)
 *
 * Contacts is granted what it actually uses and nothing more: it adds a
 * birthday to the calendar, keeps that one event in step with the contact, and
 * asks what is coming up with the person on screen. It never lists the whole
 * calendar and never opens an event by id, so it cannot — a grant is the
 * cheapest place to say what an integration is for.
 *
 * Write access at all is granted on one condition: the caller puts the change
 * in front of the user before making it. Contacts meets it — a birthday event
 * is created from an explicit menu action, announced, and undoable — and
 * `delete` is here so that Undo works, not so that Contacts can prune the
 * calendar.
 */
export const ALLOWED_CALLERS = {
  contacts: ['ping', 'search', 'create', 'update', 'delete'],
  // Puter Meetings (meetings.puter.com) lists the meetings on the calendar so
  // the day's calls are one click away on its home screen. Read-only, and
  // only the events that carry a meeting link: it has no use for the rest.
  meetings: { methods: ['ping', 'list'], has: ['meeting'] },
};

export const ERRORS = {
  FORBIDDEN: 'forbidden',
  UNKNOWN_METHOD: 'unknown_method',
  BAD_REQUEST: 'bad_request',
  NOT_FOUND: 'not_found',
  INVALID: 'invalid',
  STORAGE: 'storage_error',
  VERSION: 'unsupported_version',
};

/** An error a handler can throw to control the code the caller sees. */
export class ApiError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    if (details) this.details = details;
  }
}

/** `appName`'s entry in `allowed`, or undefined. Own properties only, so an
 *  app named `constructor` or `toString` isn't granted whatever Object has. */
function grantOf(appName, allowed) {
  const key = String(appName || '');
  return Object.prototype.hasOwnProperty.call(allowed, key) ? allowed[key] : undefined;
}

/** The methods `appName` is allowed to call, or [] for an app with no grant. */
export function grantedMethods(appName, allowed = ALLOWED_CALLERS) {
  let grant = grantOf(appName, allowed);
  if (grant && typeof grant === 'object' && !Array.isArray(grant)) grant = grant.methods;
  if (grant === '*') return [...METHODS];
  if (Array.isArray(grant)) return grant.filter((m) => METHODS.includes(m));
  return [];
}

/**
 * The slice of the calendar `appName` may work with: `{ has: [...] }` for a
 * scoped grant, `null` for a grant over the whole calendar (or no grant at all
 * — an app with no methods has nothing to scope).
 *
 * Names are passed through as written, known or not. A grant mistyped as
 * `has: ['meetng']` must fail *closed* — the methods treat an unknown name as
 * a field no event has, so such a caller sees nothing — rather than quietly
 * widen to the whole calendar.
 */
export function grantedScope(appName, allowed = ALLOWED_CALLERS) {
  const grant = grantOf(appName, allowed);
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return null;
  const has = Array.isArray(grant.has) ? [...new Set(grant.has.map((h) => String(h).trim()).filter(Boolean))] : [];
  return has.length ? { has } : null;
}

/**
 * Read who launched us and how, from the launch parameters the Puter desktop
 * put on our URL (see the access-control note above).
 *
 * @returns {{ callerApp: string, serviceMode: boolean, inPuterApp: boolean }}
 */
export function readLaunchContext(win = typeof window !== 'undefined' ? window : undefined) {
  const empty = { callerApp: '', serviceMode: false, inPuterApp: false };
  if (!win) return empty;
  const puter = win.puter;
  // `env === 'app'` means we're an app window inside the Puter desktop, which is
  // the only place an AppConnection exists. On the open web (or in the desktop's
  // own GUI context) there is no parent app and no API to serve.
  const inPuterApp = Boolean(puter && puter.env === 'app');
  if (!inPuterApp) return empty;

  let callerApp = '';
  try {
    const params = new URLSearchParams(win.location.search);
    callerApp = (params.get('puter.source_app.name') || '').trim().toLowerCase();
  } catch {
    /* no readable location — treat as an unidentified caller */
  }

  const args = (puter && puter.args) || {};
  return { callerApp, serviceMode: SERVICE_ARGS.includes(args.service), inPuterApp };
}

/** True when `msg` looks like a request on our channel. */
export function isRequest(msg) {
  return Boolean(
    msg &&
      typeof msg === 'object' &&
      msg.$ === CHANNEL &&
      typeof msg.method === 'string' &&
      typeof msg.id === 'string',
  );
}
