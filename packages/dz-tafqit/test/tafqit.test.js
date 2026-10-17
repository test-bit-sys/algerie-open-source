import test from 'node:test';
import assert from 'node:assert/strict';
import { tafqitDZD, numberToArabicWords, numberToFrenchWords, numberToEnglishWords } from '../src/index.js';

test('Arabic number words', () => {
  assert.equal(numberToArabicWords(0), 'صفر');
  assert.equal(numberToArabicWords(5), 'خمسة');
  assert.equal(numberToArabicWords(15), 'خمسة عشر');
  assert.equal(numberToArabicWords(100), 'مائة');
  assert.equal(numberToArabicWords(250), 'مائتان وخمسون');
  assert.equal(numberToArabicWords(1000), 'ألف');
  assert.equal(numberToArabicWords(15000), 'خمسة عشر ألفاً');
  assert.equal(numberToArabicWords(1000000), 'مليون');
  assert.equal(numberToArabicWords(2000000), 'مليونان');
});

test('Arabic DZD Tafqit with currency and legal suffix', () => {
  const t1 = tafqitDZD(150, { lang: 'ar', legalSuffix: true });
  assert.equal(t1, 'مائة وخمسون ديناراً جزائرياً لا غير');

  const t2 = tafqitDZD(1, { lang: 'ar', legalSuffix: true });
  assert.equal(t2, 'دينار جزائري واحد لا غير');

  const t3 = tafqitDZD(2, { lang: 'ar', legalSuffix: true });
  assert.equal(t3, 'ديناران جزائريان لا غير');

  const t4 = tafqitDZD(5, { lang: 'ar', legalSuffix: true });
  assert.equal(t4, 'خمسة دنانير جزائرية لا غير');

  const t5 = tafqitDZD(1250.50, { lang: 'ar', legalSuffix: true });
  assert.equal(t5, 'ألف ومائتان وخمسون ديناراً جزائرياً وخمسون سنتیماً لا غير');
});

test('French number words', () => {
  assert.equal(numberToFrenchWords(0), 'zéro');
  assert.equal(numberToFrenchWords(21), 'vingt et un');
  assert.equal(numberToFrenchWords(80), 'quatre-vingts');
  assert.equal(numberToFrenchWords(85), 'quatre-vingt-cinq');
  assert.equal(numberToFrenchWords(100), 'cent');
  assert.equal(numberToFrenchWords(200), 'deux cents');
  assert.equal(numberToFrenchWords(1000), 'mille');
});

test('French DZD Tafqit', () => {
  const f1 = tafqitDZD(150, { lang: 'fr', legalSuffix: true });
  assert.equal(f1, 'Cent cinquante Dinars Algériens et zéro centime');

  const f2 = tafqitDZD(1250.50, { lang: 'fr', legalSuffix: false });
  assert.equal(f2, 'Mille deux cent cinquante Dinars Algériens et cinquante Centimes');
});

test('English number words and DZD Tafqit', () => {
  assert.equal(numberToEnglishWords(0), 'zero');
  assert.equal(numberToEnglishWords(21), 'twenty-one');
  assert.equal(numberToEnglishWords(105), 'one hundred and five');
  assert.equal(numberToEnglishWords(1250), 'one thousand two hundred and fifty');

  const e1 = tafqitDZD(150, { lang: 'en', legalSuffix: true });
  assert.equal(e1, 'One hundred and fifty Algerian Dinars only');

  const e2 = tafqitDZD(1250.50, { lang: 'en', legalSuffix: false });
  assert.equal(e2, 'One thousand two hundred and fifty Algerian Dinars and fifty Centimes');
});

