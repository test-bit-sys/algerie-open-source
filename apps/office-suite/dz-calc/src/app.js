/**
 * DZ-Calc (DZ-Sheets / جداول الجزائر) — Interactive Spreadsheet Application
 * 100% Offline-First, Zero-Dependency, Native Desktop Data Grid
 */

import { FormulaEngine, parseCellAddress, colToLetter } from './formula-engine.js';
import { SPREADSHEET_TEMPLATES } from './templates.js';

const I18N = {
  ar: {
    appTitle: 'جداول الجزائر — جداول البيانات والمحاسبة',
    untitledSheet: 'جدول بيانات بدون عنوان',
    file: 'ملف',
    edit: 'تعديل',
    insert: 'إدراج',
    format: 'تنسيق',
    data: 'بيانات',
    tools: 'أدوات',
    help: 'مساعدة',
    newSheet: 'جدول جديد',
    openSheet: 'فتح جدول...',
    saveSheet: 'حفظ (Ctrl+S)',
    exportCsv: 'تصدير كـ CSV',
    exportJson: 'تصدير كـ DZ-Sheet',
    printPdf: 'طباعة / تصدير PDF',
    undo: 'تراجع',
    redo: 'إعادة',
    cut: 'قص',
    copy: 'نسخ',
    paste: 'لصق',
    bold: 'عريض',
    italic: 'مائل',
    underline: 'تسطير',
    alignLeft: 'محاذاة لليسار',
    alignCenter: 'محاذاة للوسط',
    alignRight: 'محاذاة لليمين',
    formatGeneral: 'عام',
    formatNumber: 'رقم',
    formatCurrency: 'دينار جزائري (دج)',
    formatPercent: 'نسبة مئوية (%)',
    insertChart: 'إنشاء مخطط بياني',
    templates: 'النماذج المحاسبية',
    sum: 'المجموع:',
    avg: 'المتوسط:',
    count: 'العدد:',
    min: 'الأدنى:',
    max: 'الأقصى:',
    ready: 'جاهز',
    templatesTitle: 'النماذج المحاسبية والمالية الجاهزة',
    chartTitle: 'المخطط البياني للبيانات المحددة',
    chartType: 'نوع المخطط:',
    barChart: 'أعمدة بيانية (Bar Chart)',
    lineChart: 'خط بياني (Line Chart)',
    pieChart: 'مخطط دائري (Pie Chart)',
    aboutTitle: 'عن جداول الجزائر (DZ-Calc)',
    aboutDesc: 'جدول بيانات محاسبي مكتبي حر ومفتوح المصدر 100% جزائري، بديل متقدم لمايكروسوفت إكسل مع دوال الجباية الوطنية والتفقيط وحساب الأجور.',
    close: 'إغلاق'
  },
  fr: {
    appTitle: 'DZ-Sheets — Tableur & Feuilles de Calcul',
    untitledSheet: 'Feuille sans titre',
    file: 'Fichier',
    edit: 'Édition',
    insert: 'Insertion',
    format: 'Format',
    data: 'Données',
    tools: 'Outils',
    help: 'Aide',
    newSheet: 'Nouvelle feuille',
    openSheet: 'Ouvrir une feuille...',
    saveSheet: 'Enregistrer (Ctrl+S)',
    exportCsv: 'Exporter en CSV',
    exportJson: 'Exporter en DZ-Sheet',
    printPdf: 'Imprimer / Exporter PDF',
    undo: 'Annuler',
    redo: 'Rétablir',
    cut: 'Couper',
    copy: 'Copier',
    paste: 'Coller',
    bold: 'Gras',
    italic: 'Italique',
    underline: 'Souligné',
    alignLeft: 'Aligner à gauche',
    alignCenter: 'Centrer',
    alignRight: 'Aligner à droite',
    formatGeneral: 'Standard',
    formatNumber: 'Nombre',
    formatCurrency: 'Dinar Algérien (DZD)',
    formatPercent: 'Pourcentage (%)',
    insertChart: 'Créer un graphique',
    templates: 'Modèles financiers',
    sum: 'Somme :',
    avg: 'Moyenne :',
    count: 'Nombre :',
    min: 'Min :',
    max: 'Max :',
    ready: 'Prêt',
    templatesTitle: 'Modèles financiers et comptables algériens',
    chartTitle: 'Graphique des données sélectionnées',
    chartType: 'Type de graphique :',
    barChart: 'Histogramme (Barres)',
    lineChart: 'Ligne chronologique',
    pieChart: 'Secteurs (Camembert)',
    aboutTitle: 'À propos de DZ-Sheets',
    aboutDesc: 'Tableur de bureau 100% open source souverain, alternative légère et complète à Microsoft Excel avec intégration fiscale algérienne.',
    close: 'Fermer'
  },
  en: {
    appTitle: 'DZ-Sheets — Sovereign Open-Source Spreadsheet',
    untitledSheet: 'Untitled Spreadsheet',
    file: 'File',
    edit: 'Edit',
    insert: 'Insert',
    format: 'Format',
    data: 'Data',
    tools: 'Tools',
    help: 'Help',
    newSheet: 'New Spreadsheet',
    openSheet: 'Open Spreadsheet...',
    saveSheet: 'Save (Ctrl+S)',
    exportCsv: 'Export as CSV',
    exportJson: 'Export as DZ-Sheet',
    printPdf: 'Print / Export PDF',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    alignLeft: 'Align Left',
    alignCenter: 'Align Center',
    alignRight: 'Align Right',
    formatGeneral: 'General',
    formatNumber: 'Number',
    formatCurrency: 'Algerian Dinar (DZD)',
    formatPercent: 'Percentage (%)',
    insertChart: 'Insert Chart',
    templates: 'Financial Templates',
    sum: 'Sum:',
    avg: 'Average:',
    count: 'Count:',
    min: 'Min:',
    max: 'Max:',
    ready: 'Ready',
    templatesTitle: 'Pre-built Financial & Accounting Templates',
    chartTitle: 'Data Visualization Chart',
    chartType: 'Chart Type:',
    barChart: 'Bar Chart',
    lineChart: 'Line Chart',
    pieChart: 'Pie Chart',
    aboutTitle: 'About DZ-Sheets',
    aboutDesc: '100% offline-first, sovereign open-source spreadsheet and Microsoft Excel / Google Sheets alternative with Algerian fiscal & payroll formulas.',
    close: 'Close'
  }
};

export class DZCalcApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_calc_lang') || 'ar';
    this.sheetTitle = I18N[this.currentLang].untitledSheet;
    this.colsCount = 26; // A through Z
    this.rowsCount = 60; // 60 rows
    this.cells = {}; // 'A1': { val: '', style: {} }
    this.activeCell = 'A1';
    this.selectionRange = ['A1'];
    this.isMouseDown = false;
    this.clipboard = null;

    this.formulaEngine = new FormulaEngine((c, r) => {
      const addr = `${colToLetter(c)}${r + 1}`;
      const cell = this.cells[addr];
      if (!cell) return '';
      if (typeof cell.val === 'string' && cell.val.startsWith('=')) {
        return this.formulaEngine.evaluate(cell.val);
      }
      return cell.val;
    });

    this.init();
  }

  init() {
    this.buildGridDOM();
    this.bindEvents();
    this.applyLanguage(this.currentLang);
    this.loadTemplate(SPREADSHEET_TEMPLATES[0]); // default: payroll sheet
  }

  buildGridDOM() {
    const table = document.getElementById('sheetTable');
    if (!table) return;
    table.innerHTML = '';

    // Thead (Columns header: #, A, B, C...)
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    // Top-left corner cell
    const cornerTh = document.createElement('th');
    cornerTh.className = 'grid-corner-cell';
    headerRow.appendChild(cornerTh);

    for (let c = 0; c < this.colsCount; c++) {
      const colLetter = colToLetter(c);
      const th = document.createElement('th');
      th.className = 'col-header-cell';
      th.dataset.col = c;
      th.textContent = colLetter;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Tbody (Rows: 1, 2, 3...)
    const tbody = document.createElement('tbody');
    for (let r = 0; r < this.rowsCount; r++) {
      const row = document.createElement('tr');
      
      // Row header cell (#)
      const rowTh = document.createElement('th');
      rowTh.className = 'row-header-cell';
      rowTh.dataset.row = r;
      rowTh.textContent = r + 1;
      row.appendChild(rowTh);

      for (let c = 0; c < this.colsCount; c++) {
        const addr = `${colToLetter(c)}${r + 1}`;
        const td = document.createElement('td');
        td.className = 'grid-cell';
        td.dataset.addr = addr;
        td.dataset.col = c;
        td.dataset.row = r;
        td.tabIndex = 0;
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
  }

  bindEvents() {
    const table = document.getElementById('sheetTable');
    const formulaInput = document.getElementById('formulaInput');
    const cellAddrBadge = document.getElementById('activeCellAddress');

    // Cell Selection & Click
    table.addEventListener('mousedown', (e) => {
      const td = e.target.closest('.grid-cell');
      if (td) {
        this.isMouseDown = true;
        const addr = td.dataset.addr;
        if (!e.shiftKey) {
          this.setActiveCell(addr);
        } else {
          this.expandSelectionTo(addr);
        }
      }
    });

    table.addEventListener('mouseover', (e) => {
      if (this.isMouseDown) {
        const td = e.target.closest('.grid-cell');
        if (td) {
          this.expandSelectionTo(td.dataset.addr);
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    // Double-click cell to edit directly
    table.addEventListener('dblclick', (e) => {
      const td = e.target.closest('.grid-cell');
      if (td) {
        this.startInlineEdit(td);
      }
    });

    // Formula Input bar binding
    if (formulaInput) {
      formulaInput.addEventListener('input', (e) => {
        if (!this.cells[this.activeCell]) this.cells[this.activeCell] = { val: '' };
        this.cells[this.activeCell].val = e.target.value;
        this.renderAllCells();
        this.updateStats();
      });

      formulaInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.moveActiveCell(0, 1);
        }
      });
    }

    // Keyboard navigation in grid
    table.addEventListener('keydown', (e) => {
      if (e.target.isContentEditable) return; // Typing inside cell
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          this.moveActiveCell(0, -1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.moveActiveCell(0, 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.moveActiveCell(this.currentLang === 'ar' ? 1 : -1, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.moveActiveCell(this.currentLang === 'ar' ? -1 : 1, 0);
          break;
        case 'Tab':
          e.preventDefault();
          this.moveActiveCell(e.shiftKey ? -1 : 1, 0);
          break;
        case 'Enter':
          e.preventDefault();
          this.moveActiveCell(0, e.shiftKey ? -1 : 1);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          this.clearSelection();
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            const td = document.querySelector(`td[data-addr="${this.activeCell}"]`);
            if (td) {
              this.startInlineEdit(td, e.key);
            }
          }
          break;
      }
    });

    // Toolbar formatting actions
    document.getElementById('btnBold')?.addEventListener('click', () => this.toggleStyle('bold'));
    document.getElementById('btnItalic')?.addEventListener('click', () => this.toggleStyle('italic'));
    document.getElementById('btnUnderline')?.addEventListener('click', () => this.toggleStyle('underline'));

    document.getElementById('btnAlignLeft')?.addEventListener('click', () => this.setStyle('align', 'left'));
    document.getElementById('btnAlignCenter')?.addEventListener('click', () => this.setStyle('align', 'center'));
    document.getElementById('btnAlignRight')?.addEventListener('click', () => this.setStyle('align', 'right'));

    document.getElementById('cellTextColor')?.addEventListener('input', (e) => this.setStyle('color', e.target.value));
    document.getElementById('cellBgColor')?.addEventListener('input', (e) => this.setStyle('bg', e.target.value));
    
    document.getElementById('formatSelect')?.addEventListener('change', (e) => this.setStyle('format', e.target.value));

    // File operations
    document.getElementById('btnNewSheet')?.addEventListener('click', () => this.newSpreadsheet());
    document.getElementById('btnSaveSheet')?.addEventListener('click', () => this.saveSpreadsheet());
    document.getElementById('btnExportCsv')?.addEventListener('click', () => this.exportCsv());
    document.getElementById('btnPrintPdf')?.addEventListener('click', () => window.print());

    const openInput = document.getElementById('sheetFileInput');
    document.getElementById('btnOpenSheetFile')?.addEventListener('click', () => openInput?.click());
    openInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.openSpreadsheetFile(e.target.files[0]);
      }
      openInput.value = '';
    });

    // Chart Modal
    document.getElementById('btnOpenChart')?.addEventListener('click', () => this.openChartModal());
    document.getElementById('chartTypeSelect')?.addEventListener('change', () => this.renderChart());

    // Templates Modal
    document.getElementById('btnOpenTemplates')?.addEventListener('click', () => {
      document.getElementById('modalTemplates')?.classList.add('active');
    });

    // About Modal
    document.getElementById('btnOpenAbout')?.addEventListener('click', () => {
      document.getElementById('modalAbout')?.classList.add('active');
    });

    // Title edit
    document.getElementById('sheetTitleInput')?.addEventListener('input', (e) => {
      this.sheetTitle = e.target.value.trim() || I18N[this.currentLang].untitledSheet;
      document.title = `${this.sheetTitle} — DZ-Sheets`;
    });

    // Language switcher
    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setLanguage(btn.getAttribute('data-lang'));
      });
    });

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          this.saveSpreadsheet();
        } else if (e.key.toLowerCase() === 'c') {
          this.copySelection();
        } else if (e.key.toLowerCase() === 'v') {
          this.pasteSelection();
        }
      }
    });

    this.populateTemplates();
  }

  setActiveCell(addr) {
    this.activeCell = addr;
    this.selectionRange = [addr];
    this.updateSelectionHighlight();
    this.updateFormulaBar();
    this.updateStats();

    const td = document.querySelector(`td[data-addr="${addr}"]`);
    if (td) td.focus();
  }

  expandSelectionTo(targetAddr) {
    const start = parseCellAddress(this.activeCell);
    const end = parseCellAddress(targetAddr);
    if (!start || !end) return;

    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);

    const range = [];
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        range.push(`${colToLetter(c)}${r + 1}`);
      }
    }
    this.selectionRange = range;
    this.updateSelectionHighlight();
    this.updateStats();
  }

  moveActiveCell(dCol, dRow) {
    const cur = parseCellAddress(this.activeCell);
    if (!cur) return;
    const nextCol = Math.max(0, Math.min(this.colsCount - 1, cur.col + dCol));
    const nextRow = Math.max(0, Math.min(this.rowsCount - 1, cur.row + dRow));
    const nextAddr = `${colToLetter(nextCol)}${nextRow + 1}`;
    this.setActiveCell(nextAddr);
  }

  updateSelectionHighlight() {
    document.querySelectorAll('.grid-cell.selected').forEach(td => td.classList.remove('selected', 'active'));
    this.selectionRange.forEach(addr => {
      const td = document.querySelector(`td[data-addr="${addr}"]`);
      if (td) td.classList.add('selected');
    });
    const activeTd = document.querySelector(`td[data-addr="${this.activeCell}"]`);
    if (activeTd) activeTd.classList.add('active');

    // Update active cell badge in formula bar
    const badge = document.getElementById('activeCellAddress');
    if (badge) badge.textContent = this.activeCell;
  }

  updateFormulaBar() {
    const formulaInput = document.getElementById('formulaInput');
    if (!formulaInput) return;
    const cell = this.cells[this.activeCell];
    formulaInput.value = cell ? (cell.val ?? '') : '';
  }

  startInlineEdit(td, initialChar = null) {
    td.contentEditable = 'true';
    const cell = this.cells[this.activeCell];
    const rawVal = cell ? (cell.val ?? '') : '';
    td.textContent = initialChar != null ? initialChar : rawVal;

    // Focus & place caret at end
    td.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(td);
    sel.collapseToEnd();

    const finishEdit = () => {
      td.contentEditable = 'false';
      const newVal = td.textContent.trim();
      if (!this.cells[this.activeCell]) this.cells[this.activeCell] = { val: '' };
      this.cells[this.activeCell].val = newVal;
      this.renderAllCells();
      this.updateFormulaBar();
      this.updateStats();
      td.removeEventListener('blur', finishEdit);
      td.removeEventListener('keydown', keyHandler);
    };

    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEdit();
        this.moveActiveCell(0, 1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        finishEdit();
        this.moveActiveCell(1, 0);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        td.contentEditable = 'false';
        this.renderCell(td, this.activeCell);
      }
    };

    td.addEventListener('blur', finishEdit);
    td.addEventListener('keydown', keyHandler);
  }

  renderAllCells() {
    document.querySelectorAll('.grid-cell').forEach(td => {
      const addr = td.dataset.addr;
      this.renderCell(td, addr);
    });
  }

  renderCell(td, addr) {
    const cell = this.cells[addr];
    if (!cell || cell.val === '' || cell.val == null) {
      td.textContent = '';
      td.style.fontWeight = 'normal';
      td.style.fontStyle = 'normal';
      td.style.textDecoration = 'none';
      td.style.color = '';
      td.style.backgroundColor = '';
      td.style.textAlign = '';
      return;
    }

    let displayVal = cell.val;
    if (typeof cell.val === 'string' && cell.val.startsWith('=')) {
      displayVal = this.formulaEngine.evaluate(cell.val);
    }

    // Format number if applicable
    if (cell.style && cell.style.format) {
      displayVal = this.applyNumberFormat(displayVal, cell.style.format);
    }

    td.textContent = displayVal;

    // Apply styles
    if (cell.style) {
      td.style.fontWeight = cell.style.bold ? 'bold' : 'normal';
      td.style.fontStyle = cell.style.italic ? 'italic' : 'normal';
      td.style.textDecoration = cell.style.underline ? 'underline' : 'none';
      td.style.color = cell.style.color || '';
      td.style.backgroundColor = cell.style.bg || '';
      td.style.textAlign = cell.style.align || (typeof displayVal === 'number' ? 'right' : '');
    }
  }

  applyNumberFormat(val, format) {
    const num = Number(val);
    if (isNaN(num)) return val;
    switch (format) {
      case 'currency':
        return `${num.toLocaleString('ar-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} دج`;
      case 'percent':
        return `${(num * 100).toFixed(1)}%`;
      case 'number':
        return num.toLocaleString('ar-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      default:
        return val;
    }
  }

  toggleStyle(prop) {
    this.selectionRange.forEach(addr => {
      if (!this.cells[addr]) this.cells[addr] = { val: '' };
      if (!this.cells[addr].style) this.cells[addr].style = {};
      this.cells[addr].style[prop] = !this.cells[addr].style[prop];
    });
    this.renderAllCells();
  }

  setStyle(prop, val) {
    this.selectionRange.forEach(addr => {
      if (!this.cells[addr]) this.cells[addr] = { val: '' };
      if (!this.cells[addr].style) this.cells[addr].style = {};
      this.cells[addr].style[prop] = val;
    });
    this.renderAllCells();
  }

  clearSelection() {
    this.selectionRange.forEach(addr => {
      if (this.cells[addr]) {
        this.cells[addr].val = '';
      }
    });
    this.renderAllCells();
    this.updateFormulaBar();
    this.updateStats();
  }

  copySelection() {
    this.clipboard = {};
    this.selectionRange.forEach(addr => {
      if (this.cells[addr]) {
        this.clipboard[addr] = JSON.parse(JSON.stringify(this.cells[addr]));
      }
    });
  }

  pasteSelection() {
    if (!this.clipboard) return;
    const baseAddr = parseCellAddress(this.activeCell);
    const clipKeys = Object.keys(this.clipboard);
    if (!clipKeys.length) return;
    const firstAddr = parseCellAddress(clipKeys[0]);

    clipKeys.forEach(srcAddr => {
      const srcCoord = parseCellAddress(srcAddr);
      const targetCol = baseAddr.col + (srcCoord.col - firstAddr.col);
      const targetRow = baseAddr.row + (srcCoord.row - firstAddr.row);
      if (targetCol < this.colsCount && targetRow < this.rowsCount) {
        const destAddr = `${colToLetter(targetCol)}${targetRow + 1}`;
        this.cells[destAddr] = JSON.parse(JSON.stringify(this.clipboard[srcAddr]));
      }
    });
    this.renderAllCells();
    this.updateStats();
  }

  updateStats() {
    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;

    this.selectionRange.forEach(addr => {
      const cell = this.cells[addr];
      if (cell && cell.val !== '' && cell.val != null) {
        let v = cell.val;
        if (typeof v === 'string' && v.startsWith('=')) {
          v = this.formulaEngine.evaluate(v);
        }
        if (!isNaN(v) && v !== '') {
          const num = Number(v);
          sum += num;
          count++;
          if (num < min) min = num;
          if (num > max) max = num;
        }
      }
    });

    const t = I18N[this.currentLang];
    document.getElementById('statCount').textContent = `${t.count} ${this.selectionRange.length}`;
    if (count > 0) {
      document.getElementById('statSum').textContent = `${t.sum} ${Math.round(sum * 100) / 100}`;
      document.getElementById('statAvg').textContent = `${t.avg} ${Math.round((sum / count) * 100) / 100}`;
      document.getElementById('statMin').textContent = `${t.min} ${min}`;
      document.getElementById('statMax').textContent = `${t.max} ${max}`;
    } else {
      document.getElementById('statSum').textContent = '';
      document.getElementById('statAvg').textContent = '';
      document.getElementById('statMin').textContent = '';
      document.getElementById('statMax').textContent = '';
    }
  }

  newSpreadsheet() {
    if (confirm('هل تريد بالتأكيد فتح جدول جديد فارغ؟')) {
      this.cells = {};
      this.sheetTitle = I18N[this.currentLang].untitledSheet;
      const titleInput = document.getElementById('sheetTitleInput');
      if (titleInput) titleInput.value = this.sheetTitle;
      this.renderAllCells();
      this.setActiveCell('A1');
    }
  }

  saveSpreadsheet() {
    const data = {
      title: this.sheetTitle,
      cells: this.cells,
      updatedAt: new Date().toISOString(),
      generator: 'DZ-Calc Pro 1.0.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.downloadFile(blob, `${this.sanitizeFilename(this.sheetTitle)}.dzsheet`);
  }

  openSpreadsheetFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (file.name.endsWith('.csv')) {
          this.importCsv(e.target.result);
        } else {
          const data = JSON.parse(e.target.result);
          if (data.cells) {
            this.cells = data.cells;
            if (data.title) {
              this.sheetTitle = data.title;
              const titleInput = document.getElementById('sheetTitleInput');
              if (titleInput) titleInput.value = this.sheetTitle;
            }
            this.renderAllCells();
            this.setActiveCell('A1');
          }
        }
      } catch (err) {
        alert('تعذر قراءة الملف: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  importCsv(csvText) {
    this.cells = {};
    const lines = csvText.split(/\r?\n/);
    lines.forEach((line, r) => {
      const cols = line.split(',');
      cols.forEach((val, c) => {
        if (c < this.colsCount && r < this.rowsCount) {
          const addr = `${colToLetter(c)}${r + 1}`;
          this.cells[addr] = { val: val.trim().replace(/^"|"$/g, '') };
        }
      });
    });
    this.renderAllCells();
    this.setActiveCell('A1');
  }

  exportCsv() {
    let csv = '';
    for (let r = 0; r < this.rowsCount; r++) {
      const rowVals = [];
      let hasData = false;
      for (let c = 0; c < this.colsCount; c++) {
        const addr = `${colToLetter(c)}${r + 1}`;
        const cell = this.cells[addr];
        let v = cell ? (cell.val ?? '') : '';
        if (typeof v === 'string' && v.startsWith('=')) {
          v = this.formulaEngine.evaluate(v);
        }
        if (v !== '') hasData = true;
        rowVals.push(`"${String(v).replace(/"/g, '""')}"`);
      }
      if (hasData) {
        csv += rowVals.join(',') + '\r\n';
      }
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    this.downloadFile(blob, `${this.sanitizeFilename(this.sheetTitle)}.csv`);
  }

  loadTemplate(tpl) {
    this.cells = JSON.parse(JSON.stringify(tpl.data));
    this.sheetTitle = this.currentLang === 'fr' ? tpl.nameFr : (this.currentLang === 'en' ? tpl.nameEn : tpl.nameAr);
    const titleInput = document.getElementById('sheetTitleInput');
    if (titleInput) titleInput.value = this.sheetTitle;
    this.renderAllCells();
    this.setActiveCell('A1');
  }

  populateTemplates() {
    const list = document.getElementById('templatesList');
    if (!list) return;
    list.innerHTML = '';
    SPREADSHEET_TEMPLATES.forEach(tpl => {
      const card = document.createElement('div');
      card.className = 'template-card';
      const name = this.currentLang === 'fr' ? tpl.nameFr : (this.currentLang === 'en' ? tpl.nameEn : tpl.nameAr);
      card.innerHTML = `
        <div class="template-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </div>
        <div class="template-info">
          <h4>${name}</h4>
          <span class="template-badge">${tpl.category}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this.loadTemplate(tpl);
        document.getElementById('modalTemplates')?.classList.remove('active');
      });
      list.appendChild(card);
    });
  }

  openChartModal() {
    document.getElementById('modalChart')?.classList.add('active');
    this.renderChart();
  }

  renderChart() {
    const canvas = document.getElementById('chartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Extract numbers and labels from selection
    const items = [];
    this.selectionRange.forEach(addr => {
      const cell = this.cells[addr];
      if (cell && cell.val !== '' && cell.val != null) {
        let v = cell.val;
        if (typeof v === 'string' && v.startsWith('=')) {
          v = this.formulaEngine.evaluate(v);
        }
        if (!isNaN(v)) {
          items.push({ label: addr, value: Number(v) });
        }
      }
    });

    if (items.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('يرجى تحديد خلايا تحتوي على أرقام لإنشاء المخطط', width / 2, height / 2);
      return;
    }

    const type = document.getElementById('chartTypeSelect')?.value || 'bar';
    const padding = 50;
    const maxVal = Math.max(...items.map(i => i.value), 1);

    if (type === 'bar') {
      const barWidth = Math.max(20, (width - padding * 2) / items.length - 15);
      items.forEach((item, idx) => {
        const x = padding + idx * (barWidth + 15);
        const barHeight = (item.value / maxVal) * (height - padding * 2);
        const y = height - padding - barHeight;

        // Gradient
        const grad = ctx.createLinearGradient(x, y, x, height - padding);
        grad.addColorStop(0, '#10b981');
        grad.addColorStop(1, '#047857');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barHeight);

        // Label & value
        ctx.fillStyle = '#0f172a';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(item.value, x + barWidth / 2, y - 6);
        ctx.fillText(item.label, x + barWidth / 2, height - padding + 18);
      });
    } else if (type === 'line') {
      ctx.beginPath();
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 3;
      items.forEach((item, idx) => {
        const x = padding + (idx / Math.max(1, items.length - 1)) * (width - padding * 2);
        const y = height - padding - (item.value / maxVal) * (height - padding * 2);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      items.forEach((item, idx) => {
        const x = padding + (idx / Math.max(1, items.length - 1)) * (width - padding * 2);
        const y = height - padding - (item.value / maxVal) * (height - padding * 2);
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(item.value, x, y - 10);
      });
    } else if (type === 'pie') {
      const total = items.reduce((a, b) => a + Math.abs(b.value), 0) || 1;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) / 2 - 40;
      let startAngle = 0;
      const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

      items.forEach((item, idx) => {
        const sliceAngle = (Math.abs(item.value) / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = colors[idx % colors.length];
        ctx.fill();
        startAngle += sliceAngle;
      });
    }
  }

  downloadFile(blob, filename) {
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

  setLanguage(lang) {
    if (!I18N[lang]) return;
    this.currentLang = lang;
    localStorage.setItem('dz_calc_lang', lang);
    this.applyLanguage(lang);
    this.populateTemplates();
  }

  applyLanguage(lang) {
    const t = I18N[lang];
    const isAr = lang === 'ar';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', isAr ? 'rtl' : 'ltr');

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    this.updateStats();
  }
}

// Global App Instance
window.dzCalcApp = new DZCalcApp();

window.addEventListener('DOMContentLoaded', () => {
  // Modal closers
  document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    });
  });
});
