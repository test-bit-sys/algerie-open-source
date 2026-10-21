/**
 * Code snippets for a resolved request (variables already substituted).
 *
 * resolved = { method, url, headers: [{ key, value }], body }
 * body = null
 *   | { mode: 'raw', text, contentType }
 *   | { mode: 'urlencoded', fields: [{ key, value }] }
 *   | { mode: 'form', fields: [{ key, value, kind: 'text' | 'file', fileName }] }
 *   | { mode: 'binary', fileName, contentType }
 *   | { mode: 'graphql', query, variables }
 *
 * Every generator works from the same prepared shape (see prepare()), where
 * GraphQL is already a JSON text body and multipart Content-Type headers are
 * dropped so each library (or our hand-built body) sets its own boundary.
 * File contents are never embedded: file parts refer to the file name as a
 * path for the reader to replace.
 */

export const LANGUAGES = [
  { id: 'curl', label: 'cURL', syntax: 'shell' },
  { id: 'httpie', label: 'HTTPie', syntax: 'shell' },
  { id: 'wget', label: 'Wget', syntax: 'shell' },
  { id: 'fetch', label: 'JavaScript - fetch', syntax: 'javascript' },
  { id: 'node-fetch', label: 'Node.js - fetch', syntax: 'javascript' },
  { id: 'axios', label: 'Node.js - Axios', syntax: 'javascript' },
  { id: 'python-requests', label: 'Python - Requests', syntax: 'python' },
  { id: 'python-http-client', label: 'Python - http.client', syntax: 'python' },
  { id: 'go', label: 'Go - net/http', syntax: 'go' },
  { id: 'php-curl', label: 'PHP - cURL', syntax: 'php' },
  { id: 'java-httpclient', label: 'Java - HttpClient', syntax: 'java' },
  { id: 'kotlin-okhttp', label: 'Kotlin - OkHttp', syntax: 'java' },
  { id: 'csharp-httpclient', label: 'C# - HttpClient', syntax: 'csharp' },
  { id: 'ruby-net-http', label: 'Ruby - Net::HTTP', syntax: 'ruby' },
  { id: 'rust-reqwest', label: 'Rust - reqwest', syntax: 'rust' },
  { id: 'swift-urlsession', label: 'Swift - URLSession', syntax: 'swift' },
  { id: 'powershell', label: 'PowerShell - Invoke-RestMethod', syntax: 'powershell' },
];

const GENERATORS = {
  curl: genCurl,
  httpie: genHttpie,
  wget: genWget,
  fetch: (r, o) => genFetch(r, o, false),
  'node-fetch': (r, o) => genFetch(r, o, true),
  axios: genAxios,
  'python-requests': genPythonRequests,
  'python-http-client': genPythonHttpClient,
  go: genGo,
  'php-curl': genPhp,
  'java-httpclient': genJava,
  'kotlin-okhttp': genKotlin,
  'csharp-httpclient': genCsharp,
  'ruby-net-http': genRuby,
  'rust-reqwest': genRust,
  'swift-urlsession': genSwift,
  powershell: genPowershell,
};

export function generateCode(langId, resolved, options = { indent: '  ' }) {
  const gen = GENERATORS[langId];
  if (!gen) throw new Error(`Unknown code language: ${langId}`);
  const opts = { indent: '  ', ...options };
  const code = gen(prepare(resolved || {}), opts);
  if (!resolved?.signing || langId === 'curl') return code;
  // Only curl can sign with AWS Signature Version 4 by itself; elsewhere the snippet says so.
  const syntax = LANGUAGES.find((l) => l.id === langId).syntax;
  const mark = ['shell', 'python', 'ruby', 'powershell'].includes(syntax) ? '#' : '//';
  const note = `${mark} This request must be signed with AWS Signature Version 4 (for example with an AWS SDK) before it is sent.`;
  return code.startsWith('<?php\n') ? `<?php\n${note}\n${code.slice(6)}` : `${note}\n${code}`;
}

/* ---------- shared preparation ---------- */

const BOUNDARY = '----FormBoundary7MA4YWxkTrZu0gW';
const DEFAULT_FILE = 'path/to/file';

/**
 * -> { method, url, headers, body } where body is null or
 *    { kind: 'text', text, contentType } | { kind: 'urlencoded', fields, encoded, contentType }
 *    | { kind: 'form', fields } | { kind: 'binary', path, contentType }
 */
function prepare(resolved) {
  const method = String(resolved.method || 'GET').trim().toUpperCase() || 'GET';
  const url = String(resolved.url || '');
  let headers = (resolved.headers || [])
    .filter((h) => h && h.enabled !== false && String(h.key ?? '').trim() !== '')
    // Whitespace around values is dropped when sending (fetch does too), and some clients reject it.
    .map((h) => ({ key: String(h.key).trim(), value: String(h.value ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') }));
  const b = resolved.body;
  let body = null;
  if (b && b.mode === 'raw') body = { kind: 'text', text: String(b.text ?? ''), contentType: b.contentType || '' };
  else if (b && b.mode === 'graphql') body = { kind: 'text', text: graphqlJson(b), contentType: 'application/json' };
  else if (b && b.mode === 'urlencoded') {
    const fields = cleanFields(b.fields);
    body = { kind: 'urlencoded', fields, encoded: encodeForm(fields), contentType: 'application/x-www-form-urlencoded' };
  } else if (b && b.mode === 'form') {
    body = {
      kind: 'form',
      fields: cleanFields(b.fields).map((f) => (f.kind === 'file' ? { ...f, path: f.fileName || DEFAULT_FILE } : f)),
    };
  } else if (b && b.mode === 'binary') body = { kind: 'binary', path: b.fileName || DEFAULT_FILE, contentType: b.contentType || '' };

  if (body?.kind === 'form') headers = headers.filter((h) => !(isContentType(h.key) && /multipart\//i.test(h.value)));
  else if (body?.contentType && !headers.some((h) => isContentType(h.key))) headers.push({ key: 'Content-Type', value: body.contentType });
  return { method, url, headers, body, signing: resolved.signing || null };
}

// The app sends Content-Length: 0 for these methods without a body (some servers answer 411 otherwise),
// and curl leaves it out unless it is given data.
const needsEmptyLength = (r) => ['POST', 'PUT', 'PATCH'].includes(r.method) && !r.headers.some((h) => h.key.toLowerCase() === 'content-length');

function cleanFields(list) {
  return (list || [])
    .filter((f) => f && f.enabled !== false && (String(f.key ?? '') !== '' || String(f.value ?? '') !== '' || f.kind === 'file'))
    .map((f) => ({ key: String(f.key ?? ''), value: String(f.value ?? ''), kind: f.kind === 'file' ? 'file' : 'text', fileName: f.fileName || '' }));
}

function graphqlJson(b) {
  const out = { query: String(b.query ?? '') };
  const vars = String(b.variables ?? '').trim();
  if (vars) {
    try {
      out.variables = JSON.parse(vars);
    } catch {
      // Invalid variables are left out rather than sent as a string.
    }
  }
  return JSON.stringify(out);
}

const isContentType = (key) => key.toLowerCase() === 'content-type';
const contentTypeOf = (r) => r.headers.find((h) => isContentType(h.key))?.value || '';
const formEncode = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodeForm = (fields) => fields.map((f) => `${formEncode(f.key)}=${formEncode(f.value)}`).join('&');
const baseName = (path) => String(path).split(/[\\/]/).pop() || String(path);
const hasNonAscii = (s) => /[^\x00-\x7f]/.test(s);
const STANDARD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Multipart body as alternating literal text and file segments, for languages without a form API. */
function multipartSegments(fields) {
  const segs = [];
  const text = (t) => {
    const last = segs[segs.length - 1];
    if (last && last.type === 'text') last.text += t;
    else segs.push({ type: 'text', text: t });
  };
  const q = (s) => s.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const f of fields) {
    if (f.kind === 'file') {
      text(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${q(f.key)}"; filename="${q(baseName(f.path))}"\r\n`);
      text('Content-Type: application/octet-stream\r\n\r\n');
      segs.push({ type: 'file', path: f.path });
      text('\r\n');
    } else {
      text(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${q(f.key)}"\r\n\r\n${f.value}\r\n`);
    }
  }
  text(`--${BOUNDARY}--\r\n`);
  return segs;
}

/** Merges duplicate header names (case-insensitive) with ", " for map-based APIs. */
function mergedHeaders(headers) {
  const out = [];
  for (const h of headers) {
    const prev = out.find((x) => x.key.toLowerCase() === h.key.toLowerCase());
    if (prev) prev.value += `, ${h.value}`;
    else out.push({ ...h });
  }
  return out;
}

const hasDuplicateKeys = (list) => new Set(list.map((x) => x.key)).size !== list.length;

/* ---------- string literal helpers ---------- */

const hex = (c, width) => c.charCodeAt(0).toString(16).padStart(width, '0');

/** POSIX shell: single quotes, closing and reopening around embedded quotes. */
function shq(s) {
  return /^[A-Za-z0-9_\-.,/:@%+=]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}
const shqAlways = (s) => `'${s.replace(/'/g, "'\\''")}'`;

/** C-family double-quoted string with the common escapes; other control characters via fallback(c). */
function cStr(s, fallback, extra = {}) {
  const map = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', ...extra };
  let out = '';
  for (const c of s) {
    if (map[c] !== undefined) out += map[c];
    else if (c < ' ' || c === '\x7f') out += fallback(c);
    else out += c;
  }
  return `"${out}"`;
}

function jsStr(s) {
  let out = '';
  for (const c of s) {
    if (c === "'") out += "\\'";
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c < ' ' || c === '\x7f' || c === '\u2028' || c === '\u2029') out += `\\u${hex(c, 4)}`;
    else out += c;
  }
  return `'${out}'`;
}

/** Multi-line text reads better as a template literal. */
function jsText(s) {
  if (!s.includes('\n')) return jsStr(s);
  return `\`${s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\r/g, '\\r')}\``;
}

function pyStr(s) {
  let out = '';
  for (const c of s) {
    if (c === "'") out += "\\'";
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c < ' ' || c === '\x7f') out += `\\x${hex(c, 2)}`;
    else out += c;
  }
  return `'${out}'`;
}

function pyText(s) {
  if (!s.includes('\n')) return pyStr(s);
  let out = '';
  for (const c of s) {
    if (c === '\\') out += '\\\\';
    else if (c === '"') out += '\\"';
    else if (c === '\r') out += '\\r';
    else if (c !== '\n' && c !== '\t' && (c < ' ' || c === '\x7f')) out += `\\x${hex(c, 2)}`;
    else out += c;
  }
  return `"""${out}"""`;
}

const goStr = (s) => cStr(s, (c) => `\\x${hex(c, 2)}`);
const goText = (s) => (s.includes('\n') && !/[`\r]/.test(s) ? `\`${s}\`` : goStr(s));

// Java: octal escapes, because \\u escapes are processed before lexing.
const javaStr = (s) => cStr(s, (c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`);
const ktStr = (s) => cStr(s, (c) => `\\u${hex(c, 4)}`, { $: '\\$' });
const csStr = (s) => cStr(s, (c) => `\\u${hex(c, 4)}`);
const csText = (s) => (s.includes('\n') && !s.includes('\r') ? `@"${s.replace(/"/g, '""')}"` : csStr(s));
const swiftStr = (s) => cStr(s, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`);
const rustStr = (s) => cStr(s, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`);

function rustText(s) {
  if (!/[\n"\\]/.test(s) || /[\r]/.test(s) || /[\x00-\x08\x0b-\x1f\x7f]/.test(s)) return rustStr(s);
  let hashes = '#';
  while (s.includes(`"${hashes}`)) hashes += '#';
  return `r${hashes}"${s}"${hashes}`;
}

// PHP and Ruby single-quoted strings: only \\ and \' are escapes, newlines are literal.
const sqStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const phpStr = sqStr;
// PHP double quotes, for text with line breaks that must survive as written.
const phpDqStr = (s) =>
  `"${s.replace(/[\\"$]/g, '\\$&').replace(/[\x00-\x1f\x7f]/g, (c) => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c] || `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}"`;
// Ruby drops a carriage return before a line break inside a literal, so text with control characters is escaped.
const rbStr = (s) =>
  /[\x00-\x09\x0b-\x1f\x7f]/.test(s)
    ? `"${s.replace(/[\\"#]/g, '\\$&').replace(/[\x00-\x1f\x7f]/g, (c) => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c] || `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}"`
    : sqStr(s);

// PowerShell single quotes; typographic quotes also delimit, so they are doubled too.
const psStr = (s) => `'${s.replace(/['\u2018\u2019\u201a\u201b]/g, (c) => c + c)}'`;

/* ---------- shell ---------- */

function genCurl(r, { indent }) {
  const parts = [];
  if (r.method === 'HEAD') parts.push('--head');
  // curl switches to POST when given data, so a GET with a body needs -X too.
  else if (r.method !== 'GET' || r.body) parts.push(`-X ${shq(r.method)}`);
  if (/[[\]{}]/.test(r.url)) parts.push('--globoff');
  parts.push(shqAlways(r.url));
  const lines = [`curl ${parts.join(' ')}`];
  for (const h of r.headers) lines.push(`-H ${shqAlways(h.value === '' ? `${h.key};` : `${h.key}: ${h.value}`)}`);
  if (r.signing) {
    const s = r.signing;
    lines.push(`--aws-sigv4 ${shqAlways(`aws:amz:${s.region}:${s.service}`)}`, `--user ${shqAlways(`${s.accessKey}:${s.secretKey}`)}`);
    if (s.sessionToken && !r.headers.some((h) => h.key.toLowerCase() === 'x-amz-security-token')) lines.push(`-H ${shqAlways(`X-Amz-Security-Token: ${s.sessionToken}`)}`);
  }
  const b = r.body;
  if (needsEmptyLength(r) && (!b || ((b.kind === 'urlencoded' || b.kind === 'form') && !b.fields.length))) lines.push(`-H ${shqAlways('Content-Length: 0')}`);
  if (b?.kind === 'text') lines.push(`--data-raw ${shqAlways(b.text)}`);
  else if (b?.kind === 'urlencoded') {
    for (const f of b.fields) {
      const safeKey = f.key !== '' && encodeURIComponent(f.key) === f.key;
      if (safeKey) lines.push(`--data-urlencode ${shqAlways(`${f.key}=${f.value}`)}`);
      else lines.push(`--data ${shqAlways(`${formEncode(f.key)}=${formEncode(f.value)}`)}`);
    }
  } else if (b?.kind === 'form') {
    for (const f of b.fields) {
      if (f.kind === 'file') {
        const p = /[;",]/.test(f.path) ? `"${f.path.replace(/["\\]/g, '\\$&')}"` : f.path;
        lines.push(`-F ${shqAlways(`${f.key}=@${p}`)}`);
      } else if (/^[@<"]/.test(f.value) || f.value.includes(';')) lines.push(`--form-string ${shqAlways(`${f.key}=${f.value}`)}`);
      else lines.push(`-F ${shqAlways(`${f.key}=${f.value}`)}`);
    }
  } else if (b?.kind === 'binary') lines.push(`--data-binary ${shqAlways(`@${b.path}`)}`);
  return lines.join(` \\\n${indent}`);
}

function genHttpie(r, { indent }) {
  const b = r.body;
  const flags = [];
  if (b?.kind === 'urlencoded') flags.push('--form');
  if (b?.kind === 'form') flags.push(b.fields.some((f) => f.kind === 'file') ? '--form' : '--multipart');
  // HTTPie only unescapes separators; any other backslash is kept as written.
  const esc = (k) => k.replace(/[:=@;]/g, '\\$&');
  // A value starting with a separator character would change the item's meaning (k:=v is JSON, k=@v reads a file).
  const escValue = (v) => v.replace(/^[=@:]/, '\\$&');
  const items = r.headers.map((h) => shqAlways(h.value === '' ? `${esc(h.key)};` : `${esc(h.key)}:${escValue(h.value)}`));
  if (b?.kind === 'urlencoded' || b?.kind === 'form') {
    for (const f of b.fields) items.push(shqAlways(f.kind === 'file' ? `${esc(f.key)}@${f.path}` : `${esc(f.key)}=${escValue(f.value)}`));
  }
  const head = ['http', ...flags, r.method, shqAlways(r.url)].join(' ');
  let cmd = [head, ...items].join(` \\\n${indent}`);
  if (b?.kind === 'text') cmd = `printf '%s' ${shqAlways(b.text)} | ${cmd}`;
  if (b?.kind === 'binary') cmd += ` < ${shqAlways(b.path)}`;
  return cmd;
}

function genWget(r, { indent }) {
  const lines = ['wget --quiet'];
  const b = r.body;
  if (b?.kind === 'form') {
    lines.unshift('# wget cannot build multipart/form-data bodies: text fields are sent url-encoded and file fields are left out.');
  }
  if (r.method !== 'GET') lines.push(`--method ${shq(r.method)}`);
  const headers = b?.kind === 'form' ? [...r.headers, { key: 'Content-Type', value: 'application/x-www-form-urlencoded' }] : r.headers;
  for (const h of headers) lines.push(`--header ${shqAlways(`${h.key}: ${h.value}`)}`);
  if (b?.kind === 'text') lines.push(`--body-data ${shqAlways(b.text)}`);
  else if (b?.kind === 'urlencoded') lines.push(`--body-data ${shqAlways(b.encoded)}`);
  else if (b?.kind === 'form') lines.push(`--body-data ${shqAlways(encodeForm(b.fields.filter((f) => f.kind !== 'file')))}`);
  else if (b?.kind === 'binary') lines.push(`--body-file ${shqAlways(b.path)}`);
  lines.push('--output-document -');
  lines.push(shqAlways(r.url));
  const [first, ...rest] = b?.kind === 'form' ? [`${lines[0]}\n${lines[1]}`, ...lines.slice(2)] : lines;
  return [first, ...rest].join(` \\\n${indent}`);
}

/* ---------- JavaScript ---------- */

function jsObject(pairs, indent, depth) {
  if (!pairs.length) return '{}';
  const pad = indent.repeat(depth + 1);
  return `{\n${pairs.map((p) => `${pad}${jsStr(p.key)}: ${jsStr(p.value)},`).join('\n')}\n${indent.repeat(depth)}}`;
}

function jsPairsArray(pairs, indent, depth) {
  const pad = indent.repeat(depth + 1);
  return `[\n${pairs.map((p) => `${pad}[${jsStr(p.key)}, ${jsStr(p.value)}],`).join('\n')}\n${indent.repeat(depth)}]`;
}

function jsHeaders(headers, indent, depth) {
  const dup = hasDuplicateKeys(headers.map((h) => ({ key: h.key.toLowerCase() })));
  return dup ? jsPairsArray(headers, indent, depth) : jsObject(headers, indent, depth);
}

/** Lines that build a FormData named "form"; fileExpr(path) gives the file value. */
function jsFormLines(fields, fileExpr) {
  return [
    'const form = new FormData();',
    ...fields.map((f) =>
      f.kind === 'file'
        ? `form.append(${jsStr(f.key)}, ${fileExpr(f.path)}, ${jsStr(baseName(f.path))});`
        : `form.append(${jsStr(f.key)}, ${jsStr(f.value)});`,
    ),
  ];
}

const FILE_INPUT = "const fileInput = document.querySelector('input[type=\"file\"]');";
const jsSearchParams = (fields, indent) =>
  `new URLSearchParams(${hasDuplicateKeys(fields) ? jsPairsArray(fields, indent, 1) : jsObject(fields, indent, 1)})`;

function genFetch(r, { indent }, node) {
  const b = r.body;
  const pre = [];
  const imports = [];
  let bodyExpr = null;
  if (b?.kind === 'text') bodyExpr = jsText(b.text);
  else if (b?.kind === 'urlencoded') bodyExpr = jsSearchParams(b.fields, indent);
  else if (b?.kind === 'form') {
    const hasFile = b.fields.some((f) => f.kind === 'file');
    if (node && hasFile) imports.push("import { openAsBlob } from 'node:fs';");
    if (!node && hasFile) pre.push('// Pick the files with an <input type="file"> element.', FILE_INPUT);
    let n = 0;
    pre.push(...jsFormLines(b.fields, (path) => (node ? `await openAsBlob(${jsStr(path)})` : `fileInput.files[${n++}]`)));
    bodyExpr = 'form';
  } else if (b?.kind === 'binary') {
    if (node) {
      imports.push("import { readFile } from 'node:fs/promises';");
      bodyExpr = `await readFile(${jsStr(b.path)})`;
    } else {
      pre.push(`// Pick ${jsStr(b.path)} with an <input type="file"> element.`, FILE_INPUT);
      bodyExpr = 'fileInput.files[0]';
    }
  }

  const opts = [`${indent}method: ${jsStr(r.method)},`];
  if (r.headers.length) opts.push(`${indent}headers: ${jsHeaders(r.headers, indent, 1)},`);
  if (bodyExpr) opts.push(`${indent}body: ${bodyExpr},`);
  const out = [];
  if (imports.length) out.push(...imports, '');
  if (pre.length) out.push(...pre, '');
  out.push(`const response = await fetch(${jsStr(r.url)}, {`, ...opts, '});', '');
  out.push('console.log(response.status);', 'console.log(await response.text());');
  return out.join('\n');
}

function genAxios(r, { indent }) {
  const b = r.body;
  const imports = ["import axios from 'axios';"];
  const pre = [];
  let data = null;
  if (b?.kind === 'text') data = jsText(b.text);
  else if (b?.kind === 'urlencoded') data = jsSearchParams(b.fields, indent);
  else if (b?.kind === 'form') {
    if (b.fields.some((f) => f.kind === 'file')) imports.push("import { openAsBlob } from 'node:fs';");
    pre.push(...jsFormLines(b.fields, (path) => `await openAsBlob(${jsStr(path)})`));
    data = 'form';
  } else if (b?.kind === 'binary') {
    imports.push("import { createReadStream } from 'node:fs';");
    data = `createReadStream(${jsStr(b.path)})`;
  }
  const opts = [`${indent}method: ${jsStr(r.method.toLowerCase())},`, `${indent}url: ${jsStr(r.url)},`];
  if (r.headers.length) opts.push(`${indent}headers: ${jsObject(mergedHeaders(r.headers), indent, 1)},`);
  if (data) opts.push(`${indent}data: ${data},`);
  // Axios would re-encode a text body sent as JSON (trimmed, or quoted when it is not valid JSON).
  if (b?.kind === 'text') opts.push(`${indent}transformRequest: [(body) => body],`);
  // Report every status instead of throwing on 4xx and 5xx.
  opts.push(`${indent}validateStatus: () => true,`);
  const out = [...imports, ''];
  if (pre.length) out.push(...pre, '');
  out.push('const response = await axios.request({', ...opts, '});', '', 'console.log(response.status);', 'console.log(response.data);');
  return out.join('\n');
}

/* ---------- Python ---------- */

function pyDict(pairs, indent) {
  if (!pairs.length) return '{}';
  return `{\n${pairs.map((p) => `${indent}${pyStr(p.key)}: ${pyStr(p.value)},`).join('\n')}\n}`;
}

function genPythonRequests(r, { indent }) {
  const b = r.body;
  const out = ['import requests', '', `url = ${pyStr(r.url)}`];
  const args = ['url'];
  if (r.headers.length) {
    out.push(`headers = ${pyDict(mergedHeaders(r.headers), indent)}`);
    args.push('headers=headers');
  }
  if (b?.kind === 'text') {
    out.push(`payload = ${pyText(b.text)}`);
    args.push(hasNonAscii(b.text) ? "data=payload.encode('utf-8')" : 'data=payload');
  } else if (b?.kind === 'urlencoded') {
    out.push(
      hasDuplicateKeys(b.fields)
        ? `payload = [\n${b.fields.map((f) => `${indent}(${pyStr(f.key)}, ${pyStr(f.value)}),`).join('\n')}\n]`
        : `payload = ${pyDict(b.fields, indent)}`,
    );
    args.push('data=payload');
  } else if (b?.kind === 'form') {
    // A list of (name, (filename, content)) tuples keeps duplicate names and forces multipart.
    const rows = b.fields.map((f) =>
      f.kind === 'file'
        ? `${indent}(${pyStr(f.key)}, (${pyStr(baseName(f.path))}, open(${pyStr(f.path)}, 'rb'))),`
        : `${indent}(${pyStr(f.key)}, (None, ${pyStr(f.value)})),`,
    );
    out.push(`files = [\n${rows.join('\n')}\n]`);
    args.push('files=files');
  } else if (b?.kind === 'binary') {
    out.push(`payload = open(${pyStr(b.path)}, 'rb')`);
    args.push('data=payload');
  }
  out.push('', `response = requests.request(${pyStr(r.method)}, ${args.join(', ')})`, '', 'print(response.status_code)', 'print(response.text)');
  return out.join('\n');
}

function splitHttpUrl(url) {
  const m = url.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^#]*)/i);
  if (!m) return { https: true, host: url.split(/[/?#]/)[0], path: url.slice(url.split(/[/?#]/)[0].length).split('#')[0] || '/' };
  const host = m[2].replace(/^[^@]*@/, '');
  let path = m[3] || '/';
  if (path.startsWith('?')) path = `/${path}`;
  return { https: m[1].toLowerCase() !== 'http', host, path };
}

function genPythonHttpClient(r, { indent }) {
  const b = r.body;
  const { https, host, path } = splitHttpUrl(r.url);
  const out = ['import http.client', '', `conn = http.client.${https ? 'HTTPSConnection' : 'HTTPConnection'}(${pyStr(host)})`];
  const headers = mergedHeaders(r.headers);
  let payload = 'None';
  if (b?.kind === 'text') {
    out.push(`payload = ${pyText(b.text)}${hasNonAscii(b.text) ? ".encode('utf-8')" : ''}`);
    payload = 'payload';
  } else if (b?.kind === 'urlencoded') {
    out.push(`payload = ${pyStr(b.encoded)}`);
    payload = 'payload';
  } else if (b?.kind === 'form') {
    out.push("payload = b''");
    for (const seg of multipartSegments(b.fields)) {
      if (seg.type === 'text') out.push(`payload += ${pyStr(seg.text)}.encode('utf-8')`);
      else out.push(`with open(${pyStr(seg.path)}, 'rb') as f:`, `${indent}payload += f.read()`);
    }
    headers.push({ key: 'Content-Type', value: `multipart/form-data; boundary=${BOUNDARY}` });
    payload = 'payload';
  } else if (b?.kind === 'binary') {
    out.push(`with open(${pyStr(b.path)}, 'rb') as f:`, `${indent}payload = f.read()`);
    payload = 'payload';
  }
  out.push(`headers = ${pyDict(headers, indent)}`);
  out.push(
    '',
    `conn.request(${pyStr(r.method)}, ${pyStr(path)}, ${payload}, headers)`,
    'res = conn.getresponse()',
    'data = res.read()',
    '',
    'print(res.status, res.reason)',
    "print(data.decode('utf-8'))",
  );
  return out.join('\n');
}

/* ---------- Go ---------- */

function genGo(r) {
  const t = '\t';
  const b = r.body;
  const imports = new Set(['fmt', 'io', 'net/http']);
  const body = [];
  let payload = 'nil';
  let formHeader = false;
  const check = (lvl) => [`${t.repeat(lvl)}if err != nil {`, `${t.repeat(lvl + 1)}panic(err)`, `${t.repeat(lvl)}}`];
  if (b?.kind === 'text' || b?.kind === 'urlencoded') {
    imports.add('strings');
    body.push(`${t}payload := strings.NewReader(${b.kind === 'text' ? goText(b.text) : goStr(b.encoded)})`, '');
    payload = 'payload';
  } else if (b?.kind === 'form') {
    imports.add('bytes').add('mime/multipart');
    body.push(`${t}payload := &bytes.Buffer{}`, `${t}writer := multipart.NewWriter(payload)`);
    for (const f of b.fields) {
      if (f.kind === 'file') {
        imports.add('os');
        body.push(
          `${t}{`,
          `${t}${t}file, err := os.Open(${goStr(f.path)})`,
          ...check(2),
          `${t}${t}defer file.Close()`,
          `${t}${t}part, err := writer.CreateFormFile(${goStr(f.key)}, ${goStr(baseName(f.path))})`,
          ...check(2),
          `${t}${t}if _, err := io.Copy(part, file); err != nil {`,
          `${t}${t}${t}panic(err)`,
          `${t}${t}}`,
          `${t}}`,
        );
      } else {
        body.push(`${t}if err := writer.WriteField(${goStr(f.key)}, ${goStr(f.value)}); err != nil {`, `${t}${t}panic(err)`, `${t}}`);
      }
    }
    body.push(`${t}if err := writer.Close(); err != nil {`, `${t}${t}panic(err)`, `${t}}`, '');
    payload = 'payload';
    formHeader = true;
  } else if (b?.kind === 'binary') {
    imports.add('os');
    body.push(`${t}payload, err := os.Open(${goStr(b.path)})`, ...check(1), `${t}defer payload.Close()`, '');
    payload = 'payload';
  }
  body.push(`${t}req, err := http.NewRequest(${goStr(r.method)}, ${goStr(r.url)}, ${payload})`, ...check(1));
  for (const h of r.headers) body.push(`${t}req.Header.Add(${goStr(h.key)}, ${goStr(h.value)})`);
  if (formHeader) body.push(`${t}req.Header.Set("Content-Type", writer.FormDataContentType())`);
  body.push(
    '',
    `${t}res, err := http.DefaultClient.Do(req)`,
    ...check(1),
    `${t}defer res.Body.Close()`,
    '',
    `${t}data, err := io.ReadAll(res.Body)`,
    ...check(1),
    `${t}fmt.Println(res.Status)`,
    `${t}fmt.Println(string(data))`,
  );
  const sorted = [...imports].sort();
  return ['package main', '', 'import (', ...sorted.map((i) => `${t}"${i}"`), ')', '', 'func main() {', ...body, '}'].join('\n');
}

/* ---------- PHP ---------- */

function genPhp(r, { indent }) {
  const b = r.body;
  const opts = [`CURLOPT_URL => ${phpStr(r.url)}`, 'CURLOPT_RETURNTRANSFER => true'];
  if (r.method === 'HEAD') opts.push('CURLOPT_NOBODY => true');
  else if (r.method !== 'GET' || b) opts.push(`CURLOPT_CUSTOMREQUEST => ${phpStr(r.method)}`);
  // Given as a header: an empty CURLOPT_POSTFIELDS would also make libcurl add a form Content-Type.
  const headers = !b && needsEmptyLength(r) ? [...r.headers, { key: 'Content-Length', value: '0' }] : r.headers;
  if (headers.length) {
    // libcurl drops "Name: " with nothing after it; "Name;" sends the header empty.
    opts.push(`CURLOPT_HTTPHEADER => [\n${headers.map((h) => `${indent}${indent}${phpStr(h.value === '' ? `${h.key};` : `${h.key}: ${h.value}`)},`).join('\n')}\n${indent}]`);
  }
  if (b?.kind === 'text') opts.push(`CURLOPT_POSTFIELDS => ${phpStr(b.text)}`);
  else if (b?.kind === 'urlencoded') opts.push(`CURLOPT_POSTFIELDS => ${phpStr(b.encoded)}`);
  else if (b?.kind === 'form' && hasDuplicateKeys(b.fields)) {
    // A PHP array keeps only the last of repeated names, so the multipart body is built by hand.
    const parts = multipartSegments(b.fields).map((seg) => (seg.type === 'text' ? phpDqStr(seg.text) : `file_get_contents(${phpStr(seg.path)})`));
    opts.push(`CURLOPT_POSTFIELDS => ${parts.join(`\n${indent}${indent}. `)}`);
    const list = opts.find((o) => o.startsWith('CURLOPT_HTTPHEADER'));
    const ct = `${indent}${indent}${phpStr(`Content-Type: multipart/form-data; boundary=${BOUNDARY}`)},`;
    if (list) opts[opts.indexOf(list)] = list.replace(/\n(\s*)\]$/, `\n${ct}\n$1]`);
    else opts.push(`CURLOPT_HTTPHEADER => [\n${ct}\n${indent}]`);
  } else if (b?.kind === 'form') {
    const rows = b.fields.map((f) =>
      f.kind === 'file'
        ? `${indent}${indent}${phpStr(f.key)} => new CURLFile(${phpStr(f.path)}, 'application/octet-stream', ${phpStr(baseName(f.path))}),`
        : `${indent}${indent}${phpStr(f.key)} => ${phpStr(f.value)},`,
    );
    opts.push(`CURLOPT_POSTFIELDS => [\n${rows.join('\n')}\n${indent}]`);
  } else if (b?.kind === 'binary') opts.push(`CURLOPT_POSTFIELDS => file_get_contents(${phpStr(b.path)})`);
  return [
    '<?php',
    '',
    '$curl = curl_init();',
    '',
    'curl_setopt_array($curl, [',
    ...opts.map((o) => `${indent}${o},`),
    ']);',
    '',
    '$response = curl_exec($curl);',
    '$error = curl_error($curl);',
    '',
    'if ($error) {',
    `${indent}echo 'Error: ' . $error;`,
    '} else {',
    `${indent}echo $response;`,
    '}',
  ].join('\n');
}

/* ---------- Java ---------- */

const JAVA_RESTRICTED = new Set(['connection', 'content-length', 'expect', 'host', 'upgrade']);

function genJava(r, { indent }) {
  const b = r.body;
  const i2 = indent.repeat(2);
  const i3 = indent.repeat(3);
  const imports = new Set(['java.net.URI', 'java.net.http.HttpClient', 'java.net.http.HttpRequest', 'java.net.http.HttpResponse']);
  const pre = [];
  let publisher = 'HttpRequest.BodyPublishers.noBody()';
  const headers = [...r.headers];
  if (b?.kind === 'text') publisher = `HttpRequest.BodyPublishers.ofString(${javaStr(b.text)})`;
  else if (b?.kind === 'urlencoded') publisher = `HttpRequest.BodyPublishers.ofString(${javaStr(b.encoded)})`;
  else if (b?.kind === 'binary') {
    imports.add('java.nio.file.Path');
    publisher = `HttpRequest.BodyPublishers.ofFile(Path.of(${javaStr(b.path)}))`;
  } else if (b?.kind === 'form') {
    imports.add('java.io.ByteArrayOutputStream').add('java.nio.charset.StandardCharsets');
    pre.push(`${i2}ByteArrayOutputStream body = new ByteArrayOutputStream();`);
    for (const seg of multipartSegments(b.fields)) {
      if (seg.type === 'text') pre.push(`${i2}body.write(${javaStr(seg.text)}.getBytes(StandardCharsets.UTF_8));`);
      else {
        imports.add('java.nio.file.Files').add('java.nio.file.Path');
        pre.push(`${i2}body.write(Files.readAllBytes(Path.of(${javaStr(seg.path)})));`);
      }
    }
    pre.push('');
    headers.push({ key: 'Content-Type', value: `multipart/form-data; boundary=${BOUNDARY}` });
    publisher = 'HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())';
  }
  const builder = [`${i2}HttpRequest request = HttpRequest.newBuilder()`, `${i3}.uri(URI.create(${javaStr(r.url)}))`];
  for (const h of headers) {
    // HttpClient manages these itself and rejects them.
    if (JAVA_RESTRICTED.has(h.key.toLowerCase())) builder.push(`${i3}// .header(${javaStr(h.key)}, ${javaStr(h.value)}) is set by HttpClient`);
    else builder.push(`${i3}.header(${javaStr(h.key)}, ${javaStr(h.value)})`);
  }
  builder.push(`${i3}.method(${javaStr(r.method)}, ${publisher})`, `${i3}.build();`);
  return [
    ...[...imports].sort().map((i) => `import ${i};`),
    '',
    'public class Main {',
    `${indent}public static void main(String[] args) throws Exception {`,
    `${i2}HttpClient client = HttpClient.newHttpClient();`,
    '',
    ...pre,
    ...builder,
    '',
    `${i2}HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());`,
    `${i2}System.out.println(response.statusCode());`,
    `${i2}System.out.println(response.body());`,
    `${indent}}`,
    '}',
  ].join('\n');
}

/* ---------- Kotlin ---------- */

function genKotlin(r, { indent }) {
  const b = r.body;
  const i2 = indent.repeat(2);
  const imports = new Set(['okhttp3.OkHttpClient', 'okhttp3.Request']);
  const pre = [];
  const ct = contentTypeOf(r);
  const mediaType = (value) => {
    imports.add('okhttp3.MediaType.Companion.toMediaTypeOrNull');
    return value ? `${ktStr(value)}.toMediaTypeOrNull()` : 'null';
  };
  let bodyExpr = null;
  let skipContentType = false;
  if (b?.kind === 'text' || b?.kind === 'urlencoded') {
    imports.add('okhttp3.RequestBody.Companion.toRequestBody');
    bodyExpr = `${ktStr(b.kind === 'text' ? b.text : b.encoded)}.toRequestBody(${mediaType(ct)})`;
    skipContentType = true;
  } else if (b?.kind === 'binary') {
    imports.add('java.io.File').add('okhttp3.RequestBody.Companion.asRequestBody');
    bodyExpr = `File(${ktStr(b.path)}).asRequestBody(${mediaType(ct)})`;
    skipContentType = true;
  } else if (b?.kind === 'form') {
    imports.add('okhttp3.MultipartBody');
    pre.push(`${indent}val body = MultipartBody.Builder()`, `${i2}.setType(MultipartBody.FORM)`);
    for (const f of b.fields) {
      if (f.kind === 'file') {
        imports.add('java.io.File').add('okhttp3.RequestBody.Companion.asRequestBody');
        const file = `File(${ktStr(f.path)}).asRequestBody(${mediaType('application/octet-stream')})`;
        pre.push(`${i2}.addFormDataPart(${ktStr(f.key)}, ${ktStr(baseName(f.path))}, ${file})`);
      } else pre.push(`${i2}.addFormDataPart(${ktStr(f.key)}, ${ktStr(f.value)})`);
    }
    pre.push(`${i2}.build()`, '');
    bodyExpr = 'body';
  }
  const noBodyAllowed = r.method === 'GET' || r.method === 'HEAD';
  if (bodyExpr && noBodyAllowed) {
    pre.push(`${indent}// OkHttp does not allow a body on ${r.method}; it has been left out.`);
    bodyExpr = null;
  }
  if (!bodyExpr && ['POST', 'PUT', 'PATCH', 'PROPPATCH', 'REPORT'].includes(r.method)) {
    imports.add('okhttp3.RequestBody.Companion.toRequestBody');
    bodyExpr = '"".toRequestBody(null)';
  }
  if (bodyExpr && !pre.length && bodyExpr !== 'body') {
    pre.push(`${indent}val body = ${bodyExpr}`, '');
    bodyExpr = 'body';
  }
  const req = [`${indent}val request = Request.Builder()`, `${i2}.url(${ktStr(r.url)})`, `${i2}.method(${ktStr(r.method)}, ${bodyExpr || 'null'})`];
  for (const h of r.headers) {
    if (skipContentType && isContentType(h.key)) continue;
    req.push(`${i2}.addHeader(${ktStr(h.key)}, ${ktStr(h.value)})`);
  }
  req.push(`${i2}.build()`);
  return [
    ...[...imports].sort().map((i) => `import ${i}`),
    '',
    'fun main() {',
    `${indent}val client = OkHttpClient()`,
    '',
    ...pre,
    ...req,
    '',
    `${indent}client.newCall(request).execute().use { response ->`,
    `${i2}println(response.code)`,
    `${i2}println(response.body?.string())`,
    `${indent}}`,
    '}',
  ].join('\n');
}

/* ---------- C# ---------- */

const CS_CONTENT_HEADERS = new Set([
  'allow', 'content-disposition', 'content-encoding', 'content-language', 'content-length', 'content-location', 'content-md5',
  'content-range', 'content-type', 'expires', 'last-modified',
]);

function genCsharp(r) {
  const b = r.body;
  const usings = new Set(['System', 'System.Net.Http']);
  const out = [];
  out.push('using var client = new HttpClient();');
  out.push(`var request = new HttpRequestMessage(new HttpMethod(${csStr(r.method)}), ${csStr(r.url)});`);
  const contentHeaders = [];
  for (const h of r.headers) {
    if (b && CS_CONTENT_HEADERS.has(h.key.toLowerCase())) contentHeaders.push(h);
    else out.push(`request.Headers.TryAddWithoutValidation(${csStr(h.key)}, ${csStr(h.value)});`);
  }
  if (b?.kind === 'text') {
    usings.add('System.Text');
    out.push(`request.Content = new StringContent(${csText(b.text)}, Encoding.UTF8);`);
  } else if (b?.kind === 'urlencoded') {
    usings.add('System.Text');
    out.push(`request.Content = new StringContent(${csStr(b.encoded)}, Encoding.UTF8);`);
  } else if (b?.kind === 'binary') {
    usings.add('System.IO');
    out.push(`request.Content = new StreamContent(File.OpenRead(${csStr(b.path)}));`);
  } else if (b?.kind === 'form') {
    out.push('var content = new MultipartFormDataContent();');
    for (const f of b.fields) {
      if (f.kind === 'file') {
        usings.add('System.IO');
        out.push(`content.Add(new StreamContent(File.OpenRead(${csStr(f.path)})), ${csStr(f.key)}, ${csStr(baseName(f.path))});`);
      } else out.push(`content.Add(new StringContent(${csStr(f.value)}), ${csStr(f.key)});`);
    }
    out.push('request.Content = content;');
  }
  for (const h of contentHeaders) {
    if (isContentType(h.key)) {
      usings.add('System.Net.Http.Headers');
      out.push(`request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(${csStr(h.value)});`);
    } else out.push(`request.Content.Headers.TryAddWithoutValidation(${csStr(h.key)}, ${csStr(h.value)});`);
  }
  out.push(
    '',
    'var response = await client.SendAsync(request);',
    'Console.WriteLine((int)response.StatusCode);',
    'Console.WriteLine(await response.Content.ReadAsStringAsync());',
  );
  return [...[...usings].sort().map((u) => `using ${u};`), '', ...out].join('\n');
}

/* ---------- Ruby ---------- */

const RUBY_CLASSES = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options' };

function genRuby(r, { indent }) {
  const b = r.body;
  const out = ["require 'uri'", "require 'net/http'", '', `url = URI(${rbStr(r.url)})`, ''];
  out.push('http = Net::HTTP.new(url.host, url.port)', "http.use_ssl = url.scheme == 'https'", '');
  const cls = RUBY_CLASSES[r.method];
  if (cls) out.push(`request = Net::HTTP::${cls}.new(url)`);
  else out.push(`request = Net::HTTPGenericRequest.new(${rbStr(r.method)}, ${b ? 'true' : 'false'}, true, url)`);
  // request[k] = v replaces Ruby's defaults (Accept, User-Agent); repeats of a header use add_field so both are sent.
  const seen = new Set();
  for (const h of r.headers) {
    const name = h.key.toLowerCase();
    out.push(seen.has(name) ? `request.add_field(${rbStr(h.key)}, ${rbStr(h.value)})` : `request[${rbStr(h.key)}] = ${rbStr(h.value)}`);
    seen.add(name);
  }
  if (b?.kind === 'text') out.push(`request.body = ${rbStr(b.text)}`);
  else if (b?.kind === 'urlencoded') {
    const rows = b.fields.map((f) => `${indent}[${rbStr(f.key)}, ${rbStr(f.value)}],`);
    out.push(`request.body = URI.encode_www_form([\n${rows.join('\n')}\n])`);
  }
  else if (b?.kind === 'form') {
    const rows = b.fields.map((f) =>
      f.kind === 'file'
        ? `${indent}[${rbStr(f.key)}, File.open(${rbStr(f.path)}), { filename: ${rbStr(baseName(f.path))} }],`
        : `${indent}[${rbStr(f.key)}, ${rbStr(f.value)}],`,
    );
    out.push(`request.set_form([\n${rows.join('\n')}\n], 'multipart/form-data')`);
  } else if (b?.kind === 'binary') out.push(`request.body = File.binread(${rbStr(b.path)})`);
  out.push('', 'response = http.request(request)', 'puts response.code', 'puts response.body');
  return out.join('\n');
}

/* ---------- Rust ---------- */

function genRust(r, { indent }) {
  const b = r.body;
  const i2 = indent.repeat(2);
  const features = ['reqwest = "0.12"'];
  const pre = [];
  const chain = [`${indent}let response = client`];
  const method = STANDARD_METHODS.includes(r.method)
    ? `reqwest::Method::${r.method}`
    : `reqwest::Method::from_bytes(${rustStr(r.method)}.as_bytes())?`;
  chain.push(`${i2}.request(${method}, ${rustStr(r.url)})`);
  for (const h of r.headers) chain.push(`${i2}.header(${rustStr(h.key)}, ${rustStr(h.value)})`);
  if (b?.kind === 'text') chain.push(`${i2}.body(${rustText(b.text)})`);
  else if (b?.kind === 'urlencoded') chain.push(`${i2}.body(${rustStr(b.encoded)})`);
  else if (b?.kind === 'binary') chain.push(`${i2}.body(std::fs::read(${rustStr(b.path)})?)`);
  else if (b?.kind === 'form') {
    features[0] = 'reqwest = { version = "0.12", features = ["multipart"] }';
    pre.push(`${indent}let form = reqwest::multipart::Form::new()`);
    for (const f of b.fields) {
      if (f.kind === 'file') {
        const part = `reqwest::multipart::Part::bytes(std::fs::read(${rustStr(f.path)})?).file_name(${rustStr(baseName(f.path))})`;
        pre.push(`${i2}.part(${rustStr(f.key)}, ${part})`);
      } else pre.push(`${i2}.text(${rustStr(f.key)}, ${rustStr(f.value)})`);
    }
    pre[pre.length - 1] += ';';
    pre.push('');
    chain.push(`${i2}.multipart(form)`);
  }
  chain.push(`${i2}.send()`, `${i2}.await?;`);
  return [
    `// Cargo.toml: ${features[0]}, tokio = { version = "1", features = ["full"] }`,
    '#[tokio::main]',
    'async fn main() -> Result<(), Box<dyn std::error::Error>> {',
    `${indent}let client = reqwest::Client::new();`,
    '',
    ...pre,
    ...chain,
    '',
    `${indent}println!("{}", response.status());`,
    `${indent}println!("{}", response.text().await?);`,
    `${indent}Ok(())`,
    '}',
  ].join('\n');
}

/* ---------- Swift ---------- */

function genSwift(r) {
  const b = r.body;
  const out = ['import Foundation', '#if canImport(FoundationNetworking)', 'import FoundationNetworking', '#endif', ''];
  out.push(`var request = URLRequest(url: URL(string: ${swiftStr(r.url)})!)`, `request.httpMethod = ${swiftStr(r.method)}`);
  const headers = [...r.headers];
  if (b?.kind === 'form') headers.push({ key: 'Content-Type', value: `multipart/form-data; boundary=${BOUNDARY}` });
  for (const h of headers) out.push(`request.addValue(${swiftStr(h.value)}, forHTTPHeaderField: ${swiftStr(h.key)})`);
  if (b?.kind === 'text') out.push(`request.httpBody = Data(${swiftStr(b.text)}.utf8)`);
  else if (b?.kind === 'urlencoded') out.push(`request.httpBody = Data(${swiftStr(b.encoded)}.utf8)`);
  else if (b?.kind === 'binary') out.push(`request.httpBody = try Data(contentsOf: URL(fileURLWithPath: ${swiftStr(b.path)}))`);
  else if (b?.kind === 'form') {
    out.push('', 'var body = Data()');
    for (const seg of multipartSegments(b.fields)) {
      if (seg.type === 'text') out.push(`body.append(Data(${swiftStr(seg.text)}.utf8))`);
      else out.push(`body.append(try Data(contentsOf: URL(fileURLWithPath: ${swiftStr(seg.path)})))`);
    }
    out.push('request.httpBody = body');
  }
  out.push(
    '',
    'let (data, response) = try await URLSession.shared.data(for: request)',
    'print((response as? HTTPURLResponse)?.statusCode ?? 0)',
    'print(String(decoding: data, as: UTF8.self))',
  );
  return out.join('\n');
}

/* ---------- PowerShell ---------- */

const PS_METHODS = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options', TRACE: 'Trace' };

function genPowershell(r, { indent }) {
  const b = r.body;
  const out = [];
  const args = [`-Uri ${psStr(r.url)}`];
  args.push(PS_METHODS[r.method] ? `-Method ${PS_METHODS[r.method]}` : `-CustomMethod ${psStr(r.method)}`);
  // Content-Type goes in -ContentType; the cmdlet manages it for bodies.
  const headers = mergedHeaders(r.headers.filter((h) => !isContentType(h.key)));
  const ct = contentTypeOf(r);
  if (headers.length) {
    out.push('$headers = @{', ...headers.map((h) => `${indent}${psStr(h.key)} = ${psStr(h.value)}`), '}');
    args.push('-Headers $headers');
  }
  if (b?.kind === 'text') {
    out.push(`$body = ${psStr(b.text)}`);
    args.push('-Body $body');
  } else if (b?.kind === 'urlencoded') {
    out.push(`$body = ${psStr(b.encoded)}`);
    args.push('-Body $body');
  } else if (b?.kind === 'form') {
    // Hash literal keys are unique (ignoring case); repeated names become one key with several values.
    const groups = [];
    for (const f of b.fields) {
      const g = groups.find((x) => x.key.toLowerCase() === f.key.toLowerCase());
      if (g) g.fields.push(f);
      else groups.push({ key: f.key, fields: [f] });
    }
    const value = (f) => (f.kind === 'file' ? `Get-Item -Path ${psStr(f.path)}` : psStr(f.value));
    const rows = groups.map((g) => `${indent}${psStr(g.key)} = ${g.fields.length > 1 ? `@(${g.fields.map((f) => (f.kind === 'file' ? `(${value(f)})` : value(f))).join(', ')})` : value(g.fields[0])}`);
    out.push('$form = @{', ...rows, '}');
    args.push('-Form $form');
  } else if (b?.kind === 'binary') args.push(`-InFile ${psStr(b.path)}`);
  if (ct && b?.kind !== 'form') args.push(`-ContentType ${psStr(ct)}`);
  if (out.length) out.push('');
  out.push(`$response = Invoke-RestMethod ${args.join(' ')}`, '$response');
  return out.join('\n');
}
