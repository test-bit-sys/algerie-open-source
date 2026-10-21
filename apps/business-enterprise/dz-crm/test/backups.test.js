/** Backups run against the same mock puter global the store tests use,
    with an fs.readdir that reports whatever names each test plants. */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store } from '../src/lib/store.js';
import {
  parseBackupName, listBackups, writeBackup, runBackupIfDue, BACKUP_KEEP,
} from '../src/lib/backups.js';

const DAY = 86400000;
let kvData;
let fsNames;

function nameFor(at) {
  return `crm-backup-${new Date(at).toISOString().slice(0, 19).replace(/:/g, '-')}Z.json`;
}

function installPuterMock() {
  kvData = new Map();
  fsNames = [];
  globalThis.puter = {
    env: 'web',
    kv: {
      get: vi.fn(async (k) => (kvData.has(k) ? kvData.get(k) : null)),
      set: vi.fn(async (k, v) => { kvData.set(k, v); return true; }),
    },
    fs: {
      readdir: vi.fn(async () => fsNames.map((name) => ({ name, path: `backups/${name}`, size: 10 }))),
      write: vi.fn(async (path) => {
        fsNames.push(path.split('/').pop());
        return { path };
      }),
      read: vi.fn(async () => JSON.stringify({ app: 'crm', version: 1 })),
      delete: vi.fn(async (path) => {
        fsNames = fsNames.filter((n) => `backups/${n}` !== path);
      }),
    },
    auth: {
      getUser: vi.fn(async () => ({ username: 'tester' })),
      isSignedIn: () => true,
    },
  };
}

async function storeWithData() {
  const store = new Store();
  await store.init();
  await store.addContact({ name: 'Mei' });
  return store;
}

beforeEach(installPuterMock);

describe('parseBackupName', () => {
  it('round-trips the stamp and rejects foreign files', () => {
    const at = Date.UTC(2026, 7, 5, 21, 30, 0);
    expect(parseBackupName(nameFor(at))).toBe(at);
    expect(parseBackupName('holiday-photos.zip')).toBeNull();
    expect(parseBackupName('crm-backup-oops.json')).toBeNull();
  });
});

describe('listBackups', () => {
  it('sorts newest first and skips files it did not write', async () => {
    fsNames = [nameFor(1000000000000), 'notes.txt', nameFor(2000000000000)];
    const list = await listBackups();
    expect(list.map((b) => b.at)).toEqual([2000000000000, 1000000000000]);
  });

  it('treats a missing directory as no backups yet', async () => {
    puter.fs.readdir = vi.fn(async () => { throw new Error('not found'); });
    expect(await listBackups()).toEqual([]);
    puter.fs.readdir = vi.fn(async () => { throw { code: 'subject_does_not_exist' }; });
    expect(await listBackups()).toEqual([]);
  });

  it('refuses to call an unreachable folder empty', async () => {
    // Offline is not an answer about what is in the folder, and reporting
    // it as "no backups yet" says the copies are gone.
    puter.fs.readdir = vi.fn(async () => { throw new Error('Failed to fetch'); });
    await expect(listBackups()).rejects.toThrow();
  });
});

describe('writeBackup', () => {
  it('writes a full export and prunes past the keep limit', async () => {
    const store = await storeWithData();
    // A long history: one old backup per prior day.
    fsNames = Array.from({ length: BACKUP_KEEP + 3 },
      (_, i) => nameFor(Date.UTC(2026, 0, 1) + i * DAY));

    await writeBackup(store);
    const written = puter.fs.write.mock.calls.at(-1);
    expect(written[0]).toMatch(/^backups\/crm-backup-/);
    expect(JSON.parse(written[1]).app).toBe('crm');
    expect(fsNames.length).toBe(BACKUP_KEEP);
  });
});

describe('writeBackup when the folder cannot be listed', () => {
  it('still reports the backup it just wrote', async () => {
    const store = await storeWithData();
    puter.fs.readdir = vi.fn(async () => { throw new Error('Failed to fetch'); });
    await expect(writeBackup(store)).resolves.toMatchObject({ at: expect.any(Number) });
    expect(puter.fs.write).toHaveBeenCalled();
  });
});

describe('runBackupIfDue', () => {
  it('writes when there is no backup at all', async () => {
    const store = await storeWithData();
    expect(await runBackupIfDue(store)).not.toBeNull();
    expect(puter.fs.write).toHaveBeenCalled();
  });

  it('stays quiet while the newest backup is fresh', async () => {
    const store = await storeWithData();
    fsNames = [nameFor(Date.now() - 2 * DAY)];
    expect(await runBackupIfDue(store)).toBeNull();
    expect(puter.fs.write).not.toHaveBeenCalled();
  });

  it('writes once the newest backup has aged out', async () => {
    const store = await storeWithData();
    fsNames = [nameFor(Date.now() - 8 * DAY)];
    expect(await runBackupIfDue(store)).not.toBeNull();
  });

  it('respects the off switch and skips empty accounts', async () => {
    const store = await storeWithData();
    await store.updateSettings({ autoBackupDays: 0 });
    expect(await runBackupIfDue(store)).toBeNull();

    const empty = new Store();
    await empty.init();
    expect(await runBackupIfDue(empty)).toBeNull();
    expect(puter.fs.write).not.toHaveBeenCalled();
  });

  it('never lets a filesystem error escape the boot path', async () => {
    const store = await storeWithData();
    puter.fs.write = vi.fn(async () => { throw new Error('quota'); });
    await expect(runBackupIfDue(store)).resolves.toBeNull();
  });
});
