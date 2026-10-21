/**
 * Turns a saved request into what goes on the wire: variables resolved, path
 * variables filled in, inherited auth applied, and default headers added.
 *
 * resolveRequest() returns a ResolvedRequest, plain data used for sending,
 * code snippets, the console and history:
 *   { method, url, headers: [{ key, value, auto?, credential? }], body, auth: { type, source } }
 * where body is null or one of
 *   { mode: 'raw', text, contentType }
 *   { mode: 'urlencoded', fields: [{ key, value }] }
 *   { mode: 'form', fields: [{ key, value, kind, fileName, fileRef, contentType }] }
 *   { mode: 'binary', fileName, fileRef, contentType }
 *   { mode: 'graphql', query, variables }
 */
import { RAW_CONTENT_TYPES } from './model.js';
import { applyPathVars, encodeUrlText, splitUrl, withScheme } from './url.js';
import { toBytes } from './http1.js';
import { findVariables, interpolate } from './variables.js';

export const USER_AGENT = 'PuterAPIClient/0.1';

/** The auth that applies to a request: its own, or the nearest ancestor's. */
export function effectiveAuth(request, parents = []) {
  if (request.auth?.type && request.auth.type !== 'inherit') return { auth: request.auth, source: null };
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if (p.auth && p.auth.type !== 'inherit') return { auth: p.auth, source: p };
  }
  return { auth: { type: 'none' }, source: null };
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Headers and query params contributed by an auth config (values resolved). */
export function authParts(auth, resolve = (s) => s) {
  const headers = [];
  const query = [];
  switch (auth?.type) {
    case 'bearer': {
      const token = resolve(auth.bearer.token).trim();
      if (token) headers.push({ key: 'Authorization', value: `Bearer ${token}` });
      break;
    }
    case 'basic': {
      const user = resolve(auth.basic.username);
      const pass = resolve(auth.basic.password);
      if (user || pass) headers.push({ key: 'Authorization', value: `Basic ${utf8Base64(`${user}:${pass}`)}` });
      break;
    }
    case 'apikey': {
      const key = resolve(auth.apikey.key).trim();
      const value = resolve(auth.apikey.value);
      if (key) (auth.apikey.in === 'query' ? query : headers).push({ key, value });
      break;
    }
    case 'oauth2': {
      const token = resolve(auth.oauth2.accessToken).trim();
      const prefix = resolve(auth.oauth2.headerPrefix ?? 'Bearer').trim();
      if (token) headers.push({ key: 'Authorization', value: prefix ? `${prefix} ${token}` : token });
      break;
    }
    default:
      break;
  }
  return { headers, query };
}

function decodeUserinfo(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const hasHeader = (list, name) => list.some((h) => h.key.toLowerCase() === name.toLowerCase());

function resolveBody(body, resolve) {
  switch (body?.mode) {
    case 'raw':
      return { mode: 'raw', text: resolve(body.raw), contentType: RAW_CONTENT_TYPES[body.rawType] || 'text/plain' };
    case 'urlencoded':
      return {
        mode: 'urlencoded',
        fields: body.urlencoded.filter((p) => p.enabled && p.key).map((p) => ({ key: resolve(p.key), value: resolve(p.value) })),
      };
    case 'form':
      return {
        mode: 'form',
        fields: body.form
          .filter((p) => p.enabled && p.key)
          .map((p) =>
            p.kind === 'file'
              ? { key: resolve(p.key), value: '', kind: 'file', fileName: p.file?.name || '', fileRef: p.file?.ref || '', contentType: p.file?.type || '' }
              : { key: resolve(p.key), value: resolve(p.value), kind: 'text' },
          ),
      };
    case 'binary':
      return body.binary
        ? { mode: 'binary', fileName: body.binary.name, fileRef: body.binary.ref, contentType: body.binary.type || 'application/octet-stream' }
        : null;
    case 'graphql':
      return { mode: 'graphql', query: resolve(body.graphql.query), variables: resolve(body.graphql.variables) };
    default:
      return null;
  }
}

function bodyContentType(body) {
  switch (body?.mode) {
    case 'raw':
      return body.contentType;
    case 'urlencoded':
      return 'application/x-www-form-urlencoded';
    case 'graphql':
      return 'application/json';
    case 'binary':
      return body.contentType || 'application/octet-stream';
    default:
      return null; // form: the multipart boundary is set when the body is built
  }
}

/**
 * Headers the app adds on its own, for display under the header table.
 * Returns [{ key, value, reason }].
 */
export function autoHeaders(request, parents = [], resolve = (s) => s) {
  const out = [];
  const user = request.headers.filter((h) => h.enabled && h.key);
  const { auth } = effectiveAuth(request, parents);
  for (const h of authParts(auth, resolve).headers) if (!hasHeader(user, h.key)) out.push({ ...h, reason: 'Authorization' });
  if (auth.type === 'awsv4' && !hasHeader(user, 'Authorization')) {
    out.push({ key: 'Authorization', value: 'AWS4-HMAC-SHA256 (signed when sent)', reason: 'AWS Signature' }, { key: 'X-Amz-Date', value: '(set when sent)', reason: 'AWS Signature' });
  }
  // Same rules as resolveRequest: GET and HEAD go without a body, and so does an empty raw body.
  const method = request.method.toUpperCase();
  let body = method === 'GET' || method === 'HEAD' ? null : resolveBody(request.body, resolve);
  if (body?.mode === 'raw' && body.text === '') body = null;
  const ct = bodyContentType(body);
  if (ct && !hasHeader(user, 'Content-Type')) out.push({ key: 'Content-Type', value: ct, reason: 'Body type' });
  if (body?.mode === 'form' && !hasHeader(user, 'Content-Type')) {
    out.push({ key: 'Content-Type', value: 'multipart/form-data; boundary=<set when sent>', reason: 'Body type' });
  }
  if (!hasHeader(user, 'Accept')) out.push({ key: 'Accept', value: '*/*', reason: 'Default' });
  // In the browser, the browser sends its own User-Agent.
  if (!hasHeader(user, 'User-Agent')) out.push({ key: 'User-Agent', value: USER_AGENT, reason: 'Relay only' });
  return out;
}

/**
 * request: Request model. parents: [collection, ...folders]. resolver: from
 * createResolver(). Returns { resolved, warnings }.
 */
export function resolveRequest(request, { parents = [], resolver } = {}) {
  const resolve = resolver ? resolver.resolve : (s) => s ?? '';
  const warnings = [];
  const unresolved = new Set();
  const scan = (s) => {
    for (const m of String(s).matchAll(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g)) unresolved.add(m[1]);
  };
  // Path variables and auth are encoded once resolved, so they are checked before that.
  const resolveChecked = (s) => {
    const v = resolve(s);
    scan(v);
    return v;
  };

  // URL: variables, then path variables, then auth query, then scheme and encoding.
  // A # in a variable value is data, so it is encoded rather than starting the
  // fragment. A variable that starts the URL may hold a whole URL and is left as is.
  const template = request.url ?? '';
  const first = findVariables(template)[0];
  const lead = first?.start === 0 ? first.end : 0;
  const lookup =
    resolver?.lookup ||
    ((name) => {
      const v = resolve(`{{${name}}}`);
      return v === `{{${name}}}` ? undefined : v;
    });
  let url = (resolve(template.slice(0, lead)) + interpolate(template.slice(lead), (name) => lookup(name)?.toString().replaceAll('#', '%23'))).trim();
  {
    const { base, query } = splitUrl(url);
    scan(query != null ? `${base}?${query}` : base);
  }
  const pathValues = new Map(request.pathVars.map((p) => [p.key, resolveChecked(p.value)]));
  url = applyPathVars(url, pathValues);
  const { auth, source } = effectiveAuth(request, parents);
  const parts = authParts(auth, resolveChecked);
  if (parts.query.length) {
    const { base, query, hash } = splitUrl(url);
    const extra = parts.query.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`).join('&');
    url = `${base}?${query ? `${query}&` : ''}${extra}${hash}`;
  }
  if (url) url = withScheme(url);
  // fetch refuses URLs with credentials, so user:password@ is sent as Basic auth instead, as curl does.
  let urlCredentials = null;
  const userinfo = url.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)@/i);
  if (userinfo) {
    const [user, ...rest] = userinfo[2].split(':');
    urlCredentials = { user: decodeUserinfo(user), pass: decodeUserinfo(rest.join(':')) };
    url = userinfo[1] + url.slice(userinfo[0].length);
  }
  if (request.settings?.encodeUrl !== false) url = encodeUrlText(url);
  const { hash } = splitUrl(url);
  if (hash) url = url.slice(0, url.length - hash.length);

  const headers = request.headers.filter((h) => h.enabled && h.key.trim()).map((h) => ({ key: resolve(h.key).trim(), value: resolve(h.value) }));
  // Auth headers are marked as credentials, which a redirect to another origin does not carry.
  for (const h of parts.headers) if (!hasHeader(headers, h.key)) headers.push({ ...h, auto: true, credential: true });
  if (urlCredentials && (urlCredentials.user || urlCredentials.pass) && auth.type !== 'awsv4' && !hasHeader(headers, 'Authorization')) {
    headers.push({ key: 'Authorization', value: `Basic ${utf8Base64(`${urlCredentials.user}:${urlCredentials.pass}`)}`, auto: true });
  }

  const method = request.method.toUpperCase();
  let body = method === 'GET' || method === 'HEAD' ? null : resolveBody(request.body, resolve);
  if ((method === 'GET' || method === 'HEAD') && request.body.mode !== 'none') {
    const b = resolveBody(request.body, resolve);
    const empty = !b || (b.mode === 'raw' && !b.text) || (b.fields && !b.fields.length) || (b.mode === 'graphql' && !b.query.trim() && !b.variables.trim());
    if (!empty) warnings.push(`${method} requests are sent without a body.`);
  }
  if (body?.mode === 'raw' && body.text === '' && !hasHeader(headers, 'Content-Type')) body = null;
  const ct = bodyContentType(body);
  if (ct && !hasHeader(headers, 'Content-Type')) headers.push({ key: 'Content-Type', value: ct, auto: true });
  if (!hasHeader(headers, 'Accept')) headers.push({ key: 'Accept', value: '*/*', auto: true });

  headers.forEach((h) => scan(h.value));
  if (unresolved.size) warnings.push(`Unresolved variable${unresolved.size > 1 ? 's' : ''}: ${[...unresolved].join(', ')}`);

  const signing =
    auth.type === 'awsv4' && !headers.some((h) => !h.auto && h.key.toLowerCase() === 'authorization')
      ? {
          accessKey: resolve(auth.awsv4.accessKey).trim(),
          secretKey: resolve(auth.awsv4.secretKey).trim(),
          sessionToken: resolve(auth.awsv4.sessionToken).trim(),
          region: resolve(auth.awsv4.region).trim() || 'us-east-1',
          service: resolve(auth.awsv4.service).trim() || guessAwsService(url),
        }
      : null;
  return { resolved: { method, url, headers, body, auth: { type: auth.type, source: source?.name || null }, signing }, warnings };
}

/** Serializes a GraphQL body to JSON text. Variables that are not valid JSON are dropped with a warning. */
export function graphqlJson(body) {
  let variables;
  const text = (body.variables || '').trim();
  if (text) {
    try {
      variables = JSON.parse(text);
    } catch {
      throw new Error('GraphQL variables are not valid JSON.');
    }
  }
  return JSON.stringify(variables === undefined ? { query: body.query } : { query: body.query, variables });
}

/**
 * Builds a fetch-ready body from a resolved body. files maps fileRef -> Blob.
 * Returns null, a string, a Blob, FormData or URLSearchParams.
 */
export function buildBody(body, files = new Map()) {
  if (!body) return null;
  switch (body.mode) {
    case 'raw':
      return body.text;
    case 'urlencoded': {
      const params = new URLSearchParams();
      for (const f of body.fields) params.append(f.key, f.value);
      return params;
    }
    case 'form': {
      const fd = new FormData();
      for (const f of body.fields) {
        if (f.kind === 'file') {
          const blob = files.get(f.fileRef);
          if (!blob) throw new Error(`Choose the file for form field "${f.key}" again; it is not stored on this device.`);
          fd.append(f.key, blob, f.fileName || 'file');
        } else fd.append(f.key, f.value);
      }
      return fd;
    }
    case 'binary': {
      const blob = files.get(body.fileRef);
      if (!blob) throw new Error('Choose the file to send again; it is not stored on this device.');
      return blob;
    }
    case 'graphql':
      return graphqlJson(body);
    case 'bytes':
      return body.bytes;
    default:
      return null;
  }
}

/** Scripts that run for a request, outermost first: collection, folders, request. */
export function scriptChain(request, parents, phase) {
  const out = [];
  for (const p of parents) if (p.scripts?.[phase]?.trim()) out.push({ source: p.name, kind: p.type, code: p.scripts[phase] });
  if (request.scripts?.[phase]?.trim()) out.push({ source: request.name, kind: 'request', code: request.scripts[phase] });
  return out;
}

/** Service name from an AWS endpoint host, for example "s3" from bucket.s3.us-west-2.amazonaws.com. */
export function guessAwsService(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const m = host.match(/^(.+)\.amazonaws\.com(?:\.cn)?$/);
    if (!m) return 'execute-api';
    const labels = m[1].split('.');
    if (labels.includes('execute-api')) return 'execute-api';
    // service.region, bucket.s3.region, s3.dualstack.region, s3-us-west-2 (legacy), iam (global)
    if (/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(labels.at(-1)) && labels.length > 1) labels.pop();
    if (labels.at(-1) === 'dualstack' && labels.length > 1) labels.pop();
    const service = labels.at(-1).replace(/-fips$/, '');
    return /^s3(?:-|$)/.test(service) ? 's3' : service;
  } catch {
    return 'execute-api';
  }
}

/** Adds AWS Signature Version 4 headers to a resolved request (async: uses WebCrypto). */
export async function signResolved(resolved, files) {
  if (!resolved.signing) return resolved;
  const { signAwsV4 } = await import('./aws-sigv4.js');
  const built = buildBody(resolved.body, files);
  const { bytes, contentType } = built == null ? { bytes: null } : await toBytes(built);
  let { body, headers: base } = resolved;
  if (resolved.body?.mode === 'form') {
    // Multipart gets a new random boundary each time it is built, so send the exact bytes that were signed.
    body = { mode: 'bytes', bytes };
    base = [...base.filter((h) => h.key.toLowerCase() !== 'content-type'), { key: 'Content-Type', value: contentType, auto: true }];
  }
  const { headers } = await signAwsV4({ method: resolved.method, url: resolved.url, headers: base, body: bytes }, resolved.signing);
  const names = new Set(headers.map((h) => h.key.toLowerCase()));
  return { ...resolved, body, headers: [...base.filter((h) => !names.has(h.key.toLowerCase())), ...headers.map((h) => ({ ...h, auto: true, credential: true }))] };
}
