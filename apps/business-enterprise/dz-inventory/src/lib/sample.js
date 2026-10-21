/**
 * Sample dataset for "explore with sample data": a small electronics and
 * office-goods stockroom with a few items deliberately low or out of
 * stock so the alerts, filters, and dashboard have something to show.
 * Shaped exactly like the store's collections so store.importAll()
 * installs it — and wipeAll() removes it — through the normal paths.
 */

import { uid } from './util.js';

export function sampleDataset(store) {
  const now = Date.now();
  const h = 3600 * 1000;
  const d = 24 * h;

  const loc = { warehouse: uid(), storefront: uid(), backroom: uid() };
  const sup = { nordic: uid(), apex: uid(), brightline: uid(), paperTrail: uid() };

  const locations = [
    { id: loc.warehouse, name: 'المستودع المركزي - الجزائر العاصمة (16)', note: 'المنطقة الصناعية الرويبة، ترميز الممرات والرفوف A1-B12', createdAt: now - 90 * d },
    { id: loc.storefront, name: 'نقطة التوزيع والعرض - وهران (31)', note: 'حي الصديقية، مخزون واجهة البيع المباشر', createdAt: now - 90 * d },
    { id: loc.backroom, name: 'مركز العبور واللوجستيك - قسنطينة (25)', note: 'المنطقة اللوجستية الخروب، مخزون الفائض والإرجاع', createdAt: now - 60 * d },
  ];

  const suppliers = [
    { id: sup.nordic, name: 'مؤسسة تيميمون للتجهيزات الصناعية', contact: 'أحمد بن علي', email: 'contact@timimoun-dz.example', phone: '+213 21 55 12 34', website: 'timimoun-dz.example', notes: 'دفع خلال 30 يوم، توصيل مجاني للطلبات فوق 50,000 د.ج', createdAt: now - 90 * d },
    { id: sup.apex, name: 'شركة الأوراس للإلكترونيات الدقيقة', contact: 'كريم مزيان', email: 'commercial@auras-dz.example', phone: '+213 31 88 44 20', website: 'auras-dz.example', notes: 'شحنات أسبوعية كل يوم ثلاثاء إلى مستودع الرويبة', createdAt: now - 85 * d },
    { id: sup.brightline, name: 'مؤسسة الرمال الذهبية للكوابل والشبكات', contact: 'فاطمة الزهراء قاسمي', email: 'sales@rimal-dz.example', phone: '+213 29 71 33 11', website: 'rimal-dz.example', notes: 'منتجات حاصلة على شهادة المطابقة الجزائرية', createdAt: now - 70 * d },
    { id: sup.paperTrail, name: 'الشركة المغاربية للورق واللوازم المكتبية', contact: 'يوسف بلقاسم', email: 'orders@maghreb-paper.example', phone: '+213 25 66 10 50', website: 'maghreb-paper.example', notes: 'تخفيضات خاصة عند شراء أكثر من 100 وحدة', createdAt: now - 40 * d },
  ];

  const P = (name, sku, category, quantity, locationId, supplierId, cost, price, lowStock, notes, ageDays, extra = {}) => ({
    id: uid(), name, sku, category, quantity, locationId, supplierId, cost,
    price, lowStock, notes,
    unit: 'each', packSize: 0, packName: '', archived: false, barcode: '',
    stock: quantity > 0 ? { [locationId]: quantity } : {},
    createdAt: now - ageDays * d, updatedAt: now - Math.min(ageDays, 3) * d,
    ...extra,
  });

  const products = [
    P('Wireless Mouse M310', 'WM-M310', 'Peripherals', 42, loc.warehouse, sup.apex, 11.5, 24.99, 10, '', 80,
      { barcode: '5901234123457' }),
    P('Mechanical Keyboard K87', 'KB-K87', 'Peripherals', 18, loc.warehouse, sup.apex, 38, 79, 8, 'Brown switches', 78,
      { barcode: '4006381333931' }),
    P('USB-C Cable 1m', 'CB-UC1M', 'Cables', 6, loc.storefront, sup.brightline, 2.1, 7.99, 15, 'Braided', 75,
      { barcode: '0123456789012' }),
    P('USB-C Cable 2m', 'CB-UC2M', 'Cables', 0, loc.storefront, sup.brightline, 2.9, 9.99, 15, 'Braided', 75),
    // Split across two places, so the location breakdown has something
    // to show the moment the sample data loads.
    P('HDMI Cable 2m', 'CB-HD2M', 'Cables', 64, loc.warehouse, sup.brightline, 3.4, 12.5, 20, '', 70,
      { stock: { [loc.warehouse]: 46, [loc.storefront]: 18 } }),
    P('27in Monitor QHD', 'MN-27Q', 'Displays', 9, loc.warehouse, sup.apex, 148, 259, 4, '', 66),
    P('Laptop Stand Alu', 'ST-ALU1', 'Accessories', 23, loc.storefront, sup.nordic, 14.2, 34.9, 6, '', 60),
    P('Webcam 1080p', 'WC-1080', 'Peripherals', 3, loc.backroom, sup.apex, 22, 49, 5, 'Returns checked OK', 58),
    P('Noise-Cancel Headset H700', 'HS-H700', 'Audio', 12, loc.warehouse, sup.apex, 61, 129, 5, '', 55),
    P('Desk Lamp LED', 'LP-LED2', 'Office', 31, loc.storefront, sup.nordic, 9.8, 21.5, 8, 'Warm white', 50),
    P('Notebook A5 Dotted', 'NB-A5D', 'Stationery', 140, loc.storefront, sup.paperTrail, 1.15, 4.5, 40, '3-pack', 45),
    P('Gel Pen 0.5 Black', 'PN-G05B', 'Stationery', 60, loc.storefront, sup.paperTrail, 0.3, 0.83, 24, '', 45,
      { packSize: 12, packName: 'box' }),
    P('Solder Wire 0.8mm', 'SW-08MM', 'Consumables', 4.25, loc.warehouse, sup.nordic, 18, 0, 2, 'Sold by weight', 42,
      { unit: 'kg', price: null }),
    P('Cable Sleeving', 'CS-BLK', 'Consumables', 128.5, loc.warehouse, sup.brightline, 0.4, 1.2, 50, 'Cut to length', 38,
      { unit: 'm', price: null }),
    P('Printer Paper A4 500', 'PP-A450', 'Stationery', 0, loc.backroom, sup.paperTrail, 3.9, 8.5, 12, '80gsm', 40),
    P('Ergonomic Chair Pro', 'CH-ERGP', 'Furniture', 7, loc.warehouse, sup.nordic, 189, 399, 3, '', 35),
    P('Standing Desk 120cm', 'DK-ST12', 'Furniture', 4, loc.warehouse, sup.nordic, 240, 499, 2, '', 35),
    P('Cable Organizer Set', 'OR-CBL5', 'Accessories', 2, loc.storefront, sup.brightline, 4.5, 12.9, 10, '5-piece', 30),
    P('Power Strip 6-way', 'PW-6WAY', 'Accessories', 26, loc.warehouse, sup.brightline, 6.8, 15.9, 8, 'Surge protected', 28),
    P('Monitor Arm Single', 'MA-SGL1', 'Accessories', 11, loc.warehouse, sup.nordic, 19.5, 44.9, 4, '', 20),
  ];

  const byName = (n) => products.find((p) => p.name === n);
  const act = (kind, name, delta, quantity, note, agoH) => ({
    id: uid(), at: now - agoH * h, kind,
    productId: byName(name)?.id || null, name,
    unit: byName(name)?.unit || 'each',
    delta, quantity, note,
  });

  const activity = [
    act('remove', 'Solder Wire 0.8mm', -0.75, 4.25, 'Bench work', 3),
    act('add', 'Gel Pen 0.5 Black', 24, 60, '2 boxes received', 4),
    act('add', 'Wireless Mouse M310', 24, 42, 'PO #1042 received', 5),
    act('remove', 'USB-C Cable 1m', -9, 6, 'Storefront restock', 8),
    act('remove', 'USB-C Cable 2m', -4, 0, 'Sold out', 26),
    act('recount', 'Notebook A5 Dotted', -3, 140, 'Cycle count', 30),
    act('add', 'Desk Lamp LED', 12, 31, 'PO #1039 received', 52),
    act('remove', 'Printer Paper A4 500', -12, 0, 'Office order', 75),
    act('add', 'Ergonomic Chair Pro', 5, 7, 'PO #1035 received', 96),
  ];

  return {
    settings: { sampleData: true, onboarded: true, currency: store.settings.currency },
    products,
    locations,
    suppliers,
    activity,
  };
}

/** One-tap wipe from the sample banner. Sample data needs no snapshot. */
export async function wipeSampleData(store) {
  await store.wipeAll({ snapshot: false });
  await store.updateSettings({ onboarded: false });
}
