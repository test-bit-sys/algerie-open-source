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

    // View Menu
    document.getElementById('viewShowTree')?.addEventListener('click', () => this.switchTab('tree'));
    document.getElementById('viewShowFiles')?.addEventListener('click', () => this.switchTab('files'));
    document.getElementById('viewShowExtensions')?.addEventListener('click', () => this.switchTab('extensions'));
    document.getElementById('viewToggleTreemap')?.addEventListener('click', () => this.toggleMaximizeTreemap());
    document.getElementById('viewToggleTheme')?.addEventListener('click', () => {
      this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    });

    // Modal closes
    this.dom.propCloseBtn?.addEventListener('click', () => this.dom.propertiesModal.classList.remove('open'));
    this.dom.aboutCloseBtn?.addEventListener('click', () => this.dom.aboutModal.classList.remove('open'));
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

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'F5') {
        e.preventDefault();
        this.startScan();
      } else if (e.key === 'Escape') {
        if (this.isScanning) this.cancelScan();
        this.closeAllMenus();
        this.closeContextMenu();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        if (this.selectedNode) {
          e.preventDefault();
          this.copySelectedPath();
        }
      }
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    this.dom.paneTabs.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    this.dom.tabPanels.forEach((pane) => {
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
        <td class="col-size col-mono">${SquarifiedTreemap.formatBytes(node.size)}</td>
        <td class="col-allocated col-mono">${SquarifiedTreemap.formatBytes(node.allocatedSize)}</td>
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
        // Show subdirectories first, sorted by size descending
        const subDirs = node.children
          .filter((c) => c.isDirectory)
          .sort((a, b) => b.size - a.size);

        for (const child of subDirs) {
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

    topFiles.forEach((file, index) => {
      const tr = document.createElement('tr');
      if (this.selectedNode === file) tr.classList.add('selected');

      tr.innerHTML = `
        <td style="color:var(--text-muted);">${index + 1}</td>
        <td style="font-weight:600;">${file.name}</td>
        <td class="col-mono">${SquarifiedTreemap.formatBytes(file.size)}</td>
        <td class="col-mono">${SquarifiedTreemap.formatBytes(file.allocatedSize)}</td>
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

    extensions.forEach((ext) => {
      const tr = document.createElement('tr');
      const pct = totalSize > 0 ? ((ext.size / totalSize) * 100).toFixed(1) : '0.0';
      const catColor = SquarifiedTreemap.CATEGORY_COLORS[ext.category] || SquarifiedTreemap.CATEGORY_COLORS.other;

      tr.innerHTML = `
        <td style="font-weight:700;">${ext.extension}</td>
        <td><span class="legend-dot" style="background:${catColor.bg}; display:inline-block;"></span></td>
        <td style="color:var(--text-secondary);">${ext.category}</td>
        <td class="col-mono">${SquarifiedTreemap.formatBytes(ext.size)}</td>
        <td class="col-mono">${SquarifiedTreemap.formatBytes(ext.allocatedSize)}</td>
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
