/**
 * Rich text inside one block is a Y.Text with formatting attributes:
 *   bold, italic, underline, strike, code: true
 *   link: 'https://...'        page: '<page id>' (a link to another page)
 *   color: 'red' | ...         bg: 'yellow' | ...
 *
 * The editor shows it in a contenteditable element. These helpers convert
 * between that DOM, deltas ([{ insert, attributes }]) and HTML, apply what
 * the person typed to the Y.Text as a minimal change (so two people typing
 * in the same block both keep their words), and map caret positions.
 */
import { COLORS, safeUrl, escapeHtml } from '../lib/sanitize.js';

export const MARKS = ['bold', 'italic', 'underline', 'strike', 'code'];
const TAG_MARK = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline', s: 'strike', strike: 'strike', del: 'strike', code: 'code' };
const MARK_TAG = { bold: 'b', italic: 'i', underline: 'u', strike: 's', code: 'code' };

/** Attributes picked up from one element. Unknown styling is ignored. */
function attrsOfElement(el, inherited) {
  const tag = el.tagName.toLowerCase();
  const a = { ...inherited };
  if (TAG_MARK[tag]) a[TAG_MARK[tag]] = true;
  if (tag === 'a') {
    const page = el.getAttribute('data-page');
    if (page && /^[a-z0-9]{1,40}$/.test(page)) a.page = page;
    else {
      const href = safeUrl(el.getAttribute('href'));
      if (href) a.link = href;
    }
  }
  const color = el.getAttribute?.('data-color');
  if (color && COLORS.includes(color)) a.color = color;
  const bg = el.getAttribute?.('data-bg');
  if (bg && COLORS.includes(bg)) a.bg = bg;
  // Formatting a browser may produce on its own (execCommand, paste).
  const style = el.style;
  if (style) {
    const weight = style.fontWeight;
    if (weight === 'bold' || Number(weight) >= 600) a.bold = true;
    if (style.fontStyle === 'italic') a.italic = true;
    const deco = `${style.textDecoration} ${style.textDecorationLine}`;
    if (deco.includes('underline')) a.underline = true;
    if (deco.includes('line-through')) a.strike = true;
  }
  return a;
}

function pushOp(ops, text, attrs) {
  if (!text) return;
  const clean = normalizeAttrs(attrs);
  const last = ops.at(-1);
  if (last && sameAttrs(last.attributes, clean)) last.insert += text;
  else ops.push(clean ? { insert: text, attributes: clean } : { insert: text });
}

const PAGE_ID = /^[a-z0-9]{1,40}$/;

/**
 * Only formatting the app knows, with safe values. Text from a shared
 * document is untrusted: anyone who can edit it (or a worker that serves it)
 * could put a javascript: link or an odd color name in an attribute.
 */
export function cleanAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return undefined;
  const out = {};
  for (const m of MARKS) if (attrs[m] === true) out[m] = true;
  if (typeof attrs.page === 'string' && PAGE_ID.test(attrs.page)) out.page = attrs.page;
  else if (typeof attrs.link === 'string') {
    const url = safeUrl(attrs.link);
    if (url) out.link = url;
  }
  if (COLORS.includes(attrs.color)) out.color = attrs.color;
  if (COLORS.includes(attrs.bg)) out.bg = attrs.bg;
  return Object.keys(out).length ? out : undefined;
}

/** A delta with only text inserts and clean attributes. */
export function cleanDelta(delta) {
  if (!Array.isArray(delta)) return [];
  const out = [];
  for (const op of delta) {
    if (!op || typeof op.insert !== 'string' || !op.insert) continue;
    const attributes = cleanAttrs(op.attributes);
    out.push(attributes ? { insert: op.insert, attributes } : { insert: op.insert });
  }
  return out;
}

export function normalizeAttrs(attrs) {
  if (!attrs) return undefined;
  const out = {};
  for (const k of Object.keys(attrs).sort()) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function sameAttrs(a, b) {
  return attrKey(a) === attrKey(b);
}

function attrKey(a) {
  const n = normalizeAttrs(a);
  return n ? JSON.stringify(n) : '';
}

/** Delta for the content of an element (contenteditable or parsed HTML). */
export function domToDelta(root) {
  const ops = [];
  const walk = (node, attrs) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) pushOp(ops, child.data.replace(/\u200b/g, ''), attrs);
      else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          pushOp(ops, '\n', attrs);
          continue;
        }
        if (['script', 'style', 'template'].includes(tag)) continue;
        const before = ops.length;
        walk(child, attrsOfElement(child, attrs));
        // Block-level elements inside a block (from a paste) become line breaks.
        if (['div', 'p', 'li'].includes(tag) && child.nextSibling && ops.length > before) pushOp(ops, '\n', attrs);
      }
    }
  };
  walk(root, undefined);
  // contenteditable ends a block with a <br> that only keeps the last line
  // visible ("text<br>", or "<br>" in an empty block); it is not content.
  let last = root.lastChild;
  while (last && last.nodeType === 1 && last.nodeName !== 'BR' && last.lastChild) last = last.lastChild;
  const op = ops.at(-1);
  if (last?.nodeName === 'BR' && op?.insert.endsWith('\n')) {
    op.insert = op.insert.slice(0, -1);
    if (!op.insert) ops.pop();
  }
  return ops;
}

export function deltaText(delta) {
  return delta.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
}

/** Builds DOM nodes for a delta into a parent element. */
export function renderDelta(parent, delta, { pageTitle } = {}) {
  const doc = parent.ownerDocument;
  parent.replaceChildren();
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;
    const a = cleanAttrs(op.attributes) || {};
    const parts = op.insert.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) parent.append(doc.createElement('br'));
      if (!part) return;
      let node = doc.createTextNode(part);
      if (a.bg) node = wrap(doc, 'mark', node, { 'data-bg': a.bg });
      if (a.color) node = wrap(doc, 'span', node, { 'data-color': a.color });
      for (const m of ['strike', 'underline', 'italic', 'bold', 'code']) if (a[m]) node = wrap(doc, MARK_TAG[m], node);
      if (a.page) {
        node = wrap(doc, 'a', node, { 'data-page': a.page, href: `#${a.page}`, class: 'page-link' });
        if (pageTitle) node.title = pageTitle(a.page);
      } else if (a.link) node = wrap(doc, 'a', node, { href: a.link, target: '_blank', rel: 'noopener noreferrer' });
      parent.append(node);
    });
  }
  // An empty last line (text ending in a newline) needs a <br> to be shown.
  if (parent.lastChild?.nodeName === 'BR') {
    const keep = doc.createElement('br');
    keep.setAttribute('data-ui', '');
    parent.append(keep);
  }
}

function wrap(doc, tag, child, attrs = {}) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(child);
  return el;
}

export function deltaToHtml(delta) {
  let html = '';
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;
    const a = cleanAttrs(op.attributes) || {};
    let s = escapeHtml(op.insert).replace(/\n/g, '<br>');
    if (a.bg) s = `<mark data-bg="${a.bg}">${s}</mark>`;
    if (a.color) s = `<span data-color="${a.color}">${s}</span>`;
    for (const m of ['strike', 'underline', 'italic', 'bold', 'code']) if (a[m]) s = `<${MARK_TAG[m]}>${s}</${MARK_TAG[m]}>`;
    if (a.page) s = `<a data-page="${escapeHtml(a.page)}" href="#${escapeHtml(a.page)}">${s}</a>`;
    else if (a.link) s = `<a href="${escapeHtml(a.link)}">${s}</a>`;
    html += s;
  }
  return html;
}

export function htmlToDelta(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  return domToDelta(doc.body);
}

/** One entry per character: [char, attributes]. */
function expand(delta) {
  const out = [];
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;
    for (const ch of op.insert) out.push([ch, normalizeAttrs(op.attributes)]);
  }
  return out;
}

/**
 * Applies the difference between a Y.Text and a new delta to the Y.Text.
 * Unchanged text at the start and end is kept as is, so concurrent edits
 * elsewhere in the block survive; formatting changes become format calls.
 * Call inside a transaction.
 */
export function applyDelta(ytext, next) {
  const before = expand(ytext.toDelta());
  const after = expand(next);
  // Compare by UTF-16 units, the way Y.Text counts.
  const unitLen = (chars) => chars.reduce((n, [c]) => n + c.length, 0);
  let p = 0;
  while (p < before.length && p < after.length && before[p][0] === after[p][0]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s][0] === after[after.length - 1 - s][0]) s++;
  const start = unitLen(before.slice(0, p));
  const removed = unitLen(before.slice(p, before.length - s));
  if (removed) ytext.delete(start, removed);
  // Insert the new middle in runs of equal formatting.
  let pos = start;
  const middle = after.slice(p, after.length - s);
  let i = 0;
  while (i < middle.length) {
    const key = attrKey(middle[i][1]);
    let text = '';
    let j = i;
    while (j < middle.length && attrKey(middle[j][1]) === key) text += middle[j++][0];
    ytext.insert(pos, text, explicit(middle[i][1]));
    pos += text.length;
    i = j;
  }
  // Formatting changes in the unchanged parts.
  const reformat = (fromBefore, fromAfter, count, offset) => {
    let k = 0;
    while (k < count) {
      const want = after[fromAfter + k][1];
      if (attrKey(before[fromBefore + k][1]) === attrKey(want)) {
        offset += after[fromAfter + k][0].length;
        k++;
        continue;
      }
      let len = 0;
      const startAt = offset;
      const old = before[fromBefore + k][1];
      while (k < count && attrKey(after[fromAfter + k][1]) === attrKey(want) && attrKey(before[fromBefore + k][1]) === attrKey(old) && attrKey(old) !== attrKey(want)) {
        len += after[fromAfter + k][0].length;
        k++;
      }
      ytext.format(startAt, len, diffAttrs(old, want));
      offset += len;
    }
  };
  reformat(0, 0, p, 0);
  reformat(before.length - s, after.length - s, s, pos);
}

/** Attributes to pass to insert so nothing is inherited from the left. */
function explicit(attrs) {
  return { bold: null, italic: null, underline: null, strike: null, code: null, link: null, page: null, color: null, bg: null, ...(attrs || {}) };
}

function diffAttrs(old = {}, want = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(old || {}), ...Object.keys(want || {})])) {
    const w = want?.[k];
    if (w === undefined) out[k] = null;
    else if (old?.[k] !== w) out[k] = w;
  }
  return out;
}

/** Formatting shared by every character in [start, end), for toolbar state. */
export function formatAt(ytext, start, end) {
  const chars = expand(ytext.toDelta());
  let units = 0;
  const picked = [];
  for (const [c, a] of chars) {
    const at = units;
    units += c.length;
    if (end > start ? at >= start && at < end : at === start - 1) picked.push(a || {});
  }
  if (!picked.length) return {};
  const out = {};
  for (const k of [...MARKS, 'link', 'page', 'color', 'bg']) {
    const v = picked[0][k];
    if (v !== undefined && picked.every((a) => a[k] === v)) out[k] = v;
  }
  return out;
}

/** Splits a delta at a character offset. */
export function splitDelta(delta, offset) {
  const left = [];
  const right = [];
  let n = 0;
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;
    const len = op.insert.length;
    if (n + len <= offset) left.push(op);
    else if (n >= offset) right.push(op);
    else {
      const cut = offset - n;
      left.push({ ...op, insert: op.insert.slice(0, cut) });
      right.push({ ...op, insert: op.insert.slice(cut) });
    }
    n += len;
  }
  return [left, right];
}

/* ---------- caret positions inside a contenteditable element ---------- */

function nodeLength(node) {
  if (node.nodeType === 3) return node.data.length;
  if (node.nodeName === 'BR') return node.hasAttribute('data-ui') ? 0 : 1;
  if (node.nodeType === 1 && node.hasAttribute('data-ui')) return 0;
  let n = 0;
  for (const c of node.childNodes) n += nodeLength(c);
  return n;
}

/** Text offset of a DOM point within root, or -1 if outside. */
export function offsetOf(root, node, offset) {
  if (!root.contains(node)) return -1;
  let total = 0;
  const walk = (cur) => {
    if (cur === node) {
      if (cur.nodeType === 3) total += offset;
      else for (let i = 0; i < offset && i < cur.childNodes.length; i++) total += nodeLength(cur.childNodes[i]);
      return true;
    }
    if (cur.nodeType === 3 || cur.nodeName === 'BR') {
      total += nodeLength(cur);
      return false;
    }
    for (const c of cur.childNodes) if (walk(c)) return true;
    return false;
  };
  for (const c of root.childNodes) if (walk(c)) return total;
  return total;
}

export function textLength(root) {
  return nodeLength(root);
}

/** {start, end} of the selection inside root, or null. */
export function getSelectionOffsets(root) {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const a = offsetOf(root, r.startContainer, r.startOffset);
  const b = offsetOf(root, r.endContainer, r.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** The DOM point at a text offset. */
export function pointAt(root, target) {
  let remaining = Math.max(0, target);
  const walk = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType === 3) {
        if (remaining <= c.data.length) return [c, remaining];
        remaining -= c.data.length;
      } else if (c.nodeName === 'BR') {
        if (c.hasAttribute('data-ui')) continue;
        if (remaining === 0) return [node, i];
        remaining -= 1;
        if (remaining === 0 && !c.nextSibling) return [node, i + 1];
      } else if (c.nodeType === 1) {
        const len = nodeLength(c);
        if (remaining <= len && len > 0) {
          const found = walk(c);
          if (found) return found;
        }
        remaining -= len;
      }
    }
    return null;
  };
  return walk(root) || [root, root.childNodes.length - (root.lastChild?.hasAttribute?.('data-ui') ? 1 : 0)];
}

export function setSelectionOffsets(root, start, end = start) {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;
  const range = doc.createRange();
  const [sn, so] = pointAt(root, start);
  const [en, eo] = end === start ? [sn, so] : pointAt(root, end);
  try {
    range.setStart(sn, so);
    range.setEnd(en, eo);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* the element changed under us; leave the caret where it is */
  }
}

/* ---------- inline Markdown ---------- */

export function deltaToMarkdown(delta) {
  let out = '';
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;
    const a = cleanAttrs(op.attributes) || {};
    let s = op.insert;
    if (a.code) s = `\`${s}\``;
    else s = s.replace(/([\\*_`[\]~])/g, '\\$1');
    if (!s.trim()) {
      out += s;
      continue;
    }
    const lead = s.match(/^\s*/)[0];
    const tail = s.match(/\s*$/)[0];
    let core = s.slice(lead.length, s.length - tail.length);
    {
      if (a.bold) core = `**${core}**`;
      if (a.italic) core = `*${core}*`;
      if (a.strike) core = `~~${core}~~`;
      if (a.link) core = `[${core}](${a.link})`;
      else if (a.page) core = `[${core}](#${a.page})`;
    }
    out += lead + core + tail;
  }
  return out.replace(/\n/g, '  \n');
}

/** Inline Markdown (bold, italic, strike, code, links) to a delta. */
export function markdownToDelta(text) {
  const ops = [];
  const re = /\\([\\*_`[\]~])|`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  const parse = (src, attrs) => {
    let last = 0;
    let m;
    const local = new RegExp(re.source, 'g');
    while ((m = local.exec(src))) {
      if (m.index > last) pushOp(ops, src.slice(last, m.index), attrs);
      if (m[1]) pushOp(ops, m[1], attrs);
      else if (m[2] !== undefined) pushOp(ops, m[2], { ...attrs, code: true });
      else if (m[3] !== undefined || m[4] !== undefined) parse(m[3] ?? m[4], { ...attrs, bold: true });
      else if (m[5] !== undefined) parse(m[5], { ...attrs, strike: true });
      else if (m[6] !== undefined || m[7] !== undefined) parse(m[6] ?? m[7], { ...attrs, italic: true });
      else if (m[8] !== undefined) {
        const target = m[9];
        const page = /^#([a-z0-9]{1,40})$/.exec(target)?.[1];
        const link = page ? null : safeUrl(target);
        parse(m[8], page ? { ...attrs, page } : link ? { ...attrs, link } : attrs);
      }
      last = local.lastIndex;
    }
    if (last < src.length) pushOp(ops, src.slice(last), attrs);
  };
  parse(String(text ?? '').replace(/ {2}\n/g, '\n'), undefined);
  return ops;
}
