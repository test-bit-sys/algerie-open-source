/**
 * Storage backends for personal pages. The rest of the app only uses this
 * small interface:
 *
 *   read(path)  -> { bytes: Uint8Array, modified } | null
 *   write(path, bytes | Blob) -> { modified }
 *   stat(path)  -> { modified, size } | null
 *   remove(path)                      (missing files are not an error)
 *   list(dir)   -> [{ name, isDir, modified }]
 *
 * With Puter, relative paths resolve inside the app's own folder in the
 * user's cloud, so every page is a file the user owns. puter.kv is never
 * used for page content or files; it only holds small settings and lists.
 */

export function isMissing(err) {
  const code = String(err?.code || err?.error?.code || '');
  const msg = String(err?.message || err?.error?.message || err || '');
  return code === 'subject_does_not_exist' || code === 'not_found' || code === 'dest_does_not_exist' || err?.status === 404 || /does not exist|not found|no such/i.test(msg);
}

const modifiedOf = (item) => {
  const m = Number(item?.modified ?? item?.mtime ?? 0);
  // Puter reports seconds; keep milliseconds everywhere.
  return m && m < 1e12 ? m * 1000 : m;
};

export function puterBackend(puter, root = 'wiki') {
  const p = (path) => `${root}/${path}`;
  return {
    kind: 'puter',
    async read(path) {
      try {
        const blob = await puter.fs.read(p(path));
        return { bytes: new Uint8Array(await blob.arrayBuffer()), modified: null };
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async readBlob(path) {
      try {
        return await puter.fs.read(p(path));
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async write(path, data) {
      const item = await puter.fs.write(p(path), data instanceof Blob ? data : new Blob([data]), { overwrite: true, dedupeName: false, createMissingParents: true });
      return { modified: modifiedOf(item) || Date.now(), size: item?.size ?? null };
    },
    async stat(path) {
      try {
        const item = await puter.fs.stat(p(path));
        return { modified: modifiedOf(item), size: item.size };
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
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
        return items.map((it) => ({ name: it.name, isDir: Boolean(it.is_dir ?? it.isDir), modified: modifiedOf(it) }));
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
    /** Watches the folder for writes from other devices, when Puter supports it. */
    async watch(onChange) {
      if (!puter.events?.onLocal) return null;
      try {
        const sub = await puter.events.onLocal(`fs:${root}`, ({ event }) => onChange(event), { onError: () => {} });
        return () => sub.off();
      } catch {
        return null;
      }
    },
  };
}

/** In-memory backend for tests. */
export function memoryBackend() {
  const files = new Map();
  let clock = 1;
  return {
    kind: 'memory',
    files,
    writes: 0,
    fail: 0,
    async read(path) {
      if (this.fail > 0) {
        this.fail--;
        throw new Error('network');
      }
      const f = files.get(path);
      return f ? { bytes: f.bytes.slice(), modified: f.modified } : null;
    },
    async readBlob(path) {
      const f = files.get(path);
      return f ? new Blob([f.bytes]) : null;
    },
    async write(path, data) {
      if (this.fail > 0) {
        this.fail--;
        throw new Error('network');
      }
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
      const modified = Date.now() * 1000 + clock++;
      files.set(path, { bytes, modified });
      this.writes++;
      return { modified, size: bytes.length };
    },
    async stat(path) {
      const f = files.get(path);
      return f ? { modified: f.modified, size: f.bytes.length } : null;
    },
    async remove(path) {
      files.delete(path);
    },
    async list(dir) {
      const prefix = `${dir}/`;
      const names = new Map();
      for (const [path, f] of files) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const name = rest.split('/')[0];
        names.set(name, { name, isDir: rest.includes('/'), modified: f.modified });
      }
      return [...names.values()];
    },
  };
}

/**
 * IndexedDB backend for the development sandbox (?local), so the app can
 * be tried without a Puter account. Development builds only.
 */
export async function indexedDbBackend(name = 'wiki-local') {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = (mode, fn) =>
    new Promise((resolve, reject) => {
      const t = db.transaction('files', mode);
      const store = t.objectStore('files');
      const req = fn(store);
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  return {
    kind: 'local',
    async read(path) {
      const f = await tx('readonly', (s) => s.get(path));
      return f ? { bytes: new Uint8Array(f.bytes), modified: f.modified } : null;
    },
    async readBlob(path) {
      const f = await tx('readonly', (s) => s.get(path));
      return f ? new Blob([f.bytes], { type: f.type || '' }) : null;
    },
    async write(path, data) {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
      const modified = Date.now();
      await tx('readwrite', (s) => s.put({ bytes, modified, type: data.type || '' }, path));
      return { modified, size: bytes.length };
    },
    async stat(path) {
      const f = await tx('readonly', (s) => s.get(path));
      return f ? { modified: f.modified, size: f.bytes.length } : null;
    },
    async remove(path) {
      await tx('readwrite', (s) => s.delete(path));
    },
    async list(dir) {
      const keys = await tx('readonly', (s) => s.getAllKeys());
      const prefix = `${dir}/`;
      const names = new Map();
      for (const k of keys) {
        if (!String(k).startsWith(prefix)) continue;
        const rest = String(k).slice(prefix.length);
        names.set(rest.split('/')[0], { name: rest.split('/')[0], isDir: rest.includes('/'), modified: 0 });
      }
      return [...names.values()];
    },
  };
}

/** Small structured settings: puter.kv when signed in, localStorage otherwise. */
export function puterKv(puter) {
  return {
    async get(key) {
      return puter.kv.get(key);
    },
    async set(key, value) {
      return puter.kv.set(key, value);
    },
  };
}

export function localKv(prefix = 'wiki-local:') {
  return {
    async get(key) {
      try {
        const v = localStorage.getItem(prefix + key);
        return v === null ? null : JSON.parse(v);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch {
        /* storage full or blocked */
      }
      return true;
    },
  };
}

export function memoryKv() {
  const m = new Map();
  return {
    map: m,
    async get(key) {
      return m.has(key) ? structuredClone(m.get(key)) : null;
    },
    async set(key, value) {
      m.set(key, structuredClone(value));
      return true;
    },
  };
}
