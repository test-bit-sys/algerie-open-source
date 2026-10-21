/**
 * In-app signing: the owner filling their own fields on a sent document.
 * Reuses the same fill-and-sign UI external signers get on sign.html.
 */

import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { signlinks } from '../lib/services.js';
import { openPdf } from '../lib/pdfdoc.js';
import { mountSigning } from '../ui/signing.js';
import { consentGate } from '../ui/consent.js';
import { localClock } from '../lib/consent.js';
import { pagesError } from '../ui/pages.js';
import { handleCompleted, advanceTurn } from '../ui/actions.js';
import { isSignerTurn, displayValue, isExpired } from '../lib/model.js';
import { toast } from '../ui/toast.js';

export function selfSignView({ navigate, docId }) {
  const doc = store.getDoc(docId);
  const root = el('div.main-inner');

  const me = doc?.signers.find((s) => s.isMe);
  if (!doc || !me) {
    queueMicrotask(() => navigate(doc ? `#/doc/${doc.id}` : '#/'));
    return root;
  }
  if (doc.status !== 'sent' || me.status === 'signed') {
    queueMicrotask(() => navigate(`#/doc/${doc.id}`));
    return root;
  }
  // Past the deadline the worker refuses every signer's link; signing in the
  // app is the same document, so it stops here too. The detail view already
  // hides "Sign now", but this route is reachable directly, and the status
  // still reads 'sent' until the clock-driven pass catches up.
  if (isExpired(doc)) {
    queueMicrotask(() => {
      toast('This document has expired. Extend the deadline to sign it', {
        icon: 'hourglass', duration: 4000,
      });
      navigate(`#/doc/${doc.id}`);
    });
    return root;
  }
  // Sequential signing: your own fields wait their turn like everyone else's.
  if (!isSignerTurn(doc, me.id)) {
    queueMicrotask(() => {
      const ahead = doc.signers.find((s) => s.status !== 'signed');
      toast(`${ahead?.name || 'An earlier signer'} signs before you`, { icon: 'hourglass', duration: 4000 });
      navigate(`#/doc/${doc.id}`);
    });
    return root;
  }

  let signing = null;
  const progressText = el('span.txt', {}, ' ');
  const progressFill = el('div.progress-fill', { style: { width: '0%' } });
  const finishBtn = el('button.btn.btn-primary', {
    type: 'button', disabled: true, html: icon('check', 16, 2.4), style: { padding: '11px 22px' },
  }, ' Finish signing');

  const head = el('div.view-head', {},
    el('button.icon-btn', {
      type: 'button', html: icon('arrowLeft', 20), 'aria-label': 'Back to document',
      onclick: () => navigate(`#/doc/${doc.id}`),
    }),
    el('div.grow', {},
      el('h1', { style: { fontSize: '20px' } }, doc.title),
      el('div.small.faint', {}, 'Complete your fields, then finish signing')),
  );

  const pagesWrap = el('div');

  const footer = el('div.sign-footer', {},
    el('div.sign-footer-inner', {},
      el('div.sign-progress', {}, progressText, el('div.progress-track', {}, progressFill)),
      el('div.sign-actions', {}, finishBtn)
    ));

  /**
   * Consent first, exactly as an external signer gets it: the certificate
   * should be able to say the owner agreed too, not just everyone else.
   */
  function renderConsent() {
    clear(pagesWrap);
    footer.hidden = true;
    pagesWrap.append(el('div', { style: { padding: '10px 0 20px' } },
      consentGate({
        intro: `You are signing "${doc.title}" yourself, in this app.`,
        agreeLabel: 'Agree and fill in my fields',
        onAgree: async ({ version }) => {
          try {
            await store.recordConsent(doc.id, me.id, { version, ...localClock() });
          } catch (err) {
            // The gate puts its form back; without this the owner was left
            // looking at a re-enabled button with no word of what went wrong.
            toast('Could not record your agreement. Check your connection and try again', {
              icon: 'wifiOff', duration: 5000,
            });
            throw err;
          }
          footer.hidden = false;
          loadPages();
        },
      })));
  }

  async function loadPages() {
    // Retrying after a failed load mounts a second surface; let the first go.
    signing?.destroy();
    signing = null;
    clear(pagesWrap);
    pagesWrap.append(el('p.small.faint', { style: { textAlign: 'center', padding: '30px 0' } }, 'Loading document…'));
    try {
      const [bytes, sigData, saved] = await Promise.all([
        store.readPdf(doc.id),
        store.readSigData(doc.id),
        store.getSavedSignature().catch(() => null),
      ]);
      const pdf = await openPdf(bytes);
      // mountSigning clears the container, loading line included.
      const fields = doc.fields.map((f) => {
        const signer = doc.signers.find((s) => s.id === f.signerId);
        return {
          ...f,
          mine: f.signerId === me.id,
          signerName: signer?.name || signer?.email || '',
          // Falls back to what I filled in as the sender, same as an external
          // signer sees from the worker.
          value: displayValue(f, sigData),
        };
      });
      signing = mountSigning({
        container: pagesWrap,
        pdf,
        data: { title: doc.title, pageCount: doc.pageCount, fields },
        suggestedName: me.name || store.settings.fullName || store.user?.username || '',
        savedSignature: saved?.image || null,
        onAdoptSignature: (dataUrl) => {
          store.setSavedSignature({ image: dataUrl, updatedAt: Date.now() }).catch(() => {});
        },
        onProgress: ({ done, total }) => {
          progressText.textContent = total
            ? `${done} of ${total} required field${total === 1 ? '' : 's'} complete`
            : 'Review the document, then finish';
          progressFill.style.width = total ? `${Math.round((done / total) * 100)}%` : '100%';
          // Stays clickable while incomplete: clicking walks you to the
          // first field that still needs attention.
          finishBtn.disabled = false;
        },
      });
    } catch (err) {
      console.error(err);
      clear(pagesWrap);
      pagesWrap.append(pagesError('Check your connection, then try again.', loadPages));
    }
  }
  if (me.consentAt) loadPages();
  else renderConsent();

  finishBtn.addEventListener('click', async () => {
    if (!signing) return;
    if (!signing.isComplete()) {
      signing.focusFirstIncomplete();
      toast('This field still needs to be completed', { icon: 'circleAlert' });
      return;
    }
    finishBtn.disabled = true;
    finishBtn.textContent = 'Saving…';
    try {
      const values = signing.getValues();
      // External signers see the owner's signature through the worker, and
      // with sign-in-order the same snapshot is what opens the next signer's
      // link. So it goes out BEFORE the record says this is signed: a push
      // that failed used to be swallowed, leaving the app announcing the next
      // signer's turn - and emailing them - over a link still answering
      // "not yet", with nothing that would ever push it again.
      //
      // The filled-in values are written first either way, so a failure costs
      // no work: the form comes back exactly as it was left, ready to finish.
      if (Object.keys(values).length) await store.mergeSigData(doc.id, values);
      const fresh = store.getDoc(doc.id);
      if (fresh && Object.keys(fresh.links || {}).length && !fresh.sample) {
        await signlinks.syncDoc({
          ...fresh,
          signers: fresh.signers.map((s) => (s.id === me.id ? { ...s, status: 'signed' } : s)),
        });
      }
      const result = await store.markSignerSigned(doc.id, me.id, values);
      if (result.completedNow) {
        toast('Everything is signed. The completed copy is ready', { icon: 'circleCheckBig' });
        await handleCompleted(store.getDoc(doc.id));
      } else {
        toast('Your signature is in', { icon: 'circleCheck' });
        // Signing in order: the snapshot above opened the next signer's
        // link, so their request goes out now.
        await advanceTurn(store.getDoc(doc.id));
      }
      navigate(`#/doc/${doc.id}`);
    } catch (err) {
      console.error(err);
      toast('Could not save your signature. Check your connection', { icon: 'wifiOff' });
      finishBtn.disabled = false;
      clear(finishBtn);
      finishBtn.innerHTML = icon('check', 16, 2.4);
      finishBtn.append(' Finish signing');
    }
  });

  root.append(head, pagesWrap, footer);
  root.destroy = () => signing?.destroy();
  return root;
}
