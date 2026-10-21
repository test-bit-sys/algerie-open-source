/** Small helpers shared by the importers and exporters. */
import { RAW_CONTENT_TYPES } from '../model.js';

const SafeYAML = globalThis.YAML || {
  parse(str) {
    try {
      return JSON.parse(str);
    } catch {
      // Basic key-value YAML parser for common collections
      const lines = str.split('\n');
      const res = {};
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf(':');
        if (idx !== -1) {
          const k = trimmed.slice(0, idx).trim();
          let v = trimmed.slice(idx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          res[k] = v;
        }
      }
      return Object.keys(res).length > 0 ? res : undefined;
    }
  }
};

export const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
export const arr = (v) => (Array.isArray(v) ? v : []);

/** Any scalar or structure as text; objects become JSON. */
export function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Descriptions may be plain strings or { content } objects. */
export function description(d) {
  if (typeof d === 'string') return d;
  if (isObj(d)) return text(d.content);
  return '';
}

/**
 * Parses JSON or YAML text into a value. Returns undefined when the text is
 * neither, so callers can try other readings (such as a curl command);
 * onError then receives the YAML reader's error.
 */
export function parseStructured(input, onError) {
  if (typeof input !== 'string') return input;
  const t = input.replace(/^\uFEFF/, '').trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    // fall through to YAML
  }
  try {
    return SafeYAML.parse(t, { maxAliasCount: 1000, merge: true, uniqueKeys: false });
  } catch (err) {
    onError?.(err);
    return undefined;
  }
}

/** Maps a media type to a raw body type, or null when it is not a text type. */
export function rawTypeFromMime(mime = '') {
  const m = String(mime).toLowerCase().split(';')[0].trim();
  if (!m) return null;
  if (m === 'application/json' || m.endsWith('+json') || m.endsWith('/json')) return 'json';
  if (m === 'application/xml' || m === 'text/xml' || m.endsWith('+xml')) return 'xml';
  if (m === 'text/html') return 'html';
  if (m.includes('javascript') || m === 'text/ecmascript') return 'javascript';
  if (m.startsWith('text/') || m.includes('yaml') || m === 'application/graphql') return 'text';
  return null;
}

/** True when a raw body of this type needs an explicit Content-Type header. */
export function needsContentType(mime, rawType) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  return !!m && RAW_CONTENT_TYPES[rawType] !== m;
}

/** Guesses the raw type of body text with no declared type. */
export function guessRawType(body) {
  const t = String(body || '').trim();
  if (!t) return 'text';
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      // not JSON
    }
  }
  if (/^<\?xml|^<[A-Za-z][\w:-]*[\s>]/.test(t)) return /^<!doctype html|^<html/i.test(t) ? 'html' : 'xml';
  return 'text';
}

export function pretty(value) {
  return JSON.stringify(value, null, 2);
}

/** Collects warnings once each. */
export function warningList() {
  const list = [];
  return {
    list,
    add(msg) {
      if (msg && !list.includes(msg)) list.push(msg);
    },
  };
}

export function header(headers, name) {
  const lower = name.toLowerCase();
  return arr(headers).find((h) => String(h?.key ?? h?.name ?? '').toLowerCase() === lower);
}
