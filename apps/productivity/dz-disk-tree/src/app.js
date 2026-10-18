/**
 * DZ-DiskTree — Main Application Logic & Controller
 * 100% Offline | Trilingual (AR/FR/EN) | Squarified Treemap & Table Controllers
 * Zero Emojis | Vector SVGs Only
 */

import { SquarifiedTreemap } from './treemap.js';

// Trilingual Localization Dictionary
const I18N = {
  ar: {
    appTitle: 'DZ-DiskTree',
    appSubtitle: 'أداة تحليل وتصور مساحات الأقراص والملفات المفتوحة المصدر',
    drives: 'الأقراص المتوفرة',
    targetPath: 'مسار الفحص',
    scanBtn: 'بدء الفحص السريع',
    scanning: 'جاري الفحص...',
    cancelBtn: 'إلغاء',
    totalSize: 'إجمالي الحجم',
    allocatedSize: 'المساحة المحجوزة',
    filesCount: 'عدد الملفات',
    foldersCount: 'عدد المجلدات',
    duration: 'مدة الفحص',
    statusReady: 'جاهز للفحص',
    tabTreemap: 'المخطط المساحي (Treemap)',
    tabTree: 'شجرة المجلدات',
    tabExtensions: 'أنواع الملفات والامتدادات',
    tabTopFiles: 'أكبر الملفات حجماً',
    zoomIn: 'تكبير المجلد',
    zoomOut: 'مستوى للأعلى',
    resetZoom: 'إعادة الضبط',
    toggleAllocated: 'عرض المساحة المحجوزة على القرص',
    exportImg: 'حفظ المخطط كصورة',
    exportCsv: 'تصدير CSV',
    exportJson: 'تصدير تقرير JSON',
    searchPlaceholder: 'بحث في أكبر الملفات...',
    copySuccess: 'تم نسخ المسار إلى الحافظة',
    extCol: 'الامتداد',
    categoryCol: 'التصنيف',
    countCol: 'عدد الملفات',
    sizeCol: 'الحجم',
    percentCol: 'النسبة',
    fileNameCol: 'اسم الملف',
    filePathCol: 'المسار الكامل',
    actionCol: 'إجراء',
    noData: 'لم يتم إجراء أي فحص بعد. اختر قرصاً أو مساراً واضغط بدء الفحص.',
    demoNotice: 'وضع محلي مستقل 100%'
  },
  fr: {
    appTitle: 'DZ-DiskTree',
    appSubtitle: 'Analyseur et visualiseur d\'espace disque haute performance open source',
    drives: 'Lecteurs disponibles',
    targetPath: 'Chemin à analyser',
    scanBtn: 'Démarrer l\'analyse',
    scanning: 'Analyse en cours...',
    cancelBtn: 'Annuler',
    totalSize: 'Taille totale',
    allocatedSize: 'Espace alloué',
    filesCount: 'Nombre de fichiers',
    foldersCount: 'Nombre de dossiers',
    duration: 'Durée',
    statusReady: 'Prêt pour l\'analyse',
    tabTreemap: 'Treemap (Carte arborescente)',
    tabTree: 'Arborescence des dossiers',
    tabExtensions: 'Types de fichiers',
    tabTopFiles: 'Fichiers les plus volumineux',
    zoomIn: 'Zoomer le dossier',
    zoomOut: 'Niveau supérieur',
    resetZoom: 'Réinitialiser',
    toggleAllocated: 'Afficher la taille allouée sur disque',
    exportImg: 'Exporter l\'image PNG',
    exportCsv: 'Exporter en CSV',
    exportJson: 'Rapport JSON',
    searchPlaceholder: 'Rechercher parmi les fichiers...',
    copySuccess: 'Chemin copié dans le presse-papiers',
    extCol: 'Extension',
    categoryCol: 'Catégorie',
    countCol: 'Fichiers',
    sizeCol: 'Taille',
    percentCol: 'Pourcentage',
    fileNameCol: 'Nom du fichier',
    filePathCol: 'Chemin complet',
    actionCol: 'Action',
    noData: 'Aucune analyse effectuée. Sélectionnez un lecteur et lancez l\'analyse.',
    demoNotice: 'Mode autonome 100% hors ligne'
  },
  en: {
    appTitle: 'DZ-DiskTree',
    appSubtitle: 'High-Performance Open-Source Disk Space Analyzer & Treemap Visualizer',
    drives: 'Available Drives',
    targetPath: 'Scan Path',
    scanBtn: 'Start Fast Scan',
    scanning: 'Scanning in progress...',
    cancelBtn: 'Cancel',
    totalSize: 'Total Size',
    allocatedSize: 'Allocated Space',
    filesCount: 'Total Files',
    foldersCount: 'Total Folders',
    duration: 'Duration',
    statusReady: 'Ready to scan',
    tabTreemap: 'Squarified Treemap',
    tabTree: 'Directory Tree',
    tabExtensions: 'File Types Breakdown',
    tabTopFiles: 'Largest Files',
    zoomIn: 'Zoom into Folder',
    zoomOut: 'Up One Level',
    resetZoom: 'Reset View',
    toggleAllocated: 'Show Allocated Space on Disk',
    exportImg: 'Export PNG Image',
    exportCsv: 'Export to CSV',
    exportJson: 'Export JSON Report',
    searchPlaceholder: 'Search largest files...',
    copySuccess: 'File path copied to clipboard',
    extCol: 'Extension',
    categoryCol: 'Category',
    countCol: 'Files Count',
    sizeCol: 'Size',
    percentCol: 'Percentage',
    fileNameCol: 'File Name',
    filePathCol: 'Full Path',
    actionCol: 'Action',
    noData: 'No scan performed yet. Select a drive or directory and click Start Scan.',
    demoNotice: '100% Offline-first standalone mode'
  }
};

class DiskTreeApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_disktree_lang') || 'ar';
    this.currentTheme = localStorage.getItem('dz_disktree_theme') || 'dark';
    this.showAllocated = false;
    this.activeTab = 'treemap';

    this.scanData = null;
    this.isScanning = false;
    this.timerInterval = null;
    this.treemap = null;

    this.initDOM();
    this.applyTheme(this.currentTheme);
    this.applyLanguage(this.currentLang);
    this.initTreemapCanvas();
    this.initEvents();
    this.loadDrives();
  }

  initDOM() {
    this.dom = {
      langSelect: document.getElementById('langSelect'),
      themeToggle: document.getElementById('themeToggle'),
      drivesList: document.getElementById('drivesList'),
      pathInput: document.getElementById('pathInput'),
      scanBtn: document.getElementById('scanBtn'),
      cancelBtn: document.getElementById('cancelBtn'),
      metricTotalSize: document.getElementById('metricTotalSize'),
      metricAllocated: document.getElementById('metricAllocated'),
      metricFiles: document.getElementById('metricFiles'),
      metricFolders: document.getElementById('metricFolders'),
      metricDuration: document.getElementById('metricDuration'),
      tabs: document.querySelectorAll('.tab-btn'),
      tabPanels: document.querySelectorAll('.tab-panel'),
      treemapCanvas: document.getElementById('treemapCanvas'),
      treemapBreadcrumbs: document.getElementById('treemapBreadcrumbs'),
      treemapTooltip: document.getElementById('treemapTooltip'),
      btnZoomOut: document.getElementById('btnZoomOut'),
      btnResetZoom: document.getElementById('btnResetZoom'),
      chkAllocated: document.getElementById('chkAllocated'),
      btnExportImg: document.getElementById('btnExportImg'),
      btnExportCsv: document.getElementById('btnExportCsv'),
      btnExportJson: document.getElementById('btnExportJson'),
      treeContainer: document.getElementById('treeContainer'),
      extensionsTableBody: document.getElementById('extensionsTableBody'),
      topFilesTableBody: document.getElementById('topFilesTableBody'),
      searchTopFiles: document.getElementById('searchTopFiles')
    };
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dz_disktree_theme', theme);
    if (this.treemap) this.treemap.render();
  }

  applyLanguage(lang) {
    this.currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.body.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    localStorage.setItem('dz_disktree_lang', lang);

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

  initTreemapCanvas() {
    const canvas = this.dom.treemapCanvas;
    if (!canvas) return;

    // Handle high-DPI
    const resizeCanvas = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      if (this.treemap) {
        this.treemap.render();
      }
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    this.treemap = new SquarifiedTreemap(canvas, {
      showAllocated: this.showAllocated,
      onNodeClick: (node) => {
        this.updateBreadcrumbs();
      },
      onNodeHover: (node, event) => {
        this.showTooltip(node, event);
      }
    });
  }

  updateBreadcrumbs() {
    const container = this.dom.treemapBreadcrumbs;
    if (!container || !this.treemap) return;
    container.innerHTML = '';

    const trail = this.treemap.breadcrumbTrail;
    trail.forEach((item, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-separator';
        sep.textContent = '>';
        container.appendChild(sep);
      }

      const crumb = document.createElement('span');
      crumb.className = 'crumb-item';
      crumb.textContent = item.name || item.path || '/';
      crumb.addEventListener('click', () => {
        this.treemap.currentNode = item;
        this.treemap.breadcrumbTrail = trail.slice(0, idx + 1);
        this.treemap.render();
        this.updateBreadcrumbs();
      });
      container.appendChild(crumb);
    });
  }

  showTooltip(node, event) {
    const tip = this.dom.treemapTooltip;
    if (!tip) return;

    if (!node) {
      tip.style.display = 'none';
      return;
    }

    const dict = I18N[this.currentLang] || I18N.ar;
    const isRtl = this.currentLang === 'ar';
    const totalCurrent = (this.treemap.currentNode && this.treemap.currentNode.size) || 1;
    const percent = ((node.size / totalCurrent) * 100).toFixed(1);

    tip.innerHTML = `
      <div class="tooltip-title">${node.name || 'File'}</div>
      <div class="tooltip-row">
        <span>${dict.filePathCol}:</span>
        <span class="tooltip-val" style="word-break: break-all;">${node.path || ''}</span>
      </div>
      <div class="tooltip-row">
        <span>${dict.sizeCol}:</span>
        <span class="tooltip-val">${SquarifiedTreemap.formatBytes(node.size)}</span>
      </div>
      <div class="tooltip-row">
        <span>${dict.allocatedSize}:</span>
        <span class="tooltip-val">${SquarifiedTreemap.formatBytes(node.allocatedSize)}</span>
      </div>
      <div class="tooltip-row">
        <span>${dict.percentCol}:</span>
        <span class="tooltip-val">${percent}%</span>
      </div>
      ${node.isDirectory ? `
      <div class="tooltip-row">
        <span>${dict.filesCount}:</span>
        <span class="tooltip-val">${(node.filesCount || 0).toLocaleString()}</span>
      </div>` : ''}
    `;

    tip.style.display = 'block';

    const canvasRect = this.dom.treemapCanvas.getBoundingClientRect();
    const x = event.clientX - canvasRect.left + 15;
    const y = event.clientY - canvasRect.top + 15;

    tip.style.left = `${Math.min(x, canvasRect.width - 320)}px`;
    tip.style.top = `${Math.min(y, canvasRect.height - 180)}px`;
  }

  initEvents() {
    // Theme toggle
    if (this.dom.themeToggle) {
      this.dom.themeToggle.addEventListener('click', () => {
        const next = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(next);
      });
    }

    // Language selector
    if (this.dom.langSelect) {
      this.dom.langSelect.addEventListener('change', (e) => {
        this.applyLanguage(e.target.value);
      });
    }

    // View Tabs
    this.dom.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetView = tab.getAttribute('data-view');
        this.switchTab(targetView);
      });
    });

    // Start Scan Button
    if (this.dom.scanBtn) {
      this.dom.scanBtn.addEventListener('click', () => {
        this.startScan();
      });
    }

    // Cancel Button
    if (this.dom.cancelBtn) {
      this.dom.cancelBtn.addEventListener('click', () => {
        this.cancelScan();
      });
    }

    // Treemap Controls
    if (this.dom.btnZoomOut) {
      this.dom.btnZoomOut.addEventListener('click', () => {
        if (this.treemap) {
          this.treemap.zoomOut();
          this.updateBreadcrumbs();
        }
      });
    }

    if (this.dom.btnResetZoom) {
      this.dom.btnResetZoom.addEventListener('click', () => {
        if (this.treemap) {
          this.treemap.resetZoom();
          this.updateBreadcrumbs();
        }
      });
    }

    if (this.dom.chkAllocated) {
      this.dom.chkAllocated.addEventListener('change', (e) => {
        this.showAllocated = e.target.checked;
        if (this.treemap) {
          this.treemap.options.showAllocated = this.showAllocated;
          this.treemap.render();
        }
      });
    }

    if (this.dom.btnExportImg) {
      this.dom.btnExportImg.addEventListener('click', () => {
        this.exportTreemapImage();
      });
    }

    // Export CSV
    if (this.dom.btnExportCsv) {
      this.dom.btnExportCsv.addEventListener('click', () => {
        this.exportDataCsv();
      });
    }

    // Export JSON
    if (this.dom.btnExportJson) {
      this.dom.btnExportJson.addEventListener('click', () => {
        this.exportDataJson();
      });
    }

    // Search Top Files
    if (this.dom.searchTopFiles) {
      this.dom.searchTopFiles.addEventListener('input', (e) => {
        this.filterTopFiles(e.target.value);
      });
    }
  }

  switchTab(viewName) {
    this.activeTab = viewName;
    this.dom.tabs.forEach(t => {
      if (t.getAttribute('data-view') === viewName) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });

    this.dom.tabPanels.forEach(p => {
      if (p.id === `tab-${viewName}`) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });

    if (viewName === 'treemap' && this.treemap) {
      setTimeout(() => this.treemap.render(), 50);
    }
  }

  async loadDrives() {
    try {
      const res = await fetch('/api/drives');
      const data = await res.json();
      if (data.ok && data.drives && data.drives.length > 0) {
        this.renderDrives(data.drives);
      }
    } catch {}
    // Default to workspace path for immediate high-speed demonstration
    if (!this.dom.pathInput.value) {
      this.dom.pathInput.value = 'c:\\Users\\safou\\Desktop\\algerie open source';
    }
  }

  renderDrives(drives) {
    const list = this.dom.drivesList;
    if (!list) return;
    list.innerHTML = '';

    drives.forEach((d, idx) => {
      const chip = document.createElement('div');
      chip.className = `drive-chip ${idx === 0 ? 'active' : ''}`;
      const usedPct = d.total > 0 ? Math.round((d.used / d.total) * 100) : 0;
      chip.innerHTML = `
        <svg class="svg-icon" viewBox="0 0 24 24"><path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v8h16V8H4zm14 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-3 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>
        <span>${d.letter}</span>
        <span style="font-size:0.7rem; color:var(--text-muted);">${usedPct}%</span>
      `;
      chip.addEventListener('click', () => {
        document.querySelectorAll('.drive-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.dom.pathInput.value = d.path;
      });
      list.appendChild(chip);
    });
  }

  async startScan() {
    const targetPath = this.dom.pathInput.value.trim();
    if (!targetPath) return;

    this.isScanning = true;
    this.dom.scanBtn.disabled = true;
    this.dom.cancelBtn.disabled = false;
    this.dom.cancelBtn.style.display = 'inline-flex';

    const dict = I18N[this.currentLang] || I18N.ar;
    this.dom.scanBtn.innerHTML = `<span class="spinner"></span> <span>${dict.scanning}</span>`;

    const startTimestamp = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTimestamp) / 1000).toFixed(1);
      this.dom.metricDuration.textContent = `${elapsed}s`;
    }, 100);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, maxTopFiles: 500 })
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Scan failed');
      }

      this.scanData = data;
      this.renderScanResults(data);
    } catch (err) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      this.isScanning = false;
      clearInterval(this.timerInterval);
      this.dom.scanBtn.disabled = false;
      this.dom.cancelBtn.disabled = true;
      this.dom.cancelBtn.style.display = 'none';
      this.dom.scanBtn.innerHTML = `
        <svg class="svg-icon" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.59L8.41 12 9.83 10.59 12 12.76l4.17-4.17L17.59 10z"/></svg>
        <span>${dict.scanBtn}</span>
      `;
    }
  }

  async cancelScan() {
    try {
      await fetch('/api/cancel', { method: 'POST' });
    } catch {}
    this.isScanning = false;
  }

  renderScanResults(data) {
    const stats = data.stats;
    this.dom.metricTotalSize.textContent = SquarifiedTreemap.formatBytes(stats.totalSize);
    this.dom.metricAllocated.textContent = SquarifiedTreemap.formatBytes(stats.totalAllocated);
    this.dom.metricFiles.textContent = (stats.totalFiles || 0).toLocaleString();
    this.dom.metricFolders.textContent = (stats.totalFolders || 0).toLocaleString();
    this.dom.metricDuration.textContent = `${(stats.durationMs / 1000).toFixed(2)}s`;

    // 1. Render Treemap
    if (this.treemap) {
      this.treemap.setData(data.tree);
      this.updateBreadcrumbs();
    }

    // 2. Render Directory Tree
    this.renderDirectoryTree(data.tree);

    // 3. Render Extensions Breakdown
    this.renderExtensionsTable(data.extensions, stats.totalSize);

    // 4. Render Top Largest Files
    this.renderTopFilesTable(data.topFiles);
  }

  renderDirectoryTree(rootNode) {
    const container = this.dom.treeContainer;
    if (!container) return;
    container.innerHTML = '';

    const createNodeEl = (node, depth = 0) => {
      const wrapper = document.createElement('div');
      wrapper.className = `tree-node-wrapper ${depth === 0 ? 'open' : ''}`;

      const row = document.createElement('div');
      row.className = 'tree-node';

      const hasChildren = node.children && node.children.some(c => c.isDirectory);
      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.innerHTML = hasChildren
        ? `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>`
        : `<span style="width:14px; display:inline-block;"></span>`;

      const icon = document.createElement('span');
      icon.innerHTML = `<svg class="svg-icon" style="color:var(--accent-amber);" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;

      const label = document.createElement('span');
      label.style.fontWeight = '600';
      label.textContent = node.name || node.path;

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'cell-mono';
      sizeSpan.style.color = 'var(--text-secondary)';
      sizeSpan.style.fontSize = '0.775rem';
      sizeSpan.textContent = `(${SquarifiedTreemap.formatBytes(node.size)})`;

      row.appendChild(toggle);
      row.appendChild(icon);
      row.appendChild(label);
      row.appendChild(sizeSpan);

      row.addEventListener('click', () => {
        if (hasChildren) {
          wrapper.classList.toggle('open');
        }
        if (this.treemap) {
          this.treemap.zoomToNode(node);
          this.switchTab('treemap');
        }
      });

      wrapper.appendChild(row);

      if (hasChildren) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children';
        // Only render directory children in tree view for maximum speed
        const dirChildren = node.children
          .filter(c => c.isDirectory)
          .sort((a, b) => b.size - a.size);

        for (const child of dirChildren) {
          childContainer.appendChild(createNodeEl(child, depth + 1));
        }
        wrapper.appendChild(childContainer);
      }

      return wrapper;
    };

    container.appendChild(createNodeEl(rootNode, 0));
  }

  renderExtensionsTable(extensions, totalSize) {
    const tbody = this.dom.extensionsTableBody;
    if (!tbody) return;
    tbody.innerHTML = '';

    const safeTotal = totalSize > 0 ? totalSize : 1;

    extensions.forEach(ext => {
      const tr = document.createElement('tr');
      const pct = ((ext.size / safeTotal) * 100).toFixed(2);
      const catStyle = SquarifiedTreemap.CATEGORY_COLORS[ext.category] || SquarifiedTreemap.CATEGORY_COLORS.other;

      tr.innerHTML = `
        <td class="cell-mono" style="font-weight:700;">${ext.extension}</td>
        <td>
          <span class="badge-category" style="background:${catStyle.bg}; color:${catStyle.text};">
            ${catStyle.label || ext.category}
          </span>
        </td>
        <td class="cell-mono">${(ext.count || 0).toLocaleString()}</td>
        <td class="cell-mono" style="font-weight:600;">${SquarifiedTreemap.formatBytes(ext.size)}</td>
        <td class="cell-mono">${SquarifiedTreemap.formatBytes(ext.allocatedSize)}</td>
        <td style="min-width: 140px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill" style="width: ${pct}%; background:${catStyle.bg};"></div>
            </div>
            <span class="cell-mono" style="font-size:0.75rem; width:45px;">${pct}%</span>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderTopFilesTable(files) {
    const tbody = this.dom.topFilesTableBody;
    if (!tbody) return;
    tbody.innerHTML = '';

    files.forEach((f, idx) => {
      const tr = document.createElement('tr');
      const cat = SquarifiedTreemap.getCategoryForExtension(f.extension);
      const catStyle = SquarifiedTreemap.CATEGORY_COLORS[cat] || SquarifiedTreemap.CATEGORY_COLORS.other;

      tr.innerHTML = `
        <td class="cell-mono" style="color:var(--text-muted);">${idx + 1}</td>
        <td style="font-weight:600; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${f.name}">
          ${f.name}
        </td>
        <td>
          <span class="badge-category" style="background:${catStyle.bg}; color:${catStyle.text};">
            ${f.extension || 'none'}
          </span>
        </td>
        <td class="cell-mono" style="font-weight:700; color:var(--accent-blue);">${SquarifiedTreemap.formatBytes(f.size)}</td>
        <td class="cell-mono" style="color:var(--text-secondary);">${SquarifiedTreemap.formatBytes(f.allocatedSize)}</td>
        <td class="cell-mono" style="font-size:0.775rem; max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted);" title="${f.path}">
          ${f.path}
        </td>
        <td>
          <button class="btn btn-secondary btn-icon copy-btn" title="Copy Path" data-path="${f.path}">
            <svg class="svg-icon" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
        </td>
      `;

      tr.querySelector('.copy-btn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const p = btn.getAttribute('data-path');
        navigator.clipboard.writeText(p);
        btn.style.color = 'var(--accent-emerald)';
        setTimeout(() => { btn.style.color = ''; }, 1500);
      });

      tbody.appendChild(tr);
    });
  }

  filterTopFiles(query) {
    if (!this.scanData || !this.scanData.topFiles) return;
    const clean = query.toLowerCase().trim();
    const filtered = this.scanData.topFiles.filter(f =>
      f.name.toLowerCase().includes(clean) || (f.path && f.path.toLowerCase().includes(clean))
    );
    this.renderTopFilesTable(filtered);
  }

  exportTreemapImage() {
    if (!this.dom.treemapCanvas) return;
    const link = document.createElement('a');
    link.download = `dz-treemap-${Date.now()}.png`;
    link.href = this.dom.treemapCanvas.toDataURL('image/png');
    link.click();
  }

  async exportDataCsv() {
    if (!this.scanData) return;
    const payload = {
      type: this.activeTab === 'extensions' ? 'extensions' : 'topfiles',
      rows: this.activeTab === 'extensions' ? this.scanData.extensions : this.scanData.topFiles
    };

    try {
      const res = await fetch('/api/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dz-disktree-${payload.type}-${Date.now()}.csv`;
      a.click();
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  }

  exportDataJson() {
    if (!this.scanData) return;
    const jsonStr = JSON.stringify(this.scanData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dz-disktree-report-${Date.now()}.json`;
    a.click();
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new DiskTreeApp();
});
