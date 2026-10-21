import { describe, it, expect } from 'vitest';
import { query, parsePath, parseJsonExact } from '../src/core/json-path.js';

const doc = {
  data: { items: [{ id: 1, name: 'a', tags: ['x'] }, { id: 2, name: 'b', tags: [] }, { id: 3, name: 'c' }], total: 3 },
  'weird key': true,
  meta: { id: 'm' },
};

describe('json path', () => {
  it('selects properties, indexes and slices', () => {
    expect(query(doc, '$.data.total')).toEqual([3]);
    expect(query(doc, 'data.items[0].name')).toEqual(['a']);
    expect(query(doc, '$.data.items[-1].id')).toEqual([3]);
    expect(query(doc, "$['weird key']")).toEqual([true]);
    expect(query(doc, '$.data.items[0:2].id')).toEqual([1, 2]);
    expect(query(doc, '$.data.items.length')).toEqual([3]);
  });

  it('supports wildcards and deep scans', () => {
    expect(query(doc, '$.data.items[*].id')).toEqual([1, 2, 3]);
    expect(query(doc, '$.data.items.*.name')).toEqual(['a', 'b', 'c']);
    expect(query(doc, '$..id')).toEqual([1, 2, 3, 'm']);
    expect(query(doc, '$.nope.deeper')).toEqual([]);
    expect(query(doc, '$')).toEqual([doc]);
  });

  it('handles very large arrays', () => {
    const data = { data: Array.from({ length: 200000 }, (_, i) => ({ id: i })) };
    expect(query(data, '$.data[*].id')).toHaveLength(200000);
    expect(query(data, '$.data[0:150000]')).toHaveLength(150000);
  });

  it('keeps the exact digits of large numbers', () => {
    const p = parseJsonExact('{"id":12345678901234567890,"n":[5,"x"]}');
    expect(p.stringify(query(p.value, '$.id')[0])).toBe('12345678901234567890');
    expect(p.stringify(query(p.value, '$.n'))).toBe('[\n  [\n    5,\n    "x"\n  ]\n]');
  });

  it('reports bad paths', () => {
    expect(() => parsePath('$.data[')).toThrow(/Missing/);
    expect(() => parsePath('$.data[?(@.id)]')).toThrow(/Unsupported/);
    expect(() => parsePath('$..')).toThrow(/Expected a name/);
    // Unions are not supported, so they are reported instead of read as one odd key.
    expect(() => parsePath("$['a','b']")).toThrow(/Unsupported selector \['a','b'\]/);
    expect(() => parsePath('$["a", "b"]')).toThrow(/Unsupported/);
    expect(() => parsePath('$[0,1]')).toThrow(/Unsupported/);
  });

  it('reads escaped quotes inside a quoted key', () => {
    const quoted = { "it's": 1, 'say "hi"': 2, 'a,b': 3 };
    expect(query(quoted, "$['it\\'s']")).toEqual([1]);
    expect(query(quoted, '$["say \\"hi\\""]')).toEqual([2]);
    expect(query(quoted, '$["it\'s"]')).toEqual([1]);
    expect(query(quoted, "$['a,b']")).toEqual([3]);
  });
});
