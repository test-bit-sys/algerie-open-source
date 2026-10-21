/**
 * Modal dialogs built on <dialog>: focus is trapped by the browser, Escape
 * closes, and focus returns to whatever opened it.
 */
import { h, isComposing } from '../lib/dom.js';
import { icon } from './icons.js';

let seq = 0;

/**
 * openDialog({ title, body, footer, wide, onClose, initialFocus })
 * Returns { el, close(value), result: Promise<value> }.
 */
export function openDialog({ title, body, footer = null, wide = false, className = '', onClose, initialFocus = null, label = null }) {
  const id = `dlg-${++seq}`;
  const returnFocus = document.activeElement;
  let resolve;
  const result = new Promise((r) => {
    resolve = r;
  });
  let value;
  const titleEl = h('h2.dialog-title', { id: `${id}-title` }, title);
  const el = h(
    `dialog.dialog${wide ? '.wide' : ''}${className ? `.${className}` : ''}`,
    { 'aria-labelledby': label ? null : `${id}-title`, 'aria-label': label },
    h('div.dialog-head', titleEl, h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x', 16))),
    h('div.dialog-body', body),
    footer ? h('div.dialog-foot', footer) : null,
  );
  const close = (v) => {
    value = v;
    if (el.open) el.close();
  };
  el.addEventListener('close', () => {
    el.remove();
    onClose?.(value);
    resolve(value);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus?.();
  });
  el.addEventListener('pointerdown', (e) => {
    // Click on the backdrop (the dialog element itself, outside its box) closes.
    if (e.target !== el) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  document.body.append(el);
  el.showModal();
  // A body that scrolls with nothing focusable in it (the shortcuts list on a phone) takes focus
  // itself, so it can be scrolled from the keyboard. Bodies that fit keep out of the tab order.
  const bodyEl = el.querySelector('.dialog-body');
  const fitBody = () => {
    const stuck = bodyEl.scrollHeight > bodyEl.clientHeight + 1 && !bodyEl.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]');
    if (stuck) bodyEl.tabIndex = 0;
    else bodyEl.removeAttribute('tabindex');
  };
  const bodyObserver = new ResizeObserver(fitBody);
  bodyObserver.observe(bodyEl);
  el.addEventListener('close', () => bodyObserver.disconnect());
  const focus = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
  (focus || el.querySelector('[autofocus], input, select, textarea, button.primary') || el)?.focus?.();
  return { el, close, result };
}

/** Confirmation. Resolves true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  let dlg;
  const ok = h(`button.btn${danger ? '.danger' : '.primary'}`, { type: 'button', onclick: () => dlg.close(true) }, confirmLabel);
  dlg = openDialog({
    title,
    body: h('p', { style: { margin: 0, color: 'var(--text-muted)' } }, message),
    footer: [h('button.btn', { type: 'button', onclick: () => dlg.close(false) }, cancelLabel), ok],
    initialFocus: ok,
  });
  return dlg.result.then((v) => v === true);
}

/** Single text field. Resolves the trimmed text, or null when cancelled. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save', validate }) {
  let dlg;
  const input = h('input.input', { type: 'text', value, placeholder, id: `prompt-${++seq}`, autocomplete: 'off', spellcheck: false });
  const error = h('p.field-error', { role: 'alert' });
  const submit = () => {
    const v = input.value.trim();
    const problem = validate?.(v) || (!v ? 'Enter a name.' : '');
    if (problem) {
      error.textContent = problem;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    dlg.close(v);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isComposing(e)) {
      e.preventDefault();
      submit();
    }
  });
  dlg = openDialog({
    title,
    body: h('div.field', h('label', { for: input.id }, label), input, error),
    footer: [h('button.btn', { type: 'button', onclick: () => dlg.close(null) }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: submit }, confirmLabel)],
    initialFocus: input,
  });
  input.select();
  return dlg.result.then((v) => (typeof v === 'string' ? v : null));
}
