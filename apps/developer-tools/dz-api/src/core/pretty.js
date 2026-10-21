/**
 * Pretty printers that work on text rather than parsed values, so numbers
 * keep their exact digits (no precision loss on large integers), key order
 * and duplicates are preserved, and slightly broken input still comes out
 * readable. Linear time; used from a worker for large responses.
 */

// Indentation is repeated on every line, so deep nesting can indent a small
// document to gigabytes. Output past this size is not worth showing: the text is kept as is.
const maxOutput = (n) => n * 8 + 1024 * 1024;

// Bare (unquoted) values JSON allows, plus NaN and Infinity that some servers send.
// Letters, digits, ".", "+" and "-": the characters bare JSON values are made of.
const isBareChar = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '.' || c === '-' || c === '+';
const LITERAL = /^(?:-?(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|NaN|-?Infinity)$/;

/**
 * Re-indents JSON text. Returns the input unchanged when it is not JSON-like,
 * including text that starts with "[" or "{" but has bare words in it, such
 * as a "[INFO] ..." log line, so prose never loses its spaces.
 */
export function prettyJson(text, indent = '  ') {
  const n = text.length;
  let i = 0;
  while (i < n && /\s/.test(text[i])) i++;
  if (i >= n || (text[i] !== '{' && text[i] !== '[')) return text;
  const out = [];
  const limit = maxOutput(n);
  let size = 0;
  const emit = (l) => {
    out.push(l);
    size += l.length + 1;
  };
  let depth = 0;
  let line = '';
  const pad = (d) => indent.repeat(d);
  const flush = () => {
    emit(line);
    line = pad(depth);
  };
  // Several top-level values, as in newline-delimited JSON, each start on a new line.
  const startValue = () => {
    if (depth === 0 && line) {
      emit(line);
      line = '';
    }
  };
  let bare = -1; // start of the bare value being read
  for (; i < n; i++) {
    if (size > limit) return text;
    const c = text[i];
    if (bare >= 0) {
      if (isBareChar(c)) continue;
      const value = text.slice(bare, i);
      if (!LITERAL.test(value)) return text;
      line += value;
      bare = -1;
    }
    if (c === '"') {
      startValue();
      let j = i + 1;
      while (j < n) {
        const d = text[j];
        if (d === '\\') j += 2;
        else if (d === '"') break;
        else j++;
      }
      line += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') continue;
    if (c === '{' || c === '[') {
      startValue();
      // Empty containers stay on one line.
      let k = i + 1;
      while (k < n && /\s/.test(text[k])) k++;
      if (text[k] === (c === '{' ? '}' : ']')) {
        line += c + text[k];
        i = k;
        continue;
      }
      line += c;
      depth++;
      flush();
      continue;
    }
    if (c === '}' || c === ']') {
      depth = Math.max(0, depth - 1);
      line = line.trimEnd();
      if (line.trim()) emit(line);
      line = pad(depth) + c;
      continue;
    }
    if (c === ',') {
      line += ',';
      flush();
      continue;
    }
    if (c === ':') {
      line += ': ';
      continue;
    }
    if (!isBareChar(c)) return text;
    startValue();
    bare = i;
  }
  if (bare >= 0) {
    if (!LITERAL.test(text.slice(bare))) return text;
    line += text.slice(bare);
  }
  if (line.trim()) out.push(line);
  return out.join('\n');
}

/**
 * Formats a JSON request body that may contain {{variables}}, including bare
 * ones like {"n": {{n}}}. Throws a SyntaxError when the body is not valid JSON.
 */
export function prettyJsonBody(text) {
  const vars = [];
  let base;
  do base = `9${String(Math.random()).slice(2, 12).padEnd(10, '0')}`;
  while (text.includes(base));
  // Each variable becomes a number, valid both as a value and inside a string, and is put back afterwards.
  const hold = (i) => `${base}${String(i).padStart(6, '0')}`;
  const held = text.replace(/\{\{[^{}]*\}\}/g, (m) => hold(vars.push(m) - 1));
  const restore = (str) => vars.reduce((acc, v, i) => acc.replaceAll(hold(i), () => v), str);
  try {
    JSON.parse(held);
  } catch (err) {
    // Positions refer to the text with variables swapped out, so drop them when any were.
    throw new SyntaxError(vars.length ? restore(err.message).replace(/ at position \d+.*$/, '') : err.message);
  }
  return restore(prettyJson(held));
}

// Tags may hold quoted attribute values with ">" in them.
const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')+>|<[^>]*>?/y;

/**
 * Splits markup into comments, CDATA sections, tags and text. Comments and
 * CDATA are found with indexOf, so an unclosed one is not searched for again
 * from every later "<", which a regex would do.
 */
function xmlTokens(text) {
  const tokens = [];
  const sections = [
    ['<!--', '-->'],
    ['<![CDATA[', ']]>'],
  ];
  const unclosed = new Set();
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      const next = text.indexOf('<', i);
      const end = next < 0 ? text.length : next;
      tokens.push(text.slice(i, end));
      i = end;
      continue;
    }
    let end = -1;
    for (const [open, close] of sections) {
      if (unclosed.has(open) || !text.startsWith(open, i)) continue;
      const at = text.indexOf(close, i + open.length);
      if (at < 0) unclosed.add(open);
      else end = at + close.length;
      break;
    }
    if (end < 0) {
      TAG.lastIndex = i;
      TAG.exec(text);
      end = TAG.lastIndex;
    }
    tokens.push(text.slice(i, end));
    i = end;
  }
  return tokens;
}

/** Indents XML/HTML-like markup by tag nesting. Text content is kept as is. */
export function prettyXml(text, indent = '  ') {
  // Whitespace-only text between tags is dropped below, never inside CDATA or comments.
  const tokens = xmlTokens(text);
  if (!tokens.length) return text;
  const out = [];
  const limit = maxOutput(text.length);
  let size = 0;
  let depth = 0;
  const voids = /^<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b/i;
  for (let t = 0; t < tokens.length; t++) {
    if (size > limit) return text;
    size += depth * indent.length + tokens[t].length + 1;
    const tok = tokens[t];
    if (/^<\//.test(tok)) {
      depth = Math.max(0, depth - 1);
      out.push(indent.repeat(depth) + tok);
    } else if (/^<[^!?]/.test(tok) && !/\/>$/.test(tok) && !voids.test(tok)) {
      // <a>text</a> stays on one line.
      const next = tokens[t + 1];
      const close = tokens[t + 2];
      if (next && close && !next.startsWith('<') && /^<\//.test(close)) {
        out.push(indent.repeat(depth) + tok + next.trim() + close);
        t += 2;
        continue;
      }
      out.push(indent.repeat(depth) + tok);
      depth++;
    } else if (tok.startsWith('<')) {
      out.push(indent.repeat(depth) + tok);
    } else if (tok.trim()) {
      out.push(indent.repeat(depth) + tok.trim());
    }
  }
  return out.join('\n');
}

/** Decodes a body as text using its charset, falling back to UTF-8 for unknown labels. */
export function decodeText(bytes, charset = '') {
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Unknown label: UTF-8 below.
    }
  }
  return new TextDecoder().decode(bytes);
}

/**
 * The charset an HTML or XML body declares for itself, for when the server
 * names none: a byte order mark, an <?xml encoding?> declaration or a <meta>
 * charset in its first 1024 bytes. '' when it declares none.
 */
export function declaredCharset(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  // The declarations are ASCII, which every charset they can name writes the same way.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const found = head.match(/^\s*<\?xml\s[^>]*?\bencoding\s*=\s*["']([^"']+)/) || head.match(/<meta\s[^>]*?\bcharset\s*=\s*["']?([\w.:-]+)/i);
  return found ? found[1].toLowerCase() : '';
}

/** Pretty text, or the text as is when formatting fails (say, JSON nested so deep the output would not fit in memory). */
export function prettyOrSame(source, language) {
  try {
    return language === 'json' ? prettyJson(source) : language === 'xml' ? prettyXml(source) : source;
  } catch {
    return source;
  }
}

/** Guesses a display language from a content type and the body's first characters. */
export function languageFor(contentType, text = '') {
  const ct = (contentType || '').toLowerCase();
  if (/json|\+json/.test(ct)) return 'json';
  if (/html/.test(ct)) return 'html';
  if (/xml|\+xml/.test(ct)) return 'xml';
  if (/javascript|ecmascript/.test(ct)) return 'javascript';
  if (/css/.test(ct)) return 'css';
  const head = text.slice(0, 200).trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  if (/^<!doctype html|^<html/i.test(head)) return 'html';
  if (head.startsWith('<')) return 'xml';
  return 'text';
}

/** True when bytes look like text (no NUL bytes, mostly printable) in the first 4 KB. */
export function looksLikeText(bytes) {
  const n = Math.min(bytes.length, 4096);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32)) odd++;
  }
  return odd / Math.max(1, n) < 0.05;
}

export function isTextContentType(ct) {
  return /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|csv|svg/i.test(ct || '');
}
