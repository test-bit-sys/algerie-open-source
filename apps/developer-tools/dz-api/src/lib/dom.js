const ENUMERATED = new Set(['spellcheck', 'draggable']);

/**
 * Tiny element builder.
 *   h('button.btn.primary', { onclick, 'aria-label': 'Add' }, 'Add', icon('plus'))
 * Attributes that are DOM properties are set as properties; everything else
 * (aria-*, data-*, role) goes through setAttribute. null/undefined/false skip.
 */
export function h(spec, attrs, ...children) {
  if (attrs instanceof Node || typeof attrs === 'string' || typeof attrs === 'number' || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  // 'tag#id.class.class': the id and classes may come in any order.
  const tag = spec.match(/^[\w-]*/)[0];
  const node = document.createElement(tag || 'div');
  const classes = [];
  for (const [, kind, name] of spec.slice(tag.length).matchAll(/([.#])([^.#]+)/g)) {
    if (kind === '#') node.id = name;
    else classes.push(name);
  }
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    // spellcheck and draggable are "true"/"false" attributes, so false must be written out.
    if (ENUMERATED.has(k) && v != null) {
      node.setAttribute(k, String(v));
      continue;
    }
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else node.style[sk] = sv;
      }
    } else if (k === 'class') node.className = v;
    else if (k === 'ref' && typeof v === 'function') v(node);
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

/** replaceChildren that skips null, undefined and false. */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Screen reader announcement through the polite live region. */
export function announce(text) {
  const region = document.getElementById('live-region');
  if (!region) return;
  region.textContent = '';
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
/** True for keys that belong to an IME composition (the Enter that confirms one, for example). */
export const isComposing = (e) => e.isComposing || e.keyCode === 229;

export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
/** Keyboard shortcut label, e.g. shortcut('Mod+Enter') -> "⌘ Enter" on macOS, "Ctrl+Enter" elsewhere. */
export function shortcut(spec) {
  return spec
    .split('+')
    .map((k) => (k === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : k === 'Alt' ? (isMac ? '⌥' : 'Alt') : k === 'Shift' ? (isMac ? '⇧' : 'Shift') : k))
    .join(isMac ? '' : '+');
}

/** Unique id for aria wiring. */
let seq = 0;
export const domId = (prefix = 'id') => `${prefix}-${++seq}`;
