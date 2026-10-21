/**
 * The UI for custom fields: the controls a form grows, the values a detail
 * page shows, and the filters a list offers.
 *
 * Definitions come from Settings (see lib/fields.js); everything here is
 * built from whatever is configured right now, so a field added while a
 * page is open shows up the next time that page renders.
 */

import { el } from './dom.js';
import { store } from '../lib/store.js';
import { formatDate } from '../lib/util.js';
import {
  fieldValue, filledFields, formatFieldValue, filterOptionsFor, isFilterable,
  isBlankValue,
} from '../lib/fields.js';

let seq = 0;
const fieldId = () => `cf-${++seq}`;

const asText = (value) => (isBlankValue(value) ? '' : String(value));

/**
 * One control for one field. `read()` returns the value to store, or null
 * for blank - blank has to stay blank, so a number field left empty is not
 * 0 and an untouched yes/no is not No.
 */
function buildControl(field, current) {
  const id = fieldId();
  const label = (control, extra = null) => el('div.field', {},
    el('label.field-label', { for: id }, field.name),
    control,
    extra
  );

  if (field.type === 'checkbox') {
    // A switch says yes or no; it can't say "nobody has answered". So an
    // untouched switch over a blank value reports blank, and only a
    // deliberate toggle writes the No.
    let value = current === true;
    let touched = !isBlankValue(current);
    const knob = el('span.switch-knob', { 'aria-hidden': 'true' });
    const toggle = el('button.switch', {
      type: 'button',
      role: 'switch',
      id,
      'aria-checked': String(value),
      'aria-label': field.name,
      className: `switch${value ? ' on' : ''}`,
      onclick: () => {
        value = !value;
        touched = true;
        toggle.classList.toggle('on', value);
        toggle.setAttribute('aria-checked', String(value));
      },
    }, knob);
    return {
      field,
      node: el('div.field.field-switch', {},
        el('label.field-label', { for: id }, field.name),
        toggle
      ),
      read: () => (touched ? value : null),
    };
  }

  if (field.type === 'select') {
    // A stored value the option list no longer offers still shows, and is
    // still saved unless the user picks something else - editing a lead
    // must not quietly rewrite a field the form wasn't about.
    const options = [...(field.options || [])];
    const stored = asText(current);
    if (stored && !options.some((o) => o.toLowerCase() === stored.toLowerCase())) {
      options.push(stored);
    }
    const select = el('select.select', { id },
      el('option', { value: '', selected: !stored }, 'Not set'),
      options.map((o) => el('option', { value: o, selected: o === stored }, o))
    );
    return {
      field,
      node: label(el('div.select-wrap', {}, select)),
      read: () => select.value || null,
    };
  }

  if (field.type === 'number') {
    const input = el('input.input', {
      id, type: 'number', step: 'any', inputmode: 'decimal',
      value: asText(current),
    });
    return {
      field,
      node: label(input),
      read: () => {
        if (input.value.trim() === '') return null;
        const n = Number(input.value);
        return Number.isFinite(n) ? n : null;
      },
    };
  }

  if (field.type === 'date') {
    const input = el('input.input', { id, type: 'date', value: asText(current) });
    return { field, node: label(input), read: () => input.value || null };
  }

  const input = el('input.input', {
    id, type: 'text', maxlength: 200, autocomplete: 'off', value: asText(current),
  });
  return { field, node: label(input), read: () => input.value.trim() || null };
}

/**
 * Controls for every field configured on `kind`, plus the `custom` bag to
 * save. Returns null when nothing is configured, so a form that has no
 * custom fields grows nothing at all.
 *
 * The bag starts from what the record already holds, so a value stored
 * under a field id this form doesn't show (a hand-edited export, a field
 * removed and added back) survives a save instead of being erased by it.
 */
export function customFieldInputs(kind, record = null) {
  const fields = store.customFields(kind);
  if (!fields.length) return null;
  const controls = fields.map((field) => buildControl(field, fieldValue(record || {}, field)));
  return {
    nodes: [
      el('div.custom-fields', {}, controls.map((c) => c.node)),
    ],
    get: () => {
      const out = { ...(record?.custom || {}) };
      for (const control of controls) {
        const value = control.read();
        if (value === null) delete out[control.field.id];
        else out[control.field.id] = value;
      }
      return out;
    },
  };
}

/**
 * The values a record holds, for a detail page. Only filled fields: a
 * column of "–" tells the reader nothing the edit form doesn't tell them
 * better. Null when there is nothing to show.
 */
export function customFieldRows(kind, record) {
  const rows = filledFields(record, store.customFields(kind));
  if (!rows.length) return null;
  // dl > div > dt + dd: the wrapper is what keeps a name over its own
  // value when the grid wraps into columns, and HTML allows it inside a
  // description list precisely for grouping a pair.
  return el('dl.detail-fields', {}, rows.map(({ field, value }) => el('div.detail-field', {},
    el('dt.detail-field-name', {}, field.name),
    el('dd.detail-field-value', {}, formatFieldValue(field, value, { formatDate }))
  )));
}

/**
 * Filter selects for the choice and yes/no fields on `kind`, for a list
 * view's filter row. Free text and numbers get none - a text box inside a
 * filter row is a search that already exists.
 *
 * `filters` is { [fieldId]: value }; `onChange` receives the next one.
 */
export function customFilterControls(kind, filters, onChange) {
  const fields = store.customFields(kind).filter(isFilterable);
  if (!fields.length) return [];
  const records = store[kind] || [];
  return fields.map((field) => {
    const active = filters?.[field.id] || '';
    const options = filterOptionsFor(field, records);
    // A filter can outlive the last record that matched it. Keep its own
    // value in the list, or the select would read "Any" while the list
    // stayed filtered to nothing.
    if (active && !options.some((o) => o.value.toLowerCase() === active.toLowerCase())) {
      options.push({ value: active, label: active });
    }
    const select = el('select.select.tag-filter-select', {
      'aria-label': `Filter by ${field.name}`,
      dataset: { focusKey: `custom-filter-${field.id}` },
      onchange: () => onChange({ ...filters, [field.id]: select.value }),
    },
      // The name as the user wrote it: lower-casing turned "ICP fit" into
      // "icp fit", and an acronym read as a typo.
      el('option', { value: '', selected: !active }, `Any ${field.name}`),
      options.map((o) => el('option', {
        value: o.value,
        selected: o.value.toLowerCase() === active.toLowerCase(),
      }, o.label))
    );
    return el('div.select-wrap.custom-filter', {}, select);
  });
}

/** "ICP fit: Strong" - what an active field filter is called in a message. */
export function fieldFilterLabel(field, value) {
  if (!field) return '';
  if (field.type === 'checkbox') return `${field.name}: ${value === 'no' ? 'No' : 'Yes'}`;
  return `${field.name}: ${value}`;
}
