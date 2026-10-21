import { describe, it, expect, afterEach, vi } from 'vitest';
import { createMeetings, isMeetingUrl } from '../src/js/meetings.js';

afterEach(() => vi.restoreAllMocks());

describe('meetings — stateless links', () => {
  it('mints open room codes in abcd-efgh-ijkl form', () => {
    const meetings = createMeetings();
    for (let i = 0; i < 20; i++) {
      expect(meetings.mintLink().code).toMatch(/^[a-z]{4}-[a-z]{4}-[a-z]{4}$/);
    }
  });

  it('mints distinct codes', () => {
    const meetings = createMeetings();
    const codes = new Set(Array.from({ length: 50 }, () => meetings.mintLink().code));
    expect(codes.size).toBe(50);
  });

  it('wraps the code in the Meetings app URL', () => {
    const { code, url } = createMeetings().mintLink();
    expect(url).toBe(`https://meetings.puter.com/#/m/${code}`);
  });

  it('rejection-samples: every letter can appear, none from outside a–z', () => {
    // Bytes ≥ 252 (the rejection zone for 26 letters) must be skipped, not
    // wrapped — feed a run that would betray a naive modulo.
    const fed = [255, 254, 253, 252, 25, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let i = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((arr) => {
      for (let j = 0; j < arr.length; j++) arr[j] = fed[Math.min(i++, fed.length - 1)];
      return arr;
    });
    const { code } = createMeetings().mintLink();
    // The four rejection-zone bytes produced nothing; 25 → 'z', 0.. → 'a','b',…
    expect(code).toBe('zabc-defg-hijk');
  });

  it('is available wherever crypto randomness is', () => {
    expect(createMeetings().available()).toBe(true);
  });
});

describe('isMeetingUrl — the exact room-link shape', () => {
  it('accepts both live room-code forms, including what mintLink makes', () => {
    expect(isMeetingUrl('https://meetings.puter.com/#/m/abcd-efgh-ijkl')).toBe(true); // open
    expect(isMeetingUrl('https://meetings.puter.com/#/m/abc-defg-hij')).toBe(true); // classic
    expect(isMeetingUrl(createMeetings().mintLink().url)).toBe(true);
  });

  it('rejects everything that is not exactly a Puter Meetings room link', () => {
    for (const bad of [
      'https://meetings.puter.com.evil.example/#/m/abcd-efgh-ijkl', // host prefix trick
      'http://meetings.puter.com/#/m/abcd-efgh-ijkl', //              not https
      'https://meetings.puter.com/#/m/ABCD-EFGH-IJKL', //             not a room code
      'https://meetings.puter.com/#/m/abcd-efgh-ijkl?x=1', //         trailing junk
      'https://meetings.puter.com/#/m/', //                           no code
      'https://example.com/', //                                      foreign
      `https://meetings.puter.com/#/m/${'a'.repeat(200)}`, //         over-long
      '',
      42,
      null,
    ]) {
      expect(isMeetingUrl(bad), String(bad)).toBe(false);
    }
  });
});
