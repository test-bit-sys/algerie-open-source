/**
 * Allowlist sanitizer for the inline rich text inside a block. Pages can be
 * shared with other people, so everything that reaches the editor (stored
 * pages, pasted HTML, imported Markdown) passes through here: no scripts,
 * no event handlers, no styles, no unknown elements, and only safe links.
 */

const INLINE = {
  b: [], strong: [], i: [], em: [], u: [], s: [], strike: [], del: [], code: [], br: [],
  a: ['href', 'data-page'],
  span: ['data-color', 'data-bg'],
  mark: ['data-bg'],
};
/** Normalize synonyms so stored text stays small and predictable. */
const RENAME = { strong: 'b', em: 'i', strike: 's', del: 's' };
const DROP_WITH_CONTENT = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'head', 'title', 'meta', 'link', 'button', 'select', 'textarea', 'input', 'form', 'video', 'audio', 'canvas', 'base']);
/** Elements that end a line when pasted HTML is flattened to one block. */
const LINE_BREAKING = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr']);

export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export function safeUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return null;
  // Browsers ignore control characters and whitespace inside a scheme
  // ("java\tscript:"), so check the scheme with them removed.
  // eslint-disable-next-line no-control-regex
  const probe = s.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
  if (/^(https?:|mailto:|tel:)/.test(probe)) return s;
  if (/^#[\w:/=-]*$/.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/.test(probe) || probe.startsWith('//')) return null;
  // A bare domain typed into the link field.
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(s)) return `https://${s}`;
  return null;
}

function cleanNode(node, doc, out) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) {
      out.append(doc.createTextNode(child.data));
      continue;
    }
    if (child.nodeType !== 1) continue;
    let tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) continue;
    if (!(tag in INLINE)) {
      // Unknown wrapper: keep its text, and keep a line break where a block ended.
      cleanNode(child, doc, out);
      if (LINE_BREAKING.has(tag) && child.nextSibling) out.append(doc.createElement('br'));
      continue;
    }
    tag = RENAME[tag] || tag;
    const el = doc.createElement(tag);
    for (const name of INLINE[tag] || []) {
      const value = child.getAttribute(name);
      if (value == null) continue;
      if (name === 'href') {
        const url = safeUrl(value);
        if (url) el.setAttribute('href', url);
      } else if (name === 'data-page') {
        if (/^[a-z0-9]{1,40}$/.test(value)) el.setAttribute(name, value);
      } else if (name === 'data-color' || name === 'data-bg') {
        if (COLORS.includes(value)) el.setAttribute(name, value);
      }
    }
    if (tag === 'a') {
      if (!el.hasAttribute('href') && !el.hasAttribute('data-page')) {
        cleanNode(child, doc, out);
        continue;
      }
      if (el.hasAttribute('href')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
    // A span or mark that lost its color is just text.
    if ((tag === 'span' || tag === 'mark') && !el.attributes.length) {
      cleanNode(child, doc, out);
      continue;
    }
    if (tag !== 'br') cleanNode(child, doc, el);
    out.append(el);
  }
}

let parser;
function parse(html) {
  parser ||= new DOMParser();
  return parser.parseFromString(`<!doctype html><body>${html}`, 'text/html');
}

/** Sanitized inline HTML for one block. */
export function sanitizeInline(html) {
  const src = String(html ?? '');
  if (!src) return '';
  // Plain text needs no parse; escape it so it is stored as markup.
  if (!/[<&]/.test(src)) return src.replace(/>/g, '&gt;');
  const doc = parse(src);
  const out = doc.createElement('div');
  cleanNode(doc.body, doc, out);
  let result = out.innerHTML;
  // contenteditable leaves a trailing <br> in an emptied block.
  result = result.replace(/(<br>)+$/, '');
  return result;
}

/** The text of a piece of inline HTML. */
export function textOf(html) {
  const src = String(html ?? '');
  if (!/[<&]/.test(src)) return src;
  const doc = parse(src.replace(/<br\s*\/?>/gi, '\n'));
  return doc.body.textContent || '';
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
