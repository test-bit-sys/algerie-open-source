/**
 * OpenAPI 3.0 / 3.1 and Swagger 2.0 documents -> one Collection. Operations
 * are grouped into folders by their first tag; bodies get an example built
 * from the schema when the document does not carry one.
 */
import { METHODS, normalizeCollection } from '../model.js';
import { paramsFromUrl, pathVariableNames, urlWithParams } from '../url.js';
import { arr, isObj, needsContentType, pretty, rawTypeFromMime, text, warningList } from './util.js';

const OPERATION_KEYS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
// Header parameters OpenAPI 3 says tools must ignore; they come from other fields. Swagger 2 only
// sets Content-Type elsewhere (consumes), so its Accept and Authorization parameters are kept.
const IGNORED_HEADERS = ['accept', 'content-type', 'authorization'];
const SECRET_VARS = ['bearerToken', 'password', 'apiKey', 'accessToken', 'clientSecret'];

/** 'openapi', 'swagger' or null. */
export function openApiKind(obj) {
  if (!isObj(obj)) return null;
  // Unquoted in YAML, "openapi: 3.1" is the number 3.1 and "openapi: 3.0" the number 3.
  if (typeof obj.openapi === 'number' ? Math.floor(obj.openapi) === 3 : typeof obj.openapi === 'string' && /^3\./.test(obj.openapi)) return 'openapi';
  if (String(obj.swagger) === '2.0' || String(obj.swagger) === '2') return 'swagger';
  return null;
}

export function importOpenApi(doc) {
  const w = warningList();
  const ctx = { doc, v3: openApiKind(doc) === 'openapi', w, authVars: new Set(), secretVars: new Set(SECRET_VARS), cookies: 0, skipped: [] };
  const info = isObj(doc.info) ? doc.info : {};
  // With one API key scheme its key is {{apiKey}}; with several, each is named after its scheme.
  const schemes = (ctx.v3 ? doc.components?.securitySchemes : doc.securityDefinitions) || {};
  ctx.namedKeys = Object.values(schemes).filter((s) => isObj(s) && s.type === 'apiKey' && s.in !== 'cookie').length > 1;

  const found = authFromRequirements(doc.security, ctx);
  const collectionAuth = found?.auth || { type: 'none' };
  ctx.collectionKeys = found?.keys || [];
  const folders = new Map();
  for (const t of arr(doc.tags)) {
    // Keyed by text: YAML reads a tag like 5 as a number in one place and a string in another.
    if (isObj(t) && t.name != null && t.name !== '') folders.set(text(t.name), { type: 'folder', name: text(t.name), description: text(t.description), items: [] });
  }
  const rootRequests = [];

  for (const [path, rawItem] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    const pathItem = deref(rawItem, ctx);
    if (!isObj(pathItem)) continue;
    for (const key of OPERATION_KEYS) {
      const op = pathItem[key];
      if (!isObj(op)) continue;
      const method = key.toUpperCase();
      if (!METHODS.includes(method)) {
        ctx.skipped.push(`${method} ${path}`);
        continue;
      }
      const req = buildRequest(method, path, pathItem, op, collectionAuth, ctx);
      const tag = arr(op.tags)[0] == null ? '' : text(arr(op.tags)[0]);
      if (tag !== '') {
        if (!folders.has(tag)) folders.set(tag, { type: 'folder', name: text(tag), description: '', items: [] });
        folders.get(tag).items.push(req);
      } else {
        rootRequests.push(req);
      }
    }
  }

  const baseUrl = serverUrl(ctx);
  const variables = [{ key: 'baseUrl', value: baseUrl }];
  for (const name of ctx.authVars) variables.push({ key: name, value: '', secret: ctx.secretVars.has(name) });
  if (ctx.cookies) w.add(`${ctx.cookies} cookie parameter(s) were skipped; add them as a Cookie header if needed.`);
  if (ctx.skipped.length) w.add(`Skipped unsupported operations: ${ctx.skipped.join(', ')}.`);

  const col = normalizeCollection({
    name: text(info.title) || 'Imported API',
    description: text(info.description),
    items: [...[...folders.values()].filter((f) => f.items.length), ...rootRequests],
    auth: collectionAuth,
    variables,
  });
  return { collections: [col], environments: [], warnings: w.list };
}

// ---------------------------------------------------------------- $ref

function lookupRef(ref, ctx) {
  if (!ref.startsWith('#')) {
    ctx.w.add(`External references are not followed (${ref}).`);
    return undefined;
  }
  let node = ctx.doc;
  const parts = ref.slice(1).split('/');
  if (parts[0] === '') parts.shift();
  for (const raw of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    let key = raw;
    try {
      key = decodeURIComponent(raw);
    } catch {
      // A bare % in the pointer: use the segment as written.
    }
    node = node[key.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node;
}

/** Follows $ref chains (not into schema properties). */
function deref(obj, ctx) {
  let cur = obj;
  const seen = new Set();
  while (isObj(cur) && typeof cur.$ref === 'string') {
    if (seen.has(cur.$ref)) return undefined;
    seen.add(cur.$ref);
    cur = lookupRef(cur.$ref, ctx);
  }
  return cur;
}

// ---------------------------------------------------------------- examples

const STRING_FORMATS = {
  'date-time': '2024-01-01T12:00:00Z',
  date: '2024-01-01',
  time: '12:00:00',
  email: 'user@example.com',
  uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  uri: 'https://example.com',
  url: 'https://example.com',
  hostname: 'example.com',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  byte: 'c3RyaW5n',
  binary: '',
  password: 'password',
};

/**
 * Builds an example value from a schema. `stack` holds the $refs being
 * expanded so a cyclic schema stops instead of recursing; `dir` drops
 * readOnly properties from requests and writeOnly ones from responses.
 */
export function sampleSchema(schema, doc, dir = 'request') {
  return sample(schema, { doc, w: warningList() }, [], dir, 0);
}

// Schemas that reference each other grow an example exponentially; these keep it to a readable size.
const MAX_REF_DEPTH = 6;
const MAX_SAMPLE_NODES = 2000;

function sample(schema, ctx, stack, dir, depth) {
  if (!isObj(schema) || depth > 20) return undefined;
  ctx.nodes = depth === 0 ? 1 : ctx.nodes + 1; // counted per example
  if (ctx.nodes > MAX_SAMPLE_NODES) return undefined;
  if (typeof schema.$ref === 'string') {
    if (stack.includes(schema.$ref) || stack.length >= MAX_REF_DEPTH) return undefined;
    return sample(lookupRef(schema.$ref, ctx), ctx, [...stack, schema.$ref], dir, depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const next = (s) => sample(s, ctx, stack, dir, depth + 1);

  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    let merged;
    for (const part of [...schema.allOf, ...(schema.properties ? [{ ...schema, allOf: undefined }] : [])]) {
      const v = next(part);
      if (isObj(v)) merged = { ...(isObj(merged) ? merged : {}), ...v };
      else if (merged === undefined && v !== undefined) merged = v;
    }
    return merged;
  }
  const alternatives = schema.oneOf || schema.anyOf;
  if (Array.isArray(alternatives) && alternatives.length) {
    const first = alternatives.find((s) => !(isObj(s) && s.type === 'null')) ?? alternatives[0];
    return next(first);
  }

  let type = schema.type;
  if (Array.isArray(type)) type = type.find((t) => t !== 'null') ?? 'null';
  if (!type) type = schema.properties || schema.additionalProperties ? 'object' : schema.items ? 'array' : undefined;
  switch (type) {
    case 'object': {
      const out = {};
      for (const [key, prop] of Object.entries(isObj(schema.properties) ? schema.properties : {})) {
        const target = deref(prop, ctx);
        if (isObj(target) && ((dir === 'request' && target.readOnly) || (dir === 'response' && target.writeOnly))) continue;
        const v = next(prop);
        if (v !== undefined) out[key] = v;
      }
      if (!schema.properties && isObj(schema.additionalProperties)) {
        const v = next(schema.additionalProperties);
        if (v !== undefined) out.key = v;
      }
      return out;
    }
    case 'array': {
      const v = next(schema.items);
      return v === undefined ? [] : [v];
    }
    case 'string':
      return STRING_FORMATS[schema.format] ?? 'string';
    case 'integer':
      return Math.ceil(Number(schema.minimum ?? 0));
    case 'number':
      return Number(schema.minimum ?? 0);
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return undefined;
  }
}

function mediaExample(media, ctx, dir) {
  if (!isObj(media)) return undefined;
  if (media.example !== undefined) return media.example;
  if (isObj(media.examples)) {
    const first = deref(Object.values(media.examples)[0], ctx);
    if (isObj(first) && first.value !== undefined) return first.value;
  }
  return sample(media.schema, ctx, [], dir, 0);
}

/** Explicit values only: example, default or first enum entry. */
function paramValue(p, ctx) {
  const v = paramExample(p, ctx);
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? v.map(text).join(',') : text(v);
}

/**
 * Query rows for a parameter, serialized as its style asks: OpenAPI 3 sends arrays as repeated
 * keys by default (form, explode), Swagger 2 as commas unless collectionFormat says otherwise.
 */
function queryRows(p, ctx) {
  const row = (key, value) => ({ key, value, enabled: !!p.required, description: text(p.description) });
  const v = paramExample(p, ctx);
  const style = ctx.v3 ? p.style || 'form' : '';
  const explode = ctx.v3 ? (p.explode ?? style === 'form') : p.collectionFormat === 'multi';
  if (Array.isArray(v)) {
    if (explode && (style === 'form' || !ctx.v3)) return v.map((x) => row(p.name, text(x)));
    const sep = ctx.v3 ? { spaceDelimited: ' ', pipeDelimited: '|' }[style] : { ssv: ' ', tsv: '\t', pipes: '|' }[p.collectionFormat];
    return [row(p.name, v.map(text).join(sep || ','))];
  }
  if (isObj(v) && p.schema) {
    if (style === 'deepObject') return Object.entries(v).map(([k, x]) => row(`${p.name}[${k}]`, fieldValue(x)));
    if (style === 'form') return explode ? Object.entries(v).map(([k, x]) => row(k, fieldValue(x))) : [row(p.name, Object.entries(v).flat().map(fieldValue).join(','))];
  }
  return [row(p.name, paramValue(p, ctx))];
}

/** A parameter's example value as written, or JSON text for one described by a media type. */
function paramExample(p, ctx) {
  let v = p.example ?? p['x-example'];
  if (v === undefined && isObj(p.examples)) v = deref(Object.values(p.examples)[0], ctx)?.value;
  const s = deref(p.schema, ctx) || p;
  if (v === undefined && isObj(s)) v = s.example ?? s.default ?? (Array.isArray(s.enum) ? s.enum[0] : undefined);
  // A parameter may describe its value with content (a media type) instead of a schema, often JSON.
  if (v === undefined && !p.schema && isObj(p.content)) {
    const media = Object.values(p.content).find(isObj);
    if (media) {
      v = media.example ?? (isObj(media.examples) ? deref(Object.values(media.examples)[0], ctx)?.value : undefined) ?? sample(media.schema, ctx, [], 'request', 0);
      if (isObj(v) || Array.isArray(v)) return JSON.stringify(v);
    }
  }
  return v;
}

const fieldValue = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// ---------------------------------------------------------------- requests

function buildRequest(method, path, pathItem, op, collectionAuth, ctx) {
  const params = new Map();
  for (const p of [...arr(pathItem.parameters), ...arr(op.parameters)]) {
    const r = deref(p, ctx);
    // YAML reads a name like 2024 as a number.
    if (isObj(r) && r.name != null && r.name !== '' && r.in) params.set(`${r.in}:${r.name}`, { ...r, name: text(r.name) });
  }
  const list = [...params.values()];

  // {id} filling a whole segment becomes a :id path variable; one inside a segment ({id}.json) has no
  // such form, so it takes its example value, or a {{variable}} to fill in.
  const inSegment = (name) => {
    const p = list.find((x) => x.in === 'path' && x.name === name);
    return (p && paramValue(p, ctx)) || `{{${name}}}`;
  };
  // Servers set on the operation or its path override the document's {{baseUrl}}.
  const own = ctx.v3 ? firstServer(arr(op.servers).length ? op.servers : pathItem.servers).replace(/\/+$/, '') : '';
  let url = `${own && own !== firstServer(ctx.doc.servers).replace(/\/+$/, '') ? own : '{{baseUrl}}'}${path
    .split('/')
    .map((seg) => (/^\{[^}]+\}$/.test(seg) ? `:${seg.slice(1, -1)}` : seg.replace(/\{([^}/]+)\}/g, (_, name) => inSegment(name))))
    .join('/')}`;
  let auth = { type: 'inherit' };
  let keys = ctx.collectionKeys;
  if (op.security !== undefined) {
    const found = authFromRequirements(op.security, ctx);
    if (found) {
      keys = found.keys;
      if (JSON.stringify(found.auth) !== JSON.stringify(collectionAuth)) auth = found.auth;
    }
  }
  // API keys sent alongside the auth (a requirement naming several schemes) become plain rows.
  const keyRow = (k) => ({ key: k.key, value: k.value, enabled: true });
  // A path key may carry its own query (/api?action=list); it stays ahead of the parameters.
  const query = [
    ...paramsFromUrl(url),
    ...list.filter((p) => p.in === 'query').flatMap((p) => queryRows(p, ctx)),
    ...keys.filter((k) => k.in === 'query').map(keyRow),
  ];
  url = urlWithParams(url, query);
  const pathVars = pathVariableNames(url).map((name) => {
    const p = list.find((x) => x.in === 'path' && x.name === name);
    return { key: name, value: p ? paramValue(p, ctx) : '', description: text(p?.description) };
  });
  // A header the auth sets is left to the auth: Swagger 2 specs often list it as a parameter too.
  const effective = auth.type === 'inherit' ? collectionAuth : auth;
  const authHeader = effective.type === 'apikey' ? (effective.apikey.in === 'header' ? effective.apikey.key : '') : effective.type === 'none' ? '' : 'authorization';
  const ignored = ctx.v3 ? IGNORED_HEADERS : ['content-type', authHeader.toLowerCase(), ...keys.filter((k) => k.in === 'header').map((k) => k.key.toLowerCase())];
  const headers = list
    .filter((p) => p.in === 'header' && !ignored.includes(p.name.toLowerCase()))
    .map((p) => ({ key: p.name, value: paramValue(p, ctx), enabled: !!p.required, description: text(p.description) }));
  headers.push(...keys.filter((k) => k.in === 'header').map(keyRow));
  ctx.cookies += list.filter((p) => p.in === 'cookie').length;

  const { body, contentType } = ctx.v3 ? bodyV3(op, ctx) : bodyV2(op, list, ctx);
  if (contentType) headers.unshift({ key: 'Content-Type', value: contentType });

  return {
    type: 'request',
    name: text(op.summary) || text(op.operationId) || `${method} ${path}`,
    description: text(op.description),
    method,
    url,
    params: query,
    pathVars,
    headers,
    body,
    auth,
    examples: examples(method, url, op, ctx),
  };
}

function pickMedia(content) {
  const entries = Object.entries(isObj(content) ? content : {});
  if (!entries.length) return null;
  const rank = ([m]) => {
    const l = m.toLowerCase();
    if (rawTypeFromMime(l) === 'json') return 0;
    if (l.startsWith('application/x-www-form-urlencoded')) return 1;
    if (l.startsWith('multipart/form-data')) return 2;
    if (rawTypeFromMime(l)) return 3;
    return 4;
  };
  return [...entries].sort((a, b) => rank(a) - rank(b))[0];
}

/** Flattened object properties (following allOf) as [name, schema, required]. */
function objectFields(schema, ctx, seen = new Set()) {
  const s = deref(schema, ctx);
  if (!isObj(s) || seen.has(s)) return [];
  seen.add(s);
  const out = [];
  for (const part of arr(s.allOf)) out.push(...objectFields(part, ctx, seen));
  const required = arr(s.required);
  for (const [name, prop] of Object.entries(isObj(s.properties) ? s.properties : {})) out.push([name, prop, required.includes(name)]);
  return out;
}

function isFileSchema(prop, ctx) {
  const s = deref(prop, ctx);
  if (!isObj(s)) return false;
  if (s.type === 'file' || s.format === 'binary' || s.contentMediaType) return true;
  return s.type === 'array' && isFileSchema(s.items, ctx);
}

function formBody(mode, fields, ctx) {
  const rows = fields.map(([key, prop]) => {
    const s = deref(prop, ctx) || {};
    const file = mode === 'form' && isFileSchema(prop, ctx);
    return {
      key,
      value: file ? '' : fieldValue(sample(prop, ctx, [], 'request', 0)),
      description: text(s.description),
      ...(mode === 'form' ? { kind: file ? 'file' : 'text' } : {}),
    };
  });
  return mode === 'form' ? { mode, form: rows } : { mode, urlencoded: rows };
}

// A JSON example may be written as the JSON text itself ('{"name":"x"}'), which is used as written.
function jsonText(example) {
  if (typeof example === 'string' && /^\s*[[{]/.test(example)) {
    try {
      JSON.parse(example);
      return example;
    } catch {
      // a string value that only looks like JSON
    }
  }
  return pretty(example);
}

function rawBody(mime, example) {
  const rawType = rawTypeFromMime(mime) || 'text';
  let raw = '';
  // A structured example only makes sense as JSON; other text types get it only when it is already a string.
  if (example !== undefined) raw = rawType === 'json' ? jsonText(example) : typeof example === 'string' ? example : '';
  return { body: { mode: 'raw', raw, rawType }, contentType: needsContentType(mime, rawType) ? mime : null };
}

function bodyV3(op, ctx) {
  const rb = deref(op.requestBody, ctx);
  const picked = isObj(rb) && pickMedia(rb.content);
  if (!picked) return { body: { mode: 'none' } };
  const [mime, media] = picked;
  const m = mime.toLowerCase();
  if (m.startsWith('application/x-www-form-urlencoded')) return { body: formBody('urlencoded', objectFields(media?.schema, ctx), ctx) };
  if (m.startsWith('multipart/form-data')) return { body: formBody('form', objectFields(media?.schema, ctx), ctx) };
  if (m.includes('*')) return rawBody('application/json', mediaExample(media, ctx, 'request'));
  if (!rawTypeFromMime(m)) return { body: { mode: 'binary' }, contentType: mime };
  return rawBody(mime, mediaExample(media, ctx, 'request'));
}

function bodyV2(op, params, ctx) {
  const consumes = arr(op.consumes ?? ctx.doc.consumes).map(String);
  const bodyParam = params.find((p) => p.in === 'body');
  if (bodyParam) {
    const mime = consumes.find((c) => rawTypeFromMime(c) === 'json') || consumes[0] || 'application/json';
    const example = bodyParam['x-example'] ?? sample(bodyParam.schema, ctx, [], 'request', 0);
    if (!rawTypeFromMime(mime)) return { body: { mode: 'binary' }, contentType: mime };
    return rawBody(mime, example);
  }
  const formParams = params.filter((p) => p.in === 'formData');
  if (!formParams.length) return { body: { mode: 'none' } };
  const multipart = formParams.some((p) => p.type === 'file') || consumes.some((c) => c.startsWith('multipart/form-data'));
  const fields = formParams.map((p) => [p.name, p, !!p.required]);
  return { body: formBody(multipart ? 'form' : 'urlencoded', fields, ctx) };
}

function examples(method, url, op, ctx) {
  const out = [];
  for (const [code, raw] of Object.entries(isObj(op.responses) ? op.responses : {})) {
    const status = Number(code);
    const r = deref(raw, ctx);
    if (!Number.isInteger(status) || !isObj(r)) continue;
    let mime;
    let value;
    if (ctx.v3) {
      const picked = pickMedia(r.content);
      if (!picked) continue;
      [mime] = picked;
      value = mediaExample(picked[1], ctx, 'response');
    } else {
      const produces = arr(op.produces ?? ctx.doc.produces).map(String);
      const given = isObj(r.examples) ? Object.entries(r.examples)[0] : null;
      mime = given?.[0] || produces.find((p) => rawTypeFromMime(p) === 'json') || produces[0] || 'application/json';
      value = given ? given[1] : sample(r.schema, ctx, [], 'response', 0);
    }
    if (value === undefined) continue;
    const body = rawTypeFromMime(mime) === 'json' ? jsonText(value) : typeof value === 'string' ? value : fieldValue(value);
    const label = text(r.description).split('\n')[0].trim();
    out.push({
      name: label ? `${code} ${label}` : `Response ${code}`,
      status,
      headers: [{ key: 'Content-Type', value: mime }],
      body,
      request: { method, url },
    });
  }
  return out;
}

// ---------------------------------------------------------------- servers, auth

/** URL of the first server in a v3 servers list, with its variables at their defaults. */
function firstServer(servers) {
  const server = arr(servers).find(isObj);
  let url = text(server?.url);
  for (const [name, v] of Object.entries(isObj(server?.variables) ? server.variables : {})) {
    url = url.split(`{${name}}`).join(text(v?.default ?? arr(v?.enum)[0]));
  }
  return url;
}

function serverUrl(ctx) {
  const { doc, w } = ctx;
  let url = '';
  if (ctx.v3) {
    url = firstServer(doc.servers);
  } else {
    const schemes = arr(doc.schemes);
    const scheme = schemes.includes('https') ? 'https' : schemes[0] || 'https';
    const basePath = text(doc.basePath);
    url = doc.host ? `${scheme}://${doc.host}${basePath}` : basePath;
  }
  url = url.replace(/\/+$/, '');
  if (!url) w.add('The document has no server URL; set the baseUrl collection variable.');
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    w.add(`The server URL "${url}" is relative; edit the baseUrl collection variable to include the host.`);
  }
  return url;
}

/**
 * { auth, keys } for the first requirement that has a supported scheme. A requirement naming several
 * schemes needs all of them: one becomes the auth (preferably not an API key) and the other API keys
 * are returned as { key, value, in } to send as headers or query parameters.
 */
function authFromRequirements(reqs, ctx) {
  if (!Array.isArray(reqs)) return null;
  const nonEmpty = reqs.filter((r) => isObj(r) && Object.keys(r).length);
  if (!nonEmpty.length) return { auth: { type: 'none' }, keys: [] };
  const defs = (ctx.v3 ? ctx.doc.components?.securitySchemes : ctx.doc.securityDefinitions) || {};
  for (const r of nonEmpty) {
    const found = Object.entries(r)
      .map(([name, scopes]) => [name, authFromScheme(deref(defs[name], ctx), name, arr(scopes), ctx)])
      .filter(([, a]) => a);
    if (!found.length) continue;
    const [, auth] = found.find(([, a]) => a.type !== 'apikey') || found[0];
    for (const [name, a] of found) {
      if (a !== auth && a.type !== 'apikey') ctx.w.add(`Security scheme "${name}" is required together with another one; only one of them was set as the auth.`);
    }
    return { auth, keys: found.filter(([, a]) => a !== auth && a.type === 'apikey').map(([, a]) => a.apikey) };
  }
  return null;
}

function useVar(ctx, name, secret) {
  ctx.authVars.add(name);
  if (secret) ctx.secretVars.add(name);
  return `{{${name}}}`;
}

function authFromScheme(s, name, scopes, ctx) {
  if (!isObj(s)) return null;
  const type = String(s.type || '');
  const httpScheme = String(s.scheme || '').toLowerCase();
  if (type === 'http' && httpScheme === 'bearer') return { type: 'bearer', bearer: { token: useVar(ctx, 'bearerToken') } };
  if ((type === 'http' && httpScheme === 'basic') || type === 'basic') {
    return { type: 'basic', basic: { username: useVar(ctx, 'username'), password: useVar(ctx, 'password') } };
  }
  if (type === 'apiKey') {
    if (s.in === 'cookie') {
      ctx.w.add(`Security scheme "${name}" sends its key in a cookie, which is not supported; add a Cookie header instead.`);
      return null;
    }
    return { type: 'apikey', apikey: { key: text(s.name), value: useVar(ctx, ctx.namedKeys ? name : 'apiKey', true), in: s.in === 'query' ? 'query' : 'header' } };
  }
  if (type === 'oauth2' || type === 'openIdConnect') {
    let grantType = 'client_credentials';
    let tokenUrl = '';
    let flowScopes = [];
    if (ctx.v3 && isObj(s.flows)) {
      const flow = s.flows.clientCredentials || s.flows.password || Object.values(s.flows)[0];
      if (s.flows.password && !s.flows.clientCredentials) grantType = 'password';
      tokenUrl = text(flow?.tokenUrl);
      flowScopes = Object.keys(isObj(flow?.scopes) ? flow.scopes : {});
      if (!s.flows.clientCredentials && !s.flows.password) ctx.w.add(`OAuth 2.0 flow of "${name}" is not supported; paste an access token instead.`);
    } else if (!ctx.v3) {
      if (s.flow === 'password') grantType = 'password';
      else if (s.flow !== 'application') ctx.w.add(`OAuth 2.0 flow of "${name}" is not supported; paste an access token instead.`);
      tokenUrl = text(s.tokenUrl);
      flowScopes = Object.keys(isObj(s.scopes) ? s.scopes : {});
    } else {
      ctx.w.add(`OpenID Connect scheme "${name}" was mapped to OAuth 2.0; paste an access token or set the token URL.`);
    }
    return {
      type: 'oauth2',
      oauth2: {
        accessToken: useVar(ctx, 'accessToken'),
        grantType,
        tokenUrl,
        clientId: useVar(ctx, 'clientId'),
        clientSecret: useVar(ctx, 'clientSecret'),
        scope: (scopes.length ? scopes : flowScopes).join(' '),
      },
    };
  }
  ctx.w.add(`Security scheme "${name}" (${type}${httpScheme ? ` ${httpScheme}` : ''}) is not supported.`);
  return null;
}
