/**
 * The standalone signing page (sign.html): what a signer lands on after the
 * worker's /sign/<token> redirect. Talks only to that worker's JSON API; the
 * worker origin and capability token arrive in the URL FRAGMENT, so they
 * never hit server logs.
 */

import { el, clear, append, fieldId } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { openPdf } from './lib/pdfdoc.js';
import { mountSigning } from './ui/signing.js';
import { openModal } from './ui/modal.js';
import { toast } from './ui/toast.js';
import { consentGate } from './ui/consent.js';
import { localClock } from './lib/consent.js';

const appRoot = document.getElementById('app');

// A stray file drop (say, a signature image aimed at the upload picker)
// must not navigate the tab away from the signing session.
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (e) => e.preventDefault());

/** The worker origin from the link, or null if it isn't a Puter worker.
 *  The page will only ever call https://<something>.puter.work. */
function readLink() {
  const params = new URLSearchParams(location.hash.replace(/^#/, '') || location.search.replace(/^\?/, ''));
  const w = params.get('w') || '';
  const t = params.get('t') || '';
  let origin = null;
  try {
    const url = new URL(w);
    if (url.protocol === 'https:' && /^[a-z0-9-]+\.puter\.work$/i.test(url.hostname)) {
      origin = `https://${url.hostname.toLowerCase()}`;
    }
  } catch {
    origin = null;
  }
  if (!origin || !/^[0-9a-f]{40}$/.test(t)) return null;
  return { origin, token: t };
}

function terminal({ iconName = 'circleAlert', tone = '', title, message, extra = null }) {
  clear(appRoot);
  appRoot.append(el('div.sign-terminal', {},
    el('div.empty-icon', { className: `empty-icon ${tone}`, html: icon(iconName, 30) }),
    el('h1', {}, title),
    el('p', {}, message),
    extra
  ));
}

/** Recovery for the failures that a retry can actually fix. */
function retryBtn(label = 'Try again') {
  return el('button.btn.btn-primary', {
    type: 'button', html: icon('rotate', 16, 2),
    // The worker origin and token live in the fragment, so a reload keeps them.
    onclick: () => location.reload(),
  }, ` ${label}`);
}

function downloadBytes(bytes, filename) {
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

/**
 * The access-code prompt, as a form: the input, the answer to a wrong code
 * (how many tries are left; too many and the worker locks the signer out for
 * a while), and the submit. Shared by the full-page prompt a locked link opens
 * on and by the dialog that re-asks mid-signing when an unlocked session has
 * timed out, so the code is checked one way.
 *
 * `onUnlocked` is called once the worker has traded the code for a session
 * (already written by then). Returns the form element with `.focusInput()`.
 */
function unlockForm({ origin, token, writeSession, onUnlocked, lockedUntil = 0 }) {
  const codeId = fieldId('code');
  const input = el('input.input.code-input', {
    id: codeId, type: 'text', maxLength: 32, autocomplete: 'off',
    autocapitalize: 'characters', spellcheck: false,
    placeholder: 'Access code',
    'aria-label': 'Access code',
    style: { width: '100%', fontSize: '18px' },
  });
  const error = el('p.field-error', { role: 'alert', hidden: true });
  const submit = el('button.btn.btn-primary.btn-block', {
    type: 'button', style: { padding: '12px', marginTop: '14px' },
    html: icon('lock', 16, 2),
  }, ' Open the document');

  let lockTimer = null;
  const lockOut = (until) => {
    const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    error.hidden = false;
    error.textContent = `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    input.disabled = true;
    submit.disabled = true;
    // The lock lifts on its own; so does the form, rather than staying dead
    // until the signer thinks to reload.
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => {
      error.hidden = true;
      input.disabled = false;
      submit.disabled = false;
      input.focus();
    }, Math.min(Math.max(until - Date.now(), 1000), 2_147_483_647));
  };

  const attempt = async () => {
    const code = input.value.trim();
    if (code.length < 4) {
      error.hidden = false;
      error.textContent = 'Enter the code the sender gave you.';
      return;
    }
    submit.disabled = true;
    error.hidden = true;
    try {
      const res = await fetch(`${origin}/api/sign/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', code }),
      });
      const out = await res.json().catch(() => null);
      if (res.ok && out && out.ok && out.session) {
        writeSession(out.session);
        onUnlocked();
        return;
      }
      if (out && out.error === 'locked') {
        lockOut(out.until || Date.now() + 60000);
        return;
      }
      error.hidden = false;
      error.textContent = out && Number.isFinite(out.remaining)
        ? `That code is not right. ${out.remaining} attempt${out.remaining === 1 ? '' : 's'} left.`
        : 'That code is not right.';
      submit.disabled = false;
      input.select();
    } catch {
      error.hidden = false;
      error.textContent = 'Could not check the code. Check your connection and try again.';
      submit.disabled = false;
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      attempt();
    }
  });
  submit.addEventListener('click', attempt);

  const form = el('div', {},
    el('div.field', { style: { marginBottom: '0' } }, input, error),
    submit);
  form.focusInput = () => input.focus();
  form.destroy = () => clearTimeout(lockTimer);
  if (lockedUntil > Date.now()) lockOut(lockedUntil);
  return form;
}

/**
 * The full-page prompt a locked link opens on. Unlocking starts the page
 * over, so the signer lands where they would have if the link had needed
 * nothing.
 */
function unlockScreen({ origin, token, writeSession, restart, lockedUntil = 0 }) {
  const form = unlockForm({ origin, token, writeSession, onUnlocked: restart, lockedUntil });
  clear(appRoot);
  appRoot.append(el('main.sign-main.sign-main-narrow', {},
    el('div.consent-panel', {},
      el('div.consent-head', {},
        el('span.consent-icon', { html: icon('lock', 22, 2), 'aria-hidden': 'true' }),
        el('div', {},
          el('h2', {}, 'This document needs an access code'),
          el('p.small.muted', {}, 'The sender shared a code with you separately, by phone or in person. Enter it to open the document.'))),
      form)));
  if (!(lockedUntil > Date.now())) setTimeout(() => form.focusInput(), 60);
}

/**
 * The same prompt as a dialog over the document, for when the unlocked
 * session has run out mid-signing (they last two hours; a long contract can
 * take longer). Starting the page over here would throw away everything the
 * signer had filled in, so the code is re-asked in place and the caller
 * retries what it was doing. Resolves true once unlocked, false if dismissed.
 */
function unlockDialog({ origin, token, writeSession, lockedUntil = 0 }) {
  return new Promise((resolve) => {
    let unlocked = false;
    const form = unlockForm({
      origin, token, writeSession, lockedUntil,
      onUnlocked: () => {
        unlocked = true;
        modal.close();
      },
    });
    const modal = openModal({
      title: 'Enter your access code again',
      content: el('div', {},
        el('p.modal-message', {}, 'Your access code session has timed out. Enter the code the sender gave you to carry on; nothing you filled in is lost.'),
        form),
      onClose: () => {
        form.destroy();
        resolve(unlocked);
      },
    });
  });
}

async function main() {
  const link = readLink();
  if (!link) {
    terminal({
      title: 'This link is not valid',
      message: 'The signing link looks incomplete. Ask the sender for a fresh one.',
    });
    return;
  }

  // An unlocked access code buys a session for THIS token, kept per tab so a
  // shared machine does not inherit it, and sent with every later call.
  const sessionKey = `sig:sess:${link.token}`;
  const readSession = () => {
    try {
      return sessionStorage.getItem(sessionKey) || '';
    } catch {
      return '';
    }
  };
  const writeSession = (value) => {
    try {
      if (value) sessionStorage.setItem(sessionKey, value);
      else sessionStorage.removeItem(sessionKey);
    } catch {
      /* private browsing: the signer will be asked again if they reload */
    }
  };

  const api = (path, init = {}) => {
    const session = readSession();
    const headers = { ...(init.headers || {}) };
    if (session) headers['x-sign-session'] = session;
    return fetch(`${link.origin}/api/sign/${link.token}${path}`, { ...init, headers });
  };

  /**
   * One signer action (consent, sign, decline), with the two refusals that
   * are NOT about the action handled here:
   *
   *  - The access-code session timed out (or was dropped by a new code): the
   *    code is re-asked in a dialog and the action retried, so a signer who
   *    took longer than the session lasts does not lose their work.
   *  - The document has moved on without them - expired, voided, closed by a
   *    decline, already answered, a turn that has not opened or a link that
   *    has been replaced. No retry fixes any of those; every one used to be
   *    reported as a connection problem and offered "try again" for good.
   *    The page starts over instead and lands on the truth, which the load
   *    path already knows how to show.
   *
   * Resolves { ok: true, out } on success; { ok: false, out, status } for a
   * refusal that is about the submission itself; { restarted: true } when the
   * page has started over and the caller's screen is gone; { dismissed: true }
   * when the signer backed out of the code prompt and is back where they
   * were. Throws only on a transport failure.
   */
  const FINAL = new Set([
    'expired', 'voided', 'declined', 'already_signed', 'already_declined', 'not_yet',
    'not_found', 'consent_required',
  ]);
  async function postAction(body) {
    for (let pass = 0; pass < 2; pass++) {
      const res = await api('', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => null);
      if (res.ok && out && out.ok) return { ok: true, out };
      const error = (out && out.error) || '';
      if ((error === 'code_required' || error === 'locked') && pass === 0) {
        writeSession('');
        const unlocked = await unlockDialog({
          origin: link.origin, token: link.token, writeSession,
          lockedUntil: error === 'locked' ? out.until : 0,
        });
        if (!unlocked) return { ok: false, dismissed: true };
        continue;
      }
      if (FINAL.has(error) || res.status === 404 || res.status === 410) {
        main();
        return { ok: false, restarted: true };
      }
      return { ok: false, out, status: res.status };
    }
    // A second code_required straight after a fresh unlock: the code was
    // replaced under them. The restart lands on the prompt for the new one.
    main();
    return { ok: false, restarted: true };
  }

  /** What to tell the signer about a refusal that IS about their submission. */
  function refusalMessage(result) {
    const error = (result.out && result.out.error) || '';
    if (error === 'missing_required') return 'Some fields were not accepted. Check them and try again';
    if (error === 'too_large' || result.status === 413) return 'A signature image is too large. Use a smaller image and try again';
    return 'Could not submit. Try again';
  }

  clear(appRoot);
  appRoot.append(el('div.sign-terminal', {},
    el('div.empty-icon', { html: icon('spinner', 28), className: 'empty-icon' }),
    el('p', {}, 'Loading your document…')));
  appRoot.querySelector('svg')?.classList.add('spin');

  let data = null;
  let res = null;
  try {
    res = await api('');
    data = await res.json().catch(() => null);
  } catch {
    terminal({
      iconName: 'wifiOff',
      title: 'Could not load the document',
      message: 'Check your connection, then try again.',
      extra: retryBtn(),
    });
    return;
  }

  if (!res.ok || !data || !data.ok) {
    if (data?.error === 'code_required' || data?.error === 'locked') {
      // The link needs the second factor the sender shared out of band.
      writeSession('');
      unlockScreen({
        origin: link.origin,
        token: link.token,
        writeSession,
        restart: () => main(),
        lockedUntil: data.error === 'locked' ? data.until : 0,
      });
      return;
    }
    if (data?.error === 'not_yet') {
      // Sequential signing: the document is real and this link is valid, it
      // is simply not this signer's turn yet. How they will hear that it has
      // come depends on how the sender hands the links out: promising an
      // email to the signer of a sender who copies each link by hand had
      // them waiting for one that was never going to arrive.
      const ahead = data.waitingFor ? `${data.waitingFor} signs` : 'An earlier signer signs';
      const then = data.channel === 'email'
        ? 'You will get an email when the document is ready for your signature'
        : data.channel === 'link'
          ? 'The sender will let you know when it is ready, and this link will open it then'
          : 'This link will open the document once it is your turn; check back, or ask the sender';
      terminal({
        iconName: 'hourglass',
        title: 'Not your turn yet',
        message: `${ahead} before you. ${then}${data.position && data.total ? `. You are signer ${data.position} of ${data.total}` : ''}.`,
        extra: retryBtn('Check again'),
      });
    } else if (data?.error === 'expired') {
      terminal({
        iconName: 'hourglass',
        title: 'This request has expired',
        message: 'The deadline for signing has passed, so this link no longer works. Ask the sender to extend it if you still need to sign.',
      });
    } else if (data?.error === 'declined') {
      // Sequential signing: someone ahead of this signer declined, so their
      // turn is never coming. Nothing about the document was served.
      terminal({
        iconName: 'circleX', tone: 'danger',
        title: 'Signing is closed',
        message: 'Another signer declined this document, so it can no longer be signed.',
      });
    } else if (res.status === 410 || data?.error === 'voided') {
      terminal({
        iconName: 'ban',
        title: 'This document was voided',
        message: 'The sender withdrew it from signing. Nothing is needed from you.',
      });
    } else {
      terminal({
        title: 'This link is no longer active',
        message: 'It may have been revoked or replaced. Ask the sender for a fresh link.',
      });
    }
    return;
  }

  const ownerName = data.doc.ownerName || 'The sender';

  /**
   * The document as the worker sees it now, re-asking for the access code
   * first if the unlocked session has run out (see postAction). Null when the
   * signer backed out of the code prompt.
   */
  async function fetchView() {
    for (let pass = 0; pass < 2; pass++) {
      const res = await api('');
      const out = await res.json().catch(() => null);
      if (res.ok && out && out.ok) return out;
      const error = (out && out.error) || '';
      if ((error === 'code_required' || error === 'locked') && pass === 0) {
        writeSession('');
        const unlocked = await unlockDialog({
          origin: link.origin, token: link.token, writeSession,
          lockedUntil: error === 'locked' ? out.until : 0,
        });
        if (!unlocked) return null;
        continue;
      }
      throw new Error(error || `view ${res.status}`);
    }
    return null;
  }

  /** The completed copy, built right here from the API's field values. */
  async function downloadCompleted() {
    try {
      // The view first: it is what re-asks for the code when the session has
      // run out, and the file fetch then carries the fresh one.
      const fresh = await fetchView();
      if (!fresh) return;
      const pdfRes = await api('/pdf');
      if (!pdfRes.ok) throw new Error('pdf');
      const original = new Uint8Array(await pdfRes.arrayBuffer());
      const values = {};
      for (const f of fresh.fields || []) {
        if (f.value !== undefined && f.value !== null) values[f.id] = f.value;
      }
      const { buildSignedPdf } = await import('./lib/flatten.js');
      const bytes = await buildSignedPdf(original, {
        title: fresh.doc.title,
        pageCount: fresh.doc.pageCount,
        fields: fresh.fields,
        signers: [],
        audit: [],
      }, values, { certificate: false });
      downloadBytes(bytes, `${(fresh.doc.title || 'document').slice(0, 80)} (signed).pdf`);
    } catch (err) {
      console.error(err);
      toast('Could not build the download. Try again', { icon: 'triangleAlert' });
    }
  }

  const downloadBtn = (label = 'Download signed copy') => el('button.btn.btn-primary', {
    type: 'button', html: icon('fileDown', 16, 2),
    onclick: (e) => {
      // Held in a local: currentTarget is null by the time the build settles,
      // which used to leave the button disabled for good after one press.
      const btn = e.currentTarget;
      btn.disabled = true;
      downloadCompleted().finally(() => { btn.disabled = false; });
    },
  }, ` ${label}`);

  /**
   * Decline to sign. Reachable from the consent step (before the document is
   * ever shown) and from the footer while filling it in.
   */
  function openDeclineDialog({ onCancel = null } = {}) {
    const reasonId = fieldId('reason');
    const reason = el('textarea.textarea', {
      id: reasonId, rows: 3, maxLength: 500,
      placeholder: 'Optional, shared with the sender',
    });
    const body = el('div', {},
      // Rendered as a text node, so the raw name is safe here.
      el('p.modal-message', {}, `Declining tells ${ownerName} you will not sign this document. This closes signing for everyone.`),
      el('div.field', {}, el('label', { for: reasonId }, 'Reason'), reason),
      el('div.row.end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        el('button.btn.btn-danger', {
          type: 'button',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const result = await postAction({ action: 'decline', reason: reason.value.trim(), ...localClock() });
              if (result.restarted) {
                // The page is already on the document's real state; closing
                // must not start it over again.
                declined = true;
                modal.close();
                return;
              }
              if (result.dismissed) {
                btn.disabled = false;
                return;
              }
              if (!result.ok) {
                toast(refusalMessage(result), { icon: 'circleAlert' });
                btn.disabled = false;
                return;
              }
              declined = true;
              modal.close();
              terminal({
                iconName: 'circleX', tone: 'danger',
                title: 'You declined this document',
                message: `${ownerName} has been notified. Nothing else is needed from you.`,
              });
            } catch {
              toast('Could not submit. Check your connection and try again', { icon: 'wifiOff' });
              btn.disabled = false;
            }
          },
        }, 'Decline to sign'))
    );
    const modal = openModal({
      title: 'Decline to sign?',
      content: body,
      onClose: () => { if (!declined) onCancel?.(); },
    });
  }
  let declined = false;

  /* Already answered, or nothing left to do */
  if (data.signer.status === 'declined') {
    terminal({
      iconName: 'circleX', tone: 'danger',
      title: 'You declined this document',
      message: `${ownerName} has been notified. Nothing else is needed from you.`,
    });
    return;
  }
  if (data.signer.status === 'signed') {
    terminal({
      iconName: 'circleCheckBig', tone: 'ok',
      title: 'You have signed this document',
      message: data.state === 'completed'
        ? 'Everyone has signed. You can download the completed copy for your records.'
        : `Thanks. Once everyone has signed, ${data.channel === 'email'
          ? 'the completed copy is emailed to you, and this link shows it for download.'
          : 'this link shows the completed copy for you to download.'}`,
      extra: data.state === 'completed' ? downloadBtn() : null,
    });
    return;
  }
  if (data.state === 'declined') {
    terminal({
      iconName: 'circleX', tone: 'danger',
      title: 'Signing is closed',
      message: 'Another signer declined this document, so it can no longer be signed.',
    });
    return;
  }

  /* Consent comes before the document: nothing is shown, and no file is
     fetched, until the signer has agreed to sign electronically. */
  if (!data.signer.consentAt) {
    const agreed = await new Promise((resolve) => {
      clear(appRoot);
      appRoot.append(el('main.sign-main.sign-main-narrow', {},
        consentGate({
          intro: `${ownerName} asked you to sign "${data.doc.title}".`,
          onAgree: async ({ version }) => {
            let result;
            try {
              result = await postAction({ action: 'consent', disclosureVersion: version, ...localClock() });
            } catch {
              toast('Could not record your agreement. Check your connection and try again', {
                icon: 'wifiOff', duration: 5000,
              });
              throw new Error('consent');
            }
            // Restarted onto the document's real state (this panel is gone),
            // or the code prompt was dismissed (it is back to waiting).
            if (result.restarted || result.dismissed) throw new Error('consent');
            if (!result.ok) {
              toast(refusalMessage(result), { icon: 'circleAlert', duration: 5000 });
              throw new Error('consent');
            }
            resolve(true);
          },
          onDecline: () => resolve(false),
        })));
    });
    if (!agreed) {
      // Declining from the consent step: on cancel the signer is back where
      // they were, still un-consented.
      openDeclineDialog({ onCancel: () => main() });
      return;
    }
  }

  /* The signing experience */
  let pdf = null;
  try {
    const pdfRes = await api('/pdf');
    if (!pdfRes.ok) throw new Error(`pdf ${pdfRes.status}`);
    pdf = await openPdf(new Uint8Array(await pdfRes.arrayBuffer()));
  } catch (err) {
    console.error(err);
    terminal({
      title: 'Could not load the document file',
      message: 'The file could not be fetched right now. Try again in a moment, or contact the sender.',
      extra: retryBtn(),
    });
    return;
  }

  clear(appRoot);
  const pagesWrap = el('div');
  const progressText = el('span.txt', {}, ' ');
  const progressFill = el('div.progress-fill', { style: { width: '0%' } });
  const finishBtn = el('button.btn.btn-primary', {
    type: 'button', disabled: true, html: icon('check', 16, 2.4), style: { padding: '11px 20px' },
  }, ' Finish');
  const declineBtn = el('button.btn.btn-ghost', { type: 'button' }, 'Decline');

  append(appRoot, [
    el('header.sign-topbar', {},
      el('div.sign-topbar-inner', {},
        el('span', { html: icon('signature', 22, 1.9), style: { color: 'var(--accent-strong)' }, 'aria-hidden': 'true' }),
        el('div.grow', {},
          el('div.sign-doc-title', {}, data.doc.title),
          el('div.sign-doc-sub', {}, `${ownerName} requested your signature · ${data.doc.pageCount} page${data.doc.pageCount === 1 ? '' : 's'}`)))),
    el('main.sign-main', {},
      data.doc.note && el('div.sign-note', {}, el('b', {}, `Message from ${ownerName}: `), data.doc.note),
      pagesWrap),
    el('footer.sign-footer', {},
      el('div.sign-footer-inner', {},
        el('div.sign-progress', {}, progressText, el('div.progress-track', {}, progressFill)),
        el('div.sign-actions', {}, declineBtn, finishBtn))),
  ]);

  const signing = mountSigning({
    container: pagesWrap,
    pdf,
    data: {
      title: data.doc.title,
      pageCount: data.doc.pageCount,
      fields: data.fields,
    },
    suggestedName: data.signer.name || '',
    onProgress: ({ done, total }) => {
      progressText.textContent = total
        ? `${done} of ${total} required field${total === 1 ? '' : 's'} complete`
        : 'Review the document, then finish';
      progressFill.style.width = total ? `${Math.round((done / total) * 100)}%` : '100%';
      // Stays clickable while incomplete: clicking walks you to the first
      // field that still needs attention.
      finishBtn.disabled = false;
    },
  });

  finishBtn.addEventListener('click', async () => {
    if (!signing.isComplete()) {
      signing.focusFirstIncomplete();
      toast('This field still needs to be completed', { icon: 'circleAlert' });
      return;
    }
    finishBtn.disabled = true;
    declineBtn.disabled = true;
    finishBtn.textContent = 'Submitting…';
    const rearm = () => {
      finishBtn.disabled = false;
      declineBtn.disabled = false;
      clear(finishBtn);
      finishBtn.innerHTML = icon('check', 16, 2.4);
      finishBtn.append(' Finish');
    };
    try {
      // The signer's own clock goes with the signature, exactly as it does
      // with the consent and the decline: it is what the certificate prints
      // next to the timestamp, and the signature is the act it matters for.
      const result = await postAction({ action: 'sign', values: signing.getValues(), ...localClock() });
      // The page restarted onto the document's real state: this footer is gone.
      if (result.restarted) return;
      if (result.dismissed) {
        // Back on the filled-in form, with the code prompt declined.
        rearm();
        return;
      }
      if (!result.ok) {
        toast(refusalMessage(result), { icon: 'circleAlert', duration: 5000 });
        if ((result.out && result.out.error) === 'missing_required') signing.focusFirstIncomplete();
        rearm();
        return;
      }
      const { out } = result;
      // The completed copy is emailed to signers only when the sender chose
      // email; on every channel this link shows it once everyone has signed
      // (completion outranks the deadline), so that is what is promised.
      const later = data.channel === 'email'
        ? `${ownerName} will be notified, and everyone is emailed the completed copy once all signers have signed.`
        : `${ownerName} will be notified. Once all signers have signed, this link shows the completed copy for you to download.`;
      terminal({
        iconName: 'circleCheckBig', tone: 'ok',
        title: 'Signed and submitted',
        message: out.state === 'completed'
          ? 'Everyone has signed. You can download the completed copy for your records.'
          : `Thanks, you are done. ${later}`,
        extra: out.state === 'completed' ? downloadBtn() : null,
      });
    } catch (err) {
      console.error(err);
      toast('Could not submit. Check your connection and try again', { icon: 'wifiOff', duration: 5000 });
      rearm();
    }
  });

  declineBtn.addEventListener('click', () => openDeclineDialog());
}

main();
