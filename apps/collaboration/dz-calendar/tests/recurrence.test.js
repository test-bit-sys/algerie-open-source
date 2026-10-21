import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeRecurrence,
  firstScheduledStart,
  expandOccurrences,
  materializeOccurrence,
  occurrenceNear,
  nthWeekdayInfo,
  countScheduledBefore,
  describeRecurrence,
  buildPresets,
  matchPreset,
} from '../src/js/recurrence.js';

const H = 3_600_000;
const DAY = 86_400_000;

/** Build a series master. `start` is a local Date; duration defaults to 1h. */
function master(start, recurrence, extra = {}) {
  const s = start.getTime();
  return {
    id: 'm1',
    title: 'Standup',
    description: '',
    location: '',
    allDay: false,
    color: 'indigo',
    start: s,
    end: s + H,
    createdAt: s,
    updatedAt: s,
    recurrence,
    exdates: [],
    overrides: {},
    ...extra,
  };
}

/** Occurrence start times within [from, to), as ISO-ish local strings for readability. */
function starts(m, from, to) {
  return expandOccurrences(m, from, to)
    .sort((a, b) => a.start - b.start)
    .map((o) => new Date(o.start));
}

describe('normalizeRecurrence', () => {
  const s = new Date(2026, 6, 13, 19, 30).getTime(); // Mon Jul 13 2026 19:30

  it('returns null for missing / invalid freq', () => {
    expect(normalizeRecurrence(null, s)).toBeNull();
    expect(normalizeRecurrence({}, s)).toBeNull();
    expect(normalizeRecurrence({ freq: 'hourly' }, s)).toBeNull();
  });

  it('clamps interval to >= 1 and defaults to 1', () => {
    expect(normalizeRecurrence({ freq: 'daily', interval: 0 }, s).interval).toBe(1);
    expect(normalizeRecurrence({ freq: 'daily', interval: -5 }, s).interval).toBe(1);
    expect(normalizeRecurrence({ freq: 'daily' }, s).interval).toBe(1);
    expect(normalizeRecurrence({ freq: 'daily', interval: 3 }, s).interval).toBe(3);
  });

  it('defaults weekly byWeekday to the start weekday and sorts/dedupes', () => {
    expect(normalizeRecurrence({ freq: 'weekly' }, s).byWeekday).toEqual([1]); // Monday
    expect(normalizeRecurrence({ freq: 'weekly', byWeekday: [5, 1, 1, 3] }, s).byWeekday).toEqual([
      1, 3, 5,
    ]);
    expect(normalizeRecurrence({ freq: 'weekly', byWeekday: [9, -1, 'x'] }, s).byWeekday).toEqual([
      1,
    ]);
  });

  it('defaults monthlyMode to date', () => {
    expect(normalizeRecurrence({ freq: 'monthly' }, s).monthlyMode).toBe('date');
    expect(normalizeRecurrence({ freq: 'monthly', monthlyMode: 'weekday' }, s).monthlyMode).toBe(
      'weekday',
    );
  });

  it('validates wkst (weekly only; 0..6, default Sunday)', () => {
    expect(normalizeRecurrence({ freq: 'weekly' }, s).wkst).toBe(0);
    expect(normalizeRecurrence({ freq: 'weekly', wkst: 1 }, s).wkst).toBe(1);
    expect(normalizeRecurrence({ freq: 'weekly', wkst: 7 }, s).wkst).toBe(0);
    expect(normalizeRecurrence({ freq: 'weekly', wkst: 'x' }, s).wkst).toBe(0);
    expect(normalizeRecurrence({ freq: 'daily', wkst: 1 }, s).wkst).toBeNull();
  });

  it('validates monthlyNth (weekday mode only; -1 or 1..5)', () => {
    const wk = (nth) =>
      normalizeRecurrence({ freq: 'monthly', monthlyMode: 'weekday', monthlyNth: nth }, s).monthlyNth;
    expect(wk(-1)).toBe(-1);
    expect(wk(2)).toBe(2);
    expect(wk(5)).toBe(5);
    expect(wk(0)).toBeNull();
    expect(wk(6)).toBeNull();
    expect(wk(-2)).toBeNull();
    expect(wk('x')).toBeNull();
    expect(normalizeRecurrence({ freq: 'monthly', monthlyNth: -1 }, s).monthlyNth).toBeNull(); // date mode
    expect(normalizeRecurrence({ freq: 'weekly', monthlyNth: -1 }, s).monthlyNth).toBeNull();
  });

  it('sanitizes count and until', () => {
    expect(normalizeRecurrence({ freq: 'daily', count: 0 }, s).count).toBe(1);
    expect(normalizeRecurrence({ freq: 'daily', count: 5 }, s).count).toBe(5);
    expect(normalizeRecurrence({ freq: 'daily', count: 99999 }, s).count).toBe(999);
    expect(normalizeRecurrence({ freq: 'daily', until: s + DAY }, s).until).toBe(s + DAY);
  });
});

describe('nthWeekdayInfo', () => {
  it('computes the nth weekday and last flag', () => {
    expect(nthWeekdayInfo(new Date(2026, 6, 13))).toMatchObject({ nth: 2, weekday: 1 }); // 2nd Mon
    expect(nthWeekdayInfo(new Date(2026, 6, 6))).toMatchObject({ nth: 1, weekday: 1 }); // 1st Mon
    expect(nthWeekdayInfo(new Date(2026, 6, 27)).isLast).toBe(true); // last Mon of July
  });
});

describe('expandOccurrences — daily', () => {
  const m = master(new Date(2026, 6, 13, 9, 0), { freq: 'daily', interval: 1 });

  it('produces one per day within the window', () => {
    const got = starts(m, new Date(2026, 6, 13).getTime(), new Date(2026, 6, 16).getTime());
    expect(got.map((d) => d.getDate())).toEqual([13, 14, 15]);
    expect(got.every((d) => d.getHours() === 9)).toBe(true);
  });

  it('honors interval (every 2 days)', () => {
    const m2 = master(new Date(2026, 6, 13, 9, 0), { freq: 'daily', interval: 2 });
    const got = starts(m2, new Date(2026, 6, 13).getTime(), new Date(2026, 6, 20).getTime());
    expect(got.map((d) => d.getDate())).toEqual([13, 15, 17, 19]);
  });

  it('jumps ahead efficiently for a window far from the start', () => {
    // Series started 3 years before the window; must still land on the right days.
    const got = starts(m, new Date(2029, 6, 13).getTime(), new Date(2029, 6, 16).getTime());
    expect(got.map((d) => d.getDate())).toEqual([13, 14, 15]);
  });
});

describe('expandOccurrences — weekly', () => {
  it('repeats on selected weekdays', () => {
    // Start Mon Jul 13; repeat Mon/Wed/Fri.
    const m = master(new Date(2026, 6, 13, 9, 0), {
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 3, 5],
    });
    const got = starts(m, new Date(2026, 6, 13).getTime(), new Date(2026, 6, 20).getTime());
    expect(got.map((d) => d.getDate())).toEqual([13, 15, 17]); // Mon, Wed, Fri
  });

  it('clips weekdays before the start in the first week', () => {
    // Start Wed Jul 15; repeat Mon/Wed/Fri — Monday the 13th is before start.
    const m = master(new Date(2026, 6, 15, 9, 0), {
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 3, 5],
    });
    const got = starts(m, new Date(2026, 6, 13).getTime(), new Date(2026, 6, 20).getTime());
    expect(got.map((d) => d.getDate())).toEqual([15, 17]); // Wed, Fri (no Mon)
  });

  it('every-2-weeks skips the off week', () => {
    const m = master(new Date(2026, 6, 13, 9, 0), {
      freq: 'weekly',
      interval: 2,
      byWeekday: [1],
    });
    const got = starts(m, new Date(2026, 6, 1).getTime(), new Date(2026, 7, 15).getTime());
    expect(got.map((d) => [d.getMonth() + 1, d.getDate()])).toEqual([
      [7, 13],
      [7, 27],
      [8, 10],
    ]);
  });
});

describe('expandOccurrences — weekly wkst', () => {
  it('anchors every-2-weeks on Monday when wkst=1, so a spanning BYDAY keeps its parity', () => {
    // Start Wed Jul 8 2026, every 2 weeks on Wed+Sun. Monday-anchored weeks put
    // Sun Jul 12 in the SAME week as Wed Jul 8; Sunday-anchored weeks would
    // shift every Sunday a week later.
    const m = master(new Date(2026, 6, 8, 9, 0), {
      freq: 'weekly',
      interval: 2,
      byWeekday: [0, 3],
      wkst: 1,
    });
    const got = starts(m, new Date(2026, 6, 1).getTime(), new Date(2026, 7, 1).getTime());
    expect(got.map((d) => d.getDate())).toEqual([8, 12, 22, 26]);
  });

  it('defaults to the Sunday anchor when wkst is absent (existing behavior)', () => {
    const m = master(new Date(2026, 6, 8, 9, 0), {
      freq: 'weekly',
      interval: 2,
      byWeekday: [0, 3],
    });
    const got = starts(m, new Date(2026, 6, 1).getTime(), new Date(2026, 7, 1).getTime());
    expect(got.map((d) => d.getDate())).toEqual([8, 19, 22]);
  });
});

describe('expandOccurrences — monthly', () => {
  it('by date skips months without that day (31st)', () => {
    const m = master(new Date(2026, 0, 31, 9, 0), { freq: 'monthly', interval: 1, monthlyMode: 'date' });
    const got = starts(m, new Date(2026, 0, 1).getTime(), new Date(2026, 5, 1).getTime());
    // Jan 31, (no Feb), Mar 31, (no Apr 31), May 31 -> Jan, Mar, May
    expect(got.map((d) => d.getMonth() + 1)).toEqual([1, 3, 5]);
  });

  it('by weekday repeats on the nth weekday', () => {
    // Start 2nd Monday of July 2026 (the 13th).
    const m = master(new Date(2026, 6, 13, 9, 0), {
      freq: 'monthly',
      interval: 1,
      monthlyMode: 'weekday',
    });
    const got = starts(m, new Date(2026, 6, 1).getTime(), new Date(2026, 9, 1).getTime());
    // 2nd Mondays: Jul 13, Aug 10, Sep 14
    expect(got.map((d) => [d.getMonth() + 1, d.getDate()])).toEqual([
      [7, 13],
      [8, 10],
      [9, 14],
    ]);
  });

  it('by weekday skips months lacking a 5th occurrence', () => {
    // Start on a 5th Friday.
    const start = new Date(2026, 0, 30); // Jan 30 2026 is the 5th Friday
    expect(nthWeekdayInfo(start).nth).toBe(5);
    const m = master(new Date(2026, 0, 30, 9, 0), {
      freq: 'monthly',
      interval: 1,
      monthlyMode: 'weekday',
    });
    const got = starts(m, new Date(2026, 0, 1).getTime(), new Date(2026, 6, 1).getTime());
    // Only months with 5 Fridays in H1 2026: Jan(30), May(29). Feb/Mar/Apr/Jun have 4.
    expect(got.map((d) => d.getMonth() + 1)).toEqual([1, 5]);
  });

  it('monthlyNth: -1 repeats on the LAST weekday, including five-weekday months', () => {
    // Feb 27 2026 is the 4th AND last Friday — deriving nth from the start
    // would schedule "4th Friday" and land a week early in five-Friday months.
    const m = master(new Date(2026, 1, 27, 9, 0), {
      freq: 'monthly',
      interval: 1,
      monthlyMode: 'weekday',
      monthlyNth: -1,
    });
    const got = starts(m, new Date(2026, 1, 1).getTime(), new Date(2026, 6, 1).getTime());
    // Last Fridays: Feb 27, Mar 27, Apr 24, May 29 (5 Fridays), Jun 26.
    expect(got.map((d) => [d.getMonth() + 1, d.getDate()])).toEqual([
      [2, 27],
      [3, 27],
      [4, 24],
      [5, 29],
      [6, 26],
    ]);
  });

  it('monthlyNth: -1 anchored on a 5th weekday never skips a month', () => {
    // Mar 30 2026 is a 5th Monday; nth-derived expansion would drop Apr/May.
    const m = master(new Date(2026, 2, 30, 9, 0), {
      freq: 'monthly',
      interval: 1,
      monthlyMode: 'weekday',
      monthlyNth: -1,
    });
    const got = starts(m, new Date(2026, 2, 1).getTime(), new Date(2026, 6, 1).getTime());
    // Last Mondays: Mar 30, Apr 27, May 25, Jun 29.
    expect(got.map((d) => [d.getMonth() + 1, d.getDate()])).toEqual([
      [3, 30],
      [4, 27],
      [5, 25],
      [6, 29],
    ]);
  });

  it('an explicit positive monthlyNth overrides the start-derived nth', () => {
    // Start on the 1st Monday but rule says 2nd Monday (foreign import shape).
    const m = master(new Date(2026, 6, 6, 9, 0), {
      freq: 'monthly',
      interval: 1,
      monthlyMode: 'weekday',
      monthlyNth: 2,
    });
    const got = starts(m, new Date(2026, 6, 10).getTime(), new Date(2026, 9, 1).getTime());
    // 2nd Mondays after the window floor: Jul 13, Aug 10, Sep 14.
    expect(got.map((d) => [d.getMonth() + 1, d.getDate()])).toEqual([
      [7, 13],
      [8, 10],
      [9, 14],
    ]);
  });

  it('preserves the start seconds/ms of a sub-minute start on every occurrence', () => {
    // A sub-minute start (reachable via an ICS import like DTSTART:T093045).
    const s = new Date(2026, 0, 15, 9, 30, 45, 123);
    const m = master(s, { freq: 'monthly', interval: 1, monthlyMode: 'date' });
    const got = starts(m, new Date(2026, 0, 1).getTime(), new Date(2026, 3, 1).getTime());
    expect(got.map((d) => [d.getSeconds(), d.getMilliseconds()])).toEqual([
      [45, 123],
      [45, 123],
      [45, 123],
    ]);
    // The first occurrence's recurrenceId must equal the true stored start, so
    // exdates/overrides keyed to it match and search dates the series correctly.
    const [first] = expandOccurrences(m, new Date(2026, 0, 1).getTime(), new Date(2026, 3, 1).getTime())
      .sort((a, b) => a.start - b.start);
    expect(first.recurrenceId).toBe(s.getTime());
  });

  it('an exdate on a sub-minute-start monthly occurrence cancels it', () => {
    const s = new Date(2026, 0, 15, 9, 30, 45, 123);
    const m = master(s, { freq: 'monthly', interval: 1, monthlyMode: 'date' }, { exdates: [s.getTime()] });
    const got = starts(m, new Date(2026, 0, 1).getTime(), new Date(2026, 3, 1).getTime());
    // January is cancelled; Feb and Mar remain.
    expect(got.map((d) => d.getMonth() + 1)).toEqual([2, 3]);
  });
});

describe('expandOccurrences — yearly', () => {
  it('repeats annually', () => {
    const m = master(new Date(2026, 6, 13, 9, 0), { freq: 'yearly', interval: 1 });
    const got = starts(m, new Date(2026, 0, 1).getTime(), new Date(2030, 0, 1).getTime());
    expect(got.map((d) => d.getFullYear())).toEqual([2026, 2027, 2028, 2029]);
  });

  it('skips Feb 29 in non-leap years', () => {
    const m = master(new Date(2024, 1, 29, 9, 0), { freq: 'yearly', interval: 1 });
    const got = starts(m, new Date(2024, 0, 1).getTime(), new Date(2033, 0, 1).getTime());
    // Leap years with Feb 29: 2024, 2028, 2032
    expect(got.map((d) => d.getFullYear())).toEqual([2024, 2028, 2032]);
  });
});

describe('expandOccurrences — end conditions', () => {
  const base = new Date(2026, 6, 13, 9, 0);

  it('a window past what a Date can hold has no occurrences, and costs nothing to say so', () => {
    const m = master(new Date(2026, 0, 5, 9), 60, { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] });
    const t0 = performance.now();
    expect(expandOccurrences(m, 1e16, 1e16 + DAY)).toEqual([]);
    expect(expandOccurrences(m, 0, 9e15)).toEqual([]);
    expect(expandOccurrences(m, 8.7e15, 8.8e15)).toEqual([]);
    // Without the guard each of these walks the full expansion cap (~10⁴
    // periods × 5 weekdays); with it they return at once.
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('stops after `count` occurrences', () => {
    const m = master(base, { freq: 'daily', interval: 1, count: 3 });
    const got = starts(m, base.getTime(), base.getTime() + 30 * DAY);
    expect(got).toHaveLength(3);
    expect(got.map((d) => d.getDate())).toEqual([13, 14, 15]);
  });

  it('stops on `until` (inclusive)', () => {
    const until = new Date(2026, 6, 15, 23, 59, 59, 999).getTime();
    const m = master(base, { freq: 'daily', interval: 1, until });
    const got = starts(m, base.getTime(), base.getTime() + 30 * DAY);
    expect(got.map((d) => d.getDate())).toEqual([13, 14, 15]);
  });

  it('count applies across weekly multi-weekday occurrences', () => {
    const m = master(base, { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5], count: 4 });
    const got = starts(m, base.getTime(), base.getTime() + 60 * DAY);
    // Mon13, Wed15, Fri17, Mon20 -> 4 total
    expect(got.map((d) => d.getDate())).toEqual([13, 15, 17, 20]);
  });
});

describe('expandOccurrences — exdates & overrides', () => {
  const base = new Date(2026, 6, 13, 9, 0);

  it('skips exdated occurrences', () => {
    const rid = new Date(2026, 6, 14, 9, 0).getTime();
    const m = master(base, { freq: 'daily', interval: 1 }, { exdates: [rid] });
    const got = starts(m, base.getTime(), base.getTime() + 3 * DAY);
    expect(got.map((d) => d.getDate())).toEqual([13, 15]); // 14 removed
  });

  it('applies an override in place (title + time)', () => {
    const rid = new Date(2026, 6, 14, 9, 0).getTime();
    const newStart = new Date(2026, 6, 14, 11, 0).getTime();
    const m = master(base, { freq: 'daily', interval: 1 }, {
      overrides: { [rid]: { title: 'Moved', start: newStart, end: newStart + H } },
    });
    const occ = expandOccurrences(m, base.getTime(), base.getTime() + 3 * DAY).find(
      (o) => o.recurrenceId === rid,
    );
    expect(occ.title).toBe('Moved');
    expect(new Date(occ.start).getHours()).toBe(11);
    expect(occ.isException).toBe(true);
  });

  it('surfaces an override moved INTO the window from an out-of-window slot', () => {
    // Scheduled Jul 20 (outside window) but moved to Jul 14 (inside window).
    const rid = new Date(2026, 6, 20, 9, 0).getTime();
    const moved = new Date(2026, 6, 14, 15, 0).getTime();
    const m = master(base, { freq: 'daily', interval: 1 }, {
      overrides: { [rid]: { start: moved, end: moved + H } },
    });
    const winFrom = new Date(2026, 6, 14).getTime();
    const winTo = new Date(2026, 6, 15).getTime();
    const got = expandOccurrences(m, winFrom, winTo);
    expect(got.some((o) => o.recurrenceId === rid && new Date(o.start).getHours() === 15)).toBe(
      true,
    );
  });

  it('ignores an override keyed past the series count (no phantom occurrence)', () => {
    // count:3 -> only Jul 13, 14, 15. A stray override keyed to Jul 20 (which
    // the rule never schedules) must not render an extra occurrence.
    const phantom = new Date(2026, 6, 20, 9, 0).getTime();
    const m = master(base, { freq: 'daily', interval: 1, count: 3 }, {
      overrides: { [phantom]: { title: 'Phantom' } },
    });
    const got = starts(m, base.getTime(), base.getTime() + 30 * DAY);
    expect(got.map((d) => d.getDate())).toEqual([13, 14, 15]);
  });

  it('ignores an off-pattern override slot', () => {
    // Weekly on Monday; an override keyed to a Tuesday is not a scheduled slot.
    const tuesday = new Date(2026, 6, 14, 9, 0).getTime();
    const m = master(base, { freq: 'weekly', interval: 1, byWeekday: [1] }, {
      overrides: { [tuesday]: { title: 'Off-pattern' } },
    });
    const got = starts(m, base.getTime(), base.getTime() + 21 * DAY);
    expect(got.some((d) => d.getDate() === 14)).toBe(false);
  });
});

describe('monthly by weekday — anchor later in the month than the explicit nth', () => {
  it('never yields an occurrence before the series start', () => {
    // Anchored on the LAST Friday of August 2026 with an explicit "first
    // Friday": period 0's candidate (Aug 7) is before the anchor and is not
    // an occurrence the event ever had. The series begins on September 4.
    const start = new Date(2026, 7, 28, 9, 0);
    const rule = { freq: 'monthly', interval: 1, monthlyMode: 'weekday', monthlyNth: 1 };
    const m = master(start, rule);
    const got = starts(m, new Date(2026, 6, 1).getTime(), new Date(2026, 10, 1).getTime());
    expect(got.map((d) => `${d.getMonth() + 1}/${d.getDate()}`)).toEqual(['9/4', '10/2']);
    expect(firstScheduledStart(rule, start.getTime())).toBe(new Date(2026, 8, 4, 9, 0).getTime());
    // …and a count counts from there, not from a phantom in August.
    const counted = master(start, { ...rule, count: 2 });
    expect(starts(counted, new Date(2026, 6, 1).getTime(), new Date(2027, 0, 1).getTime()).map((d) => d.getMonth() + 1)).toEqual([9, 10]);
    expect(
      countScheduledBefore(normalizeRecurrence(rule, start.getTime()), start.getTime(), new Date(2026, 9, 2, 9, 0).getTime()),
    ).toBe(1);
  });
});

describe('expandOccurrences — count-bounded series with many overrides', () => {
  it('surfaces moved-in overrides and drops phantoms at a cost that does not scale with count × overrides', () => {
    // A "999 times" weekday series with a few hundred edited past occurrences
    // (a Google export of an edited standup). Every override outside the
    // window is checked against the schedule; asking the count-bounded
    // enumerator once per override made a 42-cell month render take seconds.
    const start = new Date(2024, 0, 1, 9, 0); // Mon Jan 1 2024
    const rule = { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5], count: 999 };
    const overrides = {};
    let d = new Date(start);
    let n = 0;
    while (n < 500) {
      if (d.getDay() >= 1 && d.getDay() <= 5) {
        overrides[d.getTime()] = { title: `Edited ${n}` };
        n++;
      }
      d = new Date(d.getTime() + DAY);
      d.setHours(9, 0, 0, 0);
    }
    // One override moved INTO the window from a slot outside it, one phantom
    // keyed to a Saturday the rule never schedules.
    const winFrom = new Date(2026, 6, 13).getTime();
    const winTo = new Date(2026, 6, 20).getTime();
    const movedFrom = new Date(2026, 6, 10, 9, 0).getTime(); // Fri before the window
    overrides[movedFrom] = { title: 'Moved in', start: winFrom + 15 * H, end: winFrom + 16 * H };
    overrides[new Date(2026, 6, 11, 9, 0).getTime()] = { title: 'Phantom' }; // Saturday
    const m = master(start, rule, { overrides });

    const t0 = performance.now();
    let got;
    for (let cell = 0; cell < 42; cell++) got = expandOccurrences(m, winFrom, winTo);
    const elapsed = performance.now() - t0;

    expect(got.some((o) => o.title === 'Moved in' && o.start === winFrom + 15 * H)).toBe(true);
    expect(got.some((o) => o.title === 'Phantom')).toBe(false);
    expect(got.filter((o) => !o.title.startsWith('Moved')).map((o) => new Date(o.start).getDate())).toEqual([
      13, 14, 15, 16, 17,
    ]);
    expect(elapsed).toBeLessThan(1500); // was ~5 s per 42 cells at this size
  });
});

describe('DST — wall-clock is preserved', () => {
  it('keeps the local hour across a spring-forward daily series', () => {
    // US DST 2026 begins Sun Mar 8. A 09:00 daily series should stay 09:00.
    const m = master(new Date(2026, 2, 6, 9, 0), { freq: 'daily', interval: 1 });
    const got = starts(m, new Date(2026, 2, 6).getTime(), new Date(2026, 2, 11).getTime());
    expect(got.every((d) => d.getHours() === 9 && d.getMinutes() === 0)).toBe(true);
    expect(got.map((d) => d.getDate())).toEqual([6, 7, 8, 9, 10]);
  });

  it('does not spill an all-day occurrence onto the next day at spring-forward', () => {
    // Regression: an all-day occurrence must span whole calendar days. Deriving
    // its end from a fixed-ms duration pushes it ~59min into the next (23h) day,
    // so it renders on two days. Run in a DST zone so the 23h day is real.
    const savedTZ = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const mar8 = new Date(2026, 2, 8).getTime();
      const mar9 = new Date(2026, 2, 9).getTime();
      const mar10 = new Date(2026, 2, 10).getTime();
      expect((mar9 - mar8) / H).toBe(23); // guard: spring-forward is in effect

      const s = new Date(2026, 0, 15).getTime(); // Jan 15, a normal 24h day
      const m = master(new Date(2026, 0, 15), { freq: 'daily', interval: 1 }, {
        allDay: true,
        start: s,
        end: s + DAY - 1,
      });

      // The Mar 9 cell must contain exactly one occurrence (Mar 9's own), not
      // also a Mar 8 occurrence that spilled across the 23-hour day.
      expect(expandOccurrences(m, mar9, mar10)).toHaveLength(1);

      // And the Mar 8 occurrence ends within Mar 8.
      const occ8 = expandOccurrences(m, mar8, mar9).find((o) => o.recurrenceId === mar8);
      expect(occ8).toBeTruthy();
      expect(occ8.end).toBeLessThan(mar9);
    } finally {
      // Restore precisely: assigning `undefined` would set TZ to the string
      // "undefined" (→ UTC) and skew every later test's local-time dates.
      if (savedTZ === undefined) delete process.env.TZ;
      else process.env.TZ = savedTZ;
    }
  });
});

describe('countScheduledBefore', () => {
  it('counts occurrences before a split point', () => {
    const base = new Date(2026, 6, 13, 9, 0);
    const rule = normalizeRecurrence({ freq: 'daily', interval: 1 }, base.getTime());
    const split = new Date(2026, 6, 16, 9, 0).getTime();
    expect(countScheduledBefore(rule, base.getTime(), split)).toBe(3); // 13,14,15
  });
});

describe('materializeOccurrence', () => {
  it('builds a single occurrence with override applied', () => {
    const base = new Date(2026, 6, 13, 9, 0);
    const rid = new Date(2026, 6, 15, 9, 0).getTime();
    const m = master(base, { freq: 'daily', interval: 1 }, {
      overrides: { [rid]: { title: 'One-off' } },
    });
    const occ = materializeOccurrence(m, rid);
    expect(occ.seriesId).toBe('m1');
    expect(occ.recurrenceId).toBe(rid);
    expect(occ.title).toBe('One-off');
    expect(occ.id).toBe(`m1::${rid}`);
  });
});

describe('occurrenceNear', () => {
  it('returns the next occurrence for a long-interval series straddling the window', () => {
    // Every 4 years from 2016; target 2026 → neighbours are 2024 and 2028.
    const m = master(new Date(2016, 6, 15, 9, 0), { freq: 'yearly', interval: 4 });
    const occ = occurrenceNear(m, new Date(2026, 6, 16).getTime());
    expect(occ.seriesId).toBe('m1');
    expect(new Date(occ.recurrenceId).getFullYear()).toBe(2028); // next, not the 2016 first
  });

  it('returns the most recent occurrence of a series that ended before the target', () => {
    // Daily×10 from Jan 1 2020 → last occurrence Jan 10 2020.
    const m = master(new Date(2020, 0, 1, 9, 0), { freq: 'daily', interval: 1, count: 10 });
    const occ = occurrenceNear(m, new Date(2026, 0, 1).getTime());
    expect(new Date(occ.recurrenceId).getTime()).toBe(new Date(2020, 0, 10, 9, 0).getTime());
  });

  it('honors an until bound as the last occurrence', () => {
    const until = new Date(2020, 0, 5, 23, 59, 59, 999).getTime(); // through Jan 5
    const m = master(new Date(2020, 0, 1, 9, 0), { freq: 'daily', interval: 1, until });
    const occ = occurrenceNear(m, new Date(2026, 0, 1).getTime());
    expect(new Date(occ.recurrenceId).getTime()).toBe(new Date(2020, 0, 5, 9, 0).getTime());
  });

  it('returns the first occurrence for a series starting far in the future', () => {
    const m = master(new Date(2030, 0, 1, 9, 0), { freq: 'weekly', interval: 1 });
    const occ = occurrenceNear(m, new Date(2026, 0, 1).getTime());
    expect(new Date(occ.recurrenceId).getTime()).toBe(new Date(2030, 0, 1, 9, 0).getTime());
  });

  it('skips a cancelled (exdated) nearest occurrence', () => {
    // Every 4 years; exdate the 2028 slot → nearest upcoming becomes 2032.
    const rid2028 = new Date(2028, 6, 15, 9, 0).getTime();
    const m = master(new Date(2016, 6, 15, 9, 0), { freq: 'yearly', interval: 4 }, {
      exdates: [rid2028],
    });
    const occ = occurrenceNear(m, new Date(2026, 6, 16).getTime());
    expect(new Date(occ.recurrenceId).getFullYear()).toBe(2032);
  });
});

describe('describeRecurrence', () => {
  const mon = new Date(2026, 6, 13, 19, 30).getTime(); // Monday, July 13
  it('summarizes the common patterns', () => {
    expect(describeRecurrence(null, mon)).toBe('Does not repeat');
    expect(describeRecurrence({ freq: 'daily', interval: 1 }, mon)).toBe('Daily');
    expect(describeRecurrence({ freq: 'daily', interval: 3 }, mon)).toBe('Every 3 days');
    expect(describeRecurrence({ freq: 'weekly', byWeekday: [1] }, mon)).toBe('Weekly on Mon');
    expect(describeRecurrence({ freq: 'weekly', byWeekday: [1, 3] }, mon)).toBe('Weekly on Mon, Wed');
    expect(describeRecurrence({ freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] }, mon)).toBe(
      'Every weekday',
    );
    expect(describeRecurrence({ freq: 'monthly', monthlyMode: 'weekday' }, mon)).toBe(
      'Monthly on the second Monday',
    );
    expect(describeRecurrence({ freq: 'monthly', monthlyMode: 'date' }, mon)).toBe('Monthly on day 13');
    expect(describeRecurrence({ freq: 'yearly' }, mon)).toBe('Annually on July 13');
  });

  it('describes an explicit monthlyNth, including "last"', () => {
    expect(
      describeRecurrence({ freq: 'monthly', monthlyMode: 'weekday', monthlyNth: -1 }, mon),
    ).toBe('Monthly on the last Monday');
    expect(
      describeRecurrence({ freq: 'monthly', monthlyMode: 'weekday', monthlyNth: 3 }, mon),
    ).toBe('Monthly on the third Monday');
  });

  it('appends end conditions', () => {
    expect(describeRecurrence({ freq: 'daily', count: 13 }, mon)).toBe('Daily, 13 times');
    const until = new Date(2026, 9, 12).getTime();
    expect(describeRecurrence({ freq: 'daily', until }, mon)).toBe('Daily, until Oct 12, 2026');
  });
});

describe('buildPresets & matchPreset', () => {
  const mon = new Date(2026, 6, 13, 19, 30).getTime(); // Monday, July 13

  it('labels presets for the start date', () => {
    const labels = buildPresets(mon).map((p) => p.label);
    expect(labels).toContain('Weekly on Monday');
    expect(labels).toContain('Monthly on the second Monday');
    expect(labels).toContain('Annually on July 13');
    expect(labels).toContain('Every weekday (Monday to Friday)');
  });

  it('round-trips preset rules back to their key', () => {
    for (const p of buildPresets(mon)) {
      if (!p.rule && p.key !== 'none') continue; // skip custom (no rule)
      expect(matchPreset(p.rule ?? null, mon)).toBe(p.key);
    }
  });

  it('classifies non-preset rules as custom', () => {
    expect(matchPreset({ freq: 'daily', interval: 2 }, mon)).toBe('custom');
    expect(matchPreset({ freq: 'weekly', byWeekday: [2, 4] }, mon)).toBe('custom');
    expect(matchPreset({ freq: 'daily', count: 5 }, mon)).toBe('custom');
    expect(matchPreset({ freq: 'monthly', monthlyMode: 'date' }, mon)).toBe('custom');
  });

  it('offers "last" instead of a month-skipping "fifth" on a 5th-weekday start', () => {
    const fifthMon = new Date(2026, 2, 30, 9, 0).getTime(); // Mar 30 2026, a 5th Monday
    const monthly = buildPresets(fifthMon).find((p) => p.key === 'monthly');
    expect(monthly.label).toBe('Monthly on the last Monday');
    expect(monthly.rule.monthlyNth).toBe(-1);
    expect(matchPreset(monthly.rule, fifthMon)).toBe('monthly');
  });

  it('reads an explicit monthlyNth that differs from the preset as custom', () => {
    // mon is a 2nd-and-not-last Monday: "last Monday" is not what its preset says.
    expect(
      matchPreset({ freq: 'monthly', monthlyMode: 'weekday', monthlyNth: -1 }, mon),
    ).toBe('custom');
    // …while an explicit nth equal to the derived one still matches.
    expect(
      matchPreset({ freq: 'monthly', monthlyMode: 'weekday', monthlyNth: 2 }, mon),
    ).toBe('monthly');
  });
});

/**
 * Weekly candidates used to be built in two hops — back to the week's anchor
 * day (Sunday by default), then forward — and the anchor is the spring-forward
 * day in the US, EU, Australia and Chile. A start in the skipped hour of that
 * week resolved its anchor an hour late, and every occurrence inherited it.
 * Pin the zone: the failure needs a real transition on a real Sunday.
 */
describe('weekly series anchored in a clock-change week', () => {
  let savedTZ;
  const useZone = (zone) => {
    savedTZ = process.env.TZ;
    process.env.TZ = zone;
  };
  afterEach(() => {
    if (savedTZ === undefined) delete process.env.TZ;
    else process.env.TZ = savedTZ;
  });
  const wall = (ms) => {
    const d = new Date(ms);
    return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  it('keeps the wall clock of a start in the week the clocks went forward (New York)', () => {
    useZone('America/New_York');
    // Sun Mar 8 2026 is the US spring-forward; 02:30 that day does not exist.
    const start = new Date(2026, 2, 11, 2, 30); // the Wednesday of that week
    expect(start.getHours()).toBe(2); // the start itself is a real instant
    const rule = normalizeRecurrence({ freq: 'weekly', byWeekday: [3] }, start.getTime());
    expect(firstScheduledStart(rule, start.getTime())).toBe(start.getTime());
    const occ = expandOccurrences(master(start, rule), start.getTime() - DAY, start.getTime() + 22 * DAY);
    expect(occ.map((o) => wall(o.start))).toEqual(['11 02:30', '18 02:30', '25 02:30', '1 02:30']);
    expect(occ[0].recurrenceId).toBe(start.getTime()); // so the master's own id resolves
  });

  it('keeps an all-day series at midnight where the clocks change at midnight (Santiago)', () => {
    useZone('America/Santiago');
    // Sun Sep 6 2026: Chile's clocks go from 00:00 straight to 01:00.
    const start = new Date(2026, 8, 9); // the Wednesday of that week, 00:00
    expect(start.getHours()).toBe(0);
    const rule = normalizeRecurrence({ freq: 'weekly', byWeekday: [3] }, start.getTime());
    expect(firstScheduledStart(rule, start.getTime())).toBe(start.getTime());
    const occ = expandOccurrences(master(start, rule, { allDay: true }), start.getTime() - DAY, start.getTime() + 15 * DAY);
    expect(occ.map((o) => wall(o.start))).toEqual(['9 00:00', '16 00:00', '23 00:00']);
  });
});

describe('expandOccurrences — out of office', () => {
  const s = new Date(2026, 6, 17, 13).getTime(); // Fri Jul 17 2026 13:00
  const H = 3_600_000;
  const from = new Date(2026, 6, 1).getTime();
  const to = new Date(2026, 7, 1).getTime();

  it('carries the master away marker onto every occurrence', () => {
    const m = { id: 'away', start: s, end: s + 4 * H, ooo: true, recurrence: { freq: 'weekly', byWeekday: [5] } };
    const occ = expandOccurrences(m, from, to);
    expect(occ).toHaveLength(3); // Jul 17, 24, 31
    expect(occ.every((o) => o.ooo === true)).toBe(true);
  });

  it('defaults the marker to false for a plain series', () => {
    const m = { id: 'plain', start: s, end: s + H, recurrence: { freq: 'weekly', byWeekday: [5] } };
    expect(expandOccurrences(m, from, to).every((o) => o.ooo === false)).toBe(true);
  });
});
