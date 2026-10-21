import { describe, it, expect } from 'vitest';
import {
  filterActivity, groupByDay, dayLabel, dayKey, monthKey, monthLabel,
  dayStart, dayEnd, mergeEntries, activityLabel, kindLabel, kindIcon,
} from '../src/lib/activity.js';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const e = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  at: at(2026, 8, 4), kind: 'add', productId: 'p1', name: 'Mouse',
  delta: 5, quantity: 10, note: '', ...over,
});

describe('date keys', () => {
  it('uses local time, not UTC', () => {
    expect(dayKey(at(2026, 1, 2, 23, 30))).toBe('2026-01-02');
    expect(monthKey(at(2026, 1, 2, 0, 15))).toBe('2026-01');
  });

  it('bounds a local day inclusively', () => {
    expect(dayStart('2026-08-04')).toBe(at(2026, 8, 4, 0, 0));
    expect(dayEnd('2026-08-04')).toBe(at(2026, 8, 4, 0, 0) + 86400000 - 1);
    expect(dayStart('')).toBeNull();
    expect(dayEnd('nonsense')).toBeNull();
  });

  it('ends a day the moment before the next begins, even across DST', () => {
    // 2026-03-08 and 2026-11-01 are US transition days (23 and 25 hours
    // long); whatever the zone, adjacent days must tile exactly.
    for (const [day, next] of [
      ['2026-03-08', '2026-03-09'],
      ['2026-11-01', '2026-11-02'],
      ['2026-08-04', '2026-08-05'],
    ]) {
      expect(dayEnd(day) + 1).toBe(dayStart(next));
    }
  });

  it('labels months readably and passes junk through', () => {
    expect(monthLabel('2026-08')).toMatch(/2026/);
    expect(monthLabel('junk')).toBe('junk');
  });
});

describe('filterActivity', () => {
  const entries = [
    e({ id: '1', kind: 'add', name: 'Mouse', at: at(2026, 8, 4) }),
    e({ id: '2', kind: 'remove', name: 'Keyboard', productId: 'p2', at: at(2026, 8, 3), note: 'Sold at market' }),
    e({ id: '3', kind: 'recount', name: 'Café Beans', productId: 'p3', at: at(2026, 7, 20) }),
  ];

  it('passes everything with no filters', () => {
    expect(filterActivity(entries, {})).toHaveLength(3);
    expect(filterActivity(entries)).toHaveLength(3);
  });

  it('filters by kind and product', () => {
    expect(filterActivity(entries, { kind: 'remove' }).map((x) => x.id)).toEqual(['2']);
    expect(filterActivity(entries, { productId: 'p3' }).map((x) => x.id)).toEqual(['3']);
  });

  it('matches names and notes case- and accent-insensitively', () => {
    expect(filterActivity(entries, { query: 'cafe' }).map((x) => x.id)).toEqual(['3']);
    expect(filterActivity(entries, { query: 'MARKET' }).map((x) => x.id)).toEqual(['2']);
    expect(filterActivity(entries, { query: 'nothing' })).toEqual([]);
  });

  it('bounds an inclusive date range on local days', () => {
    expect(filterActivity(entries, { from: '2026-08-03' }).map((x) => x.id)).toEqual(['1', '2']);
    expect(filterActivity(entries, { to: '2026-08-03' }).map((x) => x.id)).toEqual(['2', '3']);
    expect(filterActivity(entries, { from: '2026-08-03', to: '2026-08-03' }).map((x) => x.id)).toEqual(['2']);
  });

  it('includes entries at the very edges of the range', () => {
    const edges = [e({ id: 'a', at: at(2026, 8, 4, 0, 0) }), e({ id: 'b', at: at(2026, 8, 4, 23, 59) })];
    expect(filterActivity(edges, { from: '2026-08-04', to: '2026-08-04' })).toHaveLength(2);
  });

  it('filters removals by reason, with unspecified for pre-reason entries', () => {
    const mixed = [
      e({ id: 's', kind: 'remove', reason: 'sold' }),
      e({ id: 'd', kind: 'remove', reason: 'damaged' }),
      e({ id: 'u', kind: 'remove' }),
      e({ id: 'a', kind: 'add' }),
    ];
    expect(filterActivity(mixed, { reason: 'damaged' }).map((x) => x.id)).toEqual(['d']);
    expect(filterActivity(mixed, { reason: 'unspecified' }).map((x) => x.id)).toEqual(['u']);
    // A reason implies removals: adds never match, whatever the kind filter.
    expect(filterActivity(mixed, { kind: 'add', reason: 'sold' })).toEqual([]);
    expect(filterActivity(mixed, { reason: '' })).toHaveLength(4);
  });
});

describe('groupByDay', () => {
  it('groups in order and sums the day’s ins and outs', () => {
    const days = groupByDay([
      e({ at: at(2026, 8, 4, 16), delta: 5 }),
      e({ at: at(2026, 8, 4, 9), delta: -2 }),
      e({ at: at(2026, 8, 3, 11), delta: 7 }),
      e({ at: at(2026, 8, 3, 10), delta: null, kind: 'create' }),
    ]);
    expect(days.map((d) => d.key)).toEqual(['2026-08-04', '2026-08-03']);
    expect(days[0]).toMatchObject({ net: 3, in: 5, out: 2 });
    expect(days[1]).toMatchObject({ net: 7, in: 7, out: 0 });
    expect(days[1].entries).toHaveLength(2);
  });

  it('is empty for no entries', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('dayLabel', () => {
  const now = at(2026, 8, 4, 15);
  it('names today and yesterday', () => {
    expect(dayLabel(at(2026, 8, 4, 2), now)).toBe('Today');
    expect(dayLabel(at(2026, 8, 3, 23), now)).toBe('Yesterday');
  });
  it('spells out older days, with the year only when it differs', () => {
    expect(dayLabel(at(2026, 7, 1), now)).not.toMatch(/2026/);
    expect(dayLabel(at(2025, 7, 1), now)).toMatch(/2025/);
  });

  /* Just after midnight on the day following a 23-hour DST day,
     now − 24h lands two days back; yesterday is a calendar step. */
  it('still says Yesterday in the first hour after a spring-forward day', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York'; // DST began March 8, 2026
    try {
      expect(dayLabel(at(2026, 3, 8, 20), at(2026, 3, 9, 0, 30))).toBe('Yesterday');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe('mergeEntries', () => {
  it('merges newest-first and drops duplicate ids', () => {
    const a = [e({ id: 'x', at: 3 }), e({ id: 'y', at: 1 })];
    const b = [e({ id: 'y', at: 1 }), e({ id: 'z', at: 2 })];
    expect(mergeEntries(a, b).map((x) => x.id)).toEqual(['x', 'z', 'y']);
    expect(mergeEntries(a, null, undefined)).toHaveLength(2);
  });
});

describe('labels', () => {
  it('describes each kind', () => {
    expect(activityLabel(e({ kind: 'add', quantity: 12 }))).toBe('Received, now 12 units on hand');
    expect(activityLabel(e({ kind: 'remove', quantity: 1 }))).toBe('Removed, now 1 unit on hand');
    expect(activityLabel(e({ kind: 'remove', quantity: 1, reason: 'sold' }))).toBe('Sold, now 1 unit on hand');
    expect(activityLabel(e({ kind: 'remove', quantity: 2, reason: 'internal' }))).toBe('Used internally, now 2 units on hand');
    expect(activityLabel(e({ kind: 'remove', quantity: 2, reason: 'other' }))).toBe('Removed, now 2 units on hand');
    expect(activityLabel(e({ kind: 'recount', quantity: 8 }))).toBe('Recounted to 8 units');
    expect(activityLabel(e({ kind: 'add', quantity: 2.5, unit: 'kg' }))).toBe('Received, now 2.5 kg on hand');
    expect(activityLabel(e({ kind: 'create' }))).toBe('Product added');
    expect(activityLabel(e({ kind: 'delete' }))).toBe('Product deleted');
    expect(activityLabel(e({ kind: 'import' }))).toBe('CSV import');
  });

  it('reads a group archive, restore, or delete as the group action it was', () => {
    // The bulk paths name no single product: "3 products archived" must
    // not be described as "Product archived".
    for (const [kind, label] of [
      ['archive', 'Archived together'],
      ['restore', 'Restored together'],
      ['delete', 'Deleted together'],
    ]) {
      expect(activityLabel(e({ kind, productId: null, name: '3 products' }))).toBe(label);
      expect(activityLabel(e({ kind, productId: undefined }))).toBe(label);
    }
  });

  it('totals only counted units in a day header', () => {
    const [day] = groupByDay([
      e({ delta: 5 }),
      e({ delta: 2.5, unit: 'kg' }),
      e({ delta: -3 }),
    ]);
    expect(day).toMatchObject({ in: 5, out: 3, net: 2 });
    expect(day.entries).toHaveLength(3);
  });

  it('falls back for unknown kinds', () => {
    expect(kindLabel('mystery')).toBe('Activity');
    expect(kindIcon('mystery')).toBe('history');
    expect(activityLabel(e({ kind: 'mystery' }))).toBe('Activity');
  });
});
