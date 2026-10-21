/** Selection and block helpers for the outline editors. */

export const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, div:not(.outline-body):not(.nt-embed), td, th';
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'DIV', 'TD', 'TH', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TR', 'HR', 'FIGURE']);

export function isBlock(node) {
  return node?.nodeType === 1 && BLOCK_TAGS.has(node.tagName);
}

export function editableRoot(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  return el?.closest?.('.outline-body, .page-title') || null;
}

export function currentRange() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return null;
  return sel.getRangeAt(0);
}

export function selectRange(range) {
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The nearest block ancestor of node inside root (or null at root level). */
export function blockOf(node, root) {
  let n = node?.nodeType === 1 ? node : node?.parentNode;
  while (n && n !== root) {
    if (isBlock(n) && !['UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TR'].includes(n.tagName)) {
      // A <li> or cell may hold <p>s; the inner one is the block.
      return n;
    }
    n = n.parentNode;
  }
  return null;
}

/** Unwraps paragraphs that the browser left wrapped around lists or tables. */
export function fixNesting(root) {
  for (const p of root.querySelectorAll('p, h1, h2, h3, h4, h5, h6')) {
    if (!p.querySelector(':scope > ul, :scope > ol, :scope > table, :scope > blockquote, :scope > pre, :scope > p, :scope > div')) continue;
    const parent = p.parentNode;
    let run = null;
    for (const child of [...p.childNodes]) {
      if (isBlock(child)) {
        run = null;
        parent.insertBefore(child, p);
      } else if (child.nodeType === 3 && !child.nodeValue.trim()) {
        child.remove();
      } else if (child.nodeName === 'BR' && !run) {
        child.remove();
      } else {
        if (!run) {
          run = p.cloneNode(false);
          parent.insertBefore(run, p);
        }
        run.append(child);
      }
    }
    p.remove();
  }
}

/** Wraps stray inline content at the root of an outline body in <p>s. */
export function ensureBlocks(root) {
  fixNesting(root);
  // Stored HTML like <p><ul>..</ul></p> parses into empty <p></p> pairs.
  for (const p of root.querySelectorAll(':scope > p:empty')) if (root.children.length > 1) p.remove();
  let run = null;
  for (const child of [...root.childNodes]) {
    const inline = child.nodeType === 3 || (child.nodeType === 1 && !isBlock(child));
    if (inline) {
      if (child.nodeType === 3 && !child.nodeValue.trim() && !run) {
        if (!child.nodeValue.includes(' ')) {
          child.remove();
          continue;
        }
      }
      if (!run) {
        run = document.createElement('p');
        root.insertBefore(run, child);
      }
      run.append(child);
    } else run = null;
  }
  if (!root.firstChild) {
    const p = document.createElement('p');
    p.append(document.createElement('br'));
    root.append(p);
  }
}

/** The blocks touched by a range, in document order. */
export function blocksInRange(range, root) {
  if (!range || !root.contains(range.commonAncestorContainer)) return [];
  if (range.collapsed) {
    const b = blockOf(range.startContainer, root);
    return b ? [b] : [];
  }
  const found = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === 1 && node.tagName !== 'BR' && node.tagName !== 'IMG' && !node.classList.contains('nt-tag')) return NodeFilter.FILTER_SKIP;
      return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 3 && !n.nodeValue.length) continue;
    // A selection that ends at offset 0 of the next block does not include it.
    if (n === range.endContainer && range.endOffset === 0 && n.nodeType === 3) continue;
    const b = blockOf(n, root);
    if (b) found.add(b);
  }
  if (!found.size) {
    const b = blockOf(range.startContainer, root);
    if (b) found.add(b);
  }
  // Drop blocks that contain another found block (an <li> holding a <p>).
  return [...found].filter((b) => ![...found].some((o) => o !== b && b.contains(o)));
}

/** Character offset of (node, offset) from the start of root. */
export function textOffset(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

/** A range covering [start, end) character offsets inside root. */
export function rangeFromOffsets(root, start, end = start) {
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startSet = false;
  let n;
  let last = null;
  while ((n = walker.nextNode())) {
    const len = n.nodeValue.length;
    if (!startSet && start <= pos + len) {
      range.setStart(n, Math.max(0, start - pos));
      startSet = true;
    }
    if (startSet && end <= pos + len) {
      range.setEnd(n, Math.max(0, end - pos));
      return range;
    }
    pos += len;
    last = n;
  }
  if (last) {
    if (!startSet) range.setStart(last, last.nodeValue.length);
    range.setEnd(last, last.nodeValue.length);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  return range;
}

/** Places the caret at the end (or start) of an element. */
export function placeCaret(el, atEnd = true) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  selectRange(range);
}

export function isEmptyBody(body) {
  if (body.querySelector('img, table, .nt-file, .nt-math, .nt-tag, hr')) return false;
  return !body.textContent.replace(/[​ \s]/g, '');
}
