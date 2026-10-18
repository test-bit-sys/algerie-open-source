/**
 * DZ-Archive — Application Controller
 * Follows the HeyPuter/everything standard (Vanilla JS + Modern ES Modules)
 * Trilingual (AR/FR/EN) | WinRAR-Equivalent Toolset | Zero Emojis
 */

import { ZipArchive, TarArchive, WinRarBenchmark, formatBytes, formatCRC32, computeCRC32 } from './archive-engine.js';

const I18N = {
  ar: {
    appTitle: 'DZ-Archive',
    appSubtitle: 'أداة الضغط والأرشفة وفك التشفير المفتوحة المصدر',
    toolAdd: 'إضافة ملفات',
    toolExtract: 'استخراج إلى',
    toolTest: 'فحص السلامة',
    toolView: 'معاينة',
    toolDelete: 'حذف',
    toolBenchmark: 'اختبار السرعة',
    toolInfo: 'معلومات',
    colName: 'اسم الملف',
    colSize: 'الحجم الأصلي',
    colPacked: 'الحجم المضغوط',
    colRatio: 'نسبة الضغط',
    colType: 'النوع',
    colModified: 'تاريخ التعديل',
    colCrc: 'CRC-32',
    emptyNotice: 'لا يوجد أرشيف مفتوح حالياً. اسحب ملف مضغوط إلى هنا أو اضغط "إضافة ملفات" لإنشاء أرشيف جديد.',
    dropPrompt: 'أفلت الأرشيف أو الملفات هنا لفتحها فوراً',
    statusSelected: 'العناصر المحددة',
    statusTotalFiles: 'إجمالي الملفات',
    statusTotalSize: 'الحجم الكلي',
    statusPackedSize: 'المضغوط',
    modalAddTitle: 'إضافة ملفات إلى الأرشيف',
    modalExtractTitle: 'استخراج محتويات الأرشيف',
    modalBenchmarkTitle: 'اختبار أداء وسرعة الضغط (WinRAR Benchmark)',
    modalTestTitle: 'فحص سلامة الأرشيف',
    modalPreviewTitle: 'معاينة محتوى الملف',
    modalInfoTitle: 'معلومات الأرشيف الفنية',
    btnCancel: 'إلغاء',
    btnConfirm: 'تأكيد',
    btnStart: 'بدء الاختبار',
    btnExtractAll: 'استخراج الكل',
    btnExtractSelected: 'استخراج المحدد',
    btnDownloadArchive: 'تحميل الأرشيف',
    compressionLevel: 'مستوى الضغط',
    compStore: 'تخزين فقط (Store - بدون ضغط)',
    compNormal: 'عادي (Normal Deflate)',
    archiveFormat: 'صيغة الأرشيف',
    benchmarkRunning: 'جاري قياس سرعة المعالجة والضغط...',
    benchmarkFinished: 'اكتمل اختبار الأداء بنجاح',
    speedLabel: 'معدل السرعة الحالي',
    scoreLabel: 'التقييم الإجمالي',
    threadsLabel: 'المسارات المتزامنة',
    testSuccess: 'تم فحص جميع الملفات بنجاح. لا توجد أي أخطاء في الـ CRC-32.',
    testFail: 'تم اكتشاف أخطاء في فحص الـ CRC-32 لبعض الملفات.',
    searchPlaceholder: 'بحث في الأرشيف...'
  },
  fr: {
    appTitle: 'DZ-Archive',
    appSubtitle: 'Gestionnaire d\'archives, compression et extraction open-source',
    toolAdd: 'Ajouter',
    toolExtract: 'Extraire vers',
    toolTest: 'Tester',
    toolView: 'Afficher',
    toolDelete: 'Supprimer',
    toolBenchmark: 'Benchmark',
    toolInfo: 'Informations',
    colName: 'Nom',
    colSize: 'Taille',
    colPacked: 'Compressé',
    colRatio: 'Taux',
    colType: 'Type',
    colModified: 'Modifié le',
    colCrc: 'CRC-32',
    emptyNotice: 'Aucune archive ouverte. Glissez-déposez un fichier ZIP/TAR ici ou cliquez sur "Ajouter".',
    dropPrompt: 'Déposez l\'archive ou les fichiers ici',
    statusSelected: 'Sélectionné(s)',
    statusTotalFiles: 'Fichiers totaux',
    statusTotalSize: 'Taille totale',
    statusPackedSize: 'Compressé',
    modalAddTitle: 'Ajouter des fichiers à l\'archive',
    modalExtractTitle: 'Extraire l\'archive',
    modalBenchmarkTitle: 'Test de vitesse et performance (Benchmark WinRAR)',
    modalTestTitle: 'Vérification de l\'intégrité',
    modalPreviewTitle: 'Aperçu du fichier',
    modalInfoTitle: 'Détails de l\'archive',
    btnCancel: 'Annuler',
    btnConfirm: 'Confirmer',
    btnStart: 'Démarrer',
    btnExtractAll: 'Tout extraire',
    btnExtractSelected: 'Extraire la sélection',
    btnDownloadArchive: 'Télécharger l\'archive',
    compressionLevel: 'Niveau de compression',
    compStore: 'Stocker (sans compression)',
    compNormal: 'Normal (Deflate)',
    archiveFormat: 'Format d\'archive',
    benchmarkRunning: 'Test de compression en cours...',
    benchmarkFinished: 'Test terminé avec succès',
    speedLabel: 'Vitesse actuelle',
    scoreLabel: 'Score de performance',
    threadsLabel: 'Threads processeur',
    testSuccess: 'Toutes les sommes de contrôle CRC-32 sont valides.',
    testFail: 'Erreurs de CRC-32 détectées.',
    searchPlaceholder: 'Rechercher dans l\'archive...'
  },
  en: {
    appTitle: 'DZ-Archive',
    appSubtitle: 'High-Performance Open-Source Archiver, Compression & Benchmark Suite',
    toolAdd: 'Add Files',
    toolExtract: 'Extract To',
    toolTest: 'Test',
    toolView: 'View',
    toolDelete: 'Delete',
    toolBenchmark: 'Benchmark',
    toolInfo: 'Info',
    colName: 'Name',
    colSize: 'Size',
    colPacked: 'Packed',
    colRatio: 'Ratio',
    colType: 'Type',
    colModified: 'Modified',
    colCrc: 'CRC-32',
    emptyNotice: 'No archive currently open. Drop a ZIP/TAR file here or click "Add Files" to create a new archive.',
    dropPrompt: 'Drop archive or files here to inspect immediately',
    statusSelected: 'Selected',
    statusTotalFiles: 'Total files',
    statusTotalSize: 'Total size',
    statusPackedSize: 'Packed',
    modalAddTitle: 'Add Files to Archive',
    modalExtractTitle: 'Extract Archive Contents',
    modalBenchmarkTitle: 'Hardware Compression Benchmark',
    modalTestTitle: 'Test Archive Integrity',
    modalPreviewTitle: 'File Preview',
    modalInfoTitle: 'Archive Information',
    btnCancel: 'Cancel',
    btnConfirm: 'Confirm',
    btnStart: 'Start Benchmark',
    btnExtractAll: 'Extract All',
    btnExtractSelected: 'Extract Selected',
    btnDownloadArchive: 'Download Archive',
    compressionLevel: 'Compression Level',
    compStore: 'Store (No compression)',
    compNormal: 'Normal (Deflate)',
    archiveFormat: 'Archive Format',
    benchmarkRunning: 'Running compression benchmark...',
    benchmarkFinished: 'Benchmark completed successfully',
    speedLabel: 'Current Speed',
    scoreLabel: 'Rating Score',
    threadsLabel: 'CPU Threads',
    testSuccess: 'All files passed CRC-32 integrity checks successfully.',
    testFail: 'CRC-32 checksum errors detected.',
    searchPlaceholder: 'Search archive files...'
  }
};

class DzArchiveApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_archive_lang') || 'ar';
    this.currentTheme = localStorage.getItem('dz_archive_theme') || 'dark';

    this.archiveName = 'new-archive.zip';
    this.archiveFiles = []; // [{ name, size, compressedSize, data, crc32, modified, isDirectory }]
    this.currentPrefix = ''; // Folder drill-down prefix within archive
    this.selectedFiles = new Set();
    this.rawParsedArchive = null;

    this.initDOM();
    this.applyTheme(this.currentTheme);
    this.applyLanguage(this.currentLang);
    this.initEvents();
    this.initDragAndDrop();
    this.updateUI();
  }

  initDOM() {
    this.dom = {
      langSelect: document.getElementById('langSelect'),
      themeToggle: document.getElementById('themeToggle'),
      toolbar: {
        btnAdd: document.getElementById('btnAdd'),
        btnExtract: document.getElementById('btnExtract'),
        btnTest: document.getElementById('btnTest'),
        btnView: document.getElementById('btnView'),
        btnDelete: document.getElementById('btnDelete'),
        btnBenchmark: document.getElementById('btnBenchmark'),
        btnInfo: document.getElementById('btnInfo')
      },
      fileInput: document.getElementById('hiddenFileInput'),
      archiveInput: document.getElementById('hiddenArchiveInput'),
      breadcrumbs: document.getElementById('archiveBreadcrumbs'),
      searchBox: document.getElementById('searchFilesInput'),
      filesTableBody: document.getElementById('filesTableBody'),
      selectAllCheck: document.getElementById('selectAllCheck'),
      dropOverlay: document.getElementById('dropOverlay'),
      statusBar: {
        selected: document.getElementById('statusSelected'),
        totalFiles: document.getElementById('statusTotalFiles'),
        totalSize: document.getElementById('statusTotalSize'),
        packedSize: document.getElementById('statusPackedSize'),
        ratio: document.getElementById('statusRatio')
      },
      modals: {
        benchmark: document.getElementById('modalBenchmark'),
        preview: document.getElementById('modalPreview'),
        test: document.getElementById('modalTest'),
        info: document.getElementById('modalInfo'),
        add: document.getElementById('modalAdd')
      }
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
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        if (el.tagName === 'INPUT' && el.placeholder) {
          el.placeholder = dict[key];
        } else {
          el.textContent = dict[key];
        }
      }
    });

    if (this.dom.langSelect) {
      this.dom.langSelect.value = lang;
    }
  }

  initEvents() {
    // Theme toggle
    if (this.dom.themeToggle) {
      this.dom.themeToggle.addEventListener('click', () => {
        const next = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(next);
      });
    }

    // Language select
    if (this.dom.langSelect) {
      this.dom.langSelect.addEventListener('change', (e) => {
        this.applyLanguage(e.target.value);
        this.updateUI();
      });
    }

    // Toolbar: Add
    this.dom.toolbar.btnAdd.addEventListener('click', () => {
      this.dom.fileInput.click();
    });

    this.dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.addFilesFromInput(Array.from(e.target.files));
      }
      this.dom.fileInput.value = '';
    });

    // Toolbar: Open Archive
    const btnOpenArchive = document.getElementById('btnOpenArchive');
    if (btnOpenArchive) {
      btnOpenArchive.addEventListener('click', () => {
        this.dom.archiveInput.click();
      });
    }

    this.dom.archiveInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.loadArchiveFile(e.target.files[0]);
      }
      this.dom.archiveInput.value = '';
    });

    // Toolbar: Extract
    this.dom.toolbar.btnExtract.addEventListener('click', () => {
      this.extractArchive();
    });

    // Toolbar: Test
    this.dom.toolbar.btnTest.addEventListener('click', () => {
      this.testArchiveIntegrity();
    });

    // Toolbar: View
    this.dom.toolbar.btnView.addEventListener('click', () => {
      this.previewSelectedFile();
    });

    // Toolbar: Delete
    this.dom.toolbar.btnDelete.addEventListener('click', () => {
      this.deleteSelected();
    });

    // Toolbar: Benchmark
    this.dom.toolbar.btnBenchmark.addEventListener('click', () => {
      this.openBenchmarkModal();
    });

    // Toolbar: Info
    this.dom.toolbar.btnInfo.addEventListener('click', () => {
      this.openInfoModal();
    });

    // Select All Checkbox
    if (this.dom.selectAllCheck) {
      this.dom.selectAllCheck.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.archiveFiles.forEach(f => this.selectedFiles.add(f.name));
        } else {
          this.selectedFiles.clear();
        }
        this.updateUI();
      });
    }

    // Search filter
    if (this.dom.searchBox) {
      this.dom.searchBox.addEventListener('input', () => {
        this.renderTable();
      });
    }

    // Close buttons for modals
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-backdrop');
        if (modal) modal.classList.remove('active');
      });
    });
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

  async loadArchiveFile(file) {
    this.archiveName = file.name;
    const buffer = await file.arrayBuffer();

    try {
      if (file.name.endsWith('.tar')) {
        const parsed = TarArchive.parse(buffer);
        this.archiveFiles = parsed.entries;
        this.rawParsedArchive = null;
      } else {
        // Assume ZIP
        const parsed = await ZipArchive.parse(buffer);
        this.archiveFiles = parsed.entries;
        this.rawParsedArchive = parsed;
      }
      this.currentPrefix = '';
      this.selectedFiles.clear();
      this.updateUI();
    } catch (err) {
      alert(`Failed to open archive: ${err.message}`);
    }
  }

  async addFilesFromInput(files) {
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const crc = computeCRC32(bytes);

      // Check if already exists, overwrite or append
      const existingIdx = this.archiveFiles.findIndex(f => f.name === file.name);
      const fileEntry = {
        name: file.name,
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

  deleteSelected() {
    if (this.selectedFiles.size === 0) return;
    this.archiveFiles = this.archiveFiles.filter(f => !this.selectedFiles.has(f.name));
    this.selectedFiles.clear();
    this.updateUI();
  }

  async extractArchive() {
    if (this.archiveFiles.length === 0) return;

    // Check if downloading the packed zip archive or individual files
    const toExtract = this.selectedFiles.size > 0
      ? this.archiveFiles.filter(f => this.selectedFiles.has(f.name))
      : this.archiveFiles;

    if (toExtract.length === 1 && !toExtract[0].isDirectory) {
      // Download single extracted file
      const entry = toExtract[0];
      const data = await this.getEntryData(entry);
      this.downloadBlob(data, entry.name.split('/').pop());
      return;
    }

    // Build newly packed ZIP and download
    const packList = [];
    for (const f of toExtract) {
      const data = await this.getEntryData(f);
      packList.push({ name: f.name, data, modified: f.modified });
    }

    const zipBuffer = await ZipArchive.create(packList, { level: 'deflate' });
    this.downloadBlob(zipBuffer, this.archiveName || 'dz-extracted.zip');
  }

  async getEntryData(entry) {
    if (entry.data) return entry.data;
    if (this.rawParsedArchive && this.rawParsedArchive.extractFile) {
      const extracted = await this.rawParsedArchive.extractFile(entry);
      entry.data = extracted;
      return extracted;
    }
    return new Uint8Array(0);
  }

  downloadBlob(data, filename) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async previewSelectedFile() {
    if (this.selectedFiles.size === 0) return;
    const selectedName = Array.from(this.selectedFiles)[0];
    const entry = this.archiveFiles.find(f => f.name === selectedName);
    if (!entry || entry.isDirectory) return;

    const data = await this.getEntryData(entry);
    const ext = (entry.name.split('.').pop() || '').toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);

    const titleEl = document.getElementById('previewModalTitle');
    const bodyEl = document.getElementById('previewModalBody');
    if (titleEl) titleEl.textContent = entry.name;

    if (bodyEl) {
      bodyEl.innerHTML = '';
      if (isImage) {
        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);
        bodyEl.innerHTML = `
          <div class="preview-img-box">
            <img src="${url}" alt="${entry.name}">
          </div>
        `;
      } else {
        const text = new TextDecoder('utf-8').decode(data);
        const pre = document.createElement('div');
        pre.className = 'preview-content-box';
        pre.textContent = text.slice(0, 50000); // cap display for speed
        bodyEl.appendChild(pre);
      }
    }

    this.dom.modals.preview.classList.add('active');
  }

  async testArchiveIntegrity() {
    if (this.archiveFiles.length === 0) return;
    const bodyEl = document.getElementById('testModalBody');
    if (!bodyEl) return;

    bodyEl.innerHTML = '<p class="cell-mono">Verifying CRC-32 checksums...</p>';
    this.dom.modals.test.classList.add('active');

    let allPassed = true;
    const results = [];

    for (const f of this.archiveFiles) {
      if (f.isDirectory) continue;
      const data = await this.getEntryData(f);
      const computed = computeCRC32(data);
      const passed = (f.crc32 === 0 || f.crc32 === undefined) || (computed === f.crc32);
      if (!passed) allPassed = false;
      results.push({ name: f.name, passed, expected: formatCRC32(f.crc32 || 0), computed: formatCRC32(computed) });
    }

    const dict = I18N[this.currentLang] || I18N.ar;
    bodyEl.innerHTML = `
      <div style="padding:12px; border-radius:6px; background:${allPassed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; border:1px solid ${allPassed ? '#10b981' : '#ef4444'}; font-weight:600;">
        ${allPassed ? dict.testSuccess : dict.testFail}
      </div>
      <div style="max-height:260px; overflow:auto; margin-top:12px; font-family:var(--font-mono); font-size:0.775rem;">
        ${results.map(r => `
          <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border-subtle);">
            <span>${r.name}</span>
            <span style="color:${r.passed ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">${r.passed ? 'OK' : 'CRC ERROR'}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  openBenchmarkModal() {
    const modal = this.dom.modals.benchmark;
    modal.classList.add('active');

    const speedEl = document.getElementById('bmSpeed');
    const scoreEl = document.getElementById('bmScore');
    const statusEl = document.getElementById('bmStatus');
    const threadsEl = document.getElementById('bmThreads');
    const btnStart = document.getElementById('btnStartBenchmark');

    if (threadsEl) threadsEl.textContent = navigator.hardwareConcurrency || 4;

    const runBm = async () => {
      btnStart.disabled = true;
      const dict = I18N[this.currentLang] || I18N.ar;
      if (statusEl) statusEl.textContent = dict.benchmarkRunning;

      const result = await WinRarBenchmark.run(3, (p) => {
        if (speedEl) speedEl.textContent = p.speedKBps.toLocaleString();
      });

      if (speedEl) speedEl.textContent = result.speedKBps.toLocaleString();
      if (scoreEl) scoreEl.textContent = result.score.toLocaleString();
      if (statusEl) statusEl.textContent = dict.benchmarkFinished;
      btnStart.disabled = false;
    };

    btnStart.onclick = runBm;
    runBm();
  }

  openInfoModal() {
    const bodyEl = document.getElementById('infoModalBody');
    if (!bodyEl) return;

    let totalUncomp = 0;
    let totalComp = 0;
    this.archiveFiles.forEach(f => {
      totalUncomp += f.size || 0;
      totalComp += f.compressedSize || f.size || 0;
    });

    const ratio = totalUncomp > 0 ? ((1 - (totalComp / totalUncomp)) * 100).toFixed(1) : 0;

    bodyEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px; font-size:0.85rem;">
        <div style="display:flex; justify-content:space-between;"><span>Archive Name:</span><span class="cell-mono" style="font-weight:700;">${this.archiveName}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Total Files:</span><span class="cell-mono">${this.archiveFiles.length}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Uncompressed Size:</span><span class="cell-mono">${formatBytes(totalUncomp)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Compressed Size:</span><span class="cell-mono">${formatBytes(totalComp)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Space Saved:</span><span class="cell-mono" style="color:var(--accent-emerald); font-weight:700;">${ratio}%</span></div>
      </div>
    `;

    this.dom.modals.info.classList.add('active');
  }

  updateUI() {
    this.renderBreadcrumbs();
    this.renderTable();
    this.updateStatusBar();

    const hasFiles = this.archiveFiles.length > 0;
    const hasSelection = this.selectedFiles.size > 0;

    this.dom.toolbar.btnExtract.disabled = !hasFiles;
    this.dom.toolbar.btnTest.disabled = !hasFiles;
    this.dom.toolbar.btnView.disabled = !hasSelection;
    this.dom.toolbar.btnDelete.disabled = !hasSelection;
  }

  renderBreadcrumbs() {
    const box = this.dom.breadcrumbs;
    if (!box) return;
    box.innerHTML = '';

    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'crumb-link';
    rootCrumb.textContent = this.archiveName || 'archive.zip';
    rootCrumb.addEventListener('click', () => {
      this.currentPrefix = '';
      this.updateUI();
    });
    box.appendChild(rootCrumb);

    if (this.currentPrefix) {
      const parts = this.currentPrefix.split('/').filter(Boolean);
      let accPath = '';
      parts.forEach(p => {
        accPath += p + '/';
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '>';
        box.appendChild(sep);

        const link = document.createElement('span');
        link.className = 'crumb-link';
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

  renderTable() {
    const tbody = this.dom.filesTableBody;
    if (!tbody) return;
    tbody.innerHTML = '';

    const dict = I18N[this.currentLang] || I18N.ar;
    const query = (this.dom.searchBox && this.dom.searchBox.value.trim().toLowerCase()) || '';

    // Filter files for current folder prefix
    const visibleFiles = this.archiveFiles.filter(f => {
      if (query) {
        return f.name.toLowerCase().includes(query);
      }
      return f.name.startsWith(this.currentPrefix);
    });

    if (visibleFiles.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">
            ${dict.emptyNotice}
          </td>
        </tr>
      `;
      return;
    }

    visibleFiles.forEach(file => {
      const tr = document.createElement('tr');
      const isSelected = this.selectedFiles.has(file.name);
      if (isSelected) tr.classList.add('selected');

      const ratio = file.size > 0
        ? Math.max(0, Math.round((1 - (file.compressedSize / file.size)) * 100)) + '%'
        : '0%';

      const ext = (file.name.split('.').pop() || '').toUpperCase();
      const modStr = file.modified ? new Date(file.modified).toLocaleDateString() : '-';
      const crcStr = formatCRC32(file.crc32 || 0);

      tr.innerHTML = `
        <td class="file-name-cell">
          <input type="checkbox" class="file-check" ${isSelected ? 'checked' : ''}>
          <svg class="file-icon svg-icon" style="color:${file.isDirectory ? 'var(--accent-amber)' : 'var(--accent-blue)'};" viewBox="0 0 24 24">
            ${file.isDirectory
              ? '<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>'
              : '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>'}
          </svg>
          <span style="max-width:280px; overflow:hidden; text-overflow:ellipsis;" title="${file.name}">
            ${file.name.replace(this.currentPrefix, '')}
          </span>
        </td>
        <td class="cell-mono">${formatBytes(file.size)}</td>
        <td class="cell-mono">${formatBytes(file.compressedSize)}</td>
        <td class="cell-mono" style="color:var(--accent-emerald); font-weight:600;">${ratio}</td>
        <td>${file.isDirectory ? 'Folder' : ext + ' File'}</td>
        <td class="cell-mono" style="color:var(--text-muted);">${modStr}</td>
        <td class="cell-mono" style="font-size:0.75rem;">${crcStr}</td>
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

      // Double-click: open folder or preview file
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

      tbody.appendChild(tr);
    });
  }

  updateStatusBar() {
    let totalUncomp = 0;
    let totalComp = 0;
    this.archiveFiles.forEach(f => {
      totalUncomp += f.size || 0;
      totalComp += f.compressedSize || f.size || 0;
    });

    const ratio = totalUncomp > 0 ? ((1 - (totalComp / totalUncomp)) * 100).toFixed(1) : 0;

    if (this.dom.statusBar.selected) this.dom.statusBar.selected.textContent = this.selectedFiles.size;
    if (this.dom.statusBar.totalFiles) this.dom.statusBar.totalFiles.textContent = this.archiveFiles.length;
    if (this.dom.statusBar.totalSize) this.dom.statusBar.totalSize.textContent = formatBytes(totalUncomp);
    if (this.dom.statusBar.packedSize) this.dom.statusBar.packedSize.textContent = formatBytes(totalComp);
    if (this.dom.statusBar.ratio) this.dom.statusBar.ratio.textContent = `${ratio}%`;
  }
}

// Instantiate on load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new DzArchiveApp();
});
