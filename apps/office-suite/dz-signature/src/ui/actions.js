/**
 * Document actions shared by views: downloads, links, reminders, void and
 * delete, and what happens when pulled responses complete a document.
 */

import { store } from '../lib/store.js';
import { signlinks } from '../lib/services.js';
import { emailer } from '../lib/services.js';
import { currentTurn, reminderDue, isExpired, sendChannel } from '../lib/model.js';
import { buildSignedPdf } from '../lib/flatten.js';
import { describeResult } from '../lib/emailer.js';
import { toast } from './toast.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { alertDialog, confirmDialog, promptDialog } from './modal.js';
import { randomCode, normalizeCode, deadlineInDays } from '../lib/util.js';

export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function baseName(doc) {
  return (doc.title || 'document').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'document';
}

export async function downloadOriginal(doc) {
  const bytes = await store.readPdf(doc.id);
  downloadBytes(bytes, `${baseName(doc)}.pdf`);
}

/**
 * Download the document with every signature collected so far. Completed
 * documents get the stored flattened copy (built once, then reused).
 */
export async function downloadSigned(doc) {
  if (doc.status === 'completed') {
    const stored = await store.readSignedPdf(doc.id);
    if (stored) {
      downloadBytes(stored, `${baseName(doc)} (signed).pdf`);
      return;
    }
  }
  const bytes = await buildAndMaybeStoreSignedPdf(doc);
  downloadBytes(bytes, `${baseName(doc)} (signed).pdf`);
}

export async function buildAndMaybeStoreSignedPdf(doc) {
  const [original, values] = await Promise.all([
    store.readPdf(doc.id),
    store.readSigData(doc.id),
  ]);
  const bytes = await buildSignedPdf(original, doc, values, {
    certificate: doc.status === 'completed',
  });
  if (doc.status === 'completed') {
    await store.writeSignedPdf(doc.id, bytes).catch(() => {});
  }
  return bytes;
}

/**
 * Copy a document into a fresh draft and open it: same PDF, same people, same
 * field layout, no signatures and no links. The one-action version of "send
 * this again".
 */
export async function duplicateDocFlow(doc, { navigate } = {}) {
  try {
    const copy = await store.duplicateDoc(doc.id);
    toast(`Copied to "${copy.title}"`, { icon: 'copy' });
    navigate?.(`#/doc/${copy.id}/edit`);
    return copy;
  } catch (err) {
    console.error(err);
    toast('Could not duplicate that document. Check your connection', { icon: 'wifiOff' });
    return null;
  }
}

/**
 * Set, change, or remove a signer's access code after sending. The link is
 * untouched: only the second factor changes, so a code shared with the wrong
 * person can be replaced without reissuing anything.
 */
export async function resetCodeFlow(doc, signer) {
  const has = signer.hasCode === true;
  const code = await promptDialog({
    title: has ? `New access code for ${signer.name || signer.email}` : `Access code for ${signer.name || signer.email}`,
    label: 'Access code',
    value: randomCode(),
    confirmLabel: has ? 'Replace code' : 'Require this code',
    hint: has
      ? 'The old code stops working immediately and any lockout is cleared. The sign link itself keeps working.'
      : 'Share it by phone or in person. The signer needs it before the document opens.',
  });
  if (!code) return false;
  if (normalizeCode(code).length < 4) {
    toast('An access code needs at least 4 characters', { icon: 'circleAlert' });
    return false;
  }
  try {
    const links = await signlinks.syncDoc(doc, { codes: { [signer.id]: code } });
    const target = store.getDoc(doc.id);
    const entry = target.signers.find((s) => s.id === signer.id);
    if (entry) entry.hasCode = true;
    store.addAudit(target, 'code_set', signer.name || signer.email);
    await store.patchDoc(doc.id, { links });
    // Shown once, because this is the only copy that exists outside the hash:
    // it gets the same monospace value and copy button as the send flow, and
    // no "Cancel" — the code is already live.
    const shown = normalizeCode(code);
    await alertDialog({
      sticky: true,
      title: 'Share this code',
      message: `${signer.name || signer.email} needs this code to open the document. It is not shown again.`,
      extra: el('div.code-row.given', {},
        el('code.code-value.grow', {}, shown),
        el('button.icon-btn', {
          type: 'button', html: icon('clipboard', 16), title: 'Copy code',
          'aria-label': 'Copy the access code',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(shown);
              toast('Code copied', { icon: 'clipboard' });
            } catch {
              toast('Could not copy. Select the code and copy it by hand', { icon: 'triangleAlert' });
            }
          },
        })),
    });
    return true;
  } catch {
    toast('Could not reach the signing service. Check your connection', { icon: 'wifiOff' });
    return false;
  }
}

/** Drop the access-code requirement for one signer. */
export async function clearCodeFlow(doc, signer) {
  const ok = await confirmDialog({
    title: 'Remove the access code?',
    message: `${signer.name || signer.email} will be able to open the document with their link alone.`,
    confirmLabel: 'Remove code',
  });
  if (!ok) return false;
  try {
    const links = await signlinks.syncDoc(doc, { codes: { [signer.id]: null } });
    const target = store.getDoc(doc.id);
    const entry = target.signers.find((s) => s.id === signer.id);
    if (entry) entry.hasCode = false;
    store.addAudit(target, 'code_cleared', signer.name || signer.email);
    await store.patchDoc(doc.id, { links });
    toast('Access code removed', { icon: 'check' });
    return true;
  } catch {
    toast('Could not reach the signing service. Check your connection', { icon: 'wifiOff' });
    return false;
  }
}

export async function copySignLink(doc, signer) {
  const link = (doc.links || {})[signer.id];
  if (!link) {
    toast('No link yet. Send the document first', { icon: 'info' });
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    toast('Could not copy. Your browser blocked clipboard access', { icon: 'triangleAlert' });
    return;
  }
  toast(`Sign link for ${signer.name || signer.email} copied`, { icon: 'link' });
}

export async function remindSigner(doc, signer) {
  try {
    const out = await emailer.send(doc, { signerIds: [signer.id], kind: 'reminder', force: true });
    const { message, icon } = describeResult(out);
    toast(message, { icon });
  } catch (err) {
    toast(err.message || 'Could not send the reminder', { icon: 'triangleAlert' });
  }
}

/**
 * A document just completed (all signatures in). Build and store the final
 * copy, and send completion notices to external signers, but only on the
 * channel the owner already chose: signers who were emailed get emailed.
 */
export async function handleCompleted(doc) {
  try {
    await buildAndMaybeStoreSignedPdf(doc);
  } catch (err) {
    console.error(err);
  }
  if (requestsWereEmailed(doc) && emailer.available() && !doc.sample) {
    try {
      // Push the final state (all values) to the worker first, so the links
      // in completion emails show the fully signed document.
      const links = await signlinks.syncDoc(doc);
      await store.patchDoc(doc.id, { links });
      await emailer.send(doc, { kind: 'completed' });
    } catch {
      /* completion notices are best-effort; the document itself is done */
    }
  }
}

/**
 * Did this document's requests go out by email? The sender chose the channel
 * when they sent: email, or copying each link by hand. Everything the app
 * sends on its own later (the next turn's request, the completion notices)
 * follows that choice rather than assuming email.
 *
 * The choice is recorded on the document at the send. Reading it off what
 * was actually emailed is only for documents sent before it was: with
 * sequential signing and the owner signing first, an email send puts NO
 * request out at the send (nobody's turn has come), so that reading called
 * the document a copy-link one, and the sender who had asked for email was
 * told to hand the next link over by hand.
 */
export function requestsWereEmailed(doc) {
  return sendChannel(doc) === 'email';
}

/**
 * Sequential signing: a signature just landed, so the next signer's turn may
 * have opened. If the requests went out by email, theirs goes out now - the
 * same per-signer send the initial one was, addressed to them alone. If the
 * sender copied links by hand instead, nobody is emailed behind their back:
 * they are told whose turn it is, so they know to hand over the next link.
 *
 * Either way a turn is opened ONCE. Every pull that reports the document
 * calls this, and the request is versioned on the document's details, so
 * without the record a deadline change or a new access code had the next
 * signer's request going out again the moment they opened the document,
 * with a second "has been asked to sign" on the trail. The first signer is
 * never opened here: they had their request at the send, on either channel.
 */
export async function advanceTurn(doc) {
  if (!doc || doc.signOrder !== true || doc.status !== 'sent' || doc.sample) return;
  const next = currentTurn(doc);
  if (!next || next.isMe) return;
  if ((doc.signers[0] || {}).id === next.id || (doc.turnOpened || {})[next.id]) return;
  const who = next.name || next.email || 'The next signer';
  const opened = async () => {
    const target = store.getDoc(doc.id);
    if (!target) return;
    target.turnOpened = { ...(target.turnOpened || {}), [next.id]: Date.now() };
    store.addAudit(target, 'turn_opened', who);
    await store.persistDoc(target);
  };
  if (requestsWereEmailed(doc)) {
    if (!emailer.available()) return;
    try {
      const out = await emailer.send(doc, { kind: 'request', signerIds: [next.id] });
      // A failed send leaves the turn unrecorded, so the next pull tries
      // again; the sender can also remind by hand from the document page.
      if (out && out.sent) {
        await opened();
        toast(`${who} has been asked to sign`, { icon: 'mailCheck' });
      }
    } catch {
      /* retried on the next pull */
    }
    return;
  }
  await opened();
  toast(`It is ${who}'s turn. Share their sign link from the document page`, {
    icon: 'link', duration: 6000,
  });
}

/**
 * The events on this document the owner should have been told about, and
 * which of them the sign worker already mailed them.
 *
 * The worker records every attempt it makes, success or failure, so anything
 * without a successful record is something the owner has not heard about.
 * `doc.ownerNotified` remembers what the APP then sent, so the two channels
 * never double up.
 */
export function missedOwnerEvents(doc, notified = {}) {
  const settings = store.settings;
  const already = doc.ownerNotified || {};
  const out = [];
  const consider = (key, wanted, event) => {
    if (!wanted) return;
    if (notified[key] && notified[key].ok) return; // the worker mailed it
    if (already[key]) return; // the app already did
    out.push({ key, ...event });
  };
  for (const signer of doc.signers || []) {
    const who = signer.name || signer.email || 'A signer';
    if (signer.isMe) continue; // you know what you did yourself
    if (signer.status === 'signed') {
      consider(`sign:${signer.id}`, settings.notifySign === true,
        { type: 'signed', who, at: signer.signedAt || Date.now() });
    }
    if (signer.status === 'declined') {
      consider(`decline:${signer.id}`, settings.notifyDecline !== false,
        { type: 'declined', who, at: signer.declinedAt || Date.now() });
    }
  }
  if (doc.status === 'completed') {
    consider('complete:-', settings.notifyComplete !== false,
      { type: 'completed', who: '', at: doc.completedAt || Date.now() });
  }
  return out;
}

/**
 * Send what the sign worker could not. The worker path is the one that works
 * with the app closed; this one closes the gap when the platform refuses
 * own-account mail from a worker, so the sender is never left guessing.
 */
export async function catchUpOwner(doc, notified) {
  const events = missedOwnerEvents(doc, notified);
  if (!events.length || doc.sample || !emailer.available()) return;
  let out;
  try {
    out = await emailer.notifyOwner(doc, events.map(({ key, ...event }) => event));
  } catch {
    return; // the in-app toast already told them; try again on the next pull
  }
  if (!out || !out.sent) return;
  const ownerNotified = { ...(doc.ownerNotified || {}) };
  for (const event of events) ownerNotified[event.key] = { at: Date.now(), via: 'app' };
  const target = store.getDoc(doc.id);
  if (!target) return;
  store.addAudit(target, 'owner_notified', `${events.length} event${events.length === 1 ? '' : 's'}`);
  await store.patchDoc(doc.id, { ownerNotified });
}

/**
 * The clock-driven half of a sent document, run from the app's pull cycle.
 *
 * Expiry is enforced by the WORKER, so a document stops being signable
 * whether or not this ever runs; this is the owner's copy catching up, and it
 * is also where reminders go out, because sending mail needs the user's own
 * session (puter.workers.exec is what authorizes and bills it).
 */
export async function runTimers() {
  for (const doc of store.listDocs()) {
    if (doc.sample) continue;
    if (doc.status === 'sent' && isExpired(doc)) {
      await store.markExpired(doc.id).catch(() => {});
      toast(`"${doc.title}" expired. Extend it to reopen the links`, { icon: 'hourglass', duration: 5000 });
      continue;
    }
    const due = reminderDue(doc);
    if (!due || !emailer.available()) continue;
    try {
      const out = await emailer.send(doc, { kind: 'reminder', force: true });
      if (out && out.sent) {
        // A successful HTTP response can still report only failed or
        // rate-limited recipients. Keep those reminders due for retry.
        await store.markReminded(doc.id, { preExpiry: due === 'expiry' });
        toast(`Reminder sent to ${out.sent} signer${out.sent === 1 ? '' : 's'} for "${doc.title}"`, {
          icon: 'bell',
        });
      }
    } catch {
      // Nothing was sent, so the schedule is left alone and the next cycle
      // tries again.
    }
  }
}

/**
 * Move a document's deadline, or take it away.
 *
 * The WORKER is what enforces a deadline, so it hears the new one first and
 * the record follows. Recording it here first left the two disagreeing
 * whenever the push failed - the app reading "expires in 7 days" over links
 * the worker still refuses, or "no expiry" over links it still cuts off - and
 * nothing ever pushed it again.
 */
export async function extendExpiry(doc, days) {
  // Counted from the current deadline while it stands, or from today once it
  // has passed; either way the result is the end of that calendar day.
  const from = Math.max(Date.now(), doc.expiresAt || 0);
  const expiresAt = days ? deadlineInDays(days, from) : null;
  if (!doc.sample && Object.keys(doc.links || {}).length) {
    try {
      const links = await signlinks.syncDoc({ ...doc, expiresAt: expiresAt || 0 });
      await store.patchDoc(doc.id, { links });
    } catch {
      toast('Could not reach the signing service, so the deadline is unchanged. Check your connection and try again', {
        icon: 'wifiOff', duration: 5000,
      });
      return false;
    }
  }
  await store.setExpiry(doc.id, expiresAt);
  toast(days ? 'Deadline extended' : 'Expiry removed', { icon: 'check' });
  return true;
}

/** Merge results from a responses pull into user-visible outcomes. */
export async function afterPull(results) {
  for (const result of results || []) {
    const doc = store.getDoc(result.docId);
    if (!doc) continue;
    if (result.completedNow) {
      toast(`"${doc.title}" is fully signed`, { icon: 'circleCheckBig' });
      await handleCompleted(doc);
    } else if (doc.signOrder && doc.status === 'sent') {
      await advanceTurn(doc);
    }
    if (result.declinedNow) {
      const decliner = doc.signers.find((s) => s.status === 'declined');
      toast(`${decliner?.name || 'A signer'} declined "${doc.title}"`, { icon: 'circleX', duration: 5000 });
    }
    // Whatever the worker could not mail the owner, the app sends now.
    await catchUpOwner(store.getDoc(result.docId), result.notified);
  }
}

export async function voidDocFlow(doc) {
  const ok = await confirmDialog({
    title: 'Void this document?',
    message: 'Every sign link stops working immediately and signers can no longer respond. This cannot be undone.',
    confirmLabel: 'Void document',
  });
  if (!ok) return false;
  try {
    if (!doc.sample) await signlinks.voidDoc(doc.id);
  } catch {
    toast('Could not reach the signing service. Check your connection', { icon: 'wifiOff' });
    return false;
  }
  await store.voidDoc(doc.id);
  toast('Document voided', { icon: 'ban' });
  return true;
}

export async function deleteDocFlow(doc) {
  const ok = await confirmDialog({
    title: 'Delete this document?',
    message: doc.status === 'sent'
      ? 'The document, its sign links, and everything signers submitted are permanently removed.'
      : 'The document and its file are permanently removed.',
    confirmLabel: 'Delete',
  });
  if (!ok) return false;
  try {
    if (!doc.sample && doc.status !== 'draft') await signlinks.revokeDoc(doc.id);
  } catch {
    toast('Could not reach the signing service. The document was not deleted. Check your connection and try again', {
      icon: 'wifiOff', duration: 5000,
    });
    return false;
  }
  await store.deleteDoc(doc.id);
  toast('Document deleted', { icon: 'trash' });
  return true;
}
