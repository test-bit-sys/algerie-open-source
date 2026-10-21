import { describe, it, expect, beforeEach } from 'vitest';
import { parseCSV } from '../src/lib/csv.js';
import { detectMapping, parseImportDate, parseImportDuration, rowsToItems } from '../src/lib/importer.js';
import { createStore } from '../src/lib/store.js';
import { createPuterMock } from './puter-mock.js';

describe('parseCSV', () => {
  it('parses quoted fields with commas, quotes, and newlines', () => {
    const rows = parseCSV('a,"b, c","say ""hi""","line\nbreak"\r\n1,2,3,4');
    expect(rows).toEqual([['a', 'b, c', 'say "hi"', 'line\nbreak'], ['1', '2', '3', '4']]);
  });

  it('strips a BOM and drops empty lines', () => {
    const rows = parseCSV('﻿Date,Hours\n\n2026-08-03,1.5\n\n');
    expect(rows).toEqual([['Date', 'Hours'], ['2026-08-03', '1.5']]);
  });
});

describe('detectMapping', () => {
  it('preserves non-billable time from a Billable? column', () => {
    const { mapping } = detectMapping(['Date', 'Client', 'Project', 'Task', 'Hours', 'Billable?']);
    const { items, invalid } = rowsToItems([
      ['2026-08-03', 'Acme', 'Site', 'Internal', '1', 'No'],
      ['2026-08-03', 'Acme', 'Site', 'Delivery', '2', 'Yes'],
    ], mapping);
    expect(invalid).toEqual([]);
    expect(items.map((item) => item.billable)).toEqual([false, true]);
  });

  it('recognizes a Toggl export', () => {
    const { source, mapping } = detectMapping(
      ['User', 'Email', 'Client', 'Project', 'Description', 'Billable', 'Start date', 'Start time', 'End date', 'End time', 'Duration', 'Tags']);
    expect(source).toBe('Toggl');
    expect(mapping.date).toBe(6);
    expect(mapping.duration).toBe(10);
    expect(mapping.client).toBe(2);
    expect(mapping.project).toBe(3);
    expect(mapping.task).toBe(4);
    expect(mapping.billable).toBe(5);
    // Clock times ride along when the export has them, and "start time"
    // never gets confused with the "start date" the date field claims.
    expect(mapping.start).toBe(7);
    expect(mapping.end).toBe(9);
  });

  it('recognizes Clockify and Harvest exports', () => {
    expect(detectMapping(['Project', 'Client', 'Description', 'Billable', 'Start Date', 'Start Time', 'End Date', 'End Time', 'Duration (h)']).source).toBe('Clockify');
    expect(detectMapping(['Date', 'Client', 'Project', 'Task', 'Notes', 'Hours', 'Billable?']).source).toBe('Harvest');
  });

  it('marks unmatched fields with -1 for the manual fallback', () => {
    const { source, mapping } = detectMapping(['When', 'How long', 'What']);
    expect(source).toBe('CSV');
    expect(mapping.date).toBe(-1);
    expect(mapping.duration).toBe(-1);
  });
});

describe('cell parsing', () => {
  it('rejects partial numeric durations instead of importing a different amount of time', () => {
    for (const value of ['1:30:00 trailing', '1,2,3', '1e', '1e308', '0.00001']) {
      expect(parseImportDuration(value), value).toBeNull();
    }
    expect(parseImportDuration('.5')).toBe(1800);
    expect(parseImportDuration('25')).toBe(25 * 3600);
    expect(parseImportDuration('1h 30m')).toBe(5400);
    expect(parseImportDuration('2 hours')).toBe(7200);
    const { mapping } = detectMapping(['Date', 'Project', 'Hours']);
    const { items, invalid } = rowsToItems([['2026-08-03', 'Site', '1:30:00 trailing']], mapping);
    expect(items).toEqual([]);
    expect(invalid).toEqual([{ line: 2, reason: 'unreadable duration' }]);
  });

  it('reads ISO, slash (month-first), and dotted (day-first) dates', () => {
    expect(parseImportDate('2026-08-03')).toBe('2026-08-03');
    expect(parseImportDate('2026-08-03 09:00:00')).toBe('2026-08-03');
    expect(parseImportDate('8/3/2026')).toBe('2026-08-03');
    expect(parseImportDate('23/8/2026')).toBe('2026-08-23'); // day-first fallback
    expect(parseImportDate('03.08.2026')).toBe('2026-08-03'); // dotted is day-first
    expect(parseImportDate('25.12.2026')).toBe('2026-12-25');
    expect(parseImportDate('12.25.2026')).toBe('2026-12-25'); // month-first fallback
    expect(parseImportDate('nonsense')).toBeNull();
  });

  it('rejects dates that do not exist on the calendar', () => {
    // A well-formed but impossible date used to survive as-is, filing an
    // entry under a month that no range could ever show it in.
    expect(parseImportDate('2026-02-30')).toBeNull();
    expect(parseImportDate('2026-04-31')).toBeNull();
    expect(parseImportDate('2/30/2026')).toBeNull();
    expect(parseImportDate('31.02.2026')).toBeNull();
    // ...including a month outside 1-12, which would have named a month
    // file ("entries-2026-13.json") nothing ever reads back.
    expect(parseImportDate('2026-13-01')).toBeNull();
    expect(parseImportDate('2026-00-10')).toBeNull();
    // Leap days stay real when the year has one.
    expect(parseImportDate('2024-02-29')).toBe('2024-02-29');
    expect(parseImportDate('2026-02-29')).toBeNull();
    expect(parseImportDate('2000-02-29')).toBe('2000-02-29');
    expect(parseImportDate('1900-02-29')).toBeNull();
    // Month ends that do exist are untouched.
    expect(parseImportDate('2026-01-31')).toBe('2026-01-31');
    expect(parseImportDate('2026-06-30')).toBe('2026-06-30');
  });

  it('reports an impossible date as an unimportable row', () => {
    const mapping = { date: 0, duration: 1, project: 2, client: -1, task: -1, notes: -1, billable: -1, start: -1, end: -1 };
    const { items, invalid } = rowsToItems([
      ['2026-08-03', '1.5', 'Site'],
      ['2026-02-30', '2', 'Site'],
    ], mapping);
    expect(items).toHaveLength(1);
    expect(invalid).toEqual([{ line: 3, reason: 'unreadable date' }]);
  });

  it('reads clock and decimal durations', () => {
    expect(parseImportDuration('8:30:00')).toBe(30600);
    expect(parseImportDuration('0:45')).toBe(2700);
    expect(parseImportDuration('7.5')).toBe(27000);
    expect(parseImportDuration('7,5')).toBe(27000);
    expect(parseImportDuration('0')).toBeNull();
    expect(parseImportDuration('')).toBeNull();
  });
});

describe('imported clock times', () => {
  it('reads start and end times onto the row date, night shifts included', () => {
    const headers = ['Date', 'Project', 'Duration', 'Start time', 'End time'];
    const { mapping } = detectMapping(headers);
    const { items } = rowsToItems([
      ['2026-08-03', 'Site', '1:30', '09:00', '10:30'],
      ['2026-08-04', 'Site', '4:00', '22:00', '02:00'],
      ['2026-08-05', 'Site', '2:00', '', ''],
      ['2026-08-06', 'Site', '2:00', 'nonsense', '10:00'],
    ], mapping);
    expect(items).toHaveLength(4);
    expect(items[0].startedAt).toBe(new Date(2026, 7, 3, 9, 0).getTime());
    expect(items[0].endedAt).toBe(new Date(2026, 7, 3, 10, 30).getTime());
    // An end at or before its start is the next morning, not negative work.
    expect(items[1].endedAt).toBe(new Date(2026, 7, 5, 2, 0).getTime());
    // No times, or half a pair, leaves the entry duration-only.
    expect(items[2].startedAt).toBeNull();
    expect(items[3].startedAt).toBeNull();
    expect(items[3].endedAt).toBeNull();
    // Times are decoration on the duration and never a source for it.
    expect(items[3].seconds).toBe(2 * 3600);
  });

  it('takes the time out of a full datetime cell', () => {
    const { mapping } = detectMapping(['Date', 'Project', 'Hours', 'Start', 'End']);
    const { items } = rowsToItems([['2026-08-03', 'Site', '1.5', '2026-08-03 09:15:00', '2026-08-03 10:45:00']], mapping);
    expect(items[0].startedAt).toBe(new Date(2026, 7, 3, 9, 15).getTime());
    expect(items[0].endedAt).toBe(new Date(2026, 7, 3, 10, 45).getTime());
  });
});

describe('rowsToItems', () => {
  const mapping = { date: 0, duration: 1, project: 2, client: 3, task: 4, notes: -1, billable: 5 };

  it('converts valid rows and reports invalid ones with line numbers', () => {
    const { items, invalid } = rowsToItems([
      ['2026-08-03', '1:30:00', 'Site', 'Acme', 'Design', 'Yes'],
      ['bad-date', '1:00:00', 'Site', 'Acme', '', 'No'],
      ['2026-08-04', '', 'Site', 'Acme', '', 'No'],
      ['2026-08-05', '2.0', '', 'Acme', '', 'No'],
    ], mapping);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ date: '2026-08-03', seconds: 5400, project: 'Site', client: 'Acme', task: 'Design', billable: true });
    expect(invalid).toEqual([
      { line: 3, reason: 'unreadable date' },
      { line: 4, reason: 'unreadable duration' },
      { line: 5, reason: 'missing project' },
    ]);
  });

  it('defaults billable to true only when the column is absent', () => {
    const noBillable = { ...mapping, billable: -1 };
    expect(rowsToItems([['2026-08-03', '1.0', 'Site', 'Acme', '', '']], noBillable).items[0].billable).toBe(true);
    expect(rowsToItems([['2026-08-03', '1.0', 'Site', 'Acme', '', 'No']], mapping).items[0].billable).toBe(false);
  });
});

describe('store.importEntries', () => {
  let store;

  beforeEach(async () => {
    globalThis.puter = createPuterMock();
    store = createStore();
    await store.init();
  });

  it('matches existing clients and projects case-insensitively, creates the rest', async () => {
    const acme = await store.addClient({ name: 'Acme', slot: 1, rate: 100 });
    await store.addProject({ clientId: acme.id, name: 'Site' });

    const result = await store.importEntries([
      { date: '2026-08-03', seconds: 3600, project: 'SITE', client: 'acme', task: 'A', notes: '', billable: true },
      { date: '2026-08-04', seconds: 1800, project: 'New thing', client: 'Fresh Co', task: '', notes: '', billable: true },
      { date: '2026-07-30', seconds: 900, project: 'Orphan', client: '', task: '', notes: '', billable: false },
    ]);

    expect(result).toMatchObject({ added: 3, skipped: 0, clientsCreated: 2, projectsCreated: 2 });
    expect(store.clients.map((c) => c.name).sort()).toEqual(['Acme', 'Fresh Co', 'Imported']);
    // Matched entry landed on the existing project.
    const aug = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(store.project(aug[0].projectId).name).toBe('Site');
    expect(store.months).toEqual(['2026-07', '2026-08']);
  });

  it('re-importing the same file adds nothing', async () => {
    const items = [
      { date: '2026-08-03', seconds: 3600, project: 'Site', client: 'Acme', task: 'A', notes: 'n', billable: true },
      { date: '2026-08-03', seconds: 3600, project: 'Site', client: 'Acme', task: 'A', notes: 'n', billable: true },
    ];
    const first = await store.importEntries(items);
    expect(first).toMatchObject({ added: 1, skipped: 1 }); // in-file duplicate skipped too

    const second = await store.importEntries(items);
    expect(second).toMatchObject({ added: 0, skipped: 2, clientsCreated: 0, projectsCreated: 0 });
    expect(await store.entriesBetween('2026-08-01', '2026-08-31')).toHaveLength(1);
  });
});
