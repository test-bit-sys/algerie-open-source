import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDoubleEntry,
  computeGrandLivre,
  computeBalance,
  generateBilan,
  generateTCR,
  DEMO_JOURNAL,
  round2
} from '../src/compta-engine.js';
import { getAccountName, searchAccounts, SCF_ACCOUNTS } from '../src/scf-plan.js';

test('DZ-Compta: Plan Comptable National SCF accounts', () => {
  assert.ok(SCF_ACCOUNTS.length >= 30);
  assert.match(getAccountName('101', 'ar'), /رأس المال الاجتماعي/);
  assert.match(getAccountName('512', 'fr'), /Banques/);
  assert.match(getAccountName('700', 'ar'), /مبيعات البضائع/);

  const searchResults = searchAccounts('مورد');
  assert.ok(searchResults.length >= 1);
  assert.ok(searchResults.some(a => a.code === '401'));
});

test('DZ-Compta: Double-entry validation rules', () => {
  const valid = validateDoubleEntry({
    date: '2026-02-01',
    piece: 'FAC-100',
    debitAccount: '512',
    creditAccount: '700',
    amount: 150000
  });
  assert.equal(valid.isValid, true);

  // Equal debit and credit accounts rejected
  const sameAcc = validateDoubleEntry({
    date: '2026-02-01',
    piece: 'ERR-01',
    debitAccount: '512',
    creditAccount: '512',
    amount: 5000
  });
  assert.equal(sameAcc.isValid, false);

  // Zero or negative amount rejected
  const zeroAmt = validateDoubleEntry({
    date: '2026-02-01',
    piece: 'ERR-02',
    debitAccount: '512',
    creditAccount: '700',
    amount: 0
  });
  assert.equal(zeroAmt.isValid, false);
});

test('DZ-Compta: Grand Livre computation', () => {
  const ledger = computeGrandLivre(DEMO_JOURNAL, 'ar');
  assert.ok(ledger['512']);
  assert.ok(ledger['512'].totalDebit > 0);
  assert.ok(ledger['512'].totalCredit > 0);
  assert.equal(ledger['512'].lines.length > 0, true);
  assert.equal(ledger['101'].totalCredit, 5000000);
});

test('DZ-Compta: Trial Balance (Balance Générale 6 columns)', () => {
  const balance = computeBalance(DEMO_JOURNAL, 'ar');
  assert.ok(balance.rows.length >= 7);
  assert.equal(balance.totals.isBalanced, true);
  assert.equal(balance.totals.totalDebit, balance.totals.totalCredit);
  assert.equal(balance.totals.totalSoldeDebiteur, balance.totals.totalSoldeCrediteur);
  assert.equal(balance.totals.diff, 0);
});

test('DZ-Compta: Bilan Comptable (Balance Sheet Actif / Passif)', () => {
  const bilan = generateBilan(DEMO_JOURNAL, 'ar');
  assert.ok(bilan.actif.totalActif > 0);
  assert.ok(bilan.passif.totalPassif > 0);
  assert.equal(bilan.isBalanced, true);
  assert.equal(bilan.actif.courant.disponibilites > 0, true);
  assert.equal(bilan.passif.capitauxPropres.capitalSocial, 5000000);
});

test('DZ-Compta: Compte de Résultat (TCR)', () => {
  const tcr = generateTCR(DEMO_JOURNAL, 'ar');
  assert.equal(tcr.chiffreAffaires, 2400000);
  assert.equal(tcr.achatsConsommes, 1200000);
  assert.equal(tcr.valeurAjoutee, 1200000);
  assert.equal(tcr.chargesPersonnel, 850000);
  assert.ok(tcr.resultatExploitation > 0);
  assert.ok(tcr.resultatNet > 0);
});
