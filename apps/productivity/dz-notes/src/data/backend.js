/**
 * Storage backends. The store only talks to this small interface:
 *   readJSON(path) -> object | null      (null when the file does not exist)
 *   writeJSON(path, value)
 *   readBlob(path) -> Blob | null
 *   writeBlob(path, blob)
 *   remove(path)                         (missing files are not an error)
 *   list(dir) -> [{ name, isDir, modified }]
 *
 * Paths are relative, so with Puter they resolve inside the app's own
 * folder in the user's cloud. Every note lives in a file there; puter.kv
 * is never used for content.
 */

function isMissing(err) {
  const code = String(err?.code || err?.error?.code || '');
  const msg = String(err?.message || err?.error?.message || err || '');
  return code === 'subject_does_not_exist' || code === 'not_found' || code === 'dest_does_not_exist' || err?.status === 404 || /does not exist|not found|no such/i.test(msg);
}

export function puterBackend(puter, root = 'notes') {
  const p = (path) => `${root}/${path}`;
  return {
    kind: 'puter',
    async readJSON(path) {
      try {
        const blob = await puter.fs.read(p(path));
        const text = await blob.text();
        return text ? JSON.parse(text) : null;
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async writeJSON(path, value) {
      await puter.fs.write(p(path), JSON.stringify(value), { overwrite: true, createMissingParents: true });
    },
    async readBlob(path) {
      try {
        return await puter.fs.read(p(path));
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async writeBlob(path, blob) {
      await puter.fs.write(p(path), blob, { overwrite: true, createMissingParents: true });
    },
    async remove(path) {
      try {
        await puter.fs.delete(p(path));
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    },
    async list(dir) {
      try {
        const items = await puter.fs.readdir(p(dir));
        return items.map((it) => ({ name: it.name, isDir: Boolean(it.is_dir), modified: it.modified }));
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
    async readURL(path, expiresIn) {
      return puter.fs.getReadURL(p(path), expiresIn);
    },
  };
}

/** In-memory backend for tests and the development sandbox. */
export function memoryBackend(seed = {}) {
  const files = new Map(Object.entries(seed));
  const backend = {
    kind: 'memory',
    files,
    writes: 0,
    delay: 0,
    failNext: 0,
    async tick() {
      if (backend.delay) await new Promise((r) => setTimeout(r, backend.delay));
      if (backend.failNext > 0) {
        backend.failNext--;
        throw new Error('Simulated network failure');
      }
    },
    async readJSON(path) {
      await backend.tick();
      return files.has(path) ? JSON.parse(files.get(path)) : null;
    },
    async writeJSON(path, value) {
      await backend.tick();
      backend.writes++;
      files.set(path, JSON.stringify(value));
    },
    async readBlob(path) {
      await backend.tick();
      return files.has(path) ? files.get(path) : null;
    },
    async writeBlob(path, blob) {
      await backend.tick();
      backend.writes++;
      files.set(path, blob);
    },
    async remove(path) {
      await backend.tick();
      for (const key of [...files.keys()]) if (key === path || key.startsWith(path + '/')) files.delete(key);
    },
    async list(dir) {
      await backend.tick();
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      const names = new Map();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const [first, ...more] = rest.split('/');
        names.set(first, more.length > 0);
      }
      return [...names].map(([name, isDir]) => ({ name, isDir, modified: Date.now() }));
    },
    async readURL(path) {
      return `memory://${path}`;
    },
  };
  return backend;
}
