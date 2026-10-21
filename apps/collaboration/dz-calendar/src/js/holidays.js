/**
 * Public holidays — a computed, read-only overlay on the calendar.
 *
 * Holidays are NEVER stored. They are derived from a small rule set at render
 * time, which is what makes the feature free of every cost a stored holiday
 * calendar carries: nothing to sync, no `puter.kv` writes, no reconciliation
 * when the user switches country or scrolls to a year they have never opened,
 * nothing to accidentally edit, nothing that leaks into an `.ics` export as if
 * it were the user's own event, and nothing a reminder can fire on. It also
 * works offline for every year, past or future, because there is no data to
 * fetch — the rules ARE the data.
 *
 * Dates are computed on day numbers (whole days since the epoch, UTC) rather
 * than Date objects, so none of the arithmetic below can be bent by a DST
 * transition; only the final conversion in `getHolidaysInRange` touches local
 * time, where an all-day item must sit on local midnight like every other
 * all-day event in the app.
 *
 * Coverage is deliberately NATIONAL only — no states, provinces or Länder. A
 * per-subdivision calendar is a different (much larger) data problem, and a
 * half-populated one would be worse than none: a Berliner would trust the
 * absence of a holiday that the calendar simply never knew about. Known gaps
 * are documented per country below and in the README.
 */

const MS_PER_DAY = 86_400_000;

/* ---- Day-number arithmetic -------------------------------------------- */

/** Whole days since 1970-01-01, from a civil (y, m, d) date. m is 1-12. */
const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / MS_PER_DAY;

/** The civil date a day number names. */
function civil(n) {
  const dt = new Date(n * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Day of week, 0 = Sunday (matches Date.prototype.getDay). Day 0 — the epoch
 *  — was a Thursday; the +11 keeps the result non-negative for pre-1970 day
 *  numbers, where JS's `%` yields a negative remainder. */
const dowOf = (n) => ((n % 7) + 11) % 7;

/** The nth weekday of a month as a day number. `nth` is 1-5, or -1 for the
 *  last one in the month. */
function nthWeekday(y, m, nth, dow) {
  if (nth > 0) {
    const first = dayNum(y, m, 1);
    return first + ((dow - dowOf(first) + 7) % 7) + (nth - 1) * 7;
  }
  // Date.UTC rolls m = 13 into the next January, so this is the last of month m.
  const last = dayNum(y, m + 1, 1) - 1;
  return last - ((dowOf(last) - dow + 7) % 7);
}

/**
 * Western (Gregorian) Easter Sunday — the anonymous Gregorian algorithm
 * (Meeus/Jones/Butcher). Every movable feast in the countries below hangs off
 * this one date: Good Friday is −2, Easter Monday +1, Ascension +39, Whit
 * Monday +50. Exported for the tests, which check it against known years.
 */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const easterDay = (y) => {
  const { month, day } = easterSunday(y);
  return dayNum(y, month, day);
};

/**
 * Japan's equinox days are astronomical, not calendrical. These are the
 * standard approximations, accurate for 1980-2099 — the only range the app can
 * meaningfully be scrolled to, and beyond which the National Astronomical
 * Observatory has not fixed the dates anyway.
 */
const vernalEquinox = (y) => dayNum(y, 3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)));
const autumnalEquinox = (y) => dayNum(y, 9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)));

/* ---- Country rules ------------------------------------------------------
 *
 * A rule resolves to one day number for a given year, in one of four shapes:
 *
 *   { month, day }        a fixed calendar date
 *   { month, nth, dow }   the nth weekday of a month (nth: 1-5, or -1 = last)
 *   { easter: offset }    days from Easter Sunday (negative = before)
 *   { on: (year) => n }   anything the other three cannot express
 *
 * `from` / `to` bound a rule to a range of years (inclusive), which is how
 * holidays that were introduced, renamed, moved or abolished are modelled —
 * two rules with disjoint ranges rather than a special case in the engine.
 *
 * `observe: true` opts a rule into its country's weekend-substitution
 * strategy (see `observedDay`). It is per-rule, not per-country, because the
 * distinction is real: Australia Day moves to the Monday when it lands on a
 * weekend, and Anzac Day, four days earlier in the same list, does not.
 *
 * Names are in English throughout, matching the rest of the UI, using the name
 * a speaker of English is most likely to recognise.
 */
const COUNTRIES = [
  {
    id: 'dz',
    name: 'الجزائر / Algeria',
    bridgeName: 'عطلة وطنية رسمية',
    rules: [
      { name: 'رأس السنة الميلادية (Nouvel An)', month: 1, day: 1 },
      { name: 'رأس السنة الأمازيغية (Yennayer)', month: 1, day: 12 },
      { name: 'عيد العمال (Fête du Travail)', month: 5, day: 1 },
      { name: 'عيد الاستقلال والشباب (Fête de l\'Indépendance)', month: 7, day: 5 },
      { name: 'عيد الثورة التحريرية المجيدة (Fête de la Révolution)', month: 11, day: 1 },
    ],
  },
  {
    id: 'us',
    name: 'United States',
    // Federal holidays. A Saturday holiday is observed the Friday before, a
    // Sunday holiday the Monday after (5 U.S.C. 6103).
    observe: 'us',
    rules: [
      { name: "New Year's Day", month: 1, day: 1, observe: true },
      { name: 'Martin Luther King Jr. Day', month: 1, nth: 3, dow: 1, from: 1986 },
      // Legally "Washington's Birthday"; nobody calls it that.
      { name: "Presidents' Day", month: 2, nth: 3, dow: 1 },
      { name: 'Memorial Day', month: 5, nth: -1, dow: 1 },
      { name: 'Juneteenth', month: 6, day: 19, from: 2021, observe: true },
      { name: 'Independence Day', month: 7, day: 4, observe: true },
      { name: 'Labor Day', month: 9, nth: 1, dow: 1 },
      { name: 'Columbus Day', month: 10, nth: 2, dow: 1 },
      { name: 'Veterans Day', month: 11, day: 11, observe: true },
      { name: 'Thanksgiving Day', month: 11, nth: 4, dow: 4 },
      { name: 'Christmas Day', month: 12, day: 25, observe: true },
    ],
  },
  {
    id: 'uk',
    name: 'United Kingdom',
    // England & Wales bank holidays. Scotland (2 Jan, St Andrew's Day, a
    // different August holiday) and Northern Ireland (St Patrick's Day, the
    // Twelfth) differ; see the README.
    observe: 'next-weekday',
    rules: [
      { name: "New Year's Day", month: 1, day: 1, observe: true },
      { name: 'Good Friday', easter: -2 },
      { name: 'Easter Monday', easter: 1 },
      // Introduced in 1978. 1995 moved it to Monday 8 May for the 50th
      // anniversary of VE Day, and 2020 to Friday 8 May for the 75th.
      { name: 'Early May Bank Holiday', month: 5, nth: 1, dow: 1, from: 1978, to: 1994 },
      { name: 'Early May Bank Holiday', on: () => dayNum(1995, 5, 8), from: 1995, to: 1995 },
      { name: 'Early May Bank Holiday', month: 5, nth: 1, dow: 1, from: 1996, to: 2019 },
      { name: 'Early May Bank Holiday', on: () => dayNum(2020, 5, 8), from: 2020, to: 2020 },
      { name: 'Early May Bank Holiday', month: 5, nth: 1, dow: 1, from: 2021 },
      // The Spring holiday moves for a jubilee, and the jubilee day itself is
      // added beside it: 1977 (Silver), 2002 (Golden), 2012 (Diamond), 2022
      // (Platinum, on the Thursday).
      { name: 'Spring Bank Holiday', month: 5, nth: -1, dow: 1, to: 1976 },
      { name: 'Spring Bank Holiday', on: () => dayNum(1977, 6, 6), from: 1977, to: 1977 },
      { name: 'Silver Jubilee Bank Holiday', on: () => dayNum(1977, 6, 7), from: 1977, to: 1977 },
      { name: 'Spring Bank Holiday', month: 5, nth: -1, dow: 1, from: 1978, to: 2001 },
      { name: 'Golden Jubilee Bank Holiday', on: () => dayNum(2002, 6, 3), from: 2002, to: 2002 },
      { name: 'Spring Bank Holiday', on: () => dayNum(2002, 6, 4), from: 2002, to: 2002 },
      { name: 'Spring Bank Holiday', month: 5, nth: -1, dow: 1, from: 2003, to: 2011 },
      { name: 'Spring Bank Holiday', on: () => dayNum(2012, 6, 4), from: 2012, to: 2012 },
      { name: 'Diamond Jubilee Bank Holiday', on: () => dayNum(2012, 6, 5), from: 2012, to: 2012 },
      { name: 'Spring Bank Holiday', month: 5, nth: -1, dow: 1, from: 2013, to: 2021 },
      { name: 'Spring Bank Holiday', on: () => dayNum(2022, 6, 2), from: 2022, to: 2022 },
      { name: 'Platinum Jubilee Bank Holiday', on: () => dayNum(2022, 6, 3), from: 2022, to: 2022 },
      { name: 'Spring Bank Holiday', month: 5, nth: -1, dow: 1, from: 2023 },
      // One-off days.
      { name: 'Royal Wedding Bank Holiday', on: () => dayNum(1981, 7, 29), from: 1981, to: 1981 },
      { name: 'Millennium Bank Holiday', on: () => dayNum(1999, 12, 31), from: 1999, to: 1999 },
      { name: 'Royal Wedding Bank Holiday', on: () => dayNum(2011, 4, 29), from: 2011, to: 2011 },
      { name: 'Bank Holiday for the State Funeral of Queen Elizabeth II', on: () => dayNum(2022, 9, 19), from: 2022, to: 2022 },
      { name: 'Bank Holiday for the Coronation of King Charles III', on: () => dayNum(2023, 5, 8), from: 2023, to: 2023 },
      { name: 'Summer Bank Holiday', month: 8, nth: -1, dow: 1 },
      { name: 'Christmas Day', month: 12, day: 25, observe: true },
      { name: 'Boxing Day', month: 12, day: 26, observe: true },
    ],
  },
  {
    id: 'ca',
    name: 'Canada',
    // Federal statutory holidays (Canada Labour Code). Provincial days — Family
    // Day, St-Jean-Baptiste, Civic Holiday — are not national and are omitted.
    observe: 'next-weekday',
    rules: [
      { name: "New Year's Day", month: 1, day: 1, observe: true },
      { name: 'Good Friday', easter: -2 },
      // The Monday on or before 24 May.
      { name: 'Victoria Day', on: (y) => { const n = dayNum(y, 5, 24); return n - ((dowOf(n) - 1 + 7) % 7); } },
      { name: 'Canada Day', month: 7, day: 1, observe: true },
      { name: 'Labour Day', month: 9, nth: 1, dow: 1 },
      { name: 'National Day for Truth and Reconciliation', month: 9, day: 30, from: 2021, observe: true },
      { name: 'Thanksgiving Day', month: 10, nth: 2, dow: 1 },
      { name: 'Remembrance Day', month: 11, day: 11, observe: true },
      { name: 'Christmas Day', month: 12, day: 25, observe: true },
      { name: 'Boxing Day', month: 12, day: 26, observe: true },
    ],
  },
  {
    id: 'au',
    name: 'Australia',
    // Holidays observed nationally. Easter Saturday, Labour Day and the state
    // show days vary by state and are omitted; Western Australia and Queensland
    // hold the monarch's birthday on their own dates.
    observe: 'next-weekday',
    rules: [
      { name: "New Year's Day", month: 1, day: 1, observe: true },
      { name: 'Australia Day', month: 1, day: 26, observe: true },
      { name: 'Good Friday', easter: -2 },
      { name: 'Easter Monday', easter: 1 },
      // Anzac Day is marked on the day itself in the eastern states — no
      // substitute — which is why it does not opt into `observe`.
      { name: 'Anzac Day', month: 4, day: 25 },
      { name: "Queen's Birthday", month: 6, nth: 2, dow: 1, to: 2022 },
      { name: "King's Birthday", month: 6, nth: 2, dow: 1, from: 2023 },
      { name: 'Christmas Day', month: 12, day: 25, observe: true },
      { name: 'Boxing Day', month: 12, day: 26, observe: true },
    ],
  },
  {
    id: 'de',
    name: 'Germany',
    // Bundesweite Feiertage only. Epiphany, Corpus Christi, Assumption, Reformation
    // Day and All Saints' are Länder holidays and are omitted. Germany has no
    // weekend substitution at all — a holiday on a Sunday is simply lost.
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Good Friday', easter: -2 },
      { name: 'Easter Monday', easter: 1 },
      { name: 'Labour Day', month: 5, day: 1 },
      { name: 'Ascension Day', easter: 39 },
      { name: 'Whit Monday', easter: 50 },
      // Reunification moved the day of unity: West Germany's 17 June (the 1953
      // uprising) held through 1990, the year 3 October was first observed —
      // both fell in that one year.
      { name: 'German Unity Day', month: 6, day: 17, to: 1990 },
      { name: 'German Unity Day', month: 10, day: 3, from: 1990 },
      // Buß- und Bettag — the Wednesday before 23 November — was a nationwide
      // holiday until 1994; from 1995 only Saxony keeps it.
      { name: 'Day of Repentance and Prayer', on: (y) => { const n = dayNum(y, 11, 22); return n - ((dowOf(n) - 3 + 7) % 7); }, to: 1994 },
      { name: 'Christmas Day', month: 12, day: 25 },
      { name: 'Second Day of Christmas', month: 12, day: 26 },
    ],
  },
  {
    id: 'fr',
    name: 'France',
    // Jours fériés (métropole). Alsace-Moselle additionally keeps Good Friday
    // and St Stephen's Day.
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Easter Monday', easter: 1 },
      { name: 'Labour Day', month: 5, day: 1 },
      { name: 'Victory in Europe Day', month: 5, day: 8 },
      { name: 'Ascension Day', easter: 39 },
      { name: 'Whit Monday', easter: 50 },
      { name: 'Bastille Day', month: 7, day: 14 },
      { name: 'Assumption of Mary', month: 8, day: 15 },
      { name: "All Saints' Day", month: 11, day: 1 },
      { name: 'Armistice Day', month: 11, day: 11 },
      { name: 'Christmas Day', month: 12, day: 25 },
    ],
  },
  {
    id: 'nl',
    name: 'Netherlands',
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Good Friday', easter: -2 },
      { name: 'Easter Sunday', easter: 0 },
      { name: 'Easter Monday', easter: 1 },
      // Queen's Day, then King's Day from the 2013 abdication. Both move BACK a
      // day when they fall on a Sunday — a genuine move, not an added
      // substitute: the nominal date is not celebrated at all.
      { name: "Queen's Day", on: (y) => { const n = dayNum(y, 4, 30); return dowOf(n) === 0 ? n - 1 : n; }, to: 2013 },
      { name: "King's Day", on: (y) => { const n = dayNum(y, 4, 27); return dowOf(n) === 0 ? n - 1 : n; }, from: 2014 },
      { name: 'Liberation Day', month: 5, day: 5 },
      { name: 'Ascension Day', easter: 39 },
      { name: 'Whit Sunday', easter: 49 },
      { name: 'Whit Monday', easter: 50 },
      { name: 'Christmas Day', month: 12, day: 25 },
      { name: 'Second Day of Christmas', month: 12, day: 26 },
    ],
  },
  {
    id: 'es',
    name: 'Spain',
    // Fiestas nacionales. The autonomous communities each add their own, and
    // each decides how to move a national holiday that falls on a Sunday —
    // which is why nothing here substitutes.
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Epiphany', month: 1, day: 6 },
      { name: 'Good Friday', easter: -2 },
      { name: 'Labour Day', month: 5, day: 1 },
      { name: 'Assumption of Mary', month: 8, day: 15 },
      { name: 'National Day', month: 10, day: 12 },
      { name: "All Saints' Day", month: 11, day: 1 },
      { name: 'Constitution Day', month: 12, day: 6 },
      { name: 'Immaculate Conception', month: 12, day: 8 },
      { name: 'Christmas Day', month: 12, day: 25 },
    ],
  },
  {
    id: 'in',
    name: 'India',
    // The three gazetted holidays observed nationwide. Diwali, Holi, the Eids
    // and the rest are lunar or lunisolar: their dates come from an ephemeris
    // (and, for the Islamic ones, from a local moon sighting), so no rule can
    // derive them and this module will not pretend otherwise. See the README
    // for how to add them as dated entries.
    rules: [
      { name: 'Republic Day', month: 1, day: 26 },
      { name: 'Independence Day', month: 8, day: 15 },
      { name: 'Gandhi Jayanti', month: 10, day: 2 },
    ],
  },
  {
    id: 'jp',
    name: 'Japan',
    // A holiday falling on a Sunday moves to the next free day (振替休日), and a
    // single ordinary day caught between two holidays becomes one itself
    // (国民の休日) — the rule that produces September's "Silver Week".
    //
    // Accurate from 2000, when the second Happy Monday move landed. Before
    // that Sports Day was 10 October rather than a Monday, and before 1989
    // the Emperor's Birthday was 29 April, not 23 December — neither is
    // modelled here (see the README).
    observe: 'sunday',
    bridge: true,
    bridgeName: "Citizens' Holiday",
    rules: [
      { name: "New Year's Day", month: 1, day: 1, observe: true },
      { name: 'Coming of Age Day', month: 1, day: 15, to: 1999, observe: true },
      { name: 'Coming of Age Day', month: 1, nth: 2, dow: 1, from: 2000 },
      { name: 'National Foundation Day', month: 2, day: 11, observe: true },
      { name: "Emperor's Birthday", month: 12, day: 23, to: 2018, observe: true },
      { name: "Emperor's Birthday", month: 2, day: 23, from: 2020, observe: true },
      { name: 'Vernal Equinox Day', on: vernalEquinox, observe: true },
      { name: 'Greenery Day', month: 4, day: 29, to: 2006, observe: true },
      { name: 'Showa Day', month: 4, day: 29, from: 2007, observe: true },
      // The 2019 abdication put two one-off holidays on the calendar, and the
      // bridge rule below turns 30 April and 2 May into holidays of their own
      // — the ten-day Golden Week the country actually had that year.
      { name: "Emperor's Enthronement Day", on: () => dayNum(2019, 5, 1), from: 2019, to: 2019 },
      { name: 'Constitution Memorial Day', month: 5, day: 3, observe: true },
      { name: 'Greenery Day', month: 5, day: 4, from: 2007, observe: true },
      { name: "Children's Day", month: 5, day: 5, observe: true },
      { name: 'Marine Day', month: 7, day: 20, from: 1996, to: 2002, observe: true },
      { name: 'Marine Day', month: 7, nth: 3, dow: 1, from: 2003, to: 2019 },
      // Tokyo 2020: Marine Day, Sports Day and Mountain Day were moved to sit
      // around the opening and closing ceremonies, in both the postponed and
      // the original year.
      { name: 'Marine Day', on: () => dayNum(2020, 7, 23), from: 2020, to: 2020 },
      { name: 'Marine Day', on: () => dayNum(2021, 7, 22), from: 2021, to: 2021 },
      { name: 'Marine Day', month: 7, nth: 3, dow: 1, from: 2022 },
      { name: 'Mountain Day', month: 8, day: 11, from: 2016, to: 2019, observe: true },
      { name: 'Mountain Day', on: () => dayNum(2020, 8, 10), from: 2020, to: 2020 },
      { name: 'Mountain Day', on: () => dayNum(2021, 8, 8), from: 2021, to: 2021, observe: true },
      { name: 'Mountain Day', month: 8, day: 11, from: 2022, observe: true },
      { name: 'Respect for the Aged Day', month: 9, day: 15, to: 2002, observe: true },
      { name: 'Respect for the Aged Day', month: 9, nth: 3, dow: 1, from: 2003 },
      { name: 'Autumnal Equinox Day', on: autumnalEquinox, observe: true },
      { name: 'Health and Sports Day', month: 10, nth: 2, dow: 1, to: 2019 },
      { name: 'Sports Day', on: () => dayNum(2020, 7, 24), from: 2020, to: 2020 },
      { name: 'Sports Day', on: () => dayNum(2021, 7, 23), from: 2021, to: 2021 },
      { name: 'Sports Day', month: 10, nth: 2, dow: 1, from: 2022 },
      { name: 'Enthronement Ceremony Day', on: () => dayNum(2019, 10, 22), from: 2019, to: 2019 },
      { name: 'Culture Day', month: 11, day: 3, observe: true },
      { name: 'Labour Thanksgiving Day', month: 11, day: 23, observe: true },
    ],
  },
];

const BY_ID = new Map(COUNTRIES.map((c) => [c.id, c]));

/** `[{ id, name }]` for the settings picker, in the order declared above. */
export const HOLIDAY_COUNTRIES = COUNTRIES.map(({ id, name }) => ({ id, name }));

export function isSupportedCountry(id) {
  return BY_ID.has(id);
}

export function countryName(id) {
  const c = BY_ID.get(id);
  return c ? c.name : '';
}

/* ---- Generation --------------------------------------------------------- */

function resolveRule(rule, year) {
  if (rule.on) return rule.on(year);
  if (rule.easter != null) return easterDay(year) + rule.easter;
  if (rule.nth != null) return nthWeekday(year, rule.month, rule.nth, rule.dow);
  return dayNum(year, rule.month, rule.day);
}

/**
 * Where a holiday landing on a weekend is actually taken. Returns null when
 * the strategy leaves this date alone.
 *
 * The moved day is added ALONGSIDE the real one rather than replacing it: 25
 * December is Christmas Day whatever weekday it falls on, and the Monday off
 * is a second, separate entry — which is both what the statutes say and what
 * every other calendar shows.
 */
function observedDay(strategy, n, taken) {
  const dow = dowOf(n);
  if (strategy === 'us') {
    if (dow === 6) return n - 1; // Saturday → the Friday before
    if (dow === 0) return n + 1; // Sunday → the Monday after
    return null;
  }
  if (strategy === 'next-weekday') {
    if (dow !== 0 && dow !== 6) return null;
    // Walk forward to the first weekday nothing else has claimed, so Christmas
    // and Boxing Day on a Sat/Sun take the Monday and the Tuesday, not both
    // the Monday.
    let m = n + (dow === 6 ? 2 : 1);
    while (dowOf(m) === 0 || dowOf(m) === 6 || taken.has(m)) m += 1;
    return m;
  }
  if (strategy === 'sunday') {
    if (dow !== 0) return null;
    let m = n + 1;
    while (taken.has(m)) m += 1;
    return m;
  }
  return null;
}

/**
 * Every holiday a country observes in one year, as `{ n, name, observed }`
 * sorted by day number.
 *
 * The result can spill a day either side of the year — a US New Year's Day on
 * a Saturday is observed on 31 December of the year before — which is why
 * `getHolidaysInRange` always generates a year of padding at each end.
 */
function generate(country, year) {
  const base = [];
  for (const rule of country.rules) {
    if (rule.from != null && year < rule.from) continue;
    if (rule.to != null && year > rule.to) continue;
    const n = resolveRule(rule, year);
    if (Number.isFinite(n)) base.push({ n, name: rule.name, observe: Boolean(rule.observe) });
  }
  base.sort((a, b) => a.n - b.n);

  // `taken` is the authority on which DAYS are already spoken for, and it is
  // filled as we go: a substitute has to see the substitutes assigned before it.
  //
  // A day being taken does not make a second holiday on it a duplicate, which
  // is why nothing here collapses one: two different feasts genuinely land
  // together now and then, since a movable one sweeps a five-week window
  // across the fixed dates. Ascension Day falls on Labour Day (2008), on VE
  // Day in France (1997, 2059, 2070, 2081, 2092) and on Liberation Day in the
  // Netherlands (2005, 2016); Easter Monday falls on Anzac Day (2011, 2095).
  // Keeping only the first by rule order would drop whichever the list
  // happens to mention later — Anzac Day, of the two — so both are listed,
  // exactly as every printed calendar for those years does.
  const taken = new Set();
  const seen = new Set(); // `${day}|${name}` — the real duplicate to guard against
  const out = [];
  for (const h of base) {
    const key = `${h.n}|${h.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    taken.add(h.n);
    out.push({ n: h.n, name: h.name, observed: false });
  }

  if (country.observe) {
    for (const h of base) {
      if (!h.observe) continue;
      const moved = observedDay(country.observe, h.n, taken);
      if (moved == null || moved === h.n || taken.has(moved)) continue;
      taken.add(moved);
      out.push({ n: moved, name: `${h.name} (observed)`, observed: true });
    }
  }

  if (country.bridge) {
    const days = [...taken].sort((a, b) => a - b);
    // A day is bridged when both its neighbours are holidays, it is not one
    // itself, and it is not a Sunday (a Sunday is never a working day to give
    // back). Collected first, then added, so one bridge cannot seed another.
    const bridged = [];
    for (const n of days) {
      const gap = n + 1;
      if (taken.has(gap) || !taken.has(gap + 1)) continue;
      if (dowOf(gap) === 0) continue;
      bridged.push(gap);
    }
    for (const n of bridged) {
      if (taken.has(n)) continue;
      taken.add(n);
      out.push({ n, name: country.bridgeName || 'Public Holiday', observed: false, bridged: true });
    }
  }

  // The name breaks a same-day tie, so a doubled day is numbered in `yearHolidays`
  // in the order `getHolidaysInRange` will hand the two items out.
  return out.sort((a, b) => a.n - b.n || a.name.localeCompare(b.name));
}

/**
 * One year of finished overlay objects, memoised.
 *
 * The whole object — local-midnight bounds, id and all — is built here rather
 * than in `getHolidaysInRange`, because the month view asks for holidays once
 * per CELL: forty-two calls per render, each of which would otherwise rebuild
 * three years of Date objects only to throw all but one day of them away. With
 * the year cached, a cell costs a handful of numeric comparisons.
 *
 * The objects are frozen and shared between calls, which is what makes handing
 * out the cached copies safe — and makes `readOnly` mean something rather than
 * being a label nothing enforces.
 *
 * The cache is capped so a long session spent scrubbing through decades cannot
 * grow it without bound. It holds local-time values, so it is keyed to the
 * session's time zone; `clearHolidayCache` is the way back out.
 */
const CACHE_MAX = 96;
const cache = new Map();

function yearHolidays(country, year) {
  const key = `${country.id}:${year}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const perDay = new Map(); // how many entries a day has already produced
  const value = generate(country, year).map((h) => {
    const { y, m, d } = civil(h.n);
    const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    // Ordinal of this entry within its day: 0 for the only (or first) holiday
    // there, which keeps the plain `hol:us:2026-12-25` shape for all but the
    // rare doubled day (see `generate`), where the second needs its own id.
    const nth = perDay.get(day) || 0;
    perDay.set(day, nth + 1);
    return Object.freeze({
      // Stable across renders and unique per item: the views use it as a key,
      // and two countries' lists are never mixed.
      id: `hol:${country.id}:${day}${nth ? `#${nth + 1}` : ''}`,
      holiday: true,
      readOnly: true,
      title: h.name,
      allDay: true,
      start: new Date(y, m - 1, d).getTime(),
      end: new Date(y, m - 1, d + 1).getTime(),
      observed: Boolean(h.observed),
      bridged: Boolean(h.bridged),
      countryId: country.id,
      countryName: country.name,
    });
  });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

/** Drop every memoised year and the detected country. Only the tests need this. */
export function clearHolidayCache() {
  cache.clear();
  detected = undefined;
}

/* ---- Country detection -------------------------------------------------- */

const REGION_TO_COUNTRY = {
  DZ: 'dz', US: 'us', GB: 'uk', CA: 'ca', AU: 'au', DE: 'de',
  FR: 'fr', NL: 'nl', ES: 'es', IN: 'in', JP: 'jp',
};

// Where the user is beats what language they read in: an American working in
// Berlin wants German holidays, and their browser still says en-US. Only the
// zones of the ten supported countries are listed — anything else falls
// through to the locale, and then to nothing.
//
// The list is exhaustive on purpose: `America/*` is NOT a US wildcard. It also
// holds Mexico City, São Paulo, Bogotá, Buenos Aires, Havana, Lima, Santiago
// and thirty more, and answering "us" for those would put Thanksgiving and the
// Fourth of July on the calendar of someone who observes neither — a wrong
// answer that looks authoritative. Falling through instead costs a US user
// nothing: an unlisted alias (`America/Fort_Wayne`) still resolves through
// their en-US locale, while es-MX and pt-BR correctly resolve to nothing.
const ZONE_TO_COUNTRY = {
  'Africa/Algiers': 'dz',
  'Europe/London': 'uk',
  'Europe/Berlin': 'de', 'Europe/Busingen': 'de',
  'Europe/Paris': 'fr',
  'Europe/Amsterdam': 'nl',
  'Europe/Madrid': 'es', 'Africa/Ceuta': 'es', 'Atlantic/Canary': 'es',
  'Asia/Kolkata': 'in', 'Asia/Calcutta': 'in',
  'Asia/Tokyo': 'jp',
  'America/New_York': 'us', 'America/Detroit': 'us', 'America/Chicago': 'us',
  'America/Menominee': 'us', 'America/Denver': 'us', 'America/Boise': 'us',
  'America/Phoenix': 'us', 'America/Los_Angeles': 'us', 'America/Anchorage': 'us',
  'America/Juneau': 'us', 'America/Sitka': 'us', 'America/Metlakatla': 'us',
  'America/Yakutat': 'us', 'America/Nome': 'us', 'America/Adak': 'us',
  'America/Puerto_Rico': 'us', 'Pacific/Honolulu': 'us',
  'America/Toronto': 'ca', 'America/Vancouver': 'ca', 'America/Edmonton': 'ca',
  'America/Winnipeg': 'ca', 'America/Halifax': 'ca', 'America/St_Johns': 'ca',
  'America/Regina': 'ca', 'America/Moncton': 'ca', 'America/Whitehorse': 'ca',
  'America/Yellowknife': 'ca', 'America/Iqaluit': 'ca', 'America/Dawson_Creek': 'ca',
  'America/Fort_Nelson': 'ca', 'America/Swift_Current': 'ca', 'America/Goose_Bay': 'ca',
  'America/Glace_Bay': 'ca', 'America/Blanc-Sablon': 'ca', 'America/Atikokan': 'ca',
  'America/Cambridge_Bay': 'ca', 'America/Inuvik': 'ca', 'America/Rankin_Inlet': 'ca',
  'America/Resolute': 'ca', 'America/Creston': 'ca', 'America/Dawson': 'ca',
};

// The only prefixes that belong to exactly one supported country: every
// `Australia/*` zone is Australian, the three multi-level American groups are
// all US states, and `US/*` / `Canada/*` are the legacy aliases for those two.
const ZONE_PREFIX_TO_COUNTRY = [
  ['Australia/', 'au'],
  ['America/Indiana/', 'us'],
  ['America/Kentucky/', 'us'],
  ['America/North_Dakota/', 'us'],
  ['US/', 'us'],
  ['Canada/', 'ca'],
];

function zoneCountry(zone) {
  if (!zone) return '';
  if (ZONE_TO_COUNTRY[zone]) return ZONE_TO_COUNTRY[zone];
  for (const [prefix, id] of ZONE_PREFIX_TO_COUNTRY) {
    if (zone.startsWith(prefix)) return id;
  }
  return '';
}

function localeCountry() {
  const tags = [];
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) tags.push(...navigator.languages);
    if (navigator.language) tags.push(navigator.language);
  }
  for (const tag of tags) {
    let region = '';
    try {
      // maximize() turns a bare "de" into "de-Latn-DE"; without it a browser
      // set to a language-only tag would never resolve to anything.
      region = new Intl.Locale(tag).maximize().region || '';
    } catch {
      const parts = String(tag).split('-');
      region = parts.length > 1 ? parts[1].toUpperCase() : '';
    }
    if (REGION_TO_COUNTRY[region]) return REGION_TO_COUNTRY[region];
  }
  return '';
}

/**
 * The country to use when the setting is left on "Automatic": the browser's
 * time zone first, its language second, nothing if neither is one of the ten.
 * Guessing wrong is cheap — the picker is two clicks away — but guessing at all
 * is what makes the feature visible to the people who would never go looking
 * for it in settings.
 */
let detected;

export function detectCountry() {
  // Memoised: neither the browser's zone nor its languages change mid-session,
  // and this is reached once per range query — forty-two times in a month
  // render, where building a DateTimeFormat each time is pure waste.
  if (detected !== undefined) return detected;
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* no Intl time zone — fall through to the locale */
  }
  detected = zoneCountry(zone) || localeCountry();
  return detected;
}

/**
 * Turn the stored `holidayCountry` setting into a country id, or '' for off.
 * '' means the user turned holidays off; 'auto' (the default) defers to
 * `detectCountry`; anything else is used as-is if it is supported.
 */
export function resolveHolidayCountry(setting) {
  if (setting === 'auto' || setting == null) return detectCountry();
  return isSupportedCountry(setting) ? setting : '';
}

/* ---- The overlay -------------------------------------------------------- */

/**
 * Public holidays intersecting `[from, to)` as read-only, event-shaped objects.
 *
 * `country` is a resolved id, not the raw setting — callers that hold the
 * settings should pass `resolveHolidayCountry(settings.holidayCountry)`.
 *
 * The objects deliberately carry `holiday: true` and `readOnly: true`: every
 * surface that renders them has to opt out of the editing affordances an event
 * gets, and a flag on the item is far harder to forget than a parallel list.
 */
export function getHolidaysInRange(country, from, to) {
  const c = BY_ID.get(country);
  if (!c || !(to > from)) return [];

  // A year of padding at each end: a holiday generated under year Y can be
  // observed on 31 December of Y-1, and the range may start mid-December.
  const firstYear = new Date(from).getFullYear() - 1;
  const lastYear = new Date(to - 1).getFullYear() + 1;

  const out = [];
  for (let year = firstYear; year <= lastYear; year++) {
    for (const h of yearHolidays(c, year)) {
      if (h.start < to && h.end > from) out.push(h);
    }
  }
  // Two entries can share a day only across the country's own list, which
  // `generate` already de-duplicates; sorting keeps a padded year's spillover
  // in date order with the rest.
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
