/**
 * DZ-DiskTree — Windows Desktop & HeyPuter Architecture Application Controller
 * High-performance hierarchical tree-grid, synchronized 3D cushioned treemap,
 * resizable split panes, desktop menus, and right-click context operations.
 * 100% Offline | Zero Emojis | Vector SVGs Only
 */

import { SquarifiedTreemap } from './treemap.js';

const I18N = {
  ar: {
    appTitle: 'DZ-DiskTree',
    statusReady: 'جاهز للفحص (Ready)',
    scanning: 'جاري فحص المسار...',
    scanComplete: 'اكتمل الفحص في',
    copySuccess: 'تم نسخ المسار إلى الحافظة',
    copyNameSuccess: 'تم نسخ الاسم إلى الحافظة',
    totalFiles: 'الملفات',
    totalFolders: 'المجلدات',
    drive: 'القرص',
    used: 'مستخدم',
    free: 'فارغ',
    scanned: 'المساحة المفحوصة',
    selectedItem: 'العنصر المحدد',
    noSelection: 'لا شيء',
    maximize: 'تكبير المخطط',
    restore: 'استعادة التقسيم'
  },
  fr: {
    appTitle: 'DZ-DiskTree',
    statusReady: 'Prêt pour l\'analyse',
    scanning: 'Analyse en cours...',
    scanComplete: 'Analyse terminée en',
    copySuccess: 'Chemin copié dans le presse-papiers',
    copyNameSuccess: 'Nom copié dans le presse-papiers',
    totalFiles: 'Fichiers',
    totalFolders: 'Dossiers',
    drive: 'Lecteur',
    used: 'Utilisé',
    free: 'Libre',
    scanned: 'Espace analysé',
    selectedItem: 'Élément sélectionné',
    noSelection: 'Aucun',
    maximize: 'Agrandir le Treemap',
    restore: 'Restaurer le panneau'
  },
  en: {
    appTitle: 'DZ-DiskTree',
    statusReady: 'Ready to scan',
    scanning: 'Scanning directory...',
    scanComplete: 'Scan completed in',
    copySuccess: 'Path copied to clipboard',
    copyNameSuccess: 'Name copied to clipboard',
    totalFiles: 'Files',
    totalFolders: 'Folders',
    drive: 'Drive',
    used: 'Used',
    free: 'Free',
    scanned: 'Scanned Space',
    selectedItem: 'Selected',
    noSelection: 'None',
    maximize: 'Maximize Treemap',
    restore: 'Restore Split'
  }
};

class DiskTreeApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_disktree_lang') || 'ar';
    this.currentTheme = localStorage.getItem('dz_disktree_theme') || 'dark';
    this.unitMode = 'auto'; // 'auto', 'bytes', 'mb', 'gb'
    this.showAllocated = false;
    this.cushionShading = true;

    this.treeSortCol = 'size';
    this.treeSortDir = 'desc';
    this.filesSortCol = 'size';
    this.filesSortDir = 'desc';

    this.scanData = null;
    this.selectedNode = null;
    this.expandedNodes = new Set();
    this.activeTab = 'tree'; // 'tree', 'files', 'extensions'
    this.isTreemapMaximized = false;
    this.savedTopHeight = 350;

    this.treemap = null;
    this.isScanning = false;
    this.timerInterval = null;

    this.initDOM();
    this.applyTheme(this.currentTheme);
    this.applyLanguage(this.currentLang);
    this.initTreemap();
    this.initSplitter();
    this.initMenus();
    this.initContextMenu();
    this.initEvents();
    this.loadDrives();
  }

  initDOM() {
    this.dom = {
      langSelect: document.getElementById('langSelect'),
      themeToggleBtn: document.getElementById('themeToggleBtn'),
      driveSelect: document.getElementById('driveSelect'),
      driveMeterFill: document.getElementById('driveMeterFill'),
      driveMeterText: document.getElementById('driveMeterText'),
      pathInput: document.getElementById('pathInput'),
      btnBrowseFolder: document.getElementById('btnBrowseFolder'),
      scanBtn: document.getElementById('scanBtn'),
      scanBtnText: document.getElementById('scanBtnText'),
      cancelBtn: document.getElementById('cancelBtn'),
      quickFilterInput: document.getElementById('quickFilterInput'),
      clearFilterBtn: document.getElementById('clearFilterBtn'),

      // Split Panes
      workspaceSplit: document.getElementById('workspaceSplit'),
      topPane: document.getElementById('topPane'),
      splitterHandle: document.getElementById('splitterHandle'),
      bottomPane: document.getElementById('bottomPane'),

      // Tabs
      paneTabs: document.querySelectorAll('.pane-tab-btn'),
      tabPanes: document.querySelectorAll('.tab-pane-content'),
      treeTableBody: document.getElementById('treeTableBody'),
      filesTableBody: document.getElementById('filesTableBody'),
      extensionsTableBody: document.getElementById('extensionsTableBody'),

      // Treemap
      treemapCanvasContainer: document.getElementById('treemapCanvasContainer'),
      treemapCanvas: document.getElementById('treemapCanvas'),
      treemapBreadcrumbs: document.getElementById('treemapBreadcrumbs'),
      treemapTooltip: document.getElementById('treemapTooltip'),
      btnZoomOut: document.getElementById('btnZoomOut'),
      btnResetZoom: document.getElementById('btnResetZoom'),
      btnToggleMaximizeTreemap: document.getElementById('btnToggleMaximizeTreemap'),
      txtMaxRestore: document.getElementById('txtMaxRestore'),

      // Status Bar
      sbState: document.getElementById('sbState'),
      sbStats: document.getElementById('sbStats'),
      sbScanned: document.getElementById('sbScanned'),
      sbTime: document.getElementById('sbTime'),
      sbSelected: document.getElementById('sbSelected'),

      // Context Menu
      contextMenu: document.getElementById('contextMenu'),
      ctxCopyPath: document.getElementById('ctxCopyPath'),
      ctxCopyName: document.getElementById('ctxCopyName'),
      ctxZoomTreemap: document.getElementById('ctxZoomTreemap'),
      ctxFilterExt: document.getElementById('ctxFilterExt'),
      ctxProperties: document.getElementById('ctxProperties'),

      // Properties Modal
      propertiesModal: document.getElementById('propertiesModal'),
      propCloseBtn: document.getElementById('propCloseBtn'),
      propTitle: document.getElementById('propTitle'),
      propName: document.getElementById('propName'),
      propType: document.getElementById('propType'),
      propPath: document.getElementById('propPath'),
      propSize: document.getElementById('propSize'),
      propAllocated: document.getElementById('propAllocated'),
      propContains: document.getElementById('propContains'),
      propContainsRow: document.getElementById('propContainsRow'),
      propModified: document.getElementById('propModified'),

      // About Modal
      aboutModal: document.getElementById('aboutModal'),
      aboutCloseBtn: document.getElementById('aboutCloseBtn')
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
    localStorage.setItem('dz_disktree_lang', lang);
    if (this.dom.langSelect) this.dom.langSelect.value = lang;
  }

  initTreemap() {
    this.treemap = new SquarifiedTreemap(this.dom.treemapCanvas, {
      showAllocated: this.showAllocated,
      cushionShading: this.cushionShading,
      onNodeClick: (node) => {
        this.selectNode(node);
        this.updateBreadcrumbs();
      },
      onNodeDoubleClick: (node) => {
        if (node.isDirectory) {
          this.updateBreadcrumbs();
        }
      },
      onNodeRightClick: (node, event) => {
        this.openContextMenu(node, event.clientX, event.clientY);
      },
      onNodeHover: (node, event) => {
        this.showTreemapTooltip(node, event);
      }
    });

    window.addEventListener('resize', () => {
      if (this.treemap) this.treemap.resize();
    });

    setTimeout(() => {
      if (this.treemap) this.treemap.resize();
    }, 100);
  }

  initSplitter() {
    let isDragging = false;
    let startY = 0;
    let startHeight = 0;

    const handle = this.dom.splitterHandle;
    const topPane = this.dom.topPane;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startY = e.clientY;
      startHeight = topPane.getBoundingClientRect().height;
      handle.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaY = e.clientY - startY;
      const newHeight = Math.max(100, Math.min(window.innerHeight - 150, startHeight + deltaY));
      topPane.style.height = `${newHeight}px`;
      this.dom.bottomPane.style.height = `calc(100% - ${newHeight}px - 6px)`;
      if (this.treemap) this.treemap.resize();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        if (this.treemap) this.treemap.resize();
      }
    });
  }

  toggleMaximizeTreemap() {
    this.isTreemapMaximized = !this.isTreemapMaximized;
    const t = I18N[this.currentLang];

    if (this.isTreemapMaximized) {
      this.savedTopHeight = this.dom.topPane.getBoundingClientRect().height;
      this.dom.topPane.style.display = 'none';
      this.dom.splitterHandle.style.display = 'none';
      this.dom.bottomPane.style.height = '100%';
      this.dom.txtMaxRestore.textContent = t.restore;
    } else {
      this.dom.topPane.style.display = 'flex';
      this.dom.splitterHandle.style.display = 'flex';
      this.dom.topPane.style.height = `${this.savedTopHeight}px`;
      this.dom.bottomPane.style.height = `calc(100% - ${this.savedTopHeight}px - 6px)`;
      this.dom.txtMaxRestore.textContent = t.maximize;
    }

    setTimeout(() => {
      if (this.treemap) this.treemap.resize();
    }, 50);
  }

  initMenus() {
    // Dropdown toggles
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

    // Menu Item Actions
    document.getElementById('itemScanFolder')?.addEventListener('click', () => this.browseFolder());
    document.getElementById('itemStartScan')?.addEventListener('click', () => this.startScan());
    document.getElementById('itemCancelScan')?.addEventListener('click', () => this.cancelScan());
    document.getElementById('itemScanRootC')?.addEventListener('click', () => {
      this.dom.pathInput.value = 'C:\\';
      this.startScan();
    });
    document.getElementById('itemScanWorkspace')?.addEventListener('click', () => {
      this.dom.pathInput.value = 'c:\\Users\\safou\\Desktop\\algerie open source';
      this.startScan();
    });
    document.getElementById('itemExportCsv')?.addEventListener('click', () => this.exportCsv());
    document.getElementById('itemExportJson')?.addEventListener('click', () => this.exportJson());
    document.getElementById('itemSaveTreemapImg')?.addEventListener('click', () => this.saveTreemapImage());
    document.getElementById('itemCopyPath')?.addEventListener('click', () => this.copySelectedPath());
    document.getElementById('itemCopyName')?.addEventListener('click', () => this.copySelectedName());
    document.getElementById('itemAbout')?.addEventListener('click', () => {
      this.dom.aboutModal.classList.add('open');
    });

    // Options Menu
    document.getElementById('optToggleAllocated')?.addEventListener('click', () => {
      this.showAllocated = !this.showAllocated;
      this.treemap.options.showAllocated = this.showAllocated;
      this.treemap.render();
      this.renderTreeTable();
    });

    document.getElementById('optToggleCushion')?.addEventListener('click', () => {
      this.cushionShading = !this.cushionShading;
      this.treemap.options.cushionShading = this.cushionShading;
      this.treemap.render();
    });

    document.getElementById('optUnitAuto')?.addEventListener('click', () => {
      this.unitMode = 'auto';
      this.renderTreeTable();
      if (this.scanData) this.renderFilesTable(this.scanData.topFiles);
    });
    document.getElementById('optUnitMB')?.addEventListener('click', () => {
      this.unitMode = 'mb';
      this.renderTreeTable();
      if (this.scanData) this.renderFilesTable(this.scanData.topFiles);
    });
    document.getElementById('optUnitGB')?.addEventListener('click', () => {
      this.unitMode = 'gb';
      this.renderTreeTable();
      if (this.scanData) this.renderFilesTable(this.scanData.topFiles);
    });

    // View Menu
    document.getElementById('viewShowTree')?.addEventListener('click', () => this.switchTab('tree'));
    document.getElementById('viewShowFiles')?.addEventListener('click', () => this.switchTab('files'));
    document.getElementById('viewShowExtensions')?.addEventListener('click', () => this.switchTab('extensions'));
    document.getElementById('viewToggleTreemap')?.addEventListener('click', () => this.toggleMaximizeTreemap());
    document.getElementById('viewToggleTheme')?.addEventListener('click', () => {
      this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    });

    // Print & Reset Report
    document.getElementById('itemPrintReport')?.addEventListener('click', () => this.exportHtmlReport());
    document.getElementById('itemExit')?.addEventListener('click', () => this.resetState());
    document.getElementById('btnExportTopCsv')?.addEventListener('click', () => this.exportCsv());
    document.getElementById('btnExportTopJson')?.addEventListener('click', () => this.exportJson());
    document.getElementById('itemSelectAll')?.addEventListener('click', () => {
      if (this.scanData && this.scanData.tree) this.selectNode(this.scanData.tree);
    });

    // Modal closes
    this.dom.propCloseBtn?.addEventListener('click', () => this.dom.propertiesModal.classList.remove('open'));
    this.dom.aboutCloseBtn?.addEventListener('click', () => this.dom.aboutModal.classList.remove('open'));
    document.getElementById('itemFindDuplicates')?.addEventListener('click', () => this.openDuplicateFinder());
    document.getElementById('dupCloseBtn')?.addEventListener('click', () => document.getElementById('duplicateModal').classList.remove('open'));
    document.getElementById('dupCloseBottomBtn')?.addEventListener('click', () => document.getElementById('duplicateModal').classList.remove('open'));
    document.getElementById('dupExportBtn')?.addEventListener('click', () => this.exportDuplicatesCsv());
  }

  resetState() {
    this.scanData = null;
    this.selectedNode = null;
    this.expandedNodes.clear();
    this.treemap.setData(null);
    this.dom.treeTableBody.innerHTML = `<tr class="empty-row"><td colspan="8" class="text-center text-muted">جاهز للفحص — اختر قرصاً أو مساراً ثم اضغط "فحص (Scan)"</td></tr>`;
    this.dom.filesTableBody.innerHTML = `<tr class="empty-row"><td colspan="7" class="text-center text-muted">لا توجد ملفات معروضة حالياً</td></tr>`;
    this.dom.extensionsTableBody.innerHTML = `<tr class="empty-row"><td colspan="7" class="text-center text-muted">لا توجد بيانات امتدادات</td></tr>`;
    this.dom.sbState.textContent = 'جاهز للفحص (Ready)';
    this.dom.sbStats.textContent = 'Files: 0 | Folders: 0';
    this.dom.sbScanned.textContent = 'Scanned: 0 B';
    this.dom.sbTime.textContent = 'Time: 0.00s';
    this.dom.sbSelected.textContent = 'None';
  }

  closeAllMenus() {
    document.querySelectorAll('.dropdown-menu').forEach((d) => d.classList.remove('show'));
    document.querySelectorAll('.menu-btn').forEach((b) => b.classList.remove('active'));
  }

  initContextMenu() {
    this.dom.ctxCopyPath.addEventListener('click', () => this.copySelectedPath());
    this.dom.ctxCopyName.addEventListener('click', () => this.copySelectedName());
    this.dom.ctxZoomTreemap.addEventListener('click', () => {
      if (this.selectedNode && this.selectedNode.isDirectory) {
        this.treemap.zoomToNode(this.selectedNode);
        this.updateBreadcrumbs();
      }
    });
    this.dom.ctxFilterExt.addEventListener('click', () => {
      if (this.selectedNode && this.selectedNode.extension) {
        this.filterByExtension(this.selectedNode.extension);
      }
    });
    this.dom.ctxProperties.addEventListener('click', () => this.openPropertiesModal(this.selectedNode));
  }

  openContextMenu(node, x, y) {
    this.selectedNode = node;
    const menu = this.dom.contextMenu;
    menu.style.display = 'block';

    const menuW = 200;
    const menuH = 160;
    const posX = Math.min(x, window.innerWidth - menuW - 10);
    const posY = Math.min(y, window.innerHeight - menuH - 10);

    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
  }

  closeContextMenu() {
    this.dom.contextMenu.style.display = 'none';
  }

  initEvents() {
    // Theme toggle button
    this.dom.themeToggleBtn.addEventListener('click', () => {
      this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    });

    // Language select
    this.dom.langSelect.addEventListener('change', (e) => {
      this.applyLanguage(e.target.value);
    });

    // Scan & Cancel Buttons
    this.dom.scanBtn.addEventListener('click', () => this.startScan());
    this.dom.cancelBtn.addEventListener('click', () => this.cancelScan());

    // Browse Folder
    this.dom.btnBrowseFolder.addEventListener('click', () => this.browseFolder());

    // Quick Search Filter
    this.dom.quickFilterInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      this.dom.clearFilterBtn.style.display = q ? 'block' : 'none';
      this.treemap.setSearchFilter(q);
      this.filterTables(q);
    });

    this.dom.clearFilterBtn.addEventListener('click', () => {
      this.dom.quickFilterInput.value = '';
      this.dom.clearFilterBtn.style.display = 'none';
      this.treemap.setSearchFilter('');
      this.filterTables('');
    });

    // Tab buttons
    this.dom.paneTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        this.switchTab(target);
      });
    });

    // Treemap Controls
    this.dom.btnZoomOut.addEventListener('click', () => {
      this.treemap.zoomOut();
      this.updateBreadcrumbs();
    });

    this.dom.btnResetZoom.addEventListener('click', () => {
      this.treemap.resetZoom();
      this.updateBreadcrumbs();
    });

    this.dom.btnToggleMaximizeTreemap.addEventListener('click', () => {
      this.toggleMaximizeTreemap();
    });

    // Legend chips
    document.querySelectorAll('.legend-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const cat = chip.getAttribute('data-cat');
        this.filterByCategory(cat);
      });
    });

    // Table Header Sorting
    this.initSortHeaders();

    // Keyboard Shortcuts & Grid Navigation
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'F5') {
        e.preventDefault();
        this.startScan();
      } else if (e.key === 'Escape') {
        if (this.isScanning) this.cancelScan();
        this.closeAllMenus();
        this.closeContextMenu();
        if (this.dom.propertiesModal) this.dom.propertiesModal.classList.remove('open');
        if (this.dom.aboutModal) this.dom.aboutModal.classList.remove('open');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        if (this.selectedNode) {
          e.preventDefault();
          this.copySelectedPath();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateRow(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateRow(-1);
      } else if (e.key === 'ArrowRight') {
        if (this.selectedNode && this.selectedNode.isDirectory) {
          e.preventDefault();
          this.expandedNodes.add(this.selectedNode);
          this.renderTreeTable();
        }
      } else if (e.key === 'ArrowLeft') {
        if (this.selectedNode && this.selectedNode.isDirectory) {
          e.preventDefault();
          this.expandedNodes.delete(this.selectedNode);
          this.renderTreeTable();
        }
      } else if (e.key === 'Enter') {
        if (this.selectedNode && this.selectedNode.isDirectory) {
          e.preventDefault();
          this.treemap.zoomToNode(this.selectedNode);
          this.updateBreadcrumbs();
        }
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this.treemap.zoomOut();
        this.updateBreadcrumbs();
      }
    });
  }

  navigateRow(direction) {
    let tbody;
    if (this.activeTab === 'tree') tbody = this.dom.treeTableBody;
    else if (this.activeTab === 'files') tbody = this.dom.filesTableBody;
    else tbody = this.dom.extensionsTableBody;

    const rows = Array.from(tbody.querySelectorAll('tr:not(.empty-row)'));
    if (rows.length === 0) return;

    const currentIndex = rows.findIndex((r) => r.classList.contains('selected'));
    let nextIndex = 0;
    if (currentIndex >= 0) {
      nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + direction));
    }
    const targetRow = rows[nextIndex];
    if (targetRow) {
      targetRow.click();
      targetRow.scrollIntoView({ block: 'nearest' });
    }
  }

  initSortHeaders() {
    // Tree Grid Headers
    document.querySelectorAll('.tree-grid th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (this.treeSortCol === col) {
          this.treeSortDir = this.treeSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.treeSortCol = col;
          this.treeSortDir = col === 'name' ? 'asc' : 'desc';
        }
        this.updateHeaderIndicators('.tree-grid', this.treeSortCol, this.treeSortDir);
        this.renderTreeTable();
      });
    });

    // Files Grid Headers
    document.querySelectorAll('.files-grid th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (this.filesSortCol === col) {
          this.filesSortDir = this.filesSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.filesSortCol = col;
          this.filesSortDir = col === 'name' || col === 'extension' || col === 'path' ? 'asc' : 'desc';
        }
        this.updateHeaderIndicators('.files-grid', this.filesSortCol, this.filesSortDir);
        if (this.scanData) this.renderFilesTable(this.scanData.topFiles);
      });
    });

    // Extensions Grid Headers
    this.extSortCol = 'size';
    this.extSortDir = 'desc';
    document.querySelectorAll('.extensions-grid th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (this.extSortCol === col) {
          this.extSortDir = this.extSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.extSortCol = col;
          this.extSortDir = col === 'ext' || col === 'category' ? 'asc' : 'desc';
        }
        this.updateHeaderIndicators('.extensions-grid', this.extSortCol, this.extSortDir);
        if (this.scanData) this.renderExtensionsTable(this.scanData.extensions, this.scanData.stats.totalSize);
      });
    });
  }

  updateHeaderIndicators(selector, sortCol, sortDir) {
    document.querySelectorAll(`${selector} th.sortable`).forEach((th) => {
      const ind = th.querySelector('.sort-indicator');
      if (!ind) return;
      if (th.getAttribute('data-sort') === sortCol) {
        ind.textContent = sortDir === 'asc' ? '▲' : '▼';
      } else {
        ind.textContent = '';
      }
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    this.dom.paneTabs.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    this.dom.tabPanes.forEach((pane) => {
      const matches = pane.id === `tabContent${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`;
      pane.classList.toggle('active', matches);
    });
  }

  async loadDrives() {
    try {
      const res = await fetch('/api/drives');
      const data = await res.json();
      if (data.ok && data.drives && data.drives.length > 0) {
        this.populateDrives(data.drives);
      }
    } catch {
      // Fallback
      this.dom.pathInput.value = 'c:\\Users\\safou\\Desktop\\algerie open source';
    }
  }

  populateDrives(drives) {
    const sel = this.dom.driveSelect;
    sel.innerHTML = '';

    drives.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.path;
      const freeStr = SquarifiedTreemap.formatBytes(d.free, 1);
      const totalStr = SquarifiedTreemap.formatBytes(d.total, 1);
      opt.textContent = `${d.letter} [${freeStr} free of ${totalStr}] - ${d.name}`;
      sel.appendChild(opt);
    });

    sel.addEventListener('change', () => {
      const selected = drives.find((d) => d.path === sel.value);
      if (selected) {
        this.dom.pathInput.value = selected.path;
        this.updateDriveMeter(selected);
      }
    });

    if (drives.length > 0) {
      this.dom.pathInput.value = drives[0].path;
      this.updateDriveMeter(drives[0]);
    }
  }

  updateDriveMeter(drive) {
    if (!drive || !drive.total) {
      this.dom.driveMeterFill.style.width = '0%';
      this.dom.driveMeterText.textContent = '0%';
      return;
    }
    const usedPct = Math.round((drive.used / drive.total) * 100);
    this.dom.driveMeterFill.style.width = `${usedPct}%`;
    this.dom.driveMeterText.textContent = `${usedPct}% Used`;
  }

  async browseFolder() {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker();
        this.dom.pathInput.value = handle.name;
        // In browser-direct mode, scan client side or trigger server scan
      } catch {}
    } else {
      const input = prompt('Enter directory path to scan:', this.dom.pathInput.value);
      if (input) this.dom.pathInput.value = input;
    }
  }

  async startScan() {
    const targetPath = this.dom.pathInput.value.trim();
    if (!targetPath) return;

    this.isScanning = true;
    this.dom.scanBtn.classList.add('scanning');
    this.dom.scanBtnText.textContent = 'Scanning...';
    this.dom.cancelBtn.disabled = false;
    this.dom.cancelBtn.style.display = 'inline-flex';
    this.dom.sbState.textContent = 'Scanning in progress...';

    const startTimestamp = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTimestamp) / 1000).toFixed(2);
      this.dom.sbTime.textContent = `Time: ${elapsed}s`;
    }, 100);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, maxTopFiles: 500 })
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Scan failed');

      this.scanData = data;
      this.renderScanData(data);
    } catch (err) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      this.isScanning = false;
      clearInterval(this.timerInterval);
      this.dom.scanBtn.classList.remove('scanning');
      this.dom.scanBtnText.textContent = 'فحص (Scan)';
      this.dom.cancelBtn.disabled = true;
      this.dom.cancelBtn.style.display = 'none';
    }
  }

  async cancelScan() {
    try {
      await fetch('/api/cancel', { method: 'POST' });
    } catch {}
    this.isScanning = false;
  }

  renderScanData(data) {
    const stats = data.stats;
    const durSec = (stats.durationMs / 1000).toFixed(2);

    this.dom.sbState.textContent = `Finished in ${durSec}s`;
    this.dom.sbStats.textContent = `Files: ${stats.totalFiles.toLocaleString()} | Folders: ${stats.totalFolders.toLocaleString()}`;
    this.dom.sbScanned.textContent = `Scanned: ${SquarifiedTreemap.formatBytes(stats.totalSize)}`;
    this.dom.sbTime.textContent = `Time: ${durSec}s`;

    // 1. Treemap
    this.treemap.setData(data.tree);
    this.updateBreadcrumbs();

    // 2. Tree Grid Table
    this.expandedNodes.clear();
    if (data.tree) this.expandedNodes.add(data.tree);
    this.renderTreeTable();

    // 3. File View Table
    this.renderFilesTable(data.topFiles);

    // 4. File Extensions Table
    this.renderExtensionsTable(data.extensions, stats.totalSize);
  }

  formatSize(bytes) {
    if (this.unitMode === 'mb') {
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }
    if (this.unitMode === 'gb') {
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
    return SquarifiedTreemap.formatBytes(bytes);
  }

  sortNodes(nodes, col, dir) {
    return [...nodes].sort((a, b) => {
      let valA, valB;
      switch (col) {
        case 'name':
          valA = (a.name || '').toLowerCase();
          valB = (b.name || '').toLowerCase();
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'allocated':
          valA = a.allocatedSize || 0;
          valB = b.allocatedSize || 0;
          break;
        case 'files':
          valA = a.filesCount || 0;
          valB = b.filesCount || 0;
          break;
        case 'folders':
          valA = a.foldersCount || 0;
          valB = b.foldersCount || 0;
          break;
        case 'modified':
          valA = new Date(a.modified || 0).getTime();
          valB = new Date(b.modified || 0).getTime();
          break;
        case 'size':
        case 'pct':
        case 'total':
        default:
          valA = a.size || 0;
          valB = b.size || 0;
          break;
      }
      return dir === 'asc' ? valA - valB : valB - valA;
    });
  }

  sortFiles(files, col, dir) {
    return [...files].sort((a, b) => {
      let valA, valB;
      switch (col) {
        case 'name':
          valA = (a.name || '').toLowerCase();
          valB = (b.name || '').toLowerCase();
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'extension':
          valA = (a.extension || '').toLowerCase();
          valB = (b.extension || '').toLowerCase();
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'path':
          valA = (a.path || '').toLowerCase();
          valB = (b.path || '').toLowerCase();
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'allocated':
          valA = a.allocatedSize || 0;
          valB = b.allocatedSize || 0;
          break;
        case 'modified':
          valA = new Date(a.modified || 0).getTime();
          valB = new Date(b.modified || 0).getTime();
          break;
        case 'size':
        default:
          valA = a.size || 0;
          valB = b.size || 0;
          break;
      }
      return dir === 'asc' ? valA - valB : valB - valA;
    });
  }

  sortExtensions(exts, col, dir) {
    return [...exts].sort((a, b) => {
      let valA, valB;
      switch (col) {
        case 'ext':
          valA = (a.extension || '').toLowerCase();
          valB = (b.extension || '').toLowerCase();
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'category':
          valA = (a.category || '').toLowerCase();
          valB = (b.category || '').toLowerCase();
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'allocated':
          valA = a.allocatedSize || 0;
          valB = b.allocatedSize || 0;
          break;
        case 'count':
          valA = a.count || 0;
          valB = b.count || 0;
          break;
        case 'size':
        case 'pct':
        default:
          valA = a.size || 0;
          valB = b.size || 0;
          break;
      }
      return dir === 'asc' ? valA - valB : valB - valA;
    });
  }

  renderTreeTable() {
    const tbody = this.dom.treeTableBody;
    tbody.innerHTML = '';

    if (!this.scanData || !this.scanData.tree) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8" class="text-center text-muted">No data</td></tr>`;
      return;
    }

    const totalDriveSize = this.scanData.stats.totalSize || 1;

    const renderNodeRows = (node, depth = 0, parentSize = totalDriveSize) => {
      const tr = document.createElement('tr');
      if (this.selectedNode === node) tr.classList.add('selected');

      const isDir = node.isDirectory;
      const isExpanded = this.expandedNodes.has(node);
      const hasChildren = isDir && node.children && node.children.some((c) => c.isDirectory);

      const sizeVal = this.showAllocated ? node.allocatedSize : node.size;
      const pctOfParent = parentSize > 0 ? ((sizeVal / parentSize) * 100).toFixed(1) : '0.0';
      const pctOfTotal = totalDriveSize > 0 ? ((sizeVal / totalDriveSize) * 100).toFixed(1) : '0.0';

      const paddingLeft = depth * 18 + 6;

      tr.innerHTML = `
        <td class="col-name">
          <div class="tree-name-cell" style="padding-inline-start: ${paddingLeft}px;">
            <span class="tree-arrow ${isExpanded ? 'expanded' : ''}" style="${hasChildren ? '' : 'visibility:hidden;'}">
              ▶
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:${isDir ? '#f59e0b' : '#38bdf8'};">
              ${
                isDir
                  ? '<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"></path>'
                  : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>'
              }
            </svg>
            <span style="font-weight:600;">${node.name}</span>
          </div>
        </td>
        <td class="col-pct">
          <div class="pct-cell-wrap">
            <div class="pct-bar-track">
              <div class="pct-bar-fill" style="width: ${pctOfParent}%;"></div>
            </div>
            <span class="pct-text">${pctOfParent}%</span>
          </div>
        </td>
        <td class="col-size col-mono">${this.formatSize(node.size)}</td>
        <td class="col-allocated col-mono">${this.formatSize(node.allocatedSize)}</td>
        <td class="col-files col-mono">${isDir ? (node.filesCount || 0).toLocaleString() : '-'}</td>
        <td class="col-folders col-mono">${isDir ? (node.foldersCount || 0).toLocaleString() : '-'}</td>
        <td class="col-total col-mono">${pctOfTotal}%</td>
        <td class="col-modified col-mono">${node.modified ? new Date(node.modified).toLocaleDateString() : '-'}</td>
      `;

      // Event bindings
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.tree-arrow')) {
          if (this.expandedNodes.has(node)) {
            this.expandedNodes.delete(node);
          } else {
            this.expandedNodes.add(node);
          }
          this.renderTreeTable();
          return;
        }

        this.selectNode(node);
        if (isDir) {
          this.treemap.zoomToNode(node);
          this.updateBreadcrumbs();
        }
      });

      tr.addEventListener('dblclick', () => {
        if (isDir) {
          if (this.expandedNodes.has(node)) {
            this.expandedNodes.delete(node);
          } else {
            this.expandedNodes.add(node);
          }
          this.renderTreeTable();
        }
      });

      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openContextMenu(node, e.clientX, e.clientY);
      });

      tbody.appendChild(tr);

      // Render children if expanded
      if (isDir && isExpanded && node.children) {
        const subDirs = node.children.filter((c) => c.isDirectory);
        const sortedDirs = this.sortNodes(subDirs, this.treeSortCol, this.treeSortDir);

        for (const child of sortedDirs) {
          renderNodeRows(child, depth + 1, node.size);
        }
      }
    };

    renderNodeRows(this.scanData.tree, 0, totalDriveSize);
  }

  renderFilesTable(topFiles) {
    const tbody = this.dom.filesTableBody;
    tbody.innerHTML = '';

    if (!topFiles || topFiles.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7" class="text-center text-muted">No files</td></tr>`;
      return;
    }

    const sortedFiles = this.sortFiles(topFiles, this.filesSortCol, this.filesSortDir);

    sortedFiles.forEach((file, index) => {
      const tr = document.createElement('tr');
      if (this.selectedNode === file) tr.classList.add('selected');

      tr.innerHTML = `
        <td style="color:var(--text-muted);">${index + 1}</td>
        <td style="font-weight:600;">${file.name}</td>
        <td class="col-mono">${this.formatSize(file.size)}</td>
        <td class="col-mono">${this.formatSize(file.allocatedSize)}</td>
        <td><span class="badge">${file.extension}</span></td>
        <td class="col-mono" style="color:var(--text-secondary); max-width:280px; overflow:hidden; text-overflow:ellipsis;">${file.path}</td>
        <td class="col-mono">${file.modified ? new Date(file.modified).toLocaleDateString() : '-'}</td>
      `;

      tr.addEventListener('click', () => {
        this.selectNode(file);
      });

      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openContextMenu(file, e.clientX, e.clientY);
      });

      tbody.appendChild(tr);
    });
  }

  renderExtensionsTable(extensions, totalSize) {
    const tbody = this.dom.extensionsTableBody;
    tbody.innerHTML = '';

    if (!extensions || extensions.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7" class="text-center text-muted">No extensions</td></tr>`;
      return;
    }

    const sortedExts = this.sortExtensions(extensions, this.extSortCol || 'size', this.extSortDir || 'desc');

    sortedExts.forEach((ext) => {
      const tr = document.createElement('tr');
      const pct = totalSize > 0 ? ((ext.size / totalSize) * 100).toFixed(1) : '0.0';
      const catColor = SquarifiedTreemap.CATEGORY_COLORS[ext.category] || SquarifiedTreemap.CATEGORY_COLORS.other;

      tr.innerHTML = `
        <td style="font-weight:700;">${ext.extension}</td>
        <td><span class="legend-dot" style="background:${catColor.bg}; display:inline-block;"></span></td>
        <td style="color:var(--text-secondary);">${ext.category}</td>
        <td class="col-mono">${this.formatSize(ext.size)}</td>
        <td class="col-mono">${this.formatSize(ext.allocatedSize)}</td>
        <td>
          <div class="pct-cell-wrap">
            <div class="pct-bar-track">
              <div class="pct-bar-fill" style="width:${pct}%; background:${catColor.bg};"></div>
            </div>
            <span class="pct-text">${pct}%</span>
          </div>
        </td>
        <td class="col-mono">${ext.count.toLocaleString()}</td>
      `;

      tr.addEventListener('click', () => {
        document.querySelectorAll('.extensions-grid tr').forEach((r) => r.classList.remove('selected'));
        tr.classList.add('selected');
        this.treemap.setExtensionHighlight(ext.extension);
      });

      tbody.appendChild(tr);
    });
  }

  exportHtmlReport() {
    if (!this.scanData) {
      alert('الرجاء بدء فحص مسار أو قرص أولاً قبل إنشاء التقرير.');
      return;
    }
    const { stats, topFiles, extensions } = this.scanData;
    const treemapImg = this.dom.treemapCanvas.toDataURL('image/png');
    const scanDate = new Date().toLocaleString();
    const durSec = (stats.durationMs / 1000).toFixed(2);

    const reportHtml = `<!DOCTYPE html>
<html lang="${this.currentLang}" dir="${this.currentLang === 'ar' ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8">
  <title>DZ-DiskTree Audit Report — ${this.dom.pathInput.value}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #1e293b; padding: 24px; margin: 0; }
    h1 { font-size: 20px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; }
    .badge { background: #0284c7; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: normal; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .meta-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
    .meta-label { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .meta-val { font-size: 18px; font-weight: bold; color: #0f172a; margin-top: 4px; font-family: monospace; }
    .section-title { font-size: 15px; font-weight: 700; margin: 24px 0 10px 0; color: #0f172a; border-inline-start: 4px solid #0284c7; padding-inline-start: 8px; }
    .treemap-img-wrap { border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 24px; text-align: center; }
    .treemap-img { max-width: 100%; height: auto; display: block; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th { background: #f1f5f9; padding: 8px; text-align: start; border: 1px solid #e2e8f0; font-weight: 600; color: #475569; }
    td { padding: 6px 8px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 11px; }
    .pct-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; width: 100px; display: inline-block; vertical-align: middle; margin-inline-end: 6px; }
    .pct-fill { height: 100%; background: #0284c7; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
      @page { margin: 1.5cm; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 16px; display: flex; justify-content: flex-end; gap: 8px;">
    <button onclick="window.print()" style="background:#0284c7; color:#fff; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:bold;">طباعة التقرير (Print Report)</button>
  </div>
  <h1>
    <span>DZ-DiskTree — تقرير تدقيق وتحليل سعة القرص</span>
    <span class="badge">Algerie Open Source</span>
  </h1>
  <div class="meta-grid">
    <div class="meta-card"><div class="meta-label">المسار المفحوص</div><div class="meta-val" style="font-size:13px; word-break:break-all;">${this.dom.pathInput.value}</div></div>
    <div class="meta-card"><div class="meta-label">إجمالي السعة المفحوصة</div><div class="meta-val">${SquarifiedTreemap.formatBytes(stats.totalSize)}</div></div>
    <div class="meta-card"><div class="meta-label">إجمالي الملفات / المجلدات</div><div class="meta-val">${stats.totalFiles.toLocaleString()} / ${stats.totalFolders.toLocaleString()}</div></div>
    <div class="meta-card"><div class="meta-label">زمن الفحص / التاريخ</div><div class="meta-val">${durSec}s | ${scanDate}</div></div>
  </div>

  <div class="section-title">المخطط البياني التفاعلي للسعة (Cushioned Treemap Snapshot)</div>
  <div class="treemap-img-wrap">
    <img class="treemap-img" src="${treemapImg}" alt="Disk Treemap Snapshot" />
  </div>

  <div class="section-title">توزيع الاستهلاك حسب نوع الملف (File Types Breakdown)</div>
  <table>
    <thead><tr><th>الامتداد</th><th>التصنيف</th><th>الحجم</th><th>المحجوز</th><th>النسبة من الإجمالي</th><th>عدد الملفات</th></tr></thead>
    <tbody>
      ${(extensions || []).slice(0, 15).map(ext => {
        const pct = stats.totalSize > 0 ? ((ext.size / stats.totalSize) * 100).toFixed(1) : 0;
        return `<tr>
          <td><strong>${ext.extension}</strong></td>
          <td>${ext.category}</td>
          <td>${SquarifiedTreemap.formatBytes(ext.size)}</td>
          <td>${SquarifiedTreemap.formatBytes(ext.allocatedSize)}</td>
          <td><div class="pct-bar"><div class="pct-fill" style="width:${pct}%"></div></div> ${pct}%</td>
          <td>${ext.count.toLocaleString()}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <div class="section-title" style="page-break-before: always;">أكبر 25 ملف مستهلك للمساحة (Top 25 Largest Files)</div>
  <table>
    <thead><tr><th>#</th><th>اسم الملف</th><th>الحجم</th><th>المحجوز</th><th>النوع</th><th>المسار الكامل</th><th>تاريخ التعديل</th></tr></thead>
    <tbody>
      ${(topFiles || []).slice(0, 25).map((f, i) => `<tr>
        <td>${i + 1}</td>
        <td><strong>${f.name}</strong></td>
        <td>${SquarifiedTreemap.formatBytes(f.size)}</td>
        <td>${SquarifiedTreemap.formatBytes(f.allocatedSize)}</td>
        <td>${f.extension}</td>
        <td style="word-break:break-all;">${f.path}</td>
        <td>${f.modified ? new Date(f.modified).toLocaleDateString() : '-'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`;

    const printWin = window.open('', '_blank');
    if (printWin) {
      printWin.document.write(reportHtml);
      printWin.document.close();
      printWin.focus();
    }
  }

  selectNode(node) {
    this.selectedNode = node;
    this.treemap.selectNode(node);

    // Update status bar
    const t = I18N[this.currentLang];
    this.dom.sbSelected.textContent = `${t.selectedItem}: ${node.name} (${SquarifiedTreemap.formatBytes(node.size)})`;

    // Highlight row in active table
    document.querySelectorAll('.wiz-grid-table tbody tr').forEach((tr) => tr.classList.remove('selected'));
  }

  updateBreadcrumbs() {
    const container = this.dom.treemapBreadcrumbs;
    container.innerHTML = '';

    this.treemap.breadcrumbTrail.forEach((item, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.style.color = 'var(--text-muted)';
        sep.textContent = '>';
        container.appendChild(sep);
      }

      const crumb = document.createElement('span');
      crumb.className = `crumb-item ${idx === this.treemap.breadcrumbTrail.length - 1 ? 'active' : ''}`;
      crumb.textContent = item.name || '/';

      crumb.addEventListener('click', () => {
        this.treemap.currentNode = item;
        this.treemap.breadcrumbTrail = this.treemap.breadcrumbTrail.slice(0, idx + 1);
        this.treemap.render();
        this.updateBreadcrumbs();
      });

      container.appendChild(crumb);
    });
  }

  showTreemapTooltip(node, event) {
    const tip = this.dom.treemapTooltip;
    if (!node) {
      tip.style.display = 'none';
      return;
    }

    const curTotal = (this.treemap.currentNode && this.treemap.currentNode.size) || 1;
    const pct = ((node.size / curTotal) * 100).toFixed(1);

    tip.innerHTML = `
      <div class="wiz-tooltip-title">${node.name}</div>
      <div class="wiz-tooltip-row">
        <span class="wiz-tooltip-label">Path:</span>
        <span class="wiz-tooltip-val" style="word-break:break-all;">${node.path}</span>
      </div>
      <div class="wiz-tooltip-row">
        <span class="wiz-tooltip-label">Size:</span>
        <span class="wiz-tooltip-val">${SquarifiedTreemap.formatBytes(node.size)}</span>
      </div>
      <div class="wiz-tooltip-row">
        <span class="wiz-tooltip-label">Allocated:</span>
        <span class="wiz-tooltip-val">${SquarifiedTreemap.formatBytes(node.allocatedSize)}</span>
      </div>
      <div class="wiz-tooltip-row">
        <span class="wiz-tooltip-label">% of Root:</span>
        <span class="wiz-tooltip-val">${pct}%</span>
      </div>
      ${
        node.isDirectory
          ? `<div class="wiz-tooltip-row"><span class="wiz-tooltip-label">Files:</span><span class="wiz-tooltip-val">${(node.filesCount || 0).toLocaleString()}</span></div>`
          : ''
      }
    `;

    tip.style.display = 'block';

    const rect = this.dom.treemapCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left + 15;
    const y = event.clientY - rect.top + 15;

    tip.style.left = `${Math.min(x, rect.width - 320)}px`;
    tip.style.top = `${Math.min(y, rect.height - 180)}px`;
  }

  filterTables(query) {
    const q = query.toLowerCase();
    // Filter Top Files rows
    document.querySelectorAll('.files-grid tbody tr:not(.empty-row)').forEach((tr) => {
      const text = tr.textContent.toLowerCase();
      tr.style.display = text.includes(q) ? '' : 'none';
    });
  }

  filterByExtension(ext) {
    this.treemap.setExtensionHighlight(ext);
    this.dom.quickFilterInput.value = `*${ext}`;
    this.dom.clearFilterBtn.style.display = 'block';
  }

  filterByCategory(cat) {
    const exts = Object.entries(SquarifiedTreemap.EXTENSION_MAP)
      .filter(([_, c]) => c === cat)
      .map(([e]) => e);

    if (exts.length > 0) {
      this.dom.quickFilterInput.value = exts.slice(0, 3).map((e) => `*.${e}`).join(' ');
      this.dom.clearFilterBtn.style.display = 'block';
    }
  }

  copySelectedPath() {
    if (this.selectedNode && this.selectedNode.path) {
      navigator.clipboard.writeText(this.selectedNode.path);
      this.dom.sbState.textContent = 'Path copied to clipboard!';
    }
  }

  copySelectedName() {
    if (this.selectedNode && this.selectedNode.name) {
      navigator.clipboard.writeText(this.selectedNode.name);
      this.dom.sbState.textContent = 'Name copied to clipboard!';
    }
  }

  openPropertiesModal(node) {
    if (!node) return;
    this.dom.propTitle.textContent = `Properties: ${node.name}`;
    this.dom.propName.textContent = node.name;
    this.dom.propType.textContent = node.isDirectory ? 'File folder' : `${node.extension || 'File'}`;
    this.dom.propPath.textContent = node.path;
    this.dom.propSize.textContent = `${SquarifiedTreemap.formatBytes(node.size)} (${node.size.toLocaleString()} bytes)`;
    this.dom.propAllocated.textContent = `${SquarifiedTreemap.formatBytes(node.allocatedSize)} (${node.allocatedSize.toLocaleString()} bytes)`;

    if (node.isDirectory) {
      this.dom.propContainsRow.style.display = 'flex';
      this.dom.propContains.textContent = `${(node.filesCount || 0).toLocaleString()} Files, ${(node.foldersCount || 0).toLocaleString()} Folders`;
    } else {
      this.dom.propContainsRow.style.display = 'none';
    }

    this.dom.propModified.textContent = node.modified ? new Date(node.modified).toLocaleString() : '-';
    this.dom.propertiesModal.classList.add('open');
  }

  exportCsv() {
    if (!this.scanData) return;
    let csv = 'Type,Name,Path,Size,AllocatedSize,Extension,Modified\n';
    const dump = (node) => {
      csv += `"${node.isDirectory ? 'Folder' : 'File'}","${node.name}","${node.path}",${node.size},${node.allocatedSize},"${node.extension || ''}","${node.modified || ''}"\n`;
      if (node.children) {
        for (const child of node.children) dump(child);
      }
    };
    dump(this.scanData.tree);
    this.downloadFile(csv, 'text/csv', 'dz_disktree_export.csv');
  }

  openDuplicateFinder() {
    const root = this.scanData?.tree;
    if (!root) {
      alert(this.currentLang === 'ar' ? 'يرجى إجراء فحص لمجلد أو قرص أولاً!' : 'Veuillez effectuer une analyse d\'abord!');
      return;
    }

    const modal = document.getElementById('duplicateModal');
    const container = document.getElementById('dupResultsContainer');
    const summaryCount = document.getElementById('dupSummaryCount');
    const summaryWaste = document.getElementById('dupSummaryWaste');

    // Collect all leaf files from root
    const allFiles = [];
    function collectFiles(node) {
      if (!node) return;
      if (!node.isDirectory) {
        if ((node.size || 0) > 1024) {
          allFiles.push(node);
        }
      } else if (node.children && node.children.length) {
        node.children.forEach(collectFiles);
      }
    }
    collectFiles(root);

    // Group files by size
    const sizeGroups = new Map();
    allFiles.forEach(f => {
      const s = f.size || 0;
      if (!sizeGroups.has(s)) {
        sizeGroups.set(s, []);
      }
      sizeGroups.get(s).push(f);
    });

    // Keep only groups with > 1 file
    this.duplicateGroups = [];
    let totalWasteBytes = 0;
    let totalDuplicateFiles = 0;

    for (const [size, files] of sizeGroups.entries()) {
      if (files.length > 1) {
        this.duplicateGroups.push({ size, files });
        totalWasteBytes += size * (files.length - 1);
        totalDuplicateFiles += files.length;
      }
    }

    this.duplicateGroups.sort((a, b) => b.size - a.size);

    summaryCount.textContent = this.currentLang === 'ar' 
      ? `تم العثور على ${this.duplicateGroups.length} مجموعة ملفات متطابقة (${totalDuplicateFiles} ملف)`
      : `${this.duplicateGroups.length} groupes de fichiers identiques (${totalDuplicateFiles} fichiers)`;
    summaryWaste.textContent = this.currentLang === 'ar'
      ? `المساحة المهدورة المتوقعة: ${this.formatBytes(totalWasteBytes)}`
      : `Espace gaspillé estimé: ${this.formatBytes(totalWasteBytes)}`;

    if (this.duplicateGroups.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:32px; color:var(--text-muted);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin:0 auto 12px; display:block; color:#16a34a;"><polyline points="20 6 9 17 4 12"/></svg>
          <div style="font-weight:700; color:var(--text-primary);">${this.currentLang === 'ar' ? 'ممتاز! لم يتم العثور على ملفات مكررة في هذا المسار.' : 'Aucun fichier dupliqué trouvé.'}</div>
        </div>
      `;
    } else {
      let html = '';
      this.duplicateGroups.slice(0, 100).forEach((grp, idx) => {
        html += `
          <div style="margin-bottom:12px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:6px; padding:10px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-weight:700; font-size:12px;">
              <span>#${idx + 1} — ${grp.files.length} ${this.currentLang === 'ar' ? 'نسخ مكررة بحجم' : 'copies de taille'} ${this.formatBytes(grp.size)}</span>
              <span style="color:#ef4444;">${this.formatBytes(grp.size * (grp.files.length - 1))} ${this.currentLang === 'ar' ? 'مهدر' : 'perdu'}</span>
            </div>
            <ul style="list-style:none; padding:0; margin:0; font-size:11px; font-family:monospace; color:var(--text-secondary);">
              ${grp.files.map(f => `
                <li style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-top:1px dashed var(--border-color);">
                  <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:620px;" title="${f.path}">${f.path}</span>
                  <button class="btn-copy-dup-path btn-tb" data-path="${f.path}" style="padding:2px 8px; font-size:10px;">${this.currentLang === 'ar' ? 'نسخ' : 'Copier'}</button>
                </li>
              `).join('')}
            </ul>
          </div>
        `;
      });
      container.innerHTML = html;

      container.querySelectorAll('.btn-copy-dup-path').forEach(btn => {
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(btn.dataset.path);
          btn.textContent = this.currentLang === 'ar' ? 'تم!' : 'Copié!';
          setTimeout(() => {
            btn.textContent = this.currentLang === 'ar' ? 'نسخ' : 'Copier';
          }, 1500);
        });
      });
    }

    modal.classList.add('open');
  }

  exportDuplicatesCsv() {
    if (!this.duplicateGroups || !this.duplicateGroups.length) {
      alert(this.currentLang === 'ar' ? 'لا توجد بيانات تكرار لتصديرها!' : 'Aucun doublon à exporter!');
      return;
    }
    let csv = 'GroupId,Size,Bytes,FileName,Path\n';
    this.duplicateGroups.forEach((grp, idx) => {
      grp.files.forEach(f => {
        csv += `${idx + 1},"${this.formatBytes(grp.size)}",${grp.size},"${f.name}","${f.path}"\n`;
      });
    });
    this.downloadFile(csv, 'text/csv', 'dz_disktree_duplicates.csv');
  }

  exportJson() {
    if (!this.scanData) return;
    const jsonStr = JSON.stringify(this.scanData, null, 2);
    this.downloadFile(jsonStr, 'application/json', 'dz_disktree_report.json');
  }

  saveTreemapImage() {
    if (!this.dom.treemapCanvas) return;
    const dataUrl = this.dom.treemapCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'treemap_snapshot.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  downloadFile(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.dzDiskTree = new DiskTreeApp();
});
