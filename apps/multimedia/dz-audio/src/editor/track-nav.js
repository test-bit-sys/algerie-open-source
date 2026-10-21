// Vertical track navigator at the right edge of the Multitrack editor: each
// visible track is a segment in its color, sized like its row, under a thumb
// that frames the visible rows. Drag the thumb to scroll, drag its top or
// bottom edge to zoom the track heights, click a segment to scroll there,
// double-click to fit every track. Wheel scrolls like the lanes.

import { h } from '../lib/dom.js';

const EDGE = 5; // px at each end of the thumb that zoom instead of scroll

export class TrackNav {
  /** @param {object} view the MultitrackView (rows, contentHeight, height, scrollY, setScroll, doc) */
  constructor(view) {
    this.view = view;
    this.segs = h('div.mt-vnav-segs');
    this.thumb = h('div.mt-vnav-thumb');
    this.el = h('div.mt-vnav', { role: 'scrollbar', 'aria-orientation': 'vertical', 'aria-label': 'Tracks overview', 'aria-valuemin': '0', 'aria-valuemax': '100', title: 'Drag to scroll, drag an end to zoom, double-click to fit all tracks' }, this.segs, this.thumb);
    this.key = '';
    this.#bind();
  }

  /** Content span the bar maps: the rows, or the viewport when they are shorter. */
  span() {
    return Math.max(1, this.view.contentHeight || 0, this.view.height || 0);
  }

  /** Redraws segments (when rows change) and the thumb. */
  update() {
    const v = this.view;
    const span = this.span();
    const rows = v.rows || [];
    const key = `${span}|${rows.map((r) => `${r.id}:${r.top}:${r.total}:${r.track.color}`).join(',')}`;
    if (key !== this.key) {
      this.key = key;
      this.segs.replaceChildren(
        ...rows.map((r) =>
          h('div.mt-vnav-seg', {
            dataset: { id: r.id },
            style: { top: `${(r.top / span) * 100}%`, height: `${(r.total / span) * 100}%`, '--track-color': r.track.color },
          }),
        ),
      );
    }
    const top = (v.scrollY || 0) / span;
    const size = Math.min(1, (v.height || 0) / span);
    this.thumb.style.top = `${top * 100}%`;
    this.thumb.style.height = `${size * 100}%`;
    const max = Math.max(1, span - (v.height || 0));
    this.el.setAttribute('aria-valuenow', String(Math.round(((v.scrollY || 0) / max) * 100)));
  }

  #bind() {
    const v = this.view;
    let drag = null;
    const px = () => this.el.getBoundingClientRect();
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = px();
      if (!r.height) return;
      const scale = this.span() / r.height;
      const t = this.thumb.getBoundingClientRect();
      if (e.clientY >= t.top && e.clientY <= t.bottom) {
        const edge = e.clientY - t.top < EDGE ? 'top' : t.bottom - e.clientY < EDGE ? 'bottom' : null;
        drag = { y: e.clientY, scroll: v.scrollY, scale, edge, amp: v.doc.view.amp || 1, top: t.top - r.top, bottom: t.bottom - r.top };
      } else {
        // Jump: centre the viewport on the clicked spot, then keep dragging.
        v.setScroll((e.clientY - r.top) * scale - v.height / 2);
        drag = { y: e.clientY, scroll: v.scrollY, scale, edge: null };
      }
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!drag) {
        const t = this.thumb.getBoundingClientRect();
        const near = e.clientY >= t.top && e.clientY <= t.bottom && (e.clientY - t.top < EDGE || t.bottom - e.clientY < EDGE);
        this.el.style.cursor = near ? 'ns-resize' : '';
        return;
      }
      const dy = e.clientY - drag.y;
      if (!drag.edge) {
        v.setScroll(drag.scroll + dy * drag.scale);
        return;
      }
      // Dragging an end resizes the thumb: a smaller thumb shows fewer rows, so tracks grow.
      const top = drag.edge === 'top' ? Math.min(drag.bottom - 8, drag.top + dy) : drag.top;
      const bottom = drag.edge === 'bottom' ? Math.max(drag.top + 8, drag.bottom + dy) : drag.bottom;
      const before = drag.bottom - drag.top;
      const after = Math.max(8, bottom - top);
      v.doc.setAmp(drag.amp * (before / after));
      const ratio = (v.doc.view.amp || 1) / drag.amp;
      v.computeRows();
      // Keep the rows at the thumb's fixed end in place.
      if (drag.edge === 'top') v.setScroll((drag.scroll + v.height) * ratio - v.height);
      else v.setScroll(drag.scroll * ratio);
    });
    const end = () => (drag = null);
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('dblclick', () => v.app.commands.run('view.zoomOutAllTracks'));
    this.el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        v.scrollBy(e.deltaY);
      },
      { passive: false },
    );
  }
}
