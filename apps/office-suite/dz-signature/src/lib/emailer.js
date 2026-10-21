/**
 * Email delivery: the user's side of src/workers/email-worker.js.
 *
 * The sign worker mints each signer a personal capability link (signlinks.js),
 * and this module hands those links to the app's shared email worker, which
 * composes and sends one private message per signer. The call goes through
 * puter.workers.exec(), which forwards the signed-in user's Puter token: that
 * is what makes the worker able to send at all, and what makes the send bill
 * the sender rather than the app owner.
 *
 * Sending always takes an explicit user action (the send flow, a reminder
 * button, or the completion notice the user opted into when sending). What
 * each signer was last sent is remembered on the document record
 * (doc.emailed[signerId] = { at, v }), where `v` is a digest of exactly what
 * that signer saw. The worker keeps the same digest and refuses to re-send a
 * message it already sent, so a double press or a second device costs
 * nothing; its reply then heals this cache.
 */

import { normalizeEmail } from './util.js';
import { isSignerTurn } from './model.js';

/** The one shared, app-owned worker (see src/workers/email-worker.js). */
export const EMAIL_WORKER_URL = 'https://signatures-email.puter.work';

/**
 * A short, SYNCHRONOUS digest of what one signer is sent. Deliberately not
 * SHA-256: it runs while building DOM, and crypto.subtle is async. This is a
 * change detector, not a secret; the cost of the (vanishingly unlikely)
 * collision is one email that isn't re-sent, which Resend covers.
 */
export function digest(parts) {
  const text = JSON.stringify(parts);
  // 64-bit FNV-1a, carried in two 32-bit halves (JS bitwise ops are 32-bit).
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * What to tell the user about a send, for the toast. `quiet` is true when
 * nothing actually happened, so automatic paths can stay silent.
 */
export function describeResult(out) {
  const sent = (out && out.sent) || 0;
  const failed = (out && out.failed) || 0;
  const optedOut = (out && out.suppressed) || 0;
  if (failed) {
    return {
      icon: 'triangleAlert',
      message: sent
        ? `Sent ${sent}, but ${failed} could not be delivered.`
        : 'Those emails could not be delivered.',
      quiet: false,
    };
  }
  const limited = ((out && out.results) || [])
    .filter((r) => r.status === 'skipped' && r.reason === 'daily_limit').length;
  if (limited) {
    return {
      icon: 'triangleAlert',
      message: sent
        ? `Sent ${sent}, but the daily email limit stopped the rest. Try again tomorrow.`
        : 'You have reached the daily email limit. Try again tomorrow.',
      quiet: false,
    };
  }
  if (optedOut) {
    return {
      icon: 'info',
      message: sent
        ? `Sent ${sent}. ${optedOut} signer${optedOut === 1 ? ' has' : 's have'} opted out of these emails.`
        : `${optedOut === 1 ? 'That signer has' : 'Those signers have'} opted out of these emails.`,
      quiet: false,
    };
  }
  if (sent) {
    return {
      icon: 'mailCheck',
      message: sent === 1 ? 'Email sent' : `Emails sent to ${sent} signers`,
      quiet: false,
    };
  }
  return { icon: 'info', message: 'Everyone already has this email.', quiet: true };
}

export function failureMessage(status, data) {
  const code = (data && data.error) || '';
  if (status === 401 || code === 'sign_in_required') {
    return 'Sign in to Puter again to send emails.';
  }
  if (status === 429 || code === 'daily_limit') {
    return 'You have reached the daily email limit. Try again tomorrow.';
  }
  if (status === 404) return 'The email service is unavailable right now.';
  return 'Could not send the emails. Please try again.';
}

export function createEmailer({
  store,
  workerUrl = EMAIL_WORKER_URL,
  getPuter = () => (typeof puter !== 'undefined' ? puter : null),
  fetchFn = (...args) => fetch(...args),
}) {
  /** Sending needs the worker bridge (it carries the user's session); without
   *  it there is no authenticated caller and the worker would refuse anyway. */
  function available() {
    const p = getPuter();
    return Boolean(p && p.workers && typeof p.workers.exec === 'function');
  }

  function ownerName(doc) {
    return store.settings.fullName || store.user?.username || '';
  }

  /**
   * Who can be emailed about this document, and who still needs it.
   * A signer is emailable once their capability link exists; `current` means
   * the exact message they'd get now was already sent to them.
   *
   * Request and reminder mail is only ever planned for signers who still owe
   * a signature, and (with sequential signing on) only once their turn has
   * come: their link would answer `not_yet` anyway, and their request goes
   * out when the signer before them finishes. The completion notice goes to
   * everyone.
   */
  function planFor(doc, kind = 'request') {
    const out = [];
    for (const signer of doc.signers || []) {
      if (signer.isMe) continue;
      if (kind !== 'completed') {
        // Never ask someone who already answered to sign again, and never
        // ask ahead of their turn.
        if (signer.status === 'signed' || signer.status === 'declined') continue;
        if (!isSignerTurn(doc, signer.id)) continue;
      }
      const email = normalizeEmail(signer.email);
      const signUrl = (doc.links || {})[signer.id] || '';
      if (!email || !signUrl) continue;
      // The code itself is never in the mail, only the fact that one is
      // needed - which is part of what this signer sees, so it is part of the
      // version too.
      const codeRequired = signer.hasCode === true;
      const version = digest([
        doc.title, doc.note || '', ownerName(doc), signUrl, kind, codeRequired, doc.expiresAt || 0,
      ]);
      const record = (doc.emailed || {})[`${signer.id}:${kind}`] || null;
      out.push({
        signerId: signer.id,
        email,
        name: signer.name || '',
        signUrl,
        codeRequired,
        version,
        sentAt: record ? record.at || 0 : 0,
        current: Boolean(record && record.v === version),
      });
    }
    return out;
  }

  /**
   * Email this document to `signerIds` (default: everyone not current for
   * this kind, or every eligible signer when forced). Resolves to the worker's summary; rejects with a message fit
   * for a toast.
   */
  async function send(doc, { signerIds = null, kind = 'request', note = '', force = false } = {}) {
    if (!available()) throw new Error('Sending email needs the Puter SDK.');
    const plan = planFor(doc, kind);
    const wanted = signerIds ? new Set(signerIds) : null;
    const recipients = (wanted
      ? plan.filter((r) => wanted.has(r.signerId))
      : plan.filter((r) => force || !r.current)
    ).map((r) => ({
      email: r.email, name: r.name, signUrl: r.signUrl, version: r.version, codeRequired: r.codeRequired,
    }));
    if (!recipients.length) return { ok: true, sent: 0, skipped: 0, failed: 0, results: [] };

    let res;
    try {
      res = await getPuter().workers.exec(`${workerUrl}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          doc: {
            id: doc.id,
            title: doc.title,
            ownerName: ownerName(doc),
            ownerEmail: store.user?.email || '',
            pageCount: doc.pageCount,
            // Stated in the mail: a request with a deadline should say so, in
            // the sender's own clock AT the deadline (a clock change between
            // now and then would otherwise put it an hour out).
            expiresAt: doc.expiresAt || 0,
            tzOffset: doc.expiresAt ? -new Date(doc.expiresAt).getTimezoneOffset() : null,
          },
          recipients,
          kind,
          note: note || doc.note || '',
          force,
        }),
      });
    } catch {
      // Callers toast err.message; a raw transport error is not for users.
      throw new Error('Could not reach the email service. Check your connection and try again.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw new Error(failureMessage(res.status, data));

    // Merge in what actually went out. A skip for 'already_sent' is the
    // worker telling us it had already sent that exact message (from another
    // device, or an earlier press whose reply we lost): record it, or this
    // device would keep offering to send it forever. Any other skip (e.g.
    // the daily limit) means the signer NEVER got the message, so it must
    // stay pending for the next attempt.
    const emailed = { ...(doc.emailed || {}) };
    for (const result of data.results || []) {
      const delivered = result.status === 'sent'
        || (result.status === 'skipped' && result.reason === 'already_sent');
      if (!delivered) continue;
      const match = plan.find((r) => r.email === result.email);
      if (!match) continue;
      emailed[`${match.signerId}:${kind}`] = { at: result.at || Date.now(), v: match.version };
    }
    await store.patchDoc(doc.id, { emailed });
    if (data.sent) {
      const target = store.getDoc(doc.id);
      if (target) {
        store.addAudit(target, kind === 'reminder' ? 'reminder_sent' : 'emailed',
          `${data.sent} signer${data.sent === 1 ? '' : 's'}`);
        await store.persistDoc(target);
      }
    }
    return data;
  }

  /**
   * What the deployed email worker can compose. The owner update is a newer
   * kind: an older deployment would fall back to composing a signature
   * REQUEST, so the app asks before it sends one. Probed once per session.
   */
  let kindsPromise = null;
  function supportedKinds() {
    if (!kindsPromise) {
      kindsPromise = fetchFn(`${workerUrl}/health`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          // A worker that answers but lists nothing predates the `kinds`
          // field, so it can only compose the original three.
          if (!data) throw new Error('unreachable');
          return Array.isArray(data.kinds) ? data.kinds : ['request', 'reminder', 'completed'];
        })
        .catch(() => {
          // Never remember a failed probe: one offline moment would otherwise
          // disable owner updates for the rest of the session.
          kindsPromise = null;
          return null;
        });
    }
    return kindsPromise;
  }

  /**
   * Tell the OWNER what happened on their own document. The sign worker does
   * this itself when the platform lets it mail its own account; this is the
   * fallback for when it cannot, so nothing is silently lost.
   *
   * `events`: [{ type: 'signed' | 'declined' | 'completed', who, at }]
   */
  async function notifyOwner(doc, events) {
    const email = normalizeEmail(store.user?.email);
    if (!available() || !email || !events || !events.length) {
      return { ok: true, sent: 0, skipped: 0, failed: 0, results: [] };
    }
    const kinds = await supportedKinds();
    if (!kinds || !kinds.includes('owner')) {
      return { ok: true, sent: 0, skipped: 0, failed: 0, unsupported: true, results: [] };
    }
    const version = digest([doc.id, events.map((e) => `${e.type}:${e.who}:${e.at}`), 'owner']);
    let res;
    try {
      res = await getPuter().workers.exec(`${workerUrl}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          doc: {
            id: doc.id,
            title: doc.title,
            ownerName: ownerName(doc),
            ownerEmail: email,
            pageCount: doc.pageCount,
          },
          recipients: [{ email, version }],
          events,
          kind: 'owner',
        }),
      });
    } catch {
      throw new Error('Could not reach the email service. Check your connection and try again.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw new Error(failureMessage(res.status, data));
    return data;
  }

  return { available, planFor, send, notifyOwner, supportedKinds };
}
