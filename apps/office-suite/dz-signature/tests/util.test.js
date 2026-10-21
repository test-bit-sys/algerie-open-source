import { describe, it, expect } from 'vitest';
import {
  uid, normalizeEmail, escapeHtml, relativeTime, formatBytes, initialsOf, coerce,
  localDateString, deadlineInDays,
} from '../src/lib/util.js';

describe('util', () => {
  it('uid is unique and url-safe', () => {
    const a = uid();
    const b = uid();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9]+$/);
  });

  it('normalizeEmail lowercases valid addresses and rejects junk', () => {
    expect(normalizeEmail(' Ava@Example.COM ')).toBe('ava@example.com');
    expect(normalizeEmail('not-an-email')).toBe('');
    expect(normalizeEmail('a b@c.d')).toBe('');
    expect(normalizeEmail(null)).toBe('');
  });

  it('escapeHtml neutralizes markup', () => {
    expect(escapeHtml('<img src=x onerror="1">&\'')).toBe('&lt;img src=x onerror=&quot;1&quot;&gt;&amp;&#39;');
  });

  it('relativeTime buckets sensibly', () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 30_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('formatBytes picks readable units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('initialsOf handles names and emails', () => {
    expect(initialsOf('Ava Chen')).toBe('AC');
    expect(initialsOf('ava@example.com')).toBe('A');
    expect(initialsOf('')).toBe('?');
  });

  it('coerce parses JSON strings and passes objects through', () => {
    expect(coerce('{"a":1}')).toEqual({ a: 1 });
    expect(coerce({ a: 1 })).toEqual({ a: 1 });
    expect(coerce('not json')).toBe(null);
    expect(coerce(null)).toBe(null);
  });
});

describe('deadlineInDays', () => {
  it('lands on the end of the calendar day, not the same time of day', () => {
    const from = new Date(2026, 8, 5, 10, 3, 27).getTime();
    const at = new Date(deadlineInDays(7, from));
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([2026, 8, 12]);
    expect([at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });

  it('counts on from a deadline that is already the end of a day', () => {
    const first = deadlineInDays(7, new Date(2026, 8, 5, 10, 0).getTime());
    const at = new Date(deadlineInDays(7, first));
    expect([at.getMonth(), at.getDate(), at.getHours()]).toEqual([8, 19, 23]);
  });

  it('walks calendar days across a clock change', () => {
    // Wherever the machine's clocks change, the 7th day is the 7th day; a
    // multiple of 24 hours could land an hour into the day before or after.
    for (const start of [new Date(2026, 2, 5, 0, 30), new Date(2026, 10, 1, 0, 30)]) {
      const at = new Date(deadlineInDays(7, start.getTime()));
      expect(at.getDate()).toBe(start.getDate() + 7);
      expect(at.getHours()).toBe(23);
    }
  });
});

describe('localDateString', () => {
  it('names the day on the wall clock, not the UTC one', () => {
    // 23:30 local on the 4th: toISOString() would say the 5th anywhere west of
    // Greenwich, and the 4th is what the picker beside it shows.
    const late = new Date(2026, 8, 4, 23, 30).getTime();
    expect(localDateString(late)).toBe('2026-09-04');
    const early = new Date(2026, 0, 1, 0, 30).getTime();
    expect(localDateString(early)).toBe('2026-01-01');
  });
});
