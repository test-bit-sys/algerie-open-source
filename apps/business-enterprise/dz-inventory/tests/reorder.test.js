import { describe, it, expect } from 'vitest';
import {
  suggestedQty, reorderGroups, reorderAlerts, productsOnOrder, onOrderQty, lineRemaining,
  migrateOrder, orderToText, orderRows, packNote,
} from '../src/lib/reorder.js';

const p = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  name: 'Widget', sku: '', unit: 'each', quantity: 0, lowStock: null,
  supplierId: null, cost: 1, archived: false, ...over,
});

describe('suggestedQty', () => {
  it('refills to about twice the threshold', () => {
    expect(suggestedQty(p({ quantity: 2, lowStock: 10 }))).toBe(18);
    expect(suggestedQty(p({ quantity: 0, lowStock: 5 }))).toBe(10);
  });

  it('falls back to the store default threshold', () => {
    expect(suggestedQty(p({ quantity: 1 }), 8)).toBe(15);
  });

  it('always suggests at least one', () => {
    expect(suggestedQty(p({ quantity: 4, lowStock: 2 }))).toBe(1);
    expect(suggestedQty(p({ quantity: 0, lowStock: 0 }))).toBe(1);
  });

  it('rounds up to whole packs when there is a pack size', () => {
    // wants 18, ships in cases of 12 → two cases
    expect(suggestedQty(p({ quantity: 2, lowStock: 10, packSize: 12 }))).toBe(24);
    expect(packNote(24, p({ packSize: 12, packName: 'case' }))).toBe('2 cases');
    expect(packNote(20, p({ packSize: 12, packName: 'case' }))).toBe('');
    // A cleared quantity field is 0, and "0 cases" isn't a note.
    expect(packNote(0, p({ packSize: 12, packName: 'case' }))).toBe('');
  });

  it('keeps measured products decimal', () => {
    expect(suggestedQty(p({ unit: 'kg', quantity: 1.5, lowStock: 2 }))).toBe(2.5);
  });

  it('does not let float residue add a whole extra pack', () => {
    // needs 5.7, packs of 1.9 → exactly 3 packs, not 4 (5.7/1.9 is
    // 3.0000000000000004 in floats)
    expect(suggestedQty(p({ unit: 'kg', quantity: 0.3, lowStock: 3, packSize: 1.9 }))).toBe(5.7);
  });

  it('notes whole packs for decimal pack sizes despite float remainders', () => {
    // 3.6 % 1.2 is 2.2e-16 in floats, but 3.6 is exactly 3 rolls
    expect(packNote(3.6, p({ unit: 'kg', packSize: 1.2, packName: 'roll' }))).toBe('3 rolls');
    expect(packNote(3.5, p({ unit: 'kg', packSize: 1.2, packName: 'roll' }))).toBe('');
  });

  it('notes packs in the chosen source\'s pack size, as the quantity was rounded', () => {
    const product = p({ quantity: 2, lowStock: 10, packSize: 6, packName: 'case' });
    const source = { supplierId: 's2', packSize: 12 };
    // wants 18, this supplier ships 12s → two of their cases, not four of 6
    expect(suggestedQty(product, undefined, 0, { source })).toBe(24);
    expect(packNote(24, product, source)).toBe('2 cases');
    expect(packNote(18, product, source)).toBe('');
    // A source without its own pack size falls back to the product's.
    expect(packNote(18, product, { supplierId: 's1' })).toBe('3 cases');
  });

  it('prefers a per-product reorder quantity over the refill formula', () => {
    expect(suggestedQty(p({ quantity: 2, lowStock: 10, reorderQty: 50 }))).toBe(50);
    // Still rounded up to whole packs, since that's what ships.
    expect(suggestedQty(p({ quantity: 2, lowStock: 10, reorderQty: 50, packSize: 12 }))).toBe(60);
    // Zero or junk falls back to the formula.
    expect(suggestedQty(p({ quantity: 2, lowStock: 10, reorderQty: 0 }))).toBe(18);
    expect(suggestedQty(p({ quantity: 2, lowStock: 10, reorderQty: null }))).toBe(18);
  });

  it('subtracts what is already on its way', () => {
    // wants 18, 12 incoming → 6 more
    expect(suggestedQty(p({ quantity: 2, lowStock: 10 }), 5, 12)).toBe(6);
    // covered (or over-covered) → nothing to order
    expect(suggestedQty(p({ quantity: 2, lowStock: 10 }), 5, 18)).toBe(0);
    expect(suggestedQty(p({ quantity: 2, lowStock: 10 }), 5, 99)).toBe(0);
    // a fixed reorder amount subtracts too
    expect(suggestedQty(p({ quantity: 2, lowStock: 10, reorderQty: 50 }), 5, 20)).toBe(30);
  });
});

describe('suggestedQty with a coverage horizon', () => {
  it('orders the days of demand asked for, once the rate is known', () => {
    // 14 days × 3 a day = 42 wanted, 6 on hand → 36.
    expect(suggestedQty(p({ quantity: 6, lowStock: 5 }), 5, 0, { perDay: 3, coverageDays: 14 })).toBe(36);
    // Nothing on its way is still subtracted.
    expect(suggestedQty(p({ quantity: 6, lowStock: 5 }), 5, 10, { perDay: 3, coverageDays: 14 })).toBe(26);
  });

  it('never lands the product back in the alert it came from', () => {
    // A 2-day horizon on a product whose threshold is 20 would order to
    // 6 — straight back into the alert; the threshold is the floor.
    expect(suggestedQty(p({ quantity: 1, lowStock: 20 }), 5, 0, { perDay: 3, coverageDays: 2 })).toBe(20);
  });

  it('ignores the horizon without a rate, and the rate without a horizon', () => {
    expect(suggestedQty(p({ quantity: 2, lowStock: 5 }), 5, 0, { perDay: 0, coverageDays: 30 })).toBe(8);
    expect(suggestedQty(p({ quantity: 2, lowStock: 5 }), 5, 0, { perDay: 3, coverageDays: 0 })).toBe(8);
  });

  it('still rounds up to whole packs', () => {
    // 10 days × 1 a day = 10 wanted, 1 on hand → 9, in cases of 4 → 12.
    expect(suggestedQty(p({ quantity: 1, lowStock: 2, packSize: 4 }), 5, 0, { perDay: 1, coverageDays: 10 })).toBe(12);
  });

  it('leaves a fixed reorder amount alone', () => {
    expect(suggestedQty(p({ quantity: 1, lowStock: 5, reorderQty: 7 }), 5, 0, { perDay: 3, coverageDays: 30 })).toBe(7);
  });
});

describe('reorderGroups', () => {
  const suppliers = [{ id: 's1', name: 'Zenith' }, { id: 's2', name: 'Apex' }];
  const products = [
    p({ id: 'a', name: 'Low Apex', quantity: 1, lowStock: 5, supplierId: 's2' }),
    p({ id: 'b', name: 'Out Zenith', quantity: 0, lowStock: 5, supplierId: 's1' }),
    p({ id: 'c', name: 'Low loose', quantity: 2, lowStock: 5 }),
    p({ id: 'd', name: 'Fine', quantity: 50, lowStock: 5, supplierId: 's2' }),
    p({ id: 'e', name: 'Retired', quantity: 0, lowStock: 5, supplierId: 's2', archived: true }),
  ];

  it('groups alerts by supplier, most urgent first, with the loose ones last', () => {
    // Zenith's line is out of stock; Apex's is merely low, and with no
    // demand data neither can be told apart by cover.
    const groups = reorderGroups(products, { suppliers });
    expect(groups.map((g) => g.name)).toEqual(['Zenith', 'Apex', '']);
    expect(groups.find((g) => g.name === 'Apex').lines.map((l) => l.product.id)).toEqual(['a']);
    expect(groups[2].supplierId).toBeNull();
  });

  it('falls back to supplier name when nothing separates the urgency', () => {
    const evens = [
      p({ id: 'a', name: 'Low Apex', quantity: 1, lowStock: 5, supplierId: 's2' }),
      p({ id: 'b', name: 'Low Zenith', quantity: 1, lowStock: 5, supplierId: 's1' }),
    ];
    expect(reorderGroups(evens, { suppliers }).map((g) => g.name)).toEqual(['Apex', 'Zenith']);
  });

  it('orders lines by days of cover, with the unknown ones after the known', () => {
    const shelf = [
      p({ id: 'slow', name: 'Slow', quantity: 4, lowStock: 5, supplierId: 's1' }),   // 20 days
      p({ id: 'fast', name: 'Fast', quantity: 4, lowStock: 5, supplierId: 's1' }),   // 2 days
      p({ id: 'quiet', name: 'Quiet', quantity: 4, lowStock: 5, supplierId: 's1' }), // no data
    ];
    const rates = new Map([['slow', 0.2], ['fast', 2]]);
    const [group] = reorderGroups(shelf, { suppliers, rates });
    expect(group.lines.map((l) => l.product.id)).toEqual(['fast', 'slow', 'quiet']);
    expect(group.lines[0]).toMatchObject({ perDay: 2, cover: 2 });
    expect(group.lines[2].cover).toBeNull();
  });

  it('aims a line at the coverage horizon once demand is known', () => {
    const shelf = [p({ id: 'a', name: 'Milk', quantity: 4, lowStock: 5, supplierId: 's1' })];
    const rates = new Map([['a', 2]]);
    // 30 days × 2 a day = 60 wanted, 4 on hand → 56.
    expect(reorderGroups(shelf, { suppliers, rates, coverageDays: 30 })[0].lines[0].suggested).toBe(56);
    // Without a horizon it stays at twice the threshold, as before.
    expect(reorderGroups(shelf, { suppliers, rates })[0].lines[0].suggested).toBe(6);
  });

  it('leaves out healthy and archived products', () => {
    const ids = reorderGroups(products, { suppliers }).flatMap((g) => g.lines.map((l) => l.product.id));
    expect(ids).not.toContain('d');
    expect(ids).not.toContain('e');
  });

  it('drops products whose shortfall incoming stock covers, keeps ones it only dents', () => {
    // 'a' wants 9; 9 incoming covers it, 4 incoming leaves 5 to order.
    const covered = reorderGroups(products, { suppliers, incoming: new Map([['a', 9]]) });
    expect(covered.map((g) => g.name)).toEqual(['Zenith', '']);
    const dented = reorderGroups(products, { suppliers, incoming: new Map([['a', 4]]) });
    const apex = dented.find((g) => g.name === 'Apex');
    expect(apex.lines[0]).toMatchObject({ suggested: 5, incoming: 4 });
  });

  it('carries a suggested quantity per line', () => {
    const apex = reorderGroups(products, { suppliers }).find((g) => g.name === 'Apex');
    expect(apex.lines[0].suggested).toBe(9);
    expect(apex.lines[0].status).toBe('low');
  });
});

describe('reorderAlerts', () => {
  const suppliers = [{ id: 's1', name: 'Zenith' }, { id: 's2', name: 'Apex' }];
  const products = [
    p({ id: 'a', name: 'Low Apex', quantity: 1, lowStock: 5, supplierId: 's2' }),
    p({ id: 'b', name: 'Out Zenith', quantity: 0, lowStock: 5, supplierId: 's1' }),
    p({ id: 'c', name: 'Low loose', quantity: 2, lowStock: 5 }),
    p({ id: 'd', name: 'Fine', quantity: 50, lowStock: 5, supplierId: 's2' }),
  ];

  // The navigation badge counts this; the page groups it. They have to
  // be the same list, or the badge promises work the page doesn't show.
  const sameAsTheGroups = (list, options) => {
    const grouped = reorderGroups(list, options).flatMap((g) => g.lines.map((l) => l.product.id));
    const flat = reorderAlerts(list, options).map((l) => l.product.id);
    expect([...flat].sort()).toEqual([...grouped].sort());
    return flat;
  };

  it('counts exactly what the grouped list shows', () => {
    sameAsTheGroups(products, { suppliers });
    sameAsTheGroups(products, { suppliers, incoming: new Map([['a', 4]]) });
  });

  it('leaves out a kit, which is built or made rather than bought', () => {
    const part = p({ id: 'part', quantity: 40, lowStock: 5 });
    const kit = p({
      id: 'kit', name: 'Desk starter kit', quantity: 1, lowStock: 5,
      kit: 'build', components: [{ productId: 'part', qty: 1 }],
    });
    const list = [part, kit];
    expect(sameAsTheGroups(list, {})).toEqual([]);
  });
});

describe('productsOnOrder / onOrderQty', () => {
  it('collects what open orders still owe, per product', () => {
    const orders = [
      { status: 'ordered', lines: [{ productId: 'a', qty: 10, received: 0 }, { productId: 'b', qty: 3, received: 0 }] },
      { status: 'partial', lines: [{ productId: 'a', qty: 6, received: 2 }, { productId: 'c', qty: 5, received: 5 }] },
      { status: 'received', lines: [{ productId: 'd', qty: 9, received: 9 }] },
      { status: 'cancelled', lines: [{ productId: 'e', qty: 9, received: 0 }] },
      { status: 'closed', lines: [{ productId: 'f', qty: 9, received: 1 }] },
    ];
    const map = onOrderQty(orders);
    expect(map.get('a')).toBe(14);
    expect(map.get('b')).toBe(3);
    // Fully received lines, finished orders, and cancellations owe nothing.
    expect(map.has('c')).toBe(false);
    expect(map.has('d')).toBe(false);
    expect(map.has('e')).toBe(false);
    expect(map.has('f')).toBe(false);
    expect([...productsOnOrder(orders)].sort()).toEqual(['a', 'b']);
    expect(productsOnOrder(null).size).toBe(0);
  });

  it('never counts an over-receipt as negative', () => {
    expect(lineRemaining({ qty: 5, received: 8 })).toBe(0);
    expect(lineRemaining({ qty: 5, received: 2.25 })).toBe(2.75);
    expect(lineRemaining(null)).toBe(0);
  });
});

describe('migrateOrder', () => {
  it('marks a received order fully arrived, an open one untouched', () => {
    const received = migrateOrder({ status: 'received', lines: [{ productId: 'a', qty: 4 }] });
    expect(received.lines[0].received).toBe(4);
    const open = migrateOrder({ status: 'ordered', lines: [{ productId: 'a', qty: 4 }] });
    expect(open.lines[0].received).toBe(0);
    // Idempotent: an already-migrated partial keeps its progress.
    const partial = migrateOrder(migrateOrder({ status: 'partial', lines: [{ productId: 'a', qty: 4, received: 1 }] }));
    expect(partial.lines[0].received).toBe(1);
  });
});

describe('order sheets', () => {
  const order = {
    supplierName: 'Apex',
    lines: [
      { name: 'Mouse', sku: 'WM-1', code: 'APX-1', unit: 'each', qty: 12 },
      { name: 'Beans', sku: '', code: '', unit: 'kg', qty: 2.5 },
    ],
  };

  it('writes readable text with the supplier and aligned amounts', () => {
    const text = orderToText(order);
    expect(text.split('\n')[0]).toBe('Order: Apex');
    expect(text).toContain('12 units  Mouse (APX-1)');
    expect(text).toContain('2.5 kg  Beans');
  });

  it('leaves the date out unless asked', () => {
    expect(orderToText(order)).not.toMatch(/\d{4}/);
    expect(orderToText(order, { date: new Date(2026, 7, 4).getTime() })).toMatch(/2026/);
  });

  it('writes one CSV row per line, under fixed headers', () => {
    const rows = orderRows(order);
    expect(rows[0]).toEqual(['Supplier code', 'SKU', 'Product', 'Quantity', 'Unit']);
    expect(rows[1]).toEqual(['APX-1', 'WM-1', 'Mouse', 12, 'each']);
    expect(rows[2]).toEqual(['', '', 'Beans', 2.5, 'kg']);
    expect(orderRows({}).length).toBe(1);
  });

  it('prints the supplier’s own code where the line has one', () => {
    // Our SKU is a number they can't look up; theirs is the point.
    expect(orderToText(order)).toContain('12 units  Mouse (APX-1)');
    expect(orderToText({ lines: [{ name: 'Mouse', sku: 'WM-1', unit: 'each', qty: 1 }] }))
      .toContain('1 unit  Mouse (WM-1)');
  });

  it('guards formula injection in the text cells, like every other export', () => {
    const rows = orderRows({ lines: [{ name: '=HYPERLINK("http://evil")', sku: '+X1', code: '-C2', unit: '@each', qty: 3 }] });
    expect(rows[1]).toEqual([`'-C2`, `'+X1`, `'=HYPERLINK("http://evil")`, 3, `'@each`]);
  });
});
