import { describe, it, expect, vi } from 'vitest';
import { MemoryDb } from './helpers/memory-db.js';
import { Workspace } from '../src/data/workspace.js';
import { SharedCollections, ReadOnlyError } from '../src/data/shared.js';
import { CloudSync } from '../src/data/sync.js';
import { request } from '../src/core/model.js';

/** Two users on one fake cloud. Files live under /<user>/AppData/app/<path>. */
function cloud() {
  const files = new Map();
  const shares = [];
  let clock = 100;
  const fsFor = (user) => {
    const abs = (p) => (p.startsWith('/') ? p : `/${user}/AppData/app/${p}`);
    const real = (p) => {
      // Masked share paths look like /<owner>/<uid>/<name>.
      const s = shares.find((x) => x.masked === p && x.holder === user);
      return s ? s.target : abs(p);
    };
    return {
      async mkdir() {},
      async write(p, data) {
        const path = real(p);
        const share = shares.find((x) => x.target === path && x.holder === user);
        if (share && share.mode === 'read') throw Object.assign(new Error('forbidden'), { code: 'forbidden' });
        files.set(path, { text: data, modified: ++clock });
        return { path, modified: clock };
      },
      async read(p) {
        const f = files.get(real(p));
        if (!f) throw Object.assign(new Error('missing'), { code: 'subject_does_not_exist' });
        return new Blob([f.text]);
      },
      async readdir(dir) {
        const base = abs(dir);
        return [...files].filter(([k]) => k.startsWith(`${base}/`) && !k.slice(base.length + 1).includes('/')).map(([k, f]) => ({ name: k.slice(base.length + 1), path: k, isDir: false, modified: f.modified }));
      },
      async delete(p) {
        files.delete(abs(p));
      },
      async share(p, recipient, mode) {
        const target = abs(p);
        const existing = shares.find((x) => x.target === target && x.holder === recipient);
        if (existing) existing.mode = mode;
        else shares.push({ target, holder: recipient, mode, owner: user, masked: `/${user}/u${shares.length}/${target.split('/').pop()}` });
        return [{ mode, holder: { username: recipient } }];
      },
      async getShares(p) {
        return shares.filter((x) => x.target === abs(p)).map((x) => ({ mode: x.mode, holder: { username: x.holder } }));
      },
      async unshare(p, recipient) {
        const target = p.startsWith('/') ? shares.find((x) => x.masked === p)?.target : abs(p);
        const i = shares.findIndex((x) => x.target === target && x.holder === recipient);
        if (i >= 0) shares.splice(i, 1);
        return { revoked: i >= 0 ? 1 : 0 };
      },
      async listShared() {
        return { items: shares.filter((x) => x.holder === user).map((x) => ({ path: x.masked, name: x.masked.split('/').pop(), isDir: false, mode: x.mode, owner: { username: x.owner }, modified: files.get(x.target)?.modified })) };
      },
    };
  };
  return { files, shares, fsFor };
}

async function user(c, name) {
  const db = new MemoryDb();
  const ws = new Workspace(db);
  await ws.load();
  const fs = c.fsFor(name);
  const sync = new CloudSync({ ws, db, fs });
  await sync.start();
  const shared = new SharedCollections({ ws, fs, sync, self: name });
  return { ws, sync, shared };
}

describe('shared collections', () => {
  it('shares, edits together, and enforces view only', async () => {
    vi.useFakeTimers();
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const col = await ada.ws.addCollection({ name: 'Team API' });
    await ada.ws.addItem(col.id, col.id, request({ name: 'Ping', url: 'https://x/ping' }));

    await ada.shared.share(col.id, 'bob', 'write');
    expect((await ada.shared.shares(col.id)).map((s) => s.holder.username)).toEqual(['bob']);

    await bob.shared.refresh();
    const copy = bob.ws.getCollection(col.id);
    expect(copy.items[0].name).toBe('Ping');
    expect(copy.shared).toMatchObject({ owner: 'ada', mode: 'write' });

    // Bob's edit goes back to Ada's file, not into Bob's own cloud folder.
    await bob.ws.updateCollection(col.id, (x) => {
      x.name = 'Team API v2';
    });
    await vi.advanceTimersByTimeAsync(2000);
    await bob.sync.flush();
    expect([...c.files.keys()].some((k) => k.startsWith('/bob/') && k.includes(col.id))).toBe(false);
    await ada.sync.pull();
    expect(ada.ws.getCollection(col.id).name).toBe('Team API v2');

    // View only blocks local edits.
    await ada.shared.share(col.id, 'bob', 'read');
    await bob.shared.refresh();
    await expect(bob.ws.updateCollection(col.id, () => {})).rejects.toBeInstanceOf(ReadOnlyError);

    // Removing access removes Bob's copy on the next refresh.
    await ada.shared.unshare(col.id, 'bob');
    await bob.shared.refresh();
    expect(bob.ws.getCollection(col.id)).toBeNull();
    vi.useRealTimers();
  });

  it('keeps an edit made while the previous one was uploading', async () => {
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const col = await ada.ws.addCollection({ name: 'Team API' });
    await ada.shared.share(col.id, 'bob', 'write');
    await bob.shared.refresh();
    await bob.ws.updateCollection(col.id, (x) => {
      x.name = 'Edit 1';
    });
    const write = bob.shared.fs.write;
    bob.shared.fs = { ...bob.shared.fs, write: async (...args) => {
      await bob.ws.updateCollection(col.id, (x) => {
        x.name = 'Edit 2';
      });
      return write(...args);
    } };
    await bob.shared.flush();
    bob.shared.stop();
    expect(bob.ws.getCollection(col.id).shared.dirty).toBe(true);
  });

  it('reports an edit as pending until it uploads, but not while offline and retrying', async () => {
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const col = await ada.ws.addCollection({ name: 'Team API' });
    await ada.shared.share(col.id, 'bob', 'write');
    await bob.shared.refresh();
    expect(bob.shared.pending).toBe(false);
    await bob.ws.updateCollection(col.id, (x) => {
      x.name = 'Edit 1';
    });
    expect(bob.shared.pending).toBe(true);
    const write = bob.shared.fs.write;
    bob.shared.fs = { ...bob.shared.fs, write: async () => {
      throw new Error('offline');
    } };
    await bob.shared.flush();
    expect(bob.shared.pending).toBe(false);
    bob.shared.fs = { ...bob.shared.fs, write };
    await bob.shared.flush();
    expect(bob.shared.pending).toBe(false);
    expect(bob.ws.getCollection(col.id).shared.dirty).toBe(false);
    bob.shared.stop();
  });

  it('applies lost edit access even with unsaved local edits', async () => {
    vi.useFakeTimers();
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const col = await ada.ws.addCollection({ name: 'Team API' });
    await ada.shared.share(col.id, 'bob', 'write');
    await bob.shared.refresh();
    await ada.shared.share(col.id, 'bob', 'read');
    await vi.advanceTimersByTimeAsync(10);
    await bob.ws.updateCollection(col.id, (x) => {
      x.name = 'Bob edit';
    });
    await bob.shared.refresh();
    const copy = bob.ws.getCollection(col.id);
    expect(copy.shared.mode).toBe('read');
    expect(copy.name).toBe('Team API');
    bob.shared.stop();
    vi.useRealTimers();
  });

  it('never lets a shared collection take over the ids of the user\'s own requests', async () => {
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const mine = await bob.ws.addCollection({ name: 'Mine' });
    const r = await bob.ws.addItem(mine.id, mine.id, request({ name: 'Mine', url: 'https://mine.test' }));
    const evil = await ada.ws.addCollection({ type: 'collection', name: 'Evil', items: [{ ...request({ name: 'Evil', url: 'https://evil.test' }), id: r.id }] });
    await ada.shared.share(evil.id, 'bob', 'write');
    await bob.shared.refresh();
    expect(bob.ws.getCollection(evil.id)).toBeNull();
    expect(bob.ws.locate(r.id).collection.id).toBe(mine.id);
  });

  it('keeps the shared collection it has when another person shares a file with the same name', async () => {
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const carol = await user(c, 'carol');
    const real = await ada.ws.addCollection({ name: 'Real' });
    await ada.shared.share(real.id, 'bob', 'read');
    await bob.shared.refresh();
    const fake = await carol.ws.addCollection({ type: 'collection', id: real.id, name: 'Fake' });
    await carol.shared.share(fake.id, 'bob', 'read');
    await bob.shared.refresh();
    expect(bob.ws.getCollection(real.id)).toMatchObject({ name: 'Real', shared: { owner: 'ada' } });
  });

  it('keeps script variable changes on a view-only collection in memory', async () => {
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const col = await ada.ws.addCollection({ name: 'Team API' });
    await ada.shared.share(col.id, 'bob', 'read');
    await bob.shared.refresh();
    await bob.ws.applyVariableChanges({ collectionId: col.id, changes: { collection: { token: 'abc' }, globals: { g: '1' } } });
    expect(bob.ws.getCollection(col.id).variables.map((v) => [v.key, v.value])).toEqual([['token', 'abc']]);
    expect(bob.ws.globals.variables.map((v) => v.key)).toEqual(['g']);
  });

  it('lets people leave a shared collection', async () => {
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const col = await ada.ws.addCollection({ name: 'Leave me' });
    await ada.shared.share(col.id, 'bob', 'read');
    await bob.shared.refresh();
    await bob.shared.leave(col.id);
    expect(bob.ws.getCollection(col.id)).toBeNull();
    expect(await ada.shared.shares(col.id)).toEqual([]);
  });

  it('never replaces one of the user\'s own collections with a shared one', async () => {
    const c = cloud();
    const ada = await user(c, 'ada');
    const bob = await user(c, 'bob');
    const col = await ada.ws.addCollection({ name: 'Original' });
    await bob.ws.addCollection({ ...structuredClone(col), name: 'Bob copy' });
    await ada.shared.share(col.id, 'bob', 'write');
    await bob.shared.refresh();
    expect(bob.ws.getCollection(col.id).name).toBe('Bob copy');
    expect(bob.ws.getCollection(col.id).shared).toBeUndefined();
  });
});
