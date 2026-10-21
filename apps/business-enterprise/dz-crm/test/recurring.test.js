import { describe, it, expect } from 'vitest';
import {
  BILLING_MODES, DEFAULT_TERM, MAX_TERM, normalizeBilling, normalizeTerm, isRecurring,
  termOf, mrrOf, arrOf, contractValue, billingSpread, billedInMonth,
  contractCoversMonth, recurringSummary, pipelineMRR,
  billingLabel, rateText, termText, contractText,
} from '../src/lib/recurring.js';

const deal = (overrides = {}) => ({
  id: 'd1', name: 'Test deal', value: 2000, stage: 'proposal', ...overrides,
});

const monthsAgo = (n) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d.getTime();
};

describe('billing modes', () => {
  it('offers exactly one-time, monthly, and annual', () => {
    expect(BILLING_MODES.map((m) => m.value)).toEqual(['one-time', 'monthly', 'annual']);
  });

  it('normalizes anything unrecognized to one-time', () => {
    expect(normalizeBilling('monthly')).toBe('monthly');
    expect(normalizeBilling('annual')).toBe('annual');
    expect(normalizeBilling(undefined)).toBe('one-time');
    expect(normalizeBilling(null)).toBe('one-time');
    expect(normalizeBilling('quarterly')).toBe('one-time');
    expect(normalizeBilling(12)).toBe('one-time');
  });

  it('reads a deal with no billing field as one-time', () => {
    expect(isRecurring(deal())).toBe(false);
    expect(isRecurring(deal({ billing: 'monthly' }))).toBe(true);
    expect(isRecurring(deal({ billing: 'annual' }))).toBe(true);
  });
});

describe('term', () => {
  it('is null for a one-time deal', () => {
    expect(normalizeTerm(12, 'one-time')).toBe(null);
    expect(termOf(deal())).toBe(1);
  });

  it('defaults to a year and clamps to sane bounds', () => {
    expect(normalizeTerm(undefined, 'monthly')).toBe(DEFAULT_TERM);
    expect(normalizeTerm('', 'monthly')).toBe(DEFAULT_TERM);
    expect(normalizeTerm('abc', 'monthly')).toBe(DEFAULT_TERM);
    expect(normalizeTerm(0, 'monthly')).toBe(1);
    expect(normalizeTerm(-4, 'monthly')).toBe(1);
    expect(normalizeTerm(999, 'monthly')).toBe(MAX_TERM);
    expect(normalizeTerm('6', 'monthly')).toBe(6);
    expect(normalizeTerm(6.4, 'monthly')).toBe(6);
  });
});

describe('rates', () => {
  it('reads MRR and ARR off the billing mode', () => {
    expect(mrrOf(deal({ billing: 'monthly' }))).toBe(2000);
    expect(arrOf(deal({ billing: 'monthly' }))).toBe(24000);
    expect(mrrOf(deal({ billing: 'annual', value: 24000 }))).toBe(2000);
    expect(arrOf(deal({ billing: 'annual', value: 24000 }))).toBe(24000);
  });

  it('is zero for a one-time deal', () => {
    expect(mrrOf(deal())).toBe(0);
    expect(arrOf(deal())).toBe(0);
  });
});

describe('contractValue', () => {
  it('is the deal value itself for a one-time deal', () => {
    expect(contractValue(deal({ value: 12500 }))).toBe(12500);
    expect(contractValue(deal({ value: 'nonsense' }))).toBe(0);
  });

  it('multiplies a monthly rate by the term', () => {
    expect(contractValue(deal({ billing: 'monthly', term: 12 }))).toBe(24000);
    expect(contractValue(deal({ billing: 'monthly', term: 6 }))).toBe(12000);
  });

  it('takes an annual rate as a year at a time', () => {
    expect(contractValue(deal({ billing: 'annual', value: 24000, term: 12 }))).toBe(24000);
    expect(contractValue(deal({ billing: 'annual', value: 24000, term: 24 }))).toBe(48000);
    expect(contractValue(deal({ billing: 'annual', value: 24000, term: 18 }))).toBe(36000);
  });

  it('assumes a year when a recurring deal names no term', () => {
    expect(contractValue(deal({ billing: 'monthly' }))).toBe(24000);
  });
});

describe('billingSpread', () => {
  it('puts a one-time deal in one month', () => {
    expect(billingSpread(deal({ value: 5000 }), '2026-08'))
      .toEqual([{ key: '2026-08', amount: 5000 }]);
  });

  it('bills a monthly deal every month of its term', () => {
    const spread = billingSpread(deal({ billing: 'monthly', term: 3 }), '2026-11');
    expect(spread).toEqual([
      { key: '2026-11', amount: 2000 },
      { key: '2026-12', amount: 2000 },
      { key: '2027-01', amount: 2000 },
    ]);
  });

  it('bills an annual deal once a year, prorating a part-year tail', () => {
    expect(billingSpread(deal({ billing: 'annual', value: 12000, term: 24 }), '2026-01'))
      .toEqual([
        { key: '2026-01', amount: 12000 },
        { key: '2027-01', amount: 12000 },
      ]);
    expect(billingSpread(deal({ billing: 'annual', value: 12000, term: 18 }), '2026-01'))
      .toEqual([
        { key: '2026-01', amount: 12000 },
        { key: '2027-01', amount: 6000 },
      ]);
  });

  it('sums to the contract value', () => {
    for (const d of [
      deal({ value: 5000 }),
      deal({ billing: 'monthly', term: 7 }),
      deal({ billing: 'annual', value: 9000, term: 30 }),
    ]) {
      const total = billingSpread(d, '2026-03').reduce((n, e) => n + e.amount, 0);
      expect(total).toBeCloseTo(contractValue(d), 2);
    }
  });

  it('reports what a single month bills', () => {
    const d = deal({ billing: 'monthly', term: 3 });
    expect(billedInMonth(d, '2026-11', '2026-12')).toBe(2000);
    expect(billedInMonth(d, '2026-11', '2027-02')).toBe(0);
  });
});

describe('committed recurring revenue', () => {
  it('counts won contracts still inside their term', () => {
    const deals = [
      deal({ stage: 'won', billing: 'monthly', value: 2000, term: 12, closedAt: monthsAgo(2) }),
      deal({ stage: 'won', billing: 'annual', value: 12000, term: 12, closedAt: monthsAgo(1) }),
    ];
    const summary = recurringSummary(deals);
    expect(summary.count).toBe(2);
    expect(summary.mrr).toBe(3000);
    expect(summary.arr).toBe(36000);
  });

  it('drops a contract whose term has run out', () => {
    const deals = [
      deal({ stage: 'won', billing: 'monthly', value: 2000, term: 6, closedAt: monthsAgo(9) }),
    ];
    expect(recurringSummary(deals)).toEqual({ mrr: 0, arr: 0, count: 0 });
  });

  it('ignores one-time and open deals', () => {
    const deals = [
      deal({ stage: 'won', value: 50000, closedAt: Date.now() }),
      deal({ stage: 'proposal', billing: 'monthly', value: 4000, term: 12 }),
    ];
    expect(recurringSummary(deals).count).toBe(0);
    expect(contractCoversMonth(deals[0])).toBe(false);
  });

  it('reports the recurring revenue still in play separately', () => {
    const deals = [
      deal({ stage: 'proposal', billing: 'monthly', value: 4000, term: 12 }),
      deal({ stage: 'lost', billing: 'monthly', value: 9000, term: 12 }),
      deal({ stage: 'new', value: 8000 }),
    ];
    expect(pipelineMRR(deals)).toEqual({ mrr: 4000, count: 1 });
  });
});

describe('words for the numbers', () => {
  it('names the billing mode', () => {
    expect(billingLabel(deal())).toBe('One-time');
    expect(billingLabel(deal({ billing: 'monthly' }))).toBe('Monthly');
    expect(billingLabel(deal({ billing: 'annual' }))).toBe('Annual');
  });

  it('suffixes a rate only when the deal recurs', () => {
    expect(rateText(deal({ value: 5000 }), 'USD')).toBe('$5,000');
    expect(rateText(deal({ billing: 'monthly' }), 'USD')).toBe('$2,000/mo');
    expect(rateText(deal({ billing: 'annual', value: 24000 }), 'USD')).toBe('$24,000/yr');
  });

  it('spells the contract out, and says nothing for a one-time deal', () => {
    expect(termText(deal())).toBe(null);
    expect(contractText(deal(), 'USD')).toBe(null);
    expect(termText(deal({ billing: 'monthly', term: 1 }))).toBe('1 month');
    expect(contractText(deal({ billing: 'monthly', term: 12 }), 'USD'))
      .toBe('$24,000 over 12 months');
  });
});
