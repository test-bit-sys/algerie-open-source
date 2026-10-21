/** Tiny element builder: el('button.btn.btn-primary', { onclick }, children...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'html') {
      node.innerHTML = v;
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k in node && k !== 'list' && k !== 'form') {
      // `false` reaches the property rather than being dropped: for a
      // boolean one (checked, selected, open) that's the default anyway,
      // but `spellcheck: false` is a real value — skipping it left the
      // attribute absent, which means "inherit", i.e. on.
      node[k] = v;
    } else if (v !== false) {
      // A plain attribute has no false: absent is how it says no.
      node.setAttribute(k, v === true ? '' : v);
    }
  }

  append(node, children);
  return node;
}

/**
 * Attributes for a field holding a code rather than prose — SKUs,
 * barcodes, unit names, and the boxes those get typed and scanned into.
 * Phones capitalize and autocorrect text fields by default, which turns
 * a typed "cb-uc2m" into "Cb-uc2m" and is free to rewrite a part number
 * into a dictionary word; a red squiggle under every SKU is noise on
 * top of it.
 */
export const CODE_FIELD = { autocapitalize: 'off', autocorrect: 'off', spellcheck: false };

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
