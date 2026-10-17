import test from 'node:test';
import assert from 'node:assert/strict';
import { WILAYAS, getWilayas, getWilayaByCode, searchWilayas } from '../src/index.js';

test('Wilayas collection contains exactly 58 official Algerian wilayas', () => {
  assert.equal(WILAYAS.length, 58);
  assert.equal(WILAYAS[0].code, '01');
  assert.equal(WILAYAS[0].nameAr, 'أدرار');
  assert.equal(WILAYAS[15].code, '16');
  assert.equal(WILAYAS[15].nameAr, 'الجزائر');
  assert.equal(WILAYAS[15].nameFr, 'Alger');
  assert.equal(WILAYAS[57].code, '58');
  assert.equal(WILAYAS[57].nameAr, 'المنيعة');
});

test('getWilayaByCode lookup', () => {
  const alger = getWilayaByCode('16');
  assert.notEqual(alger, null);
  assert.equal(alger.nameAr, 'الجزائر');

  const oran = getWilayaByCode(31);
  assert.notEqual(oran, null);
  assert.equal(oran.nameFr, 'Oran');

  const invalid = getWilayaByCode('99');
  assert.equal(invalid, null);
});

test('searchWilayas search function', () => {
  const searchAr = searchWilayas('وهران');
  assert.equal(searchAr.length, 1);
  assert.equal(searchAr[0].code, '31');

  const searchFr = searchWilayas('constantine');
  assert.equal(searchFr.length, 1);
  assert.equal(searchFr[0].code, '25');

  const searchNum = searchWilayas('16');
  assert.equal(searchNum.length, 1);
  assert.equal(searchNum[0].nameFr, 'Alger');
});
