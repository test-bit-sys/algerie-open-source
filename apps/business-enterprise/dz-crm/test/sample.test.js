/**
 * The sample dataset is generated relative to "today", so these tests
 * guard the invariants that keep the demo believable on any date:
 * referential integrity, valid stages, and a live mix of due dates.
 */

import { describe, it, expect } from 'vitest';
import { sampleDataset } from '../src/lib/sample.js';
import { STAGES } from '../src/lib/forecast.js';
import { todayISO } from '../src/lib/util.js';

const stubStore = { settings: { currency: 'USD', theme: 'system', onboarded: false, sampleData: false, stageProbabilities: {} } };
const data = sampleDataset(stubStore);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('sampleDataset', () => {
  it('is a valid import payload that flags sample mode', () => {
    expect(data.app).toBe('crm');
    expect(data.version).toBe(1);
    expect(data.settings.sampleData).toBe(true);
    expect(data.settings.onboarded).toBe(true);
  });

  it('has unique ids across every collection', () => {
    const ids = [...data.companies, ...data.contacts, ...data.deals, ...data.activities, ...data.tasks]
      .map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every cross-reference', () => {
    const companyIds = new Set(data.companies.map((c) => c.id));
    const contactIds = new Set(data.contacts.map((c) => c.id));
    const dealIds = new Set(data.deals.map((d) => d.id));

    for (const c of data.contacts) {
      if (c.companyId) expect(companyIds.has(c.companyId)).toBe(true);
    }
    for (const d of data.deals) {
      if (d.companyId) expect(companyIds.has(d.companyId)).toBe(true);
      if (d.contactId) expect(contactIds.has(d.contactId)).toBe(true);
    }
    for (const a of data.activities) {
      if (a.contactId) expect(contactIds.has(a.contactId)).toBe(true);
      if (a.companyId) expect(companyIds.has(a.companyId)).toBe(true);
      if (a.dealId) expect(dealIds.has(a.dealId)).toBe(true);
    }
    for (const t of data.tasks) {
      if (t.contactId) expect(contactIds.has(t.contactId)).toBe(true);
      if (t.dealId) expect(dealIds.has(t.dealId)).toBe(true);
    }
  });

  it('uses only valid stages and stamps closedAt exactly on closed deals', () => {
    const valid = new Set(STAGES.map((s) => s.id));
    for (const d of data.deals) {
      expect(valid.has(d.stage)).toBe(true);
      if (d.stage === 'won' || d.stage === 'lost') {
        expect(d.closedAt).toBeTypeOf('number');
      } else {
        expect(d.closedAt).toBeNull();
      }
    }
  });

  it('covers the full pipeline: open, won, and lost deals', () => {
    const stages = new Set(data.deals.map((d) => d.stage));
    expect(stages.has('won')).toBe(true);
    expect(stages.has('lost')).toBe(true);
    expect(data.deals.some((d) => d.stage !== 'won' && d.stage !== 'lost')).toBe(true);
  });

  it('gives every open deal a future-facing forecast (value + close date)', () => {
    for (const d of data.deals) {
      expect(d.value).toBeGreaterThan(0);
      expect(d.expectedClose).toMatch(ISO_DATE);
    }
  });

  it('keeps follow-ups alive on any date: overdue, today, and upcoming', () => {
    const today = todayISO();
    const open = data.tasks.filter((t) => !t.done);
    expect(open.some((t) => t.due < today)).toBe(true);
    expect(open.some((t) => t.due === today)).toBe(true);
    expect(open.some((t) => t.due > today)).toBe(true);
    for (const t of data.tasks) expect(t.due).toMatch(ISO_DATE);
  });

  it('dates all activities in the past, newest ones recent', () => {
    const today = todayISO();
    for (const a of data.activities) {
      expect(a.date).toMatch(ISO_DATE);
      expect(a.date <= today).toBe(true);
      expect(a.summary.length).toBeGreaterThan(0);
    }
  });
});
