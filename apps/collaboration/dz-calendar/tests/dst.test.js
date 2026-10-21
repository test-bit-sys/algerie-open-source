/**
 * Clock changes (see dst.js): derived from the zone, never from a table, so
 * the checks here are the ones a table gets wrong — next year, another
 * hemisphere, a half-hour zone, a zone with no changes at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  transitionsInYear,
  getClockChangesInRange,
  describeShift,
  browserZone,
  clearClockChangeCache,
} from '../src/js/dst.js';

const utc = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const brief = (zone, year) =>
  transitionsInYear(zone, year).map((t) => `${utc(t.at)} ${t.before}→${t.after}`);

describe('transitionsInYear', () => {
  beforeEach(clearClockChangeCache);

  it('finds the US changes at the second Sunday of March and first of November', () => {
    // 2026: the two dates in the feature request…
    expect(brief('America/New_York', 2026)).toEqual([
      '2026-03-08T07:00:00Z -300→-240',
      '2026-11-01T06:00:00Z -240→-300',
    ]);
    // …and 2027, where those two dates would already be wrong.
    expect(brief('America/New_York', 2027)).toEqual([
      '2027-03-14T07:00:00Z -300→-240',
      '2027-11-07T06:00:00Z -240→-300',
    ]);
  });

  it('finds Europe’s on the last Sundays of March and October', () => {
    expect(brief('Europe/Berlin', 2026)).toEqual([
      '2026-03-29T01:00:00Z 60→120',
      '2026-10-25T01:00:00Z 120→60',
    ]);
    expect(brief('Europe/London', 2026)).toEqual([
      '2026-03-29T01:00:00Z 0→60',
      '2026-10-25T01:00:00Z 60→0',
    ]);
  });

  it('runs the other way round in the southern hemisphere', () => {
    // Sydney leaves DST in April and enters it in October.
    expect(brief('Australia/Sydney', 2026)).toEqual([
      '2026-04-04T16:00:00Z 660→600',
      '2026-10-03T16:00:00Z 600→660',
    ]);
  });

  it('copes with a half-hour change', () => {
    expect(brief('Australia/Lord_Howe', 2026)).toEqual([
      '2026-04-04T15:00:00Z 660→630',
      '2026-10-03T15:30:00Z 630→660',
    ]);
  });

  it('finds nothing where the clocks never move', () => {
    for (const zone of ['Asia/Tokyo', 'Asia/Kolkata', 'America/Phoenix', 'America/Regina', 'UTC']) {
      expect(transitionsInYear(zone, 2026), zone).toEqual([]);
    }
  });

  it('memoises a year, and hands the same frozen list back', () => {
    const a = transitionsInYear('Europe/Paris', 2026);
    expect(transitionsInYear('Europe/Paris', 2026)).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe('getClockChangesInRange', () => {
  let savedTZ;
  beforeEach(() => {
    savedTZ = process.env.TZ;
    process.env.TZ = 'America/New_York';
    clearClockChangeCache();
  });
  afterEach(() => {
    if (savedTZ === undefined) delete process.env.TZ;
    else process.env.TZ = savedTZ;
    clearClockChangeCache();
  });

  const local = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('puts one read-only all-day item on the local day of each change', () => {
    const items = getClockChangesInRange(
      'America/New_York',
      new Date(2026, 0, 1).getTime(),
      new Date(2027, 0, 1).getTime(),
    );
    expect(items.map((i) => [local(i.start), i.title])).toEqual([
      ['2026-03-08', 'Clocks go forward'],
      ['2026-11-01', 'Clocks go back'],
    ]);
    const [spring] = items;
    expect(spring).toMatchObject({
      id: 'dst:America/New_York:2026-03-08',
      dst: true,
      readOnly: true,
      allDay: true,
      before: -300,
      after: -240,
      zone: 'America/New_York',
    });
    // Local midnight to local midnight — the day the clocks move, all of it.
    expect(spring.start).toBe(new Date(2026, 2, 8).getTime());
    expect(spring.end).toBe(new Date(2026, 2, 9).getTime());
    // The instant itself: 2:00 AM Eastern Standard.
    expect(utc(spring.at)).toBe('2026-03-08T07:00:00Z');
    expect(Object.isFrozen(spring)).toBe(true);
  });

  it('respects the half-open range', () => {
    const day = (d) => new Date(2026, 2, d).getTime();
    expect(getClockChangesInRange('America/New_York', day(1), day(8))).toEqual([]);
    expect(getClockChangesInRange('America/New_York', day(8), day(9))).toHaveLength(1);
    expect(getClockChangesInRange('America/New_York', day(9), day(31))).toEqual([]);
    // A range ending inside the day still catches it.
    expect(getClockChangesInRange('America/New_York', day(1), day(8) + 1)).toHaveLength(1);
  });

  it('is empty for an unknown zone, an empty range, or a zone without changes', () => {
    const y = [new Date(2026, 0, 1).getTime(), new Date(2027, 0, 1).getTime()];
    expect(getClockChangesInRange('Mars/Olympus_Mons', ...y)).toEqual([]);
    expect(getClockChangesInRange('', ...y)).toEqual([]);
    expect(getClockChangesInRange('America/New_York', y[0], y[0])).toEqual([]);
    expect(getClockChangesInRange('Asia/Tokyo', ...y)).toEqual([]);
  });
});

describe('describeShift', () => {
  it('reads as people say it', () => {
    expect(describeShift(60)).toBe('1 hour');
    expect(describeShift(-60)).toBe('1 hour');
    expect(describeShift(120)).toBe('2 hours');
    expect(describeShift(30)).toBe('30 minutes');
  });
});

describe('browserZone', () => {
  it('reports the process zone under test', () => {
    const savedTZ = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    try {
      expect(browserZone()).toBe('Europe/Berlin');
    } finally {
      if (savedTZ === undefined) delete process.env.TZ;
      else process.env.TZ = savedTZ;
    }
  });
});
