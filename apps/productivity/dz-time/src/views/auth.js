/** Intro page shown before sign-in. */

import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export function authView({ onSignedIn }) {
  const cta = el('button.btn.btn-primary.auth-cta', {
    onclick: async () => {
      cta.disabled = true;
      cta.textContent = 'Waiting for Puter…';
      try {
        await puter.auth.signIn();
        onSignedIn();
      } catch {
        cta.disabled = false;
        cta.textContent = 'Sign in';
      }
    },
  }, 'Sign in');

  return el('div.auth-view', {},
    el('img.auth-logo', { src: './icons/icon-192.png', width: 88, height: 88, alt: 'Hourly logo' }),
    el('h1.auth-title', {}, 'Hourly'),
    el('p.auth-sub', {}, 'Timesheets without the chore. Track billable hours by client, project, or task, on every device.'),
    el('div.auth-features', {},
      feature('timer', 'One-tap timer that survives reloads, plus quick manual entries'),
      feature('banknote', 'Rates per client, project, or entry, with billing-ready rounding'),
      feature('cloud', 'Your data lives in your own Puter cloud, not on our servers')
    ),
    cta,
    el('p.auth-note', {}, 'Free', el('span.dot-sep'), 'No ads', el('span.dot-sep'), 'Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))
  );

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
