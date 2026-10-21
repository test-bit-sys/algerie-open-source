/**
 * {{variable}} templates. Names may contain anything except braces and line
 * breaks; surrounding spaces are ignored. Names starting with $ are dynamic
 * values generated at send time. Unknown names are left as written.
 */

const VAR_RE = /\{\{\s*([^{}\r\n]+?)\s*\}\}/g;

/** [{ name, start, end }] for every {{name}} in text. */
export function findVariables(text) {
  const out = [];
  if (!text || typeof text !== 'string' || !text.includes('{{')) return out;
  VAR_RE.lastIndex = 0;
  let m;
  while ((m = VAR_RE.exec(text))) out.push({ name: m[1], start: m.index, end: m.index + m[0].length });
  return out;
}

const MAX_NESTED_LENGTH = 10 * 1048576;

/**
 * Replaces each {{name}} with lookup(name) when it returns a string. Values
 * may reference other variables; nesting is followed up to `depth` levels so
 * a cycle cannot loop forever.
 */
export function interpolate(text, lookup, depth = 5) {
  if (!text || typeof text !== 'string' || !text.includes('{{')) return text ?? '';
  let out = text;
  for (let i = 0; i < depth && out.includes('{{'); i++) {
    let changed = false;
    const next = out.replace(VAR_RE, (whole, name) => {
      const v = lookup(name);
      if (v == null) return whole;
      changed = true;
      return String(v);
    });
    // Values that reference themselves many times grow exponentially; stop nesting before that runs away.
    if (i > 0 && next.length > MAX_NESTED_LENGTH) break;
    out = next;
    if (!changed) break;
  }
  return out;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const rand = (n) => Math.floor(Math.random() * n);
const pickOne = (list) => list[rand(list.length)];
const alnum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FIRST = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Rowan', 'Skyler'];
const LAST = ['Rivera', 'Chen', 'Patel', 'Novak', 'Okafor', 'Silva', 'Kim', 'Larsen', 'Haddad', 'Moreau', 'Ito', 'Reyes'];
const WORDS = ['alpha', 'river', 'stone', 'cloud', 'maple', 'orbit', 'pixel', 'delta', 'ember', 'frost', 'lumen', 'sable'];

/** Dynamic variables: name -> { description, generate() }. */
export const DYNAMIC = {
  $uuid: { description: 'Random UUID v4', generate: () => crypto.randomUUID() },
  $timestamp: { description: 'Unix time in seconds', generate: () => String(Math.floor(Date.now() / 1000)) },
  $timestampMs: { description: 'Unix time in milliseconds', generate: () => String(Date.now()) },
  $isoTimestamp: { description: 'Current time, ISO 8601', generate: () => new Date().toISOString() },
  $date: {
    description: 'Today, YYYY-MM-DD',
    generate: () => {
      const d = new Date();
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
  },
  $randomInt: { description: 'Integer from 0 to 1000', generate: () => String(rand(1001)) },
  $randomFloat: { description: 'Number from 0 to 1000 with 2 decimals', generate: () => (Math.random() * 1000).toFixed(2) },
  $randomBoolean: { description: 'true or false', generate: () => String(Math.random() < 0.5) },
  $randomString: { description: '12 random letters and digits', generate: () => Array.from({ length: 12 }, () => alnum[rand(alnum.length)]).join('') },
  $randomWord: { description: 'A random word', generate: () => pickOne(WORDS) },
  $randomFirstName: { description: 'A random first name', generate: () => pickOne(FIRST) },
  $randomLastName: { description: 'A random last name', generate: () => pickOne(LAST) },
  $randomFullName: { description: 'A random full name', generate: () => `${pickOne(FIRST)} ${pickOne(LAST)}` },
  $randomEmail: { description: 'A random email address', generate: () => `${pickOne(FIRST).toLowerCase()}.${pickOne(LAST).toLowerCase()}${rand(1000)}@example.com` },
  $randomColor: {
    description: 'A random hex color',
    generate: () => `#${pad(rand(0x1000000).toString(16), 6)}`,
  },
  $randomIP: { description: 'A random IPv4 address', generate: () => `${1 + rand(223)}.${rand(256)}.${rand(256)}.${1 + rand(254)}` },
};

/**
 * Builds a lookup over variable scopes, narrowest first. Each scope is
 * { name, vars } where vars is a Map or an array of Variable objects.
 * get(name) -> { value, scope } | null, with dynamic values generated once
 * per resolver so one request sees a single $uuid.
 */
export function createResolver(scopes) {
  const maps = scopes.filter(Boolean).map((s) => ({ name: s.name, map: toMap(s.vars) }));
  const generated = new Map();
  function get(name) {
    for (const s of maps) if (s.map.has(name)) return { value: s.map.get(name), scope: s.name };
    if (DYNAMIC[name]) {
      if (!generated.has(name)) generated.set(name, DYNAMIC[name].generate());
      return { value: generated.get(name), scope: 'dynamic' };
    }
    return null;
  }
  const lookup = (name) => get(name)?.value;
  return { get, lookup, resolve: (text) => interpolate(text, lookup) };
}

function toMap(vars) {
  if (vars instanceof Map) return vars;
  const m = new Map();
  if (Array.isArray(vars)) {
    for (const v of vars) if (v && v.enabled !== false && v.key) m.set(v.key, v.value ?? '');
  } else if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) m.set(k, v);
  }
  return m;
}
