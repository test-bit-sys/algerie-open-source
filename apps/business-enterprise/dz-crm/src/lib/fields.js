/**
 * Custom fields: the per-record data this particular business has to track.
 *
 * Settings already lets a founder shape the funnel - stage names, order,
 * win probabilities, tags. The *fields* were fixed, so seats, trial end
 * date, ICP fit, or who referred them went into the free-text notes blob,
 * where nothing could filter, sort, or export them.
 *
 * Definitions live in `crm:settings:v1` as
 *   customFields: { contacts: [{ id, name, type, options }], companies: [], deals: [] }
 * and values live on the record itself as `custom: { [fieldId]: value }`,
 * so JSON export/import, CSV, and the trash restore path carry them
 * without a second store to fall out of step.
 *
 * Pure functions over plain objects - no Puter, no DOM. Deliberately no
 * dependency on csv.js: that module reads this one, and spreadsheet-shaped
 * coercion (loose dates, money cells) belongs on its side of the line.
 */

import { uid, isValidISODate } from './util.js';

/** The record types that can carry custom fields, in Settings order. */
export const CUSTOM_KINDS = [
  { key: 'contacts', label: 'Leads', one: 'lead', icon: 'users' },
  { key: 'companies', label: 'Companies', one: 'company', icon: 'company' },
  { key: 'deals', label: 'Deals', one: 'deal', icon: 'deal' },
];

const KIND_KEYS = CUSTOM_KINDS.map((k) => k.key);

/**
 * What a field can hold. Five types cover what a small business tracks;
 * anything richer (formulas, conditional visibility) is a different app.
 */
export const FIELD_TYPES = [
  // `noun` is how a sentence names the type: "a value that isn't a date".
  { value: 'text', label: 'Text', noun: 'text' },
  { value: 'number', label: 'Number', noun: 'a number' },
  { value: 'date', label: 'Date', noun: 'a date' },
  { value: 'select', label: 'Choice', noun: 'a choice', hasOptions: true },
  { value: 'checkbox', label: 'Yes / no', noun: 'a yes or a no' },
];

const TYPE_IDS = new Set(FIELD_TYPES.map((t) => t.value));

/** A modest cap keeps the forms, the detail pages, and the CSV honest. */
export const MAX_CUSTOM_FIELDS = 10;
export const MAX_FIELD_OPTIONS = 20;
export const MAX_FIELD_NAME = 40;
export const MAX_OPTION_LENGTH = 40;

export function fieldTypeInfo(type) {
  return FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0];
}

/** Does this type carry its own list of choices? */
export function hasOptions(type) {
  return type === 'select';
}

/** Can a list view filter on this type? Free text and numbers can't. */
export function isFilterable(field) {
  return field?.type === 'select' || field?.type === 'checkbox';
}

const str = (v) => (typeof v === 'string' ? v : '');

/** Readable, collision-free id for a new field ("Trial end" → trial-end). */
export function makeFieldId(name, taken = new Set()) {
  const base = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'field';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function normalizeOptions(raw) {
  const seen = new Set();
  const out = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    const label = str(o).trim().slice(0, MAX_OPTION_LENGTH);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_FIELD_OPTIONS) break;
  }
  return out;
}

/**
 * One field definition, or null for anything unusable. A blank name is
 * dropped rather than rendered as an unlabelled input on every form.
 */
export function normalizeFieldDef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name).trim().slice(0, MAX_FIELD_NAME);
  if (!name) return null;
  const type = TYPE_IDS.has(raw.type) ? raw.type : 'text';
  const id = str(raw.id).trim() || makeFieldId(name);
  const field = { id, name, type };
  if (hasOptions(type)) field.options = normalizeOptions(raw.options);
  return field;
}

/** A field list: definitions only, ids unique, capped. */
export function normalizeFieldList(raw) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const field = normalizeFieldDef(item);
    if (!field || seen.has(field.id)) continue;
    seen.add(field.id);
    out.push(field);
    if (out.length >= MAX_CUSTOM_FIELDS) break;
  }
  return out;
}

/** The whole `customFields` setting, shaped: one list per record type. */
export function normalizeCustomFields(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of KIND_KEYS) out[key] = normalizeFieldList(source[key]);
  return out;
}

/** The fields configured for one record type ('contacts' | 'companies' | 'deals'). */
export function customFieldsOf(settings, kind) {
  if (!KIND_KEYS.includes(kind)) return [];
  return normalizeFieldList(settings?.customFields?.[kind]);
}

/** Is `kind` a record type that can carry custom fields? */
export function isCustomKind(kind) {
  return KIND_KEYS.includes(kind);
}

/* ---------- values ---------- */

/** Blank means "no value": never 0, never false, never "". */
export function isBlankValue(value) {
  return value === null || value === undefined || value === '';
}

const numberOf = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // Thousands separators and stray spaces are how people type numbers.
  const cleaned = value.replace(/[,\s]/g, '');
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const TRUE_WORDS = /^(y|yes|true|1|on|checked)$/i;
const FALSE_WORDS = /^(n|no|false|0|off|unchecked)$/i;

const boolOf = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (TRUE_WORDS.test(raw)) return true;
  if (FALSE_WORDS.test(raw)) return false;
  return null;
};

const textOf = (value) => {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return str(value).trim();
};

/**
 * A stored value read as the field's type: the value, `null` for blank, or
 * `undefined` when it cannot be read that way at all.
 *
 * The three-way answer is the point. Changing a field's type has to either
 * convert cleanly or refuse - silently dropping what a record already holds
 * is the one outcome a custom field can't have.
 */
export function coerceFieldValue(field, value) {
  if (isBlankValue(value)) return null;
  switch (field?.type) {
    case 'number': {
      const n = numberOf(value);
      return n === null ? undefined : n;
    }
    case 'date': {
      const text = textOf(value);
      return isValidISODate(text) ? text : undefined;
    }
    case 'checkbox': {
      const b = boolOf(value);
      return b === null ? undefined : b;
    }
    // Text and choice take anything that can be written down. A choice
    // keeps a value the option list no longer has rather than erasing it -
    // the form shows it and the filter offers it.
    case 'select':
    case 'text':
    default: {
      const text = textOf(value);
      return text === '' ? null : text;
    }
  }
}

/** The value a record holds for a field, read as that field's type. */
export function fieldValue(record, field) {
  const raw = record?.custom?.[field?.id];
  const value = coerceFieldValue(field, raw);
  return value === undefined ? null : value;
}

/**
 * Shape a `custom` bag for storage: scalars only, blanks dropped so an
 * absent value stays absent instead of becoming "" on every save.
 */
export function normalizeCustomValues(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key || isBlankValue(value)) continue;
    if (typeof value === 'string') {
      const text = value.trim();
      if (text) out[key] = text;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
    // Anything else (objects, arrays) is not a field value.
  }
  return out;
}

/** Strip the listed field ids from a record's values. Returns whether it changed. */
export function dropFieldValues(record, ids) {
  if (!record?.custom || !ids?.length) return false;
  let changed = false;
  for (const id of ids) {
    if (Object.prototype.hasOwnProperty.call(record.custom, id)) {
      delete record.custom[id];
      changed = true;
    }
  }
  return changed;
}

/**
 * Every stored value a retype would have to convert, and whether it can.
 *
 *   { total, blocked: [{ record, value }] }
 *
 * `blocked` is what the caller must refuse over - "3 leads hold a value
 * that isn't a number" beats losing them.
 */
export function retypeReport(records, field, nextType) {
  const target = { ...field, type: nextType };
  const report = { total: 0, blocked: [] };
  for (const record of Array.isArray(records) ? records : []) {
    const raw = record?.custom?.[field.id];
    if (isBlankValue(raw)) continue;
    report.total++;
    if (coerceFieldValue(target, raw) === undefined) report.blocked.push({ record, value: raw });
  }
  return report;
}

/* ---------- display ---------- */

/** What a value reads as on a row, a detail page, or a chip. '' for blank. */
export function formatFieldValue(field, value, { formatDate = (v) => v } = {}) {
  if (isBlankValue(value)) return '';
  switch (field?.type) {
    case 'checkbox': return value ? 'Yes' : 'No';
    case 'date': return formatDate(value);
    case 'number': return typeof value === 'number' ? value.toLocaleString('en-US') : textOf(value);
    default: return textOf(value);
  }
}

/** Fields this record actually has a value for, in configured order. */
export function filledFields(record, fields) {
  return (fields || [])
    .map((field) => ({ field, value: fieldValue(record, field) }))
    .filter((row) => !isBlankValue(row.value));
}

/* ---------- filtering ---------- */

/**
 * The choices a filter offers for one field: its own options plus any
 * value records still carry that the list has since lost (so a filter can
 * always reach what is actually stored), or Yes/No for a checkbox.
 */
export function filterOptionsFor(field, records = []) {
  if (field.type === 'checkbox') {
    return [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  }
  const seen = new Map();
  for (const option of field.options || []) seen.set(option.toLowerCase(), option);
  for (const record of records) {
    const value = fieldValue(record, field);
    if (isBlankValue(value)) continue;
    const key = String(value).toLowerCase();
    if (!seen.has(key)) seen.set(key, String(value));
  }
  return [...seen.values()].map((option) => ({ value: option, label: option }));
}

/** Does a record match one field filter? An empty filter matches everything. */
export function matchesFieldFilter(record, field, wanted) {
  if (!wanted) return true;
  const value = fieldValue(record, field);
  if (field.type === 'checkbox') {
    if (wanted === 'yes') return value === true;
    if (wanted === 'no') return value === false;
    return true;
  }
  if (isBlankValue(value)) return false;
  return String(value).toLowerCase() === String(wanted).toLowerCase();
}

/**
 * Does a record match every active field filter? `filters` is
 * { [fieldId]: value }; a filter naming a field that no longer exists is
 * ignored rather than emptying the list.
 */
export function matchesCustomFilters(record, fields, filters) {
  if (!filters) return true;
  for (const [id, wanted] of Object.entries(filters)) {
    if (!wanted) continue;
    const field = (fields || []).find((f) => f.id === id);
    if (!field) continue;
    if (!matchesFieldFilter(record, field, wanted)) return false;
  }
  return true;
}

/** Field filters that are actually on, and still name a field that exists. */
export function activeFieldFilters(fields, filters) {
  if (!filters) return [];
  return Object.entries(filters)
    .filter(([, value]) => !!value)
    .map(([id, value]) => ({ field: (fields || []).find((f) => f.id === id), value }))
    .filter((row) => !!row.field);
}

/**
 * A comparable signature of the configured fields, so a view can tell
 * whether its filter row is out of date - the same bargain tagVocabulary
 * strikes for tags.
 */
export function fieldSignature(fields) {
  return (fields || [])
    .map((f) => [f.id, f.name, f.type, (f.options || []).join('')].join(''))
    .join('\0');
}

/** A fresh field, ready for the Settings editor. */
export function blankField(taken = new Set()) {
  const name = 'New field';
  return { id: makeFieldId(`${name}-${uid().slice(0, 4)}`, taken), name, type: 'text' };
}
