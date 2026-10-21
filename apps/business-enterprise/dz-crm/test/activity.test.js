import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_WINDOWS, weekStartISO, weekRange, weekElapsed, matchesActivityWindow,
  normalizeTouchTargets, typeTargets, touchTarget, hasTouchTarget, touchProgress,
} from '../src/lib/activity.js';

const act = (date, type = 'call') => ({ id: date + type, date, type, summary: 's' });

describe('the sales week', () => {
  it('starts on Monday', () => {
    // 2026-08-20 is a Thursday.
    expect(weekStartISO('2026-08-20')).toBe('2026-08-17');
    expect(weekStartISO('2026-08-17')).toBe('2026-08-17');
    // Sunday closes the week it belongs to rather than opening the next.
    expect(weekStartISO('2026-08-23')).toBe('2026-08-17');
    expect(weekRange('2026-08-20')).toEqual({ from: '2026-08-17', to: '2026-08-23' });
  });

  it('counts today as a whole day of selling', () => {
    expect(weekElapsed('2026-08-17')).toBeCloseTo(1 / 7, 5);   // Monday
    expect(weekElapsed('2026-08-20')).toBeCloseTo(4 / 7, 5);   // Thursday
    expect(weekElapsed('2026-08-23')).toBe(1);                 // Sunday
  });
});

describe('windows', () => {
  const today = '2026-08-20';

  it('offers the four the log needs', () => {
    expect(ACTIVITY_WINDOWS.map((w) => w.value)).toEqual(['week', '30', 'month', 'all']);
  });

  it('sorts activities into them', () => {
    expect(matchesActivityWindow(act('2026-08-18'), 'week', today)).toBe(true);
    expect(matchesActivityWindow(act('2026-08-16'), 'week', today)).toBe(false);
    expect(matchesActivityWindow(act('2026-08-01'), 'month', today)).toBe(true);
    expect(matchesActivityWindow(act('2026-07-31'), 'month', today)).toBe(false);
    expect(matchesActivityWindow(act('2026-07-23'), '30', today)).toBe(true);
    expect(matchesActivityWindow(act('2026-07-21'), '30', today)).toBe(false);
    expect(matchesActivityWindow(act('2020-01-01'), 'all', today)).toBe(true);
    expect(matchesActivityWindow({ date: '' }, 'all', today)).toBe(false);
  });
});

describe('touch targets', () => {
  it('shapes anything into whole counts', () => {
    expect(normalizeTouchTargets(null))
      .toEqual({ all: 0, meeting: 0, call: 0, email: 0, note: 0 });
    expect(normalizeTouchTargets({ all: '12', call: 4.6, email: -3, note: 'lots' }))
      .toEqual({ all: 12, meeting: 0, call: 5, email: 0, note: 0 });
    expect(normalizeTouchTargets({ all: 9999 }).all).toBe(999);
  });

  it('adds the per-type targets up when no overall one is set', () => {
    expect(touchTarget({ call: 8, meeting: 3 })).toBe(11);
    expect(touchTarget({ all: 15, call: 8, meeting: 3 })).toBe(15);
    expect(touchTarget(null)).toBe(0);
    expect(hasTouchTarget({ call: 1 })).toBe(true);
    expect(hasTouchTarget({})).toBe(false);
  });

  it('lists only the types with a target, in the app’s own order', () => {
    expect(typeTargets({ call: 8, meeting: 3 })).toEqual([
      { type: 'meeting', label: 'Meeting', target: 3 },
      { type: 'call', label: 'Call', target: 8 },
    ]);
  });
});

describe('touchProgress', () => {
  const thursday = '2026-08-20';
  const activities = [
    act('2026-08-17', 'call'), act('2026-08-18', 'call'), act('2026-08-19', 'meeting'),
    act('2026-08-16', 'call'),                    // last week
    act('2026-08-24', 'call'),                    // next week
  ];

  it('counts only this week', () => {
    const p = touchProgress(activities, { all: 10 }, thursday);
    expect(p.logged).toBe(3);
    expect(p).toMatchObject({ target: 10, remaining: 7, from: '2026-08-17', to: '2026-08-23' });
  });

  it('paces against the day of the week', () => {
    // Thursday is 4/7 of the week: 10 × 4/7 ≈ 5.71 expected.
    const behind = touchProgress(activities, { all: 10 }, thursday);
    expect(behind.pace).toBe('behind');
    expect(behind.gap).toBe(3);

    const onTrack = touchProgress(activities, { all: 5 }, thursday);
    expect(onTrack.pace).toBe('on-track');
    expect(onTrack.gap).toBe(0);

    const met = touchProgress(activities, { all: 3 }, thursday);
    expect(met.pace).toBe('met');
  });

  it('is inert with no target, but still counts', () => {
    const p = touchProgress(activities, null, thursday);
    expect(p).toMatchObject({ target: 0, pace: null, pct: null });
    expect(p.logged).toBe(3);
  });

  it('breaks the week down by type where a type has a target', () => {
    const p = touchProgress(activities, { call: 8, meeting: 3 }, thursday);
    expect(p.target).toBe(11);
    expect(p.byType).toEqual([
      { type: 'meeting', label: 'Meeting', target: 3, logged: 1, pct: 1 / 3 },
      { type: 'call', label: 'Call', target: 8, logged: 2, pct: 0.25 },
    ]);
  });
});
