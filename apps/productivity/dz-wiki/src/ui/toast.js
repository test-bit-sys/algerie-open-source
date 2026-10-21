import { h, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let host = null;

/** A short message at the bottom of the screen, optionally with an action. */
export function toast(message, { action = null, kind = 'info', duration = 4500 } = {}) {
  if (!host || !host.isConnected) {
    host = h('div.toasts', { role: 'region', 'aria-label': 'Notifications' });
    document.body.append(host);
  }
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 160);
  };
  const el = h(
    `div.toast.${kind}`,
    kind === 'error' ? icon('alert', 16) : kind === 'success' ? icon('circleCheck', 16) : null,
    h('span.toast-text', message),
    action
      ? h('button.toast-action', { type: 'button', onclick: () => {
          action.run();
          close();
        } }, action.label)
      : null,
    h('button.icon-btn.toast-close', { type: 'button', 'aria-label': 'Dismiss', onclick: close }, icon('x', 14)),
  );
  host.append(el);
  announce(action ? `${message}. ${action.label} is available.` : message);
  let timer = setTimeout(close, action ? duration * 1.6 : duration);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => (timer = setTimeout(close, 2000)));
  el.addEventListener('focusin', () => clearTimeout(timer));
  return close;
}
