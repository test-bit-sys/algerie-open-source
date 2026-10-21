/**
 * Imports a curl command line into a partial request (see normalizeRequest).
 * Handles POSIX shell quoting ('...', "...", $'...', backslash escapes),
 * Windows cmd caret escapes, PowerShell quoting (backtick escapes) and line
 * continuations in bash, cmd and PowerShell style. Files referenced with @path cannot be read here, so they
 * become file placeholders that only carry the base name.
 */
import { pair, formField, emptyBody, emptyAuth } from './model.js';
import { paramsFromUrl, splitUrl, syncPathVars } from './url.js';

const PROMPT_RE = /^\s*(?:\$|>|PS [^>]*>)\s+/;
const CURL_RE = /^curl(?:\.exe)?(?:\s|$)/i;

/** True when the text looks like a curl command (optionally after a "$ " prompt). */
export function looksLikeCurl(text) {
  if (typeof text !== 'string') return false;
  return CURL_RE.test(text.trim().replace(PROMPT_RE, ''));
}

// Short options that take an argument; every other letter is a switch.
const SHORT_WITH_ARG = {
  A: 'user-agent',
  b: 'cookie',
  c: 'cookie-jar',
  C: 'continue-at',
  d: 'data',
  D: 'dump-header',
  e: 'referer',
  E: 'cert',
  F: 'form',
  H: 'header',
  K: 'config',
  m: 'max-time',
  o: 'output',
  P: 'ftp-port',
  Q: 'quote',
  r: 'range',
  t: 'telnet-option',
  T: 'upload-file',
  u: 'user',
  U: 'proxy-user',
  w: 'write-out',
  x: 'proxy',
  X: 'request',
  y: 'speed-time',
  Y: 'speed-limit',
  z: 'time-cond',
};
const SHORT_SWITCHES = { G: 'get', I: 'head' };
// Auth schemes for --user that this app does not have; the credentials are imported as Basic auth.
const OTHER_AUTH = { digest: 'Digest', ntlm: 'NTLM', negotiate: 'Negotiate' };

// Long options that take an argument (only their argument needs skipping when ignored).
const LONG_WITH_ARG = new Set([
  ...Object.values(SHORT_WITH_ARG),
  'data-raw', 'data-binary', 'data-ascii', 'data-urlencode', 'json', 'form-string', 'url', 'url-query', 'oauth2-bearer',
  'abstract-unix-socket', 'alt-svc', 'aws-sigv4', 'cacert', 'capath', 'cert-type', 'ciphers', 'connect-timeout', 'connect-to',
  'crlfile', 'curves', 'delegation', 'dns-interface', 'dns-ipv4-addr', 'dns-ipv6-addr', 'dns-servers', 'doh-url', 'egd-file',
  'engine', 'etag-compare', 'etag-save', 'expect100-timeout', 'ftp-account', 'ftp-alternative-to-user', 'ftp-method',
  'ftp-ssl-ccc-mode', 'happy-eyeballs-timeout-ms', 'haproxy-clientip', 'hostpubmd5', 'hostpubsha256', 'hsts', 'interface',
  'ip-tos', 'keepalive-time', 'key', 'key-type', 'krb', 'libcurl', 'limit-rate', 'local-port', 'login-options', 'mail-auth',
  'mail-from', 'mail-rcpt', 'max-filesize', 'max-redirs', 'netrc-file', 'noproxy', 'output-dir', 'parallel-max', 'pass',
  'pinnedpubkey', 'preproxy', 'proto', 'proto-default', 'proto-redir', 'proxy-cacert', 'proxy-capath', 'proxy-cert',
  'proxy-cert-type', 'proxy-ciphers', 'proxy-crlfile', 'proxy-header', 'proxy-key', 'proxy-key-type', 'proxy-pass',
  'proxy-pinnedpubkey', 'proxy-service-name', 'proxy-tls13-ciphers', 'proxy-tlsauthtype', 'proxy-tlspassword',
  'proxy-tlsuser', 'proxy1.0', 'pubkey', 'random-file', 'rate', 'request-target', 'resolve', 'retry', 'retry-delay',
  'retry-max-time', 'sasl-authzid', 'service-name', 'socks4', 'socks4a', 'socks5', 'socks5-gssapi-service', 'socks5-hostname',
  'stderr', 'tls-max', 'tls13-ciphers', 'tlsauthtype', 'tlspassword', 'tlsuser', 'trace', 'trace-ascii', 'trace-config',
  'unix-socket', 'variable', 'write-out', 'keepalive-cnt', 'ech', 'vlan-priority', 'ssl-sessions', 'upload-flags', 'knownhosts',
]);

/**
 * Parses a curl command. Returns { method, url, headers, params, body, auth,
 * warnings } with rows built by the model factories, or throws an Error
 * explaining why the text could not be read. Only the first command is read
 * when several are joined with ; & && or |.
 */
export function parseCurl(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Paste a curl command to import.');
  const source = text.trim().replace(PROMPT_RE, '');
  if (!CURL_RE.test(source)) throw new Error('Not a curl command: the text should start with "curl".');

  const tokenize = isCmdStyle(source) ? tokenizeCmd : isPowerShell(text.trim(), source) ? tokenizePowerShell : tokenizePosix;
  const { tokens, rest } = tokenize(source);
  const warnings = [];
  if (/(^|[\s;&|])curl(\.exe)?\s/i.test(rest)) warnings.push('The text has more than one curl command; only the first one was imported.');
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) throw new Error('Not a curl command: the text should start with "curl".');

  const st = {
    method: '',
    url: '',
    positionals: [],
    headers: [],
    data: [], // { text, json, file }
    form: [],
    get: false,
    head: false,
    user: null,
    bearer: null,
    awsSigv4: null,
    upload: null,
    urlQuery: [],
    jsonFlag: false,
    cookieRow: null,
    otherAuth: null,
    warnings,
  };

  let i = 1;
  const next = (name) => {
    if (i >= tokens.length) throw new Error(`The curl option ${name} needs a value.`);
    return tokens[i++];
  };

  let endOfOptions = false;
  while (i < tokens.length) {
    const tok = tokens[i++];
    if (endOfOptions || tok === '-' || !tok.startsWith('-')) {
      st.positionals.push(tok);
      continue;
    }
    if (tok === '--') {
      endOfOptions = true;
      continue;
    }
    if (tok.startsWith('--')) {
      // --expand-X is option X with curl's {{variable}} expansion, which reads like this app's variables.
      const name = tok.slice(2).replace(/^expand-/, '');
      if (handlesOption(name)) applyOption(st, name, next(tok));
      else if (name === 'get' || name === 'head') applyOption(st, name, '');
      else if (LONG_WITH_ARG.has(name)) next(tok);
      else if (Object.hasOwn(OTHER_AUTH, name) || name === 'basic') st.otherAuth = OTHER_AUTH[name] || null;
      // Anything else is a switch that does not change the request (-L, --compressed, --insecure, ...).
      continue;
    }
    // Short options, possibly combined (-sSL, -XPOST, -sX POST).
    for (let j = 1; j < tok.length; j++) {
      const letter = tok[j];
      if (SHORT_SWITCHES[letter]) {
        applyOption(st, SHORT_SWITCHES[letter], '');
        continue;
      }
      const long = SHORT_WITH_ARG[letter];
      if (!long) continue;
      const value = j + 1 < tok.length ? tok.slice(j + 1) : next(`-${letter}`);
      if (handlesOption(long)) applyOption(st, long, value);
      break;
    }
  }

  return { ...buildRequest(st), warnings };
}

const HANDLED = new Set([
  'request', 'header', 'data', 'data-ascii', 'data-binary', 'data-raw', 'data-urlencode', 'json', 'form', 'form-string', 'user',
  'user-agent', 'cookie', 'referer', 'url', 'upload-file', 'oauth2-bearer', 'url-query', 'aws-sigv4',
]);

function handlesOption(name) {
  return HANDLED.has(name);
}

function applyOption(st, name, value) {
  switch (name) {
    case 'request':
      st.method = value.trim().toUpperCase();
      break;
    case 'header':
      addHeaderLine(st, value);
      break;
    case 'data':
    case 'data-ascii':
    case 'data-binary':
      st.data.push(value.startsWith('@') ? { text: value, file: value.slice(1) } : { text: value });
      break;
    case 'data-raw':
      st.data.push({ text: value });
      break;
    case 'data-urlencode':
      st.data.push({ text: encodeDataUrlencode(value) });
      break;
    case 'json':
      st.jsonFlag = true;
      st.data.push(value.startsWith('@') ? { text: value, file: value.slice(1), json: true } : { text: value, json: true });
      break;
    case 'form':
    case 'form-string': {
      const field = parseFormArg(value, name === 'form-string', st.warnings);
      if (field) st.form.push(field);
      break;
    }
    case 'user': {
      const colon = value.indexOf(':');
      st.user = colon < 0 ? { username: value, password: '' } : { username: value.slice(0, colon), password: value.slice(colon + 1) };
      break;
    }
    case 'oauth2-bearer':
      st.bearer = value;
      break;
    case 'aws-sigv4':
      st.awsSigv4 = value;
      break;
    case 'user-agent':
      st.headers.push(pair('User-Agent', value));
      break;
    case 'referer':
      st.headers.push(pair('Referer', value.replace(/;auto$/, '')));
      break;
    case 'cookie':
      // A value without "=" names a cookie file, which we cannot read.
      if (!value.includes('=')) break;
      if (st.cookieRow) st.cookieRow.value += `; ${value}`;
      else {
        st.cookieRow = pair('Cookie', value);
        st.headers.push(st.cookieRow);
      }
      break;
    case 'url':
      if (!st.url) st.url = value;
      break;
    case 'upload-file':
      st.upload = value;
      break;
    case 'url-query':
      st.urlQuery.push(value.startsWith('+') ? value.slice(1) : encodeDataUrlencode(value));
      break;
    case 'get':
      st.get = true;
      break;
    case 'head':
      st.head = true;
      break;
    default:
      break;
  }
}

function addHeaderLine(st, line) {
  if (line.startsWith('@')) return; // headers from a file
  const colon = line.indexOf(':');
  const semi = line.indexOf(';');
  // "Name;" sends an empty header; "Name:" with no value only removes a default one.
  if (colon < 0) {
    if (semi > 0 && line.slice(semi + 1).trim() === '') st.headers.push(pair(line.slice(0, semi).trim(), ''));
    return;
  }
  const key = line.slice(0, colon).trim();
  const value = line.slice(colon + 1).trim();
  if (!key || value === '') return;
  st.headers.push(pair(key, value));
}

function buildRequest(st) {
  let url = st.url || st.positionals.find((p) => /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) || st.positionals[0] || '';
  if (!url) throw new Error('No URL found in the curl command.');

  const headers = st.headers;
  const findHeader = (name) => headers.find((h) => h.key.toLowerCase() === name);
  if (st.jsonFlag) {
    if (!findHeader('content-type')) headers.push(pair('Content-Type', 'application/json'));
    if (!findHeader('accept')) headers.push(pair('Accept', 'application/json'));
  }

  // Join data the way curl does: "&" between -d values, nothing between --json values.
  let dataText = '';
  st.data.forEach((d, idx) => {
    dataText += (idx > 0 && !(d.json && st.data[idx - 1].json) ? '&' : '') + d.text;
  });

  if (st.urlQuery.length) url = appendQuery(url, st.urlQuery.join('&'));
  const hasData = st.data.length > 0;
  if (st.get && hasData) url = appendQuery(url, dataText);
  const sendsData = hasData && !st.get;

  let method = st.method;
  if (!method) {
    if (st.head) method = 'HEAD';
    else if (st.get) method = 'GET';
    else if (st.upload) method = 'PUT';
    else if (sendsData || st.form.length) method = 'POST';
    else method = 'GET';
  }

  const body = emptyBody();
  const contentType = (findHeader('content-type')?.value || '').toLowerCase();
  if (st.form.length) {
    body.mode = 'form';
    body.form = st.form;
    // The boundary in a copied multipart header would not match the new body.
    const ct = findHeader('content-type');
    if (ct && /multipart\//i.test(ct.value)) headers.splice(headers.indexOf(ct), 1);
  } else if (st.upload || (sendsData && st.data.length === 1 && st.data[0].file)) {
    body.mode = 'binary';
    body.binary = { ref: '', name: basename(st.upload || st.data[0].file), size: 0, type: contentType.split(';')[0].trim() };
  } else if (sendsData) {
    Object.assign(body, detectDataBody(dataText, contentType));
  }

  const auth = emptyAuth('none');
  if (st.awsSigv4 != null) {
    // "provider1[:provider2[:region[:service]]]", signed with the access key and secret from --user.
    const [, , region, service] = st.awsSigv4.split(':');
    auth.type = 'awsv4';
    auth.awsv4 = { ...auth.awsv4, accessKey: st.user?.username || '', secretKey: st.user?.password || '', region: region || auth.awsv4.region, service: service || '' };
  } else if (st.user) {
    auth.type = 'basic';
    auth.basic = { ...st.user };
    if (st.otherAuth) st.warnings.push(`The command uses ${st.otherAuth} authentication, which is not supported; its credentials were imported as Basic auth.`);
  } else if (st.bearer != null) {
    auth.type = 'bearer';
    auth.bearer = { token: st.bearer };
  }

  return { method, url, headers, params: paramsFromUrl(url), pathVars: syncPathVars(url), body, auth };
}

function detectDataBody(text, contentType) {
  const raw = (rawType) => ({ mode: 'raw', raw: text, rawType });
  if (contentType) {
    if (contentType.includes('json')) return raw('json');
    if (contentType.includes('x-www-form-urlencoded')) return { mode: 'urlencoded', urlencoded: parseUrlencoded(text) };
    if (contentType.includes('xml')) return raw('xml');
    if (contentType.includes('html')) return raw('html');
    if (contentType.includes('javascript')) return raw('javascript');
    return raw('text');
  }
  if (isJsonDocument(text)) return raw('json');
  if (looksUrlencoded(text)) return { mode: 'urlencoded', urlencoded: parseUrlencoded(text) };
  return raw('text');
}

function isJsonDocument(text) {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function looksUrlencoded(text) {
  if (!text || /[\r\n]/.test(text)) return false;
  const parts = text.split('&');
  return parts.every((p) => /^[^=&\s]+(=[^&]*)?$/.test(p)) && parts.some((p) => p.includes('='));
}

function parseUrlencoded(text) {
  if (!text) return [];
  return text
    .split('&')
    .filter((p) => p !== '')
    .map((part) => {
      const eq = part.indexOf('=');
      return eq < 0 ? pair(decodeFormComponent(part), '') : pair(decodeFormComponent(part.slice(0, eq)), decodeFormComponent(part.slice(eq + 1)));
    });
}

function decodeFormComponent(s) {
  const spaced = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** Percent-encodes like curl_easy_escape: everything except unreserved characters. */
function curlEscape(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// --data-urlencode forms: "content", "=content", "name=content", "@file", "name@file".
function encodeDataUrlencode(value) {
  // Like curl: an = anywhere wins over @, so user@x=1 is the field "user@x".
  const eq = value.indexOf('=');
  const at = eq >= 0 ? eq : value.indexOf('@');
  if (at < 0) return curlEscape(value);
  if (value[at] === '=') return at === 0 ? curlEscape(value.slice(1)) : `${value.slice(0, at)}=${curlEscape(value.slice(at + 1))}`;
  return at === 0 ? value : `${value.slice(0, at)}=${value.slice(at)}`; // file content: kept as a reference
}

function appendQuery(url, query) {
  if (!query) return url;
  const { base, query: existing, hash } = splitUrl(url);
  return `${base}?${existing ? `${existing}&` : ''}${query}${hash}`;
}

function basename(path) {
  const clean = String(path).trim().replace(/^["']|["']$/g, '');
  return clean.split(/[\\/]/).pop() || clean;
}

/** -F name=value, name=@file;type=x;filename=y, name=<file (the file's content as text), name="quoted;value". */
function parseFormArg(arg, literal, warnings) {
  const eq = arg.indexOf('=');
  if (eq < 0) return null;
  const name = arg.slice(0, eq);
  let rest = arg.slice(eq + 1);
  if (literal) return formField(name, rest);

  let prefix = '';
  if (rest[0] === '@' || rest[0] === '<') {
    prefix = rest[0];
    rest = rest.slice(1);
  }
  let value;
  let params;
  if (rest[0] === '"') {
    let j = 1;
    value = '';
    while (j < rest.length && rest[j] !== '"') {
      if (rest[j] === '\\' && j + 1 < rest.length) {
        value += rest[j + 1];
        j += 2;
      } else value += rest[j++];
    }
    params = rest.slice(j + 1);
  } else {
    const m = rest.match(/;\s*(type|filename|headers|encoder)=/i);
    value = m ? rest.slice(0, m.index) : rest;
    params = m ? rest.slice(m.index) : '';
  }

  const opts = {};
  const re = /;\s*(type|filename|headers|encoder)=("(?:[^"\\]|\\.)*"|[^;]*)/gi;
  let m;
  while ((m = re.exec(params))) {
    let v = m[2];
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    opts[m[1].toLowerCase()] = v.trim();
  }

  if (!prefix) return formField(name, value);
  if (prefix === '<') {
    warnings.push(`The form field "${name}" takes its value from the file ${value}, which cannot be read here; fill it in.`);
    return formField(name, '');
  }
  return formField(name, '', {
    kind: 'file',
    file: { ref: '', name: opts.filename || basename(value), size: 0, type: opts.type || '' },
  });
}

/* ---------- tokenizers ---------- */

function isCmdStyle(text) {
  // Only cmd's ^ escapes outside POSIX single quotes count: '{"re":"^"}' is a bash body, not cmd syntax.
  // $'...' strings may contain \' so they go first, and cmd's ^" starts a word ("re=^" is bash).
  const outside = text.replace(/\$'(?:[^'\\]|\\.)*'/g, "''").replace(/'[^']*'/g, "''");
  return /(^|\s)\^"/.test(outside) || /\^[ \t]*\r?\n/.test(outside);
}

// A PS prompt, a backtick continuing a line, or curl.exe (curl alone is Invoke-WebRequest in Windows
// PowerShell) with PowerShell quoting: curl.exe also runs in cmd, where "{\"a\":1}" is the usual form.
function isPowerShell(text, source) {
  if (/^\s*PS [^>]*>/.test(text)) return true;
  if (/`[ \t]*\r?\n/.test(source.replace(/'[^']*'/g, "''"))) return true;
  return /^curl\.exe(\s|$)/i.test(source) && (source.includes('`') || /(^|\s)'/.test(source));
}

// Length of a line continuation starting at i (marker, optional blanks, newline), or 0.
function continuationAt(text, i) {
  let j = i + 1;
  while (text[j] === ' ' || text[j] === '\t') j++;
  if (text[j] === '\r' && text[j + 1] === '\n') return j + 2 - i;
  if (text[j] === '\n') return j + 1 - i;
  return 0;
}

const isBlank = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

function tokenizePosix(text) {
  const tokens = [];
  let rest = '';
  let cur = '';
  let has = false;
  let i = 0;
  const n = text.length;
  const push = () => {
    if (has) tokens.push(cur);
    cur = '';
    has = false;
  };

  while (i < n) {
    const c = text[i];
    if (isBlank(c)) {
      push();
      i++;
      continue;
    }
    if (c === '\\' || c === '`' || c === '^') {
      const len = continuationAt(text, i);
      if (len) {
        i += len;
        continue;
      }
    }
    // Stop at pipes and command separators, even inside a word (url;). A single & ends the command only before
    // a blank: in a pasted URL (?a=1&b=2) it is almost always meant as part of the query.
    if (c === '|' || c === ';' || (c === '&' && (text[i + 1] === '&' || i + 1 === n || isBlank(text[i + 1])))) {
      rest = text.slice(i);
      break;
    }
    if (!has) {
      // Skip comments.
      if (c === '#') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
    }
    has = true;
    if (c === '\\') {
      if (i + 1 < n) cur += text[i + 1];
      i += 2;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new Error('Unterminated single quote in the curl command.');
      cur += text.slice(i + 1, end);
      i = end + 1;
    } else if (c === '$' && text[i + 1] === "'") {
      const res = readAnsiC(text, i + 2);
      cur += res.value;
      i = res.end;
    } else if (c === '"') {
      i++;
      let closed = false;
      while (i < n) {
        const d = text[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && i + 1 < n) {
          const e = text[i + 1];
          if (e === '\n') i += 2;
          else if (e === '\r' && text[i + 2] === '\n') i += 3;
          else if (e === '"' || e === '\\' || e === '$' || e === '`') {
            cur += e;
            i += 2;
          } else {
            cur += d;
            i++;
          }
          continue;
        }
        cur += d;
        i++;
      }
      if (!closed) throw new Error('Unterminated double quote in the curl command.');
    } else {
      cur += c;
      i++;
    }
  }
  push();
  return { tokens, rest };
}

const PS_ESCAPES = { 0: '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

/**
 * PowerShell: '...' is literal ('' is a quote), "..." and bare words take
 * backtick escapes (`" `n ...), and "" inside "..." is a quote. curl.exe then
 * reads \" as a quote, as the C runtime does, which is how commands written
 * for Windows PowerShell pass JSON ('{\"name\":\"a\"}').
 */
function tokenizePowerShell(text) {
  const tokens = [];
  let rest = '';
  let cur = '';
  let has = false;
  let i = 0;
  const n = text.length;
  const push = () => {
    if (has) tokens.push(cur.replace(/(\\+)"/g, (m, bs) => (bs.length % 2 ? `${'\\'.repeat(bs.length >> 1)}"` : m)));
    cur = '';
    has = false;
  };
  const escape = () => {
    const e = text[i + 1] ?? '';
    cur += PS_ESCAPES[e] ?? e;
    i += 2;
  };

  while (i < n) {
    const c = text[i];
    if (isBlank(c)) {
      push();
      i++;
      continue;
    }
    if (c === '`') {
      const len = continuationAt(text, i);
      if (len) {
        i += len;
        continue;
      }
    }
    if (c === '|' || c === ';' || (c === '&' && (text[i + 1] === '&' || i + 1 === n || isBlank(text[i + 1])))) {
      rest = text.slice(i);
      break;
    }
    if (!has && c === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    has = true;
    if (c === '`') escape();
    else if (c === "'" || c === '"') {
      i++;
      for (;;) {
        if (i >= n) throw new Error(`Unterminated ${c === "'" ? 'single' : 'double'} quote in the curl command.`);
        const d = text[i];
        if (d === '`' && c === '"') escape();
        else if (d === c && text[i + 1] === c) {
          cur += c;
          i += 2;
        } else if (d === c) {
          i++;
          break;
        } else {
          cur += d;
          i++;
        }
      }
    } else {
      cur += c;
      i++;
    }
  }
  push();
  return { tokens, rest };
}

const ANSI_SIMPLE = {
  a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?',
};

function readAnsiC(text, start) {
  let i = start;
  let value = '';
  while (i < text.length) {
    const c = text[i];
    if (c === "'") return { value, end: i + 1 };
    if (c !== '\\') {
      value += c;
      i++;
      continue;
    }
    const e = text[i + 1];
    if (e in ANSI_SIMPLE) {
      value += ANSI_SIMPLE[e];
      i += 2;
    } else if (e === 'x' || e === 'u' || e === 'U') {
      const max = e === 'x' ? 2 : e === 'u' ? 4 : 8;
      const m = text.slice(i + 2, i + 2 + max).match(/^[0-9a-fA-F]+/);
      if (m) {
        value += String.fromCodePoint(parseInt(m[0], 16));
        i += 2 + m[0].length;
      } else {
        value += `\\${e}`;
        i += 2;
      }
    } else if (/[0-7]/.test(e)) {
      const m = text.slice(i + 1, i + 4).match(/^[0-7]+/);
      value += String.fromCharCode(parseInt(m[0], 8) & 0xff);
      i += 1 + m[0].length;
    } else if (e === 'c' && i + 2 < text.length) {
      value += String.fromCharCode(text.charCodeAt(i + 2) & 0x1f);
      i += 3;
    } else {
      value += c + (e ?? '');
      i += 2;
    }
  }
  throw new Error("Unterminated $'...' string in the curl command.");
}

/**
 * Windows cmd: carets escape the next character (^" is a literal quote and a
 * caret at the end of a line continues it), and & or | outside quotes ends the
 * command. Then curl.exe splits arguments with the C runtime rules: double
 * quotes group, backslashes escape quotes.
 */
function tokenizeCmd(text) {
  let unescaped = '';
  let rest = '';
  let cmdQuoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!cmdQuoted && (c === '&' || c === '|')) {
      rest = text.slice(i);
      break;
    }
    if (c === '"') cmdQuoted = !cmdQuoted;
    if (c === '^') {
      const len = continuationAt(text, i);
      if (len) {
        i += len - 1;
        continue;
      }
      if (i + 1 < text.length) unescaped += text[++i];
      continue;
    }
    unescaped += c;
  }

  const tokens = [];
  let cur = '';
  let has = false;
  let quoted = false;
  let i = 0;
  while (i < unescaped.length) {
    const c = unescaped[i];
    if (!quoted && isBlank(c)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
      i++;
      continue;
    }
    has = true;
    if (c === '\\') {
      let count = 0;
      while (unescaped[i] === '\\') {
        count++;
        i++;
      }
      if (unescaped[i] === '"') {
        cur += '\\'.repeat(Math.floor(count / 2));
        if (count % 2) {
          cur += '"';
          i++;
        }
      } else cur += '\\'.repeat(count);
      continue;
    }
    if (c === '"') {
      if (quoted && unescaped[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      quoted = !quoted;
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (has) tokens.push(cur);
  return { tokens, rest };
}
