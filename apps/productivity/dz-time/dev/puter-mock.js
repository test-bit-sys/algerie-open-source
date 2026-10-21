/**
 * Dev-only mock of the Puter SDK, used by /mock.html. Lets you develop and
 * test the full signed-in UI without a Puter account. Backed by
 * localStorage so reloads keep data (which is how the timer's reload
 * survival gets exercised). Not part of the production build (vite only
 * builds index.html).
 */
(() => {
  const LS = 'hourly:devmock';
  let state = { kv: {}, files: {} };
  /* Re-read before every call and write back after: two tabs are then two
     devices against one shared store, which is the only way to exercise
     cross-device reconciliation by hand. */
  const load = () => {
    try {
      state = JSON.parse(localStorage.getItem(LS)) || { kv: {}, files: {} };
    } catch {
      state = { kv: {}, files: {} };
    }
    state.kv ||= {};
    state.files ||= {};
    return state;
  };
  const save = () => {
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch {}
  };
  load();
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), latency));

  // ?signedout=1 shows the intro page; the sign-in button then "signs in".
  // ?env=app simulates running inside Puter (no sign-out offered).
  // ?slow=800 makes every call take that long (to see the boot splash).
  // ?offline=1 makes every kv/fs call fail like a dead network (auth still
  // works), to exercise the offline mirror and write queue.
  const params = new URLSearchParams(location.search);
  let signedIn = !params.has('signedout');
  const latency = Math.max(25, Number(params.get('slow')) || 25);
  const offline = params.has('offline');
  const guard = () => {
    if (offline) throw new TypeError('Failed to fetch (mock offline)');
  };

  window.puter = {
    env: params.get('env') || 'web',
    auth: {
      isSignedIn: () => signedIn,
      getUser: async () => ({ uuid: 'dev-user-uuid', username: 'devuser' }),
      signIn: async () => { signedIn = true; return true; },
      signOut: () => { localStorage.removeItem(LS); },
    },
    kv: {
      async get(key) {
        guard();
        load();
        return delay(key in state.kv ? structuredClone(state.kv[key]) : null);
      },
      async set(key, value) {
        guard();
        load();
        state.kv[key] = structuredClone(value);
        save();
        return delay(true);
      },
      async del(key) {
        guard();
        load();
        delete state.kv[key];
        save();
        return delay(true);
      },
    },
    fs: {
      async write(path, content) {
        guard();
        load();
        // Binary writes (the invoice logo) are kept as data URLs so the
        // whole mock stays a JSON blob in localStorage.
        state.files[path] = content instanceof Blob
          ? await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.readAsDataURL(content);
          })
          : String(content);
        save();
        return delay({ path });
      },
      async read(path) {
        guard();
        load();
        if (!(path in state.files)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          return Promise.reject(err);
        }
        const text = state.files[path];
        // Puter hands back a Blob; the store only ever calls .text() on
        // one, so both shapes work, but a logo really does need the blob.
        if (text.startsWith('data:')) return delay(await (await fetch(text)).blob());
        return delay({ text: async () => text });
      },
      async delete(path) {
        guard();
        load();
        delete state.files[path];
        save();
        return delay(true);
      },
    },
  };
})();
