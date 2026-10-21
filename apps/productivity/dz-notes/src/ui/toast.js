import { h, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let host = null;

/**
 * Brief status message at the bottom of the window.
 *   toast('Page deleted', { action: { label: 'Undo', run } })
 * Toasts with an action stay longer and pause while hovered or focused.
 */
export function toast(message, { action, duration, kind = 'info' } = {}) {
  if (!host) {
    host = h('div.toasts', { role: 'region', 'aria-label': 'Notifications' });
    document.body.append(host);
  }
  const el = h(`div.toast.${kind}`, { role: kind === 'error' ? 'alert' : 'status' });
  el.append(h('span.toast-msg', message));
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 160);
  };
  if (action) {
    el.append(h('button.toast-action', { type: 'button', onclick: () => { dismiss(); action.run(); } }, action.label));
  }
  el.append(h('button.toast-close.icon-btn', { type: 'button', 'aria-label': 'Dismiss', onclick: dismiss }, icon('x', 14)));
  host.append(el);
  while (host.children.length > 3) host.firstChild.remove();
  const ms = duration ?? (action ? 8000 : 4000);
  const arm = () => { timer = setTimeout(dismiss, ms); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', arm);
  arm();
  if (kind !== 'error') announce(message);
  return dismiss;
}
