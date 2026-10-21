/**
 * Shared page rendering: PDF pages as canvases inside .page-frame elements,
 * each with an overlay layer that field boxes position into using the
 * fraction geometry from model.js. Used by the field editor, the read-only
 * preview, and the signing experience.
 */

import { el, clear } from './dom.js';
import { icon, FIELD_ICONS } from './icons.js';
import { fieldLabel, signerColor } from '../lib/model.js';
import { renderPage, pageAspect } from '../lib/pdfdoc.js';

/**
 * Mount page frames for `pageCount` pages and render them lazily as they
 * scroll into view. `onActive(index)` reports the page crossing the middle of
 * the viewport, which is what "page N of M" means to a reader.
 * Returns { frames, renderOne, scrollToPage, destroy }.
 */
export function mountPages({ container, pdf, pageCount, onActive = null }) {
  const frames = [];
  clear(container);
  container.classList.add('pages');

  for (let i = 0; i < pageCount; i++) {
    const canvas = el('canvas', { 'aria-label': `Page ${i + 1}` });
    const overlay = el('div', { style: { position: 'absolute', inset: '0' } });
    const frame = el('div.page-frame', {},
      el('span.page-num', { 'aria-hidden': 'true' }, `${i + 1} / ${pageCount}`),
      canvas, overlay);
    // Reserve height before render so the scroll position doesn't jump.
    frame.style.aspectRatio = '612 / 792';
    container.append(frame);
    frames.push({ index: i, frame, canvas, overlay, rendered: false, rendering: null });
  }

  async function renderOne(entry) {
    if (entry.rendered || entry.rendering) return entry.rendering;
    entry.rendering = (async () => {
      const aspect = await pageAspect(pdf, entry.index + 1);
      entry.frame.style.aspectRatio = `1 / ${aspect}`;
      const width = entry.frame.clientWidth || 612;
      await renderPage(pdf, entry.index + 1, entry.canvas, width);
      entry.rendered = true;
      entry.renderedWidth = width;
      entry.rendering = null;
    })().catch((err) => {
      entry.rendering = null;
      throw err;
    });
    return entry.rendering;
  }

  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((hits) => {
      for (const hit of hits) {
        if (!hit.isIntersecting) continue;
        const entry = frames.find((f) => f.frame === hit.target);
        if (entry) renderOne(entry).catch(() => {});
      }
    }, { rootMargin: '600px 0px' })
    : null;
  for (const entry of frames) {
    if (observer) observer.observe(entry.frame);
    else renderOne(entry).catch(() => {});
  }
  // Always render the first pages immediately; the observer covers the rest.
  for (const entry of frames.slice(0, 2)) renderOne(entry).catch(() => {});

  // Replace the one-size placeholder with each page's true aspect up front:
  // otherwise a page that isn't US-Letter portrait reflows the whole strip
  // (and yanks the scroll position) the moment it lazily renders.
  let disposed = false;
  (async () => {
    for (const entry of frames) {
      if (disposed) return;
      if (entry.rendered || entry.rendering) continue;
      try {
        const aspect = await pageAspect(pdf, entry.index + 1);
        if (!disposed && !entry.rendered && !entry.rendering) {
          entry.frame.style.aspectRatio = `1 / ${aspect}`;
        }
      } catch {
        return;
      }
    }
  })();

  // CSS keeps pages and field boxes aligned through resizes; re-rendering
  // once the new width settles restores crispness.
  let resizeTimer = null;
  const resizer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        for (const entry of frames) {
          if (!entry.rendered) continue;
          const width = entry.frame.clientWidth;
          if (!width || Math.abs(width - (entry.renderedWidth || 0)) < 2) continue;
          entry.rendered = false;
          renderOne(entry).catch(() => {});
        }
      }, 150);
    })
    : null;
  resizer?.observe(container);

  // Which page is being looked at. A band across the middle of the viewport,
  // so the answer changes once per page rather than on every pixel.
  const activeObserver = onActive && typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((hits) => {
      for (const hit of hits) {
        if (!hit.isIntersecting) continue;
        const entry = frames.find((f) => f.frame === hit.target);
        if (entry) onActive(entry.index);
      }
    }, { rootMargin: '-45% 0px -45% 0px' })
    : null;
  if (activeObserver) for (const entry of frames) activeObserver.observe(entry.frame);

  return {
    frames,
    renderOne,
    /**
     * Bring one page into view, leaving `offset` px clear above it for
     * whatever is stuck to the top of the column.
     */
    scrollToPage(index, offset = 0) {
      const entry = frames[index];
      if (!entry) return;
      const reduce = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const top = entry.frame.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
      renderOne(entry).catch(() => {});
    },
    destroy() {
      disposed = true;
      observer?.disconnect();
      activeObserver?.disconnect();
      resizer?.disconnect();
      clearTimeout(resizeTimer);
    },
  };
}

/**
 * The failure state for every PDF surface (preview, editor, signing): a
 * dead-end line of grey text left no way back, so this one offers the retry.
 */
export function pagesError(message, onRetry) {
  return el('div.empty', {},
    el('div.empty-icon', { html: icon('wifiOff', 24) }),
    el('h3', {}, 'Could not load the document'),
    el('p', {}, message),
    el('button.btn.btn-soft', {
      type: 'button', style: { marginTop: '16px' }, html: icon('rotate', 15, 2),
      onclick: onRetry,
    }, ' Try again'));
}

/** Apply a field's fraction rect to an absolutely positioned box. */
export function positionBox(node, field) {
  node.style.left = `${field.x * 100}%`;
  node.style.top = `${field.y * 100}%`;
  node.style.width = `${field.w * 100}%`;
  node.style.height = `${field.h * 100}%`;
}

/**
 * A read-only field box. With a complete value it renders the value (image,
 * text, or check); otherwise a labeled placeholder in the signer's color.
 *
 * role=img makes everything inside the box presentational, so whatever is
 * drawn in it has to be in the label too - the sender's own field label, and
 * above all the value, which on a signed document is the whole point of the
 * preview. (The signing surface's own boxes do the same, in ui/signing.js.)
 */
export function staticFieldBox(field, doc, value) {
  const signer = (doc.signers || []).find((s) => s.id === field.signerId);
  const color = signer ? signerColor(signer, doc.signers) : 1;
  const label = field.label || fieldLabel(field.type);
  const whose = `${label} for ${signer?.name || signer?.email || 'signer'}`;
  const node = el(`div.field-box.c${color}`, { role: 'img', 'aria-label': whose });
  positionBox(node, field);
  if (value !== undefined && value !== null && value !== '' && value !== false) {
    node.classList.add('filled');
    if (value && value.kind === 'image') {
      node.append(el('img', { src: value.data, alt: '' }));
      node.setAttribute('aria-label', `${whose}, signed`);
    } else if (value === true) {
      node.innerHTML = icon('check', 15, 3);
      node.style.color = '#14141f';
      node.setAttribute('aria-label', `${whose}, ticked`);
    } else {
      node.append(el('span.fb-text', {}, String(value)));
      node.setAttribute('aria-label', `${whose}: ${value}`);
    }
  } else {
    node.innerHTML = icon(FIELD_ICONS[field.type] || 'textCursor', 13, 2);
    node.append(el('span.fb-label', {}, label));
  }
  return node;
}
