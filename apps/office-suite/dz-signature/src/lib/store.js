/**
 * Data layer on top of Puter.
 *
 * Storage design:
 *
 *  KV (small, hot records; one kv.list on boot, point reads after):
 *    sig:settings:v1    { theme, fullName, onboarded, sampleData, ... }
 *    sig:doc:<id>       one document record: signers, fields, statuses,
 *                       links, audit trail. Never holds image data.
 *    sig:tpl:<id>       a reusable template: roles + field layout
 *    sig:worker:cfg:v1  the per-user sign worker (managed by signlinks.js)
 *    sig:signature:v1   the owner's reusable signature images
 *
 *  FS (bulky, per document):
 *    signatures-data/<id>/original.pdf   the uploaded file
 *    signatures-data/<id>/sigdata.json   field values incl. signature images
 *    signatures-data/<id>/signed.pdf     flattened copy, written on completion
 *    signatures-data/templates/<id>/original.pdf   a template's own PDF
 */

import { coerce, copyTitle, formatDate, sha256HexBytes, uid } from './util.js';
import { deriveStatus, templateSeed, templateInstance, duplicateSeed } from './model.js';

export const KV_KEYS = {
  settings: 'sig:settings:v1',
  docPrefix: 'sig:doc:',
  tplPrefix: 'sig:tpl:',
  workerCfg: 'sig:worker:cfg:v1',
  signature: 'sig:signature:v1',
};

export const DATA_DIR = 'signatures-data';
export const pdfPath = (id) => `${DATA_DIR}/${id}/original.pdf`;
export const signedPdfPath = (id) => `${DATA_DIR}/${id}/signed.pdf`;
export const sigDataPath = (id) => `${DATA_DIR}/${id}/sigdata.json`;
export const templateDir = (id) => `${DATA_DIR}/templates/${id}`;
export const templatePdfPath = (id) => `${templateDir(id)}/original.pdf`;

export const DEFAULT_SETTINGS = {
  theme: 'system',
  fullName: '',
  onboarded: false,
  sampleData: false,
  // Being told about your own document. A decline and a completion are things
  // you have to act on; every individual signature is noise for most people,
  // so that one is off until asked for.
  notifySign: false,
  notifyDecline: true,
  notifyComplete: true,
  // Sending defaults, offered (and changeable) in the send flow.
  defaultExpiryDays: 0,
  defaultReminderDays: 0,
};

const MAX_AUDIT = 200;

/**
 * True when an fs read failed because the file doesn't exist rather than a
 * transport failure. Puter rejects missing paths with
 * { code: 'subject_does_not_exist' }; the message match covers other SDK
 * builds and test mocks.
 */
export function isMissingFileError(err) {
  const code = err?.code ?? err?.error?.code;
  if (typeof code === 'string' && /does_not_exist|not_found/.test(code)) return true;
  const msg = String(err?.message ?? err?.error?.message ?? '');
  return /no such file|not found|does not exist/i.test(msg);
}

export function createStore({ getPuter = () => (typeof puter !== 'undefined' ? puter : null) } = {}) {
  const events = new EventTarget();
  const docs = new Map(); // id -> record
  const templates = new Map(); // id -> template record
  let settings = { ...DEFAULT_SETTINGS };
  let user = null;
  let savedSignature = null; // lazily loaded
  let savedSignatureLoaded = false;

  const p = () => {
    const sdk = getPuter();
    if (!sdk) throw new Error('Puter SDK is unavailable');
    return sdk;
  };

  function emit() {
    events.dispatchEvent(new Event('change'));
  }

  /* ---- Boot ------------------------------------------------------------- */

  async function init() {
    try {
      user = await p().auth.getUser();
    } catch {
      user = null;
    }
    const [storedSettings, entries, tplEntries] = await Promise.all([
      p().kv.get(KV_KEYS.settings),
      p().kv.list(`${KV_KEYS.docPrefix}*`, true),
      p().kv.list(`${KV_KEYS.tplPrefix}*`, true).catch(() => []),
    ]);
    settings = { ...DEFAULT_SETTINGS, ...(coerce(storedSettings) || {}) };
    docs.clear();
    for (const entry of entries || []) {
      if (!entry || typeof entry.key !== 'string') continue;
      const value = coerce(entry.value);
      if (!value || typeof value !== 'object' || !value.id) continue;
      docs.set(value.id, value);
    }
    templates.clear();
    for (const entry of tplEntries || []) {
      if (!entry || typeof entry.key !== 'string') continue;
      const value = coerce(entry.value);
      if (!value || typeof value !== 'object' || !value.id) continue;
      templates.set(value.id, value);
    }
  }

  /* ---- Settings ----------------------------------------------------------- */

  async function updateSettings(patch) {
    settings = { ...settings, ...patch };
    await p().kv.set(KV_KEYS.settings, settings);
    emit();
    return settings;
  }

  /* ---- Documents ----------------------------------------------------------- */

  function getDoc(id) {
    return docs.get(id) || null;
  }

  function listDocs() {
    return [...docs.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  const nextCopyTitle = (title) => copyTitle(title, [...docs.values()].map((d) => d.title));

  function addAudit(doc, type, detail = '') {
    doc.audit = doc.audit || [];
    doc.audit.push({ at: Date.now(), type, detail });
    if (doc.audit.length > MAX_AUDIT) doc.audit = doc.audit.slice(-MAX_AUDIT);
  }

  async function persistDoc(doc) {
    doc.updatedAt = Date.now();
    await p().kv.set(KV_KEYS.docPrefix + doc.id, doc);
    docs.set(doc.id, doc);
    emit();
    return doc;
  }

  /**
   * Create a draft from an uploaded PDF. `pdfBytes` may be an ArrayBuffer,
   * a typed array, or a Blob. The absolute path returned by fs.write is kept
   * on the record: the sign worker reads the file by that path, and absolute
   * paths stay valid outside this app's own working directory.
   *
   * `signers`/`fields`/`note` seed the draft (a duplicate or a template
   * instance arrives fully laid out), and `origin` records where it came
   * from as a second audit line after the 'created' one.
   */
  async function createDoc({
    title, fileName, pdfBytes, pageCount,
    note = '', signers = null, fields = null, origin = null, signOrder = false,
  }) {
    const id = uid();
    const data = pdfBytes instanceof Blob ? pdfBytes : new Blob([pdfBytes], { type: 'application/pdf' });
    const written = await p().fs.write(pdfPath(id), data, { createMissingParents: true });
    const doc = {
      id,
      title: String(title || fileName || 'Untitled document').trim() || 'Untitled document',
      fileName: fileName || 'document.pdf',
      pageCount: pageCount || 1,
      note,
      status: 'draft',
      signers: signers || [],
      fields: fields || [],
      // Sequential signing is part of the layout, not of one send: a copy or a
      // template instance has to arrive with the order its source used.
      signOrder: signOrder === true,
      links: {},
      emailed: {},
      audit: [],
      pdfAbsPath: (written && written.path) || null,
      sample: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sentAt: null,
      completedAt: null,
    };
    addAudit(doc, 'created', doc.fileName);
    if (origin && origin.type) addAudit(doc, origin.type, origin.detail || '');
    return persistDoc(doc);
  }

  /**
   * A fresh draft with this document's PDF, people, and field layout, and
   * none of its history: no links, no signatures, every signer pending.
   */
  async function duplicateDoc(id, { title = null } = {}) {
    const source = docs.get(id);
    if (!source) throw new Error('Document not found');
    const bytes = await readPdf(id);
    const { signers, fields } = duplicateSeed(source);
    return createDoc({
      title: title || nextCopyTitle(source.title),
      fileName: source.fileName,
      pdfBytes: bytes,
      pageCount: source.pageCount,
      note: source.note || '',
      signers,
      fields,
      signOrder: source.signOrder === true,
      origin: { type: 'duplicated', detail: source.title },
    });
  }

  /**
   * Swap the file of a DRAFT (pages reordered, rotated, deleted, or added).
   * Only ever a draft: once links exist, signers have been served that exact
   * file, and the fingerprint on the certificate says so.
   */
  async function replacePdf(id, bytes, pageCount, { fields = null, audit = null } = {}) {
    const doc = docs.get(id);
    if (!doc) throw new Error('Document not found');
    if (doc.status !== 'draft') throw new Error('Only a draft can be rebuilt');
    const written = await p().fs.write(
      pdfPath(id),
      new Blob([bytes], { type: 'application/pdf' }),
      { createMissingParents: true },
    );
    doc.pdfAbsPath = (written && written.path) || doc.pdfAbsPath;
    doc.pageCount = pageCount;
    // A failed send may already have fingerprinted this draft. Its new
    // bytes need a new fingerprint when sending is retried.
    doc.fingerprint = null;
    if (fields) doc.fields = fields;
    if (audit) addAudit(doc, audit.type, audit.detail || '');
    return persistDoc(doc);
  }

  async function patchDoc(id, patch) {
    const doc = docs.get(id);
    if (!doc) throw new Error('Document not found');
    Object.assign(doc, patch);
    return persistDoc(doc);
  }

  async function deleteDoc(id) {
    await p().kv.del(KV_KEYS.docPrefix + id);
    docs.delete(id);
    try {
      await p().fs.delete(`${DATA_DIR}/${id}`, { recursive: true });
    } catch {
      /* the record is gone; stray files are harmless */
    }
    emit();
  }

  /* ---- Files ---------------------------------------------------------------- */

  async function readPdf(id) {
    const blob = await p().fs.read(pdfPath(id));
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function readSigData(id) {
    try {
      const blob = await p().fs.read(sigDataPath(id));
      return coerce(await blob.text()) || {};
    } catch (err) {
      if (isMissingFileError(err)) return {};
      throw err;
    }
  }

  async function mergeSigData(id, patch) {
    const current = await readSigData(id);
    const merged = { ...current, ...patch };
    await p().fs.write(sigDataPath(id), JSON.stringify(merged), { createMissingParents: true });
    return merged;
  }

  async function writeSignedPdf(id, bytes) {
    await p().fs.write(signedPdfPath(id), new Blob([bytes], { type: 'application/pdf' }), {
      createMissingParents: true,
    });
  }

  async function readSignedPdf(id) {
    try {
      const blob = await p().fs.read(signedPdfPath(id));
      return new Uint8Array(await blob.arrayBuffer());
    } catch (err) {
      if (isMissingFileError(err)) return null;
      throw err;
    }
  }

  /* ---- Templates ------------------------------------------------------------ */

  function getTemplate(id) {
    return templates.get(id) || null;
  }

  function listTemplates() {
    return [...templates.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function persistTemplate(template) {
    template.updatedAt = Date.now();
    await p().kv.set(KV_KEYS.tplPrefix + template.id, template);
    templates.set(template.id, template);
    emit();
    return template;
  }

  /**
   * Save a document's PDF and field layout as a reusable template. The PDF is
   * COPIED, not referenced: deleting the document later must not break the
   * template.
   */
  async function saveTemplateFromDoc(doc, { name } = {}) {
    const bytes = await readPdf(doc.id);
    const id = uid();
    const written = await p().fs.write(
      templatePdfPath(id),
      new Blob([bytes], { type: 'application/pdf' }),
      { createMissingParents: true },
    );
    const { roles, fields } = templateSeed(doc);
    return persistTemplate({
      id,
      name: String(name || doc.title || 'Untitled template').trim().slice(0, 120) || 'Untitled template',
      fileName: doc.fileName || 'document.pdf',
      pageCount: doc.pageCount || 1,
      note: doc.note || '',
      roles,
      fields,
      signOrder: doc.signOrder === true,
      pdfAbsPath: (written && written.path) || null,
      useCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function patchTemplate(id, patch) {
    const template = templates.get(id);
    if (!template) throw new Error('Template not found');
    Object.assign(template, patch);
    return persistTemplate(template);
  }

  async function deleteTemplate(id) {
    await p().kv.del(KV_KEYS.tplPrefix + id);
    templates.delete(id);
    try {
      await p().fs.delete(templateDir(id), { recursive: true });
    } catch {
      /* the record is gone; stray files are harmless */
    }
    emit();
  }

  async function readTemplatePdf(id) {
    const blob = await p().fs.read(templatePdfPath(id));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * A new draft from a template. `roleValues` maps a role id to
   * { name, email }; the template itself is never modified beyond its
   * usage counters.
   */
  async function createDocFromTemplate(id, { title = null, roleValues = {} } = {}) {
    const template = templates.get(id);
    if (!template) throw new Error('Template not found');
    const bytes = await readTemplatePdf(id);
    const { signers, fields } = templateInstance(template, roleValues);
    const doc = await createDoc({
      title: title || template.name,
      fileName: template.fileName,
      pdfBytes: bytes,
      pageCount: template.pageCount,
      note: template.note || '',
      signers,
      fields,
      signOrder: template.signOrder === true,
      origin: { type: 'from_template', detail: template.name },
    });
    await patchTemplate(id, {
      useCount: (template.useCount || 0) + 1,
      lastUsedAt: Date.now(),
    }).catch(() => {});
    return doc;
  }

  /* ---- Status transitions ------------------------------------------------- */

  /**
   * The draft goes out: capability links are minted, signers start pending,
   * and the deadline and reminder schedule chosen while sending are stamped
   * on the record.
   *
   * `channel` is how the sender chose to hand out the links ('email' or
   * 'link'). Everything the app sends on its own later - the next request
   * when a turn opens, the completion notices - follows it. It is recorded
   * as a choice rather than inferred from what went out, because with
   * sequential signing and the owner first, nothing goes out at the send.
   */
  async function markSent(id, links, { expiresAt = null, reminder = null, channel = null } = {}) {
    const doc = docs.get(id);
    if (!doc) throw new Error('Document not found');
    doc.status = 'sent';
    doc.sentAt = Date.now();
    doc.links = links || {};
    if (expiresAt !== null) doc.expiresAt = expiresAt || null;
    if (reminder) doc.reminder = { ...reminder, lastAt: 0, preExpiryAt: 0 };
    if (channel === 'email' || channel === 'link') doc.channel = channel;
    for (const signer of doc.signers) {
      if (!signer.status) signer.status = 'pending';
    }
    addAudit(doc, 'sent', `${doc.signers.length} signer${doc.signers.length === 1 ? '' : 's'}`);
    return persistDoc(doc);
  }

  /**
   * The owner agreed to sign electronically in the app. Same record as an
   * external signer's, minus the parts only a request can know (IP, browser
   * as the edge saw it): the app is the client here.
   */
  async function recordConsent(id, signerId, { version, tzOffset, tzName } = {}) {
    const doc = docs.get(id);
    if (!doc) throw new Error('Document not found');
    const signer = doc.signers.find((s) => s.id === signerId);
    if (!signer) throw new Error('Signer not found');
    if (signer.consentAt) return doc;
    const at = Date.now();
    signer.consentAt = at;
    signer.consentVersion = version || '';
    signer.evidence = {
      ...(signer.evidence || {}),
      consent: { at, ip: '', ua: typeof navigator !== 'undefined' ? navigator.userAgent : '', tzOffset, tzName },
    };
    addAudit(doc, 'consented', signer.name || signer.email);
    return persistDoc(doc);
  }

  /**
   * The fingerprint of the file signers are served: recorded when the
   * document goes out, printed on the certificate, so a completed copy can be
   * tied to exactly the bytes that were signed.
   */
  async function recordFingerprint(id) {
    const doc = docs.get(id);
    if (!doc) throw new Error('Document not found');
    if (doc.fingerprint && doc.fingerprint.hex) return doc.fingerprint;
    const hex = await sha256HexBytes(await readPdf(id));
    const fingerprint = { alg: 'SHA-256', hex, at: Date.now() };
    await patchDoc(id, { fingerprint });
    return fingerprint;
  }

  /**
   * The deadline passed. The worker already refuses the links; this is the
   * owner's copy catching up, so the list and the trail say so too.
   */
  async function markExpired(id) {
    const doc = docs.get(id);
    if (!doc || doc.status !== 'sent') return null;
    doc.status = 'expired';
    addAudit(doc, 'expired', formatDate(doc.expiresAt));
    return persistDoc(doc);
  }

  /**
   * Move the deadline (or drop it). An expired document goes back out for
   * signature, which is exactly what deriveStatus already says about a
   * deadline in the future.
   *
   * A moved deadline gets a last call of its own: the one already sent was
   * about the old date, and leaving it on record meant an extended document
   * ran out with no warning to anyone.
   */
  async function setExpiry(id, expiresAt) {
    const doc = docs.get(id);
    if (!doc) throw new Error('Document not found');
    const moved = (expiresAt || null) !== (doc.expiresAt || null);
    doc.expiresAt = expiresAt || null;
    if (moved && doc.reminder && doc.reminder.preExpiryAt) {
      doc.reminder = { ...doc.reminder, preExpiryAt: 0 };
    }
    if (expiresAt) addAudit(doc, 'extended', formatDate(expiresAt));
    else addAudit(doc, 'expiry_cleared');
    doc.status = deriveStatus(doc);
    return persistDoc(doc);
  }

  /** Remember that a reminder went out, so the schedule counts from here. */
  async function markReminded(id, { preExpiry = false } = {}) {
    const doc = docs.get(id);
    if (!doc) return null;
    const now = Date.now();
    doc.reminder = {
      ...(doc.reminder || {}),
      lastAt: now,
      preExpiryAt: preExpiry ? now : (doc.reminder || {}).preExpiryAt || 0,
    };
    return persistDoc(doc);
  }

  async function voidDoc(id, reason = '') {
    const doc = docs.get(id);
    if (!doc) throw new Error('Document not found');
    doc.status = 'voided';
    addAudit(doc, 'voided', reason);
    return persistDoc(doc);
  }

  /** Record that a signer finished in-app (the owner signing their own fields). */
  async function markSignerSigned(id, signerId, values) {
    const doc = docs.get(id);
    if (!doc) throw new Error('Document not found');
    const signer = doc.signers.find((s) => s.id === signerId);
    if (!signer) throw new Error('Signer not found');
    if (values && Object.keys(values).length) await mergeSigData(id, values);
    signer.status = 'signed';
    signer.signedAt = Date.now();
    signer.evidence = {
      ...(signer.evidence || {}),
      sign: {
        at: signer.signedAt,
        ip: '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        tzOffset: -new Date().getTimezoneOffset(),
        tzName: (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
          } catch {
            return '';
          }
        })(),
      },
    };
    addAudit(doc, 'signed', signer.name || signer.email || 'Signer');
    return finishStatusChange(doc);
  }

  /**
   * Merge signer responses pulled from the sign worker. Newer-wins per signer:
   * a stale pull must never regress "signed" back to "viewed".
   * `responses`: [{ signerId, status, viewedAt, signedAt, declinedAt,
   *               declineReason, values }]
   * Returns { changed, completedNow, declinedNow }.
   */
  async function applyResponses(id, responses) {
    const current = docs.get(id);
    if (!current || !Array.isArray(responses) || !responses.length) {
      return { changed: false, completedNow: false, declinedNow: false };
    }
    // Publish responses only after their values and record are saved. A
    // failed write must leave the document eligible for the next pull;
    // marking it completed in memory would stop that retry entirely.
    const doc = structuredClone(current);
    const rank = { pending: 0, viewed: 1, signed: 2, declined: 2 };
    let changed = false;
    const values = {};
    for (const r of responses) {
      const signer = doc.signers.find((s) => s.id === r.signerId);
      if (!signer) continue;
      const currentRank = rank[signer.status || 'pending'] ?? 0;
      const nextRank = rank[r.status] ?? 0;
      if (r.viewedAt && !signer.viewedAt) {
        signer.viewedAt = r.viewedAt;
        changed = true;
      }
      // The signer agreed to sign electronically. First agreement wins, and
      // it is worth an audit line of its own.
      if (r.consentAt && !signer.consentAt) {
        signer.consentAt = r.consentAt;
        signer.consentVersion = r.consentVersion || '';
        addAudit(doc, 'consented', signer.name || signer.email);
        changed = true;
      }
      // The access-code gate. Failures and unlocks are the owner's business:
      // they are the signal that a link went somewhere it should not have.
      if (r.code && typeof r.code === 'object') {
        const seen = signer.codeSeen || {};
        if (r.code.lastFailAt && r.code.lastFailAt !== seen.lastFailAt) {
          addAudit(doc, r.code.lockedUntil > Date.now() ? 'code_locked' : 'code_failed',
            signer.name || signer.email);
          changed = true;
        }
        if (r.code.unlockedAt && !seen.unlockedAt) {
          addAudit(doc, 'code_unlocked', signer.name || signer.email);
          changed = true;
        }
        if (r.code.lastFailAt !== seen.lastFailAt || r.code.unlockedAt !== seen.unlockedAt
          || r.code.fails !== seen.fails) {
          signer.codeSeen = {
            fails: r.code.fails || 0,
            lastFailAt: r.code.lastFailAt || 0,
            unlockedAt: r.code.unlockedAt || 0,
            lockedUntil: r.code.lockedUntil || 0,
          };
          changed = true;
        }
      }
      // The technical context of each act, for the certificate.
      if (r.evidence && typeof r.evidence === 'object') {
        const merged = { ...(signer.evidence || {}) };
        for (const [key, value] of Object.entries(r.evidence)) {
          if (value && !merged[key]) merged[key] = value;
        }
        if (JSON.stringify(merged) !== JSON.stringify(signer.evidence || {})) {
          signer.evidence = merged;
          changed = true;
        }
      }
      if (nextRank > currentRank) {
        signer.status = r.status;
        if (r.status === 'viewed') addAudit(doc, 'viewed', signer.name || signer.email);
        if (r.status === 'signed') {
          signer.signedAt = r.signedAt || Date.now();
          addAudit(doc, 'signed', signer.name || signer.email);
        }
        if (r.status === 'declined') {
          signer.declinedAt = r.declinedAt || Date.now();
          signer.declineReason = String(r.declineReason || '').slice(0, 500);
          addAudit(doc, 'declined', signer.name || signer.email);
        }
        changed = true;
      }
      if (r.values && typeof r.values === 'object') Object.assign(values, r.values);
    }
    if (!changed && !Object.keys(values).length) {
      return { changed: false, completedNow: false, declinedNow: false };
    }
    if (Object.keys(values).length) await mergeSigData(id, values);
    return finishStatusChange(doc);
  }

  /** Recompute the doc status after signer changes and persist. */
  async function finishStatusChange(doc) {
    const before = doc.status;
    const next = deriveStatus(doc);
    const completedNow = next === 'completed' && before !== 'completed';
    const declinedNow = next === 'declined' && before !== 'declined';
    doc.status = next;
    if (completedNow) {
      doc.completedAt = Date.now();
      addAudit(doc, 'completed');
    }
    await persistDoc(doc);
    return { changed: true, completedNow, declinedNow, doc };
  }

  /* ---- Saved signature ------------------------------------------------------ */

  async function getSavedSignature() {
    if (!savedSignatureLoaded) {
      savedSignature = coerce(await p().kv.get(KV_KEYS.signature));
      savedSignatureLoaded = true;
    }
    return savedSignature;
  }

  async function setSavedSignature(value) {
    savedSignature = value;
    savedSignatureLoaded = true;
    if (value) await p().kv.set(KV_KEYS.signature, value);
    else await p().kv.del(KV_KEYS.signature);
  }

  /* ---- Sample data ----------------------------------------------------------- */

  /**
   * Import a prepared dataset: [{ doc, pdfBytes, sigData }]. Used by
   * onboarding's "explore with sample data".
   */
  async function importDataset(items) {
    for (const item of items) {
      const written = await p().fs.write(
        pdfPath(item.doc.id),
        new Blob([item.pdfBytes], { type: 'application/pdf' }),
        { createMissingParents: true },
      );
      item.doc.pdfAbsPath = (written && written.path) || null;
      if (item.sigData && Object.keys(item.sigData).length) {
        await p().fs.write(sigDataPath(item.doc.id), JSON.stringify(item.sigData), {
          createMissingParents: true,
        });
      }
      await p().kv.set(KV_KEYS.docPrefix + item.doc.id, item.doc);
      docs.set(item.doc.id, item.doc);
    }
    await updateSettings({ sampleData: true, onboarded: true });
  }

  async function wipeSampleData() {
    for (const doc of [...docs.values()]) {
      if (doc.sample) await deleteDoc(doc.id);
    }
    await updateSettings({ sampleData: false });
  }

  return {
    init,
    // events
    addEventListener: (...a) => events.addEventListener(...a),
    removeEventListener: (...a) => events.removeEventListener(...a),
    // state
    get settings() { return settings; },
    get user() { return user; },
    // settings
    updateSettings,
    // documents
    createDoc,
    duplicateDoc,
    replacePdf,
    getDoc,
    listDocs,
    patchDoc,
    persistDoc,
    deleteDoc,
    addAudit,
    // templates
    getTemplate,
    listTemplates,
    saveTemplateFromDoc,
    patchTemplate,
    deleteTemplate,
    readTemplatePdf,
    createDocFromTemplate,
    // files
    readPdf,
    readSigData,
    mergeSigData,
    writeSignedPdf,
    readSignedPdf,
    // transitions
    markSent,
    markExpired,
    setExpiry,
    markReminded,
    recordConsent,
    recordFingerprint,
    voidDoc,
    markSignerSigned,
    applyResponses,
    // saved signature
    getSavedSignature,
    setSavedSignature,
    // sample data
    importDataset,
    wipeSampleData,
  };
}

/** The app-wide singleton. Views import this; tests build their own. */
export const store = createStore();
