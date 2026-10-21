/**
 * Tiny element builder.
 *   h('button.btn.primary', { onclick, 'aria-label': 'Add' }, 'Add', icon('plus'))
 * Attributes that are DOM properties are set as properties; everything else
 * (aria-*, data-*, role) goes through setAttribute. null/undefined/false skip.
 */
export function h(spec, attrs, ...children) {
  if (attrs instanceof Node || typeof attrs === 'string' || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const [tagAndId, ...classes] = spec.split('.');
  const [tag, id] = tagAndId.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else node.style[sk] = sv;
      }
    } else if (k === 'class') node.className = v;
    else if (k.includes('-') || k === 'role' || k === 'for' || k === 'list' || k === 'form' || !(k in node)) {
      node.setAttribute(k, v === true ? '' : v);
    } else node[k] = v;
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

/** Escape text for HTML insertion. */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Visually hidden live-region announcement for screen readers. */
export function announce(text) {
  const region = document.getElementById('live-region');
  if (!region) return;
  region.textContent = '';
  // A fresh text node after a tick makes repeated messages speak again.
  setTimeout(() => {
    region.textContent = text;
  }, 30);
}

export function debounce(fn, ms) {
  let t = 0;
  let last = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    last = args;
    t = setTimeout(() => {
      last = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    clearTimeout(t);
    last = null;
  };
  wrapped.flush = () => {
    if (!last) return;
    const args = last;
    wrapped.cancel();
    fn(...args);
  };
  return wrapped;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
export const modLabel = isMac ? '⌘' : 'Ctrl+';

/** replaceChildren that skips null, undefined and false (for optional parts). */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}
