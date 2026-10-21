import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Pre-sign-in intro page: what the app is, why it's safe, one button in. */
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
    el('img.auth-logo', { src: './icon-192.png', alt: '', 'aria-hidden': 'true' }),
    el('h1.auth-title', {}, 'Sales CRM'),
    el('p.auth-sub', {}, 'Leads, deals, follow-ups, and forecasts for founders who do their own selling.'),
    el('div.auth-features', {},
      feature('pipeline', 'A pipeline board that shows exactly where every deal stands'),
      feature('followups', 'Follow-ups with due dates, so no lead goes quiet by accident'),
      feature('chart', 'A weighted forecast built from your stages, not wishful thinking'),
      feature('company', 'Your data lives in your own Puter cloud, not on our servers')
    ),
    cta,
    el('p.auth-note', {}, 'Free • No ads • Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))
  );

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
