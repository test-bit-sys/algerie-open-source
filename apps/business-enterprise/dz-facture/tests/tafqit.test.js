/**
 * DZ-Facture unit tests — Tafqit engine (DZD amount in words: AR / FR / EN).
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  numberToArabicWords,
  tafqitDZD
} from '../src/modules/tafqit.js';

test('Arabic words for common amounts', () => {
  assert.equal(numberToArabicWords(0), 'صفر');
  assert.equal(numberToArabicWords(1), 'واحد');
  assert.equal(numberToArabicWords(21), 'واحد وعشرون');
  assert.equal(numberToArabicWords(2550), 'ألفان وخمسمائة وخمسون');
  assert.equal(numberToArabicWords(1000000), 'مليون');
  assert.equal(numberToArabicWords(2000000), 'مليونان');
  assert.equal(numberToArabicWords(-5), 'سالب خمسة');
});

test('Arabic tafqit uses pure ARABIC letters (regression: Persian ی is forbidden)', () => {
  const out = tafqitDZD(2550.5, { lang: 'ar' });
  assert.ok(out.includes('ألفان'));
  assert.ok(out.includes('سنتيماً'), `expected Arabic سنتيماً, got: ${out}`);
  assert.ok(!out.includes('\u06CC'), 'Persian yeh (U+06CC) must never appear in Arabic output');
  assert.ok(out.endsWith('لا غير'));
});

test('Arabic tafqit handles dinar pluralisation and negative amounts', () => {
  assert.equal(tafqitDZD(2, { lang: 'ar', legalSuffix: false }), 'ديناران جزائريان');
  assert.equal(tafqitDZD(5, { lang: 'ar', legalSuffix: false }), 'خمسة دنانير جزائرية');
  assert.ok(tafqitDZD(-15.25, { lang: 'ar' }).startsWith('سالب'));
  assert.equal(tafqitDZD(NaN), '');
});

test('French tafqit follows the legal invoice formula', () => {
  assert.equal(tafqitDZD(100, { lang: 'fr' }), 'Cent Dinars Algériens et zéro centime');
  assert.equal(tafqitDZD(1.5, { lang: 'fr', legalSuffix: false }), 'Un Dinar Algérien et cinquante Centimes');
});

test('English tafqit', () => {
  assert.equal(tafqitDZD(100, { lang: 'en' }), 'One hundred Algerian Dinars only');
  assert.equal(tafqitDZD(0, { lang: 'en' }), 'Zero Algerian Dinar only');
  assert.equal(tafqitDZD(121.02, { lang: 'en' }), 'One hundred and twenty-one Algerian Dinars and two Centimes');
});
