/**
 * DZ-Facture unit tests — Algerian geography (58 wilayas).
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WILAYAS, getWilayas, getWilayaByCode } from '../src/modules/geo.js';

test('contains all 58 wilayas with sequential official codes', () => {
  assert.equal(WILAYAS.length, 58);
  WILAYAS.forEach((w, i) => {
    assert.equal(w.code, String(i + 1).padStart(2, '0'));
    assert.ok(w.nameAr && w.nameFr);
  });
});

test('lookup by code accepts loose numeric input', () => {
  assert.equal(getWilayaByCode('16').nameFr, 'Alger');
  assert.equal(getWilayaByCode(16).nameAr, 'الجزائر');
  assert.equal(getWilayaByCode('31').nameFr, 'Oran');
  assert.equal(getWilayaByCode('58').nameFr, 'El Menia');
  assert.equal(getWilayaByCode('59'), null);
  assert.equal(getWilayaByCode(''), null);
});

test('getWilayas exposes the requested language name', () => {
  assert.equal(getWilayas('fr')[15].name, 'Alger');
  assert.equal(getWilayas('ar')[15].name, 'الجزائر');
  assert.equal(getWilayas().length, 58);
});
