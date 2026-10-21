import { describe, it, expect } from 'vitest';
import { rankMatch, rankFields, searchRank } from '../src/lib/search.js';

describe('rankMatch', () => {
  it('ranks prefix over word-start over substring', () => {
    expect(rankMatch('Wireless Mouse', 'wire')).toBe(3);
    expect(rankMatch('Wireless Mouse', 'mou')).toBe(2);
    expect(rankMatch('Wireless Mouse', 'ous')).toBe(1);
    expect(rankMatch('Wireless Mouse', 'usb')).toBe(0);
  });

  it('sees through case and accents, and hyphenated word starts', () => {
    expect(rankMatch('Café Beans', 'cafe')).toBe(3);
    expect(rankMatch('USB-C Cable', 'c cable')).toBe(2); // '-' starts a word
    expect(rankMatch('USB-C Cable', 'sb')).toBe(1);
    expect(rankMatch('WM-M310', 'm310')).toBe(2);
    expect(rankMatch('', 'x')).toBe(0);
    expect(rankMatch('x', '')).toBe(0);
  });
});

describe('rankFields / searchRank', () => {
  const items = [
    { name: 'USB-C Cable 2m', sku: 'CB-UC2M' },
    { name: 'Wireless Mouse', sku: 'WM-M310' },
    { name: 'Mouse Pad XL', sku: 'PD-XL' },
  ];

  it('takes the best field', () => {
    expect(rankFields(['Mouse Pad', 'PD-1'], 'pd')).toBe(3);
    expect(rankFields(['Mouse Pad', ''], 'nope')).toBe(0);
  });

  it('orders by rank, keeps input order within ties, and caps results', () => {
    const hits = searchRank(items, 'mouse', (x) => [x.name, x.sku]);
    expect(hits.map((x) => x.name)).toEqual(['Mouse Pad XL', 'Wireless Mouse']);
    expect(searchRank(items, 'mouse', (x) => [x.name], { limit: 1 })).toHaveLength(1);
    expect(searchRank(items, '', (x) => [x.name])).toEqual([]);
    expect(searchRank(items, 'zzz', (x) => [x.name])).toEqual([]);
  });
});
