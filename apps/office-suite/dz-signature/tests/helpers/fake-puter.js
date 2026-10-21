/**
 * In-memory stand-ins for the slices of the Puter SDK the app uses: kv, fs,
 * auth, and workers. Workers created through this fake are INSTANTIATED from
 * the written source (see worker-harness.js), so client modules and worker
 * code are tested talking to each other for real.
 */

import { vi } from 'vitest';
import { instantiateWorker, ResponseShim, makeKv } from './worker-harness.js';

export { makeKv };

export function makeFs() {
  const files = new Map(); // path -> string | Uint8Array | Blob
  const listeners = new Set(); // notified on write (worker redeploys)
  return {
    files,
    onWrite: (fn) => listeners.add(fn),
    write: vi.fn(async (path, content) => {
      let data = content;
      if (content instanceof Blob) data = new Uint8Array(await content.arrayBuffer());
      files.set(path, data);
      for (const fn of listeners) fn(path, data);
      return { path: `/testuser/AppData/app/${path}`, name: path.split('/').pop() };
    }),
    read: vi.fn(async (path) => {
      // The app writes app-relative paths but records absolute ones; accept both.
      const key = files.has(path) ? path : path.replace('/testuser/AppData/app/', '');
      if (!files.has(key)) {
        const err = new Error('No such file');
        err.code = 'subject_does_not_exist';
        throw err;
      }
      const data = files.get(key);
      if (data instanceof Blob) return data;
      return new Blob([typeof data === 'string' ? data : data]);
    }),
    delete: vi.fn(async (path) => {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
      return true;
    }),
  };
}

/**
 * A full fake `puter` global. `user` feeds auth.getUser; workers.create
 * instantiates whatever source was last written to the given file path, and
 * `fetchTo(url)` routes admin fetches to the live instance.
 */
export function makeFakePuter({ user = { username: 'testuser', email: 'me@example.com', uuid: 'u-1' } } = {}) {
  const kv = makeKv();
  const fs = makeFs();
  const workersByUrl = new Map(); // origin -> { name, filePath, instance }
  const workersByName = new Map();
  let counter = 0;

  // Overwriting a deployed worker's file redeploys it (Puter semantics).
  fs.onWrite((path, data) => {
    for (const w of workersByUrl.values()) {
      if (w.filePath === path) {
        w.instance = instantiateWorker(text(data), { kv: w.instance.kv, me: w.instance.me });
      }
    }
  });

  const text = (data) => (typeof data === 'string' ? data : new TextDecoder().decode(data));

  const p = {
    env: 'web',
    auth: {
      isSignedIn: vi.fn(() => true),
      getUser: vi.fn(async () => user),
      signOut: vi.fn(),
    },
    kv,
    fs,
    workers: {
      create: vi.fn(async (name, filePath) => {
        if (workersByName.has(name)) throw new Error('name taken');
        counter += 1;
        const origin = `https://${name}.puter.work`;
        const source = fs.files.get(filePath);
        if (source == null) throw new Error(`no source at ${filePath}`);
        const record = {
          name,
          filePath,
          instance: instantiateWorker(text(source), { me: { puter: { kv: makeKv(), fs } } }),
        };
        workersByUrl.set(origin, record);
        workersByName.set(name, record);
        return { url: origin };
      }),
      delete: vi.fn(async (name) => {
        const record = workersByName.get(name);
        if (record) {
          workersByName.delete(name);
          for (const [origin, r] of workersByUrl) if (r === record) workersByUrl.delete(origin);
        }
        return true;
      }),
      get: vi.fn(async (name) => {
        const record = workersByName.get(name);
        return record ? { name, file_path: record.filePath } : null;
      }),
      exec: vi.fn(),
    },
  };

  /** fetch() replacement that routes to instantiated workers. */
  p.fetchTo = async (url, init = {}) => {
    const u = new URL(url);
    const record = workersByUrl.get(u.origin);
    if (!record) return new ResponseShim('no worker', { status: 404 });
    return record.instance.call(init.method || 'GET', u.pathname + u.search, {
      headers: init.headers || {},
      body: init.body,
    });
  };

  p.workersByUrl = workersByUrl;
  return p;
}
