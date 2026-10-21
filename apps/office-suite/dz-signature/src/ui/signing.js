/**
 * The fill-and-sign experience, shared by the external signing page
 * (sign.html) and in-app self-signing. Renders the document's pages, shows
 * co-signers' completed fields, and makes the current signer's fields
 * interactive.
 *
 * One signature capture "adopts" the signature: after the first, tapping the
 * remaining empty signature fields applies it in one tap. Tapping a filled
 * field reopens the pad to replace it. Date-signed fields fill themselves.
 *
 * A field can also carry a label (what is being asked for), help text (shown
 * while it is being filled), a value the sender filled in, and a read-only
 * flag, in which case the value is shown but never asked of the signer.
 */

import { el, clear } from './dom.js';
import { icon, FIELD_ICONS } from './icons.js';
import {
  fieldLabel, isFieldComplete, isValidInput, inputTypeHint, needsSigner, displayValue, FIELD_LIMITS,
} from '../lib/model.js';
import { mountPages, positionBox } from './pages.js';
import { openSignaturePad } from './sigpad.js';
import { formatDate } from '../lib/util.js';

export function mountSigning({
  container,
  pdf,
  data, // { title, pageCount, fields: [...with mine/value], signerName }
  suggestedName = '',
  savedSignature = null,
  onAdoptSignature = null, // (dataUrl) => void, when "save for next time" is ticked
  onProgress = () => {},
}) {
  const pagesApi = mountPages({ container, pdf, pageCount: data.pageCount });
  const values = {};
  const adopted = { signature: null, initials: null };
  // Read-only fields are mine to LOOK at, never to fill: they are left out of
  // progress, out of the walk to the next incomplete field, and out of the
  // submission.
  const mine = data.fields.filter((f) => f.mine && !f.readOnly);

  // Prefill: values the server already has for me (a reopened page, or a
  // value the sender filled in), and date-signed fields, which record the
  // signing date automatically.
  for (const field of mine) {
    if (field.value !== undefined && field.value !== null) values[field.id] = field.value;
    if (field.type === 'date' && !values[field.id]) values[field.id] = formatDate(Date.now());
  }

  const owed = () => mine.filter(needsSigner);

  function progress() {
    const required = owed();
    const done = required.filter((f) => isFieldComplete(f, values[f.id])).length;
    onProgress({
      done,
      total: required.length,
      complete: isComplete(),
    });
  }

  /**
   * Everything asked of me is answered, and nothing I typed is invalid for
   * the type the sender asked for (an optional field left blank is fine, one
   * holding "not-an-email" is not).
   */
  function isComplete() {
    return owed().every((f) => isFieldComplete(f, values[f.id]))
      && mine.every((f) => isValidInput(f.inputType, values[f.id]));
  }

  /* ---- Boxes ------------------------------------------------------------- */

  function staticBox(field) {
    const label = field.label || fieldLabel(field.type);
    const whose = field.mine
      ? `${label}, filled in for you`
      : (field.signerName ? `${label} for ${field.signerName}` : label);
    const node = el(`div.field-box.${field.mine ? 'c1' : 'c2'}`, { role: 'img' });
    positionBox(node, field);
    // The field arrives with its value already resolved (the sign worker
    // resolves it, and selfsign.js does the same from sigdata): a co-signer's
    // answer, or what the sender filled in. Reading it out of `preset` alone
    // showed an empty box for both.
    const value = displayValue(field, { [field.id]: field.value });
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      node.classList.add('filled');
      if (value && value.kind === 'image') {
        node.append(el('img', { src: value.data, alt: '' }));
        node.setAttribute('aria-label', `${whose}, signed`);
      } else if (value === true) {
        node.innerHTML = icon('check', 15, 3);
        node.style.color = '#14141f';
        node.setAttribute('aria-label', `${whose}, ticked`);
      } else {
        node.append(el('span.fb-text', {}, String(value)));
        // role=img makes the label the whole of what a screen reader gets, so
        // a value that is on the page has to be in the label too.
        node.setAttribute('aria-label', `${whose}: ${value}`);
      }
    } else {
      node.innerHTML = icon(FIELD_ICONS[field.type] || 'textCursor', 12, 2);
      node.append(el('span.fb-label', {}, field.signerName || label));
      node.setAttribute('aria-label', whose);
    }
    return node;
  }

  async function captureSignature(field, node) {
    const kind = field.type === 'initials' ? 'initials' : 'signature';
    const result = await openSignaturePad({
      title: kind === 'initials' ? 'Add your initials' : 'Add your signature',
      kind,
      suggestedName: kind === 'initials'
        ? suggestedName.split(/\s+/).map((w) => w.charAt(0)).join('').toUpperCase()
        : suggestedName,
      // A saved full signature must not be offered for initials fields.
      saved: kind === 'initials' ? adopted.initials : (adopted.signature || savedSignature),
      allowSave: Boolean(onAdoptSignature) && kind === 'signature',
    });
    if (!result) return;
    adopted[kind] = result.dataUrl;
    if (result.saveAsDefault && onAdoptSignature) onAdoptSignature(result.dataUrl);
    values[field.id] = { kind: 'image', data: result.dataUrl };
    rebuildBox(field, node);
    progress();
  }

  /** The native input flavour for a text field's accepted type. */
  function inputAttrs(inputType) {
    switch (inputType) {
      case 'number': return { type: 'text', inputMode: 'decimal' };
      case 'email': return { type: 'email', inputMode: 'email', autocomplete: 'email' };
      case 'date': return { type: 'date' };
      default: return { type: 'text' };
    }
  }

  /** Stable per field, so a rebuilt box still points at its own bubble. */
  const helpId = (field) => (field.help ? `fh-${field.id}` : null);

  function actionableBox(field) {
    const label = field.label || fieldLabel(field.type);
    const describedBy = helpId(field);
    const aria = (suffix = '') =>
      `${label}${field.required !== false ? ', required' : ''}${suffix}`;
    let node;
    if (field.type === 'text') {
      node = el('div.field-box.actionable.c1');
      positionBox(node, field);
      const input = el('input.fb-input', {
        ...inputAttrs(field.inputType),
        placeholder: label,
        // The sign worker truncates beyond this; stop typing before it
        // silently trims.
        maxLength: FIELD_LIMITS.text,
        value: typeof values[field.id] === 'string' ? values[field.id] : '',
        'aria-label': aria(),
        'aria-describedby': describedBy,
        oninput: () => {
          values[field.id] = input.value;
          // Flag a value that can never be accepted (the worker rejects it
          // too) rather than letting Finish fail on submit.
          const bad = !isValidInput(field.inputType, input.value);
          node.classList.toggle('invalid', bad);
          input.setAttribute('aria-invalid', bad ? 'true' : 'false');
          progress();
        },
      });
      node.append(input);
      return node;
    }
    if (field.type === 'checkbox') {
      node = el('div.field-box.actionable.c1');
      positionBox(node, field);
      const input = el('input.fb-check', {
        type: 'checkbox',
        checked: values[field.id] === true,
        'aria-label': aria(),
        'aria-describedby': describedBy,
        onchange: () => {
          values[field.id] = input.checked;
          progress();
        },
      });
      node.append(input);
      return node;
    }
    if (field.type === 'date') {
      node = el('div.field-box.filled.c1', { role: 'img', 'aria-label': `Date signed: ${values[field.id]}` });
      positionBox(node, field);
      node.append(el('span.fb-text', {}, String(values[field.id] || '')));
      return node;
    }
    // signature / initials
    const value = values[field.id];
    if (value && value.kind === 'image') {
      node = el('button.field-box.actionable.filled.c1', {
        type: 'button',
        'aria-label': `${label} added. Activate to replace.`,
        'aria-describedby': describedBy,
      }, el('img', { src: value.data, alt: '' }));
    } else {
      node = el('button.field-box.actionable.c1', {
        type: 'button',
        html: icon(FIELD_ICONS[field.type], 13, 2.2),
        'aria-label': aria('. Activate to sign.'),
        'aria-describedby': describedBy,
      }, el('span.fb-label', {}, field.type === 'initials' ? 'Initial' : 'Sign'));
    }
    positionBox(node, field);
    node.addEventListener('click', () => {
      const kind = field.type === 'initials' ? 'initials' : 'signature';
      const already = values[field.id] && values[field.id].kind === 'image';
      if (!already && adopted[kind]) {
        // One tap applies the adopted signature to further fields.
        values[field.id] = { kind: 'image', data: adopted[kind] };
        rebuildBox(field, node);
        progress();
        return;
      }
      captureSignature(field, node);
    });
    return node;
  }

  function rebuildBox(field, oldNode) {
    const fresh = actionableBox(field);
    // The help bubble is the box's next sibling (CSS reveals it on
    // focus/hover), and replaceWith keeps that order.
    oldNode.replaceWith(fresh);
    boxNodes.set(field.id, fresh);
  }

  /**
   * The sender's help text, anchored under the field. A sibling rather than a
   * child: the box clips its own contents, and a tooltip has to escape it.
   */
  function helpBubble(field) {
    const bubble = el('div.fb-help', { id: helpId(field), role: 'note' }, field.help);
    bubble.style.left = `${field.x * 100}%`;
    bubble.style.top = `${(field.y + field.h) * 100}%`;
    // Near the right edge the bubble would run off the page; anchor it right.
    if (field.x > 0.62) {
      bubble.style.left = 'auto';
      bubble.style.right = `${(1 - field.x - field.w) * 100}%`;
    }
    return bubble;
  }

  const boxNodes = new Map();

  for (const entry of pagesApi.frames) {
    clear(entry.overlay);
    for (const field of data.fields.filter((f) => f.page === entry.index)) {
      const interactive = field.mine && !field.readOnly;
      const node = interactive ? actionableBox(field) : staticBox(field);
      boxNodes.set(field.id, node);
      entry.overlay.append(node);
      if (interactive && field.help) entry.overlay.append(helpBubble(field));
    }
  }
  progress();

  /* ---- API ------------------------------------------------------------------ */

  return {
    getValues: () => ({ ...values }),
    isComplete,
    /** Scroll to and flag the first field that still needs attention. */
    focusFirstIncomplete() {
      const field = owed().find((f) => !isFieldComplete(f, values[f.id]))
        || mine.find((f) => !isValidInput(f.inputType, values[f.id]));
      if (!field) return;
      const node = boxNodes.get(field.id);
      if (!node) return;
      // CSS reduced-motion can't reach JS-driven smooth scrolling.
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      node.classList.remove('attention');
      requestAnimationFrame(() => node.classList.add('attention'));
      // A signature box IS the button, but a text or checkbox box is a plain
      // div wrapping the real control: focusing the wrapper does nothing at
      // all, so the signer was scrolled to the field and then left to find it
      // with the keyboard themselves.
      const target = node.querySelector('input, textarea, select') || node;
      if (target.focus) target.focus({ preventScroll: true });
    },
    destroy: pagesApi.destroy,
  };
}
