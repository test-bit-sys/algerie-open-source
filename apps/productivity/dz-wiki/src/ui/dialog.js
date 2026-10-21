/**
 * Modal dialogs on the native <dialog> element: focus moves in and is kept
 * inside, Escape closes, and focus returns to what opened it.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let seq = 0;

export function openDialog({ title, description = null, body = null, actions = [], className = '', onClose = null, initialFocus = null, wide = false, closeLabel = 'Close' } = {}) {
  const id = `dlg-${++seq}`;
  const returnTo = document.activeElement;
  const error = h('p.dialog-error', { role: 'alert' });
  const footer = actions.length ? h('div.dialog-actions') : null;
  const dialog = h(
    `dialog.dialog${wide ? '.wide' : ''}${className ? `.${className}` : ''}`,
    { 'aria-labelledby': `${id}-title`, 'aria-describedby': description ? `${id}-desc` : null },
    h('div.dialog-head', h('h2.dialog-title', { id: `${id}-title` }, title), h('button.icon-btn.dialog-close', { type: 'button', 'aria-label': closeLabel, onclick: () => api.close() }, icon('x', 16))),
    description ? h('p.dialog-desc', { id: `${id}-desc` }, description) : null,
    body ? h('div.dialog-body', body) : null,
    error,
    footer,
  );
  let closed = false;
  const api = {
    el: dialog,
    error(message) {
      error.textContent = message || '';
    },
    close(result) {
      if (closed) return;
      closed = true;
      dialog.close();
      dialog.remove();
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
      onClose?.(result);
    },
    busy(on) {
      for (const b of dialog.querySelectorAll('.dialog-actions button')) b.disabled = on;
      dialog.setAttribute('aria-busy', on ? 'true' : 'false');
    },
  };
  for (const a of actions) {
    const b = h(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}`, { type: 'button' }, a.label);
    b.addEventListener('click', async () => {
      if (!a.run) return api.close(a.value);
      api.error('');
      try {
        api.busy(true);
        const keep = await a.run(api);
        if (keep !== false) api.close(a.value);
      } catch (err) {
        api.error(err?.message || 'Something went wrong. Try again.');
      } finally {
        if (!closed) api.busy(false);
      }
    });
    footer.append(b);
  }
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    api.close();
  });
  // A press that starts and ends on the backdrop closes it (not a text
  // selection dragged out of the dialog).
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === dialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop) api.close();
    downOnBackdrop = false;
  });
  document.body.append(dialog);
  dialog.showModal();
  const focusTarget = typeof initialFocus === 'string' ? dialog.querySelector(initialFocus) : initialFocus;
  (focusTarget || dialog.querySelector('input, textarea, select, .btn.primary, button:not(.dialog-close)') || dialog.querySelector('.dialog-close'))?.focus();
  return api;
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    let ok = false;
    openDialog({
      title,
      description: message,
      actions: [
        { label: cancel },
        {
          label: confirm,
          primary: !danger,
          danger,
          run: () => {
            ok = true;
          },
        },
      ],
      onClose: () => resolve(ok),
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', confirm = 'Save', validate = null }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input.field', { type: 'text', value, placeholder, 'aria-label': label });
    const form = h('label.field-label', h('span', label), input);
    const dlg = openDialog({
      title,
      body: form,
      actions: [
        { label: 'Cancel' },
        {
          label: confirm,
          primary: true,
          run: () => {
            const v = input.value.trim();
            const problem = validate?.(v);
            if (problem) throw new Error(problem);
            result = v;
          },
        },
      ],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        dlg.el.querySelector('.btn.primary').click();
      }
    });
    input.select();
  });
}
