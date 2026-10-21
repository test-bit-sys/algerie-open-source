/**
 * RFC 6265 cookie jar for requests sent over the raw socket client, where the
 * browser's own cookie store is not involved. Cookies are plain objects:
 *   { name, value, domain, path, expires (ms | null), httpOnly, secure, sameSite, hostOnly, createdAt }
 * SameSite is stored for display but not enforced (every request is "first party" here).
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MAX_COOKIE_BYTES = 4096;
// RFC 6265 5.1.1 delimiters: %x09 / %x20-2F / %x3B-40 / %x5B-60 / %x7B-7E
const DATE_DELIMITERS = /[\x09\x20-\x2f\x3b-\x40\x5b-\x60\x7b-\x7e]+/;

/** Parses a cookie date (RFC 1123, RFC 850, asctime and the usual variants) to ms since epoch, or null. */
export function parseCookieDate(text) {
  let time = null;
  let day = null;
  let month = null;
  let year = null;
  for (const token of String(text).split(DATE_DELIMITERS)) {
    if (!token) continue;
    let m;
    if (time == null && (m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\D|$)/.exec(token))) {
      time = [Number(m[1]), Number(m[2]), Number(m[3])];
    } else if (day == null && (m = /^(\d{1,2})(?:\D|$)/.exec(token))) {
      day = Number(m[1]);
    } else if (month == null && MONTHS.includes(token.slice(0, 3).toLowerCase())) {
      month = MONTHS.indexOf(token.slice(0, 3).toLowerCase());
    } else if (year == null && (m = /^(\d{2,4})(?:\D|$)/.exec(token))) {
      year = Number(m[1]);
    }
  }
  if (year != null && year >= 70 && year <= 99) year += 1900;
  else if (year != null && year >= 0 && year <= 69) year += 2000;
  if (time == null || day == null || month == null || year == null) return null;
  if (day < 1 || day > 31 || year < 1601 || time[0] > 23 || time[1] > 59 || time[2] > 59) return null;
  const ms = Date.UTC(year, month, day, time[0], time[1], time[2]);
  // Reject dates like Feb 31 that Date.UTC would roll over.
  if (new Date(ms).getUTCDate() !== day) return null;
  return ms;
}

function normalizeDomain(domain) {
  let d = String(domain || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.$/, '');
  if (!d) return '';
  if (/[^\x00-\x7f]/.test(d)) {
    try {
      d = new URL(`http://${d}`).hostname;
    } catch {
      return '';
    }
  }
  return d;
}

function isIpAddress(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
}

/** RFC 6265 5.1.3 domain-match. */
export function domainMatch(host, domain) {
  if (host === domain) return true;
  return host.endsWith(`.${domain}`) && !isIpAddress(host);
}

/** RFC 6265 5.1.4 path-match. */
export function pathMatch(requestPath, cookiePath) {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/** RFC 6265 5.1.4 default-path. */
export function defaultPath(pathname) {
  if (!pathname || pathname[0] !== '/') return '/';
  const last = pathname.lastIndexOf('/');
  return last <= 0 ? '/' : pathname.slice(0, last);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function isTrustworthy(url) {
  return url.protocol === 'https:' || url.protocol === 'wss:' || LOOPBACK.has(url.hostname);
}

function normalizeSameSite(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'strict') return 'Strict';
  if (v === 'lax') return 'Lax';
  if (v === 'none') return 'None';
  return null;
}

/**
 * Parses one Set-Cookie value. Returns a cookie whose domain/path are the raw
 * attributes (null when absent; the jar fills them in from the request URL),
 * or null when the value holds no cookie. Max-Age wins over Expires.
 */
export function parseSetCookie(value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const [pair, ...attrs] = value.split(';');
  const eq = pair.indexOf('=');
  // A pair without "=" is a nameless cookie (RFC 6265bis), as browsers do.
  const name = eq < 0 ? '' : pair.slice(0, eq).trim();
  const val = (eq < 0 ? pair : pair.slice(eq + 1)).trim();
  if (!name && !val) return null;
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(name + val)) return null;

  const cookie = { name, value: val, domain: null, path: null, expires: null, maxAge: null, httpOnly: false, secure: false, sameSite: null };
  let expiresAttr = null;
  for (const attr of attrs) {
    const at = attr.indexOf('=');
    const key = (at < 0 ? attr : attr.slice(0, at)).trim().toLowerCase();
    const v = at < 0 ? '' : attr.slice(at + 1).trim();
    if (key === 'expires') {
      const ms = parseCookieDate(v);
      if (ms != null) expiresAttr = ms;
    } else if (key === 'max-age') {
      if (/^-?\d+$/.test(v)) cookie.maxAge = Number(v);
    } else if (key === 'domain') {
      if (v) cookie.domain = normalizeDomain(v) || null;
    } else if (key === 'path') {
      cookie.path = v.startsWith('/') ? v : null;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'samesite') {
      cookie.sameSite = normalizeSameSite(v);
    }
  }
  if (cookie.maxAge != null) cookie.expires = cookie.maxAge <= 0 ? 0 : now + cookie.maxAge * 1000;
  else cookie.expires = expiresAttr;
  return cookie;
}

const keyOf = (c) => `${c.domain}\n${c.path}\n${c.name}`;

function normalizeCookie(c, now = Date.now()) {
  const domain = normalizeDomain(c.domain);
  if (!domain) throw new TypeError('A cookie needs a domain');
  return {
    name: String(c.name ?? ''),
    value: String(c.value ?? ''),
    domain,
    path: typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/',
    expires: Number.isFinite(c.expires) ? c.expires : null,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: normalizeSameSite(c.sameSite),
    hostOnly: Boolean(c.hostOnly),
    createdAt: Number.isFinite(c.createdAt) ? c.createdAt : now,
  };
}

export class CookieJar {
  constructor(cookies = []) {
    this.store = new Map();
    for (const c of cookies) this.set(c);
  }

  /**
   * Stores the Set-Cookie values received for `url`.
   * Returns { accepted: cookie[], rejected: [{ header, reason }] } so the UI can explain dropped cookies.
   */
  setFromResponse(url, setCookieHeaderValues = [], now = Date.now()) {
    const target = url instanceof URL ? url : new URL(url);
    const host = target.hostname.toLowerCase();
    const accepted = [];
    const rejected = [];
    const reject = (header, reason) => rejected.push({ header, reason });
    for (const header of setCookieHeaderValues) {
      const parsed = parseSetCookie(header, now);
      if (!parsed) {
        reject(header, 'Could not parse the cookie');
        continue;
      }
      if (parsed.name.length + parsed.value.length > MAX_COOKIE_BYTES) {
        reject(header, 'Cookie is larger than 4096 bytes');
        continue;
      }
      let domain = host;
      let hostOnly = true;
      if (parsed.domain && parsed.domain !== host) {
        // Single-label domains (com, localhost...) only work as the exact host, which is the host-only case below.
        if (!parsed.domain.includes('.')) {
          reject(header, `Domain "${parsed.domain}" is too broad`);
          continue;
        }
        if (!domainMatch(host, parsed.domain)) {
          reject(header, `Domain "${parsed.domain}" does not match host "${host}"`);
          continue;
        }
        domain = parsed.domain;
        hostOnly = false;
      } else if (parsed.domain && parsed.domain.includes('.') && !isIpAddress(host)) {
        // Domain equal to the host: a domain cookie that also covers subdomains.
        hostOnly = false;
      }
      if (parsed.secure && !isTrustworthy(target)) {
        reject(header, 'Secure cookie set over an insecure connection');
        continue;
      }
      const path = parsed.path ?? defaultPath(target.pathname);
      if (parsed.name.startsWith('__Secure-') && !parsed.secure) {
        reject(header, '__Secure- cookies must be Secure');
        continue;
      }
      if (parsed.name.startsWith('__Host-') && (!parsed.secure || !hostOnly || path !== '/')) {
        reject(header, '__Host- cookies must be Secure, host-only and have Path=/');
        continue;
      }
      const cookie = {
        name: parsed.name,
        value: parsed.value,
        domain,
        path,
        expires: parsed.expires,
        httpOnly: parsed.httpOnly,
        secure: parsed.secure,
        sameSite: parsed.sameSite,
        hostOnly,
        createdAt: now,
      };
      const key = keyOf(cookie);
      const existing = this.store.get(key);
      if (existing) cookie.createdAt = existing.createdAt;
      if (cookie.expires != null && cookie.expires <= now) {
        // An already-expired cookie is how servers delete one.
        this.store.delete(key);
        continue;
      }
      this.store.set(key, cookie);
      accepted.push({ ...cookie });
    }
    return { accepted, rejected };
  }

  /** Cookies that apply to `url`, longest path first, then oldest first. */
  matching(url, now = Date.now()) {
    const target = url instanceof URL ? url : new URL(url);
    const host = target.hostname.toLowerCase();
    const path = target.pathname || '/';
    const secure = isTrustworthy(target);
    this.prune(now);
    const out = [];
    for (const c of this.store.values()) {
      if (c.hostOnly ? host !== c.domain : !domainMatch(host, c.domain)) continue;
      if (!pathMatch(path, c.path)) continue;
      if (c.secure && !secure) continue;
      out.push(c);
    }
    // Map order is insertion order and sort is stable, so equal createdAt keeps arrival order.
    out.sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt);
    return out.map((c) => ({ ...c }));
  }

  /** Value for a Cookie request header ('' when nothing applies). */
  cookieHeader(url, now = Date.now()) {
    return this.matching(url, now)
      .map((c) => (c.name ? `${c.name}=${c.value}` : c.value))
      .join('; ');
  }

  list(now = Date.now()) {
    this.prune(now);
    return [...this.store.values()].map((c) => ({ ...c }));
  }

  /** Adds or replaces a cookie (for manual edits). Returns the stored copy. */
  set(cookie, now = Date.now()) {
    const c = normalizeCookie(cookie, now);
    const key = keyOf(c);
    const existing = this.store.get(key);
    if (existing && !Number.isFinite(cookie.createdAt)) c.createdAt = existing.createdAt;
    this.store.set(key, c);
    return { ...c };
  }

  remove(domain, path, name) {
    return this.store.delete(keyOf({ domain: normalizeDomain(domain), path, name }));
  }

  clearDomain(domain) {
    const d = normalizeDomain(domain);
    let removed = 0;
    for (const [key, c] of this.store) {
      if (c.domain === d) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear() {
    this.store.clear();
  }

  domains() {
    return [...new Set([...this.store.values()].map((c) => c.domain))].sort();
  }

  /** Drops expired cookies; returns how many were removed. */
  prune(now = Date.now()) {
    let removed = 0;
    for (const [key, c] of this.store) {
      if (c.expires != null && c.expires <= now) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size() {
    return this.store.size;
  }

  toJSON() {
    return [...this.store.values()].map((c) => ({ ...c }));
  }

  /** Accepts the output of toJSON (array), { cookies: [...] }, or a JSON string of either. */
  static fromJSON(data) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
    const jar = new CookieJar();
    for (const c of list) {
      try {
        jar.set(c);
      } catch {
        // skip malformed entries
      }
    }
    return jar;
  }
}
