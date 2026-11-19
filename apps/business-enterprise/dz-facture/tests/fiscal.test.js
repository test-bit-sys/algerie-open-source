/**
 * DZ-Facture unit tests — Fiscal engine (TVA, timbre fiscal, TTC split).
 * Run: npm test   (uses Node.js built-in test runner, zero dependencies)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLineItem,
  calculateInvoiceTotals,
  calculateTimbreFiscal,
  splitTTCByRates,
  round2,
  validateNIF,
  validateNIS,
  validateRC,
  calculateCCPKey,
  computeEtat104,
  exportEtat104ToCSV,
  PAYMENT_METHODS
} from '../src/modules/fiscal.js';

test('round2 normalises floating-point noise', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1234.567), 1234.57);
  assert.equal(round2(0), 0);
});

test('calculateLineItem computes HT / TVA / TTC for a standard 19% line', () => {
  const line = calculateLineItem({ quantity: 2, unitPriceHT: 1000, tvaRate: 19 });
  assert.equal(line.totalHT, 2000);
  assert.equal(line.totalTVA, 380);
  assert.equal(line.totalTTC, 2380);
  assert.equal(line.discountAmount, 0);
});

test('calculateLineItem applies percentage discount before TVA', () => {
  const line = calculateLineItem({ quantity: 1, unitPriceHT: 2000, discountPercent: 10, tvaRate: 19 });
  assert.equal(line.discountAmount, 200);
  assert.equal(line.totalHT, 1800);
  assert.equal(line.totalTVA, 342);
});

test('timbre fiscal: 1% on cash only, min 5 DZD, capped at 10 000 DZD', () => {
  assert.equal(calculateTimbreFiscal(0), 0);
  assert.equal(calculateTimbreFiscal(100), 5);        // 1 DZD raised to legal minimum
  assert.equal(calculateTimbreFiscal(1000), 10);      // exactly 1%
  assert.equal(calculateTimbreFiscal(1190), 12);      // ceil(11.90)
  assert.equal(calculateTimbreFiscal(2000000), 10000); // legal maximum cap
  assert.equal(calculateTimbreFiscal(-50), 0);
});

test('calculateInvoiceTotals adds the stamp duty ONLY for cash payments', () => {
  const items = [{ quantity: 1, unitPriceHT: 1000, tvaRate: 19 }];
  const cash = calculateInvoiceTotals({ items, paymentMethod: PAYMENT_METHODS.ESPECES });
  assert.equal(cash.subtotalTTC, 1190);
  assert.equal(cash.timbreFiscal, 12);
  assert.equal(cash.grandTotalTTC, 1202);

  const transfer = calculateInvoiceTotals({ items, paymentMethod: PAYMENT_METHODS.VIREMENT });
  assert.equal(transfer.timbreFiscal, 0);
  assert.equal(transfer.grandTotalTTC, 1190);
});

test('splitTTCByRates: HT + TVA === TTC to the cent (POS shelf-price model)', () => {
  const items = [
    { quantity: 1, unitPriceTTC: 18500, tvaRate: 19 },
    { quantity: 1, unitPriceTTC: 8900, tvaRate: 19 },
    { quantity: 2, unitPriceTTC: 4200, tvaRate: 9 },
    { quantity: 3, unitPriceTTC: 500, tvaRate: 0 }
  ];
  const r = splitTTCByRates(items);
  assert.equal(r.totalTTC, 37300);
  assert.equal(round2(r.totalHT + r.totalTVA), 37300);
  assert.equal(r.tvaBreakdown['19'].amountTVA, round2((27400 * 19) / 119));
  assert.equal(r.tvaBreakdown['9'].amountTVA, round2((8400 * 9) / 109));
  assert.equal(r.tvaBreakdown['0'].baseHT, 1500);
  assert.equal(r.tvaBreakdown['0'].amountTVA, 0);
});

test('NIF (15 digits) / NIS (20 digits) / RC validators', () => {
  assert.equal(validateNIF('001616012345678'), true);
  assert.equal(validateNIF('00161601234567'), false);
  assert.equal(validateNIF(''), false);
  assert.equal(validateNIS('00161601234567890123'), true);
  assert.equal(validateNIS('00161601234567890'), false);
  assert.equal(validateRC('16/00-1234567B22'), true);
  assert.equal(validateRC('99/00-1234567B22'), false); // wilaya 99 does not exist
});

test('CCP key: mod-97 postal algorithm', () => {
  const account = 1234567;
  const expected = ((account * 100) % 97) || 97;
  const key = calculateCCPKey(String(account));
  assert.match(key, /^\d{2}$/);
  assert.equal(Number(key), expected);
  assert.equal(calculateCCPKey('not-a-number'), '');
});

test('DZ-Facture: Official État 104 des Clients (Art. 224 CIDTA - DGI)', () => {
  const sampleInvoices = [
    {
      docType: 'FACTURE',
      docDate: '2026-02-10',
      clientName: 'مؤسسة السلام',
      clientNif: '003116098765432',
      clientRc: '31/00-9876543B20',
      clientAddress: 'وهران',
      totalHT: 100000,
      totalTVA: 19000,
      timbreFiscal: 0,
      totalTTC: 119000,
      paymentMethod: 'VIREMENT'
    },
    {
      docType: 'FACTURE',
      docDate: '2026-03-15',
      clientName: 'مؤسسة السلام',
      clientNif: '003116098765432',
      clientRc: '31/00-9876543B20',
      clientAddress: 'وهران',
      totalHT: 50000,
      totalTVA: 9500,
      timbreFiscal: 0,
      totalTTC: 59500,
      paymentMethod: 'VIREMENT'
    },
    {
      docType: 'FACTURE',
      docDate: '2026-03-20',
      clientName: 'شركة التاج',
      clientNif: '001916055555555',
      clientRc: '19/00-5555555B21',
      clientAddress: 'سطيف',
      totalHT: 20000,
      totalTVA: 3800,
      timbreFiscal: 238,
      totalTTC: 24038,
      paymentMethod: 'ESPECES'
    },
    {
      // Proforma should be excluded from État 104
      docType: 'PROFORMA',
      docDate: '2026-03-22',
      clientName: 'شركة تجريبية',
      totalHT: 80000,
      totalTVA: 15200,
      totalTTC: 95200
    }
  ];

  const etat = computeEtat104(sampleInvoices, { year: '2026' });
  assert.equal(etat.clients.length, 2);
  assert.equal(etat.totals.invoicesCount, 3);
  assert.equal(etat.totals.totalHT, 170000);
  assert.equal(etat.totals.totalTVA, 32300);
  assert.equal(etat.totals.totalTimbre, 238);
  assert.equal(etat.totals.totalTTC, 202538);

  const salam = etat.clients.find(c => c.clientNif === '003116098765432');
  assert.ok(salam);
  assert.equal(salam.invoicesCount, 2);
  assert.equal(salam.totalHT, 150000);
  assert.equal(salam.mainPaymentMethod, 'VIREMENT');

  // Test CSV export
  const csv = exportEtat104ToCSV(etat);
  assert.ok(csv.includes('مؤسسة السلام'));
  assert.ok(csv.includes('003116098765432'));
  assert.ok(csv.includes('TOTAL GENERAL'));
});
