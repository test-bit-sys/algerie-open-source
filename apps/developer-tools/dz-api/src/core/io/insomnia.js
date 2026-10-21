/**
 * Insomnia export format v4 (_type: 'export', resources[]) -> collections and
 * environments. Each workspace becomes a collection; its base environment
 * becomes collection variables and each sub-environment an Environment.
 */
import { normalizeCollection, normalizeEnvironment } from '../model.js';
import { parseQueryString, splitUrl, syncPathVars, urlWithParams } from '../url.js';
import { arr, isObj, pretty, rawTypeFromMime, text, warningList } from './util.js';

export function isInsomnia(obj) {
  return isObj(obj) && obj._type === 'export' && Array.isArray(obj.resources);
}

/** '{{ _.name }}' and '{{ _["name"] }}' -> '{{name}}'. */
export function convertTemplate(s) {
  if (typeof s !== 'string' || !s.includes('{{')) return s;
  return s
    .replace(/\{\{\s*_\.([^{}\s]+)\s*\}\}/g, '{{$1}}')
    .replace(/\{\{\s*_\[\s*['"]([^'"]+)['"]\s*\]\s*\}\}/g, '{{$1}}');
}

export function importInsomnia(obj, { name } = {}) {
  const w = warningList();
  const ctx = { w, tags: 0, scripts: 0, files: 0, wsHeaders: 0 };
  const resources = arr(obj.resources).filter((r) => isObj(r) && r._id);
  const children = new Map();
  for (const r of resources) {
    const key = r.parentId ?? null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(r);
  }
  const sorted = (id) => [...(children.get(id) || [])].sort((a, b) => (Number(a.metaSortKey) || 0) - (Number(b.metaSortKey) || 0));
  const t = (s) => {
    const out = convertTemplate(text(s));
    if (out.includes('{%')) ctx.tags++;
    return out;
  };

  const items = (parentId) =>
    sorted(parentId)
      .map((r) => {
        if (r._type === 'request_group') {
          if (isObj(r.environment) && Object.keys(r.environment).length) w.add(`Folder variables in "${text(r.name)}" were not imported.`);
          return {
            type: 'folder',
            name: text(r.name) || 'Untitled Folder',
            description: t(r.description),
            items: items(r._id),
            auth: auth(r.authentication, t, ctx, text(r.name) || 'Untitled Folder'),
          };
        }
        if (r._type === 'request') return request(r, t, ctx);
        if (r._type === 'websocket_request') return websocket(r, sorted(r._id), t, ctx);
        return null;
      })
      .filter(Boolean);

  const collections = [];
  const environments = [];
  const workspaces = resources.filter((r) => r._type === 'workspace');
  const workspaceIds = new Set(workspaces.map((ws) => ws._id));

  for (const ws of workspaces) {
    const base = sorted(ws._id).find((r) => r._type === 'environment');
    collections.push(
      normalizeCollection({
        name: text(ws.name) || name || 'Imported Collection',
        description: t(ws.description),
        items: items(ws._id),
        variables: base ? envVariables(base.data, t) : [],
      }),
    );
    if (base) {
      for (const env of sorted(base._id).filter((r) => r._type === 'environment')) {
        environments.push(normalizeEnvironment({ name: text(env.name) || 'Environment', variables: envVariables(env.data, t) }));
      }
    }
  }

  // Requests whose workspace is not part of the export.
  const ids = new Set(resources.map((r) => r._id));
  const orphanParents = [...children.keys()].filter((id) => !workspaceIds.has(id) && !ids.has(id));
  const orphans = orphanParents.flatMap((id) => items(id));
  if (orphans.length) collections.push(normalizeCollection({ name: name || 'Imported Collection', items: orphans }));

  if (ctx.tags) w.add(`${ctx.tags} value(s) use template tags ({% ... %}), which this app does not support; edit them before sending.`);
  if (ctx.scripts) w.add(`Scripts in ${ctx.scripts} request(s) use a different scripting API; review them before running.`);
  if (ctx.wsHeaders) w.add(`Headers and auth on ${ctx.wsHeaders} WebSocket request(s) were not imported: browsers cannot set them on a WebSocket.`);
  if (ctx.files) w.add(`${ctx.files} file upload(s) could not be imported; re-attach the files before sending.`);
  return { collections, environments, warnings: w.list };
}

/** Nested environment data is flattened to dotted keys, which is how templates address it. */
function envVariables(data, t, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(isObj(data) ? data : {})) {
    const key = prefix + k;
    if (isObj(v)) out.push(...envVariables(v, t, `${key}.`));
    else out.push({ key, value: typeof v === 'string' ? t(v) : text(v) });
  }
  return out;
}

const rows = (list, t) =>
  arr(list)
    .filter((p) => isObj(p) && (p.name || p.value))
    .map((p) => ({ key: t(p.name), value: t(p.value), enabled: !p.disabled, description: text(p.description) }));

function websocket(r, children, t, ctx) {
  let url = t(r.url);
  const params = [...parseQueryString(splitUrl(url).query).map((p) => ({ key: p.key, value: p.value })), ...rows(r.parameters, t)];
  url = urlWithParams(url, params.map((p) => ({ ...p, enabled: p.enabled !== false })));
  const a = r.authentication;
  if (rows(r.headers, t).some((h) => h.enabled) || (isObj(a) && a.type && a.type !== 'none' && !a.disabled)) ctx.wsHeaders++;
  const messages = children
    .filter((c) => c._type === 'websocket_payload')
    .map((c) => ({ name: text(c.name), body: t(c.value), format: /json/i.test(text(c.mode)) ? 'json' : 'text' }));
  return { type: 'websocket', name: text(r.name) || 'Untitled WebSocket', description: t(r.description), url, params, messages };
}

function request(r, t, ctx) {
  let url = t(r.url);
  const { query } = splitUrl(url);
  const params = [...parseQueryString(query).map((p) => ({ key: p.key, value: p.value })), ...rows(r.parameters, t)];
  url = urlWithParams(url, params.map((p) => ({ ...p, enabled: p.enabled !== false })));
  const pathVars = syncPathVars(url, rows(r.pathParameters, t));
  const pre = text(r.preRequestScript);
  const post = text(r.afterResponseScript);
  if (pre || post) ctx.scripts++;
  return {
    type: 'request',
    name: text(r.name) || 'Untitled Request',
    description: t(r.description),
    method: text(r.method) || 'GET',
    url,
    params,
    pathVars,
    headers: rows(r.headers, t),
    body: body(r.body, t, ctx),
    auth: auth(r.authentication, t, ctx, text(r.name) || 'Untitled Request'),
    scripts: { pre, post },
    settings: { followRedirects: r.settingFollowRedirects !== 'off', encodeUrl: r.settingEncodeUrl !== false },
  };
}

function body(b, t, ctx) {
  if (!isObj(b)) return { mode: 'none' };
  const mime = String(b.mimeType || '').toLowerCase();
  if (!mime) return b.text ? { mode: 'raw', raw: t(b.text), rawType: 'text' } : { mode: 'none' };
  if (mime === 'application/graphql') {
    let g = {};
    try {
      g = JSON.parse(b.text || '{}');
    } catch {
      g = { query: b.text };
    }
    const vars = g.variables == null ? '' : typeof g.variables === 'string' ? g.variables : pretty(g.variables);
    return { mode: 'graphql', graphql: { query: t(g.query), variables: t(vars) } };
  }
  if (mime.startsWith('application/x-www-form-urlencoded')) return { mode: 'urlencoded', urlencoded: rows(b.params, t) };
  if (mime.startsWith('multipart/form-data')) {
    return {
      mode: 'form',
      form: arr(b.params)
        .filter(isObj)
        .map((p) => {
          const isFile = p.type === 'file';
          if (isFile) ctx.files++;
          return { key: t(p.name), value: isFile ? '' : t(p.value), enabled: !p.disabled, kind: isFile ? 'file' : 'text', file: null };
        }),
    };
  }
  if (mime === 'application/octet-stream') {
    if (b.fileName) ctx.files++;
    return { mode: 'binary' };
  }
  return { mode: 'raw', raw: t(b.text), rawType: rawTypeFromMime(mime) || 'text' };
}

function auth(a, t, ctx, where) {
  if (!isObj(a) || !a.type) return { type: 'inherit' };
  if (a.disabled) return { type: 'none' };
  switch (a.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer': {
      // A custom prefix (Token, JWT...) has no place in Bearer auth, so it becomes the header itself.
      const prefix = t(a.prefix).trim();
      if (prefix && prefix.toLowerCase() !== 'bearer') return { type: 'apikey', apikey: { key: 'Authorization', value: `${prefix} ${t(a.token)}`, in: 'header' } };
      return { type: 'bearer', bearer: { token: t(a.token) } };
    }
    case 'basic':
      return { type: 'basic', basic: { username: t(a.username), password: t(a.password) } };
    case 'apikey':
      if (a.addTo === 'cookie') {
        ctx.w.add('An API key sent as a cookie became a Cookie header; browsers only send it through the Puter relay.');
        return { type: 'apikey', apikey: { key: 'Cookie', value: `${t(a.key)}=${t(a.value)}`, in: 'header' } };
      }
      return { type: 'apikey', apikey: { key: t(a.key), value: t(a.value), in: a.addTo === 'queryParams' ? 'query' : 'header' } };
    case 'oauth2':
      if (a.grantType && !['client_credentials', 'password'].includes(a.grantType)) {
        ctx.w.add(`OAuth 2.0 grant type "${text(a.grantType)}" on "${where}" is not supported; the stored access token was kept.`);
      }
      return {
        type: 'oauth2',
        oauth2: {
          accessToken: t(a.accessToken),
          headerPrefix: a.tokenPrefix ? t(a.tokenPrefix) : 'Bearer',
          grantType: a.grantType === 'password' ? 'password' : 'client_credentials',
          tokenUrl: t(a.accessTokenUrl),
          clientId: t(a.clientId),
          clientSecret: t(a.clientSecret),
          scope: t(a.scope),
          username: t(a.username),
          password: t(a.password),
          clientAuth: a.credentialsInBody ? 'body' : 'header',
        },
      };
    case 'iam':
      return {
        type: 'awsv4',
        awsv4: { accessKey: t(a.accessKeyId), secretKey: t(a.secretAccessKey), sessionToken: t(a.sessionToken), region: t(a.region), service: t(a.service) },
      };
    default:
      ctx.w.add(`Auth type "${a.type}" is not supported and was set to No auth.`);
      return { type: 'none' };
  }
}
