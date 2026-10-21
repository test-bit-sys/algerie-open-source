// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { productView } from '../src/views/product.js';
import { reportsView } from '../src/views/reports.js';

it('shows the same component-based kit margin on the product page and reports', () => {
  const snapshot = vi.spyOn(store, 'recordSnapshot').mockResolvedValue(null);
  store.products = [
    { id: 'part', name: 'Part', unit: 'each', stock: { '': 20 }, quantity: 20, cost: 3, price: null },
    { id: 'kit', name: 'Pair', unit: 'each', stock: {}, quantity: 0, cost: 99, price: 5,
      kit: 'sell', components: [{ productId: 'part', qty: 2 }] },
  ];
  location.hash = '#/product/kit';
  const product = productView();
  const reports = reportsView();
  try {
    const tile = [...product.querySelectorAll('.stat-grid > *')].find((node) => node.textContent.includes('Margin'));
    expect(tile.textContent).toContain('-20%');
    const row = [...reports.querySelectorAll('tr')].find((node) => node.textContent.includes('Pair'));
    expect(row.textContent).toContain('Below cost');
    expect(row.textContent).toContain('-20.0%');
    expect(row.textContent).toContain('6.00');
  } finally {
    product.destroy();
    reports.destroy();
    snapshot.mockRestore();
  }
});
