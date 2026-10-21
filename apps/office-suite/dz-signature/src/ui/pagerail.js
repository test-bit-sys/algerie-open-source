/**
 * The page rail: a strip of thumbnails beside a long document.
 *
 * It does two jobs, and a 20-page agreement needs both. Navigation: tap a
 * thumbnail to jump there, with the page you are looking at marked. Page
 * fixes, on a draft only: rotate a sideways scan, move a page, delete the
 * cover sheet nobody needs.
 *
 * Page edits rewrite the file, so they are handed up to the editor (onPlan),
 * which is what owns the fields that have to move with them.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { renderPage, pageAspect } from '../lib/pdfdoc.js';
import { movePlan, deletePlan, rotatePlan } from '../lib/pdfedit.js';

const THUMB_WIDTH = 76;

/**
 * pageRail({ pdf, pageCount, onJump, onPlan, editable })
 * -> element with .setActive(index), .destroy()
 *
 * `onPlan(plan, label)` receives a page plan (see lib/pdfedit.js) and is
 * responsible for rewriting the file and remapping the fields.
 */
export function pageRail({
  pdf,
  pageCount,
  onJump = () => {},
  onPlan = null,
  editable = false,
  onAddPages = null,
}) {
  // A group of jump buttons, not a tablist: there are no tabpanels for them
  // to control and no arrow-key handling between them, so role="tab" promised
  // a keyboard model that does not exist ("tab 3 of 20", arrows do nothing).
  // Which page is being looked at is aria-current, the way the shell's own
  // navigation marks it.
  const strip = el('div.rail-strip', { role: 'group', 'aria-label': 'Pages' });
  const collapse = el('button.icon-btn.rail-collapse', {
    type: 'button', html: icon('chevD', 16), 'aria-expanded': 'true',
    title: 'Hide the page strip', 'aria-label': 'Hide the page strip',
    onclick: () => {
      const hidden = root.classList.toggle('collapsed');
      collapse.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      const label = hidden ? 'Show the page strip' : 'Hide the page strip';
      collapse.title = label;
      collapse.setAttribute('aria-label', label);
    },
  });
  const root = el('div.page-rail', {},
    el('div.rail-head', {},
      collapse,
      el('span.rail-title.grow', {}, `${pageCount} page${pageCount === 1 ? '' : 's'}`),
      editable && onAddPages && el('button.btn.btn-ghost.btn-sm', {
        type: 'button', html: icon('plus', 13, 2.4), onclick: () => onAddPages(),
      }, ' Add pages')),
    strip);

  let active = 0;
  const thumbs = [];
  let disposed = false;

  function build() {
    clear(strip);
    thumbs.length = 0;
    for (let index = 0; index < pageCount; index++) {
      const canvas = el('canvas', { 'aria-hidden': 'true' });
      const frame = el('div.rail-thumb', {}, canvas);
      // Reserved before render so the strip does not jump as pages arrive.
      frame.style.aspectRatio = '612 / 792';

      const controls = editable && onPlan
        ? el('div.rail-tools', {},
          el('button.icon-btn', {
            type: 'button', html: icon('chevL', 14), disabled: index === 0,
            title: 'Move page earlier', 'aria-label': `Move page ${index + 1} earlier`,
            onclick: (e) => {
              e.stopPropagation();
              onPlan(movePlan(pageCount, index, index - 1), `page ${index + 1} moved earlier`);
            },
          }),
          el('button.icon-btn', {
            type: 'button', html: icon('rotate', 14),
            title: 'Rotate page', 'aria-label': `Rotate page ${index + 1}`,
            onclick: (e) => {
              e.stopPropagation();
              onPlan(rotatePlan(pageCount, index, 1), `page ${index + 1} rotated`);
            },
          }),
          el('button.icon-btn.danger', {
            type: 'button', html: icon('trash', 14), disabled: pageCount < 2,
            title: pageCount < 2 ? 'A document needs at least one page' : 'Delete page',
            'aria-label': `Delete page ${index + 1}`,
            onclick: (e) => {
              e.stopPropagation();
              onPlan(deletePlan(pageCount, index), `page ${index + 1} deleted`);
            },
          }),
          el('button.icon-btn', {
            type: 'button', html: icon('chevR', 14), disabled: index === pageCount - 1,
            title: 'Move page later', 'aria-label': `Move page ${index + 1} later`,
            onclick: (e) => {
              e.stopPropagation();
              onPlan(movePlan(pageCount, index, index + 1), `page ${index + 1} moved later`);
            },
          }))
        : null;

      const item = el('div.rail-item', {},
        el('button.rail-jump', {
          type: 'button',
          'aria-current': index === active ? 'page' : null,
          'aria-label': `Go to page ${index + 1}`,
          onclick: () => onJump(index),
        }, frame, el('span.rail-num', {}, String(index + 1))),
        controls);
      strip.append(item);
      thumbs.push({ index, item, canvas, frame, rendered: false });
    }
    renderVisible();
  }

  /** Thumbnails are cheap, but a 200-page document is not: render lazily. */
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((hits) => {
      for (const hit of hits) {
        if (!hit.isIntersecting) continue;
        const thumb = thumbs.find((t) => t.item === hit.target);
        if (thumb) draw(thumb);
      }
    }, { root: strip, rootMargin: '400px' })
    : null;

  async function draw(thumb) {
    if (disposed || thumb.rendered) return;
    thumb.rendered = true;
    try {
      const aspect = await pageAspect(pdf, thumb.index + 1);
      if (disposed) return;
      thumb.frame.style.aspectRatio = `1 / ${aspect}`;
      await renderPage(pdf, thumb.index + 1, thumb.canvas, THUMB_WIDTH);
    } catch {
      thumb.rendered = false;
    }
  }

  function renderVisible() {
    for (const thumb of thumbs) {
      if (observer) observer.observe(thumb.item);
      // Without an observer (or before one fires) the first screenful still
      // has to appear.
      if (!observer || thumb.index < 8) draw(thumb);
    }
    setActive(active);
  }

  function setActive(index) {
    active = Math.max(0, Math.min(pageCount - 1, index));
    for (const thumb of thumbs) {
      const on = thumb.index === active;
      thumb.item.classList.toggle('active', on);
      const jump = thumb.item.querySelector('.rail-jump');
      if (on) jump?.setAttribute('aria-current', 'page');
      else jump?.removeAttribute('aria-current');
    }
    const item = thumbs[active]?.item;
    if (!item) return;
    // Keep the marked thumbnail in view, without dragging the page with it.
    const box = item.getBoundingClientRect();
    const rail = strip.getBoundingClientRect();
    if (box.left < rail.left || box.right > rail.right) {
      strip.scrollTo({ left: item.offsetLeft - strip.clientWidth / 2 + item.offsetWidth / 2 });
    }
  }

  build();

  root.setActive = setActive;
  root.destroy = () => {
    disposed = true;
    observer?.disconnect();
  };
  return root;
}
