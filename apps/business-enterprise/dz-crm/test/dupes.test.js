import { describe, it, expect } from 'vitest';
import {
  normName, normEmail, normPhone, normDomain,
  contactDuplicates, companyDuplicates, contactByEmail,
} from '../src/lib/dupes.js';

describe('normalizers', () => {
  it('folds case, whitespace, and accents in names', () => {
    expect(normName('  Dana  FOX ')).toBe('dana fox');
    expect(normName('José')).toBe(normName('Jose'));
  });

  it('keeps only meaningful phone digits', () => {
    expect(normPhone('+1 (555) 014-2000')).toBe('15550142000');
    expect(normPhone('x123')).toBe('');
    expect(normPhone('')).toBe('');
  });

  it('reduces websites to their domain', () => {
    expect(normDomain('https://www.Acme.com/about?x=1')).toBe('acme.com');
    expect(normDomain('acme.com')).toBe('acme.com');
    expect(normDomain('http://acme.com#top')).toBe('acme.com');
    expect(normDomain('')).toBe('');
  });
});

describe('contactDuplicates', () => {
  const c = (id, over = {}) => ({ id, name: '', email: '', phone: '', createdAt: 0, ...over });

  it('pairs by email, name, or phone, collecting every reason', () => {
    const pairs = contactDuplicates([
      c('1', { name: 'Dana Fox', email: 'dana@x.com', createdAt: 1 }),
      c('2', { name: 'DANA FOX', email: 'dana@x.com', phone: '555 0100', createdAt: 2 }),
      c('3', { name: 'Sam', email: 'sam@x.com', createdAt: 3 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.id).toBe('1');       // older record leads
    expect(pairs[0].b.id).toBe('2');
    expect(pairs[0].reasons.sort()).toEqual(['email', 'name']);
  });

  it('anchors a group of three on its oldest instead of crossing all three', () => {
    const pairs = contactDuplicates([
      c('new', { name: 'Dana Fox', createdAt: 30 }),
      c('old', { name: 'dana fox', createdAt: 10 }),
      c('mid', { name: 'DANA  FOX', createdAt: 20 }),
    ]);
    // Merging mid and new into old settles mid against new too, so the
    // cross pair is a row nobody could act on.
    expect(pairs.map((p) => `${p.a.id}:${p.b.id}`).sort()).toEqual(['old:mid', 'old:new']);
  });

  it('stays linear when a bad import lands hundreds of rows under one name', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      c(`x${i}`, { name: 'Sales Team', createdAt: 1000 - i }));
    const pairs = contactDuplicates(many);
    // 400 records is 399 pairs to work through, not 79,800 built and binned.
    expect(pairs).toHaveLength(50);
    expect(pairs.every((p) => p.a.id === 'x399')).toBe(true);
  });

  it('ignores empty fields - two blank emails are not a match', () => {
    const pairs = contactDuplicates([
      c('1', { name: 'A', createdAt: 1 }),
      c('2', { name: 'B', createdAt: 2 }),
    ]);
    expect(pairs).toHaveLength(0);
  });
});

describe('companyDuplicates', () => {
  it('pairs by normalized name or website domain', () => {
    const pairs = companyDuplicates([
      { id: '1', name: 'Acme', website: 'https://www.acme.com', createdAt: 1 },
      { id: '2', name: 'Acme Inc', website: 'acme.com/about', createdAt: 2 },
      { id: '3', name: 'acme', website: '', createdAt: 3 },
    ]);
    const keys = pairs.map((p) => `${p.a.id}:${p.b.id}`).sort();
    expect(keys).toEqual(['1:2', '1:3']);
    expect(pairs.find((p) => p.b.id === '2').reasons).toEqual(['domain']);
    expect(pairs.find((p) => p.b.id === '3').reasons).toEqual(['name']);
  });
});

describe('contactByEmail', () => {
  const contacts = [
    { id: '1', name: 'Dana Fox', email: 'Dana@X.com' },
    { id: '2', name: 'Sam', email: '' },
  ];

  it('finds the owner of a typed email, case-insensitively', () => {
    expect(contactByEmail(contacts, ' dana@x.com ').id).toBe('1');
  });

  it('never matches partial or empty input, and can exclude self', () => {
    expect(contactByEmail(contacts, 'dana')).toBeNull();
    expect(contactByEmail(contacts, '')).toBeNull();
    expect(contactByEmail(contacts, 'dana@x.com', '1')).toBeNull();
  });
});
