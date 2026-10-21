/**
 * Data files for the collection runner. Each row becomes one iteration's
 * data variables.
 *
 * parseDataFile(text, fileName) -> { rows: [object], columns: [string], format: 'csv' | 'json' }
 *
 * CSV follows RFC 4180: the first record is the header row, fields may be
 * quoted, quotes inside quoted fields are doubled, and quoted fields may
 * span lines. CRLF and LF line endings and a leading byte order mark are
 * accepted. Tab and semicolon separated files are detected from the header.
 *
 * JSON is an array of objects, or an object with a `rows` array.
 * Errors are thrown as Error with a message that can be shown as is.
 */

export const DATA_FILE_ACCEPT = '.csv,.tsv,.json,.txt,text/csv,text/tab-separated-values,application/json';

export function parseDataFile(text, fileName = '') {
  if (typeof text !== 'string') throw new Error('The file could not be read as text.');
  const body = text.replace(/^﻿/, '');
  if (!body.trim()) throw new Error('The file is empty.');
  const ext = /\.([a-z0-9]+)$/i.exec(fileName || '')?.[1]?.toLowerCase() || '';
  let format = ext === 'json' ? 'json' : ext === 'csv' || ext === 'tsv' || ext === 'txt' ? 'csv' : null;
  if (!format) format = /^[[{]/.test(body.trimStart()) ? 'json' : 'csv';
  const out = format === 'json' ? parseJson(body) : parseCsv(body, ext === 'tsv' ? '\t' : null);
  return { ...out, format };
}

// JSON ----------------------------------------------------------------------

// Doubles hold 15 significant digits; only longer literals can lose some.
const LONG_DIGITS = /\d[\d.]{15}/;
/** True for a number literal a double would change, such as a 19-digit id. */
const lossy = (value, source) => typeof value === 'number' && LONG_DIGITS.test(source) && String(value) !== source;
const STRING_OR_NUMBER = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** JSON.parse that keeps the exact digits of numbers a double cannot hold. */
function parseExact(text) {
  if (!LONG_DIGITS.test(text)) return JSON.parse(text);
  // Where supported, the reviver sees each number's source text.
  if (typeof JSON.rawJSON === 'function') return JSON.parse(text, (k, v, context) => (lossy(v, context?.source) ? JSON.rawJSON(context.source) : v));
  // Elsewhere, such numbers are quoted first and arrive as text.
  return JSON.parse(text.replace(STRING_OR_NUMBER, (m) => (m[0] !== '"' && lossy(Number(m), m) ? `"${m}"` : m)));
}

function parseJson(text) {
  let data;
  try {
    data = parseExact(text);
  } catch (err) {
    throw new Error(`The file is not valid JSON. ${String(err?.message || '').replace(/^JSON\.parse: /, '')}`.trim());
  }
  if (data && !Array.isArray(data) && typeof data === 'object' && Array.isArray(data.rows)) data = data.rows;
  if (!Array.isArray(data)) throw new Error('A JSON data file must contain an array of objects, for example [{"id": 1}, {"id": 2}].');
  if (!data.length) throw new Error('The JSON array is empty. Add at least one object.');
  const columns = [];
  const seen = new Set();
  const rows = data.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || JSON.isRawJSON?.(item)) {
      throw new Error(`Item ${i + 1} in the JSON array is not an object. Each item should look like {"name": "value"}.`);
    }
    const entries = Object.entries(item).map(([k, v]) => {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
      // Objects, and numbers kept as raw JSON, become their JSON text.
      return [k, v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v];
    });
    // fromEntries defines every key as data, so a column named __proto__ is kept rather than swallowed.
    return Object.fromEntries(entries);
  });
  return { rows, columns };
}

// CSV -----------------------------------------------------------------------

/** Picks the separator used in the header line (outside quotes). */
function detectDelimiter(text) {
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  let best = ',';
  for (const d of ['\t', ';']) if (counts[d] > counts[best]) best = d;
  return best;
}

/** Splits CSV text into records of raw string fields, with the line each record starts on. */
export function parseCsvRecords(text, delimiter = ',') {
  const records = [];
  let field = '';
  let record = [];
  let line = 1;
  let recordLine = 1;
  let quoted = false;
  let quoteLine = 0;
  let wasQuoted = false;
  const endField = () => {
    record.push(field);
    field = '';
    wasQuoted = false;
  };
  const endRecord = () => {
    // A line with nothing on it, as opposed to one holding a single "" value.
    const blank = !record.length && field.trim() === '' && !wasQuoted;
    endField();
    records.push({ fields: record, line: recordLine, blank });
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (field === '' && !wasQuoted) {
        quoted = true;
        wasQuoted = true;
        quoteLine = line;
      } else field += c; // A stray quote in an unquoted field is kept as text.
    } else if (c === delimiter) {
      endField();
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error(`Line ${quoteLine}: a quoted value is never closed. Check for a missing closing quote (").`);
  if (field !== '' || record.length || wasQuoted) endRecord();
  return records;
}

function parseCsv(text, forced) {
  const delimiter = forced || detectDelimiter(text);
  const records = parseCsvRecords(text, delimiter).filter((r) => !r.blank);
  if (!records.length) throw new Error('The file is empty.');
  const [head, ...body] = records;
  const columns = head.fields.map((name, i) => name.trim() || `column${i + 1}`);
  const seen = new Set();
  for (const c of columns) {
    if (seen.has(c)) throw new Error(`The column "${c}" appears more than once in the header row. Column names must be unique.`);
    seen.add(c);
  }
  if (!body.length) throw new Error('The file has a header row but no data rows. Add at least one row below the header.');
  const rows = body.map(({ fields, line }) => {
    let values = fields;
    if (values.length > columns.length) {
      const extra = values.slice(columns.length);
      if (extra.some((v) => v.trim() !== '')) {
        throw new Error(`Line ${line} has ${values.length} values but the header row has ${columns.length} columns.`);
      }
      values = values.slice(0, columns.length);
    }
    return Object.fromEntries(columns.map((c, i) => [c, values[i] ?? '']));
  });
  return { rows, columns };
}
