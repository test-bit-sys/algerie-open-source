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

/**
 * Children are written as `condition && el(...)`, so every falsy value a
 * short-circuit can yield has to be dropped, not just `false`. Numbers meant
 * for display are stringified at the call site.
 */
export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (!child && child !== 0) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * A fresh id for pairing a visible <label for> with its control. Forms are
 * rebuilt on every render and several can be open at once, so the id has to
 * be unique per element rather than per field name.
 */
let uidCounter = 0;
export function fieldId(prefix = 'f') {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}
