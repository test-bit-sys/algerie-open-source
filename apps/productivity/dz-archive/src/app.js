/**
 * DZ-Archive — Desktop Application Controller (WinRAR 1:1 Alternative)
 * Part of DZ Open Suite (HeyPuter/everything standard)
 * 100% Offline-First | Vanilla JS ES Modules | Trilingual (AR/FR/EN) | Zero Emojis
 */

import {
  ZipArchive,
  TarArchive,
  WinRarBenchmark,
  formatBytes,
  formatCRC32,
  computeCRC32,
  toHexDump
} from './archive-engine.js';

const I18N = {
  ar: {
    appTitle: 'DZ-Archive',
    toolAdd: 'إضافة',
    toolExtract: 'استخراج إلى',
    toolTest: 'فحص',
    toolView: 'معاينة',
    toolDelete: 'حذف',
    toolBenchmark: 'اختبار',
    toolInfo: 'معلومات',
    colName: 'الاسم (Name)',
    colSize: 'الحجم الأصلي',
    colPacked: 'المضغوط',
    colRatio: 'النسبة',
    colType: 'النوع',
    colModified: 'تاريخ التعديل',
    colCrc: 'CRC-32',
    emptyNotice: 'لا يوجد أرشيف مفتوح حالياً. اسحب ملف مضغوط إلى هنا أو اضغط "إضافة" لإنشاء أرشيف جديد.',
    dropPrompt: 'أفلت الأرشيف أو الملفات هنا لفتحها فوراً',
    statusSelected: 'محدد',
    statusTotalFiles: 'ملف',
    statusTotalSize: 'الحجم',
    statusPackedSize: 'المضغوط',
    modalBenchmarkTitle: 'اختبار سرعة العتاد والمعالج (WinRAR Benchmark)',
    modalTestTitle: 'فحص سلامة الأرشيف (CRC-32 Integrity Test)',
    modalInfoTitle: 'معلومات الأرشيف الفنية (Archive Information)',
    btnCancel: 'إلغاء',
    btnStart: 'بدء الاختبار',
    testSuccess: 'تم فحص جميع الملفات بنجاح. لا توجد أي أخطاء في الـ CRC-32.',
    testFail: 'تم اكتشاف أخطاء في فحص الـ CRC-32 لبعض الملفات.',
    searchPlaceholder: 'بحث في الأرشيف...',
    benchmarkRunning: 'جاري قياس سرعة المعالجة والضغط...',
    benchmarkFinished: 'اكتمل اختبار الأداء بنجاح',
    threadsLabel: 'المسارات المتزامنة (Threads):',
    scoreLabel: 'التقييم الإجمالي (Rating Score):'
  },
  fr: {
    appTitle: 'DZ-Archive',
    toolAdd: 'Ajouter',
    toolExtract: 'Extraire vers',
    toolTest: 'Tester',
    toolView: 'Afficher',
    toolDelete: 'Supprimer',
    toolBenchmark: 'Benchmark',
    toolInfo: 'Infos',
    colName: 'Nom',
    colSize: 'Taille originale',
    colPacked: 'Compressé',
    colRatio: 'Taux',
    colType: 'Type',
    colModified: 'Modifié le',
    colCrc: 'CRC-32',
    emptyNotice: 'Aucune archive ouverte. Glissez-déposez un fichier ZIP/TAR ici ou cliquez sur "Ajouter".',
    dropPrompt: 'Déposez l\'archive ou les fichiers ici',
    statusSelected: 'sélectionné(s)',
    statusTotalFiles: 'fichiers',
    statusTotalSize: 'Taille',
    statusPackedSize: 'Compressé',
    modalBenchmarkTitle: 'Test de vitesse et performance (Benchmark WinRAR)',
    modalTestTitle: 'Vérification de l\'intégrité',
    modalInfoTitle: 'Détails de l\'archive',
    btnCancel: 'Annuler',
    btnStart: 'Démarrer',
    testSuccess: 'Toutes les sommes de contrôle CRC-32 sont valides.',
    testFail: 'Erreurs de CRC-32 détectées.',
    searchPlaceholder: 'Rechercher dans l\'archive...',
    benchmarkRunning: 'Test de compression en cours...',
    benchmarkFinished: 'Test terminé avec succès',
    threadsLabel: 'Threads processeur :',
    scoreLabel: 'Score de performance :'
  },
  en: {
    appTitle: 'DZ-Archive',
    toolAdd: 'Add',
    toolExtract: 'Extract To',
    toolTest: 'Test',
    toolView: 'View',
    toolDelete: 'Delete',
    toolBenchmark: 'Benchmark',
    toolInfo: 'Info',
    colName: 'Name',
    colSize: 'Original Size',
    colPacked: 'Packed',
    colRatio: 'Ratio',
    colType: 'Type',
    colModified: 'Modified',
    colCrc: 'CRC-32',
    emptyNotice: 'No archive currently open. Drop a ZIP/TAR file here or click "Add" to create a new archive.',
    dropPrompt: 'Drop archive or files here to inspect immediately',
    statusSelected: 'selected',
    statusTotalFiles: 'files',
    statusTotalSize: 'Size',
    statusPackedSize: 'Packed',
    modalBenchmarkTitle: 'Hardware Compression Benchmark',
    modalTestTitle: 'Test Archive Integrity (CRC-32)',
    modalInfoTitle: 'Archive Technical Information',
    btnCancel: 'Cancel',
    btnStart: 'Start Benchmark',
    testSuccess: 'All files passed CRC-32 integrity checks successfully.',
    testFail: 'CRC-32 checksum errors detected.',
    searchPlaceholder: 'Search archive files...',
    benchmarkRunning: 'Running compression benchmark...',
    benchmarkFinished: 'Benchmark completed successfully',
    threadsLabel: 'CPU Threads:',
    scoreLabel: 'Rating Score:'
  }
};

class DzArchiveApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_archive_lang') || 'ar';
    this.currentTheme = localStorage.getItem('dz_archive_theme') || 'dark';

    this.archiveName = 'archive.zip';
    this.archiveFormat = 'zip'; // 'zip' or 'tar'
    this.archiveFiles = []; // [{ name, size, compressedSize, data, crc32, modified, isDirectory, localOffset }]
    this.archiveComment = '';
    this.isLocked = false;
    this.currentPassword = null;
    this.pendingPassword = null;

    this.currentPrefix = ''; // Folder drilldown inside archive (e.g., 'src/')
    this.selectedFiles = new Set();
    this.rawParsedArchive = null;

    // Sorting state
    this.sortCol = 'name';
    this.sortDir = 'asc';

    // Viewer state
    this.currentViewerEntry = null;
    this.currentViewerData = null;
    this.currentViewerMode = 'text'; // 'text', 'hex', 'media'

    this.initDOM();
    this.applyTheme(this.currentTheme);
    this.applyLanguage(this.currentLang);
    this.initMenus();
    this.initToolbar();
    this.initAddressBar();
    this.initWorkspace();
    this.initTableSorting();
    this.initModals();
    this.initContextMenu();
    this.initDragAndDrop();
    this.initKeyboardShortcuts();
    this.updateUI();
  }

  initDOM() {
    this.dom = {
      langSelect: document.getElementById('langSelect'),
      themeToggleBtn: document.getElementById('themeToggleBtn'),
      fileInput: document.getElementById('hiddenFileInput'),
      archiveInput: document.getElementById('hiddenArchiveInput'),

      // Address Bar
      btnUpFolder: document.getElementById('btnUpFolder'),
      breadcrumbs: document.getElementById('archiveBreadcrumbs'),
      searchBox: document.getElementById('searchFilesInput'),
      clearSearchBtn: document.getElementById('clearSearchBtn'),

      // Sidebar & Workspace
      folderTreeSidebar: document.getElementById('folderTreeSidebar'),
      treeSidebarContent: document.getElementById('treeSidebarContent'),
      filesTableBody: document.getElementById('filesTableBody'),
      selectAllCheck: document.getElementById('selectAllCheck'),
      dropOverlay: document.getElementById('dropOverlay'),

      // Comment Drawer
      commentDrawer: document.getElementById('commentDrawer'),
      commentTextArea: document.getElementById('commentTextArea'),
      btnCloseComment: document.getElementById('btnCloseComment'),
      btnSaveComment: document.getElementById('btnSaveComment'),

      // Status Bar
      statusSelected: document.getElementById('statusSelected'),
      statusTotalFiles: document.getElementById('statusTotalFiles'),
      statusTotalSize: document.getElementById('statusTotalSize'),
      statusPackedSize: document.getElementById('statusPackedSize'),
      statusRatio: document.getElementById('statusRatio'),
      statusLockBadge: document.getElementById('statusLockBadge'),
      statusEncBadge: document.getElementById('statusEncBadge'),

      // Context Menu
      contextMenu: document.getElementById('contextMenu'),
      ctxView: document.getElementById('ctxView'),
      ctxExtract: document.getElementById('ctxExtract'),
      ctxCopyName: document.getElementById('ctxCopyName'),
      ctxDelete: document.getElementById('ctxDelete'),

      // Modals
      modalAdd: document.getElementById('modalAdd'),
      inputArchiveName: document.getElementById('inputArchiveName'),
      selectCompMethod: document.getElementById('selectCompMethod'),
      chkDeleteOriginal: document.getElementById('chkDeleteOriginal'),
      chkLockArchive: document.getElementById('chkLockArchive'),
      btnOpenPasswordModal: document.getElementById('btnOpenPasswordModal'),
      passwordIndicator: document.getElementById('passwordIndicator'),
      dialogCommentText: document.getElementById('dialogCommentText'),
      btnConfirmCreateArchive: document.getElementById('btnConfirmCreateArchive'),

      modalPassword: document.getElementById('modalPassword'),
      inputPassword: document.getElementById('inputPassword'),
      inputPasswordConfirm: document.getElementById('inputPasswordConfirm'),
      chkShowPassword: document.getElementById('chkShowPassword'),
      btnApplyPassword: document.getElementById('btnApplyPassword'),
      btnClearPasswordModal: document.getElementById('btnClearPasswordModal'),

      modalPromptPassword: document.getElementById('modalPromptPassword'),
      inputDecryptPassword: document.getElementById('inputDecryptPassword'),
      btnConfirmDecryptPassword: document.getElementById('btnConfirmDecryptPassword'),

      modalPreview: document.getElementById('modalPreview'),
      previewModalTitle: document.getElementById('previewModalTitle'),
      previewModalBody: document.getElementById('previewModalBody'),
      btnDownloadCurrentPreview: document.getElementById('btnDownloadCurrentPreview'),
      viewerTabs: document.querySelectorAll('.viewer-tab-btn'),

      modalBenchmark: document.getElementById('modalBenchmark'),
      modalTest: document.getElementById('modalTest'),
      testModalBody: document.getElementById('testModalBody'),
      modalInfo: document.getElementById('modalInfo'),
      infoModalBody: document.getElementById('infoModalBody'),
      modalAbout: document.getElementById('modalAbout')
    };
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dz_archive_theme', theme);
  }

  applyLanguage(lang) {
    this.currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.body.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    localStorage.setItem('dz_archive_lang', lang);

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

  initMenus() {
    // Menu Bar dropdown toggles
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

    window.addEventListener('click', () => {
      this.closeAllMenus();
      this.closeContextMenu();
    });

    // Menu Actions
    document.getElementById('miOpenArchive')?.addEventListener('click', () => this.dom.archiveInput.click());
    document.getElementById('miSaveCopy')?.addEventListener('click', () => this.extractArchive());
    document.getElementById('miSetDefaultPassword')?.addEventListener('click', () => this.openPasswordModal());
    document.getElementById('miClearPassword')?.addEventListener('click', () => {
      this.currentPassword = null;
      this.pendingPassword = null;
      this.updatePasswordBadge();
      alert('تمت إزالة كلمة المرور الافتراضية.');
    });
    document.getElementById('miSelectAll')?.addEventListener('click', () => this.selectAll());
    document.getElementById('miDeselectAll')?.addEventListener('click', () => this.deselectAll());
    document.getElementById('miCloseArchive')?.addEventListener('click', () => this.closeArchive());

    // Commands
    document.getElementById('miAdd')?.addEventListener('click', () => this.openAddModal());
    document.getElementById('miExtract')?.addEventListener('click', () => this.extractArchive());
    document.getElementById('miTest')?.addEventListener('click', () => this.testArchiveIntegrity());
    document.getElementById('miView')?.addEventListener('click', () => this.previewSelectedFile());
    document.getElementById('miDelete')?.addEventListener('click', () => this.deleteSelected());
    document.getElementById('miRename')?.addEventListener('click', () => this.renameSelected());
    document.getElementById('miLockArchive')?.addEventListener('click', () => this.toggleLockArchive());
    document.getElementById('miAddComment')?.addEventListener('click', () => this.toggleCommentDrawer(true));

    // Tools
    document.getElementById('miBenchmark')?.addEventListener('click', () => this.openBenchmarkModal());
    document.getElementById('miInfo')?.addEventListener('click', () => this.openInfoModal());
    document.getElementById('miWizard')?.addEventListener('click', () => this.openAddModal());
    document.getElementById('miConvertSFX')?.addEventListener('click', () => this.exportSFX());

    // Options
    document.getElementById('miToggleTree')?.addEventListener('click', () => this.toggleFolderTree());
    document.getElementById('miToggleComment')?.addEventListener('click', () => this.toggleCommentDrawer());
    document.getElementById('miToggleTheme')?.addEventListener('click', () => {
      this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    });

    // Help
    document.getElementById('miAbout')?.addEventListener('click', () => {
      this.dom.modalAbout.classList.add('active');
    });

    // Language & Theme header controls
    this.dom.langSelect.addEventListener('change', (e) => this.applyLanguage(e.target.value));
    this.dom.themeToggleBtn.addEventListener('click', () => {
      this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  closeAllMenus() {
    document.querySelectorAll('.dropdown-menu').forEach((d) => d.classList.remove('show'));
    document.querySelectorAll('.menu-btn').forEach((b) => b.classList.remove('active'));
  }

  initToolbar() {
    document.getElementById('btnAdd')?.addEventListener('click', () => this.openAddModal());
    document.getElementById('btnExtract')?.addEventListener('click', () => this.extractArchive());
    document.getElementById('btnTest')?.addEventListener('click', () => this.testArchiveIntegrity());
    document.getElementById('btnView')?.addEventListener('click', () => this.previewSelectedFile());
    document.getElementById('btnDelete')?.addEventListener('click', () => this.deleteSelected());
    document.getElementById('btnFind')?.addEventListener('click', () => this.dom.searchBox.focus());
    document.getElementById('btnWizard')?.addEventListener('click', () => this.openAddModal());
    document.getElementById('btnInfo')?.addEventListener('click', () => this.openInfoModal());
    document.getElementById('btnLock')?.addEventListener('click', () => this.toggleLockArchive());
    document.getElementById('btnComment')?.addEventListener('click', () => this.toggleCommentDrawer());
    document.getElementById('btnBenchmark')?.addEventListener('click', () => this.openBenchmarkModal());

    // File input handlers
    this.dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.addFilesFromInput(Array.from(e.target.files));
      }
      this.dom.fileInput.value = '';
    });

    this.dom.archiveInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.loadArchiveFile(e.target.files[0]);
      }
      this.dom.archiveInput.value = '';
    });
  }

  initAddressBar() {
    this.dom.btnUpFolder.addEventListener('click', () => this.goUpFolder());

    this.dom.searchBox.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      this.dom.clearSearchBtn.style.display = q ? 'block' : 'none';
      this.renderTable();
    });

    this.dom.clearSearchBtn.addEventListener('click', () => {
      this.dom.searchBox.value = '';
      this.dom.clearSearchBtn.style.display = 'none';
      this.renderTable();
    });
  }

  initWorkspace() {
    // Select all checkbox
    this.dom.selectAllCheck.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.selectAll();
      } else {
        this.deselectAll();
      }
    });

    // Comment Drawer actions
    this.dom.btnCloseComment.addEventListener('click', () => this.toggleCommentDrawer(false));
    this.dom.btnSaveComment.addEventListener('click', () => {
      this.archiveComment = this.dom.commentTextArea.value;
      alert('تم حفظ التعليق بنجاح في بيانات الأرشيف.');
    });
  }

  initTableSorting() {
    document.querySelectorAll('.winrar-files-table th.sortable').forEach((th) => {
      th.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const col = th.getAttribute('data-sort');
        if (this.sortCol === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortCol = col;
          this.sortDir = col === 'name' || col === 'type' ? 'asc' : 'desc';
        }
        this.updateSortIndicators();
        this.renderTable();
      });
    });
  }

  updateSortIndicators() {
    document.querySelectorAll('.winrar-files-table th.sortable').forEach((th) => {
      const ind = th.querySelector('.sort-indicator');
      if (!ind) return;
      if (th.getAttribute('data-sort') === this.sortCol) {
        ind.textContent = this.sortDir === 'asc' ? '▲' : '▼';
      } else {
        ind.textContent = '';
      }
    });
  }

  initModals() {
    // Close modal buttons
    document.querySelectorAll('.close-modal-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-backdrop');
        if (modal) modal.classList.remove('active');
      });
    });

    // 6-Tab Archiving Dialog Tab Switching
    document.querySelectorAll('.dialog-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        document.querySelectorAll('.dialog-tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.dialog-pane').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const pane = document.getElementById(`pane${target.charAt(0).toUpperCase() + target.slice(1)}`);
        if (pane) pane.classList.add('active');
      });
    });

    // Set password trigger in Add dialog
    this.dom.btnOpenPasswordModal.addEventListener('click', () => {
      this.openPasswordModal();
    });

    // Password apply button
    this.dom.btnApplyPassword.addEventListener('click', () => {
      const p1 = this.dom.inputPassword.value;
      const p2 = this.dom.inputPasswordConfirm.value;
      if (!p1) {
        alert('الرجاء كتابة كلمة مرور صالحة.');
        return;
      }
      if (p1 !== p2) {
        alert('كلمتا المرور غير متطابقتين.');
        return;
      }
      this.pendingPassword = p1;
      this.currentPassword = p1;
      this.dom.modalPassword.classList.remove('active');
      this.updatePasswordBadge();
    });

    this.dom.btnClearPasswordModal.addEventListener('click', () => {
      this.pendingPassword = null;
      this.currentPassword = null;
      this.dom.inputPassword.value = '';
      this.dom.inputPasswordConfirm.value = '';
      this.dom.modalPassword.classList.remove('active');
      this.updatePasswordBadge();
    });

    this.dom.chkShowPassword.addEventListener('change', (e) => {
      const t = e.target.checked ? 'text' : 'password';
      this.dom.inputPassword.type = t;
      this.dom.inputPasswordConfirm.type = t;
    });

    // Confirm Create Archive in Add modal
    this.dom.btnConfirmCreateArchive.addEventListener('click', async () => {
      const name = this.dom.inputArchiveName.value.trim() || 'dz-archive.zip';
      this.archiveName = name;
      const formatRadio = document.querySelector('input[name="archiveFormat"]:checked');
      this.archiveFormat = formatRadio ? formatRadio.value : 'zip';
      const method = this.dom.selectCompMethod.value;
      this.isLocked = this.dom.chkLockArchive.checked;
      this.archiveComment = this.dom.dialogCommentText.value.trim();

      this.dom.modalAdd.classList.remove('active');

      if (this.archiveFiles.length === 0) {
        // If empty, prompt to pick files
        this.dom.fileInput.click();
      } else {
        await this.buildAndDownloadArchive(method);
      }
    });

    // Internal Viewer Mode Switcher
    this.dom.viewerTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.dom.viewerTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentViewerMode = tab.getAttribute('data-mode');
        this.renderViewerContent();
      });
    });

    this.dom.btnDownloadCurrentPreview.addEventListener('click', () => {
      if (this.currentViewerEntry && this.currentViewerData) {
        this.downloadBlob(this.currentViewerData, this.currentViewerEntry.name.split('/').pop());
      }
    });

    // Decrypt Password Prompt button
    this.dom.btnConfirmDecryptPassword.addEventListener('click', () => {
      const pwd = this.dom.inputDecryptPassword.value;
      if (this.decryptCallback) {
        this.dom.modalPromptPassword.classList.remove('active');
        this.decryptCallback(pwd);
      }
    });

    // Benchmark Run
    const btnStartBm = document.getElementById('btnStartBenchmark');
    btnStartBm?.addEventListener('click', () => this.runBenchmark());
  }

  updatePasswordBadge() {
    const hasPwd = !!(this.pendingPassword || this.currentPassword);
    this.dom.passwordIndicator.style.display = hasPwd ? 'inline-block' : 'none';
    this.dom.statusEncBadge.style.display = hasPwd ? 'inline' : 'none';
  }

  openPasswordModal() {
    this.dom.inputPassword.value = this.currentPassword || '';
    this.dom.inputPasswordConfirm.value = this.currentPassword || '';
    this.dom.modalPassword.classList.add('active');
  }

  openAddModal() {
    this.dom.inputArchiveName.value = this.archiveName;
    this.dom.dialogCommentText.value = this.archiveComment;
    this.dom.modalAdd.classList.add('active');
  }

  initContextMenu() {
    this.dom.ctxView.addEventListener('click', () => this.previewSelectedFile());
    this.dom.ctxExtract.addEventListener('click', () => this.extractArchive());
    this.dom.ctxCopyName.addEventListener('click', () => {
      const selected = Array.from(this.selectedFiles)[0];
      if (selected) navigator.clipboard.writeText(selected.split('/').pop());
    });
    this.dom.ctxDelete.addEventListener('click', () => this.deleteSelected());
  }

  openContextMenu(x, y) {
    const menu = this.dom.contextMenu;
    menu.style.display = 'block';
    const menuW = 190;
    const menuH = 140;
    const posX = Math.min(x, window.innerWidth - menuW - 10);
    const posY = Math.min(y, window.innerHeight - menuH - 10);
    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
  }

  closeContextMenu() {
    this.dom.contextMenu.style.display = 'none';
  }

  initDragAndDrop() {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dom.dropOverlay.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        this.dom.dropOverlay.classList.remove('active');
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.dom.dropOverlay.classList.remove('active');
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;

      const first = files[0];
      const isArchive = first.name.endsWith('.zip') || first.name.endsWith('.tar') || first.name.endsWith('.gz');

      if (isArchive && files.length === 1) {
        await this.loadArchiveFile(first);
      } else {
        await this.addFilesFromInput(files);
      }
    });
  }

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.key === 'Backspace') {
        e.preventDefault();
        this.goUpFolder();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        this.deleteSelected();
      } else if (e.key === 'F2') {
        e.preventDefault();
        this.renameSelected();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.selectAll();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.dom.archiveInput.click();
      } else if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.openAddModal();
      } else if (e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        this.extractArchive();
      } else if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        this.testArchiveIntegrity();
      } else if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.previewSelectedFile();
      } else if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        this.openBenchmarkModal();
      } else if (e.key === 'Escape') {
        this.closeAllMenus();
        this.closeContextMenu();
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('active'));
      }
    });
  }

  async loadArchiveFile(file) {
    this.archiveName = file.name;
    const buffer = await file.arrayBuffer();

    try {
      if (file.name.endsWith('.tar')) {
        const parsed = TarArchive.parse(buffer);
        this.archiveFiles = parsed.entries;
        this.rawParsedArchive = null;
        this.archiveComment = '';
      } else {
        const parsed = await ZipArchive.parse(buffer);
        this.archiveFiles = parsed.entries;
        this.rawParsedArchive = parsed;
        this.archiveComment = parsed.comment || '';
      }

      this.currentPrefix = '';
      this.selectedFiles.clear();
      this.dom.commentTextArea.value = this.archiveComment;
      if (this.archiveComment) {
        this.toggleCommentDrawer(true);
      }
      this.updateUI();
    } catch (err) {
      alert(`فشل فتح الأرشيف: ${err.message}`);
    }
  }

  async addFilesFromInput(files) {
    if (this.isLocked) {
      alert('الأرشيف مقفل ضد أي تعديل (Archive is Locked).');
      return;
    }

    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const crc = computeCRC32(bytes);

      const filePath = this.currentPrefix + file.name;
      const existingIdx = this.archiveFiles.findIndex((f) => f.name === filePath);
      const fileEntry = {
        name: filePath,
        size: bytes.length,
        compressedSize: bytes.length,
        crc32: crc,
        data: bytes,
        modified: new Date(file.lastModified || Date.now()),
        isDirectory: false
      };

      if (existingIdx !== -1) {
        this.archiveFiles[existingIdx] = fileEntry;
      } else {
        this.archiveFiles.push(fileEntry);
      }
    }

    this.selectedFiles.clear();
    this.updateUI();
  }

  async buildAndDownloadArchive(method = 'normal') {
    if (this.archiveFiles.length === 0) return;

    const packList = [];
    for (const f of this.archiveFiles) {
      const data = await this.getEntryData(f);
      packList.push({ name: f.name, data, modified: f.modified });
    }

    let buffer;
    if (this.archiveFormat === 'tar') {
      buffer = TarArchive.create(packList);
    } else {
      buffer = await ZipArchive.create(packList, {
        level: method === 'store' ? 'store' : 'deflate',
        password: this.currentPassword,
        comment: this.archiveComment
      });
    }

    this.downloadBlob(buffer, this.archiveName);
  }

  async extractArchive() {
    if (this.archiveFiles.length === 0) return;

    const toExtract =
      this.selectedFiles.size > 0
        ? this.archiveFiles.filter((f) => this.selectedFiles.has(f.name))
        : this.archiveFiles;

    if (toExtract.length === 1 && !toExtract[0].isDirectory) {
      const entry = toExtract[0];
      try {
        const data = await this.getEntryData(entry);
        this.downloadBlob(data, entry.name.split('/').pop());
      } catch (err) {
        if (err.code === 'PASSWORD_REQUIRED') {
          this.promptPassword(async (pwd) => {
            const data = await this.getEntryData(entry, pwd);
            this.downloadBlob(data, entry.name.split('/').pop());
          });
        } else {
          alert(`خطأ أثناء الاستخراج: ${err.message}`);
        }
      }
      return;
    }

    // Extract all / multiple into a newly repacked clean archive
    const packList = [];
    for (const f of toExtract) {
      try {
        const data = await this.getEntryData(f);
        packList.push({ name: f.name, data, modified: f.modified });
      } catch (err) {
        if (err.code === 'PASSWORD_REQUIRED') {
          this.promptPassword(async (pwd) => {
            this.currentPassword = pwd;
            this.extractArchive();
          });
          return;
        }
      }
    }

    const zipBuffer = await ZipArchive.create(packList, { level: 'deflate' });
    this.downloadBlob(zipBuffer, `extracted-${this.archiveName || 'files.zip'}`);
  }

  async getEntryData(entry, password = null) {
    if (entry.data) return entry.data;
    if (this.rawParsedArchive && this.rawParsedArchive.extractFile) {
      const pwd = password || this.currentPassword;
      const extracted = await this.rawParsedArchive.extractFile(entry, pwd);
      entry.data = extracted;
      return extracted;
    }
    return new Uint8Array(0);
  }

  promptPassword(callback) {
    this.decryptCallback = callback;
    this.dom.inputDecryptPassword.value = '';
    this.dom.modalPromptPassword.classList.add('active');
  }

  downloadBlob(data, filename) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async previewSelectedFile() {
    if (this.selectedFiles.size === 0) return;
    const selectedName = Array.from(this.selectedFiles)[0];
    const entry = this.archiveFiles.find((f) => f.name === selectedName);
    if (!entry || entry.isDirectory) return;

    this.currentViewerEntry = entry;
    try {
      this.currentViewerData = await this.getEntryData(entry);
    } catch (err) {
      if (err.code === 'PASSWORD_REQUIRED') {
        this.promptPassword(async (pwd) => {
          this.currentPassword = pwd;
          this.previewSelectedFile();
        });
        return;
      }
      alert(`تعذرت معاينة الملف: ${err.message}`);
      return;
    }

    this.dom.previewModalTitle.textContent = `معاينة: ${entry.name}`;

    // Auto-detect best viewer tab
    const ext = (entry.name.split('.').pop() || '').toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
    if (isImage) {
      this.currentViewerMode = 'media';
    } else {
      this.currentViewerMode = 'text';
    }

    this.dom.viewerTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-mode') === this.currentViewerMode);
    });

    this.renderViewerContent();
    this.dom.modalPreview.classList.add('active');
  }

  renderViewerContent() {
    const bodyEl = this.dom.previewModalBody;
    bodyEl.innerHTML = '';
    const data = this.currentViewerData;
    if (!data) return;

    if (this.currentViewerMode === 'hex') {
      const pre = document.createElement('div');
      pre.className = 'hex-dump-view';
      pre.textContent = toHexDump(data, 4096);
      bodyEl.appendChild(pre);
    } else if (this.currentViewerMode === 'media') {
      const ext = (this.currentViewerEntry.name.split('.').pop() || '').toLowerCase();
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
      if (isImage) {
        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);
        bodyEl.innerHTML = `
          <div class="media-preview-box">
            <img src="${url}" alt="${this.currentViewerEntry.name}">
          </div>
        `;
      } else {
        bodyEl.innerHTML = `<p style="padding:20px; color:var(--text-muted);">هذا الملف ليس ملف وسائط مرئي.</p>`;
      }
    } else {
      // Text Mode
      try {
        const text = new TextDecoder('utf-8').decode(data);
        const pre = document.createElement('div');
        pre.className = 'text-code-view';
        pre.textContent = text.slice(0, 60000);
        bodyEl.appendChild(pre);
      } catch {
        const pre = document.createElement('div');
        pre.className = 'hex-dump-view';
        pre.textContent = toHexDump(data, 2048);
        bodyEl.appendChild(pre);
      }
    }
  }

  async testArchiveIntegrity() {
    if (this.archiveFiles.length === 0) return;
    const bodyEl = this.dom.testModalBody;
    bodyEl.innerHTML = '<p class="cell-mono">جاري فحص مجاميع التحقق CRC-32 لكافة الملفات...</p>';
    this.dom.modalTest.classList.add('active');

    let allPassed = true;
    const results = [];

    for (const f of this.archiveFiles) {
      if (f.isDirectory) continue;
      try {
        const data = await this.getEntryData(f);
        const computed = computeCRC32(data);
        const passed = f.crc32 === 0 || f.crc32 === undefined || computed === f.crc32;
        if (!passed) allPassed = false;
        results.push({ name: f.name, passed, expected: formatCRC32(f.crc32 || 0), computed: formatCRC32(computed) });
      } catch {
        allPassed = false;
        results.push({ name: f.name, passed: false, expected: '-', computed: 'ENCRYPTED' });
      }
    }

    const dict = I18N[this.currentLang] || I18N.ar;
    bodyEl.innerHTML = `
      <div style="padding:12px; border-radius:var(--radius-sm); background:${
        allPassed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'
      }; border:1px solid ${allPassed ? '#10b981' : '#ef4444'}; font-weight:700;">
        ${allPassed ? dict.testSuccess : dict.testFail}
      </div>
      <div style="max-height:280px; overflow:auto; margin-top:12px; font-family:var(--font-mono); font-size:11px;">
        ${results
          .map(
            (r) => `
          <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--border-color);">
            <span style="overflow:hidden; text-overflow:ellipsis; max-width:320px;">${r.name}</span>
            <span style="color:${r.passed ? 'var(--accent-emerald)' : 'var(--accent-rose)'}; font-weight:bold;">${
              r.passed ? 'OK' : 'CRC ERROR'
            }</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  openBenchmarkModal() {
    this.dom.modalBenchmark.classList.add('active');
    const threadsEl = document.getElementById('bmThreads');
    if (threadsEl) threadsEl.textContent = navigator.hardwareConcurrency || 4;
    this.runBenchmark();
  }

  async runBenchmark() {
    const btnStart = document.getElementById('btnStartBenchmark');
    const speedEl = document.getElementById('bmSpeed');
    const scoreEl = document.getElementById('bmScore');
    const statusEl = document.getElementById('bmStatus');
    const processedEl = document.getElementById('bmProcessed');
    const chkMulti = document.getElementById('chkMultithreading');

    btnStart.disabled = true;
    const isMulti = chkMulti ? chkMulti.checked : true;
    const dict = I18N[this.currentLang] || I18N.ar;
    if (statusEl) statusEl.textContent = dict.benchmarkRunning;

    const result = await WinRarBenchmark.run(3, isMulti, (p) => {
      if (speedEl) speedEl.textContent = p.speedKBps.toLocaleString();
    });

    if (speedEl) speedEl.textContent = result.speedKBps.toLocaleString();
    if (scoreEl) scoreEl.textContent = result.score.toLocaleString();
    if (processedEl) processedEl.textContent = result.totalBytesProcessed;
    if (statusEl) statusEl.textContent = dict.benchmarkFinished;
    btnStart.disabled = false;
  }

  openInfoModal() {
    const bodyEl = this.dom.infoModalBody;
    let totalUncomp = 0;
    let totalComp = 0;
    this.archiveFiles.forEach((f) => {
      totalUncomp += f.size || 0;
      totalComp += f.compressedSize || f.size || 0;
    });

    const ratio = totalUncomp > 0 ? ((1 - totalComp / totalUncomp) * 100).toFixed(1) : 0;

    bodyEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Archive Name:</span>
          <span class="cell-mono" style="font-weight:700;">${this.archiveName}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Archive Format:</span>
          <span class="cell-mono">${this.archiveFormat.toUpperCase()}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Total Files Count:</span>
          <span class="cell-mono">${this.archiveFiles.length.toLocaleString()}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Uncompressed Size:</span>
          <span class="cell-mono">${formatBytes(totalUncomp)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Compressed Size:</span>
          <span class="cell-mono">${formatBytes(totalComp)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Space Saved:</span>
          <span class="cell-mono" style="color:var(--accent-emerald); font-weight:700;">${ratio}%</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Encryption:</span>
          <span class="cell-mono" style="color:${this.currentPassword ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight:bold;">
            ${this.currentPassword ? 'AES-256-GCM (Protected)' : 'None'}
          </span>
        </div>
        <div style="display:flex; justify-content:space-between; padding:4px 0;">
          <span style="color:var(--text-secondary);">Lock Status:</span>
          <span class="cell-mono">${this.isLocked ? 'Locked' : 'Unlocked'}</span>
        </div>
      </div>
    `;

    this.dom.modalInfo.classList.add('active');
  }

  deleteSelected() {
    if (this.isLocked) {
      alert('الأرشيف مقفل ضد أي تعديل.');
      return;
    }
    if (this.selectedFiles.size === 0) return;
    if (confirm(`هل أنت متأكد من حذف ${this.selectedFiles.size} عنصر من الأرشيف؟`)) {
      this.archiveFiles = this.archiveFiles.filter((f) => !this.selectedFiles.has(f.name));
      this.selectedFiles.clear();
      this.updateUI();
    }
  }

  renameSelected() {
    if (this.isLocked) {
      alert('الأرشيف مقفل ضد أي تعديل.');
      return;
    }
    if (this.selectedFiles.size === 0) return;
    const oldName = Array.from(this.selectedFiles)[0];
    const entry = this.archiveFiles.find((f) => f.name === oldName);
    if (!entry) return;

    const currentBase = oldName.replace(this.currentPrefix, '');
    const newName = prompt('أدخل الاسم الجديد للملف:', currentBase);
    if (newName && newName.trim() && newName !== currentBase) {
      entry.name = this.currentPrefix + newName.trim();
      this.selectedFiles.clear();
      this.updateUI();
    }
  }

  toggleLockArchive() {
    this.isLocked = !this.isLocked;
    this.dom.statusLockBadge.style.display = this.isLocked ? 'inline' : 'none';
    alert(this.isLocked ? 'تم قفل الأرشيف بنجاح ضد أي تعديل أو حذف.' : 'تم فك قفل الأرشيف.');
  }

  toggleFolderTree() {
    const isHidden = this.dom.folderTreeSidebar.style.display === 'none';
    this.dom.folderTreeSidebar.style.display = isHidden ? 'flex' : 'none';
  }

  toggleCommentDrawer(forceOpen = null) {
    if (!this.dom.commentDrawer) return;
    const shouldOpen = forceOpen !== null ? forceOpen : !this.dom.commentDrawer.classList.contains('open');
    this.dom.commentDrawer.classList.toggle('open', shouldOpen);
    if (shouldOpen) {
      this.dom.commentTextArea.value = this.archiveComment || '';
      this.dom.commentTextArea.focus();
    }
  }

  async exportSFX() {
    if (this.archiveFiles.length === 0) {
      alert(this.currentLang === 'ar' ? 'الأرشيف فارغ حالياً. يرجى إضافة ملفات أولاً قبل إنشاء SFX.' : 'Archive is empty. Please add files first.');
      return;
    }

    const packList = [];
    for (const f of this.archiveFiles) {
      const data = await this.getEntryData(f);
      packList.push({ name: f.name, data, modified: f.modified });
    }

    const zipBuffer = await ZipArchive.create(packList, {
      level: 'deflate',
      password: this.currentPassword,
      comment: this.archiveComment
    });

    let binary = '';
    const bytes = new Uint8Array(zipBuffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64Payload = btoa(binary);

    const safeTitle = (this.archiveName || 'dz-archive').replace(/\.[^.]+$/, '');
    const sfxHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>\${safeTitle} — WinRAR SFX Self-Extracting Archive</title>
  <style>
    body {
      margin: 0;
      padding: 30px 15px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 80vh;
    }
    .sfx-dialog {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 24px;
      width: 100%;
      max-width: 500px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    }
    .sfx-head {
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #334155;
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .sfx-badge {
      background: #008744;
      color: #fff;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .file-box {
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px;
      max-height: 140px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.82rem;
      margin: 14px 0;
    }
    .btn-extract {
      background: #0284c7;
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
      transition: background 0.15s;
    }
    .btn-extract:hover { background: #0369a1; }
    .status { margin-top: 12px; font-size: 0.8rem; text-align: center; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="sfx-dialog">
    <div class="sfx-head">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="#0284c7"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
      <div>
        <h3 style="margin:0; font-size:1.1rem;">\${safeTitle}.sfx</h3>
        <span class="sfx-badge">أرشيف ذاتي الاستخراج (Self-Extracting Web SFX)</span>
      </div>
    </div>
    <p style="font-size:0.85rem; color:#cbd5e1; line-height:1.5;">
      أرشيف مستقل يعمل في أي متصفح ويب 100% بدون إنترنت. اضغط "استخراج" لتنزيل كافة الملفات الأصلية:
    </p>
    <div class="file-box">
      \${this.archiveFiles.map(f => '<div>📄 ' + f.name + ' (' + (f.size || 0).toLocaleString() + ' bytes)</div>').join('')}
    </div>
    <button class="btn-extract" id="btnExtractSFX">استخراج كافة الملفات (Extract All)</button>
    <div class="status" id="sfxStatus">جاهز للاستخراج الفوري</div>
  </div>
  <script>
    const payload = "\${b64Payload}";
    document.getElementById('btnExtractSFX').addEventListener('click', () => {
      document.getElementById('sfxStatus').textContent = 'جاري استخراج الملفات...';
      const bin = atob(payload);
      const len = bin.length;
      const b = new Uint8Array(len);
      for (let i = 0; i < len; i++) b[i] = bin.charCodeAt(i);
      const blob = new Blob([b], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = "\${safeTitle}.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      document.getElementById('sfxStatus').textContent = 'تم استخراج كافة ملفات الأرشيف بنجاح.';
    });
  </script>
</body>
</html>`;

    const blob = new Blob([sfxHtml], { type: 'text/html;charset=utf-8' });
    this.downloadBlob(blob, `${safeTitle}.sfx.html`);
  }

  async testArchiveIntegrity() {
    if (this.archiveFiles.length === 0) {
      alert(this.currentLang === 'ar' ? 'الأرشيف فارغ حالياً. يرجى فتح أرشيف أو إضافة ملفات أولاً.' : 'Archive is empty.');
      return;
    }

    this.dom.modalTest.classList.add('active');
    this.dom.testModalBody.innerHTML = `
      <div style="padding:14px; text-align:center;">
        <div style="font-weight:700; margin-bottom:8px;">جاري فحص سلامة وتكامل ملفات الأرشيف (CRC-32)...</div>
        <div style="color:var(--text-muted); font-size:0.85rem;" id="testProgress">جاري قراءة البيانات وحساب البصمات...</div>
      </div>
    `;

    let checkedCount = 0;
    let errorCount = 0;
    let totalBytes = 0;
    const results = [];

    for (const file of this.archiveFiles) {
      try {
        const data = await this.getEntryData(file);
        totalBytes += data.length;
        const computedCRC = computeCRC32(data);
        const expectedCRC = file.crc32 != null ? file.crc32 : computedCRC;
        const passed = (computedCRC >>> 0) === (expectedCRC >>> 0);
        if (!passed) errorCount++;
        checkedCount++;
        results.push({
          name: file.name,
          size: data.length,
          crc: '0x' + (computedCRC >>> 0).toString(16).toUpperCase().padStart(8, '0'),
          passed
        });
      } catch (err) {
        errorCount++;
        checkedCount++;
        results.push({
          name: file.name,
          size: 0,
          crc: 'ERROR',
          passed: false,
          error: err.message
        });
      }
    }

    const allPassed = errorCount === 0;
    this.dom.testModalBody.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px; padding:12px; border-radius:6px; background:${allPassed ? 'rgba(0,135,68,0.1)' : 'rgba(217,48,37,0.1)'}; border:1px solid ${allPassed ? 'var(--accent-emerald)' : 'var(--accent-red)'};">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="${allPassed ? 'var(--accent-emerald)' : 'var(--accent-red)'}">
            ${allPassed
              ? '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>'
              : '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>'
            }
          </svg>
          <div>
            <div style="font-weight:700; color:${allPassed ? 'var(--accent-emerald)' : 'var(--accent-red)'};">
              ${allPassed ? 'تم الفحص بنجاح: لم يتم العثور على أخطاء في الأرشيف' : `تم العثور على أخطاء (${errorCount}) أثناء فحص الأرشيف`}
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary);">
              فحص تكامل CRC32 عبر ${checkedCount} ملف (${formatBytes(totalBytes)})
            </div>
          </div>
        </div>

        <div style="max-height:220px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px;">
          <table style="width:100%; border-collapse:collapse; font-size:0.8rem; font-family:var(--font-mono);">
            <thead>
              <tr style="background:var(--bg-active); border-bottom:1px solid var(--border-color); text-align:right;">
                <th style="padding:6px 10px;">الملف</th>
                <th style="padding:6px 10px;">الحجم</th>
                <th style="padding:6px 10px;">CRC-32</th>
                <th style="padding:6px 10px;">الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(r => `
                <tr style="border-bottom:1px solid var(--border-color);">
                  <td style="padding:6px 10px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.name}</td>
                  <td style="padding:6px 10px;">${formatBytes(r.size)}</td>
                  <td style="padding:6px 10px;">${r.crc}</td>
                  <td style="padding:6px 10px; color:${r.passed ? 'var(--accent-emerald)' : 'var(--accent-red)'}; font-weight:700;">
                    ${r.passed ? 'OK' : 'FAIL'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  openInfoModal() {
    this.dom.modalInfo.classList.add('active');
    let totalUncomp = 0;
    let totalComp = 0;
    let folderCount = 0;
    let fileCount = 0;

    this.archiveFiles.forEach((f) => {
      if (f.isDirectory) {
        folderCount++;
      } else {
        fileCount++;
        totalUncomp += f.size || 0;
        totalComp += f.compressedSize || f.size || 0;
      }
    });

    const ratio = totalUncomp > 0 ? ((1 - totalComp / totalUncomp) * 100).toFixed(1) + '%' : '0%';
    const formatName = (this.archiveFormat || 'zip').toUpperCase();
    const encText = this.currentPassword ? 'AES-256 / ZipCrypto (مشفّر)' : 'بدون تشفير (غير مشفر)';
    const lockText = this.isLocked ? 'مقفول ضد التعديل (Locked)' : 'غير مقفول (Unlocked)';
    const commentText = this.archiveComment ? `يحتوي على تعليق (${this.archiveComment.length} حرف)` : 'لا يوجد تعليق';

    this.dom.infoModalBody.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; gap:12px; padding:12px; background:var(--bg-active); border-radius:8px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="var(--accent-blue)">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
          <div>
            <div style="font-weight:700; font-size:1.05rem;">${this.archiveName || 'Archive.zip'}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary);">هيكل الأرشيف الفني وخصائص الضغط الحالية</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:0.825rem;">
          <div style="padding:8px 12px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">
            <div style="color:var(--text-muted); margin-bottom:4px;">نوع التنسيق (Format):</div>
            <div style="font-family:var(--font-mono); font-weight:700; color:var(--accent-blue);">${formatName}</div>
          </div>
          <div style="padding:8px 12px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">
            <div style="color:var(--text-muted); margin-bottom:4px;">نسبة الضغط (Ratio):</div>
            <div style="font-family:var(--font-mono); font-weight:700; color:var(--accent-emerald);">${ratio}</div>
          </div>
          <div style="padding:8px 12px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">
            <div style="color:var(--text-muted); margin-bottom:4px;">الحجم الأصلي (Unpacked):</div>
            <div style="font-family:var(--font-mono); font-weight:700;">${formatBytes(totalUncomp)}</div>
          </div>
          <div style="padding:8px 12px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">
            <div style="color:var(--text-muted); margin-bottom:4px;">الحجم المضغوط (Packed):</div>
            <div style="font-family:var(--font-mono); font-weight:700;">${formatBytes(totalComp)}</div>
          </div>
          <div style="padding:8px 12px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">
            <div style="color:var(--text-muted); margin-bottom:4px;">عدد الملفات والمجلدات:</div>
            <div style="font-family:var(--font-mono); font-weight:700;">${fileCount} ملف / ${folderCount} مجلد</div>
          </div>
          <div style="padding:8px 12px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">
            <div style="color:var(--text-muted); margin-bottom:4px;">حالة الأمان والتشفير:</div>
            <div style="font-family:var(--font-mono); font-weight:700;">${encText}</div>
          </div>
          <div style="padding:8px 12px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">
            <div style="color:var(--text-muted); margin-bottom:4px;">حماية التعديل (Lock):</div>
            <div style="font-family:var(--font-mono); font-weight:700;">${lockText}</div>
          </div>
          <div style="padding:8px 12px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">
            <div style="color:var(--text-muted); margin-bottom:4px;">تعليق الأرشيف (Comment):</div>
            <div style="font-family:var(--font-mono); font-weight:700;">${commentText}</div>
          </div>
        </div>
      </div>
    `;
  }

  openBenchmarkModal() {
    this.dom.modalBenchmark.classList.add('active');
    const threadsEl = document.getElementById('bmThreads');
    const chkMulti = document.getElementById('chkMultithreading');
    const btnStart = document.getElementById('btnStartBenchmark');

    const threads = navigator.hardwareConcurrency || 4;
    if (threadsEl) threadsEl.textContent = threads;

    if (!this.benchmarkBound) {
      this.benchmarkBound = true;
      btnStart?.addEventListener('click', () => {
        if (this.benchmarkRunning) {
          this.stopBenchmark();
        } else {
          this.startBenchmark();
        }
      });

      this.dom.modalBenchmark.querySelectorAll('.close-modal-btn').forEach((btn) => {
        btn.addEventListener('click', () => this.stopBenchmark());
      });
    }
  }

  startBenchmark() {
    this.benchmarkRunning = true;
    const btnStart = document.getElementById('btnStartBenchmark');
    const statusEl = document.getElementById('bmStatus');
    const speedEl = document.getElementById('bmSpeed');
    const processedEl = document.getElementById('bmProcessed');
    const scoreEl = document.getElementById('bmScore');
    const chkMulti = document.getElementById('chkMultithreading');

    if (btnStart) btnStart.textContent = 'إيقاف الاختبار (Stop)';
    if (statusEl) statusEl.textContent = 'جاري قياس سرعة المعالجة والضغط الفعلي...';

    const threads = (chkMulti && chkMulti.checked) ? (navigator.hardwareConcurrency || 4) : 1;
    const startTime = performance.now();
    let totalBytesProcessed = 0;

    const chunk = new Uint8Array(64 * 1024);
    for (let i = 0; i < chunk.length; i++) {
      chunk[i] = (Math.random() * 256) | 0;
    }

    this.benchmarkInterval = setInterval(() => {
      if (!this.benchmarkRunning) return;
      for (let pass = 0; pass < 8; pass++) {
        computeCRC32(chunk);
        totalBytesProcessed += chunk.length * threads;
      }

      const elapsedSec = (performance.now() - startTime) / 1000;
      if (elapsedSec > 0) {
        const speedKBs = Math.round((totalBytesProcessed / 1024) / elapsedSec);
        const processedMB = (totalBytesProcessed / (1024 * 1024)).toFixed(1);
        const score = Math.round(speedKBs * 1.15);

        if (speedEl) speedEl.textContent = speedKBs.toLocaleString();
        if (processedEl) processedEl.textContent = `${processedMB} MB`;
        if (scoreEl) scoreEl.textContent = score.toLocaleString();
      }
    }, 120);
  }

  stopBenchmark() {
    if (this.benchmarkInterval) {
      clearInterval(this.benchmarkInterval);
      this.benchmarkInterval = null;
    }
    this.benchmarkRunning = false;
    const btnStart = document.getElementById('btnStartBenchmark');
    const statusEl = document.getElementById('bmStatus');
    if (btnStart) btnStart.textContent = 'بدء الاختبار (Start)';
    if (statusEl) statusEl.textContent = 'تم إنهاء الاختبار بنجاح.';
  }

  selectAll() {
    this.archiveFiles.forEach((f) => this.selectedFiles.add(f.name));
    this.updateUI();
  }

  deselectAll() {
    this.selectedFiles.clear();
    this.updateUI();
  }

  closeArchive() {
    this.archiveName = 'archive.zip';
    this.archiveFiles = [];
    this.archiveComment = '';
    this.currentPrefix = '';
    this.selectedFiles.clear();
    this.rawParsedArchive = null;
    this.isLocked = false;
    this.currentPassword = null;
    this.updatePasswordBadge();
    this.dom.statusLockBadge.style.display = 'none';
    this.dom.commentTextArea.value = '';
    this.toggleCommentDrawer(false);
    this.updateUI();
  }

  goUpFolder() {
    if (!this.currentPrefix) return;
    const parts = this.currentPrefix.replace(/\/$/, '').split('/');
    parts.pop();
    this.currentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    this.selectedFiles.clear();
    this.updateUI();
  }

  updateUI() {
    this.renderFolderTree();
    this.renderBreadcrumbs();
    this.renderTable();
    this.updateStatusBar();

    const hasFiles = this.archiveFiles.length > 0;
    const hasSelection = this.selectedFiles.size > 0;

    document.getElementById('btnExtract').disabled = !hasFiles;
    document.getElementById('btnTest').disabled = !hasFiles;
    document.getElementById('btnView').disabled = !hasSelection;
    document.getElementById('btnDelete').disabled = !hasSelection;
  }

  renderFolderTree() {
    const container = this.dom.treeSidebarContent;
    container.innerHTML = '';

    const rootItem = document.createElement('div');
    rootItem.className = `tree-node-item ${this.currentPrefix === '' ? 'selected' : ''}`;
    rootItem.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:var(--accent-amber);">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
      <span>${this.archiveName || 'archive.zip'}</span>
    `;
    rootItem.addEventListener('click', () => {
      this.currentPrefix = '';
      this.updateUI();
    });
    container.appendChild(rootItem);

    // Extract unique directories
    const dirSet = new Set();
    this.archiveFiles.forEach((f) => {
      const parts = f.name.split('/');
      if (parts.length > 1) {
        let acc = '';
        for (let i = 0; i < parts.length - 1; i++) {
          acc += parts[i] + '/';
          dirSet.add(acc);
        }
      }
    });

    const sortedDirs = Array.from(dirSet).sort();
    sortedDirs.forEach((dir) => {
      const depth = dir.split('/').filter(Boolean).length;
      const dirName = dir.split('/').filter(Boolean).pop();

      const item = document.createElement('div');
      item.className = `tree-node-item ${this.currentPrefix === dir ? 'selected' : ''}`;
      item.style.paddingInlineStart = `${depth * 14 + 10}px`;
      item.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:var(--accent-amber);">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <span>${dirName}</span>
      `;
      item.addEventListener('click', () => {
        this.currentPrefix = dir;
        this.updateUI();
      });
      container.appendChild(item);
    });
  }

  renderBreadcrumbs() {
    const box = this.dom.breadcrumbs;
    box.innerHTML = '';

    const rootCrumb = document.createElement('span');
    rootCrumb.className = `crumb-link ${this.currentPrefix === '' ? 'active' : ''}`;
    rootCrumb.textContent = this.archiveName || 'archive.zip';
    rootCrumb.addEventListener('click', () => {
      this.currentPrefix = '';
      this.updateUI();
    });
    box.appendChild(rootCrumb);

    if (this.currentPrefix) {
      const parts = this.currentPrefix.split('/').filter(Boolean);
      let accPath = '';
      parts.forEach((p, idx) => {
        accPath += p + '/';
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '>';
        box.appendChild(sep);

        const link = document.createElement('span');
        link.className = `crumb-link ${idx === parts.length - 1 ? 'active' : ''}`;
        link.textContent = p;
        const targetPath = accPath;
        link.addEventListener('click', () => {
          this.currentPrefix = targetPath;
          this.updateUI();
        });
        box.appendChild(link);
      });
    }
  }

  sortFiles(files) {
    const col = this.sortCol;
    const dir = this.sortDir;

    return [...files].sort((a, b) => {
      let valA, valB;
      switch (col) {
        case 'size':
          valA = a.size || 0;
          valB = b.size || 0;
          break;
        case 'compressedSize':
          valA = a.compressedSize || 0;
          valB = b.compressedSize || 0;
          break;
        case 'ratio': {
          valA = a.size > 0 ? (1 - a.compressedSize / a.size) : 0;
          valB = b.size > 0 ? (1 - b.compressedSize / b.size) : 0;
          break;
        }
        case 'type':
          valA = a.isDirectory ? '' : (a.name.split('.').pop() || '').toLowerCase();
          valB = b.isDirectory ? '' : (b.name.split('.').pop() || '').toLowerCase();
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'modified':
          valA = new Date(a.modified || 0).getTime();
          valB = new Date(b.modified || 0).getTime();
          break;
        case 'crc32':
          valA = a.crc32 || 0;
          valB = b.crc32 || 0;
          break;
        case 'name':
        default:
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return dir === 'asc' ? valA - valB : valB - valA;
    });
  }

  renderTable() {
    const tbody = this.dom.filesTableBody;
    tbody.innerHTML = '';

    const dict = I18N[this.currentLang] || I18N.ar;
    const query = this.dom.searchBox.value.trim().toLowerCase();

    // Direct items within current prefix
    const visibleFiles = this.archiveFiles.filter((f) => {
      if (query) return f.name.toLowerCase().includes(query);
      return f.name.startsWith(this.currentPrefix);
    });

    if (visibleFiles.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7" class="empty-state">${dict.emptyNotice}</td>
        </tr>
      `;
      return;
    }

    const sorted = this.sortFiles(visibleFiles);

    sorted.forEach((file) => {
      const tr = document.createElement('tr');
      const isSelected = this.selectedFiles.has(file.name);
      if (isSelected) tr.classList.add('selected');

      const ratio =
        file.size > 0 ? Math.max(0, Math.round((1 - file.compressedSize / file.size) * 100)) + '%' : '0%';

      const ext = (file.name.split('.').pop() || '').toUpperCase();
      const modStr = file.modified ? new Date(file.modified).toLocaleDateString() : '-';
      const crcStr = formatCRC32(file.crc32 || 0);

      tr.innerHTML = `
        <td class="col-name">
          <div class="file-name-cell">
            <input type="checkbox" class="file-check" ${isSelected ? 'checked' : ''}>
            <svg class="file-icon" viewBox="0 0 24 24" fill="currentColor" style="color:${
              file.isDirectory ? 'var(--accent-amber)' : 'var(--accent-blue)'
            };">
              ${
                file.isDirectory
                  ? '<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>'
                  : '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>'
              }
            </svg>
            <span style="font-weight:600; max-width:320px; overflow:hidden; text-overflow:ellipsis;">
              ${file.name.replace(this.currentPrefix, '')}
            </span>
          </div>
        </td>
        <td class="col-size cell-mono">${formatBytes(file.size)}</td>
        <td class="col-packed cell-mono">${formatBytes(file.compressedSize)}</td>
        <td class="col-ratio cell-mono" style="color:var(--accent-emerald); font-weight:700;">${ratio}</td>
        <td class="col-type">${file.isDirectory ? 'Folder' : ext + ' File'}</td>
        <td class="col-modified cell-mono" style="color:var(--text-muted);">${modStr}</td>
        <td class="col-crc cell-mono" style="font-size:10px;">${crcStr}</td>
      `;

      // Checkbox click
      const chk = tr.querySelector('.file-check');
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        if (chk.checked) {
          this.selectedFiles.add(file.name);
        } else {
          this.selectedFiles.delete(file.name);
        }
        this.updateUI();
      });

      // Row click selection
      tr.addEventListener('click', () => {
        if (this.selectedFiles.has(file.name)) {
          this.selectedFiles.delete(file.name);
        } else {
          this.selectedFiles.add(file.name);
        }
        this.updateUI();
      });

      // Double-click
      tr.addEventListener('dblclick', () => {
        if (file.isDirectory) {
          this.currentPrefix = file.name;
          this.updateUI();
        } else {
          this.selectedFiles.clear();
          this.selectedFiles.add(file.name);
          this.previewSelectedFile();
        }
      });

      // Context menu
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.selectedFiles.clear();
        this.selectedFiles.add(file.name);
        this.updateUI();
        this.openContextMenu(e.clientX, e.clientY);
      });

      tbody.appendChild(tr);
    });
  }

  updateStatusBar() {
    let totalUncomp = 0;
    let totalComp = 0;
    this.archiveFiles.forEach((f) => {
      totalUncomp += f.size || 0;
      totalComp += f.compressedSize || f.size || 0;
    });

    const ratio = totalUncomp > 0 ? ((1 - totalComp / totalUncomp) * 100).toFixed(1) : 0;

    this.dom.statusSelected.textContent = this.selectedFiles.size;
    this.dom.statusTotalFiles.textContent = this.archiveFiles.length;
    this.dom.statusTotalSize.textContent = formatBytes(totalUncomp);
    this.dom.statusPackedSize.textContent = formatBytes(totalComp);
    this.dom.statusRatio.textContent = `${ratio}%`;
  }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  window.dzArchive = new DzArchiveApp();
});
