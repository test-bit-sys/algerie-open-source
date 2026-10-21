/**
 * Email invitations — the host's side of src/workers/email-worker.js.
 *
 * The RSVP worker mints each guest a personal answer link (rsvp-links.js), but
 * getting that link to the guest was manual: copy the block, paste it into a
 * mail client. This module hands the same links to the calendar's shared email
 * worker at EMAIL_WORKER_URL, which composes and sends one private invitation
 * per guest. The call goes through puter.workers.exec(), which forwards the
 * signed-in user's Puter token — that is what makes the worker able to send at
 * all, and what makes the send bill the host rather than the app owner.
 *
 * Sending always takes a yes. Saving an event with guests asks whether to mail
 * them, and on a yes the send waits here until the RSVP worker has minted every
 * guest a link (a second or two after the save) — the host is long done with
 * the editor by then, so the answer has to be collected while they are still
 * looking at it. The details card's button covers everything after that: a
 * guest added later, an event that moved, a plain resend.
 *
 * What never happens is mail going out on a debounce. No store subscription
 * reaches this module; every message it sends is one a person was asked about.
 *
 * Every message names its host. The .ics ORGANIZER is what the guest's
 * calendar shows as the organizer (Google Calendar files one without it under
 * "unknownorganizer@calendar.google.com"), Reply-To is where their mail
 * client's own RSVP buttons answer, and the body says who invited them. Puter
 * withholds the account's email until the user grants it, so an event saved
 * while that was unknown carries no organizer (modal.js saves rather than lose
 * the edit); a send resolves the address then — silently when the grant has
 * landed since boot, with Puter's prompt on an explicit press — and an
 * invitation that still cannot name its host is not sent.
 *
 * What each guest was last sent is remembered in the app's own KV
 * (`cal:invite:<eventId>` -> { [email]: { at, v } }), where `v` is a digest of
 * exactly what that guest saw — details plus their own link. It answers the
 * only two questions the UI asks: who has never been invited, and whose
 * invitation is now out of date. The worker keeps the same digest and refuses
 * to re-send a message it already sent, so a double press, a second device, or
 * a stale cache costs nothing; its reply then heals this cache.
 *
 * Deleting an invited event is the one message that can't be composed from the
 * store — by send time the event is gone, and the next rsvp-links pass revokes
 * its guests' links. So cancellation is two steps: `cancellationFor` snapshots
 * everything the mail needs (taken BEFORE the delete; its recipients are the
 * sent log itself, because a guest removed from the list after being emailed
 * still believes the event is on), and `sendCancellation` posts it to the
 * worker's /cancellations route once the host says yes (cancellation-dialog.js
 * asks — same rule as ever: no mail without a yes).
 */
import { toICS } from './ics.js';
import { getUser, requestUserEmail } from './auth.js';
import { describeRecurrence, materializeOccurrence, isScheduledOccurrence, countScheduledBefore, normalizeRecurrence } from './recurrence.js';
import { isBlocked } from './offline.js';
import { toast as defaultToast } from './toast.js';
import {
  formatFullDate,
  formatDateRange,
  formatTime,
  formatTimeRange,
  isSameDay,
  tzAbbreviation,
} from './date-utils.js';

/** The one shared, app-owned worker (see src/workers/email-worker.js). */
export const EMAIL_WORKER_URL = 'https://calendar-email.puter.work';

const SENT_PREFIX = 'cal:invite:';

/** Why an invitation stays unsent when nobody can be named as its host. */
export const NO_HOST_EMAIL =
  'Invitations need your email address so guests can see who invited them. Allow Calendar to read it, then send again.';

/** A stored or reported address, or '' for anything that isn't one. */
function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

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

/**
 * A short, SYNCHRONOUS digest of what one guest was sent. Deliberately not
 * SHA-256: the details card computes it for every guest while building its DOM,
 * and crypto.subtle is async. This is a change detector, not a secret — the
 * cost of the (vanishingly unlikely) collision is one invitation that isn't
 * re-sent, which the Resend action covers.
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

function localTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * The date line the guest reads. It mirrors the details card's own when-line
 * (modal.js viewWhen) with one addition: the organizer's time zone. The card is
 * read where the calendar is; this is read anywhere, and "3:00 PM" with no zone
 * is how people miss meetings.
 */
export function describeWhen(ev, { hour12 = true, tz = localTz() } = {}) {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  if (ev.allDay) {
    return isSameDay(start, end)
      ? `${formatFullDate(start)} · All day`
      : `${formatDateRange(start, end)} · All day`;
  }
  const zone = tzAbbreviation(tz, start);
  const suffix = zone ? ` (${zone})` : '';
  if (isSameDay(start, end)) {
    return `${formatFullDate(start)} · ${formatTimeRange(start, end, { hour12 })}${suffix}`;
  }
  return (
    `${formatFullDate(start)}, ${formatTime(start, { hour12 })} – ` +
    `${formatFullDate(end)}, ${formatTime(end, { hour12 })}${suffix}`
  );
}

/**
 * What to tell the host about a send, for the toast. Shared by the card's
 * button and the after-save send, which are the same event to the person
 * reading it and should never be worded two ways. `quiet` is true when nothing
 * actually happened — the automatic path stays silent for that rather than
 * reporting a non-event seconds after the editor closed.
 */
export function describeResult(out) {
  const sent = (out && out.sent) || 0;
  const failed = (out && out.failed) || 0;
  const optedOut = (out && out.suppressed) || 0;
  const capped = (out && out.capped) || 0;
  if (capped) {
    // The sender's daily email allowance ran out part-way through the batch.
    // Those guests were not mailed and are still offered; say so rather than
    // let "Everyone already has this invitation" stand in for it.
    return {
      variant: 'danger',
      message: sent
        ? `Sent ${sent}, but ${capped} could not be sent — today's email limit was reached.`
        : "Today's email limit was reached — try again tomorrow.",
      quiet: false,
    };
  }
  if (failed) {
    return {
      variant: 'danger',
      message: sent
        ? `Sent ${sent}, but ${failed} could not be delivered.`
        : 'Those invitations could not be delivered.',
      quiet: false,
    };
  }
  if (optedOut) {
    // Not a failure to retry: they unsubscribed from this sender's mail, and
    // no amount of pressing send will reach them.
    return {
      variant: 'default',
      message: sent
        ? `Sent ${sent}. ${optedOut} guest${optedOut === 1 ? ' has' : 's have'} opted out of these emails.`
        : `${optedOut === 1 ? 'That guest has' : 'Those guests have'} opted out of these emails.`,
      quiet: false,
    };
  }
  if (sent) {
    return {
      variant: 'success',
      message: sent === 1 ? 'Invitation sent' : `Invitations sent to ${sent} guests`,
      quiet: false,
    };
  }
  return { variant: 'default', message: 'Everyone already has this invitation.', quiet: true };
}

/** The cancellation counterpart of describeResult, for the same toasts. */
export function describeCancelResult(out) {
  const sent = (out && out.sent) || 0;
  const failed = (out && out.failed) || 0;
  const optedOut = (out && out.suppressed) || 0;
  const capped = (out && out.capped) || 0;
  if (capped) {
    return {
      variant: 'danger',
      message: sent
        ? `Sent ${sent}, but ${capped} could not be sent — today's email limit was reached.`
        : "Today's email limit was reached — the cancellation could not be sent.",
      quiet: false,
    };
  }
  if (failed) {
    return {
      variant: 'danger',
      message: sent
        ? `Sent ${sent}, but ${failed} could not be delivered.`
        : 'The cancellation emails could not be delivered.',
      quiet: false,
    };
  }
  if (optedOut) {
    return {
      variant: 'default',
      message: sent
        ? `Sent ${sent}. ${optedOut} guest${optedOut === 1 ? ' has' : 's have'} opted out of these emails.`
        : `${optedOut === 1 ? 'That guest has' : 'Those guests have'} opted out of these emails.`,
      quiet: false,
    };
  }
  if (sent) {
    return {
      variant: 'success',
      message: sent === 1 ? 'Cancellation sent' : `Cancellation emails sent: ${sent}`,
      quiet: false,
    };
  }
  // The worker already sent this exact cancellation (another device, or an
  // earlier press whose reply was lost) — the guests know.
  return { variant: 'default', message: 'Your guests have already been told.', quiet: true };
}

export function createInvites({
  kv,
  store,
  rsvp,
  user,
  workerUrl = EMAIL_WORKER_URL,
  getPuter = () => (typeof puter !== 'undefined' ? puter : null),
  blocked = isBlocked,
  toast = defaultToast,
  // Who "I" am when boot's `user` did not say (see hostEmail): a fresh
  // getUser() that costs no prompt, and the ask — Puter's permission prompt.
  requestUser = getUser,
  requestEmail = requestUserEmail,
  // How long to wait for the RSVP worker to mint the links a fresh event's
  // guests need. Generous on purpose: a first-ever save also has to deploy that
  // worker, and the platform takes 5–30s to bring one up.
  readyTimeoutMs = 120_000,
}) {
  // eventId -> { [email]: { at, v } }
  const sent = new Map();
  // Who "I" am, for events that carry no organizer of their own: one saved
  // before organizers were stamped, or while my address was unknown (Puter
  // withholds it until the user grants `email:read`, and modal.js saves on a
  // refusal rather than lose the edit). Boot's user object has the first word;
  // hostEmail() the last.
  let selfEmail = normalizeEmail(user && user.email);

  /**
   * My address, resolving it if boot did not know it. A grant that landed since
   * (another dialog asked, a second tab) shows up in a fresh getUser() with no
   * prompt; `prompt` additionally lets Puter ASK — only ever on an explicit
   * press, never on the automatic send after a save, which the editor just
   * asked for and may just have been refused. '' when there is still no
   * address to be had: an account without one, or a refusal.
   */
  async function hostEmail({ prompt = false } = {}) {
    if (selfEmail) return selfEmail;
    let email = '';
    try {
      if (prompt) email = normalizeEmail(await requestEmail());
      else {
        const fresh = await requestUser();
        email = normalizeEmail(fresh && fresh.email);
      }
    } catch {
      /* unresolved — the caller decides what an anonymous send is worth */
    }
    if (email) selfEmail = email;
    return selfEmail;
  }

  /** Sending needs the worker bridge (it carries the user's session); without
   *  it there is no authenticated caller and the worker would refuse anyway. */
  function available() {
    const p = getPuter();
    return Boolean(p && p.workers && typeof p.workers.exec === 'function');
  }

  /* ---- What each guest has (and hasn't) been sent ----------------------- */

  /** The event that owns the guest list — a series' guests live on its master. */
  function ownerEvent(item) {
    if (!item) return null;
    const id = item.seriesId || item.id;
    return store.getEvent(id) || (item.id === id ? item : null);
  }

  function detailsOf(ev) {
    return {
      title: ev.title || '',
      when: describeWhen(ev, { hour12: store.getSettings().hour12 !== false }),
      recurLabel: ev.recurrence ? describeRecurrence(ev.recurrence, ev.start) : '',
      location: ev.location || '',
      // Attaching (or swapping) a meeting link re-flags every guest as
      // pending, exactly like any other detail change — it's in the digest.
      meetingUrl: (ev.meeting && ev.meeting.url) || '',
      description: ev.description || '',
      organizerName: (ev.organizer && ev.organizer.name) || '',
      organizerEmail: (ev.organizer && ev.organizer.email) || selfEmail,
    };
  }

  /** Guest-visible exceptions, in a stable order. Colors and reminders are
   * local preferences; a no-op override must not prompt everyone for email.
   * No exceptions keeps the pre-existing digest, including on older records. */
  function exceptionsOf(ev) {
    if (!ev.recurrence) return null;
    const exdates = [...new Set((ev.exdates || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
    const excluded = new Set(exdates);
    const overrides = [];
    const plain = { ...ev, overrides: {} };
    for (const rid of Object.keys(ev.overrides || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b)) {
      if (excluded.has(rid)) continue;
      const actual = materializeOccurrence(ev, rid);
      const base = materializeOccurrence(plain, rid);
      if (!actual || !base) continue;
      const changes = ['title', 'description', 'location', 'start', 'end', 'allDay']
        .filter((key) => actual[key] !== base[key])
        .map((key) => [key, actual[key]]);
      if (changes.length) overrides.push([rid, changes]);
    }
    return exdates.length || overrides.length ? [exdates, overrides] : null;
  }

  /**
   * Who can be emailed about this event, and who still needs it.
   *
   * Synchronous on purpose: the details card calls it while building its rows.
   * A guest is `pending` when they have never been sent this event, or when
   * anything they were shown — details, or their own RSVP link — has changed
   * since. Guests whose link hasn't been minted yet are `waiting`: they are not
   * emailable, and the RSVP worker is usually seconds away from fixing that.
   */
  function planFor(item, { previouslyInvitedOnly = false } = {}) {
    const ev = ownerEvent(item);
    const empty = { eventId: '', ready: [], pending: [], waiting: 0, lastSentAt: 0 };
    if (!ev || !rsvp || !rsvp.isHosted(ev)) return empty;
    const links = rsvp.linksFor(ev.id) || {};
    const details = detailsOf(ev);
    const exceptions = exceptionsOf(ev);
    const log = sent.get(ev.id) || {};
    const ready = [];
    let waiting = 0;
    let lastSentAt = 0;
    for (const g of rsvp.linkableGuests(ev)) {
      if (previouslyInvitedOnly && !log[g.email]) continue;
      const rsvpUrl = links[g.email] || '';
      if (!rsvpUrl) {
        waiting += 1;
        continue;
      }
      const version = digest(exceptions ? [details, rsvpUrl, exceptions] : [details, rsvpUrl]);
      const record = log[g.email] || null;
      if (record && record.at > lastSentAt) lastSentAt = record.at;
      ready.push({
        email: g.email,
        name: g.name || '',
        rsvpUrl,
        version,
        sentAt: record ? record.at || 0 : 0,
        current: Boolean(record && record.v === version),
      });
    }
    return {
      eventId: ev.id,
      ready,
      pending: ready.filter((r) => !r.current),
      waiting,
      lastSentAt,
    };
  }

  /* ---- Sending ---------------------------------------------------------- */

  async function persist(eventId, log) {
    sent.set(eventId, log);
    await kv.set(SENT_PREFIX + eventId, log);
  }

  /**
   * Email this event's invitation to `emails` (default: everyone pending).
   * Resolves to the worker's summary; rejects with a message fit for a toast.
   * `prompt` lets an event without an organizer ask Puter for my address: an
   * explicit press may, the automatic send after a save must not (hostEmail).
   */
  async function send(item, { emails = null, note = '', force = false, prompt = true, canSend = () => true } = {}) {
    if (blocked()) throw new Error("You're offline — reconnect to send invitations.");
    if (!available()) throw new Error('Sending invitations needs the Puter SDK.');
    const ev = ownerEvent(item);
    if (!ev || !planFor(item).eventId) throw new Error('Only the organizer can send invitations.');

    // One send per event on the wire at a time. Two saves that both said
    // yes, or a press while an earlier one is still in flight, would
    // otherwise reach the worker together — and puter.kv has no transactions,
    // so its already-sent check for the second can run before the first has
    // recorded anything, and the guest gets the mail twice. Queued behind the
    // earlier send, the later one re-reads the plan after that send has
    // persisted its log, and the worker sees requests in sequence: its record
    // answers the second one with "skipped", which is the quiet outcome.
    const previous = inFlight.get(ev.id) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => deliver(item, { emails, note, force, prompt, canSend }));
    inFlight.set(ev.id, run);
    run.catch(() => {}).finally(() => {
      if (inFlight.get(ev.id) === run) inFlight.delete(ev.id);
    });
    return run;
  }

  // eventId -> the send currently on the wire for it (see send()).
  const inFlight = new Map();

  async function deliver(item, { emails, note, force, prompt, canSend }) {
    if (!canSend()) return { ok: true, sent: 0, skipped: 0, failed: 0, results: [] };
    const ev = ownerEvent(item);
    if (!ev || !planFor(item).eventId) throw new Error('Only the organizer can send invitations.');
    // The mail speaks for its host — .ics ORGANIZER, Reply-To, "<host> invited
    // you" — and an event saved while my address was unknown carries none.
    // Resolve it before the plan is read (its digests include the address), or
    // refuse: an anonymous invitation files under an unknown organizer in the
    // guest's calendar and gives their RSVP buttons nobody to answer.
    if (!ev.organizer && !(await hostEmail({ prompt }))) throw new Error(NO_HOST_EMAIL);
    const plan = planFor(item);

    const wanted = emails ? new Set(emails) : null;
    const recipients = (wanted ? plan.ready.filter((r) => wanted.has(r.email)) : plan.pending).map(
      (r) => ({ email: r.email, name: r.name, rsvpUrl: r.rsvpUrl, version: r.version }),
    );
    if (!recipients.length) return { ok: true, sent: 0, skipped: 0, failed: 0, results: [] };

    // An .ics rides along so a guest can put the event in their own calendar.
    // METHOD:REQUEST — a real iTIP invitation. Mail clients draw their own
    // RSVP strip whenever ORGANIZER/ATTENDEE lines exist, and under PUBLISH
    // those buttons render dead, which guests read as broken. Under REQUEST
    // they work: the native answer is emailed to the organizer — a person's
    // real inbox, even though this app never reads it — while the links in
    // the body remain the path that updates this calendar automatically.
    // TZID pins the actual instant for guests in other zones (floating times
    // filed a 6:30 PM PDT event at 6:30 PM in the GUEST's zone), and
    // SEQUENCE — updatedAt as seconds since 2020, small enough for clients
    // that read it as a 32-bit int — lets a changed event supersede the copy
    // an earlier email installed.
    let ics = '';
    try {
      const icsEvent =
        ev.organizer || !selfEmail ? ev : { ...ev, organizer: { email: selfEmail } };
      ics = toICS([icsEvent], {
        method: 'REQUEST',
        tzid: localTz(),
        sequence: Math.max(0, (ev.updatedAt || 0) - 1577836800000) / 1000,
      });
    } catch {
      /* an invitation without its attachment is still an invitation */
    }

    const details = detailsOf(ev);
    // The kind is per guest, not per batch: someone who was sent this event
    // before is getting an update, and their subject line should say so — a
    // single batch-level kind labelled the whole send a fresh "Invitation:"
    // whenever one new guest rode along, and the guest whose only news was
    // the changed time read it as a duplicate of the mail they already had.
    const isUpdate = (r) => Boolean(plan.ready.find((x) => x.email === r.email).sentAt);
    const batches = [
      { kind: 'invite', recipients: recipients.filter((r) => !isUpdate(r)) },
      { kind: 'update', recipients: recipients.filter(isUpdate) },
    ].filter((b) => b.recipients.length);

    const summary = { ok: true, sent: 0, skipped: 0, failed: 0, suppressed: 0, capped: 0, results: [] };
    // Merge in what actually went out. A 'skipped' result is the worker telling
    // us it had already sent that exact invitation (from another device, or an
    // earlier press whose reply we lost) — record it, or this device would keep
    // offering to send it forever.
    const log = { ...(sent.get(ev.id) || {}) };
    let failure = null;
    for (const batch of batches) {
      const res = await getPuter().workers.exec(`${workerUrl}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: { id: ev.id, ...details },
          recipients: batch.recipients,
          kind: batch.kind,
          note,
          ics,
          force,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) {
        failure = new Error(failureMessage(res.status, data));
        break;
      }
      summary.sent += data.sent || 0;
      summary.skipped += data.skipped || 0;
      summary.failed += data.failed || 0;
      summary.suppressed += data.suppressed || 0;
      summary.results.push(...(data.results || []));
      for (const result of data.results || []) {
        // Only a mail that went out — or one the worker had already sent (a
        // second device, a lost reply) — is a delivery. A `skipped` for any
        // other reason means the guest was NOT mailed: the worker skips the
        // rest of a batch once the sender's daily cap runs out, and logging
        // those showed them as invited and never offered to send again.
        if (result.status === 'skipped' && result.reason !== 'already_sent') {
          summary.capped += 1;
          continue;
        }
        if (result.status !== 'sent' && result.status !== 'skipped') continue;
        const recipient = batch.recipients.find((r) => r.email === result.email);
        if (!recipient) continue;
        log[result.email] = { at: result.at || Date.now(), v: recipient.version };
      }
    }
    // Record what DID go out even when a later batch failed, or a retry after
    // the throw below would keep re-mailing guests who already have it.
    await persist(ev.id, log);
    if (failure) throw failure;
    return summary;
  }

  /* ---- Cancelling (the host deleted an invited event) --------------------- */

  /**
   * Everything a cancellation email will need, snapshotted while the event
   * still exists — call this BEFORE the delete, offer it to the host after
   * (cancellation-dialog.js). Null when there is nothing to cancel: nobody was
   * ever emailed an invitation, or there is no worker bridge to send through.
   *
   * The recipients are the sent log, not the guest list: the log records who
   * actually holds an invitation, including a guest the host removed from the
   * list afterwards — that person still believes the event is on. Names are
   * borrowed from the list where it still knows them.
   * Passing an occurrence snapshots just its original slot and current details;
   * the master still supplies the UID, organizer, and previously invited guests.
   * `future` cancels from this original slot onward; from the first scheduled
   * slot it cancels the whole series, matching store.deleteFuture.
   */
  function cancellationFor(item, { future = false } = {}) {
    if (!available()) return null;
    const ev = ownerEvent(item);
    if (!ev) return null;
    // From the first scheduled slot, a future delete removes the whole series.
    const wholeSeries = future && ev.recurrence && countScheduledBefore(
      normalizeRecurrence(ev.recurrence, ev.start), ev.start, item.recurrenceId,
    ) === 0;
    const recurrenceId = item.seriesId && !wholeSeries ? item.recurrenceId : null;
    const recurrenceRange = future && recurrenceId != null ? 'THISANDFUTURE' : '';
    const occurrence = recurrenceId != null && Number.isFinite(recurrenceId)
      ? materializeOccurrence(ev, recurrenceId) : null;
    if (item.seriesId && !wholeSeries && !occurrence) return null;
    const log = sent.get(ev.id) || {};
    const details = detailsOf(occurrence || ev);
    // One digest for the lot: unlike an invitation there is no per-guest link
    // in a cancellation, so what every guest sees is the same. It only has to
    // differ from every invitation digest (the 'cancel' marker) so the worker
    // neither skips it as "already sent" nor blocks a later re-invitation
    // should the host undo the delete and start over.
    const version = digest(recurrenceId == null ? ['cancel', details]
      : recurrenceRange ? ['cancel', recurrenceId, recurrenceRange, details] : ['cancel', recurrenceId, details]);
    const names = new Map((ev.guests || []).map((g) => [g.email, g.name || '']));
    const recipients = Object.keys(log).map((email) => ({
      email,
      name: names.get(email) || '',
      version,
    }));
    if (!recipients.length) return null;
    return { eventId: ev.id, event: { ...ev }, details, recipients, ...(occurrence ? { recurrenceId } : {}), ...(recurrenceRange ? { recurrenceRange } : {}) };
  }

  /** Compare the saved guest list with its pre-save master. Only people who
   * actually received an invitation and were removed by this save are due. */
  async function removedGuestsFor(before, after, { recurrenceId = null } = {}) {
    if (!available() || !before || !after || !rsvp || !rsvp.isHosted(before)) return null;
    // An invitation already on the wire may not have recorded its recipients
    // yet. Let it finish before deciding that a removed guest was never mailed.
    await (inFlight.get(before.id) || Promise.resolve()).catch(() => {});
    const kept = new Set((after.guests || []).map((g) => normalizeEmail(g.email)));
    const log = sent.get(before.id) || {};
    const removed = (before.guests || []).filter((g) =>
      !kept.has(normalizeEmail(g.email)) && log[normalizeEmail(g.email)] &&
      normalizeEmail(g.email) !== normalizeEmail(before.organizer?.email) &&
      normalizeEmail(g.email) !== selfEmail);
    if (!removed.length) return null;
    const future = before.id !== after.id && recurrenceId != null;
    const occurrence = future ? materializeOccurrence(before, recurrenceId) : null;
    if (future && !occurrence) return null;
    const details = detailsOf(occurrence || before);
    const version = digest(['removed-guests', before.id, future ? recurrenceId : null, details]);
    return {
      eventId: before.id, membershipEventId: after.id, removedGuests: true,
      event: { ...before, guests: removed.map((g) => ({ ...g })) }, details,
      recipients: removed.map((g) => ({ email: normalizeEmail(g.email), name: g.name || '', version })),
      ...(future ? { recurrenceId, recurrenceRange: 'THISANDFUTURE' } : {}),
    };
  }

  // Serialize cancellations with invitation updates for this same event, so
  // removing delivered guests from the log cannot race an update's log write.
  function sendCancellation(snapshot) {
    const id = snapshot && snapshot.eventId;
    const previous = inFlight.get(id) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => deliverCancellation(snapshot));
    inFlight.set(id, run);
    run.catch(() => {}).finally(() => {
      if (inFlight.get(id) === run) inFlight.delete(id);
    });
    return run;
  }

  /**
   * Email an event cancellation or a withdrawn invitation. Resolves to
   * the worker's summary; rejects with a message fit for a toast. Distinct
   * route on purpose: a worker deployment that predates cancellations answers
   * /cancellations with a 404 — an honest failure — where a `kind` it doesn't
   * know on /invites would have been coerced to 'invite' and mailed every
   * guest a fresh invitation to an event that no longer exists.
   */
  async function deliverCancellation(snapshot) {
    if (blocked()) throw new Error("You're offline — reconnect to send the cancellation.");
    if (!available()) throw new Error('Sending the cancellation needs the Puter SDK.');
    if (!snapshot || !snapshot.eventId || !(snapshot.recipients || []).length) {
      throw new Error('There is nobody to notify about this event.');
    }
    // Recheck after queued invitation sends: Undo may restore the tail while
    // this cancellation is waiting for its turn.
    if (!snapshot.removedGuests && snapshot.recurrenceRange &&
        isScheduledOccurrence(store.getEvent(snapshot.eventId), snapshot.recurrenceId)) {
      throw new Error('The event was restored — no cancellation was sent.');
    }
    if (snapshot.removedGuests) {
      const current = store.getEvent(snapshot.membershipEventId);
      if (!current) throw new Error('The event changed — no invitation cancellations were sent.');
      const kept = new Set((current.guests || []).map((g) => normalizeEmail(g.email)));
      const recipients = snapshot.recipients.filter((r) => !kept.has(r.email));
      if (!recipients.length) throw new Error('The guests were added back — no invitation cancellations were sent.');
      const emails = new Set(recipients.map((r) => r.email));
      snapshot = { ...snapshot, recipients,
        event: { ...snapshot.event, guests: snapshot.event.guests.filter((g) => emails.has(normalizeEmail(g.email))) } };
    }

    // Sent as whoever sent the invitation. An address that landed since boot
    // is picked up; nothing is asked for and nothing refused — this is the
    // guests' one chance to hear the event is off.
    const details = { ...snapshot.details };
    if (!details.organizerEmail) details.organizerEmail = await hostEmail();

    // METHOD:CANCEL + STATUS:CANCELLED is the iTIP retraction of the METHOD:
    // REQUEST the invitation carried: same UID, and a SEQUENCE above every one
    // an invitation ever used — those derive from updatedAt, which necessarily
    // precedes this deletion; +1 clears even a delete in the same second.
    let ics = '';
    try {
      const ev = snapshot.event;
      const icsEvent = ev.organizer || !selfEmail ? ev : { ...ev, organizer: { email: selfEmail } };
      ics = toICS([icsEvent], {
        method: 'CANCEL',
        // Withdrawing attendees must not declare the event itself cancelled
        // (RFC 5546 §3.2.5); ATTENDEE names only those being removed.
        status: snapshot.removedGuests ? '' : 'CANCELLED',
        tzid: localTz(),
        sequence: Math.floor(Math.max(0, Date.now() - 1577836800000) / 1000) + 1,
        recurrenceId: snapshot.recurrenceId,
        recurrenceRange: snapshot.recurrenceRange,
      });
    } catch {
      if (snapshot.removedGuests || snapshot.recurrenceId != null) throw new Error('Could not prepare the invitation cancellation.');
      /* a cancellation without its attachment is still a cancellation */
    }

    // The worker takes 50 recipients per request and silently drops the rest.
    // An invitation self-heals from that — whoever was dropped stays pending
    // for the next press — but this is the guests' one chance to hear, so a
    // list the log let grow past 50 goes out in batches. A refusal before
    // anything went out is reported outright; one in the middle is counted
    // against the guests it stranded rather than pretended away.
    const summary = { ok: true, sent: 0, skipped: 0, failed: 0, suppressed: 0, capped: 0, results: [] };
    const stranded = new Set(); // guests this run failed to tell
    for (let i = 0; i < snapshot.recipients.length; i += 50) {
      const res = await getPuter().workers.exec(`${workerUrl}/cancellations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: { id: snapshot.eventId, ...details },
          recipients: snapshot.recipients.slice(i, i + 50),
          kind: 'cancel',
          cancellationScope: snapshot.removedGuests ? 'guests' : 'event',
          note: snapshot.removedGuests
            ? snapshot.recurrenceRange
              ? 'Your invitation is cancelled from this occurrence onward. Earlier occurrences are unchanged.'
              : 'Your invitation has been withdrawn. The event remains scheduled for the other guests.'
            : snapshot.recurrenceRange
            ? 'This and all following occurrences are cancelled. Earlier occurrences are unchanged.'
            : snapshot.recurrenceId != null
            ? 'Only this occurrence is cancelled. The rest of the series is unchanged.' : '',
          ics,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) {
        if (i === 0) throw new Error(cancelFailureMessage(res.status, data));
        for (const r of snapshot.recipients.slice(i)) stranded.add(r.email);
        summary.failed += snapshot.recipients.length - i;
        break;
      }
      summary.sent += data.sent || 0;
      summary.skipped += data.skipped || 0;
      summary.failed += data.failed || 0;
      summary.suppressed += data.suppressed || 0;
      summary.results.push(...(data.results || []));
      for (const result of data.results || []) {
        if (!result || !result.email) continue;
        // A guest the daily cap skipped was not told any more than one whose
        // mail failed: keep their entry so the retry still names them.
        const capped = result.status === 'skipped' && result.reason !== 'already_sent';
        if (capped) summary.capped += 1;
        if (result.status === 'failed' || capped) stranded.add(result.email);
      }
    }

    if (snapshot.removedGuests && !snapshot.recurrenceRange) {
      const log = { ...(sent.get(snapshot.eventId) || {}) };
      for (const result of summary.results) {
        if (result.status === 'sent' || result.status === 'suppressed' ||
            (result.status === 'skipped' && result.reason === 'already_sent')) delete log[result.email];
      }
      await persist(snapshot.eventId, log);
      return summary;
    }

    // The series is still live: every invited guest must remain reachable for
    // later occurrences and a whole-series cancellation, even after this send.
    if (snapshot.recurrenceId != null) return summary;

    if (stranded.size) {
      // Some guests were NOT told, and this log is the only record that could
      // still reach them: keep exactly their entries, so an undo + re-delete
      // (the one path back to cancellationFor) offers a retry that names them
      // — deleting it here would erase the last copy of who they are. The
      // toast already reports the honest count; start() prunes any leftovers
      // on the next boot.
      const log = sent.get(snapshot.eventId) || {};
      const kept = {};
      for (const [email, entry] of Object.entries(log)) {
        if (stranded.has(email)) kept[email] = entry;
      }
      await persist(snapshot.eventId, kept);
      return summary;
    }

    // The event is gone and its guests have been told: the record of who was
    // mailed the invitation has answered its last question. (start() would
    // prune it on the next boot anyway; this just doesn't wait.)
    sent.delete(snapshot.eventId);
    await kv.del(SENT_PREFIX + snapshot.eventId).catch(() => {});
    return summary;
  }

  function cancelFailureMessage(status, data) {
    const code = (data && data.error) || '';
    if (status === 401 || code === 'sign_in_required') {
      return 'Sign in to Puter again to send the cancellation.';
    }
    if (status === 429 || code === 'daily_limit') {
      return "You've reached today's email limit. Try again tomorrow.";
    }
    // The one shared worker is an older deployment that has no /cancellations
    // route yet. Nothing was sent — say so rather than pretend.
    if (status === 404 || code === 'invalid_ics') {
      return 'The email service needs an update before it can send cancellations.';
    }
    return 'Could not send the cancellation. Please try again.';
  }

  /* ---- Sending once the links exist -------------------------------------- */

  // eventId -> { timer, off }. One pending send per event: a second save
  // supersedes the first, rather than racing it to the same guests.
  const pending = new Map();

  function stopWaiting(eventId) {
    const wait = pending.get(eventId);
    if (!wait) return;
    clearTimeout(wait.timer);
    wait.off();
    pending.delete(eventId);
  }

  /**
   * Mail this event's invitation as soon as every guest has a link to put in
   * it. Called with the host's answer to "send invitations?" already in hand
   * (modal.js asks at save time) — this only handles the waiting, because a
   * newly saved event's links do not exist yet: the RSVP worker mints them a
   * beat later, and on a first-ever save it has to be deployed first.
   *
   * It waits for ALL of them rather than mailing whoever is ready: a partial
   * send would leave the rest needing a manual press the host has no reason to
   * expect. If the links never come, `readyTimeoutMs` sends to whoever has one
   * and says plainly who was left — silence there would be a promise quietly
   * broken. `canSend` rechecks a split after Undo, including while queued for
   * delivery. `previouslyInvitedOnly` updates its historical half without
   * inviting people who never received that series.
   */
  function sendWhenReady(item, { canSend = () => true, previouslyInvitedOnly = false } = {}) {
    const ev = ownerEvent(item);
    if (!ev || !available() || blocked() || !canSend()) return;
    const eventId = ev.id;
    stopWaiting(eventId);

    const attempt = (outOfTime) => {
      const plan = planFor({ id: eventId }, { previouslyInvitedOnly });
      // Deleted, or no longer an event with guests to write to.
      if (!plan.eventId || !canSend()) return void stopWaiting(eventId);
      if (plan.waiting && !outOfTime) return;
      stopWaiting(eventId);
      const emails = plan.pending.map((r) => r.email);
      if (outOfTime && plan.waiting) {
        toast(
          `Could not prepare RSVP links for ${plan.waiting} guest${plan.waiting === 1 ? '' : 's'} — invite them from the event.`,
          { variant: 'danger' },
        );
      }
      if (!emails.length) return;
      // The editor just asked for my address if this event needed one; a
      // refusal there must not be asked again seconds later. A grant that
      // landed since boot is still picked up (hostEmail).
      send({ id: eventId }, { emails, prompt: false, canSend })
        .then((out) => {
          const { message, variant, quiet } = describeResult(out);
          if (!quiet) toast(message, { variant });
        })
        .catch((err) => toast(err.message || 'Could not send the invitations.', { variant: 'danger' }));
    };

    const off = rsvp.onUpdate((changed) => {
      if (changed === eventId) attempt(false);
    });
    pending.set(eventId, { timer: setTimeout(() => attempt(true), readyTimeoutMs), off });
    attempt(false); // an event whose guests already have links needs no wait
  }

  function failureMessage(status, data) {
    const code = (data && data.error) || '';
    if (status === 401 || code === 'sign_in_required') {
      return 'Sign in to Puter again to send invitations.';
    }
    if (status === 429 || code === 'daily_limit') {
      return "You've reached today's invitation limit. Try again tomorrow.";
    }
    if (status === 404) return 'The invitation service is unavailable right now.';
    // The worker binds the mail's organizer to the signed-in account; a
    // mismatch means the session and this window disagree about who that is.
    if (status === 403 || code === 'organizer_mismatch') {
      return 'Sign in to Puter again — this invitation would not be sent from your account.';
    }
    // The worker read our own .ics and refused it: the deployed worker is
    // behind the app's ics.js (a new property it doesn't know yet). Retrying
    // won't change that; a redeploy will.
    if (code === 'invalid_ics') return 'The email service needs an update before it can send this event.';
    return 'Could not send the invitations. Please try again.';
  }

  /* ---- Lifecycle --------------------------------------------------------- */

  /**
   * Load what this account has already sent, and drop the records of events
   * that no longer exist. Deleting an event revokes its guests' links (see
   * rsvp-links.js); this is the same tidy-up for the log of who was mailed
   * them — nobody is ever going to ask about an event that isn't there, and
   * the keys would otherwise accumulate for the life of the account.
   */
  async function start() {
    try {
      const entries = (await kv.list(`${SENT_PREFIX}*`, true)) || [];
      // A store that never loaded (an offline boot) knows about no events at
      // all; reading that as "they were all deleted" would prune every record.
      // revision() is the store's own "have I loaded?" — null until it has.
      const canPrune = store.revision() !== null;
      const stale = [];
      for (const entry of entries) {
        if (!entry || typeof entry.key !== 'string') continue;
        const value = coerce(entry.value);
        if (!value || typeof value !== 'object') continue;
        const id = entry.key.slice(SENT_PREFIX.length);
        if (canPrune && !store.getEvent(id)) {
          stale.push(entry.key);
          continue;
        }
        sent.set(id, value);
      }
      for (const key of stale) await kv.del(key).catch(() => {});
    } catch {
      /* an unreadable cache only costs a "Send" label where "Resend" belongs */
    }
  }

  return { start, available, planFor, send, sendWhenReady, cancellationFor, removedGuestsFor, sendCancellation };
}
