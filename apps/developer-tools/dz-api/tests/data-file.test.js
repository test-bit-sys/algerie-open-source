import { describe, it, expect } from 'vitest';
import { parseDataFile, parseCsvRecords } from '../src/core/data-file.js';

describe('parseDataFile: CSV', () => {
  it('reads a header row and data rows', () => {
    const out = parseDataFile('id,name\n1,Ada\n2,Grace\n', 'users.csv');
    expect(out.format).toBe('csv');
    expect(out.columns).toEqual(['id', 'name']);
    expect(out.rows).toEqual([{ id: '1', name: 'Ada' }, { id: '2', name: 'Grace' }]);
  });

  it('handles quotes, escaped quotes, delimiters and line breaks inside quotes', () => {
    const text = 'a,b,c\r\n"x, y","say ""hi""","line 1\r\nline 2"\r\n"",plain,\r\n';
    const out = parseDataFile(text, 'q.csv');
    expect(out.rows).toEqual([
      { a: 'x, y', b: 'say "hi"', c: 'line 1\r\nline 2' },
      { a: '', b: 'plain', c: '' },
    ]);
  });

  it('strips a byte order mark and accepts CRLF and missing final newline', () => {
    const out = parseDataFile('﻿key,value\r\nk1,v1\r\nk2,v2', 'bom.csv');
    expect(out.columns).toEqual(['key', 'value']);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[1]).toEqual({ key: 'k2', value: 'v2' });
  });

  it('skips blank lines and pads short rows', () => {
    const out = parseDataFile('a,b,c\n1,2\n\n3,4,5\n\n', 'x.csv');
    expect(out.rows).toEqual([{ a: '1', b: '2', c: '' }, { a: '3', b: '4', c: '5' }]);
  });

  it('ignores empty trailing values but rejects extra values', () => {
    expect(parseDataFile('a,b\n1,2,\n', 'x.csv').rows).toEqual([{ a: '1', b: '2' }]);
    expect(() => parseDataFile('a,b\n1,2\n1,2,3\n', 'x.csv')).toThrow(/Line 3 has 3 values but the header row has 2 columns/);
  });

  it('detects tab and semicolon separators', () => {
    expect(parseDataFile('a\tb\n1\t2', 'x.tsv').rows).toEqual([{ a: '1', b: '2' }]);
    expect(parseDataFile('a;b\n1;2', 'x.csv').rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('names empty header cells and rejects duplicate columns', () => {
    expect(parseDataFile('a,,c\n1,2,3', 'x.csv').columns).toEqual(['a', 'column2', 'c']);
    expect(() => parseDataFile('a,a\n1,2', 'x.csv')).toThrow(/appears more than once/);
  });

  it('reports unclosed quotes with a line number', () => {
    expect(() => parseDataFile('a,b\n1,"open\n2,3', 'x.csv')).toThrow(/Line 2: a quoted value is never closed/);
  });

  it('rejects empty files and header-only files', () => {
    expect(() => parseDataFile('', 'x.csv')).toThrow('The file is empty.');
    expect(() => parseDataFile('﻿  \n', 'x.csv')).toThrow('The file is empty.');
    expect(() => parseDataFile('a,b\n', 'x.csv')).toThrow(/no data rows/);
  });

  it('exposes record line numbers', () => {
    const recs = parseCsvRecords('a\n"x\ny"\nz');
    expect(recs.map((r) => r.line)).toEqual([1, 2, 4]);
  });
});

describe('parseDataFile: JSON', () => {
  it('reads an array of objects with the union of keys as columns', () => {
    const out = parseDataFile('[{"id":1,"name":"Ada"},{"id":2,"role":"admin"}]', 'users.json');
    expect(out.format).toBe('json');
    expect(out.columns).toEqual(['id', 'name', 'role']);
    expect(out.rows[0]).toEqual({ id: 1, name: 'Ada' });
  });

  it('accepts { rows: [...] }', () => {
    expect(parseDataFile('{"rows":[{"a":"b"}]}', 'd.json').rows).toEqual([{ a: 'b' }]);
  });

  it('stringifies nested values and blanks nulls', () => {
    const out = parseDataFile('[{"obj":{"x":1},"list":[1,2],"none":null}]', 'd.json');
    expect(out.rows[0]).toEqual({ obj: '{"x":1}', list: '[1,2]', none: '' });
  });

  it('keeps every digit of numbers a double cannot hold', () => {
    const text = '[{"id":1234567890123456789,"n":7,"price":1.5,"f":1.0,"nested":{"big":12345678901234567890,"s":"9007199254740993"}}]';
    const check = () => {
      const row = parseDataFile(text, 'd.json').rows[0];
      expect(String(row.id)).toBe('1234567890123456789');
      expect(row.n).toBe(7);
      expect(row.price).toBe(1.5);
      expect(row.f).toBe(1);
      expect(row.nested).toMatch(/"big":"?12345678901234567890"?,"s":"9007199254740993"/);
    };
    check();
    // Browsers without JSON.rawJSON get the digits as text.
    const rawJSON = JSON.rawJSON;
    delete JSON.rawJSON;
    try {
      check();
      expect(() => parseDataFile('[{"a":1},', 'd.json')).toThrow(/not valid JSON/);
    } finally {
      JSON.rawJSON = rawJSON;
    }
    expect(() => parseDataFile('[12345678901234567890]', 'd.json')).toThrow(/Item 1 in the JSON array is not an object/);
  });

  it('sniffs JSON when the file name has no known extension', () => {
    expect(parseDataFile('  [{"a":1}]', 'data').format).toBe('json');
    expect(parseDataFile('a,b\n1,2', 'data').format).toBe('csv');
  });

  it('throws friendly errors', () => {
    expect(() => parseDataFile('[{"a":1},', 'd.json')).toThrow(/not valid JSON/);
    expect(() => parseDataFile('{"a":1}', 'd.json')).toThrow(/array of objects/);
    expect(() => parseDataFile('[]', 'd.json')).toThrow(/empty/);
    expect(() => parseDataFile('[{"a":1}, 5]', 'd.json')).toThrow(/Item 2 in the JSON array is not an object/);
  });
  it('keeps a row that holds a single quoted empty value', () => {
    expect(parseDataFile('name\n""\nbob\n\n', 'x.csv').rows).toEqual([{ name: '' }, { name: 'bob' }]);
  });
  it('keeps a column named __proto__', () => {
    expect(parseDataFile('__proto__,b\n1,2', 'x.csv').rows[0]).toEqual(Object.fromEntries([['__proto__', '1'], ['b', '2']]));
    expect(Object.keys(parseDataFile('[{"__proto__": 1}]', 'x.json').rows[0])).toEqual(['__proto__']);
  });
});
