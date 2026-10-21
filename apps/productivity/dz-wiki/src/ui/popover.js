/**
 * Floating panels (menus, pickers) anchored to an element, a point or the
 * caret. They close on Escape, on a press outside, and when another one
 * opens at the same level; focus goes back where it came from.
 */
const stack = [];

export function placeAt(el, rect, { placement = 'bottom-start', gap = 4, inset = 8 } = {}) {
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.maxHeight = '';
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = placement.endsWith('end') ? rect.right - w : placement.startsWith('right') ? rect.right + gap : rect.left;
  let top = placement.startsWith('right') ? rect.top : rect.bottom + gap;
  const below = vh - rect.bottom - gap - inset;
  const above = rect.top - gap - inset;
  if (!placement.startsWith('right') && h > below && above > below) {
    top = Math.max(inset, rect.top - gap - Math.min(h, above));
    if (h > above) el.style.maxHeight = `${above}px`;
  } else if (h > below && !placement.startsWith('right')) el.style.maxHeight = `${Math.max(120, below)}px`;
  if (placement.startsWith('right') && left + w > vw - inset) left = rect.left - gap - w;
  left = Math.max(inset, Math.min(left, vw - w - inset));
  top = Math.max(inset, Math.min(top, vh - Math.min(h, vh - inset * 2) - inset));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

export function rectOf(anchor) {
  if (!anchor) return new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0);
  if (anchor instanceof Element) return anchor.getBoundingClientRect();
  if ('x' in anchor && !('width' in anchor)) return new DOMRect(anchor.x, anchor.y, 0, 0);
  return anchor;
}

export class Popover {
  constructor({ anchor, content, className = '', placement, onClose, label, role = 'dialog', returnFocus = true, level = null, modal = false }) {
    this.anchor = anchor;
    this.onClose = onClose;
    this.returnTo = returnFocus ? document.activeElement : null;
    this.el = document.createElement('div');
    this.el.className = `popover ${className}`.trim();
    if (role) this.el.setAttribute('role', role);
    if (label) this.el.setAttribute('aria-label', label);
    this.el.append(content);
    // A popover opened from inside another one stacks on it; anything else
    // replaces whatever was open.
    const parentIndex = level ?? stack.findIndex((p) => p.el.contains(document.activeElement) || (anchor instanceof Element && p.el.contains(anchor)));
    while (stack.length > parentIndex + 1) stack.at(-1).close({ focus: false });
    this.parent = stack.at(-1) || null;
    stack.push(this);
    // Inside the main landmark (or an open dialog), so it is part of the page structure.
    (document.querySelector('dialog[open]') || document.getElementById('main') || document.body).append(this.el);
    this.place(placement);
    this.onDown = (e) => {
      if (stack.at(-1) !== this) return;
      if (this.el.contains(e.target)) return;
      if (anchor instanceof Element && anchor.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      this.close({ focus: false });
    };
    this.onKey = (e) => {
      if (e.key === 'Escape' && stack.at(-1) === this) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    this.onResize = () => this.place(placement);
    setTimeout(() => {
      document.addEventListener('pointerdown', this.onDown, true);
    });
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
    this.modal = modal;
  }

  place(placement = this.placement) {
    this.placement = placement;
    placeAt(this.el, rectOf(this.anchor), { placement });
  }

  get open() {
    return stack.includes(this);
  }

  close({ focus = true } = {}) {
    const i = stack.indexOf(this);
    if (i < 0) return;
    while (stack.length > i + 1) stack.at(-1).close({ focus: false });
    stack.splice(i, 1);
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
    if (focus && this.returnTo?.isConnected) this.returnTo.focus({ preventScroll: true });
    this.onClose?.();
  }
}

export function closeAllPopovers() {
  while (stack.length) stack.at(-1).close({ focus: false });
}

export function hasOpenPopover() {
  return stack.length > 0;
}
