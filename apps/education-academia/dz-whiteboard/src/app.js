/**
 * DZ-Whiteboard Pro — Main Application Controller
 * ------------------------------------------------
 * 100% Client-side orchestrator for OpenBoard / Miro alternative:
 * State management, multi-page slide navigation, undo/redo history,
 * presentation mode, export pipeline, keyboard shortcuts, templates,
 * interactive geometry tools (Ruler, Protractor), and clipboard image pasting.
 */

import { CanvasEngine } from './canvas-engine.js';
import { ToolsManager } from './tools.js';
import { ExportEngine } from './export-engine.js';

// Comprehensive Trilingual Dictionary
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
    duplicate: 'تكرار المحدد (Duplicate)',
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

    btnTemplates: 'قوالب تعليمية',
    btnMath: 'رموز رياضية',
    templatesTitle: 'مكتبة القوالب التعليمية الجاهزة',
    templatesSubtitle: 'اختر قالباً جاهزاً لبدء الدرس أو الشرح التفاعلي بضغطة زر واحدة:',
    mathTitle: 'لوحة الرموز الرياضية والعلمية',
    mathSubtitle: 'انقر على أي رمز لإدراجه فوراً على السبورة كنص متجهي:',
    clearConfirmTitle: 'مسح كافة محتويات الصفحة؟',
    clearConfirmText: 'سيتم مسح جميع الرسومات والنصوص والأشكال في هذه الصفحة. يمكنك التراجع عبر Ctrl+Z.',
    cancel: 'إلغاء',
    confirmClear: 'نعم، امسح الكل',
    strokeColor: 'اللون:',
    strokeWidth: 'السمك:',
    shapeFill: 'التعبئة:',

    pageLabel: 'الصفحة',
    about: 'حول DZ-Whiteboard Pro...'
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
    duplicate: 'Dupliquer la sélection',
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

    btnTemplates: 'Modèles',
    btnMath: 'Symboles Math',
    templatesTitle: 'Bibliothèque de Modèles Pédagogiques',
    templatesSubtitle: 'Choisissez un modèle prêt à l’emploi pour démarrer votre cours :',
    mathTitle: 'Palette de Symboles Mathématiques',
    mathSubtitle: 'Cliquez sur un symbole pour l’insérer sur le tableau :',
    clearConfirmTitle: 'Effacer tout le contenu ?',
    clearConfirmText: 'Tous les tracés et formes seront effacés. Annulable avec Ctrl+Z.',
    cancel: 'Annuler',
    confirmClear: 'Oui, tout effacer',
    strokeColor: 'Couleur :',
    strokeWidth: 'Épaisseur :',
    shapeFill: 'Remplissage :',

    pageLabel: 'Page',
    about: 'À propos de DZ-Whiteboard Pro...'
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
    duplicate: 'Duplicate Selection',
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

    btnTemplates: 'Templates',
    btnMath: 'Math Symbols',
    templatesTitle: 'Educational Templates Library',
    templatesSubtitle: 'Choose a ready-to-use template for your lesson or diagram:',
    mathTitle: 'Math & Scientific Symbols Palette',
    mathSubtitle: 'Click any symbol to insert it directly onto the board:',
    clearConfirmTitle: 'Clear entire page content?',
    clearConfirmText: 'All drawings and shapes on this page will be cleared. Undoable with Ctrl+Z.',
    cancel: 'Cancel',
    confirmClear: 'Yes, Clear All',
    strokeColor: 'Color:',
    strokeWidth: 'Width:',
    shapeFill: 'Fill:',

    pageLabel: 'Page',
    about: 'About DZ-Whiteboard Pro...'
  }
};

class DZWhiteboardApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_wb_lang') || 'ar';
    this.currentTheme = localStorage.getItem('dz_wb_theme') || 'light';

    // History stack per page
    this.historyStack = [];
    this.historyIndex = -1;
    this.maxHistory = 40;

    this.initDOM();
    this.initEngine();
    this.initTools();
    this.initMenus();
    this.initFastHeader();
    this.initStyleControls();
    this.initModals();
    this.initImagePasting();
    this.initPagesDrawer();
    this.initKeyboardShortcuts();
    this.applyTheme(this.currentTheme);
    this.applyLanguage(this.currentLang);

    // Initial seed with exemplary lecture content if empty
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
      fileInputImage: document.getElementById('fileInputImage'),

      // Header buttons
      langSelect: document.getElementById('langSelect'),
      themeToggleBtn: document.getElementById('themeToggleBtn'),
      btnPresentation: document.getElementById('btnPresentation'),
      btnTogglePages: document.getElementById('btnTogglePages'),

      // Fast Header Action Buttons
      btnHeaderUndo: document.getElementById('btnHeaderUndo'),
      btnHeaderRedo: document.getElementById('btnHeaderRedo'),
      btnHeaderTemplates: document.getElementById('btnHeaderTemplates'),
      btnHeaderMath: document.getElementById('btnHeaderMath'),
      btnHeaderRuler: document.getElementById('btnHeaderRuler'),
      btnHeaderProtractor: document.getElementById('btnHeaderProtractor'),
      btnHeaderSnap: document.getElementById('btnHeaderSnap'),
      btnHeaderClear: document.getElementById('btnHeaderClear'),

      // Page Drawer
      pagesDrawer: document.getElementById('pagesDrawer'),
      pagesDrawerBody: document.getElementById('pagesDrawerBody'),
      btnAddPage: document.getElementById('btnAddPage'),
      btnCloseDrawer: document.getElementById('btnCloseDrawer'),

      // Floating Tools Dock
      dock: document.getElementById('floatingDock'),
      dockButtons: document.querySelectorAll('.dock-btn'),
      shapesFlyout: document.getElementById('shapesFlyout'),
      linesFlyout: document.getElementById('linesFlyout'),
      stickyFlyout: document.getElementById('stickyFlyout'),
      btnUploadImageDock: document.getElementById('btnUploadImageDock'),

      // Style Shelf
      styleShelf: document.getElementById('styleShelf'),
      colorSwatches: document.querySelectorAll('.color-dot'),
      customColorInput: document.getElementById('customColorInput'),
      strokeWidthButtons: document.querySelectorAll('.stroke-width-btn[data-width]'),
      btnFillNone: document.getElementById('btnFillNone'),
      btnFillTint: document.getElementById('btnFillTint'),
      btnFillSolid: document.getElementById('btnFillSolid'),

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
      presenterPageText: document.getElementById('presenterPageText'),

      // Modals
      templatesModal: document.getElementById('templatesModal'),
      btnCloseTemplatesModal: document.getElementById('btnCloseTemplatesModal'),
      mathModal: document.getElementById('mathModal'),
      btnCloseMathModal: document.getElementById('btnCloseMathModal'),
      mathSymbolsGrid: document.getElementById('mathSymbolsGrid'),
      clearConfirmModal: document.getElementById('clearConfirmModal'),
      btnCancelClear: document.getElementById('btnCancelClear'),
      btnConfirmClear: document.getElementById('btnConfirmClear'),
      aboutModal: document.getElementById('aboutModal'),
      btnCloseAboutModal: document.getElementById('btnCloseAboutModal')
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
        this.updateStyleShelfForSelection();
      },
      onTextEditRequest: ({ x, y, screenPos, existingElement }) => {
        this.openInlineTextEditor(x, y, screenPos, existingElement);
      }
    });

    // Tool dock buttons
    this.dom.dockButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const toolName = btn.dataset.tool;
        if (!toolName) return;

        if (toolName === 'shapes-menu') {
          this.dom.linesFlyout?.classList.remove('show');
          this.dom.stickyFlyout?.classList.remove('show');
          this.dom.shapesFlyout.classList.toggle('show');
          return;
        }

        if (toolName === 'line-menu') {
          this.dom.shapesFlyout?.classList.remove('show');
          this.dom.stickyFlyout?.classList.remove('show');
          this.dom.linesFlyout.classList.toggle('show');
          return;
        }

        if (toolName === 'sticky-menu') {
          this.dom.shapesFlyout?.classList.remove('show');
          this.dom.linesFlyout?.classList.remove('show');
          this.dom.stickyFlyout.classList.toggle('show');
          return;
        }

        this.closeAllFlyouts();
        this.tools.setTool(toolName);
        this.setActiveToolUI(toolName);
      });
    });

    // Shapes Flyout items
    document.querySelectorAll('.shape-choice-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const shape = btn.dataset.shape;
        document.querySelectorAll('.shape-choice-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.tools.setTool('shape', shape);
        this.setActiveToolUI('shapes-menu');
        this.closeAllFlyouts();
      });
    });

    // Lines Flyout items
    document.querySelectorAll('.line-choice-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const line = btn.dataset.line;
        document.querySelectorAll('.line-choice-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.tools.setTool('line', line);
        this.setActiveToolUI('line-menu');
        this.closeAllFlyouts();
      });
    });

    // Sticky Notes Flyout items
    document.querySelectorAll('.sticky-choice-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const theme = btn.dataset.theme;
        this.tools.activeStickyTheme = theme;
        this.tools.setTool('sticky');
        this.setActiveToolUI('sticky-menu');
        this.closeAllFlyouts();
      });
    });

    // Close flyouts on click outside
    window.addEventListener('click', (e) => {
      if (!e.target.closest('.floating-dock')) {
        this.closeAllFlyouts();
      }
    });

    // Zoom Controls
    this.dom.zoomInBtn?.addEventListener('click', () => this.engine.zoomIn());
    this.dom.zoomOutBtn?.addEventListener('click', () => this.engine.zoomOut());
    this.dom.zoomResetBtn?.addEventListener('click', () => this.engine.resetZoom());
    this.dom.zoomFitBtn?.addEventListener('click', () => this.engine.fitToContent());
  }

  closeAllFlyouts() {
    this.dom.shapesFlyout?.classList.remove('show');
    this.dom.linesFlyout?.classList.remove('show');
    this.dom.stickyFlyout?.classList.remove('show');
  }

  setActiveToolUI(toolName) {
    this.dom.dockButtons.forEach((b) => {
      if (b.dataset.tool === toolName) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }

  // --- Fast Header Actions ---

  initFastHeader() {
    // Direct Undo / Redo
    this.dom.btnHeaderUndo?.addEventListener('click', () => this.undo());
    this.dom.btnHeaderRedo?.addEventListener('click', () => this.redo());

    // Templates Modal toggle
    this.dom.btnHeaderTemplates?.addEventListener('click', () => {
      this.dom.templatesModal.style.display = 'flex';
    });

    // Math Symbols Palette toggle
    this.dom.btnHeaderMath?.addEventListener('click', () => {
      this.dom.mathModal.style.display = 'flex';
    });

    // Ruler toggle
    this.dom.btnHeaderRuler?.addEventListener('click', () => {
      this.engine.ruler.active = !this.engine.ruler.active;
      this.dom.btnHeaderRuler.classList.toggle('active', this.engine.ruler.active);
      this.engine.render();
    });

    // Protractor toggle
    this.dom.btnHeaderProtractor?.addEventListener('click', () => {
      this.engine.protractor.active = !this.engine.protractor.active;
      this.dom.btnHeaderProtractor.classList.toggle('active', this.engine.protractor.active);
      this.engine.render();
    });

    // Grid Snap toggle
    this.dom.btnHeaderSnap?.addEventListener('click', () => {
      this.engine.gridSnap = !this.engine.gridSnap;
      this.dom.btnHeaderSnap.classList.toggle('active', this.engine.gridSnap);
    });

    // Clear Page Modal
    this.dom.btnHeaderClear?.addEventListener('click', () => {
      this.dom.clearConfirmModal.style.display = 'flex';
    });

    this.dom.btnCancelClear?.addEventListener('click', () => {
      this.dom.clearConfirmModal.style.display = 'none';
    });

    this.dom.btnConfirmClear?.addEventListener('click', () => {
      this.dom.clearConfirmModal.style.display = 'none';
      this.engine.activePage.elements = [];
      this.engine.selectedElementIds.clear();
      this.engine.render();
      this.saveStateToHistory();
      this.engine.renderMinimap(this.dom.minimapCanvas);
      this.renderPagesList();
    });
  }

  // --- Style Shelf (Color, Stroke, Fill) ---

  initStyleControls() {
    // Preset Color Dots
    this.dom.colorSwatches.forEach((dot) => {
      dot.addEventListener('click', () => {
        this.dom.colorSwatches.forEach((d) => d.classList.remove('active'));
        dot.classList.add('active');
        const color = dot.dataset.color;
        this.tools.strokeColor = color;
        this.applyColorToSelected(color);
      });
    });

    // Custom Color Input
    this.dom.customColorInput?.addEventListener('input', (e) => {
      const color = e.target.value;
      this.dom.colorSwatches.forEach((d) => d.classList.remove('active'));
      this.tools.strokeColor = color;
      this.applyColorToSelected(color);
    });

    // Stroke Width Buttons
    this.dom.strokeWidthButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.dom.strokeWidthButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const width = parseInt(btn.dataset.width, 10);
        this.tools.strokeWidth = width;
        this.applyStrokeWidthToSelected(width);
      });
    });

    // Fill Mode Buttons
    const setFillUI = (activeBtn) => {
      [this.dom.btnFillNone, this.dom.btnFillTint, this.dom.btnFillSolid].forEach((b) => b?.classList.remove('active'));
      activeBtn?.classList.add('active');
    };

    this.dom.btnFillNone?.addEventListener('click', () => {
      setFillUI(this.dom.btnFillNone);
      this.tools.fillColor = 'transparent';
      this.applyFillToSelected('transparent');
    });

    this.dom.btnFillTint?.addEventListener('click', () => {
      setFillUI(this.dom.btnFillTint);
      const color = this.tools.strokeColor || '#0284c7';
      // Convert to rgba with 15% opacity
      const tint = this.hexToRgba(color, 0.15);
      this.tools.fillColor = tint;
      this.applyFillToSelected(tint);
    });

    this.dom.btnFillSolid?.addEventListener('click', () => {
      setFillUI(this.dom.btnFillSolid);
      const color = this.tools.strokeColor || '#0284c7';
      this.tools.fillColor = color;
      this.applyFillToSelected(color);
    });
  }

  hexToRgba(hex, alpha = 0.2) {
    if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  applyColorToSelected(color) {
    const selected = this.engine.activePage.elements.filter((el) => this.engine.selectedElementIds.has(el.id));
    if (selected.length === 0) return;
    selected.forEach((el) => {
      if (el.type === 'pen') el.color = color;
      else if (el.type === 'shape' || el.type === 'line') el.strokeColor = color;
      else if (el.type === 'text') el.color = color;
    });
    this.engine.render();
    this.saveStateToHistory();
  }

  applyStrokeWidthToSelected(width) {
    const selected = this.engine.activePage.elements.filter((el) => this.engine.selectedElementIds.has(el.id));
    if (selected.length === 0) return;
    selected.forEach((el) => {
      if (el.type === 'pen') el.width = width;
      else if (el.type === 'shape' || el.type === 'line') el.strokeWidth = width;
    });
    this.engine.render();
    this.saveStateToHistory();
  }

  applyFillToSelected(fill) {
    const selected = this.engine.activePage.elements.filter((el) => this.engine.selectedElementIds.has(el.id));
    if (selected.length === 0) return;
    selected.forEach((el) => {
      if (el.type === 'shape') el.fillColor = fill;
    });
    this.engine.render();
    this.saveStateToHistory();
  }

  updateStyleShelfForSelection() {
    const selected = this.engine.activePage.elements.filter((el) => this.engine.selectedElementIds.has(el.id));
    if (selected.length > 0) {
      const first = selected[0];
      const color = first.color || first.strokeColor;
      if (color) {
        this.dom.colorSwatches.forEach((dot) => {
          dot.classList.toggle('active', dot.dataset.color.toLowerCase() === color.toLowerCase());
        });
      }
    }
  }

  // --- Image Upload & Clipboard Pasting (Ctrl+V) ---

  initImagePasting() {
    // Dock Image Upload Button
    this.dom.btnUploadImageDock?.addEventListener('click', () => {
      this.dom.fileInputImage.click();
    });

    this.dom.fileInputImage?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.insertImageFromFile(e.target.files[0]);
      }
      this.dom.fileInputImage.value = '';
    });

    // Native Drag and Drop onto canvas
    const wrap = this.dom.canvas.parentElement;
    wrap?.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    wrap?.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) this.insertImageFromFile(files[0], e.clientX, e.clientY);
    });

    // Clipboard Paste (Ctrl+V)
    window.addEventListener('paste', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const items = (e.clipboardData || window.clipboardData)?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const file = items[i].getAsFile();
          this.insertImageFromFile(file);
          return;
        }
      }

      // If text/elements copied internally, paste them
      this.tools.pasteSelected();
      this.saveStateToHistory();
    });
  }

  insertImageFromFile(file, screenX = null, screenY = null) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target.result;
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || 400;
        let h = img.naturalHeight || 300;
        const maxDim = 550;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        let worldPos;
        if (screenX != null && screenY != null) {
          worldPos = this.engine.screenToWorld(screenX, screenY);
        } else {
          worldPos = this.engine.screenToWorld(
            this.engine.canvas.width / (2 * this.engine.dpr),
            this.engine.canvas.height / (2 * this.engine.dpr)
          );
        }

        const newEl = {
          id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          type: 'image',
          x: Math.round(worldPos.x - w / 2),
          y: Math.round(worldPos.y - h / 2),
          width: w,
          height: h,
          src: src,
          imgObj: img
        };

        this.engine.activePage.elements.push(newEl);
        this.engine.selectedElementIds.clear();
        this.engine.selectedElementIds.add(newEl.id);
        this.engine.render();
        this.saveStateToHistory();
        this.engine.renderMinimap(this.dom.minimapCanvas);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  // --- Modals & Templates & Math Symbols ---

  initModals() {
    // Close templates modal
    this.dom.btnCloseTemplatesModal?.addEventListener('click', () => {
      this.dom.templatesModal.style.display = 'none';
    });

    // Template Cards Click
    document.querySelectorAll('.template-card').forEach((card) => {
      card.addEventListener('click', () => {
        const type = card.dataset.template;
        this.loadTemplate(type);
        this.dom.templatesModal.style.display = 'none';
      });
    });

    // Math Modal
    this.dom.btnCloseMathModal?.addEventListener('click', () => {
      this.dom.mathModal.style.display = 'none';
    });

    // Populate Math Symbols Grid
    const symbols = [
      'α', 'β', 'γ', 'θ', 'λ', 'μ', 'π', 'σ', 'φ', 'ω', 'Δ', 'Ω',
      '√', '∑', '∫', '≈', '≠', '≤', '≥', '±', '∞', '×', '÷', '∂',
      '∈', '∉', '⊂', '∪', '∩', '½', '¼', '¾', '²', '³', '₀', '₁'
    ];

    const grid = this.dom.mathSymbolsGrid;
    if (grid) {
      grid.innerHTML = '';
      symbols.forEach((sym) => {
        const btn = document.createElement('button');
        btn.className = 'math-sym-btn';
        btn.textContent = sym;
        btn.addEventListener('click', () => {
          this.insertMathSymbol(sym);
          this.dom.mathModal.style.display = 'none';
        });
        grid.appendChild(btn);
      });
    }

    // About Modal
    document.getElementById('itemAbout')?.addEventListener('click', () => {
      this.dom.aboutModal.style.display = 'flex';
    });
    this.dom.btnCloseAboutModal?.addEventListener('click', () => {
      this.dom.aboutModal.style.display = 'none';
    });

    // Close on backdrop click
    window.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) {
        e.target.style.display = 'none';
      }
    });
  }

  insertMathSymbol(sym) {
    const vCenter = this.engine.screenToWorld(
      this.engine.canvas.width / (2 * this.engine.dpr),
      this.engine.canvas.height / (2 * this.engine.dpr)
    );

    const newEl = {
      id: 'sym_' + Date.now(),
      type: 'text',
      x: Math.round(vCenter.x),
      y: Math.round(vCenter.y),
      text: sym,
      fontSize: 28,
      color: this.tools.strokeColor || '#0f172a',
      isBold: true
    };

    this.engine.activePage.elements.push(newEl);
    this.engine.selectedElementIds.clear();
    this.engine.selectedElementIds.add(newEl.id);
    this.engine.render();
    this.saveStateToHistory();
  }

  // --- Educational Template Loaders ---

  loadTemplate(type) {
    const page = this.engine.activePage;
    page.elements = [];
    this.engine.selectedElementIds.clear();

    if (type === 'math') {
      page.background = 'grid';
      // Coordinate Plane X-Y
      page.elements.push({
        id: 'tpl_axis_x',
        type: 'line',
        lineType: 'arrow',
        x1: 100, y1: 340, x2: 860, y2: 340,
        strokeColor: '#0284c7', strokeWidth: 3
      });
      page.elements.push({
        id: 'tpl_axis_y',
        type: 'line',
        lineType: 'arrow',
        x1: 480, y1: 580, x2: 480, y2: 100,
        strokeColor: '#0284c7', strokeWidth: 3
      });
      page.elements.push({
        id: 'tpl_lbl_x',
        type: 'text',
        x: 875, y: 325,
        text: 'X (t) [s]', fontSize: 18, color: '#0284c7', isBold: true
      });
      page.elements.push({
        id: 'tpl_lbl_y',
        type: 'text',
        x: 465, y: 70,
        text: 'Y [m]', fontSize: 18, color: '#0284c7', isBold: true
      });
      page.elements.push({
        id: 'tpl_lbl_o',
        type: 'text',
        x: 460, y: 348,
        text: 'O (0,0)', fontSize: 14, color: '#64748b', isBold: true
      });

      // Sticky note formula
      page.elements.push({
        id: 'tpl_formula_sticky',
        type: 'sticky',
        x: 100, y: 100, width: 240, height: 160,
        text: 'معادلة المسار:\ny(x) = - (g / 2v₀²cos²α) · x² + (tan α) · x\n\nقم برسم نقاط المنحنى ومطابقة الشروط الابتدائية.',
        colorTheme: 'cyan'
      });
    } else if (type === 'mindmap') {
      page.background = 'dots';
      // Center Topic
      page.elements.push({
        id: 'tpl_mm_center',
        type: 'shape',
        shapeType: 'rounded-rect',
        x: 400, y: 260, width: 220, height: 90,
        strokeColor: '#8b5cf6', strokeWidth: 3,
        fillColor: 'rgba(139, 92, 246, 0.12)'
      });
      page.elements.push({
        id: 'tpl_mm_center_txt',
        type: 'text',
        x: 435, y: 295,
        text: 'الفكرة المركزية\n(الموضوع الأساسي)', fontSize: 16, color: '#581c87', isBold: true
      });

      // 4 Branches
      const branches = [
        { name: '1. الأهداف والنتائج', color: '#0284c7', x: 400, y: 100, x1: 510, y1: 260, x2: 510, y2: 170 },
        { name: '2. الموارد والميزانية', color: '#008744', x: 700, y: 260, x1: 620, y1: 305, x2: 700, y2: 305 },
        { name: '3. خطة التنفيذ والمهام', color: '#ea580c', x: 400, y: 440, x1: 510, y1: 350, x2: 510, y2: 440 },
        { name: '4. المخاطر والبدائل', color: '#d93025', x: 100, y: 260, x1: 400, y1: 305, x2: 320, y2: 305 }
      ];

      branches.forEach((b, i) => {
        page.elements.push({
          id: `tpl_mm_arr_${i}`,
          type: 'line',
          lineType: 'arrow',
          x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2,
          strokeColor: b.color, strokeWidth: 3
        });
        page.elements.push({
          id: `tpl_mm_box_${i}`,
          type: 'shape',
          shapeType: 'rounded-rect',
          x: b.x, y: b.y, width: 220, height: 70,
          strokeColor: b.color, strokeWidth: 2,
          fillColor: this.hexToRgba(b.color, 0.1)
        });
        page.elements.push({
          id: `tpl_mm_txt_${i}`,
          type: 'text',
          x: b.x + 20, y: b.y + 24,
          text: b.name, fontSize: 15, color: b.color, isBold: true
        });
      });
    } else if (type === 'kanban') {
      page.background = 'white';
      const cols = [
        { title: 'قيد الانتظار (To Do)', color: '#64748b', x: 80, theme: 'yellow' },
        { title: 'قيد الإنجاز (In Progress)', color: '#0284c7', x: 380, theme: 'cyan' },
        { title: 'مكتمل بنجاح (Completed)', color: '#008744', x: 680, theme: 'green' }
      ];
      cols.forEach((col, idx) => {
        page.elements.push({
          id: `tpl_kb_col_${idx}`,
          type: 'shape',
          shapeType: 'rounded-rect',
          x: col.x, y: 80, width: 270, height: 500,
          strokeColor: col.color, strokeWidth: 2,
          fillColor: this.hexToRgba(col.color, 0.05)
        });
        page.elements.push({
          id: `tpl_kb_hdr_${idx}`,
          type: 'text',
          x: col.x + 20, y: 100,
          text: col.title, fontSize: 16, color: col.color, isBold: true
        });
        // Sample card
        page.elements.push({
          id: `tpl_kb_card_${idx}`,
          type: 'sticky',
          x: col.x + 15, y: 150, width: 240, height: 110,
          text: `مهمة ${idx + 1}:\nدراسة الفصل وتحضير الملخص المنهجي والمراجع.`,
          colorTheme: col.theme
        });
      });
    } else if (type === 'calligraphy') {
      page.background = 'lines';
      page.elements.push({
        id: 'tpl_callig_title',
        type: 'text',
        x: 120, y: 120,
        text: 'دَفْتَرُ اللُّغَةِ العَرَبِيَّةِ وَالخَطِّ المَدْرَسِيّ',
        fontSize: 22, color: '#008744', isBold: true
      });
      page.elements.push({
        id: 'tpl_callig_verse',
        type: 'text',
        x: 120, y: 190,
        text: 'العِلْمُ يَرْفَعُ بَيْتًا لا عِمَادَ لَهُ ... وَالجَهْلُ يَهْدِمُ بَيْتَ العِزِّ وَالشَّرَفِ',
        fontSize: 24, color: '#0f172a', isBold: true
      });
      page.elements.push({
        id: 'tpl_callig_note',
        type: 'sticky',
        x: 680, y: 260, width: 220, height: 140,
        text: 'قواعد الخط المدرسي:\n• احترام مسافات الأسطر (Seyès)\n• كتابة الحروف الرأسية والأفقية بانتظام',
        colorTheme: 'yellow'
      });
    } else if (type === 'flowchart') {
      page.background = 'grid';
      // Flowchart blocks
      page.elements.push({
        id: 'tpl_fc_start',
        type: 'shape', shapeType: 'circle',
        x: 420, y: 80, width: 140, height: 70,
        strokeColor: '#008744', strokeWidth: 3, fillColor: 'rgba(0,135,68,0.1)'
      });
      page.elements.push({
        id: 'tpl_fc_txt_start',
        type: 'text', x: 460, y: 105, text: 'البداية', fontSize: 16, color: '#008744', isBold: true
      });
      page.elements.push({
        id: 'tpl_fc_arr1',
        type: 'line', lineType: 'arrow',
        x1: 490, y1: 150, x2: 490, y2: 210, strokeColor: '#0284c7', strokeWidth: 3
      });
      page.elements.push({
        id: 'tpl_fc_proc',
        type: 'shape', shapeType: 'rect',
        x: 390, y: 210, width: 200, height: 80,
        strokeColor: '#0284c7', strokeWidth: 2, fillColor: 'rgba(2,132,199,0.1)'
      });
      page.elements.push({
        id: 'tpl_fc_txt_proc',
        type: 'text', x: 420, y: 238, text: 'معالجة البيانات\n(Process X = A + B)', fontSize: 14, color: '#0369a1', isBold: true
      });
      page.elements.push({
        id: 'tpl_fc_arr2',
        type: 'line', lineType: 'arrow',
        x1: 490, y1: 290, x2: 490, y2: 350, strokeColor: '#0284c7', strokeWidth: 3
      });
      page.elements.push({
        id: 'tpl_fc_cond',
        type: 'shape', shapeType: 'diamond',
        x: 400, y: 350, width: 180, height: 110,
        strokeColor: '#ea580c', strokeWidth: 2, fillColor: 'rgba(234,88,12,0.1)'
      });
      page.elements.push({
        id: 'tpl_fc_txt_cond',
        type: 'text', x: 440, y: 395, text: 'هل X > 100؟', fontSize: 14, color: '#c2410c', isBold: true
      });
    } else if (type === 'table') {
      page.background = 'white';
      // 2-column comparison matrix
      page.elements.push({
        id: 'tpl_tbl_hdr1',
        type: 'shape', shapeType: 'rounded-rect',
        x: 100, y: 100, width: 360, height: 60,
        strokeColor: '#0284c7', strokeWidth: 2, fillColor: 'rgba(2,132,199,0.15)'
      });
      page.elements.push({
        id: 'tpl_tbl_txt1',
        type: 'text', x: 180, y: 118, text: 'المفهوم الأول (الجانب أ)', fontSize: 18, color: '#0369a1', isBold: true
      });
      page.elements.push({
        id: 'tpl_tbl_hdr2',
        type: 'shape', shapeType: 'rounded-rect',
        x: 500, y: 100, width: 360, height: 60,
        strokeColor: '#008744', strokeWidth: 2, fillColor: 'rgba(0,135,68,0.15)'
      });
      page.elements.push({
        id: 'tpl_tbl_txt2',
        type: 'text', x: 580, y: 118, text: 'المفهوم الثاني (الجانب ب)', fontSize: 18, color: '#15803d', isBold: true
      });
      page.elements.push({
        id: 'tpl_tbl_body1',
        type: 'shape', shapeType: 'rect',
        x: 100, y: 170, width: 360, height: 350,
        strokeColor: '#cbd5e1', strokeWidth: 1, fillColor: '#f8fafc'
      });
      page.elements.push({
        id: 'tpl_tbl_body2',
        type: 'shape', shapeType: 'rect',
        x: 500, y: 170, width: 360, height: 350,
        strokeColor: '#cbd5e1', strokeWidth: 1, fillColor: '#f8fafc'
      });
    }

    this.engine.fitToContent();
    this.saveStateToHistory();
    this.renderPagesList();
    this.updateUI();
  }

  // --- Seed Demo Elements (Clean Classroom Layout) ---

  seedDemoIfEmpty() {
    const page = this.engine.activePage;
    if (page.elements.length > 0) return;

    page.background = 'grid';

    // 1. Algerian Republic National Banner Box
    page.elements.push({
      id: 'demo_header_box',
      type: 'shape',
      shapeType: 'rounded-rect',
      x: 80,
      y: 40,
      width: 860,
      height: 75,
      strokeColor: '#0284c7',
      fillColor: 'rgba(2, 132, 199, 0.08)',
      strokeWidth: 2,
      strokeStyle: 'solid'
    });

    page.elements.push({
      id: 'demo_title',
      type: 'text',
      x: 110,
      y: 52,
      text: 'الجمهورية الجزائرية الديمقراطية الشعبية — مادة العلوم الفيزيائية والرياضيات',
      fontSize: 18,
      color: '#0f172a',
      isBold: true
    });

    page.elements.push({
      id: 'demo_subtitle',
      type: 'text',
      x: 110,
      y: 80,
      text: 'الوحدة 01: دراسة تطور جملة ميكانيكية • قوانين نيوتن للحركة والمعادلات الزمنية',
      fontSize: 14,
      color: '#0284c7',
      isBold: false
    });

    // 2. Educational Flowchart Blocks (3 Aligned Steps)
    page.elements.push({
      id: 'demo_rect_1',
      type: 'shape',
      shapeType: 'rounded-rect',
      x: 80,
      y: 150,
      width: 220,
      height: 95,
      strokeColor: '#008744',
      fillColor: 'rgba(0, 135, 68, 0.1)',
      strokeWidth: 2.5,
      strokeStyle: 'solid'
    });
    page.elements.push({
      id: 'demo_txt_1',
      type: 'text',
      x: 105,
      y: 175,
      text: '1. الشروط الابتدائية\n(الموضع والسرعة عند t=0)',
      fontSize: 15,
      color: '#14532d',
      isBold: true
    });

    // Arrow 1 -> 2
    page.elements.push({
      id: 'demo_arr_1',
      type: 'line',
      lineType: 'arrow',
      x1: 300,
      y1: 198,
      x2: 370,
      y2: 198,
      strokeColor: '#0284c7',
      strokeWidth: 3.5,
      strokeStyle: 'solid'
    });

    // Block 2
    page.elements.push({
      id: 'demo_rect_2',
      type: 'shape',
      shapeType: 'rounded-rect',
      x: 370,
      y: 150,
      width: 250,
      height: 95,
      strokeColor: '#0284c7',
      fillColor: 'rgba(2, 132, 199, 0.1)',
      strokeWidth: 2.5,
      strokeStyle: 'solid'
    });
    page.elements.push({
      id: 'demo_txt_2',
      type: 'text',
      x: 395,
      y: 175,
      text: '2. تطبيق القانون الثاني لنيوتن\n∑ F_ext = m · a',
      fontSize: 15,
      color: '#0369a1',
      isBold: true
    });

    // Arrow 2 -> 3
    page.elements.push({
      id: 'demo_arr_2',
      type: 'line',
      lineType: 'arrow',
      x1: 620,
      y1: 198,
      x2: 690,
      y2: 198,
      strokeColor: '#0284c7',
      strokeWidth: 3.5,
      strokeStyle: 'solid'
    });

    // Block 3
    page.elements.push({
      id: 'demo_rect_3',
      type: 'shape',
      shapeType: 'rounded-rect',
      x: 690,
      y: 150,
      width: 250,
      height: 95,
      strokeColor: '#d93025',
      fillColor: 'rgba(217, 48, 37, 0.08)',
      strokeWidth: 2.5,
      strokeStyle: 'solid'
    });
    page.elements.push({
      id: 'demo_txt_3',
      type: 'text',
      x: 715,
      y: 175,
      text: '3. المعادلات الزمنية للحركة\nx(t) و v(t) بالتكامل',
      fontSize: 15,
      color: '#b91c1c',
      isBold: true
    });

    // 3. Clean Yellow Sticky Note (Methodological advice)
    page.elements.push({
      id: 'demo_sticky',
      type: 'sticky',
      x: 80,
      y: 285,
      width: 260,
      height: 160,
      text: 'تنبيه منهجي للطلبة:\n• تحديد الجملة المدروسة بدقة\n• اختيار مرجع عطالي مناسب\n• إسقاط شعاع القوى على المحاور',
      colorTheme: 'yellow'
    });

    // 4. Motion Equations Box
    page.elements.push({
      id: 'demo_formula_box',
      type: 'shape',
      shapeType: 'rounded-rect',
      x: 370,
      y: 285,
      width: 570,
      height: 160,
      strokeColor: '#94a3b8',
      fillColor: 'rgba(248, 250, 252, 0.85)',
      strokeWidth: 1.5,
      strokeStyle: 'solid'
    });

    page.elements.push({
      id: 'demo_formula_title',
      type: 'text',
      x: 395,
      y: 305,
      text: 'المعادلات التفاضلية والزمنية للحركة المستقيمة بانتظام:',
      fontSize: 15,
      color: '#0f172a',
      isBold: true
    });

    page.elements.push({
      id: 'demo_formula_v',
      type: 'text',
      x: 395,
      y: 345,
      text: 'v(t) = a · t + v₀       [معادلة السرعة اللحظية]',
      fontSize: 16,
      color: '#0284c7',
      isBold: true
    });

    page.elements.push({
      id: 'demo_formula_x',
      type: 'text',
      x: 395,
      y: 385,
      text: 'x(t) = ½ · a · t² + v₀ · t + x₀   [معادلة الموضع والمسافة]',
      fontSize: 16,
      color: '#008744',
      isBold: true
    });

    this.engine.fitToContent();
  }

  // --- Inline Text Editor (Overlaid on Canvas) ---

  openInlineTextEditor(worldX, worldY, screenPos, existingElement = null) {
    const editor = this.dom.textEditor;
    if (!editor) return;

    const screen = this.engine.worldToScreen(worldX, worldY);
    editor.style.left = screen.x + 'px';
    editor.style.top = screen.y + 'px';
    editor.style.fontSize = Math.max(14, (existingElement?.fontSize || this.tools.fontSize) * this.engine.zoom) + 'px';
    editor.style.color = existingElement?.color || this.tools.strokeColor || '#0f172a';
    editor.value = existingElement ? existingElement.text : '';
    editor.style.display = 'block';
    editor.focus();

    const commit = () => {
      if (editor.style.display === 'none') return;
      const text = editor.value.trim();
      editor.style.display = 'none';

      if (!text) {
        if (existingElement) {
          const idx = this.engine.activePage.elements.indexOf(existingElement);
          if (idx !== -1) this.engine.activePage.elements.splice(idx, 1);
        }
      } else {
        if (existingElement) {
          existingElement.text = text;
        } else {
          const newEl = {
            id: 'txt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: 'text',
            x: worldX,
            y: worldY,
            text: text,
            fontSize: this.tools.fontSize || 20,
            color: this.tools.strokeColor || '#0f172a',
            isBold: false
          };
          this.engine.activePage.elements.push(newEl);
          this.engine.selectedElementIds.clear();
          this.engine.selectedElementIds.add(newEl.id);
        }
      }

      this.engine.render();
      this.saveStateToHistory();
      this.engine.renderMinimap(this.dom.minimapCanvas);
    };

    editor.onblur = commit;
    editor.onkeydown = (e) => {
      if (e.key === 'Escape') {
        editor.style.display = 'none';
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        commit();
      }
    };
  }

  // --- Presentation Mode ---

  togglePresentationMode() {
    const app = this.dom.appContainer;
    const isPresent = app.classList.toggle('presenter-mode');

    if (isPresent) {
      if (app.requestFullscreen) {
        app.requestFullscreen().catch(() => {});
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

    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
    }

    this.historyStack.push(snapshot);
    if (this.historyStack.length > this.maxHistory) {
      this.historyStack.shift();
    }
    this.historyIndex = this.historyStack.length - 1;

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

  // --- Slide & Page Drawer ---

  initPagesDrawer() {
    this.dom.btnTogglePages?.addEventListener('click', () => {
      this.dom.pagesDrawer.classList.toggle('open');
    });

    this.dom.btnCloseDrawer?.addEventListener('click', () => {
      this.dom.pagesDrawer.classList.remove('open');
    });

    this.dom.btnAddPage?.addEventListener('click', () => {
      this.addNewPage();
    });

    // Presenter bar page buttons
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

    this.dom.btnExitPresent?.addEventListener('click', () => {
      this.togglePresentationMode();
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
    if (!listEl) return;
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

    // Smart Chalkboard / Blackboard Palette auto-switch
    if (bgType === 'chalkboard' || bgType === 'blackboard') {
      if (this.tools.strokeColor === '#0f172a' || this.tools.strokeColor === '#000000') {
        this.tools.strokeColor = '#ffffff';
        this.dom.colorSwatches.forEach(d => {
          d.classList.toggle('active', d.dataset.color === '#ffffff');
        });
      }
    } else {
      if (this.tools.strokeColor === '#ffffff') {
        this.tools.strokeColor = '#0f172a';
        this.dom.colorSwatches.forEach(d => {
          d.classList.toggle('active', d.dataset.color === '#0f172a');
        });
      }
    }

    this.engine.render();
    this.renderPagesList();
    this.saveStateToHistory();
  }

  // --- Classic Menus ---

  initMenus() {
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
      ExportEngine.exportPNG(this.engine, 'dz-whiteboard-lecture.png');
    });

    document.getElementById('itemExportSvg')?.addEventListener('click', () => {
      ExportEngine.exportSVG(this.engine, 'dz-whiteboard-lecture.svg');
    });

    document.getElementById('itemExportPdf')?.addEventListener('click', () => {
      ExportEngine.exportMultiPagePDF(this.engine, 'الدرس التفاعلي — DZ-Whiteboard Pro');
    });

    // Edit Menu
    document.getElementById('itemUndo')?.addEventListener('click', () => this.undo());
    document.getElementById('itemRedo')?.addEventListener('click', () => this.redo());
    document.getElementById('itemDuplicate')?.addEventListener('click', () => {
      this.tools.duplicateSelected();
      this.saveStateToHistory();
    });
    document.getElementById('itemDeleteSelection')?.addEventListener('click', () => this.deleteSelected());
    document.getElementById('itemClearPage')?.addEventListener('click', () => {
      this.dom.clearConfirmModal.style.display = 'flex';
    });

    // Background Menu
    document.getElementById('bgOptWhite')?.addEventListener('click', () => this.setBackground('white'));
    document.getElementById('bgOptGrid')?.addEventListener('click', () => this.setBackground('grid'));
    document.getElementById('bgOptLines')?.addEventListener('click', () => this.setBackground('lines'));
    document.getElementById('bgOptDots')?.addEventListener('click', () => this.setBackground('dots'));
    document.getElementById('bgOptChalkboard')?.addEventListener('click', () => this.setBackground('chalkboard'));
    document.getElementById('bgOptBlackboard')?.addEventListener('click', () => this.setBackground('blackboard'));

    // Presentation mode button in header
    this.dom.btnPresentation?.addEventListener('click', () => this.togglePresentationMode());

    // Theme Toggle
    this.dom.themeToggleBtn?.addEventListener('click', () => {
      const next = this.currentTheme === 'light' ? 'dark' : 'light';
      this.applyTheme(next);
    });

    // Language select
    this.dom.langSelect?.addEventListener('change', (e) => {
      this.applyLanguage(e.target.value);
    });
  }

  closeAllMenus() {
    document.querySelectorAll('.dropdown-menu').forEach((d) => d.classList.remove('show'));
    document.querySelectorAll('.menu-btn').forEach((b) => b.classList.remove('active'));
  }

  // --- Keyboard Shortcuts ---

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
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

      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        this.tools.duplicateSelected();
        this.saveStateToHistory();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        this.tools.copySelected();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        this.tools.selectAll();
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

      if (e.key === ']') {
        this.tools.bringForward();
        return;
      }

      if (e.key === '[') {
        this.tools.sendBackward();
        return;
      }

      if (e.key === 'F11' || (e.key === 'f' && !e.ctrlKey)) {
        e.preventDefault();
        this.togglePresentationMode();
        return;
      }

      // Quick Tools keys
      const key = e.key.toLowerCase();
      if (key === 'v') { this.tools.setTool('select'); this.setActiveToolUI('select'); }
      else if (key === 'p') { this.tools.setTool('pen'); this.setActiveToolUI('pen'); }
      else if (key === 'h') { this.tools.setTool('highlighter'); this.setActiveToolUI('highlighter'); }
      else if (key === 'e') { this.tools.setTool('eraser'); this.setActiveToolUI('eraser'); }
      else if (key === 'r') { this.tools.setTool('shape', 'rect'); this.setActiveToolUI('shapes-menu'); }
      else if (key === 'o') { this.tools.setTool('shape', 'circle'); this.setActiveToolUI('shapes-menu'); }
      else if (key === 'a') { this.tools.setTool('line', 'arrow'); this.setActiveToolUI('line-menu'); }
      else if (key === 'l') { this.tools.setTool('line', 'line'); this.setActiveToolUI('line-menu'); }
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

  // --- Theme & Language ---

  applyTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dz_wb_theme', theme);
    this.engine.render();
  }

  applyLanguage(lang) {
    this.currentLang = lang;
    localStorage.setItem('dz_wb_lang', lang);
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', lang);

    if (this.dom.langSelect) this.dom.langSelect.value = lang;

    const dict = I18N[lang] || I18N.ar;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (dict[key]) el.textContent = dict[key];
    });

    document.title = dict.appTitle || 'DZ-Whiteboard Pro';
  }

  updateZoomDisplay() {
    if (this.dom.zoomLabel) {
      this.dom.zoomLabel.textContent = Math.round(this.engine.zoom * 100) + '%';
    }
  }

  updateUI() {
    this.updateZoomDisplay();
    if (this.dom.presenterPageText) {
      this.dom.presenterPageText.textContent = `${this.engine.activePageIndex + 1} / ${this.engine.pages.length}`;
    }
    this.renderPagesList();
  }
}

// Bootstrap application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.dzWhiteboardApp = new DZWhiteboardApp();
});
