import { describe, it, expect, beforeEach } from 'vitest';
import { csvField, toCSVLine, entriesToCSV, CSV_HEADER } from '../src/lib/csv.js';
import { isoOf } from '../src/lib/time.js';
import { createStore } from '../src/lib/store.js';
import { createPuterMock } from './puter-mock.js';

describe('csvField', () => {
  it('passes plain values through', () => {
    expect(csvField('hello')).toBe('hello');
    expect(csvField(42)).toBe('42');
    expect(csvField(null)).toBe('');
  });

  it('quotes and escapes per RFC 4180', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
  });

  it('neutralizes spreadsheet formula injection', () => {
    expect(csvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvField('@HYPERLINK("evil")')).toBe(`"'@HYPERLINK(""evil"")"`);
    expect(csvField('+1234')).toBe("'+1234");
    expect(csvField('-rf notes')).toBe("'-rf notes");
    // Ordinary values pass through untouched.
    expect(csvField('2026-08-03')).toBe('2026-08-03');
    expect(csvField(150)).toBe('150');
  });
});

describe('entriesToCSV', () => {
  let store;
  let client;
  let project;

  beforeEach(async () => {
    globalThis.puter = createPuterMock();
    store = createStore();
    await store.init();
    await store.updateSettings({ currency: 'USD', defaultRate: 50, rounding: 0 });
    client = await store.addClient({ name: 'Acme, Inc.', slot: 1, rate: 100 });
    project = await store.addProject({ clientId: client.id, name: 'Site', billable: true });
  });

  it('renders header plus one row per entry with resolved rates', async () => {
    const entry = await store.addEntry({
      date: '2026-08-03', projectId: project.id, task: 'Design',
      notes: 'kickoff "v1"', seconds: 5400, billable: true,
    });
    const csv = entriesToCSV([entry], store);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines).toHaveLength(2);
    // Client name with a comma and notes with quotes must be escaped.
    // Empty Start and End: a duration-only entry says nothing about when.
    expect(lines[1]).toBe('2026-08-03,,,"Acme, Inc.",Site,Design,"kickoff ""v1""",1:30,1.5,yes,100,USD,150.00,');
  });

  it('keeps sub-minute seconds in the duration column', async () => {
    const entry = await store.addEntry({
      date: '2026-08-03', projectId: project.id, task: 'Timer work',
      seconds: 5445, billable: false,
    });
    const row = entriesToCSV([entry], store).split('\r\n')[1];
    expect(row).toContain(',1:30:45,1.51,');
  });

  it('leaves rate and amount empty on non-billable entries', async () => {
    const entry = await store.addEntry({
      date: '2026-08-03', projectId: project.id, task: 'Admin',
      seconds: 3600, billable: false,
    });
    const csv = entriesToCSV([entry], store);
    expect(csv.split('\r\n')[1]).toBe('2026-08-03,,,"Acme, Inc.",Site,Admin,,1:00,1,no,,,,');
  });

  it('exports the clock times of an entry that has them', async () => {
    const startedAt = new Date(2026, 7, 3, 9, 5).getTime();
    const entry = await store.addEntry({
      date: '2026-08-03', projectId: project.id, task: 'Design', seconds: 5400,
      startedAt, endedAt: startedAt + 5400 * 1000,
    });
    const row = entriesToCSV([entry], store).split('\r\n')[1];
    expect(row.startsWith('2026-08-03,09:05,10:35,')).toBe(true);
  });

  it('exports the locked rate and invoiced date for invoiced entries', async () => {
    const entry = await store.addEntry({
      date: '2026-08-03', projectId: project.id, task: 'Design', seconds: 3600,
    });
    await store.markInvoiced([entry]);
    // A later rate change must not alter the exported billing record.
    await store.updateClient(client.id, { rate: 999 });
    const [invoiced] = await store.entriesBetween('2026-08-03', '2026-08-03');
    const row = entriesToCSV([invoiced], store).split('\r\n')[1];
    // The quoted client name contains a comma, so assert on the row tail:
    // ...,rate,currency,amount,invoiced-date
    expect(row).toMatch(/,100,USD,100\.00,\d{4}-\d{2}-\d{2}$/);
    // The date is the local calendar day, as shown in the app, not UTC.
    expect(row.endsWith(isoOf(new Date(invoiced.invoicedAt)))).toBe(true);
  });
});
