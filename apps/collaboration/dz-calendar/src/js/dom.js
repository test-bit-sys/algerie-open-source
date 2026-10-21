/** Minimal DOM helpers to keep view code terse and consistent. */

/**
 * Create an element. `attrs` supports: class, html, text, dataset, style
 * (object), attributes (any other key), and `on` (event map).
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') setStyle(node, value);
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Apply inline styles, routing `--custom-props` through setProperty. */
function setStyle(node, styles) {
  for (const [prop, val] of Object.entries(styles)) {
    if (val == null) continue;
    if (prop.startsWith('--')) node.style.setProperty(prop, val);
    else node.style[prop] = val;
  }
}

export function clear(node) {
  if (node) node.replaceChildren();
  return node;
}

/* ---- Linkify ----------------------------------------------------------- */

// Web URLs (explicit scheme or www.) and bare email addresses. Deliberately
// narrow: only http(s) ever becomes a clickable scheme, so user text can never
// smuggle a javascript:/data: href into the page.
const LINK_RE = /\bhttps?:\/\/[^\s<>]+|\bwww\.[^\s<>]+|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

/** Sentence punctuation glued to the end of a matched URL ("see x.com/a.")
 *  isn't part of it; nor is a closing paren unless the URL itself opened one
 *  ("wiki/Foo_(bar)" keeps its paren, "(see x.com)" loses it). */
function trimDanglingPunctuation(url) {
  let out = url;
  for (;;) {
    if (/[.,;:!?'"”’»]$/.test(out)) {
      out = out.slice(0, -1);
    } else if (
      out.endsWith(')') &&
      (out.match(/\(/g) || []).length < (out.match(/\)/g) || []).length
    ) {
      out = out.slice(0, -1);
    } else {
      return out;
    }
  }
}

/**
 * Split free-form user text into el()-ready children: plain strings, with each
 * URL / email replaced by a safe anchor (its text is the raw match — never
 * parsed as HTML). Anchors open in a new tab.
 */
export function linkify(text) {
  const s = String(text ?? '');
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(LINK_RE)) {
    const raw = trimDanglingPunctuation(m[0]);
    if (!raw || /^www\.?$/i.test(raw)) continue; // trimmed down to nothing linkable
    if (m.index > last) parts.push(s.slice(last, m.index));
    const href = /^https?:\/\//i.test(raw)
      ? raw
      : raw.toLowerCase().startsWith('www.')
        ? `https://${raw}`
        : `mailto:${raw}`;
    parts.push(
      el('a', {
        class: 'linkified',
        href,
        text: raw,
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
    );
    last = m.index + raw.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
