/**
 * Correcting a sent document: fixing a signer's name or address, replacing
 * the person, and reissuing their link.
 *
 * Sent documents are otherwise immutable by design, and that is right for the
 * PDF and the fields. It was never right for one mistyped address: the only
 * remedy was to void the document and rebuild it, losing every signature
 * already collected. This changes WHO a pending signer is, and nothing else.
 *
 * The worker side already existed and nothing called it: /admin/sync takes a
 * `reissue` list, mints a fresh token for those signers, and deletes the old
 * one server-side, so the link that went to the wrong person stops working.
 */

import { el, append, fieldId } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { signlinks, emailer } from '../lib/services.js';
import { describeResult } from '../lib/emailer.js';
import { normalizeEmail } from '../lib/util.js';

/** Can this signer still be corrected? */
export function canCorrect(doc, signer) {
  return doc.status === 'sent'
    && !doc.sample
    && !signer.isMe
    && signer.status !== 'signed'
    && signer.status !== 'declined';
}

/** "Ava Chen <ava@example.com>" */
function describe(name, email) {
  const shown = String(name || '').trim();
  return shown && email ? `${shown} <${email}>` : (shown || email || 'a signer');
}

export function openCorrectSigner(doc, signer, { onDone = () => {} } = {}) {
  const nameId = fieldId('cn');
  const emailId = fieldId('ce');
  const reissueId = fieldId('cr');
  const notifyId = fieldId('cm');
  const errorId = fieldId('cee');

  const original = { name: signer.name || '', email: signer.email || '' };

  const emailError = el('p.field-error', { id: errorId, hidden: true },
    'Enter a valid email address, like alex@example.com');
  const nameInput = el('input.input', {
    id: nameId, type: 'text', maxLength: 100, value: original.name, placeholder: 'Full name',
  });
  const emailInput = el('input.input', {
    id: emailId, type: 'email', maxLength: 254, value: original.email, placeholder: 'email@example.com',
  });

  // Reissuing is the right default the moment the ADDRESS changes: the old
  // link may already be sitting in the wrong inbox.
  const reissue = el('input', { type: 'checkbox', id: reissueId, checked: false });
  const reissueNote = el('p.small.faint', { style: { margin: '4px 0 0 26px' } });
  const canEmail = emailer.available() && !doc.sample;
  const notify = el('input', {
    type: 'checkbox', id: notifyId, checked: canEmail, disabled: !canEmail,
  });

  let touchedReissue = false;
  reissue.addEventListener('change', () => { touchedReissue = true; syncHints(); });

  function emailChanged() {
    return normalizeEmail(emailInput.value) !== normalizeEmail(original.email);
  }

  function syncHints() {
    if (!touchedReissue) reissue.checked = emailChanged();
    reissueNote.textContent = reissue.checked
      ? 'The link already sent stops working immediately, and a new one is minted.'
      : 'They keep the link they already have.';
  }
  emailInput.addEventListener('input', () => {
    emailError.hidden = !emailInput.value || Boolean(normalizeEmail(emailInput.value));
    syncHints();
  });
  syncHints();

  const status = el('p.small.faint', { style: { margin: '10px 0 0' }, 'aria-live': 'polite' });
  const saveBtn = el('button.btn.btn-primary.btn-block', {
    type: 'button', style: { padding: '12px', marginTop: '16px' }, html: icon('check', 16, 2.2),
  }, ' Save correction');

  const body = el('div');
  append(body, [
    el('p.modal-message', {},
      'Fix a name or an address, or put a different person in this signer\'s place. Their fields and position on the document stay exactly as they are.'),
    el('div.field', {}, el('label', { for: nameId }, 'Name'), nameInput),
    el('div.field', {}, el('label', { for: emailId }, 'Email'), emailInput, emailError),
    el('div', { style: { marginBottom: '12px' } },
      el('label.check-row', { for: reissueId }, reissue, 'Reissue their sign link'),
      reissueNote),
    el('label.check-row', { for: notifyId }, notify,
      canEmail ? 'Email them the request now' : 'Email is unavailable. Copy their link from this page instead'),
    signer.hasCode && el('p.small.faint', { style: { marginTop: '10px' } },
      'Their access code is unchanged. If someone else is taking their place, replace the code from the signer row so the old one is no use.'),
    saveBtn,
    status,
  ]);

  const modal = openModal({ title: 'Correct signer', content: body });

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const email = normalizeEmail(emailInput.value);
    if (emailInput.value && !email) {
      emailError.hidden = false;
      emailInput.focus();
      return;
    }
    if (!email) {
      toast('A signer needs an email address to receive their link', { icon: 'circleAlert' });
      emailInput.focus();
      return;
    }
    // The same address on two signers would leave one of them un-emailed (see
    // sendBlockers): a correction must not create that.
    const clash = doc.signers.find((s) => s.id !== signer.id && normalizeEmail(s.email) === email);
    if (clash) {
      toast(`${clash.name || email} already has that address on this document`, {
        icon: 'circleAlert', duration: 4000,
      });
      emailInput.focus();
      return;
    }
    const changed = name !== original.name || email !== normalizeEmail(original.email);
    if (!changed && !reissue.checked) {
      modal.close();
      return;
    }

    saveBtn.disabled = true;
    nameInput.disabled = true;
    emailInput.disabled = true;
    status.textContent = reissue.checked ? 'Reissuing their link…' : 'Saving…';

    try {
      const target = store.getDoc(doc.id);
      const entry = target.signers.find((s) => s.id === signer.id);
      if (!entry) throw new Error('signer_gone');

      // The worker mints the new link and kills the old one, so it hears the
      // correction first, from a copy of the document rather than the record
      // itself. Writing the record first meant a failed push left the app
      // saying the link had been reissued when the worker had never revoked
      // it - and a retry stacked a second correction on the trail.
      const corrected = {
        ...target,
        signers: target.signers.map((s) => (s.id === signer.id ? { ...s, name, email } : s)),
      };
      const links = await signlinks.syncDoc(corrected, {
        reissue: reissue.checked ? [signer.id] : [],
      });

      entry.name = name;
      entry.email = email;
      target.links = links;
      // A corrected address has never had this document, whatever was sent to
      // the old one: forget the send record so the request goes out again.
      const emailed = { ...(target.emailed || {}) };
      for (const key of Object.keys(emailed)) {
        if (key.startsWith(`${signer.id}:`)) delete emailed[key];
      }
      target.emailed = emailed;
      if (changed) {
        store.addAudit(target, 'corrected',
          `${describe(original.name, original.email)} to ${describe(name, email)}`);
      }
      if (reissue.checked) {
        // A reissued link is a clean slate. Whoever held the revoked one may
        // have opened the document and agreed to the disclosure; that view and
        // that agreement were theirs, so they must not be shown against - or
        // printed on the certificate for - the person holding the new link.
        // The worker drops its own copy of the same record.
        entry.status = 'pending';
        delete entry.viewedAt;
        delete entry.consentAt;
        delete entry.consentVersion;
        delete entry.evidence;
        delete entry.codeSeen;
        store.addAudit(target, 'link_reissued', describe(name, email));
      }
      await store.persistDoc(target);

      let summary = null;
      if (notify.checked && canEmail) {
        status.textContent = 'Sending the request…';
        try {
          summary = await emailer.send(store.getDoc(doc.id), { signerIds: [signer.id], kind: 'request', force: true });
        } catch (err) {
          toast(err.message || 'Corrected, but the email could not be sent', {
            icon: 'triangleAlert', duration: 5000,
          });
        }
      }
      modal.close();
      if (summary) {
        const { message, icon: ic, quiet } = describeResult(summary);
        toast(quiet ? 'Signer corrected' : message, { icon: quiet ? 'check' : ic });
      } else {
        toast(reissue.checked ? 'Signer corrected and link reissued' : 'Signer corrected', { icon: 'check' });
      }
      onDone();
    } catch (err) {
      console.error(err);
      status.textContent = '';
      toast('Could not reach the signing service. Check your connection and try again', {
        icon: 'wifiOff', duration: 5000,
      });
      saveBtn.disabled = false;
      nameInput.disabled = false;
      emailInput.disabled = false;
    }
  });
}
