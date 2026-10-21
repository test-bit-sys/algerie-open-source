/** HAR 1.2 archives (browser network exports) -> one Collection, one request per entry. */
import { normalizeCollection } from '../model.js';
import { parseQueryString, splitUrl } from '../url.js';
import { arr, isObj, rawTypeFromMime, text, warningList } from './util.js';

const SKIPPED_HEADERS = ['cookie', 'content-length'];

export function isHar(obj) {
  return isObj(obj) && isObj(obj.log) && Array.isArray(obj.log.entries);
}

export function importHar(obj, { name } = {}) {
  const w = warningList();
  const ctx = { w, files: 0 };
  const items = arr(obj.log.entries)
    .filter((e) => isObj(e) && isObj(e.request))
    .map((e) => entryToRequest(e, ctx));
  if (ctx.files) w.add(`${ctx.files} file upload(s) could not be imported; re-attach the files before sending.`);
  if (!items.length) w.add('The archive has no requests.');
  const col = normalizeCollection({ name: name || 'Imported HAR', items });
  return { collections: [col], environments: [], warnings: w.list };
}

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname || '/';
  } catch {
    return splitUrl(url).base || url;
  }
}

function entryToRequest(entry, ctx) {
  const r = entry.request;
  const method = text(r.method).toUpperCase() || 'GET';
  const url = text(r.url);
  const headers = arr(r.headers)
    .filter((h) => isObj(h) && h.name && !String(h.name).startsWith(':') && !SKIPPED_HEADERS.includes(String(h.name).toLowerCase()))
    .map((h) => ({ key: text(h.name), value: text(h.value) }));
  const query = splitUrl(url).query;
  const params =
    query != null
      ? parseQueryString(query).map((p) => ({ key: p.key, value: p.value }))
      : arr(r.queryString).map((q) => ({ key: text(q.name), value: text(q.value) }));
  return {
    type: 'request',
    name: `${method} ${pathOf(url)}`,
    method,
    url,
    params,
    headers,
    body: postDataBody(r.postData, ctx),
    auth: { type: 'inherit' },
    examples: responseExample(entry, method, url),
  };
}

function postDataBody(pd, ctx) {
  if (!isObj(pd)) return { mode: 'none' };
  const mime = String(pd.mimeType || '').toLowerCase();
  const params = arr(pd.params).filter(isObj);
  if (mime.startsWith('application/x-www-form-urlencoded')) {
    // The raw text is unambiguous; browsers differ on whether params are still percent-encoded.
    const rows = text(pd.text) || !params.length
      ? parseQueryString(text(pd.text)).map((p) => ({ key: safeDecode(p.key), value: safeDecode(p.value) }))
      : params.map((p) => ({ key: text(p.name), value: text(p.value) }));
    return { mode: 'urlencoded', urlencoded: rows };
  }
  if (mime.startsWith('multipart/form-data') && params.length) {
    return {
      mode: 'form',
      form: params.map((p) => {
        const isFile = p.fileName != null;
        if (isFile) ctx.files++;
        return { key: text(p.name), value: isFile ? '' : text(p.value), kind: isFile ? 'file' : 'text', file: null };
      }),
    };
  }
  const raw = text(pd.text);
  if (!raw && !mime) return { mode: 'none' };
  return { mode: 'raw', raw, rawType: rawTypeFromMime(mime) || 'text' };
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function responseExample(entry, method, url) {
  const res = entry.response;
  if (!isObj(res) || !Number(res.status)) return [];
  const content = isObj(res.content) ? res.content : {};
  const body = content.encoding === 'base64' ? '' : text(content.text);
  return [
    {
      name: `${res.status} ${text(res.statusText)}`.trim(),
      status: Number(res.status),
      statusText: text(res.statusText),
      headers: arr(res.headers)
        .filter((h) => isObj(h) && h.name && !String(h.name).startsWith(':'))
        .map((h) => ({ key: text(h.name), value: text(h.value) })),
      body,
      request: { method, url },
    },
  ];
}
