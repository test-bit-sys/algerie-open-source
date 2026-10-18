/**
 * DZ-Facture unit tests — LocalDB storage engine (with a localStorage mock).
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal in-memory localStorage mock (must exist before db.js methods run).
class LocalStorageMock {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
}
globalThis.localStorage = new LocalStorageMock();

const { LocalDB, APP_VERSION } = await import('../src/modules/db.js');

test('init seeds the demo dataset (idempotent, never overwrites)', () => {
  LocalDB.init();
  assert.ok(LocalDB.getProducts().length >= 6);
  assert.equal(LocalDB.getClients().length, 3);
  assert.equal(LocalDB.getCompany().nif, '001616012345678');
  assert.equal(LocalDB.getInvoices().length, 2);
});

test('corrupted storage never crashes the app (safeParse fallbacks)', () => {
  localStorage.setItem('dz_facture_products', 'THIS IS NOT JSON{{{');
  assert.deepEqual(LocalDB.getProducts(), []);
  localStorage.removeItem('dz_facture_products');
});

test('addInvoice does NOT touch stock — stock moves are explicit', () => {
  LocalDB.init();
  const before = LocalDB.getProducts().find((p) => p.id === 'p1').stock;
  LocalDB.addInvoice({
    docType: 'POS',
    docNumber: 'TKT-TEST-0001',
    items: [{ productId: 'p1', quantity: 2 }],
    totalTTC: 100,
    paymentMethod: 'ESPECES'
  });
  assert.equal(LocalDB.getProducts().find((p) => p.id === 'p1').stock, before);

  LocalDB.deductStock('p1', 2);
  assert.equal(LocalDB.getProducts().find((p) => p.id === 'p1').stock, before - 2);

  LocalDB.restoreStock('p1', 2);
  assert.equal(LocalDB.getProducts().find((p) => p.id === 'p1').stock, before);
});

test('nextDocNumber is sequential per prefix, per year, and gap-free', () => {
  LocalDB.init();
  const year = String(new Date().getFullYear());
  const existingMax = LocalDB.getInvoices().reduce((max, inv) => {
    const m = String(inv.docNumber || '').match(new RegExp(`^FAC-${year}-(\\d+)$`));
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);

  const first = LocalDB.nextDocNumber('FAC');
  assert.equal(first, `FAC-${year}-${String(existingMax + 1).padStart(4, '0')}`);

  // Numbers are only consumed on save — peeking twice returns the same value.
  assert.equal(LocalDB.nextDocNumber('FAC'), first);

  // Saving consumes it: the next proposal is exactly +1 (no gaps, no repeats).
  LocalDB.addInvoice({ docType: 'FACTURE', docNumber: first, totalTTC: 5, items: [] });
  const seq = parseInt(first.slice(-4), 10);
  assert.equal(LocalDB.nextDocNumber('FAC'), `FAC-${year}-${String(seq + 1).padStart(4, '0')}`);
});

test('upsertInvoice updates an existing docNumber instead of duplicating it', () => {
  LocalDB.init();
  const docNumber = 'FAC-UPSERT-0099';
  LocalDB.addInvoice({ docType: 'FACTURE', docNumber, totalTTC: 10, items: [] });
  LocalDB.upsertInvoice({ docType: 'FACTURE', docNumber, totalTTC: 99, items: [] });

  const matches = LocalDB.getInvoices().filter((i) => i.docNumber === docNumber);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].totalTTC, 99);
});

test('A_TERME (credit) sale increments the client balance', () => {
  LocalDB.init();
  const before = LocalDB.getClients().find((c) => c.id === 'c1').balance || 0;
  LocalDB.addInvoice({
    docType: 'FACTURE',
    docNumber: 'FAC-CREDIT-0001',
    paymentMethod: 'A_TERME',
    clientId: 'c1',
    totalTTC: 5000,
    items: []
  });
  assert.equal(LocalDB.getClients().find((c) => c.id === 'c1').balance, before + 5000);
});

test('held carts persist the remise (discount) metadata', () => {
  LocalDB.init();
  const held = LocalDB.saveHeldCart(
    [{ id: 'p1', name: 'Test item', sellPrice: 100, buyPrice: 50, quantity: 2 }],
    'Client en attente',
    { type: 'PERCENT', value: 5 }
  );
  assert.equal(held.discount.type, 'PERCENT');
  assert.equal(held.discount.value, 5);
  assert.match(held.savedAt, /^\d{2}:\d{2}$/);
  assert.equal(LocalDB.getHeldCarts().length, 1);
  LocalDB.removeHeldCart(held.id);
  assert.equal(LocalDB.getHeldCarts().length, 0);
});

test('backup export → import round-trip restores everything', () => {
  LocalDB.init();
  const backup = LocalDB.exportBackupJSON();
  assert.equal(JSON.parse(backup).version, APP_VERSION);

  localStorage.removeItem('dz_facture_products');
  assert.deepEqual(LocalDB.getProducts(), []);

  assert.equal(LocalDB.importBackupJSON(backup).success, true);
  assert.ok(LocalDB.getProducts().length >= 6);
  assert.equal(LocalDB.importBackupJSON('NOT VALID JSON').success, false);
});
