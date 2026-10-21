import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatMoney, compactMoney, daysBetween, todayISO } from '../src/lib/util.js';
import { DZ_WILAYAS, wilayaByCode, formatWilaya } from '../src/lib/wilayas.js';
import { resolveStages, firstStageId, isTerminalStage } from '../src/lib/forecast.js';

describe('DZ-CRM Sovereign Engine Tests', () => {

  it('formats Algerian Dinar (DZD) currency amounts accurately with sovereign Arabic suffix', () => {
    // 1. Full money formatting
    const dzd1 = formatMoney(15000, 'DZD');
    assert.ok(dzd1.includes('د.ج'), `Expected د.ج in formatted amount, got ${dzd1}`);
    assert.ok(dzd1.includes('15'), `Expected 15 in amount, got ${dzd1}`);

    const dzd2 = formatMoney(1250000, 'DZD');
    assert.ok(dzd2.includes('د.ج'));

    // 2. Compact money formatting for KPI cards & pipeline totals
    const compactMil = compactMoney(2500000, 'DZD');
    assert.ok(compactMil.includes('2.5M د.ج') || compactMil.includes('2.5M'), `Got ${compactMil}`);

    const compactK = compactMoney(75000, 'DZD');
    assert.ok(compactK.includes('75K د.ج') || compactK.includes('75K'), `Got ${compactK}`);
  });

  it('provides all 58 verified Algerian Wilayas for CRM territory management', () => {
    assert.equal(DZ_WILAYAS.length, 58, 'Algerian wilayas registry must have exactly 58 wilayas');

    // Test first and last wilaya
    assert.equal(DZ_WILAYAS[0].code, '01');
    assert.equal(DZ_WILAYAS[0].name_ar, 'أدرار');
    assert.equal(DZ_WILAYAS[57].code, '58');
    assert.equal(DZ_WILAYAS[57].name_ar, 'المنيعة');

    // Test lookup by code
    const alger = wilayaByCode('16');
    assert.ok(alger);
    assert.equal(alger.name_ar, 'الجزائر العاصمة');
    assert.equal(alger.name_fr, 'Alger');

    const oran = wilayaByCode(31);
    assert.ok(oran);
    assert.equal(oran.name_ar, 'وهران');

    // Test formatWilaya
    assert.equal(formatWilaya('16', 'ar'), '16 - الجزائر العاصمة');
    assert.equal(formatWilaya('31', 'fr'), '31 - Oran');
  });

  it('resolves pipeline stages, initial stage, and terminal deal states', () => {
    const stages = resolveStages(null);
    assert.ok(stages.length >= 4, 'Pipeline should have at least 4 default stages');

    const first = firstStageId(stages);
    assert.ok(first, 'Should have a valid first stage id');

    // Closed states
    assert.equal(isTerminalStage('won'), true);
    assert.equal(isTerminalStage('lost'), true);
    assert.equal(isTerminalStage(first), false);
  });

  it('calculates date intervals and today ISO timestamp safely', () => {
    const today = todayISO();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(daysBetween(today, today), 0);
  });

});
