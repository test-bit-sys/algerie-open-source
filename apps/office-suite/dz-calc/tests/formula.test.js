/**
 * DZ-Calc — Formula Engine & Algerian Financial Mathematics Unit Tests
 * 100% Offline-First, Zero-Dependency Test Suite (node:test)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  tafqitArabic,
  tafqitFrench,
  calculateTvaDz,
  calculateTtcDz,
  calculateTimbreDz,
  calculateCnasDz,
  calculateIrgDz,
  parseCellAddress,
  colToLetter,
  FormulaEngine
} from '../src/formula-engine.js';

describe('DZ-Calc Fiscal & Mathematical Engine Tests', () => {

  test('Arabic Tafqit produces correct Algerian Dinar currency spelling', () => {
    assert.strictEqual(tafqitArabic(0), 'صفر دينار جزائري');
    assert.strictEqual(tafqitArabic(100), 'مائة دينار جزائري');
    assert.strictEqual(tafqitArabic(1000), 'ألف دينار جزائري');
    assert.strictEqual(tafqitArabic(2000), 'ألفان دينار جزائري');
    assert.strictEqual(tafqitArabic(5000), 'خمسة آلاف دينار جزائري');
    
    // Test with centimes
    const withCentimes = tafqitArabic(1500.50);
    assert.ok(withCentimes.includes('دينار جزائري'));
    assert.ok(withCentimes.includes('سنتيم'));
  });

  test('French Tafqit produces legal French phrasing', () => {
    assert.strictEqual(tafqitFrench(0), 'zéro dinar algérien');
    assert.strictEqual(tafqitFrench(100), 'cent dinars algériens');
  });

  test('TVA and TTC calculations follow Algerian tax code', () => {
    // 19% standard rate
    assert.strictEqual(calculateTvaDz(10000, 19), 1900);
    assert.strictEqual(calculateTtcDz(10000, 19), 11900);

    // 9% reduced rate
    assert.strictEqual(calculateTvaDz(10000, 9), 900);
    assert.strictEqual(calculateTtcDz(10000, 9), 10900);

    // Default rate is 19%
    assert.strictEqual(calculateTvaDz(5000), 950);
    assert.strictEqual(calculateTtcDz(5000), 5950);
  });

  test('Timbre fiscal (Stamp Duty): 1% on cash, min 5 DZD, capped at 10 000 DZD', () => {
    assert.strictEqual(calculateTimbreDz(0), 0);
    assert.strictEqual(calculateTimbreDz(-500), 0);
    // Minimum 5 DZD
    assert.strictEqual(calculateTimbreDz(200), 5); // 1% of 200 is 2 -> capped by min 5
    // Normal 1%
    assert.strictEqual(calculateTimbreDz(1000), 10);
    assert.strictEqual(calculateTimbreDz(50000), 500);
    // Capped at 10,000 DZD
    assert.strictEqual(calculateTimbreDz(2000000), 10000); // 1% of 2M is 20,000 -> capped at 10,000
  });

  test('CNAS social security deduction: exactly 9% of base brut salary', () => {
    assert.strictEqual(calculateCnasDz(50000), 4500);
    assert.strictEqual(calculateCnasDz(100000), 9000);
  });

  test('IRG progressive salary tax according to Algerian Finance Law barème', () => {
    // Under 30,000 DZD: 0% tax exempt
    assert.strictEqual(calculateIrgDz(28000), 0);
    assert.strictEqual(calculateIrgDz(30000), 0);

    // 30,001 - 35,000 bracket: 23%
    assert.strictEqual(calculateIrgDz(35000), (35000 - 30000) * 0.23); // 1150

    // Above 35,000 bracket
    assert.ok(calculateIrgDz(60000) > 1150);
  });

  test('Coordinate conversions: A1 <-> {col: 0, row: 0}', () => {
    assert.deepStrictEqual(parseCellAddress('A1'), { col: 0, row: 0 });
    assert.deepStrictEqual(parseCellAddress('B5'), { col: 1, row: 4 });
    assert.deepStrictEqual(parseCellAddress('Z100'), { col: 25, row: 99 });
    assert.deepStrictEqual(parseCellAddress('AA1'), { col: 26, row: 0 });

    assert.strictEqual(colToLetter(0), 'A');
    assert.strictEqual(colToLetter(1), 'B');
    assert.strictEqual(colToLetter(25), 'Z');
    assert.strictEqual(colToLetter(26), 'AA');
  });

  test('FormulaEngine evaluates arithmetic expressions and cell references', () => {
    const mockGrid = {
      'A1': 100,
      'A2': 200,
      'A3': 300,
      'B1': 50
    };

    const engine = new FormulaEngine((col, row) => {
      const addr = `${colToLetter(col)}${row + 1}`;
      return mockGrid[addr] ?? 0;
    });

    // Simple arithmetic
    assert.strictEqual(engine.evaluate('=10+20*2'), 50);
    assert.strictEqual(engine.evaluate('=(10+20)*2'), 60);

    // Cell tokens
    assert.strictEqual(engine.evaluate('=A1 + B1'), 150);
    assert.strictEqual(engine.evaluate('=A1 * 2'), 200);

    // Range SUM
    assert.strictEqual(engine.evaluate('=SUM(A1:A3)'), 600);
    assert.strictEqual(engine.evaluate('=SUM(A1, B1)'), 150);

    // Range AVERAGE
    assert.strictEqual(engine.evaluate('=AVERAGE(A1:A3)'), 200);

    // MIN & MAX
    assert.strictEqual(engine.evaluate('=MIN(A1:A3)'), 100);
    assert.strictEqual(engine.evaluate('=MAX(A1:A3)'), 300);

    // COUNT
    assert.strictEqual(engine.evaluate('=COUNT(A1:A3)'), 3);
  });
});
