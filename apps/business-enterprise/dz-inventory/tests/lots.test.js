import { describe, it, expect } from 'vitest';
import {
  normalizeLots, lotsTotal, addLot, consumeLots, consumeLotAt, resizeLots,
  lotsAt, allLots, expiryStatus, expiringProducts, isExpiring, lotDateLabel, dayStampIn,
} from '../src/lib/lots.js';

const now = new Date(2026, 7, 4, 12).getTime(); // Aug 4, 2026

describe('normalizeLots', () => {
  it('merges same dates, drops junk, sorts FEFO with no-date last', () => {
    const lots = normalizeLots([
      { date: '2026-09-01', qty: 2 },
      { date: '', qty: 3 },
      { date: '2026-08-10', qty: 1 },
      { date: '2026-09-01', qty: 4 },
      { date: 'not-a-date', qty: 2 },
      { date: '2026-01-01', qty: 0 },
      { date: '2026-01-01', qty: -5 },
    ]);
    expect(lots).toEqual([
      { date: '2026-08-10', qty: 1 },
      { date: '2026-09-01', qty: 6 },
      { date: '', qty: 5 }, // unparseable dates fold into "no date"
    ]);
    expect(lotsTotal(lots)).toBe(12);
  });
});

describe('consuming', () => {
  const lots = [
    { date: '2026-08-10', qty: 2 },
    { date: '2026-09-01', qty: 5 },
    { date: '', qty: 3 },
  ];

  it('takes earliest-dated stock first, keeping the taken dates', () => {
    const { lots: rest, taken } = consumeLots(lots, 4);
    expect(rest).toEqual([{ date: '2026-09-01', qty: 3 }, { date: '', qty: 3 }]);
    expect(taken).toEqual([{ date: '2026-08-10', qty: 2 }, { date: '2026-09-01', qty: 2 }]);
  });

  it('taking more than there is takes what there is', () => {
    const { lots: rest, taken } = consumeLots(lots, 99);
    expect(rest).toEqual([]);
    expect(lotsTotal(taken)).toBe(10);
  });

  it('takes from a named lot first, spilling FEFO only when it runs out', () => {
    const hit = consumeLotAt(lots, '2026-09-01', 3);
    expect(hit.lots).toEqual([
      { date: '2026-08-10', qty: 2 },
      { date: '2026-09-01', qty: 2 },
      { date: '', qty: 3 },
    ]);
    const spill = consumeLotAt(lots, '2026-09-01', 6);
    expect(spill.lots).toEqual([{ date: '2026-08-10', qty: 1 }, { date: '', qty: 3 }]);
    // An unknown lot falls back to plain FEFO.
    expect(consumeLotAt(lots, '2030-01-01', 2).lots[0]).toEqual({ date: '2026-09-01', qty: 5 });
  });

  it('handles measured decimals without float crumbs', () => {
    const { lots: rest } = consumeLots([{ date: '', qty: 0.3 }], 0.1);
    expect(rest).toEqual([{ date: '', qty: 0.2 }]);
  });
});

describe('resizeLots', () => {
  const lots = [{ date: '2026-08-10', qty: 2 }, { date: '', qty: 3 }];

  it('grows with undated stock and shrinks FEFO', () => {
    expect(resizeLots(lots, 8)).toEqual([{ date: '2026-08-10', qty: 2 }, { date: '', qty: 6 }]);
    expect(resizeLots(lots, 4)).toEqual([{ date: '2026-08-10', qty: 1 }, { date: '', qty: 3 }]);
    expect(resizeLots(lots, 0)).toEqual([]);
    expect(resizeLots([], 5)).toEqual([{ date: '', qty: 5 }]);
  });
});

describe('expiry status', () => {
  const tracked = {
    trackExpiry: true,
    cost: 2,
    lots: {
      main: [{ date: '2026-08-01', qty: 2 }, { date: '2026-08-20', qty: 3 }],
      shop: [{ date: '2026-12-01', qty: 4 }, { date: '', qty: 5 }],
    },
  };

  it('splits expired from expiring-soon across every location', () => {
    const status = expiryStatus(tracked, { days: 30, now });
    expect(status).toEqual({ expired: 2, soon: 3, soonest: '2026-08-01' });
    expect(expiryStatus({ trackExpiry: false }, { now })).toBeNull();
  });

  it('reads per-location and merged lots', () => {
    expect(lotsAt(tracked, 'main')).toHaveLength(2);
    expect(lotsAt(tracked, 'nowhere')).toEqual([]);
    expect(allLots(tracked).map((l) => l.date)).toEqual(['2026-08-01', '2026-08-20', '2026-12-01', '']);
  });

  it('lists expiring products worst first, valued at cost', () => {
    const fine = { trackExpiry: true, cost: 9, lots: { main: [{ date: '2027-01-01', qty: 9 }] } };
    const rows = expiringProducts([tracked, fine, { archived: true, trackExpiry: true, lots: tracked.lots }], { days: 30, now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ expired: 2, soon: 3, value: 10 });
    expect(isExpiring(tracked, { now })).toBe(true);
    expect(isExpiring(fine, { now })).toBe(false);
  });

  it('ranks expired stock first, then by the money at stake', () => {
    const cheapPile = { name: 'cheap', trackExpiry: true, cost: 0.1, lots: { m: [{ date: '2026-08-01', qty: 100 }] } };
    const pricyFew = { name: 'pricy', trackExpiry: true, cost: 500, lots: { m: [{ date: '2026-08-02', qty: 2 }] } };
    const dueSoon = { name: 'soon', trackExpiry: true, cost: 900, lots: { m: [{ date: '2026-08-20', qty: 4 }] } };
    const rows = expiringProducts([cheapPile, dueSoon, pricyFew], { days: 30, now });
    // Both expired ones outrank the merely-due one, however valuable it
    // is, and the £1,000 loss outranks the £10 one.
    expect(rows.map((r) => r.product.name)).toEqual(['pricy', 'cheap', 'soon']);
  });
});

describe('dayStampIn', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    // Berlin's clocks go back on Oct 25, 2026: the 30 days from Oct 20
    // are 30 × 24h + 1, so millisecond arithmetic named Nov 18 and every
    // lot dated Nov 19 dropped out of the expiring-soon window.
    const before = new Date(2026, 9, 20, 0, 30).getTime();
    expect(dayStampIn(30, before)).toBe('2026-11-19');
    expect(dayStampIn(0, before)).toBe('2026-10-20');
    expect(dayStampIn(1, new Date(2026, 11, 31, 23).getTime())).toBe('2027-01-01');
  });
});

describe('lotDateLabel', () => {
  it('reads as a short date, with the year only when it differs', () => {
    expect(lotDateLabel('', now)).toBe('No date');
    expect(lotDateLabel('2026-09-04', now)).not.toMatch(/2026/);
    expect(lotDateLabel('2027-09-04', now)).toMatch(/2027/);
  });
});
