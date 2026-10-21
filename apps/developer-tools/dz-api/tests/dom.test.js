import { describe, it, expect } from 'vitest';
import { h, fill } from '../src/lib/dom.js';

describe('h()', () => {
  it('writes false for true/false attributes such as spellcheck and draggable', () => {
    expect(h('input', { spellcheck: false }).getAttribute('spellcheck')).toBe('false');
    const row = h('div', { draggable: 'false' });
    expect(row.draggable).toBe(false);
    expect(h('div', { draggable: true }).draggable).toBe(true);
  });

  it('parses tag, id and classes in any order', () => {
    const a = h('main.main#main');
    expect(a.tagName).toBe('MAIN');
    expect(a.id).toBe('main');
    expect(a.className).toBe('main');
    const b = h('div#x.one.two');
    expect([b.id, b.className]).toEqual(['x', 'one two']);
    expect(h('.only').tagName).toBe('DIV');
  });

  it('sets properties, attributes, events and children', () => {
    let clicked = 0;
    const el = h('button.btn', { type: 'button', 'aria-label': 'Go', disabled: false, dataset: { k: 'v' }, onclick: () => clicked++ }, 'Go', null, ['!']);
    el.click();
    expect(clicked).toBe(1);
    expect(el.getAttribute('aria-label')).toBe('Go');
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(el.dataset.k).toBe('v');
    expect(el.textContent).toBe('Go!');
    fill(el, h('span', 'x'), false);
    expect(el.innerHTML).toBe('<span>x</span>');
  });
});

describe('prefs', async () => {
  const { prefs } = await import('../src/ui/prefs.js');
  it('keeps changes another tab made to other preferences', () => {
    prefs.set('layout', 'stacked');
    const stored = JSON.parse(localStorage.getItem('api-client:prefs'));
    localStorage.setItem('api-client:prefs', JSON.stringify({ ...stored, theme: 'dark' }));
    prefs.set('layout', 'side');
    expect(JSON.parse(localStorage.getItem('api-client:prefs')).theme).toBe('dark');
  });
});

describe('promptDialog', async () => {
  const { promptDialog } = await import('../src/ui/dialog.js');
  it('ignores the Enter that confirms an IME composition', async () => {
    let value = 'pending';
    promptDialog({ title: 'Rename', label: 'Name', value: '' }).then((v) => (value = v));
    const input = document.querySelector('dialog[open] input');
    input.value = '名前';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(value).toBe('pending');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(value).toBe('名前');
  });
});

describe('popover', async () => {
  const { showPopover } = await import('../src/ui/popover.js');
  it('closes when the window is resized', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const el = showPopover(anchor, 'Details', { label: 'Details' });
    expect(el.isConnected).toBe(true);
    window.dispatchEvent(new Event('resize'));
    expect(el.isConnected).toBe(false);
  });
});

describe('var inputs', async () => {
  const { createVarInput, liveVarInputs } = await import('../src/ui/var-input.js');
  it('forgets fields that were removed from the page', async () => {
    const vars = { get: () => null, list: () => [], resolve: (t) => t };
    for (let round = 0; round < 50; round++) {
      const host = document.createElement('div');
      document.body.append(host);
      for (let i = 0; i < 20; i++) host.append(createVarInput({ value: '', label: 'x', vars }).el);
      host.remove();
      await null;
    }
    expect(liveVarInputs()).toBeLessThan(500);
  });

  it('leaves a field alone on a refresh that changes nothing it shows', async () => {
    const { refreshVarInputs } = await import('../src/ui/var-input.js');
    let defined = false;
    const vars = { get: (n) => (n === 'host' && defined ? { value: 'h', scope: 'environment' } : null), list: () => [] };
    const field = createVarInput({ value: '{{host}}/x', label: 'URL', vars });
    document.body.append(field.el);
    const mirror = field.el.querySelector('.var-mirror');
    const writes = [];
    new MutationObserver((m) => writes.push(...m)).observe(mirror, { childList: true, subtree: true, characterData: true });
    const token = mirror.querySelector('.var-token');
    expect(token.classList.contains('missing')).toBe(true);
    refreshVarInputs();
    await null;
    expect(writes).toHaveLength(0);
    expect(mirror.querySelector('.var-token')).toBe(token);
    defined = true;
    refreshVarInputs();
    expect(mirror.querySelector('.var-token').classList.contains('missing')).toBe(false);
    field.setValue('{{host}}/y');
    expect(mirror.textContent).toBe('{{host}}/y');
    field.el.remove();
  });
  it('does not insert a suggestion at the old spot after the caret moves away', () => {
    const vars = { get: () => null, list: () => [] };
    const field = createVarInput({ value: '', label: 'URL', vars });
    document.body.append(field.el);
    const { input } = field;
    input.focus();
    input.value = 'https://api.test/b/{{';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(input.getAttribute('aria-expanded')).toBe('true');
    input.setSelectionRange(0, 0);
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(tab);
    expect(input.value).toBe('https://api.test/b/{{');
    expect(tab.defaultPrevented).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    // The same with the keyboard; choosing while the caret is still in the braces completes them.
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.setSelectionRange(0, 0);
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Home', bubbles: true }));
    expect(input.getAttribute('aria-expanded')).toBe('false');
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(input.value).toMatch(/^https:\/\/api\.test\/b\/\{\{\$\w+\}\}$/);
    field.el.remove();
  });
});

describe('code editor', async () => {
  const { codeEditor } = await import('../src/ui/code-editor.js');
  it('does not mount an editor destroyed while its code was loading', async () => {
    if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () => [];
      Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    }
    const ed = codeEditor({ doc: 'x', language: 'json', label: 'Body' });
    document.body.append(ed.el);
    ed.destroy();
    await ed.ready;
    expect(ed.el.querySelector('.cm-editor')).toBeNull();
  });

  it('does not copy the document into the stand-in textarea once the editor code is loaded', async () => {
    const { loadEditor } = await import('../src/ui/code-editor.js');
    await loadEditor();
    const doc = '{"big":"' + 'x'.repeat(1000) + '"}';
    const ed = codeEditor({ doc, language: 'json', label: 'Body' });
    document.body.append(ed.el);
    expect(ed.el.querySelector('textarea').value).toBe('');
    expect(ed.getValue()).toBe(doc);
    ed.setValue('{"a":1}');
    expect(ed.getValue()).toBe('{"a":1}');
    await ed.ready;
    expect(ed.el.querySelector('.cm-editor')).not.toBeNull();
    expect(ed.el.querySelector('textarea')).toBeNull();
    expect(ed.getValue()).toBe('{"a":1}');
    ed.destroy();
    ed.el.remove();
  });
});

describe('code editor keys', () => {
  it('leaves Ctrl+Alt+[ and ] to the app to switch tabs instead of folding', async () => {
    if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () => [];
      Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    }
    const { createEditor } = await import('../src/ui/cm.js');
    const parent = document.createElement('div');
    document.body.append(parent);
    const ed = createEditor({ parent, doc: '{\n  "a": {\n    "b": 1\n  }\n}', language: 'json' });
    const press = (init) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      ed.view.contentDOM.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press({ key: '[', code: 'BracketLeft', keyCode: 219, ctrlKey: true, altKey: true })).toBe(false);
    expect(press({ key: ']', code: 'BracketRight', keyCode: 221, ctrlKey: true, altKey: true })).toBe(false);
    // Folding the block at the cursor keeps its own keys.
    expect(press({ key: '{', code: 'BracketLeft', keyCode: 219, ctrlKey: true, shiftKey: true })).toBe(true);
    ed.destroy();
    parent.remove();
  });
});

describe('code editor for large documents', () => {
  it('drops and brings back highlighting and folding as a document grows past the limit and shrinks again', async () => {
    const { createEditor } = await import('../src/ui/cm.js');
    const { language } = await import('@codemirror/language');
    const parent = document.createElement('div');
    document.body.append(parent);
    const ed = createEditor({ parent, doc: '{\n  "a": 1\n}', language: 'json' });
    const state = () => ({ language: ed.view.state.facet(language)?.name ?? null, folding: !!parent.querySelector('.cm-foldGutter') });
    expect(state()).toEqual({ language: 'json', folding: true });
    ed.setLarge(true);
    expect(state()).toEqual({ language: null, folding: false });
    // A language picked meanwhile is used once the document is small again.
    ed.setLanguage('xml');
    expect(state()).toEqual({ language: null, folding: false });
    ed.setLarge(false);
    expect(state()).toEqual({ language: 'xml', folding: true });
    ed.destroy();
    const big = createEditor({ parent, doc: '{}', language: 'json', large: true });
    expect(big.view.state.facet(language)).toBeNull();
    expect(parent.querySelector('.cm-foldGutter')).toBeNull();
    big.setLarge(false);
    expect(big.view.state.facet(language).name).toBe('json');
    big.destroy();
    parent.remove();
  });
});

describe('code editor line breaks', () => {
  it('keeps \\r\\n line breaks of a body written with them throughout', async () => {
    const { createEditor } = await import('../src/ui/cm.js');
    const parent = document.createElement('div');
    document.body.append(parent);
    const edit = (doc) => {
      let changed = null;
      const ed = createEditor({ parent, doc, onChange: (v) => (changed = v) });
      const end = ed.view.state.doc.length;
      ed.view.dispatch({ changes: { from: end, insert: 'x' } });
      ed.view.dispatch({ changes: { from: end, to: end + 1 } });
      ed.view.destroy();
      return [changed, ed.getValue()];
    };
    expect(edit('{\r\n  "a": 1\r\n}')).toEqual(['{\r\n  "a": 1\r\n}', '{\r\n  "a": 1\r\n}']);
    expect(edit('a\nb')).toEqual(['a\nb', 'a\nb']);
    // Mixed line breaks are written as \n, as before.
    expect(edit('a\r\nb\nc')).toEqual(['a\nb\nc', 'a\nb\nc']);
    // A document set later (another tab, a remote change) brings its own line breaks.
    let changed = null;
    const ed = createEditor({ parent, doc: 'a\nb', onChange: (v) => (changed = v) });
    ed.setValue('c\r\nd');
    expect(ed.getValue()).toBe('c\r\nd');
    ed.view.dispatch({ changes: { from: 0, insert: 'e\n' } });
    expect(changed).toBe('e\r\nc\r\nd');
    ed.setValue('f\ng');
    expect(ed.getValue()).toBe('f\ng');
    ed.view.destroy();
    parent.remove();
  });
});

describe('isVariableDefined', async () => {
  const { isVariableDefined } = await import('../src/ui/var-input.js');
  it('knows dynamic values but not typos of them', () => {
    const vars = { get: (n) => (n === 'host' ? { value: 'h' } : null) };
    expect(isVariableDefined(vars, 'host')).toBe(true);
    expect(isVariableDefined(vars, '$uuid')).toBe(true);
    expect(isVariableDefined(vars, '$typo')).toBe(false);
    expect(isVariableDefined(vars, 'nope')).toBe(false);
  });
});
