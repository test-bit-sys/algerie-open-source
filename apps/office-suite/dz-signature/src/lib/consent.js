/**
 * Electronic-signature consent and the evidence that goes with a signature.
 *
 * Two halves live here: the disclosure a signer agrees to (its text and its
 * VERSION, both recorded with the agreement, so a certificate can say what
 * was actually shown), and the presentation of the technical context the sign
 * worker captured — IP address, device, and the signer's own clock offset.
 *
 * The worker keeps its own copy of nothing here: it stores raw values and the
 * disclosure version it was handed, and this module is what turns them into
 * something a person can read.
 */

/** Bump when DISCLOSURE_POINTS changes in a way a signer would notice. */
export const DISCLOSURE_VERSION = '1';

export const DISCLOSURE_TITLE = 'Signing electronically';

export const DISCLOSURE_POINTS = [
  'You agree to sign this document electronically. Your electronic signature is intended to have the same legal effect as signing on paper.',
  'You can ask the sender for a paper copy, or to sign on paper instead, at no cost to you.',
  'You can withdraw your agreement at any time before you finish, by choosing "Decline" instead of signing.',
  'You need a device with a current web browser and internet access to review and sign. You can download a copy of the completed document for your records.',
  'The record of your signature includes when you signed, your IP address, and your browser, and is attached to the completed document as a signature certificate.',
];

export const CONSENT_LABEL = 'I agree to sign this document electronically';

/**
 * "UTC+02:00". Offsets are stored as minutes EAST of UTC (the negation of
 * Date#getTimezoneOffset), so the sign reads the way people write it.
 */
export function formatOffset(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const sign = minutes < 0 ? '-' : '+';
  const total = Math.abs(Math.round(minutes));
  return `UTC${sign}${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** This browser's clock context, sent along with a consent or a signature. */
export function localClock() {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    zone = '';
  }
  return { tzOffset: -new Date().getTimezoneOffset(), tzName: zone };
}

/**
 * "Chrome 141 on macOS" from a user-agent string. Deliberately coarse: the
 * full string is kept in the record, and this is only for reading. Order
 * matters — every Chromium browser also claims Safari, and Edge claims both.
 */
export function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return '';
  const os = /Windows NT/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Mac OS X/.test(ua) ? 'macOS'
        : /Android/.test(ua) ? 'Android'
          : /CrOS/.test(ua) ? 'ChromeOS'
            : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari' : '';
  const version = (browser === 'Safari'
    ? /Version\/(\d+)/.exec(ua)
    : new RegExp(`${browser === 'Edge' ? 'Edg' : browser === 'Opera' ? 'OPR' : browser.replace(/\s+/g, '')}\\/(\\d+)`).exec(ua)
  )?.[1];
  const named = browser ? `${browser}${version ? ` ${version}` : ''}` : '';
  if (named && os) return `${named} on ${os}`;
  return named || os || '';
}

/** "203.0.113.7 · Chrome 141 on macOS", skipping whatever is missing. */
export function evidenceLine(event) {
  if (!event) return '';
  return [event.ip, describeDevice(event.ua)].filter(Boolean).join(' · ');
}

/** A timestamp in the signer's own clock: "Aug 20, 2026, 2:41 PM UTC-07:00". */
export function stampWithOffset(at, event) {
  if (!at) return '';
  const zone = event && Number.isFinite(event.tzOffset) ? formatOffset(event.tzOffset) : '';
  const when = new Date(at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return zone ? `${when} (signer's clock ${zone})` : when;
}

/** "a1b2c3d4 e5f6…": a 64-char hex digest has no spaces to wrap on. */
export function groupHex(hex, size = 8) {
  return String(hex || '').replace(new RegExp(`(.{${size}})`, 'g'), '$1 ').trim();
}
