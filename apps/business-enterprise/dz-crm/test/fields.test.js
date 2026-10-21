import { describe, it, expect } from 'vitest';
import {
  FIELD_TYPES, MAX_CUSTOM_FIELDS, MAX_FIELD_OPTIONS, MAX_FIELD_NAME,
  normalizeFieldDef, normalizeFieldList, normalizeCustomFields, customFieldsOf,
  normalizeCustomValues, coerceFieldValue, fieldValue, isBlankValue, dropFieldValues,
  retypeReport, formatFieldValue, filledFields, filterOptionsFor, matchesFieldFilter,
  matchesCustomFilters, activeFieldFilters, fieldSignature, isFilterable, makeFieldId,
  blankField,
} from '../src/lib/fields.js';

const field = (over = {}) => ({ id: 'f1', name: 'ICP fit', type: 'text', ...over });

describe('field definitions', () => {
  it('offers five types', () => {
    expect(FIELD_TYPES.map((t) => t.value))
      .toEqual(['text', 'number', 'date', 'select', 'checkbox']);
  });

  it('drops a definition with no name', () => {
    expect(normalizeFieldDef({ id: 'a', name: '   ', type: 'text' })).toBeNull();
    expect(normalizeFieldDef(null)).toBeNull();
    expect(normalizeFieldDef('nope')).toBeNull();
  });

  it('falls back to text for an unknown type, and mints an id from the name', () => {
    expect(normalizeFieldDef({ name: 'Trial end', type: 'wormhole' }))
      .toEqual({ id: 'trial-end', name: 'Trial end', type: 'text' });
  });

  it('carries options only for a choice field, deduped and capped', () => {
    const f = normalizeFieldDef({
      id: 'x', name: 'Plan', type: 'select',
      options: ['Pro', 'pro', '  Team  ', '', ...Array.from({ length: 30 }, (_, i) => `O${i}`)],
    });
    expect(f.options.slice(0, 2)).toEqual(['Pro', 'Team']);
    expect(f.options).toHaveLength(MAX_FIELD_OPTIONS);
    expect(normalizeFieldDef({ name: 'Seats', type: 'number', options: ['a'] }).options)
      .toBeUndefined();
  });

  it('truncates a very long name rather than refusing it', () => {
    const f = normalizeFieldDef({ name: 'x'.repeat(200), type: 'text' });
    expect(f.name).toHaveLength(MAX_FIELD_NAME);
  });

  it('caps the list and drops duplicate ids', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, name: `F${i}` }));
    expect(normalizeFieldList(many)).toHaveLength(MAX_CUSTOM_FIELDS);
    expect(normalizeFieldList([
      { id: 'a', name: 'One' }, { id: 'a', name: 'Two' },
    ])).toHaveLength(1);
    expect(normalizeFieldList('nope')).toEqual([]);
  });

  it('shapes the whole setting into one list per record type', () => {
    expect(normalizeCustomFields(null)).toEqual({ contacts: [], companies: [], deals: [] });
    const all = normalizeCustomFields({ deals: [{ id: 'd', name: 'Trial' }], bogus: [{}] });
    expect(all.deals).toHaveLength(1);
    expect(all.bogus).toBeUndefined();
  });

  it('reads one kind out of a settings object, and nothing for an unknown kind', () => {
    const settings = { customFields: { contacts: [{ id: 'a', name: 'Seats', type: 'number' }] } };
    expect(customFieldsOf(settings, 'contacts')).toHaveLength(1);
    expect(customFieldsOf(settings, 'activities')).toEqual([]);
    expect(customFieldsOf({}, 'contacts')).toEqual([]);
  });

  it('makes unique ids, and a blank field that collides with nothing', () => {
    expect(makeFieldId('Trial End!')).toBe('trial-end');
    expect(makeFieldId('Seats', new Set(['seats']))).toBe('seats-2');
    const taken = new Set(['a']);
    expect(taken.has(blankField(taken).id)).toBe(false);
  });

  it('knows which types a list can filter on', () => {
    expect(isFilterable(field({ type: 'select' }))).toBe(true);
    expect(isFilterable(field({ type: 'checkbox' }))).toBe(true);
    expect(isFilterable(field({ type: 'text' }))).toBe(false);
    expect(isFilterable(field({ type: 'number' }))).toBe(false);
  });
});

describe('values', () => {
  it('treats only null, undefined, and empty string as blank', () => {
    expect(isBlankValue(null)).toBe(true);
    expect(isBlankValue(undefined)).toBe(true);
    expect(isBlankValue('')).toBe(true);
    // The whole point: a record with no answer is not a 0 and not a No.
    expect(isBlankValue(0)).toBe(false);
    expect(isBlankValue(false)).toBe(false);
  });

  it('keeps scalars and drops everything else on the way to storage', () => {
    expect(normalizeCustomValues({
      a: ' text ', b: 42, c: false, d: '', e: null, f: { x: 1 }, g: ['x'], h: NaN,
    })).toEqual({ a: 'text', b: 42, c: false });
    expect(normalizeCustomValues(null)).toEqual({});
    expect(normalizeCustomValues(['a'])).toEqual({});
  });

  it('reads a value as its field type', () => {
    expect(coerceFieldValue(field({ type: 'number' }), '1,200')).toBe(1200);
    expect(coerceFieldValue(field({ type: 'number' }), 'twelve')).toBeUndefined();
    expect(coerceFieldValue(field({ type: 'date' }), '2026-09-30')).toBe('2026-09-30');
    expect(coerceFieldValue(field({ type: 'date' }), '2026-02-30')).toBeUndefined();
    expect(coerceFieldValue(field({ type: 'checkbox' }), 'Yes')).toBe(true);
    expect(coerceFieldValue(field({ type: 'checkbox' }), 'no')).toBe(false);
    expect(coerceFieldValue(field({ type: 'checkbox' }), 'maybe')).toBeUndefined();
    expect(coerceFieldValue(field({ type: 'text' }), 42)).toBe('42');
    expect(coerceFieldValue(field({ type: 'text' }), true)).toBe('Yes');
    expect(coerceFieldValue(field({ type: 'number' }), null)).toBeNull();
  });

  it('reads a record that has no value for a field as blank', () => {
    expect(fieldValue({}, field())).toBeNull();
    expect(fieldValue({ custom: {} }, field())).toBeNull();
    expect(fieldValue({ custom: { f1: 'Strong' } }, field())).toBe('Strong');
    // A stored value that can't be read as the type reads as blank rather
    // than as a broken value on the page.
    expect(fieldValue({ custom: { f1: 'nope' } }, field({ type: 'number' }))).toBeNull();
  });

  it('drops named values off a record', () => {
    const record = { custom: { a: 1, b: 2 } };
    expect(dropFieldValues(record, ['a'])).toBe(true);
    expect(record.custom).toEqual({ b: 2 });
    expect(dropFieldValues(record, ['zzz'])).toBe(false);
    expect(dropFieldValues({}, ['a'])).toBe(false);
  });
});

describe('retypeReport', () => {
  const records = [
    { id: 'r1', custom: { f1: '12' } },
    { id: 'r2', custom: { f1: 'many' } },
    { id: 'r3', custom: {} },
    { id: 'r4' },
  ];

  it('counts what a type change would touch, and what it would lose', () => {
    const report = retypeReport(records, field(), 'number');
    expect(report.total).toBe(2);
    expect(report.blocked.map((b) => b.record.id)).toEqual(['r2']);
  });

  it('blocks nothing when everything converts', () => {
    const report = retypeReport([{ id: 'r', custom: { f1: '5' } }], field(), 'number');
    expect(report).toMatchObject({ total: 1, blocked: [] });
  });

  it('ignores records with no value at all', () => {
    expect(retypeReport([{ id: 'r' }], field(), 'date')).toEqual({ total: 0, blocked: [] });
  });
});

describe('display', () => {
  it('spells a value out for a page', () => {
    expect(formatFieldValue(field({ type: 'checkbox' }), true)).toBe('Yes');
    expect(formatFieldValue(field({ type: 'checkbox' }), false)).toBe('No');
    expect(formatFieldValue(field({ type: 'number' }), 12500)).toBe('12,500');
    expect(formatFieldValue(field({ type: 'date' }), '2026-09-30',
      { formatDate: () => 'Sep 30' })).toBe('Sep 30');
    expect(formatFieldValue(field(), null)).toBe('');
  });

  it('lists only the fields a record has answered', () => {
    const fields = [field({ id: 'a', name: 'A' }), field({ id: 'b', name: 'B' })];
    const rows = filledFields({ custom: { b: 'yes' } }, fields);
    expect(rows).toHaveLength(1);
    expect(rows[0].field.id).toBe('b');
  });
});

describe('filtering', () => {
  const plan = field({ id: 'plan', name: 'Plan', type: 'select', options: ['Pro', 'Team'] });
  const trial = field({ id: 'trial', name: 'Trial', type: 'checkbox' });
  const records = [
    { id: 'r1', custom: { plan: 'Pro', trial: true } },
    { id: 'r2', custom: { plan: 'Legacy', trial: false } },
    { id: 'r3', custom: {} },
  ];

  it('offers the field options plus values records still carry', () => {
    expect(filterOptionsFor(plan, records).map((o) => o.value))
      .toEqual(['Pro', 'Team', 'Legacy']);
    expect(filterOptionsFor(trial, records).map((o) => o.value)).toEqual(['yes', 'no']);
  });

  it('matches a value, and never matches a blank against a real filter', () => {
    expect(matchesFieldFilter(records[0], plan, 'Pro')).toBe(true);
    expect(matchesFieldFilter(records[0], plan, 'pro')).toBe(true);
    expect(matchesFieldFilter(records[1], plan, 'Pro')).toBe(false);
    expect(matchesFieldFilter(records[2], plan, 'Pro')).toBe(false);
    expect(matchesFieldFilter(records[2], plan, '')).toBe(true);
    expect(matchesFieldFilter(records[0], trial, 'yes')).toBe(true);
    expect(matchesFieldFilter(records[1], trial, 'no')).toBe(true);
    // Blank is not a No: a record nobody has answered for doesn't match.
    expect(matchesFieldFilter(records[2], trial, 'no')).toBe(false);
  });

  it('ANDs the active filters and ignores one naming a field that is gone', () => {
    const fields = [plan, trial];
    expect(matchesCustomFilters(records[0], fields, { plan: 'Pro', trial: 'yes' })).toBe(true);
    expect(matchesCustomFilters(records[0], fields, { plan: 'Pro', trial: 'no' })).toBe(false);
    expect(matchesCustomFilters(records[0], fields, { ghost: 'x' })).toBe(true);
    expect(matchesCustomFilters(records[0], fields, {})).toBe(true);
    expect(matchesCustomFilters(records[0], fields, null)).toBe(true);
  });

  it('reports which filters are actually on', () => {
    const active = activeFieldFilters([plan, trial], { plan: 'Pro', trial: '', ghost: 'x' });
    expect(active).toHaveLength(1);
    expect(active[0].field.id).toBe('plan');
  });

  it('signs the configuration so a view can tell when its filters are stale', () => {
    const a = fieldSignature([plan]);
    expect(fieldSignature([plan])).toBe(a);
    expect(fieldSignature([{ ...plan, name: 'Plan tier' }])).not.toBe(a);
    expect(fieldSignature([{ ...plan, options: ['Pro'] }])).not.toBe(a);
    expect(fieldSignature([])).toBe('');
  });
});
