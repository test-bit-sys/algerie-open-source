/**
 * The document model, shared by the app, the sign page, and the workers'
 * client side. Pure data helpers only.
 *
 * Field geometry is stored as fractions of the page (x, y from the top-left,
 * w, h in 0..1), so it is independent of render scale and of PDF units.
 */

import { clamp, uid } from './util.js';

export const FIELD_TYPES = [
  { type: 'signature', label: 'Signature' },
  { type: 'initials', label: 'Initials' },
  { type: 'date', label: 'Date signed' },
  { type: 'text', label: 'Text' },
  { type: 'checkbox', label: 'Checkbox' },
];

const FIELD_LABELS = Object.fromEntries(FIELD_TYPES.map((f) => [f.type, f.label]));

export function fieldLabel(type) {
  return FIELD_LABELS[type] || 'Field';
}

/** Default size per type, as fractions of a page (tuned for US Letter/A4). */
export function defaultRect(type) {
  switch (type) {
    case 'signature': return { w: 0.26, h: 0.052 };
    case 'initials': return { w: 0.09, h: 0.045 };
    case 'date': return { w: 0.16, h: 0.032 };
    case 'text': return { w: 0.26, h: 0.032 };
    case 'checkbox': return { w: 0.032, h: 0.0247 };
    default: return { w: 0.2, h: 0.04 };
  }
}

export const MIN_FIELD = { w: 0.03, h: 0.015 };

/** What a text field accepts. Validated on the signing page AND in the
 *  worker, which keeps its own copy of these rules (it imports nothing). */
export const TEXT_INPUT_TYPES = [
  { id: 'text', label: 'Any text' },
  { id: 'number', label: 'Number' },
  { id: 'email', label: 'Email address' },
  { id: 'date', label: 'Date' },
];

export const FIELD_LIMITS = { label: 100, help: 200, text: 2000 };

/**
 * What the sign worker will accept on one document (MAX_FIELDS and
 * MAX_SIGNERS in src/workers/sign-worker.js, kept in step by hand: a worker
 * imports nothing). Anything past these it silently drops, which would leave
 * fields the sender can see and signers cannot, and signers with no link at
 * all — so the app refuses first.
 */
export const DOC_LIMITS = { fields: 200, signers: 20 };

/** "1,250.50" -> "1250.50": thousands separators and spaces are noise. */
export function numericText(value) {
  return String(value).replace(/[,\s]/g, '');
}

/**
 * Is this text acceptable for the field's input type? Blank always is;
 * whether blank is ALLOWED is the separate question of `required`.
 */
export function isValidInput(inputType, value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return true;
  switch (inputType) {
    case 'number': return /^-?(\d+\.?\d*|\.\d+)$/.test(numericText(text));
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 254;
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))
      && new Date(text).toISOString().slice(0, 10) === text;
    default: return true;
  }
}

/** The message shown when an input type is not satisfied. */
export function inputTypeHint(inputType) {
  switch (inputType) {
    case 'number': return 'Enter a number, like 1250.50';
    case 'email': return 'Enter an email address, like alex@example.com';
    case 'date': return 'Enter a date';
    default: return 'Check this value';
  }
}

/**
 * The value to show for a field: what the signer submitted, or failing that
 * the value the sender filled in for them. A submitted `false` (an unchecked
 * box) or empty string (a cleared optional field) wins over a preset.
 */
export function displayValue(field, values) {
  const stored = values ? values[field.id] : undefined;
  if (stored !== undefined && stored !== null) return stored;
  return field.preset === undefined || field.preset === '' ? stored : field.preset;
}

/**
 * Does the SIGNER still owe work here? A read-only field carries the sender's
 * own value, so it never waits on the signer however required it is.
 */
export function needsSigner(field) {
  return field.required !== false && field.readOnly !== true;
}

/** A new field centered on (x, y) page fractions, clamped inside the page. */
export function makeField({ type, page, x, y, signerId }) {
  const { w, h } = defaultRect(type);
  return clampField({
    id: uid(),
    type,
    page,
    x: x - w / 2,
    y: y - h / 2,
    w,
    h,
    signerId,
    required: type !== 'checkbox',
  });
}

/** Keep a field fully inside its page; mutates and returns the field. */
export function clampField(field) {
  field.w = clamp(field.w, MIN_FIELD.w, 1);
  field.h = clamp(field.h, MIN_FIELD.h, 1);
  field.x = clamp(field.x, 0, 1 - field.w);
  field.y = clamp(field.y, 0, 1 - field.h);
  return field;
}

/**
 * Convert a field's top-left fraction rect to PDF points. PDF pages have the
 * origin at the BOTTOM-left, so y flips.
 */
export function toPdfRect(field, pageW, pageH) {
  return {
    x: field.x * pageW,
    y: (1 - field.y - field.h) * pageH,
    w: field.w * pageW,
    h: field.h * pageH,
  };
}

/**
 * Is `value` a completed answer for this field?
 * Signature-like fields hold { kind: 'image', data: dataURL }; date fields
 * auto-fill at submit, so any truthy value counts; checkboxes hold booleans
 * (an unchecked optional checkbox is complete by definition).
 */
export function isFieldComplete(field, value) {
  if (field.type === 'checkbox') return !field.required || value === true;
  if (field.type === 'signature' || field.type === 'initials') {
    return Boolean(value && value.kind === 'image' && typeof value.data === 'string' && value.data.startsWith('data:image/'));
  }
  if (field.type === 'date') return Boolean(value);
  if (typeof value !== 'string') return Boolean(value);
  // A text field's answer also has to fit the type the sender asked for, or
  // "complete" would mean an email field holding a phone number.
  return value.trim().length > 0 && isValidInput(field.inputType, value);
}

/** Required fields for `signerId` that don't yet have a complete value. */
export function missingRequired(fields, values, signerId) {
  return (fields || []).filter((f) =>
    f.signerId === signerId && f.required && !isFieldComplete(f, values ? values[f.id] : undefined));
}

/* ---- Working with several fields at once --------------------------------- */

/** How far apart two edges can be and still count as aligned (page fractions). */
export const SNAP = 0.006;
/** The grid a dragged field settles onto when nothing else is near. */
export const GRID = 0.005;

/**
 * A copy of `field` on each of `pages`, same rect, same signer, same options.
 * The source page is skipped: it already has the original.
 */
export function copyFieldToPages(field, pages) {
  return pages
    .filter((page) => page !== field.page)
    .map((page) => ({ ...field, id: uid(), page }));
}

/** A copy beside the original, nudged so it cannot hide underneath it. */
export function duplicateField(field, offset = 0.02) {
  return clampField({ ...field, id: uid(), x: field.x + offset, y: field.y + offset });
}

/**
 * The nearest alignment for one edge of a moving field: the same edge, the
 * opposite edge, or the centre of another field on the page, and failing all
 * of those, the grid. Returns { value, guide } — `guide` is the line to draw,
 * or null when the field simply settled onto the grid.
 */
export function snapEdge(value, others, extent) {
  let best = null;
  for (const other of others) {
    for (const candidate of [other.start, other.end, other.start + other.size / 2 - extent / 2]) {
      const distance = Math.abs(candidate - value);
      if (distance <= SNAP && (!best || distance < best.distance)) {
        best = { value: candidate, distance, guide: candidate === other.end ? other.end : candidate };
      }
    }
  }
  if (best) return { value: best.value, guide: best.guide };
  return { value: Math.round(value / GRID) * GRID, guide: null };
}

/**
 * Where a dragged field should land: each axis snapped to the fields it is
 * being lined up with. `others` are the fields on the same page.
 */
export function snapPosition(rect, others) {
  const xs = others.map((f) => ({ start: f.x, end: f.x + f.w, size: f.w }));
  const ys = others.map((f) => ({ start: f.y, end: f.y + f.h, size: f.h }));
  const x = snapEdge(rect.x, xs, rect.w);
  const y = snapEdge(rect.y, ys, rect.h);
  return {
    x: clamp(x.value, 0, 1 - rect.w),
    y: clamp(y.value, 0, 1 - rect.h),
    guides: [x.guide === null ? null : { axis: 'x', at: x.value }, y.guide === null ? null : { axis: 'y', at: y.value }]
      .filter(Boolean),
  };
}

/** The same for a resize: the far edges move, the near ones stay put. */
export function snapSize(rect, others) {
  const xs = others.map((f) => ({ start: f.x, end: f.x + f.w, size: f.w }));
  const ys = others.map((f) => ({ start: f.y, end: f.y + f.h, size: f.h }));
  const right = snapEdge(rect.x + rect.w, xs, 0);
  const bottom = snapEdge(rect.y + rect.h, ys, 0);
  return {
    w: clamp(right.value - rect.x, MIN_FIELD.w, 1 - rect.x),
    h: clamp(bottom.value - rect.y, MIN_FIELD.h, 1 - rect.y),
    guides: [right.guide === null ? null : { axis: 'x', at: right.value },
      bottom.guide === null ? null : { axis: 'y', at: bottom.value }].filter(Boolean),
  };
}

/** Move a whole group by one delta, clamped so none of them leaves the page. */
export function shiftFields(fields, dx, dy) {
  let clampedX = dx;
  let clampedY = dy;
  for (const field of fields) {
    clampedX = clamp(clampedX, -field.x, 1 - field.w - field.x);
    clampedY = clamp(clampedY, -field.y, 1 - field.h - field.y);
  }
  return fields.map((field) => ({ ...field, x: field.x + clampedX, y: field.y + clampedY }));
}

/** Line up a group on one edge, taking the reference from the first of them. */
export function alignFields(fields, edge) {
  const [first] = fields;
  if (!first) return fields;
  return fields.map((field) => {
    if (edge === 'left') return clampField({ ...field, x: first.x });
    if (edge === 'right') return clampField({ ...field, x: first.x + first.w - field.w });
    if (edge === 'top') return clampField({ ...field, y: first.y });
    if (edge === 'bottom') return clampField({ ...field, y: first.y + first.h - field.h });
    return field;
  });
}

/** Make a group the size of the first of them. */
export function matchFieldSizes(fields) {
  const [first] = fields;
  if (!first) return fields;
  return fields.map((field) => clampField({ ...field, w: first.w, h: first.h }));
}

/* ---- Statuses ------------------------------------------------------------ */

export const DOC_STATUSES = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'squarePen' },
  sent: { label: 'Out for signature', tone: 'info', icon: 'send' },
  completed: { label: 'Completed', tone: 'ok', icon: 'circleCheckBig' },
  declined: { label: 'Declined', tone: 'danger', icon: 'circleX' },
  expired: { label: 'Expired', tone: 'warn', icon: 'hourglass' },
  voided: { label: 'Voided', tone: 'neutral', icon: 'ban' },
};

export const SIGNER_STATUSES = {
  // 'waiting' is DERIVED, never stored: with sequential signing on it stands
  // in for pending/viewed until every earlier signer has signed.
  waiting: { label: 'Waiting', tone: 'neutral', icon: 'hourglass' },
  pending: { label: 'Pending', tone: 'neutral', icon: 'clock' },
  viewed: { label: 'Viewed', tone: 'info', icon: 'eye' },
  signed: { label: 'Signed', tone: 'ok', icon: 'circleCheck' },
  declined: { label: 'Declined', tone: 'danger', icon: 'circleX' },
};

export function docStatusMeta(status) {
  return DOC_STATUSES[status] || DOC_STATUSES.draft;
}

export function signerStatusMeta(status) {
  return SIGNER_STATUSES[status] || SIGNER_STATUSES.pending;
}

/** A human-readable line for one audit event. */
export function auditLabel(event) {
  const d = event.detail || '';
  switch (event.type) {
    case 'created': return d ? `Document created from ${d}` : 'Document created';
    case 'sent': return d ? `Sent for signature to ${d}` : 'Sent for signature';
    case 'viewed': return d ? `Viewed by ${d}` : 'Viewed';
    case 'signed': return d ? `Signed by ${d}` : 'Signed';
    case 'declined': return d ? `Declined by ${d}` : 'Declined';
    case 'completed': return 'Completed. All signers have signed';
    case 'voided': return d ? `Voided: ${d}` : 'Voided';
    case 'emailed': return d ? `Emailed to ${d}` : 'Emailed to signers';
    case 'reminder_sent': return d ? `Reminder sent to ${d}` : 'Reminder sent';
    case 'link_copied': return d ? `Sign link copied for ${d}` : 'Sign link copied';
    case 'duplicated': return d ? `Duplicated from "${d}"` : 'Duplicated from another document';
    case 'from_template': return d ? `Created from template "${d}"` : 'Created from a template';
    case 'template_saved': return d ? `Saved as template "${d}"` : 'Saved as a template';
    case 'owner_notified': return d ? `You were emailed about ${d}` : 'You were emailed about this document';
    case 'merged': return d ? `Built from ${d}` : 'Built from several files';
    case 'pages_changed': return d ? `Pages edited: ${d}` : 'Pages edited';
    case 'pages_added': return d ? `Pages added from ${d}` : 'Pages added';
    case 'expired': return d ? `Expired: ${d}` : 'Expired. The sign links no longer work';
    case 'extended': return d ? `Expiry extended to ${d}` : 'Expiry extended';
    case 'expiry_cleared': return 'Expiry removed. The links do not run out';
    case 'corrected': return d ? `Signer corrected: ${d}` : 'A signer was corrected';
    case 'link_reissued': return d ? `Sign link reissued for ${d}` : 'Sign link reissued';
    case 'code_failed': return d ? `Wrong access code entered for ${d}` : 'Wrong access code entered';
    case 'code_locked': return d ? `Access code locked after repeated failures for ${d}` : 'Access code locked after repeated failures';
    case 'code_unlocked': return d ? `${d} entered their access code` : 'Access code accepted';
    case 'code_set': return d ? `Access code set for ${d}` : 'Access code set';
    case 'code_cleared': return d ? `Access code removed for ${d}` : 'Access code removed';
    case 'consented': return d ? `${d} agreed to sign electronically` : 'Agreed to sign electronically';
    case 'turn_opened': return d ? `${d}'s turn to sign` : 'The next signer\'s turn opened';
    default: return d ? `${event.type}: ${d}` : event.type;
  }
}

/** Six distinguishable signer slots; indexes wrap for signer seven onward. */
export const SIGNER_COLOR_COUNT = 6;

export function signerColor(signer, signers) {
  const index = (signers || []).findIndex((s) => s.id === signer.id);
  return ((index < 0 ? 0 : index) % SIGNER_COLOR_COUNT) + 1;
}

/** "2 of 3 signed" for list rows and headers. */
export function signerProgress(doc) {
  const total = (doc.signers || []).length;
  const signed = (doc.signers || []).filter((s) => s.status === 'signed').length;
  return { signed, total };
}

/**
 * How the sender handed out the links: 'email', 'link' (copied by hand), or
 * '' when the document was sent before the choice was recorded and nothing
 * has been emailed since. Everything the app does on its own later follows
 * this, and the sign worker is told too, so a signer waiting their turn can be
 * told how they will hear about it.
 */
export function sendChannel(doc) {
  if (doc.channel === 'email' || doc.channel === 'link') return doc.channel;
  return Object.keys(doc.emailed || {}).some((k) => k.endsWith(':request')) ? 'email' : '';
}

/* ---- Signing order ------------------------------------------------------- */

/**
 * Sequential signing: `doc.signers` IS the order, so there is no separate
 * position to keep in sync with it, and reordering is an array move.
 *
 * Is it this signer's turn? Without the toggle, always. With it, only once
 * every signer ahead of them has signed. A signer who is not on the document
 * has no turn.
 */
export function isSignerTurn(doc, signerId) {
  const signers = doc.signers || [];
  const index = signers.findIndex((s) => s.id === signerId);
  if (index < 0) return false;
  if (!doc.signOrder) return true;
  return signers.slice(0, index).every((s) => s.status === 'signed');
}

/** The signer the document is currently waiting on, or null. */
export function currentTurn(doc) {
  if (!doc.signOrder) return null;
  return (doc.signers || []).find((s) => s.status !== 'signed' && s.status !== 'declined') || null;
}

/**
 * The status to SHOW for a signer: their own, unless sequential signing means
 * their turn has not opened yet, which reads as 'waiting'.
 */
export function effectiveSignerStatus(doc, signer) {
  const status = signer.status || 'pending';
  if (!doc.signOrder || (status !== 'pending' && status !== 'viewed')) return status;
  return isSignerTurn(doc, signer.id) ? status : 'waiting';
}

/* ---- Expiry and reminders ------------------------------------------------ */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Options offered when sending, and as the default in settings. */
export const EXPIRY_CHOICES = [
  { days: 0, label: 'No expiry' },
  { days: 7, label: 'In 7 days' },
  { days: 14, label: 'In 14 days' },
  { days: 30, label: 'In 30 days' },
];

export const REMINDER_CHOICES = [
  { days: 0, label: 'No reminders' },
  { days: 3, label: 'Every 3 days' },
  { days: 7, label: 'Every week' },
];

/** Days before expiry that the last-call reminder goes out. */
export const PRE_EXPIRY_DAYS = 2;

/** Is this document past its expiry? Documents with no expiry never are. */
export function isExpired(doc, now = Date.now()) {
  return Boolean(doc.expiresAt) && doc.expiresAt <= now;
}

/** "in 5 days", "in 4 hours", "today" — how long a signer has left. */
export function expiresInWords(doc, now = Date.now()) {
  if (!doc.expiresAt) return '';
  const left = doc.expiresAt - now;
  if (left <= 0) return 'expired';
  const days = Math.floor(left / DAY_MS);
  if (days >= 1) return `in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.round(left / (60 * 60 * 1000)));
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Is a reminder due, and why? Two triggers: the document's own schedule
 * (counted from the last reminder, or from the send if there has been none),
 * and one last call before it expires. Nothing is due once the document has
 * expired: chasing a link that no longer works is worse than silence.
 *
 * The last call waits a day after the last thing the signer was sent. A
 * deadline a day or two out put the whole document inside the last-call
 * window from the moment it was sent, so the request went out and the
 * "reminder" followed it within the minute - and the request already states
 * the deadline.
 *
 * Returns 'schedule' | 'expiry' | ''.
 */
export function reminderDue(doc, now = Date.now()) {
  if (doc.status !== 'sent' || doc.sample) return '';
  if (isExpired(doc, now)) return '';
  const plan = doc.reminder || {};
  const outstanding = (doc.signers || []).some((s) => !s.isMe
    && s.status !== 'signed' && s.status !== 'declined' && isSignerTurn(doc, s.id));
  if (!outstanding) return '';
  if (doc.expiresAt && plan.beforeExpiry !== false && !plan.preExpiryAt) {
    const heard = Math.max(plan.lastAt || 0, doc.sentAt || 0);
    if (now >= doc.expiresAt - PRE_EXPIRY_DAYS * DAY_MS && now - heard >= DAY_MS) return 'expiry';
  }
  const every = Number(plan.every) || 0;
  if (!every) return '';
  const since = plan.lastAt || doc.sentAt || 0;
  if (!since) return '';
  return now - since >= every * DAY_MS ? 'schedule' : '';
}

/**
 * The doc status implied by its signers and the clock: any decline wins,
 * everyone signed completes, an unfinished document past its expiry expires,
 * and extending one puts it back out for signature.
 */
export function deriveStatus(doc, now = Date.now()) {
  if (doc.status === 'voided') return 'voided';
  const signers = doc.signers || [];
  if (signers.some((s) => s.status === 'declined')) return 'declined';
  if (doc.status !== 'draft' && signers.length && signers.every((s) => s.status === 'signed')) {
    return 'completed';
  }
  if (doc.status === 'sent' && isExpired(doc, now)) return 'expired';
  // An extension is just a date in the future again.
  if (doc.status === 'expired' && !isExpired(doc, now)) return 'sent';
  return doc.status;
}

/* ---- Templates and duplicates ------------------------------------------- */

/**
 * A template's reusable payload, derived from a document: each signer becomes
 * a ROLE ("Client", "Contractor") and every field is re-keyed to that role,
 * so the layout can be reused with different people in it.
 */
export function templateSeed(doc) {
  const signers = doc.signers || [];
  const roles = signers.map((signer, index) => ({
    id: uid(),
    label: (signer.name || '').trim() || (signer.isMe ? 'Me' : `Signer ${index + 1}`),
    isMe: Boolean(signer.isMe),
  }));
  const roleOf = new Map(signers.map((signer, index) => [signer.id, roles[index].id]));
  const fields = (doc.fields || [])
    .filter((field) => roleOf.has(field.signerId))
    .map(({ id, signerId, ...rest }) => ({ ...rest, id: uid(), roleId: roleOf.get(signerId) }));
  return { roles, fields };
}

/**
 * Signers and fields for a new draft from a template. `values` maps a role id
 * to { name, email }; ids are minted fresh so the new draft shares nothing
 * with the template or with earlier drafts made from it.
 */
export function templateInstance(template, values = {}) {
  const roles = template.roles || [];
  const signers = roles.map((role) => {
    const value = values[role.id] || {};
    return {
      id: uid(),
      name: String(value.name || '').trim(),
      email: String(value.email || '').trim(),
      isMe: Boolean(role.isMe),
      roleLabel: role.label,
      status: 'pending',
    };
  });
  const signerOf = new Map(roles.map((role, index) => [role.id, signers[index].id]));
  const fields = (template.fields || [])
    .filter((field) => signerOf.has(field.roleId))
    .map(({ id, roleId, ...rest }) => ({ ...rest, id: uid(), signerId: signerOf.get(roleId) }));
  return { signers, fields };
}

/**
 * Signers and fields for a copy of `doc`: the same people and layout, every
 * id fresh and every signer back to pending, so the copy carries none of the
 * original's signatures or links.
 */
export function duplicateSeed(doc) {
  const source = doc.signers || [];
  const signers = source.map((signer) => ({
    id: uid(),
    name: signer.name || '',
    email: signer.email || '',
    isMe: Boolean(signer.isMe),
    ...(signer.roleLabel ? { roleLabel: signer.roleLabel } : {}),
    status: 'pending',
  }));
  const signerOf = new Map(source.map((signer, index) => [signer.id, signers[index].id]));
  const fields = (doc.fields || [])
    .filter((field) => signerOf.has(field.signerId))
    .map((field) => ({ ...field, id: uid(), signerId: signerOf.get(field.signerId) }));
  return { signers, fields };
}
