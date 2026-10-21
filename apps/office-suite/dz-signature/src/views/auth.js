import { el } from '../ui/dom.js';
import { icon, appIcon } from '../ui/icons.js';

export function authView({ onSignedIn }) {
  const cta = el('button.btn.btn-primary.auth-cta', {
    type: 'button',
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
    el('div.auth-logo', { html: appIcon(76), 'aria-hidden': 'true' }),
    el('h1.auth-title', {}, 'Signatures'),
    el('p.auth-sub', {}, 'Send documents for signature, track who signed, and download the completed copy.'),
    el('div.auth-features', {},
      feature('send', 'Signers get a private link by email. No account needed to sign'),
      feature('shield', 'Your documents live in your own Puter cloud, not on our servers'),
      feature('fileCheck', 'Completed copies come with a full signature certificate')
    ),
    cta,
    el('p.auth-note', {}, 'Free • No ads • Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))
  );

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
