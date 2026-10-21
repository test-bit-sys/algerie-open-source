/**
 * Sovereign Code Editor Engine for DZ-API Studio.
 * 100% Offline-First, Zero External Dependencies, High Performance.
 * Replaces heavy external npm bundles with a native, line-numbered, responsive editor.
 */

export function createEditor(opts = {}) {
  const container = document.createElement('div');
  container.className = 'cm-editor cm-standalone';
  container.style.cssText = `
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    position: relative;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 13px;
    line-height: 20px;
    background-color: var(--surface, #1e1e24);
    color: var(--text, #f0f0f5);
    border-radius: 4px;
    overflow: hidden;
  `;

  const gutter = document.createElement('div');
  gutter.className = 'cm-gutters cm-standalone-gutter';
  gutter.style.cssText = `
    width: 44px;
    padding: 8px 6px 8px 0;
    text-align: right;
    user-select: none;
    color: var(--text-faint, #6e6e80);
    background-color: var(--bg-subtle, rgba(0,0,0,0.15));
    border-right: 1px solid var(--border, rgba(255,255,255,0.08));
    font-size: 12px;
    overflow: hidden;
  `;

  const textarea = document.createElement('textarea');
  textarea.className = 'cm-content cm-standalone-textarea';
  textarea.style.cssText = `
    flex: 1;
    padding: 8px 12px;
    border: none;
    outline: none;
    resize: none;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    background: transparent;
    color: inherit;
    tab-size: 2;
    white-space: ${opts.wrap ? 'pre-wrap' : 'pre'};
    word-break: ${opts.wrap ? 'break-word' : 'normal'};
    overflow: auto;
  `;

  textarea.value = opts.doc || '';
  textarea.readOnly = !!opts.readOnly;
  textarea.spellcheck = false;
  textarea.placeholder = opts.placeholder || '';
  textarea.setAttribute('aria-label', opts.label || 'Code Editor');

  function updateGutters() {
    if (opts.lineNumbers === false) {
      gutter.style.display = 'none';
      return;
    }
    const linesCount = (textarea.value.match(/\n/g) || []).length + 1;
    let numbers = '';
    for (let i = 1; i <= linesCount; i++) {
      numbers += i + '\n';
    }
    gutter.textContent = numbers;
  }

  updateGutters();

  textarea.addEventListener('input', () => {
    updateGutters();
    opts.onChange?.(textarea.value);
  });

  textarea.addEventListener('scroll', () => {
    gutter.scrollTop = textarea.scrollTop;
  });

  // Tab indentation & Mod-Enter submit
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      textarea.value = val.substring(0, start) + '  ' + val.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      opts.onChange?.(textarea.value);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (opts.onSubmit) {
        e.preventDefault();
        opts.onSubmit();
      }
    }
  });

  container.append(gutter, textarea);
  if (opts.parent) {
    opts.parent.append(container);
  }

  const editorInstance = {
    view: { dom: container },
    getValue: () => textarea.value,
    setValue(text) {
      if (textarea.value !== text) {
        textarea.value = text || '';
        updateGutters();
      }
    },
    setLanguage(lang) {
      container.dataset.language = lang;
    },
    setLarge(on) {
      container.dataset.large = on ? 'true' : 'false';
    },
    setWrap(on) {
      textarea.style.whiteSpace = on ? 'pre-wrap' : 'pre';
      textarea.style.wordBreak = on ? 'break-word' : 'normal';
    },
    setReadOnly(on) {
      textarea.readOnly = !!on;
    },
    refreshVariables() {
      // Sovereign variable check hook
    },
    openSearch() {
      const q = prompt('Search in document:');
      if (q) {
        const idx = textarea.value.indexOf(q);
        if (idx !== -1) {
          textarea.focus();
          textarea.setSelectionRange(idx, idx + q.length);
        } else {
          alert('Not found: ' + q);
        }
      }
    },
    focus: () => textarea.focus(),
    destroy: () => container.remove(),
  };

  return editorInstance;
}
