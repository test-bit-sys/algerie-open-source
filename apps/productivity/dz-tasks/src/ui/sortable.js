/**
 * Pointer-based manual reordering for vertical lists and grids.
 *
 * Mouse/pen: press and move a few pixels to lift. Touch: press and hold
 * (~330ms) to lift — moving first means the user is scrolling, so the
 * gesture is handed back to the browser. While an item is lifted, native
 * scrolling is suppressed (non-passive touchmove) and the item follows the
 * pointer by reordering live in the DOM; drop commits via onDrop with the
 * new neighbors. The click that would fire after a drag is swallowed.
 *
 * Attach once per container; re-rendered children need no re-attachment
 * (all listeners live on the container). Not a keyboard path — callers
 * must offer one separately (e.g. move up/down in a row menu).
 */

const LIFT_DELAY_TOUCH = 330;
const MOVE_THRESHOLD = 6;

export function makeSortable(container, { itemSelector, onDrop, carrySelector = null, grid = false }) {
  let press = null; // { item, carry, x, y, pointerId, timer, lifted, placedFrom }

  const items = () => [...container.querySelectorAll(itemSelector)].filter((el) => el !== press?.item);

  function lift() {
    if (!press || press.lifted) return;
    press.lifted = true;
    // Capture the pointer: a mouse drag that strays (or is released)
    // outside the container must keep delivering its moves and its release
    // here — otherwise the drag wedges with 'sorting' stuck on the body
    // and every later press ignored.
    try { container.setPointerCapture(press.pointerId); } catch { /* pointer already gone */ }
    press.item.classList.add('sortable-dragging');
    document.body.classList.add('sorting');
    // Where it came from, in case the gesture is cancelled. Anchor past
    // the carried element (an expanded subtask strip): that moves with
    // the item, so anchoring on it would leave nothing to insert before
    // and drop the row at the end of the list.
    press.placedFrom = (press.carry || press.item).nextSibling;
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch {} }
  }

  function carryOf(item) {
    const next = item.nextElementSibling;
    return carrySelector && next?.matches(carrySelector) ? next : null;
  }

  /** Insertion point in reading order, tolerant of grid layouts. */
  function targetBefore(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const el of items()) {
      const r = el.getBoundingClientRect();
      const dx = x - Math.max(r.left, Math.min(x, r.right));
      const dy = y - Math.max(r.top, Math.min(y, r.bottom));
      const d = Math.hypot(dx, dy);
      if (d < bestDist) { bestDist = d; best = el; }
    }
    if (!best) return null;
    const r = best.getBoundingClientRect();
    const sameRow = y >= r.top && y <= r.bottom;
    const after = grid && sameRow
      ? x > r.left + r.width / 2
      : y > r.top + r.height / 2;
    if (!after) return best;
    const rest = items();
    return rest[rest.indexOf(best) + 1] || null;
  }

  function reposition(x, y) {
    const before = targetBefore(x, y);
    const group = [press.item, press.carry].filter(Boolean);
    if (before === press.item.nextElementSibling || before === press.item) return;
    for (const el of group) el.remove();
    if (before) before.before(...group);
    else container.append(...group);
  }

  function settle(commit) {
    const { item, carry, lifted, placedFrom } = press;
    clearTimeout(press.timer);
    press = null;
    unbindWindow();
    if (!lifted) return;
    item.classList.remove('sortable-dragging');
    document.body.classList.remove('sorting');
    // The click that follows a completed drag must not activate the row —
    // but if no click arrives (pointer released off-element), the swallower
    // must not linger and eat the next real one.
    const swallow = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    container.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => container.removeEventListener('click', swallow, { capture: true }), 150);
    if (!commit) {
      const group = [item, carry].filter(Boolean);
      for (const el of group) el.remove();
      if (placedFrom && placedFrom.parentNode === container) container.insertBefore(group[0], placedFrom);
      else container.append(group[0]);
      if (carry) group[0].after(carry);
      return;
    }
    // A store change (a remote merge, a collab sync) re-renders the view
    // mid-drag and detaches this container. The visible drag died with
    // it, so the neighbors here describe a DOM the user can no longer
    // see — committing them would save an order nobody chose.
    if (!container.isConnected) return;
    const all = [...container.querySelectorAll(itemSelector)];
    const i = all.indexOf(item);
    if (i < 0) return; // the item itself was replaced by the re-render
    onDrop(item, all[i - 1] || null, all[i + 1] || null);
  }

  // A press that leaves the container before capture kicks in (or before a
  // lift ever happens) would otherwise never see its release and block all
  // future drags — the window catches what the container misses. Bound only
  // while a press is live, so re-rendered containers leak nothing.
  const onWinUp = (e) => { if (press && e.pointerId === press.pointerId) settle(true); };
  const onWinCancel = (e) => { if (press && e.pointerId === press.pointerId) settle(false); };
  function bindWindow() {
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinCancel);
  }
  function unbindWindow() {
    window.removeEventListener('pointerup', onWinUp);
    window.removeEventListener('pointercancel', onWinCancel);
  }

  container.addEventListener('pointerdown', (e) => {
    if (press || e.button !== 0) return;
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    press = {
      item,
      carry: carryOf(item),
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      lifted: false,
      timer: e.pointerType === 'touch' ? setTimeout(lift, LIFT_DELAY_TOUCH) : null,
    };
    bindWindow();
  });

  container.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    if (!press.lifted) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= MOVE_THRESHOLD) return;
      if (e.pointerType === 'touch') {
        // Moved before the hold completed: it's a scroll, not a drag.
        clearTimeout(press.timer);
        press = null;
        unbindWindow();
        return;
      }
      lift();
    }
    reposition(e.clientX, e.clientY);
  });

  container.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    settle(true);
  });

  container.addEventListener('pointercancel', (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    settle(false);
  });

  // Suppress native scrolling only while an item is lifted, and native
  // anchor/image dragging whenever a press might become a sort.
  container.addEventListener('touchmove', (e) => {
    if (press?.lifted) e.preventDefault();
  }, { passive: false });
  container.addEventListener('dragstart', (e) => {
    if (press) e.preventDefault();
  });
}
