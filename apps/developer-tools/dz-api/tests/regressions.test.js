import { describe, it, expect } from 'vitest';
import { MemoryDb } from './helpers/memory-db.js';
import { Workspace } from '../src/data/workspace.js';
import { CloudSync } from '../src/data/sync.js';
import { ReadOnlyError } from '../src/data/shared.js';
import { execute } from '../src/core/execute.js';
import { runScript } from '../src/core/scripts/runtime.js';
import { request } from '../src/core/model.js';

async function workspace() {
  const db = new MemoryDb();
  const ws = new Workspace(db);
  await ws.load();
  return { ws, db };
}

describe('regressions', () => {
  it('keeps an edit made while the previous version was uploading', async () => {
    const { ws, db } = await workspace();
    let release;
    const files = new Map();
    const fs = {
      async mkdir() {},
      async readdir() {
        return [];
      },
      async read(p) {
        return new Blob([files.get(p)]);
      },
      async write(p, data) {
        if (!release) await new Promise((r) => (release = r));
        files.set(p, data);
        return { modified: Date.now() };
      },
    };
    const sync = new CloudSync({ ws, db, fs });
    await sync.start();
    const c = await ws.addCollection({ name: 'v1' });
    const first = sync.flush();
    await new Promise((r) => setTimeout(r, 0));
    await ws.updateCollection(c.id, (x) => {
      x.name = 'v2';
    });
    release();
    await first;
    await sync.flush();
    expect(JSON.parse(files.get(`workspace/collections/${c.id}.json`)).name).toBe('v2');
    sync.stop();
  });

  it('refuses to move a request into a view-only shared collection without losing it', async () => {
    const { ws } = await workspace();
    const mine = await ws.addCollection({ name: 'Mine' });
    const r = request({ name: 'Keep me' });
    await ws.addItem(mine.id, mine.id, r);
    const theirs = await ws.putCollection({ type: 'collection', name: 'Theirs', items: [], shared: { path: '/x/y.json', owner: 'x', mode: 'read' } }, { quiet: true });
    await expect(ws.moveItem(r.id, theirs.id, theirs.id)).rejects.toBeInstanceOf(ReadOnlyError);
    expect(ws.locate(r.id).collection.id).toBe(mine.id);
  });

  it('applies a body a pre-request script sets on a request without one', async () => {
    const { ws } = await workspace();
    const sandbox = { run: (msg) => runScript(msg) };
    const req = request({ method: 'POST', url: '', scripts: { pre: 'request.body.raw = JSON.stringify({ a: 1 });', post: '' } });
    const out = await execute(req, [], { ws, sandbox, sendOptions: {} });
    expect(out.request.body.mode).toBe('raw');
    expect(out.request.body.raw).toBe('{"a":1}');
  });

  it('keeps runner.stop() from a script that then throws', async () => {
    const { ws } = await workspace();
    const sandbox = { run: (msg) => runScript(msg) };
    const req = request({ url: '', scripts: { pre: 'runner.stop(); throw new Error("boom");', post: '' } });
    const out = await execute(req, [], { ws, sandbox, sendOptions: {} });
    expect(out.error.code).toBe('script');
    expect(out.flow?.stop).toBe(true);
  });

  it('does not turn data-file values into variables that outlive their row', async () => {
    const { ws } = await workspace();
    const local = new Map();
    const sandbox = {
      async run(msg) {
        return { ok: true, tests: [], logs: [], variables: { ...msg.variables, local: { ...msg.variables.local, seen: msg.variables.local.user } } };
      },
    };
    const req = request({ url: '', scripts: { pre: 'vars.set("seen", vars.get("user"))', post: '' } });
    await execute(req, [], { ws, local, sandbox, data: { user: 'row1' }, sendOptions: {} });
    expect(local.has('user')).toBe(false);
    expect(local.get('seen')).toBe('row1');
  });

  it('merges local globals with the cloud on the first sync of a device', async () => {
    const { ws, db } = await workspace();
    await ws.updateGlobals((g) => g.variables.push({ id: 'a', key: 'mine', value: '1', enabled: true }));
    const files = new Map([['workspace/globals.json', JSON.stringify({ variables: [{ key: 'theirs', value: '2' }] })]]);
    const fs = {
      async mkdir() {},
      async readdir(dir) {
        return dir === 'workspace' ? [{ name: 'globals.json', isDir: false, modified: 5 }] : [];
      },
      async read(p) {
        return new Blob([files.get(p)]);
      },
      async write(p, data) {
        files.set(p, data);
        return { modified: 6 };
      },
    };
    const sync = new CloudSync({ ws, db, fs });
    await sync.start();
    expect(ws.globals.variables.map((v) => v.key).sort()).toEqual(['mine', 'theirs']);
    await sync.flush();
    expect(JSON.parse(files.get('workspace/globals.json')).variables.map((v) => v.key).sort()).toEqual(['mine', 'theirs']);
    sync.stop();
  });
});
