/**
 * Dev-only in-memory mock of the Puter SDK, served at /mock.html.
 * Lets you develop and test the full signed-in UI without a Puter
 * account. KV values persist in localStorage so reloads keep your data.
 * Not part of the production build (vite only builds index.html).
 */
(() => {
  const LS_PREFIX = 'puter-mock:kv:';
  const FS_PREFIX = 'puter-mock:fs:';

  const blobToDataURL = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  window.puter = {
    env: 'web',

    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username: 'demo', uuid: 'mock-user' }),
      signIn: async () => true,
      signOut: () => {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith(LS_PREFIX) || k.startsWith(FS_PREFIX)) localStorage.removeItem(k);
        }
      },
    },

    /* Files as data URLs in localStorage — enough for product photos,
       which are downscaled to a few tens of kilobytes each. */
    fs: {
      async write(path, data) {
        const url = await blobToDataURL(data instanceof Blob ? data : new Blob([data]));
        try {
          localStorage.setItem(FS_PREFIX + path, url);
        } catch {
          throw new Error('Mock drive is full (localStorage quota)');
        }
        return { path };
      },
      async read(path) {
        const url = localStorage.getItem(FS_PREFIX + path);
        if (url === null) throw new Error(`No such file: ${path}`);
        return (await fetch(url)).blob();
      },
      async delete(path) {
        localStorage.removeItem(FS_PREFIX + path);
        return true;
      },
    },

    kv: {
      async list(pattern = '*', returnValues = false) {
        const prefix = pattern.replace(/\*$/, '');
        return Object.keys(localStorage).filter((key) => key.startsWith(LS_PREFIX + prefix)).sort().map((key) => {
          const name = key.slice(LS_PREFIX.length);
          return returnValues ? { key: name, value: JSON.parse(localStorage.getItem(key)) } : name;
        });
      async get(key) {
        const raw = localStorage.getItem(LS_PREFIX + key);
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      },
      async set(key, value) {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
        return true;
      },
      async del(key) {
        localStorage.removeItem(LS_PREFIX + key);
        return true;
      },
    },
  };
})();
