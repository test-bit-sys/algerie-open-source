/** Shared form field builders. */

import { el } from './dom.js';
import { ratePeriods } from '../lib/store.js';
import { fmtMoney } from '../lib/util.js';
import { fmtDay } from '../lib/time.js';

let idSeq = 0;
const nextId = (prefix) => `${prefix}-${++idSeq}`;

/* One wording for an unparseable hourly rate, wherever one is typed. */
export const RATE_ERROR = 'Enter the rate as a number, like 120';

/** Label + control, wired together for a11y. */
export function field(label, control, { hint = null } = {}) {
  const id = control.id || nextId('f');
  control.id = id;
  const hintNode = hint ? el('p.field-hint', { id: `${id}-hint` }, hint) : null;
  if (hintNode) control.setAttribute('aria-describedby', hintNode.id);
  return el('div.field', {},
    el('label.field-label', { htmlFor: id }, label),
    control.classList.contains('select') ? el('div.select-wrap', {}, control) : control,
    hintNode
  );
}

/**
 * Inline error slot under a field; call .show(msg) / .hide().
 *
 * Pass the control it belongs to and the message is tied to it, not just
 * printed near it: aria-invalid marks the field as the one at fault, and
 * aria-describedby means coming back to it reads the reason out. The alert
 * role only speaks once, as the message appears; a field re-visited later
 * would otherwise announce nothing but its label. Any hint the field
 * already carries is kept alongside the error, never replaced.
 */
export function fieldError(control = null) {
  const node = el('p.field-error', { role: 'alert', hidden: true, id: nextId('err') });
  const others = () => (control.getAttribute('aria-describedby') || '')
    .split(/\s+/).filter((id) => id && id !== node.id);
  node.show = (msg) => {
    node.textContent = msg;
    node.hidden = false;
    if (!control) return;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', [...others(), node.id].join(' '));
  };
  node.hide = () => {
    node.hidden = true;
    if (!control) return;
    control.removeAttribute('aria-invalid');
    const rest = others();
    if (rest.length) control.setAttribute('aria-describedby', rest.join(' '));
    else control.removeAttribute('aria-describedby');
  };
  return node;
}

/**
 * Give a control's native constraint failure the field's own wording.
 *
 * Constraint validation runs before the submit event, so a form's handler
 * never ran for an empty required field, and neither did any of the
 * messages written in it: all the user got was the browser's generic
 * bubble, phrased by the browser and gone on the next keystroke. Canceling
 * the invalid event takes the field off the list the browser reports on, so
 * no bubble appears while submission stays blocked exactly as before, and
 * the field's own slot says what is wrong instead. The message clears as
 * soon as the field is valid again, so nothing is left flagged after a fix.
 */
export function nativeError(control, err, message) {
  control.addEventListener('invalid', (e) => {
    e.preventDefault();
    // invalid fires on every field at fault, in document order; the first
    // of them is where the user should land, since the browser no longer
    // moves focus itself.
    const isFirst = !control.form?.querySelector('[aria-invalid="true"]');
    err.show(message);
    if (isFirst) control.focus();
  });
  const clear = () => { if (control.validity.valid) err.hide(); };
  control.addEventListener('input', clear);
  control.addEventListener('change', clear);
}

/**
 * One-line history of an effective-dated rate ("$100.00/h before ·
 * $120.00/h from Mar 1, 2026"). A single always-period is fully shown by
 * the rate input itself and gets no line; a single dated period does (the
 * input only shows the rate in effect today, so a scheduled or dated rate
 * would otherwise be invisible). A period without a rate is one where
 * this level stops billing at its own rate, so it names the fall-through
 * rather than printing a zero.
 */
export function rateHistoryLine(value, currency) {
  const periods = ratePeriods(value);
  if (!periods.length || (periods.length === 1 && periods[0].from == null)) return null;
  const parts = periods.map((p) => {
    const rate = p.rate == null ? 'inherited rate' : `${fmtMoney(p.rate, currency)}/h`;
    return p.from ? `${rate} from ${fmtDay(p.from, { year: true })}` : `${rate} before`;
  });
  return el('p.field-hint', {}, `Rate history: ${parts.join(' · ')}`);
}

/** Small colored dot identifying a client (color slot 1..8). */
export function colorDot(slot, size = 10) {
  return el('span.color-dot', {
    style: { width: `${size}px`, height: `${size}px`, background: `var(--series-${slot || 8})` },
    'aria-hidden': 'true',
  });
}

/**
 * <select> of active projects grouped by client. Pass allowEmpty for a
 * "Select a project" placeholder row that blocks submit until changed.
 */
export function projectSelect(store, selectedId = null, { allowEmpty = true } = {}) {
  const select = el('select.select', { required: true });
  if (allowEmpty) {
    select.append(el('option', { value: '', selected: !selectedId, disabled: true }, 'Select a project'));
  }
  for (const client of store.activeClients()) {
    const projects = store.projectsOf(client.id);
    if (!projects.length) continue;
    const group = el('optgroup', { label: client.name });
    for (const p of projects) {
      group.append(el('option', { value: p.id, selected: p.id === selectedId }, p.name));
    }
    select.append(group);
  }
  // An archived project on an old entry still needs to show as itself.
  if (selectedId && !store.activeProjects().some((p) => p.id === selectedId)) {
    const p = store.project(selectedId);
    if (p) select.append(el('option', { value: p.id, selected: true }, `${p.name} (archived)`));
  }
  return select;
}

/** iOS-style switch built on a real checkbox. */
export function switchField(label, checked, { hint = null } = {}) {
  const input = el('input.switch-input', { type: 'checkbox', checked });
  const id = nextId('sw');
  input.id = id;
  // Tied to the checkbox like field() does it: the hint carries what the
  // switch actually costs ("Nothing is requested until you turn this
  // on"), and sitting next to it on screen does not read it out.
  const hintNode = hint ? el('p.field-hint', { id: `${id}-hint`, style: { margin: 0 } }, hint) : null;
  if (hintNode) input.setAttribute('aria-describedby', hintNode.id);
  const node = el('div.switch-row', {},
    el('div.grow', {},
      el('label.switch-label', { htmlFor: id }, label),
      hintNode
    ),
    el('span.switch', {}, input, el('span.switch-thumb', { 'aria-hidden': 'true' }))
  );
  node.input = input;
  return node;
}
