/**
 * In-memory stand-in for the Puter SDK, covering exactly the surface the
 * store uses: kv get/set, fs write/read/delete, auth.getUser. Reads reject
 * missing paths the way Puter does (code 'subject_does_not_exist').
 *
 * Text writes read back through .text() like Puter's blobs do; a blob
 * written (the invoice logo) comes back as the same blob, which is what
 * the real SDK hands over.
 */

export function createPuterMock() {
  const kv = new Map();
  const files = new Map();

  return {
    env: 'web',
    _kv: kv,
    _files: files,

    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username: 'tester' }),
      signOut: () => {},
    },

    kv: {
      async get(key) {
        return kv.has(key) ? structuredClone(kv.get(key)) : null;
      },
      async set(key, value) {
        kv.set(key, structuredClone(value));
        return true;
      },
      async del(key) {
        kv.delete(key);
        return true;
      },
    },

    fs: {
      async write(path, content) {
        files.set(path, content instanceof Blob ? content : String(content));
        return { path };
      },
      async read(path) {
        if (!files.has(path)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        const stored = files.get(path);
        if (stored instanceof Blob) return stored;
        return { text: async () => stored };
      },
      async delete(path) {
        files.delete(path);
      },
    },
  };
}
