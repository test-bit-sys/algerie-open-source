/**
 * Email delivery: the app's one shared, app-owned Puter worker (deployed to
 * https://signatures-email.puter.work; see src/lib/emailer.js for the
 * calling side).
 *
 * Unlike the sign worker (one per user, deployed into their own account) this
 * one is deployed ONCE, by the app owner: outbound mail has to be authorized
 * by a worker's own token, so the sending capability lives somewhere the app
 * controls. The cost does not: the app calls this worker with
 * puter.workers.exec(), which forwards the signed-in user's Puter token, and
 * each message is sent with that token in hand, so every send is billed to,
 * and rate-limited as, the user who asked for it, never the app owner.
 *
 *   POST /send      send one document's emails (one private mail per signer)
 *   GET  /health    liveness + deployed version (no auth)
 *   GET  /whoami    what the worker can see of your session (names only),
 *                   the deployment self-test for "why am I getting a 401"
 *
 * An app-owned relay that forwarded whatever it was handed would be a spam
 * cannon wearing the app's sending reputation, so it never does:
 *   - no Puter session, no send. `user` is only populated for callers that
 *     come through puter.workers.exec(); everyone else gets 401.
 *   - the caller supplies a DOCUMENT, not an email. Subject and body are
 *     composed here, so every message this worker can be made to send is a
 *     signature request (or reminder, or completion notice) for that
 *     document, addressed to its signers.
 *   - kind 'owner' tells the SENDER what happened on their own document
 *     (a signature, a decline, a completion). It is addressed to the caller's
 *     own account address whenever the platform will tell us what that is,
 *     carries no link at all, and exists as the fallback for when the user's
 *     sign worker cannot mail its own owner.
 *   - the only clickable destination is the signer's own capability URL
 *     (https://<worker>.puter.work/sign/<40 hex>, minted by that user's sign
 *     worker). Sender-supplied text is escaped and never linkified.
 *   - recipients are capped per request (MAX_RECIPIENTS) and per user per day
 *     (DAILY_LIMIT), and a message a signer already received is skipped
 *     rather than re-sent (see the `version` digest below).
 *
 * KV here belongs to the APP OWNER, not to the app user, so it holds nothing
 * personal: keys are SHA-256 hashes of (user, doc, signer) triples and values
 * are a version digest plus a timestamp.
 *
 *   mail:sent:<sha256(callerId|docId|email)>  -> { v, at }  (expires: SENT_TTL)
 *   mail:rate:<sha256(callerId)>:<YYYY-MM-DD> -> count      (expires: RATE_TTL)
 *
 * Deploy with:  npm run deploy:email-worker
 */

const WORKER_VERSION = '3';

const SENT_PREFIX = 'mail:sent:';
const RATE_PREFIX = 'mail:rate:';
const SENT_TTL = 365 * 24 * 60 * 60; // seconds; long enough to outlive a document
const RATE_TTL = 2 * 24 * 60 * 60; // seconds; yesterday's counter is dead weight

const MAX_RECIPIENTS = 20; // per request
const DAILY_LIMIT = 100; // per user per UTC day
const KINDS = ['request', 'reminder', 'completed', 'owner'];

/* ---- Small utilities ---------------------------------------------------- */

/** The worker owner's context (the `me` global; ctx.me in tests). */
function ownerOf(ctx) {
  return (ctx && ctx.me) || (typeof me !== 'undefined' ? me : null);
}

/** The signed-in caller. The runtime has called this both `user` and
 *  `requestor`; take whichever one arrived. */
function callerOf(ctx) {
  return (ctx && (ctx.user || ctx.requestor)) || null;
}

/**
 * A stable id for the caller: it keys the already-sent and daily-cap records,
 * so it has to be the same tomorrow as it is today, and different for every
 * user. The live platform has handed over callers whose documented `uuid` was
 * absent, so try the known names, then the ones nested under their Puter
 * handle, then getUser(). '' means "could not tell", which is refused rather
 * than guessed at: a shared id would let one user's dedupe record suppress
 * another's mail.
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
    return '';
  }
}

/**
 * The caller's own email address, for kind 'owner'. Asking the platform beats
 * trusting the request: a notice about your own document should only ever
 * reach you.
 */
async function callerEmailOf(caller) {
  const p = caller && caller.puter;
  const direct = caller && (caller.email || (p && p.email && typeof p.email === 'string' ? p.email : ''));
  if (typeof direct === 'string' && lowerEmail(direct)) return lowerEmail(direct);
  try {
    const who = p && p.auth && typeof p.auth.getUser === 'function' ? await p.auth.getUser() : null;
    return lowerEmail(who && who.email);
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
 *  a subject is how header injection starts. */
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

/** Escaped, with the line breaks the sender typed preserved. */
function escapeBlock(v) {
  return escapeHtml(v).replace(/\r?\n/g, '<br>');
}

/* ---- Request validation --------------------------------------------------- */

/**
 * A signer's link, or '': the ONLY link this worker will put in a mail. It
 * must be a capability URL on the Puter workers domain: https, a *.puter.work
 * host, and the exact /sign/<40 hex> path the sign worker mints. Query and
 * fragment are dropped rather than trusted.
 */
function signUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return '';
  let url = null;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  if (!/^[a-z0-9-]+\.puter\.work$/i.test(url.hostname)) return '';
  if (!/^\/sign\/[0-9a-f]{40}$/.test(url.pathname)) return '';
  return `https://${url.hostname.toLowerCase()}${url.pathname}`;
}

/** The send request, normalized, or { error } for a 400. */
function readRequest(body) {
  const src = body && typeof body === 'object' ? body : {};
  const doc = src.doc && typeof src.doc === 'object' ? src.doc : {};
  if (typeof doc.id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(doc.id)) {
    return { error: 'doc_id_required' };
  }
  const kind = KINDS.includes(src.kind) ? src.kind : 'request';

  const recipients = [];
  const seen = new Set();
  for (const r of Array.isArray(src.recipients) ? src.recipients : []) {
    const email = lowerEmail(r && r.email);
    if (!email || seen.has(email)) continue;
    // A digest of everything THIS signer sees: the document's details and
    // their own link. Opaque here: the worker only ever compares it to the
    // one it last sent to the same signer.
    const version = /^[0-9a-f]{8,64}$/.test(String((r && r.version) || '')) ? String(r.version) : '';
    if (!version) return { error: 'version_required' };
    seen.add(email);
    recipients.push({
      email,
      version,
      name: line(r && r.name, 200),
      signUrl: signUrl(r && r.signUrl),
      // The sender shares the code out of band; this mail only ever says one
      // is needed.
      codeRequired: r && r.codeRequired === true,
    });
    if (recipients.length >= MAX_RECIPIENTS) break;
  }
  if (!recipients.length) return { error: 'recipients_required' };

  const events = [];
  for (const e of Array.isArray(src.events) ? src.events.slice(0, 20) : []) {
    const type = ['signed', 'declined', 'completed'].includes(e && e.type) ? e.type : '';
    if (!type) continue;
    events.push({ type, who: line(e && e.who, 200), at: Number.isFinite(e && e.at) ? e.at : 0 });
  }
  if (kind === 'owner' && !events.length) return { error: 'events_required' };

  return {
    kind,
    recipients,
    events,
    force: src.force === true,
    doc: {
      id: doc.id,
      title: line(doc.title, 300) || '(Untitled document)',
      ownerName: line(doc.ownerName, 200),
      ownerEmail: lowerEmail(doc.ownerEmail),
      pageCount: Number.isInteger(doc.pageCount) && doc.pageCount > 0 ? doc.pageCount : 0,
      expiresAt: Number.isFinite(doc.expiresAt) && doc.expiresAt > 0 ? Math.round(doc.expiresAt) : 0,
      // The sender's clock at the deadline, minutes east of UTC, so the mail
      // can state the deadline as the sender set it. Anything outside the
      // real range is not a clock.
      tzOffset: Number.isFinite(doc.tzOffset) && Math.abs(doc.tzOffset) <= 840 ? Math.round(doc.tzOffset) : null,
    },
    note: text(src.note, 2000),
  };
}

/* ---- The message ---------------------------------------------------------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** "4 September 2026 (UTC)": no locale to lean on inside a worker. */
function utcDate(ts) {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} (UTC)`;
}

/**
 * The deadline as the sender set it: "12 September 2026, 11:59 PM
 * (UTC-07:00)" in the sender's own clock when the app says what that is,
 * and the UTC date alone when it does not. A deadline is the end of a day in
 * the sender's time, which for everyone west of Greenwich is the NEXT day in
 * UTC: the mail told a signer in the sender's own city they had until the
 * 13th, and the link died at midnight on the 12th.
 */
function deadlineText(ts, tzOffset) {
  if (!Number.isFinite(tzOffset)) return utcDate(ts);
  const d = new Date(ts + tzOffset * 60_000);
  const hours = d.getUTCHours();
  const clock = `${hours % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
  const abs = Math.abs(tzOffset);
  const zone = `UTC${tzOffset < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${clock} (${zone})`;
}

function senderName(doc) {
  return doc.ownerName || doc.ownerEmail || 'Someone';
}

function subjectFor(req) {
  const title = req.doc.title;
  if (req.kind === 'reminder') return line(`Reminder: "${title}" is waiting for your signature`, 250);
  if (req.kind === 'completed') return line(`Completed: "${title}" has been signed by all parties`, 250);
  if (req.kind === 'owner') {
    const done = req.events.some((e) => e.type === 'completed');
    const declined = req.events.some((e) => e.type === 'declined');
    if (done) return line(`Completed: "${title}" has been signed by everyone`, 250);
    if (declined) return line(`Declined: someone will not sign "${title}"`, 250);
    return line(`Signed: activity on "${title}"`, 250);
  }
  return line(`${senderName(req.doc)} sent you "${title}" to sign`, 250);
}

/** One line per event, in the order the app observed them. */
function ownerLines(req) {
  return req.events.map((e) => {
    if (e.type === 'completed') return 'Everyone has signed. The completed copy is ready.';
    if (e.type === 'declined') return `${e.who || 'A signer'} declined to sign, which closes signing for everyone.`;
    return `${e.who || 'A signer'} signed.`;
  });
}

function introFor(req) {
  if (req.kind === 'owner') return `Activity on your document "${req.doc.title}".`;
  if (req.kind === 'reminder') {
    return `${senderName(req.doc)} is waiting for your signature on this document.`;
  }
  if (req.kind === 'completed') {
    return 'Everyone has signed this document. You can view and download the completed copy.';
  }
  return `${senderName(req.doc)} sent you a document to review and sign.`;
}

function ctaFor(req) {
  return req.kind === 'completed' ? 'View completed document' : 'Review and sign';
}

function plainBody(req, signer) {
  if (req.kind === 'owner') {
    return [introFor(req), '', ...ownerLines(req), '', 'Open Signatures to see the document.'].join('\n');
  }
  const out = [];
  if (signer.name) out.push(`Hi ${signer.name},`, '');
  out.push(introFor(req), '', req.doc.title);
  if (req.doc.pageCount) out.push(`${req.doc.pageCount} page${req.doc.pageCount === 1 ? '' : 's'}`);
  if (req.doc.ownerEmail) {
    out.push(`From: ${req.doc.ownerName ? `${req.doc.ownerName} <${req.doc.ownerEmail}>` : req.doc.ownerEmail}`);
  }
  if (req.note) out.push('', req.note);
  if (req.doc.expiresAt) {
    out.push('', `Please sign by ${deadlineText(req.doc.expiresAt, req.doc.tzOffset)}. After that the link stops working.`);
  }
  if (signer.codeRequired) {
    out.push('', 'This document is protected by an access code. Use the code the sender gave you separately.');
  }
  if (signer.signUrl) out.push('', `${ctaFor(req)}: ${signer.signUrl}`);
  out.push('', 'This link is personal to you. Please do not forward this email.');
  return out.join('\n');
}

/**
 * The HTML half. Deliberately plain: everything styled inline (mail clients
 * drop <style> blocks), no images and no web fonts, so it degrades to
 * something readable everywhere and loads nothing from the network.
 */
function htmlBody(req, signer) {
  if (req.kind === 'owner') {
    // No link and no sender-supplied text beyond the title: this message
    // exists to tell you to go and look.
    return `<div style="background:#f6f7f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`
      + `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">`
      + `<h1 style="margin:0 0 16px;color:#111827;font-size:18px;line-height:1.3">${escapeHtml(req.doc.title)}</h1>`
      + ownerLines(req).map((l) => `<p style="margin:0 0 10px;color:#111827;font-size:14px">${escapeHtml(l)}</p>`).join('')
      + `<p style="margin:18px 0 0;font-size:13px;color:#6b7280">Open Signatures to see the document.</p>`
      + `</div></div>`;
  }
  const rows = [];
  const row = (label, value) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;vertical-align:top">${label}</td>` +
    `<td style="padding:4px 0;color:#111827;font-size:14px">${value}</td></tr>`;
  if (req.doc.pageCount) rows.push(row('Pages', String(req.doc.pageCount)));
  if (req.doc.ownerEmail || req.doc.ownerName) {
    rows.push(row('From', escapeHtml(req.doc.ownerName || req.doc.ownerEmail)));
  }

  const action = signer.signUrl
    ? `<div style="margin:24px 0 8px"><a href="${escapeHtml(signer.signUrl)}" ` +
      `style="display:inline-block;padding:12px 24px;border-radius:8px;background:#4f46e5;color:#ffffff;` +
      `font-size:15px;font-weight:600;text-decoration:none">${ctaFor(req)}</a></div>` +
      `<p style="margin:12px 0 0;font-size:13px;color:#6b7280">Or open this link: ` +
      `<a href="${escapeHtml(signer.signUrl)}" style="color:#4f46e5">${escapeHtml(signer.signUrl)}</a></p>`
    : '';

  return (
    `<div style="background:#f6f7f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">` +
    (signer.name ? `<p style="margin:0 0 12px;color:#111827;font-size:14px">Hi ${escapeHtml(signer.name)},</p>` : '') +
    `<p style="margin:0 0 16px;color:#6b7280;font-size:14px">${escapeHtml(introFor(req))}</p>` +
    `<h1 style="margin:0 0 16px;color:#111827;font-size:20px;line-height:1.3">${escapeHtml(req.doc.title)}</h1>` +
    (rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.join('')}</table>` : '') +
    (req.note ? `<p style="margin:16px 0 0;color:#111827;font-size:14px;white-space:pre-wrap">${escapeBlock(req.note)}</p>` : '') +
    (req.doc.expiresAt
      ? `<p style="margin:16px 0 0;color:#111827;font-size:14px"><b>Please sign by ${escapeHtml(deadlineText(req.doc.expiresAt, req.doc.tzOffset))}.</b>`
        + ` After that the link stops working.</p>`
      : '') +
    (signer.codeRequired
      ? `<p style="margin:16px 0 0;padding:10px 12px;border-radius:8px;background:#f3f4f6;color:#374151;font-size:13px">`
        + `This document is protected by an access code. Use the code the sender gave you separately.</p>`
      : '') +
    action +
    `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">This link is personal to you. Please do not forward this email.</p>` +
    `</div></div>`
  );
}

/* ---- Sending -------------------------------------------------------------- */

/**
 * A send has two halves, who pays (the app user) and what authorizes it (this
 * worker), and the platform accepts them in either arrangement:
 *
 *   me.puter.email.send({ ..., requesterToken: user.puter.authToken })
 *   user.puter.email.send({ ..., emailAccessToken: me.puter.authToken })
 *
 * Both bill the app user; which name a given runtime knows has moved, so try
 * the first, fall back to the second, and remember which one answered. The
 * fallback is gated on the error looking like a rejected REQUEST rather than
 * a rejected DELIVERY: retrying a message the transport already accepted
 * would double-send it.
 */
let preferredForm = 0;

const DELIVERY_ERROR = /deliver|recipient|suppress|unsubscrib|mailbox|smtp|bounce|spam|quota|rate|limit/i;
const REQUEST_ERROR = /token|auth|unauthor|forbidden|permission|denied|unknown|unrecognized|unsupported|invalid|missing|required|not a function|undefined/i;

function sendForms(ctx) {
  const owner = ownerOf(ctx);
  const caller = callerOf(ctx);
  return [
    (message) =>
      owner.puter.email.send({ ...message, requesterToken: caller.puter.authToken }),
    (message) =>
      caller.puter.email.send({ ...message, emailAccessToken: owner.puter.authToken }),
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

function sentKey(uuid, docId, email) {
  return sha256Hex(`${uuid}|${docId}|${email}`).then((hash) => SENT_PREFIX + hash);
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

async function bumpQuota(kv, key, n) {
  if (!n) return;
  try {
    if (typeof kv.incr === 'function') await kv.incr(key, n);
    else await kv.set(key, (await quotaUsed(kv, key)) + n);
    await expire(kv, key, RATE_TTL);
  } catch {
    /* the cap is a guard rail, not a ledger; never fail a send over it */
  }
}

/* ---- Routes ---------------------------------------------------------------- */

router.get('/health', async () => json({ ok: true, version: WORKER_VERSION, kinds: KINDS }));

/**
 * What this worker can see of the caller: NAMES and presence only, never a
 * value, a token, or an address. Answering to the caller about their own
 * session leaks nothing they don't already have.
 */
router.get('/whoami', async (ctx) => {
  const caller = callerOf(ctx);
  const p = caller && caller.puter;
  return json({
    ok: true,
    version: WORKER_VERSION,
    sawAuthHeader: Boolean(ctx.request.headers.get('puter-auth')),
    boundAs: ctx.user ? 'user' : ctx.requestor ? 'requestor' : null,
    callerKeys: caller ? Object.keys(caller).sort() : [],
    has: {
      puter: Boolean(p),
      authToken: Boolean(p && p.authToken),
      email: Boolean(p && p.email && typeof p.email.send === 'function'),
      auth: Boolean(p && p.auth && typeof p.auth.getUser === 'function'),
    },
    identified: Boolean(await callerIdOf(caller)),
    owner: {
      email: Boolean(ownerOf(ctx) && ownerOf(ctx).puter && ownerOf(ctx).puter.email),
      authToken: Boolean(ownerOf(ctx) && ownerOf(ctx).puter && ownerOf(ctx).puter.authToken),
    },
  });
});

router.post('/send', async (ctx) => {
  // A caller context exists only for requests that came through
  // puter.workers.exec(), which forwards their Puter session. No session, no
  // send, and no way to bill anyone for one either.
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
  const req = readRequest(body);
  if (req.error) return json({ error: req.error }, 400);

  const kv = kvOf(ctx);
  const rateKey = await quotaKey(callerId);
  const used = await quotaUsed(kv, rateKey);
  let budget = Math.max(0, DAILY_LIMIT - used);
  if (!budget) return json({ error: 'daily_limit', limit: DAILY_LIMIT }, 429);

  const subject = subjectFor(req);
  const replyTo = req.doc.ownerEmail || undefined;
  const results = [];
  let sent = 0;

  // An owner update is about the caller's own document and goes to the
  // caller's own address: ask the platform who they are, and only fall back
  // to the address in the request when it will not say.
  let audience = req.recipients;
  if (req.kind === 'owner') {
    const own = await callerEmailOf(caller);
    audience = [{ ...req.recipients[0], email: own || req.recipients[0].email, name: '', signUrl: '' }];
  }

  for (const signer of audience) {
    const key = await sentKey(callerId, `${req.doc.id}:${req.kind}`, signer.email);
    // Same message, same signer, nothing changed: don't spend the user's
    // money on a duplicate. `force` covers a deliberate resend/reminder.
    if (!req.force) {
      const previous = coerce(await kv.get(key));
      if (previous && previous.v === signer.version) {
        results.push({ email: signer.email, status: 'skipped', reason: 'already_sent', at: previous.at || 0 });
        continue;
      }
    }
    if (!budget) {
      results.push({ email: signer.email, status: 'skipped', reason: 'daily_limit' });
      continue;
    }

    try {
      const out = (await sendMail(ctx, {
        to: signer.email,
        subject,
        text: plainBody(req, signer),
        html: htmlBody(req, signer),
        replyTo,
      })) || {};
      // One recipient per send, so these arrays name this signer or nobody.
      if ((out.suppressed || []).includes(signer.email)) {
        results.push({ email: signer.email, status: 'suppressed' });
        continue;
      }
      if ((out.failed || []).includes(signer.email)) {
        results.push({ email: signer.email, status: 'failed', reason: 'delivery_failed' });
        continue;
      }
      budget -= 1;
      sent += 1;
      const at = Date.now();
      await kv.set(key, { v: signer.version, at });
      await expire(kv, key, SENT_TTL);
      results.push({ email: signer.email, status: 'sent', at });
    } catch (err) {
      results.push({
        email: signer.email,
        status: 'failed',
        reason: line((err && err.message) || 'send_failed', 200),
      });
    }
  }

  await bumpQuota(kv, rateKey, sent);

  return json({
    ok: true,
    version: WORKER_VERSION,
    sent,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    // Counted apart from failures: a suppressed signer unsubscribed from this
    // sender's mail, which is a decision to report, not a fault to retry.
    suppressed: results.filter((r) => r.status === 'suppressed').length,
    results,
  });
});
