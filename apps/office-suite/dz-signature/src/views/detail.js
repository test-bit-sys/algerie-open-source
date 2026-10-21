/**
 * Document detail: live signer statuses, per-signer actions (copy link,
 * remind), the audit trail, downloads, and the read-only page preview with
 * every collected signature in place.
 */

import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { signlinks, emailer } from '../lib/services.js';
import { openPdf } from '../lib/pdfdoc.js';
import {
  docStatusMeta, signerStatusMeta, signerColor, signerProgress, auditLabel,
  effectiveSignerStatus, isSignerTurn, currentTurn, displayValue,
  expiresInWords, isExpired, REMINDER_CHOICES, DAY_MS,
} from '../lib/model.js';
import { formatDate, formatDateTime, relativeTime, initialsOf } from '../lib/util.js';
import { evidenceLine, stampWithOffset, groupHex } from '../lib/consent.js';
import { mountPages, pagesError, staticFieldBox } from '../ui/pages.js';
import { openModal } from '../ui/modal.js';
import {
  downloadOriginal, downloadSigned, copySignLink, remindSigner,
  voidDocFlow, deleteDocFlow, duplicateDocFlow, afterPull,
  resetCodeFlow, clearCodeFlow, extendExpiry,
} from '../ui/actions.js';
import { saveAsTemplateFlow } from '../ui/templates.js';
import { openCorrectSigner, canCorrect } from '../ui/correct.js';
import { toast } from '../ui/toast.js';

export function detailView({ navigate, docId }) {
  const root = el('div.main-inner');
  let doc = store.getDoc(docId);

  if (!doc) {
    root.append(el('div.empty', {},
      el('div.empty-icon', { html: icon('fileText', 26) }),
      el('h3', {}, 'Document not found'),
      el('p', {}, 'It may have been deleted on another device.'),
      el('button.btn.btn-soft', { type: 'button', style: { marginTop: '16px' }, onclick: () => navigate('#/') }, 'Back to documents')
    ));
    return root;
  }
  if (doc.status === 'draft') {
    queueMicrotask(() => navigate(`#/doc/${doc.id}/edit`));
    return root;
  }

  const headWrap = el('div');
  const sideWrap = el('div.detail-side');
  const pagesWrap = el('div.detail-main');
  let sigData = {};
  let pagesApi = null;

  /* ---- Header ------------------------------------------------------------ */

  function renderHead() {
    clear(headWrap);
    const meta = docStatusMeta(doc.status);
    headWrap.append(el('div.view-head', {},
      el('button.icon-btn', {
        type: 'button', html: icon('arrowLeft', 20), 'aria-label': 'Back to documents',
        dataset: { act: 'back' },
        onclick: () => navigate('#/'),
      }),
      el('div.grow', {},
        el('h1', { style: { fontSize: '20px' } }, doc.title),
        el('div.small.faint', {},
          `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'} · Updated ${relativeTime(doc.updatedAt)}`)),
      el('div.view-head-status', {},
        el(`span.chip.${meta.tone}`, { html: icon(meta.icon, 13, 2.2) }, el('span', {}, meta.label)))
    ));
  }

  /* ---- Side column ------------------------------------------------------------ */

  function renderSide() {
    clear(sideWrap);
    const me = doc.signers.find((s) => s.isMe);
    const canSelfSign = doc.status === 'sent' && !isExpired(doc) && me && me.status !== 'signed'
      && me.status !== 'declined' && isSignerTurn(doc, me.id);
    const { signed, total } = signerProgress(doc);

    /* Primary actions */
    const actions = [];
    if (canSelfSign) {
      actions.push(el('button.btn.btn-primary.btn-block', {
        type: 'button', html: icon('penLine', 16, 2.2),
        dataset: { act: 'sign' },
        onclick: () => navigate(`#/doc/${doc.id}/sign`),
      }, ' Sign now'));
    }
    if (doc.status === 'completed') {
      actions.push(el('button.btn.btn-primary.btn-block', {
        type: 'button', html: icon('fileDown', 16, 2),
        dataset: { act: 'download-signed' },
        onclick: () => downloadSigned(doc).catch(() => toast('Could not build the download', { icon: 'triangleAlert' })),
      }, ' Download signed copy'));
    } else if (doc.status === 'sent' && signed > 0) {
      actions.push(el('button.btn.btn-soft.btn-block', {
        type: 'button', html: icon('fileDown', 16, 2),
        dataset: { act: 'download-signed' },
        onclick: () => downloadSigned(doc).catch(() => toast('Could not build the download', { icon: 'triangleAlert' })),
      }, ' Download progress copy'));
    }
    actions.push(el('button.btn.btn-ghost.btn-block', {
      type: 'button', html: icon('download', 16, 2),
      dataset: { act: 'download-original' },
      onclick: () => downloadOriginal(doc).catch(() => toast('Could not download the file', { icon: 'triangleAlert' })),
    }, ' Download original'));
    // Sending the same paperwork again is the common next step once a
    // document is done, so both ways to do it live with the actions.
    actions.push(el('button.btn.btn-ghost.btn-block', {
      type: 'button', html: icon('copy', 16, 2),
      dataset: { act: 'duplicate' },
      onclick: () => duplicateDocFlow(doc, { navigate }),
    }, ' Duplicate as draft'));
    actions.push(el('button.btn.btn-ghost.btn-block', {
      type: 'button', html: icon('template', 16, 2),
      dataset: { act: 'template' },
      onclick: () => saveAsTemplateFlow(doc),
    }, ' Save as template'));

    /* Signers */
    const ordered = doc.signOrder === true;
    const turn = ordered ? currentTurn(doc) : null;
    const signerRows = doc.signers.map((signer, index) => {
      const shown = effectiveSignerStatus(doc, signer);
      const sMeta = signerStatusMeta(shown);
      const link = (doc.links || {})[signer.id];
      // Chasing a signer whose link still answers "not yet" would only
      // confuse them, so the bell waits for their turn too.
      const canRemind = doc.status === 'sent' && !signer.isMe && signer.status !== 'signed'
        && signer.status !== 'declined' && !doc.sample && emailer.available() && link
        && isSignerTurn(doc, signer.id);
      return el('div.signer-row', {},
        ordered
          ? el('span.order-badge', { 'aria-hidden': 'true' }, String(index + 1))
          : null,
        el(`span.avatar.c${signerColor(signer, doc.signers)}`, { 'aria-hidden': 'true' }, initialsOf(signer.name || signer.email)),
        el('div.who', {},
          // Names and addresses still ellipsize in a narrow column; the title
          // keeps the full value one hover away.
          el('div.nm', { title: signer.name || signer.email || 'Signer' },
            signer.name || signer.email || 'Signer', signer.isMe ? ' (you)' : ''),
          el('div.em', { title: signer.email || null }, signer.email || ''),
          // Date only: the exact time never fit this column and got
          // ellipsized away. The activity trail carries the full timestamp,
          // and so does the tooltip here.
          signer.status === 'signed' && signer.signedAt
            && el('div.em.when', { title: stampWithOffset(signer.signedAt, (signer.evidence || {}).sign) },
              `Signed ${formatDate(signer.signedAt)}`),
          // The technical context the worker captured, which the certificate
          // also prints. Shown here so the sender sees it as it arrives.
          signer.consentAt && el('div.em.when.evidence', {
            title: `Agreed to sign electronically ${stampWithOffset(signer.consentAt, (signer.evidence || {}).consent)}`,
            html: icon('shield', 11, 2.2),
          }, el('span', {}, [
            'Consented',
            evidenceLine((signer.evidence || {}).sign) || evidenceLine((signer.evidence || {}).consent),
          ].filter(Boolean).join(' · '))),
          signer.hasCode && el('div.em.when.evidence', { html: icon('lock', 11, 2.2) },
            el('span', {}, (signer.codeSeen || {}).lockedUntil > Date.now()
              ? 'Access code locked after failed attempts'
              : 'Access code required')),
          shown === 'waiting' && el('div.em.when', {},
            `Waits for ${doc.signers.slice(0, index).find((s) => s.status !== 'signed')?.name || 'an earlier signer'}`),
          signer.declineReason && el('div.decline-note', {}, `"${signer.declineReason}"`)
        ),
        el(`span.chip.${sMeta.tone}`, { html: icon(sMeta.icon, 12, 2.2) }, el('span', {}, sMeta.label)),
        el('div.acts', {},
          !signer.isMe && link && !doc.sample && el('button.icon-btn', {
            type: 'button', html: icon('link', 16), title: 'Copy sign link',
            'aria-label': `Copy sign link for ${signer.name || signer.email}`,
            dataset: { act: `link:${signer.id}` },
            onclick: () => copySignLink(doc, signer),
          }),
          // One mistyped address used to mean voiding the document and
          // starting over; now it is a correction on the signer itself.
          canCorrect(doc, signer) && el('button.icon-btn', {
            type: 'button', html: icon('userPen', 16), title: 'Correct name, email, or link',
            'aria-label': `Correct ${signer.name || signer.email}`,
            dataset: { act: `correct:${signer.id}` },
            onclick: () => openCorrectSigner(doc, signer, { onDone: refresh }),
          }),
          // The second factor is the owner's to manage after sending: a code
          // that went to the wrong person can be replaced without touching
          // the link.
          !signer.isMe && doc.status === 'sent' && !doc.sample && el('button.icon-btn', {
            // A closed padlock locks it down; a circular arrow swaps the code
            // for a new one. Two padlocks side by side read as one control.
            type: 'button', html: icon(signer.hasCode ? 'rotate' : 'lock', 16),
            title: signer.hasCode ? 'Replace access code' : 'Require an access code',
            'aria-label': `${signer.hasCode ? 'Replace' : 'Require'} an access code for ${signer.name || signer.email}`,
            dataset: { act: `code:${signer.id}` },
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              await resetCodeFlow(doc, signer);
              btn.disabled = false;
            },
          }),
          signer.hasCode && doc.status === 'sent' && !doc.sample && el('button.icon-btn', {
            type: 'button', html: icon('unlock', 16), title: 'Remove access code',
            'aria-label': `Remove the access code for ${signer.name || signer.email}`,
            dataset: { act: `uncode:${signer.id}` },
            onclick: () => clearCodeFlow(doc, signer),
          }),
          canRemind && el('button.icon-btn', {
            type: 'button', html: icon('bell', 16), title: 'Send email reminder',
            'aria-label': `Send reminder to ${signer.name || signer.email}`,
            dataset: { act: `remind:${signer.id}` },
            onclick: async (e) => {
              // A successful send re-renders this panel; on failure the same
              // button survives, so re-arm it for a retry.
              const btn = e.currentTarget;
              btn.disabled = true;
              await remindSigner(doc, signer);
              btn.disabled = false;
            },
          })
        )
      );
    });

    /* Activity */
    const audit = [...(doc.audit || [])].reverse().slice(0, 30);

    /* Danger zone */
    const danger = [];
    if (doc.status === 'sent' || doc.status === 'expired') {
      danger.push(el('button.btn.btn-danger.btn-block', {
        type: 'button', html: icon('ban', 15, 2),
        dataset: { act: 'void' },
        onclick: async () => { if (await voidDocFlow(doc)) refresh(); },
      }, ' Void document'));
    }
    danger.push(el('button.btn.btn-danger.btn-block', {
      type: 'button', html: icon('trash', 15, 2),
      dataset: { act: 'delete' },
      onclick: async () => { if (await deleteDocFlow(doc)) navigate('#/'); },
    }, ' Delete document'));

    // .detail-top cards jump above the pages on one-column layouts; the
    // rest (message, activity, danger zone) stays below them.
    append(sideWrap, [
      doc.sample && el('div.sample-banner.detail-top', { html: icon('sparkle', 14, 2.2) },
        el('span.grow', {}, 'Sample document. Links and email are disabled')),
      el('div.card.detail-top', {}, el('div.card-title', {}, 'Actions'),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, actions)),
      el('div.card.detail-top', {},
        el('div.card-title', {}, `Signers · ${signed} of ${total} signed`),
        ordered && el('p.order-note', { html: icon('listOrdered', 14, 2) },
          el('span', {}, doc.status !== 'sent' || !turn
            ? 'Signed in order'
            : `In order · waiting on ${turn.name || turn.email || 'the next signer'}${turn.isMe ? ' (you)' : ''}`)),
        signerRows),
      doc.note && el('div.card', {}, el('div.card-title', {}, 'Message'),
        el('p.small.muted', { style: { whiteSpace: 'pre-wrap' } }, doc.note)),
      // The clock side of a sent document: when it runs out, how often
      // signers are chased, and the one action that changes either.
      (doc.status === 'sent' || doc.status === 'expired') && el('div.card.detail-top', {},
        el('div.card-title', {}, 'Timing'),
        el('div.timing-row', { html: icon(isExpired(doc) ? 'hourglass' : 'clock', 15, 2) },
          el('span.grow', {}, doc.expiresAt
            ? (isExpired(doc)
              ? `Expired ${formatDate(doc.expiresAt)}. The links no longer work.`
              : `Expires ${expiresInWords(doc)}, on ${formatDate(doc.expiresAt)}`)
            : 'No expiry. The links keep working until everyone signs.')),
        el('div.timing-row', { html: icon('bell', 15, 2) },
          el('span.grow', {}, (() => {
            const every = Number((doc.reminder || {}).every) || 0;
            if (!every) return 'No automatic reminders. The bell on a signer sends one now.';
            const label = (REMINDER_CHOICES.find((c) => c.days === every) || {}).label || `Every ${every} days`;
            const since = (doc.reminder || {}).lastAt || doc.sentAt || 0;
            const next = since ? formatDate(since + every * DAY_MS) : '';
            return `${label}${next && !isExpired(doc) ? ` · next around ${next}` : ''}`;
          })())),
        el('div.row', { style: { marginTop: '11px' } },
          el('button.btn.btn-soft.btn-sm', {
            type: 'button', html: icon('calendar', 14, 2),
            dataset: { act: 'deadline' },
            onclick: () => openExtendMenu(doc),
          }, doc.expiresAt ? ' Change deadline' : ' Set a deadline'))),
      // What ties the completed copy to the bytes signers were served.
      doc.fingerprint && doc.fingerprint.hex && el('div.card', {},
        el('div.card-title', {}, 'Document fingerprint'),
        el('p.fingerprint', {}, groupHex(doc.fingerprint.hex)),
        el('p.small.faint', { style: { marginTop: '7px' } },
          `${doc.fingerprint.alg || 'SHA-256'} of the original PDF, recorded when it was sent. Also printed on the signature certificate.`)),
      el('div.card', {}, el('div.card-title', {}, 'Activity'),
        el('ul.audit-list', {}, audit.map((event) =>
          el(`li.audit-item${event.type === 'signed' || event.type === 'completed' ? '.ok' : ''}${event.type === 'declined' || event.type === 'voided' ? '.danger' : ''}`, {},
            el('div', {}, auditLabel(event)),
            el('div.when', {}, formatDateTime(event.at)))))),
      el('div.card', {}, el('div.card-title', {}, 'Danger zone'),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, danger)),
    ]);
  }

  /**
   * Extending is the answer to an expired document, so the choices are
   * relative ("another 7 days") rather than a calendar the sender has to
   * reason about.
   */
  function openExtendMenu(target) {
    const options = [7, 14, 30];
    const content = el('div', {},
      el('p.modal-message', {}, target.expiresAt
        ? `The deadline is ${formatDate(target.expiresAt)}. Extending counts from ${isExpired(target) ? 'today' : 'the current deadline'}.`
        : 'Set a deadline and every sign link stops working after it.'),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } },
        options.map((days) => el('button.btn.btn-soft.btn-block', {
          type: 'button',
          onclick: async () => {
            modal.close();
            if (await extendExpiry(target, days)) refresh();
          },
        }, `${target.expiresAt && !isExpired(target) ? 'Another' : 'In'} ${days} days`)),
        target.expiresAt && el('button.btn.btn-ghost.btn-block', {
          type: 'button',
          onclick: async () => {
            modal.close();
            if (await extendExpiry(target, 0)) refresh();
          },
        }, 'Remove the deadline')));
    const modal = openModal({ title: target.expiresAt ? 'Change the deadline' : 'Set a deadline', content });
  }

  /* ---- Pages -------------------------------------------------------------------- */

  async function renderPages() {
    // Retrying after a failed load mounts a second surface; let the first go.
    pagesApi?.destroy();
    pagesApi = null;
    clear(pagesWrap);
    pagesWrap.append(el('p.small.faint', { style: { textAlign: 'center', padding: '30px 0' } }, 'Loading document…'));
    try {
      const [bytes, values] = await Promise.all([
        store.readPdf(doc.id),
        store.readSigData(doc.id),
      ]);
      sigData = values;
      const pdf = await openPdf(bytes);
      // mountPages clears the container, loading line included.
      pagesApi = mountPages({ container: pagesWrap, pdf, pageCount: doc.pageCount });
      renderOverlays();
    } catch (err) {
      console.error(err);
      clear(pagesWrap);
      pagesWrap.append(pagesError('The preview could not be loaded right now.', renderPages));
    }
  }

  function renderOverlays() {
    if (!pagesApi) return;
    for (const entry of pagesApi.frames) {
      clear(entry.overlay);
      for (const field of doc.fields.filter((f) => f.page === entry.index)) {
        entry.overlay.append(staticFieldBox(field, doc, displayValue(field, sigData)));
      }
    }
  }

  /**
   * Rebuild the head and the side column after anything changed.
   *
   * Every control here is thrown away and rebuilt, and the store emits often:
   * the background pull, a reminder that just went out, a code that was just
   * replaced. Whatever was activated went with it, so the keyboard landed on
   * the body and Tab started again from the top of the page. Each control
   * carries a stable key, and the one that held focus gets it back.
   */
  function refresh() {
    doc = store.getDoc(docId);
    if (!doc) {
      navigate('#/');
      return;
    }
    const held = root.contains(document.activeElement)
      ? (document.activeElement.dataset || {}).act || '' : '';
    renderHead();
    renderSide();
    // The layout is the same one it was focused in, so nothing has to scroll.
    if (held) root.querySelector(`[data-act="${held}"]`)?.focus({ preventScroll: true });
    store.readSigData(doc.id).then((values) => {
      sigData = values;
      renderOverlays();
    }).catch(() => {});
  }

  const onStoreChange = () => refresh();
  store.addEventListener('change', onStoreChange);

  /* Fresh statuses on open (throttled inside signlinks). */
  if (doc.status === 'sent' && !doc.sample) {
    signlinks.pull({ force: true }).then(afterPull).catch(() => {});
  }

  renderHead();
  renderSide();
  renderPages();

  root.append(headWrap, el('div.detail-grid', {}, pagesWrap, sideWrap));
  root.destroy = () => {
    store.removeEventListener('change', onStoreChange);
    pagesApi?.destroy();
  };
  return root;
}
