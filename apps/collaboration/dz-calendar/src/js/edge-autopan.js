/**
 * Auto-pan while dragging near a calendar's edge.
 *
 * When the user holds a dragged event against an edge of the drag region, the
 * calendar should advance to the neighbouring period (so events can be dropped
 * on dates outside the current viewport) or — for the time grid's vertical
 * axis — scroll to reveal earlier/later hours.
 *
 * The watcher is driven by `requestAnimationFrame`, not by pointer movement, so
 * it keeps firing while the finger/cursor is held perfectly still at an edge.
 * The owning drag feeds pointer coordinates through `move(x, y)` on every drag
 * move and calls `stop()` when the gesture ends (drop / cancel).
 *
 * Contract:
 *   getBounds() → a rect ({ left, right, top, bottom }) for the drag region, or
 *                 null when it can't be measured (the watcher then idles).
 *   onPage(dir) → advance the period; dir is -1 (left/top edge) or +1 (right/
 *                 bottom). Called at most once per `PAGE_REPEAT` after an initial
 *                 `PAGE_DWELL` so a quick brush past an edge — or a normal drop
 *                 near it — never pages.
 *   onScroll(dir, px) → optional. When provided, the vertical edges scroll by
 *                 `px` pixels each frame (dir -1 up / +1 down) instead of paging,
 *                 and only the horizontal edges page. Without it (e.g. the month
 *                 grid, which has no scroll axis) all four edges page.
 *
 * Horizontal edges take priority over vertical ones in a corner, so a drag into
 * the corner of the time grid pages the week rather than fighting the scroll.
 */
const ZONE = 40; // px from an edge that arms auto-pan
const PAGE_DWELL = 300; // ms held at an edge before the first page fires
const PAGE_REPEAT = 500; // ms between pages while the edge is held
const SCROLL_MIN = 4; // px/frame at the inner edge of the zone
const SCROLL_MAX = 24; // px/frame at the very edge
const FRAME_MS = 16; // reference frame duration for scroll normalisation

export function createEdgePan({ getBounds, onPage, onScroll } = {}) {
  let x = 0;
  let y = 0;
  let raf = null;
  let running = false;
  let pageDir = 0; // currently armed paging direction (-1 | 0 | 1)
  let armedAt = 0; // timestamp the current paging edge was entered
  let lastPageAt = 0; // timestamp of the last page fired
  let lastFrame = 0;

  function resetPaging() {
    pageDir = 0;
    armedAt = 0;
    lastPageAt = 0;
  }

  // Throttle repeated pages: dwell before the first, then a steady repeat.
  function tryPage(dir, t) {
    if (!onPage) return;
    if (dir !== pageDir) {
      pageDir = dir;
      armedAt = t;
      lastPageAt = 0;
      return; // arm only — dwell must elapse before the first page
    }
    if (t - armedAt >= PAGE_DWELL && t - lastPageAt >= PAGE_REPEAT) {
      lastPageAt = t;
      onPage(dir);
    }
  }

  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(50, t - lastFrame) : FRAME_MS;
    lastFrame = t;

    const r = getBounds();
    if (!r) {
      resetPaging();
      return;
    }

    const hDir = x <= r.left + ZONE ? -1 : x >= r.right - ZONE ? 1 : 0;
    let vDir = 0;
    let vDist = 0;
    if (y <= r.top + ZONE) {
      vDir = -1;
      vDist = r.top + ZONE - y;
    } else if (y >= r.bottom - ZONE) {
      vDir = 1;
      vDist = y - (r.bottom - ZONE);
    }

    // Vertical scroll owns the top/bottom edges when a scroller is wired, but
    // horizontal paging wins the corners.
    if (onScroll && vDir !== 0 && hDir === 0) {
      resetPaging();
      const intensity = Math.min(1, vDist / ZONE);
      onScroll(vDir, (SCROLL_MIN + intensity * (SCROLL_MAX - SCROLL_MIN)) * (dt / FRAME_MS));
      return;
    }

    // Otherwise page: horizontal first, else vertical (only reached when there
    // is no scroll axis, i.e. the month grid pages on all four edges).
    const dir = hDir !== 0 ? hDir : onScroll ? 0 : vDir;
    if (dir === 0) {
      resetPaging();
      return;
    }
    tryPage(dir, t);
  }

  return {
    /** Feed the latest pointer position and start the loop on first call. */
    move(nx, ny) {
      x = nx;
      y = ny;
      if (!running) {
        running = true;
        lastFrame = 0;
        raf = requestAnimationFrame(frame);
      }
    },
    /** Halt the loop and disarm — call on drop and on cancel. */
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      resetPaging();
      lastFrame = 0;
    },
  };
}
