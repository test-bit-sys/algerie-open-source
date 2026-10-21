/**
 * CSV parsing, column auto-detection, and serialization for product
 * import/export. No dependencies; tolerant of the messy files spreadsheet
 * tools actually produce (BOM, ;/tab delimiters, quoted newlines,
 * currency symbols, thousands separators).
 */

import { parseQty, parseMoney } from './util.js';
import { normalizeUnit, isCountUnit } from './units.js';
import { stockEntries, binMap, binAt, defaultLocationId, UNASSIGNED_LABEL } from './stock.js';

/* ---------- Parsing ---------- */

/**
 * Every character a file might be delimited by. Reading votes among
 * them (detectDelimiter); writing always uses the first — and quotes
 * any field carrying one of the others, so our own votes stay ours
 * (see escapeField).
 */
const DELIMITERS = [',', ';', '\t', '|'];

/** The one the exporters write. */
const WRITE_DELIMITER = DELIMITERS[0];

/** Pick the delimiter that appears most often outside quotes in the first lines. */
function detectDelimiter(text) {
  const counts = Object.fromEntries(DELIMITERS.map((d) => [d, 0]));
  // Same rule as the parser: only a quote at the start of a field opens
  // a quoted section. Here the field boundaries aren't known yet (the
  // delimiter is what's being detected), so "follows a boundary
  // character" stands in for "field start" \u2014 which keeps a bare inch
  // mark (24" Monitor) from putting the rest of the line "in quotes".
  const boundary = (ch) => ch === undefined || ch === '\n' || ch === '\r' || ch in counts;
  let inQuotes = false, lines = 0;
  for (let i = 0; i < text.length && lines < 20; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      }
    } else if (ch === '"' && boundary(text[i - 1])) {
      inQuotes = true;
    } else if (ch === '\n') {
      lines++;
    } else if (ch in counts) {
      counts[ch]++;
    }
  }
  let best = WRITE_DELIMITER, bestN = -1;
  for (const [d, n] of Object.entries(counts)) {
    if (n > bestN) { best = d; bestN = n; }
  }
  return bestN > 0 ? best : WRITE_DELIMITER;
}

/**
 * RFC-4180-ish parser: quoted fields, "" escapes, newlines inside
 * quotes.
 *
 * Each returned row carries the 1-based line of the file it started on
 * as a non-enumerable `line` \u2014 blank rows are dropped and quoted
 * fields can span several lines, so a row's position in this array
 * doesn't say where the user will find it in their spreadsheet.
 */
export function parseCSV(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const delim = detectDelimiter(src);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  let line = 1;      // the line the parser is on
  let rowLine = 1;   // the line the row being built started on

  const pushRow = (cells) => {
    Object.defineProperty(cells, 'line', { value: rowLine, enumerable: false });
    rows.push(cells);
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        // A newline inside a quoted field keeps the row open but still
        // moves the file's own line count on.
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      // Only a quote that starts a field opens a quoted section; a bare
      // quote inside one (24" Monitor) is a literal character, per RFC
      // 4180 and what Excel and Sheets do. Treating it as an opener
      // used to swallow the whole rest of the file into one field.
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      pushRow(row); row = [];
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); pushRow(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/* ---------- Serialization ---------- */

/*
 * RFC 4180 asks for quotes around fields holding a quote, a line break,
 * or the delimiter in use. We quote on *any* candidate delimiter as
 * well, because reading a file means voting on which one it used: a bare
 * field's semicolons, tabs, and pipes all join that vote against the
 * commas we wrote. Notes kept as "blue; red; green; …", or a stock
 * breakdown listing several locations ("Main: 10 | Shop: 5"), can
 * outnumber them across the first twenty lines — and then our own export
 * re-imports as one column per row, with every row rejected for having
 * no name. Quoting is transparent: the parser strips it again.
 */
const NEEDS_QUOTES = new RegExp(`["\\r\\n${DELIMITERS.join('')}]`);

function escapeField(v) {
  const s = String(v ?? '');
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/*
 * Formula-injection guard (CWE-1236): spreadsheets execute cells that
 * start with =, +, -, or @ as formulas, so exported text fields get
 * Excel's own "treat as text" marker, a leading apostrophe. The import
 * path strips that exact prefix back off, so our exports round-trip,
 * and so do files from Google Sheets, which uses the same convention.
 * "-" is included: Excel evaluates "-2+3+cmd|…" like any other formula,
 * and the apostrophe is invisible in the spreadsheet, so marking a
 * dash-leading name costs nothing there and round-trips losslessly here.
 */
/* A value already carrying apostrophes in front of a formula character
   ("'=Grade A") gets one more on export — the import strips exactly one
   back off, so the pair stays inverse and round-trips can't eat a
   legitimate leading apostrophe. Leading spaces don't hide a formula
   either (" =1+1"): LibreOffice trims them on import and executes what
   remains, so they're allowed in front of the marker character too. */
const NEEDS_MARK = /^[' ]*[=+\-@\t\r]/;
const MARKED = /^'[' ]*[=+\-@\t\r]/;

export function escapeFormula(v) {
  const s = String(v ?? '');
  return NEEDS_MARK.test(s) ? `'${s}` : s;
}

export function unescapeFormula(v) {
  const s = String(v ?? '');
  return MARKED.test(s) ? s.slice(1) : s;
}

/**
 * A cell the exporters assume is numeric. Real numbers pass as-is and
 * blanks stay blank, but anything else goes through the formula guard:
 * these fields are only numbers on the paths that build them, and data
 * that arrived through an untrusted backup file may hold strings —
 * including ones a spreadsheet would execute.
 */
export function numCell(v) {
  if (v === null || v === undefined || v === '') return '';
  return typeof v === 'number' && Number.isFinite(v) ? v : escapeFormula(v);
}

/** rows: array of arrays → CSV text with CRLF line endings. */
export function toCSV(rows) {
  return rows.map((r) => r.map(escapeField).join(WRITE_DELIMITER)).join('\r\n');
}

/* ---------- Product columns ---------- */

/**
 * Canonical import/export columns. `aliases` are matched (normalized)
 * against incoming headers for auto-mapping; export always writes
 * the canonical `header` names, so an export re-imports losslessly.
 */
export const PRODUCT_COLUMNS = [
  { key: 'name', header: 'Name', aliases: ['name', 'product', 'productname', 'item', 'itemname', 'title', 'description'] },
  { key: 'sku', header: 'SKU', aliases: ['sku', 'code', 'itemcode', 'productcode', 'partnumber', 'part', 'ref', 'reference'] },
  { key: 'barcode', header: 'Barcode', aliases: ['barcode', 'upc', 'ean', 'gtin', 'ean13', 'upca', 'scancode', 'barcodenumber'] },
  { key: 'category', header: 'Category', aliases: ['category', 'type', 'group', 'department'] },
  { key: 'quantity', header: 'Quantity', aliases: ['quantity', 'qty', 'stock', 'onhand', 'count', 'units', 'instock', 'stocklevel', 'quantityonhand'] },
  // 'units' is deliberately not an alias here: a column headed "Units"
  // in an inventory sheet is a quantity far more often than a unit name,
  // and Quantity claims it first anyway.
  { key: 'unit', header: 'Unit', aliases: ['unit', 'uom', 'unitofmeasure', 'measure', 'measuredin', 'unitname'] },
  { key: 'packSize', header: 'Pack size', aliases: ['packsize', 'packqty', 'casesize', 'unitsperpack', 'unitspercase', 'packof', 'qtyperpack'] },
  { key: 'packName', header: 'Pack name', aliases: ['packname', 'packunit', 'packtype', 'caseunit', 'packlabel'] },
  // 'bin' and 'shelf' are no longer aliases for a location: they name
  // where a thing sits *inside* one, which is its own column now.
  { key: 'location', header: 'Location', aliases: ['location', 'warehouse', 'site', 'store', 'room'] },
  { key: 'bin', header: 'Bin', aliases: ['bin', 'bincode', 'shelf', 'shelfcode', 'aisle', 'slot', 'position', 'binlocation'] },
  { key: 'binByLocation', header: 'Bins by location', aliases: ['binsbylocation', 'binbylocation', 'binsperlocation', 'shelfbylocation', 'binbreakdown'] },
  { key: 'stockByLocation', header: 'Stock by location', aliases: ['stockbylocation', 'locationstock', 'stockperlocation', 'bylocation', 'locationbreakdown'] },
  { key: 'supplier', header: 'Supplier', aliases: ['supplier', 'vendor', 'manufacturer', 'brand', 'source'] },
  { key: 'supplierLeadTime', header: 'Supplier lead time (days)', aliases: ['supplierleadtimedays', 'supplierleadtime', 'leadtimedays', 'leadtime', 'deliverydays'] },
  { key: 'supplierMinOrder', header: 'Supplier minimum order', aliases: ['supplierminimumorder', 'supplierminorder', 'minimumorder', 'minorder', 'moq', 'orderminimum'] },
  { key: 'cost', header: 'Purchase cost', aliases: ['purchasecost', 'cost', 'unitcost', 'costprice', 'buyprice', 'purchaseprice', 'costperunit'] },
  { key: 'price', header: 'Price', aliases: ['price', 'sellprice', 'saleprice', 'retailprice', 'sellingprice', 'unitprice', 'listprice'] },
  { key: 'lowStock', header: 'Low stock threshold', aliases: ['lowstockthreshold', 'lowstock', 'reorderpoint', 'reorderlevel', 'minstock', 'minimum', 'minqty', 'threshold', 'alertlevel'] },
  { key: 'reorderQty', header: 'Reorder quantity', aliases: ['reorderquantity', 'reorderqty', 'orderquantity', 'orderqty', 'reorderamount'] },
  { key: 'notes', header: 'Notes', aliases: ['notes', 'note', 'comment', 'comments', 'remarks', 'memo'] },
  { key: 'archived', header: 'Archived', aliases: ['archived', 'archive', 'inactive', 'discontinued', 'retired'] },
];

const TRUTHY = new Set(['yes', 'y', 'true', '1', 'x', 'archived', 'inactive', 'discontinued']);
const FALSY = new Set(['', 'no', 'n', 'false', '0', 'active']);

/** Read a boolean-ish CSV cell; unrecognized text reads as NaN. */
export function parseBool(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
  return NaN;
}

const normalizeHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* ---------- Stock breakdown column ---------- */

/**
 * "Main warehouse: 10 | Storefront: 5" — one cell holding a product's
 * whole per-location breakdown, so an export stays one row per product.
 * Names are split on the last colon, so "Aisle 3: bin 4: 12" works.
 */
export function stockToText(product, locationNames = new Map()) {
  const parts = [];
  for (const [locationId, qty] of stockEntries(product)) {
    parts.push(`${locationId ? (locationNames.get(locationId) || UNASSIGNED_LABEL) : UNASSIGNED_LABEL}: ${qty}`);
  }
  return parts.join(' | ');
}

/**
 * "Main warehouse: A3-12 | Storefront: B1" — a product's shelf codes
 * across places in one cell, the same grammar the stock breakdown uses,
 * so an export stays one row per product.
 */
export function binsToText(product, locationNames = new Map()) {
  const parts = [];
  for (const [locationId, code] of Object.entries(binMap(product))) {
    parts.push(`${locationId ? (locationNames.get(locationId) || UNASSIGNED_LABEL) : UNASSIGNED_LABEL}: ${code}`);
  }
  return parts.join(' | ');
}

/**
 * Parse that cell back into [{ name, code, unassigned }]. Split on the
 * last colon, like the stock breakdown, so a name holding one still
 * works; a piece with no colon at all belongs to the piece before it,
 * which is what makes our own exports of "Aisle 1 | Bin 2" re-import.
 */
export function parseBinsText(text, { onSkip = null } = {}) {
  const out = [];
  let carry = '';
  for (const chunk of String(text ?? '').split('|')) {
    const merged = carry ? `${carry}|${chunk}` : chunk;
    if (!merged.trim()) { carry = ''; continue; }
    if (merged.indexOf(':') === -1) { carry = merged; continue; }
    carry = '';
    const part = merged.trim();
    const at = part.lastIndexOf(':');
    const name = part.slice(0, at).trim();
    const code = part.slice(at + 1).trim();
    if (!name || !code) { onSkip?.(part); continue; }
    if (name.toLowerCase() === UNASSIGNED_LABEL.toLowerCase()) out.push({ name: '', code, unassigned: true });
    else out.push({ name, code });
  }
  if (carry.trim()) onSkip?.(carry.trim());
  return out;
}

/**
 * Parse that cell back into [{ name, qty, unassigned }]. `onSkip` is
 * told about each piece that tried to state an amount and couldn't be
 * read (bad number, missing name, dangling text) — a zero is a value,
 * not a failure.
 */
export function parseStockText(text, { decimals = false, onSkip = null } = {}) {
  const out = [];
  let carry = '';
  for (const chunk of String(text ?? '').split('|')) {
    // A '|' inside a location name ("Aisle 1 | Bin 2") splits its entry
    // apart; the piece left without a colon can't stand alone, so it
    // belongs to the front of the next piece — that's what makes our own
    // exports of such names re-import losslessly.
    const merged = carry ? `${carry}|${chunk}` : chunk;
    if (!merged.trim()) { carry = ''; continue; }
    if (merged.indexOf(':') === -1) { carry = merged; continue; }
    carry = '';
    const part = merged.trim();
    const at = part.lastIndexOf(':');
    const name = part.slice(0, at).trim();
    const qty = parseQty(part.slice(at + 1), { decimals });
    if (!name || Number.isNaN(qty)) { onSkip?.(part); continue; }
    if (qty <= 0) continue;
    if (name.toLowerCase() === UNASSIGNED_LABEL.toLowerCase()) out.push({ name: '', qty, unassigned: true });
    else out.push({ name, qty });
  }
  if (carry.trim()) onSkip?.(carry.trim());
  return out;
}

/**
 * Does the first row look like a header? True when at least one cell
 * matches a known alias and no cell parses as a bare number.
 */
export function looksLikeHeader(row) {
  if (!row?.length) return false;
  const cells = row.map(normalizeHeader);
  const known = PRODUCT_COLUMNS.some((c) => cells.some((cell) => c.aliases.includes(cell)));
  const numeric = row.some((cell) => /^\s*[\d.,]+\s*$/.test(String(cell)) && String(cell).trim() !== '');
  return known && !numeric;
}

/**
 * Map header cells to product fields: { fieldKey: columnIndex }.
 * A column feeds at most one field.
 *
 * The best alias wins, not the leftmost column: aliases are listed
 * best-first, so a file headed "Description, SKU, Name" has to take
 * its names from Name — scanning columns left to right instead put
 * every product's description in the name and left the real Name
 * column unmapped.
 */
export function autoMapColumns(header) {
  const cells = header.map(normalizeHeader);
  const map = {};
  const taken = new Set();
  for (const col of PRODUCT_COLUMNS) {
    let best = -1;
    let bestRank = Infinity;
    cells.forEach((cell, i) => {
      if (taken.has(i)) return;
      const rank = col.aliases.indexOf(cell);
      // Ties go to the leftmost column, as before.
      if (rank !== -1 && rank < bestRank) { best = i; bestRank = rank; }
    });
    if (best !== -1) {
      map[col.key] = best;
      taken.add(best);
    }
  }
  return map;
}

/**
 * Convert parsed CSV data rows into product drafts using a column mapping.
 * Returns { drafts, errors }. Rows without a name are rejected; bad
 * numbers fall back to safe defaults and are reported, not dropped.
 * Warnings name the row the user will actually find in their
 * spreadsheet: a row parsed by parseCSV knows the line it came from,
 * and `firstLine` numbers rows built some other way (2 when a header
 * was stripped).
 * `unitOf` answers "what unit does the product this SKU matches use?" —
 * it decides whether decimals are allowed when the file itself has no
 * Unit column, so a kg product's "2.5" isn't rejected as a decimal
 * count of items.
 *
 * Two kinds of "nothing here" matter, because a merge has to tell them
 * apart or an import silently destroys data:
 *   `undefined` — the file has no such column, so it says nothing about
 *                 the field and a matched product keeps what it has;
 *   `null`/empty — the column is there and this cell is blank, which is
 *                 a value the file is stating (no price, no category).
 */
export function rowsToDrafts(rows, mapping, { firstLine = 1, unitOf = null } = {}) {
  const drafts = [];
  const errors = [];
  const has = (key) => mapping[key] !== undefined;
  /**
   * Does this row actually carry the column's cell? A ragged row —
   * fewer cells than the header, which spreadsheet tools produce when
   * they trim trailing blanks — has nothing there at all, which is the
   * `undefined` case, not a stated blank: reading it as an empty cell
   * would turn "the row says nothing about quantity" into "quantity is
   * 0" and wipe a matched product's stock.
   */
  const present = (row, key) => has(key) && mapping[key] < row.length;
  const cell = (row, key) =>
    (has(key) ? unescapeFormula(String(row[mapping[key]] ?? '').trim()) : '');
  /** The cell's value, or undefined when the file (or row) doesn't carry it. */
  const stated = (row, key) => (present(row, key) ? cell(row, key) : undefined);

  rows.forEach((row, i) => {
    const line = row.line ?? (i + firstLine);
    const name = cell(row, 'name');
    if (!name) {
      errors.push({ line, message: 'Missing product name; row skipped' });
      return;
    }
    // An empty unit cell means "the file doesn't say", which leaves a
    // matched product's unit alone; new products default to "each".
    // For reading the numbers, though, a file that says nothing defers
    // to the product the row will match.
    const unitRaw = cell(row, 'unit');
    const unit = unitRaw ? normalizeUnit(unitRaw) : '';
    const knownUnit = unit || (unitOf ? String(unitOf(cell(row, 'sku')) ?? '') : '');
    const measured = !!knownUnit && !isCountUnit(knownUnit);
    const draft = {
      name,
      sku: cell(row, 'sku'),
      barcode: stated(row, 'barcode'),
      category: stated(row, 'category'),
      locationName: cell(row, 'location'),
      supplierName: cell(row, 'supplier'),
      notes: stated(row, 'notes'),
      unit,
      packSize: 0,
      packName: cell(row, 'packName'),
      quantity: present(row, 'quantity') ? 0 : undefined,
      stock: null,
      // A stated blank clears the shelf code the way any other column
      // does; an absent column says nothing about it.
      bin: undefined,
      bins: undefined,
      cost: present(row, 'cost') ? 0 : undefined,
      price: present(row, 'price') ? null : undefined,
      lowStock: present(row, 'lowStock') ? null : undefined,
      reorderQty: present(row, 'reorderQty') ? null : undefined,
      // Supplier details describe the supplier, not the product; a blank
      // cell says nothing (undefined), never "clear the supplier's value".
      supplierLeadTime: undefined,
      supplierMinOrder: undefined,
      archived: present(row, 'archived') ? false : undefined,
    };

    // An unreadable cell is neither a value nor a blank: the file tried
    // to say something and we couldn't read it. Importing a 0 over a
    // matched product's real number on that basis would be the silent
    // destruction the undefined/stated split exists to prevent — so
    // these fall back to undefined (field skipped) and a warning.
    const qtyRaw = cell(row, 'quantity');
    if (qtyRaw) {
      const q = parseQty(qtyRaw, { decimals: measured });
      if (Number.isNaN(q)) {
        draft.quantity = undefined;
        errors.push({
          line,
          message: measured
            ? `Unreadable quantity "${qtyRaw}"; not imported`
            : `Unreadable quantity "${qtyRaw}" for a counted product; not imported`,
        });
      } else draft.quantity = q;
    }
    const binRaw = cell(row, 'bin');
    if (present(row, 'bin')) draft.bin = binRaw;
    const binsRaw = cell(row, 'binByLocation');
    if (binsRaw) {
      let bad = 0;
      const list = parseBinsText(binsRaw, { onSkip: () => bad++ });
      if (!list.length || bad) {
        draft.bins = undefined;
        errors.push({
          line,
          message: `Unreadable bin breakdown "${binsRaw}"; using the Bin column`,
        });
      } else draft.bins = list;
    }
    const stockRaw = cell(row, 'stockByLocation');
    if (stockRaw) {
      let bad = 0;
      const list = parseStockText(stockRaw, { decimals: measured, onSkip: () => bad++ });
      if (!list.length || bad) {
        // All or nothing: importing the readable half of a breakdown
        // would shrink the total and, in 'set' mode, wipe the very
        // buckets the unreadable half was stating.
        draft.stock = [];
        errors.push({
          line,
          message: list.length
            ? `Unreadable parts in stock breakdown "${stockRaw}"; using the Quantity column`
            : `Unreadable stock breakdown "${stockRaw}"; using the Quantity column`,
        });
      } else {
        draft.stock = list;
        // The breakdown is the detailed truth; keep the total in step
        // with it so previews and merges agree.
        draft.quantity = Math.round(list.reduce((n, s) => n + s.qty, 0) * 1000) / 1000;
      }
    }
    const packRaw = cell(row, 'packSize');
    if (packRaw) {
      const s = parseQty(packRaw, { decimals: measured });
      if (Number.isNaN(s)) errors.push({ line, message: `Unreadable pack size "${packRaw}"; ignored` });
      else draft.packSize = s;
    }
    const costRaw = cell(row, 'cost');
    if (costRaw) {
      const c = parseMoney(costRaw);
      if (Number.isNaN(c) || c < 0) {
        draft.cost = undefined;
        errors.push({ line, message: `Unreadable cost "${costRaw}"; not imported` });
      } else draft.cost = c;
    }
    const priceRaw = cell(row, 'price');
    if (priceRaw) {
      const p = parseMoney(priceRaw);
      if (!Number.isNaN(p) && p >= 0) draft.price = p;
      else {
        draft.price = undefined;
        errors.push({ line, message: `Unreadable price "${priceRaw}"; not imported` });
      }
    }
    const lowRaw = cell(row, 'lowStock');
    if (lowRaw) {
      const l = parseQty(lowRaw, { decimals: measured });
      if (!Number.isNaN(l)) draft.lowStock = l;
      else {
        draft.lowStock = undefined;
        errors.push({ line, message: `Unreadable low-stock threshold "${lowRaw}"; not imported` });
      }
    }
    const reorderRaw = cell(row, 'reorderQty');
    if (reorderRaw) {
      const r = parseQty(reorderRaw, { decimals: measured });
      if (!Number.isNaN(r)) draft.reorderQty = r;
      else {
        draft.reorderQty = undefined;
        errors.push({ line, message: `Unreadable reorder quantity "${reorderRaw}"; not imported` });
      }
    }
    const leadRaw = cell(row, 'supplierLeadTime');
    if (leadRaw) {
      const days = parseQty(leadRaw);
      if (!Number.isNaN(days)) draft.supplierLeadTime = days;
      else errors.push({ line, message: `Unreadable supplier lead time "${leadRaw}"; ignored` });
    }
    const minRaw = cell(row, 'supplierMinOrder');
    if (minRaw) {
      const min = parseMoney(minRaw);
      if (!Number.isNaN(min) && min >= 0) draft.supplierMinOrder = min;
      else errors.push({ line, message: `Unreadable supplier minimum order "${minRaw}"; ignored` });
    }
    const archivedRaw = cell(row, 'archived');
    if (archivedRaw) {
      const a = parseBool(archivedRaw);
      if (typeof a === 'boolean') draft.archived = a;
      else {
        draft.archived = undefined;
        errors.push({ line, message: `Unreadable archived value "${archivedRaw}"; left as it was` });
      }
    }

    drafts.push(draft);
  });

  return { drafts, errors };
}

/* ---------- Activity ---------- */

export const ACTIVITY_COLUMNS = [
  'Date', 'Time', 'Type', 'Reason', 'Product', 'SKU',
  'Change', 'Moved', 'On hand after', 'Unit cost', 'Unit price',
  'Location', 'To location', 'Note',
];

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Serialize activity entries for bookkeeping. Date and time are local
 * and split into their own columns so a spreadsheet can sort and pivot
 * them; SKUs come from the products still on file. `reason` prints a
 * removal's why (sold, damaged, …) — blank for everything else.
 *
 * Unit cost carries what a receipt paid per unit, or what a sale's units
 * had cost at the time; Unit price is what a sale went out for. Both are
 * blank on entries that never recorded them — the money the log holds is
 * part of the record it exists to be.
 *
 * A move doesn't change what's on hand, so its Change cell is empty and
 * the amount that shifted shelves lives in `Moved` instead — a column
 * nobody has to sum against the others. Location is where the change
 * happened (for a move, where the stock left); To location only ever
 * fills in for a move. Without these, the whole per-location dimension
 * the app is built around was missing from its own audit export, and a
 * move exported as a row that stated nothing at all.
 */
export function activityToCSV(entries, { products = [], label = (a) => a.kind, reason = (a) => a.reason || '' } = {}) {
  const skuOf = new Map(products.map((p) => [p.id, p.sku || '']));
  const rows = [ACTIVITY_COLUMNS];
  for (const a of entries) {
    const d = new Date(a.at);
    rows.push([
      `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
      // The caller's label is fixed strings today, but the default
      // prints a.kind raw, and kinds can arrive through a restored
      // backup — guard the cell like every other text cell here.
      escapeFormula(label(a) ?? ''),
      escapeFormula(reason(a) ?? ''),
      escapeFormula(a.name ?? ''),
      escapeFormula(skuOf.get(a.productId) ?? ''),
      numCell(a.delta),
      numCell(a.moved),
      numCell(a.quantity),
      numCell(a.cost),
      numCell(a.price),
      escapeFormula(a.locationName ?? ''),
      escapeFormula(a.toLocationName ?? ''),
      escapeFormula(a.note ?? ''),
    ]);
  }
  return toCSV(rows);
}

/**
 * Serialize products to CSV with canonical headers. Location and supplier
 * ids are resolved to names so the file is human-readable and re-importable.
 */
export function productsToCSV(products, { locations = [], suppliers = [] } = {}) {
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const supById = new Map(suppliers.map((s) => [s.id, s]));
  const rows = [PRODUCT_COLUMNS.map((c) => c.header)];
  for (const p of products) {
    const sup = supById.get(p.supplierId);
    rows.push([
      escapeFormula(p.name),
      escapeFormula(p.sku ?? ''),
      escapeFormula(p.barcode ?? ''),
      escapeFormula(p.category ?? ''),
      numCell(p.quantity ?? 0),
      escapeFormula(normalizeUnit(p.unit)),
      Number(p.packSize) > 1 ? numCell(p.packSize) : '',
      escapeFormula(Number(p.packSize) > 1 ? (p.packName || '') : ''),
      escapeFormula(locName.get(p.locationId) ?? ''),
      escapeFormula(binAt(p, defaultLocationId(p))),
      escapeFormula(binsToText(p, locName)),
      escapeFormula(stockToText(p, locName)),
      escapeFormula(sup?.name ?? ''),
      numCell(sup?.leadTimeDays),
      numCell(sup?.minOrder),
      numCell(p.cost ?? 0),
      numCell(p.price),
      numCell(p.lowStock),
      numCell(p.reorderQty),
      escapeFormula(p.notes ?? ''),
      p.archived ? 'Yes' : '',
    ]);
  }
  return toCSV(rows);
}
