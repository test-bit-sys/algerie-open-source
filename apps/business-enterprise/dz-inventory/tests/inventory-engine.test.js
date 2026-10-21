import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, round2, asList, uid } from '../src/lib/util.js';
import { ALGERIAN_WILAYAS, getWilayaByCode } from '../src/lib/wilayas.js';
import { DEFAULT_SETTINGS } from '../src/lib/store.js';
import { sampleDataset } from '../src/lib/sample.js';

describe('DZ-Inventory Sovereign Engine Tests', () => {
  it('formats Algerian Dinar (DZD) currency accurately with sovereign Arabic suffix', () => {
    const formatted = formatMoney(12500.5, 'DZD');
    assert.ok(formatted.includes('د.ج'), `Expected 'د.ج' in formatted string, got: ${formatted}`);
    assert.ok(formatted.includes('12'), `Expected formatted amount, got: ${formatted}`);
  });

  it('calculates round2 cents precision accurately avoiding float drift', () => {
    assert.equal(round2(8.165), 8.17);
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(0), 0);
  });

  it('initializes default store settings with DZD currency', () => {
    assert.equal(DEFAULT_SETTINGS.currency, 'DZD');
    assert.equal(DEFAULT_SETTINGS.onboarded, false);
  });

  it('provides all 58 verified Algerian Wilayas for warehouse locations and supplier logistics', () => {
    assert.equal(ALGERIAN_WILAYAS.length, 58);
    const alger = getWilayaByCode('16');
    assert.ok(alger);
    assert.equal(alger.nameAr, 'الجزائر');
    assert.equal(alger.nameFr, 'Alger');

    const oran = getWilayaByCode('31');
    assert.ok(oran);
    assert.equal(oran.nameAr, 'وهران');

    const elMenia = getWilayaByCode('58');
    assert.ok(elMenia);
    assert.equal(elMenia.nameAr, 'المنيعة');
  });

  it('generates authentic Algerian sample dataset with localized warehouses and suppliers', () => {
    const mockStore = { settings: { currency: 'DZD' } };
    const data = sampleDataset(mockStore);
    assert.ok(data.locations.length >= 3);
    assert.ok(data.locations.some(l => l.name.includes('الجزائر العاصمة')));
    assert.ok(data.locations.some(l => l.name.includes('وهران')));
    assert.ok(data.suppliers.length >= 4);
    assert.ok(data.suppliers.some(s => s.phone.startsWith('+213')));
    assert.ok(data.products.length > 0);
  });
});
