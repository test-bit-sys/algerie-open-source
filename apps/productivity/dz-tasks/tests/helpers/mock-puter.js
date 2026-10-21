/**
 * In-memory mock of the Puter SDK surface the store uses, plus the browser
 * globals (localStorage, window, navigator) the store expects. Install once
 * per test file; reset() between tests.
 *
 * createMockPuter() builds an isolated "account" (its own kv + fs); read
 * URLs minted by any account resolve through a global fetch mock, so
 * cross-account flows (shared lists, collaboration) can be tested.
 */

/* All accounts' drives, keyed by account id, for the fetch mock. */
const drives = new Map();
let nextAccount = 0;

export function createMockPuter({ username = 'testuser' } = {}) {
  const kv = new Map();
  const files = new Map();
  const accountId = ++nextAccount;
  drives.set(accountId, files);

  const mock = {
    kv: {
      async get(key) {
        return kv.has(key) ? structuredClone(kv.get(key)) : null;
      },
      async set(key, value) {
        kv.set(key, structuredClone(value));
        return true;
      },
      async del(key) {
        return kv.delete(key);
      },
    },
    fs: {
      async write(path, data) {
        files.set(path, String(data));
        return { path };
      },
      async read(path) {
        if (!files.has(path)) {
          const err = new Error('No such file');
          err.code = 'subject_does_not_exist';
          throw err;
        }
        return files.get(path);
      },
      async delete(path) {
        files.delete(path);
      },
      async getReadURL(path, expiresIn) {
        if (!files.has(path)) throw new Error('No such file');
        return `https://api.puter.example/read?u=${accountId}&path=${encodeURIComponent(path)}&ttl=${expiresIn}`;
      },
    },
    auth: {
      async getUser() {
        return { username };
      },
      async isSignedIn() {
        return true;
      },
    },
    env: 'web',
  };

  return { puter: mock, kvMap: kv, fileMap: files, accountId };
}

/** Resolves read URLs minted by any mock account. Live: re-reads on fetch. */
function installFetchMock() {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.host !== 'api.puter.example') throw new Error(`Unmocked fetch: ${url}`);
    const files = drives.get(Number(u.searchParams.get('u')));
    const path = u.searchParams.get('path');
    if (!files || !files.has(path)) {
      return { ok: false, status: 404, text: async () => 'Not found' };
    }
    return { ok: true, status: 200, text: async () => files.get(path) };
  };
}

export function installMockPuter() {
  const { puter: mock, kvMap: kv, fileMap: files } = createMockPuter();
  installFetchMock();

  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };
  globalThis.window = globalThis.window || globalThis;
  globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
  // Node's navigator global is a read-only getter without onLine; give the
  // store one that says "online" so share syncs run.
  if (!globalThis.navigator?.onLine) {
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true }, configurable: true,
      });
    } catch {}
  }
  globalThis.location = globalThis.location || {
    origin: 'https://tasks.example', pathname: '/', hash: '',
  };

  globalThis.puter = mock;
  return {
    puter: mock,
    kvMap: kv,
    fileMap: files,
    reset() {
      kv.clear();
      files.clear();
      storage.clear();
    },
  };
}
