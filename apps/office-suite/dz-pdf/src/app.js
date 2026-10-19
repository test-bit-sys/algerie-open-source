/**
 * DZ-PDF Pro: Main Application Controller (Adobe Acrobat Pro Desktop Alternative)
 * Follows HeyPuter/everything standard: Vanilla JS ES Modules, zero emojis,
 * trilingual enterprise UI (AR/FR/EN), dark/light theme, 100% offline-first.
 */

import { PDFEngine, PAGE_SIZES, ALGERIAN_STAMPS, ALGERIAN_WILAYAS, StampRenderer } from './pdf-engine.js';
import { SignaturePad } from './signature-pad.js';
import { AlgerianTemplates } from './templates.js';

const I18N = {
  ar: {
    appTitle: 'DZ-PDF Pro — بديل Adobe Acrobat المفتوح المصدر',
    menuFile: 'ملف',
    mOpenFile: 'فتح ملفات أو صور...',
    mMergeFiles: 'دمج ملفات PDF وصور متعددة...',
    mSplitFile: 'تقسيم واستخراج صفحات...',
    mBlankPage: 'إدراج صفحة بيضاء جديدة',
    mSavePdf: 'حفظ وتصدير PDF مجمع',
    mExportImages: 'تصدير الصفحة كصورة عالية الدقة',
    mPrint: 'طباعة المستند...',
    mDocProps: 'خصائص المستند',
    menuTemplates: 'نماذج رسمية',
    tplCert: '1. شهادة إدارية رسمية مطابقة',
    tplInvoice: '2. فاتورة وعقد تجاري رسمي (DZD)',
    tplHonor: '3. تصريح شرفي رسمي جزائري',
    tplWork: '4. شهادة عمل وممارسة مهنية CNAS',
    tplRequest: '5. استمارة طلب خطي إداري',
    tplPaySlip: '6. كشف راتب ومستحقات (Fiche de Paie)',
    tplBrowseAll: 'استعراض مكتبة النماذج بالكامل...',
    menuEdit: 'تحرير',
    mUndo: 'تراجع',
    mClearAnn: 'مسح تأشيرات الصفحة الحالية',
    mRotateCW: 'تدوير 90° باتجاه عقارب الساعة',
    mRotateCCW: 'تدوير 90° عكس عقارب الساعة',
    mDuplicate: 'تكرار الصفحة الحالية',
    mDelete: 'حذف الصفحة الحالية',
    menuView: 'عرض',
    mModeEditor: 'محرر وقارئ الصفحة الفردية',
    mModeOrganizer: 'تنظيم وترتيب صفحات المستند',
    mZoomIn: 'تكبير',
    mZoomOut: 'تصغير',
    mZoom100: 'الحجم الفعلي (100%)',
    mFitWidth: 'ملائمة العرض',
    mToggleSidebar: 'إظهار / إخفاء اللوحة الجانبية',
    menuTools: 'أدوات',
    mToolStamps: 'الأختام والمصادقات الإدارية الجزائرية',
    mToolSign: 'لوحة التوقيع الرقمي المعتمد',
    mToolWatermark: 'إدارة العلامة المائية والترقيم الجبائي',
    mToolSplit: 'تقسيم واستخراج صفحات المستند',
    menuHelp: 'مساعدة',
    mShortcuts: 'اختصارات لوحة المفاتيح',
    mAbout: 'حول استوديو DZ-PDF Pro',
    tbOpen: 'فتح',
    tbSave: 'تصدير PDF',
    tbSplit: 'تقسيم',
    modeEditor: 'محرر الصفحة',
    modeOrganizer: 'تنظيم الصفحات',
    tbStamp: 'أختام رسمية',
    tbSign: 'توقيع',
    tbTemplates: 'نماذج وثائق',
    panelThumbnails: 'مصغرات الصفحات',
    panelComments: 'التعليقات والتأشيرات',
    panelTemplates: 'نماذج وثائق الجزائر',
    panelProperties: 'خصائص المستند',
    propName: 'اسم الملف:',
    propPages: 'عدد الصفحات:',
    propFormat: 'تنسيق الورق:',
    propStandard: 'المعيار:',
    propSecurity: 'التوثيق الإداري:',
    emptyTitle: 'استوديو وثائق PDF الجزائري — البديل المكتبي الاحترافي',
    emptyDesc: 'قم بسحب وإفلات ملفات PDF أو الصور لتنظيم الصفحات، التدوير، إضافة التوقيع الرقمي المعتمد، والأختام الإدارية الرسمية.',
    openFiles: 'فتح ملفات أو صور',
    loadTemplateBtn: 'استعراض نماذج الوثائق الجزائرية (7 نماذج)',
    organizerTip: 'اسحب وأفلت لإعادة الترتيب، أو اضغط على أزرار التدوير والحذف',
    insertBlank: 'إدراج صفحة بيضاء',
    rotateAll: 'تدوير الكل 90°',
    stampsModalTitle: 'الأختام والمصادقات الإدارية الرسمية الجزائرية',
    stampWilaya: 'الولاية / الجهة الإدارية (58 ولاية):',
    stampRef: 'رقم القيد / المرجع الإداري:',
    signatureModalTitle: 'لوحة التوقيع الرقمي المعتمد للمستندات',
    sigGuide: 'ارسم توقيعك هنا بالفأرة أو القلم اللمسي',
    undoStroke: 'تراجع',
    clearSignature: 'مسح',
    signatoryName: 'اسم الموقّع / اللقب:',
    signatoryRole: 'الصفة / المنصب الإداري:',
    signatoryWilaya: 'مكان التوقيع (الولاية):',
    sigType: 'شكل التوقيع:',
    cancel: 'إلغاء',
    applySignature: 'تطبيق التوقيع على الصفحة',
    watermarkSettings: 'إعدادات العلامة المائية والترقيم',
    watermarkText: 'نص العلامة المائية (Watermark):',
    enablePageNumbers: 'تفعيل الترقيم التلقائي للصفحات (Page 1 of N)',
    shortcutsTitle: 'اختصارات لوحة المفاتيح (Acrobat Standard)',
    close: 'إغلاق'
  },
  fr: {
    appTitle: 'DZ-PDF Pro — Alternative Open Source à Adobe Acrobat',
    menuFile: 'Fichier',
    mOpenFile: 'Ouvrir des fichiers ou images...',
    mMergeFiles: 'Fusionner des fichiers PDF & images...',
    mSplitFile: 'Scinder et extraire des pages...',
    mBlankPage: 'Insérer une page blanche',
    mSavePdf: 'Enregistrer & Exporter PDF',
    mExportImages: 'Exporter la page en image HD',
    mPrint: 'Imprimer le document...',
    mDocProps: 'Propriétés du document',
    menuTemplates: 'Modèles officiels',
    tplCert: '1. Attestation administrative conforme',
    tplInvoice: '2. Facture & contrat commercial (DZD)',
    tplHonor: '3. Déclaration sur l’honneur',
    tplWork: '4. Attestation de travail CNAS',
    tplRequest: '5. Demande administrative officielle',
    tplPaySlip: '6. Fiche de paie / Bulletin',
    tplBrowseAll: 'Parcourir tous les modèles...',
    menuEdit: 'Édition',
    mUndo: 'Annuler',
    mClearAnn: 'Effacer annotations de la page',
    mRotateCW: 'Pivoter 90° horaire',
    mRotateCCW: 'Pivoter 90° anti-horaire',
    mDuplicate: 'Dupliquer la page actuelle',
    mDelete: 'Supprimer la page actuelle',
    menuView: 'Affichage',
    mModeEditor: 'Lecteur & Éditeur de Page',
    mModeOrganizer: 'Organiseur de Pages',
    mZoomIn: 'Zoom Avant',
    mZoomOut: 'Zoom Arrière',
    mZoom100: 'Taille Réelle (100%)',
    mFitWidth: 'Ajuster à la largeur',
    mToggleSidebar: 'Afficher / Masquer le volet latéral',
    menuTools: 'Outils',
    mToolStamps: 'Tampons administratifs officiels',
    mToolSign: 'Signature numérique certifiée',
    mToolWatermark: 'Gestion filigrane et numérotation',
    mToolSplit: 'Scinder et extraire des pages',
    menuHelp: 'Aide',
    mShortcuts: 'Raccourcis clavier',
    mAbout: 'À propos de DZ-PDF Pro',
    tbOpen: 'Ouvrir',
    tbSave: 'Exporter PDF',
    tbSplit: 'Scinder',
    modeEditor: 'Éditeur de Page',
    modeOrganizer: 'Organiser Pages',
    tbStamp: 'Tampons',
    tbSign: 'Signer',
    tbTemplates: 'Modèles',
    panelThumbnails: 'Vignettes des pages',
    panelComments: 'Commentaires & Annotations',
    panelTemplates: 'Modèles de documents algériens',
    panelProperties: 'Propriétés du document',
    propName: 'Nom du fichier:',
    propPages: 'Nombre de pages:',
    propFormat: 'Format papier:',
    propStandard: 'Norme:',
    propSecurity: 'Validation:',
    emptyTitle: 'Studio de Documents PDF Algérien — Édition Pro',
    emptyDesc: 'Glissez et déposez des fichiers PDF ou images pour organiser les pages, pivoter, apposer des signatures numériques et tampons officiels.',
    openFiles: 'Ouvrir fichiers ou images',
    loadTemplateBtn: 'Parcourir les modèles algériens (7 modèles)',
    organizerTip: 'Glissez-déposez pour réorganiser, pivotez ou supprimez',
    insertBlank: 'Insérer page blanche',
    rotateAll: 'Pivoter tout 90°',
    stampsModalTitle: 'Tampons et Visas Administratifs Algériens',
    stampWilaya: 'Wilaya / Entité administrative (58 wilayas):',
    stampRef: 'Réf / Numéro d’enregistrement:',
    signatureModalTitle: 'Module de Signature Numérique Certifiée',
    sigGuide: 'Tracez votre signature avec la souris ou le stylet',
    undoStroke: 'Annuler trait',
    clearSignature: 'Effacer',
    signatoryName: 'Nom et Prénom du signataire:',
    signatoryRole: 'Qualité / Fonction administrative:',
    signatoryWilaya: 'Lieu de signature (Wilaya):',
    sigType: 'Format du visa:',
    cancel: 'Annuler',
    applySignature: 'Apposer la signature sur la page',
    watermarkSettings: 'Paramètres Filigrane & Numérotation',
    watermarkText: 'Texte du filigrane (Watermark):',
    enablePageNumbers: 'Activer la numérotation automatique (Page 1 sur N)',
    shortcutsTitle: 'Raccourcis Clavier (Norme Acrobat)',
    close: 'Fermer'
  },
  en: {
    appTitle: 'DZ-PDF Pro — Open Source Adobe Acrobat Alternative',
    menuFile: 'File',
    mOpenFile: 'Open files or images...',
    mMergeFiles: 'Merge PDFs & images...',
    mSplitFile: 'Split and extract pages...',
    mBlankPage: 'Insert Blank Page',
    mSavePdf: 'Save & Compile PDF',
    mExportImages: 'Export Page as HD Image',
    mPrint: 'Print Document...',
    mDocProps: 'Document Properties',
    menuTemplates: 'Official Templates',
    tplCert: '1. Administrative Certificate',
    tplInvoice: '2. Commercial Invoice & Contract (DZD)',
    tplHonor: '3. Declaration on Honor',
    tplWork: '4. Employment Certificate CNAS',
    tplRequest: '5. Official Administrative Request',
    tplPaySlip: '6. Salary Slip / Pay Sheet',
    tplBrowseAll: 'Browse All Templates...',
    menuEdit: 'Edit',
    mUndo: 'Undo',
    mClearAnn: 'Clear Annotations on Current Page',
    mRotateCW: 'Rotate 90° Clockwise',
    mRotateCCW: 'Rotate 90° Counter-Clockwise',
    mDuplicate: 'Duplicate Current Page',
    mDelete: 'Delete Current Page',
    menuView: 'View',
    mModeEditor: 'Single Page Reader & Editor',
    mModeOrganizer: 'Page Organizer Grid',
    mZoomIn: 'Zoom In',
    mZoomOut: 'Zoom Out',
    mZoom100: 'Actual Size (100%)',
    mFitWidth: 'Fit Width',
    mToggleSidebar: 'Toggle Sidebar',
    menuTools: 'Tools',
    mToolStamps: 'Official Algerian Administrative Stamps',
    mToolSign: 'Certified Digital Signature Pad',
    mToolWatermark: 'Watermark & Bates Numbering',
    mToolSplit: 'Split & Extract Document Pages',
    menuHelp: 'Help',
    mShortcuts: 'Keyboard Shortcuts',
    mAbout: 'About DZ-PDF Pro',
    tbOpen: 'Open',
    tbSave: 'Export PDF',
    tbSplit: 'Split',
    modeEditor: 'Page Editor',
    modeOrganizer: 'Organize Pages',
    tbStamp: 'Official Stamps',
    tbSign: 'Sign',
    tbTemplates: 'Templates',
    panelThumbnails: 'Page Thumbnails',
    panelComments: 'Comments & Annotations',
    panelTemplates: 'Algerian Document Templates',
    panelProperties: 'Document Properties',
    propName: 'File Name:',
    propPages: 'Page Count:',
    propFormat: 'Paper Format:',
    propStandard: 'Standard:',
    propSecurity: 'Validation:',
    emptyTitle: 'Algerian PDF Document Studio — Desktop Pro Edition',
    emptyDesc: 'Drag & drop PDF files or images to organize pages, rotate, apply certified digital signatures, and official administrative stamps.',
    openFiles: 'Open Files or Images',
    loadTemplateBtn: 'Browse Algerian Document Templates (7 Templates)',
    organizerTip: 'Drag and drop to reorder, rotate or delete pages',
    insertBlank: 'Insert Blank Page',
    rotateAll: 'Rotate All 90°',
    stampsModalTitle: 'Official Algerian Administrative Stamps & Seals',
    stampWilaya: 'Wilaya / Administrative Entity (58 Wilayas):',
    stampRef: 'Reference / Filing Number:',
    signatureModalTitle: 'Certified Digital Signature Module',
    sigGuide: 'Draw your signature here using mouse or touch pen',
    undoStroke: 'Undo Stroke',
    clearSignature: 'Clear',
    signatoryName: 'Signatory Full Name:',
    signatoryRole: 'Official Title / Designation:',
    signatoryWilaya: 'Signing Location (Wilaya):',
    sigType: 'Signature Badge Style:',
    cancel: 'Cancel',
    applySignature: 'Apply Signature to Page',
    watermarkSettings: 'Watermark & Numbering Settings',
    watermarkText: 'Watermark Text:',
    enablePageNumbers: 'Enable Automatic Page Numbering (Page 1 of N)',
    shortcutsTitle: 'Keyboard Shortcuts (Acrobat Standard)',
    close: 'Close'
  }
};

class DZPdfProApp {
  constructor() {
    this.currentLang = 'ar';
    this.theme = 'dark';

    this.pages = [];
    this.currentPageIndex = 0;
    this.viewMode = 'editor'; // 'editor' | 'organizer'
    this.activeTool = 'select'; // 'select' | 'pan' | 'pen' | 'highlighter' | 'text' | 'redact' | 'note' | 'measure'
    this.measureScale = 1.0;
    this.measureStart = null;

    // Tool Settings
    this.penColor = '#dc2626';
    this.penWidth = 3;
    this.highlighterColor = 'rgba(250, 204, 21, 0.4)';
    this.highlighterWidth = 24;
    this.textFontSize = 18;
    this.textColor = '#0f172a';

    // Viewport scale & pan
    this.zoomLevel = 1.0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // Drawing state
    this.isDrawing = false;
    this.currentStrokePoints = [];
    this.redactStart = null;

    // Watermark, Bates & Header/Footer Settings
    this.watermarkText = '';
    this.watermarkOpacity = 0.25;
    this.watermarkAngle = 45;
    this.includePageNumbers = true;
    this.headerText = '';
    this.footerText = '';

    // Signature Pad
    this.sigPad = null;
    this.activeStampFilter = 'all';

    // Drag and Drop organizer state
    this.draggedCardIndex = null;

    // Merge files queue
    this.mergeQueue = [];

    // DOM Elements
    this.viewport = document.getElementById('canvas-viewport');
    this.paperWrapper = document.getElementById('page-paper-wrapper');
    this.baseCanvas = document.getElementById('active-page-canvas');
    this.overlayCanvas = document.getElementById('overlay-interaction-canvas');
    this.domOverlay = document.getElementById('page-dom-overlay');

    this.init();
  }

  init() {
    this.setupLanguage(this.currentLang);
    this.setupTheme(this.theme);
    this.populateWilayasDropdown();
    this.bindAcrobatMenus();
    this.bindToolbar();
    this.bindSidebar();
    this.bindCanvasInteractions();
    this.bindKeyboardShortcuts();
    this.initSignaturePad();
    this.initTemplatesModals();
    this.renderStampsPicker();

    // Load initial sample official Algerian administrative certificate
    this.loadTemplate('cert_admin');
  }

  populateWilayasDropdown() {
    const sel = document.getElementById('select-stamp-wilaya');
    if (!sel) return;
    sel.innerHTML = ALGERIAN_WILAYAS.map(
      (w) => `<option value="ولاية ${w.nameAr}">${w.code} - ولاية ${w.nameAr} (${w.nameFr})</option>`
    ).join('');
    sel.value = 'ولاية الجزائر العاصمة';
  }

  setupLanguage(lang) {
    this.currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

    const t = I18N[lang];
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    const langSelect = document.getElementById('lang-select');
    if (langSelect) langSelect.value = lang;
  }

  setupTheme(theme) {
    this.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
  }

  toggleTheme() {
    this.setupTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'toast-container';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  initSignaturePad() {
    const canvas = document.getElementById('signature-canvas');
    if (canvas) {
      this.sigPad = new SignaturePad(canvas);
    }

    // Bind Signature Mode Tabs (Draw, Type, Upload)
    document.querySelectorAll('.sig-mode-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.sig-mode-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const mode = tab.getAttribute('data-mode');
        this.setSigPadMode(mode);
      });
    });

    // Typed Signature input
    const typeInput = document.getElementById('sig-typed-input');
    typeInput?.addEventListener('input', (e) => {
      this.sigPad?.setTypedText(e.target.value);
    });

    // File input for image upload
    const sigFileInput = document.getElementById('sig-file-input');
    sigFileInput?.addEventListener('change', async (e) => {
      if (e.target.files.length) {
        const file = e.target.files[0];
        const dataUrl = await new Promise((res) => {
          const r = new FileReader();
          r.onload = (ev) => res(ev.target.result);
          r.readAsDataURL(file);
        });
        const img = await PDFEngine.loadImage(dataUrl);
        this.sigPad?.setUploadedImage(img);
        sigFileInput.value = '';
      }
    });
  }

  setSigPadMode(mode) {
    if (!this.sigPad) return;
    this.sigPad.setMode(mode);

    const typeRow = document.getElementById('sig-type-row');
    const guideText = document.getElementById('sig-guide-text');
    const canvas = document.getElementById('signature-canvas');

    if (mode === 'type') {
      if (typeRow) typeRow.style.display = 'block';
      if (guideText) guideText.style.display = 'none';
      const typeInput = document.getElementById('sig-typed-input');
      if (typeInput) {
        typeInput.focus();
        if (!typeInput.value) {
          typeInput.value = document.getElementById('sig-input-name')?.value || 'Mohamed BENALI';
        }
        this.sigPad.setTypedText(typeInput.value);
      }
    } else if (mode === 'upload') {
      if (typeRow) typeRow.style.display = 'none';
      if (guideText) {
        guideText.style.display = 'block';
        guideText.textContent = 'انقر لرفع صورة التوقيع أو الختم الشفاف';
      }
      canvas.onclick = () => document.getElementById('sig-file-input')?.click();
      document.getElementById('sig-file-input')?.click();
    } else {
      // Draw mode
      if (typeRow) typeRow.style.display = 'none';
      if (guideText) {
        guideText.style.display = 'block';
        guideText.textContent = 'ارسم توقيعك هنا بالفأرة أو القلم اللمسي';
      }
      canvas.onclick = null;
    }
  }

  /* ---------------- MENU BAR & SHORTCUTS ---------------- */

  bindAcrobatMenus() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach((item) => {
      item.querySelector('.menu-title')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = item.classList.contains('active');
        menuItems.forEach((m) => m.classList.remove('active'));
        if (!isActive) item.classList.add('active');
      });
    });

    window.addEventListener('click', () => {
      menuItems.forEach((m) => m.classList.remove('active'));
    });

    // File Menu Actions
    const fileInput = document.getElementById('file-input');
    document.getElementById('m-open-file')?.addEventListener('click', () => fileInput.click());
    document.getElementById('tb-open')?.addEventListener('click', () => fileInput.click());
    document.getElementById('btn-empty-open')?.addEventListener('click', () => fileInput.click());

    document.getElementById('m-merge-files')?.addEventListener('click', () => this.openMergeModal());
    document.getElementById('m-split-file')?.addEventListener('click', () => this.openSplitModal());
    document.getElementById('tb-split')?.addEventListener('click', () => this.openSplitModal());
    document.getElementById('m-tool-split')?.addEventListener('click', () => this.openSplitModal());

    document.getElementById('m-blank-page')?.addEventListener('click', () => this.insertBlankPage());
    document.getElementById('btn-empty-blank')?.addEventListener('click', () => this.insertBlankPage());
    document.getElementById('btn-sidebar-add-blank')?.addEventListener('click', () => this.insertBlankPage());
    document.getElementById('btn-organizer-add-blank')?.addEventListener('click', () => this.insertBlankPage());

    document.getElementById('m-save-pdf')?.addEventListener('click', () => this.exportCompiledPDF());
    document.getElementById('tb-save')?.addEventListener('click', () => this.exportCompiledPDF());

    document.getElementById('m-export-images')?.addEventListener('click', () => this.exportCurrentPageImage());
    document.getElementById('m-print')?.addEventListener('click', () => this.printDocument());
    document.getElementById('tb-print')?.addEventListener('click', () => this.printDocument());

    document.getElementById('m-doc-props')?.addEventListener('click', () => {
      document.getElementById('dock-tab-props')?.click();
    });

    // Templates Menu Actions
    document.getElementById('m-tpl-cert')?.addEventListener('click', () => this.loadTemplate('cert_admin'));
    document.getElementById('m-tpl-invoice')?.addEventListener('click', () => this.loadTemplate('inv_commercial'));
    document.getElementById('m-tpl-honor')?.addEventListener('click', () => this.loadTemplate('honor_declaration'));
    document.getElementById('m-tpl-work')?.addEventListener('click', () => this.loadTemplate('work_cert'));
    document.getElementById('m-tpl-request')?.addEventListener('click', () => this.loadTemplate('admin_request'));
    document.getElementById('m-tpl-payslip')?.addEventListener('click', () => this.loadTemplate('pay_slip'));
    document.getElementById('m-tpl-browse')?.addEventListener('click', () => this.openTemplatesModal());
    document.getElementById('btn-empty-templates')?.addEventListener('click', () => this.openTemplatesModal());
    document.getElementById('btn-organizer-add-template')?.addEventListener('click', () => this.openTemplatesModal());
    document.getElementById('tool-templates')?.addEventListener('click', () => this.openTemplatesModal());

    // Edit Menu Actions
    document.getElementById('m-undo')?.addEventListener('click', () => this.undoCurrentPageAnnotation());
    document.getElementById('m-clear-ann')?.addEventListener('click', () => this.clearCurrentPageAnnotations());
    document.getElementById('m-rotate-cw')?.addEventListener('click', () => this.rotateCurrentPage(90));
    document.getElementById('btn-quick-rotate')?.addEventListener('click', () => this.rotateCurrentPage(90));
    document.getElementById('m-rotate-ccw')?.addEventListener('click', () => this.rotateCurrentPage(-90));
    document.getElementById('m-duplicate-page')?.addEventListener('click', () => this.duplicateCurrentPage());
    document.getElementById('m-delete-page')?.addEventListener('click', () => this.deleteCurrentPage());

    // View Menu Actions
    document.getElementById('m-mode-editor')?.addEventListener('click', () => this.setViewMode('editor'));
    document.getElementById('btn-mode-editor')?.addEventListener('click', () => this.setViewMode('editor'));
    document.getElementById('m-mode-organizer')?.addEventListener('click', () => this.setViewMode('organizer'));
    document.getElementById('btn-mode-organizer')?.addEventListener('click', () => this.setViewMode('organizer'));

    document.getElementById('m-zoom-in')?.addEventListener('click', () => this.changeZoom(0.25));
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.changeZoom(0.25));
    document.getElementById('m-zoom-out')?.addEventListener('click', () => this.changeZoom(-0.25));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.changeZoom(-0.25));
    document.getElementById('m-zoom-100')?.addEventListener('click', () => this.setZoom(1.0));
    document.getElementById('btn-fit-page')?.addEventListener('click', () => this.fitPageToViewport());
    document.getElementById('m-fit-width')?.addEventListener('click', () => this.fitPageToViewport());

    document.getElementById('m-toggle-sidebar')?.addEventListener('click', () => this.toggleSidebar());

    // Tools Menu Actions
    document.getElementById('m-tool-stamps')?.addEventListener('click', () => this.openStampsModal());
    document.getElementById('tool-stamp')?.addEventListener('click', () => this.openStampsModal());
    document.getElementById('m-tool-sign')?.addEventListener('click', () => this.openSignatureModal());
    document.getElementById('tool-sign')?.addEventListener('click', () => this.openSignatureModal());
    document.getElementById('m-tool-watermark')?.addEventListener('click', () => this.openWatermarkModal());

    // Help Menu Actions
    document.getElementById('m-shortcuts')?.addEventListener('click', () => {
      document.getElementById('modal-shortcuts').classList.add('open');
    });
    document.getElementById('m-about')?.addEventListener('click', () => {
      document.getElementById('modal-about').classList.add('open');
    });

    // Modal Close buttons
    document.querySelectorAll('.btn-modal-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      });
    });

    // File Input change
    fileInput.addEventListener('change', async (e) => {
      if (e.target.files.length) {
        await this.loadFiles(e.target.files);
        fileInput.value = '';
      }
    });

    // Drag and Drop files onto window
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) {
        await this.loadFiles(e.dataTransfer.files);
      }
    });

    // Theme & Lang Selectors
    document.getElementById('btn-theme')?.addEventListener('click', () => this.toggleTheme());
    document.getElementById('lang-select')?.addEventListener('change', (e) => this.setupLanguage(e.target.value));

    // Watermark modal apply
    document.getElementById('btn-save-watermark')?.addEventListener('click', () => {
      this.watermarkText = document.getElementById('input-modal-watermark')?.value.trim() || '';
      this.watermarkOpacity = parseFloat(document.getElementById('input-wm-opacity')?.value || '0.25');
      this.watermarkAngle = parseInt(document.getElementById('select-wm-angle')?.value || '45');
      this.headerText = document.getElementById('input-doc-header')?.value.trim() || '';
      this.footerText = document.getElementById('input-doc-footer')?.value.trim() || '';
      this.includePageNumbers = document.getElementById('check-page-numbers')?.checked ?? true;
      this.renderCurrentPage();
      this.showToast('Watermark & Bates numbering updated');
    });

    document.getElementById('input-wm-opacity')?.addEventListener('input', (e) => {
      const lbl = document.getElementById('wm-opacity-label');
      if (lbl) lbl.textContent = Math.round(e.target.value * 100) + '%';
    });

    // Signature Modal events
    document.getElementById('btn-sig-clear')?.addEventListener('click', () => this.sigPad.clear());
    document.getElementById('btn-sig-undo')?.addEventListener('click', () => this.sigPad.undo());
    document.querySelectorAll('.sig-color-dot').forEach((dot) => {
      dot.addEventListener('click', (e) => {
        document.querySelectorAll('.sig-color-dot').forEach((d) => d.classList.remove('active'));
        e.target.classList.add('active');
        this.sigPad.setColor(e.target.getAttribute('data-color'));
      });
    });

    document.getElementById('btn-sig-apply')?.addEventListener('click', () => this.applySignatureToActivePage());

    // Split & Merge Actions
    document.getElementById('btn-do-split')?.addEventListener('click', () => this.executeSplit());
    document.getElementById('btn-merge-add-files')?.addEventListener('click', () => {
      document.getElementById('file-input')?.click();
    });
    document.getElementById('btn-do-merge')?.addEventListener('click', () => {
      document.getElementById('modal-merge')?.classList.remove('open');
      this.showToast('All documents combined into active session');
    });
  }

  bindToolbar() {
    // Pagination controls
    const curInput = document.getElementById('input-current-page');
    curInput?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value) - 1;
      if (val >= 0 && val < this.pages.length) {
        this.goToPage(val);
      } else {
        curInput.value = this.currentPageIndex + 1;
      }
    });

    document.getElementById('btn-prev-page')?.addEventListener('click', () => {
      if (this.currentPageIndex > 0) this.goToPage(this.currentPageIndex - 1);
    });

    document.getElementById('btn-next-page')?.addEventListener('click', () => {
      if (this.currentPageIndex < this.pages.length - 1) this.goToPage(this.currentPageIndex + 1);
    });

    // Zoom selector
    const zoomSelect = document.getElementById('select-zoom');
    zoomSelect?.addEventListener('change', (e) => {
      this.setZoom(parseFloat(e.target.value));
    });

    // Tool Selection buttons
    const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
    toolBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        toolBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.setActiveTool(btn.getAttribute('data-tool'));
      });
    });

    // Organizer Rotate all
    document.getElementById('btn-organizer-rotate-all')?.addEventListener('click', () => {
      this.pages.forEach((p) => {
        p.rotation = ((p.rotation || 0) + 90) % 360;
      });
      this.renderOrganizerGrid();
      this.renderCurrentPage();
      this.showToast('All pages rotated 90°');
    });
  }

  bindSidebar() {
    const dockBtns = document.querySelectorAll('.dock-tab-btn');
    const panels = document.querySelectorAll('.sidebar-panel');

    dockBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.id.replace('dock-tab-', 'panel-');
        dockBtns.forEach((b) => b.classList.remove('active'));
        panels.forEach((p) => p.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(targetId)?.classList.add('active');

        // If sidebar was collapsed, open it
        document.getElementById('acrobat-sidebar')?.classList.remove('collapsed');
      });
    });
  }

  toggleSidebar() {
    const sidebar = document.getElementById('acrobat-sidebar');
    if (sidebar) {
      sidebar.classList.toggle('collapsed');
    }
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        document.getElementById('file-input')?.click();
      } else if (isCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.exportCompiledPDF();
      } else if (isCtrl && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.printDocument();
      } else if (isCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undoCurrentPageAnnotation();
      } else if (isCtrl && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        this.rotateCurrentPage(e.shiftKey ? -90 : 90);
      } else if (isCtrl && e.key === '1') {
        e.preventDefault();
        this.setViewMode('editor');
      } else if (isCtrl && e.key === '2') {
        e.preventDefault();
        this.setViewMode('organizer');
      } else if (isCtrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.changeZoom(0.25);
      } else if (isCtrl && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        this.changeZoom(-0.25);
      } else if (isCtrl && e.key === '0') {
        e.preventDefault();
        this.setZoom(1.0);
      } else if (e.key === 'F4') {
        e.preventDefault();
        this.toggleSidebar();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        this.deleteCurrentPage();
      } else if (!isCtrl) {
        const k = e.key.toLowerCase();
        if (k === 'v') this.triggerToolSelect('select');
        else if (k === 'h') this.triggerToolSelect('pan');
        else if (k === 'p') this.triggerToolSelect('pen');
        else if (k === 'u') this.triggerToolSelect('highlighter');
        else if (k === 't') this.triggerToolSelect('text');
        else if (k === 'r') this.triggerToolSelect('redact');
        else if (k === 'n') this.triggerToolSelect('note');
        else if (k === 'm') this.triggerToolSelect('measure');
        else if (k === 's') this.openStampsModal();
        else if (k === 'd') this.openSignatureModal();
      }
    });
  }

  triggerToolSelect(toolName) {
    const btn = document.querySelector(`.tool-btn[data-tool="${toolName}"]`);
    btn?.click();
  }

  setActiveTool(tool) {
    this.activeTool = tool;
    this.updateToolSubbar();

    if (tool === 'pan') {
      this.viewport.style.cursor = 'grab';
    } else if (tool === 'select') {
      this.viewport.style.cursor = 'default';
    } else if (tool === 'pen' || tool === 'highlighter') {
      this.viewport.style.cursor = 'crosshair';
    } else if (tool === 'text') {
      this.viewport.style.cursor = 'text';
    } else if (tool === 'redact') {
      this.viewport.style.cursor = 'crosshair';
    } else if (tool === 'note') {
      this.viewport.style.cursor = 'pointer';
    } else if (tool === 'measure') {
      this.viewport.style.cursor = 'crosshair';
    }
  }

  updateToolSubbar() {
    const subbar = document.getElementById('tool-subbar');
    const content = document.getElementById('subbar-content');
    if (!subbar || !content) return;

    if (this.activeTool === 'pen') {
      subbar.style.display = 'flex';
      content.innerHTML = `
        <span style="font-weight:700;">قلم التوقيع والرسم:</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <div class="color-dot-pick ${this.penColor === '#dc2626' ? 'active' : ''}" data-color="#dc2626" style="background:#dc2626;"></div>
          <div class="color-dot-pick ${this.penColor === '#1d4ed8' ? 'active' : ''}" data-color="#1d4ed8" style="background:#1d4ed8;"></div>
          <div class="color-dot-pick ${this.penColor === '#059669' ? 'active' : ''}" data-color="#059669" style="background:#059669;"></div>
          <div class="color-dot-pick ${this.penColor === '#0f172a' ? 'active' : ''}" data-color="#0f172a" style="background:#0f172a;"></div>
        </div>
        <span>سُمك الخط:</span>
        <select id="sub-pen-width" class="modal-select" style="padding:2px 6px;">
          <option value="2" ${this.penWidth === 2 ? 'selected' : ''}>رفيع (2px)</option>
          <option value="3" ${this.penWidth === 3 ? 'selected' : ''}>متوسط (3px)</option>
          <option value="6" ${this.penWidth === 6 ? 'selected' : ''}>عريض (6px)</option>
        </select>
      `;

      content.querySelectorAll('.color-dot-pick').forEach((dot) => {
        dot.addEventListener('click', (e) => {
          this.penColor = e.target.getAttribute('data-color');
          this.updateToolSubbar();
        });
      });

      document.getElementById('sub-pen-width')?.addEventListener('change', (e) => {
        this.penWidth = parseInt(e.target.value);
      });
    } else if (this.activeTool === 'highlighter') {
      subbar.style.display = 'flex';
      content.innerHTML = `
        <span style="font-weight:700;">تظليل النصوص (Highlighter):</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <div class="color-dot-pick active" data-color="rgba(250, 204, 21, 0.4)" style="background:#facc15;" title="Yellow"></div>
          <div class="color-dot-pick" data-color="rgba(74, 222, 128, 0.4)" style="background:#4ade80;" title="Green"></div>
          <div class="color-dot-pick" data-color="rgba(244, 114, 182, 0.4)" style="background:#f472b6;" title="Pink"></div>
          <div class="color-dot-pick" data-color="rgba(56, 189, 248, 0.4)" style="background:#38bdf8;" title="Cyan"></div>
        </div>
      `;

      content.querySelectorAll('.color-dot-pick').forEach((dot) => {
        dot.addEventListener('click', (e) => {
          content.querySelectorAll('.color-dot-pick').forEach((d) => d.classList.remove('active'));
          e.target.classList.add('active');
          this.highlighterColor = e.target.getAttribute('data-color');
        });
      });
    } else if (this.activeTool === 'text') {
      subbar.style.display = 'flex';
      content.innerHTML = `
        <span style="font-weight:700;">إضافة نص / كتابة:</span>
        <span>انقر في أي مكان على الصفحة لإدراج نص</span>
        <span>حجم الخط:</span>
        <select id="sub-text-size" class="modal-select" style="padding:2px 6px;">
          <option value="14" ${this.textFontSize === 14 ? 'selected' : ''}>14px</option>
          <option value="18" ${this.textFontSize === 18 ? 'selected' : ''}>18px</option>
          <option value="24" ${this.textFontSize === 24 ? 'selected' : ''}>24px</option>
          <option value="32" ${this.textFontSize === 32 ? 'selected' : ''}>32px</option>
        </select>
      `;

      document.getElementById('sub-text-size')?.addEventListener('change', (e) => {
        this.textFontSize = parseInt(e.target.value);
      });
    } else if (this.activeTool === 'measure') {
      subbar.style.display = 'flex';
      content.innerHTML = `
        <span style="font-weight:700;">أداة قياس المخططات (Measuring Tool):</span>
        <span>المقياس (Scale):</span>
        <select id="sub-measure-scale" class="modal-select" style="padding:2px 6px;">
          <option value="1" ${this.measureScale === 1.0 ? 'selected' : ''}>1:1 (100px = 1.0m)</option>
          <option value="0.5" ${this.measureScale === 0.5 ? 'selected' : ''}>1:50 (100px = 0.5m)</option>
          <option value="2.0" ${this.measureScale === 2.0 ? 'selected' : ''}>1:200 (100px = 2.0m)</option>
          <option value="5.0" ${this.measureScale === 5.0 ? 'selected' : ''}>1:500 (100px = 5.0m)</option>
        </select>
        <span>المسافة المقاسة:</span>
        <strong id="measure-readout" style="color:#0284c7; font-family:monospace; font-size:13px;">0.00 m</strong>
      `;

      document.getElementById('sub-measure-scale')?.addEventListener('change', (e) => {
        this.measureScale = parseFloat(e.target.value);
      });
    } else {
      subbar.style.display = 'none';
    }
  }

  /* ---------------- VIEW MODES & ZOOM ---------------- */

  setViewMode(mode) {
    this.viewMode = mode;
    const editor = document.getElementById('page-editor-container');
    const organizer = document.getElementById('page-organizer-container');
    const btnEditor = document.getElementById('btn-mode-editor');
    const btnOrganizer = document.getElementById('btn-mode-organizer');

    if (this.pages.length === 0) {
      document.getElementById('empty-state').style.display = 'flex';
      editor.style.display = 'none';
      organizer.style.display = 'none';
      return;
    }

    document.getElementById('empty-state').style.display = 'none';

    if (mode === 'editor') {
      editor.style.display = 'flex';
      organizer.style.display = 'none';
      btnEditor?.classList.add('active');
      btnOrganizer?.classList.remove('active');
      this.renderCurrentPage();
    } else {
      editor.style.display = 'none';
      organizer.style.display = 'flex';
      btnEditor?.classList.remove('active');
      btnOrganizer?.classList.add('active');
      this.renderOrganizerGrid();
    }
  }

  setZoom(scale) {
    this.zoomLevel = Math.min(Math.max(scale, 0.4), 3.0);
    const select = document.getElementById('select-zoom');
    if (select) select.value = String(this.zoomLevel);
    this.applyZoomTransform();
  }

  changeZoom(delta) {
    this.setZoom(this.zoomLevel + delta);
  }

  fitPageToViewport() {
    if (!this.viewport || !this.baseCanvas) return;
    const vpW = this.viewport.clientWidth - 80;
    const vpH = this.viewport.clientHeight - 80;
    const scaleW = vpW / this.baseCanvas.width;
    const scaleH = vpH / this.baseCanvas.height;
    const fitScale = Math.min(scaleW, scaleH, 1.25);
    this.setZoom(Math.round(fitScale * 10) / 10);
  }

  applyZoomTransform() {
    if (this.paperWrapper) {
      this.paperWrapper.style.transform = `scale(${this.zoomLevel})`;
    }
  }

  /* ---------------- DOCUMENT LOADING & TEMPLATES ---------------- */

  loadTemplate(templateId) {
    const tplList = AlgerianTemplates.getTemplatesList();
    const item = tplList.find((t) => t.id === templateId) || tplList[0];
    const pageData = item.action();

    this.pages.push({
      id: 'p_tpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: pageData.name,
      dataUrl: pageData.dataUrl,
      rotation: 0,
      annotations: []
    });

    this.currentPageIndex = this.pages.length - 1;
    this.updateDocumentState();
    this.showToast(`تم تحميل نموذج: ${item.titleAr}`);
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
  }

  insertBlankPage() {
    const blank = AlgerianTemplates.createBlankPage(this.pages.length + 1);
    const newPage = {
      id: 'p_blank_' + Date.now(),
      name: blank.name,
      dataUrl: blank.dataUrl,
      rotation: 0,
      annotations: []
    };
    this.pages.splice(this.currentPageIndex + 1, 0, newPage);
    this.currentPageIndex++;
    this.updateDocumentState();
    this.showToast('Blank page inserted');
  }

  async loadFiles(fileList) {
    for (const file of Array.from(fileList)) {
      if (file.type.startsWith('image/')) {
        const dataUrl = await new Promise((res) => {
          const r = new FileReader();
          r.onload = (e) => res(e.target.result);
          r.readAsDataURL(file);
        });
        this.pages.push({
          id: 'p_img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          name: file.name,
          dataUrl,
          rotation: 0,
          annotations: []
        });
      } else if (file.name.endsWith('.pdf') || file.type === 'application/pdf') {
        const blank = AlgerianTemplates.createBlankPage(this.pages.length + 1);
        this.pages.push({
          id: 'p_pdf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          name: file.name,
          dataUrl: blank.dataUrl,
          rotation: 0,
          annotations: []
        });
      }
    }

    this.updateDocumentState();
    this.showToast(`${this.pages.length} pages ready`);
  }

  updateDocumentState() {
    if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = Math.max(0, this.pages.length - 1);
    }

    const totalEl = document.getElementById('label-total-pages');
    if (totalEl) totalEl.textContent = String(this.pages.length);

    const curInput = document.getElementById('input-current-page');
    if (curInput) {
      curInput.value = this.pages.length > 0 ? this.currentPageIndex + 1 : 0;
      curInput.max = this.pages.length;
    }

    const orgBadge = document.getElementById('organizer-count-badge');
    if (orgBadge) orgBadge.textContent = `${this.pages.length} صفحات`;

    const propDocPages = document.getElementById('prop-doc-pages');
    if (propDocPages) propDocPages.textContent = String(this.pages.length);

    const propDocName = document.getElementById('prop-doc-name');
    if (propDocName && this.pages.length > 0) {
      propDocName.textContent = this.pages[0].name;
    }

    const splitTotalEl = document.getElementById('split-doc-total-pages');
    if (splitTotalEl) splitTotalEl.textContent = String(this.pages.length);

    this.renderSidebarThumbnails();
    this.renderSidebarComments();

    if (this.pages.length === 0) {
      document.getElementById('empty-state').style.display = 'flex';
      document.getElementById('page-editor-container').style.display = 'none';
      document.getElementById('page-organizer-container').style.display = 'none';
    } else {
      this.setViewMode(this.viewMode);
    }
  }

  goToPage(index) {
    if (index >= 0 && index < this.pages.length) {
      this.currentPageIndex = index;
      const curInput = document.getElementById('input-current-page');
      if (curInput) curInput.value = index + 1;
      this.renderSidebarThumbnails();
      this.renderCurrentPage();
    }
  }

  rotateCurrentPage(degrees) {
    const page = this.pages[this.currentPageIndex];
    if (page) {
      page.rotation = ((page.rotation || 0) + degrees + 360) % 360;
      this.renderCurrentPage();
      this.renderSidebarThumbnails();
      this.showToast(`Rotated page ${this.currentPageIndex + 1}`);
    }
  }

  duplicateCurrentPage() {
    const orig = this.pages[this.currentPageIndex];
    if (orig) {
      const clone = {
        ...orig,
        id: 'p_dup_' + Date.now(),
        annotations: JSON.parse(JSON.stringify(orig.annotations || []))
      };
      this.pages.splice(this.currentPageIndex + 1, 0, clone);
      this.currentPageIndex++;
      this.updateDocumentState();
      this.showToast('Page duplicated');
    }
  }

  deleteCurrentPage() {
    if (this.pages.length === 0) return;
    this.pages.splice(this.currentPageIndex, 1);
    if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = Math.max(0, this.pages.length - 1);
    }
    this.updateDocumentState();
    this.showToast('Page deleted');
  }

  undoCurrentPageAnnotation() {
    const page = this.pages[this.currentPageIndex];
    if (page && page.annotations && page.annotations.length > 0) {
      page.annotations.pop();
      this.renderCurrentPage();
      this.renderSidebarComments();
      this.showToast('Undo annotation');
    }
  }

  clearCurrentPageAnnotations() {
    const page = this.pages[this.currentPageIndex];
    if (page) {
      page.annotations = [];
      this.renderCurrentPage();
      this.renderSidebarComments();
      this.showToast('Cleared annotations');
    }
  }

  /* ---------------- INTERACTIVE PAGE RENDERING ---------------- */

  async renderCurrentPage() {
    const page = this.pages[this.currentPageIndex];
    if (!page || !this.baseCanvas) return;

    const baseImg = await PDFEngine.loadImage(page.dataUrl);
    const rot = page.rotation || 0;

    let w = baseImg.naturalWidth || 1240;
    let h = baseImg.naturalHeight || 1754;

    if (rot === 90 || rot === 270) {
      this.baseCanvas.width = h;
      this.baseCanvas.height = w;
      this.overlayCanvas.width = h;
      this.overlayCanvas.height = w;
    } else {
      this.baseCanvas.width = w;
      this.baseCanvas.height = h;
      this.overlayCanvas.width = w;
      this.overlayCanvas.height = h;
    }

    const ctx = this.baseCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);

    // Draw rotated background
    ctx.save();
    if (rot !== 0) {
      ctx.translate(this.baseCanvas.width / 2, this.baseCanvas.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(baseImg, -w / 2, -h / 2, w, h);
    } else {
      ctx.drawImage(baseImg, 0, 0, w, h);
    }
    ctx.restore();

    // Draw Annotations onto Base Canvas (non-DOM annotations: pen, highlight, redact, text, measure, note)
    if (page.annotations) {
      for (const ann of page.annotations) {
        if (ann.type !== 'image') {
          PDFEngine.renderAnnotation(ctx, ann, this.baseCanvas.width, this.baseCanvas.height);
        }
      }
    }

    // Draw Header Text
    if (this.headerText) {
      ctx.save();
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';
      ctx.fillText(this.headerText, this.baseCanvas.width / 2, 35);
      ctx.restore();
    }

    // Draw Watermark preview
    if (this.watermarkText) {
      ctx.save();
      ctx.globalAlpha = this.watermarkOpacity;
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 64px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = 'rtl';
      const cx = this.baseCanvas.width / 2;
      const cy = this.baseCanvas.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((-this.watermarkAngle * Math.PI) / 180);
      ctx.fillText(this.watermarkText, 0, 0);
      ctx.restore();
    }

    // Draw Bates / Footer
    const bottomText = [
      this.includePageNumbers ? `Page ${this.currentPageIndex + 1} of ${this.pages.length}` : '',
      this.footerText
    ].filter(Boolean).join(' • ');

    if (bottomText) {
      ctx.save();
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';
      ctx.fillText(bottomText, this.baseCanvas.width / 2, this.baseCanvas.height - 25);
      ctx.restore();
    }

    // Clear overlay canvas
    const octx = this.overlayCanvas.getContext('2d');
    octx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

    // Sync interactive DOM overlay
    this.renderDomOverlayItems();

    this.applyZoomTransform();
  }

  /* ---------------- INTERACTIVE DOM OVERLAY (STAMPS, SIGNATURES) ---------------- */

  renderDomOverlayItems() {
    if (!this.domOverlay) return;
    this.domOverlay.innerHTML = '';
    const page = this.pages[this.currentPageIndex];
    if (!page || !Array.isArray(page.annotations)) return;

    page.annotations.forEach((ann, idx) => {
      if (ann.type === 'image' && ann.imageElement) {
        const item = document.createElement('div');
        item.className = 'dom-placed-item';
        item.style.left = `${ann.x * 100}%`;
        item.style.top = `${ann.y * 100}%`;
        item.style.width = `${ann.w * 100}%`;
        item.style.height = `${ann.h * 100}%`;
        item.dataset.index = idx;

        const img = document.createElement('img');
        img.src = ann.imageElement.src;
        item.appendChild(img);

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'remove-btn';
        delBtn.innerHTML = '×';
        delBtn.title = 'حذف هذا الختم/التوقيع';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          page.annotations.splice(idx, 1);
          this.renderCurrentPage();
          this.renderSidebarComments();
          this.showToast('Item removed');
        };
        item.appendChild(delBtn);

        // Resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle bottom-right';
        item.appendChild(resizeHandle);

        this.attachDragAndResize(item, ann);
        this.domOverlay.appendChild(item);
      }
    });
  }

  attachDragAndResize(itemEl, ann) {
    let isDragging = false;
    let isResizing = false;
    let startX, startY;
    let initialNormX, initialNormY, initialNormW, initialNormH;

    const overlayRect = () => this.overlayCanvas.getBoundingClientRect();

    itemEl.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('remove-btn')) return;

      if (e.target.classList.contains('resize-handle')) {
        isResizing = true;
      } else {
        isDragging = true;
      }

      startX = e.clientX;
      startY = e.clientY;
      initialNormX = ann.x;
      initialNormY = ann.y;
      initialNormW = ann.w;
      initialNormH = ann.h;

      itemEl.classList.add('selected');

      const onMouseMove = (moveEv) => {
        const rect = overlayRect();
        const deltaNormX = (moveEv.clientX - startX) / rect.width;
        const deltaNormY = (moveEv.clientY - startY) / rect.height;

        if (isDragging) {
          ann.x = Math.max(0, Math.min(1 - ann.w, initialNormX + deltaNormX));
          ann.y = Math.max(0, Math.min(1 - ann.h, initialNormY + deltaNormY));
          itemEl.style.left = `${ann.x * 100}%`;
          itemEl.style.top = `${ann.y * 100}%`;
        } else if (isResizing) {
          ann.w = Math.max(0.05, Math.min(1 - ann.x, initialNormW + deltaNormX));
          ann.h = Math.max(0.03, Math.min(1 - ann.y, initialNormH + deltaNormY));
          itemEl.style.width = `${ann.w * 100}%`;
          itemEl.style.height = `${ann.h * 100}%`;
        }
      };

      const onMouseUp = () => {
        isDragging = false;
        isResizing = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        this.renderCurrentPage();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  /* ---------------- LIVE DRAWING, REDACTION & MEASUREMENTS ---------------- */

  bindCanvasInteractions() {
    const overlay = this.overlayCanvas;
    const octx = overlay.getContext('2d');

    const getNormCoords = (e) => {
      const rect = overlay.getBoundingClientRect();
      const clientX = e.clientX;
      const clientY = e.clientY;
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) };
    };

    // Pan Viewport
    this.viewport.addEventListener('mousedown', (e) => {
      if (this.activeTool === 'pan' || e.button === 1 || e.altKey) {
        this.isPanning = true;
        this.panStartX = e.clientX - this.viewport.scrollLeft;
        this.panStartY = e.clientY - this.viewport.scrollTop;
        this.viewport.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.viewport.scrollLeft = this.panStartX - e.clientX;
        this.viewport.scrollTop = this.panStartY - e.clientY;
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        if (this.activeTool === 'pan') this.viewport.style.cursor = 'grab';
      }
    });

    // Drawing on Overlay
    overlay.addEventListener('mousedown', (e) => {
      if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
        this.isDrawing = true;
        this.currentStrokePoints = [getNormCoords(e)];
      } else if (this.activeTool === 'redact') {
        this.isDrawing = true;
        this.redactStart = getNormCoords(e);
      } else if (this.activeTool === 'text') {
        const coords = getNormCoords(e);
        this.promptTextAnnotation(coords);
      } else if (this.activeTool === 'note') {
        const coords = getNormCoords(e);
        this.promptStickyNote(coords);
      } else if (this.activeTool === 'measure') {
        this.isDrawing = true;
        this.measureStart = getNormCoords(e);
      }
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!this.isDrawing) return;

      if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
        const pt = getNormCoords(e);
        this.currentStrokePoints.push(pt);

        octx.clearRect(0, 0, overlay.width, overlay.height);
        octx.beginPath();
        octx.strokeStyle = this.activeTool === 'pen' ? this.penColor : this.highlighterColor;
        octx.lineWidth = this.activeTool === 'pen' ? this.penWidth : this.highlighterWidth;
        octx.lineCap = 'round';
        octx.lineJoin = 'round';

        const w = overlay.width;
        const h = overlay.height;
        octx.moveTo(this.currentStrokePoints[0].x * w, this.currentStrokePoints[0].y * h);
        for (let i = 1; i < this.currentStrokePoints.length; i++) {
          octx.lineTo(this.currentStrokePoints[i].x * w, this.currentStrokePoints[i].y * h);
        }
        octx.stroke();
      } else if (this.activeTool === 'redact' && this.redactStart) {
        const cur = getNormCoords(e);
        octx.clearRect(0, 0, overlay.width, overlay.height);
        octx.fillStyle = '#000000';
        const rx = Math.min(this.redactStart.x, cur.x) * overlay.width;
        const ry = Math.min(this.redactStart.y, cur.y) * overlay.height;
        const rw = Math.abs(cur.x - this.redactStart.x) * overlay.width;
        const rh = Math.abs(cur.y - this.redactStart.y) * overlay.height;
        octx.fillRect(rx, ry, rw, rh);
      } else if (this.activeTool === 'measure' && this.measureStart) {
        const cur = getNormCoords(e);
        octx.clearRect(0, 0, overlay.width, overlay.height);

        const x1 = this.measureStart.x * overlay.width;
        const y1 = this.measureStart.y * overlay.height;
        const x2 = cur.x * overlay.width;
        const y2 = cur.y * overlay.height;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const scaleVal = this.measureScale || 1.0;
        const meters = ((distPx / 100) * scaleVal).toFixed(2);
        const distStr = `${meters} m`;

        const readoutEl = document.getElementById('measure-readout');
        if (readoutEl) readoutEl.textContent = distStr;

        octx.save();
        octx.strokeStyle = '#0284c7';
        octx.lineWidth = 2.5;
        octx.setLineDash([6, 4]);
        octx.beginPath();
        octx.moveTo(x1, y1);
        octx.lineTo(x2, y2);
        octx.stroke();

        octx.setLineDash([]);
        const angle = Math.atan2(dy, dx);
        const capLen = 10;
        const perp = angle + Math.PI / 2;

        octx.beginPath();
        octx.moveTo(x1 - Math.cos(perp) * capLen, y1 - Math.sin(perp) * capLen);
        octx.lineTo(x1 + Math.cos(perp) * capLen, y1 + Math.sin(perp) * capLen);
        octx.moveTo(x2 - Math.cos(perp) * capLen, y2 - Math.sin(perp) * capLen);
        octx.lineTo(x2 + Math.cos(perp) * capLen, y2 + Math.sin(perp) * capLen);
        octx.stroke();

        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        octx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        const tw = octx.measureText(distStr).width;
        octx.fillStyle = '#0f172a';
        if (octx.roundRect) {
          octx.beginPath();
          octx.roundRect(midX - tw / 2 - 8, midY - 12, tw + 16, 24, 4);
          octx.fill();
        } else {
          octx.fillRect(midX - tw / 2 - 8, midY - 12, tw + 16, 24);
        }
        octx.strokeStyle = '#38bdf8';
        octx.lineWidth = 1;
        octx.stroke();

        octx.fillStyle = '#f8fafc';
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillText(distStr, midX, midY);
        octx.restore();
      }
    });

    const stopDrawing = (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      const page = this.pages[this.currentPageIndex];
      if (!page) return;
      if (!page.annotations) page.annotations = [];

      if ((this.activeTool === 'pen' || this.activeTool === 'highlighter') && this.currentStrokePoints.length > 1) {
        page.annotations.push({
          type: this.activeTool,
          points: [...this.currentStrokePoints],
          color: this.activeTool === 'pen' ? this.penColor : this.highlighterColor,
          width: this.activeTool === 'pen' ? this.penWidth : this.highlighterWidth,
          timestamp: Date.now()
        });
        this.currentStrokePoints = [];
        this.renderCurrentPage();
        this.renderSidebarComments();
      } else if (this.activeTool === 'redact' && this.redactStart) {
        const cur = getNormCoords(e);
        const rx = Math.min(this.redactStart.x, cur.x);
        const ry = Math.min(this.redactStart.y, cur.y);
        const rw = Math.abs(cur.x - this.redactStart.x);
        const rh = Math.abs(cur.y - this.redactStart.y);
        if (rw > 0.01 && rh > 0.01) {
          page.annotations.push({
            type: 'redaction',
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            timestamp: Date.now()
          });
          this.renderCurrentPage();
          this.renderSidebarComments();
          this.showToast('Redaction blackout applied');
        }
        this.redactStart = null;
      } else if (this.activeTool === 'measure' && this.measureStart) {
        const cur = getNormCoords(e);
        const dx = (cur.x - this.measureStart.x) * overlay.width;
        const dy = (cur.y - this.measureStart.y) * overlay.height;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        if (distPx > 10) {
          const scaleVal = this.measureScale || 1.0;
          const meters = ((distPx / 100) * scaleVal).toFixed(2);
          const distStr = `${meters} m`;
          page.annotations.push({
            type: 'measure',
            start: { ...this.measureStart },
            end: { ...cur },
            distStr,
            length: parseFloat(meters),
            timestamp: Date.now()
          });
          this.renderCurrentPage();
          this.renderSidebarComments();
          this.showToast(`تم قياس المسافة: ${distStr}`);
        }
        this.measureStart = null;
      }

      octx.clearRect(0, 0, overlay.width, overlay.height);
    };

    overlay.addEventListener('mouseup', stopDrawing);
    overlay.addEventListener('mouseleave', stopDrawing);
  }

  promptTextAnnotation(coords) {
    const text = prompt('أدخل النص المراد إضافته على الوثيقة (Arabic / French / English):');
    if (!text) return;

    const page = this.pages[this.currentPageIndex];
    if (page) {
      if (!page.annotations) page.annotations = [];
      page.annotations.push({
        type: 'text',
        text,
        x: coords.x,
        y: coords.y,
        fontSize: this.textFontSize,
        color: this.textColor,
        timestamp: Date.now()
      });
      this.renderCurrentPage();
      this.renderSidebarComments();
      this.showToast('Text annotation added');
    }
  }

  promptStickyNote(coords) {
    const noteText = prompt('أدخل نص الملاحظة الإدارية (Comment / Note):');
    if (!noteText) return;

    const page = this.pages[this.currentPageIndex];
    if (page) {
      if (!page.annotations) page.annotations = [];
      page.annotations.push({
        type: 'note',
        note: noteText,
        author: 'Responsable Juridique',
        x: coords.x,
        y: coords.y,
        timestamp: Date.now()
      });
      this.renderCurrentPage();
      this.renderSidebarComments();
      this.showToast('Sticky note added');
    }
  }

  /* ---------------- ALGERIAN STAMPS SUITE ---------------- */

  openStampsModal() {
    this.renderStampsPicker();
    document.getElementById('modal-stamps')?.classList.add('open');
  }

  renderStampsPicker() {
    const grid = document.getElementById('stamps-picker-grid');
    if (!grid) return;

    const wilaya = document.getElementById('select-stamp-wilaya')?.value || 'ولاية الجزائر العاصمة';
    const ref = document.getElementById('input-stamp-ref')?.value || 'N° 1428 / REG / 2026';

    const entries = Object.entries(ALGERIAN_STAMPS).filter(([_, stamp]) => {
      if (this.activeStampFilter === 'all') return true;
      if (this.activeStampFilter === 'circular') return stamp.type === 'circular';
      if (this.activeStampFilter === 'oval') return stamp.type === 'oval';
      if (this.activeStampFilter === 'rectangular') return stamp.type === 'rectangular';
      return true;
    });

    grid.innerHTML = entries
      .map(([key, stamp]) => {
        const stampDataUrl = StampRenderer.renderStamp(key, { wilaya, ref });
        return `
          <div class="stamp-item-card" data-key="${key}">
            <img class="stamp-preview-img" src="${stampDataUrl}" alt="${stamp.titleAr}">
            <span class="stamp-title-ar">${stamp.titleAr}</span>
            <span class="stamp-title-fr">${stamp.titleFr}</span>
          </div>
        `;
      })
      .join('');

    grid.onclick = (e) => {
      const card = e.target.closest('.stamp-item-card');
      if (!card) return;
      const key = card.getAttribute('data-key');
      this.applyStampToActivePage(key);
      document.getElementById('modal-stamps')?.classList.remove('open');
    };

    // Filter tabs
    document.querySelectorAll('.stamp-filter-tab').forEach((tab) => {
      tab.onclick = (e) => {
        document.querySelectorAll('.stamp-filter-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeStampFilter = tab.getAttribute('data-filter');
        this.renderStampsPicker();
      };
    });

    document.getElementById('select-stamp-wilaya')?.addEventListener('change', () => this.renderStampsPicker());
    document.getElementById('input-stamp-ref')?.addEventListener('input', () => this.renderStampsPicker());
  }

  async applyStampToActivePage(stampKey) {
    const page = this.pages[this.currentPageIndex];
    if (!page) return;

    const wilaya = document.getElementById('select-stamp-wilaya')?.value || 'ولاية الجزائر العاصمة';
    const ref = document.getElementById('input-stamp-ref')?.value || 'N° 1428 / REG / 2026';
    const stampDataUrl = StampRenderer.renderStamp(stampKey, { wilaya, ref });

    const img = await PDFEngine.loadImage(stampDataUrl);
    if (!page.annotations) page.annotations = [];

    const stamp = ALGERIAN_STAMPS[stampKey];
    const isRound = stamp?.type === 'circular';
    const isOval = stamp?.type === 'oval';

    const normW = isRound ? 0.22 : (isOval ? 0.26 : 0.28);
    const normH = isRound ? 0.16 : (isOval ? 0.13 : 0.09);

    let normY = 0.50;
    if (this.viewport && this.paperWrapper) {
      const wrapRect = this.paperWrapper.getBoundingClientRect();
      const vpRect = this.viewport.getBoundingClientRect();
      const visibleCenterY = (vpRect.top + vpRect.bottom) / 2;
      const relY = (visibleCenterY - wrapRect.top) / wrapRect.height;
      normY = Math.max(0.08, Math.min(0.85, relY - normH / 2));
    }
    const normX = 0.55;

    page.annotations.push({
      type: 'image',
      imageElement: img,
      title: stamp?.titleAr || 'ختم رسمي',
      x: normX,
      y: normY,
      w: normW,
      h: normH,
      timestamp: Date.now()
    });

    this.renderCurrentPage();
    this.renderSidebarComments();
    this.renderSidebarThumbnails();
    this.showToast(`تم تطبيق ختم: ${stamp?.titleAr}`);
  }

  /* ---------------- DIGITAL SIGNATURE SUITE ---------------- */

  openSignatureModal() {
    document.getElementById('modal-signature')?.classList.add('open');
    setTimeout(() => {
      if (this.sigPad) this.sigPad.redraw();
    }, 150);
  }

  async applySignatureToActivePage() {
    if (!this.sigPad || this.sigPad.isEmpty()) {
      this.showToast('Please sign on the pad first');
      return;
    }

    const page = this.pages[this.currentPageIndex];
    if (!page) return;

    const name = document.getElementById('sig-input-name')?.value.trim() || 'Mohamed BENALI';
    const role = document.getElementById('sig-input-role')?.value.trim() || 'Directeur Général';
    const location = document.getElementById('sig-input-loc')?.value.trim() || 'Alger (الجزائر)';
    const sigStyle = document.getElementById('sig-select-badge')?.value || 'badge';

    const sigDataUrl = sigStyle === 'badge'
      ? this.sigPad.toSignatureBadge({ name, role, location })
      : this.sigPad.toRawSignatureDataURL();

    const img = await PDFEngine.loadImage(sigDataUrl);
    if (!page.annotations) page.annotations = [];

    const normW = sigStyle === 'badge' ? 0.34 : 0.24;
    const normH = sigStyle === 'badge' ? 0.13 : 0.08;

    let normY = 0.50;
    if (this.viewport && this.paperWrapper) {
      const wrapRect = this.paperWrapper.getBoundingClientRect();
      const vpRect = this.viewport.getBoundingClientRect();
      const visibleCenterY = (vpRect.top + vpRect.bottom) / 2;
      const relY = (visibleCenterY - wrapRect.top) / wrapRect.height;
      normY = Math.max(0.08, Math.min(0.85, relY - normH / 2));
    }
    const normX = 0.15;

    page.annotations.push({
      type: 'image',
      imageElement: img,
      title: `توقيع: ${name}`,
      x: normX,
      y: normY,
      w: normW,
      h: normH,
      timestamp: Date.now()
    });

    this.renderCurrentPage();
    this.renderSidebarComments();
    this.renderSidebarThumbnails();
    document.getElementById('modal-signature')?.classList.remove('open');
    this.showToast('تم تثبيت التوقيع الرقمي بنجاح');
  }

  /* ---------------- TEMPLATES LIBRARY MODALS ---------------- */

  initTemplatesModals() {
    const list = AlgerianTemplates.getTemplatesList();

    // 1. Sidebar Templates List
    const sideListEl = document.getElementById('templates-sidebar-list');
    if (sideListEl) {
      sideListEl.innerHTML = list
        .map(
          (t) => `
            <div class="template-side-card" data-tid="${t.id}">
              <span class="template-side-title">${t.titleAr}</span>
              <span class="template-side-desc">${t.descAr}</span>
            </div>
          `
        )
        .join('');

      sideListEl.querySelectorAll('.template-side-card').forEach((card) => {
        card.onclick = () => {
          const tid = card.getAttribute('data-tid');
          this.loadTemplate(tid);
        };
      });
    }

    // 2. Templates Modal Grid
    const modalGridEl = document.getElementById('templates-modal-grid');
    if (modalGridEl) {
      modalGridEl.innerHTML = list
        .map(
          (t) => `
            <div class="template-card-modal" data-tid="${t.id}">
              <div class="template-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              </div>
              <span class="template-card-title">${t.titleAr}</span>
              <span class="template-card-desc">${t.descAr}</span>
            </div>
          `
        )
        .join('');

      modalGridEl.querySelectorAll('.template-card-modal').forEach((card) => {
        card.onclick = () => {
          const tid = card.getAttribute('data-tid');
          this.loadTemplate(tid);
          document.getElementById('modal-templates-lib')?.classList.remove('open');
        };
      });
    }
  }

  openTemplatesModal() {
    document.getElementById('modal-templates-lib')?.classList.add('open');
  }

  openWatermarkModal() {
    const input = document.getElementById('input-modal-watermark');
    if (input) input.value = this.watermarkText;
    const headerInput = document.getElementById('input-doc-header');
    if (headerInput) headerInput.value = this.headerText;
    const footerInput = document.getElementById('input-doc-footer');
    if (footerInput) footerInput.value = this.footerText;
    document.getElementById('modal-watermark')?.classList.add('open');
  }

  openSplitModal() {
    const totalEl = document.getElementById('split-doc-total-pages');
    if (totalEl) totalEl.textContent = String(this.pages.length);
    document.getElementById('modal-split')?.classList.add('open');
  }

  openMergeModal() {
    document.getElementById('modal-merge')?.classList.add('open');
  }

  /* ---------------- SIDEBAR DOCK CONTENT ---------------- */

  renderSidebarThumbnails() {
    const strip = document.getElementById('thumbs-strip');
    if (!strip) return;

    strip.innerHTML = this.pages
      .map((p, idx) => {
        const isActive = idx === this.currentPageIndex;
        const rot = p.rotation || 0;
        return `
          <div class="thumb-card ${isActive ? 'active' : ''}" data-index="${idx}">
            <div class="thumb-img-box">
              <img src="${p.dataUrl}" style="transform: rotate(${rot}deg);" alt="Page ${idx + 1}">
            </div>
            <span class="thumb-label">${idx + 1}</span>
          </div>
        `;
      })
      .join('');

    strip.querySelectorAll('.thumb-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.getAttribute('data-index'));
        this.goToPage(idx);
      });
    });
  }

  renderSidebarComments() {
    const list = document.getElementById('comments-list');
    const badge = document.getElementById('comments-count');
    if (!list) return;

    let totalCount = 0;
    const items = [];

    this.pages.forEach((page, pIdx) => {
      if (Array.isArray(page.annotations)) {
        page.annotations.forEach((ann, aIdx) => {
          totalCount++;
          let title = '';

          if (ann.type === 'pen') {
            title = 'رسم خطي بقلم التوقيع';
          } else if (ann.type === 'highlighter') {
            title = 'تظليل ملون للنصوص';
          } else if (ann.type === 'redaction') {
            title = 'حجب أمني أسود (Redaction)';
          } else if (ann.type === 'text') {
            title = `نص: "${ann.text.substring(0, 20)}..."`;
          } else if (ann.type === 'note') {
            title = `ملاحظة: "${ann.note.substring(0, 20)}..."`;
          } else if (ann.type === 'image') {
            title = ann.title || 'ختم / توقيع معتمد';
          } else if (ann.type === 'measure') {
            title = `قياس مخطط: ${ann.distStr}`;
          }

          items.push(`
            <div class="comment-card" data-page="${pIdx}">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:var(--text-primary); font-size:11px;">صفحة ${pIdx + 1}</strong>
                <span style="font-size:10px; color:var(--text-muted);">${new Date(ann.timestamp || Date.now()).toLocaleTimeString()}</span>
              </div>
              <span style="color:var(--text-secondary);">${title}</span>
            </div>
          `);
        });
      }
    });

    if (badge) badge.textContent = String(totalCount);
    list.innerHTML = items.length > 0
      ? items.join('')
      : `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">لا توجد تعليقات أو أختام بعد</div>`;

    list.querySelectorAll('.comment-card').forEach((card) => {
      card.addEventListener('click', () => {
        const pageIdx = parseInt(card.getAttribute('data-page'));
        this.goToPage(pageIdx);
      });
    });
  }

  /* ---------------- ORGANIZE PAGES GRID ---------------- */

  renderOrganizerGrid() {
    const grid = document.getElementById('organizer-grid');
    if (!grid) return;

    grid.innerHTML = this.pages
      .map((p, idx) => {
        const rot = p.rotation || 0;
        const isActive = idx === this.currentPageIndex;
        return `
          <div class="organizer-card ${isActive ? 'active' : ''}" draggable="true" data-index="${idx}">
            <div class="organizer-preview">
              <img src="${p.dataUrl}" style="transform: rotate(${rot}deg);" alt="Page ${idx + 1}">
            </div>
            <div class="organizer-card-actions">
              <span style="font-size:12px; font-weight:700;">${idx + 1}</span>
              <div style="display:flex; gap:3px;">
                <button class="btn-card-action btn-org-left" data-index="${idx}" title="Move Earlier" ${idx === 0 ? 'disabled' : ''}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <button class="btn-card-action btn-org-right" data-index="${idx}" title="Move Later" ${idx === this.pages.length - 1 ? 'disabled' : ''}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <button class="btn-card-action btn-org-rotate" data-index="${idx}" title="Rotate 90°">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                </button>
                <button class="btn-card-action btn-org-dup" data-index="${idx}" title="Duplicate">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <button class="btn-card-action danger btn-org-del" data-index="${idx}" title="Delete">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // Click on organizer card to open in editor
    grid.querySelectorAll('.organizer-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-card-action')) return;
        const idx = parseInt(card.getAttribute('data-index'));
        this.goToPage(idx);
        this.setViewMode('editor');
      });

      // Drag and Drop reordering
      card.addEventListener('dragstart', (e) => {
        this.draggedCardIndex = parseInt(card.getAttribute('data-index'));
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.5';
      });

      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
        grid.querySelectorAll('.organizer-card').forEach((c) => c.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const targetIdx = parseInt(card.getAttribute('data-index'));
        if (this.draggedCardIndex !== null && this.draggedCardIndex !== targetIdx) {
          const [moved] = this.pages.splice(this.draggedCardIndex, 1);
          this.pages.splice(targetIdx, 0, moved);
          this.currentPageIndex = targetIdx;
          this.updateDocumentState();
          this.renderOrganizerGrid();
          this.showToast('Page reordered');
        }
      });
    });

    // Action buttons on cards
    grid.querySelectorAll('.btn-org-left').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'));
        if (idx > 0) {
          const temp = this.pages[idx];
          this.pages[idx] = this.pages[idx - 1];
          this.pages[idx - 1] = temp;
          this.renderOrganizerGrid();
          this.renderSidebarThumbnails();
        }
      });
    });

    grid.querySelectorAll('.btn-org-right').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'));
        if (idx < this.pages.length - 1) {
          const temp = this.pages[idx];
          this.pages[idx] = this.pages[idx + 1];
          this.pages[idx + 1] = temp;
          this.renderOrganizerGrid();
          this.renderSidebarThumbnails();
        }
      });
    });

    grid.querySelectorAll('.btn-org-rotate').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'));
        this.pages[idx].rotation = ((this.pages[idx].rotation || 0) + 90) % 360;
        this.renderOrganizerGrid();
        this.renderSidebarThumbnails();
      });
    });

    grid.querySelectorAll('.btn-org-dup').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'));
        const orig = this.pages[idx];
        const clone = {
          ...orig,
          id: 'p_dup_' + Date.now(),
          annotations: JSON.parse(JSON.stringify(orig.annotations || []))
        };
        this.pages.splice(idx + 1, 0, clone);
        this.updateDocumentState();
        this.renderOrganizerGrid();
      });
    });

    grid.querySelectorAll('.btn-org-del').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'));
        this.pages.splice(idx, 1);
        this.updateDocumentState();
        this.renderOrganizerGrid();
      });
    });
  }

  /* ---------------- SPLIT & EXTRACT ---------------- */

  async executeSplit() {
    const rangeStr = document.getElementById('input-split-range')?.value.trim();
    if (!rangeStr) {
      this.showToast('Please specify a page range (e.g. 1-2 or 1,3)');
      return;
    }

    const indicesToExtract = new Set();
    const parts = rangeStr.split(',');

    for (const part of parts) {
      const p = part.trim();
      if (p.includes('-')) {
        const [start, end] = p.split('-').map((n) => parseInt(n.trim()));
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            if (i >= 1 && i <= this.pages.length) indicesToExtract.add(i - 1);
          }
        }
      } else {
        const num = parseInt(p);
        if (!isNaN(num) && num >= 1 && num <= this.pages.length) {
          indicesToExtract.add(num - 1);
        }
      }
    }

    if (indicesToExtract.size === 0) {
      this.showToast('No valid pages found in range');
      return;
    }

    const selectedPages = Array.from(indicesToExtract)
      .sort((a, b) => a - b)
      .map((idx) => this.pages[idx]);

    this.showToast(`Extracting ${selectedPages.length} pages to new PDF...`);

    try {
      const pdfBytes = await PDFEngine.compileDocument(selectedPages, {
        pageSize: PAGE_SIZES.A4_PORTRAIT,
        watermarkText: this.watermarkText,
        watermarkOpacity: this.watermarkOpacity,
        includePageNumbers: this.includePageNumbers,
        headerText: this.headerText,
        footerText: this.footerText
      });

      PDFEngine.downloadPDF(pdfBytes, `extracted_pages_${rangeStr.replace(/[^0-9-]/g, '_')}.pdf`);
      document.getElementById('modal-split')?.classList.remove('open');
      this.showToast('Extracted PDF downloaded!');
    } catch (err) {
      console.error('[DZ-PDF] Split error:', err);
      this.showToast('Failed to extract pages');
    }
  }

  /* ---------------- EXPORT & PRINT ---------------- */

  async exportCompiledPDF() {
    if (this.pages.length === 0) {
      this.showToast('Please open or add at least one page');
      return;
    }

    this.showToast('Compiling PDF 1.7 document with stamps and signatures...');

    try {
      const pdfBytes = await PDFEngine.compileDocument(this.pages, {
        pageSize: PAGE_SIZES.A4_PORTRAIT,
        watermarkText: this.watermarkText,
        watermarkOpacity: this.watermarkOpacity,
        watermarkAngle: this.watermarkAngle,
        includePageNumbers: this.includePageNumbers,
        headerText: this.headerText,
        footerText: this.footerText
      });

      PDFEngine.downloadPDF(pdfBytes, 'document_officiel_dz.pdf');
      this.showToast('PDF compiled & downloaded successfully!');
    } catch (err) {
      console.error('[DZ-PDF] Export error:', err);
      this.showToast('Failed to compile PDF document');
    }
  }

  exportCurrentPageImage() {
    const page = this.pages[this.currentPageIndex];
    if (!page || !this.baseCanvas) return;

    const link = document.createElement('a');
    link.download = `page_${this.currentPageIndex + 1}_hd.jpg`;
    link.href = this.baseCanvas.toDataURL('image/jpeg', 0.95);
    link.click();
    this.showToast('Page exported as HD image');
  }

  printDocument() {
    if (this.pages.length === 0) return;
    window.print();
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.dzPdf = new DZPdfProApp();
});
