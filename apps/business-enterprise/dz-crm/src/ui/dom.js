/** Tiny element builder: el('button.btn.btn-primary', { onclick }, children...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  // A key the element carries as a property can take false as a real value
  // - that is how spellcheck says "off". An attribute cannot: setAttribute
  // spells it "false", and to disabled or selected any string means yes, so
  // there the only way to say no is to leave the attribute out.
  const isProperty = (k) => k in node && k !== 'list' && k !== 'form' && k !== 'draggable';

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined) continue;
    if (v === false && !isProperty(k)) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'html') {
      node.innerHTML = v;
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k === 'style' && typeof v === 'object') {
      // Custom properties need setProperty - they are invisible to
      // CSSStyleDeclaration's named accessors.
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    } else if (isProperty(k)) {
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

/* ---------- focus across a re-render ----------
   Views rebuild their whole body on every store change, which throws away
   the node the keyboard was on and lands focus on the document body - so
   the next Tab restarts from the top of the page. Checking off three
   follow-ups in a row means tabbing back from the top three times. The
   control is found again afterwards by an attribute its rebuilt copy still
   carries. */

/**
 * Escape a value for use as an attribute-selector value. These carry record
 * names ("Delete Ada Lovelace"), and a name is whatever the spreadsheet had
 * - a CSV cell may legitimately span two lines. A raw newline cannot appear
 * in a CSS string at all, so hand-escaping quotes was not enough: the
 * selector was a parse error and querySelector threw mid-render.
 */
const attrValue = (v) => CSS.escape(String(v));

/** A selector that finds this control again once its view is rebuilt. */
function focusSelector(node) {
  if (!(node instanceof HTMLElement)) return null;
  // An explicit key wins: filter chips and sort headers are told apart by
  // their label text alone, which changes as they toggle.
  const { focusKey } = node.dataset;
  if (focusKey) return `[data-focus-key=${attrValue(focusKey)}]`;
  const label = node.getAttribute('aria-label');
  if (label) return `[aria-label=${attrValue(label)}]`;
  if (node.id) return `[id=${attrValue(node.id)}]`;
  const { stage } = node.dataset;
  if (stage && node.classList.contains('stage-step')) {
    return `.stage-step[data-stage=${attrValue(stage)}]`;
  }
  return null;
}

/**
 * Wrap a re-render so it hands the keyboard back. Focus is restored only
 * when the render actually dropped it, and never into a page sitting under
 * an open dialog.
 */
export function keepingFocus(render) {
  return (...args) => {
    const active = document.activeElement;
    const selector = active?.closest?.('#app') ? focusSelector(active) : null;
    render(...args);
    if (!selector || document.activeElement !== document.body) return;
    if (document.querySelector('.modal-root')) return;
    document.querySelector(`#app ${selector}`)?.focus({ preventScroll: true });
  };
}

export function clear(node) {
  node.replaceChildren();
  return node;
}
