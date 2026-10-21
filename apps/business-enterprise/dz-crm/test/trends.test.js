import { describe, it, expect } from 'vitest';
import { monthSpan, monthlyFlows, winRateTrend, salesCycleTrend } from '../src/lib/trends.js';

/** Timestamp inside a given month, day 15 to dodge timezone edges. */
const ts = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 15).getTime();
};

const DAY = 86400000;

describe('monthSpan', () => {
  it('is the last N months ending at `to`, oldest first', () => {
    expect(monthSpan(3, '2026-08')).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(monthSpan(2, '2026-01')).toEqual(['2025-12', '2026-01']);
  });
});

describe('monthlyFlows', () => {
  const deals = [
    // Created in June, still open: added only.
    { stage: 'proposal', value: 1000, createdAt: ts('2026-06'), closedAt: null },
    // Created in June, won in July: added in June, won in July.
    { stage: 'won', value: 2000, createdAt: ts('2026-06'), closedAt: ts('2026-07') },
    // Created and lost inside July.
    { stage: 'lost', value: 500, createdAt: ts('2026-07'), closedAt: ts('2026-07') },
    // Ancient history: outside the window entirely.
    { stage: 'won', value: 9999, createdAt: ts('2024-01'), closedAt: ts('2024-02') },
  ];

  it('buckets added by created month and won/lost by close month', () => {
    const flows = monthlyFlows(deals, { months: 3, to: '2026-08' });
    const [jun, jul, aug] = flows;
    expect(jun).toEqual({ key: '2026-06', added: { count: 2, value: 3000 }, won: { count: 0, value: 0 }, lost: { count: 0, value: 0 } });
    expect(jul.added).toEqual({ count: 1, value: 500 });
    expect(jul.won).toEqual({ count: 1, value: 2000 });
    expect(jul.lost).toEqual({ count: 1, value: 500 });
    expect(aug.added.count).toBe(0);
  });

  it('counts a subscription at its whole contract, like every other figure', () => {
    // A $3k/mo deal on a 6-month term added $18k of pipeline and won $18k -
    // the number the tiles and the month-by-month table already show.
    const flows = monthlyFlows([{
      stage: 'won', value: 3000, billing: 'monthly', term: 6,
      createdAt: ts('2026-06'), closedAt: ts('2026-07'),
    }], { months: 3, to: '2026-08' });
    const [jun, jul] = flows;
    expect(jun.added).toEqual({ count: 1, value: 18000 });
    expect(jul.won).toEqual({ count: 1, value: 18000 });
  });

  it('ignores junk timestamps instead of throwing', () => {
    const flows = monthlyFlows([{ stage: 'won', value: 1, createdAt: 'nope', closedAt: null }], { months: 2, to: '2026-08' });
    expect(flows.every((r) => r.added.count === 0 && r.won.count === 0)).toBe(true);
  });
});

describe('winRateTrend', () => {
  it('rates each close month and leaves quiet months null', () => {
    const flows = monthlyFlows([
      { stage: 'won', value: 1, createdAt: ts('2026-07'), closedAt: ts('2026-07') },
      { stage: 'lost', value: 1, createdAt: ts('2026-07'), closedAt: ts('2026-07') },
      { stage: 'lost', value: 1, createdAt: ts('2026-07'), closedAt: ts('2026-07') },
      { stage: 'won', value: 1, createdAt: ts('2026-08'), closedAt: ts('2026-08') },
    ], { months: 3, to: '2026-08' });
    const trend = winRateTrend(flows);
    expect(trend[0]).toEqual({ key: '2026-06', rate: null, closed: 0 });
    expect(trend[1].rate).toBeCloseTo(1 / 3);
    expect(trend[2].rate).toBe(1);
  });
});

describe('salesCycleTrend', () => {
  it('averages created→closed days for deals won in each month', () => {
    const closed = ts('2026-08');
    const trend = salesCycleTrend([
      { stage: 'won', createdAt: closed - 10 * DAY, closedAt: closed },
      { stage: 'won', createdAt: closed - 30 * DAY, closedAt: closed },
      // Lost deals don't set the pace of winning.
      { stage: 'lost', createdAt: closed - 90 * DAY, closedAt: closed },
    ], { months: 2, to: '2026-08' });
    expect(trend[0]).toEqual({ key: '2026-07', days: null, count: 0 });
    expect(trend[1]).toEqual({ key: '2026-08', days: 20, count: 2 });
  });
});
