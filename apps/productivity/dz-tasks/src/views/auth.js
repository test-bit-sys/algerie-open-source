import { el } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import iconUrl from '../assets/icon-192.png';

/** Signed-out intro page: value proposition + Sign in. */
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
    el('img.auth-logo', { src: iconUrl, width: 88, height: 88, alt: 'Tasks app icon' }),
    el('h1.auth-title', {}, 'Tasks'),
    el('p.auth-sub', {}, 'Personal and shared to-do lists that stay out of your way and in your own cloud.'),
    el('div.auth-features', {},
      feature('repeat', 'Recurring tasks and reminders that re-arm themselves'),
      feature('users', 'Share any list as a live, read-only link'),
      feature('calendar', 'A built-in calendar, plus feeds your calendar app can subscribe to'),
      feature('cloud', 'Your data lives in your own Puter account, not on our servers')
    ),
    cta,
    el('p.auth-note', {}, 'Free · No ads · Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))
  );

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
