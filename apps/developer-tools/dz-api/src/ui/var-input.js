/**
 * Text field that highlights {{variables}}: green when defined in an active
 * scope, red when not. Hovering a variable shows its value and where it comes
 * from, and typing {{ offers matching names (combobox pattern).
 *
 * The input keeps the real text; a mirror layer behind it draws the colored
 * spans, scrolled in step with the input.
 *
 * vars: { list() -> [{ name, value, scope, secret }], get(name) -> { value, scope, secret } | null }
 */
import { h, domId, isComposing } from '../lib/dom.js';
import { findVariables, DYNAMIC } from '../core/variables.js';

// Every field by element: refreshes find fields on the page (or in a tab being
// shown) through it, so a field no longer referenced is not kept alive here.
const byEl = new WeakMap();
// Bumped by each refresh; a field painted before the last one is out of date.
let generation = 0;
let tip = null;

/** True when a {{name}} resolves: defined in a scope in reach, or one of the dynamic $ values. */
export const isVariableDefined = (vars, name) => !!vars?.get(name) || !!DYNAMIC[name];

/** How many fields refreshes would repaint: those on the page (for tests). */
export const liveVarInputs = () => [...document.querySelectorAll('.var-field')].filter((el) => byEl.has(el)).length;

/**
 * Re-highlights every field on the page, e.g. after switching environments.
 * With a root (a tab being shown), re-highlights the fields in it that missed
 * a refresh while they were off the page.
 */
export function refreshVarInputs(root) {
  if (!root) generation++;
  // Draw every field first, then line up their scroll positions: reading a
  // field's scroll position after each draw would lay out the page per field.
  const drawn = [];
  for (const el of (root || document).querySelectorAll('.var-field')) {
    const inst = byEl.get(el);
    if (inst && (!root || inst.generation !== generation) && inst.draw()) drawn.push(inst);
  }
  for (const inst of drawn) inst.syncScroll();
}

function hideTip() {
  tip?.remove();
  tip = null;
}

function showTip(target, name, vars) {
  hideTip();
  const info = vars?.get(name);
  const dynamic = DYNAMIC[name];
  const scopeLabel = { local: 'Script variable', data: 'Data file', environment: 'Environment', collection: 'Collection', globals: 'Global', dynamic: 'Dynamic' };
  tip = h(
    'div.var-tip',
    { role: 'tooltip' },
    h('div.var-tip-head', h('span.var-tip-name', name), h('span.var-tip-scope', info ? scopeLabel[info.scope] || info.scope : dynamic ? 'Dynamic' : 'Not defined')),
    info
      ? h('div.var-tip-value.mono', info.secret ? '••••••••' : info.value === '' ? h('em', 'Empty') : truncate(info.value))
      : dynamic
        ? h('div.var-tip-desc', dynamic.description)
        : h('div.var-tip-desc', 'Not set in the active environment, the collection or globals.'),
  );
  document.body.append(tip);
  const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  const below = r.bottom + 6;
  tip.style.top = `${below + tip.offsetHeight > window.innerHeight - 8 ? r.top - tip.offsetHeight - 6 : below}px`;
}

const truncate = (s) => (s.length > 300 ? `${s.slice(0, 300)}...` : s);

export function createVarInput({
  value = '',
  placeholder = '',
  label = '',
  labelledBy = null,
  vars = null,
  onInput,
  onEnter,
  onPaste,
  onKeyDown,
  className = '',
  id = domId('vi'),
  readOnly = false,
} = {}) {
  const mirror = h('div.var-mirror', { 'aria-hidden': 'true' });
  const listId = `${id}-list`;
  const input = h('input.var-input', {
    id,
    type: 'text',
    value,
    placeholder,
    readOnly,
    spellcheck: false,
    autocomplete: 'off',
    autocapitalize: 'off',
    'aria-label': labelledBy ? null : label || null,
    'aria-labelledby': labelledBy,
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
  });
  const el = h(`div.var-field${className ? `.${className}` : ''}`, mirror, input);
  let list = null;
  let options = [];
  let active = -1;
  let tokenStart = -1;

  let drawnKey = null;
  /** Redraws the colored copy; false when it already shows this text and these states. */
  const draw = () => {
    inst.generation = generation;
    const text = input.value;
    const found = findVariables(text);
    const defined = found.map((v) => isVariableDefined(vars, v.name));
    const key = `${defined.map(Number).join('')}:${text}`;
    if (key === drawnKey) return false;
    drawnKey = key;
    if (!found.length) {
      mirror.textContent = text;
      el.classList.remove('has-vars');
    } else {
      el.classList.add('has-vars');
      const parts = [];
      let at = 0;
      found.forEach((v, i) => {
        if (v.start > at) parts.push(document.createTextNode(text.slice(at, v.start)));
        parts.push(h(`span.var-token${defined[i] ? '' : '.missing'}`, { dataset: { name: v.name } }, text.slice(v.start, v.end)));
        at = v.end;
      });
      if (at < text.length) parts.push(document.createTextNode(text.slice(at)));
      mirror.replaceChildren(...parts);
    }
    return true;
  };
  const syncScroll = () => {
    mirror.scrollLeft = input.scrollLeft;
  };
  const paint = () => {
    draw();
    syncScroll();
  };

  const inst = { el, draw, syncScroll, generation };
  byEl.set(el, inst);

  const closeList = () => {
    list?.remove();
    list = null;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const choose = (name) => {
    const text = input.value;
    const caret = input.selectionStart;
    const after = text.slice(caret);
    const closing = after.startsWith('}}') ? '' : '}}';
    input.value = `${text.slice(0, tokenStart)}{{${name}${closing}${after}`;
    const pos = tokenStart + name.length + 4;
    input.setSelectionRange(pos, pos);
    closeList();
    paint();
    onInput?.(input.value);
  };

  const setActive = (i) => {
    active = i;
    [...(list?.children || [])].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    const li = list?.children[i];
    if (li) {
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  };

  const suggest = () => {
    if (!vars) return;
    const caret = input.selectionStart;
    const before = input.value.slice(0, caret);
    const open = before.lastIndexOf('{{');
    if (open < 0 || before.slice(open).includes('}}')) return closeList();
    const query = before.slice(open + 2).trim().toLowerCase();
    if (/[{}\s]/.test(query)) return closeList();
    tokenStart = open;
    const all = [...vars.list(), ...Object.entries(DYNAMIC).map(([name, d]) => ({ name, value: d.description, scope: 'dynamic' }))];
    const seen = new Set();
    options = all.filter((v) => {
      if (seen.has(v.name)) return false;
      seen.add(v.name);
      return v.name.toLowerCase().includes(query);
    }).sort((a, b) => (a.name.toLowerCase().startsWith(query) ? 0 : 1) - (b.name.toLowerCase().startsWith(query) ? 0 : 1)).slice(0, 50);
    if (!options.length) return closeList();
    if (!list) {
      list = h('ul.var-suggest', { id: listId, role: 'listbox', 'aria-label': 'Variables' });
      document.body.append(list);
    }
    list.replaceChildren(
      ...options.map((o, i) =>
        h(
          'li',
          {
            id: `${listId}-${i}`,
            role: 'option',
            'aria-selected': 'false',
            onpointerdown: (e) => {
              e.preventDefault();
              choose(o.name);
            },
          },
          h('span.var-suggest-name', o.name),
          h('span.var-suggest-value', o.secret ? '••••' : truncate(String(o.value ?? '')).slice(0, 60)),
          h('span.var-suggest-scope', o.scope === 'dynamic' ? 'dynamic' : o.scope),
        ),
      ),
    );
    input.setAttribute('aria-expanded', 'true');
    const r = input.getBoundingClientRect();
    list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 328))}px`;
    list.style.top = `${r.bottom + 4}px`;
    setActive(0);
  };

  input.addEventListener('input', (e) => {
    paint();
    onInput?.(input.value, e);
    suggest();
  });
  input.addEventListener('scroll', syncScroll);
  input.addEventListener('keyup', syncScroll);
  // Moving the caret leaves the {{ the list was opened for: offer what fits the new spot, or close it.
  const recheck = () => list && suggest();
  input.addEventListener('click', recheck);
  input.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) recheck();
  });
  input.addEventListener('blur', () => {
    setTimeout(closeList, 100);
    hideTip();
  });
  input.addEventListener('keydown', (e) => {
    if (isComposing(e)) return;
    if (list) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        return setActive((active + 1) % options.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        return setActive((active - 1 + options.length) % options.length);
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (active >= 0) {
          e.preventDefault();
          return choose(options[active].name);
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return closeList();
      }
    }
    if (e.key === 'Enter' && onEnter && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      onEnter(e);
      return;
    }
    onKeyDown?.(e);
  });
  if (onPaste) input.addEventListener('paste', onPaste);

  // Hover: find the variable span under the pointer.
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const spans = mirror.querySelectorAll('.var-token');
    for (const s of spans) {
      const r = s.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        if (tip?.dataset.for !== s.dataset.name) {
          showTip(r, s.dataset.name, vars);
          tip.dataset.for = s.dataset.name;
        }
        return;
      }
    }
    hideTip();
  });
  el.addEventListener('pointerleave', hideTip);

  paint();
  return {
    el,
    input,
    paint,
    getValue: () => input.value,
    setValue(v) {
      if (input.value === v) return;
      input.value = v;
      paint();
    },
    focus: () => input.focus(),
  };
}
