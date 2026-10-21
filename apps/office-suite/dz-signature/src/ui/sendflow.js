/**
 * The send flow: mint sign links on the user's sign worker, mark the
 * document sent, and (optionally) email every external signer their link.
 */

import { el, append, clear, fieldId } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { signlinks, emailer } from '../lib/services.js';
import { describeResult } from '../lib/emailer.js';
import { normalizeEmail, randomCode, normalizeCode, localDateString, deadlineInDays } from '../lib/util.js';
import {
  signerColor, EXPIRY_CHOICES, REMINDER_CHOICES, PRE_EXPIRY_DAYS, DAY_MS, DOC_LIMITS,
  isValidInput, inputTypeHint,
} from '../lib/model.js';
import { formatDate } from '../lib/util.js';

/** A refusal to send that is the user's to fix, not a failure to report. */
class SendBlocked extends Error {}

/**
 * The codes, shown once. The app keeps only a salted hash on the worker, so
 * this panel is the sender's only chance to copy them: it replaces the send
 * form rather than sitting behind a toast.
 */
function showCodesOnce(modal, signers, codes) {
  const rows = signers.map((signer) => {
    const code = normalizeCode(codes[signer.id]);
    return el('div.code-row.given', {},
      el('div.grow', {},
        el('div.small', { style: { fontWeight: 650 } }, signer.name || signer.email),
        el('div.small.faint', {}, signer.email)),
      el('code.code-value', {}, code),
      el('button.icon-btn', {
        type: 'button', html: icon('clipboard', 16), title: 'Copy code',
        'aria-label': `Copy the access code for ${signer.name || signer.email}`,
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(code);
            toast('Code copied', { icon: 'clipboard' });
          } catch {
            toast('Could not copy. Select the code and copy it by hand', { icon: 'triangleAlert' });
          }
        },
      }));
  });
  const panel = el('div', {},
    el('p.modal-message', {},
      'Share each code with its signer by phone, in person, or any channel that is not carrying the link. They are not shown again, and this app does not store them.'),
    rows,
    el('button.btn.btn-primary.btn-block', {
      type: 'button', style: { marginTop: '16px', padding: '12px' },
      onclick: () => modal.close(),
    }, 'Done, I have the codes'));
  const body = modal.panel.querySelector('.modal-head')?.nextSibling;
  if (body) body.replaceWith(panel);
  else modal.panel.append(panel);
  const title = modal.panel.querySelector('.modal-title');
  if (title) title.textContent = 'Access codes to share';
  // The only copy outside the hash: a tap beside the sheet or an Escape used
  // to close this and leave the editor, and the codes with it.
  modal.lock();
}

/**
 * A deadline the sender picked that has already gone by. The date picker's
 * `min` stops the calendar offering one, but a typed date walks straight past
 * it, and sending then means links that are dead on arrival: the worker
 * answers 410 to every one of them, while the email that just went out invites
 * the signer to use them.
 */
export function pastDeadline(at, now = Date.now()) {
  return Boolean(at) && at <= now;
}

/** Problems that block sending, as user-readable strings. */
export function sendBlockers(doc) {
  const problems = [];
  if (!doc.signers.length) problems.push('Add at least one signer.');
  // Past these the sign worker keeps the first N and drops the rest, so the
  // sender would be looking at fields no signer is ever served.
  if (doc.signers.length > DOC_LIMITS.signers) {
    problems.push(`${doc.signers.length} signers is more than the ${DOC_LIMITS.signers} one document can carry. Remove some, or split the document.`);
  }
  if (doc.fields.length > DOC_LIMITS.fields) {
    problems.push(`${doc.fields.length} fields is more than the ${DOC_LIMITS.fields} one document can carry. Remove some before sending.`);
  }
  // One address, one signer: a link is minted per signer but the mail is
  // addressed per recipient, and the email worker sends one message per
  // address per request — so the second of two signers sharing an address
  // silently got no email at all.
  const byEmail = new Map();
  for (const signer of doc.signers) {
    const email = normalizeEmail(signer.email);
    if (!email) continue;
    const first = byEmail.get(email);
    if (first) {
      problems.push(`${first} and ${signer.name || signer.email} have the same email address. Each signer needs their own.`);
    } else {
      byEmail.set(email, signer.name || email);
    }
  }
  for (const signer of doc.signers) {
    if (!signer.isMe && !normalizeEmail(signer.email)) {
      problems.push(`${signer.name || 'A signer'} needs a valid email address.`);
    }
    const own = doc.fields.filter((f) => f.signerId === signer.id);
    if (!own.length) {
      problems.push(`${signer.name || signer.email || 'A signer'} has no fields on the document.`);
    } else if (own.every((f) => f.readOnly === true)) {
      // Every field of theirs is filled in and locked, so there is nothing
      // for them to do and nothing to collect.
      problems.push(`${signer.name || signer.email || 'A signer'} has only read-only fields, so there is nothing for them to fill in.`);
    }
  }
  // A read-only text field carries the sender's own value and nothing else:
  // left empty, the signer is shown a locked, blank box and the completed
  // copy has nothing to draw there. (A read-only checkbox left unticked is a
  // real value.)
  const blank = doc.fields.filter((f) => f.readOnly === true && f.type === 'text'
    && !(typeof f.preset === 'string' && f.preset.trim()));
  if (blank.length) {
    const label = blank[0].label || 'Text';
    problems.push(blank.length === 1
      ? `The read-only field "${label}" on page ${blank[0].page + 1} has nothing filled in. Fill it in, or let the signer.`
      : `${blank.length} read-only text fields have nothing filled in. Fill them in, or let the signer.`);
  }
  // Filled in, but not with what the field accepts ("$1,250" in a Number
  // field): the signer sees it, yet the completed copy skips any value that
  // fails its type, so the box came out blank on the signed PDF.
  const misfit = doc.fields.find((f) => f.readOnly === true && f.type === 'text'
    && typeof f.preset === 'string' && f.preset.trim() && !isValidInput(f.inputType, f.preset));
  if (misfit) {
    problems.push(`The read-only field "${misfit.label || 'Text'}" on page ${misfit.page + 1} does not match what it accepts. ${inputTypeHint(misfit.inputType)}.`);
  }
  return problems;
}

export function openSendFlow(doc, { navigate }) {
  if (doc.sample) {
    toast('Sample documents cannot be sent. Create your own to try it', { icon: 'info' });
    return;
  }
  const problems = sendBlockers(doc);
  if (problems.length) {
    toast(problems[0], { icon: 'circleAlert', duration: 4000 });
    return;
  }

  const external = doc.signers.filter((s) => !s.isMe);
  const meSigner = doc.signers.find((s) => s.isMe);

  // Only-me documents skip the worker entirely: nothing to link, nothing to
  // email. Straight to signing.
  if (!external.length) {
    (async () => {
      // The fingerprint of the file being signed, recorded before it goes out.
      await store.recordFingerprint(doc.id).catch(() => {});
      await store.markSent(doc.id, {});
      navigate(`#/doc/${doc.id}/sign`);
    })().catch(() => toast('Could not start signing', { icon: 'triangleAlert' }));
    return;
  }

  const canEmail = emailer.available();
  const noteId = fieldId('note');
  const note = el('textarea.textarea', {
    id: noteId, maxLength: 1000, rows: 3,
    placeholder: 'Optional. Included in the email and shown on the signing page.',
  });
  note.value = doc.note || '';

  const emailToggleId = fieldId('email');
  const emailToggle = el('input', { type: 'checkbox', id: emailToggleId, checked: canEmail, disabled: !canEmail });

  // Sequential signing follows the channel chosen below: with email on, each
  // request goes out as the turn before it closes; with it off, the sender
  // hands over each link as its turn comes, and is told when that is. With
  // the sender first in the order, nothing at all goes out at the send.
  const meFirst = doc.signOrder === true && Boolean(doc.signers[0]?.isMe);
  const orderNote = el('span');
  const syncOrderNote = () => {
    orderNote.textContent = emailToggle.checked
      ? (meFirst
        ? 'Signing in order. You sign first, in this app; each signer is then emailed their request as the one before them signs.'
        : 'Signing in order. Only the first signer is emailed now; each next request goes out as the one before it is signed.')
      : 'Signing in order. Each link opens only once the signer before it has signed; copy each one from the document page as its turn comes, and the app tells you when it does.';
  };
  syncOrderNote();
  emailToggle.addEventListener('change', syncOrderNote);

  const status = el('p.small.faint', { style: { margin: '10px 0 0' }, 'aria-live': 'polite' });
  const sendBtn = el('button.btn.btn-primary.btn-block', {
    type: 'button', style: { padding: '12px', marginTop: '16px' },
    html: icon('send', 16, 2),
  }, ' Send for signature');

  /* ---- Deadline and reminders ---------------------------------------- */

  let expiryDays = Number(store.settings.defaultExpiryDays) || 0;
  let reminderDays = Number(store.settings.defaultReminderDays) || 0;
  let customExpiry = '';
  const timingWrap = el('div');

  /**
   * The chosen deadline as a timestamp: the end of that day, local time,
   * whether the day was picked from the calendar or counted from today.
   */
  function expiresAt() {
    if (customExpiry) {
      const [y, m, d] = customExpiry.split('-').map(Number);
      return y && m && d ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : null;
    }
    return expiryDays ? deadlineInDays(expiryDays) : null;
  }

  function renderTiming() {
    clear(timingWrap);
    const expiryId = fieldId('exp');
    const dateId = fieldId('expd');
    const dateErrorId = fieldId('expe');
    const remId = fieldId('rem');
    const at = expiresAt();
    const past = pastDeadline(at);
    const minDate = localDateString(Date.now() + DAY_MS);

    append(timingWrap, [
      el('div.field', { style: { marginBottom: '12px' } },
        el('label', { for: expiryId }, 'Expires'),
        el('div.select-wrap', {},
          el('select.select', {
            id: expiryId,
            onchange: (e) => {
              if (e.target.value === 'custom') {
                expiryDays = 0;
                // Default the picker a fortnight out rather than to nothing.
                customExpiry = customExpiry
                  || localDateString(Date.now() + 14 * DAY_MS);
              } else {
                customExpiry = '';
                expiryDays = Number(e.target.value);
              }
              renderTiming();
            },
          },
            EXPIRY_CHOICES.map((choice) => el('option', {
              value: String(choice.days),
              selected: !customExpiry && expiryDays === choice.days,
            }, choice.label)),
            el('option', { value: 'custom', selected: Boolean(customExpiry) }, 'On a date…'))),
        customExpiry && el('input.input', {
          id: dateId, type: 'date', value: customExpiry, min: minDate,
          'aria-label': 'Expiry date', style: { marginTop: '8px' },
          'aria-invalid': past ? 'true' : null,
          'aria-describedby': past ? dateErrorId : null,
          onchange: (e) => { customExpiry = e.target.value; renderTiming(); },
        })),
      el('div.field', { style: { marginBottom: at || reminderDays ? '12px' : '0' } },
        el('label', { for: remId }, 'Remind signers who have not signed'),
        el('div.select-wrap', {},
          el('select.select', {
            id: remId,
            onchange: (e) => { reminderDays = Number(e.target.value); renderTiming(); },
          }, REMINDER_CHOICES.map((choice) => el('option', {
            value: String(choice.days), selected: reminderDays === choice.days,
          }, choice.label))))),
      past && el('p.field-error', { id: dateErrorId, style: { margin: '0' } },
        `${formatDate(at)} has already passed. Choose a date in the future, or no expiry.`),
      at && !past && el('p.small.faint', { style: { margin: '0' } },
        `Every link stops working after ${formatDate(at)}, and anyone who has not signed gets a last reminder ${PRE_EXPIRY_DAYS} days before.`),
      !at && reminderDays > 0 && el('p.small.faint', { style: { margin: '0' } },
        'Reminders keep going until everyone signs. An expiry date stops them.'),
    ]);
  }
  renderTiming();

  /* ---- Access codes -------------------------------------------------- */

  // Held only until the send completes: the app never stores a code, and the
  // worker keeps only a salted hash.
  const codes = {};
  let codesOn = false;
  const codesWrap = el('div');

  function renderCodes() {
    clear(codesWrap);
    const toggleId = fieldId('codes');
    codesWrap.append(el('label.check-row', { for: toggleId },
      el('input', {
        type: 'checkbox', id: toggleId, checked: codesOn,
        onchange: (e) => {
          codesOn = e.target.checked;
          for (const signer of external) {
            codes[signer.id] = codesOn ? (codes[signer.id] || randomCode()) : '';
          }
          renderCodes();
        },
      }), 'Require an access code to open the link'));
    if (!codesOn) {
      codesWrap.append(el('p.small.faint', { style: { margin: '5px 0 0 26px' } },
        'The link is the only credential. A code adds a second one you share by phone or in person.'));
      return;
    }
    for (const signer of external) {
      const inputId = fieldId('code');
      const input = el('input.input.code-input', {
        id: inputId, type: 'text', maxLength: 32, value: codes[signer.id] || '',
        autocapitalize: 'characters', autocomplete: 'off', spellcheck: false,
        'aria-label': `Access code for ${signer.name || signer.email}`,
        oninput: (e) => { codes[signer.id] = e.target.value; },
      });
      codesWrap.append(el('div.code-row', {},
        el('label.grow', { for: inputId }, signer.name || signer.email),
        input,
        el('button.icon-btn', {
          type: 'button', html: icon('rotate', 15, 2), title: 'Generate a new code',
          'aria-label': `Generate a new access code for ${signer.name || signer.email}`,
          onclick: () => {
            codes[signer.id] = randomCode();
            input.value = codes[signer.id];
          },
        })));
    }
    codesWrap.append(el('p.small.faint', { style: { marginTop: '9px' } },
      'Share each code by phone, in person, or any channel that is not carrying the link. The email says a code is needed, never what it is, and this app does not keep it.'));
  }
  renderCodes();

  /** Blocks the send: a code too short to be a second factor. */
  function codeProblem() {
    if (!codesOn) return '';
    for (const signer of external) {
      if (normalizeCode(codes[signer.id]).length < 4) {
        return `${signer.name || signer.email} needs an access code of at least 4 characters.`;
      }
    }
    return '';
  }

  const body = el('div');
  append(body, [
    el('div.card', { style: { padding: '4px 14px', marginBottom: '14px' } },
      doc.signOrder === true && el('p.order-note', { html: icon('listOrdered', 14, 2), style: { margin: '10px 0 2px' } },
        orderNote),
      doc.signers.map((s, index) => el('div.signer-row', {},
        doc.signOrder === true
          ? el('span.order-badge', { 'aria-hidden': 'true' }, String(index + 1))
          : el('span.recipient-dot', { className: `recipient-dot c${signerColor(s, doc.signers)}` }),
        el('div.who', {},
          el('div.nm', {}, s.name || s.email || 'Signer'),
          el('div.em', {}, s.isMe ? 'You, signing in this app' : s.email)
        )
      ))),
    el('div.field', {}, el('label', { for: noteId }, 'Message to signers'), note),
    el('div.card', { style: { padding: '14px', marginBottom: '14px' } }, timingWrap),
    el('div.card', { style: { padding: '14px', marginBottom: '14px' } }, codesWrap),
    el('label.check-row', { for: emailToggleId }, emailToggle,
      canEmail
        ? (doc.signOrder === true
          ? (meFirst
            ? 'Email each signer their private sign link as their turn comes'
            : 'Email the first signer their private sign link now')
          : 'Email each signer their private sign link now')
        : 'Email is unavailable. Copy each sign link from the document page instead'),
    sendBtn,
    status,
  ]);

  // Set once the send has landed: from then on, every way out of this dialog
  // (Done, the X, Escape, the scrim) has to leave the editor, which is now
  // showing a document that has already gone out.
  let onDismiss = null;
  const modal = openModal({
    title: 'Send for signature',
    content: body,
    onClose: () => onDismiss?.(),
  });

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    note.disabled = true;
    try {
      await store.patchDoc(doc.id, { note: note.value.trim() });
      // Fingerprint the exact bytes signers will be served, so the completed
      // copy can be tied back to them.
      await store.recordFingerprint(doc.id).catch(() => {});
      status.textContent = doc.links && Object.keys(doc.links).length
        ? 'Preparing sign links…'
        : 'Setting up your signing service. The first send can take up to 30 seconds…';
      // One reading of the clock for the whole send: the deadline the worker
      // is told about has to be the one the record ends up holding.
      const deadline = expiresAt();
      const bad = codeProblem()
        || (pastDeadline(deadline) ? 'That deadline has already passed. Choose one in the future, or no expiry.' : '');
      if (bad) throw new SendBlocked(bad);
      // The deadline is stamped on the record by markSent, which cannot run
      // until the links exist — so the snapshot carries it explicitly. Without
      // this the worker is pushed expiresAt: 0 and enforces no deadline at
      // all, leaving every link alive past it while the app's own copy reads
      // Expired.
      const fresh = { ...store.getDoc(doc.id), expiresAt: deadline };
      const links = await signlinks.syncDoc(fresh, {
        codes: codesOn ? Object.fromEntries(external.map((sx) => [sx.id, codes[sx.id]])) : null,
      });
      await store.markSent(doc.id, links, {
        expiresAt: deadline,
        reminder: { every: reminderDays, beforeExpiry: true },
        // The channel is a choice, recorded whether or not anything goes out
        // right now: with the sender first in the order, the first request is
        // only emailed once they have signed.
        channel: emailToggle.checked ? 'email' : 'link',
      });
      if (codesOn) {
        // Only the fact, never the code: this record is all the app keeps.
        const withCodes = store.getDoc(doc.id);
        for (const signer of withCodes.signers) {
          if (!signer.isMe) {
            signer.hasCode = true;
            store.addAudit(withCodes, 'code_set', signer.name || signer.email);
          }
        }
        await store.persistDoc(withCodes);
      }
      let mailSummary = null;
      if (emailToggle.checked) {
        status.textContent = 'Sending emails…';
        try {
          mailSummary = await emailer.send(store.getDoc(doc.id), { kind: 'request' });
        } catch (err) {
          toast(err.message || 'Links are ready, but the emails failed', { icon: 'triangleAlert', duration: 5000 });
        }
      }
      const leave = () => navigate(meSigner ? `#/doc/${doc.id}/sign` : `#/doc/${doc.id}`);
      onDismiss = leave;
      if (codesOn) {
        // The one time these are visible in the app. Shown before anything
        // navigates away, so nothing can hide them.
        showCodesOnce(modal, external, codes);
        if (mailSummary) {
          const { message, icon: ic, quiet } = describeResult(mailSummary);
          if (!quiet) toast(message, { icon: ic });
        }
        return;
      }
      modal.close(); // fires onDismiss, which navigates
      if (mailSummary) {
        const { message, icon: ic, quiet } = describeResult(mailSummary);
        if (!quiet) toast(message, { icon: ic });
        else toast('Document sent', { icon: 'send' });
      } else {
        toast('Document sent. Share each sign link from the document page', { icon: 'send', duration: 4500 });
      }
    } catch (err) {
      status.textContent = '';
      if (err instanceof SendBlocked) {
        toast(err.message, { icon: 'circleAlert', duration: 4000 });
      } else {
        console.error(err);
        toast('Could not prepare the sign links. Check your connection and try again', {
          icon: 'wifiOff', duration: 5000,
        });
      }
      sendBtn.disabled = false;
      note.disabled = false;
    }
  });
}
