import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSupportedCountry,
  resolveHolidayCountry,
  getHolidaysInRange,
  HOLIDAY_COUNTRIES,
  clearHolidayCache
} from '../src/js/holidays.js';

import {
  addDays,
  startOfMonth,
  startOfDay,
  formatMonthYear,
  formatFullDate,
  formatDateRange
} from '../src/js/date-utils.js';

describe('DZ-Calendar Sovereign Engine Tests', () => {

  it('recognizes Algeria (dz) as a first-class supported country', () => {
    assert.equal(isSupportedCountry('dz'), true);
    assert.equal(isSupportedCountry('us'), true);
    assert.equal(isSupportedCountry('nonexistent'), false);

    const algeriaMeta = HOLIDAY_COUNTRIES.find(c => c.id === 'dz');
    assert.ok(algeriaMeta, 'Algeria should exist in HOLIDAY_COUNTRIES');
    assert.match(algeriaMeta.name, /الجزائر/);
  });

  it('generates the 5 permanent Algerian civil & national holidays', () => {
    clearHolidayCache();
    // Test for year 2026
    const from = new Date(2026, 0, 1).getTime();
    const to = new Date(2026, 11, 31, 23, 59, 59).getTime();

    const holidays = getHolidaysInRange('dz', from, to);
    assert.ok(holidays.length >= 5, `Expected at least 5 holidays, got ${holidays.length}`);

    const titles = holidays.map(h => h.title);
    
    // Check key national dates
    assert.ok(titles.some(t => t.includes('Nouvel An') || t.includes('رأس السنة الميلادية')), 'Nouvel An missing');
    assert.ok(titles.some(t => t.includes('Yennayer') || t.includes('رأس السنة الأمازيغية')), 'Yennayer missing');
    assert.ok(titles.some(t => t.includes('Travail') || t.includes('عيد العمال')), 'Labour day missing');
    assert.ok(titles.some(t => t.includes('Indépendance') || t.includes('عيد الاستقلال')), 'Independence day missing');
    assert.ok(titles.some(t => t.includes('Révolution') || t.includes('عيد الثورة')), 'Revolution day missing');

    // Check specific dates
    const yennayer = holidays.find(h => h.title.includes('Yennayer'));
    assert.ok(yennayer);
    const yennayerDate = new Date(yennayer.start);
    assert.equal(yennayerDate.getMonth(), 0); // January
    assert.equal(yennayerDate.getDate(), 12); // 12th
  });

  it('formats dates and ranges accurately', () => {
    const d = new Date(2026, 6, 5); // 5 July 2026 (Independence Day)
    assert.equal(formatMonthYear(d), 'July 2026');
    assert.equal(formatFullDate(d), 'Sun, July 5, 2026');

    const range = formatDateRange(new Date(2026, 10, 1), new Date(2026, 10, 3));
    assert.equal(range, 'Nov 1 – 3, 2026');
  });

  it('performs DST-safe arithmetic on days', () => {
    const start = new Date(2026, 0, 1);
    const nextWeek = addDays(start, 7);
    assert.equal(nextWeek.getDate(), 8);
    assert.equal(nextWeek.getMonth(), 0);
  });

});
