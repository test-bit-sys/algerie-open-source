/**
 * URL text helpers. The URL box holds what the user typed, variables and all,
 * so these work on strings rather than URL objects. Query values are kept as
 * written (not decoded) so editing a parameter never rewrites the rest.
 */
import { pair } from './model.js';

/** Splits "base?query#hash" at the first ? and the first # after it. */
export function splitUrl(url = '') {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const q = beforeHash.indexOf('?');
  if (q < 0) return { base: beforeHash, query: null, hash };
  return { base: beforeHash.slice(0, q), query: beforeHash.slice(q + 1), hash };
}

/** Query string -> [{ key, value }] in order, values as written. */
export function parseQueryString(query) {
  if (query == null || query === '') return [];
  return query.split('&').map((part) => {
    const eq = part.indexOf('=');
    return eq < 0 ? { key: part, value: '', hasValue: false } : { key: part.slice(0, eq), value: part.slice(eq + 1), hasValue: true };
  });
}

export function buildQueryString(list) {
  return list.map((p) => (p.value === '' && p.hasValue === false ? p.key : `${p.key}=${p.value}`)).join('&');
}

/**
 * Reconciles the param table with an edited URL: enabled rows are replaced by
 * the URL's query in order (reusing ids and descriptions where keys line up),
 * disabled rows are kept.
 */
export function paramsFromUrl(url, previous = []) {
  const { query } = splitUrl(url);
  const parsed = parseQueryString(query);
  const enabled = previous.filter((p) => p.enabled);
  const pool = [...enabled];
  const rows = parsed
    .filter((p) => !(p.key === '' && p.value === '' && parsed.length === 1 && query === ''))
    .map((p, i) => {
      let prev = pool.findIndex((x) => x.key === p.key);
      if (prev < 0 && enabled[i] && !parsed.some((q) => q.key === enabled[i].key)) prev = pool.indexOf(enabled[i]);
      const reuse = prev >= 0 ? pool.splice(prev, 1)[0] : null;
      return reuse ? { ...reuse, key: p.key, value: p.value, enabled: true } : pair(p.key, p.value);
    });
  // Keep disabled rows where they were relative to their neighbours: append at end.
  const disabled = previous.filter((p) => !p.enabled);
  return mergeDisabled(previous, rows, disabled);
}

function mergeDisabled(previous, rows, disabled) {
  if (!disabled.length) return rows;
  const out = [...rows];
  for (const d of disabled) {
    const at = previous.indexOf(d);
    // Count enabled rows that came before it originally.
    const before = previous.slice(0, at).filter((p) => p.enabled).length;
    const pos = Math.min(before + out.slice(0, before + 1).filter((p) => !p.enabled).length, out.length);
    out.splice(pos, 0, d);
  }
  return out;
}

/**
 * Percent-encodes the characters that would end a query key or value early
 * (& and #, plus = in keys), leaving {{variables}} and everything else as typed.
 */
function encodeQueryPart(text, isKey) {
  const special = isKey ? /[&#=]/g : /[&#]/g;
  return text.split(/(\{\{[^{}]*\}\})/).map((part, i) => (i % 2 ? part : part.replace(special, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))).join('');
}

/** Rewrites the URL's query from the enabled param rows. */
export function urlWithParams(url, params) {
  const { base, query, hash } = splitUrl(url);
  const enabled = params.filter((p) => p.enabled && (p.key !== '' || p.value !== ''));
  if (!enabled.length) return base + hash;
  // Keys written without "=" (?flag) stay that way while their value is empty.
  const bare = new Set(parseQueryString(query).filter((p) => !p.hasValue).map((p) => p.key));
  return `${base}?${buildQueryString(enabled.map((p) => {
    const key = encodeQueryPart(p.key, true);
    return { key, value: encodeQueryPart(p.value, false), hasValue: !(p.value === '' && bare.has(key)) };
  }))}${hash}`;
}

/** Path variables written as /:name segments (not ports, not inside {{ }}). */
export function pathVariableNames(url) {
  const { base } = splitUrl(url);
  const withoutScheme = base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = withoutScheme.indexOf('/');
  if (slash < 0) return [];
  const path = withoutScheme.slice(slash).replace(/\{\{[^}]*\}\}/g, '');
  const names = [];
  const re = /\/:([A-Za-z_][\w.-]*)/g;
  let m;
  while ((m = re.exec(path))) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

/**
 * Keeps pathVars in step with the names in the URL, preserving values. With
 * renamed (the URL is being edited), a name being typed (one that extends or
 * shortens the old one, as :id to :idx and back) takes the place and value of
 * the variable at its position when that one's name is gone. A different URL
 * pasted over it starts empty.
 */
export function syncPathVars(url, pathVars = [], { renamed = false } = {}) {
  const names = pathVariableNames(url);
  return names.map((name, i) => {
    const same = pathVars.find((p) => p.key === name);
    if (same) return same;
    const old = renamed ? pathVars[i] : null;
    const typed = old && !names.includes(old.key) && (name.startsWith(old.key) || old.key.startsWith(name));
    return typed ? { ...old, key: name } : pair(name, '');
  });
}

/** Replaces /:name segments with values (already resolved). */
export function applyPathVars(url, values) {
  const { base, query, hash } = splitUrl(url);
  const m = base.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i);
  const origin = m ? m[1] : '';
  const path = m ? m[2] : base;
  const replaced = path.replace(/\/:([A-Za-z_][\w.-]*)/g, (whole, name) => (values.has(name) ? `/${encodePathSegment(values.get(name))}` : whole));
  return origin + replaced + (query != null ? `?${query}` : '') + hash;
}

function encodePathSegment(v) {
  return String(v).replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@%]/g, (c) => encodeURIComponent(c));
}

/** Adds a scheme when missing: http for local and private-network hosts, https otherwise. */
export function withScheme(url) {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return (isPrivateHost(hostOf(trimmed)) ? 'http://' : 'https://') + trimmed;
}

/** Host name of a scheme-less URL: "[::1]:80/x" -> "[::1]", "a.b:1?x" -> "a.b". */
export function hostOf(text) {
  const authority = text.split(/[/?#]/)[0].replace(/^[^@]*@/, '');
  if (authority.startsWith('[')) return authority.slice(0, authority.indexOf(']') + 1);
  return authority.replace(/:\d*$/, '');
}

/**
 * Percent-encodes characters that are not valid in a URL while leaving valid
 * escapes and reserved characters alone, so "a b" becomes "a%20b" but
 * "%20" and "&" stay as they are.
 */
export function encodeUrlText(url) {
  // The u flag matches emoji and other astral characters whole, not as two halves.
  return url.replace(/%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/gu, (c) => {
    if (c === '%') return '%25';
    try {
      return encodeURIComponent(c);
    } catch {
      return '%EF%BF%BD'; // A lone surrogate: send the replacement character.
    }
  });
}

/** True for loopback, link-local and private-network hosts. */
export function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || h === '0.0.0.0') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  // IPv6 unique-local and link-local ranges (only for literal addresses).
  return h.includes(':') && (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'));
}

/** Short display form of a URL for lists: drops the scheme. */
export function displayUrl(url) {
  return url.replace(/^https?:\/\//i, '');
}
