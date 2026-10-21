/**
 * Workspace data model. Everything the app stores is plain JSON built by the
 * factories below, so it can be cloned, diffed, written to a file and read
 * back without classes.
 *
 * Collection  { id, type: 'collection', name, description, items, auth, scripts, variables, createdAt, updatedAt }
 * Folder      { id, type: 'folder', name, description, items, auth, scripts }
 * Request     { id, type: 'request', name, description, method, url, params, pathVars, headers, body, auth, scripts, settings, examples }
 * Environment { id, name, variables, createdAt, updatedAt }
 * Variable    { id, key, value, enabled, secret, description }
 * Pair        { id, key, value, enabled, description }   (params, headers, form fields)
 */
import { uid } from '../lib/ids.js';
import { normalizeWebSocket } from './websocket.js';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const BODY_MODES = ['none', 'form', 'urlencoded', 'raw', 'binary', 'graphql'];
export const RAW_TYPES = ['json', 'text', 'javascript', 'html', 'xml'];
export const AUTH_TYPES = ['inherit', 'none', 'bearer', 'basic', 'apikey', 'oauth2', 'awsv4'];

export const RAW_CONTENT_TYPES = {
  json: 'application/json',
  text: 'text/plain',
  javascript: 'application/javascript',
  html: 'text/html',
  xml: 'application/xml',
};

export function pair(key = '', value = '', extra = {}) {
  return { id: uid(), key, value, enabled: true, description: '', ...extra };
}

export function variable(key = '', value = '', extra = {}) {
  return { id: uid(), key, value, enabled: true, secret: false, description: '', ...extra };
}

export function formField(key = '', value = '', extra = {}) {
  return { id: uid(), key, value, enabled: true, description: '', kind: 'text', file: null, ...extra };
}

export function emptyBody() {
  return { mode: 'none', raw: '', rawType: 'json', form: [], urlencoded: [], binary: null, graphql: { query: '', variables: '' } };
}

export function emptyAuth(type = 'inherit') {
  return {
    type,
    bearer: { token: '' },
    basic: { username: '', password: '' },
    apikey: { key: '', value: '', in: 'header' },
    oauth2: {
      accessToken: '',
      headerPrefix: 'Bearer',
      grantType: 'client_credentials',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      username: '',
      password: '',
      clientAuth: 'header',
    },
    awsv4: { accessKey: '', secretKey: '', sessionToken: '', region: 'us-east-1', service: '' },
  };
}

export function defaultSettings() {
  return { followRedirects: true, timeoutMs: 0, transport: 'auto', encodeUrl: true };
}

export function request(fields = {}) {
  return normalizeRequest({ name: 'New Request', ...fields });
}

export function folder(fields = {}) {
  return normalizeFolder({ name: 'New Folder', ...fields });
}

export function collection(fields = {}) {
  const now = Date.now();
  return normalizeCollection({ name: 'New Collection', createdAt: now, updatedAt: now, ...fields });
}

export function environment(fields = {}) {
  const now = Date.now();
  return normalizeEnvironment({ name: 'New Environment', createdAt: now, updatedAt: now, ...fields });
}

const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);

function normalizePairs(list, make = pair) {
  return arr(list)
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const out = make(str(p.key), str(p.value), { enabled: p.enabled !== false, description: str(p.description) });
      if (p.id) out.id = str(p.id);
      return out;
    });
}

function normalizeForm(list) {
  return arr(list)
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      ...formField(str(p.key), str(p.value), { enabled: p.enabled !== false, description: str(p.description) }),
      ...(p.id ? { id: str(p.id) } : {}),
      kind: p.kind === 'file' ? 'file' : 'text',
      file: p.kind === 'file' && p.file ? normalizeFileRef(p.file) : null,
    }));
}

function normalizeFileRef(f) {
  if (!f || typeof f !== 'object') return null;
  return { ref: str(f.ref), name: str(f.name), size: Number(f.size) || 0, type: str(f.type) };
}

export function normalizeVariables(list) {
  return arr(list)
    .filter((v) => v && typeof v === 'object')
    .map((v) => ({
      ...variable(str(v.key), str(v.value), { enabled: v.enabled !== false, secret: !!v.secret, description: str(v.description) }),
      ...(v.id ? { id: str(v.id) } : {}),
    }));
}

export function normalizeAuth(a, fallback = 'inherit') {
  const base = emptyAuth(fallback);
  if (!a || typeof a !== 'object') return base;
  const type = AUTH_TYPES.includes(a.type) ? a.type : fallback;
  return {
    type,
    bearer: { ...base.bearer, ...pick(a.bearer, base.bearer) },
    basic: { ...base.basic, ...pick(a.basic, base.basic) },
    apikey: { ...base.apikey, ...pick(a.apikey, base.apikey), in: a.apikey?.in === 'query' ? 'query' : 'header' },
    oauth2: { ...base.oauth2, ...pick(a.oauth2, base.oauth2) },
    awsv4: { ...base.awsv4, ...pick(a.awsv4, base.awsv4) },
  };
}

function pick(src, shape) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of Object.keys(shape)) if (src[k] != null) out[k] = str(src[k]);
  return out;
}

export function normalizeBody(b) {
  const base = emptyBody();
  if (!b || typeof b !== 'object') return base;
  return {
    mode: BODY_MODES.includes(b.mode) ? b.mode : 'none',
    raw: str(b.raw),
    rawType: RAW_TYPES.includes(b.rawType) ? b.rawType : 'json',
    form: normalizeForm(b.form),
    urlencoded: normalizePairs(b.urlencoded),
    binary: normalizeFileRef(b.binary),
    graphql: { query: str(b.graphql?.query), variables: str(b.graphql?.variables) },
  };
}

function normalizeScripts(s) {
  return { pre: str(s?.pre), post: str(s?.post) };
}

function normalizeSettings(s) {
  const d = defaultSettings();
  if (!s || typeof s !== 'object') return d;
  return {
    followRedirects: s.followRedirects !== false,
    timeoutMs: Math.max(0, Number(s.timeoutMs) || 0),
    transport: ['auto', 'browser', 'relay'].includes(s.transport) ? s.transport : 'auto',
    encodeUrl: s.encodeUrl !== false,
  };
}

function normalizeExample(e) {
  return {
    id: str(e?.id) || uid(),
    name: str(e?.name, 'Example'),
    status: Number(e?.status) || 200,
    statusText: str(e?.statusText),
    headers: normalizePairs(e?.headers),
    body: str(e?.body),
    request: e?.request ? { method: str(e.request.method, 'GET'), url: str(e.request.url) } : null,
  };
}

export function normalizeRequest(r = {}) {
  const method = str(r.method, 'GET').toUpperCase().trim() || 'GET';
  return {
    id: str(r.id) || uid(),
    type: 'request',
    name: str(r.name, 'Untitled Request'),
    description: str(r.description),
    method,
    url: str(r.url),
    params: normalizePairs(r.params),
    pathVars: normalizePairs(r.pathVars),
    headers: normalizePairs(r.headers),
    body: normalizeBody(r.body),
    auth: normalizeAuth(r.auth),
    scripts: normalizeScripts(r.scripts),
    settings: normalizeSettings(r.settings),
    examples: arr(r.examples).map(normalizeExample),
  };
}

function normalizeItems(items) {
  return arr(items)
    .filter((i) => i && typeof i === 'object')
    .map((i) => (i.type === 'websocket' ? normalizeWebSocket(i) : i.type === 'folder' || Array.isArray(i.items) ? normalizeFolder(i) : normalizeRequest(i)));
}

export function normalizeFolder(f = {}) {
  return {
    id: str(f.id) || uid(),
    type: 'folder',
    name: str(f.name, 'Untitled Folder'),
    description: str(f.description),
    items: normalizeItems(f.items),
    auth: normalizeAuth(f.auth),
    scripts: normalizeScripts(f.scripts),
  };
}

export function normalizeCollection(c = {}) {
  const now = Date.now();
  return {
    id: str(c.id) || uid(),
    type: 'collection',
    name: str(c.name, 'Untitled Collection'),
    description: str(c.description),
    items: normalizeItems(c.items),
    auth: normalizeAuth(c.auth, 'none'),
    scripts: normalizeScripts(c.scripts),
    variables: normalizeVariables(c.variables),
    createdAt: Number(c.createdAt) || now,
    updatedAt: Number(c.updatedAt) || now,
    // Set only on local copies of collections other people shared with this user.
    ...(c.shared && typeof c.shared === 'object'
      ? { shared: { path: str(c.shared.path), owner: str(c.shared.owner), mode: str(c.shared.mode, 'read'), modified: c.shared.modified ?? null, dirty: !!c.shared.dirty } }
      : {}),
  };
}

export function normalizeEnvironment(e = {}) {
  const now = Date.now();
  return {
    id: str(e.id) || uid(),
    name: str(e.name, 'Untitled Environment'),
    variables: normalizeVariables(e.variables),
    createdAt: Number(e.createdAt) || now,
    updatedAt: Number(e.updatedAt) || now,
  };
}

/** Normalizes a saved item that opens in an editor tab (an HTTP or WebSocket request). */
export function normalizeDraft(d) {
  return d?.type === 'websocket' ? normalizeWebSocket(d) : normalizeRequest(d);
}

// Strings longer than this (a large body) are compared as they are instead of being copied into the JSON.
const LONG_STRING = 1024;

/**
 * What tells whether a draft has unsaved changes: two drafts are the same exactly when their
 * normalized JSON is (see sameDraft). Long strings are set aside in order and replaced by
 * "\0" and their position; short strings that start with "\0" get one more, so nothing else
 * reads the same. name is the normalized name.
 */
export function draftKey(d) {
  const draft = normalizeDraft(d);
  const long = [];
  const json = JSON.stringify(draft, (key, value) => {
    if (typeof value !== 'string') return value;
    if (value.length > LONG_STRING) return `\0${long.push(value) - 1}`;
    return value.startsWith('\0') ? `\0${value}` : value;
  });
  return { json, long, name: draft.name };
}

/** True when two draftKey results are of the same draft. */
export function sameDraft(a, b) {
  return a.json === b.json && a.long.length === b.long.length && a.long.every((s, i) => s === b.long[i]);
}

// Credentials typed into auth settings, by auth type.
export const AUTH_SECRETS = { bearer: ['token'], basic: ['password'], apikey: ['value'], oauth2: ['accessToken', 'clientSecret', 'password'], awsv4: ['secretKey', 'sessionToken'] };

/** True for a value that only names {{variables}} (or is empty), so holds no secret itself. */
export const onlyVariables = (v) => /^\s*(\{\{[^{}]+\}\}\s*)*$/.test(v ?? '');

/** How many secret values a collection holds: secret variables with a value, and credentials typed into auth. */
export function countSecrets(c) {
  let n = (c.variables || []).filter((v) => v.secret && v.value).length;
  // Every auth type counts, not only the one in use: the others keep what was typed into them.
  const auth = (node) => {
    for (const [type, fields] of Object.entries(AUTH_SECRETS)) for (const f of fields) if (!onlyVariables(node.auth?.[type]?.[f])) n++;
  };
  auth(c);
  walk(c, auth);
  return n;
}

/** Depth-first walk over a collection or folder. fn(item, parents) */
export function walk(node, fn, parents = []) {
  for (const item of node.items || []) {
    fn(item, parents);
    if (item.type === 'folder') walk(item, fn, [...parents, item]);
  }
}

/** Finds an item by id; returns { item, parent, parents, index } or null. */
export function findItem(root, id) {
  let found = null;
  const visit = (node, parents) => {
    const items = node.items || [];
    for (let i = 0; i < items.length && !found; i++) {
      const item = items[i];
      if (item.id === id) found = { item, parent: node, parents: [...parents, node], index: i };
      else if (item.type === 'folder') visit(item, [...parents, node]);
    }
  };
  if (root.id === id) return { item: root, parent: null, parents: [], index: -1 };
  visit(root, []);
  return found;
}

/** All requests in a node, in tree order. */
export function requestsIn(node) {
  const out = [];
  walk(node, (item, parents) => {
    if (item.type === 'request') out.push({ item, parents });
  });
  return out;
}

/** Every request and WebSocket under a node, with its parents. */
export function leavesIn(node) {
  const out = [];
  walk(node, (item, parents) => {
    if (item.type === 'request' || item.type === 'websocket') out.push({ item, parents });
  });
  return out;
}

/** Deep copy with fresh ids, for duplicate. */
export function cloneWithNewIds(item, ids = null) {
  const copy = structuredClone(item);
  const renew = (x) => {
    const old = x.id;
    x.id = uid();
    ids?.set(old, x.id); // old id -> new id, when the caller asks
    for (const key of ['params', 'pathVars', 'headers', 'variables']) for (const p of x[key] || []) p.id = uid();
    if (x.body) for (const key of ['form', 'urlencoded']) for (const p of x.body[key] || []) p.id = uid();
    for (const e of x.examples || []) e.id = uid();
    for (const m of x.messages || []) m.id = uid();
    for (const child of x.items || []) renew(child);
  };
  renew(copy);
  return copy;
}
