import { describe, it, expect } from 'vitest';
import { goingCold, noNextStep, noDecisionMaker, DEFAULT_COLD_DAYS } from '../src/lib/attention.js';

const today = '2026-08-20';
const daysAgoTs = (n) => new Date(2026, 7, 20 - n).getTime();

const contact = (over = {}) => ({
  id: 'c1', name: 'Mei', status: 'lead', createdAt: daysAgoTs(90), ...over,
});
const deal = (over = {}) => ({
  id: 'd1', name: 'Deal', value: 1000, stage: 'proposal', contactId: null,
  createdAt: daysAgoTs(90), ...over,
});

describe('goingCold', () => {
  it('flags chaseable leads past the threshold, coldest first', () => {
    const rows = goingCold([
      contact({ id: 'warm', name: 'Warm' }),
      contact({ id: 'cool', name: 'Cool' }),
      contact({ id: 'ice', name: 'Ice' }),
    ], (id) => ({ warm: '2026-08-18', cool: '2026-08-01', ice: '2026-06-01' })[id], { today });

    expect(rows.map((r) => r.contact.id)).toEqual(['ice', 'cool']);
    expect(rows[0].days).toBe(80);
    expect(rows[1]).toMatchObject({ lastAt: '2026-08-01', days: 19 });
  });

  it('leaves customers and lost leads alone', () => {
    const rows = goingCold([
      contact({ id: 'cust', status: 'customer' }),
      contact({ id: 'gone', status: 'lost' }),
      contact({ id: 'live', status: 'active' }),
    ], () => null, { today });
    expect(rows.map((r) => r.contact.id)).toEqual(['live']);
  });

  it('counts never-contacted leads from when they were added', () => {
    const fresh = contact({ id: 'fresh', createdAt: daysAgoTs(2) });
    const old = contact({ id: 'old', createdAt: daysAgoTs(40) });
    const rows = goingCold([fresh, old], () => null, { today });
    expect(rows.map((r) => r.contact.id)).toEqual(['old']);
    expect(rows[0].lastAt).toBeNull();
  });

  it('honors the threshold, and 0 turns it off', () => {
    const c = [contact({ createdAt: daysAgoTs(20) })];
    expect(goingCold(c, () => null, { today, coldDays: 30 })).toEqual([]);
    expect(goingCold(c, () => null, { today, coldDays: 0 })).toEqual([]);
    expect(goingCold(c, () => null, { today, coldDays: DEFAULT_COLD_DAYS })).toHaveLength(1);
  });
});

describe('noNextStep', () => {
  const opts = (over = {}) => ({
    lastTouchOf: () => null, hasOpenTask: () => false, today, ...over,
  });

  it('flags open, quiet deals with no follow-up', () => {
    const rows = noNextStep([
      deal({ id: 'quiet' }),
      deal({ id: 'scheduled' }),
      deal({ id: 'closed', stage: 'won' }),
      deal({ id: 'recent' }),
    ], opts({
      hasOpenTask: (id) => id === 'scheduled',
      lastTouchOf: (d) => (d.id === 'recent' ? '2026-08-19' : null),
    }));
    expect(rows.map((r) => r.deal.id)).toEqual(['quiet']);
  });

  it('sorts by silence, then by value', () => {
    const rows = noNextStep([
      deal({ id: 'small', value: 100 }),
      deal({ id: 'big', value: 90000 }),
      deal({ id: 'oldest', value: 5 }),
    ], opts({
      lastTouchOf: (d) => (d.id === 'oldest' ? '2026-01-01' : '2026-07-01'),
    }));
    expect(rows.map((r) => r.deal.id)).toEqual(['oldest', 'big', 'small']);
  });

  it('is off at a zero threshold', () => {
    expect(noNextStep([deal()], opts({ coldDays: 0 }))).toEqual([]);
  });
});

describe('noDecisionMaker', () => {
  const withPeople = (id, ...roles) => deal({
    id, contacts: roles.map((role, i) => ({ contactId: `${id}-c${i}`, role })),
  });

  it('flags open deals where nobody signs, biggest first', () => {
    const rows = noDecisionMaker([
      withPeople('small', 'champion'),
      { ...withPeople('big', 'champion', 'influencer'), value: 90000 },
      withPeople('covered', 'decision-maker'),
      { ...withPeople('closed', 'champion'), stage: 'won' },
    ]);
    expect(rows.map((r) => r.deal.id)).toEqual(['big', 'small']);
  });

  it('counts a deal with nobody on it at all', () => {
    expect(noDecisionMaker([deal({ id: 'empty', contacts: [] })])).toHaveLength(1);
  });

  it('reads a recurring deal at its contract value when ranking', () => {
    const rows = noDecisionMaker([
      { ...withPeople('once', 'champion'), value: 20000 },
      { ...withPeople('sub', 'champion'), value: 2000, billing: 'monthly', term: 24 },
    ]);
    expect(rows.map((r) => r.deal.id)).toEqual(['sub', 'once']);
  });
});
