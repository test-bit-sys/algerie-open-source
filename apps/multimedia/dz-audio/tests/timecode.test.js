import { describe, it, expect } from 'vitest';
import { formatTime, parseTime, framesToTimecode, timecodeToFrames, SMPTE_RATES, framesPerSecond } from '../src/lib/time.js';

const df = SMPTE_RATES.smpte2997df;

describe('SMPTE timecode', () => {
  it('skips two frame numbers each minute except every tenth at 29.97 drop', () => {
    expect(framesToTimecode(1799, df)).toEqual({ h: 0, m: 0, s: 59, f: 29 });
    expect(framesToTimecode(1800, df)).toEqual({ h: 0, m: 1, s: 0, f: 2 });
    expect(framesToTimecode(17982, df)).toEqual({ h: 0, m: 10, s: 0, f: 0 });
    expect(framesToTimecode(17981, df)).toEqual({ h: 0, m: 9, s: 59, f: 29 });
    expect(framesToTimecode(107892, df)).toEqual({ h: 1, m: 0, s: 0, f: 0 });
  });

  it('round-trips frame counts through drop-frame timecode', () => {
    for (const rate of [df, SMPTE_RATES.smpte5994df, SMPTE_RATES.smpte2997, SMPTE_RATES.smpte25]) {
      for (const n of [0, 1, 1799, 1800, 1801, 3597, 17982, 40000, 123456]) {
        const tc = framesToTimecode(n, rate);
        expect(timecodeToFrames(tc.h, tc.m, tc.s, tc.f, rate)).toBe(n);
      }
    }
  });

  it('formats and parses NTSC rates against the real clock', () => {
    // One hour of real time at 29.97 drop reads 01:00:00;00 (drop-frame tracks the clock).
    expect(formatTime(48000 * 3600, 48000, 'smpte2997df')).toBe('01:00:00;00');
    // Non-drop 29.97 runs 3.6 s (108 frames) behind after an hour.
    expect(formatTime(48000 * 3600, 48000, 'smpte2997')).toBe('00:59:56:12');
    expect(formatTime(48000, 48000, 'smpte2398')).toBe('00:00:00:23');
    const at = parseTime('00:01:00;02', 48000, 'smpte2997df');
    expect(at).toBe(Math.round((1800 / (30000 / 1001)) * 48000));
    expect(formatTime(at, 48000, 'smpte2997df')).toBe('00:01:00;02');
  });

  it('keeps integer rates and gives snapping the real frame rate', () => {
    expect(formatTime(48000 * 61.5, 48000, 'smpte25')).toBe('00:01:01:12');
    const prefs = (v) => ({ get: (k) => (k === 'timeFormat' ? v : 24) });
    expect(framesPerSecond(prefs('smpte2997df'))).toBeCloseTo(29.97, 2);
    expect(framesPerSecond(prefs('frames'))).toBe(24);
    expect(framesPerSecond(prefs('decimal'))).toBe(30);
  });
});

describe('bars and beats input', () => {
  it('reads the subdivision field as decimals for powers of ten, else as the displayed number', () => {
    const rate = 48000;
    const music = { tempo: 120, beatsPerBar: 4, beatNote: 4 };
    // 120 BPM: a beat is half a second.
    expect(parseTime('1:1.5', rate, 'bars', { ...music, subdivisions: 100 })).toBe(rate * 0.25);
    expect(parseTime('1:1.5', rate, 'bars', { ...music, subdivisions: 16 })).toBe(Math.round((rate * 0.5 * 5) / 16));
    const at = parseTime('2:3.07', rate, 'bars', { ...music, subdivisions: 16 });
    expect(formatTime(at, rate, 'bars', { ...music, subdivisions: 16 })).toBe('2:3.07');
  });
});
