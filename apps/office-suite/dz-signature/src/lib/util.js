/** Shared small utilities. Pure functions only, no DOM and no Puter. */

/** Collision-safe id: time-sortable prefix + 8 random hex chars. */
export function uid() {
  const rand = new Uint8Array(4);
  crypto.getRandomValues(rand);
  let hex = '';
  for (const b of rand) hex += b.toString(16).padStart(2, '0');
  return `${Date.now().toString(36)}${hex}`;
}

/** n crypto-random bytes as lowercase hex. */
export function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(text) {
  return sha256HexBytes(new TextEncoder().encode(String(text)));
}

/** SHA-256 of raw bytes: the fingerprint of a file, not of its name. */
export async function sha256HexBytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * A shareable access code: read out loud, typed back in, so no character that
 * can be mistaken for another (no O/0, I/1/L, S/5, B/8).
 */
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789';

export function randomCode(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  // Rejection-free and unbiased enough for a 27-character alphabet: the bias
  // from 256 % 27 is under 2%, and the code is a second factor, not a key.
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** Codes are compared case- and space-insensitively, here and in the worker. */
export function normalizeCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '').slice(0, 64) : '';
}

/** A valid, normalized email address, or '' if the input isn't one. */
export function normalizeEmail(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : '';
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * "2026-09-04" for a <input type="date">, in the user's OWN calendar day.
 * toISOString() gives the UTC day, which late in the evening west of
 * Greenwich (or early in the morning east of it) is a different day from the
 * one on the wall clock the picker is being read against.
 */
export function localDateString(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A deadline `days` calendar days from `from`, at the end of that day in the
 * user's own time: the last millisecond of the day. Deadlines are counted in
 * calendar days, so "in 7 days" chosen at 10:03 on the 5th means the 12th,
 * not 10:03 on the 12th (at which point the app was already reading
 * "expires in 6 days", and a signer who had "until the 12th" lost the
 * afternoon). Walked in calendar days rather than multiples of 24 hours, so
 * a daylight-saving change on the way does not land it on the wrong day.
 */
export function deadlineInDays(days, from = Date.now()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** "Sep 4, 2026" */
export function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Sep 4, 2026, 2:41 PM" */
export function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function relativeTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return formatDate(ts);
}

/** "142 KB", "1.3 MB" */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** puter.kv values may come back as parsed objects or JSON strings. */
export function coerce(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

/**
 * A non-colliding title for a copy: "Agreement" -> "Agreement (copy)", then
 * "(copy 2)", "(copy 3)". Copying a copy re-uses the same base rather than
 * stacking suffixes.
 *
 * Titles are capped at 200 characters, and the base gives up room for the
 * suffix rather than the other way round: cutting the finished string
 * instead dropped the suffix from a long title, so its copy came out named
 * exactly like the original, past a collision check that had looked at the
 * uncut name.
 */
const MAX_TITLE = 200;

export function copyTitle(title, existing = []) {
  const base = String(title || 'Untitled document')
    .replace(/\s*\(copy(?:\s+\d+)?\)\s*$/i, '').trim() || 'Untitled document';
  const taken = new Set(existing.map((t) => String(t || '').trim().toLowerCase()));
  const named = (suffix) => `${base.slice(0, MAX_TITLE - suffix.length).trimEnd()}${suffix}`;
  let candidate = named(' (copy)');
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = named(` (copy ${n})`);
  return candidate;
}

/** Initials for an avatar: "Ava Chen" -> "AC", "ava@x.co" -> "A". */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
