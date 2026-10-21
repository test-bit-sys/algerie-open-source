/**
 * A small JSONPath subset for filtering responses:
 *   $            the root (optional)
 *   .name        a property; ["name"] or ['name'] for any key
 *   [0], [-1]    an array index, counting from the end when negative
 *   [*], .*      every element or property value
 *   ..name       name at any depth
 *   [0:3]        a slice
 * query(value, path) returns every match, in document order.
 */

export function parsePath(path) {
  const src = path.trim();
  const steps = [];
  let i = src.startsWith('$') ? 1 : 0;
  const ident = /[A-Za-z_$][\w$-]*/y;
  while (i < src.length) {
    const c = src[i];
    if (c === '.' && src[i + 1] === '.') {
      i += 2;
      if (src[i] === '*') {
        steps.push({ deep: true, wildcard: true });
        i++;
        continue;
      }
      ident.lastIndex = i;
      const m = ident.exec(src);
      if (!m) throw new Error(`Expected a name after ".." at ${i + 1}.`);
      steps.push({ deep: true, key: m[0] });
      i = ident.lastIndex;
    } else if (c === '.') {
      i++;
      if (src[i] === '*') {
        steps.push({ wildcard: true });
        i++;
        continue;
      }
      ident.lastIndex = i;
      const m = ident.exec(src);
      if (!m) throw new Error(`Expected a name after "." at ${i + 1}.`);
      steps.push({ key: m[0] });
      i = ident.lastIndex;
    } else if (c === '[') {
      const end = findClose(src, i);
      const inner = src.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === '*') steps.push({ wildcard: true });
      // One quoted key; a union such as ['a','b'] is not supported.
      else if (/^(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")$/s.test(inner)) steps.push({ key: inner.slice(1, -1).replace(/\\(.)/g, '$1') });
      else if (/^-?\d+$/.test(inner)) steps.push({ index: Number(inner) });
      else if (/^-?\d*:-?\d*$/.test(inner)) {
        const [a, b] = inner.split(':');
        steps.push({ slice: [a === '' ? null : Number(a), b === '' ? null : Number(b)] });
      } else throw new Error(`Unsupported selector [${inner}].`);
    } else if (i === 0 && /[A-Za-z_$]/.test(c)) {
      // Allow "data.items" without a leading $ or dot.
      ident.lastIndex = i;
      const m = ident.exec(src);
      steps.push({ key: m[0] });
      i = ident.lastIndex;
    } else throw new Error(`Unexpected "${c}" at ${i + 1}.`);
  }
  return steps;
}

function findClose(src, start) {
  let quote = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ']') return i;
  }
  throw new Error('Missing "]".');
}

const isObj = (v) => v !== null && typeof v === 'object';

function children(v) {
  if (Array.isArray(v)) return v;
  if (isObj(v)) return Object.values(v);
  return [];
}

function descend(v, out) {
  out.push(v);
  for (const c of children(v)) descend(c, out);
}

export function query(value, path) {
  let current = [value];
  for (const step of parsePath(path)) {
    const next = [];
    let sources = current;
    if (step.deep) {
      sources = [];
      for (const v of current) descend(v, sources);
    }
    for (const v of sources) {
      // Plain loops rather than push(...list): spreading a huge array overflows the call stack.
      if (step.wildcard) for (const c of children(v)) next.push(c);
      else if (step.key !== undefined) {
        if (isObj(v) && !Array.isArray(v) && Object.hasOwn(v, step.key)) next.push(v[step.key]);
        else if (Array.isArray(v) && step.key === 'length' && !step.deep) next.push(v.length);
      } else if (step.index !== undefined) {
        if (Array.isArray(v)) {
          const idx = step.index < 0 ? v.length + step.index : step.index;
          if (idx >= 0 && idx < v.length) next.push(v[idx]);
        }
      } else if (step.slice) {
        if (Array.isArray(v)) for (const c of v.slice(step.slice[0] ?? 0, step.slice[1] ?? v.length)) next.push(c);
      }
    }
    current = next;
  }
  return current;
}

/**
 * Parses JSON keeping numbers whose digits a double would change (large IDs,
 * long decimals), and returns { value, stringify } where stringify writes them
 * back exactly. Uses the reviver's source text where the browser provides it.
 */
export function parseJsonExact(text) {
  const exact = [];
  const tag = `\u0000n${Math.random().toString(36).slice(2, 8)}:`;
  const value = JSON.parse(text, (key, v, ctx) => {
    if (typeof v === 'number' && ctx?.source && String(v) !== ctx.source) return tag + (exact.push(ctx.source) - 1);
    return v;
  });
  const marker = new RegExp(`"${JSON.stringify(tag).slice(1, -1).replace(/\\/g, '\\\\')}(\\d+)"`, 'g');
  const stringify = (v) => {
    const out = JSON.stringify(v, null, 2);
    return exact.length && out ? out.replace(marker, (_, i) => exact[Number(i)]) : out;
  };
  return { value, stringify };
}
