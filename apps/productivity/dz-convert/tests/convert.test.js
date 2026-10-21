/**
 * DZ-Convert Engine — Unit Tests (node:test)
 * 100% Offline-First, Zero-Dependency Test Suite
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertAlgerianCurrency,
  tafqitDinarArabic,
  tafqitDinarFrench,
  convertLandArea,
  calculateRebarWeight,
  calculateConcreteMaterials
} from '../src/convert-engine.js';

describe('DZ-Convert Engine Tests', () => {

  test('converts 10,000 DZD to 1 million centimes and 50,000 doro', () => {
    const res = convertAlgerianCurrency(10000, 'dzd');
    assert.strictEqual(res.dzd, 10000);
    assert.strictEqual(res.centimes, 1000000);
    assert.strictEqual(res.doro, 50000);
    assert.strictEqual(res.millionCentimes, 1);
    assert.ok(res.popularSpokenAr.includes('مليون سنتيم'));
  });

  test('converts 1.5 million centimes to 15,000 DZD', () => {
    const res = convertAlgerianCurrency(1.5, 'million_centimes');
    assert.strictEqual(res.dzd, 15000);
    assert.strictEqual(res.centimes, 1500000);
  });

  test('converts 1 milliard centimes to 10 million DZD', () => {
    const res = convertAlgerianCurrency(1, 'milliard_centimes');
    assert.strictEqual(res.dzd, 10000000);
    assert.strictEqual(res.centimes, 1000000000);
    assert.ok(res.popularSpokenAr.includes('مليار سنتيم'));
  });

  test('tafqitDinarArabic spells 25,450.50 DZD correctly', () => {
    const text = tafqitDinarArabic(25450.50);
    assert.ok(text.includes('خمسة وعشرون ألف'));
    assert.ok(text.includes('أربعمائة وخمسون'));
    assert.ok(text.includes('دينار جزائري'));
    assert.ok(text.includes('خمسون سنتيم'));
    assert.ok(text.endsWith('لا غير'));
  });

  test('tafqitDinarFrench spells 1500 DZD correctly', () => {
    const text = tafqitDinarFrench(1500);
    assert.ok(text.toLowerCase().includes('mille'));
    assert.ok(text.toLowerCase().includes('cinq cents'));
    assert.ok(text.toLowerCase().includes('dinars algériens'));
  });

  test('convertLandArea converts 25,000 m2 into 2 ha 50 ares', () => {
    const land = convertLandArea(25000, 'm2');
    assert.strictEqual(land.hectares, 2.5);
    assert.strictEqual(land.ares, 250);
    assert.ok(land.officialCadastreFormatted.includes('2 هكتار'));
    assert.ok(land.officialCadastreFormatted.includes('50 آر'));
  });

  test('calculateRebarWeight computes linear weight for T12 bar accurately', () => {
    // 12mm bar standard theoretical weight is ~0.888 kg/m
    const rebar = calculateRebarWeight(12, 12, 1);
    assert.ok(rebar.weightPerMeterKg >= 0.88 && rebar.weightPerMeterKg <= 0.90);
    assert.ok(rebar.totalWeightKg >= 10.5 && rebar.totalWeightKg <= 10.8);
  });

  test('calculateConcreteMaterials computes bags and aggregates for 10m3 slab', () => {
    const conc = calculateConcreteMaterials(10, 350);
    assert.strictEqual(conc.totalCementKg, 3500);
    assert.strictEqual(conc.cementBags50kg, 70);
    assert.strictEqual(conc.sandVolumeM3, 4);
    assert.strictEqual(conc.gravelVolumeM3, 8);
  });
});
