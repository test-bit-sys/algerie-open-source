import { describe, it, expect } from 'vitest';
import {
  cleanTag, dedupeTags, normalizeTags, splitTags, hasTag,
  MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD,
} from '../src/lib/tags.js';

describe('cleanTag', () => {
  it('trims, collapses whitespace, and bounds length', () => {
    expect(cleanTag('  YC   W26  ')).toBe('YC W26');
    expect(cleanTag('x'.repeat(80))).toHaveLength(MAX_TAG_LENGTH);
    expect(cleanTag(null)).toBe('');
  });
});

describe('dedupeTags', () => {
  it('keeps the first spelling of a case-variant pair', () => {
    expect(dedupeTags(['VIP', 'vip', 'Champion', 'VIP'])).toEqual(['VIP', 'Champion']);
  });
});

describe('normalizeTags', () => {
  it('cleans, drops empties, dedupes, and caps the list', () => {
    expect(normalizeTags([' vip ', '', 'VIP', 42, 'champion'])).toEqual(['vip', '42', 'champion']);
    expect(normalizeTags('vip')).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS_PER_RECORD);
  });
});

describe('splitTags', () => {
  it('splits a CSV cell on commas and semicolons', () => {
    expect(splitTags('vip, expansion; champion')).toEqual(['vip', 'expansion', 'champion']);
    expect(splitTags('  ')).toEqual([]);
    expect(splitTags('vip,vip,VIP')).toEqual(['vip']);
  });
});

describe('hasTag', () => {
  it('matches case-insensitively and survives junk', () => {
    expect(hasTag(['YC W26'], 'yc w26')).toBe(true);
    expect(hasTag(['a'], 'b')).toBe(false);
    expect(hasTag(undefined, 'a')).toBe(false);
  });
});
