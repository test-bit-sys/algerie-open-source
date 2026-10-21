/**
 * Dev-only in-memory mock of the Puter SDK, used by /mock.html.
 * Lets you develop and test the full signed-in UI without a Puter account -
 * start empty and use "Explore with sample data", or add records by hand.
 * Not part of the production build (vite only builds index.html).
 */
(() => {
  // Backed by localStorage so dev-server reloads (HMR) keep the data.
  const LS = 'crm-mock-kv';
  const kv = new Map(JSON.parse(localStorage.getItem(LS) || '[]'));
  const persist = () => localStorage.setItem(LS, JSON.stringify([...kv]));
  const offline = () => localStorage.getItem('crm-mock-offline') === '1';

  window.puter = {
    env: 'web',
    auth: {
      isSignedIn: () => {
        if (offline()) throw new Error('mock offline');
        return true;
      },
      signIn: async () => true,
      signOut: () => {},
      getUser: async () => {
        if (offline()) throw new Error('mock offline');
        return { username: 'demo', uuid: 'mock-user' };
      },
    },
    /* `localStorage['crm-mock-offline'] = '1'` makes every KV call fail, the
       way a lost connection does - the way to exercise the outbox, the
       offline indicator, and an offline cold start in dev. */
    kv: {
      get: async (key) => {
        if (offline()) throw new Error('mock offline');
        return kv.has(key) ? kv.get(key) : null;
      },
      set: async (key, value) => {
        if (offline()) throw new Error('mock offline');
        kv.set(key, value);
        persist();
        return true;
      },
      del: async (key) => {
        if (offline()) throw new Error('mock offline');
        const had = kv.delete(key);
        persist();
        return had;
      },
    },
    /* A stand-in for puter.ai.chat: slow enough to see the pending state,
       and it answers the two prompt shapes the app sends (a JSON draft, or
       prose). Dev-only - the real SDK is a model. */
    ai: {
      chat: async (prompt) => {
        await new Promise((r) => setTimeout(r, 700));
        if (/one JSON object/i.test(prompt)) {
          const from = (re) => (prompt.match(re) || [])[1] || '';
          return {
            message: {
              content: JSON.stringify(/website/i.test(prompt)
                ? {
                  name: from(/^([A-Z][\w&' ]+)$/m) || 'Northwind Robotics',
                  industry: 'Manufacturing',
                  website: from(/([\w-]+\.(?:com|example|io|co))/) || 'northwind.example',
                }
                : {
                  name: from(/^([A-Z][a-z]+ [A-Z][a-z]+)$/m) || 'Mei Tanaka',
                  title: from(/^((?:VP|Head|Director|Chief)[^\n]*)$/m) || 'VP Operations',
                  email: from(/([\w.+-]+@[\w.-]+\.\w+)/),
                  phone: from(/(\+?[\d][\d\s().-]{7,}\d)/),
                  company: from(/([\w&' ]+(?:Robotics|Health|Freight|Supply|Analytics|Co))/),
                }),
            },
          };
        }
        if (/Sum up where this stands/i.test(prompt)) {
          return 'You have had three conversations and the last one moved it forward. '
            + 'The security review is the open question and nobody has answered it. '
            + 'Next: get the checklist back from engineering and send it on.';
        }
        return 'Thanks again for the time yesterday - the notes are below.\n\n'
          + 'Happy to pick this up whenever suits you.';
      },
    },
    // In-memory only (blobs don't survive a reload) - enough to exercise
    // the attachments and backups flows in dev.
    fs: (() => {
      const files = new Map();
      return {
        write: async (path, data) => {
          const blob = data instanceof Blob ? data : new Blob([data ?? '']);
          files.set(path, blob);
          return { path, name: path.split('/').pop(), size: blob.size };
        },
        read: async (path) => {
          if (!files.has(path)) throw new Error(`No such file: ${path}`);
          return files.get(path);
        },
        delete: async (path) => { files.delete(path); },
        readdir: async (dir) => [...files.keys()]
          .filter((p) => p.startsWith(`${dir.replace(/\/$/, '')}/`))
          .map((p) => ({ path: p, name: p.split('/').pop(), size: files.get(p).size })),
        mkdir: async () => ({}),
      };
    })(),
  };
})();
