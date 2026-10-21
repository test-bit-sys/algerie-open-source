/**
 * Email templates: the same handful of emails a founder-seller sends on
 * repeat, with merge fields filled from the record they're sent from.
 *
 * Plain text only - mailto: can't carry HTML reliably, and mailto: is the
 * whole delivery story: no sending, no OAuth, no inbox sync, so the data
 * never leaves the user's machine except in their own mail client.
 */

import { rateText } from './recurring.js';

/** The fields a template may reference, shown as helper chips in the editor. */
export const MERGE_FIELDS = [
  { key: 'firstName', token: '{{firstName}}', label: 'First name' },
  { key: 'name', token: '{{name}}', label: 'Full name' },
  { key: 'company', token: '{{company}}', label: 'Company' },
  { key: 'dealName', token: '{{dealName}}', label: 'Deal name' },
  { key: 'dealValue', token: '{{dealValue}}', label: 'Deal value' },
];

/**
 * Replace {{field}} tokens from `ctx`. A known field with no value fills
 * empty; an unknown token stays visible - a typo'd {{fistName}} should be
 * seen in the preview, not silently swallowed into a broken email.
 */
export function fillTemplate(text, ctx = {}) {
  return String(text ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    (Object.prototype.hasOwnProperty.call(ctx, key) ? String(ctx[key] ?? '') : match));
}

/** Merge-field values for a record combination. Any part may be missing. */
export function templateContext({ contact = null, company = null, deal = null, currency = 'USD' } = {}) {
  return {
    firstName: String(contact?.name || '').trim().split(/\s+/)[0] || '',
    name: contact?.name || '',
    company: company?.name || '',
    dealName: deal?.name || '',
    // A subscription's value is a rate: "$2,000/mo", not a bare $2,000
    // that reads as the whole contract in the sentence around it.
    dealValue: deal && Number(deal.value) ? rateText(deal, currency) : '',
  };
}

/** A mailto: URL with subject and body, everything percent-encoded. */
export function buildMailto(email, subject = '', body = '') {
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${encodeURIComponent(String(email || '').trim())}${params.length ? `?${params.join('&')}` : ''}`;
}

/**
 * A tel: URL from however the number was typed. Digits, a leading +, and
 * the visual separators RFC 3966 allows survive; everything else goes.
 * A pasted or CSV-imported number can carry the pause and wait characters
 * (, ; p w) that append a second dial sequence to the call, and the dialler
 * would obey them.
 */
export function buildTel(phone) {
  const raw = String(phone || '').trim();
  const plus = raw.startsWith('+') ? '+' : '';
  return `tel:${plus}${raw.replace(/[^\d\-.()]/g, '')}`;
}
