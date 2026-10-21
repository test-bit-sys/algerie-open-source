/**
 * An in-memory stand-in for the parts of Puter the worker uses (kv, fs,
 * auth), so the collaboration service can be tested without a network.
 */
import { WikiService, DOCS } from '../../worker/service.js';

export const alice = { uuid: '11111111-1111-4111-8111-111111111111', username: 'alice' };
export const bob = { uuid: '22222222-2222-4222-8222-222222222222', username: 'bob' };
export const cam = { uuid: '33333333-3333-4333-8333-333333333333', username: 'cam' };

export function fakePuter(owner = alice) {
  const data = new Map();
  const files = new Map();
  const listeners = new Set();
  const env = { data, files, kvCalls: 0, listCalls: 0, now: Date.now() };
  const kv = {
    async get(key) {
      env.kvCalls++;
      return Array.isArray(key) ? key.map((k) => structuredClone(data.get(k) ?? null)) : structuredClone(data.get(key) ?? null);
    },
    async set(key, value) {
      env.kvCalls++;
      data.set(key, structuredClone(value));
      for (const fn of listeners) fn(key, value);
      return true;
    },
    async del(key) {
      data.delete(key);
      return true;
    },
    async incr(key, amount = 1) {
      const v = (data.get(key) || 0) + amount;
      data.set(key, v);
      return v;
    },
    async expire() {
      return true;
    },
    async list({ pattern, reverse, limit = 1000, cursor }) {
      env.listCalls++;
      const prefix = pattern.replace(/\*$/, '');
      let keys = [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (reverse) keys.reverse();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + limit);
      return { items: page.map((key) => ({ key, value: structuredClone(data.get(key)) })), ...(start + limit < keys.length ? { cursor: String(start + limit) } : {}) };
    },
  };
  const fs = {
    async read(path) {
      if (!files.has(path)) throw Object.assign(new Error('not found'), { code: 'subject_does_not_exist' });
      return new Blob([files.get(path)]);
    },
    async write(path, text) {
      files.set(path, typeof text === 'string' ? text : await new Blob([text]).text());
      return { path };
    },
    async stat(path) {
      if (!files.has(path)) throw Object.assign(new Error('not found'), { code: 'subject_does_not_exist' });
      return { path, size: files.get(path).length };
    },
    async delete(path) {
      files.delete(path);
    },
  };
  const puter = { kv, fs, auth: { getUser: async () => owner }, authToken: 'header.eyJhcHBfdWlkIjoiYXBwLXdpa2kifQ.sig', APIOrigin: 'https://api.test' };
  env.puter = puter;
  env.onSet = (fn) => listeners.add(fn);
  env.service = (opts = {}) => new WikiService(puter, { now: () => env.now, fetcher: async () => ({ ok: true, json: async () => ({ handle: 'h-1' }) }), ...opts });
  /** A request function for SharedSpace, as a given person. */
  env.requester = (user) => async (op, data) => {
    try {
      return structuredClone(await env.service().call(user, { op, ...data }));
    } catch (err) {
      throw Object.assign(new Error(err.message), { status: err.status || 500 });
    }
  };
  env.forget = () => DOCS.clear();
  return env;
}
