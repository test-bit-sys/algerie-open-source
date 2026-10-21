/**
 * Allowlist HTML sanitizer for note content. Everything that reaches an
 * outline (pasted HTML, imported files, stored pages, published snapshots)
 * goes through here, so a page can never carry script, event handlers,
 * frames, forms, or javascript: URLs.
 */

const BLOCK = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'colgroup', 'col', 'hr', 'figure', 'figcaption'];
const INLINE = ['span', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'code', 'mark', 'br', 'img', 'font', 'small', 'kbd', 'cite', 'q', 'abbr'];
const ALLOWED = new Set([...BLOCK, ...INLINE]);
/** Elements whose content is dropped along with the element. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'frame', 'frameset', 'svg', 'math', 'head', 'title', 'meta', 'link', 'button', 'select', 'textarea', 'input', 'form', 'video', 'audio', 'canvas', 'applet', 'base']);

const STYLE_PROPS = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'vertical-align', 'margin-left', 'padding-left', 'width', 'height', 'border', 'border-color', 'text-indent', 'list-style-type']);
const CLASS_ALLOW = /^nt-[a-z0-9-]+$/;
const DATA_ALLOW = new Set(['data-tag', 'data-done', 'data-asset', 'data-name', 'data-size', 'data-type', 'data-tex', 'data-kind', 'data-duration', 'data-tags']);

const ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height', 'title'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span', 'width'],
  ol: ['start', 'type'],
  font: ['color', 'face'],
  abbr: ['title'],
  span: ['contenteditable'],
};

export function safeUrl(url, { image = false } = {}) {
  const s = String(url || '').trim();
  if (!s) return null;
  if (image) {
    if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(s)) return s;
    if (/^blob:/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    return null;
  }
  if (/^#[a-z0-9:/_-]*$/i.test(s)) return s;
  // Strip control characters and whitespace a browser would ignore when
  // resolving the scheme ("java\tscript:").
  // eslint-disable-next-line no-control-regex
  const probe = s.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  if (/^(https?:|mailto:|tel:)/.test(probe)) return s;
  if (!/^[a-z][a-z0-9+.-]*:/.test(probe) && !probe.startsWith('//')) return s; // relative
  return null;
}

function cleanStyle(value) {
  const out = [];
  for (const decl of String(value || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop)) continue;
    if (/url\s*\(|expression\s*\(|javascript:|[<>]|\\/i.test(val)) continue;
    if (val.length > 200) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
}

function cleanElement(el, doc) {
  const tag = el.tagName.toLowerCase();
  const allowed = ATTRS[tag] || [];
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name === 'style') {
      const s = cleanStyle(attr.value);
      if (s) el.setAttribute('style', s);
      else el.removeAttribute('style');
    } else if (name === 'class') {
      const keep = attr.value.split(/\s+/).filter((c) => CLASS_ALLOW.test(c));
      if (keep.length) el.setAttribute('class', keep.join(' '));
      else el.removeAttribute('class');
    } else if (DATA_ALLOW.has(name)) {
      if (attr.value.length > 20000) el.removeAttribute(attr.name);
      // Asset ids become storage paths, so only generated names pass.
      else if (name === 'data-asset' && !/^[a-z0-9]+(\.[a-z0-9]+){1,3}$/i.test(attr.value)) el.removeAttribute(attr.name);
    } else if (allowed.includes(name)) {
      if (name === 'href') {
        const url = safeUrl(attr.value);
        if (url) el.setAttribute('href', url);
        else el.removeAttribute('href');
      } else if (name === 'src') {
        const url = safeUrl(attr.value, { image: true });
        if (url) el.setAttribute('src', url);
        else el.removeAttribute('src');
      } else if (name === 'contenteditable') {
        if (attr.value !== 'false') el.removeAttribute(attr.name);
      }
    } else {
      el.removeAttribute(attr.name);
    }
  }
  if (tag === 'a' && el.hasAttribute('href')) {
    const href = el.getAttribute('href');
    if (!href.startsWith('#')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }
  // <font> from legacy paste becomes a span with equivalent styles.
  if (tag === 'font') {
    const span = doc.createElement('span');
    const styles = [];
    if (el.getAttribute('color')) styles.push(`color: ${el.getAttribute('color')}`);
    if (el.getAttribute('face')) styles.push(`font-family: ${el.getAttribute('face')}`);
    const s = cleanStyle(styles.join(';'));
    if (s) span.setAttribute('style', s);
    while (el.firstChild) span.append(el.firstChild);
    el.replaceWith(span);
    return span;
  }
  return el;
}

function walk(node, doc) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8 /* comment */) {
      child.remove();
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      child.remove();
      continue;
    }
    if (!ALLOWED.has(tag)) {
      // Unknown wrapper (section, article, o:p...): keep its children.
      walk(child, doc);
      const frag = doc.createDocumentFragment();
      while (child.firstChild) frag.append(child.firstChild);
      child.replaceWith(frag);
      continue;
    }
    const cleaned = cleanElement(child, doc);
    walk(cleaned, doc);
  }
}

/** Returns sanitized HTML for the given (untrusted) HTML string. */
export function sanitizeHtml(html) {
  const doc = document.implementation.createHTMLDocument('');
  const container = doc.createElement('div');
  container.innerHTML = String(html ?? '');
  walk(container, doc);
  return container.innerHTML;
}

/** Plain text of an HTML fragment with block boundaries as newlines. */
export function htmlToText(html) {
  const doc = document.implementation.createHTMLDocument('');
  const div = doc.createElement('div');
  div.innerHTML = sanitizeHtml(html);
  const parts = [];
  const blockTags = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'BR', 'HR', 'FIGCAPTION']);
  (function rec(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) parts.push(c.nodeValue);
      else if (c.nodeType === 1) {
        if (c.classList.contains('nt-math')) parts.push(c.dataset.tex || '');
        else if (c.classList.contains('nt-file')) parts.push(c.dataset.name || '');
        else rec(c);
        if (c.tagName === 'TD' || c.tagName === 'TH') parts.push('\t');
        if (blockTags.has(c.tagName)) parts.push('\n');
      }
    }
  })(div);
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
