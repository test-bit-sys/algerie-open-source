/**
 * Dev-only in-memory mock of the Puter SDK, served at /dev/mock.html.
 * Lets you develop and test the full signed-in UI without a Puter account.
 * Not part of the production build (vite only builds index.html).
 */
(() => {
  const kv = new Map();
  const files = new Map();
  // ?signedout shows the intro page; ?env=app exercises the Puter-app chrome.
  const params = new URLSearchParams(location.search);
  let signedIn = !params.has('signedout');

  window.puter = {
    env: params.get('env') || 'web',
    kv: {
      async get(key) {
        const v = kv.get(key);
        return v === undefined ? null : JSON.parse(JSON.stringify(v));
      },
      async set(key, value) {
        kv.set(key, JSON.parse(JSON.stringify(value)));
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
        return new Blob([files.get(path)]);
      },
      async delete(path) {
        files.delete(path);
      },
      async getReadURL(path) {
        // Serve the current snapshot through a blob URL so the shared
        // viewer can be exercised end to end in dev.
        if (!files.has(path)) throw new Error('No such file');
        return URL.createObjectURL(new Blob([files.get(path)], { type: 'application/json' }));
      },
    },
    auth: {
      async isSignedIn() { return signedIn; },
      async signIn() { signedIn = true; return true; },
      signOut() { signedIn = false; },
      async getUser() { return { username: 'demo', uuid: 'demo-uuid' }; },
    },
  };

  window.__puterMock = { kv, files };
})();
