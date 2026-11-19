import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNif,
  validateNis,
  validateRc,
  validateNin,
  calculateCcpKey,
  generatePostalRip,
  validateRip,
  validatePaymentCard,
  validateAlgerianPhone,
  tafqitArabic,
  tafqitFrench,
  lookupBankByCode,
  generateBankRib,
  generateTestCard,
  calculateIRGDetails,
  ALGERIAN_BANKS
} from '../src/validators.js';

test('DZ-DevTools: NIF validation (15 digits)', () => {
  const valid = validateNif('001616012345678');
  assert.equal(valid.isValid, true);
  assert.equal(valid.wilayaCode, '00');

  const invalid = validateNif('12345');
  assert.equal(invalid.isValid, false);
});

test('DZ-DevTools: NIS validation (20 digits)', () => {
  const valid = validateNis('00161601001234567890');
  assert.equal(valid.isValid, true);
  assert.equal(valid.nis.length, 20);

  const invalid = validateNis('00161601');
  assert.equal(invalid.isValid, false);
});

test('DZ-DevTools: RC validation (CNRC format)', () => {
  const valid = validateRc('16/00-1234567B22');
  assert.equal(valid.isValid, true);
  assert.equal(valid.wilayaCode, '16');
  assert.equal(valid.category, 'شخص معنوي (Personne Morale)');

  const invalid = validateRc('INVALID_RC');
  assert.equal(invalid.isValid, false);
});

test('DZ-DevTools: NIN validation (18 digits Algerian National ID)', () => {
  // 1 (Male), 16 (Alger), 0123 (Commune), 1995 (Year), 00456 (Acte), 12 (Key)
  const valid = validateNin('116012319950045612');
  assert.equal(valid.isValid, true);
  assert.equal(valid.gender, 'ذكر (Masculin)');
  assert.equal(valid.wilayaCode, '16');
  assert.equal(valid.birthYear, '1995');
  assert.equal(valid.acteNumber, '00456');

  // Female from Oran (31) born in 2002
  const validFemale = validateNin('231004520020123499');
  assert.equal(validFemale.isValid, true);
  assert.equal(validFemale.gender, 'أنثى (Féminin)');
  assert.equal(validFemale.wilayaCode, '31');

  // Invalid length
  assert.equal(validateNin('1160123').isValid, false);
  // Invalid gender digit
  assert.equal(validateNin('316012319950045612').isValid, false);
});

test('DZ-DevTools: CCP key and RIP calculation (Modulo 97)', () => {
  const key = calculateCcpKey('1234567');
  assert.ok(key && key.length === 2);

  const rip = generatePostalRip('1234567');
  assert.equal(rip.bankCode, '007');
  assert.equal(rip.guichetCode, '99999');
  assert.equal(rip.rip.length, 20);

  const validatedRip = validateRip(rip.rip);
  assert.equal(validatedRip.isValid, true);
});

test('DZ-DevTools: Bank directory & 20-digit RIB builder', () => {
  assert.ok(ALGERIAN_BANKS.length >= 15);
  const bna = lookupBankByCode('001');
  assert.ok(bna);
  assert.match(bna.nameAr, /الوطني الجزائري/);
  assert.equal(bna.swift, 'BNADEZAL');

  const rib = generateBankRib('001', '00123', '1234567890');
  assert.ok(rib);
  assert.equal(rib.bankCode, '001');
  assert.equal(rib.guichet, '00123');
  assert.equal(rib.account, '1234567890');
  assert.equal(rib.rib.length, 20);

  // Validate the generated RIB using validateRip
  const val = validateRip(rib.rib);
  assert.equal(val.isValid, true);
});

test('DZ-DevTools: SATIM / CIB / EDAHABIA Test Card Generator', () => {
  const edahabia = generateTestCard('edahabia');
  assert.equal(edahabia.cardNumber.length, 16);
  assert.ok(edahabia.cardNumber.startsWith('628058'));
  const checkEd = validatePaymentCard(edahabia.cardNumber);
  assert.equal(checkEd.isValid, true);
  assert.equal(checkEd.isEdahabia, true);

  const cib = generateTestCard('cib');
  assert.equal(cib.cardNumber.length, 16);
  assert.ok(cib.cardNumber.startsWith('603700'));
  const checkCib = validatePaymentCard(cib.cardNumber);
  assert.equal(checkCib.isValid, true);
});

test('DZ-DevTools: Official Algerian Barème IRG 2024 calculation', () => {
  // Salaires <= 30,000 DA are exempt from IRG
  const exempt = calculateIRGDetails(30000);
  assert.equal(exempt.monthlyTax, 0);
  assert.equal(exempt.effectiveRatePercent, 0);

  // Salary 65,000 DA: in bracket 40,001 - 80,000
  const mid = calculateIRGDetails(65000);
  assert.ok(mid.monthlyTax > 0);
  assert.ok(mid.abattement >= 1000 && mid.abattement <= 1500);
  assert.equal(mid.netImposable, 65000 - mid.monthlyTax);
  assert.equal(mid.annualTax, mid.monthlyTax * 12);
});

test('DZ-DevTools: Phone carrier identification', () => {
  const mobilis = validateAlgerianPhone('0661234567');
  assert.equal(mobilis.isValid, true);
  assert.equal(mobilis.opCode, 'mobilis');

  const djezzy = validateAlgerianPhone('0770123456');
  assert.equal(djezzy.isValid, true);
  assert.equal(djezzy.opCode, 'djezzy');

  const ooredoo = validateAlgerianPhone('0550123456');
  assert.equal(ooredoo.isValid, true);
  assert.equal(ooredoo.opCode, 'ooredoo');
});

test('DZ-DevTools: Tafqit in Algerian Dinars', () => {
  const ar = tafqitArabic(1500.50);
  assert.match(ar, /ألف/);
  assert.match(ar, /دينار جزائري/);
  assert.match(ar, /سنتيم/);

  const fr = tafqitFrench(100);
  assert.match(fr, /cent/);
  assert.match(fr, /dinars algériens/);
});
