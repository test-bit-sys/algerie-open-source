import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertInvoiceToSCF,
  convertZReportToSCF,
  convertPayrollMonthToSCF,
  round2
} from '../erp-bridge.js';

test('ERP Bridge: Convert cash commercial invoice with TVA & Timbre to SCF entries', () => {
  const invoice = {
    docNumber: 'FAC-2026-0042',
    date: '2026-02-15',
    clientName: 'EURL Sahara Tech',
    totalHT: 100000,
    totalTVA: 19000,
    timbreFiscal: 1190,
    totalTTC: 120190,
    paymentMethod: 'ESPECES'
  };

  const scf = convertInvoiceToSCF(invoice);
  assert.equal(scf.isBalanced, true);
  assert.equal(scf.entries.length, 3);

  // Revenue line
  const rev = scf.entries.find(e => e.creditAccount === '700');
  assert.ok(rev);
  assert.equal(rev.debitAccount, '530');
  assert.equal(rev.amount, 100000);

  // TVA collected line
  const tva = scf.entries.find(e => e.creditAccount === '4457');
  assert.ok(tva);
  assert.equal(tva.debitAccount, '530');
  assert.equal(tva.amount, 19000);

  // Timbre fiscal line
  const timbre = scf.entries.find(e => e.creditAccount === '447');
  assert.ok(timbre);
  assert.equal(timbre.debitAccount, '530');
  assert.equal(timbre.amount, 1190);

  // Total debited to cash (530) equals Total TTC
  const totalDebited = scf.entries.reduce((sum, e) => sum + e.amount, 0);
  assert.equal(totalDebited, 120190);
});

test('ERP Bridge: Convert credit sale invoice (A_TERME) to Client account 411', () => {
  const invoice = {
    docNumber: 'FAC-2026-0099',
    date: '2026-02-16',
    clientName: 'SPA Industrie Algérie',
    totalHT: 500000,
    totalTVA: 95000,
    timbreFiscal: 0,
    totalTTC: 595000,
    paymentMethod: 'A_TERME'
  };

  const scf = convertInvoiceToSCF(invoice);
  assert.equal(scf.entries.length, 2);
  assert.equal(scf.entries[0].debitAccount, '411'); // Client
  assert.equal(scf.entries[0].creditAccount, '700');
  assert.equal(scf.entries[1].debitAccount, '411'); // Client
  assert.equal(scf.entries[1].creditAccount, '4457');
});

test('ERP Bridge: Convert electronic card / bank transfer to Bank account 512', () => {
  const invoice = {
    docNumber: 'FAC-2026-0150',
    date: '2026-02-18',
    clientName: 'Sarl Atlas Solutions',
    totalHT: 250000,
    totalTVA: 47500,
    timbreFiscal: 0,
    totalTTC: 297500,
    paymentMethod: 'CARTE_CIB'
  };

  const scf = convertInvoiceToSCF(invoice);
  assert.equal(scf.entries[0].debitAccount, '512'); // Banque
});

test('ERP Bridge: Convert POS daily closing report (Rapport Z) to SCF', () => {
  const zReport = {
    zNumber: 'Z-20260219-01',
    date: '2026-02-19',
    totalCash: 450000,
    totalElectronic: 150000,
    totalHT: 504200,
    totalTVA: 95800,
    totalTimbre: 4500
  };

  const scf = convertZReportToSCF(zReport);
  assert.ok(scf.entries.length >= 2);
  assert.ok(scf.entries.some(e => e.debitAccount === '530')); // Caisse
  assert.ok(scf.entries.some(e => e.debitAccount === '512')); // Banque CIB
});

test('ERP Bridge: Convert monthly payroll summary to balanced SCF journal entries', () => {
  const payroll = {
    month: '2026-02',
    date: '2026-02-28',
    totalBrut: 1500000,
    totalNet: 1145000,
    totalCnasSalarie: 135000,
    totalCnasPatronale: 390000,
    totalIRG: 220000
  };

  const scf = convertPayrollMonthToSCF(payroll);
  assert.equal(scf.isBalanced, true);

  // Check Net to Personnel (421)
  const netLine = scf.entries.find(e => e.creditAccount === '421');
  assert.equal(netLine.amount, 1145000);
  assert.equal(netLine.debitAccount, '631');

  // Check CNAS Salarié to Social Security (431)
  const cnasLine = scf.entries.find(e => e.creditAccount === '431' && e.debitAccount === '631');
  assert.equal(cnasLine.amount, 135000);

  // Check IRG to Tax Authority (447)
  const irgLine = scf.entries.find(e => e.creditAccount === '447');
  assert.equal(irgLine.amount, 220000);

  // Total debited to Salaries (631) equals Gross (totalBrut = Net 1145k + CNAS 135k + IRG 220k = 1500k)
  const totalDebited631 = scf.entries.filter(e => e.debitAccount === '631').reduce((s, e) => s + e.amount, 0);
  assert.equal(totalDebited631, 1500000);

  // Check Employer Social Charges line (Debit 635 / Credit 431)
  const patLine = scf.entries.find(e => e.debitAccount === '635');
  assert.equal(patLine.amount, 390000);
  assert.equal(patLine.creditAccount, '431');
});
