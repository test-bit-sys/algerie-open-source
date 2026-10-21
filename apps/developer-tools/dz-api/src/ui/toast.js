import { h } from '../lib/dom.js';
import { icon } from './icons.js';

let host = null;
const ICONS = { success: 'circleCheck', error: 'alert', info: 'info', warning: 'warning' };

/**
 * While a modal dialog is open everything outside it is inert and hidden from screen readers,
 * so the toasts live in the topmost open dialog then, and in the body otherwise.
 */
function placeHost() {
  if (!host) return;
  const parent = [...document.querySelectorAll('dialog[open]')].at(-1) || document.body;
  if (host.parentNode === parent) return;
  const focused = host.contains(document.activeElement) ? document.activeElement : null;
  parent.append(host);
  focused?.focus({ preventScroll: true });
}

/**
 * toast({ title, text, kind, actions: [{ label, run }], duration })
 * Errors stay until dismissed; others fade after `duration` ms (0 keeps them).
 * Returns a function that dismisses the toast.
 */
export function toast({ title, text = '', kind = 'info', actions = [], duration } = {}) {
  if (!host) {
    host = h('div.toasts', { role: 'region', 'aria-label': 'Notifications' });
    // Follows dialogs as they open and close.
    new MutationObserver(placeHost).observe(document.body, { subtree: true, attributeFilter: ['open'] });
  }
  placeHost();
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  const el = h(
    'div.toast',
    { role: kind === 'error' ? 'alert' : 'status', dataset: { kind } },
    icon(ICONS[kind] || 'info', 16),
    h(
      'div.toast-body',
      title ? h('div.toast-title', title) : null,
      text ? h('div.toast-text', text) : null,
      actions.length
        ? h(
            'div.toast-actions',
            actions.map((a) =>
              h('button.link-btn', { type: 'button', onclick: () => { close(); a.run(); } }, a.label),
            ),
          )
        : null,
    ),
    h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Dismiss notification', onclick: close }, icon('x', 14)),
  );
  host.append(el);
  const ms = duration ?? (kind === 'error' ? 0 : 4500);
  let timer = ms ? setTimeout(close, ms) : 0;
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => {
    if (ms) timer = setTimeout(close, ms);
  });
  return close;
}
