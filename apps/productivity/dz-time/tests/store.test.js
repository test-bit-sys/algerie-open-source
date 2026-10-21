import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createStore, DEFAULT_SETTINGS, rateAt, withRateFrom, isLogoPath, mergeById,
  dueDateFor, paidAmount, outstandingAmount, invoiceState, lastPaymentDate,
  normalizeInvoiceLines, linesTotal, invoiceTotals,
  INVOICE_LOCK_FIELDS, invoiceLocksOf,
} from '../src/lib/store.js';
import { sampleDataset, wipeSampleData } from '../src/lib/sample.js';
import { createPuterMock } from './puter-mock.js';

let store;
let mock;

beforeEach(async () => {
  mock = createPuterMock();
  globalThis.puter = mock;
  store = createStore();
  await store.init();
});

async function seedProject({ clientRate = 100, projectRate = null, billable = true } = {}) {
  const client = await store.addClient({ name: 'Acme', slot: 1, rate: clientRate });
  const project = await store.addProject({ clientId: client.id, name: 'Site', rate: projectRate, billable });
  return { client, project };
}

describe('init', () => {
  it('starts from defaults on an empty account', () => {
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.clients).toEqual([]);
    expect(store.projects).toEqual([]);
    expect(store.months).toEqual([]);
    expect(store.timer).toBeNull();
  });

  it('reloads persisted state', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.updateSettings({ currency: 'EUR' });

    const second = createStore();
    await second.init();
    expect(second.settings.currency).toBe('EUR');
    expect(second.clients).toHaveLength(1);
    expect(second.months).toEqual(['2026-08']);
    expect(await second.loadMonth('2026-08')).toHaveLength(1);
  });
});

describe('clients and projects', () => {
  it('archiving a client archives its projects but keeps both', async () => {
    const { client, project } = await seedProject();
    await store.archiveClient(client.id);
    expect(store.client(client.id).archived).toBe(true);
    expect(store.project(project.id).archived).toBe(true);
    expect(store.activeClients()).toEqual([]);
    expect(store.activeProjects()).toEqual([]);
    // History intact: the records still resolve.
    expect(store.client(client.id).name).toBe('Acme');
  });
});

describe('write rollback', () => {
  it('rolls back settings, clients, and projects on a failed write', async () => {
    const { client, project } = await seedProject();
    const realSet = mock.kv.set;
    mock.kv.set = async () => { throw new Error('server error'); };

    await expect(store.updateSettings({ currency: 'EUR' })).rejects.toThrow();
    expect(store.settings.currency).toBe('USD');

    await expect(store.addClient({ name: 'Ghost', slot: 2 })).rejects.toThrow();
    expect(store.clients).toHaveLength(1);

    await expect(store.updateClient(client.id, { name: 'Renamed' })).rejects.toThrow();
    expect(store.client(client.id).name).toBe('Acme');

    await expect(store.addProject({ clientId: client.id, name: 'Ghost' })).rejects.toThrow();
    expect(store.projects).toHaveLength(1);

    await expect(store.updateProject(project.id, { rate: 999 })).rejects.toThrow();
    expect(store.project(project.id).rate).toBeNull();

    await expect(store.archiveClient(client.id)).rejects.toThrow();
    expect(store.client(client.id).archived).toBe(false);
    expect(store.project(project.id).archived).toBe(false);

    // The store still works once writes succeed again.
    mock.kv.set = realSet;
    await store.updateSettings({ currency: 'EUR' });
    expect(store.settings.currency).toBe('EUR');
  });
});

describe('rate resolution', () => {
  it('falls through entry, project, client, then default', async () => {
    await store.updateSettings({ defaultRate: 40 });
    const { client, project } = await seedProject({ clientRate: 100, projectRate: 120 });

    expect(store.resolveRate({ projectId: project.id, rate: 150 })).toBe(150);
    expect(store.resolveRate({ projectId: project.id, rate: null })).toBe(120);

    await store.updateProject(project.id, { rate: null });
    expect(store.resolveRate({ projectId: project.id, rate: null })).toBe(100);

    await store.updateClient(client.id, { rate: null });
    expect(store.resolveRate({ projectId: project.id, rate: null })).toBe(40);
  });

  it('computes entry amounts with billing rounding applied', async () => {
    const { project } = await seedProject({ clientRate: 100 });
    await store.updateSettings({ rounding: 15 });
    // 61 minutes rounds up to 75 minutes = 1.25h at 100/h.
    const entry = await store.addEntry({
      date: '2026-08-03', projectId: project.id, seconds: 61 * 60, billable: true,
    });
    expect(store.billedSeconds(entry)).toBe(75 * 60);
    expect(store.entryAmount(entry)).toBe(125);
  });

  it('non-billable entries earn nothing', async () => {
    const { project } = await seedProject();
    const entry = await store.addEntry({
      date: '2026-08-03', projectId: project.id, seconds: 3600, billable: false,
    });
    expect(store.entryAmount(entry)).toBe(0);
    expect(store.billedSeconds(entry)).toBe(0);
  });
});

describe('entries', () => {
  it('adds entries into per-month files and indexes the month', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.addEntry({ date: '2026-07-30', projectId: project.id, seconds: 1800 });
    expect(store.months).toEqual(['2026-07', '2026-08']);
    expect(mock._files.has('hourly-data/entries-2026-08.json')).toBe(true);
    expect(mock._files.has('hourly-data/entries-2026-07.json')).toBe(true);
  });

  it('entriesBetween filters and sorts newest first', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 100 });
    await store.addEntry({ date: '2026-08-05', projectId: project.id, seconds: 200 });
    await store.addEntry({ date: '2026-07-01', projectId: project.id, seconds: 300 });

    const range = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(range.map((e) => e.date)).toEqual(['2026-08-05', '2026-08-03']);

    const all = await store.entriesBetween('2026-01-01', '2026-12-31');
    expect(all).toHaveLength(3);
    expect(all[0].date).toBe('2026-08-05');
  });

  it('shares one read between concurrent loads of the same month', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 });

    const fresh = createStore();
    await fresh.init();
    let reads = 0;
    const realRead = mock.fs.read;
    mock.fs.read = async (path) => { reads += 1; return realRead(path); };
    const [a, b] = await Promise.all([
      fresh.entriesBetween('2026-08-01', '2026-08-31'),
      fresh.entriesBetween('2026-08-03', '2026-08-03'),
    ]);
    mock.fs.read = realRead;
    expect(reads).toBe(1);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('updates an entry in place', async () => {
    const { project } = await seedProject();
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.updateEntry(entry.id, entry.date, { seconds: 7200, task: 'QA' });
    const [updated] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(updated.seconds).toBe(7200);
    expect(updated.task).toBe('QA');
  });

  it('moves an entry across month files when its date changes', async () => {
    const { project } = await seedProject();
    const entry = await store.addEntry({ date: '2026-08-01', projectId: project.id, seconds: 3600 });
    await store.updateEntry(entry.id, entry.date, { date: '2026-07-31' });
    expect(await store.loadMonth('2026-08')).toHaveLength(0);
    const july = await store.loadMonth('2026-07');
    expect(july).toHaveLength(1);
    expect(july[0].id).toBe(entry.id);
  });

  it('keeps no phantom entry when the file write fails', async () => {
    const { project } = await seedProject();
    const realWrite = mock.fs.write;
    mock.fs.write = async () => { throw new Error('network down'); };
    await expect(store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 }))
      .rejects.toThrow();
    mock.fs.write = realWrite;
    // The failed entry is nowhere: not in memory, not on disk.
    expect(await store.entriesBetween('2026-08-01', '2026-08-31')).toHaveLength(0);
    // And the store still works afterwards.
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 900 });
    expect(await store.entriesBetween('2026-08-01', '2026-08-31')).toHaveLength(1);
  });

  it('keeps both entries when two adds race on the same month', async () => {
    const { project } = await seedProject();
    const [a, b] = await Promise.all([
      store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 }),
      store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 900 }),
    ]);
    const entries = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(entries.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    // And the file on disk holds both, not just the later write.
    const onDisk = JSON.parse(mock._files.get('hourly-data/entries-2026-08.json'));
    expect(onDisk).toHaveLength(2);
  });

  it('keeps an update that races a concurrent add', async () => {
    const { project } = await seedProject();
    const a = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 });
    await Promise.all([
      store.updateEntry(a.id, a.date, { seconds: 1200 }),
      store.addEntry({ date: '2026-08-04', projectId: project.id, seconds: 900 }),
    ]);
    const entries = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.id === a.id).seconds).toBe(1200);
  });

  it('keeps racing cross-month moves in opposite directions intact', async () => {
    const { project } = await seedProject();
    const jul = await store.addEntry({ date: '2026-07-15', projectId: project.id, seconds: 600 });
    const aug = await store.addEntry({ date: '2026-08-15', projectId: project.id, seconds: 900 });
    await Promise.all([
      store.updateEntry(jul.id, jul.date, { date: '2026-08-20' }),
      store.updateEntry(aug.id, aug.date, { date: '2026-07-20' }),
    ]);
    const july = await store.loadMonth('2026-07');
    const august = await store.loadMonth('2026-08');
    expect(july.map((e) => e.id)).toEqual([aug.id]);
    expect(august.map((e) => e.id)).toEqual([jul.id]);
  });

  it('deletes an entry and returns it for undo', async () => {
    const { project } = await seedProject();
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    const removed = await store.deleteEntry(entry.id, entry.date);
    expect(removed.id).toBe(entry.id);
    expect(await store.entriesBetween('2026-08-01', '2026-08-31')).toHaveLength(0);
  });
});

describe('timer', () => {
  it('starts, persists, and stops into an entry on the start date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 9, 0, 0));
    try {
      const { project } = await seedProject();
      await store.startTimer({ projectId: project.id, task: 'Build', billable: true });
      expect(store.running).toBe(true);

      // Survives a reload: a fresh store sees the running timer.
      const second = createStore();
      await second.init();
      expect(second.running).toBe(true);
      expect(second.timer.task).toBe('Build');

      vi.advanceTimersByTime(90 * 60 * 1000);
      expect(store.elapsedSeconds()).toBe(5400);

      const entry = await store.stopTimer();
      expect(store.running).toBe(false);
      expect(entry.date).toBe('2026-08-04');
      expect(entry.seconds).toBe(5400);
      expect(entry.task).toBe('Build');
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps a forgotten timer when asked, never inflating short ones', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 6, 0, 0));
    try {
      const { project } = await seedProject();
      await store.startTimer({ projectId: project.id, task: 'Left running' });
      vi.advanceTimersByTime(11 * 3600 * 1000);
      const entry = await store.stopTimer({ capSeconds: 8 * 3600 });
      expect(entry.seconds).toBe(8 * 3600);

      // A cap larger than the elapsed time changes nothing.
      await store.startTimer({ projectId: project.id });
      vi.advanceTimersByTime(30 * 60 * 1000);
      const short = await store.stopTimer({ capSeconds: 8 * 3600 });
      expect(short.seconds).toBe(30 * 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('floors accidental sub-minute stops at one minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 9, 0, 0));
    try {
      const { project } = await seedProject();
      await store.startTimer({ projectId: project.id });
      vi.advanceTimersByTime(5 * 1000);
      const entry = await store.stopTimer();
      expect(entry.seconds).toBe(60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the timer running when stopping fails to write the entry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 9, 0, 0));
    try {
      const { project } = await seedProject();
      await store.startTimer({ projectId: project.id, task: 'Build' });
      vi.advanceTimersByTime(30 * 60 * 1000);

      const realWrite = mock.fs.write;
      mock.fs.write = async () => { throw new Error('network down'); };
      await expect(store.stopTimer()).rejects.toThrow();
      // Nothing was lost: the timer is still running with its start time.
      expect(store.running).toBe(true);
      expect(store.timer.task).toBe('Build');
      expect(store.elapsedSeconds()).toBe(30 * 60);

      // Retrying once the network is back records the full duration.
      mock.fs.write = realWrite;
      vi.advanceTimersByTime(10 * 60 * 1000);
      const entry = await store.stopTimer();
      expect(entry.seconds).toBe(40 * 60);
      expect(store.running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back a start that could not persist', async () => {
    const { project } = await seedProject();
    const realSet = mock.kv.set;
    mock.kv.set = async () => { throw new Error('network down'); };
    await expect(store.startTimer({ projectId: project.id })).rejects.toThrow();
    expect(store.running).toBe(false);
    mock.kv.set = realSet;
    await store.startTimer({ projectId: project.id });
    expect(store.running).toBe(true);
  });

  it('retags the running timer without restarting it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 10, 0, 0));
    try {
      const { project } = await seedProject();
      const other = await store.addProject({ clientId: project.clientId, name: 'Other', billable: false });
      await store.startTimer({ projectId: project.id, task: 'Wrong task' });
      const startedAt = store.timer.startedAt;

      await store.retagTimer({ projectId: other.id, task: ' Fixed task ', billable: false });
      expect(store.timer.projectId).toBe(other.id);
      expect(store.timer.task).toBe('Fixed task');
      expect(store.timer.billable).toBe(false);
      expect(store.timer.startedAt).toBe(startedAt);

      // Persisted: a fresh store sees the retagged timer.
      const second = createStore();
      await second.init();
      expect(second.timer.task).toBe('Fixed task');

      // Moving the start back grows the elapsed time.
      await store.retagTimer({ startedAt: startedAt - 20 * 60 * 1000 });
      expect(store.elapsedSeconds()).toBe(20 * 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects invalid start-time moves and rolls back on failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 10, 0, 0));
    try {
      const { project } = await seedProject();
      await store.startTimer({ projectId: project.id, task: 'Work' });
      const t = store.timer;

      // Future and cross-day moves are rejected, timer untouched.
      await expect(store.retagTimer({ startedAt: Date.now() + 60000 })).rejects.toThrow(/future/);
      await expect(store.retagTimer({ startedAt: t.startedAt - 24 * 3600 * 1000 })).rejects.toThrow(/same day/);
      expect(store.timer.startedAt).toBe(t.startedAt);

      // A failed write rolls the retag back.
      const realSet = mock.kv.set;
      mock.kv.set = async () => { throw new Error('network down'); };
      await expect(store.retagTimer({ task: 'Changed' })).rejects.toThrow();
      expect(store.timer.task).toBe('Work');
      mock.kv.set = realSet;
    } finally {
      vi.useRealTimers();
    }
  });

  it('discards without creating an entry', async () => {
    const { project } = await seedProject();
    await store.startTimer({ projectId: project.id });
    await store.discardTimer();
    expect(store.running).toBe(false);
    expect(await store.entriesBetween('2000-01-01', '2100-01-01')).toHaveLength(0);
  });
});

describe('invoicing', () => {
  it('freezes the rate at invoicing time; unbilled entries stay live', async () => {
    const { client, project } = await seedProject({ clientRate: 100 });
    const a = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    const b = await store.addEntry({ date: '2026-08-04', projectId: project.id, seconds: 3600 });

    expect(await store.markInvoiced([a])).toBe(1);
    await store.updateClient(client.id, { rate: 200 });

    const [newer, older] = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(older.id).toBe(a.id);
    expect(store.entryAmount(older)).toBe(100); // locked at invoicing
    expect(store.entryAmount(newer)).toBe(200); // follows the live rate
    expect(newer.id).toBe(b.id);

    // Un-marking thaws the rate again.
    await store.markInvoiced([older], false);
    const [, thawed] = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(thawed.invoicedAt).toBeNull();
    expect(store.entryAmount(thawed)).toBe(200);
  });

  it('freezes the billing rounding at invoicing time too', async () => {
    const { project } = await seedProject({ clientRate: 100 });
    await store.updateSettings({ rounding: 15 });
    // 61 minutes bills as 75 under 15-minute rounding.
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 61 * 60 });
    await store.markInvoiced([entry]);

    // Turning rounding off later must not rewrite the billed record.
    await store.updateSettings({ rounding: 0 });
    const [invoiced] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(store.billedSeconds(invoiced)).toBe(75 * 60);
    expect(store.entryAmount(invoiced)).toBe(125);

    // Un-marking thaws it back onto the live setting.
    await store.markInvoiced([invoiced], false);
    const [thawed] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(store.billedSeconds(thawed)).toBe(61 * 60);
  });

  it('lets invoiced entries without a frozen rounding follow the live setting', async () => {
    const { project } = await seedProject({ clientRate: 100 });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 61 * 60 });
    await store.markInvoiced([entry]);
    // Entries invoiced before lockedRounding existed have no frozen value.
    const [invoiced] = await store.entriesBetween('2026-08-03', '2026-08-03');
    delete invoiced.lockedRounding;
    await store.updateSettings({ rounding: 15 });
    expect(store.billedSeconds(invoiced)).toBe(75 * 60);
  });

  it('marks in bulk across month files and skips already-matching entries', async () => {
    const { project } = await seedProject();
    const jul = await store.addEntry({ date: '2026-07-30', projectId: project.id, seconds: 1800 });
    const aug = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.markInvoiced([jul]);
    // jul is already invoiced: only aug counts.
    expect(await store.markInvoiced([jul, aug])).toBe(1);
    const all = await store.entriesBetween('2026-07-01', '2026-08-31');
    expect(all.every((e) => !!e.invoicedAt)).toBe(true);
  });

  it('locks invoiced entries against edits and deletes', async () => {
    const { project } = await seedProject();
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.markInvoiced([entry]);
    await expect(store.updateEntry(entry.id, entry.date, { seconds: 60 })).rejects.toThrow(/invoiced/);
    await expect(store.deleteEntry(entry.id, entry.date)).rejects.toThrow(/invoiced/);
    // Un-marking reopens them.
    const [locked] = await store.entriesBetween('2026-08-03', '2026-08-03');
    await store.markInvoiced([locked], false);
    await expect(store.updateEntry(entry.id, entry.date, { seconds: 60 })).resolves.toBeTruthy();
  });

  it('totals unbilled work per client', async () => {
    await store.updateSettings({ defaultRate: 0 });
    const acme = await store.addClient({ name: 'Acme', slot: 1, rate: 100 });
    const other = await store.addClient({ name: 'Other', slot: 2, rate: 50 });
    const site = await store.addProject({ clientId: acme.id, name: 'Site' });
    const app = await store.addProject({ clientId: other.id, name: 'App' });

    const a = await store.addEntry({ date: '2026-08-03', projectId: site.id, seconds: 3600 });
    await store.addEntry({ date: '2026-08-04', projectId: site.id, seconds: 1800 });
    await store.addEntry({ date: '2026-08-04', projectId: app.id, seconds: 3600, billable: false });
    await store.markInvoiced([a]);

    const unbilled = await store.unbilledByClient();
    expect(unbilled.get(acme.id)).toEqual({
      seconds: 1800, amount: 50, count: 1,
      oldest: '2026-08-04', newest: '2026-08-04', currency: 'USD',
    });
    expect(unbilled.has(other.id)).toBe(false); // only non-billable work
  });

  it('ages unbilled work per client, oldest first', async () => {
    const acme = await store.addClient({ name: 'Acme', slot: 1, rate: 100 });
    const globex = await store.addClient({ name: 'Globex', slot: 2, rate: 50 });
    const site = await store.addProject({ clientId: acme.id, name: 'Site' });
    const app = await store.addProject({ clientId: globex.id, name: 'App' });
    // Acme has been waiting since May; Globex only since this month.
    await store.addEntry({ date: '2026-05-04', projectId: site.id, seconds: 3600 });
    await store.addEntry({ date: '2026-08-10', projectId: site.id, seconds: 3600 });
    await store.addEntry({ date: '2026-08-15', projectId: app.id, seconds: 7200 });

    const map = await store.unbilledByClient();
    expect(map.get(acme.id)).toMatchObject({ oldest: '2026-05-04', newest: '2026-08-10', count: 2 });

    const ready = await store.readyToInvoice({ now: '2026-08-20' });
    expect(ready.map((r) => r.client.name)).toEqual(['Acme', 'Globex']);
    expect(ready[0].ageDays).toBe(108);
    expect(ready[1].ageDays).toBe(5);

    // A threshold hides work that is not old enough to worry about.
    const old = await store.readyToInvoice({ minAgeDays: 30, now: '2026-08-20' });
    expect(old.map((r) => r.client.name)).toEqual(['Acme']);

    // Invoicing it takes the client off the list entirely.
    const acmeEntries = (await store.entriesBetween('2026-01-01', '2026-12-31'))
      .filter((e) => e.projectId === site.id);
    await store.markInvoiced(acmeEntries);
    expect((await store.readyToInvoice({ now: '2026-08-20' })).map((r) => r.client.name)).toEqual(['Globex']);
  });

  it('leaves orphaned entries out of the ready-to-invoice list', async () => {
    const client = await store.addClient({ name: 'Acme', slot: 1, rate: 100 });
    const project = await store.addProject({ clientId: client.id, name: 'Site' });
    const entry = await store.addEntry({ date: '2026-08-01', projectId: project.id, seconds: 3600 });
    // An entry whose project no longer exists has nobody to invoice.
    await store.bulkPatch([{ id: entry.id, date: entry.date, patch: { projectId: 'gone' } }]);
    const map = await store.unbilledByClient();
    expect(map.has('none')).toBe(true);
    expect(await store.readyToInvoice()).toEqual([]);
  });
});

describe('clock times on entries', () => {
  it('records the real start of a timer and an end matching the duration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 9, 0, 0));
    try {
      const { project } = await seedProject();
      await store.startTimer({ projectId: project.id, task: 'Build' });
      vi.advanceTimersByTime(90 * 60 * 1000);
      const entry = await store.stopTimer();
      expect(entry.startedAt).toBe(new Date(2026, 7, 3, 9, 0, 0).getTime());
      expect(entry.endedAt).toBe(new Date(2026, 7, 3, 10, 30, 0).getTime());
      expect((entry.endedAt - entry.startedAt) / 1000).toBe(entry.seconds);
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts a trimmed timer end where the recorded duration lands', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 9, 0, 0));
    try {
      const { project } = await seedProject();
      await store.startTimer({ projectId: project.id });
      vi.advanceTimersByTime(14 * 3600 * 1000); // left running overnight
      const entry = await store.stopTimer({ capSeconds: 8 * 3600 });
      // Not "now": the times must never contradict what gets billed.
      expect(entry.seconds).toBe(8 * 3600);
      expect(entry.endedAt).toBe(new Date(2026, 7, 3, 17, 0, 0).getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps duration-only entries valid and free of times', async () => {
    const { project } = await seedProject();
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    expect(entry.startedAt).toBeNull();
    expect(entry.endedAt).toBeNull();
    // Duration stays the source of truth for billing whatever the times say.
    const timed = await store.addEntry({
      date: '2026-08-03', projectId: project.id, seconds: 3600,
      startedAt: new Date(2026, 7, 3, 9, 0).getTime(),
      endedAt: new Date(2026, 7, 3, 11, 0).getTime(),
    });
    expect(store.billedSeconds(timed)).toBe(3600);
  });

  it('finds overlapping spans on a day, and ignores what cannot clash', async () => {
    const { project } = await seedProject();
    const at = (h, m = 0) => new Date(2026, 7, 3, h, m).getTime();
    const morning = await store.addEntry({
      date: '2026-08-03', projectId: project.id, seconds: 5400,
      startedAt: at(9), endedAt: at(10, 30),
    });
    const noTimes = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    const day = await store.entriesBetween('2026-08-03', '2026-08-03');

    // Straddles the morning block.
    expect(store.overlappingEntries(day, { startedAt: at(10), endedAt: at(11) }).map((e) => e.id))
      .toEqual([morning.id]);
    // Touching ends are not an overlap.
    expect(store.overlappingEntries(day, { startedAt: at(10, 30), endedAt: at(11) })).toEqual([]);
    // The entry being edited never clashes with itself.
    expect(store.overlappingEntries(day, { startedAt: at(9), endedAt: at(10), id: morning.id })).toEqual([]);
    // A span with no times, and an entry with no times, can never clash.
    expect(store.overlappingEntries(day, { startedAt: null, endedAt: at(11) })).toEqual([]);
    expect(day.find((e) => e.id === noTimes.id).startedAt).toBeNull();
  });

  it('sees a night shift that runs into the next morning', async () => {
    const { project } = await seedProject();
    // Stored on the day it started, ending in the small hours after it.
    const startedAt = new Date(2026, 7, 17, 22, 0).getTime();
    const endedAt = new Date(2026, 7, 18, 1, 30).getTime();
    const night = await store.addEntry({
      date: '2026-08-17', projectId: project.id, task: 'Night deploy',
      seconds: (endedAt - startedAt) / 1000, startedAt, endedAt,
    });

    const probe = {
      startedAt: new Date(2026, 7, 18, 0, 30).getTime(),
      endedAt: new Date(2026, 7, 18, 1, 0).getTime(),
    };
    // The next morning on its own cannot see it, which is why the sheet
    // has to hand over the days either side rather than only its own.
    const tuesdayOnly = await store.entriesBetween('2026-08-18', '2026-08-18');
    expect(store.overlappingEntries(tuesdayOnly, probe)).toEqual([]);

    const eitherSide = await store.entriesBetween('2026-08-17', '2026-08-19');
    expect(store.overlappingEntries(eitherSide, probe).map((e) => e.id)).toEqual([night.id]);

    // A neighbouring day that does not reach into the span stays out of it.
    await store.addEntry({
      date: '2026-08-19', projectId: project.id, seconds: 3600,
      startedAt: new Date(2026, 7, 19, 9, 0).getTime(),
      endedAt: new Date(2026, 7, 19, 10, 0).getTime(),
    });
    const withMore = await store.entriesBetween('2026-08-17', '2026-08-19');
    expect(store.overlappingEntries(withMore, probe).map((e) => e.id)).toEqual([night.id]);
  });
});

describe('search filtering', () => {
  it('matches text across task, notes, project, and client, accent-insensitive', async () => {
    const client = await store.addClient({ name: 'Café Müller', slot: 1, rate: 80 });
    const project = await store.addProject({ clientId: client.id, name: 'Rebrand' });
    const a = await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Décor review', seconds: 600 });
    const b = await store.addEntry({ date: '2026-08-04', projectId: project.id, task: 'Other', notes: 'follow-up call', seconds: 600 });

    const all = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(store.filterEntries(all, { query: 'decor' }).map((e) => e.id)).toEqual([a.id]);
    expect(store.filterEntries(all, { query: 'FOLLOW' }).map((e) => e.id)).toEqual([b.id]);
    expect(store.filterEntries(all, { query: 'cafe muller' })).toHaveLength(2);
    expect(store.filterEntries(all, { query: 'rebrand' })).toHaveLength(2);
    expect(store.filterEntries(all, { query: 'nothing here' })).toHaveLength(0);
  });

  it('filters by client and billing state', async () => {
    const acme = await store.addClient({ name: 'Acme', slot: 1, rate: 100 });
    const other = await store.addClient({ name: 'Other', slot: 2, rate: 50 });
    const site = await store.addProject({ clientId: acme.id, name: 'Site' });
    const app = await store.addProject({ clientId: other.id, name: 'App' });
    const a = await store.addEntry({ date: '2026-08-03', projectId: site.id, seconds: 600 });
    const b = await store.addEntry({ date: '2026-08-04', projectId: app.id, seconds: 600, billable: false });
    const c = await store.addEntry({ date: '2026-08-05', projectId: site.id, seconds: 600 });
    await store.markInvoiced([c]);

    const all = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(store.filterEntries(all, { clientId: acme.id })).toHaveLength(2);
    expect(store.filterEntries(all, { billing: 'nonbillable' }).map((e) => e.id)).toEqual([b.id]);
    expect(store.filterEntries(all, { billing: 'unbilled' }).map((e) => e.id)).toEqual([a.id]);
    expect(store.filterEntries(all, { billing: 'invoiced' }).map((e) => e.id)).toEqual([c.id]);
    expect(store.filterEntries(all, { clientId: acme.id, billing: 'invoiced' }).map((e) => e.id)).toEqual([c.id]);
  });
});

describe('budgets', () => {
  it('tracks an hours budget across all history, timer included', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 12, 0, 0));
    try {
      const { project } = await seedProject();
      await store.updateProject(project.id, { budget: { kind: 'hours', value: 10, period: 'total' } });
      await store.addEntry({ date: '2026-07-15', projectId: project.id, seconds: 4 * 3600 });
      await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3 * 3600 });

      let prog = await store.budgetProgress(store.project(project.id));
      expect(prog.spent).toBe(7 * 3600);
      expect(prog.value).toBe(10 * 3600);
      expect(prog.ratio).toBeCloseTo(0.7);

      await store.startTimer({ projectId: project.id });
      vi.advanceTimersByTime(3600 * 1000);
      prog = await store.budgetProgress(store.project(project.id));
      expect(prog.spent).toBe(8 * 3600);
      await store.discardTimer();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets monthly amount budgets each month and ignores non-billable time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 12, 0, 0));
    try {
      const { project } = await seedProject({ clientRate: 100 });
      await store.updateProject(project.id, { budget: { kind: 'amount', value: 1000, period: 'monthly' } });
      // Last month is out of window; non-billable earns nothing.
      await store.addEntry({ date: '2026-07-20', projectId: project.id, seconds: 20 * 3600 });
      await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 9 * 3600 });
      await store.addEntry({ date: '2026-08-04', projectId: project.id, seconds: 5 * 3600, billable: false });

      const prog = await store.budgetProgress(store.project(project.id));
      expect(prog.spent).toBe(900);
      expect(prog.value).toBe(1000);
      expect(prog.ratio).toBeCloseTo(0.9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts work dated later in the period, not just up to today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 12, 0, 0));
    try {
      const { project } = await seedProject();
      await store.updateProject(project.id, { budget: { kind: 'hours', value: 10, period: 'monthly' } });
      await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 4 * 3600 });
      // Filled in ahead: the rest of this week, and the month's last day.
      await store.addEntry({ date: '2026-08-07', projectId: project.id, seconds: 5 * 3600 });
      await store.addEntry({ date: '2026-08-31', projectId: project.id, seconds: 2 * 3600 });
      // Next month is a different period and stays out of it.
      await store.addEntry({ date: '2026-09-01', projectId: project.id, seconds: 8 * 3600 });

      const prog = await store.budgetProgress(store.project(project.id));
      expect(prog.spent).toBe(11 * 3600);
      expect(prog.ratio).toBeCloseTo(1.1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts future-dated work against a total budget too', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 12, 0, 0));
    try {
      const { project } = await seedProject();
      await store.updateProject(project.id, { budget: { kind: 'hours', value: 10, period: 'total' } });
      await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 4 * 3600 });
      await store.addEntry({ date: '2026-11-20', projectId: project.id, seconds: 7 * 3600 });

      const prog = await store.budgetProgress(store.project(project.id));
      expect(prog.spent).toBe(11 * 3600);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null without a budget', async () => {
    const { project } = await seedProject();
    expect(await store.budgetProgress(store.project(project.id))).toBeNull();
  });
});

describe('aggregation', () => {
  it('totals and groups by client, project, and task', async () => {
    const acme = await store.addClient({ name: 'Acme', slot: 1, rate: 100 });
    const other = await store.addClient({ name: 'Other', slot: 2, rate: 50 });
    const site = await store.addProject({ clientId: acme.id, name: 'Site' });
    const app = await store.addProject({ clientId: other.id, name: 'App' });

    await store.addEntry({ date: '2026-08-03', projectId: site.id, task: 'Design', seconds: 3600 });
    await store.addEntry({ date: '2026-08-04', projectId: site.id, task: 'Design', seconds: 1800 });
    await store.addEntry({ date: '2026-08-04', projectId: app.id, task: 'Build', seconds: 7200, billable: false });

    const entries = await store.entriesBetween('2026-08-01', '2026-08-31');
    const totals = store.totals(entries);
    expect(totals.seconds).toBe(12600);
    expect(totals.billableSeconds).toBe(5400);
    expect(totals.amount).toBe(150);

    const byClient = store.groupEntries(entries, 'client');
    expect(byClient.map((g) => g.label)).toEqual(['Other', 'Acme']);
    expect(byClient[1].amount).toBe(150);

    const byTask = store.groupEntries(entries, 'task');
    expect(byTask.map((g) => g.label)).toEqual(['Build', 'Design']);
    expect(byTask[1].seconds).toBe(5400);
  });

  it('keeps tracked billable time out of billing rounding', async () => {
    const { project } = await seedProject();
    await store.updateSettings({ rounding: 30 });
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 300 });
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 300, billable: false });

    const entries = await store.entriesBetween('2026-08-03', '2026-08-03');
    const totals = store.totals(entries);
    expect(totals.seconds).toBe(600);
    // What gets billed: 5 minutes rounded up to the half hour.
    expect(totals.billableSeconds).toBe(1800);
    // What was actually tracked on billable work, so a "share of tracked"
    // ratio can never pass 100%.
    expect(totals.trackedBillableSeconds).toBe(300);
    expect(totals.trackedBillableSeconds).toBeLessThanOrEqual(totals.seconds);
  });

  it('keeps a task named "None" apart from entries without a task', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'None', seconds: 600 });
    await store.addEntry({ date: '2026-08-03', projectId: project.id, task: '', seconds: 900 });

    const entries = await store.entriesBetween('2026-08-03', '2026-08-03');
    const groups = store.groupEntries(entries, 'task');
    expect(groups.map((g) => g.label).sort()).toEqual(['No task', 'None']);
  });
});

describe('export / import / sample data', () => {
  it('round-trips through exportAll and importAll', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    const dump = await store.exportAll();

    const fresh = createStore();
    globalThis.puter = createPuterMock();
    await fresh.init();
    await fresh.importAll(dump);
    expect(fresh.clients).toHaveLength(1);
    expect(fresh.months).toEqual(['2026-08']);
    expect(await fresh.entriesBetween('2026-08-01', '2026-08-31')).toHaveLength(1);
  });

  it('rejects foreign files', async () => {
    await expect(store.importAll({ app: 'other' })).rejects.toThrow();
  });

  it('makes a restore the newest settings write, so a refresh cannot undo it', async () => {
    await store.updateSettings({ currency: 'USD', defaultRate: 90 });
    const mine = store.settings.updatedAt;

    // A backup taken before all that, restored now.
    await store.importAll({
      app: 'hourly',
      version: 1,
      settings: { currency: 'EUR', defaultRate: 150, updatedAt: 5 },
      clients: [], projects: [], entries: {},
    });
    expect(store.settings.currency).toBe('EUR');
    // At least as new as the last local write (the same millisecond is
    // fine: an equal stamp still loses to nobody).
    expect(store.settings.updatedAt).toBeGreaterThanOrEqual(mine);

    // Another device wrote its settings after the backup was taken but
    // before the restore. The restore is newer, so it stands.
    mock._kv.set('hourly:settings:v1', { ...DEFAULT_SETTINGS, currency: 'JPY', updatedAt: mine });
    await store.refresh();
    expect(store.settings.currency).toBe('EUR');
    expect(store.settings.defaultRate).toBe(150);
  });

  it('sanitizes malformed backups instead of installing them', async () => {
    await store.importAll({
      app: 'hourly',
      version: 1,
      settings: 'not-an-object',
      clients: 'not-an-array',
      projects: { sneaky: true },
      entries: {
        '../../escape': [{ id: 'x', date: '2026-08-01', seconds: 60, createdAt: 1 }],
        'also/bad': [],
        '2026-13': [],
        '2026-08': 'not-an-array',
      },
    });
    // Nothing malformed survives: arrays stay arrays, settings fall back
    // to defaults, and no file path is built from a non YYYY-MM key.
    expect(store.clients).toEqual([]);
    expect(store.projects).toEqual([]);
    expect(store.settings.currency).toBe(DEFAULT_SETTINGS.currency);
    expect(store.months).toEqual(['2026-08']);
    expect(await store.loadMonth('2026-08')).toEqual([]);
    for (const path of mock._files.keys()) {
      expect(path).toMatch(/^hourly-data\/entries-\d{4}-\d{2}\.json$/);
    }
  });

  it('discards a running timer whose project the import removed', async () => {
    const { project } = await seedProject();
    await store.startTimer({ projectId: project.id, task: 'Exploring' });
    await wipeSampleData(store);
    expect(store.running).toBe(false);
    // Gone from KV too: a reload must not resurrect it.
    const second = createStore();
    await second.init();
    expect(second.timer).toBeNull();
  });

  it('keeps a running timer when the import still contains its project', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    const dump = await store.exportAll();
    await store.startTimer({ projectId: project.id, task: 'Still here' });
    await store.importAll(dump);
    expect(store.running).toBe(true);
    expect(store.timer.task).toBe('Still here');
  });

  it('installs and wipes sample data through the same path', async () => {
    const data = sampleDataset(store);
    await store.importAll(data);
    expect(store.settings.sampleData).toBe(true);
    expect(store.clients.length).toBeGreaterThan(0);
    expect(store.months.length).toBeGreaterThan(0);
    const entries = await store.entriesBetween('2000-01-01', '2100-01-01');
    expect(entries.length).toBeGreaterThan(20);
    // Weekend-free believable data.
    for (const e of entries) {
      const day = new Date(e.date + 'T12:00:00').getDay();
      expect(day).toBeGreaterThan(0);
      expect(day).toBeLessThan(6);
    }
    // No demo day double-books itself: the app cautions about overlapping
    // clock times, so its own sample data must never trip that caution.
    for (const day of new Set(entries.map((e) => e.date))) {
      const timed = entries.filter((e) => e.date === day && e.startedAt && e.endedAt);
      for (const e of timed) {
        expect(store.overlappingEntries(timed, e)).toEqual([]);
      }
    }

    await wipeSampleData(store);
    expect(store.settings.sampleData).toBe(false);
    expect(store.clients).toEqual([]);
    expect(await store.entriesBetween('2000-01-01', '2100-01-01')).toEqual([]);
    // The old month files are gone from disk too.
    for (const key of Object.keys(data.entries)) {
      expect(globalThis.puter._files.has(`hourly-data/entries-${key}.json`)).toBe(false);
    }
  });
});

describe('effective-dated rates', () => {
  it('resolves the period in effect on the entry date, per cascade level', async () => {
    const { client, project } = await seedProject({ clientRate: 100 });
    // Raise the client rate from March 1 without touching February work.
    await store.updateClient(client.id, { rate: withRateFrom(100, 120, '2026-03-01') });

    expect(store.resolveRate({ projectId: project.id, date: '2026-02-15' })).toBe(100);
    expect(store.resolveRate({ projectId: project.id, date: '2026-03-01' })).toBe(120);
    expect(store.resolveRate({ projectId: project.id, date: '2026-06-01' })).toBe(120);

    // Amounts follow the entry's own date.
    const feb = await store.addEntry({ date: '2026-02-15', projectId: project.id, seconds: 3600 });
    const mar = await store.addEntry({ date: '2026-03-15', projectId: project.id, seconds: 3600 });
    expect(store.entryAmount(feb)).toBe(100);
    expect(store.entryAmount(mar)).toBe(120);
  });

  it('falls through the cascade when a level has no period yet', async () => {
    await store.updateSettings({ defaultRate: 40 });
    const client = await store.addClient({ name: 'New', slot: 1, rate: [{ from: '2026-03-01', rate: 90 }] });
    const project = await store.addProject({ clientId: client.id, name: 'P' });
    // Work before the client's first dated rate bills at the default.
    expect(store.resolveRate({ projectId: project.id, date: '2026-02-01' })).toBe(40);
    expect(store.resolveRate({ projectId: project.id, date: '2026-03-02' })).toBe(90);
  });

  it('edits in place without a date and stacks periods with one', () => {
    // Plain numbers stay plain when edited without a date.
    expect(withRateFrom(100, 110)).toBe(110);
    expect(withRateFrom(null, 100)).toBe(100);
    expect(withRateFrom(100, null)).toBeNull();

    const dated = withRateFrom(100, 120, '2026-03-01');
    expect(dated).toEqual([{ from: null, rate: 100 }, { from: '2026-03-01', rate: 120 }]);
    // A dateless edit then updates the currently effective period.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5));
    try {
      expect(withRateFrom(dated, 130)).toEqual([{ from: null, rate: 100 }, { from: '2026-03-01', rate: 130 }]);
    } finally {
      vi.useRealTimers();
    }
    // Re-dating the same day replaces that period instead of stacking.
    expect(withRateFrom(dated, 125, '2026-03-01')).toEqual([{ from: null, rate: 100 }, { from: '2026-03-01', rate: 125 }]);
    expect(rateAt(dated, '2026-01-01')).toBe(100);
    expect(rateAt(dated, '2026-03-01')).toBe(120);
  });

  it('clearing a rate from a date stops billing there without repricing earlier work', async () => {
    await store.updateSettings({ defaultRate: 40 });
    const { client, project } = await seedProject({ clientRate: 100 });
    // "No rate of my own from September": earlier work keeps the 100 the
    // date was chosen to protect, later work falls through to the default.
    await store.updateClient(client.id, { rate: withRateFrom(100, null, '2026-09-01') });

    expect(store.client(client.id).rate).toEqual([{ from: null, rate: 100 }, { from: '2026-09-01', rate: null }]);
    expect(store.resolveRate({ projectId: project.id, date: '2026-08-31' })).toBe(100);
    expect(store.resolveRate({ projectId: project.id, date: '2026-09-01' })).toBe(40);

    // A rate can start again later without disturbing either period.
    const resumed = withRateFrom(store.client(client.id).rate, 130, '2026-12-01');
    await store.updateClient(client.id, { rate: resumed });
    expect(store.resolveRate({ projectId: project.id, date: '2026-08-31' })).toBe(100);
    expect(store.resolveRate({ projectId: project.id, date: '2026-10-01' })).toBe(40);
    expect(store.resolveRate({ projectId: project.id, date: '2026-12-02' })).toBe(130);
  });

  it('collapses a history that never names a rate back to none', () => {
    // Undated clearing still wipes the whole history, as before.
    expect(withRateFrom(100, null)).toBeNull();
    // A dated clear on a level that had no rate to begin with is nothing.
    expect(withRateFrom(null, null, '2026-09-01')).toBeNull();
    expect(withRateFrom([{ from: '2026-03-01', rate: 90 }], null, '2026-03-01')).toBeNull();
  });

  it('keeps invoicing locks frozen across rate-history changes', async () => {
    const { client, project } = await seedProject({ clientRate: 100 });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.markInvoiced([entry]);
    await store.updateClient(client.id, { rate: withRateFrom(100, 200, '2026-01-01') });
    const [invoiced] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(store.entryAmount(invoiced)).toBe(100); // locked at invoicing
  });
});

describe('per-client currency', () => {
  it('resolves the client currency, falling back to the global default', async () => {
    const { project } = await seedProject();
    const eur = await store.addClient({ name: 'Berlin GmbH', slot: 2, rate: 90, currency: 'EUR' });
    const eurProject = await store.addProject({ clientId: eur.id, name: 'App' });

    expect(store.resolveCurrency({ projectId: project.id })).toBe('USD');
    expect(store.resolveCurrency({ projectId: eurProject.id })).toBe('EUR');

    await store.updateSettings({ currency: 'GBP' });
    expect(store.resolveCurrency({ projectId: project.id })).toBe('GBP');
    expect(store.resolveCurrency({ projectId: eurProject.id })).toBe('EUR');
  });

  it('freezes the currency at invoicing and thaws it on un-mark', async () => {
    const eur = await store.addClient({ name: 'Berlin GmbH', slot: 2, rate: 90, currency: 'EUR' });
    const project = await store.addProject({ clientId: eur.id, name: 'App' });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.markInvoiced([entry]);

    // The client switching currency later must not rewrite the billed record.
    await store.updateClient(eur.id, { currency: 'CHF' });
    const [invoiced] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(invoiced.lockedCurrency).toBe('EUR');
    expect(store.resolveCurrency(invoiced)).toBe('EUR');

    await store.markInvoiced([invoiced], false);
    const [thawed] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(thawed.lockedCurrency).toBeNull();
    expect(store.resolveCurrency(thawed)).toBe('CHF');
  });

  it('totals per currency side by side, never summing across them', async () => {
    const usd = await store.addClient({ name: 'US Co', slot: 1, rate: 100 });
    const eur = await store.addClient({ name: 'Berlin GmbH', slot: 2, rate: 90, currency: 'EUR' });
    const usdProject = await store.addProject({ clientId: usd.id, name: 'Site' });
    const eurProject = await store.addProject({ clientId: eur.id, name: 'App' });
    await store.addEntry({ date: '2026-08-03', projectId: usdProject.id, seconds: 3600 });
    await store.addEntry({ date: '2026-08-03', projectId: usdProject.id, seconds: 1800 });
    await store.addEntry({ date: '2026-08-04', projectId: eurProject.id, seconds: 3600 });
    await store.addEntry({ date: '2026-08-04', projectId: eurProject.id, seconds: 3600, billable: false });

    const entries = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(store.amountsByCurrency(entries)).toEqual([
      { currency: 'USD', amount: 150 },
      { currency: 'EUR', amount: 90 },
    ]);

    // Task groups spanning clients split per currency too.
    const [group] = store.groupEntries(entries.filter((e) => e.billable), 'task');
    expect(group.amounts).toHaveLength(2);
  });
});

describe('bulk edits', () => {
  it('patches many entries across month files and skips invoiced ones', async () => {
    const { client, project } = await seedProject();
    const other = await store.addProject({ clientId: client.id, name: 'Other' });
    const jul = await store.addEntry({ date: '2026-07-30', projectId: project.id, task: 'a', seconds: 600 });
    const aug = await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'b', seconds: 900 });
    const locked = await store.addEntry({ date: '2026-08-04', projectId: project.id, task: 'c', seconds: 300 });
    await store.markInvoiced([locked]);

    const items = [jul, aug, locked].map((e) => ({ id: e.id, date: e.date, patch: { projectId: other.id, task: 'Renamed' } }));
    const res = await store.bulkPatch(items);
    expect(res.changed).toBe(2);
    expect(res.skipped).toBe(1);

    const all = await store.entriesBetween('2026-07-01', '2026-08-31');
    const patched = all.filter((e) => e.id !== locked.id);
    expect(patched.every((e) => e.projectId === other.id && e.task === 'Renamed')).toBe(true);
    // The invoiced record is untouched.
    expect(all.find((e) => e.id === locked.id).projectId).toBe(project.id);

    // The inverse patch restores exactly the prior values.
    await store.bulkPatch(res.inverse);
    const restored = await store.entriesBetween('2026-07-01', '2026-08-31');
    expect(restored.find((e) => e.id === jul.id).task).toBe('a');
    expect(restored.find((e) => e.id === aug.id).projectId).toBe(project.id);
  });

  it('restores original invoice locks on a reopened entry (reopen undo)', async () => {
    const { client, project } = await seedProject({ clientRate: 100 });
    await store.updateSettings({ rounding: 15 });
    await store.updateClient(client.id, { minimumMinutes: 30 });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.markInvoiced([entry]);
    const [locked] = await store.entriesBetween('2026-08-03', '2026-08-03');

    // Reopen, then the world changes: rates, rounding, and the minimum
    // billable time all move on.
    await store.markInvoiced([locked], false);
    await store.updateClient(client.id, { rate: 250, minimumMinutes: null });
    await store.updateSettings({ rounding: 0 });

    // Undo restores the exact original locks, not today's resolution.
    // Every lock, too: leaving one out reprices the entry just as surely
    // as re-marking it would.
    await store.bulkPatch([{
      id: locked.id,
      date: locked.date,
      patch: invoiceLocksOf(locked),
    }]);
    const [restored] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(restored.invoicedAt).toBe(locked.invoicedAt);
    expect(restored.lockedRate).toBe(100);
    expect(restored.lockedRounding).toBe(15);
    expect(restored.lockedMinimum).toBe(30);
    expect(store.entryAmount(restored)).toBe(100);
  });

  it('names every lock invoicing freezes, so a reopen undo can restore them all', async () => {
    const { client, project } = await seedProject({ clientRate: 100 });
    await store.updateClient(client.id, { rounding: 15, minimumMinutes: 30, currency: 'EUR' });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 });
    await store.markInvoiced([entry]);
    const [locked] = await store.entriesBetween('2026-08-03', '2026-08-03');

    // Whatever markInvoiced stamps is what the undo has to put back: a
    // lock added to one side and forgotten on the other reprices the bill.
    const frozen = Object.keys(locked).filter((k) => k === 'invoicedAt' || k.startsWith('locked'));
    expect([...frozen].sort()).toEqual([...INVOICE_LOCK_FIELDS].sort());
    expect(invoiceLocksOf(locked)).toEqual({
      invoicedAt: locked.invoicedAt,
      lockedRate: 100,
      lockedRounding: 15,
      lockedMinimum: 30,
      lockedCurrency: 'EUR',
    });
  });

  it('keeps a frozen minimum through a reopen undo (a short billed call)', async () => {
    const { client, project } = await seedProject({ clientRate: 120 });
    await store.updateClient(client.id, { minimumMinutes: 15 });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 5 * 60 });
    await store.markInvoiced([entry]);
    const [locked] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(store.billedSeconds(locked)).toBe(15 * 60);
    expect(store.entryAmount(locked)).toBe(30);

    // Reopened by mistake; the client's minimum is dropped meanwhile.
    await store.markInvoiced([locked], false);
    await store.updateClient(client.id, { minimumMinutes: null });

    await store.bulkPatch([{
      id: locked.id,
      date: locked.date,
      patch: invoiceLocksOf(locked),
    }]);
    const [restored] = await store.entriesBetween('2026-08-03', '2026-08-03');
    // The bill said 15 minutes at $120; undoing the reopen must not turn
    // that into 5 minutes.
    expect(store.billedSeconds(restored)).toBe(15 * 60);
    expect(store.entryAmount(restored)).toBe(30);
  });

  it('moves an entry\u2019s end when its duration changes, keeping the start', async () => {
    const { project } = await seedProject();
    const startedAt = new Date(2026, 7, 20, 13, 0, 0).getTime();
    const e = await store.addEntry({
      date: '2026-08-20', projectId: project.id, seconds: 70 * 60,
      startedAt, endedAt: startedAt + 70 * 60 * 1000,
    });

    // A grid cell retyped as three hours: the entry must not claim three
    // hours of work inside a seventy-minute window.
    await store.updateEntry(e.id, e.date, store.durationPatch(e, 3 * 3600));
    const [after] = await store.entriesBetween('2026-08-20', '2026-08-20');
    expect(after.seconds).toBe(3 * 3600);
    expect(after.startedAt).toBe(startedAt);
    expect(after.endedAt).toBe(startedAt + 3 * 3600 * 1000);
    expect((after.endedAt - after.startedAt) / 1000).toBe(after.seconds);
  });

  it('leaves a duration-only entry without clock times', async () => {
    const { project } = await seedProject();
    const e = await store.addEntry({ date: '2026-08-20', projectId: project.id, seconds: 600 });
    expect(store.durationPatch(e, 1800)).toEqual({ seconds: 1800 });
    await store.updateEntry(e.id, e.date, store.durationPatch(e, 1800));
    const [after] = await store.entriesBetween('2026-08-20', '2026-08-20');
    expect(after.seconds).toBe(1800);
    expect(after.startedAt).toBeNull();
    expect(after.endedAt).toBeNull();
  });

  /**
   * A dataset holding a record stamped ahead of this clock: sample data,
   * a restored backup, or work synced from a device whose clock runs
   * fast. Newest-wins compared the edit against it and kept the stored
   * copy, so the write disappeared while the caller was told it landed.
   */
  async function seedStampedAhead(patch = {}) {
    const client = await store.addClient({ name: 'Acme', slot: 1, rate: 100 });
    const project = await store.addProject({ clientId: client.id, name: 'Site' });
    const ahead = Date.now() + 60 * 60 * 1000;
    const id = 'ahead-1';
    await store.importAll({
      app: 'hourly',
      version: 1,
      settings: store.settings,
      clients: [client],
      projects: [project],
      entries: {
        '2026-08': [{
          id, date: '2026-08-20', projectId: project.id, task: 'before', notes: '',
          seconds: 3600, startedAt: null, endedAt: null, billable: true, rate: null,
          invoicedAt: null, lockedRate: null, lockedRounding: null,
          lockedMinimum: null, lockedCurrency: null,
          createdAt: ahead, updatedAt: ahead, ...patch,
        }],
      },
    });
    return { client, project, id, ahead };
  }

  it('lands an edit on a record it holds stamped ahead of the clock', async () => {
    const { id, ahead } = await seedStampedAhead();

    await store.updateEntry(id, '2026-08-20', { task: 'after' });
    const [edited] = await store.entriesBetween('2026-08-20', '2026-08-20');
    expect(edited.task).toBe('after');
    expect(edited.updatedAt).toBeGreaterThan(ahead);

    // It survives a re-read from the server, not just this tab's memory.
    const second = createStore();
    await second.init();
    expect((await second.entriesBetween('2026-08-20', '2026-08-20'))[0].task).toBe('after');
  });

  it('lands an invoice lock on a record it holds stamped ahead of the clock', async () => {
    const { client, id } = await seedStampedAhead();

    // The invoice recorded the entry while the lock never stuck, leaving
    // the same time sitting in "unbilled" for a second invoice to take.
    const invoice = await store.createInvoice({ clientId: client.id, entries: [{ id, date: '2026-08-20' }] });
    expect(invoice.entries).toHaveLength(1);
    const [locked] = await store.entriesBetween('2026-08-20', '2026-08-20');
    expect(locked.invoicedAt).not.toBeNull();
    expect(store.filterEntries([locked], { billing: 'unbilled' })).toEqual([]);

    const second = createStore();
    await second.init();
    expect((await second.entriesBetween('2026-08-20', '2026-08-20'))[0].invoicedAt).not.toBeNull();
  });

  it('lands a payment on an invoice it holds stamped ahead of the clock', async () => {
    const { client, id } = await seedStampedAhead();
    const invoice = await store.createInvoice({ clientId: client.id, entries: [{ id, date: '2026-08-20' }] });

    // The invoice record now carries another device's stamp, from ahead
    // of this clock. Recording money against it must still land.
    const ahead = Date.now() + 60 * 60 * 1000;
    store.invoices = store.invoices.map((i) => ({ ...i, updatedAt: ahead }));
    await mock.kv.set('hourly:invoices:v1', store.invoices);

    await store.addPayment(invoice.id, { date: '2026-08-21', amount: invoice.total });
    const paid = store.invoices.find((i) => i.id === invoice.id);
    expect(paidAmount(paid)).toBe(invoice.total);
    expect(invoiceState(paid, '2026-08-21')).toBe('paid');

    // And it survives a re-read, not just this tab's memory.
    const second = createStore();
    await second.init();
    expect(paidAmount(second.invoices.find((i) => i.id === invoice.id))).toBe(invoice.total);
  });

  it('lands a settings edit on a copy it holds stamped ahead of the clock', async () => {
    const ahead = Date.now() + 60 * 60 * 1000;
    store.settings = { ...store.settings, updatedAt: ahead };
    await store.updateSettings({ currency: 'EUR' });
    expect(store.settings.updatedAt).toBeGreaterThan(ahead);
    // A refresh against the copy just written must not undo the edit.
    await store.refresh();
    expect(store.settings.currency).toBe('EUR');
  });

  it('still loses to a newer copy it has not caught up with', async () => {
    const { project } = await seedProject();
    const e = await store.addEntry({ date: '2026-08-20', projectId: project.id, task: 'mine', seconds: 600 });

    // Another device wrote after this one read; this device never saw it.
    // stampFor must not hand a stale editor the win.
    const stored = JSON.parse(mock._files.get('hourly-data/entries-2026-08.json'));
    await mock.fs.write('hourly-data/entries-2026-08.json',
      JSON.stringify(stored.map((r) => (r.id === e.id ? { ...r, task: 'theirs', updatedAt: Date.now() + 60000 } : r))));

    await store.updateEntry(e.id, e.date, { task: 'stale' });
    const [after] = await store.entriesBetween('2026-08-20', '2026-08-20');
    expect(after.task).toBe('theirs');
  });

  it('never lets a bulk patch move an entry across months', async () => {
    const { project } = await seedProject();
    const e = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 });
    await store.bulkPatch([{ id: e.id, date: e.date, patch: { date: '2026-07-01', task: 'kept' } }]);
    const [after] = await store.entriesBetween('2026-08-01', '2026-08-31');
    expect(after.date).toBe('2026-08-03');
    expect(after.task).toBe('kept');
  });

  it('never writes a month file that a mark-invoiced left unchanged', async () => {
    const { project } = await seedProject();
    const e = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 600 });
    const writes = vi.spyOn(mock.fs, 'write');

    expect(await store.markInvoiced([e], true)).toBe(1);
    expect(writes).toHaveBeenCalledTimes(1);
    // Marking what is already marked, and reopening what is already open,
    // change nothing and so cost nothing.
    expect(await store.markInvoiced([e], true)).toBe(0);
    expect(await store.markInvoiced([{ ...e, invoicedAt: null }], false)).toBe(1);
    expect(await store.markInvoiced([{ ...e, invoicedAt: null }], false)).toBe(0);
    expect(writes).toHaveBeenCalledTimes(2);
    writes.mockRestore();
  });

  it('bulk-deletes with undo and skips invoiced entries', async () => {
    const { project } = await seedProject();
    const a = await store.addEntry({ date: '2026-07-30', projectId: project.id, seconds: 600 });
    const b = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 900 });
    const locked = await store.addEntry({ date: '2026-08-04', projectId: project.id, seconds: 300 });
    await store.markInvoiced([locked]);

    const res = await store.bulkDelete([a, b, locked].map((e) => ({ id: e.id, date: e.date })));
    expect(res.deleted).toBe(2);
    expect(res.skipped).toBe(1);
    expect((await store.entriesBetween('2026-07-01', '2026-08-31')).map((e) => e.id)).toEqual([locked.id]);

    await store.restoreEntries(res.removed);
    expect(await store.entriesBetween('2026-07-01', '2026-08-31')).toHaveLength(3);
  });
});

describe('per-client billing rules', () => {
  async function seedRules(rules) {
    const client = await store.addClient({ name: 'Acme', slot: 1, rate: 100, ...rules });
    const project = await store.addProject({ clientId: client.id, name: 'Site' });
    return { client, project };
  }

  it('rounds through the client, falling back to the global setting', async () => {
    await store.updateSettings({ rounding: 0 });
    const { client, project } = await seedRules({ rounding: 15 });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 16 * 60 });
    expect(store.billedSeconds(entry)).toBe(30 * 60); // client rule, not the global none
    expect(store.entryAmount(entry)).toBe(50);

    // Cleared, it inherits again; zero at either level means exact time.
    await store.updateClient(client.id, { rounding: null });
    await store.updateSettings({ rounding: 30 });
    expect(store.billedSeconds(entry)).toBe(30 * 60);
    await store.updateClient(client.id, { rounding: 0 });
    expect(store.billedSeconds(entry)).toBe(16 * 60);
  });

  it('bills at least the client minimum, on top of rounding, never twice', async () => {
    await store.updateSettings({ rounding: 10 });
    const { project } = await seedRules({ minimumMinutes: 15 });
    const short = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3 * 60 });
    // Rounded to 10, floored at 15: the minimum is a floor, not a second charge.
    expect(store.billedSeconds(short)).toBe(15 * 60);
    const long = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 22 * 60 });
    expect(store.billedSeconds(long)).toBe(30 * 60);
  });

  it('freezes the client rules at invoicing, and leaves old billed time alone', async () => {
    const { client, project } = await seedRules({ rounding: 15, minimumMinutes: 15 });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 5 * 60 });
    await store.markInvoiced([entry]);
    const [locked] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(locked.lockedRounding).toBe(15);
    expect(locked.lockedMinimum).toBe(15);
    expect(store.billedSeconds(locked)).toBe(15 * 60);

    // Dropping both rules must not reprice what is already billed.
    await store.updateClient(client.id, { rounding: 0, minimumMinutes: null });
    expect(store.billedSeconds(locked)).toBe(15 * 60);
    // Reopening puts it back under the live rules.
    await store.markInvoiced([locked], false);
    const [thawed] = await store.entriesBetween('2026-08-03', '2026-08-03');
    expect(store.billedSeconds(thawed)).toBe(5 * 60);
  });

  it('bills entries invoiced before minimums existed at no minimum', async () => {
    const { client, project } = await seedRules({ rounding: 15 });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 5 * 60 });
    await store.markInvoiced([entry]);
    const [locked] = await store.entriesBetween('2026-08-03', '2026-08-03');
    delete locked.lockedMinimum; // the shape written before this rule existed
    await store.updateClient(client.id, { minimumMinutes: 60 });
    expect(store.billedSeconds(locked)).toBe(15 * 60);
  });

  it('resolves tax and payment terms through the client', async () => {
    await store.updateSettings({ taxRate: 19, paymentTermsDays: 14 });
    const { client } = await seedRules({});
    expect(store.resolveTaxRate(client.id)).toBe(19);
    expect(store.resolvePaymentTermsDays(client.id)).toBe(14);

    await store.updateClient(client.id, { taxRate: 0, paymentTermsDays: 30 });
    expect(store.resolveTaxRate(client.id)).toBe(0); // zero-rated, not inheriting
    expect(store.resolvePaymentTermsDays(client.id)).toBe(30);

    // Due on receipt is a real term, and distinct from having none.
    await store.updateClient(client.id, { paymentTermsDays: 0 });
    expect(store.resolvePaymentTermsDays(client.id)).toBe(0);
    await store.updateSettings({ paymentTermsDays: null });
    await store.updateClient(client.id, { paymentTermsDays: null });
    expect(store.resolvePaymentTermsDays(client.id)).toBeNull();
  });

  it('dates a new invoice from the client terms, not the global ones', async () => {
    await store.updateSettings({ paymentTermsDays: 14 });
    const { client, project } = await seedRules({ paymentTermsDays: 30 });
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    const inv = await store.createInvoice({ clientId: client.id, entries: [entry], issueDate: '2026-08-03' });
    expect(inv.dueDate).toBe('2026-09-02');
  });
});

describe('invoices', () => {
  async function seedUnbilled() {
    await store.updateSettings({ businessName: 'Jane Doe Consulting', invoiceTerms: 'Due in 14 days' });
    const client = await store.addClient({
      name: 'Acme', slot: 1, rate: 100, currency: 'EUR',
      billingEmail: 'billing@acme.test', billingAddress: '1 Main St', taxId: 'DE123',
    });
    const project = await store.addProject({ clientId: client.id, name: 'Site' });
    const a = await store.addEntry({ date: '2026-07-30', projectId: project.id, task: 'Build', seconds: 2 * 3600 });
    const b = await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Build', seconds: 3600 });
    return { client, project, entries: [a, b] };
  }

  it('creates a numbered invoice, locking entries and freezing details', async () => {
    const { client, entries } = await seedUnbilled();
    const inv = await store.createInvoice({ clientId: client.id, entries, taxRate: 19, notes: 'Thanks!' });

    expect(inv.number).toBe(1);
    expect(inv.currency).toBe('EUR');
    expect(inv.seconds).toBe(3 * 3600);
    expect(inv.subtotal).toBe(300);
    expect(inv.tax).toBe(57);
    expect(inv.total).toBe(357);
    expect(inv.periodFrom).toBe('2026-07-30');
    expect(inv.periodTo).toBe('2026-08-03');
    expect(inv.business.name).toBe('Jane Doe Consulting');
    expect(inv.terms).toBe('Due in 14 days');
    expect(inv.billTo).toEqual({ name: 'Acme', address: '1 Main St', email: 'billing@acme.test', taxId: 'DE123' });

    // Entries are locked billing records now, currency and rate frozen.
    const covered = await store.invoiceEntries(inv);
    expect(covered).toHaveLength(2);
    expect(covered.every((e) => e.invoicedAt && e.lockedRate === 100 && e.lockedCurrency === 'EUR')).toBe(true);

    // Later profile edits never rewrite the issued document.
    await store.updateClient(client.id, { name: 'Renamed', billingAddress: 'Elsewhere' });
    expect(store.invoices[0].billTo.name).toBe('Acme');

    // Numbering is sequential and the record survives a reload.
    const second = createStore();
    await second.init();
    expect(second.invoices).toHaveLength(1);
    expect(second.invoices[0].number).toBe(1);
  });

  it('voiding reopens the entries and frees the number', async () => {
    const { client, entries } = await seedUnbilled();
    const inv = await store.createInvoice({ clientId: client.id, entries });
    await store.voidInvoice(inv.id);
    expect(store.invoices).toHaveLength(0);
    const all = await store.entriesBetween('2026-07-01', '2026-08-31');
    expect(all.every((e) => !e.invoicedAt && e.lockedRate === null)).toBe(true);
    const again = await store.createInvoice({ clientId: client.id, entries: all });
    expect(again.number).toBe(1);
  });

  it('only invoices unbilled billable entries and rolls back if the record fails', async () => {
    const { client, project, entries } = await seedUnbilled();
    const nonBillable = await store.addEntry({ date: '2026-08-04', projectId: project.id, seconds: 3600, billable: false });
    await store.markInvoiced([entries[0]]);
    const inv = await store.createInvoice({ clientId: client.id, entries: [...entries, nonBillable] });
    expect(inv.entries).toHaveLength(1); // only the unbilled billable one
    expect(inv.subtotal).toBe(100);

    // A failed invoice write must not leave entries marked.
    await store.voidInvoice(inv.id);
    const realSet = mock.kv.set;
    mock.kv.set = async (key, value) => {
      if (key === 'hourly:invoices:v1') throw new Error('server error');
      return realSet(key, value);
    };
    await expect(store.createInvoice({ clientId: client.id, entries: [entries[1]] })).rejects.toThrow();
    mock.kv.set = realSet;
    const [after] = (await store.entriesBetween('2026-08-03', '2026-08-03'));
    expect(after.invoicedAt).toBeNull();
  });

  it('knows which invoice covers an entry, and that voiding uncovers it', async () => {
    const { client, entries } = await seedUnbilled();
    const inv = await store.createInvoice({ clientId: client.id, entries: [entries[0]] });
    expect(store.invoiceFor(entries[0].id)?.id).toBe(inv.id);
    // Hand-marked entries have no covering document.
    await store.markInvoiced([entries[1]]);
    expect(store.invoiceFor(entries[1].id)).toBeNull();
    // Voiding is the one door that reopens covered entries.
    await store.voidInvoice(inv.id);
    expect(store.invoiceFor(entries[0].id)).toBeNull();
  });

  it('freezes branding and payment details, and keeps replacing them out of issued invoices', async () => {
    await store.updateSettings({ paymentDetails: 'IBAN DE00 1234', businessLogo: 'hourly-data/logo-1000.png' });
    const { client, entries } = await seedUnbilled();
    const inv = await store.createInvoice({ clientId: client.id, entries });
    expect(inv.business.payment).toBe('IBAN DE00 1234');
    expect(inv.business.logo).toBe('hourly-data/logo-1000.png');

    // A rebrand: new payment account, new logo file, terms rewritten.
    await store.updateSettings({ paymentDetails: 'Wise link', businessLogo: '', invoiceTerms: 'Net 30' });
    expect(store.invoices[0].business.payment).toBe('IBAN DE00 1234');
    expect(store.invoices[0].business.logo).toBe('hourly-data/logo-1000.png');
    expect(store.invoices[0].terms).toBe('Due in 14 days');
  });

  it('stores a logo as its own file and reads it back, refusing anything else', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const path = await store.saveLogo(blob);
    expect(isLogoPath(path)).toBe(true);
    expect(store.settings.businessLogo).toBe(path);
    expect(await store.readLogo(path)).toBeInstanceOf(Blob);

    // Replacing writes a second file, so the first invoice's path still reads.
    const second = await store.saveLogo(new Blob(['x'], { type: 'image/jpeg' }));
    expect(second).not.toBe(path);
    expect(await store.readLogo(path)).toBeInstanceOf(Blob);

    // Nothing outside the app's own naming is ever read, and an image type
    // the sheet cannot print is refused before anything is written.
    expect(await store.readLogo('hourly-data/entries-2026-08.json')).toBeNull();
    expect(await store.readLogo('../../etc/passwd')).toBeNull();
    expect(await store.readLogo('')).toBeNull();
    await expect(store.saveLogo(new Blob(['x'], { type: 'image/gif' }))).rejects.toThrow();
  });

  it('dates an invoice from the payment terms and derives its state from payments', async () => {
    await store.updateSettings({ paymentTermsDays: 14 });
    const { client, entries } = await seedUnbilled();
    const inv = await store.createInvoice({ clientId: client.id, entries, issueDate: '2026-08-03' });
    expect(inv.dueDate).toBe('2026-08-17');
    expect(inv.payments).toEqual([]);
    expect(invoiceState(inv, '2026-08-10')).toBe('open');
    expect(invoiceState(inv, '2026-08-18')).toBe('overdue');
    expect(outstandingAmount(inv)).toBe(300);

    // A deposit: partly paid, and no longer overdue-blind about what is left.
    await store.addPayment(inv.id, { date: '2026-08-10', amount: 100, note: 'Deposit' });
    let stored = store.invoices[0];
    expect(paidAmount(stored)).toBe(100);
    expect(outstandingAmount(stored)).toBe(200);
    expect(invoiceState(stored, '2026-08-10')).toBe('partial');
    expect(invoiceState(stored, '2026-08-18')).toBe('overdue');

    // The balance settles it, whatever the due date says.
    await store.addPayment(inv.id, { date: '2026-08-20', amount: 200 });
    stored = store.invoices[0];
    expect(invoiceState(stored, '2026-09-30')).toBe('paid');
    expect(outstandingAmount(stored)).toBe(0);
    expect(lastPaymentDate(stored)).toBe('2026-08-20');

    // Removing a payment puts the debt back.
    await store.removePayment(inv.id, stored.payments[1].id);
    expect(invoiceState(store.invoices[0], '2026-08-18')).toBe('overdue');
    expect(outstandingAmount(store.invoices[0])).toBe(200);

    // Payments survive a reload, and a bad amount is refused outright.
    const second = createStore();
    await second.init();
    expect(second.invoices[0].payments).toHaveLength(1);
    await expect(store.addPayment(inv.id, { date: '2026-08-20', amount: 0 })).rejects.toThrow();
    await expect(store.addPayment('nope', { date: '2026-08-20', amount: 5 })).rejects.toThrow();
  });

  it('leaves an invoice with no terms without a due date, and never calls it late', async () => {
    const { client, entries } = await seedUnbilled();
    const inv = await store.createInvoice({ clientId: client.id, entries, issueDate: '2020-01-01' });
    expect(inv.dueDate).toBeNull();
    expect(invoiceState(inv, '2026-08-20')).toBe('open');
    expect(dueDateFor('2026-08-03', null)).toBeNull();
    // An older record, written before payments existed, reads as open.
    expect(invoiceState({ total: 100 })).toBe('open');
    expect(paidAmount({ total: 100 })).toBe(0);
  });

  it('totals what is owed per currency, and ages the oldest overdue', async () => {
    await store.updateSettings({ paymentTermsDays: 7 });
    const { client, entries } = await seedUnbilled(); // EUR client
    const usd = await store.addClient({ name: 'Globex', slot: 2, rate: 50 });
    const usdProject = await store.addProject({ clientId: usd.id, name: 'App' });
    const usdEntry = await store.addEntry({ date: '2026-08-05', projectId: usdProject.id, seconds: 3600 });

    const late = await store.createInvoice({ clientId: client.id, entries, issueDate: '2026-08-01' });
    const fresh = await store.createInvoice({ clientId: usd.id, entries: [usdEntry], issueDate: '2026-08-19' });
    await store.addPayment(late.id, { date: '2026-08-05', amount: 100 });

    const [eur, other] = store.outstandingByCurrency('2026-08-20');
    expect(eur).toEqual({ currency: 'EUR', open: 200, overdue: 200, oldestOverdue: '2026-08-08', count: 1, overdueCount: 1 });
    expect(other).toEqual({ currency: 'USD', open: 50, overdue: 0, oldestOverdue: null, count: 1, overdueCount: 0 });

    // Settling one takes it out of the debt entirely.
    await store.addPayment(fresh.id, { date: '2026-08-20', amount: 50 });
    expect(store.outstandingByCurrency('2026-08-20').map((b) => b.currency)).toEqual(['EUR']);
  });

  it('bills fees, expenses, and discounts alongside time, taxing only what is taxable', async () => {
    const { client, entries } = await seedUnbilled(); // 3h at 100 EUR = 300
    const inv = await store.createInvoice({
      clientId: client.id,
      entries,
      taxRate: 10,
      lines: [
        { kind: 'fee', label: 'Milestone 2', quantity: 1, unitAmount: 1000 },
        { kind: 'expense', label: 'Stock licence', quantity: 3, unitAmount: 25, taxable: false },
        { kind: 'discount', label: 'Long-term client', unitAmount: 50 },
      ],
    });
    expect(inv.lines.map((l) => l.amount)).toEqual([1000, 75, -50]);
    expect(inv.subtotal).toBe(1325); // 300 time + 1000 + 75 - 50
    // Taxed: 300 + 1000 - 50 = 1250; the zero-rated expense stays out.
    expect(inv.tax).toBe(125);
    expect(inv.total).toBe(1450);
    expect(inv.seconds).toBe(3 * 3600);

    // Frozen with the rest of the record: nothing recomputes it later.
    const second = createStore();
    await second.init();
    expect(second.invoices[0].lines).toHaveLength(3);
    expect(second.invoices[0].total).toBe(1450);
  });

  it('issues an invoice with no tracked time at all, and refuses an empty one', async () => {
    const client = await store.addClient({ name: 'Fixed Co', slot: 2 });
    const inv = await store.createInvoice({
      clientId: client.id,
      entries: [],
      lines: [{ kind: 'fee', label: 'Website, fixed price', quantity: 1, unitAmount: 4000 }],
    });
    expect(inv.seconds).toBe(0);
    expect(inv.subtotal).toBe(4000);
    expect(inv.periodFrom).toBeNull();
    expect(inv.periodTo).toBeNull();
    expect(inv.entries).toEqual([]);

    await expect(store.createInvoice({ clientId: client.id, entries: [], lines: [] }))
      .rejects.toThrow(/Nothing to invoice/);
    // A line worth nothing is not a line.
    await expect(store.createInvoice({
      clientId: client.id, entries: [], lines: [{ kind: 'fee', label: 'Free', unitAmount: 0 }],
    })).rejects.toThrow(/Nothing to invoice/);
  });

  it('normalizes lines it is handed, and never lets a discount create negative tax', () => {
    const normalized = normalizeInvoiceLines([
      { kind: 'discount', label: '  ', quantity: 4, unitAmount: -80 },
      { kind: 'weird', label: 'x'.repeat(200), quantity: -2, unitAmount: 12.5 },
      // Amounts arrive already parsed from the sheet; anything unreadable
      // is worth nothing and is dropped rather than billed as zero.
      { kind: 'fee', label: 'Typo', unitAmount: '12,50' },
    ]);
    expect(normalized).toHaveLength(2);
    const [discount, fee] = normalized;
    // A discount is one deduction, always negative, and labelled by kind.
    expect(discount).toMatchObject({ kind: 'discount', label: 'Discount', quantity: 1, amount: -80 });
    // An unknown kind falls back to a fee; a bad quantity to one.
    expect(fee).toMatchObject({ kind: 'fee', quantity: 1, amount: 12.5 });
    expect(fee.label).toHaveLength(120);
    expect(linesTotal([{ amount: 10 }, { amount: -4 }])).toBe(6);

    const wiped = invoiceTotals(100, [{ amount: -500, taxable: true }], 19);
    expect(wiped.tax).toBe(0);
    expect(wiped.total).toBe(-400); // the sheet blocks this; the math stays honest
  });

  it('round-trips invoices through export and import', async () => {
    const { client, entries } = await seedUnbilled();
    await store.createInvoice({ clientId: client.id, entries });
    const dump = await store.exportAll();

    const fresh = createStore();
    globalThis.puter = createPuterMock();
    await fresh.init();
    await fresh.importAll(dump);
    expect(fresh.invoices).toHaveLength(1);
    expect(fresh.invoices[0].total).toBe(300);
  });
});

describe('backups', () => {
  it('writes snapshots, keeps an index, and prunes to the retention cap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0));
    try {
      const { project } = await seedProject();
      await store.addEntry({ date: '2026-01-01', projectId: project.id, seconds: 3600 });
      for (let i = 0; i < 10; i++) {
        await store.writeBackup();
        vi.advanceTimersByTime(7 * 86400000);
      }
      expect(store.backups).toHaveLength(8);
      // The two oldest files are pruned from disk, the newest kept.
      expect(mock._files.has('hourly-data/backups/backup-2026-01-01.json')).toBe(false);
      expect(mock._files.has('hourly-data/backups/backup-2026-01-08.json')).toBe(false);
      expect(mock._files.has('hourly-data/backups/backup-2026-03-05.json')).toBe(true);

      // The index survives a reload and the snapshot restores.
      const second = createStore();
      await second.init();
      expect(second.backups).toHaveLength(8);
      const snap = await second.readBackup(second.backups.at(-1).date);
      expect(snap.app).toBe('hourly');
      expect(Object.values(snap.entries).flat()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-snapshotting the same day replaces that day instead of stacking', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 9, 0, 0));
    try {
      await seedProject();
      await store.writeBackup();
      await store.writeBackup();
      expect(store.backups).toHaveLength(1);
      expect(store.backups[0].date).toBe('2026-08-03');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-backs-up on the configured interval only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 9, 0, 0));
    try {
      await seedProject();
      expect(await store.maybeAutoBackup()).toBeTruthy();
      expect(await store.maybeAutoBackup()).toBeNull(); // same day
      vi.advanceTimersByTime(3 * 86400000);
      expect(await store.maybeAutoBackup()).toBeNull(); // too soon for weekly
      vi.advanceTimersByTime(4 * 86400000);
      expect(await store.maybeAutoBackup()).toBeTruthy(); // a week has passed

      await store.updateSettings({ backupInterval: 'off' });
      vi.advanceTimersByTime(60 * 86400000);
      expect(await store.maybeAutoBackup()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never spends a retention slot on sample data', async () => {
    await store.updateSettings({ sampleData: true });
    expect(await store.maybeAutoBackup()).toBeNull();
    expect(store.backups).toEqual([]);
  });

  it('refuses to restore a backup from a newer schema version', async () => {
    await expect(store.importAll({ app: 'hourly', version: 2, entries: {} }))
      .rejects.toThrow(/newer version/);
  });
});

describe('other devices', () => {
  /* A second store on the same mock is a second device on the same
     account: it writes to the very same kv keys and month files. */
  async function otherDevice() {
    const other = createStore();
    await other.init();
    return other;
  }

  it('reconciles two copies record by record, newest write winning', () => {
    const base = new Set(['a', 'c', 'e']);
    const { list, changed } = mergeById(
      // Here: 'a' edited, 'c' deleted, 'e' still held, 'd' brand new.
      [{ id: 'a', updatedAt: 2, name: 'mine' }, { id: 'e', updatedAt: 1 }, { id: 'd', updatedAt: 9 }],
      // There: 'a' edited later, 'c' untouched, 'e' deleted, 'b' brand new.
      [{ id: 'a', updatedAt: 5, name: 'theirs' }, { id: 'c', updatedAt: 1 }, { id: 'b', updatedAt: 1 }],
      base,
    );
    expect(list.map((r) => r.id).sort()).toEqual(['a', 'b', 'd']);
    expect(list.find((r) => r.id === 'a').name).toBe('theirs');
    // Three things this device did not already have: the newer 'a', the
    // new 'b', and 'c' staying deleted. 'e' being dropped is the fourth.
    expect(changed).toBe(4);

    // Ties keep the local copy, and without a baseline nothing is dropped.
    const tie = mergeById([{ id: 'a', updatedAt: 5, name: 'mine' }], [{ id: 'a', updatedAt: 5, name: 'theirs' }], new Set(['a']));
    expect(tie.list[0].name).toBe('mine');
    expect(tie.changed).toBe(0);
    const blind = mergeById([{ id: 'x' }], [{ id: 'y' }], null);
    expect(blind.list.map((r) => r.id).sort()).toEqual(['x', 'y']);
  });

  it('picks up entries another device added to a month already on screen', async () => {
    const { project } = await seedProject();
    await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    await store.entriesBetween('2026-08-03', '2026-08-03'); // now cached and stale-able

    const other = await otherDevice();
    await other.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Phone work', seconds: 1800 });

    // Before the refresh, this device is none the wiser.
    expect(await store.loadMonth('2026-08')).toHaveLength(1);
    const seen = vi.fn();
    store.addEventListener('change', seen);
    expect(await store.refresh()).toBe(1);
    expect(seen).toHaveBeenCalledTimes(1);
    const merged = await store.loadMonth('2026-08');
    expect(merged.map((e) => e.task).sort()).toEqual(['', 'Phone work']);

    // Nothing new: no event, no noise.
    expect(await store.refresh()).toBe(0);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('merges rather than overwrites when a stale tab writes a month', async () => {
    const { project } = await seedProject();
    const mine = await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Mine', seconds: 3600 });

    const other = await otherDevice();
    await other.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Theirs', seconds: 1800 });

    // This device never saw that, and now edits its own entry: the write
    // must not take the other entry down with it.
    await store.updateEntry(mine.id, mine.date, { seconds: 7200 });
    const after = await store.loadMonth('2026-08');
    expect(after.map((e) => e.task).sort()).toEqual(['Mine', 'Theirs']);
    expect(after.find((e) => e.task === 'Mine').seconds).toBe(7200);

    // And the file itself holds both, not just this device's picture.
    const stored = JSON.parse(mock._files.get('hourly-data/entries-2026-08.json'));
    expect(stored).toHaveLength(2);
  });

  it('keeps a deleted entry deleted through a merge', async () => {
    const { project } = await seedProject();
    const doomed = await store.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Doomed', seconds: 3600 });
    const other = await otherDevice();

    // Deleted here; the other device still has it in memory and writes.
    await store.deleteEntry(doomed.id, doomed.date);
    await other.addEntry({ date: '2026-08-03', projectId: project.id, task: 'Theirs', seconds: 600 });

    const stored = JSON.parse(mock._files.get('hourly-data/entries-2026-08.json'));
    // The other device knew that entry, saw it gone, and let it go.
    expect(stored.map((e) => e.task)).toEqual(['Theirs']);
    // And a refresh here does not bring it back either.
    await store.refresh();
    expect((await store.loadMonth('2026-08')).map((e) => e.task)).toEqual(['Theirs']);
  });

  it('does not cancel out two devices editing different clients', async () => {
    const acme = await store.addClient({ name: 'Acme', slot: 1 });
    const other = await otherDevice();

    // One adds a client, the other renames the existing one.
    await other.addClient({ name: 'Globex', slot: 2 });
    await store.updateClient(acme.id, { name: 'Acme Studio' });

    expect(store.clients.map((c) => c.name).sort()).toEqual(['Acme Studio', 'Globex']);
    const stored = await mock.kv.get('hourly:clients:v1');
    expect(stored.map((c) => c.name).sort()).toEqual(['Acme Studio', 'Globex']);
  });

  it('takes the newer settings and leaves older ones alone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 9, 0, 0));
    try {
      await store.updateSettings({ currency: 'USD' });
      const other = await otherDevice();
      vi.advanceTimersByTime(60000);
      await other.updateSettings({ currency: 'EUR' });
      expect(await store.refresh()).toBe(1);
      expect(store.settings.currency).toBe('EUR');

      // This device writes last: an older server copy must not win.
      vi.advanceTimersByTime(60000);
      await store.updateSettings({ currency: 'GBP' });
      expect(await store.refresh()).toBe(0);
      expect(store.settings.currency).toBe('GBP');
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows the timer, the month index, and voided invoices across devices', async () => {
    const { client, project } = await seedProject();
    const entry = await store.addEntry({ date: '2026-08-03', projectId: project.id, seconds: 3600 });
    const inv = await store.createInvoice({ clientId: client.id, entries: [entry] });
    const other = await otherDevice();

    // The other device starts a timer, tracks in a month this one has
    // never read, and voids the invoice.
    await other.startTimer({ projectId: project.id, task: 'On the phone' });
    await other.addEntry({ date: '2026-09-01', projectId: project.id, seconds: 1800 });
    await other.voidInvoice(inv.id);

    expect(await store.refresh()).toBeGreaterThan(0);
    expect(store.timer?.task).toBe('On the phone');
    expect(store.months).toContain('2026-09');
    expect(store.invoices).toHaveLength(0);
  });

});

describe('change events', () => {
  it('emits change on writes', async () => {
    const seen = vi.fn();
    store.addEventListener('change', seen);
    await store.addClient({ name: 'Acme', slot: 1 });
    await store.updateSettings({ currency: 'EUR' });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
