/** Tiny element builder: el('button.btn.btn-primary', { onclick }, children...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'html') {
      node.innerHTML = v;
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k in node && k !== 'list' && k !== 'form') {
      node[k] = v;
    } else {
      node.setAttribute(k, v === true ? '' : v);
    }
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

/**
 * Re-render a container the user is working inside, then put focus back on
 * the control that had it. A control that rebuilds itself on activation
 * (every segmented control here does, to redraw which option is on) would
 * otherwise take keyboard focus down with it, dropping the user on the
 * document body with nothing to do but tab in from the top again.
 */
export function keepFocus(container, render) {
  const active = document.activeElement;
  const i = active && active.parentElement === container
    ? [...container.children].indexOf(active)
    : -1;
  render();
  if (i >= 0) container.children[i]?.focus({ preventScroll: true });
}

/**
 * Scroll a node into view, jumping straight there for anyone who asked the
 * OS to reduce motion. The stylesheet's reduced-motion block only
 * neutralises animations and transitions; an explicit behavior: 'smooth'
 * passed here overrides scroll-behavior and animates regardless, so the
 * preference has to be read in script.
 */
export function scrollIntoView(node, { block = 'start' } = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.scrollIntoView({ block, behavior: reduce ? 'auto' : 'smooth' });
}
