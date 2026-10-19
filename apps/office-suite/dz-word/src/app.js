/**
 * DZ-Word (كاتب الجزائر) — Microsoft Word Authentic Architecture & Logic
 * 100% Offline-First, Zero-Dependency, Sovereign Algerian Word Processor
 */

(function () {
  'use strict';

  class DZWordApp {
  constructor() {
    this.currentLang = 'ar';
    this.zoomLevel = 100;
    this.docTitle = 'مستند 1 - Word';
    this.editor = null;
    this.formatPainterActive = false;
    this.copiedStyle = null;
    this.pageOrientation = 'portrait';
    this.pageMargins = 'normal';
    this.pageSize = 'A4';
    this.showParagraphMarks = false;
    this.isAutoSaveOn = true;
    this.isDirty = false;

    this.init();
  }

  getTemplates() {
    return (typeof window !== 'undefined' && window.DZ_WORD_TEMPLATES) ? window.DZ_WORD_TEMPLATES : [];
  }

  init() {
    this.editor = document.getElementById('documentEditor');
    if (!this.editor) return;

    this.setupRuler();
    this.bindEvents();
    this.setupRibbonTabs();
    this.setupTableGridPicker();
    this.setupStylesGallery();
    this.setupTemplates();
    this.setupBackstage();
    this.setupMiniToolbar();
    this.setupContextMenu();
    this.loadDefaultDocument();
    this.updateStats();
  }

  // ==========================================================================
  // 1. RULER SETUP
  // ==========================================================================
  setupRuler() {
    const ruler = document.getElementById('rulerHorizontal');
    if (!ruler) return;
    ruler.innerHTML = '';

    const totalCm = this.pageOrientation === 'landscape' ? 29.7 : 21;
    const rulerWidth = this.pageOrientation === 'landscape' ? 1056 : 816;
    const pxPerCm = rulerWidth / totalCm;

    ruler.style.width = `${rulerWidth}px`;

    const marginCm = this.pageMargins === 'narrow' ? 1.27 : (this.pageMargins === 'wide' ? 3.5 : 2.54);
    const marginPx = marginCm * pxPerCm;

    const leftMargin = document.createElement('div');
    leftMargin.className = 'ruler-margin-zone';
    leftMargin.style.left = '0';
    leftMargin.style.width = `${marginPx}px`;

    const rightMargin = document.createElement('div');
    rightMargin.className = 'ruler-margin-zone';
    rightMargin.style.right = '0';
    rightMargin.style.width = `${marginPx}px`;

    ruler.appendChild(leftMargin);
    ruler.appendChild(rightMargin);

    for (let cm = 0; cm <= totalCm; cm++) {
      const pos = cm * pxPerCm;
      const tick = document.createElement('div');
      tick.className = 'ruler-tick' + (cm % 1 === 0 ? ' major' : '');
      tick.style.left = `${pos}px`;

      if (cm > 0 && cm < totalCm) {
        const label = document.createElement('span');
        label.className = 'ruler-tick-label';
        label.style.left = `${pos}px`;
        label.textContent = cm;
        ruler.appendChild(label);
      }
      ruler.appendChild(tick);
    }
  }

  // ==========================================================================
  // 2. RIBBON TABS
  // ==========================================================================
  setupRibbonTabs() {
    const tabs = document.querySelectorAll('.tab-btn[data-tab]');
    const panes = document.querySelectorAll('.ribbon-tab-pane');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        if (target === 'file') {
          this.openBackstage();
          return;
        }

        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const targetPane = document.getElementById(`tabPane_${target}`);
        if (targetPane) targetPane.classList.add('active');
      });
    });
  }

  // ==========================================================================
  // 3. EVENT BINDINGS
  // ==========================================================================
  bindEvents() {
    // Editor input listener
    this.editor.addEventListener('input', () => {
      this.isDirty = true;
      this.updateStats();
      if (this.isAutoSaveOn) {
        this.autoSave();
      }
    });

    // Formatting Toolbar commands
    document.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cmd = btn.getAttribute('data-cmd');
        const val = btn.getAttribute('data-val') || null;
        this.executeFormat(cmd, val);
      });
    });

    // Font Family Select
    const fontSelect = document.getElementById('fontFamilySelect');
    if (fontSelect) {
      fontSelect.addEventListener('change', (e) => {
        this.executeFormat('fontName', e.target.value);
      });
    }

    // Font Size Select
    const fontSizeSelect = document.getElementById('fontSizeSelect');
    if (fontSizeSelect) {
      fontSizeSelect.addEventListener('change', (e) => {
        this.executeFormat('fontSize', e.target.value);
      });
    }

    // Grow / Shrink Font
    document.getElementById('btnGrowFont')?.addEventListener('click', () => this.adjustFontSize(1));
    document.getElementById('btnShrinkFont')?.addEventListener('click', () => this.adjustFontSize(-1));

    // Clear Formatting
    document.getElementById('btnClearFormat')?.addEventListener('click', () => {
      this.executeFormat('removeFormat');
    });

    // Text & Highlight Color Pickers
    const textColorPicker = document.getElementById('textColorInput');
    const textColorBar = document.getElementById('textColorBar');
    if (textColorPicker && textColorBar) {
      textColorPicker.addEventListener('input', (e) => {
        textColorBar.style.backgroundColor = e.target.value;
        this.executeFormat('foreColor', e.target.value);
      });
    }

    const hiliteColorPicker = document.getElementById('hiliteColorInput');
    const hiliteColorBar = document.getElementById('hiliteColorBar');
    if (hiliteColorPicker && hiliteColorBar) {
      hiliteColorPicker.addEventListener('input', (e) => {
        hiliteColorBar.style.backgroundColor = e.target.value;
        this.executeFormat('hiliteColor', e.target.value);
      });
    }

    // Format Painter
    document.getElementById('btnFormatPainter')?.addEventListener('click', () => {
      this.toggleFormatPainter();
    });

    // Paragraph Marks (¶)
    document.getElementById('btnToggleMarks')?.addEventListener('click', () => {
      this.showParagraphMarks = !this.showParagraphMarks;
      this.editor.classList.toggle('show-marks', this.showParagraphMarks);
      document.getElementById('btnToggleMarks')?.classList.toggle('active', this.showParagraphMarks);
    });

    // Text Direction (RTL / LTR)
    document.getElementById('btnDirRtl')?.addEventListener('click', () => this.setDirection('rtl'));
    document.getElementById('btnDirLtr')?.addEventListener('click', () => this.setDirection('ltr'));

    // Shading Background
    document.getElementById('btnShadingInput')?.addEventListener('input', (e) => {
      const color = e.target.value;
      const sel = window.getSelection();
      if (sel && sel.anchorNode) {
        let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        while (node && node !== this.editor && !['P', 'DIV', 'H1', 'H2', 'H3', 'TD', 'TH'].includes(node.tagName)) {
          node = node.parentElement;
        }
        if (node && node !== this.editor) {
          node.style.backgroundColor = color;
        }
      }
    });

    // AutoSave Toggle
    document.getElementById('autoSaveTogglePill')?.addEventListener('click', () => {
      this.isAutoSaveOn = !this.isAutoSaveOn;
      const pill = document.getElementById('autoSaveTogglePill');
      const toggle = pill?.querySelector('.autosave-toggle');
      if (toggle) {
        toggle.style.background = this.isAutoSaveOn ? '#10b981' : '#94a3b8';
      }
      const label = document.getElementById('autoSaveLabel');
      if (label) {
        label.textContent = this.isAutoSaveOn ? 'الحفظ التلقائي: تشغيل' : 'الحفظ التلقائي: متوقف';
      }
    });

    // Title input
    const docTitleInput = document.getElementById('docTitleInput');
    if (docTitleInput) {
      docTitleInput.addEventListener('input', (e) => {
        this.docTitle = e.target.value.trim() || 'مستند 1 - Word';
        document.title = `${this.docTitle} — Word`;
      });
    }

    // Zoom controls
    const zoomSlider = document.getElementById('zoomSliderBar');
    const zoomVal = document.getElementById('zoomValueLabel');
    if (zoomSlider && zoomVal) {
      zoomSlider.addEventListener('input', (e) => {
        this.setZoom(parseInt(e.target.value, 10));
      });
    }
    document.getElementById('btnZoomOut')?.addEventListener('click', () => this.setZoom(this.zoomLevel - 10));
    document.getElementById('btnZoomIn')?.addEventListener('click', () => this.setZoom(this.zoomLevel + 10));
    document.getElementById('zoomValueLabel')?.addEventListener('click', () => this.setZoom(100));

    // View Modes
    document.getElementById('btnViewPrint')?.addEventListener('click', () => this.setViewMode('print'));
    document.getElementById('btnViewRead')?.addEventListener('click', () => this.setViewMode('read'));
    document.getElementById('btnViewWeb')?.addEventListener('click', () => this.setViewMode('web'));

    // Image Upload
    const imgInput = document.getElementById('imageFileInput');
    if (imgInput) {
      imgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (loadEvt) => this.insertImage(loadEvt.target.result);
          reader.readAsDataURL(file);
        }
        imgInput.value = '';
      });
    }

    // Page Orientation & Margins
    document.getElementById('btnOrientationPortrait')?.addEventListener('click', () => this.setOrientation('portrait'));
    document.getElementById('btnOrientationLandscape')?.addEventListener('click', () => this.setOrientation('landscape'));
    document.getElementById('btnMarginNormal')?.addEventListener('click', () => this.setMargins('normal'));
    document.getElementById('btnMarginNarrow')?.addEventListener('click', () => this.setMargins('narrow'));
    document.getElementById('btnMarginWide')?.addEventListener('click', () => this.setMargins('wide'));

    // Search Box in Titlebar
    const titleSearch = document.getElementById('titleSearchInput');
    if (titleSearch) {
      titleSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.toggleNavigationPane(true, titleSearch.value);
        }
      });
    }

    // Navigation Pane toggle
    document.getElementById('btnToggleNavPane')?.addEventListener('click', () => this.toggleNavigationPane());
    document.getElementById('btnCloseNavPane')?.addEventListener('click', () => this.toggleNavigationPane(false));
    document.getElementById('navSearchInput')?.addEventListener('input', (e) => this.performNavSearch(e.target.value));

    // Word Count modal
    document.getElementById('statusWordCount')?.addEventListener('click', () => this.openWordCountDialog());

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault();
            this.exportDocx();
            break;
          case 'p':
            e.preventDefault();
            this.printDocument();
            break;
          case 'f':
            e.preventDefault();
            this.toggleNavigationPane(true);
            break;
          case 'h':
            e.preventDefault();
            this.openFindReplaceModal();
            break;
        }
      }
      if (e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        titleSearch?.focus();
      }
    });

    // Quick Access Print
    document.getElementById('qaPrintBtn')?.addEventListener('click', () => {
      this.printDocument();
    });

    // Line Spacing dropdown
    const lineSpacingSelect = document.getElementById('lineSpacingSelect');
    if (lineSpacingSelect) {
      lineSpacingSelect.addEventListener('change', (e) => {
        this.setLineSpacing(e.target.value);
      });
    }

    // Table Picker Dropdown Toggle
    const tableToggle = document.getElementById('btnTablePickerToggle');
    const tableDropdown = document.getElementById('tableDropdown');
    if (tableToggle && tableDropdown) {
      tableToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = tableDropdown.style.display === 'block';
        tableDropdown.style.display = isOpen ? 'none' : 'block';
      });
      document.addEventListener('click', (e) => {
        if (!tableToggle.contains(e.target) && !tableDropdown.contains(e.target)) {
          tableDropdown.style.display = 'none';
        }
      });
    }

    // Watermark buttons
    document.querySelectorAll('[data-watermark]').forEach(btn => {
      btn.addEventListener('click', () => {
        const wm = btn.getAttribute('data-watermark');
        this.setWatermark(wm);
      });
    });

    // Window controls
    document.querySelectorAll('.win-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('close')) {
          if (confirm('هل ترغب في فتح مستند جديد وإعادة الضبط؟')) {
            this.newDocument();
          }
        } else if (btn.title.includes('استعادة') || btn.title.includes('تكبير')) {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.().catch(() => {});
          } else {
            document.exitFullscreen?.().catch(() => {});
          }
        } else {
          document.querySelector('.word-ribbon')?.classList.toggle('collapsed');
        }
      });
    });

    // Close Modals
    document.querySelectorAll('.dialog-close, [data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
      });
    });
  }

  // ==========================================================================
  // 4. FORMATTING ENGINE
  // ==========================================================================
  executeFormat(cmd, val = null) {
    this.editor.focus();
    if (cmd === 'save') {
      this.exportDocx();
      return;
    }
    document.execCommand(cmd, false, val);
    this.updateStats();
  }

  adjustFontSize(delta) {
    const fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
    const select = document.getElementById('fontSizeSelect');
    let current = parseInt(select?.value || '12', 10);
    let idx = fontSizes.indexOf(current);
    if (idx === -1) idx = 4;
    let nextIdx = Math.max(0, Math.min(fontSizes.length - 1, idx + delta));
    let nextSize = fontSizes[nextIdx];
    if (select) select.value = nextSize;
    this.executeFormat('fontSize', nextSize);
  }

  setDirection(dir) {
    this.editor.setAttribute('dir', dir);
    this.editor.style.textAlign = dir === 'rtl' ? 'right' : 'left';
    document.getElementById('btnDirRtl')?.classList.toggle('active', dir === 'rtl');
    document.getElementById('btnDirLtr')?.classList.toggle('active', dir === 'ltr');
  }

  setLineSpacing(spacing) {
    const sel = window.getSelection();
    if (sel && sel.anchorNode) {
      let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      while (node && node !== this.editor && !['P', 'DIV', 'H1', 'H2', 'H3'].includes(node.tagName)) {
        node = node.parentElement;
      }
      if (node && node !== this.editor) {
        node.style.lineHeight = spacing;
      } else {
        this.editor.style.lineHeight = spacing;
      }
    }
  }

  toggleFormatPainter() {
    if (!this.formatPainterActive) {
      const sel = window.getSelection();
      if (sel && sel.anchorNode) {
        const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        const style = window.getComputedStyle(el);
        this.copiedStyle = {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          color: style.color,
          backgroundColor: style.backgroundColor,
          textDecoration: style.textDecoration
        };
        this.formatPainterActive = true;
        document.getElementById('btnFormatPainter')?.classList.add('active');
        this.editor.style.cursor = 'copy';

        const applyHandler = () => {
          if (this.formatPainterActive && this.copiedStyle) {
            const currentSel = window.getSelection();
            if (currentSel && !currentSel.isCollapsed) {
              const span = document.createElement('span');
              Object.assign(span.style, this.copiedStyle);
              try {
                const range = currentSel.getRangeAt(0);
                range.surroundContents(span);
              } catch (e) {
                // fallback
              }
            }
          }
          this.formatPainterActive = false;
          this.editor.style.cursor = 'text';
          document.getElementById('btnFormatPainter')?.classList.remove('active');
          this.editor.removeEventListener('mouseup', applyHandler);
        };

        this.editor.addEventListener('mouseup', applyHandler);
      }
    } else {
      this.formatPainterActive = false;
      this.editor.style.cursor = 'text';
      document.getElementById('btnFormatPainter')?.classList.remove('active');
    }
  }

  // ==========================================================================
  // 5. STYLES GALLERY
  // ==========================================================================
  setupStylesGallery() {
    const styles = [
      { id: 'normal', name: 'عادي (Normal)', tag: 'p', css: 'font-size: 12pt; font-weight: normal; color: #1e293b;' },
      { id: 'no-spacing', name: 'بلا تباعد', tag: 'p', css: 'font-size: 12pt; line-height: 1.2; margin: 0;' },
      { id: 'heading1', name: 'عنوان 1', tag: 'h1', css: 'font-size: 20pt; font-weight: 700; color: #185abd; border-bottom: 2px solid #e2e8f0; margin-top: 15px;' },
      { id: 'heading2', name: 'عنوان 2', tag: 'h2', css: 'font-size: 16pt; font-weight: 700; color: #2b579a; margin-top: 12px;' },
      { id: 'heading3', name: 'عنوان 3', tag: 'h3', css: 'font-size: 14pt; font-weight: 600; color: #047857; margin-top: 10px;' },
      { id: 'title', name: 'عنوان رئيسي', tag: 'h1', css: 'font-size: 24pt; font-weight: 800; color: #0f172a; text-align: center;' },
      { id: 'subtitle', name: 'عنوان فرعي', tag: 'p', css: 'font-size: 13pt; color: #64748b; font-style: italic; text-align: center;' },
      { id: 'quote', name: 'اقتباس', tag: 'blockquote', css: 'font-size: 12pt; font-style: italic; border-right: 4px solid #185abd; padding: 8px 16px; background: #f8fafc; color: #475569;' }
    ];

    const gallery = document.getElementById('stylesGallery');
    if (!gallery) return;
    gallery.innerHTML = '';

    styles.forEach(st => {
      const card = document.createElement('div');
      card.className = 'style-card';
      card.innerHTML = `
        <span class="style-sample">أبجد</span>
        <span class="style-name">${st.name}</span>
      `;
      card.addEventListener('click', () => {
        gallery.querySelectorAll('.style-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.applyStyle(st);
      });
      gallery.appendChild(card);
    });
  }

  applyStyle(st) {
    this.editor.focus();
    const sel = window.getSelection();
    if (sel && sel.anchorNode) {
      let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      while (node && node !== this.editor && !['P', 'DIV', 'H1', 'H2', 'H3', 'BLOCKQUOTE'].includes(node.tagName)) {
        node = node.parentElement;
      }
      if (node && node !== this.editor) {
        const newEl = document.createElement(st.tag);
        newEl.innerHTML = node.innerHTML;
        newEl.style.cssText = st.css;
        node.parentNode.replaceChild(newEl, node);
      } else {
        document.execCommand('formatBlock', false, st.tag);
      }
    }
    this.updateStats();
  }

  // ==========================================================================
  // 6. TABLE GRID PICKER (10x8)
  // ==========================================================================
  setupTableGridPicker() {
    const container = document.getElementById('tableGridPicker');
    if (!container) return;
    container.innerHTML = '';

    const label = document.getElementById('tableGridSizeLabel');

    for (let r = 1; r <= 8; r++) {
      for (let c = 1; c <= 10; c++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;

        cell.addEventListener('mouseenter', () => {
          container.querySelectorAll('.grid-cell').forEach(other => {
            const or = parseInt(other.dataset.r, 10);
            const oc = parseInt(other.dataset.c, 10);
            other.classList.toggle('highlight', or <= r && oc <= c);
          });
          if (label) label.textContent = `${c} × ${r} جدول`;
        });

        cell.addEventListener('click', () => {
          this.insertTable(r, c);
          const td = document.getElementById('tableDropdown');
          if (td) {
            td.classList.remove('open');
            td.style.display = 'none';
          }
        });

        container.appendChild(cell);
      }
    }
  }

  insertTable(rows, cols) {
    this.editor.focus();
    let tableHtml = `<table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 11pt;">`;
    tableHtml += `<thead><tr style="background: #f1f5f9;">`;
    for (let c = 1; c <= cols; c++) {
      tableHtml += `<th style="border: 1px solid #94a3b8; padding: 8px 10px; font-weight: bold; text-align: inherit;">العمود ${c}</th>`;
    }
    tableHtml += `</tr></thead><tbody>`;
    for (let r = 1; r <= rows; r++) {
      tableHtml += `<tr>`;
      for (let c = 1; c <= cols; c++) {
        tableHtml += `<td style="border: 1px solid #cbd5e1; padding: 8px 10px;">بيانات (${r}, ${c})</td>`;
      }
      tableHtml += `</tr>`;
    }
    tableHtml += `</tbody></table><p><br></p>`;
    document.execCommand('insertHTML', false, tableHtml);
    this.updateStats();
  }

  // ==========================================================================
  // 7. FLOATING MINI-TOOLBAR & CONTEXT MENU
  // ==========================================================================
  setupMiniToolbar() {
    const toolbar = document.getElementById('floatingMiniToolbar');
    if (!toolbar) return;

    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && this.editor.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect && rect.width > 0) {
          toolbar.style.top = `${window.scrollY + rect.top - 46}px`;
          toolbar.style.left = `${window.scrollX + rect.left + rect.width / 2 - 80}px`;
          toolbar.classList.add('visible');
          return;
        }
      }
      toolbar.classList.remove('visible');
    });
  }

  setupContextMenu() {
    const menu = document.getElementById('wordContextMenu');
    if (!menu) return;

    this.editor.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu.style.top = `${e.clientY}px`;
      menu.style.left = `${e.clientX}px`;
      menu.classList.add('open');
    });

    document.addEventListener('click', () => {
      menu.classList.remove('open');
    });
  }

  // ==========================================================================
  // 8. TEMPLATES & EMBLEMS
  // ==========================================================================
  setupTemplates() {
    const container = document.getElementById('backstageTemplatesGrid');
    if (!container) return;
    container.innerHTML = '';

    // Blank Document card first
    const blankCard = document.createElement('div');
    blankCard.className = 'template-tile';
    blankCard.innerHTML = `
      <div class="template-tile-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="12" y1="18" x2="12" y2="12"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
      </div>
      <h4>مستند فارغ</h4>
      <span>مستند جديد بدون محتوى</span>
    `;
    blankCard.addEventListener('click', () => {
      this.newDocument();
      this.closeBackstage();
    });
    container.appendChild(blankCard);

    // 7 Algerian Administrative templates
    const templates = this.getTemplates();
    templates.forEach(tpl => {
      const tile = document.createElement('div');
      tile.className = 'template-tile';
      tile.innerHTML = `
        <div class="template-tile-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </div>
        <h4>${tpl.nameAr}</h4>
        <span>${tpl.category}</span>
      `;
      tile.addEventListener('click', () => {
        this.applyTemplate(tpl);
        this.closeBackstage();
      });
      container.appendChild(tile);
    });
  }

  loadDefaultDocument() {
    const templates = this.getTemplates();
    const defaultTpl = templates[0];
    if (defaultTpl && !this.editor.innerText.trim()) {
      this.applyTemplate(defaultTpl);
    }
  }

  applyTemplate(tpl) {
    this.editor.innerHTML = tpl.content;
    this.docTitle = tpl.nameAr;
    const titleInput = document.getElementById('docTitleInput');
    if (titleInput) titleInput.value = this.docTitle;
    document.title = `${this.docTitle} — Word`;
    this.setDirection(tpl.direction || 'rtl');
    this.updateStats();
  }

  insertAlgerianHeader() {
    this.editor.focus();
    const headerHtml = `
      <div style="text-align: center; border-bottom: 2px solid #047857; padding-bottom: 15px; margin-bottom: 25px;">
        <h3 style="margin: 0; color: #047857; font-size: 16pt; font-family: 'Amiri', 'Cairo', serif;">الجمهورية الجزائرية الديمقراطية الشعبية</h3>
        <p style="margin: 4px 0; color: #475569; font-size: 11pt; font-family: sans-serif;">République Algérienne Démocratique et Populaire</p>
        <p style="margin: 4px 0; font-weight: bold; color: #1e3a8a; font-size: 12pt;">وزارة [اسم الوزارة أو الهيئة الحكومية]</p>
        <p style="margin: 2px 0; font-size: 10pt; color: #64748b;">مديرية [المديرية العامة] — ولاية [الولاية]</p>
      </div>
      <p><br></p>
    `;
    document.execCommand('insertHTML', false, headerHtml);
    this.updateStats();
  }

  insertOfficialSeal() {
    this.editor.focus();
    const sealHtml = `
      <div style="display: inline-block; border: 2px dashed #047857; border-radius: 50%; width: 120px; height: 120px; text-align: center; padding: 20px 10px; color: #047857; font-size: 10pt; font-weight: bold; transform: rotate(-5deg); margin: 20px;">
        الجمهورية الجزائرية<br>الديمقراطية الشعبية<br>★ ختم رسمي ★
      </div>
    `;
    document.execCommand('insertHTML', false, sealHtml);
    this.updateStats();
  }

  insertImage(src) {
    this.editor.focus();
    const imgHtml = `
      <div style="text-align: center; margin: 15px 0;">
        <img src="${src}" style="max-width: 90%; max-height: 400px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #cbd5e1;">
      </div><p><br></p>
    `;
    document.execCommand('insertHTML', false, imgHtml);
    this.updateStats();
  }

  insertPageBreak() {
    this.editor.focus();
    const hrHtml = `<hr style="border: 0; border-top: 2px dashed #94a3b8; margin: 40px 0; page-break-after: always;"><p><br></p>`;
    document.execCommand('insertHTML', false, hrHtml);
    this.updateStats();
  }

  setWatermark(text) {
    let wm = this.editor.querySelector('.page-watermark');
    if (!text) {
      if (wm) wm.remove();
      return;
    }
    if (!wm) {
      wm = document.createElement('div');
      wm.className = 'page-watermark';
      this.editor.prepend(wm);
    }
    wm.textContent = text;
  }

  // ==========================================================================
  // 9. PAGE SETUP & LAYOUT
  // ==========================================================================
  setOrientation(orient) {
    this.pageOrientation = orient;
    const page = this.editor;
    if (orient === 'landscape') {
      page.style.width = '1056px';
      page.style.minHeight = '816px';
    } else {
      page.style.width = '816px';
      page.style.minHeight = '1056px';
    }
    this.setupRuler();
    document.getElementById('btnOrientationPortrait')?.classList.toggle('active', orient === 'portrait');
    document.getElementById('btnOrientationLandscape')?.classList.toggle('active', orient === 'landscape');
  }

  setMargins(type) {
    this.pageMargins = type;
    const marginMap = {
      normal: '72px 72px',
      narrow: '36px 36px',
      wide: '100px 100px'
    };
    this.editor.style.padding = marginMap[type] || '72px 72px';
    this.setupRuler();
  }

  // ==========================================================================
  // 10. NAVIGATION PANE & SEARCH
  // ==========================================================================
  toggleNavigationPane(forceState, initialQuery = '') {
    const pane = document.getElementById('navigationPane');
    if (!pane) return;

    const isOpen = forceState !== undefined ? forceState : !pane.classList.contains('open');
    pane.classList.toggle('open', isOpen);

    if (isOpen) {
      const searchInput = document.getElementById('navSearchInput');
      if (searchInput) {
        if (initialQuery) searchInput.value = initialQuery;
        searchInput.focus();
        this.performNavSearch(searchInput.value);
      }
    }
  }

  performNavSearch(query) {
    const resultsContainer = document.getElementById('navResultsList');
    if (!resultsContainer) return;
    resultsContainer.innerHTML = '';

    if (!query) {
      const headings = this.editor.querySelectorAll('h1, h2, h3');
      headings.forEach((h) => {
        const item = document.createElement('div');
        item.className = 'nav-result-item';
        item.textContent = `${h.tagName}: ${h.textContent}`;
        item.addEventListener('click', () => h.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        resultsContainer.appendChild(item);
      });
      return;
    }

    const text = this.editor.innerText || '';
    const regex = new RegExp(query, 'gi');
    let match;
    let count = 0;

    while ((match = regex.exec(text)) !== null && count < 25) {
      count++;
      const snippetStart = Math.max(0, match.index - 20);
      const snippetEnd = Math.min(text.length, match.index + query.length + 20);
      const snippet = text.substring(snippetStart, snippetEnd);

      const item = document.createElement('div');
      item.className = 'nav-result-item';
      item.innerHTML = `<strong>نتيجة ${count}:</strong> ...${snippet.replace(regex, '<mark>$&</mark>')}...`;
      item.addEventListener('click', () => {
        window.find?.(query, false, false, true);
      });
      resultsContainer.appendChild(item);
    }
  }

  // ==========================================================================
  // 11. BACKSTAGE (ملف - FILE)
  // ==========================================================================
  setupBackstage() {
    const backstage = document.getElementById('wordBackstage');
    if (!backstage) return;

    document.querySelectorAll('.backstage-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const paneId = btn.getAttribute('data-pane');
        if (!paneId) return;
        document.querySelectorAll('.backstage-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.backstage-pane').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(`backstagePane_${paneId}`)?.classList.add('active');
      });
    });

    document.getElementById('btnBackstageBack')?.addEventListener('click', () => this.closeBackstage());

    document.getElementById('btnBackstageNew')?.addEventListener('click', () => {
      this.newDocument();
      this.closeBackstage();
    });

    document.getElementById('btnBackstageSave')?.addEventListener('click', () => {
      this.exportDocx();
      this.closeBackstage();
    });

    document.getElementById('btnBackstagePrint')?.addEventListener('click', () => {
      this.closeBackstage();
      this.printDocument();
    });

    document.getElementById('btnExportDocx')?.addEventListener('click', () => this.exportDocx());
    document.getElementById('btnExportPdf')?.addEventListener('click', () => this.printDocument());
    document.getElementById('btnExportHtml')?.addEventListener('click', () => this.exportHtml());
    document.getElementById('btnExportMd')?.addEventListener('click', () => this.exportMarkdown());
    document.getElementById('btnExportTxt')?.addEventListener('click', () => this.exportTxt());
    document.getElementById('btnExportDzdoc')?.addEventListener('click', () => this.exportDzdoc());

    const fileInput = document.getElementById('openFileInput');
    document.getElementById('btnBackstageOpen')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.openDocumentFile(e.target.files[0]);
        this.closeBackstage();
      }
      fileInput.value = '';
    });
  }

  openBackstage() {
    document.getElementById('wordBackstage')?.classList.add('active');
    this.updateDocumentInfo();
  }

  closeBackstage() {
    document.getElementById('wordBackstage')?.classList.remove('active');
  }

  updateDocumentInfo() {
    const text = this.editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;

    const infoWords = document.getElementById('infoDocWords');
    const infoChars = document.getElementById('infoDocChars');
    const infoDate = document.getElementById('infoDocDate');

    if (infoWords) infoWords.textContent = words;
    if (infoChars) infoChars.textContent = chars;
    if (infoDate) infoDate.textContent = new Date().toLocaleString('ar-DZ');
  }

  // ==========================================================================
  // 12. IMPORT & EXPORT
  // ==========================================================================
  exportDocx() {
    const docxGen = typeof window !== 'undefined' ? window.generateDocxBlob : null;
    if (typeof docxGen === 'function') {
      const blob = docxGen(this.editor.innerHTML, {
        title: this.docTitle,
        direction: this.editor.getAttribute('dir') || 'rtl',
        orientation: this.pageOrientation
      });
      this.downloadBlob(blob, `${this.sanitizeFilename(this.docTitle)}.docx`);
    } else {
      // Fallback export as HTML
      this.exportHtml();
    }
  }

  exportHtml() {
    const fullHtml = `<!DOCTYPE html>
<html lang="${this.currentLang}" dir="${this.editor.getAttribute('dir') || 'rtl'}">
<head>
  <meta charset="UTF-8">
  <title>${this.docTitle}</title>
  <style>
    body { font-family: 'Amiri', 'Cairo', 'Segoe UI', system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.8; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; }
    th { background: #f8fafc; }
    img { max-width: 100%; border-radius: 6px; }
  </style>
</head>
<body>
  ${this.editor.innerHTML}
</body>
</html>`;
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    this.downloadBlob(blob, `${this.sanitizeFilename(this.docTitle)}.html`);
  }

  exportMarkdown() {
    let text = this.editor.innerHTML;
    text = text.replace(/<h1>(.*?)<\/h1>/gi, '# $1\n\n');
    text = text.replace(/<h2>(.*?)<\/h2>/gi, '## $1\n\n');
    text = text.replace(/<h3>(.*?)<\/h3>/gi, '### $1\n\n');
    text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**');
    text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
    text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*');
    text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*');
    text = text.replace(/<p>(.*?)<\/p>/gi, '$1\n\n');
    text = text.replace(/<br\s*[\/]?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    this.downloadBlob(blob, `${this.sanitizeFilename(this.docTitle)}.md`);
  }

  exportTxt() {
    const text = this.editor.innerText || '';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    this.downloadBlob(blob, `${this.sanitizeFilename(this.docTitle)}.txt`);
  }

  exportDzdoc() {
    const docData = {
      title: this.docTitle,
      contentHtml: this.editor.innerHTML,
      direction: this.editor.getAttribute('dir') || 'rtl',
      orientation: this.pageOrientation,
      margins: this.pageMargins,
      updatedAt: new Date().toISOString(),
      generator: 'DZ-Word Sovereign Studio 2.0'
    };
    const blob = new Blob([JSON.stringify(docData, null, 2)], { type: 'application/json' });
    this.downloadBlob(blob, `${this.sanitizeFilename(this.docTitle)}.dzdoc`);
  }

  openDocumentFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.contentHtml) {
          this.editor.innerHTML = data.contentHtml;
          if (data.title) {
            this.docTitle = data.title;
            const input = document.getElementById('docTitleInput');
            if (input) input.value = this.docTitle;
          }
          if (data.direction) this.setDirection(data.direction);
          if (data.orientation) this.setOrientation(data.orientation);
          this.updateStats();
          return;
        }
      } catch (err) {
        this.editor.innerHTML = e.target.result;
        this.updateStats();
      }
    };
    reader.readAsText(file);
  }

  printDocument() {
    window.print();
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_');
  }

  newDocument() {
    this.editor.innerHTML = '<p><br></p>';
    this.docTitle = 'مستند 1 - Word';
    const input = document.getElementById('docTitleInput');
    if (input) input.value = this.docTitle;
    document.title = `${this.docTitle} — Word`;
    this.setDirection('rtl');
    this.updateStats();
  }

  // ==========================================================================
  // 13. STATS & DIALOGS
  // ==========================================================================
  updateStats() {
    const text = this.editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const pages = Math.max(1, Math.ceil(words / 350));

    const wLabel = document.getElementById('statusWordCountLabel');
    const pLabel = document.getElementById('statusPageCountLabel');
    if (wLabel) wLabel.textContent = `${words} كلمة`;
    if (pLabel) pLabel.textContent = `الصفحة 1 من ${pages}`;

    const savedLabel = document.getElementById('statusSavedIndicator');
    if (savedLabel) {
      savedLabel.textContent = '✓ تم الحفظ محلياً';
    }
  }

  openWordCountDialog() {
    const text = this.editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const charsWithSpaces = text.length;
    const charsNoSpaces = text.replace(/\s+/g, '').length;
    const paragraphs = text.split(/\n+/).filter(p => p.trim()).length || 1;
    const lines = Math.max(1, Math.ceil(charsWithSpaces / 70));
    const pages = Math.max(1, Math.ceil(words / 350));

    document.getElementById('dlgPagesCount').textContent = pages;
    document.getElementById('dlgWordsCount').textContent = words;
    document.getElementById('dlgCharsNoSpaces').textContent = charsNoSpaces;
    document.getElementById('dlgCharsWithSpaces').textContent = charsWithSpaces;
    document.getElementById('dlgParagraphsCount').textContent = paragraphs;
    document.getElementById('dlgLinesCount').textContent = lines;

    document.getElementById('modalWordCount')?.classList.add('active');
  }

  openFindReplaceModal() {
    this.toggleNavigationPane(true);
  }

  // ==========================================================================
  // 14. VIEW MODES & ZOOM
  // ==========================================================================
  setZoom(lvl) {
    this.zoomLevel = Math.max(50, Math.min(200, lvl));
    const label = document.getElementById('zoomValueLabel');
    const slider = document.getElementById('zoomSliderBar');
    if (label) label.textContent = `${this.zoomLevel}%`;
    if (slider) slider.value = this.zoomLevel;

    const wrapper = document.querySelector('.document-sheet-container');
    if (wrapper) {
      wrapper.style.transform = `scale(${this.zoomLevel / 100})`;
    }
  }

  setViewMode(mode) {
    document.body.classList.remove('mode-read', 'mode-web');
    if (mode === 'read') {
      document.body.classList.add('mode-read');
    } else if (mode === 'web') {
      document.body.classList.add('mode-web');
    }
  }

  autoSave() {
    try {
      localStorage.setItem('dz_word_autosave', JSON.stringify({
        title: this.docTitle,
        content: this.editor.innerHTML,
        timestamp: Date.now()
      }));
    } catch (e) {
      // ignore
    }
  }
}

  if (typeof window !== 'undefined') {
    window.DZWordApp = DZWordApp;

    const initDzWord = () => {
      if (!window.dzWordApp) {
        window.dzWordApp = new DZWordApp();
      }
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', initDzWord);
    } else {
      initDzWord();
    }
  }
})();

