/** Caret geometry helpers for moving between blocks with the arrow keys. */

export function caretRect() {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length) return rects[0];
  // An empty line has no rect of its own; use a temporary marker.
  const marker = document.createElement('span');
  marker.textContent = '​';
  range.insertNode(marker);
  const r = marker.getBoundingClientRect();
  const parent = marker.parentNode;
  marker.remove();
  parent?.normalize?.();
  return r;
}

function lineHeight(el) {
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  return Number.isFinite(lh) ? lh : 22;
}

export function onFirstLine(el) {
  const r = caretRect();
  if (!r || (!r.top && !r.bottom)) return true;
  return r.top - el.getBoundingClientRect().top < lineHeight(el) * 0.8;
}

export function onLastLine(el) {
  const r = caretRect();
  if (!r || (!r.top && !r.bottom)) return true;
  return el.getBoundingClientRect().bottom - r.bottom < lineHeight(el) * 0.8;
}

/** Puts the caret in el at screen x, on its first or last line. */
export function placeCaretAtX(el, x, fromAbove) {
  const rect = el.getBoundingClientRect();
  const y = fromAbove ? rect.top + Math.min(8, rect.height / 2) : rect.bottom - Math.min(8, rect.height / 2);
  const cx = Math.max(rect.left + 1, Math.min(x, rect.right - 1));
  let range = null;
  if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(cx, y);
  else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(cx, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
  }
  el.focus({ preventScroll: true });
  if (range && el.contains(range.startContainer)) {
    range.collapse(true);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  return false;
}
