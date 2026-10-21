/**
 * DZ-Prayer Engine — Unit Tests (node:test)
 * 100% Offline-First, Zero-Dependency Test Suite
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DZ_WILAYAS,
  calculateQibla,
  calculatePrayerTimes,
  getNextPrayerInfo,
  getHijriDate,
  generateMonthlyTimetable
} from '../src/prayer-engine.js';

describe('DZ-Prayer Astronomical & Sovereign Engine Tests', () => {

  test('All 58 Algerian Wilayas are present with valid coordinates and names', () => {
    assert.strictEqual(DZ_WILAYAS.length, 58);

    // Check Wilaya 01 (Adrar)
    const adrar = DZ_WILAYAS.find(w => w.code === '01');
    assert.ok(adrar);
    assert.strictEqual(adrar.name_ar, 'أدرار');
    assert.ok(adrar.lat > 20 && adrar.lat < 30);

    // Check Wilaya 16 (Alger)
    const alger = DZ_WILAYAS.find(w => w.code === '16');
    assert.ok(alger);
    assert.strictEqual(alger.name_ar, 'الجزائر العاصمة');
    assert.strictEqual(alger.name_fr, 'Alger');
    assert.ok(alger.lat > 36.5 && alger.lat < 37.0);

    // Check Wilaya 58 (El Menia)
    const elmenia = DZ_WILAYAS.find(w => w.code === '58');
    assert.ok(elmenia);
    assert.strictEqual(elmenia.name_ar, 'المنيعة');
  });

  test('Qibla angle calculation for Algiers is accurate towards East-South-East', () => {
    const alger = DZ_WILAYAS.find(w => w.code === '16');
    const qibla = calculateQibla(alger.lat, alger.lon);

    // For Algiers (36.75° N, 3.06° E), the Kaaba bearing is approximately 104° to 106° (ESE)
    assert.ok(qibla.bearing >= 100 && qibla.bearing <= 110, `Expected bearing around 105.4°, got ${qibla.bearing}`);
    // Distance from Algiers to Makkah is approximately ~3900 km - ~4100 km
    assert.ok(qibla.distanceKm >= 3800 && qibla.distanceKm <= 4200, `Expected distance ~4000km, got ${qibla.distanceKm}`);
  });

  test('Prayer times calculation produces valid sequential chronological order', () => {
    const alger = DZ_WILAYAS.find(w => w.code === '16');
    const fixedDate = new Date(2026, 9, 21); // October 21, 2026
    const { times, minutesMap } = calculatePrayerTimes(alger, fixedDate);

    // All prayer times must be valid non-empty HH:MM strings
    const timeRegex = /^\d{2}:\d{2}$/;
    assert.match(times.fajr, timeRegex);
    assert.match(times.sunrise, timeRegex);
    assert.match(times.dhuhr, timeRegex);
    assert.match(times.asr, timeRegex);
    assert.match(times.maghrib, timeRegex);
    assert.match(times.isha, timeRegex);

    // Must follow chronological order across the day
    assert.ok(minutesMap.fajr < minutesMap.sunrise, 'Fajr must be before Sunrise');
    assert.ok(minutesMap.sunrise < minutesMap.dhuhr, 'Sunrise must be before Dhuhr');
    assert.ok(minutesMap.dhuhr < minutesMap.asr, 'Dhuhr must be before Asr');
    assert.ok(minutesMap.asr < minutesMap.maghrib, 'Asr must be before Maghrib');
    assert.ok(minutesMap.maghrib < minutesMap.isha, 'Maghrib must be before Isha');
  });

  test('getNextPrayerInfo identifies correct upcoming prayer and countdown', () => {
    const timesMap = {
      fajr: 5 * 60,       // 05:00
      sunrise: 6.5 * 60,  // 06:30
      dhuhr: 12.5 * 60,   // 12:30
      asr: 15.5 * 60,     // 15:30
      maghrib: 18 * 60,   // 18:00
      isha: 19.5 * 60     // 19:30
    };

    // At 10:00 AM (600 min), next prayer should be Dhuhr (750 min)
    const info = getNextPrayerInfo(timesMap, 10 * 60);
    assert.strictEqual(info.next.id, 'dhuhr');
    assert.strictEqual(info.diffMinutes, 150);
    assert.strictEqual(info.remainingTimeFormatted, '02:30:00');

    // At 21:00 PM (after Isha), next prayer should be tomorrow Fajr
    const infoNight = getNextPrayerInfo(timesMap, 21 * 60);
    assert.strictEqual(infoNight.next.id, 'fajr');
    assert.ok(infoNight.diffMinutes > 0);
  });

  test('Hijri date conversion produces accurate year and month name', () => {
    const testDate = new Date(2026, 9, 21);
    const hijri = getHijriDate(testDate);

    assert.ok(hijri.year >= 1447 && hijri.year <= 1449);
    assert.ok(hijri.month >= 1 && hijri.month <= 12);
    assert.ok(hijri.day >= 1 && hijri.day <= 30);
    assert.ok(hijri.monthNameAr.length > 0);
    assert.ok(hijri.formattedAr.includes('هـ'));
  });

  test('generateMonthlyTimetable creates complete timetable for October (31 days)', () => {
    const oran = DZ_WILAYAS.find(w => w.code === '31');
    const table = generateMonthlyTimetable(oran, 2026, 10);

    assert.strictEqual(table.length, 31);
    assert.strictEqual(table[0].day, 1);
    assert.strictEqual(table[30].day, 31);
    assert.ok(table[0].fajr.length === 5);
    assert.ok(table[0].maghrib.length === 5);
  });
});
