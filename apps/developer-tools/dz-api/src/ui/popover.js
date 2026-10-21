/**
 * Non-modal popover anchored to an element. Closes on outside click or Escape,
 * and showing it again for the same anchor closes it (the anchor toggles it).
 */
import { h, isComposing } from '../lib/dom.js';
import { place } from './menu.js';

let current = null;

export function closePopover() {
  if (!current) return;
  const c = current;
  current = null;
  c.cleanup();
  c.el.remove();
  c.anchor?.setAttribute?.('aria-expanded', 'false');
  c.onClose?.();
}

export function showPopover(anchor, content, { align = 'start', side = 'bottom', label = '', onClose, className = '', focus = true } = {}) {
  if (current?.anchor === anchor) {
    closePopover();
    return null;
  }
  closePopover();
  const el = h(`div.popover${className ? `.${className}` : ''}`, { role: 'dialog', 'aria-label': label || null, tabindex: '-1' }, content);
  document.body.append(el);
  place(el, anchor.getBoundingClientRect(), { align, side });
  anchor.setAttribute?.('aria-expanded', 'true');
  const onDown = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target) && !e.target.closest?.('.menu')) closePopover();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
      anchor.focus?.();
    }
  };
  // A popover that left focus where it was (focus: false) still closes on Escape.
  const onDocKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || isComposing(e)) return;
    closePopover();
    if (!document.activeElement || document.activeElement === document.body) anchor.focus?.();
  };
  // Its position is computed once, so a resize would leave it stranded or off screen.
  const onResize = () => closePopover();
  // Added a tick later so the click that opened it does not close it, unless it closed first.
  let closed = false;
  setTimeout(() => closed || document.addEventListener('pointerdown', onDown, true));
  window.addEventListener('resize', onResize);
  el.addEventListener('keydown', onKey);
  document.addEventListener('keydown', onDocKey);
  current = {
    el,
    anchor,
    onClose,
    cleanup() {
      closed = true;
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onDocKey);
      window.removeEventListener('resize', onResize);
    },
  };
  if (focus) (el.querySelector('input, select, textarea, button') || el).focus();
  return el;
}

export const popoverOpenFor = (anchor) => current?.anchor === anchor;
