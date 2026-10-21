/**
 * User-script runtime. Everything lives inside runtimeFactory() so that its
 * source text (Function.prototype.toString) is fully self-contained and can be
 * booted inside the sandbox worker from a Blob URL. The same factory is also
 * called here so tests and the inline fallback can use the building blocks
 * directly.
 *
 * Nothing inside runtimeFactory may reference module scope or imports.
 */

function runtimeFactory() {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const LOG_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
  const MAX_LOGS = 1000;
  const MAX_STRING = 10000;
  const TYPE_NAMES = ['string', 'number', 'boolean', 'object', 'array', 'null', 'undefined', 'function', 'bigint', 'symbol'];
  const VAR_RE = /\{\{\s*([^{}\r\n]+?)\s*\}\}/g;
  const SCRIPT_PARAMS = ['test', 'expect', 'request', 'response', 'env', 'collectionVars', 'globals', 'vars', 'variables',
    'console', 'send', 'runner', 'info', 'utils', 'api'];

  const noop = () => {};
  const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
  const isObj = (v) => v !== null && typeof v === 'object';
  const tagOf = (v) => Object.prototype.toString.call(v);
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const round2 = (n) => Math.round(n * 100) / 100;

  class AssertionError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AssertionError';
    }
  }

  /** Stored variable values are strings: objects become JSON, everything else String(). */
  function toStored(v) {
    if (typeof v === 'string') return v;
    if (isObj(v)) return JSON.stringify(v);
    return String(v);
  }

  function errorText(err) {
    if (err instanceof AssertionError || (isObj(err) && err.name === 'AssertionError')) return str(err.message);
    if (isObj(err) && 'message' in err) return `${err.name || 'Error'}: ${str(err.message)}`;
    return str(err, 'Unknown error');
  }

  // ---- value previews (assertion messages) --------------------------------

  function preview(value, max = 200) {
    let s;
    try {
      s = previewInner(value, 0, new Set());
    } catch {
      s = '[Unprintable]';
    }
    return s.length > max ? `${s.slice(0, max - 3)}...` : s;
  }

  function keyText(k) {
    return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
  }

  function previewInner(v, depth, seen) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'string') return JSON.stringify(v);
    if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (t === 'bigint') return `${v}n`;
    if (t === 'boolean' || t === 'symbol') return String(v);
    if (t === 'function') return `[Function ${v.name || 'anonymous'}]`;
    if (seen.has(v)) return '[Circular]';
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : `Date(${v.toISOString()})`;
    if (v instanceof RegExp) return String(v);
    if (v instanceof Error) return `[${v.name}: ${v.message}]`;
    if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
    seen.add(v);
    try {
      const list = (items, total, open, close) => {
        const more = total > items.length ? `, ... ${total - items.length} more` : '';
        return `${open}${items.join(', ')}${more}${close}`;
      };
      if (Array.isArray(v)) return list(v.slice(0, 20).map((x) => previewInner(x, depth + 1, seen)), v.length, '[', ']');
      if (v instanceof Map) {
        const items = [...v].slice(0, 20).map(([k, x]) => `${previewInner(k, depth + 1, seen)} => ${previewInner(x, depth + 1, seen)}`);
        return list(items, v.size, 'Map {', '}');
      }
      if (v instanceof Set) return list([...v].slice(0, 20).map((x) => previewInner(x, depth + 1, seen)), v.size, 'Set {', '}');
      if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.length})`;
      const keys = Object.keys(v);
      const items = keys.slice(0, 20).map((k) => `${keyText(k)}: ${previewInner(v[k], depth + 1, seen)}`);
      return list(items, keys.length, '{', '}');
    } finally {
      seen.delete(v);
    }
  }

  // ---- equality ------------------------------------------------------------

  function equals(a, b, strict, seen = []) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
    if (!isObj(a) || !isObj(b)) return false;
    if (tagOf(a) !== tagOf(b)) return false;
    if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (a instanceof Date) return Object.is(a.getTime(), b.getTime());
    if (a instanceof RegExp) return String(a) === String(b);
    if (a instanceof Error) return a.name === b.name && a.message === b.message;
    if (a instanceof Number || a instanceof String || a instanceof Boolean) return Object.is(a.valueOf(), b.valueOf());
    for (const [x, y] of seen) if (x === a && y === b) return true;
    seen.push([a, b]);
    try {
      if (a instanceof ArrayBuffer || a instanceof DataView) {
        // Compare the bytes; neither has enumerable keys to compare.
        const bytes = (x) => (x instanceof DataView ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : new Uint8Array(x));
        const [x, y] = [bytes(a), bytes(b)];
        return x.length === y.length && x.every((v, i) => v === y[i]);
      }
      if (ArrayBuffer.isView(a)) return a.length === b.length && Array.prototype.every.call(a, (x, i) => Object.is(x, b[i]));
      if (a instanceof Map) {
        if (a.size !== b.size) return false;
        for (const [k, v] of a) if (!b.has(k) || !equals(v, b.get(k), strict, seen)) return false;
        return true;
      }
      if (a instanceof Set) {
        if (a.size !== b.size) return false;
        const rest = [...b];
        for (const x of a) if (!b.has(x) && !rest.some((y) => equals(x, y, strict, seen))) return false;
        return true;
      }
      if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!equals(a[i], b[i], strict, seen)) return false;
        return true;
      }
      const keysOf = (o) => Object.keys(o).filter((k) => strict || o[k] !== undefined);
      const ka = keysOf(a);
      const kb = keysOf(b);
      if (ka.length !== kb.length) return false;
      for (const k of ka) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!equals(a[k], b[k], strict, seen)) return false;
      }
      return true;
    } finally {
      seen.pop();
    }
  }

  function isPlainish(v) {
    return isObj(v) && !(v instanceof Date) && !(v instanceof RegExp) && !(v instanceof Map) && !(v instanceof Set);
  }

  function matchesObject(actual, expected) {
    if (Array.isArray(expected)) {
      return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matchesObject(actual[i], e));
    }
    if (isPlainish(expected)) {
      if (!isObj(actual)) return false;
      return Object.keys(expected).every((k) => k in actual && matchesObject(actual[k], expected[k]));
    }
    return equals(actual, expected, false);
  }

  function parsePath(path) {
    if (Array.isArray(path)) return path.map(String);
    // a.b[0]["c.d"]: quoted bracket keys may contain dots.
    const out = [];
    const re = /\[\s*(?:"([^"]*)"|'([^']*)'|([^\]]*))\s*\]|([^.[\]]+)/g;
    let m;
    while ((m = re.exec(String(path)))) {
      const key = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (key !== '' && key !== undefined) out.push(key);
    }
    return out;
  }

  // ---- expect --------------------------------------------------------------

  function typeName(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  const isIterable = (v) => v != null && typeof v[Symbol.iterator] === 'function';

  function usage(text) {
    return new AssertionError(text);
  }

  function requireNumber(v, matcher) {
    if (typeof v !== 'number' && typeof v !== 'bigint') throw usage(`${matcher}: expected a number but received ${preview(v)}`);
  }

  // Variables are strings, so a numeric string counts as the number it spells.
  function expectedNumber(v, matcher) {
    if (typeof v === 'number' || typeof v === 'bigint') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    throw usage(`${matcher}: expected value must be a number but received ${preview(v)}`);
  }

  // Each matcher returns { pass, phrase, detail? }. The message reads
  // "expected <actual> [not ]to <phrase>[, but <detail>]".
  const MATCHERS = {
    toBe(a, e) {
      const pass = Object.is(a, e);
      const sameShape = !pass && isObj(a) && equals(a, e, false);
      const detail = sameShape ? 'they are different objects with equal contents; use toEqual for deep equality' : '';
      return { pass, phrase: `be ${preview(e)}`, detail };
    },
    toEqual: (a, e) => ({ pass: equals(a, e, false), phrase: `equal ${preview(e)}` }),
    toStrictEqual: (a, e) => ({ pass: equals(a, e, true), phrase: `strictly equal ${preview(e)}` }),
    toBeTruthy: (a) => ({ pass: !!a, phrase: 'be truthy' }),
    toBeFalsy: (a) => ({ pass: !a, phrase: 'be falsy' }),
    toBeNull: (a) => ({ pass: a === null, phrase: 'be null' }),
    toBeUndefined: (a) => ({ pass: a === undefined, phrase: 'be undefined' }),
    toBeDefined: (a) => ({ pass: a !== undefined, phrase: 'be defined' }),
    toBeNaN: (a) => ({ pass: typeof a === 'number' && Number.isNaN(a), phrase: 'be NaN' }),
    toBeGreaterThan(a, n) {
      requireNumber(a, 'toBeGreaterThan');
      n = expectedNumber(n, 'toBeGreaterThan');
      return { pass: a > n, phrase: `be greater than ${preview(n)}` };
    },
    toBeGreaterThanOrEqual(a, n) {
      requireNumber(a, 'toBeGreaterThanOrEqual');
      n = expectedNumber(n, 'toBeGreaterThanOrEqual');
      return { pass: a >= n, phrase: `be greater than or equal to ${preview(n)}` };
    },
    toBeLessThan(a, n) {
      requireNumber(a, 'toBeLessThan');
      n = expectedNumber(n, 'toBeLessThan');
      return { pass: a < n, phrase: `be less than ${preview(n)}` };
    },
    toBeLessThanOrEqual(a, n) {
      requireNumber(a, 'toBeLessThanOrEqual');
      n = expectedNumber(n, 'toBeLessThanOrEqual');
      return { pass: a <= n, phrase: `be less than or equal to ${preview(n)}` };
    },
    toBeCloseTo(a, e, digits = 2) {
      requireNumber(a, 'toBeCloseTo');
      e = expectedNumber(e, 'toBeCloseTo');
      const diff = Math.abs(a - e);
      const pass = (a === Infinity && e === Infinity) || (a === -Infinity && e === -Infinity) || diff < 10 ** -digits / 2;
      return { pass, phrase: `be close to ${preview(e)} (${digits} digits)`, detail: `the difference is ${diff}` };
    },
    toContain(a, item) {
      if (typeof a === 'string') return { pass: a.includes(String(item)), phrase: `contain ${preview(item)}` };
      if (!isIterable(a)) throw usage(`toContain: expected a string, array or iterable but received ${preview(a)}`);
      const pass = Array.from(a).some((x) => x === item || (Number.isNaN(x) && Number.isNaN(item)));
      return { pass, phrase: `contain ${preview(item)}` };
    },
    toContainEqual(a, item) {
      if (!isIterable(a)) throw usage(`toContainEqual: expected an array or iterable but received ${preview(a)}`);
      return { pass: Array.from(a).some((x) => equals(x, item, false)), phrase: `contain an item equal to ${preview(item)}` };
    },
    toMatch(a, pattern) {
      if (typeof a !== 'string') throw usage(`toMatch: expected a string but received ${preview(a)}`);
      let pass;
      if (pattern instanceof RegExp) {
        pattern.lastIndex = 0;
        pass = pattern.test(a);
      } else pass = a.includes(String(pattern));
      return { pass, phrase: `match ${pattern instanceof RegExp ? String(pattern) : preview(String(pattern))}` };
    },
    toHaveLength(a, n) {
      if (a == null || typeof a.length !== 'number') throw usage(`toHaveLength: expected a value with a length but received ${preview(a)}`);
      n = expectedNumber(n, 'toHaveLength');
      return { pass: a.length === n, phrase: `have length ${n}`, detail: `its length is ${a.length}` };
    },
    toHaveProperty(a, path, ...rest) {
      const parts = parsePath(path);
      let cur = a;
      let found = parts.length > 0 && cur != null;
      for (const p of parts) {
        if (cur == null || !(p in Object(cur))) {
          found = false;
          break;
        }
        cur = cur[p];
      }
      const label = Array.isArray(path) ? path.join('.') : String(path);
      if (!rest.length) return { pass: found, phrase: `have property ${preview(label)}` };
      const pass = found && equals(cur, rest[0], false);
      const detail = found ? `it is ${preview(cur)}` : 'the property does not exist';
      return { pass, phrase: `have property ${preview(label)} equal to ${preview(rest[0])}`, detail };
    },
    toBeInstanceOf(a, Cls) {
      if (typeof Cls !== 'function') throw usage(`toBeInstanceOf: expected a class or constructor but received ${preview(Cls)}`);
      const actualName = isObj(a) && a.constructor ? a.constructor.name : typeName(a);
      return { pass: a instanceof Cls, phrase: `be an instance of ${Cls.name || 'the given class'}`, detail: `it is ${actualName}` };
    },
    toBeOneOf(a, list) {
      if (!Array.isArray(list)) throw usage(`toBeOneOf: expected an array of options but received ${preview(list)}`);
      return { pass: list.some((x) => equals(a, x, false)), phrase: `be one of ${preview(list)}` };
    },
    toBeType(a, type) {
      if (!TYPE_NAMES.includes(type)) throw usage(`toBeType: unknown type ${preview(type)}; use one of ${TYPE_NAMES.join(', ')}`);
      const actual = typeName(a);
      return { pass: actual === type, phrase: `be of type ${type}`, detail: `it is ${actual}` };
    },
    toMatchObject(a, e) {
      if (!isObj(e)) throw usage(`toMatchObject: expected an object or array but received ${preview(e)}`);
      return { pass: matchesObject(a, e), phrase: `match object ${preview(e)}` };
    },
    toThrow(fn, expected) {
      if (typeof fn !== 'function') throw usage(`toThrow: expected a function but received ${preview(fn)}`);
      let threw = false;
      let err;
      try {
        fn();
      } catch (e) {
        threw = true;
        err = e;
      }
      const msg = isObj(err) && 'message' in err ? str(err.message) : str(err);
      if (expected === undefined) return { pass: threw, phrase: 'throw', detail: 'it did not throw' };
      let pass = threw;
      let phrase;
      if (typeof expected === 'string') {
        pass = threw && msg.includes(expected);
        phrase = `throw an error containing ${preview(expected)}`;
      } else if (expected instanceof RegExp) {
        expected.lastIndex = 0;
        pass = threw && expected.test(msg);
        phrase = `throw an error matching ${String(expected)}`;
      } else if (typeof expected === 'function') {
        pass = threw && err instanceof expected;
        phrase = `throw ${expected.name || 'the given error type'}`;
      } else if (isObj(expected) && 'message' in expected) {
        pass = threw && msg === str(expected.message);
        phrase = `throw an error with message ${preview(str(expected.message))}`;
      } else throw usage(`toThrow: unsupported expectation ${preview(expected)}`);
      return { pass, phrase, detail: threw ? `it threw ${preview(err)}` : 'it did not throw' };
    },
  };

  function describeActual(name, actual) {
    return name === 'toThrow' ? 'function' : preview(actual);
  }

  function matchersFor(actual, negated) {
    const out = {};
    for (const name of Object.keys(MATCHERS)) {
      out[name] = (...args) => {
        const r = MATCHERS[name](actual, ...args);
        if (!!r.pass === !negated) return undefined;
        const detail = !negated && r.detail ? `, but ${r.detail}` : '';
        throw new AssertionError(`expected ${describeActual(name, actual)} ${negated ? 'not ' : ''}to ${r.phrase}${detail}`);
      };
    }
    return out;
  }

  function asyncMatchers(promise, negated, mode) {
    const out = {};
    for (const name of Object.keys(MATCHERS)) {
      out[name] = (...args) =>
        Promise.resolve(promise).then(
          (value) => {
            if (mode === 'rejects') throw new AssertionError(`expected promise to reject, but it resolved with ${preview(value)}`);
            return matchersFor(value, negated)[name](...args);
          },
          (err) => {
            if (mode === 'resolves') throw new AssertionError(`expected promise to resolve, but it rejected with ${preview(err)}`);
            // As in Jest, rejects.toThrow checks the rejection reason as if it had been thrown.
            const subject = name === 'toThrow' ? () => { throw err; } : err;
            return matchersFor(subject, negated)[name](...args);
          },
        );
    }
    return out;
  }

  function createExpect() {
    function expect(actual) {
      const m = matchersFor(actual, false);
      m.not = matchersFor(actual, true);
      m.resolves = asyncMatchers(actual, false, 'resolves');
      m.resolves.not = asyncMatchers(actual, true, 'resolves');
      m.rejects = asyncMatchers(actual, false, 'rejects');
      m.rejects.not = asyncMatchers(actual, true, 'rejects');
      return m;
    }
    expect.AssertionError = AssertionError;
    return expect;
  }

  // ---- test() --------------------------------------------------------------

  function createTest(tests, track) {
    function test(name, fn) {
      const entry = { name: str(name, 'Untitled test'), passed: false, skipped: false, error: null, durationMs: 0 };
      tests.push(entry);
      const start = now();
      const finish = (ok, err) => {
        entry.durationMs = round2(now() - start);
        entry.passed = ok;
        entry.error = ok ? null : errorText(err);
      };
      if (typeof fn !== 'function') {
        finish(false, new TypeError('test() needs a function as its second argument'));
        return Promise.resolve();
      }
      let ret;
      try {
        ret = fn();
      } catch (err) {
        finish(false, err);
        return Promise.resolve();
      }
      if (ret && typeof ret.then === 'function') {
        const done = Promise.resolve(ret).then(() => finish(true), (err) => finish(false, err));
        track(done);
        return done;
      }
      finish(true);
      return Promise.resolve();
    }
    test.skip = (name) => {
      tests.push({ name: str(name, 'Untitled test'), passed: false, skipped: true, error: null, durationMs: 0 });
      return Promise.resolve();
    };
    return test;
  }

  // ---- console capture -----------------------------------------------------

  /** Turns any value into structured-clone-safe data: cycles, functions, huge values handled. */
  function serialize(v, depth = 0, seen = new Set()) {
    const t = typeof v;
    if (v === null || v === undefined || t === 'boolean' || t === 'number') return v;
    if (t === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}... [${v.length - MAX_STRING} more chars]` : v;
    if (t === 'bigint') return `${v}n`;
    if (t === 'symbol') return String(v);
    if (t === 'function') return `[Function ${v.name || 'anonymous'}]`;
    if (seen.has(v)) return '[Circular]';
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (v instanceof Error) return { name: str(v.name), message: str(v.message), stack: str(v.stack).slice(0, 2000) };
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return `[${v.constructor.name}(${v.byteLength} bytes)]`;
    if (depth >= 8) return Array.isArray(v) ? '[Array]' : '[Object]';
    seen.add(v);
    try {
      if (Array.isArray(v) || v instanceof Set) {
        const items = Array.from(v);
        const out = items.slice(0, 200).map((x) => serialize(x, depth + 1, seen));
        if (items.length > 200) out.push(`... ${items.length - 200} more items`);
        return out;
      }
      if (v instanceof Map) {
        const out = {};
        let n = 0;
        for (const [k, x] of v) {
          if (n++ >= 200) {
            out['...'] = `${v.size - 200} more entries`;
            break;
          }
          out[typeof k === 'string' ? k : preview(k, 80)] = serialize(x, depth + 1, seen);
        }
        return out;
      }
      const out = {};
      const keys = Object.keys(v);
      for (const k of keys.slice(0, 200)) {
        let x;
        try {
          x = serialize(v[k], depth + 1, seen);
        } catch (err) {
          x = `[Thrown: ${errorText(err)}]`;
        }
        Object.defineProperty(out, k, { value: x, enumerable: true, writable: true, configurable: true });
      }
      if (keys.length > 200) out['...'] = `${keys.length - 200} more keys`;
      return out;
    } finally {
      seen.delete(v);
    }
  }

  function createConsole(logs) {
    let dropped = false;
    const push = (level, args) => {
      if (logs.length >= MAX_LOGS) {
        if (!dropped) logs.push({ level: 'warn', args: [`Log limit of ${MAX_LOGS} reached; further output was dropped`], at: Date.now() });
        dropped = true;
        return;
      }
      logs.push({ level, args: Array.from(args, (a) => serialize(a)), at: Date.now() });
    };
    const c = { push };
    for (const level of LOG_LEVELS) c[level] = (...args) => push(level, args);
    c.trace = (...args) => push('debug', args);
    c.dir = (v) => push('log', [v]);
    c.table = (v) => push('log', [v]);
    c.assert = (cond, ...args) => {
      if (!cond) push('error', ['Assertion failed', ...args]);
    };
    return c;
  }

  // ---- variables -----------------------------------------------------------

  function createScope(initial) {
    const map = new Map();
    if (isObj(initial)) for (const [k, v] of Object.entries(initial)) map.set(k, str(v));
    return Object.freeze({
      get: (k) => (map.has(String(k)) ? map.get(String(k)) : undefined),
      set: (k, v) => void map.set(String(k), toStored(v)),
      unset: (k) => void map.delete(String(k)),
      has: (k) => map.has(String(k)),
      clear: () => map.clear(),
      toObject: () => Object.fromEntries(map),
    });
  }

  /** Scopes narrowest first: local, environment, collection, globals. */
  function createVariables(scopes) {
    const order = [scopes.local, scopes.environment, scopes.collection, scopes.globals];
    const get = (k) => {
      for (const s of order) if (s.has(k)) return s.get(k);
      return undefined;
    };
    const resolve = (text, depth = 5) => {
      if (typeof text !== 'string' || !text.includes('{{')) return text == null ? '' : String(text);
      let out = text;
      for (let i = 0; i < depth && out.includes('{{'); i++) {
        let changed = false;
        out = out.replace(VAR_RE, (whole, name) => {
          const v = get(name);
          if (v === undefined) return whole;
          changed = true;
          return v;
        });
        if (!changed) break;
      }
      return out;
    };
    return Object.freeze({
      get,
      has: (k) => order.some((s) => s.has(k)),
      resolve,
      toObject: () => Object.assign({}, ...[...order].reverse().map((s) => s.toObject())),
    });
  }

  // ---- request / response --------------------------------------------------

  /** Accepts [[k, v]], [{ key, value, enabled }], a plain object or a Headers-like; returns [{ key, value }]. */
  function headerPairs(h) {
    const out = [];
    if (!h) return out;
    if (Array.isArray(h)) {
      for (const item of h) {
        if (Array.isArray(item)) out.push({ key: str(item[0]), value: str(item[1]) });
        else if (isObj(item) && item.enabled !== false) out.push({ key: str(item.key), value: str(item.value) });
      }
    } else if (typeof h.forEach === 'function' && typeof h.get === 'function') {
      h.forEach((value, key) => out.push({ key: str(key), value: str(value) }));
    } else if (isObj(h)) {
      for (const [key, value] of Object.entries(h)) out.push({ key, value: str(value) });
    }
    return out.filter((p) => p.key);
  }

  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  function readOnlyHeaders(list) {
    const matches = (name) => list.filter((h) => sameName(h.key, name));
    return Object.freeze({
      get(name) {
        const m = matches(name);
        return m.length ? m.map((h) => h.value).join(', ') : null;
      },
      has: (name) => matches(name).length > 0,
      toObject() {
        const out = {};
        for (const h of list) out[h.key] = h.key in out ? `${out[h.key]}, ${h.value}` : h.value;
        return out;
      },
      list: () => list.map((h) => ({ key: h.key, value: h.value })),
    });
  }

  function parseJson(text, what) {
    if (!text.trim()) throw new SyntaxError(`${what} is empty, so it cannot be parsed as JSON`);
    try {
      return JSON.parse(text);
    } catch (err) {
      const start = text.length > 60 ? `${text.slice(0, 60)}...` : text;
      throw new SyntaxError(`${what} is not valid JSON (${err.message}). It starts with: ${JSON.stringify(start)}`);
    }
  }

  /** Request view for scripts. Writable in the pre-request phase; snapshot() returns the state for the host. */
  function createRequestApi(raw, writable) {
    const src = isObj(raw) ? raw : {};
    const state = {
      method: str(src.method, 'GET').toUpperCase() || 'GET',
      url: str(src.url),
      headers: (Array.isArray(src.headers) ? src.headers : headerPairs(src.headers))
        .filter(isObj)
        .map((h) => ({ ...h, key: str(h.key), value: str(h.value), enabled: h.enabled !== false })),
      body: isObj(src.body) ? { ...src.body } : { mode: 'none', raw: '' },
    };
    const guard = () => {
      if (!writable) throw new TypeError('request is read-only in post-response scripts');
    };
    const enabled = (name) => state.headers.filter((h) => h.enabled && sameName(h.key, name));
    const headers = Object.freeze({
      get(name) {
        const m = enabled(name);
        return m.length ? m[0].value : null;
      },
      has: (name) => enabled(name).length > 0,
      set(name, value) {
        guard();
        const key = String(name);
        const v = toStored(value);
        const existing = state.headers.findIndex((h) => sameName(h.key, key) && h.enabled);
        if (existing === -1) state.headers.push({ key, value: v, enabled: true });
        else {
          state.headers[existing] = { ...state.headers[existing], value: v, enabled: true };
          state.headers = state.headers.filter((h, i) => i === existing || !(h.enabled && sameName(h.key, key)));
        }
      },
      remove(name) {
        guard();
        state.headers = state.headers.filter((h) => !sameName(h.key, name));
      },
      toObject() {
        const out = {};
        for (const h of state.headers) if (h.enabled && h.key) out[h.key] = h.key in out ? `${out[h.key]}, ${h.value}` : h.value;
        return out;
      },
      list: () => state.headers.map((h) => ({ key: h.key, value: h.value, enabled: h.enabled })),
    });
    const body = Object.freeze({
      get mode() {
        return str(state.body.mode, 'none');
      },
      set mode(v) {
        guard();
        state.body.mode = String(v);
      },
      get raw() {
        return str(state.body.raw);
      },
      set raw(v) {
        guard();
        state.body.raw = toStored(v);
        if (!state.body.mode || state.body.mode === 'none') state.body.mode = 'raw';
      },
      json: () => parseJson(str(state.body.raw), 'Request body'),
    });
    const api = Object.freeze({
      get method() {
        return state.method;
      },
      set method(v) {
        guard();
        state.method = String(v).toUpperCase();
      },
      get url() {
        return state.url;
      },
      set url(v) {
        guard();
        state.url = String(v);
      },
      headers,
      body,
    });
    const snapshot = () => ({ method: state.method, url: state.url, headers: state.headers.map((h) => ({ ...h })), body: { ...state.body } });
    return { api, snapshot };
  }

  function createResponseApi(raw) {
    const src = isObj(raw) ? raw : {};
    const status = Number(src.status) || 0;
    const text = str(src.bodyText);
    let parsed;
    let hasParsed = false;
    const size = Number(src.sizeBytes);
    return Object.freeze({
      status,
      code: status,
      statusText: str(src.statusText),
      ok: status >= 200 && status < 300,
      headers: readOnlyHeaders(headerPairs(src.headers)),
      text: () => text,
      json() {
        if (!hasParsed) {
          parsed = parseJson(text, 'Response body');
          hasParsed = true;
        }
        return parsed;
      },
      time: Number(src.timeMs) || 0,
      size: Number.isFinite(size) && size >= 0 ? size : new TextEncoder().encode(text).length,
    });
  }

  // A body object with one of these modes describes the body; any other object is sent as JSON.
  const SEND_BODY_MODES = ['none', 'raw', 'urlencoded', 'formdata', 'form', 'file', 'binary', 'graphql'];

  /** Normalizes send() input into { method, url, headers: [{ key, value, enabled }], body: { mode, raw, ... } }. */
  function normalizeSendRequest(input) {
    const src = typeof input === 'string' ? { url: input } : input;
    if (!isObj(src)) throw new TypeError('send() needs a URL string or a request object');
    const url = str(src.url).trim();
    if (!url) throw new TypeError('send() needs a request with a url');
    const headers = headerPairs(src.headers).map((h) => ({ key: h.key, value: h.value, enabled: true }));
    let body = { mode: 'none', raw: '' };
    const b = src.body;
    if (typeof b === 'string') body = { mode: 'raw', raw: b };
    else if (isObj(b) && SEND_BODY_MODES.includes(b.mode)) body = JSON.parse(JSON.stringify({ ...b, raw: b.raw == null ? '' : toStored(b.raw) }));
    else if (isObj(b)) {
      body = { mode: 'raw', raw: JSON.stringify(b), rawType: 'json' };
      if (!headers.some((h) => sameName(h.key, 'content-type'))) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
    } else if (b != null) body = { mode: 'raw', raw: String(b) };
    return { method: str(src.method, 'GET').toUpperCase() || 'GET', url, headers, body };
  }

  // ---- utils ---------------------------------------------------------------

  // The sandbox has an opaque origin, which browsers do not treat as a secure
  // context, so crypto.subtle is missing there. SHA-256 and HMAC are small
  // enough to implement directly.
  let SHA_K = null;
  let SHA_H = null;
  function shaConstants() {
    if (SHA_K) return;
    const primes = [];
    for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
    SHA_K = new Uint32Array(primes.map((p) => (p ** (1 / 3) * 2 ** 32) | 0));
    SHA_H = new Uint32Array(primes.slice(0, 8).map((p) => (p ** (1 / 2) * 2 ** 32) | 0));
  }

  function sha256Bytes(data) {
    shaConstants();
    const ror = (x, n) => (x >>> n) | (x << (32 - n));
    const len = data.length;
    const total = Math.ceil((len + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(data);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, Math.floor((len * 8) / 2 ** 32));
    view.setUint32(total - 4, (len * 8) >>> 0);
    const H = new Uint32Array(SHA_H);
    const W = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = ror(W[i - 15], 7) ^ ror(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = ror(W[i - 2], 17) ^ ror(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + W[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      H[0] += a;
      H[1] += b;
      H[2] += c;
      H[3] += d;
      H[4] += e;
      H[5] += f;
      H[6] += g;
      H[7] += h;
    }
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
    return out;
  }

  function hmacSha256Bytes(key, msg) {
    let k = key.length > 64 ? sha256Bytes(key) : key;
    const block = new Uint8Array(64);
    block.set(k);
    k = block;
    const inner = new Uint8Array(64 + msg.length);
    const outer = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) {
      inner[i] = k[i] ^ 0x36;
      outer[i] = k[i] ^ 0x5c;
    }
    inner.set(msg, 64);
    outer.set(sha256Bytes(inner), 64);
    return sha256Bytes(outer);
  }

  function createUtils(cryptoImpl) {
    const c = cryptoImpl || (typeof crypto !== 'undefined' ? crypto : null);
    const enc = new TextEncoder();
    const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    const bytes = (s) => new Uint8Array(enc.encode(String(s)));
    return Object.freeze({
      base64(s) {
        let bin = '';
        for (const b of enc.encode(String(s))) bin += String.fromCharCode(b);
        return btoa(bin);
      },
      base64Decode(s) {
        const bin = atob(String(s));
        return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
      },
      // Async so a native implementation can be swapped in later without changing scripts.
      sha256: async (s) => hex(sha256Bytes(bytes(s))),
      hmacSha256: async (key, msg) => hex(hmacSha256Bytes(bytes(key), bytes(msg))),
      uuid() {
        if (c && typeof c.randomUUID === 'function') return c.randomUUID();
        const b = new Uint8Array(16);
        if (c && c.getRandomValues) c.getRandomValues(b);
        else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = hex(b);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      },
    });
  }

  // ---- running a script ----------------------------------------------------

  // Lines the Function constructor adds before the body; measured once so
  // error line numbers point into the user's script in any engine.
  let headerLines = null;
  async function measureHeaderLines() {
    if (headerLines !== null) return headerLines;
    headerLines = 0;
    try {
      await new AsyncFunction(...SCRIPT_PARAMS, 'throw new Error("probe");\n//# sourceURL=line-probe.js')();
    } catch (err) {
      const m = /line-probe\.js:(\d+)/.exec(str(err && err.stack));
      if (m) headerLines = Number(m[1]) - 1;
    }
    return headerLines;
  }

  function describeError(err, sourceName) {
    const out = { name: 'Error', message: str(err, 'Unknown error') };
    if (isObj(err)) {
      out.name = str(err.name, 'Error');
      out.message = str(err.message, out.message);
      if (err.stack) out.stack = str(err.stack).slice(0, 4000);
      const m = new RegExp(`${sourceName.replace(/[.-]/g, '\\$&')}:(\\d+):(\\d+)`).exec(str(err.stack));
      if (m) {
        out.line = Number(m[1]) - headerLines;
        out.column = Number(m[2]);
      }
    }
    return out;
  }

  /**
   * Runs one script message and resolves with the result. `host` provides
   * send(request) -> Promise<responseLike> and optionally attachLog(fn), which
   * receives a (level, args) logger for uncaught errors.
   */
  async function runScript(message, host = {}) {
    const msg = isObj(message) ? message : {};
    const phase = msg.phase === 'post' ? 'post' : 'pre';
    const tests = [];
    const logs = [];
    const pending = new Set();
    const track = (p) => {
      const settled = Promise.resolve(p).then(noop, noop);
      pending.add(settled);
      settled.then(() => pending.delete(settled));
      return p;
    };

    const vars = isObj(msg.variables) ? msg.variables : {};
    const scopes = {
      environment: createScope(vars.environment),
      collection: createScope(vars.collection),
      globals: createScope(vars.globals),
      local: createScope(vars.local),
    };
    const req = createRequestApi(msg.request, phase === 'pre');
    const consoleApi = createConsole(logs);
    if (host && typeof host.attachLog === 'function') host.attachLog((level, args) => consoleApi.push(level, args));
    const flow = { next: undefined, stop: false };

    const send = (input) =>
      track(
        (async () => {
          if (!host || typeof host.send !== 'function') throw new Error('send() is not available here');
          const raw = await host.send(normalizeSendRequest(input));
          return createResponseApi(raw);
        })(),
      );

    const api = Object.freeze({
      test: createTest(tests, track),
      expect: createExpect(),
      request: req.api,
      response: phase === 'post' ? createResponseApi(msg.response) : undefined,
      env: scopes.environment,
      collectionVars: scopes.collection,
      globals: scopes.globals,
      vars: scopes.local,
      variables: createVariables(scopes),
      console: Object.freeze(Object.fromEntries(Object.entries(consoleApi).filter(([k]) => k !== 'push'))),
      send,
      runner: Object.freeze({
        next(name) {
          flow.next = name == null ? null : String(name);
        },
        stop() {
          flow.stop = true;
        },
      }),
      info: Object.freeze({ ...(isObj(msg.info) ? msg.info : {}), phase }),
      utils: createUtils(),
    });

    const sourceName = `${phase}-script.js`;
    let error = null;
    await measureHeaderLines();
    try {
      const fn = new AsyncFunction(...SCRIPT_PARAMS, `${str(msg.code)}\n//# sourceURL=${sourceName}`);
      await fn(...SCRIPT_PARAMS.map((k) => (k === 'api' ? api : api[k])));
    } catch (err) {
      error = describeError(err, sourceName);
    }
    // Unawaited tests and sends still count; later ones may add more work.
    while (pending.size) await Promise.all([...pending]);

    const result = {
      id: msg.id,
      ok: !error,
      tests,
      logs,
      variables: {
        environment: scopes.environment.toObject(),
        collection: scopes.collection.toObject(),
        globals: scopes.globals.toObject(),
        local: scopes.local.toObject(),
      },
      request: phase === 'pre' ? req.snapshot() : undefined,
      flow: { ...flow },
    };
    if (error) result.error = error;
    return result;
  }

  /** Worker side of the protocol: hello, run, sendResult in; hello, send, result out. */
  function installMessageHandler(scope) {
    const post = (m) => {
      try {
        scope.postMessage(m);
      } catch {
        scope.postMessage(JSON.parse(JSON.stringify(m)));
      }
    };
    const sends = new Map();
    let seq = 0;
    let sink = null;
    scope.addEventListener('error', (e) => {
      if (!sink) return;
      sink('error', [`Uncaught ${e.error ? errorText(e.error) : str(e.message)}`]);
      e.preventDefault();
    });
    scope.addEventListener('unhandledrejection', (e) => {
      if (!sink) return;
      sink('error', [`Unhandled promise rejection: ${errorText(e.reason)}`]);
      e.preventDefault();
    });
    scope.addEventListener('message', (e) => {
      const d = e.data;
      if (!isObj(d)) return;
      if (d.type === 'hello') post({ type: 'hello' });
      else if (d.type === 'sendResult') {
        const s = sends.get(d.sendId);
        if (!s) return;
        sends.delete(d.sendId);
        if (d.error != null) s.reject(new Error(str(d.error)));
        else s.resolve(d.response);
      } else if (d.type === 'run') {
        const host = {
          send: (request) =>
            new Promise((resolve, reject) => {
              const sendId = ++seq;
              sends.set(sendId, { resolve, reject });
              post({ type: 'send', sendId, request });
            }),
          attachLog: (fn) => {
            sink = fn;
          },
        };
        runScript(d.message, host).then(
          (result) => post({ type: 'result', result }),
          (err) => post({ type: 'result', result: { ok: false, error: { message: errorText(err) }, tests: [], logs: [] } }),
        );
      }
    });
  }

  return {
    AssertionError,
    createExpect,
    createTest,
    createConsole,
    createScope,
    createVariables,
    createRequestApi,
    createResponseApi,
    createUtils,
    normalizeSendRequest,
    serialize,
    preview,
    equals,
    runScript,
    installMessageHandler,
  };
}

/**
 * Source booted inside the sandbox. In a worker it serves the message
 * protocol; in a window (the no-Worker fallback) it leaves the API on
 * self.__scriptRuntime for the loader to pick up.
 */
export const RUNTIME_SOURCE = `(function () {
  var api = (${runtimeFactory.toString()})();
  if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) api.installMessageHandler(self);
  else self.__scriptRuntime = api;
})();
`;

const runtime = runtimeFactory();

export const {
  AssertionError,
  createExpect,
  createTest,
  createConsole,
  createScope,
  createVariables,
  createRequestApi,
  createResponseApi,
  createUtils,
  normalizeSendRequest,
  serialize,
  preview,
  equals,
  runScript,
  installMessageHandler,
} = runtime;
