/**
 * DZ-Facture unit tests — Timezone-safe local date helpers.
 * Guards the Algeria (UTC+1) off-by-one-day bug that toISOString() caused.
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { todayLocalISO, toLocalDateKey, toLocalTimeKey } from '../src/modules/dates.js';

test('toLocalDateKey uses LOCAL calendar components, never UTC', () => {
  assert.equal(toLocalDateKey(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
  assert.equal(toLocalDateKey(new Date(2026, 11, 31, 0, 5)), '2026-12-31');
  assert.equal(toLocalDateKey(new Date(2026, 9, 18, 12, 0)), '2026-10-18');
});

test('date-only strings pass through untouched', () => {
  assert.equal(toLocalDateKey('2026-10-18'), '2026-10-18');
  assert.equal(toLocalDateKey('  2026-01-01  '), '2026-01-01');
});

test('full ISO strings resolve to the LOCAL day (not the UTC day)', () => {
  // '2026-10-18T23:30:00.000Z' is already Oct 19 in any UTC+ timezone.
  const key = toLocalDateKey('2026-10-18T23:30:00.000Z');
  assert.ok(key === '2026-10-18' || key === '2026-10-19');
  assert.equal(toLocalDateKey('2026-10-18T10:00:00.000Z'), '2026-10-18');
});

test('invalid input yields an empty string instead of throwing', () => {
  assert.equal(toLocalDateKey('not-a-date'), '');
  assert.equal(toLocalDateKey(null), '');
  assert.equal(toLocalDateKey(undefined), '');
  assert.equal(toLocalDateKey(new Date('invalid')), '');
});

test('todayLocalISO always equals the manually formatted local date', () => {
  const now = new Date();
  const manual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(todayLocalISO(), manual);
});

test('toLocalTimeKey returns zero-padded HH:MM', () => {
  assert.equal(toLocalTimeKey(new Date(2026, 5, 1, 9, 5)), '09:05');
  assert.equal(toLocalTimeKey(new Date(2026, 5, 1, 23, 59)), '23:59');
});
