/**
 * Test harness for the workers in src/workers (pattern borrowed from
 * calendar.puter.com): instantiates one the way the Puter workers runtime
 * would, a `router` global collecting routes and a `me` global exposing the
 * owner's own Puter resources, and lets tests call its routes as plain HTTP,
 * with or without a signed-in caller (`user`, which the runtime only
 * populates for puter.workers.exec() callers). Request/Response are small
 * local shims so the harness never depends on which fetch globals the test
 * environment ships.
 */

import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';

/* ---- Minimal fetch-shape shims ---------------------------------------- */

class HeadersShim {
  constructor(init = {}) {
    this.m = new Map(Object.entries(init).map(([k, v]) => [k.toLowerCase(), String(v)]));
  }
  get(name) {
    const key = String(name).toLowerCase();
    return this.m.has(key) ? this.m.get(key) : null;
  }
}

class RequestShim {
  constructor(url, { method = 'GET', headers = {}, body } = {}) {
    this.url = String(url);
    this.method = method;
    this.headers = headers instanceof HeadersShim ? headers : new HeadersShim(headers);
    this._body = body;
  }
  async text() {
    return this._body == null ? '' : String(this._body);
  }
  async json() {
    return JSON.parse(await this.text());
  }
}

export class ResponseShim {
  constructor(body, { status = 200, headers = {} } = {}) {
    this._body = body;
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = headers instanceof HeadersShim ? headers : new HeadersShim(headers);
  }
  async text() {
    return this._body == null ? '' : String(this._body);
  }
  async json() {
    return JSON.parse(await this.text());
  }
  async arrayBuffer() {
    if (this._body instanceof ArrayBuffer) return this._body;
    if (ArrayBuffer.isView(this._body)) return this._body.buffer;
    return new TextEncoder().encode(await this.text()).buffer;
  }
}

/* ---- Fake puter.kv ------------------------------------------------------ */

export function makeKv(initial = {}) {
  const map = new Map(Object.entries(initial));
  const globToRe = (glob) =>
    new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return {
    map,
    set: vi.fn(async (k, v) => {
      const items = Array.isArray(k) ? k : [{ key: k, value: v }];
      for (const { key, value } of items) map.set(key, JSON.parse(JSON.stringify(value)));
      return true;
    }),
    get: vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
    del: vi.fn(async (k) => {
      map.delete(k);
      return true;
    }),
    incr: vi.fn(async (k, by = 1) => {
      const next = (Number(map.get(k)) || 0) + by;
      map.set(k, next);
      return next;
    }),
    // Expiry is a no-op here: tests assert a TTL was requested, never that
    // the key vanished.
    expire: vi.fn(async () => true),
    list: vi.fn(async (pattern, returnValues) => {
      let keys = [...map.keys()];
      if (typeof pattern === 'string') keys = keys.filter((k) => globToRe(pattern).test(k));
      return returnValues ? keys.map((k) => ({ key: k, value: map.get(k) })) : keys;
    }),
  };
}

/* ---- Worker instantiation ------------------------------------------------ */

export async function sha256Hex(text) {
  const buf = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
      else if (pSegs[i] !== uSegs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

/**
 * Run worker source (placeholders already substituted) and return a `call`
 * able to hit its routes. `kv` is the worker-owner's storage; `me` overrides
 * the whole owner context for a worker that uses more of it than storage
 * (e.g. the email worker's `me.puter.email`, or the sign worker's
 * `me.puter.fs`).
 */
export function instantiateWorker(source, { kv = makeKv(), me = null } = {}) {
  const owner = me || { puter: { kv } };
  const ownerKv = owner.puter.kv || kv;
  const routes = [];
  const add = (method) => (pattern, handler) => routes.push({ method, pattern, handler });
  const router = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
    options: add('OPTIONS'),
  };
  new Function('router', 'me', 'crypto', 'Response', `'use strict';\n${source}`)(
    router,
    owner,
    webcrypto,
    ResponseShim,
  );

  /** `user` stands in for the caller context the runtime attaches when the
   *  request arrives through puter.workers.exec(); omit it to call as an
   *  anonymous visitor. */
  async function call(
    method,
    pathAndQuery,
    { headers = {}, body, json, user = null, bindAs = 'user' } = {},
  ) {
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['content-type'] = 'application/json';
    } else if (body !== undefined) {
      init.body = body;
    }
    const url = new URL(pathAndQuery, 'https://test-worker.puter.work');
    const match = matchRoute(routes, method, url.pathname);
    if (!match) return new ResponseShim('no route', { status: 404 });
    const request = new RequestShim(url.href, init);
    const ctx = { request, params: match.params, me: owner };
    if (user) ctx[bindAs] = user;
    const result = await match.handler(ctx);
    return result instanceof ResponseShim
      ? result
      : new ResponseShim(JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
  }

  return { call, kv: ownerKv, me: owner, routes };
}
