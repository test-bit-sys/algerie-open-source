/**
 * Dev-only mock of the Puter SDK slices this app uses, for working on the UI
 * without a live Puter session: open http://localhost:5173/?mock=1.
 *
 * kv/fs live in memory (a reload starts fresh). workers.create actually
 * instantiates src/workers/sign-worker.js in-page and window.fetch is patched
 * for *.puter.work, so the whole send flow (links, statuses, void) works.
 * The email worker is stubbed to always succeed.
 */

import signWorkerSource from '../src/workers/sign-worker.js?raw';

class ResponseShim {
  constructor(body, { status = 200, headers = {} } = {}) {
    this._body = body;
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = { get: (k) => headers[String(k).toLowerCase()] ?? null };
  }
  async text() { return this._body == null ? '' : String(this._body); }
  async json() { return JSON.parse(await this.text()); }
  async arrayBuffer() {
    if (this._body instanceof ArrayBuffer) return this._body;
    if (ArrayBuffer.isView(this._body)) return this._body.buffer;
    return new TextEncoder().encode(await this.text()).buffer;
  }
}

function makeKv() {
  const map = new Map();
  const globToRe = (glob) =>
    new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return {
    map,
    set: async (k, v) => (map.set(k, JSON.parse(JSON.stringify(v))), true),
    get: async (k) => (map.has(k) ? map.get(k) : null),
    del: async (k) => (map.delete(k), true),
    incr: async (k, by = 1) => {
      const next = (Number(map.get(k)) || 0) + by;
      map.set(k, next);
      return next;
    },
    expire: async () => true,
    list: async (pattern, returnValues) => {
      let keys = [...map.keys()];
      if (typeof pattern === 'string') keys = keys.filter((k) => globToRe(pattern).test(k));
      return returnValues ? keys.map((k) => ({ key: k, value: map.get(k) })) : keys;
    },
  };
}

function makeFs() {
  const files = new Map();
  const listeners = new Set();
  return {
    files,
    onWrite: (fn) => listeners.add(fn),
    write: async (path, content) => {
      let data = content;
      if (content instanceof Blob) data = new Uint8Array(await content.arrayBuffer());
      files.set(path, data);
      for (const fn of listeners) fn(path, data);
      return { path: `/mockuser/AppData/signatures/${path}` };
    },
    read: async (path) => {
      const key = files.has(path) ? path : path.replace('/mockuser/AppData/signatures/', '');
      if (!files.has(key)) {
        const err = new Error('No such file');
        err.code = 'subject_does_not_exist';
        throw err;
      }
      const data = files.get(key);
      return data instanceof Blob ? data : new Blob([data]);
    },
    delete: async (path) => {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
      return true;
    },
  };
}

function matchRoute(routes, method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const pSegs = r.pattern.split('/').filter(Boolean);
    const uSegs = pathname.split('/').filter(Boolean);
    if (pSegs.length !== uSegs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pSegs.length; i++) {
      if (pSegs[i].startsWith(':')) params[pSegs[i].slice(1)] = decodeURIComponent(uSegs[i]);
      else if (pSegs[i] !== uSegs[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

function instantiateWorker(source, me) {
  const routes = [];
  const add = (method) => (pattern, handler) => routes.push({ method, pattern, handler });
  const router = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  new Function('router', 'me', 'Response', `'use strict';\n${source}`)(router, me, ResponseShim);
  return {
    async call(method, pathAndQuery, init = {}) {
      const url = new URL(pathAndQuery, 'https://mock.puter.work');
      const match = matchRoute(routes, method, url.pathname);
      if (!match) return new ResponseShim('no route', { status: 404 });
      const request = {
        url: url.href,
        method,
        headers: { get: (k) => (init.headers || {})[String(k).toLowerCase()] ?? (init.headers || {})[k] ?? null },
        json: async () => JSON.parse(init.body || 'null'),
        text: async () => String(init.body || ''),
      };
      return match.handler({ request, params: match.params, me });
    },
  };
}

export function installMockPuter() {
  const kv = makeKv();
  const fs = makeFs();
  const workersByOrigin = new Map(); // origin -> { filePath, instance }

  fs.onWrite((path, data) => {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    for (const w of workersByOrigin.values()) {
      if (w.filePath === path) w.instance = instantiateWorker(text, w.me);
    }
  });

  const puter = {
    env: 'web',
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username: 'mockuser', email: 'mockuser@example.com', uuid: 'mock-1' }),
      signIn: async () => true,
      signOut: () => {},
    },
    kv,
    fs,
    workers: {
      create: async (name, filePath) => {
        const origin = `https://${name}.puter.work`;
        const data = fs.files.get(filePath);
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        const me = { puter: { kv: makeKv(), fs } };
        const record = { filePath, me, instance: instantiateWorker(text, me) };
        workersByOrigin.set(origin, record);
        return { url: origin };
      },
      delete: async () => true,
      get: async () => null,
      // The email worker always "succeeds" in mock mode.
      exec: async (url, init = {}) => {
        const body = JSON.parse(init.body || '{}');
        const results = (body.recipients || []).map((r) => ({ email: r.email, status: 'sent', at: Date.now() }));
        console.info('[mock] email worker call', url, body);
        return new ResponseShim(JSON.stringify({ ok: true, sent: results.length, skipped: 0, failed: 0, suppressed: 0, results }), { status: 200 });
      },
    },
  };

  // Route fetches to *.puter.work into the in-page workers.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    let origin = null;
    try {
      origin = new URL(url).origin;
    } catch {
      /* relative URL */
    }
    if (origin && origin.endsWith('.puter.work')) {
      const record = workersByOrigin.get(origin);
      if (!record) return new ResponseShim('no worker', { status: 404 });
      const u = new URL(url);
      const headers = {};
      for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
      return record.instance.call(init.method || 'GET', u.pathname + u.search, { headers, body: init.body });
    }
    return realFetch(input, init);
  };

  window.puter = puter;
  console.info('[mock] Puter SDK mocked. Data lives in memory for this tab.');
  return puter;
}
