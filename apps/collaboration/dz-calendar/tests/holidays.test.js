import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  easterSunday,
  getHolidaysInRange,
  HOLIDAY_COUNTRIES,
  isSupportedCountry,
  countryName,
  detectCountry,
  resolveHolidayCountry,
  clearHolidayCache,
} from '../src/js/holidays.js';

/** The holiday titles a country observes on one local date. */
function on(country, y, m, d) {
  return getHolidaysInRange(country, new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()).map(
    (h) => h.title,
  );
}

/** A whole calendar year as ["MM-DD Title"], in date order. */
function inYear(country, y) {
  return getHolidaysInRange(country, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()).map((h) => {
    const d = new Date(h.start);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${h.title}`;
  });
}

const iso = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('Easter', () => {
  // Independently known Western Easter dates spanning the algorithm's awkward
  // corners (a century boundary, both March and April outcomes).
  it.each([
    [1981, 4, 19],
    [2000, 4, 23],
    [2020, 4, 12],
    [2021, 4, 4],
    [2022, 4, 17],
    [2023, 4, 9],
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2030, 4, 21],
  ])('%i falls on %i/%i', (year, month, day) => {
    expect(easterSunday(year)).toEqual({ month, day });
  });

  it('always lands on a Sunday', () => {
    for (let y = 1970; y <= 2100; y++) {
      const { month, day } = easterSunday(y);
      expect(new Date(y, month - 1, day).getDay()).toBe(0);
    }
  });
});

describe('United States', () => {
  it('lists the eleven federal holidays for 2026', () => {
    expect(inYear('us', 2026)).toEqual([
      "01-01 New Year's Day",
      '01-19 Martin Luther King Jr. Day',
      "02-16 Presidents' Day",
      '05-25 Memorial Day',
      '06-19 Juneteenth',
      '07-03 Independence Day (observed)',
      '07-04 Independence Day',
      '09-07 Labor Day',
      '10-12 Columbus Day',
      '11-11 Veterans Day',
      '11-26 Thanksgiving Day',
      '12-25 Christmas Day',
    ]);
  });

  it('observes a Saturday holiday on the Friday before and a Sunday one on the Monday after', () => {
    // 4 July 2026 is a Saturday; 25 December 2022 is a Sunday.
    expect(on('us', 2026, 7, 3)).toEqual(['Independence Day (observed)']);
    expect(on('us', 2026, 7, 4)).toEqual(['Independence Day']);
    expect(on('us', 2022, 12, 25)).toEqual(['Christmas Day']);
    expect(on('us', 2022, 12, 26)).toEqual(['Christmas Day (observed)']);
  });

  it("observes a New Year's Day that falls on a Saturday in the previous year", () => {
    // 1 January 2022 was a Saturday, so the federal day off was Fri 31 Dec 2021
    // — a date the generator only reaches while working on 2022.
    expect(on('us', 2021, 12, 31)).toEqual(["New Year's Day (observed)"]);
  });

  it('honours the years a holiday came into being', () => {
    expect(inYear('us', 2020).some((h) => h.includes('Juneteenth'))).toBe(false);
    expect(inYear('us', 2021).some((h) => h.includes('Juneteenth'))).toBe(true);
    expect(inYear('us', 1985).some((h) => h.includes('Martin Luther King'))).toBe(false);
    expect(inYear('us', 1986).some((h) => h.includes('Martin Luther King'))).toBe(true);
  });
});

describe('United Kingdom', () => {
  it('gives Christmas and Boxing Day separate substitute days when both fall on a weekend', () => {
    // 25 Dec 2021 was a Saturday and 26 Dec a Sunday: the substitutes were the
    // Monday AND the Tuesday, not both on the Monday.
    expect(on('uk', 2021, 12, 27)).toEqual(['Christmas Day (observed)']);
    expect(on('uk', 2021, 12, 28)).toEqual(['Boxing Day (observed)']);
  });

  it('skips a substitute onto the next free weekday', () => {
    // 25 Dec 2022 was a Sunday, so its substitute cannot be Boxing Day itself.
    expect(on('uk', 2022, 12, 26)).toEqual(['Boxing Day']);
    expect(on('uk', 2022, 12, 27)).toEqual(['Christmas Day (observed)']);
  });

  it('models the one-off bank holidays of 2020, 2022 and 2023', () => {
    expect(on('uk', 2020, 5, 8)).toEqual(['Early May Bank Holiday']);
    expect(on('uk', 2020, 5, 4)).toEqual([]);
    expect(on('uk', 2022, 6, 2)).toEqual(['Spring Bank Holiday']);
    expect(on('uk', 2022, 6, 3)).toEqual(['Platinum Jubilee Bank Holiday']);
    expect(on('uk', 2022, 5, 30)).toEqual([]);
    expect(on('uk', 2022, 9, 19)).toEqual(['Bank Holiday for the State Funeral of Queen Elizabeth II']);
    expect(on('uk', 2023, 5, 8)).toEqual(['Bank Holiday for the Coronation of King Charles III']);
    // …and returns to the ordinary rule either side of them.
    expect(on('uk', 2021, 5, 31)).toEqual(['Spring Bank Holiday']);
    expect(on('uk', 2023, 5, 29)).toEqual(['Spring Bank Holiday']);
  });
});

describe('United Kingdom — history', () => {
  it('models the jubilee years and the other one-off bank holidays back to 1977', () => {
    expect(on('uk', 2012, 6, 4)).toEqual(['Spring Bank Holiday']);
    expect(on('uk', 2012, 6, 5)).toEqual(['Diamond Jubilee Bank Holiday']);
    expect(on('uk', 2012, 5, 28)).toEqual([]);
    expect(on('uk', 2002, 6, 3)).toEqual(['Golden Jubilee Bank Holiday']);
    expect(on('uk', 2002, 6, 4)).toEqual(['Spring Bank Holiday']);
    expect(on('uk', 2002, 5, 27)).toEqual([]);
    expect(on('uk', 1977, 6, 6)).toEqual(['Spring Bank Holiday']);
    expect(on('uk', 1977, 6, 7)).toEqual(['Silver Jubilee Bank Holiday']);
    expect(on('uk', 1977, 5, 30)).toEqual([]);
    expect(on('uk', 2011, 4, 29)).toEqual(['Royal Wedding Bank Holiday']);
    expect(on('uk', 1999, 12, 31)).toEqual(['Millennium Bank Holiday']);
    expect(on('uk', 1981, 7, 29)).toEqual(['Royal Wedding Bank Holiday']);
    // The Early May holiday began in 1978, and 1995 moved it to VE Day's Monday.
    expect(on('uk', 1977, 5, 2)).toEqual([]);
    expect(on('uk', 1978, 5, 1)).toEqual(['Early May Bank Holiday']);
    expect(on('uk', 1995, 5, 8)).toEqual(['Early May Bank Holiday']);
    expect(on('uk', 1995, 5, 1)).toEqual([]);
    // …and the ordinary rules hold in the years between.
    expect(on('uk', 2003, 5, 26)).toEqual(['Spring Bank Holiday']);
    expect(on('uk', 2013, 5, 27)).toEqual(['Spring Bank Holiday']);
  });
});

describe('Germany', () => {
  it('moves the day of unity with reunification and keeps Buß- und Bettag nationwide through 1994', () => {
    expect(on('de', 1989, 6, 17)).toEqual(['German Unity Day']);
    expect(on('de', 1989, 10, 3)).toEqual([]);
    expect(on('de', 1990, 6, 17)).toEqual(['German Unity Day']);
    expect(on('de', 1990, 10, 3)).toEqual(['German Unity Day']);
    expect(on('de', 1991, 6, 17)).toEqual([]);
    expect(on('de', 2026, 10, 3)).toEqual(['German Unity Day']);
    expect(on('de', 1994, 11, 16)).toEqual(['Day of Repentance and Prayer']); // Wed 16 Nov 1994
    expect(on('de', 1995, 11, 22)).toEqual([]); // abolished nationwide from 1995
  });
});

describe('Canada', () => {
  it('puts Victoria Day on the Monday before 25 May, every year', () => {
    for (let y = 2020; y <= 2035; y++) {
      const [holiday] = getHolidaysInRange('ca', new Date(y, 4, 1).getTime(), new Date(y, 5, 1).getTime()).filter(
        (h) => h.title === 'Victoria Day',
      );
      const d = new Date(holiday.start);
      expect(d.getDay()).toBe(1);
      expect(d.getDate()).toBeGreaterThanOrEqual(18);
      expect(d.getDate()).toBeLessThanOrEqual(24);
    }
  });

  it('adds Truth and Reconciliation Day from 2021', () => {
    expect(inYear('ca', 2020).some((h) => h.includes('Truth and Reconciliation'))).toBe(false);
    expect(on('ca', 2026, 9, 30)).toEqual(['National Day for Truth and Reconciliation']);
  });
});

describe('Australia', () => {
  it('moves Australia Day off a weekend but leaves Anzac Day where it falls', () => {
    expect(on('au', 2025, 1, 26)).toEqual(['Australia Day']);
    expect(on('au', 2025, 1, 27)).toEqual(['Australia Day (observed)']);
    // 25 April 2026 is a Saturday and gets no substitute in the eastern states.
    expect(on('au', 2026, 4, 25)).toEqual(['Anzac Day']);
    expect(on('au', 2026, 4, 27)).toEqual([]);
  });

  it('renames the monarch’s birthday in 2023', () => {
    expect(inYear('au', 2022).some((h) => h.includes("Queen's Birthday"))).toBe(true);
    expect(inYear('au', 2022).some((h) => h.includes("King's Birthday"))).toBe(false);
    expect(inYear('au', 2023).some((h) => h.includes("King's Birthday"))).toBe(true);
    expect(inYear('au', 2023).some((h) => h.includes("Queen's Birthday"))).toBe(false);
  });
});

describe('countries without weekend substitution', () => {
  it('loses a German holiday that falls on a Saturday', () => {
    // 3 October 2026 is a Saturday. Germany substitutes nothing, ever.
    expect(on('de', 2026, 10, 3)).toEqual(['German Unity Day']);
    expect(on('de', 2026, 10, 5)).toEqual([]);
  });

  it('lists the French jours fériés for 2026', () => {
    expect(inYear('fr', 2026)).toEqual([
      "01-01 New Year's Day",
      '04-06 Easter Monday',
      '05-01 Labour Day',
      '05-08 Victory in Europe Day',
      '05-14 Ascension Day',
      '05-25 Whit Monday',
      '07-14 Bastille Day',
      '08-15 Assumption of Mary',
      "11-01 All Saints' Day",
      '11-11 Armistice Day',
      '12-25 Christmas Day',
    ]);
  });

  it('lists the Spanish national holidays for 2026', () => {
    expect(inYear('es', 2026)).toEqual([
      "01-01 New Year's Day",
      '01-06 Epiphany',
      '04-03 Good Friday',
      '05-01 Labour Day',
      '08-15 Assumption of Mary',
      '10-12 National Day',
      "11-01 All Saints' Day",
      '12-06 Constitution Day',
      '12-08 Immaculate Conception',
      '12-25 Christmas Day',
    ]);
  });

  it('ships only the three holidays India observes nationwide', () => {
    expect(inYear('in', 2026)).toEqual([
      '01-26 Republic Day',
      '08-15 Independence Day',
      '10-02 Gandhi Jayanti',
    ]);
  });
});

describe('Netherlands', () => {
  it("moves King's Day back a day when 27 April is a Sunday", () => {
    expect(on('nl', 2026, 4, 27)).toEqual(["King's Day"]); // a Monday
    // 27 April 2025 was a Sunday: the day is celebrated on the 26th, and the
    // 27th is not a holiday at all — a move, not an added substitute.
    expect(on('nl', 2025, 4, 26)).toEqual(["King's Day"]);
    expect(on('nl', 2025, 4, 27)).toEqual([]);
  });

  it('was Queen’s Day before the 2013 abdication', () => {
    expect(inYear('nl', 2012).some((h) => h.includes("Queen's Day"))).toBe(true);
    expect(inYear('nl', 2015).some((h) => h.includes("King's Day"))).toBe(true);
    expect(inYear('nl', 2015).some((h) => h.includes("Queen's Day"))).toBe(false);
  });
});

describe('Japan', () => {
  it('computes the equinox days', () => {
    expect(on('jp', 2026, 3, 20)).toEqual(['Vernal Equinox Day']);
    expect(on('jp', 2026, 9, 23)).toEqual(['Autumnal Equinox Day']);
    expect(on('jp', 2024, 3, 20)).toEqual(['Vernal Equinox Day']);
    expect(on('jp', 2025, 9, 23)).toEqual(['Autumnal Equinox Day']);
  });

  it('pushes a Sunday holiday to the next free day', () => {
    // 3 May 2026 is a Sunday, but the 4th and 5th are holidays of their own —
    // the substitute lands on the 6th.
    expect(on('jp', 2026, 5, 3)).toEqual(['Constitution Memorial Day']);
    expect(on('jp', 2026, 5, 6)).toEqual(['Constitution Memorial Day (observed)']);
    expect(on('jp', 2021, 8, 9)).toEqual(['Mountain Day (observed)']);
  });

  it("bridges the day between two holidays (September's Silver Week)", () => {
    expect(on('jp', 2026, 9, 21)).toEqual(['Respect for the Aged Day']);
    expect(on('jp', 2026, 9, 22)).toEqual(["Citizens' Holiday"]);
    expect(on('jp', 2026, 9, 23)).toEqual(['Autumnal Equinox Day']);
    // 2025's equinox is the Tuesday itself, leaving nothing to bridge.
    expect(on('jp', 2025, 9, 16)).toEqual([]);
  });

  it('gives 2019 the ten-day Golden Week the abdication produced', () => {
    // Two one-off holidays (1 May, 22 Oct), and the bridge rule turning the
    // days either side of the first into holidays of their own. The list
    // already modelled the Emperor's Birthday moving off 2019; without these
    // the year read as an ordinary one.
    expect(on('jp', 2019, 4, 29)).toEqual(['Showa Day']);
    expect(on('jp', 2019, 4, 30)).toEqual(["Citizens' Holiday"]);
    expect(on('jp', 2019, 5, 1)).toEqual(["Emperor's Enthronement Day"]);
    expect(on('jp', 2019, 5, 2)).toEqual(["Citizens' Holiday"]);
    expect(on('jp', 2019, 5, 3)).toEqual(['Constitution Memorial Day']);
    expect(on('jp', 2019, 10, 22)).toEqual(['Enthronement Ceremony Day']);
    // One-offs, so the ordinary years either side are untouched.
    expect(inYear('jp', 2018).some((h) => h.includes('Enthronement'))).toBe(false);
    expect(inYear('jp', 2020).some((h) => h.includes('Enthronement'))).toBe(false);
    expect(on('jp', 2020, 4, 30)).toEqual([]);
  });

  it('honours the Tokyo 2020 date moves in both affected years', () => {
    expect(on('jp', 2021, 7, 22)).toEqual(['Marine Day']);
    expect(on('jp', 2021, 7, 23)).toEqual(['Sports Day']);
    expect(on('jp', 2021, 8, 8)).toEqual(['Mountain Day']);
    expect(on('jp', 2021, 10, 11)).toEqual([]); // the usual second Monday of October
    expect(on('jp', 2022, 7, 18)).toEqual(['Marine Day']); // back to the third Monday
  });
});

describe('two holidays on one day', () => {
  // A movable feast sweeps a five-week window across the fixed dates, so now
  // and then two land together. Both belong on the day: keeping only the first
  // by rule order dropped whichever the country's list mentions later.
  it('lists both when Ascension Day falls on a fixed holiday', () => {
    // Easter 1997 was 30 March, putting Ascension on VE Day.
    expect(on('fr', 1997, 5, 8)).toEqual(['Ascension Day', 'Victory in Europe Day']);
    // Easter 2008 was 23 March: Ascension on Labour Day, in two countries.
    expect(on('de', 2008, 5, 1)).toEqual(['Ascension Day', 'Labour Day']);
    expect(on('fr', 2008, 5, 1)).toEqual(['Ascension Day', 'Labour Day']);
    // Easter 2016 was 27 March: Ascension on Dutch Liberation Day.
    expect(on('nl', 2016, 5, 5)).toEqual(['Ascension Day', 'Liberation Day']);
    // Still ahead of us: 2059, 2070, 2081 and 2092 all repeat the 1997 clash.
    expect(on('fr', 2059, 5, 8)).toEqual(['Ascension Day', 'Victory in Europe Day']);
  });

  it('does not lose Anzac Day to an Easter Monday on top of it', () => {
    // Easter 2011 was 24 April. Anzac Day is the one nobody would forgive the
    // calendar for dropping, and it is the later of the two in the rule list.
    expect(on('au', 2011, 4, 25)).toEqual(['Anzac Day', 'Easter Monday']);
    expect(on('au', 2095, 4, 25)).toEqual(['Anzac Day', 'Easter Monday']);
  });

  it('still gives each item its own id', () => {
    const day = new Date(2011, 3, 25);
    const items = getHolidaysInRange('au', day.getTime(), day.getTime() + 86_400_000);
    expect(items.map((h) => h.id)).toEqual(['hol:au:2011-04-25', 'hol:au:2011-04-25#2']);
  });

  it('leaves an ordinary day with the plain, unsuffixed id', () => {
    const [xmas] = getHolidaysInRange(
      'fr',
      new Date(2026, 11, 25).getTime(),
      new Date(2026, 11, 26).getTime(),
    );
    expect(xmas.id).toBe('hol:fr:2026-12-25');
  });

  it('does not double a holiday whose own rules both cover one year', () => {
    // Every country's list, every year: one name may appear only once a day.
    for (const c of HOLIDAY_COUNTRIES) {
      for (let y = 1990; y <= 2100; y++) {
        const items = getHolidaysInRange(c.id, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime());
        const keys = items.map((h) => `${h.start}|${h.title}`);
        expect(new Set(keys).size, `${c.id} ${y}`).toBe(keys.length);
        expect(new Set(items.map((h) => h.id)).size, `${c.id} ${y} ids`).toBe(items.length);
      }
    }
  });
});

describe('range handling', () => {
  it('is half-open: an item is in the range its day starts in', () => {
    const xmas = new Date(2026, 11, 25).getTime();
    expect(getHolidaysInRange('us', xmas, xmas + 1)).toHaveLength(1);
    // A range ending exactly at Christmas midnight excludes it.
    expect(getHolidaysInRange('us', new Date(2026, 11, 1).getTime(), xmas)).toEqual([]);
  });

  it('returns nothing for an empty range, an inverted one, or an unknown country', () => {
    const t = new Date(2026, 6, 4).getTime();
    expect(getHolidaysInRange('us', t, t)).toEqual([]);
    expect(getHolidaysInRange('us', t + 1000, t)).toEqual([]);
    expect(getHolidaysInRange('zz', 0, Date.now() * 2)).toEqual([]);
    expect(getHolidaysInRange('', 0, Date.now() * 2)).toEqual([]);
  });

  it('spans years, in order, without duplicating the boundary', () => {
    const items = getHolidaysInRange('us', new Date(2025, 11, 20).getTime(), new Date(2026, 0, 10).getTime());
    expect(items.map((h) => `${iso(h.start)} ${h.title}`)).toEqual([
      '2025-12-25 Christmas Day',
      '2026-01-01 New Year\'s Day',
    ]);
    expect(new Set(items.map((h) => h.id)).size).toBe(items.length);
  });
});

describe('the overlay objects', () => {
  const [xmas] = getHolidaysInRange('us', new Date(2026, 11, 25).getTime(), new Date(2026, 11, 26).getTime());

  it('is an all-day, read-only, event-shaped item on local midnight', () => {
    expect(xmas).toMatchObject({
      id: 'hol:us:2026-12-25',
      holiday: true,
      readOnly: true,
      allDay: true,
      title: 'Christmas Day',
      observed: false,
      countryId: 'us',
      countryName: 'United States',
    });
    expect(xmas.start).toBe(new Date(2026, 11, 25).getTime());
    expect(xmas.end).toBe(new Date(2026, 11, 26).getTime());
  });

  it('flags an observed day as such', () => {
    const [obs] = getHolidaysInRange('us', new Date(2026, 6, 3).getTime(), new Date(2026, 6, 4).getTime());
    expect(obs.observed).toBe(true);
    expect(obs.title).toBe('Independence Day (observed)');
  });

  it('carries no palette color, so no category filter can hide it', () => {
    expect(xmas.color).toBeUndefined();
  });
});

describe('the memo cache', () => {
  it('returns identical results before and after it is cleared', () => {
    const range = [new Date(2026, 0, 1).getTime(), new Date(2027, 0, 1).getTime()];
    const first = getHolidaysInRange('us', ...range);
    const cached = getHolidaysInRange('us', ...range);
    clearHolidayCache();
    const cold = getHolidaysInRange('us', ...range);
    expect(cached).toEqual(first);
    expect(cold).toEqual(first);
  });

  it('does not grow without bound as a user scrolls through years', () => {
    // 200 years across two countries is far past the cap; the point is that it
    // keeps answering correctly rather than that it keeps everything.
    for (let y = 1900; y < 2100; y++) {
      getHolidaysInRange('us', new Date(y, 0, 1).getTime(), new Date(y, 0, 2).getTime());
      getHolidaysInRange('jp', new Date(y, 0, 1).getTime(), new Date(y, 0, 2).getTime());
    }
    expect(on('us', 2026, 7, 4)).toEqual(['Independence Day']);
  });
});

describe('the country list', () => {
  it('exposes ten countries with unique ids and names', () => {
    expect(HOLIDAY_COUNTRIES).toHaveLength(10);
    expect(new Set(HOLIDAY_COUNTRIES.map((c) => c.id)).size).toBe(10);
    for (const c of HOLIDAY_COUNTRIES) {
      expect(isSupportedCountry(c.id)).toBe(true);
      expect(countryName(c.id)).toBe(c.name);
      // Every listed country must actually produce holidays.
      expect(inYear(c.id, 2026).length).toBeGreaterThan(0);
    }
  });

  it('answers for an id it does not know', () => {
    expect(isSupportedCountry('zz')).toBe(false);
    expect(countryName('zz')).toBe('');
  });
});

describe('detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearHolidayCache();
  });

  // Detection is memoised for the session, so each stub needs a clean slate.
  const withZone = (timeZone) => {
    clearHolidayCache();
    return vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({ resolvedOptions: () => ({ timeZone }) }));
  };

  it('reads the country off the browser time zone', () => {
    withZone('Europe/London');
    expect(detectCountry()).toBe('uk');
    vi.restoreAllMocks();
    withZone('Asia/Tokyo');
    expect(detectCountry()).toBe('jp');
    vi.restoreAllMocks();
    withZone('Australia/Perth');
    expect(detectCountry()).toBe('au');
    vi.restoreAllMocks();
    withZone('America/Toronto');
    expect(detectCountry()).toBe('ca');
    vi.restoreAllMocks();
    withZone('America/Chicago');
    expect(detectCountry()).toBe('us');
  });

  it('does not read every America/* zone as the United States', () => {
    // `America/` is not a US wildcard: it also holds most of Latin America,
    // where answering "us" would put Thanksgiving on the calendar of someone
    // who does not observe it.
    for (const zone of [
      'America/Mexico_City',
      'America/Sao_Paulo',
      'America/Bogota',
      'America/Argentina/Buenos_Aires',
      'America/Havana',
      'America/Santiago',
      'America/Guatemala',
    ]) {
      vi.restoreAllMocks();
      withZone(zone);
      vi.stubGlobal('navigator', { language: 'es-MX', languages: ['es-MX'] });
      expect(detectCountry()).toBe('');
    }
  });

  it('reads the legacy zone aliases and the multi-level US zones', () => {
    withZone('America/Indiana/Indianapolis');
    expect(detectCountry()).toBe('us');
    vi.restoreAllMocks();
    withZone('America/Kentucky/Louisville');
    expect(detectCountry()).toBe('us');
    vi.restoreAllMocks();
    withZone('US/Eastern');
    expect(detectCountry()).toBe('us');
    vi.restoreAllMocks();
    withZone('Canada/Pacific');
    expect(detectCountry()).toBe('ca');
  });

  it('still finds a US user whose zone is an unlisted alias, via the locale', () => {
    withZone('America/Fort_Wayne');
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
    expect(detectCountry()).toBe('us');
  });

  it('prefers where the user is over what they read', () => {
    withZone('Europe/Berlin');
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
    expect(detectCountry()).toBe('de');
  });

  it('falls back to the locale when the zone means nothing here', () => {
    withZone('Africa/Nairobi');
    vi.stubGlobal('navigator', { language: 'es-ES', languages: ['es-ES'] });
    expect(detectCountry()).toBe('es');
  });

  it('maximizes a language-only tag', () => {
    withZone('Africa/Nairobi');
    vi.stubGlobal('navigator', { language: 'nl', languages: ['nl'] });
    expect(detectCountry()).toBe('nl');
  });

  it('gives up cleanly when neither signal is supported', () => {
    withZone('Africa/Nairobi');
    vi.stubGlobal('navigator', { language: 'sw-KE', languages: ['sw-KE'] });
    expect(detectCountry()).toBe('');
  });

  it('survives an environment with no Intl time zone and no navigator', () => {
    clearHolidayCache();
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('nope');
    });
    vi.stubGlobal('navigator', undefined);
    expect(detectCountry()).toBe('');
  });
});

describe('resolveHolidayCountry', () => {
  beforeEach(() => clearHolidayCache());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearHolidayCache();
  });

  it('passes a supported id straight through', () => {
    expect(resolveHolidayCountry('jp')).toBe('jp');
  });

  it('treats the empty string as off, and never detects for it', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
      resolvedOptions: () => ({ timeZone: 'Europe/London' }),
    }));
    expect(resolveHolidayCountry('')).toBe('');
  });

  it('detects for "auto" and for a missing setting', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
      resolvedOptions: () => ({ timeZone: 'Europe/Paris' }),
    }));
    expect(resolveHolidayCountry('auto')).toBe('fr');
    expect(resolveHolidayCountry(undefined)).toBe('fr');
    expect(resolveHolidayCountry(null)).toBe('fr');
  });

  it('falls back to off for an id it does not know', () => {
    expect(resolveHolidayCountry('atlantis')).toBe('');
  });
});
