/**
 * Field placement on rendered pages: with a field type armed, tap to drop it
 * at a default size or drag to draw it to size. Drag to move, corner handle
 * to resize, arrow keys to nudge, Delete to remove, Escape to cancel.
 * Geometry lives in page fractions (model.js), so nothing here depends on
 * render scale.
 *
 * Several fields can be selected at once (shift-click each one), and then they
 * move together; arrow keys nudge, with shift or alt held for a bigger step.
 * While one is being dragged or resized it snaps to the edges and centres of
 * the others on the page, and to a light grid otherwise, with a guide line
 * drawn on whatever it lined up with — matching two fields by eye was the
 * slowest part of laying out a form.
 */

import { el, clear } from './dom.js';
import { icon, FIELD_ICONS } from './icons.js';
import {
  makeField, clampField, fieldLabel, signerColor, MIN_FIELD, snapPosition, snapSize, shiftFields,
} from '../lib/model.js';
import { mountPages, positionBox } from './pages.js';
import { clamp } from '../lib/util.js';

/* Pointer travel (px) that turns an armed tap into drawing a box. */
const DRAW_THRESHOLD = 5;

export function mountFieldEditor({
  container,
  pdf,
  doc,
  onChange, // (doc) => void, called after any field mutation
  onSelect = () => {}, // (field | null)
  getArmed = () => null, // () => field type armed for placement, or null
  getSigner = () => null, // () => signerId new fields belong to
  canPlace = () => true, // () => false to refuse a new field (and say why)
  onPlaced = () => {},
  onPageEnter = null, // (index) => void, the page the reader is looking at
  onGeometry = () => {}, // (field) => void, live during a resize
}) {
  container.classList.add('editor-pages');
  const pagesApi = mountPages({ container, pdf, pageCount: doc.pageCount, onActive: (index) => {
    activePage = index;
    onPageEnter?.(index);
  } });
  // The last field touched is the "primary" one: the reference for aligning
  // and matching, and the one the single-field toolbar describes.
  let selectedId = null;
  const selection = new Set();
  let activePage = 0;
  const placementAborts = new Set();

  function fieldsOn(page) {
    return doc.fields.filter((f) => f.page === page);
  }

  function boxNode(fieldId) {
    return container.querySelector(`[data-fid="${fieldId}"]`);
  }

  /** The selected fields, primary first, in the order the document holds them. */
  function selectedFields() {
    const primary = doc.fields.find((f) => f.id === selectedId);
    const rest = doc.fields.filter((f) => selection.has(f.id) && f.id !== selectedId);
    return primary ? [primary, ...rest] : rest;
  }

  /**
   * Retag the selection ring without rebuilding boxes: a rebuild would
   * replace the node mid-gesture and drop both pointer capture and keyboard
   * focus. Used alone on pointerdown so the toolbar (which shifts layout)
   * only appears once the gesture ends.
   */
  function markSelected(fieldId, { additive = false } = {}) {
    if (!fieldId) {
      selection.clear();
      selectedId = null;
    } else if (additive) {
      if (selection.has(fieldId) && selection.size > 1) {
        selection.delete(fieldId);
        if (selectedId === fieldId) selectedId = [...selection][selection.size - 1] || null;
      } else {
        selection.add(fieldId);
        selectedId = fieldId;
      }
    } else {
      selection.clear();
      selection.add(fieldId);
      selectedId = fieldId;
    }
    paintSelection();
  }

  function paintSelection() {
    for (const entry of pagesApi.frames) {
      for (const box of entry.overlay.querySelectorAll('.field-box[data-fid]')) {
        box.classList.toggle('selected', selection.has(box.dataset.fid));
        box.classList.toggle('primary', box.dataset.fid === selectedId);
      }
    }
  }

  /**
   * Full selection: ring, optional keyboard focus (clicks preventDefault, so
   * the browser never focuses the box on its own), and the onSelect callback.
   */
  function select(fieldId, { focus = false, additive = false } = {}) {
    markSelected(fieldId, { additive });
    if (!fieldId && document.activeElement?.classList?.contains('field-box')) {
      document.activeElement.blur();
    }
    if (fieldId && focus) boxNode(fieldId)?.focus({ preventScroll: true });
    onSelect(selectedFields());
  }

  function mutate(field, { refocus = false } = {}) {
    clampField(field);
    const entry = pagesApi.frames[field.page];
    if (entry) {
      refreshOverlay(entry);
      // The rebuild replaced the node the keyboard was on; hand focus to the
      // fresh one so arrow-key nudging keeps working.
      if (refocus) boxNode(field.id)?.focus({ preventScroll: true });
    }
    onChange(doc);
  }

  /** Remove every selected field, or just this one when it stands alone. */
  function removeField(field) {
    const doomed = new Set(selection.has(field.id) ? [...selection] : [field.id]);
    const pages = new Set(doc.fields.filter((f) => doomed.has(f.id)).map((f) => f.page));
    doc.fields = doc.fields.filter((f) => !doomed.has(f.id));
    for (const page of pages) {
      const entry = pagesApi.frames[page];
      if (entry) refreshOverlay(entry);
    }
    select(null);
    onChange(doc);
  }

  /**
   * The lines a field lined itself up on. Drawn into the page's own overlay,
   * so they scale with it and vanish with the gesture.
   */
  function drawGuides(entry, guides) {
    clearGuides(entry);
    for (const guide of guides || []) {
      const line = el(`div.snap-guide.${guide.axis}`, { 'aria-hidden': 'true' });
      if (guide.axis === 'x') line.style.left = `${guide.at * 100}%`;
      else line.style.top = `${guide.at * 100}%`;
      entry.overlay.append(line);
    }
  }

  function clearGuides(entry) {
    for (const line of entry.overlay.querySelectorAll('.snap-guide')) line.remove();
  }

  /* ---- One field box -------------------------------------------------- */

  function buildBox(field, entry) {
    const signer = doc.signers.find((s) => s.id === field.signerId);
    const color = signer ? signerColor(signer, doc.signers) : 1;
    const node = el(`div.field-box.editable.c${color}`, {
      tabindex: 0,
      role: 'button',
      dataset: { fid: field.id },
      'aria-label': `${field.label || fieldLabel(field.type)}${field.readOnly ? ', read-only,' : ''} for ${signer?.name || signer?.email || 'signer'}, page ${field.page + 1}. Arrow keys move, Delete removes.`,
      html: icon(field.readOnly ? 'lock' : (FIELD_ICONS[field.type] || 'textCursor'), 13, 2),
    }, el('span.fb-label', {},
      // A value the sender filled in is what the signer will see, so show it
      // here instead of the label.
      typeof field.preset === 'string' && field.preset
        ? field.preset
        : field.label || fieldLabel(field.type)));
    positionBox(node, field);
    // A rebuilt box carries its own state: without the ring, moving a group
    // with the arrow keys (which rebuilds every overlay) looked like it had
    // lost the selection.
    if (selection.has(field.id)) node.classList.add('selected');
    if (field.id === selectedId) node.classList.add('primary');

    /* Drag to move. Shift-click never drags: it is how a selection is built. */
    let drag = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('resize-handle')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        select(field.id, { additive: true });
        return;
      }
      node.setPointerCapture(e.pointerId);
      // Dragging one of several selected fields moves the whole group; a
      // field outside the selection becomes the selection.
      if (!selection.has(field.id)) markSelected(field.id);
      const group = selectedFields();
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        rect: entry.frame.getBoundingClientRect(),
        moved: false,
        origin: group.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h })),
      };
    });
    node.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / drag.rect.width;
      const dy = (e.clientY - drag.startY) / drag.rect.height;
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
      if (drag.origin.length > 1) {
        // A group moves as one: no snapping, or the members would drift apart.
        const moved = shiftFields(drag.origin, dx, dy);
        for (const next of moved) {
          const target = doc.fields.find((f) => f.id === next.id);
          if (!target) continue;
          target.x = next.x;
          target.y = next.y;
          const box = boxNode(next.id);
          if (box) positionBox(box, target);
        }
        clearGuides(entry);
        return;
      }
      const start = drag.origin[0];
      const snapped = snapPosition(
        { x: start.x + dx, y: start.y + dy, w: field.w, h: field.h },
        fieldsOn(entry.index).filter((f) => f.id !== field.id),
      );
      field.x = snapped.x;
      field.y = snapped.y;
      positionBox(node, field);
      drawGuides(entry, snapped.guides);
    });
    node.addEventListener('pointerup', (e) => {
      const gesture = drag;
      drag = null;
      clearGuides(entry);
      if (gesture && gesture.moved) {
        if (gesture.origin.length > 1) {
          for (const f of selectedFields()) clampField(f);
          refreshOverlay(entry);
          onChange(doc);
        } else {
          mutate(field);
        }
      } else if (gesture && selection.size > 1) {
        // A click that never travelled, on one of several selected fields:
        // the selection narrows to the one that was actually clicked.
        markSelected(field.id);
      }
      // WHICH fields are selected was settled on pointerdown (a shift-click
      // toggles one; a plain drag keeps the group so it can move as one).
      // Deciding it again here used to break up the group the moment the
      // pointer came up. All that is left is the toolbar, which waits for the
      // gesture to end because it shifts layout, and the keyboard, which lands
      // on the (possibly rebuilt) box so arrow-key nudging carries on.
      if (selection.has(field.id)) boxNode(field.id)?.focus({ preventScroll: true });
      onSelect(selectedFields());
      e.stopPropagation();
    });
    node.addEventListener('pointercancel', () => {
      if (drag) {
        // The gesture died mid-drag (e.g. a touch turned into a scroll);
        // put every field back where it started.
        for (const start of drag.origin) {
          const target = doc.fields.find((f) => f.id === start.id);
          if (!target) continue;
          target.x = start.x;
          target.y = start.y;
          const box = boxNode(start.id);
          if (box) positionBox(box, target);
        }
      }
      drag = null;
      clearGuides(entry);
    });

    /* Keyboard */
    node.addEventListener('keydown', (e) => {
      // Shift (or alt) is the nudge accelerator, the way every layout tool
      // does it, so crossing a page does not take forty presses.
      const step = e.shiftKey || e.altKey ? 0.02 : 0.005;
      const nudge = (dx, dy) => {
        e.preventDefault();
        const group = selectedFields();
        if (group.length > 1) {
          for (const next of shiftFields(group, dx, dy)) {
            const target = doc.fields.find((f) => f.id === next.id);
            if (!target) continue;
            target.x = next.x;
            target.y = next.y;
          }
          refreshAllOverlays();
          boxNode(field.id)?.focus({ preventScroll: true });
          onChange(doc);
          return;
        }
        field.x += dx;
        field.y += dy;
        mutate(field, { refocus: true });
      };
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeField(field);
      } else if (e.key === 'ArrowLeft') nudge(-step, 0);
      else if (e.key === 'ArrowRight') nudge(step, 0);
      else if (e.key === 'ArrowUp') nudge(0, -step);
      else if (e.key === 'ArrowDown') nudge(0, step);
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(field.id, { additive: e.shiftKey });
      }
    });
    node.addEventListener('focus', () => {
      // Tabbing onto a field selects it, but never breaks up a group the user
      // has just built.
      if (!selection.has(field.id)) select(field.id);
    });

    /* Resize handle */
    const handle = el('div.resize-handle', { 'aria-hidden': 'true' });
    let resize = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      if (selectedId !== field.id) markSelected(field.id);
      const rect = entry.frame.getBoundingClientRect();
      resize = { startX: e.clientX, startY: e.clientY, w: field.w, h: field.h, rect };
    });
    handle.addEventListener('pointermove', (e) => {
      if (!resize) return;
      const dw = (e.clientX - resize.startX) / resize.rect.width;
      const dh = (e.clientY - resize.startY) / resize.rect.height;
      const snapped = snapSize(
        { x: field.x, y: field.y, w: resize.w + dw, h: resize.h + dh },
        fieldsOn(entry.index).filter((f) => f.id !== field.id),
      );
      field.w = snapped.w;
      field.h = snapped.h;
      positionBox(node, field);
      drawGuides(entry, snapped.guides);
      onGeometry(field);
    });
    handle.addEventListener('pointerup', () => {
      clearGuides(entry);
      if (resize) {
        mutate(field);
        select(field.id, { focus: true });
      }
      resize = null;
    });
    handle.addEventListener('pointercancel', () => {
      if (resize) {
        field.w = resize.w;
        field.h = resize.h;
        positionBox(node, field);
      }
      resize = null;
      clearGuides(entry);
    });
    node.append(handle);

    return node;
  }

  function refreshOverlay(entry) {
    clear(entry.overlay);
    for (const field of fieldsOn(entry.index)) {
      entry.overlay.append(buildBox(field, entry));
    }
  }

  function refreshAllOverlays() {
    for (const entry of pagesApi.frames) refreshOverlay(entry);
  }

  /* ---- Placement: tap to drop, drag to draw --------------------------- */

  for (const entry of pagesApi.frames) {
    refreshOverlay(entry);

    const onPage = (e) => e.target === entry.frame || e.target === entry.canvas || e.target === entry.overlay;
    let placing = null;

    const abortPlacement = () => {
      const active = Boolean(placing && placing.armed);
      placing?.ghost?.remove();
      placing = null;
      return active;
    };
    placementAborts.add(abortPlacement);

    const drawnRect = (gesture, e) => {
      const { rect, startX, startY } = gesture;
      const x1 = clamp((Math.min(startX, e.clientX) - rect.left) / rect.width, 0, 1);
      const y1 = clamp((Math.min(startY, e.clientY) - rect.top) / rect.height, 0, 1);
      const x2 = clamp((Math.max(startX, e.clientX) - rect.left) / rect.width, 0, 1);
      const y2 = clamp((Math.max(startY, e.clientY) - rect.top) / rect.height, 0, 1);
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    };

    entry.frame.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !onPage(e)) return;
      const armed = getArmed();
      const signerId = getSigner();
      // A refusal (the document is full) still counts as a tap on the page,
      // so it clears the selection rather than doing nothing at all.
      if (!armed || !signerId || !canPlace()) {
        placing = { deselect: true };
        return;
      }
      e.preventDefault();
      entry.frame.setPointerCapture(e.pointerId);
      const signer = doc.signers.find((s) => s.id === signerId);
      placing = {
        armed,
        signerId,
        color: signer ? signerColor(signer, doc.signers) : 1,
        rect: entry.frame.getBoundingClientRect(),
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        ghost: null,
      };
    });

    entry.frame.addEventListener('pointermove', (e) => {
      if (!placing || !placing.armed || e.pointerId !== placing.pointerId) return;
      if (!placing.ghost) {
        if (Math.hypot(e.clientX - placing.startX, e.clientY - placing.startY) < DRAW_THRESHOLD) return;
        placing.ghost = el(`div.field-box.ghost.c${placing.color}`, { 'aria-hidden': 'true' });
        entry.overlay.append(placing.ghost);
      }
      positionBox(placing.ghost, drawnRect(placing, e));
    });

    entry.frame.addEventListener('pointerup', (e) => {
      if (!placing) return;
      if (placing.deselect) {
        placing = null;
        if (onPage(e)) select(null);
        return;
      }
      if (e.pointerId !== placing.pointerId) return;
      const gesture = placing;
      placing = null;
      gesture.ghost?.remove();
      const { rect } = gesture;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const field = makeField({ type: gesture.armed, page: entry.index, x, y, signerId: gesture.signerId });
      if (gesture.ghost) {
        // Drawn to size: keep the drawn rect, enforcing the minimum.
        const r = drawnRect(gesture, e);
        field.x = r.x;
        field.y = r.y;
        field.w = Math.max(r.w, MIN_FIELD.w);
        field.h = Math.max(r.h, MIN_FIELD.h);
        clampField(field);
      } else if (x < 0 || x > 1 || y < 0 || y > 1) {
        return;
      }
      doc.fields.push(field);
      refreshOverlay(entry);
      onChange(doc);
      select(field.id, { focus: true });
      onPlaced(field);
    });

    entry.frame.addEventListener('pointercancel', abortPlacement);
  }

  function setArmedCursor(armed) {
    for (const entry of pagesApi.frames) {
      entry.frame.classList.toggle('armed', Boolean(armed));
    }
  }

  return {
    select,
    setArmedCursor,
    /** Abort an in-progress drag-to-draw. Returns true if one was active. */
    cancelPlacement() {
      let any = false;
      for (const abort of placementAborts) any = abort() || any;
      return any;
    },
    refreshAll: refreshAllOverlays,
    get selectedField() {
      return doc.fields.find((f) => f.id === selectedId) || null;
    },
    /** Everything selected, the primary field first. */
    get selectedFields() {
      return selectedFields();
    },
    /** The page the reader is on, which is where a paste lands. */
    get activePage() {
      return activePage;
    },
    /**
     * Select these ids (used after a duplicate or a paste). `primary` names
     * the one to make the reference; without it the last id becomes it, which
     * is what a fresh selection wants. A group ACTION has to pass the primary
     * it started from, or aligning twice would line the group up on a
     * different field the second time.
     */
    selectMany(ids, { primary = null } = {}) {
      selection.clear();
      for (const id of ids) selection.add(id);
      selectedId = (primary && selection.has(primary)) ? primary : (ids[ids.length - 1] || null);
      paintSelection();
      onSelect(selectedFields());
    },
    scrollToPage: (index, offset) => pagesApi.scrollToPage(index, offset),
    destroy: pagesApi.destroy,
  };
}
