import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import landingHTML from './landing.html?raw';
import { initPublicNavigation } from '../../site/client.js';

/** Public introduction, also enhanced while the SDK resolves the session. */
export function authView({ onSignedIn, signal }) {
  const view = document.getElementById('landing-top') || el('div.landing', { id: 'landing-top', html: landingHTML });
  view.dataset.ready = 'true';
  for (const slot of view.querySelectorAll('[data-icon]')) {
    slot.innerHTML = icon(slot.dataset.icon, 20, 1.7);
  }
  const buttons = [...view.querySelectorAll('[data-sign-in]')];
  buttons.forEach((button) => { button.disabled = false; });
  const status = view.querySelector('[role="status"]');
  let pending = false;

  const disposeNavigation = initPublicNavigation(view);
  signal?.addEventListener('abort', disposeNavigation, { once: true });

  view.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-sign-in]');
    if (!button || pending) return;
    if (!globalThis.puter?.auth?.signIn) {
      status.textContent = 'Couldn’t connect to Puter. Check your connection, then reload this page to sign in.';
      status.focus();
      return;
    }
    pending = true;
    buttons.forEach((cta) => { cta.disabled = true; });
    status.textContent = 'Finish signing in in the Puter window…';
    try {
      await puter.auth.signIn();
      disposeNavigation();
      await onSignedIn();
    } catch {
      status.textContent = 'Sign-in wasn’t completed. Please try again and allow the Puter sign-in window if prompted.';
      status.focus();
    } finally {
      pending = false;
      buttons.forEach((cta) => { cta.disabled = false; });
    }
  }, signal ? { signal } : undefined);
  return view;
}
