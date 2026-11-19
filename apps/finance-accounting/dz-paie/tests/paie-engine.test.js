import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateIRG,
  computePayslip,
  computePayrollJournal,
  DEMO_EMPLOYEES,
  round2
} from '../src/paie-engine.js';

test('DZ-Paie: Official Algerian Barème IRG 2024 calculation', () => {
  // <= 30,000 DA is 100% exempt from IRG
  assert.equal(calculateIRG(0), 0);
  assert.equal(calculateIRG(25000), 0);
  assert.equal(calculateIRG(30000), 0);

  // 35,000 DA
  const irg35 = calculateIRG(35000);
  assert.ok(irg35 > 0);

  // 65,000 DA
  const irg65 = calculateIRG(65000);
  assert.ok(irg65 > 0);

  // Higher salary: 150,000 DA
  const irg150 = calculateIRG(150000);
  assert.ok(irg150 > irg65);
});

test('DZ-Paie: Complete Algerian payslip calculation', () => {
  const emp = {
    matricule: 'EMP-001',
    name: 'سفيان بن عبد الله',
    post: 'مهندس برمجيات أول',
    baseSalary: 100000,
    iepPrime: 10000,
    priPrime: 10000,
    nuisancePrime: 0,
    panierPrime: 8000,
    transportPrime: 6000,
    overtimePay: 0,
    retenues: 0
  };

  const slip = computePayslip(emp);

  // Salaire de poste = 100,000 + 10,000 + 10,000 = 120,000
  assert.equal(slip.salairePoste, 120000);

  // CNAS salarié = 9% of 120,000 = 10,800
  assert.equal(slip.cnasSalarie, 10800);

  // CNAS patronale = 26% of 120,000 = 31,200
  assert.equal(slip.cnasPatronale, 31200);

  // Salaire Brut = 120,000 + 8,000 + 6,000 = 134,000
  assert.equal(slip.salaireBrut, 134000);

  // Salaire Imposable = 120,000 - 10,800 = 109,200
  assert.equal(slip.salaireImposable, 109200);

  // IRG on 109,200
  assert.ok(slip.irg > 0);

  // Net à payer = Brut - CNAS 9% - IRG
  assert.equal(slip.netAPayer, round2(slip.salaireBrut - slip.cnasSalarie - slip.irg));

  // Coût employeur = Brut + CNAS Patronale 26%
  assert.equal(slip.coutEmployeur, round2(slip.salaireBrut + slip.cnasPatronale));
});

test('DZ-Paie: Monthly Payroll Journal summary', () => {
  const journal = computePayrollJournal(DEMO_EMPLOYEES);
  assert.equal(journal.count, 5);
  assert.ok(journal.totals.totalBase > 0);
  assert.ok(journal.totals.totalPoste > 0);
  assert.ok(journal.totals.totalBrut > 0);
  assert.ok(journal.totals.totalCnasSalarie > 0);
  assert.ok(journal.totals.totalCnasPatronale > 0);
  assert.ok(journal.totals.totalIRG > 0);
  assert.ok(journal.totals.totalNet > 0);
  assert.ok(journal.totals.totalCoutEmployeur > journal.totals.totalBrut);
});
