/**
 * Collection format v2.0 / v2.1 (info.schema ".../collection/v2.x.x/...") and
 * its companion environment format ({ name, values: [{ key, value, enabled }] }).
 */
import { RAW_TYPES, normalizeCollection, normalizeEnvironment } from '../model.js';
import { parseQueryString, splitUrl, syncPathVars } from '../url.js';
import { arr, description, guessRawType, header, isObj, pretty, rawTypeFromMime, text, warningList } from './util.js';

export const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

/** 'v2.1', 'v2.0' or null. */
export function collectionV2Version(obj) {
  const schema = isObj(obj) && isObj(obj.info) ? String(obj.info.schema || '') : '';
  if (!schema.includes('collection/v2')) return null;
  return schema.includes('v2.0') ? 'v2.0' : 'v2.1';
}

export function isEnvironmentV2(obj) {
  return isObj(obj) && Array.isArray(obj.values) && !obj.info && !obj.item && obj.values.every((v) => isObj(v));
}

// ---------------------------------------------------------------- import

export function importCollectionV2(obj) {
  const w = warningList();
  const ctx = { w, scriptItems: 0, files: 0 };
  const info = isObj(obj.info) ? obj.info : {};
  const col = normalizeCollection({
    name: text(info.name) || 'Imported Collection',
    description: description(info.description),
    items: importItems(obj.item, ctx),
    auth: importAuth(obj.auth, 'the collection', ctx, 'none'),
    scripts: importScripts(obj.event, ctx),
    variables: arr(obj.variable).filter(isObj).map(importVariable),
  });
  if (ctx.scriptItems) {
    w.add(
      `Scripts in ${ctx.scriptItems} item(s) use the pm.* scripting API, which this app does not provide. ` +
        'They were imported as written; review them before running.',
    );
  }
  if (ctx.files) w.add(`${ctx.files} file upload(s) could not be imported; re-attach the files before sending.`);
  return { collections: [col], environments: [], warnings: w.list };
}

export function importEnvironmentV2(obj) {
  const env = normalizeEnvironment({
    name: text(obj.name) || 'Imported Environment',
    variables: arr(obj.values).filter(isObj).map(importVariable),
  });
  return { collections: [], environments: [env], warnings: [] };
}

function importVariable(v) {
  return {
    key: text(v.key),
    value: text(v.value),
    enabled: v.enabled !== false && !v.disabled,
    secret: v.type === 'secret',
    description: description(v.description),
  };
}

function importItems(items, ctx) {
  return arr(items)
    .filter(isObj)
    .map((item) => (Array.isArray(item.item) ? importFolder(item, ctx) : importRequest(item, ctx)));
}

function importFolder(item, ctx) {
  const name = text(item.name) || 'Untitled Folder';
  return {
    type: 'folder',
    name,
    description: description(item.description),
    items: importItems(item.item, ctx),
    auth: importAuth(item.auth, name, ctx, 'inherit'),
    scripts: importScripts(item.event, ctx),
  };
}

function importRequest(item, ctx) {
  const name = text(item.name) || 'Untitled Request';
  let req = item.request;
  if (typeof req === 'string') req = { url: req, method: 'GET' };
  if (!isObj(req)) req = {};
  const url = urlToString(req.url);
  const headers = importPairs(req.header);
  const ppb = isObj(item.protocolProfileBehavior) ? item.protocolProfileBehavior : {};
  return {
    type: 'request',
    name,
    description: description(req.description ?? item.description),
    method: text(req.method) || 'GET',
    url,
    params: importParams(req.url, url),
    pathVars: syncPathVars(url, importPairs(isObj(req.url) ? req.url.variable : null)),
    headers,
    body: importBody(req.body, headers, ctx),
    auth: importAuth(req.auth, name, ctx, 'inherit'),
    scripts: importScripts(item.event, ctx),
    settings: { followRedirects: ppb.followRedirects !== false, encodeUrl: ppb.disableUrlEncoding !== true },
    examples: arr(item.response).filter(isObj).map(importExample),
  };
}

/** Header lists may be arrays of { key, value, disabled } or a "Key: value" block. */
function importPairs(list) {
  if (typeof list === 'string') {
    return list
      .split(/\r?\n/)
      .map((line) => {
        // Split at the first colon with indexOf: a regex that trims around it is quadratic on long runs of spaces.
        const at = line.indexOf(':');
        const key = line.slice(0, at).trim();
        const value = line.slice(at + 1).trimStart();
        return at > 0 && key && !/[\r\u2028\u2029]/.test(value) ? { key, value, enabled: true } : null;
      })
      .filter(Boolean);
  }
  return arr(list)
    .filter(isObj)
    .map((p) => ({ key: text(p.key), value: text(p.value), enabled: !p.disabled, description: description(p.description) }));
}

function urlToString(u) {
  if (typeof u === 'string') return u;
  if (!isObj(u)) return '';
  if (typeof u.raw === 'string' && u.raw) return u.raw;
  const host = Array.isArray(u.host) ? u.host.join('.') : text(u.host);
  const segs = Array.isArray(u.path) ? u.path.map((s) => (isObj(s) ? text(s.value) : text(s))) : [text(u.path).replace(/^\//, '')];
  const path = segs.filter((s, i) => s !== '' || i > 0).join('/');
  let out = (u.protocol ? `${u.protocol}://` : '') + host + (u.port ? `:${u.port}` : '') + (path ? `/${path}` : '');
  const query = arr(u.query).filter((q) => isObj(q) && !q.disabled);
  if (query.length) out += `?${query.map((q) => (q.value == null ? text(q.key) : `${text(q.key)}=${text(q.value)}`)).join('&')}`;
  if (u.hash) out += `#${u.hash}`;
  return out;
}

function importParams(u, url) {
  if (isObj(u) && Array.isArray(u.query)) return importPairs(u.query);
  return parseQueryString(splitUrl(url).query).map((p) => ({ key: p.key, value: p.value, enabled: true }));
}

function importBody(b, headers, ctx) {
  if (!isObj(b) || b.disabled) return { mode: 'none' };
  switch (b.mode) {
    case 'raw': {
      const lang = b.options?.raw?.language;
      const raw = text(b.raw);
      const rawType = RAW_TYPES.includes(lang) ? lang : rawTypeFromMime(header(headers, 'content-type')?.value) || guessRawType(raw);
      return { mode: 'raw', raw, rawType };
    }
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: importPairs(b.urlencoded) };
    case 'formdata':
      return {
        mode: 'form',
        form: arr(b.formdata)
          .filter(isObj)
          .map((f) => {
            const isFile = f.type === 'file';
            if (isFile) ctx.files++;
            return {
              key: text(f.key),
              value: isFile ? '' : text(f.value),
              enabled: !f.disabled,
              description: description(f.description),
              kind: isFile ? 'file' : 'text',
              file: null,
            };
          }),
      };
    case 'file':
      ctx.files++;
      return { mode: 'binary', binary: null };
    case 'graphql': {
      const g = isObj(b.graphql) ? b.graphql : {};
      const vars = typeof g.variables === 'string' ? g.variables : g.variables == null ? '' : pretty(g.variables);
      return { mode: 'graphql', graphql: { query: text(g.query), variables: vars } };
    }
    default:
      return { mode: 'none' };
  }
}

/** Auth attributes come as [{ key, value }] in v2.1 and as a plain object in v2.0. */
function authAttrs(block) {
  if (Array.isArray(block)) {
    const out = {};
    for (const a of block) if (isObj(a) && a.key != null) out[a.key] = a.value;
    return out;
  }
  return isObj(block) ? block : {};
}

function importAuth(a, where, ctx, fallback) {
  if (!isObj(a) || !a.type) return { type: fallback };
  const at = authAttrs(a[a.type]);
  switch (a.type) {
    case 'noauth':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', bearer: { token: text(at.token) } };
    case 'basic':
      return { type: 'basic', basic: { username: text(at.username), password: text(at.password) } };
    case 'apikey':
      return { type: 'apikey', apikey: { key: text(at.key), value: text(at.value), in: at.in === 'query' ? 'query' : 'header' } };
    case 'oauth2': {
      const grant = text(at.grant_type);
      if (at.addTokenTo === 'queryParams') ctx.w.add(`OAuth 2.0 on ${quote(where)} added its token to the URL; here it is sent in the Authorization header.`);
      if (grant && !['client_credentials', 'password_credentials'].includes(grant)) {
        ctx.w.add(`OAuth 2.0 grant type "${grant}" on ${quote(where)} is not supported; the stored access token was kept.`);
      }
      const oauth2 = {
        accessToken: text(at.accessToken),
        headerPrefix: at.headerPrefix != null ? text(at.headerPrefix) : 'Bearer',
        grantType: grant === 'password_credentials' ? 'password' : 'client_credentials',
        tokenUrl: text(at.accessTokenUrl),
        clientId: text(at.clientId),
        clientSecret: text(at.clientSecret),
        scope: text(at.scope),
        username: text(at.username),
        password: text(at.password),
        clientAuth: at.client_authentication === 'body' ? 'body' : 'header',
      };
      return { type: 'oauth2', oauth2 };
    }
    case 'awsv4':
      return {
        type: 'awsv4',
        awsv4: { accessKey: text(at.accessKey), secretKey: text(at.secretKey), sessionToken: text(at.sessionToken), region: text(at.region), service: text(at.service) },
      };
    default:
      ctx.w.add(`Auth type "${a.type}" on ${quote(where)} is not supported and was set to No auth.`);
      return { type: 'none' };
  }
}

const quote = (where) => (where === 'the collection' ? where : `"${where}"`);

function importScripts(events, ctx) {
  const out = { pre: '', post: '' };
  for (const e of arr(events)) {
    if (!isObj(e) || e.disabled) continue;
    const exec = e.script?.exec;
    const src = Array.isArray(exec) ? exec.map(text).join('\n') : text(exec);
    if (!src) continue;
    const slot = e.listen === 'prerequest' ? 'pre' : e.listen === 'test' ? 'post' : null;
    if (slot) out[slot] = out[slot] ? `${out[slot]}\n${src}` : src;
  }
  if (/\bpm\./.test(out.pre + out.post)) ctx.scriptItems++;
  return out;
}

function importExample(r) {
  const orig = isObj(r.originalRequest) ? r.originalRequest : null;
  return {
    name: text(r.name) || 'Example',
    status: Number(r.code) || 200,
    statusText: text(r.status),
    headers: importPairs(r.header),
    body: text(r.body),
    request: orig ? { method: text(orig.method) || 'GET', url: urlToString(orig.url) } : null,
  };
}

// ---------------------------------------------------------------- export

export function exportCollectionV2(collection) {
  const c = normalizeCollection(collection);
  const out = {
    info: { name: c.name, ...(c.description ? { description: c.description } : {}), schema: SCHEMA_V21 },
    item: c.items.filter((i) => i.type !== 'websocket').map(exportItem),
  };
  const auth = exportAuth(c.auth);
  if (auth) out.auth = auth;
  const event = exportScripts(c.scripts);
  if (event) out.event = event;
  if (c.variables.length) out.variable = c.variables.map(exportVariable);
  return pretty(out);
}

export function exportEnvironmentV2(environment) {
  const e = normalizeEnvironment(environment);
  return pretty({
    name: e.name,
    values: e.variables.map((v) => ({ key: v.key, value: v.value, type: v.secret ? 'secret' : 'default', enabled: v.enabled })),
  });
}

function exportVariable(v) {
  return {
    key: v.key,
    value: v.value,
    type: v.secret ? 'secret' : 'string',
    ...(v.enabled ? {} : { disabled: true }),
    ...(v.description ? { description: v.description } : {}),
  };
}

function exportItem(item) {
  if (item.type === 'folder') {
    // WebSocket requests have no equivalent in this format and are left out.
    const out = { name: item.name, ...(item.description ? { description: item.description } : {}), item: item.items.filter((i) => i.type !== 'websocket').map(exportItem) };
    const auth = exportAuth(item.auth);
    if (auth) out.auth = auth;
    const event = exportScripts(item.scripts);
    if (event) out.event = event;
    return out;
  }
  return exportRequest(item);
}

function exportRequest(r) {
  const out = { name: r.name };
  const event = exportScripts(r.scripts);
  if (event) out.event = event;
  const ppb = {};
  if (!r.settings.followRedirects) ppb.followRedirects = false;
  if (!r.settings.encodeUrl) ppb.disableUrlEncoding = true;
  if (Object.keys(ppb).length) out.protocolProfileBehavior = ppb;
  const req = { method: r.method, header: r.headers.map(exportPair) };
  const auth = exportAuth(r.auth);
  if (auth) req.auth = auth;
  const body = exportBody(r.body);
  if (body) req.body = body;
  req.url = exportUrl(r);
  if (r.description) req.description = r.description;
  out.request = req;
  out.response = r.examples.map((e) => ({
    name: e.name,
    ...(e.request ? { originalRequest: { method: e.request.method, header: [], url: e.request.url } } : {}),
    status: e.statusText,
    code: e.status,
    header: e.headers.map(exportPair),
    body: e.body,
  }));
  return out;
}

function exportPair(p) {
  return { key: p.key, value: p.value, ...(p.enabled ? {} : { disabled: true }), ...(p.description ? { description: p.description } : {}) };
}

/** Splits a URL with {{variables}} into the structured form, keeping raw as written. */
function exportUrl(r) {
  const raw = r.url;
  const out = { raw };
  const { base, hash } = splitUrl(raw);
  let rest = base;
  const scheme = rest.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    out.protocol = scheme[1];
    rest = rest.slice(scheme[0].length);
  }
  // The host ends at the first "/" that is not inside {{ }}.
  let depth = 0;
  let cut = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (rest.startsWith('{{', i)) depth++;
    else if (rest.startsWith('}}', i) && depth) depth--;
    else if (rest[i] === '/' && !depth) {
      cut = i;
      break;
    }
  }
  let host = rest.slice(0, cut);
  const path = rest.slice(cut + 1);
  const port = host.match(/:(\d+|\{\{[^}]*\}\})$/);
  if (port) {
    out.port = port[1];
    host = host.slice(0, -port[0].length);
  }
  if (host) out.host = host.includes('{{') ? [host] : host.split('.');
  if (cut < rest.length) out.path = path.split('/');
  const written = parseQueryString(splitUrl(raw).query);
  const query = r.params.length ? r.params : written.map((p) => ({ ...p, enabled: true }));
  // Postman sends a null value as a bare key (?flag) and "" as "flag=".
  const bare = new Set(written.filter((p) => !p.hasValue).map((p) => p.key));
  if (query.length) out.query = query.map((p) => ({ ...exportPair(p), ...(p.value === '' && bare.has(p.key) ? { value: null } : {}) }));
  if (r.pathVars.length) {
    out.variable = r.pathVars.map((p) => ({ key: p.key, value: p.value, ...(p.description ? { description: p.description } : {}) }));
  }
  if (hash) out.hash = hash.slice(1);
  return out;
}

function exportBody(b) {
  switch (b.mode) {
    case 'raw':
      return { mode: 'raw', raw: b.raw, options: { raw: { language: b.rawType } } };
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: b.urlencoded.map(exportPair) };
    case 'form':
      return {
        mode: 'formdata',
        formdata: b.form.map((f) => ({
          key: f.key,
          ...(f.kind === 'file' ? { type: 'file', src: f.file?.name || '' } : { value: f.value, type: 'text' }),
          ...(f.enabled ? {} : { disabled: true }),
          ...(f.description ? { description: f.description } : {}),
        })),
      };
    case 'binary':
      return { mode: 'file', file: { src: b.binary?.name || '' } };
    case 'graphql':
      return { mode: 'graphql', graphql: { query: b.graphql.query, variables: b.graphql.variables } };
    default:
      return null;
  }
}

const attrs = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== '' && v != null)
    .map(([key, value]) => ({ key, value, type: 'string' }));

function exportAuth(a) {
  switch (a.type) {
    case 'inherit':
      return null;
    case 'none':
      return { type: 'noauth' };
    case 'bearer':
      return { type: 'bearer', bearer: attrs({ token: a.bearer.token }) };
    case 'basic':
      return { type: 'basic', basic: attrs({ username: a.basic.username, password: a.basic.password }) };
    case 'apikey':
      return { type: 'apikey', apikey: attrs({ key: a.apikey.key, value: a.apikey.value, in: a.apikey.in }) };
    case 'oauth2': {
      const o = a.oauth2;
      return {
        type: 'oauth2',
        oauth2: attrs({
          accessToken: o.accessToken,
          headerPrefix: o.headerPrefix,
          grant_type: o.grantType === 'password' ? 'password_credentials' : 'client_credentials',
          accessTokenUrl: o.tokenUrl,
          clientId: o.clientId,
          clientSecret: o.clientSecret,
          scope: o.scope,
          username: o.username,
          password: o.password,
          client_authentication: o.clientAuth,
          addTokenTo: 'header',
        }).concat(
          // Kept even when empty: a missing prefix reads back as "Bearer".
          o.headerPrefix === '' ? [{ key: 'headerPrefix', value: '', type: 'string' }] : [],
        ),
      };
    }
    case 'awsv4': {
      const w = a.awsv4;
      return { type: 'awsv4', awsv4: attrs({ accessKey: w.accessKey, secretKey: w.secretKey, sessionToken: w.sessionToken, region: w.region, service: w.service }) };
    }
    default:
      return null;
  }
}

function exportScripts(s) {
  const out = [];
  if (s.pre) out.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: s.pre.split('\n') } });
  if (s.post) out.push({ listen: 'test', script: { type: 'text/javascript', exec: s.post.split('\n') } });
  return out.length ? out : null;
}
