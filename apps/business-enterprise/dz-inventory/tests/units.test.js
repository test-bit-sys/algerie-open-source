import { describe, it, expect } from 'vitest';
import {
  EACH, normalizeUnit, isCountUnit, roundQty, formatQtyIn, unitLabel,
  qtyWithUnit, packSizeOf, packLabel, packsToUnits, packSummary, unitPrecision,
} from '../src/lib/units.js';

describe('normalizeUnit', () => {
  it('treats blank as each and matches a suggestion’s casing', () => {
    expect(normalizeUnit('')).toBe(EACH);
    expect(normalizeUnit(null)).toBe(EACH);
    expect(normalizeUnit('  EACH ')).toBe(EACH);
    expect(normalizeUnit('KG')).toBe('kg');
    expect(normalizeUnit('ml')).toBe('mL');
  });

  it('keeps custom units, trimmed and length-capped', () => {
    expect(normalizeUnit('  rolls ')).toBe('rolls');
    expect(normalizeUnit('a'.repeat(40))).toHaveLength(12);
  });
});

describe('counted vs measured', () => {
  it('counts items by default and measures anything else', () => {
    expect(isCountUnit(undefined)).toBe(true);
    expect(isCountUnit('each')).toBe(true);
    expect(isCountUnit('kg')).toBe(false);
    expect(unitPrecision('each')).toBe(0);
    expect(unitPrecision('kg')).toBe(3);
  });

  it('rounds to whole items but keeps three decimals when measured', () => {
    expect(roundQty(2.6, 'each')).toBe(3);
    expect(roundQty(2.5678, 'kg')).toBe(2.568);
    expect(roundQty(-5, 'kg')).toBe(0);
    expect(roundQty('abc', 'kg')).toBe(0);
    expect(roundQty(0.1 + 0.2, 'kg')).toBe(0.3);
  });

  it('formats without inventing decimals a count can’t have', () => {
    expect(formatQtyIn(2.6, 'each')).toBe('3');
    expect(formatQtyIn(2.5, 'kg')).toBe('2.5');
    expect(formatQtyIn(1234, 'each')).toBe('1,234');
  });

  it('names the unit, singular where it matters', () => {
    expect(unitLabel('each', 1)).toBe('unit');
    expect(unitLabel('each', 4)).toBe('units');
    expect(unitLabel('kg', 1)).toBe('kg');
    expect(qtyWithUnit(2.5, 'kg')).toBe('2.5 kg');
    expect(qtyWithUnit(1, '')).toBe('1 unit');
  });
});

describe('pack sizes', () => {
  const box = { unit: 'each', packSize: 24, packName: 'case' };

  it('ignores a pack size of one or less', () => {
    expect(packSizeOf(box)).toBe(24);
    expect(packSizeOf({ packSize: 1 })).toBe(0);
    expect(packSizeOf({ packSize: 0 })).toBe(0);
    expect(packSizeOf(null)).toBe(0);
  });

  it('names a pack, defaulting to "pack"', () => {
    expect(packLabel(box, 1)).toBe('case');
    expect(packLabel(box, 3)).toBe('cases');
    expect(packLabel({ packSize: 6 }, 2)).toBe('packs');
    // English plurals just well enough to avoid "boxs" in the UI
    expect(packLabel({ packName: 'box' }, 2)).toBe('boxes');
    expect(packLabel({ packName: 'tray' }, 2)).toBe('trays');
    expect(packLabel({ packName: 'caddy' }, 2)).toBe('caddies');
    expect(packLabel({ packName: 'bunch' }, 2)).toBe('bunches');
  });

  it('converts packs to units, and says so in words', () => {
    expect(packsToUnits(3, box)).toBe(72);
    expect(packsToUnits(3, { unit: 'kg' })).toBe(3);
    expect(packSummary(3, box)).toBe('3 cases of 24 = 72 units');
    expect(packSummary(1, box)).toBe('1 case of 24 = 24 units');
    expect(packSummary(2, { unit: 'each' })).toBe('');
  });

  it('handles measured packs, like a 2.5 kg bag', () => {
    const bag = { unit: 'kg', packSize: 2.5, packName: 'bag' };
    expect(packsToUnits(3, bag)).toBe(7.5);
    expect(packSummary(3, bag)).toBe('3 bags of 2.5 = 7.5 kg');
  });
});
