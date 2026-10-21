/**
 * The consent step: the disclosure a signer sees before the document, and the
 * checkbox that records their agreement. Shared by the external signing page
 * and in-app self-signing, so the record on the certificate says the same
 * thing whoever signed.
 *
 * Nothing is shown of the document itself here. Agreeing is the first act of
 * signing, and the record of it is what makes the signature defensible.
 */

import { el, fieldId } from './dom.js';
import { icon } from './icons.js';
import {
  DISCLOSURE_TITLE, DISCLOSURE_POINTS, DISCLOSURE_VERSION, CONSENT_LABEL,
} from '../lib/consent.js';

/**
 * consentGate({ intro, onAgree, onDecline, agreeLabel }) -> the panel element.
 * `intro` is one sentence naming the document, written by the caller because
 * the sender and the owner-signing-their-own-document read differently.
 * `onAgree` may return a promise; the button shows its progress.
 */
export function consentGate({
  intro = '',
  onAgree,
  onDecline = null,
  agreeLabel = 'Agree and review the document',
}) {
  const boxId = fieldId('consent');
  const agreeBtn = el('button.btn.btn-primary.btn-block', {
    type: 'button', disabled: true, style: { padding: '12px' },
    html: icon('penLine', 16, 2.2),
  }, ` ${agreeLabel}`);

  const checkbox = el('input', {
    type: 'checkbox', id: boxId,
    onchange: () => { agreeBtn.disabled = !checkbox.checked; },
  });

  const status = el('p.small.faint', { style: { margin: '10px 0 0', textAlign: 'center' }, 'aria-live': 'polite' });

  agreeBtn.addEventListener('click', async () => {
    if (!checkbox.checked) return;
    agreeBtn.disabled = true;
    checkbox.disabled = true;
    status.textContent = 'Recording your agreement…';
    try {
      await onAgree({ version: DISCLOSURE_VERSION });
    } catch (err) {
      console.error(err);
      status.textContent = '';
      agreeBtn.disabled = false;
      checkbox.disabled = false;
      throw err;
    }
  });

  return el('div.consent-panel', {},
    el('div.consent-head', {},
      el('span.consent-icon', { html: icon('shield', 22, 2), 'aria-hidden': 'true' }),
      el('div', {},
        el('h2', {}, DISCLOSURE_TITLE),
        intro && el('p.small.muted', {}, intro))),
    el('ul.consent-list', {}, DISCLOSURE_POINTS.map((point) => el('li', {}, point))),
    el('label.check-row.consent-check', { for: boxId }, checkbox, CONSENT_LABEL),
    agreeBtn,
    onDecline && el('button.btn.btn-ghost.btn-block', {
      type: 'button', style: { marginTop: '9px' },
      onclick: () => onDecline(),
    }, 'Decline to sign'),
    status,
    el('p.consent-version', {},
      `Disclosure version ${DISCLOSURE_VERSION}. Your agreement is recorded with the time, your IP address, and your browser.`)
  );
}
