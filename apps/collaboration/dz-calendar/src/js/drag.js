/**
 * Pointer-drag lifecycle shared by the calendar views.
 *
 * A press becomes a drag once the pointer travels past `DRAG_THRESHOLD`
 * (mouse / pen) or is held past `TOUCH_HOLD_MS` (touch), so ordinary clicks and
 * taps still open the event while a touch *swipe* is left to the browser and
 * keeps scrolling the grid. Callbacks receive the originating pointer event,
 * leaving all hit-testing / geometry to the caller:
 *
 *   onStart(pointerEvent, origin)  – once, when the drag begins; `origin` is the
 *                                    `{x, y}` of the initial press, so callers can
 *                                    anchor a grab offset without threshold skew
 *   onMove(pointerEvent)   – on every move while dragging
 *   onDrop(pointerEvent)   – on release after a real drag
 *   onCancel()             – if the drag is abandoned (Esc / pointercancel)
 *
 * `canStart(pointerEvent)` is an optional guard checked on pointerdown: return
 * false to ignore the press entirely (e.g. it landed on a child with its own
 * gesture). It never runs after the press is accepted.
 *
 * Touch specifics: the drag activates on a long-press rather than travel, so a
 * quick tap still fires the caller's click and a scroll swipe (movement before
 * the hold elapses) is handed back to the browser. Once a touch drag is active a
 * non-passive `touchmove` listener suppresses page scrolling, and a capture
 * `contextmenu` listener swallows the long-press menu the OS would otherwise
 * raise mid-drag.
 *
 * Returns a `detach()` that removes the pointerdown listener.
 */
export const DRAG_THRESHOLD = 4; // px of travel before a press counts as a drag (mouse/pen)
const TOUCH_HOLD_MS = 320; // press duration before a touch counts as a drag
const TOUCH_SCROLL_TOL = 10; // px of touch travel that means "scroll", abandoning the press

// At most one gesture may be *active* (past the threshold/hold) across every
// draggable() instance. Without this, two fingers can drive two drags at once —
// each with its own window listeners, `is-dragging` toggling, and edge-pan loop
// — so the first release clears the shared `is-dragging` flag out from under the
// second drag (defeating the mid-drag render guards) and a held corner pages by
// the sum of both directions. The lock is released on every terminal path.
let dragActive = false;

// Told when any gesture ends — after its onDrop / onCancel has run — so work
// that was held back for the drag's sake (the app's re-renders, which would
// tear down the nodes a gesture measures) can catch up. A gesture that never
// crossed the threshold was a click and notifies nobody.
const endListeners = new Set();
export function onDragEnd(fn) {
  endListeners.add(fn);
  return () => endListeners.delete(fn);
}
function notifyDragEnd() {
  for (const fn of [...endListeners]) {
    try {
      fn();
    } catch {
      /* one listener's failure must not silence the rest */
    }
  }
}

export function draggable(handle, { onStart, onMove, onDrop, onCancel, canStart } = {}) {
  let active = false; // past the threshold / hold
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let isTouch = false;
  let holdTimer = null;
  let lastEvent = null; // most recent pointer event, so the hold timer starts the drag at the current spot

  function clearHold() {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  // While a touch drag is active, block the browser's own scrolling and the
  // long-press context menu. Non-passive so preventDefault takes effect; added
  // only once the long-press activates (the finger has been still, so scrolling
  // hasn't begun and the move is still cancelable).
  function blockTouchScroll(e) {
    if (active) e.preventDefault();
  }
  function blockContextMenu(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function begin(e) {
    if (dragActive) return; // another draggable already owns the active gesture
    // A re-render between the press and the moment the gesture becomes a drag
    // — a store change, the minute tick, a second finger paging the view during
    // a touch hold — replaces the handle with a fresh node and leaves this one
    // detached. Its geometry then reads as zeros, and a drag measured from it
    // commits a move hours from where the pointer is. Nothing to drag: hand
    // the gesture back to the browser.
    if (!handle.isConnected) {
      releaseTracking();
      return;
    }
    dragActive = true;
    active = true;
    document.body.classList.add('is-dragging');
    if (isTouch) {
      window.addEventListener('touchmove', blockTouchScroll, { passive: false, capture: true });
      window.addEventListener('contextmenu', blockContextMenu, true);
    }
    onStart?.(e, { x: startX, y: startY });
  }

  function onPointerDown(e) {
    // A gesture is already being tracked (its window listeners are live): ignore
    // any additional pointer so a second finger can't hijack pointerId and
    // re-fire onStart, orphaning the first drag's ghost. `finish` clears
    // pointerId, so this never wedges a completed gesture.
    if (pointerId != null) return;
    // Primary button / touch / pen only — never right-click or modified clicks.
    if (e.button != null && e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (canStart && !canStart(e)) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    active = false;
    isTouch = e.pointerType === 'touch';
    lastEvent = e;
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('keydown', onKey, true);
    if (isTouch) {
      // Long-press to begin a touch drag: a quick tap still clicks, and a swipe
      // (handled in onPointerMove) is left to the browser to scroll.
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (pointerId != null && !active) begin(lastEvent);
      }, TOUCH_HOLD_MS);
    }
  }

  function onPointerMove(e) {
    if (e.pointerId !== pointerId) return;
    lastEvent = e;
    if (!active) {
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (isTouch) {
        // Travel before the hold fires means the user is scrolling: abandon the
        // press and hand the gesture back to the browser (never preventDefault).
        if (holdTimer !== null && (dx > TOUCH_SCROLL_TOL || dy > TOUCH_SCROLL_TOL)) {
          releaseTracking();
        }
        return;
      }
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      begin(e);
      if (!active) return; // begin() refused: another gesture owns the drag
    }
    e.preventDefault(); // suppress text selection / native drag while moving
    onMove?.(e);
  }

  /** Remove every listener without treating the gesture as a drag — used when a
   *  touch turns out to be a scroll, so the browser owns the gesture from here. */
  function releaseTracking() {
    clearHold();
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('touchmove', blockTouchScroll, { capture: true });
    window.removeEventListener('contextmenu', blockContextMenu, true);
    pointerId = null;
  }

  function finish(commit, e) {
    clearHold();
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('touchmove', blockTouchScroll, { capture: true });
    window.removeEventListener('contextmenu', blockContextMenu, true);
    pointerId = null;
    if (!active) return; // never crossed the threshold / hold: leave it as a click
    active = false;
    dragActive = false;
    document.body.classList.remove('is-dragging');
    if (commit) {
      onDrop?.(e);
      suppressNextClick();
    } else {
      onCancel?.();
    }
    notifyDragEnd();
  }

  function onPointerUp(e) {
    if (e.pointerId === pointerId) finish(true, e);
  }
  function onPointerCancel(e) {
    if (e.pointerId === pointerId) finish(false, e);
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (!active) {
      finish(false, e);
      return;
    }
    // Cancel the in-flight gesture now, but the pointer is still down: keep
    // watching for its release so we can swallow the click it would synthesize
    // if it lands back on the origin element (which would re-open the event).
    active = false;
    dragActive = false;
    document.body.classList.remove('is-dragging');
    onCancel?.();
    notifyDragEnd();
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('touchmove', blockTouchScroll, { capture: true });
    window.removeEventListener('contextmenu', blockContextMenu, true);
    const onReleaseAfterCancel = (ev) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointerup', onReleaseAfterCancel, true);
      window.removeEventListener('pointercancel', onReleaseAfterCancel, true);
      pointerId = null;
      suppressNextClick();
    };
    window.addEventListener('pointerup', onReleaseAfterCancel, true);
    window.addEventListener('pointercancel', onReleaseAfterCancel, true);
  }

  handle.addEventListener('pointerdown', onPointerDown);
  return () => handle.removeEventListener('pointerdown', onPointerDown);
}

/**
 * Swallow the single `click` the browser synthesizes after a drag, so the
 * release doesn't also open the event or create one in the drop target. A
 * capture-phase window listener catches it before any target handler; the
 * timeout clears the trap if no click follows (e.g. touch releases).
 */
function suppressNextClick() {
  const onClick = (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    window.removeEventListener('click', onClick, true);
  };
  window.addEventListener('click', onClick, true);
  setTimeout(() => window.removeEventListener('click', onClick, true), 0);
}
