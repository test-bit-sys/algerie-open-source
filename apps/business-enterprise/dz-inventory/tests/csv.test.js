import { describe, it, expect } from 'vitest';
import {
  parseCSV, toCSV, looksLikeHeader, autoMapColumns, rowsToDrafts,
  productsToCSV, activityToCSV, parseBool, parseStockText, stockToText,
  binsToText, parseBinsText, PRODUCT_COLUMNS,
} from '../src/lib/csv.js';

describe('parseCSV', () => {
  it('parses simple comma-separated rows', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles quoted fields containing commas and escaped quotes', () => {
    const rows = parseCSV('name,notes\n"Mouse, wireless","He said ""hi"""');
    expect(rows[1]).toEqual(['Mouse, wireless', 'He said "hi"']);
  });

  it('handles newlines inside quoted fields', () => {
    const rows = parseCSV('name,notes\nMouse,"line one\nline two"');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('line one\nline two');
  });

  it('handles CRLF line endings', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseCSV('\uFEFF' + 'name,qty\nMouse,3')[0]).toEqual(['name', 'qty']);
  });

  it('auto-detects semicolon and tab delimiters', () => {
    expect(parseCSV('a;b;c\n1;2;3')[1]).toEqual(['1', '2', '3']);
    expect(parseCSV('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });

  it('drops fully empty rows', () => {
    expect(parseCSV('a,b\n,\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('treats a bare quote inside an unquoted field as a literal character', () => {
    // Inch marks are everywhere in inventory data; a lone " must not
    // put the rest of the file "in quotes" and swallow every row after it.
    const rows = parseCSV('Name,SKU,Quantity\n24" Monitor,MN-24,7\nWireless Mouse,WM-1,42');
    expect(rows).toEqual([
      ['Name', 'SKU', 'Quantity'],
      ['24" Monitor', 'MN-24', '7'],
      ['Wireless Mouse', 'WM-1', '42'],
    ]);
  });

  it('still detects the delimiter when a field carries a bare quote', () => {
    const rows = parseCSV('Name;SKU\n24" Monitor;MN-24\nCable 1m;CB-1');
    expect(rows[1]).toEqual(['24" Monitor', 'MN-24']);
    expect(rows[2]).toEqual(['Cable 1m', 'CB-1']);
  });

  it('appends text after a closing quote literally', () => {
    expect(parseCSV('"quoted" tail,b')[0]).toEqual(['quoted tail', 'b']);
  });

  it('tells each row which line of the file it came from', () => {
    // Blank rows are dropped and quoted fields span lines, so a row's
    // index is not where the user will find it in their spreadsheet.
    const rows = parseCSV('Name,Notes\nWidget,"one\ntwo"\n\nGadget,plain');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });

  it('returns [] for empty input', () => {
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV(null)).toEqual([]);
  });
});

describe('toCSV', () => {
  it('quotes fields containing commas, quotes, and newlines', () => {
    expect(toCSV([['a,b', 'say "hi"', 'x\ny']]))
      .toBe('"a,b","say ""hi""","x\ny"');
  });

  it('round-trips through parseCSV', () => {
    const rows = [['Name', 'Notes'], ['Cable, 2m', 'He said "ok"\nsecond line'], ['Plain', '']];
    // Trailing empty fields are preserved because the row has content.
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });

  it('quotes the other candidate delimiters too, so they can’t win the vote', () => {
    expect(toCSV([['a;b', 'c|d', 'e\tf']]))
      .toBe('"a;b","c|d","e\tf"');
  });

  it('round-trips a file whose text is thick with semicolons and pipes', () => {
    // Reading a file means voting on its delimiter; unquoted semicolons
    // in free text used to outvote the commas we wrote and shred the
    // whole export into one column per row.
    const notes = 'blue; red; green; black; white; grey; pink; teal; cyan; lime; navy; gold';
    const rows = [
      ['Name', 'Notes', 'Stock by location'],
      ...Array.from({ length: 5 }, (_, i) => [`Widget ${i}`, notes, 'Main: 10 | Shop: 5 | Van: 2']),
    ];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });
});

describe('looksLikeHeader', () => {
  it('recognizes a header row of known aliases', () => {
    expect(looksLikeHeader(['Product Name', 'SKU', 'Qty'])).toBe(true);
  });

  it('rejects a data row with numbers', () => {
    expect(looksLikeHeader(['Mouse', 'WM-1', '42'])).toBe(false);
  });

  it('rejects rows with no known column names', () => {
    expect(looksLikeHeader(['foo', 'bar', 'baz'])).toBe(false);
  });
});

describe('autoMapColumns', () => {
  it('maps common header variants case- and punctuation-insensitively', () => {
    const map = autoMapColumns(['Product Name', 'SKU', 'Qty', 'Unit Cost', 'Warehouse', 'Vendor', 'Reorder Point']);
    expect(map).toEqual({ name: 0, sku: 1, quantity: 2, cost: 3, location: 4, supplier: 5, lowStock: 6 });
  });

  it('prefers the better alias over the leftmost column', () => {
    // "Description" is a weak alias for Name; an actual Name column
    // beats it wherever it sits, or every product imports its
    // description as its name and the real column goes unmapped.
    expect(autoMapColumns(['Description', 'SKU', 'Name'])).toMatchObject({ name: 2, sku: 1 });
    // "Reorder point" also means the low-stock threshold, but an
    // explicit "Low stock threshold" column says it better.
    expect(autoMapColumns(['Reorder point', 'SKU', 'Low stock threshold'])).toMatchObject({ lowStock: 2 });
  });

  it('never maps two fields to the same column', () => {
    const map = autoMapColumns(['Name', 'Description']);
    // "Description" is an alias of name, but name already took column 0.
    const used = Object.values(map);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('rowsToDrafts', () => {
  const mapping = { name: 0, sku: 1, quantity: 2, cost: 3 };

  it('builds drafts with parsed numbers', () => {
    const { drafts, errors } = rowsToDrafts([['Mouse', 'WM-1', '1,200', '$11.50']], mapping);
    expect(errors).toEqual([]);
    expect(drafts[0]).toMatchObject({ name: 'Mouse', sku: 'WM-1', quantity: 1200, cost: 11.5 });
  });

  it('skips rows without a name and reports them', () => {
    const { drafts, errors } = rowsToDrafts([['', 'X', '1', '2']], mapping);
    expect(drafts).toEqual([]);
    expect(errors[0].line).toBe(1);
  });

  it('reports bad numbers but keeps the row, skipping the unreadable cells', () => {
    const { drafts, errors } = rowsToDrafts([['Mouse', '', 'many', 'cheap']], mapping);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].quantity).toBeUndefined();
    expect(drafts[0].cost).toBeUndefined();
    expect(errors).toHaveLength(2);
  });

  it('leaves fields the file has no column for unstated', () => {
    const { drafts } = rowsToDrafts([['Mouse']], { name: 0 });
    expect(drafts[0].sku).toBe('');
    for (const key of ['quantity', 'cost', 'price', 'lowStock', 'category', 'notes', 'barcode', 'archived']) {
      expect(drafts[0][key], key).toBeUndefined();
    }
  });

  it('numbers warnings by the spreadsheet row, past blanks and wrapped fields', () => {
    const rows = parseCSV([
      'Name,SKU,Quantity',
      'Widget,W1,5',
      '',                      // blank line the parser drops
      '"Multi',                // a quoted field spanning two lines
      'line",M1,7',
      'Gadget,G1,nonsense',    // spreadsheet row 6
    ].join('\n'));
    const { errors } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]), { firstLine: 2 });
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(6);
  });

  it('leaves fields unstated when a ragged row has no cell for them', () => {
    // A row shorter than the header (trailing blanks trimmed by the
    // exporting tool) says nothing about the missing columns; reading
    // them as blanks would import 0s over a matched product's numbers.
    const { drafts, errors } = rowsToDrafts(
      [['Widget', 'W1']],
      { name: 0, sku: 1, quantity: 2, cost: 3, price: 4, archived: 5 },
    );
    expect(errors).toEqual([]);
    expect(drafts[0].quantity).toBeUndefined();
    expect(drafts[0].cost).toBeUndefined();
    expect(drafts[0].price).toBeUndefined();
    expect(drafts[0].archived).toBeUndefined();
  });

  it('states an empty cell in a mapped column as a cleared value', () => {
    const { drafts } = rowsToDrafts([['Mouse', '', '', '', '']],
      { name: 0, category: 1, cost: 2, price: 3, notes: 4 });
    expect(drafts[0]).toMatchObject({ category: '', cost: 0, price: null, notes: '' });
  });
});

describe('productsToCSV', () => {
  it('resolves location and supplier ids to names and round-trips', () => {
    const products = [{
      name: 'Cable, braided', sku: 'CB-1', category: 'Cables', quantity: 7,
      locationId: 'L1', supplierId: 'S1', cost: 2.5, price: 7.99, lowStock: 15, notes: 'note "x"',
    }];
    const csv = productsToCSV(products, {
      locations: [{ id: 'L1', name: 'Main warehouse' }],
      suppliers: [{ id: 'S1', name: 'Brightline' }],
    });
    const rows = parseCSV(csv);
    expect(rows[0]).toEqual(PRODUCT_COLUMNS.map((c) => c.header));

    // A full export → import cycle preserves every field.
    const mapping = autoMapColumns(rows[0]);
    const { drafts, errors } = rowsToDrafts(rows.slice(1), mapping);
    expect(errors).toEqual([]);
    expect(drafts[0]).toMatchObject({
      name: 'Cable, braided', sku: 'CB-1', category: 'Cables', quantity: 7,
      locationName: 'Main warehouse', supplierName: 'Brightline',
      cost: 2.5, price: 7.99, lowStock: 15, notes: 'note "x"',
    });
  });

  it('round-trips an export whose notes are semicolon-separated lists', () => {
    // Real habit, and it used to break the file: enough unquoted
    // semicolons in the notes column outvoted our own commas, so the
    // export came back as one nameless column per row.
    const notes = 'blue; red; green; black; white; grey; pink; teal; cyan; lime; navy; gold; rust; jade; plum';
    const products = Array.from({ length: 6 }, (_, i) => ({
      name: `Widget ${i}`, sku: `W-${i}`, category: 'Parts', unit: 'each',
      quantity: 10, stock: { L1: 10 }, cost: 1.5, price: 3, lowStock: 5, notes,
    }));
    const rows = parseCSV(productsToCSV(products, { locations: [{ id: 'L1', name: 'Main' }] }));
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual(PRODUCT_COLUMNS.map((c) => c.header));
    const { drafts, errors } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(errors).toEqual([]);
    expect(drafts).toHaveLength(6);
    expect(drafts[0]).toMatchObject({ name: 'Widget 0', sku: 'W-0', notes, quantity: 10 });
  });

  it('leaves optional fields empty rather than writing 0', () => {
    const csv = productsToCSV([{ name: 'X', quantity: 1, cost: 0, price: null, lowStock: null }]);
    const row = parseCSV(csv)[1];
    const idx = (key) => PRODUCT_COLUMNS.findIndex((c) => c.key === key);
    expect(row[idx('price')]).toBe('');
    expect(row[idx('lowStock')]).toBe('');
    expect(row[idx('reorderQty')]).toBe('');
    expect(row[idx('supplierLeadTime')]).toBe('');
    expect(row[idx('supplierMinOrder')]).toBe('');
  });

  it('round-trips the reorder quantity and the supplier lead time and minimum', () => {
    const csv = productsToCSV(
      [{ name: 'X', sku: 'X-1', quantity: 1, cost: 0, price: null, lowStock: null, reorderQty: 40, supplierId: 'S1' }],
      { suppliers: [{ id: 'S1', name: 'Apex', leadTimeDays: 5, minOrder: 100 }] }
    );
    const rows = parseCSV(csv);
    const { drafts, errors } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(errors).toEqual([]);
    expect(drafts[0]).toMatchObject({
      reorderQty: 40, supplierName: 'Apex', supplierLeadTime: 5, supplierMinOrder: 100,
    });
  });

  it('reads supplier details only when the cell says something', () => {
    const { drafts, errors } = rowsToDrafts(
      [['Mouse', '', ''], ['Pad', '7', '€1.234,56'], ['Mat', 'soon', 'call us']],
      { name: 0, supplierLeadTime: 1, supplierMinOrder: 2 }
    );
    expect(drafts[0].supplierLeadTime).toBeUndefined();
    expect(drafts[0].supplierMinOrder).toBeUndefined();
    expect(drafts[1]).toMatchObject({ supplierLeadTime: 7, supplierMinOrder: 1234.56 });
    // Unreadable values warn and stay unset instead of writing junk.
    expect(drafts[2].supplierLeadTime).toBeUndefined();
    expect(drafts[2].supplierMinOrder).toBeUndefined();
    expect(errors).toHaveLength(2);
  });
});

describe('formula-injection guard', () => {
  it('marks exported text cells that spreadsheets would execute as text', () => {
    const csv = productsToCSV([{
      name: '=HYPERLINK("http://evil")', sku: '+X1', category: '@cmd',
      unit: '=A1&"kg"', quantity: 1, cost: 2, price: null, lowStock: null, notes: '=1+2',
    }]);
    const [header, row] = parseCSV(csv);
    const col = (name) => row[header.indexOf(name)];
    expect(col('Name')).toBe(`'=HYPERLINK("http://evil")`);
    expect(col('SKU')).toBe(`'+X1`);
    // The unit is free text too, so it gets the same treatment.
    expect(col('Unit')).toBe(`'=A1&"kg"`);
    expect(col('Notes')).toBe(`'=1+2`);
  });

  it('round-trips escaped values back to the original text on import', () => {
    const csv = productsToCSV([{ name: '=SUM(A1)', sku: 'OK-1', quantity: 2, cost: 0, price: null, lowStock: null }]);
    const rows = parseCSV(csv);
    const { drafts } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(drafts[0].name).toBe('=SUM(A1)');
  });

  it('round-trips a name that already starts with an apostrophe and a formula character', () => {
    const csv = productsToCSV([{ name: "'=Grade A", sku: 'S1', quantity: 1, cost: 0, price: null, lowStock: null }]);
    const rows = parseCSV(csv);
    // One more apostrophe on export, exactly one stripped on import.
    expect(rows[1][0]).toBe(`''=Grade A`);
    const { drafts } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(drafts[0].name).toBe("'=Grade A");
  });

  it('marks dash-leading text — Excel executes "-2+3" like any formula — and round-trips it', () => {
    const csv = productsToCSV([{ name: "-2+3+cmd|' /C calc'!A0", sku: 'S1', quantity: 1, cost: 0, price: null, lowStock: null }]);
    const rows = parseCSV(csv);
    expect(rows[1][0]).toBe("'-2+3+cmd|' /C calc'!A0");
    const { drafts } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(drafts[0].name).toBe("-2+3+cmd|' /C calc'!A0");
  });

  it('leaves ordinary text and inner apostrophes alone', () => {
    const csv = productsToCSV([{ name: "20% bin 'A'", sku: 'S1', quantity: 1, cost: 0, price: null, lowStock: null }]);
    const rows = parseCSV(csv);
    expect(rows[1][0]).toBe("20% bin 'A'");
    const { drafts } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(drafts[0].name).toBe("20% bin 'A'");
  });

  it('marks a formula hiding behind leading spaces — LibreOffice trims them on import', () => {
    const csv = productsToCSV([{ name: ' =1+1', sku: 'S1', quantity: 1, cost: 0, price: null, lowStock: null }]);
    const rows = parseCSV(csv);
    expect(rows[1][0]).toBe("' =1+1");
    const { drafts } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(drafts[0].name).toBe(' =1+1');
  });

  it('still marks tab-leading cells', () => {
    const csv = productsToCSV([{ name: '\t2+2', sku: 'S1', quantity: 1, cost: 0, price: null, lowStock: null }]);
    const rows = parseCSV(csv);
    expect(rows[1][0]).toBe("'\t2+2");
  });

  it('guards the numeric columns against smuggled formula strings', () => {
    // Data that skipped every coercing path (e.g. planted by a crafted
    // backup restored before validation hardened) must still not export
    // as live formulas.
    const csv = productsToCSV(
      [{ name: 'Widget', sku: 'S1', quantity: 2, cost: '=cmd|\'/c calc\'!A1', price: '=1+1', lowStock: null, reorderQty: '-2+3', supplierId: 's1' }],
      { suppliers: [{ id: 's1', name: 'Acme', leadTimeDays: '@SUM(1)', minOrder: 3 }] },
    );
    const rows = parseCSV(csv);
    const head = rows[0];
    const col = (h) => rows[1][head.indexOf(h)];
    expect(col('Purchase cost')).toBe(`'=cmd|'/c calc'!A1`);
    expect(col('Price')).toBe(`'=1+1`);
    expect(col('Reorder quantity')).toBe(`'-2+3`);
    expect(col('Supplier lead time (days)')).toBe(`'@SUM(1)`);
    expect(col('Supplier minimum order')).toBe('3');
  });
});

describe('activityToCSV', () => {
  const at = new Date(2026, 7, 4, 9, 5).getTime();
  const entries = [
    { id: 'a', at, kind: 'add', productId: 'p1', name: 'Mouse', delta: 5, quantity: 12, locationName: 'Storefront', note: 'PO #1042' },
    { id: 'b', at, kind: 'import', productId: null, name: '2 added', delta: null, quantity: null, note: '' },
  ];

  it('writes local date and time columns and resolves SKUs', () => {
    const rows = parseCSV(activityToCSV(entries, { products: [{ id: 'p1', sku: 'WM-1' }] }));
    expect(rows[0]).toEqual(['Date', 'Time', 'Type', 'Reason', 'Product', 'SKU',
      'Change', 'Moved', 'On hand after', 'Unit cost', 'Unit price',
      'Location', 'To location', 'Note']);
    expect(rows[1]).toEqual(['2026-08-04', '09:05', 'add', '', 'Mouse', 'WM-1',
      '5', '', '12', '', '', 'Storefront', '', 'PO #1042']);
  });

  it('leaves change and quantity blank when an entry has none', () => {
    const rows = parseCSV(activityToCSV(entries));
    expect(rows[2].slice(5)).toEqual(['', '', '', '', '', '', '', '', '']);
  });

  it('carries the money on a receipt and on a priced sale', () => {
    const received = { ...entries[0], cost: 4.5 };
    expect(parseCSV(activityToCSV([received]))[1].slice(9, 11)).toEqual(['4.5', '']);
    const sale = { ...entries[0], kind: 'remove', reason: 'sold', delta: -2, cost: 4.5, price: 11 };
    expect(parseCSV(activityToCSV([sale]))[1].slice(9, 11)).toEqual(['4.5', '11']);
  });

  it('states what a move shifted, and between which places', () => {
    const move = {
      id: 'c', at, kind: 'move', productId: 'p1', name: 'Mouse', moved: 4, quantity: 12,
      locationName: 'Main warehouse', toLocationName: 'Storefront', note: '',
    };
    const row = parseCSV(activityToCSV([move]))[1];
    // A move leaves the total alone, so Change stays empty and the
    // amount that changed shelves reads out of its own column.
    expect(row.slice(6, 9)).toEqual(['', '4', '12']);
    expect(row.slice(11, 13)).toEqual(['Main warehouse', 'Storefront']);
  });

  it('takes a label function for human-readable types', () => {
    const rows = parseCSV(activityToCSV(entries, { label: () => 'Received' }));
    expect(rows[1][2]).toBe('Received');
  });

  it('guards the type cell too — a restored backup can hold any kind', () => {
    const hostile = { ...entries[0], kind: '=cmd|/c calc' };
    expect(parseCSV(activityToCSV([hostile]))[1][2]).toBe("'=cmd|/c calc");
  });

  it('carries a removal reason, raw by default and through the reason function', () => {
    const removal = { ...entries[0], kind: 'remove', reason: 'damaged' };
    expect(parseCSV(activityToCSV([removal]))[1][3]).toBe('damaged');
    expect(parseCSV(activityToCSV([removal], { reason: () => 'Damaged' }))[1][3]).toBe('Damaged');
  });

  it('guards formula injection in names and notes', () => {
    const rows = parseCSV(activityToCSV([{ ...entries[0], name: '=cmd', note: '@x', locationName: '+A1' }]));
    expect(rows[1][4]).toBe("'=cmd");
    expect(rows[1][11]).toBe("'+A1");
    expect(rows[1][13]).toBe("'@x");
  });
});

describe('the archived column', () => {
  const base = { name: 'Mouse', sku: 'WM-1', quantity: 2, cost: 1, price: null, lowStock: null, notes: '' };

  it('reads the spellings spreadsheets actually contain', () => {
    expect(parseBool('Yes')).toBe(true);
    expect(parseBool('TRUE')).toBe(true);
    expect(parseBool('1')).toBe(true);
    expect(parseBool('discontinued')).toBe(true);
    expect(parseBool('no')).toBe(false);
    expect(parseBool('')).toBe(false);
    expect(parseBool('maybe')).toBeNaN();
  });

  it('round-trips an archived product through export and import', () => {
    const csv = productsToCSV([{ ...base, archived: true }, { ...base, sku: 'WM-2', archived: false }]);
    const rows = parseCSV(csv);
    expect(rows[0].at(-1)).toBe('Archived');
    expect(rows[1].at(-1)).toBe('Yes');
    const { drafts } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(drafts.map((d) => d.archived)).toEqual([true, false]);
  });

  it('leaves the flag unknown when the file has no such column', () => {
    const { drafts } = rowsToDrafts([['Mouse', '5']], { name: 0, quantity: 1 });
    expect(drafts[0].archived).toBeUndefined();
  });

  it('reports an unreadable value and leaves the flag alone', () => {
    const { drafts, errors } = rowsToDrafts([['Mouse', 'perhaps']], { name: 0, archived: 1 });
    expect(drafts[0].archived).toBeUndefined();
    expect(errors[0].message).toMatch(/Unreadable archived/);
  });
});

describe('units and packs in CSV', () => {
  const cols = (csv) => parseCSV(csv);

  it('exports the unit and pack columns, and re-imports them', () => {
    const csv = productsToCSV([
      { name: 'Beans', sku: 'BN-1', unit: 'kg', quantity: 2.5, cost: 4, price: null, lowStock: null },
      { name: 'Pens', sku: 'PN-1', unit: 'each', packSize: 12, packName: 'box', quantity: 60, cost: 1, price: null, lowStock: null },
    ]);
    const [header, beans, pens] = cols(csv);
    expect(header).toContain('Unit');
    expect(beans[header.indexOf('Unit')]).toBe('kg');
    expect(beans[header.indexOf('Quantity')]).toBe('2.5');
    expect(pens[header.indexOf('Pack size')]).toBe('12');
    expect(pens[header.indexOf('Pack name')]).toBe('box');

    const { drafts } = rowsToDrafts([beans, pens], autoMapColumns(header));
    expect(drafts[0]).toMatchObject({ unit: 'kg', quantity: 2.5 });
    expect(drafts[1]).toMatchObject({ unit: 'each', packSize: 12, packName: 'box' });
  });

  it('leaves pack columns empty for products not sold in packs', () => {
    const [header, row] = cols(productsToCSV([{ name: 'Mug', quantity: 1, cost: 0, price: null, lowStock: null }]));
    expect(row[header.indexOf('Pack size')]).toBe('');
    expect(row[header.indexOf('Pack name')]).toBe('');
    expect(row[header.indexOf('Unit')]).toBe('each');
  });

  it('accepts decimal quantities only for measured units', () => {
    const mapping = { name: 0, unit: 1, quantity: 2 };
    const { drafts, errors } = rowsToDrafts([
      ['Beans', 'kg', '2.5'],
      ['Mice', 'each', '2.5'],
    ], mapping);
    expect(drafts[0].quantity).toBe(2.5);
    expect(drafts[1].quantity).toBeUndefined();
    expect(errors[0].message).toMatch(/counted product/);
  });

  /* An unreadable cell is neither a value nor a blank; importing 0 over
     a matched product's real number would silently destroy data. */
  it('skips unreadable cells instead of importing zeros over real data', () => {
    const mapping = { name: 0, quantity: 1, cost: 2, price: 3, lowStock: 4 };
    const { drafts, errors } = rowsToDrafts([['Mouse', 'N/A', 'TBD', '?', 'few']], mapping);
    expect(drafts[0].quantity).toBeUndefined();
    expect(drafts[0].cost).toBeUndefined();
    expect(drafts[0].price).toBeUndefined();
    expect(drafts[0].lowStock).toBeUndefined();
    expect(errors).toHaveLength(4);
    // Blank cells in those same columns are still stated values.
    const blank = rowsToDrafts([['Mouse', '', '', '', '']], mapping).drafts[0];
    expect(blank).toMatchObject({ quantity: 0, cost: 0, price: null, lowStock: null });
  });

  it('reads a "Units" header as a quantity, not a unit name', () => {
    const map = autoMapColumns(['Item', 'Units']);
    expect(map.quantity).toBe(1);
    expect(map.unit).toBeUndefined();
  });

  it('leaves the unit unset when the file has no such column', () => {
    const { drafts } = rowsToDrafts([['Mug', '4']], { name: 0, quantity: 1 });
    expect(drafts[0].unit).toBe('');
  });
});

describe('the stock-by-location column', () => {
  const locations = [{ id: 'l1', name: 'Main warehouse' }, { id: 'l2', name: 'Storefront' }];
  const names = new Map(locations.map((l) => [l.id, l.name]));

  it('writes each bucket, biggest first, naming the loose one', () => {
    expect(stockToText({ stock: { l1: 10, l2: 5, '': 2 } }, names))
      .toBe('Main warehouse: 10 | Storefront: 5 | No location: 2');
    expect(stockToText({ stock: {} }, names)).toBe('');
  });

  it('reads it back, including the loose bucket', () => {
    expect(parseStockText('Main warehouse: 10 | Storefront: 5 | No location: 2')).toEqual([
      { name: 'Main warehouse', qty: 10 },
      { name: 'Storefront', qty: 5 },
      { name: '', qty: 2, unassigned: true },
    ]);
  });

  it('splits on the last colon, so names may contain one', () => {
    expect(parseStockText('Aisle 3: bin 4: 12')).toEqual([{ name: 'Aisle 3: bin 4', qty: 12 }]);
  });

  it("defers to the matched product's unit when the file has no Unit column", () => {
    const rows = [['Solder', 'SW-1', '2.5'], ['Mouse', 'WM-1', '2.5']];
    const mapping = { name: 0, sku: 1, quantity: 2 };
    const unitOf = (sku) => (sku === 'SW-1' ? 'kg' : 'each');
    const { drafts, errors } = rowsToDrafts(rows, mapping, { unitOf });
    // The kg product's decimal reads fine; the counted one still warns.
    expect(drafts[0].quantity).toBe(2.5);
    expect(drafts[0].unit).toBe(''); // the file still states no unit
    expect(drafts[1].quantity).toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it('numbers warnings from firstLine, so they match the spreadsheet', () => {
    const { errors } = rowsToDrafts([['', 'S1']], { name: 0, sku: 1 }, { firstLine: 2 });
    expect(errors[0].line).toBe(2);
  });

  it('rejects a partially unreadable breakdown rather than importing half of it', () => {
    const rows = [['Widget', 'W1', '9', 'Main: junk | Shop: 5']];
    const mapping = { name: 0, sku: 1, quantity: 2, stockByLocation: 3 };
    const { drafts, errors } = rowsToDrafts(rows, mapping);
    expect(drafts[0].stock).toEqual([]);
    expect(drafts[0].quantity).toBe(9); // the Quantity column, not the partial sum
    expect(errors.some((e) => e.message.includes('stock breakdown'))).toBe(true);
  });

  it('round-trips a location name containing the | separator', () => {
    const pipeNames = new Map([['a', 'Aisle 1 | Bin 2'], ['b', 'Shop']]);
    const cell = stockToText({ stock: { a: 10, b: 5 } }, pipeNames);
    expect(cell).toBe('Aisle 1 | Bin 2: 10 | Shop: 5');
    expect(parseStockText(cell)).toEqual([
      { name: 'Aisle 1 | Bin 2', qty: 10 },
      { name: 'Shop', qty: 5 },
    ]);
  });

  it('skips junk, blanks, and non-positive amounts', () => {
    expect(parseStockText('Main: 0 | : 5 | nonsense | Shop: -2 |  ')).toEqual([]);
    expect(parseStockText('')).toEqual([]);
    expect(parseStockText(null)).toEqual([]);
  });

  it('takes decimals only when the unit is measured', () => {
    expect(parseStockText('Barrel: 2.5', { decimals: true })).toEqual([{ name: 'Barrel', qty: 2.5 }]);
    expect(parseStockText('Barrel: 2.5')).toEqual([]);
  });

  it('round-trips a split product and totals the quantity from it', () => {
    const csv = productsToCSV([{
      id: 'p1', name: 'Cable', sku: 'CB-1', quantity: 15, cost: 1, price: null, lowStock: null,
      locationId: 'l1', stock: { l1: 10, l2: 5 },
    }], { locations });
    const rows = parseCSV(csv);
    const { drafts } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(drafts[0].stock).toEqual([{ name: 'Main warehouse', qty: 10 }, { name: 'Storefront', qty: 5 }]);
    expect(drafts[0].quantity).toBe(15);
  });

  it('falls back to the Quantity column when the breakdown is unreadable', () => {
    const { drafts, errors } = rowsToDrafts([['Cable', '7', 'nonsense']], { name: 0, quantity: 1, stockByLocation: 2 });
    expect(drafts[0].quantity).toBe(7);
    expect(drafts[0].stock).toEqual([]);
    expect(errors[0].message).toMatch(/stock breakdown/);
  });
});

describe('the barcode column', () => {
  it('exports and re-imports a barcode of its own', () => {
    const csv = productsToCSV([{ name: 'Mouse', sku: 'WM-1', barcode: '5901234123457', quantity: 1, cost: 0, price: null, lowStock: null }]);
    const rows = parseCSV(csv);
    expect(rows[1][rows[0].indexOf('Barcode')]).toBe('5901234123457');
    const { drafts } = rowsToDrafts(rows.slice(1), autoMapColumns(rows[0]));
    expect(drafts[0]).toMatchObject({ sku: 'WM-1', barcode: '5901234123457' });
  });

  it('maps UPC/EAN headers to the barcode, not the SKU', () => {
    expect(autoMapColumns(['Item', 'SKU', 'EAN'])).toMatchObject({ sku: 1, barcode: 2 });
    expect(autoMapColumns(['Item', 'UPC'])).toMatchObject({ barcode: 1 });
    expect(autoMapColumns(['Item', 'Barcode']).sku).toBeUndefined();
  });
});

describe('bin columns', () => {
  const locations = [{ id: 'l1', name: 'Main warehouse' }, { id: 'l2', name: 'Storefront' }];
  const names = new Map(locations.map((l) => [l.id, l.name]));

  it('writes a product’s shelf codes as one cell', () => {
    expect(binsToText({ bin: { l1: 'A3-12', l2: 'B1' } }, names)).toBe('Main warehouse: A3-12 | Storefront: B1');
    expect(binsToText({ bin: { '': 'X9' } }, names)).toBe('No location: X9');
    expect(binsToText({}, names)).toBe('');
  });

  it('reads that cell back, splitting on the last colon', () => {
    expect(parseBinsText('Main warehouse: A3-12 | Storefront: B1')).toEqual([
      { name: 'Main warehouse', code: 'A3-12' },
      { name: 'Storefront', code: 'B1' },
    ]);
    // A name holding a colon, and one holding a pipe, both survive.
    expect(parseBinsText('Aisle 3: bin 4: C7')).toEqual([{ name: 'Aisle 3: bin 4', code: 'C7' }]);
    expect(parseBinsText('Aisle 1 | Bin 2: D1')).toEqual([{ name: 'Aisle 1 | Bin 2', code: 'D1' }]);
    expect(parseBinsText('No location: X9')[0]).toMatchObject({ name: '', code: 'X9', unassigned: true });
  });

  it('reports pieces it cannot read rather than guessing', () => {
    const skipped = [];
    expect(parseBinsText('Main: A1 | rubbish', { onSkip: (x) => skipped.push(x) })).toEqual([{ name: 'Main', code: 'A1' }]);
    expect(skipped).toEqual(['rubbish']);
  });

  it('round-trips through the product export', () => {
    const csv = productsToCSV([{ name: 'Mouse', sku: 'WM-1', unit: 'each', quantity: 6, stock: { l1: 6 }, locationId: 'l1', bin: { l1: 'A3-12', l2: 'B1' } }], { locations });
    const rows = parseCSV(csv);
    const at = (header) => rows[0].indexOf(header);
    expect(rows[1][at('Bin')]).toBe('A3-12');
    expect(rows[1][at('Bins by location')]).toBe('Main warehouse: A3-12 | Storefront: B1');
  });

  it('maps a spreadsheet’s shelf column to the bin field, not the location', () => {
    const map = autoMapColumns(['Name', 'Shelf', 'Location']);
    expect(map.bin).toBe(1);
    expect(map.location).toBe(2);
    const { drafts } = rowsToDrafts([['Mouse', 'A3-12', 'Main warehouse']], map);
    expect(drafts[0]).toMatchObject({ bin: 'A3-12', locationName: 'Main warehouse' });
  });
});
