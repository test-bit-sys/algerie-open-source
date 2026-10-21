/**
 * AWS Signature Version 4 request signing with WebCrypto.
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */

const enc = new TextEncoder();

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** RFC 3986 encoding: everything except unreserved characters. */
export function uriEncode(text) {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Canonical path: each segment encoded once for S3, twice for other services. */
export function canonicalPath(pathname, service) {
  if (!pathname || pathname === '/') return '/';
  return pathname
    .split('/')
    .map((seg) => {
      const once = uriEncode(safeDecode(seg));
      return service === 's3' ? once : uriEncode(once);
    })
    .join('/');
}

export function canonicalQuery(search) {
  const pairs = [];
  for (const part of search.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = safeDecode((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    const v = eq < 0 ? '' : safeDecode(part.slice(eq + 1).replace(/\+/g, ' '));
    pairs.push([uriEncode(k), uriEncode(v)]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

export function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * Signs a request. Returns the headers to add:
 *   [{ key, value }] with Authorization, X-Amz-Date and, when needed,
 *   X-Amz-Security-Token and X-Amz-Content-Sha256.
 *
 * req: { method, url, headers: [{ key, value }], body: string | Uint8Array | null }
 * cfg: { accessKey, secretKey, sessionToken, region, service, date }
 */
export async function signAwsV4(req, cfg) {
  const { accessKey, secretKey, sessionToken = '', region = 'us-east-1', service = 'execute-api' } = cfg;
  if (!accessKey || !secretKey) throw new Error('Enter the AWS access key and secret key.');
  const url = new URL(req.url);
  const stamp = amzDate(cfg.date || new Date());
  const day = stamp.slice(0, 8);
  const bodyHash = await sha256Hex(req.body == null ? '' : req.body);

  const add = [{ key: 'X-Amz-Date', value: stamp }];
  if (sessionToken) add.push({ key: 'X-Amz-Security-Token', value: sessionToken });
  if (service === 's3') add.push({ key: 'X-Amz-Content-Sha256', value: bodyHash });

  const all = [...req.headers.filter((h) => !/^(authorization|x-amz-date|x-amz-security-token|x-amz-content-sha256)$/i.test(h.key)), ...add];
  const signed = new Map([['host', url.host]]);
  for (const h of all) {
    const name = h.key.toLowerCase().trim();
    if (name === 'content-type' || name.startsWith('x-amz-')) {
      const value = String(h.value).trim().replace(/\s+/g, ' ');
      signed.set(name, signed.has(name) ? `${signed.get(name)},${value}` : value);
    }
  }
  const names = [...signed.keys()].sort();
  const canonicalHeaders = names.map((n) => `${n}:${signed.get(n)}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [req.method.toUpperCase(), canonicalPath(url.pathname, service), canonicalQuery(url.search), canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonicalRequest)].join('\n');
  let key = await hmac(`AWS4${secretKey}`, day);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, stringToSign));
  add.unshift({ key: 'Authorization', value: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` });
  return { headers: add, canonicalRequest, stringToSign, signature };
}
