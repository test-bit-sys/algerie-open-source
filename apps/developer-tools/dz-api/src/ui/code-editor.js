/**
 * Lightweight handle for a code editor. The element is available at once;
 * CodeMirror loads in the background and replaces a plain textarea that
 * stands in meanwhile (and remains if loading fails, so editing never
 * blocks on the network).
 */
import { h } from '../lib/dom.js';

// Documents larger than this are edited without highlighting and folding, as large responses are shown.
export const LARGE_DOCUMENT = 3 * 1048576;

let cmModule = null;
let cmLoaded = false;
export function loadEditor() {
  cmModule ||= import('./cm.js').then((m) => {
    cmLoaded = true;
    return m;
  });
  return cmModule;
}

// Every mounted editor by element: refreshes find editors on the page (or in a
// tab being shown) through it, so an editor no longer referenced is not kept alive here.
const byEl = new WeakMap();
// Bumped by each refresh; an editor colored before the last one is out of date.
let generation = 0;

/**
 * Re-colors {{variables}} in every editor on the page after scope changes.
 * With a root (a tab being shown), re-colors the editors in it that missed a
 * refresh while they were off the page.
 */
export function refreshEditorVariables(root) {
  if (!root) generation++;
  for (const el of (root || document).querySelectorAll('.code-editor')) {
    const ed = byEl.get(el);
    if (ed && (!root || ed.generation !== generation)) ed.refreshVariables();
  }
}

export function codeEditor(opts = {}) {
  const el = h(`div.code-editor${opts.className ? `.${opts.className}` : ''}`);
  // With the editor code already loaded the editor replaces the textarea within a
  // microtask, so the textarea is left empty instead of copying a large document.
  const standIn = !cmLoaded;
  const fallback = h('textarea.code-fallback.mono', {
    value: standIn ? opts.doc || '' : '',
    readOnly: !!opts.readOnly,
    spellcheck: false,
    'aria-label': opts.label || 'Code editor',
    placeholder: opts.placeholder || '',
  });
  fallback.addEventListener('input', () => opts.onChange?.(fallback.value));
  el.append(fallback);
  let editor = null;
  let destroyed = false;
  let pending = { value: opts.doc || '', language: opts.language, wrap: opts.wrap, large: !!opts.large };
  const handle = {
    el,
    ready: null,
    getValue: () => (editor ? editor.getValue() : standIn ? fallback.value : pending.value),
    setValue(v) {
      pending.value = v;
      if (editor) editor.setValue(v);
      else if (standIn) fallback.value = v;
    },
    setLanguage(l) {
      pending.language = l;
      editor?.setLanguage(l);
    },
    setWrap(w) {
      pending.wrap = w;
      editor?.setWrap(w);
    },
    setLarge(on) {
      pending.large = on;
      if (!destroyed) editor?.setLarge(on);
    },
    generation,
    refreshVariables() {
      handle.generation = generation;
      editor?.refreshVariables();
    },
    openSearch: () => editor?.openSearch(),
    focus: () => (editor ? editor.focus() : fallback.focus()),
    destroy: () => {
      destroyed = true;
      byEl.delete(el);
      editor?.destroy();
    },
  };
  handle.ready = loadEditor()
    .then(({ createEditor }) => {
      // Destroyed while the editor code was loading: mounting now would leak it.
      if (destroyed) return handle;
      const value = standIn ? fallback.value : pending.value;
      const hadFocus = document.activeElement === fallback;
      fallback.remove();
      editor = createEditor({ ...opts, parent: el, doc: value, language: pending.language, wrap: pending.wrap, large: pending.large });
      if (hadFocus) editor.focus();
      handle.generation = generation;
      byEl.set(el, handle);
      return handle;
    })
    .catch((err) => {
      console.warn('Code editor unavailable, using plain text', err);
      return handle;
    });
  return handle;
}
