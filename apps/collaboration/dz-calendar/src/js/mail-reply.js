/**
 * iTIP REPLY by email — answering an invitation the calendar received by
 * mail with a real reply the ORGANIZER's own mail client understands, not
 * just a KV write on our side.
 *
 * Two ways to get the message out, tried in order:
 *   - primary: `puter.email.send(...)` — sent from the user's own
 *     `<username>@puter.email` address, needing the `.mail:write` ACL
 *     (requested lazily, on first 'forbidden').
 *   - fallback: the shared email worker's `/replies` route (same worker as
 *     invites.js, same anti-relay posture: the caller hands over an event and
 *     a PARTSTAT, the worker composes the message).
 *
 * `send()` resolves the server's JSON body regardless of HTTP status — it
 * never throws on a refusal, and it raises Puter's own upgrade dialog on a
 * 402 itself. So every outcome here is read off that body, never a status
 * code: `delivered` naming the organizer is a send; `forbidden` gets one
 * permission request and one retry; `too_many_requests` is the user's own
 * daily budget and is reported, not retried elsewhere; anything else —
 * `subscription_required`, an external-plan refusal, an SDK with no
 * `email.send` at all — falls back to the worker.
 *
 * Nothing here ever sends without a press: `offerReply` only opens a confirm
 * dialog, and `sendReply` is reached solely through its "Send" button.
 */
import { toICS } from './ics.js';
import { EMAIL_WORKER_URL, digest, describeWhen } from './invites.js';
import { getUser, requestUserEmail } from './auth.js';
import { isBlocked } from './offline.js';
import { toast as defaultToast } from './toast.js';
import { el } from './dom.js';
import { mountDialog } from './recurrence-dialog.js';

const STATUS_LABEL = { accepted: 'Accepted', declined: 'Declined', tentative: 'Tentative' };
const STATUS_VERB = {
  accepted: 'has accepted this invitation.',
  declined: 'has declined this invitation.',
  tentative: 'has tentatively accepted this invitation.',
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/* ---- Small, pure helpers -------------------------------------------------- */

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Plain (unwrapped) base64 — ComposerLib takes the attachment `content` as
 *  one string and wraps it itself. */
function base64Bytes(bytes) {
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

/** `Accepted: <title>` etc., ASCII-folded: ComposerLib throws on any header
 *  value outside printable ASCII, so every non-ASCII (or control-character)
 *  run collapses to one '?'. A title with nothing printable left — empty,
 *  all-emoji, all-CJK — falls back to a plain "invitation" rather than a
 *  subject that is just question marks. */
function replySubject(status, title) {
  const folded = String(title ?? '').replace(/[^\x20-\x7e]+/g, '?').trim().slice(0, 200);
  const body = /[^\s?]/.test(folded) ? folded : 'invitation';
  return `${STATUS_LABEL[status]}: ${body}`;
}

function localTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function guestNameFor(event, email) {
  const list = Array.isArray(event && event.guests) ? event.guests : [];
  const match = list.find((g) => normalizeEmail(g && g.email) === email);
  return (match && match.name) || '';
}

/** Same shape of message as invites.js's failureMessage/cancelFailureMessage,
 *  for the worker's /replies route. */
function replyFailureMessage(status, data) {
  const code = (data && data.error) || '';
  if (status === 401 || code === 'sign_in_required') return 'Sign in to Puter again to send your reply.';
  if (status === 429 || code === 'daily_limit') return "You've reached today's email limit. Try again tomorrow.";
  if (status === 403 || code === 'attendee_mismatch') {
    return 'Sign in to Puter again — this reply would not be sent from your account.';
  }
  if (status === 404 || code === 'invalid_ics') return 'The email service needs an update before it can send your reply.';
  return 'Could not send the reply. Please try again.';
}

function describeReason(reason) {
  if (reason === 'offline') return "you're offline.";
  if (reason === 'unavailable' || reason === 'none') return 'sending is not available right now.';
  if (reason === 'no_organizer') return 'this event has no organizer to reply to.';
  if (reason === 'no_self_email') return 'your email address could not be confirmed.';
  if (reason === 'ics_failed') return 'the reply could not be prepared.';
  if (typeof reason === 'string' && reason.trim()) return reason;
  return 'please try again.';
}

/** What to toast for a sendReply() outcome — a plain function so tests (and
 *  any other caller) can check the wording without sending anything. */
export function describeResult(out) {
  if (!out) return { message: 'Could not send the reply.', variant: 'danger' };
  if (out.sent) return { message: `Reply sent to ${out.organizerEmail}`, variant: 'success' };
  return { message: `Saved. The reply email could not be sent — ${describeReason(out.reason)}`, variant: 'danger' };
}

export function createMailReply({
  store,
  user,
  getPuter = () => (typeof puter !== 'undefined' ? puter : null),
  workerUrl = EMAIL_WORKER_URL,
  blocked = isBlocked,
  toast = defaultToast,
  requestUser = getUser,
  requestEmail = requestUserEmail,
}) {
  let selfEmail = normalizeEmail(user && user.email);
  let selfUsername = (user && user.username) || '';

  async function resolveSelf() {
    if (!selfEmail || !selfUsername) {
      try {
        const fresh = await requestUser();
        if (fresh) {
          selfUsername = selfUsername || fresh.username || '';
          selfEmail = selfEmail || normalizeEmail(fresh.email);
        }
      } catch {
        /* unresolved — the caller decides what an anonymous reply is worth */
      }
    }
    if (!selfEmail) {
      try {
        selfEmail = normalizeEmail(await requestEmail());
      } catch {
        /* a refusal here just means no reply can be sent */
      }
    }
    return { email: selfEmail, username: selfUsername };
  }

  function available() {
    const p = getPuter();
    if (!p) return false;
    const api = Boolean(p.email && typeof p.email.send === 'function');
    const worker = Boolean(p.workers && typeof p.workers.exec === 'function');
    return api || worker;
  }

  /** The `.mail:write` grant, asked for lazily — only once `send()` has
   *  actually shown it's missing ('forbidden'), never speculatively up front. */
  async function requestMailWritePermission(p, username) {
    try {
      if (!p || !p.perms || typeof p.perms.request !== 'function' || !username) return;
      await p.perms.request('permission', { permission: `fs:/${username}/.mail:write`, create: true });
    } catch {
      /* a refusal (or an SDK too old to have perms) just keeps the API path unavailable */
    }
  }

  function deliveredTo(body, email) {
    const list = body && Array.isArray(body.delivered) ? body.delivered : [];
    return list.some((addr) => normalizeEmail(addr) === email);
  }

  /** Send once via `puter.email.send`, interpreting its resolved body — see
   *  the module header for the full outcome matrix. `forbidden` retries once
   *  after requesting the write grant; everything unrecognized (including
   *  `subscription_required` and a `failed` entry naming an external-plan
   *  refusal) falls back to the worker. */
  async function attemptSend(p, payload, username, retried = false) {
    let body;
    try {
      body = await p.email.send(payload);
    } catch {
      // A transport failure, or ComposerLib refusing a header it cannot write
      // as ASCII — an organizer address with non-ASCII in it is the only one
      // we do not fold, since there is no sane folding of an address. Either
      // way the worker is the next thing to try.
      return { ok: false, fallback: true, reason: 'send_error' };
    }
    if (deliveredTo(body, normalizeEmail(payload.to))) return { ok: true, body };
    const code = body && body.code;
    if (code === 'forbidden' && !retried) {
      await requestMailWritePermission(p, username);
      return attemptSend(p, payload, username, true);
    }
    if (code === 'too_many_requests') {
      return { ok: false, fallback: false, reason: "You've reached today's email limit. Try again tomorrow." };
    }
    return { ok: false, fallback: true, reason: code || 'unknown' };
  }

  function announce(out) {
    const { message, variant } = describeResult(out);
    toast(message, { variant });
    return out;
  }

  /** The UID the organizer filed this invitation under. A reply is matched to
   *  a meeting by UID, so a foreign organizer's own UID has to travel back
   *  verbatim — toICS takes it as an override (it otherwise synthesizes
   *  `<id>@calendar.puter.com`, which no external calendar has ever seen). */
  function replyUid(event) {
    return (event.invite && typeof event.invite.uid === 'string' && event.invite.uid) || '';
  }

  /** Offer to email the answer — never automatic. Opens a confirm dialog
   *  (mirrors invitation-dialog.js) and calls sendReply only on "Send". */
  function offerReply(event, status, { organizer } = {}) {
    const org = organizer || (event && event.organizer);
    const email = normalizeEmail(org && org.email);
    if (!email || !event || blocked() || !available()) return;
    openReplyDialog({
      email,
      onConfirm: () => {
        sendReply({ ...event, organizer: org }, status);
      },
    });
  }

  async function sendReply(event, status) {
    if (!STATUS_LABEL[status]) throw new Error('Unknown RSVP status.');
    const organizer = event && event.organizer;
    const organizerEmail = normalizeEmail(organizer && organizer.email);
    if (!organizerEmail) return announce({ ok: false, sent: false, reason: 'no_organizer', organizerEmail: '' });
    if (blocked()) return announce({ ok: false, sent: false, reason: 'offline', organizerEmail });
    if (!available()) return announce({ ok: false, sent: false, reason: 'unavailable', organizerEmail });

    const self = await resolveSelf();
    if (!self.username) {
      return announce({ ok: false, sent: false, reason: 'no_self_email', organizerEmail });
    }

    // The address the REPLY answers as. Google and Outlook silently drop a
    // REPLY whose ATTENDEE isn't one they invited — so it must be the address
    // the original REQUEST used when we have it, not just whichever address
    // happens to be on the account. From is unaffected: puter.email.send
    // always sends from the account's own <username>@puter.email.
    const inviteAttendee = event.invite && typeof event.invite.attendee === 'string'
      ? normalizeEmail(event.invite.attendee)
      : '';
    const attendeeEmail = inviteAttendee || self.email || `${self.username}@puter.email`;

    const title = event.title || '(No title)';
    const when = describeWhen(event, { hour12: store.getSettings().hour12 !== false });
    const attendeeName = guestNameFor(event, attendeeEmail) || self.username;
    const replyId = event.id;
    const uid = replyUid(event);
    const sequence = event.invite && Number.isFinite(event.invite.seq) ? event.invite.seq : 0;

    let ics = '';
    try {
      ics = toICS(
        [
          {
            id: replyId,
            title: event.title,
            start: event.start,
            end: event.end,
            allDay: Boolean(event.allDay),
            organizer: { email: organizerEmail, name: organizer.name || '' },
            guests: [{ email: attendeeEmail, name: attendeeName, status }],
          },
        ],
        { method: 'REPLY', tzid: localTz(), sequence, uid },
      );
    } catch {
      return announce({ ok: false, sent: false, reason: 'ics_failed', organizerEmail });
    }

    const p = getPuter();
    const subject = replySubject(status, title);
    const text = [`${attendeeName || attendeeEmail} ${STATUS_VERB[status]}`, '', title, ...(when ? [when] : [])].join('\n');

    let outcome = { ok: false, fallback: true, reason: 'unavailable' };
    if (p.email && typeof p.email.send === 'function') {
      outcome = await attemptSend(
        p,
        {
          to: organizerEmail,
          subject,
          text,
          attachments: [{
            filename: 'reply.ics',
            content: base64Bytes(new TextEncoder().encode(ics)),
            contentType: 'text/calendar; charset=utf-8; method=REPLY',
          }],
        },
        self.username,
      );
    }
    if (outcome.ok) return announce({ ok: true, sent: true, method: 'api', organizerEmail, data: outcome.body });
    if (!outcome.fallback) {
      return announce({ ok: false, sent: false, method: 'api', reason: outcome.reason, organizerEmail });
    }
    if (!p.workers || typeof p.workers.exec !== 'function') {
      return announce({ ok: false, sent: false, method: 'none', reason: outcome.reason, organizerEmail });
    }

    const version = digest([replyId, status, organizerEmail, title, when]);
    let fb;
    try {
      const res = await p.workers.exec(`${workerUrl}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: { id: replyId, title, when, organizerEmail, organizerName: organizer.name || '' },
          attendee: { email: attendeeEmail, name: attendeeName },
          partstat: status,
          ics,
          version,
        }),
      });
      const data = await res.json().catch(() => null);
      fb = res.ok && data && data.ok ? { ok: true, data } : { ok: false, reason: replyFailureMessage(res.status, data) };
    } catch {
      fb = { ok: false, reason: 'Could not send the reply. Please try again.' };
    }

    return fb.ok
      ? announce({ ok: true, sent: true, method: 'worker', organizerEmail, data: fb.data })
      : announce({ ok: false, sent: false, method: 'worker', reason: fb.reason, organizerEmail });
  }

  return { available, offerReply, sendReply, describeResult };
}

/* ---- The confirm dialog (mirrors invitation-dialog.js) -------------------- */

function openReplyDialog({ email, onConfirm }) {
  const dialog = el(
    'form',
    { class: 'modal rr-modal invite-ask', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mail-reply-title' },
    [
      el('div', { class: 'modal__head' }, [
        el('h2', { class: 'modal__title', id: 'mail-reply-title', text: 'Send your answer by email?' }),
      ]),
      el('div', { class: 'modal__body' }, [el('p', { text: `Email your answer to ${email}?` })]),
      el('div', { class: 'modal__foot' }, [
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', type: 'button', text: "Don't send", on: { click: () => close() } }),
        el('button', { class: 'btn btn--primary', type: 'submit', text: 'Send' }),
      ]),
    ],
  );

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    close();
    onConfirm();
  });

  const close = mountDialog(dialog);
  requestAnimationFrame(() => dialog.querySelector('.btn--primary').focus());
}
