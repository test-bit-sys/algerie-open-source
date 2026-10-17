import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNIF,
  validateNIS,
  validateRC,
  calculateCCPKey,
  calculateTimbreFiscal,
  calculateLineItem,
  calculateInvoiceTotals,
  TVA_RATES,
  PAYMENT_METHODS
} from '../src/index.js';

test('NIF validation', () => {
  assert.equal(validateNIF('001216012345678'), true);
  assert.equal(validateNIF('123456789012345'), true);
  assert.equal(validateNIF('12345'), false); // Too short
  assert.equal(validateNIF('00121601234567A'), false); // Contains letter
  assert.equal(validateNIF(null), false);
});

test('NIS validation', () => {
  assert.equal(validateNIS('00011601234567890123'), true); // 20 digits
  assert.equal(validateNIS('0001160123456789012'), false); // 19 digits
});

test('RC validation', () => {
  assert.equal(validateRC('16/00-1234567A20'), true);
  assert.equal(validateRC('31B0123456'), true);
  assert.equal(validateRC('99/00-1234567A20'), false); // Wilaya 99 does not exist
});

test('CCP Key calculation', () => {
  // Account 123456 -> (123456 * 100) % 97 = 12345600 % 97 = 22
  const key = calculateCCPKey('123456');
  assert.equal(key, '22');
});

test('Timbre fiscal calculation for cash payment', () => {
  // Cash payment: 1%
  assert.equal(calculateTimbreFiscal(1000), 10);
  assert.equal(calculateTimbreFiscal(200), 5); // Hits min of 5 DZD
  assert.equal(calculateTimbreFiscal(2000000), 10000); // Hits max limit
});

test('Invoice calculations with multiple items and TVA breakdown', () => {
  const result = calculateInvoiceTotals({
    items: [
      { quantity: 2, unitPriceHT: 5000, discountPercent: 10, tvaRate: TVA_RATES.NORMAL }, // raw 10,000 - 1000 = 9000 HT, TVA 19% = 1710, TTC = 10710
      { quantity: 1, unitPriceHT: 2000, discountPercent: 0, tvaRate: TVA_RATES.REDUIT }    // 2000 HT, TVA 9% = 180, TTC = 2180
    ],
    paymentMethod: PAYMENT_METHODS.ESPECES
  });

  assert.equal(result.totalHT, 11000);
  assert.equal(result.totalDiscount, 1000);
  assert.equal(result.totalTVA, 1890);
  assert.equal(result.subtotalTTC, 12890);
  assert.equal(result.timbreFiscal, 129); // 1% of 12890 = 128.9 -> 129
  assert.equal(result.grandTotalTTC, 13019);

  // Check TVA breakdown
  assert.equal(result.tvaBreakdown['19'].baseHT, 9000);
  assert.equal(result.tvaBreakdown['19'].amountTVA, 1710);
  assert.equal(result.tvaBreakdown['9'].baseHT, 2000);
  assert.equal(result.tvaBreakdown['9'].amountTVA, 180);
});

test('Invoice calculations with bank transfer (no timbre)', () => {
  const result = calculateInvoiceTotals({
    items: [
      { quantity: 1, unitPriceHT: 10000, tvaRate: TVA_RATES.NORMAL }
    ],
    paymentMethod: PAYMENT_METHODS.VIREMENT
  });

  assert.equal(result.totalHT, 10000);
  assert.equal(result.totalTVA, 1900);
  assert.equal(result.subtotalTTC, 11900);
  assert.equal(result.timbreFiscal, 0); // No timbre for wire transfer
  assert.equal(result.grandTotalTTC, 11900);
});
