/**
 * DZ-Whiteboard Pro — Main Application Controller
 * ------------------------------------------------
 * 100% Client-side orchestrator for OpenBoard / Miro alternative:
 * State management, multi-page slide navigation, undo/redo history,
 * presentation mode, export pipeline, and keyboard shortcuts.
 */

import { CanvasEngine } from './canvas-engine.js';
import { ToolsManager } from './tools.js';
import { ExportEngine } from './export-engine.js';

// Trilingual Dictionary
const I18N = {
  ar: {
    appTitle: 'DZ-Whiteboard Pro — السبورة البيضاء التفاعلية',
    mFile: 'ملف (File)',
    mEdit: 'تحرير (Edit)',
    mView: 'عرض (View)',
    mPages: 'صفحات (Pages)',
    mBackground: 'الخلفية (Background)',
    mTools: 'أدوات (Tools)',
    mHelp: 'مساعدة (Help)',

    newBoard: 'لوحة جديدة فارغة',
    openBoard: 'فتح مشروع محلي (.dzboard)...',
    saveBoard: 'حفظ المشروع (.dzboard)',
    exportPng: 'تصدير كصورة عالية الدقة (PNG)',
    exportSvg: 'تصدير كملف متجه (SVG)',
    exportPdf: 'تصدير شرائح الدرس (PDF للطباعة)',

    undo: 'تراجع (Undo)',
    redo: 'إعادة (Redo)',
    deleteSelection: 'حذف المحدد',
    clearPage: 'مسح كافة عناصر الصفحة',

    bgWhite: 'صبورة بيضاء نقية (Whiteboard)',
    bgGrid: 'ورق شبكي / مربعات هندسية (Grid)',
    bgLines: 'ورق مسطر مدرسي (Ruled Lines)',
    bgDots: 'شبكة نقاط (Dotted)',
    bgChalkboard: 'سبورة مدرسية خضراء (Chalkboard)',
    bgBlackboard: 'سبورة سوداء داكنة (Blackboard)',

    addPage: 'إضافة صفحة جديدة',
    duplicatePage: 'تكرار الصفحة الحالية',
    deletePage: 'حذف الصفحة الحالية',

    presentMode: 'وضع الشرح والعرض (F11)',
    exitPresent: 'إنهاء العرض',

    toolSelect: 'تحديد وتحريك (V)',
    toolPen: 'قلم الكتابة (P)',
    toolHighlighter: 'قلم التمييز (H)',
    toolEraser: 'ممحاة (E)',
    toolShape: 'أشكال هندسية (R)',
    toolLine: 'أسهم وخطوط (A)',
    toolText: 'كتابة نصية (T)',
    toolSticky: 'ملاحظة لاصقة (S)',
    toolLaser: 'مؤشر الليزر (K)',
    toolHand: 'تحريك الرقعة (Space)',

    pageLabel: 'الصفحة'
  },
  fr: {
    appTitle: 'DZ-Whiteboard Pro — Tableau Blanc Interactif',
    mFile: 'Fichier',
    mEdit: 'Édition',
    mView: 'Affichage',
    mPages: 'Pages',
    mBackground: 'Arrière-plan',
    mTools: 'Outils',
    mHelp: 'Aide',

    newBoard: 'Nouveau tableau vierge',
    openBoard: 'Ouvrir projet (.dzboard)...',
    saveBoard: 'Enregistrer (.dzboard)',
    exportPng: 'Exporter image HD (PNG)',
    exportSvg: 'Exporter vecteur (SVG)',
    exportPdf: 'Exporter en PDF (Imprimable)',

    undo: 'Annuler (Undo)',
    redo: 'Rétablir (Redo)',
    deleteSelection: 'Supprimer la sélection',
    clearPage: 'Effacer toute la page',

    bgWhite: 'Tableau blanc pur (Whiteboard)',
    bgGrid: 'Papier quadrillé (Grid)',
    bgLines: 'Lignes cahier d’école (Ruled)',
    bgDots: 'Grille de points (Dotted)',
    bgChalkboard: 'Tableau vert d’école (Chalkboard)',
    bgBlackboard: 'Tableau noir mat (Blackboard)',

    addPage: 'Ajouter une page',
    duplicatePage: 'Dupliquer la page active',
    deletePage: 'Supprimer la page active',

    presentMode: 'Mode Présentation (F11)',
    exitPresent: 'Quitter le mode présentation',

    toolSelect: 'Sélection (V)',
    toolPen: 'Stylo (P)',
    toolHighlighter: 'Surligneur (H)',
    toolEraser: 'Gomme (E)',
    toolShape: 'Formes géométriques (R)',
    toolLine: 'Flèches et lignes (A)',
    toolText: 'Texte (T)',
    toolSticky: 'Pense-bête (S)',
    toolLaser: 'Pointeur laser (K)',
    toolHand: 'Déplacer (Space)',

    pageLabel: 'Page'
  },
  en: {
    appTitle: 'DZ-Whiteboard Pro — Interactive Whiteboard Suite',
    mFile: 'File',
    mEdit: 'Edit',
    mView: 'View',
    mPages: 'Pages',
    mBackground: 'Background',
    mTools: 'Tools',
    mHelp: 'Help',

    newBoard: 'New Blank Board',
    openBoard: 'Open Project (.dzboard)...',
    saveBoard: 'Save Project (.dzboard)',
    exportPng: 'Export High-Res Image (PNG)',
    exportSvg: 'Export Vector (SVG)',
    exportPdf: 'Export Lesson Slides (PDF)',

    undo: 'Undo',
    redo: 'Redo',
    deleteSelection: 'Delete Selection',
    clearPage: 'Clear Entire Page',

    bgWhite: 'Pure Whiteboard',
    bgGrid: 'Grid / Graph Paper',
    bgLines: 'Ruled Classroom Lines',
    bgDots: 'Dotted Grid',
    bgChalkboard: 'Classroom Green Chalkboard',
    bgBlackboard: 'Matte Blackboard',

    addPage: 'Add New Page',
    duplicatePage: 'Duplicate Current Page',
    deletePage: 'Delete Current Page',

    presentMode: 'Presentation Mode (F11)',
    exitPresent: 'Exit Presentation',

    toolSelect: 'Select (V)',
    toolPen: 'Pen (P)',
    toolHighlighter: 'Highlighter (H)',
    toolEraser: 'Eraser (E)',
    toolShape: 'Shapes (R)',
    toolLine: 'Lines & Arrows (A)',
    toolText: 'Text (T)',
    toolSticky: 'Sticky Note (S)',
    toolLaser: 'Laser Pointer (K)',
    toolHand: 'Pan Canvas (Space)',

    pageLabel: 'Page'
  }
};

class DZWhiteboardApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_wb_lang') || 'ar';
    this.currentTheme = localStorage.getItem('dz_wb_theme') || 'light';

    // History stack per page
    this.historyStack = [];
    this.historyIndex = -1;
    this.maxHistory = 35;

    this.initDOM();
    this.initEngine();
    this.initTools();
    this.initMenus();
    this.initStyleControls();
    this.initPagesDrawer();
    this.initKeyboardShortcuts();
    this.applyTheme(this.currentTheme);
    this.applyLanguage(this.currentLang);

    // Initial seed with demo lecture content if empty
    this.seedDemoIfEmpty();
    this.saveStateToHistory();
    this.updateUI();
  }

  initDOM() {
    this.dom = {
      appContainer: document.getElementById('whiteboardApp'),
      canvas: document.getElementById('whiteboardCanvas'),
      minimapCanvas: document.getElementById('minimapCanvas'),
      textEditor: document.getElementById('textEditorOverlay'),
      fileInput: document.getElementById('fileInputProject'),

      // Header buttons
      langSelect: document.getElementById('langSelect'),
      themeToggleBtn: document.getElementById('themeToggleBtn'),
      btnPresentation: document.getElementById('btnPresentation'),
      btnTogglePages: document.getElementById('btnTogglePages'),

      // Page Drawer
      pagesDrawer: document.getElementById('pagesDrawer'),
      pagesDrawerBody: document.getElementById('pagesDrawerBody'),
      btnAddPage: document.getElementById('btnAddPage'),
      btnCloseDrawer: document.getElementById('btnCloseDrawer'),

      // Floating Tools Dock
      dock: document.getElementById('floatingDock'),
      dockButtons: document.querySelectorAll('.dock-btn'),
      shapesFlyout: document.getElementById('shapesFlyout'),
      stickyFlyout: document.getElementById('stickyFlyout'),

      // Style Shelf
      styleShelf: document.getElementById('styleShelf'),
      colorSwatches: document.querySelectorAll('.color-dot'),
      strokeWidthButtons: document.querySelectorAll('.stroke-width-btn'),

      // Zoom Controls
      zoomInBtn: document.getElementById('btnZoomIn'),
      zoomOutBtn: document.getElementById('btnZoomOut'),
      zoomResetBtn: document.getElementById('btnZoomReset'),
      zoomFitBtn: document.getElementById('btnZoomFit'),
      zoomLabel: document.getElementById('zoomPctLabel'),

      // Presenter bar
      presenterBar: document.getElementById('presenterBar'),
      btnExitPresent: document.getElementById('btnExitPresent'),
      btnPresentPrevPage: document.getElementById('btnPresentPrevPage'),
      btnPresentNextPage: document.getElementById('btnPresentNextPage'),
      presenterPageText: document.getElementById('presenterPageText')
    };
  }

  initEngine() {
    this.engine = new CanvasEngine(this.dom.canvas, {
      onDirty: () => {
        this.updateZoomDisplay();
        this.engine.renderMinimap(this.dom.minimapCanvas);
      }
    });
  }

  initTools() {
    this.tools = new ToolsManager(this.engine, {
      onElementCreated: (el) => {
        this.saveStateToHistory();
        this.engine.renderMinimap(this.dom.minimapCanvas);
        this.renderPagesList();
      },
      onSelectionChanged: (selectedIds) => {
        this.updateStyleShelfVisibility();
      },
      onTextEditRequest: (req) => {
        this.openInlineTextEditor(req);
      }
    });

    // Tool dock clicks
    this.dom.dockButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tool = btn.getAttribute('data-tool');

        if (tool === 'shapes-menu') {
          const isOpen = this.dom.shapesFlyout.classList.contains('show');
          this.closeAllFlyouts();
          if (!isOpen) this.dom.shapesFlyout.classList.add('show');
          return;
        }

        if (tool === 'sticky-menu') {
          const isOpen = this.dom.stickyFlyout.classList.contains('show');
          this.closeAllFlyouts();
          if (!isOpen) this.dom.stickyFlyout.classList.add('show');
          return;
        }

        this.closeAllFlyouts();
        this.setActiveToolUI(tool);
        this.tools.setTool(tool);
      });
    });

    // Shapes sub-menu clicks
    document.querySelectorAll('.shape-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const shapeType = btn.getAttribute('data-shape');
        this.tools.setTool('shape', shapeType);
        this.setActiveToolUI('shapes-menu');
        this.closeAllFlyouts();
      });
    });

    // Sticky colors sub-menu clicks
    document.querySelectorAll('.sticky-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme');
        this.tools.activeStickyTheme = theme;
        this.tools.setTool('sticky');
        this.setActiveToolUI('sticky-menu');
        this.closeAllFlyouts();
      });
    });

    // Lines choices
    document.querySelectorAll('.line-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lineType = btn.getAttribute('data-line');
        this.tools.setTool('line', lineType);
        this.setActiveToolUI('line');
        this.closeAllFlyouts();
      });
    });

    window.addEventListener('click', () => this.closeAllFlyouts());
  }

  closeAllFlyouts() {
    this.dom.shapesFlyout?.classList.remove('show');
    this.dom.stickyFlyout?.classList.remove('show');
  }

  setActiveToolUI(toolName) {
    this.dom.dockButtons.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tool') === toolName);
    });
    this.updateStyleShelfVisibility();
  }

  updateStyleShelfVisibility() {
    const hasSelection = this.engine.selectedElementIds.size > 0;
    const isDrawingTool = ['pen', 'highlighter', 'shape', 'line', 'text', 'shapes-menu'].includes(this.tools.activeTool);
    this.dom.styleShelf.style.display = (hasSelection || isDrawingTool) ? 'flex' : 'none';
  }

  // --- Inline Text Editor ---

  openInlineTextEditor({ x, y, screenPos, existingElement }) {
    const editor = this.dom.textEditor;
    const canvasRect = this.dom.canvas.getBoundingClientRect();

    let initialText = '';
    let targetX = x;
    let targetY = y;

    if (existingElement) {
      initialText = existingElement.text || '';
      targetX = existingElement.x;
      targetY = existingElement.y;
    }

    const scr = this.engine.worldToScreen(targetX, targetY);

    editor.style.display = 'block';
    editor.style.left = (scr.x - canvasRect.left) + 'px';
    editor.style.top = (scr.y - canvasRect.top) + 'px';
    editor.style.fontSize = (this.tools.fontSize * this.engine.zoom) + 'px';
    editor.style.minWidth = (140 * this.engine.zoom) + 'px';
    editor.value = initialText;

    editor.focus();

    const commit = () => {
      editor.style.display = 'none';
      const val = editor.value.trim();
      if (!val) {
        if (existingElement) {
          const idx = this.engine.activePage.elements.indexOf(existingElement);
          if (idx !== -1) this.engine.activePage.elements.splice(idx, 1);
        }
      } else {
        if (existingElement) {
          existingElement.text = val;
        } else {
          const newText = {
            id: 'text_' + Date.now(),
            type: 'text',
            x: targetX,
            y: targetY,
            text: val,
            fontSize: this.tools.fontSize,
            color: this.tools.strokeColor
          };
          this.engine.activePage.elements.push(newText);
        }
      }
      this.saveStateToHistory();
      this.engine.render();
      this.engine.renderMinimap(this.dom.minimapCanvas);
    };

    editor.onblur = () => commit();
    editor.onkeydown = (e) => {
      if (e.key === 'Escape') {
        editor.style.display = 'none';
      }
    };
  }

  // --- Style Controls Shelf ---

  initStyleControls() {
    this.dom.colorSwatches.forEach((dot) => {
      dot.addEventListener('click', () => {
        this.dom.colorSwatches.forEach((d) => d.classList.remove('active'));
        dot.classList.add('active');
        const color = dot.getAttribute('data-color');
        this.tools.strokeColor = color;

        // Apply to current selection if any
        if (this.engine.selectedElementIds.size > 0) {
          this.engine.activePage.elements.forEach((el) => {
            if (this.engine.selectedElementIds.has(el.id)) {
              if (el.type === 'pen') el.color = color;
              else if (el.type === 'shape' || el.type === 'line') el.strokeColor = color;
              else if (el.type === 'text') el.color = color;
            }
          });
          this.engine.render();
          this.saveStateToHistory();
        }
      });
    });

    this.dom.strokeWidthButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.dom.strokeWidthButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const w = parseInt(btn.getAttribute('data-width'), 10) || 3;
        this.tools.strokeWidth = w;

        if (this.engine.selectedElementIds.size > 0) {
          this.engine.activePage.elements.forEach((el) => {
            if (this.engine.selectedElementIds.has(el.id)) {
              if (el.type === 'pen') el.width = w;
              else if (el.type === 'shape' || el.type === 'line') el.strokeWidth = w;
            }
          });
          this.engine.render();
          this.saveStateToHistory();
        }
      });
    });
  }

  // --- Multi-Page Deck Management ---

  initPagesDrawer() {
    this.dom.btnTogglePages.addEventListener('click', () => {
      this.dom.pagesDrawer.classList.toggle('open');
      this.renderPagesList();
    });

    this.dom.btnCloseDrawer?.addEventListener('click', () => {
      this.dom.pagesDrawer.classList.remove('open');
    });

    this.dom.btnAddPage.addEventListener('click', () => {
      this.addNewPage();
    });
  }

  addNewPage() {
    const newIdx = this.engine.pages.length + 1;
    const bg = this.engine.activePage ? this.engine.activePage.background : 'white';
    const page = this.engine.createBlankPage(`صفحة ${newIdx} (شريحة الدرس)`, bg);
    this.engine.pages.push(page);
    this.engine.activePageIndex = this.engine.pages.length - 1;
    this.engine.selectedElementIds.clear();
    this.engine.resetZoom();
    this.saveStateToHistory();
    this.renderPagesList();
    this.updateUI();
  }

  renderPagesList() {
    const listEl = this.dom.pagesDrawerBody;
    listEl.innerHTML = '';

    this.engine.pages.forEach((page, index) => {
      const card = document.createElement('div');
      card.className = `page-thumb-card ${index === this.engine.activePageIndex ? 'active' : ''}`;

      card.innerHTML = `
        <div class="page-thumb-preview" style="background:${page.background === 'chalkboard' ? '#1b4332' : (page.background === 'blackboard' ? '#0f172a' : '#ffffff')};">
          <span style="font-size:10px; color:${page.background === 'chalkboard' || page.background === 'blackboard' ? '#fff' : '#64748b'};">
            ${page.elements.length} عناصر
          </span>
        </div>
        <div class="page-thumb-footer">
          <span class="page-name-text">${page.name || `صفحة ${index + 1}`}</span>
          <div style="display:flex; gap:4px;">
            ${this.engine.pages.length > 1 ? `<button class="icon-btn btn-del-page" style="width:22px; height:22px; color:var(--accent-red);" title="حذف">&times;</button>` : ''}
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        this.engine.activePageIndex = index;
        this.engine.selectedElementIds.clear();
        this.engine.render();
        this.renderPagesList();
        this.updateUI();
      });

      const delBtn = card.querySelector('.btn-del-page');
      delBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`هل تريد حذف ${page.name}؟`)) {
          this.engine.pages.splice(index, 1);
          if (this.engine.activePageIndex >= this.engine.pages.length) {
            this.engine.activePageIndex = this.engine.pages.length - 1;
          }
          this.engine.render();
          this.renderPagesList();
          this.updateUI();
          this.saveStateToHistory();
        }
      });

      listEl.appendChild(card);
    });
  }

  // --- Background Switcher ---

  setBackground(bgType) {
    this.engine.activePage.background = bgType;
    this.engine.render();
    this.renderPagesList();
    this.saveStateToHistory();
  }

  // --- Menu Bar & Header Actions ---

  initMenus() {
    // Menu Dropdown toggles
    document.querySelectorAll('.menu-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.nextElementSibling;
        const wasOpen = dropdown.classList.contains('show');
        this.closeAllMenus();
        if (!wasOpen) {
          dropdown.classList.add('show');
          btn.classList.add('active');
        }
      });
    });

    window.addEventListener('click', () => this.closeAllMenus());

    // File Actions
    document.getElementById('itemNewBoard')?.addEventListener('click', () => {
      if (confirm('هل تريد بدء لوحة درس جديدة وتفريغ المحتوى؟')) {
        this.engine.pages = [this.engine.createBlankPage('الصفحة 1 (الدرس الرئيسي)')];
        this.engine.activePageIndex = 0;
        this.engine.selectedElementIds.clear();
        this.engine.resetZoom();
        this.saveStateToHistory();
        this.renderPagesList();
        this.updateUI();
      }
    });

    document.getElementById('itemOpenBoard')?.addEventListener('click', () => {
      this.dom.fileInput.click();
    });

    this.dom.fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
          if (ExportEngine.loadProjectJSON(this.engine, evt.target.result)) {
            this.renderPagesList();
            this.updateUI();
            this.saveStateToHistory();
          }
        };
        reader.readAsText(file);
      }
      this.dom.fileInput.value = '';
    });

    document.getElementById('itemSaveBoard')?.addEventListener('click', () => {
      ExportEngine.saveProjectJSON(this.engine, 'lesson-whiteboard.dzboard');
    });

    document.getElementById('itemExportPng')?.addEventListener('click', () => {
      ExportEngine.exportPNG(this.engine, 'whiteboard-export.png');
    });

    document.getElementById('itemExportSvg')?.addEventListener('click', () => {
      ExportEngine.exportSVG(this.engine, 'whiteboard-vector.svg');
    });

    document.getElementById('itemExportPdf')?.addEventListener('click', () => {
      ExportEngine.exportMultiPagePDF(this.engine, 'DZ-Whiteboard-Lesson');
    });

    // Edit Actions
    document.getElementById('itemUndo')?.addEventListener('click', () => this.undo());
    document.getElementById('itemRedo')?.addEventListener('click', () => this.redo());
    document.getElementById('itemDeleteSelection')?.addEventListener('click', () => this.deleteSelected());
    document.getElementById('itemClearPage')?.addEventListener('click', () => {
      if (confirm('هل أنت متأكد من رغبتك في مسح كافة عناصر الصفحة الحالية؟')) {
        this.engine.activePage.elements = [];
        this.engine.selectedElementIds.clear();
        this.engine.render();
        this.saveStateToHistory();
        this.renderPagesList();
      }
    });

    // Backgrounds Menu
    document.getElementById('bgOptWhite')?.addEventListener('click', () => this.setBackground('white'));
    document.getElementById('bgOptGrid')?.addEventListener('click', () => this.setBackground('grid'));
    document.getElementById('bgOptLines')?.addEventListener('click', () => this.setBackground('lines'));
    document.getElementById('bgOptDots')?.addEventListener('click', () => this.setBackground('dots'));
    document.getElementById('bgOptChalkboard')?.addEventListener('click', () => this.setBackground('chalkboard'));
    document.getElementById('bgOptBlackboard')?.addEventListener('click', () => this.setBackground('blackboard'));

    // Zoom Controls
    this.dom.zoomInBtn?.addEventListener('click', () => this.engine.zoomIn());
    this.dom.zoomOutBtn?.addEventListener('click', () => this.engine.zoomOut());
    this.dom.zoomResetBtn?.addEventListener('click', () => this.engine.resetZoom());
    this.dom.zoomFitBtn?.addEventListener('click', () => this.engine.fitToContent());

    // Presentation Mode
    this.dom.btnPresentation?.addEventListener('click', () => this.togglePresentationMode());
    this.dom.btnExitPresent?.addEventListener('click', () => this.togglePresentationMode(false));

    this.dom.btnPresentPrevPage?.addEventListener('click', () => {
      if (this.engine.activePageIndex > 0) {
        this.engine.activePageIndex--;
        this.engine.render();
        this.updateUI();
      }
    });

    this.dom.btnPresentNextPage?.addEventListener('click', () => {
      if (this.engine.activePageIndex < this.engine.pages.length - 1) {
        this.engine.activePageIndex++;
        this.engine.render();
        this.updateUI();
      }
    });

    // Language & Theme
    this.dom.langSelect?.addEventListener('change', (e) => this.applyLanguage(e.target.value));
    this.dom.themeToggleBtn?.addEventListener('click', () => {
      this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  closeAllMenus() {
    document.querySelectorAll('.dropdown-menu').forEach((d) => d.classList.remove('show'));
    document.querySelectorAll('.menu-btn').forEach((b) => b.classList.remove('active'));
  }

  // --- Presentation / Lecture Mode ---

  togglePresentationMode(forceState = null) {
    const isCurrentlyPresent = this.dom.appContainer.classList.contains('presenter-mode');
    const newState = forceState !== null ? forceState : !isCurrentlyPresent;

    this.dom.appContainer.classList.toggle('presenter-mode', newState);

    if (newState) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      this.tools.setTool('laser');
      this.setActiveToolUI('laser');
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      this.tools.setTool('pen');
      this.setActiveToolUI('pen');
    }

    this.updateUI();
    setTimeout(() => this.engine.resize(), 100);
  }

  // --- Undo / Redo History Engine ---

  saveStateToHistory() {
    const snapshot = JSON.stringify(this.engine.activePage.elements);

    // If we've undone and then perform an action, discard redo branch
    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
    }

    this.historyStack.push(snapshot);
    if (this.historyStack.length > this.maxHistory) {
      this.historyStack.shift();
    }
    this.historyIndex = this.historyStack.length - 1;

    // Auto-save project to localStorage
    try {
      localStorage.setItem('dz_whiteboard_autosave', JSON.stringify({
        pages: this.engine.pages,
        activePageIndex: this.engine.activePageIndex
      }));
    } catch {}
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const snapshot = this.historyStack[this.historyIndex];
      this.engine.activePage.elements = JSON.parse(snapshot);
      this.engine.selectedElementIds.clear();
      this.engine.render();
      this.engine.renderMinimap(this.dom.minimapCanvas);
      this.renderPagesList();
    }
  }

  redo() {
    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyIndex++;
      const snapshot = this.historyStack[this.historyIndex];
      this.engine.activePage.elements = JSON.parse(snapshot);
      this.engine.selectedElementIds.clear();
      this.engine.render();
      this.engine.renderMinimap(this.dom.minimapCanvas);
      this.renderPagesList();
    }
  }

  deleteSelected() {
    if (this.engine.selectedElementIds.size === 0) return;
    this.engine.activePage.elements = this.engine.activePage.elements.filter(
      (el) => !this.engine.selectedElementIds.has(el.id)
    );
    this.engine.selectedElementIds.clear();
    this.engine.render();
    this.saveStateToHistory();
    this.engine.renderMinimap(this.dom.minimapCanvas);
  }

  // --- Keyboard Shortcuts ---

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore if user is currently typing in an input
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.tools.setTool('hand');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        this.redo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        ExportEngine.saveProjectJSON(this.engine, 'lesson.dzboard');
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelected();
        return;
      }

      if (e.key === 'F11' || (e.key === 'f' && !e.ctrlKey)) {
        e.preventDefault();
        this.togglePresentationMode();
        return;
      }

      // Tool shortcut keys
      const key = e.key.toLowerCase();
      if (key === 'v') { this.tools.setTool('select'); this.setActiveToolUI('select'); }
      else if (key === 'p') { this.tools.setTool('pen'); this.setActiveToolUI('pen'); }
      else if (key === 'h') { this.tools.setTool('highlighter'); this.setActiveToolUI('highlighter'); }
      else if (key === 'e') { this.tools.setTool('eraser'); this.setActiveToolUI('eraser'); }
      else if (key === 'r') { this.tools.setTool('shape', 'rect'); this.setActiveToolUI('shapes-menu'); }
      else if (key === 'o') { this.tools.setTool('shape', 'circle'); this.setActiveToolUI('shapes-menu'); }
      else if (key === 'a') { this.tools.setTool('line', 'arrow'); this.setActiveToolUI('line'); }
      else if (key === 'l') { this.tools.setTool('line', 'line'); this.setActiveToolUI('line'); }
      else if (key === 't') { this.tools.setTool('text'); this.setActiveToolUI('text'); }
      else if (key === 's') { this.tools.setTool('sticky'); this.setActiveToolUI('sticky-menu'); }
      else if (key === 'k') { this.tools.setTool('laser'); this.setActiveToolUI('laser'); }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.tools.setTool('pen');
        this.setActiveToolUI('pen');
      }
    });
  }

  // --- Seed Demo Elements (Classroom lesson layout) ---

  seedDemoIfEmpty() {
    const page = this.engine.activePage;
    if (page.elements.length > 0) return;

    page.background = 'grid';

    // 1. Header Box
    page.elements.push({
      id: 'demo_header_box',
      type: 'shape',
      shapeType: 'rounded-rect',
      x: 100,
      y: 80,
      width: 580,
      height: 70,
      strokeColor: '#0284c7',
      fillColor: 'rgba(2, 132, 199, 0.08)',
      strokeWidth: 2,
      strokeStyle: 'solid'
    });

    // 2. Title Text
    page.elements.push({
      id: 'demo_title',
      type: 'text',
      x: 120,
      y: 100,
      text: 'الجمهورية الجزائرية الديمقراطية الشعبية — درس الرياضيات والفيزياء',
      fontSize: 22,
      color: '#0f172a',
      isBold: true
    });

    // 3. Educational Flowchart Blocks
    page.elements.push({
      id: 'demo_rect_1',
      type: 'shape',
      shapeType: 'rounded-rect',
      x: 120,
      y: 200,
      width: 180,
      height: 90,
      strokeColor: '#008744',
      fillColor: 'rgba(0, 135, 68, 0.1)',
      strokeWidth: 3,
      strokeStyle: 'solid'
    });
    page.elements.push({
      id: 'demo_txt_1',
      type: 'text',
      x: 145,
      y: 232,
      text: '1. المعطيات الأولية\nوالشروط الابتدائية',
      fontSize: 16,
      color: '#14532d',
      isBold: true
    });

    // Arrow to next block
    page.elements.push({
      id: 'demo_arr_1',
      type: 'line',
      lineType: 'arrow',
      x1: 300,
      y1: 245,
      x2: 390,
      y2: 245,
      strokeColor: '#0284c7',
      strokeWidth: 4,
      strokeStyle: 'solid'
    });

    // Block 2
    page.elements.push({
      id: 'demo_rect_2',
      type: 'shape',
      shapeType: 'rounded-rect',
      x: 400,
      y: 200,
      width: 180,
      height: 90,
      strokeColor: '#0284c7',
      fillColor: 'rgba(2, 132, 199, 0.1)',
      strokeWidth: 3,
      strokeStyle: 'solid'
    });
    page.elements.push({
      id: 'demo_txt_2',
      type: 'text',
      x: 425,
      y: 232,
      text: '2. تطبيق القانون:\nE = m · c²',
      fontSize: 16,
      color: '#0369a1',
      isBold: true
    });

    // Arrow to Result
    page.elements.push({
      id: 'demo_arr_2',
      type: 'line',
      lineType: 'arrow',
      x1: 580,
      y1: 245,
      x2: 670,
      y2: 245,
      strokeColor: '#0284c7',
      strokeWidth: 4,
      strokeStyle: 'solid'
    });

    // Block 3 (Result Circle)
    page.elements.push({
      id: 'demo_circle',
      type: 'shape',
      shapeType: 'circle',
      x: 680,
      y: 190,
      width: 110,
      height: 110,
      strokeColor: '#d93025',
      fillColor: 'rgba(217, 48, 37, 0.1)',
      strokeWidth: 3,
      strokeStyle: 'solid'
    });
    page.elements.push({
      id: 'demo_txt_3',
      type: 'text',
      x: 705,
      y: 232,
      text: 'النتيجة\nالنهائية',
      fontSize: 16,
      color: '#b91c1c',
      isBold: true
    });

    // Sticky Note Note for students
    page.elements.push({
      id: 'demo_sticky',
      type: 'sticky',
      x: 120,
      y: 350,
      width: 200,
      height: 140,
      text: 'تنبيه للطلبة:\nتطبيق القوانين يتطلب تحويل كافة الوحدات إلى النظام الدولي (SI) قبل بدء الحساب.',
      colorTheme: 'yellow'
    });

    // Pen formula note
    page.elements.push({
      id: 'demo_pen_note',
      type: 'text',
      x: 380,
      y: 360,
      text: 'v(t) = v₀ + a·t   |   x(t) = x₀ + v₀·t + ½a·t²',
      fontSize: 20,
      color: '#0f172a',
      isBold: true
    });

    this.engine.fitToContent();
  }

  // --- UI Update & Theme / Language ---

  updateZoomDisplay() {
    if (this.dom.zoomLabel) {
      this.dom.zoomLabel.textContent = `${Math.round(this.engine.zoom * 100)}%`;
    }
  }

  updateUI() {
    this.updateZoomDisplay();
    const cur = this.engine.activePageIndex + 1;
    const total = this.engine.pages.length;
    if (this.dom.presenterPageText) {
      this.dom.presenterPageText.textContent = `${cur} / ${total}`;
    }
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dz_wb_theme', theme);
  }

  applyLanguage(lang) {
    this.currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.body.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    localStorage.setItem('dz_wb_lang', lang);

    const dict = I18N[lang] || I18N.ar;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        if (el.tagName === 'INPUT' && el.placeholder) {
          el.placeholder = dict[key];
        } else {
          el.textContent = dict[key];
        }
      }
    });

    if (this.dom.langSelect) this.dom.langSelect.value = lang;
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.dzWhiteboard = new DZWhiteboardApp();
});
