/**
 * Email invitations — the calendar's one shared, app-owned Puter worker
 * (deployed to https://calendar-email.puter.work; see src/js/invites.js for
 * the calling side).
 *
 * Unlike the RSVP worker — one per calendar user, deployed into their own
 * account — this one is deployed ONCE, by the app owner: outbound mail has to
 * be authorized by a worker's own token, so the sending capability lives
 * somewhere the app controls. The cost does not: the app calls this worker
 * with puter.workers.exec(), which forwards the signed-in user's Puter token,
 * and each message is sent with that token in hand — so every send is billed
 * to, and rate-limited as, the host who asked for it, never the app owner.
 *
 *   POST /invites        send one event's invitations (one private mail per guest)
 *   POST /replies        answer an invitation this user received by mail, as a
 *                        real iTIP REPLY to its organizer (see mail-reply.js)
 *   POST /cancellations  tell an event's guests and host it was deleted — its
 *                        own route, NOT a kind on /invites, so an outdated
 *                        deployment 404s (nothing sent) instead of coercing
 *                        the unknown kind to 'invite' and mailing guests a
 *                        fresh invitation to an event that no longer exists
 *   GET  /health         liveness + deployed version (no auth)
 *   GET  /whoami         what the worker can see of your session (names only) —
 *                        the deployment self-test for "why am I getting a 401"
 *
 * An app-owned relay that forwarded whatever it was handed would be a spam
 * cannon wearing the calendar's sending reputation, so it never does:
 *   - no Puter session, no send. `user` is only populated for callers that
 *     come through puter.workers.exec(); everyone else gets 401.
 *   - the caller supplies an EVENT, not an email. Subject and body are
 *     composed here, so every message this worker can be made to send is an
 *     invitation to something, addressed to that event's guests.
 *   - the links the worker itself writes are fixed shapes it controls: the
 *     guest's own RSVP capability URL (https://<worker>.puter.work/rsvp/<40
 *     hex>, minted by that host's RSVP worker) and the event's validated
 *     meeting link. Host-supplied text (title, description, note) is
 *     HTML-escaped, so it can never inject markup or an <a> of its own. That
 *     is NOT link suppression, though: a bare URL a host types into a
 *     description stays plain text a mail client may auto-detect and make
 *     clickable (in the text/plain part especially). The guard against a rogue
 *     host is therefore not that its text can't be linkified, but that every
 *     send needs the host's own Puter session and is billed to and
 *     rate-limited as that host (below).
 *   - recipients are capped per request (MAX_RECIPIENTS) and per user per day
 *     (DAILY_LIMIT), and an invitation a guest already received is skipped
 *     rather than re-sent (see the `version` digest below).
 *
 * KV here belongs to the APP OWNER, not to the calendar user, so it holds
 * nothing personal: keys are SHA-256 hashes of (user, event, guest) triples
 * and values are a version digest plus a timestamp. A dump of it reveals no
 * address, no event id, and no title.
 *
 *   mail:sent:<sha256(callerId|eventId|email)>  -> { v, at }  (expires: SENT_TTL)
 *   mail:rate:<sha256(callerId)>:<YYYY-MM-DD>   -> count      (expires: RATE_TTL)
 *
 * Deploy with:  puter worker deploy src/workers/email-worker.js calendar-email
 */

// '2': .ics attachments carry their METHOD in the MIME type (method=REQUEST),
//      which is what lets mail clients' native RSVP buttons work.
// '3': invitations carry the event's meeting link as a "Join" line/row
//      (meetingUrl below). The constant exists so /health can prove which
//      snapshot is live — a deploy that changes behavior must bump it.
// '4': POST /cancellations — a deleted event's invited guests get a
//      cancellation notice (METHOD:CANCEL .ics; no RSVP or meeting links).
// '5': the caller's .ics is read before it is attached (icsProblem below):
//      its METHOD must be the route's, its ORGANIZER the organizer the body
//      names, and its link-valued properties the event's validated meeting
//      link — a forged attachment is refused (400 invalid_ics) rather than
//      relayed. A request that would send nothing is no longer answered 429.
// '8': attendee-removal cancellation copy distinguishes an invitation from the event.
// '9': event cancellations include a deduplicated, quota-counted host receipt.
// '10': redeployed to pick up the current worker runtime (puter.js with
//      email.sendTransactional); /health and /whoami now report it as runtime.
// '11': POST /replies — an iTIP REPLY to an invitation the calendar received
//      by mail, for when the user's own puter.email.send cannot carry it.
const WORKER_VERSION = '11';

const SENT_PREFIX = 'mail:sent:';
const RATE_PREFIX = 'mail:rate:';
const SENT_TTL = 180 * 24 * 60 * 60; // seconds — long enough to outlive an event
const RATE_TTL = 2 * 24 * 60 * 60; // seconds — yesterday's counter is dead weight

const MAX_RECIPIENTS = 50; // per request
const DAILY_LIMIT = 200; // per calendar user per UTC day
const MAX_ICS_CHARS = 64_000;

/* ---- Small utilities ---------------------------------------------------- */

/** The worker owner's context (the `me` global; ctx.me in tests). */
function ownerOf(ctx) {
  return (ctx && ctx.me) || (typeof me !== 'undefined' ? me : null);
}

/** The puter.js build the platform baked into this deploy (its preamble's
 *  first line). Null under the test harness, which has no preamble. */
function workerRuntime() {
  return typeof __PUTER_PREAMBLE_VERSION__ === 'string' ? __PUTER_PREAMBLE_VERSION__ : null;
}

/** The signed-in caller. The runtime has called this both `user` and
 *  `requestor`; take whichever one arrived. (Observed on the live platform,
 *  2026-08: `user`.) */
function callerOf(ctx) {
  return (ctx && (ctx.user || ctx.requestor)) || null;
}

/**
 * A stable id for the caller — it keys the already-sent and daily-cap records,
 * so it has to be the same tomorrow as it is today, and different for every
 * user. Do NOT assume it is sitting on the caller object: the live platform
 * (2026-08) hands over a caller whose only own property is `puter`, so the
 * documented `user.uuid` is absent and asking their own Puter is the path that
 * actually answers. Try the known names first anyway, then the ones nested
 * under their Puter handle, then getUser(). '' means "could not tell", which
 * is refused rather than guessed at: a shared id would let one user's dedupe
 * record suppress another's invitation.
 */
async function callerIdOf(caller) {
  if (!caller) return '';
  const own = caller.uuid || caller.uid || caller.user_uuid || caller.username;
  if (typeof own === 'string' && own) return own;
  const p = caller.puter;
  const nested = p && (p.uuid || p.uid || p.username);
  if (typeof nested === 'string' && nested) return nested;
  try {
    const who = p && p.auth && typeof p.auth.getUser === 'function' ? await p.auth.getUser() : null;
    const id = who && (who.uuid || who.uid || who.username);
    return typeof id === 'string' ? id : '';
  } catch {
    return ''; // an unreachable /whoami is not an identity
  }
}

/** The caller's own address, when the platform can tell us — '' otherwise. */
async function callerEmailOf(caller) {
  if (!caller) return '';
  if (typeof caller.email === 'string' && caller.email) return lowerEmail(caller.email);
  const p = caller.puter;
  try {
    const who = p && p.auth && typeof p.auth.getUser === 'function' ? await p.auth.getUser() : null;
    return who && typeof who.email === 'string' ? lowerEmail(who.email) : '';
  } catch {
    return '';
  }
}

function kvOf(ctx) {
  return ownerOf(ctx).puter.kv;
}

/** puter.kv values may come back as parsed objects or JSON strings. */
function coerce(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Every response here is about one user's guest list — never cacheable.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function lowerEmail(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : '';
}

/** Body text: control characters stripped, newlines kept, length capped. */
function text(v, cap) {
  return typeof v === 'string' ? v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, cap) : '';
}

/** Header-safe text: as above, but folded to a single line. A stray CR/LF in
 *  a subject is how header injection starts; there is no legitimate newline in
 *  a title, a date line, or a name. */
function line(v, cap) {
  return text(v, cap).replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escaped, with the line breaks the host typed preserved. */
function escapeBlock(v) {
  return escapeHtml(v).replace(/\r?\n/g, '<br>');
}

/** Base64 without depending on btoa: the worker runtime's globals are not
 *  guaranteed, and an .ics body is UTF-8 (btoa is latin1-only anyway). */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(String(value));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b || 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c || 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

/* ---- Request validation --------------------------------------------------- */

/**
 * A guest's RSVP link, or '' — the ONLY link this worker will put in a mail.
 * It must be an RSVP capability URL on the Puter workers domain: https, a
 * *.puter.work host, and the exact /rsvp/<40 hex> path the RSVP worker mints.
 * Query and fragment are dropped rather than trusted.
 */
function rsvpUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return '';
  let url = null;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  if (!/^[a-z0-9-]+\.puter\.work$/i.test(url.hostname)) return '';
  if (!/^\/rsvp\/[0-9a-f]{40}$/.test(url.pathname)) return '';
  return `https://${url.hostname.toLowerCase()}${url.pathname}`;
}

/**
 * The event's meeting link, or '' — the only other link this worker will put
 * in a mail. Held to the exact shape of a Puter Meetings room link
 * (https://meetings.puter.com/#/m/<room code>), because meeting URLs reach
 * the calendar from outside too (ICS import), and this worker must not
 * become a way to mail guests an arbitrary URL under the calendar's name.
 */
function meetingUrl(value) {
  if (typeof value !== 'string' || value.length > 100) return '';
  return /^https:\/\/meetings\.puter\.com\/#\/m\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|[a-z]{4}-[a-z]{4}-[a-z]{4})$/.test(value)
    ? value
    : '';
}

/* The RFC 5545 / 7986 / 9073 / 9253 properties whose VALUE is a URI. Mail
 * clients read a conference link out of these (URL for Apple, X-GOOGLE-
 * CONFERENCE and CONFERENCE for Google), and ATTACH/IMAGE render as
 * downloads and pictures, so they are the attachment's clickable surface. */
const ICS_URI_PROPS = new Set(['URL', 'ATTACH', 'CONFERENCE', 'IMAGE', 'SOURCE', 'LINK', 'STRUCTURED-DATA', 'TZURL']);

/** The value part of an unfolded content line: everything after the first
 *  ':' that is not inside a quoted parameter (CN="Ada: Countess" is one). */
function icsValue(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) return line.slice(i + 1);
  }
  return '';
}

/**
 * Why the caller's .ics may not be attached, or '' when it may.
 *
 * The attachment is the one part of the mail this worker does not compose,
 * and it is what the guest's mail client builds the invitation card from:
 * the organizer it shows, the "join" it offers, the address its native RSVP
 * buttons reply to, whether the file installs an event or retracts one. Left
 * unread, it would be exactly the relay the body is carefully not — so the
 * file is held to the body's rules. METHOD must be what the route says the
 * message is (a "Cancelled:" mail must not carry a REQUEST that installs the
 * event); ORGANIZER must be the organizer the body names; and every
 * URI-valued property — the standard ones above and any X- extension, which
 * is where clients read conference links from — may carry only the event's
 * validated meeting link. Text properties (SUMMARY, DESCRIPTION, LOCATION…)
 * are the host's own words, shown as text by every client, and are as
 * trusted here as the same words in the body. A line no parser would read as
 * a property is passed over rather than failed: it can name no organizer and
 * carry no link.
 *
 * Checked against exactly what src/js/ics.js writes (tests/email-worker.test.js
 * feeds this the real toICS output), so the app never trips it; a caller that
 * does is not the app.
 */
/** The property name and parameters of an unfolded content line — everything
 *  before the first colon that is not inside a quoted parameter value. */
function icsParamText(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) return line.slice(0, i);
  }
  return line;
}

function icsProblem(ics, { method, organizerEmail, meetingLink }) {
  // Unfold continuation lines (RFC 5545 §3.1) first — a folded "UR\r\n L:"
  // is a URL to every client — then read one property per line.
  const lines = ics.replace(/(?:\r\n|\r|\n)[ \t]/g, '').split(/\r\n|\r|\n/);
  for (const line of lines) {
    const m = /^([A-Za-z0-9-]+)([;:])/.exec(line);
    if (!m) continue;
    const name = m[1].toUpperCase();
    // A URI can ride in a PARAMETER as well as a value: ALTREP names an
    // "alternate representation" some clients render in place of the text,
    // DIR and SENT-BY hang a link off an organizer or attendee. None of them
    // is anything the app writes, and each is a clickable URL of the caller's
    // choosing in a mail this worker vouches for.
    if (m[2] === ';' && /(?:^|;)(?:ALTREP|DIR|SENT-BY)=/i.test(icsParamText(line))) return 'link';
    if (name === 'METHOD') {
      if (icsValue(line).trim().toUpperCase() !== method) return 'method';
    } else if (name === 'ORGANIZER') {
      const address = icsValue(line).trim().replace(/^mailto:/i, '').toLowerCase();
      if (!address || address !== organizerEmail) return 'organizer';
    } else if (ICS_URI_PROPS.has(name) || name.startsWith('X-')) {
      if (!meetingLink || icsValue(line).trim() !== meetingLink) return 'link';
    }
  }
  return '';
}

/** The invitation request, normalized — or { error } for a 400. The route
 *  decides what the message IS (`forcedKind`); the body only ever picks
 *  between the /invites flavors. A cancellation is stripped of both link
 *  kinds whatever the caller sent: the guests' RSVP links are revoked with
 *  the event, and "Join" has no place in mail about a meeting that is off. */
function readRequest(body, forcedKind = '') {
  const src = body && typeof body === 'object' ? body : {};
  const ev = src.event && typeof src.event === 'object' ? src.event : {};
  // The id becomes part of a KV key. Same alphabet the app's uid() uses (and
  // the RSVP worker enforces), so nothing can smuggle a separator in.
  if (typeof ev.id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(ev.id)) {
    return { error: 'event_id_required' };
  }
  const kind = forcedKind || (src.kind === 'update' ? 'update' : 'invite');

  const recipients = [];
  const seen = new Set();
  for (const g of Array.isArray(src.recipients) ? src.recipients : []) {
    const email = lowerEmail(g && g.email);
    if (!email || seen.has(email)) continue;
    // A digest of everything THIS guest sees — the event's details and their
    // own link — computed by the app (invites.js). Opaque here: the worker only
    // ever compares it to the one it last sent to the same guest. Per guest,
    // not per event, because a re-issued RSVP link is reason enough to write
    // again even when nothing about the event moved.
    const version = /^[0-9a-f]{8,64}$/.test(String((g && g.version) || '')) ? String(g.version) : '';
    if (!version) return { error: 'version_required' };
    seen.add(email);
    recipients.push({
      email,
      version,
      name: line(g && g.name, 200),
      rsvpUrl: kind === 'cancel' ? '' : rsvpUrl(g && g.rsvpUrl),
    });
    if (recipients.length >= MAX_RECIPIENTS) break;
  }
  if (!recipients.length) return { error: 'recipients_required' };

  const ics = typeof src.ics === 'string' && src.ics.length <= MAX_ICS_CHARS ? src.ics : '';
  if (ics) {
    const problem = icsProblem(ics, {
      method: kind === 'cancel' ? 'CANCEL' : 'REQUEST',
      // The address as the caller wrote it: the body prints only a
      // well-formed one, but the file's ORGANIZER has to be the organizer
      // the caller named, whatever shape that name is in.
      organizerEmail: typeof ev.organizerEmail === 'string' ? ev.organizerEmail.trim().toLowerCase() : '',
      // The event's link, whatever the message kind: a cancellation's file
      // still describes the event (the body just stops offering to join it).
      meetingLink: meetingUrl(ev.meetingUrl),
    });
    if (problem) return { error: 'invalid_ics', reason: problem };
  }

  return {
    kind,
    removedGuests: kind === 'cancel' && src.cancellationScope === 'guests',
    recipients,
    force: src.force === true,
    event: {
      id: ev.id,
      title: line(ev.title, 200) || '(No title)',
      when: line(ev.when, 200),
      recurLabel: line(ev.recurLabel, 200),
      location: line(ev.location, 500),
      meetingUrl: kind === 'cancel' ? '' : meetingUrl(ev.meetingUrl),
      description: text(ev.description, 2000),
      organizerName: line(ev.organizerName, 200),
      organizerEmail: lowerEmail(ev.organizerEmail),
    },
    note: text(src.note, 2000),
    ics,
  };
}

/* ---- The message ---------------------------------------------------------- */

function hostName(event) {
  return event.organizerName || event.organizerEmail || 'Someone';
}

function subjectFor(req) {
  const prefix =
    req.removedGuests ? 'Invitation cancelled' : req.kind === 'cancel' ? 'Cancelled' : req.kind === 'update' ? 'Updated invitation' : 'Invitation';
  const when = req.event.when ? ` — ${req.event.when}` : '';
  return line(`${prefix}: ${req.event.title}${when}`, 200);
}

function introFor(req, guest) {
  const host = hostName(req.event);
  if (req.removedGuests) return `${host} cancelled your invitation to this event.`;
  if (req.kind === 'cancel' && guest.isHost) return 'You cancelled this event.';
  if (req.kind === 'cancel') return `${host} cancelled an event you were invited to.`;
  if (req.kind === 'update') return `${host} updated an event you're invited to.`;
  return `${host} invited you to an event.`;
}

function plainBody(req, guest) {
  const ev = req.event;
  const out = [];
  if (guest.name) out.push(`Hi ${guest.name},`, '');
  out.push(introFor(req, guest), '', ev.title);
  if (ev.when) out.push(ev.when);
  if (ev.recurLabel) out.push(ev.recurLabel);
  if (ev.location) out.push(`Where: ${ev.location}`);
  if (ev.meetingUrl) out.push(`Join: ${ev.meetingUrl}`);
  if (ev.organizerEmail) {
    out.push(`Organizer: ${ev.organizerName ? `${ev.organizerName} <${ev.organizerEmail}>` : ev.organizerEmail}`);
  }
  if (req.note) out.push('', req.note);
  if (ev.description) out.push('', ev.description);
  if (guest.rsvpUrl) {
    out.push(
      '',
      'Will you attend?',
      `  Yes:   ${guest.rsvpUrl}/accept`,
      `  No:    ${guest.rsvpUrl}/decline`,
      `  Maybe: ${guest.rsvpUrl}/maybe`,
      '',
      `Or open your invitation: ${guest.rsvpUrl}`,
    );
  }
  return out.join('\n');
}

/**
 * The HTML half. Deliberately plain: a table-free card, everything styled
 * inline (mail clients drop <style> blocks), no images and no web fonts, so it
 * degrades to something readable everywhere and loads nothing from the network.
 */
function htmlBody(req, guest) {
  const ev = req.event;
  const rows = [];
  const row = (label, value) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;vertical-align:top">${label}</td>` +
    `<td style="padding:4px 0;color:#111827;font-size:14px">${value}</td></tr>`;
  if (ev.when) rows.push(row('When', escapeHtml(ev.when)));
  if (ev.recurLabel) rows.push(row('Repeats', escapeHtml(ev.recurLabel)));
  if (ev.location) rows.push(row('Where', escapeHtml(ev.location)));
  if (ev.meetingUrl) {
    rows.push(
      row('Join', `<a href="${escapeHtml(ev.meetingUrl)}" style="color:#2563eb">${escapeHtml(ev.meetingUrl)}</a>`),
    );
  }
  if (ev.organizerEmail || ev.organizerName) {
    rows.push(row('Organizer', escapeHtml(ev.organizerName || ev.organizerEmail)));
  }

  const button = (label, action) =>
    `<a href="${escapeHtml(`${guest.rsvpUrl}/${action}`)}" ` +
    `style="display:inline-block;margin:0 8px 8px 0;padding:10px 20px;border-radius:8px;` +
    `background:#f3f4f6;color:#111827;font-size:14px;font-weight:600;text-decoration:none;` +
    `border:1px solid rgba(0,0,0,.08)">${label}</a>`;

  const actions = guest.rsvpUrl
    ? `<p style="margin:24px 0 8px;color:#111827;font-size:14px;font-weight:600">Will you attend?</p>` +
      `<div>${button('Yes', 'accept')}${button('No', 'decline')}${button('Maybe', 'maybe')}</div>` +
      `<p style="margin:12px 0 0;font-size:13px;color:#6b7280">Or open your invitation: ` +
      `<a href="${escapeHtml(guest.rsvpUrl)}" style="color:#2563eb">${escapeHtml(guest.rsvpUrl)}</a></p>`
    : '';

  const intro = escapeHtml(introFor(req, guest));

  return (
    `<div style="background:#f6f7f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">` +
    (guest.name ? `<p style="margin:0 0 12px;color:#111827;font-size:14px">Hi ${escapeHtml(guest.name)},</p>` : '') +
    `<p style="margin:0 0 16px;color:#6b7280;font-size:14px">${intro}</p>` +
    `<h1 style="margin:0 0 16px;color:#111827;font-size:20px;line-height:1.3">${escapeHtml(ev.title)}</h1>` +
    (rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.join('')}</table>` : '') +
    (req.note ? `<p style="margin:16px 0 0;color:#111827;font-size:14px;white-space:pre-wrap">${escapeBlock(req.note)}</p>` : '') +
    (ev.description ? `<p style="margin:16px 0 0;color:#374151;font-size:14px;white-space:pre-wrap">${escapeBlock(ev.description)}</p>` : '') +
    actions +
    `</div></div>`
  );
}

/** The .ics the host's app built for this event, as an attachment. The app
 *  writes METHOD:REQUEST — a real iTIP invitation — or METHOD:CANCEL for a
 *  cancellation, and the MIME type has to repeat that method: it is what
 *  Outlook and Gmail key on to make their auto-generated RSVP buttons
 *  actually work (or to retract the event) instead of rendering an inert
 *  strip. Read from the file rather than assumed, so this worker faithfully
 *  labels whatever it was handed. */
function attachmentsFor(req) {
  if (!req.ics) return undefined;
  const method = /^METHOD:([A-Za-z-]+)\s*$/m.exec(req.ics);
  return [
    {
      filename: req.kind === 'cancel' ? 'cancel.ics' : 'invite.ics',
      content: base64Utf8(req.ics),
      contentType: `text/calendar; charset=utf-8${method ? `; method=${method[1].toUpperCase()}` : ''}`,
    },
  ];
}

/* ---- Sending -------------------------------------------------------------- */

/**
 * A send has two halves — who pays (the calendar user) and what authorizes it
 * (this worker) — and the platform accepts them in either arrangement:
 *
 *   me.puter.email.sendTransactional({ …, requesterToken: user.puter.authToken })
 *   user.puter.email.sendTransactional({ …, emailAccessToken: me.puter.authToken })
 *
 * Both bill the calendar user; which name a given runtime knows has moved, and
 * a worker that only spoke one of them would silently stop sending. So try the
 * first, fall back to the second, and remember which one answered for the rest
 * of this worker's life. The fallback is gated on the error looking like a
 * rejected request (bad parameter, bad token) rather than a rejected DELIVERY —
 * retrying a message the transport already accepted would double-send it.
 *
 * The method itself has moved too: `sendTransactional` is its name now, `send`
 * the one it had, still served until every caller has moved. mailerOf() picks
 * whichever this runtime's SDK carries, per call, so a runtime upgraded under a
 * long-lived worker is picked up without a redeploy.
 */
let preferredForm = 0;

function mailerOf(puter) {
  const email = puter && puter.email;
  if (email && typeof email.sendTransactional === 'function') {
    return (message) => email.sendTransactional(message);
  }
  // Reaches for `send` even when it is absent: the TypeError reads as a
  // rejected REQUEST to sendMail(), which then tries the other arrangement.
  return (message) => email.send(message);
}

function hasMailer(puter) {
  const email = puter && puter.email;
  return Boolean(
    email && (typeof email.sendTransactional === 'function' || typeof email.send === 'function'),
  );
}

const DELIVERY_ERROR = /deliver|recipient|suppress|unsubscrib|mailbox|smtp|bounce|spam|quota|rate|limit/i;
const REQUEST_ERROR = /token|auth|unauthor|forbidden|permission|denied|unknown|unrecognized|unsupported|invalid|missing|required|not a function|undefined/i;

function sendForms(ctx) {
  const owner = ownerOf(ctx);
  const caller = callerOf(ctx);
  return [
    (message) =>
      mailerOf(owner.puter)({ ...message, requesterToken: caller.puter.authToken }),
    (message) =>
      mailerOf(caller.puter)({ ...message, emailAccessToken: owner.puter.authToken }),
  ];
}

async function sendMail(ctx, message) {
  const forms = sendForms(ctx);
  const order = preferredForm === 0 ? [0, 1] : [1, 0];
  let lastErr = null;
  for (const index of order) {
    try {
      const result = await forms[index](message);
      preferredForm = index;
      return result || {};
    } catch (err) {
      lastErr = err;
      const reason = String((err && err.message) || err || '');
      // Anything the transport said about THIS message is final.
      if (DELIVERY_ERROR.test(reason) || !REQUEST_ERROR.test(reason)) throw err;
    }
  }
  throw lastErr;
}

/* ---- Dedupe + daily cap ---------------------------------------------------- */

function sentKey(uuid, eventId, email) {
  return sha256Hex(`${uuid}|${eventId}|${email}`).then((hash) => SENT_PREFIX + hash);
}

async function expire(kv, key, seconds) {
  try {
    if (typeof kv.expire === 'function') await kv.expire(key, seconds);
  } catch {
    /* a key that outlives its welcome is harmless; a failed send is not */
  }
}

async function quotaKey(uuid) {
  return `${RATE_PREFIX}${await sha256Hex(uuid)}:${new Date().toISOString().slice(0, 10)}`;
}

async function quotaUsed(kv, key) {
  const value = coerce(await kv.get(key));
  const used = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(used) && used > 0 ? used : 0;
}

/**
 * Reserve `want` sends against today's cap and return how many may go out.
 * Reserve-then-refund where the store can increment atomically: a
 * read-then-write cap let N concurrent requests each read the same count and
 * each send their full batch — 40 parallel posts of 50 recipients put 2,000
 * mails out under a cap of 200. Reservation up front means every request's
 * count already includes every other's; what a request then does not send
 * (over-reservation, failures, suppressions) is given back. A refund that is
 * lost only makes the cap stricter, never looser. Without incr, the old
 * read-then-write stands and bumpQuota() settles the count afterwards.
 */
async function reserveQuota(kv, key, want) {
  if (typeof kv.incr !== 'function') {
    const used = await quotaUsed(kv, key);
    return { granted: Math.min(want, Math.max(0, DAILY_LIMIT - used)), reserved: false };
  }
  const res = await kv.incr(key, want);
  const after = Number.isFinite(Number(res)) && res !== null ? Number(res) : await quotaUsed(kv, key);
  await expire(kv, key, RATE_TTL).catch(() => {});
  const before = after - want;
  const granted = Math.max(0, Math.min(want, DAILY_LIMIT - before));
  if (granted < want) await releaseQuota(kv, key, want - granted);
  return { granted, reserved: true };
}

async function releaseQuota(kv, key, n) {
  if (!n) return;
  try {
    if (typeof kv.decr === 'function') await kv.decr(key, n);
    else await kv.incr(key, -n);
  } catch {
    /* a lost refund only makes the cap stricter */
  }
}

async function bumpQuota(kv, key, n) {
  if (!n) return;
  try {
    if (typeof kv.incr === 'function') await kv.incr(key, n);
    else await kv.set(key, (await quotaUsed(kv, key)) + n);
    await expire(kv, key, RATE_TTL);
  } catch {
    /* the cap is a guard rail, not a ledger — never fail a send over it */
  }
}

/* ---- Routes ---------------------------------------------------------------- */

router.get('/health', async () => json({ ok: true, version: WORKER_VERSION, runtime: workerRuntime() }));

/**
 * What this worker can see of the caller — NAMES and presence only, never a
 * value, a token, or an address. Two different failures both surface as "you
 * are not signed in" from /invites (the session never left the browser, or it
 * arrived and the runtime bound it somewhere this code doesn't look), and only
 * the worker itself can tell them apart. Answering to the caller about their
 * own session leaks nothing they don't already have.
 */
router.get('/whoami', async (ctx) => {
  const caller = callerOf(ctx);
  const p = caller && caller.puter;
  return json({
    ok: true,
    version: WORKER_VERSION,
    runtime: workerRuntime(),
    // Did the session even reach us? puter.workers.exec() sends this header.
    sawAuthHeader: Boolean(ctx.request.headers.get('puter-auth')),
    boundAs: ctx.user ? 'user' : ctx.requestor ? 'requestor' : null,
    callerKeys: caller ? Object.keys(caller).sort() : [],
    puterKeys: p ? Object.keys(p).sort() : [],
    has: {
      puter: Boolean(p),
      authToken: Boolean(p && p.authToken),
      email: hasMailer(p),
      auth: Boolean(p && p.auth && typeof p.auth.getUser === 'function'),
    },
    identified: Boolean(await callerIdOf(caller)),
    owner: {
      email: Boolean(ownerOf(ctx) && ownerOf(ctx).puter && ownerOf(ctx).puter.email),
      authToken: Boolean(ownerOf(ctx) && ownerOf(ctx).puter && ownerOf(ctx).puter.authToken),
    },
  });
});

/**
 * The one send pipeline, shared by both POST routes. `forcedKind` is the
 * route's say over what the message is: '' lets the body choose between the
 * invitation flavors (/invites), 'cancel' composes a cancellation whatever
 * the body claims (/cancellations). Everything else — auth, the daily cap,
 * the per-guest already-sent record — is identical, and deliberately shares
 * state: a cancellation counts against the same quota, and writing its digest
 * over the invitation's is exactly what lets a re-invitation go out if the
 * host restores the event and starts over.
 */
async function deliver(ctx, forcedKind = '') {
  // A caller context exists only for requests that came through
  // puter.workers.exec(), which forwards their Puter session. No session, no
  // send — and no way to bill anyone for one either. `detail` separates "no
  // session arrived" from "a session arrived that we could not pin to a
  // person"; GET /whoami reports the same picture in full.
  const caller = callerOf(ctx);
  if (!caller || !caller.puter) {
    return json({ error: 'sign_in_required', detail: 'no_caller' }, 401);
  }
  const callerId = await callerIdOf(caller);
  if (!callerId) return json({ error: 'sign_in_required', detail: 'no_identity' }, 401);

  let body = null;
  try {
    body = await ctx.request.json();
  } catch {
    /* handled by readRequest */
  }
  const req = readRequest(body, forcedKind);
  if (req.error) return json(req.reason ? { error: req.error, reason: req.reason } : { error: req.error }, 400);

  // The organizer a mail speaks for — its Reply-To, its .ics ORGANIZER, the
  // "<name> invited you" line — must be the caller, whenever the platform can
  // say who that is. This worker answers any signed-in Puter user; without
  // the check anyone could put the calendar's sender behind a mail whose
  // replies and RSVP answers went to an address of their choosing.
  const callerEmail = await callerEmailOf(caller);
  if (callerEmail && req.event.organizerEmail && req.event.organizerEmail !== callerEmail) {
    return json({ error: 'organizer_mismatch' }, 403);
  }

  // Event cancellation digests are shared by all recipients, including across
  // batches. Sending the host through the same loop applies the normal quota,
  // failure reporting and retry deduplication without dropping a guest.
  if (req.kind === 'cancel' && !req.removedGuests) {
    const email = req.event.organizerEmail || callerEmail;
    if (email) {
      const existing = req.recipients.find((recipient) => recipient.email === email);
      if (existing) existing.isHost = true;
      else req.recipients.push({
        email,
        name: req.event.organizerName,
        version: req.recipients[0].version,
        rsvpUrl: '',
        isHost: true,
      });
    }
  }

  const kv = kvOf(ctx);

  // Who still needs this mail. Same invitation, same guest, nothing changed:
  // don't spend the user's money to send a duplicate. A guest whose details
  // or link changed gets a new `version` from the app, and `force` covers a
  // deliberate resend. Settled before the daily cap is consulted, because a
  // press that needs no mail — a retry after a lost reply, the same event
  // from a second device — is not a send the cap should refuse.
  const results = [];
  const due = [];
  for (const guest of req.recipients) {
    const key = await sentKey(callerId, req.event.id, guest.email);
    const previous = req.force ? null : coerce(await kv.get(key));
    if (previous && previous.v === guest.version) {
      results.push({ email: guest.email, status: 'skipped', reason: 'already_sent', at: previous.at || 0 });
      continue;
    }
    due.push({ guest, key });
  }

  const rateKey = await quotaKey(callerId);
  const quota = due.length ? await reserveQuota(kv, rateKey, due.length) : { granted: 0, reserved: false };
  let budget = quota.granted;
  if (!budget && due.length) return json({ error: 'daily_limit', limit: DAILY_LIMIT }, 429);

  const subject = subjectFor(req);
  const attachments = attachmentsFor(req);
  const replyTo = req.event.organizerEmail || undefined;
  let sent = 0;
  let cost = 0;

  for (const { guest, key } of due) {
    if (!budget) {
      results.push({ email: guest.email, status: 'skipped', reason: 'daily_limit' });
      continue;
    }

    try {
      const out =
        (await sendMail(ctx, {
          to: guest.email,
          subject,
          text: plainBody(req, guest),
          html: htmlBody(req, guest),
          replyTo,
          attachments,
        })) || {};
      // One recipient per send, so these arrays name this guest or nobody.
      // Both outcomes leave the invitation unsent: don't record it as sent, or
      // a later retry would be skipped as a duplicate.
      if ((out.suppressed || []).includes(guest.email)) {
        results.push({ email: guest.email, status: 'suppressed' });
        continue;
      }
      if ((out.failed || []).includes(guest.email)) {
        results.push({ email: guest.email, status: 'failed', reason: 'delivery_failed' });
        continue;
      }
      budget -= 1;
      sent += 1;
      cost += Number.isFinite(out.cost) ? out.cost : 0;
      const at = Date.now();
      results.push({ email: guest.email, status: 'sent', at });
      // The mail is out. Recording it is a separate matter: a storage error
      // here used to fall into the catch below and report the guest as
      // `failed` — so the app never logged them, and the next press mailed
      // them the same invitation again.
      try {
        await kv.set(key, { v: guest.version, at });
        await expire(kv, key, SENT_TTL);
      } catch {
        /* sent but unrecorded — a retry can at worst duplicate, never lose */
      }
    } catch (err) {
      results.push({
        email: guest.email,
        status: 'failed',
        reason: line((err && err.message) || 'send_failed', 200),
      });
    }
  }

  // Settle the count: give back what was reserved but not sent, or (without
  // atomic increments) add what went out.
  if (quota.reserved) await releaseQuota(kv, rateKey, quota.granted - sent);
  else await bumpQuota(kv, rateKey, sent);

  return json({
    ok: true,
    version: WORKER_VERSION,
    sent,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    // Counted apart from failures: a suppressed guest unsubscribed from this
    // sender's mail, which is a decision to report, not a fault to retry.
    suppressed: results.filter((r) => r.status === 'suppressed').length,
    cost,
    results,
  });
}

router.post('/invites', (ctx) => deliver(ctx));
router.post('/cancellations', (ctx) => deliver(ctx, 'cancel'));

/* ---- Replies (fallback for src/js/mail-reply.js's puter.email.send) ------- */

const PARTSTAT_LABEL = { accepted: 'Accepted', declined: 'Declined', tentative: 'Tentative' };
const PARTSTAT_VERB = {
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentatively accepted',
};

/** The reply request, normalized — or { error } for a 400. Unlike /invites,
 *  there is exactly one recipient (the organizer) and the .ics is required: a
 *  REPLY with no attachment gives the organizer's client nothing to match
 *  against the invitation it sent, so there is no point sending one at all. */
function readReplyRequest(body) {
  const src = body && typeof body === 'object' ? body : {};
  const ev = src.event && typeof src.event === 'object' ? src.event : {};
  if (typeof ev.id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(ev.id)) {
    return { error: 'event_id_required' };
  }
  const organizerEmail = lowerEmail(ev.organizerEmail);
  if (!organizerEmail) return { error: 'organizer_required' };

  const att = src.attendee && typeof src.attendee === 'object' ? src.attendee : {};
  const attendeeEmail = lowerEmail(att.email);
  if (!attendeeEmail) return { error: 'attendee_required' };

  const partstat = Object.prototype.hasOwnProperty.call(PARTSTAT_LABEL, src.partstat)
    ? src.partstat
    : '';
  if (!partstat) return { error: 'partstat_required' };

  const version = /^[0-9a-f]{8,64}$/.test(String(src.version || '')) ? String(src.version) : '';
  if (!version) return { error: 'version_required' };

  const ics =
    typeof src.ics === 'string' && src.ics.length > 0 && src.ics.length <= MAX_ICS_CHARS
      ? src.ics
      : '';
  if (!ics) return { error: 'ics_required' };
  // A REPLY carries no meeting link or RSVP link of its own — pass '' so ANY
  // URI-valued property (a forged Join link riding along) is refused.
  const problem = icsProblem(ics, { method: 'REPLY', organizerEmail, meetingLink: '' });
  if (problem) return { error: 'invalid_ics', reason: problem };

  return {
    event: {
      id: ev.id,
      title: line(ev.title, 200) || '(No title)',
      when: line(ev.when, 200),
      organizerEmail,
      organizerName: line(ev.organizerName, 200),
    },
    attendee: { email: attendeeEmail, name: line(att.name, 200) },
    partstat,
    version,
    ics,
  };
}

function replyIntro(req) {
  const who = req.attendee.name || req.attendee.email;
  return `${who} ${PARTSTAT_VERB[req.partstat]} your invitation.`;
}

function replyPlainBody(req) {
  const ev = req.event;
  const out = [replyIntro(req), '', ev.title];
  if (ev.when) out.push(ev.when);
  return out.join('\n');
}

/** No links, no buttons — a REPLY is a status update, not something to act on. */
function replyHtmlBody(req) {
  const ev = req.event;
  const when = ev.when
    ? `<p style="margin:0 0 8px;color:#6b7280;font-size:14px">${escapeHtml(ev.when)}</p>`
    : '';
  return (
    `<div style="background:#f6f7f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">` +
    `<p style="margin:0 0 16px;color:#111827;font-size:14px">${escapeHtml(replyIntro(req))}</p>` +
    `<h1 style="margin:0 0 16px;color:#111827;font-size:20px;line-height:1.3">${escapeHtml(ev.title)}</h1>` +
    when +
    `</div></div>`
  );
}

function attachmentsForReply(req) {
  return [
    {
      filename: 'reply.ics',
      content: base64Utf8(req.ics),
      contentType: 'text/calendar; charset=utf-8; method=REPLY',
    },
  ];
}

/**
 * POST /replies — same anti-relay posture as /invites: the caller hands over an
 * event, an attendee and a PARTSTAT; this worker composes the message and reads
 * (never relays) the caller's own .ics.
 *
 * `attendee.email` must be the caller answering for THEMSELVES — checked
 * against `callerEmailOf`, the account email, when the platform can name it.
 * That can legitimately differ from the caller's `<username>@puter.email`
 * mailbox address (the address a mail-received invitation was actually made out
 * to), so a mismatch is only refused when attendee.email is neither the account
 * email nor that mailbox address — otherwise nobody could ever reply as the
 * very address their invitation was sent to.
 */
async function deliverReply(ctx) {
  const caller = callerOf(ctx);
  if (!caller || !caller.puter) {
    return json({ error: 'sign_in_required', detail: 'no_caller' }, 401);
  }
  const callerId = await callerIdOf(caller);
  if (!callerId) return json({ error: 'sign_in_required', detail: 'no_identity' }, 401);

  let body = null;
  try {
    body = await ctx.request.json();
  } catch {
    /* handled by readReplyRequest */
  }
  const req = readReplyRequest(body);
  if (req.error) {
    return json(req.reason ? { error: req.error, reason: req.reason } : { error: req.error }, 400);
  }

  const callerEmail = await callerEmailOf(caller);
  const callerUsername = (caller && caller.username) || '';
  const selfMailbox = callerUsername ? `${callerUsername.toLowerCase()}@puter.email` : '';
  if (callerEmail && req.attendee.email !== callerEmail && req.attendee.email !== selfMailbox) {
    return json({ error: 'attendee_mismatch' }, 403);
  }

  const kv = kvOf(ctx);
  const key = await sentKey(callerId, req.event.id, req.event.organizerEmail);
  const previous = coerce(await kv.get(key));
  if (previous && previous.v === req.version) {
    return json({
      ok: true,
      version: WORKER_VERSION,
      sent: 0,
      skipped: 1,
      failed: 0,
      results: [
        { email: req.event.organizerEmail, status: 'skipped', reason: 'already_sent' },
      ],
    });
  }

  const rateKey = await quotaKey(callerId);
  const quota = await reserveQuota(kv, rateKey, 1);
  if (!quota.granted) return json({ error: 'daily_limit', limit: DAILY_LIMIT }, 429);

  let sent = 0;
  const results = [];
  try {
    const out =
      (await sendMail(ctx, {
        to: req.event.organizerEmail,
        subject: line(`${PARTSTAT_LABEL[req.partstat]}: ${req.event.title}`, 200),
        text: replyPlainBody(req),
        html: replyHtmlBody(req),
        attachments: attachmentsForReply(req),
      })) || {};
    if ((out.suppressed || []).includes(req.event.organizerEmail)) {
      results.push({ email: req.event.organizerEmail, status: 'suppressed' });
    } else if ((out.failed || []).includes(req.event.organizerEmail)) {
      results.push({ email: req.event.organizerEmail, status: 'failed', reason: 'delivery_failed' });
    } else {
      sent = 1;
      const at = Date.now();
      results.push({ email: req.event.organizerEmail, status: 'sent', at });
      try {
        await kv.set(key, { v: req.version, at });
        await expire(kv, key, SENT_TTL);
      } catch {
        /* sent but unrecorded — a retry can at worst duplicate, never lose */
      }
    }
  } catch (err) {
    results.push({
      email: req.event.organizerEmail,
      status: 'failed',
      reason: line((err && err.message) || 'send_failed', 200),
    });
  }

  if (quota.reserved) await releaseQuota(kv, rateKey, quota.granted - sent);
  else await bumpQuota(kv, rateKey, sent);

  return json({
    ok: true,
    version: WORKER_VERSION,
    sent,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
}

router.post('/replies', (ctx) => deliverReply(ctx));
