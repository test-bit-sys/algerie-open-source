import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeG50FromJournal,
  validateG50Form,
  G50_DEFAULT_ENTERPRISE
} from '../src/g50-engine.js';

describe('DZ-Compta: G50 Tax Declaration Engine Tests', () => {
  it('contains valid default enterprise credentials with 15-digit NIF', () => {
    assert.strictEqual(G50_DEFAULT_ENTERPRISE.nif.length, 15);
    const val = validateG50Form(G50_DEFAULT_ENTERPRISE);
    assert.strictEqual(val.isValid, true);
    assert.strictEqual(val.errors.length, 0);
  });

  it('rejects invalid NIF length in G50 validation', () => {
    const invalid = { ...G50_DEFAULT_ENTERPRISE, nif: '12345' };
    const val = validateG50Form(invalid);
    assert.strictEqual(val.isValid, false);
    assert.ok(val.errors[0].includes('15 رقماً'));
  });

  it('correctly calculates TVA, Droits de Timbre, and IRG from journal entries', () => {
    const mockJournal = [
      // Sales 19%
      { date: '2026-01-05', piece: 'FAC-001', debitAccount: '530', creditAccount: '700', amount: 100000, label: 'Vente logiciel HT 19%' },
      { date: '2026-01-05', piece: 'FAC-001', debitAccount: '530', creditAccount: '4457', amount: 19000, label: 'TVA collectée 19%' },
      { date: '2026-01-05', piece: 'FAC-001', debitAccount: '530', creditAccount: '447', amount: 1000, label: 'Timbre fiscal 1%' },
      // Purchase deductible TVA
      { date: '2026-01-10', piece: 'FAC-ACH-12', debitAccount: '4456', creditAccount: '512', amount: 9500, label: 'TVA déductible sur achats matériel' },
      // Payroll IRG
      { date: '2026-01-31', piece: 'PAIE-2026-01', debitAccount: '631', creditAccount: '447', amount: 14200, label: 'Retenue IRG salaires' }
    ];

    const g50 = computeG50FromJournal(mockJournal, { period: '2026-01', creditTvaAnterieur: 0 });

    // Output TVA = 19,000, Deductible TVA = 9,500 => TVA Nette à payer = 9,500
    assert.strictEqual(g50.tva.tvaCollectee19, 19000);
    assert.strictEqual(g50.tva.tvaDeductibleAchats, 9500);
    assert.strictEqual(g50.tva.tvaNetteAPayer, 9500);
    assert.strictEqual(g50.tva.nouveauCreditTva, 0);

    // Timbre = 1,000
    assert.strictEqual(g50.timbre.droitsTimbre, 1000);

    // IRG Salaires = 14,200
    assert.strictEqual(g50.irg.irgSalaires, 14200);

    // TAP is 0 (Exonérée LF 2024)
    assert.strictEqual(g50.tap.tapDues, 0);
    assert.strictEqual(g50.tap.exoneree, true);

    // Total à payer = 9,500 + 1,000 + 14,200 = 24,700 DZD
    assert.strictEqual(g50.totaux.totalDroitsDus, 24700);

    // Deadline should be 20/02/2026
    assert.strictEqual(g50.deadlineStr, '20/02/2026');
  });

  it('correctly reports new TVA credit when deductible exceeds output TVA', () => {
    const mockJournal = [
      { date: '2026-01-05', piece: 'FAC-001', debitAccount: '530', creditAccount: '700', amount: 20000, label: 'Vente HT 19%' },
      { date: '2026-01-05', piece: 'FAC-001', debitAccount: '530', creditAccount: '4457', amount: 3800, label: 'TVA 19%' },
      { date: '2026-01-10', piece: 'ACHAT-INV', debitAccount: '4456', creditAccount: '512', amount: 15000, label: 'TVA déductible investissement' }
    ];

    const g50 = computeG50FromJournal(mockJournal, { period: '2026-01', creditTvaAnterieur: 2000 });

    // Output = 3,800, Deductible = 15,000, Anterieur = 2,000 => Excess = 13,200 credit
    assert.strictEqual(g50.tva.tvaNetteAPayer, 0);
    assert.strictEqual(g50.tva.nouveauCreditTva, 13200);
    assert.strictEqual(g50.totaux.totalDroitsDus, 0);
  });
});
