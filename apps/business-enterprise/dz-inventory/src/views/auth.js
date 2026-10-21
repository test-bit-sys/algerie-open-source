import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Sovereign Algerian pre-sign-in intro / offline landing page */
export function authView({ onSignedIn }) {
  const cta = el('button.btn.btn-primary.auth-cta', {
    onclick: async () => {
      cta.disabled = true;
      if (globalThis.puter?.auth?.signIn) {
        try { await puter.auth.signIn(); } catch {}
      }
      onSignedIn?.();
    },
  }, 'الدخول إلى إدارة المخزون');

  return el('div.auth-view', { id: 'landing-top' },
    el('img.auth-logo', { src: './icon-192.png', alt: '', 'aria-hidden': 'true', width: '64', height: '64' }),
    el('h1.auth-title', {}, 'DZ-Inventory | إدارة المخزون والمستودعات'),
    el('p.auth-sub', {}, 'إدارة الأصناف، تتبع حركات المخزون، الباركود، والحد الأدنى للطلب - 100% محلي دون خوادم سحابية.'),
    cta
  );
}
