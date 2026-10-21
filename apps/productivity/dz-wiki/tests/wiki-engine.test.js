import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TEMPLATES, templateById, welcomeBlocks } from '../src/data/templates.js';
import { keyBetween, keysAfter, compareOrder } from '../src/lib/order.js';
import { memoryBackend, memoryKv, isMissing } from '../src/data/backend.js';

describe('DZ-Wiki Sovereign Engine Tests', () => {

  it('registers Algerian sovereign templates in the template registry', () => {
    assert.ok(TEMPLATES.length >= 5, 'Expected at least 5 templates');

    // 1. DZ Fiche Projet
    const fiche = templateById('dz_fiche_projet');
    assert.ok(fiche, 'Fiche de Projet should exist');
    assert.match(fiche.name, /بطاقة مشروع/);
    const ficheBlocks = fiche.blocks();
    assert.ok(ficheBlocks.length > 5, 'Fiche de projet should have structured blocks');
    assert.ok(ficheBlocks.some(b => b.text && b.text.includes('الجمهورية الجزائرية')));

    // 2. DZ Procès-Verbal de Réunion
    const pv = templateById('dz_pv_reunion');
    assert.ok(pv, 'PV de Réunion should exist');
    assert.match(pv.name, /محضر اجتماع/);
    const pvBlocks = pv.blocks();
    assert.ok(pvBlocks.some(b => b.text && b.text.includes('جدول الأعمال')));

    // 3. Welcome blocks
    const welcome = welcomeBlocks();
    assert.ok(welcome.length >= 5, 'Welcome blocks should exist');
    assert.ok(welcome[0].text.includes('DZ-Wiki'), 'Welcome header should mention DZ-Wiki');
    assert.ok(welcome[0].text.includes('محلياً 100%'), 'Welcome text should highlight 100% local sovereign storage');
  });

  it('generates consistent and strictly monotonic fractional order keys', () => {
    const k1 = keyBetween('', '');
    const k2 = keyBetween(k1, '');
    const k3 = keyBetween(k1, k2);

    assert.ok(k1 < k2, `k1 (${k1}) should be strictly less than k2 (${k2})`);
    assert.ok(k1 < k3, `k1 (${k1}) should be strictly less than k3 (${k3})`);
    assert.ok(k3 < k2, `k3 (${k3}) should be strictly less than k2 (${k2})`);

    const batch = keysAfter('a', 5);
    assert.equal(batch.length, 5);
    for (let i = 1; i < batch.length; i++) {
      assert.ok(batch[i - 1] < batch[i], 'Keys in batch must be strictly ascending');
    }

    const items = [
      { id: 'b', order: 'z' },
      { id: 'a', order: 'm' },
      { id: 'c', order: 'b' }
    ];
    items.sort(compareOrder);
    assert.equal(items[0].id, 'c');
    assert.equal(items[1].id, 'a');
    assert.equal(items[2].id, 'b');
  });

  it('implements in-memory sovereign storage backend with full CRUD', async () => {
    const backend = memoryBackend();
    const kv = memoryKv();

    // 1. Write and read
    const payload = new TextEncoder().encode(JSON.stringify({ title: 'وثيقة سيادية جزائرية', content: 'بيانات محلية' }));
    const writeRes = await backend.write('pages/p1.json', payload);
    assert.ok(writeRes.modified > 0);
    assert.equal(writeRes.size, payload.length);

    // 2. Stat
    const statRes = await backend.stat('pages/p1.json');
    assert.ok(statRes);
    assert.equal(statRes.size, payload.length);

    // 3. Read
    const readRes = await backend.read('pages/p1.json');
    assert.ok(readRes);
    const decoded = JSON.parse(new TextDecoder().decode(readRes.bytes));
    assert.equal(decoded.title, 'وثيقة سيادية جزائرية');

    // 4. List
    const listRes = await backend.list('pages');
    assert.equal(listRes.length, 1);
    assert.equal(listRes[0].name, 'p1.json');

    // 5. KV operations
    await kv.set('pref_lang', 'ar');
    assert.equal(await kv.get('pref_lang'), 'ar');

    // 6. Missing error handling
    assert.equal(await backend.read('nonexistent.json'), null);
    assert.equal(isMissing({ code: 'not_found' }), true);
  });

});
