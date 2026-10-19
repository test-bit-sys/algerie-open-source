/**
 * DZ-Calc (جداول الجزائر) — Microsoft Excel & Google Sheets Native Application
 * 100% Offline-First, Zero-Dependency, Sovereign Algerian Spreadsheet Studio
 */

import { FormulaEngine, parseCellAddress, colToLetter, tafqitArabic, tafqitFrench } from './formula-engine.js';
import { SPREADSHEET_TEMPLATES } from './templates.js';

export class DZCalcApp {
  constructor() {
    this.colsCount = 26; // A through Z
    this.rowsCount = 60; // 60 rows
    this.zoomLevel = 100;
    this.isEditing = false;
    this.isMouseDown = false;
    this.isAutofilling = false;
    this.activeCell = 'A1';
    this.selectionStart = 'A1';
    this.selectionEnd = 'A1';
    this.selectedRange = ['A1'];
    this.clipboard = null;
    this.clipboardAction = null; // 'copy' or 'cut'
    this.history = [];
    this.historyIndex = -1;
    this.isAutoSaveOn = true;

    // Multi-sheet Workbook Structure
    this.workbook = {
      title: 'كشف الأجور والرواتب الجزائري (Fiche de Paie)',
      activeSheetId: 'sheet1',
      sheets: {
        'sheet1': {
          id: 'sheet1',
          name: 'ورقة 1',
          cells: {},
          colWidths: {},
          rowHeights: {}
        }
      }
    };

    // Formula Engine
    this.formulaEngine = new FormulaEngine((c, r) => this.getCellValueByCoord(c, r));

    this.init();
  }

  getCurrentSheet() {
    return this.workbook.sheets[this.workbook.activeSheetId] || Object.values(this.workbook.sheets)[0];
  }

  getCurrentCells() {
    return this.getCurrentSheet().cells;
  }

  init() {
    this.buildGridDOM();
    this.renderSheetTabs();
    this.bindEvents();
    this.setupRibbonTabs();
    this.setupBackstage();
    this.setupTemplatesGallery();
    this.loadDefaultTemplate();
    this.selectCell('A1');
    this.updateStatusMetrics();

    // Auto-expose on window for inline handlers & testing
    if (typeof window !== 'undefined') {
      window.dzCalcApp = this;
    }
  }

  // ==========================================================================
  // 1. GRID GENERATION & DOM
  // ==========================================================================
  buildGridDOM() {
    const table = document.getElementById('sheetTable');
    if (!table) return;
    table.innerHTML = '';

    const currentSheet = this.getCurrentSheet();

    // Thead (Column Headers)
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    // Corner Cell
    const cornerTh = document.createElement('th');
    cornerTh.className = 'grid-corner-cell';
    cornerTh.title = 'تحديد كافة الخلايا (Ctrl+A)';
    cornerTh.addEventListener('click', () => this.selectAllCells());
    headerRow.appendChild(cornerTh);

    for (let c = 0; c < this.colsCount; c++) {
      const colLetter = colToLetter(c);
      const th = document.createElement('th');
      th.className = 'col-header-cell';
      th.dataset.col = c;
      th.textContent = colLetter;
      if (currentSheet.colWidths[c]) {
        th.style.width = `${currentSheet.colWidths[c]}px`;
        th.style.minWidth = `${currentSheet.colWidths[c]}px`;
      }

      // Column Resizer Handle
      const resizer = document.createElement('div');
      resizer.className = 'col-resizer';
      this.initColResize(resizer, c, th);
      th.appendChild(resizer);

      // Select entire column on click
      th.addEventListener('click', (e) => {
        if (e.target === resizer) return;
        this.selectColumn(c);
      });

      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Tbody (Rows)
    const tbody = document.createElement('tbody');
    for (let r = 0; r < this.rowsCount; r++) {
      const row = document.createElement('tr');
      if (currentSheet.rowHeights[r]) {
        row.style.height = `${currentSheet.rowHeights[r]}px`;
      }

      // Row Header Cell (#)
      const rowTh = document.createElement('th');
      rowTh.className = 'row-header-cell';
      rowTh.dataset.row = r;
      rowTh.textContent = r + 1;

      // Row Resizer Handle
      const rowResizer = document.createElement('div');
      rowResizer.className = 'row-resizer';
      this.initRowResize(rowResizer, r, row);
      rowTh.appendChild(rowResizer);

      // Select entire row on click
      rowTh.addEventListener('click', (e) => {
        if (e.target === rowResizer) return;
        this.selectRow(r);
      });

      row.appendChild(rowTh);

      // Data Cells
      for (let c = 0; c < this.colsCount; c++) {
        const addr = `${colToLetter(c)}${r + 1}`;
        const td = document.createElement('td');
        td.className = 'grid-cell';
        td.dataset.addr = addr;
        td.dataset.col = c;
        td.dataset.row = r;

        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
  }

  initColResize(resizer, colIdx, th) {
    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e) => {
      const diff = startX - e.clientX; // RTL direction
      const newWidth = Math.max(40, startWidth + diff);
      th.style.width = `${newWidth}px`;
      th.style.minWidth = `${newWidth}px`;
      this.getCurrentSheet().colWidths[colIdx] = newWidth;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
    };

    resizer.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startX = e.clientX;
      startWidth = th.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  initRowResize(resizer, rowIdx, tr) {
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e) => {
      const diff = e.clientY - startY;
      const newHeight = Math.max(18, startHeight + diff);
      tr.style.height = `${newHeight}px`;
      this.getCurrentSheet().rowHeights[rowIdx] = newHeight;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
    };

    resizer.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startY = e.clientY;
      startHeight = tr.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ==========================================================================
  // 2. CELL SELECTION & NAVIGATION
  // ==========================================================================
  selectCell(addr, extendSelection = false) {
    if (!addr) return;
    addr = addr.toUpperCase();

    if (!extendSelection) {
      this.activeCell = addr;
      this.selectionStart = addr;
      this.selectionEnd = addr;
      this.selectedRange = [addr];
    } else {
      this.selectionEnd = addr;
      this.selectedRange = this.computeRange(this.selectionStart, this.selectionEnd);
    }

    this.renderSelectionHighlights();
    this.updateFormulaBar();
    this.updateStatusMetrics();
  }

  computeRange(startAddr, endAddr) {
    const start = parseCellAddress(startAddr);
    const end = parseCellAddress(endAddr);
    if (!start || !end) return [startAddr];

    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);

    const range = [];
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        range.push(`${colToLetter(c)}${r + 1}`);
      }
    }
    return range;
  }

  renderSelectionHighlights() {
    // Clear previous cell outlines & highlights
    document.querySelectorAll('.grid-cell.active-cell, .grid-cell.selected-range').forEach(td => {
      td.classList.remove('active-cell', 'selected-range');
      const handle = td.querySelector('.autofill-handle');
      if (handle) handle.remove();
    });

    document.querySelectorAll('.col-header-cell.selected, .row-header-cell.selected').forEach(th => {
      th.classList.remove('selected');
    });

    // Highlight range cells
    const activeCoord = parseCellAddress(this.activeCell);
    const selectedCols = new Set();
    const selectedRows = new Set();

    this.selectedRange.forEach(addr => {
      const td = document.querySelector(`.grid-cell[data-addr="${addr}"]`);
      if (td) {
        td.classList.add('selected-range');
        const c = parseInt(td.dataset.col, 10);
        const r = parseInt(td.dataset.row, 10);
        selectedCols.add(c);
        selectedRows.add(r);
      }
    });

    // Mark active cell
    const activeTd = document.querySelector(`.grid-cell[data-addr="${this.activeCell}"]`);
    if (activeTd) {
      activeTd.classList.add('active-cell');

      // Attach Autofill Handle at bottom-right corner of active cell
      const handle = document.createElement('div');
      handle.className = 'autofill-handle';
      handle.title = 'اسحب لتعبئة وتمديد السلسلة تلقائياً';
      this.initAutofillDrag(handle);
      activeTd.appendChild(handle);
    }

    // Highlight Header Col/Row
    selectedCols.forEach(c => {
      const colTh = document.querySelector(`.col-header-cell[data-col="${c}"]`);
      if (colTh) colTh.classList.add('selected');
    });
    selectedRows.forEach(r => {
      const rowTh = document.querySelector(`.row-header-cell[data-row="${r}"]`);
      if (rowTh) rowTh.classList.add('selected');
    });

    // Update active cell name box
    const nameBox = document.getElementById('activeCellNameBox');
    if (nameBox) {
      if (this.selectedRange.length > 1) {
        nameBox.value = `${this.selectionStart}:${this.selectionEnd}`;
      } else {
        nameBox.value = this.activeCell;
      }
    }
  }

  selectColumn(c) {
    const startAddr = `${colToLetter(c)}1`;
    const endAddr = `${colToLetter(c)}${this.rowsCount}`;
    this.selectionStart = startAddr;
    this.activeCell = startAddr;
    this.selectCell(endAddr, true);
  }

  selectRow(r) {
    const startAddr = `A${r + 1}`;
    const endAddr = `${colToLetter(this.colsCount - 1)}${r + 1}`;
    this.selectionStart = startAddr;
    this.activeCell = startAddr;
    this.selectCell(endAddr, true);
  }

  selectAllCells() {
    const startAddr = 'A1';
    const endAddr = `${colToLetter(this.colsCount - 1)}${this.rowsCount}`;
    this.selectionStart = startAddr;
    this.activeCell = startAddr;
    this.selectCell(endAddr, true);
  }

  // ==========================================================================
  // 3. AUTOFILL & DRAG EXTENSION (مقبض التعبئة التلقائية)
  // ==========================================================================
  initAutofillDrag(handle) {
    let startAddr = this.activeCell;
    let targetAddr = this.activeCell;

    const onMouseMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el?.closest('.grid-cell');
      if (td && td.dataset.addr && td.dataset.addr !== targetAddr) {
        targetAddr = td.dataset.addr;
        this.selectCell(targetAddr, true);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      this.isAutofilling = false;

      // Perform Autofill Series / Formula Copy
      if (targetAddr !== startAddr) {
        this.performAutofill(startAddr, targetAddr);
      }
    };

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.isAutofilling = true;
      startAddr = this.activeCell;
      targetAddr = this.activeCell;
      document.body.style.cursor = 'crosshair';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  performAutofill(sourceAddr, targetAddr) {
    const src = parseCellAddress(sourceAddr);
    const trg = parseCellAddress(targetAddr);
    if (!src || !trg) return;

    const sourceCell = this.getCurrentCells()[sourceAddr] || { val: '' };
    const srcVal = sourceCell.val;
    const isFormula = typeof srcVal === 'string' && srcVal.startsWith('=');
    const isNumber = typeof srcVal === 'number' || (!isNaN(srcVal) && srcVal !== '');

    const cellsToFill = this.computeRange(sourceAddr, targetAddr);

    let step = 0;
    cellsToFill.forEach(addr => {
      if (addr === sourceAddr) return;
      step++;

      if (isFormula) {
        // Transpose relative cell references in formula! e.g. C4 -> C5
        const transposed = this.transposeFormula(srcVal, src, parseCellAddress(addr));
        this.setCellValue(addr, transposed);
      } else if (isNumber) {
        // Incremental series +1
        const nextNum = Number(srcVal) + step;
        this.setCellValue(addr, nextNum);
      } else {
        // Copy exact value and style
        this.setCellValue(addr, srcVal, sourceCell.style);
      }
    });

    this.renderGridValues();
    this.updateStatusMetrics();
  }

  transposeFormula(formula, srcCoord, targetCoord) {
    const colDiff = targetCoord.col - srcCoord.col;
    const rowDiff = targetCoord.row - srcCoord.row;

    return formula.replace(/([A-Z]+)([0-9]+)/gi, (match, colLetter, rowNumStr) => {
      const originalCol = parseCellAddress(match).col;
      const originalRow = parseInt(rowNumStr, 10) - 1;

      const newCol = Math.max(0, originalCol + colDiff);
      const newRow = Math.max(0, originalRow + rowDiff);
      return `${colToLetter(newCol)}${newRow + 1}`;
    });
  }

  // ==========================================================================
  // 4. DATA MODEL & CELL VALUES
  // ==========================================================================
  getCellValue(addr) {
    const cell = this.getCurrentCells()[addr];
    if (!cell || cell.val == null) return '';
    const raw = cell.val;

    if (typeof raw === 'string' && raw.startsWith('=')) {
      return this.formulaEngine.evaluate(raw);
    }
    return raw;
  }

  getCellValueByCoord(col, row) {
    const addr = `${colToLetter(col)}${row + 1}`;
    return this.getCellValue(addr);
  }

  setCellValue(addr, val, style = null) {
    addr = addr.toUpperCase();
    const cells = this.getCurrentCells();

    if (!cells[addr]) {
      cells[addr] = { val: '', style: {} };
    }

    cells[addr].val = val;
    if (style) {
      cells[addr].style = { ...(cells[addr].style || {}), ...style };
    }

    this.renderCellDOM(addr);
  }

  renderCellDOM(addr) {
    const td = document.querySelector(`.grid-cell[data-addr="${addr}"]`);
    if (!td) return;

    const cell = this.getCurrentCells()[addr] || { val: '' };
    const rawVal = cell.val;
    const style = cell.style || {};

    let displayVal = rawVal;
    if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
      displayVal = this.formulaEngine.evaluate(rawVal);
    }

    // Apply number format if set
    if (style.numFormat === 'currency' && !isNaN(displayVal) && displayVal !== '') {
      displayVal = `${Number(displayVal).toLocaleString('ar-DZ')} د.ج`;
    } else if (style.numFormat === 'percent' && !isNaN(displayVal) && displayVal !== '') {
      displayVal = `${(Number(displayVal) * 100).toFixed(1)}%`;
    } else if (typeof displayVal === 'number') {
      displayVal = displayVal.toLocaleString('ar-DZ');
    }

    td.textContent = displayVal != null ? displayVal : '';

    // Apply inline visual styles
    td.style.fontWeight = style.bold ? 'bold' : 'normal';
    td.style.fontStyle = style.italic ? 'italic' : 'normal';
    td.style.textDecoration = style.underline ? 'underline' : 'none';
    td.style.color = style.color || '';
    td.style.backgroundColor = style.bg || '';
    td.style.textAlign = style.align || (typeof displayVal === 'number' || !isNaN(displayVal) ? 'left' : 'right');
    td.style.verticalAlign = style.valign || 'middle';
    td.style.whiteSpace = style.wrap ? 'normal' : 'nowrap';

    if (style.fontSize) td.style.fontSize = style.fontSize;
    if (style.fontFamily) td.style.fontFamily = style.fontFamily;

    // Borders
    if (style.border === 'all') {
      td.style.border = '1px solid #94a3b8';
    } else if (style.border === 'thick') {
      td.style.border = '2px solid #0f172a';
    } else if (style.border === 'none') {
      td.style.border = 'none';
    }
  }

  renderGridValues() {
    const cells = this.getCurrentCells();
    for (const addr of Object.keys(cells)) {
      this.renderCellDOM(addr);
    }
  }

  // ==========================================================================
  // 5. IN-CELL EDITING & FORMULA BAR SYNC
  // ==========================================================================
  startEditing(initialChar = null) {
    if (this.isEditing) return;
    this.isEditing = true;

    const td = document.querySelector(`.grid-cell[data-addr="${this.activeCell}"]`);
    if (!td) return;

    const cell = this.getCurrentCells()[this.activeCell] || { val: '' };
    const rawVal = initialChar !== null ? initialChar : (cell.val != null ? cell.val : '');

    // In-place overlay editor
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'cell-in-place-editor';
    editor.value = rawVal;
    editor.style.width = `${Math.max(td.offsetWidth + 30, 120)}px`;
    editor.style.height = `${td.offsetHeight + 2}px`;
    editor.style.top = `${td.offsetTop}px`;
    editor.style.right = `${td.offsetLeft}px`;

    td.appendChild(editor);
    editor.focus();
    if (initialChar === null) editor.select();

    const commit = () => {
      if (!this.isEditing) return;
      this.isEditing = false;
      const newVal = editor.value.trim();
      editor.remove();
      this.setCellValue(this.activeCell, newVal);
      this.updateFormulaBar();
      this.updateStatusMetrics();
    };

    const cancel = () => {
      this.isEditing = false;
      editor.remove();
      this.updateFormulaBar();
    };

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        this.navigateCell(0, 1); // Move down
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commit();
        this.navigateCell(1, 0); // Move right
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    editor.addEventListener('input', () => {
      const formulaInput = document.getElementById('formulaInputField');
      if (formulaInput) formulaInput.value = editor.value;
    });

    editor.addEventListener('blur', commit);
  }

  updateFormulaBar() {
    const formulaInput = document.getElementById('formulaInputField');
    if (!formulaInput) return;

    const cell = this.getCurrentCells()[this.activeCell];
    formulaInput.value = (cell && cell.val != null) ? cell.val : '';
  }

  navigateCell(colDelta, rowDelta) {
    const coord = parseCellAddress(this.activeCell);
    if (!coord) return;

    const nextCol = Math.max(0, Math.min(this.colsCount - 1, coord.col + colDelta));
    const nextRow = Math.max(0, Math.min(this.rowsCount - 1, coord.row + rowDelta));
    const nextAddr = `${colToLetter(nextCol)}${nextRow + 1}`;

    this.selectCell(nextAddr);

    // Scroll into view if needed
    const td = document.querySelector(`.grid-cell[data-addr="${nextAddr}"]`);
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ==========================================================================
  // 6. EVENT BINDINGS
  // ==========================================================================
  bindEvents() {
    const grid = document.getElementById('gridViewport');
    const table = document.getElementById('sheetTable');
    const formulaInput = document.getElementById('formulaInputField');
    const nameBox = document.getElementById('activeCellNameBox');

    // Cell Clicks & Drag Selection
    table.addEventListener('mousedown', (e) => {
      const td = e.target.closest('.grid-cell');
      if (!td || e.target.classList.contains('autofill-handle')) return;

      this.isMouseDown = true;
      const addr = td.dataset.addr;

      if (e.shiftKey) {
        this.selectCell(addr, true);
      } else {
        this.selectCell(addr, false);
      }
    });

    table.addEventListener('mouseover', (e) => {
      if (!this.isMouseDown || this.isAutofilling) return;
      const td = e.target.closest('.grid-cell');
      if (td && td.dataset.addr) {
        this.selectCell(td.dataset.addr, true);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    // In-Cell Double Click
    table.addEventListener('dblclick', (e) => {
      const td = e.target.closest('.grid-cell');
      if (td && td.dataset.addr) {
        this.selectCell(td.dataset.addr);
        this.startEditing();
      }
    });

    // Formula Bar Commit & Cancel
    document.getElementById('btnFormulaCommit')?.addEventListener('click', () => {
      if (formulaInput) {
        this.setCellValue(this.activeCell, formulaInput.value);
        this.updateStatusMetrics();
      }
    });

    document.getElementById('btnFormulaCancel')?.addEventListener('click', () => {
      this.updateFormulaBar();
    });

    document.getElementById('btnFormulaFx')?.addEventListener('click', () => {
      this.openFunctionsModal();
    });

    formulaInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.setCellValue(this.activeCell, formulaInput.value);
        this.navigateCell(0, 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.updateFormulaBar();
      }
    });

    nameBox?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = nameBox.value.trim().toUpperCase();
        if (target.includes(':')) {
          const parts = target.split(':');
          this.selectionStart = parts[0];
          this.selectCell(parts[1], true);
        } else if (parseCellAddress(target)) {
          this.selectCell(target);
        }
      }
    });

    // Keyboard Navigation & Shortcuts
    window.addEventListener('keydown', (e) => {
      if (this.isEditing || document.activeElement === formulaInput || document.activeElement === nameBox) {
        return;
      }

      // Ctrl / Cmd Shortcuts
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault();
            this.exportXlsx();
            break;
          case 'c':
            e.preventDefault();
            this.copySelection();
            break;
          case 'x':
            e.preventDefault();
            this.cutSelection();
            break;
          case 'v':
            e.preventDefault();
            this.pasteSelection();
            break;
          case 'b':
            e.preventDefault();
            this.toggleFormat('bold');
            break;
          case 'i':
            e.preventDefault();
            this.toggleFormat('italic');
            break;
          case 'u':
            e.preventDefault();
            this.toggleFormat('underline');
            break;
          case 'f':
          case 'h':
            e.preventDefault();
            this.openFindReplaceModal();
            break;
          case 'p':
            e.preventDefault();
            this.printWorkbook();
            break;
          case 'a':
            e.preventDefault();
            this.selectAllCells();
            break;
          case '`':
            e.preventDefault();
            this.toggleShowFormulas();
            break;
        }
        return;
      }

      // Arrow Keys Navigation
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          this.navigateCell(0, -1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.navigateCell(0, 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.navigateCell(1, 0); // In RTL: Left increases column
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.navigateCell(-1, 0); // In RTL: Right decreases column
          break;
        case 'Enter':
          e.preventDefault();
          if (e.shiftKey) this.navigateCell(0, -1);
          else this.startEditing();
          break;
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey) this.navigateCell(-1, 0);
          else this.navigateCell(1, 0);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          this.clearSelectionContents();
          break;
        case 'F2':
          e.preventDefault();
          this.startEditing();
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
            this.startEditing(e.key);
          }
          break;
      }
    });

    // Formatting Toolbar Buttons
    document.getElementById('btnBold')?.addEventListener('click', () => this.toggleFormat('bold'));
    document.getElementById('btnItalic')?.addEventListener('click', () => this.toggleFormat('italic'));
    document.getElementById('btnUnderline')?.addEventListener('click', () => this.toggleFormat('underline'));

    document.getElementById('fontFamilySelect')?.addEventListener('change', (e) => this.setFormat('fontFamily', e.target.value));
    document.getElementById('fontSizeSelect')?.addEventListener('change', (e) => this.setFormat('fontSize', `${e.target.value}pt`));
    document.getElementById('btnGrowFont')?.addEventListener('click', () => this.adjustFontSize(1));
    document.getElementById('btnShrinkFont')?.addEventListener('click', () => this.adjustFontSize(-1));
    document.getElementById('btnClearFormatting')?.addEventListener('click', () => this.clearSelectionFormats());

    // Color Pickers
    const fillColorInput = document.getElementById('fillColorInput');
    const fillColorBar = document.getElementById('fillColorBar');
    fillColorInput?.addEventListener('input', (e) => {
      fillColorBar.style.backgroundColor = e.target.value;
      this.setFormat('bg', e.target.value);
    });

    const textColorInput = document.getElementById('textColorInput');
    const textColorBar = document.getElementById('textColorBar');
    textColorInput?.addEventListener('input', (e) => {
      textColorBar.style.backgroundColor = e.target.value;
      this.setFormat('color', e.target.value);
    });

    // Borders Dropdown
    const bordersToggle = document.getElementById('btnBordersToggle');
    const bordersMenu = document.getElementById('bordersMenu');
    bordersToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      bordersMenu?.classList.toggle('open');
    });
    document.querySelectorAll('.border-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const b = item.getAttribute('data-border');
        this.setFormat('border', b);
        bordersMenu?.classList.remove('open');
      });
    });
    document.addEventListener('click', () => bordersMenu?.classList.remove('open'));

    // Alignments
    document.getElementById('btnAlignRight')?.addEventListener('click', () => this.setFormat('align', 'right'));
    document.getElementById('btnAlignCenter')?.addEventListener('click', () => this.setFormat('align', 'center'));
    document.getElementById('btnAlignLeft')?.addEventListener('click', () => this.setFormat('align', 'left'));
    document.getElementById('btnValignTop')?.addEventListener('click', () => this.setFormat('valign', 'top'));
    document.getElementById('btnValignMiddle')?.addEventListener('click', () => this.setFormat('valign', 'middle'));
    document.getElementById('btnValignBottom')?.addEventListener('click', () => this.setFormat('valign', 'bottom'));
    document.getElementById('btnWrapText')?.addEventListener('click', () => this.toggleFormat('wrap'));
    document.getElementById('btnMergeCenter')?.addEventListener('click', () => this.mergeAndCenterSelection());

    // Number Formats
    document.getElementById('numberFormatSelect')?.addEventListener('change', (e) => this.setFormat('numFormat', e.target.value));
    document.getElementById('btnFormatDzd')?.addEventListener('click', () => this.setFormat('numFormat', 'currency'));
    document.getElementById('btnFormatPercent')?.addEventListener('click', () => this.setFormat('numFormat', 'percent'));

    // Editing Operations
    document.getElementById('btnRibbonCut')?.addEventListener('click', () => this.cutSelection());
    document.getElementById('btnRibbonCopy')?.addEventListener('click', () => this.copySelection());
    document.getElementById('btnRibbonPaste')?.addEventListener('click', () => this.pasteSelection());

    document.getElementById('btnAutoSum')?.addEventListener('click', () => this.insertAutoSum());
    document.getElementById('btnInsertRow')?.addEventListener('click', () => this.insertRowAbove());
    document.getElementById('btnInsertCol')?.addEventListener('click', () => this.insertColLeft());
    document.getElementById('btnDeleteSelected')?.addEventListener('click', () => this.deleteSelectedRowOrCol());
    document.getElementById('btnDataSortAsc')?.addEventListener('click', () => this.sortSelection(true));
    document.getElementById('btnDataSortDesc')?.addEventListener('click', () => this.sortSelection(false));
    document.getElementById('btnSortAsc')?.addEventListener('click', () => this.sortSelection(true));

    // Function shortcuts from Formulas tab
    document.getElementById('btnFormulaTafqit')?.addEventListener('click', () => this.insertFormulaText('=TAFQIT_AR('));
    document.getElementById('btnFormulaTva')?.addEventListener('click', () => this.insertFormulaText('=TVA_DZ('));
    document.getElementById('btnFormulaIrg')?.addEventListener('click', () => this.insertFormulaText('=IRG_DZ('));
    document.getElementById('btnFormulaSum')?.addEventListener('click', () => this.insertFormulaText('=SUM('));
    document.getElementById('btnFormulaAvg')?.addEventListener('click', () => this.insertFormulaText('=AVERAGE('));
    document.getElementById('btnFormulaIf')?.addEventListener('click', () => this.insertFormulaText('=IF('));
    document.getElementById('btnInsertFunctionFx')?.addEventListener('click', () => this.openFunctionsModal());
    document.getElementById('btnShowFormulasToggle')?.addEventListener('click', () => this.toggleShowFormulas());

    // Sovereign Insertions
    document.getElementById('btnInsertAlgerianHeader')?.addEventListener('click', () => this.insertAlgerianHeader());
    document.getElementById('btnInsertOfficialSeal')?.addEventListener('click', () => this.insertOfficialSeal());

    // Charts
    document.getElementById('btnInsertChart')?.addEventListener('click', () => this.openChartModal('bar'));
    document.getElementById('btnQuickPieChart')?.addEventListener('click', () => this.openChartModal('pie'));
    document.getElementById('chartTypeSelect')?.addEventListener('change', (e) => this.renderChart(e.target.value));

    // Search and Find
    document.getElementById('btnFindReplace')?.addEventListener('click', () => this.openFindReplaceModal());
    document.getElementById('btnFindNext')?.addEventListener('click', () => this.findNext());
    document.getElementById('btnReplaceAll')?.addEventListener('click', () => this.replaceAll());

    // Sheet Direction & Gridlines
    document.getElementById('btnToggleRtl')?.addEventListener('click', () => this.toggleSheetDirection());
    document.getElementById('btnToggleGridlines')?.addEventListener('click', () => {
      document.getElementById('sheetTable')?.classList.toggle('hide-gridlines');
    });

    // Zoom Controls
    const zoomSlider = document.getElementById('zoomSlider');
    zoomSlider?.addEventListener('input', (e) => this.setZoom(parseInt(e.target.value, 10)));
    document.getElementById('btnZoomIn')?.addEventListener('click', () => this.setZoom(this.zoomLevel + 10));
    document.getElementById('btnZoomOut')?.addEventListener('click', () => this.setZoom(this.zoomLevel - 10));

    // Quick Access & Print
    document.getElementById('qaSaveBtn')?.addEventListener('click', () => this.exportXlsx());
    document.getElementById('qaPrintBtn')?.addEventListener('click', () => this.printWorkbook());
    document.getElementById('btnTriggerPrint')?.addEventListener('click', () => this.printWorkbook());
    document.getElementById('btnViewPrintPreview')?.addEventListener('click', () => this.printWorkbook());

    // File Import
    const fileImportInput = document.getElementById('fileImportInput');
    document.getElementById('btnImportCsvBtn')?.addEventListener('click', () => fileImportInput?.click());
    fileImportInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.importFile(e.target.files[0]);
      }
      fileImportInput.value = '';
    });

    // Title Input
    const titleInput = document.getElementById('workbookTitleInput');
    titleInput?.addEventListener('input', (e) => {
      this.workbook.title = e.target.value.trim() || 'مصنف 1 — Excel';
      document.title = `${this.workbook.title} — Excel`;
      document.getElementById('infoWorkbookTitle').textContent = this.workbook.title;
    });

    // Modals Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
      });
    });

    document.getElementById('btnAboutDialog')?.addEventListener('click', () => {
      document.getElementById('modalAbout')?.classList.add('active');
    });
  }

  // ==========================================================================
  // 7. FORMATTING ACTIONS
  // ==========================================================================
  toggleFormat(prop) {
    const cells = this.getCurrentCells();
    const firstCell = cells[this.activeCell] || { style: {} };
    const currentVal = !!(firstCell.style && firstCell.style[prop]);
    const nextVal = !currentVal;

    this.selectedRange.forEach(addr => {
      if (!cells[addr]) cells[addr] = { val: '', style: {} };
      if (!cells[addr].style) cells[addr].style = {};
      cells[addr].style[prop] = nextVal;
      this.renderCellDOM(addr);
    });
  }

  setFormat(prop, value) {
    const cells = this.getCurrentCells();
    this.selectedRange.forEach(addr => {
      if (!cells[addr]) cells[addr] = { val: '', style: {} };
      if (!cells[addr].style) cells[addr].style = {};
      cells[addr].style[prop] = value;
      this.renderCellDOM(addr);
    });
  }

  adjustFontSize(delta) {
    const fontSizes = [9, 10, 11, 12, 14, 16, 18, 20, 24];
    const select = document.getElementById('fontSizeSelect');
    let current = parseInt(select?.value || '11', 10);
    let idx = fontSizes.indexOf(current);
    if (idx === -1) idx = 2;
    let nextIdx = Math.max(0, Math.min(fontSizes.length - 1, idx + delta));
    let nextSize = fontSizes[nextIdx];
    if (select) select.value = nextSize;
    this.setFormat('fontSize', `${nextSize}pt`);
  }

  mergeAndCenterSelection() {
    if (this.selectedRange.length <= 1) return;
    const firstAddr = this.selectedRange[0];
    const firstVal = this.getCellValue(firstAddr);

    this.selectedRange.forEach((addr, idx) => {
      if (idx === 0) {
        this.setFormat('align', 'center');
      } else {
        this.setCellValue(addr, '');
      }
    });
    this.setCellValue(firstAddr, firstVal);
  }

  clearSelectionContents() {
    this.selectedRange.forEach(addr => {
      this.setCellValue(addr, '');
    });
    this.updateFormulaBar();
    this.updateStatusMetrics();
  }

  clearSelectionFormats() {
    const cells = this.getCurrentCells();
    this.selectedRange.forEach(addr => {
      if (cells[addr]) {
        cells[addr].style = {};
        this.renderCellDOM(addr);
      }
    });
  }

  // ==========================================================================
  // 8. AUTOSUM & FORMULA HELPERS
  // ==========================================================================
  insertAutoSum() {
    const coord = parseCellAddress(this.activeCell);
    if (!coord) return;

    // Look upwards for consecutive numbers
    let topRow = coord.row - 1;
    while (topRow >= 0) {
      const v = this.getCellValueByCoord(coord.col, topRow);
      if (v === '' || isNaN(v)) break;
      topRow--;
    }
    topRow++;

    if (topRow < coord.row) {
      const range = `${colToLetter(coord.col)}${topRow + 1}:${colToLetter(coord.col)}${coord.row}`;
      this.setCellValue(this.activeCell, `=SUM(${range})`);
    } else {
      // Look rightwards (in RTL) or leftwards
      this.setCellValue(this.activeCell, `=SUM(A${coord.row + 1}:${colToLetter(Math.max(0, coord.col - 1))}${coord.row + 1})`);
    }

    this.renderGridValues();
    this.updateStatusMetrics();
  }

  insertFormulaText(prefix) {
    const targetAddr = this.activeCell;
    const formulaInput = document.getElementById('formulaInputField');
    if (formulaInput) {
      formulaInput.value = `${prefix}`;
      formulaInput.focus();
    }
    this.setCellValue(targetAddr, `${prefix}`);
  }

  toggleShowFormulas() {
    const cells = this.getCurrentCells();
    document.querySelectorAll('.grid-cell').forEach(td => {
      const addr = td.dataset.addr;
      const cell = cells[addr];
      if (cell && typeof cell.val === 'string' && cell.val.startsWith('=')) {
        td.textContent = cell.val;
      }
    });
  }

  // ==========================================================================
  // 9. COPY, CUT & PASTE
  // ==========================================================================
  copySelection() {
    this.clipboard = {};
    this.clipboardAction = 'copy';
    const cells = this.getCurrentCells();

    this.selectedRange.forEach(addr => {
      this.clipboard[addr] = JSON.parse(JSON.stringify(cells[addr] || { val: '' }));
    });
  }

  cutSelection() {
    this.copySelection();
    this.clipboardAction = 'cut';
  }

  pasteSelection() {
    if (!this.clipboard) return;
    const baseTarget = parseCellAddress(this.activeCell);
    const sourceAddrs = Object.keys(this.clipboard);
    if (sourceAddrs.length === 0) return;

    const baseSource = parseCellAddress(sourceAddrs[0]);
    const colDiff = baseTarget.col - baseSource.col;
    const rowDiff = baseTarget.row - baseSource.row;

    sourceAddrs.forEach(srcAddr => {
      const srcCoord = parseCellAddress(srcAddr);
      const newCol = Math.max(0, Math.min(this.colsCount - 1, srcCoord.col + colDiff));
      const newRow = Math.max(0, Math.min(this.rowsCount - 1, srcCoord.row + rowDiff));
      const targetAddr = `${colToLetter(newCol)}${newRow + 1}`;

      const cellData = this.clipboard[srcAddr];
      let val = cellData.val;
      if (typeof val === 'string' && val.startsWith('=')) {
        val = this.transposeFormula(val, srcCoord, { col: newCol, row: newRow });
      }

      this.setCellValue(targetAddr, val, cellData.style);
    });

    if (this.clipboardAction === 'cut') {
      sourceAddrs.forEach(addr => this.setCellValue(addr, ''));
      this.clipboard = null;
    }

    this.renderGridValues();
    this.updateStatusMetrics();
  }

  // ==========================================================================
  // 10. INSERT & DELETE ROWS / COLS
  // ==========================================================================
  insertRowAbove() {
    const activeCoord = parseCellAddress(this.activeCell);
    const targetRow = activeCoord.row + 1;
    const cells = this.getCurrentCells();
    const newCells = {};

    for (const [addr, cell] of Object.entries(cells)) {
      const m = addr.match(/^([A-Z]+)([0-9]+)$/);
      if (!m) continue;
      const colLetter = m[1];
      const rowNum = parseInt(m[2], 10);

      if (rowNum >= targetRow) {
        newCells[`${colLetter}${rowNum + 1}`] = cell;
      } else {
        newCells[addr] = cell;
      }
    }

    this.getCurrentSheet().cells = newCells;
    this.buildGridDOM();
    this.renderGridValues();
    this.selectCell(`A${targetRow}`);
  }

  insertColLeft() {
    const activeCoord = parseCellAddress(this.activeCell);
    const targetCol = activeCoord.col;
    const cells = this.getCurrentCells();
    const newCells = {};

    for (const [addr, cell] of Object.entries(cells)) {
      const coord = parseCellAddress(addr);
      if (coord.col >= targetCol) {
        newCells[`${colToLetter(coord.col + 1)}${coord.row + 1}`] = cell;
      } else {
        newCells[addr] = cell;
      }
    }

    this.getCurrentSheet().cells = newCells;
    this.buildGridDOM();
    this.renderGridValues();
    this.selectCell(`${colToLetter(targetCol)}1`);
  }

  deleteSelectedRowOrCol() {
    const activeCoord = parseCellAddress(this.activeCell);
    const targetRow = activeCoord.row + 1;
    const cells = this.getCurrentCells();
    const newCells = {};

    for (const [addr, cell] of Object.entries(cells)) {
      const m = addr.match(/^([A-Z]+)([0-9]+)$/);
      if (!m) continue;
      const colLetter = m[1];
      const rowNum = parseInt(m[2], 10);

      if (rowNum === targetRow) {
        // delete
      } else if (rowNum > targetRow) {
        newCells[`${colLetter}${rowNum - 1}`] = cell;
      } else {
        newCells[addr] = cell;
      }
    }

    this.getCurrentSheet().cells = newCells;
    this.buildGridDOM();
    this.renderGridValues();
    this.selectCell(`A${targetRow}`);
  }

  sortSelection(ascending = true) {
    if (this.selectedRange.length <= 1) return;
    const coords = this.selectedRange.map(addr => parseCellAddress(addr));
    const cells = this.getCurrentCells();

    const minRow = Math.min(...coords.map(c => c.row));
    const maxRow = Math.max(...coords.map(c => c.row));
    const minCol = Math.min(...coords.map(c => c.col));
    const maxCol = Math.max(...coords.map(c => c.col));

    // Extract rows
    const rows = [];
    for (let r = minRow; r <= maxRow; r++) {
      const rowCells = [];
      for (let c = minCol; c <= maxCol; c++) {
        const addr = `${colToLetter(c)}${r + 1}`;
        rowCells.push({ c, r, data: cells[addr] || { val: '' } });
      }
      rows.push(rowCells);
    }

    // Sort by first column in selection
    rows.sort((a, b) => {
      const valA = a[0].data.val;
      const valB = b[0].data.val;
      const numA = Number(valA);
      const numB = Number(valB);

      if (!isNaN(numA) && !isNaN(numB)) {
        return ascending ? numA - numB : numB - numA;
      }
      return ascending ? String(valA).localeCompare(String(valB), 'ar') : String(valB).localeCompare(String(valA), 'ar');
    });

    // Write back
    rows.forEach((row, rIdx) => {
      row.forEach(cellObj => {
        const addr = `${colToLetter(cellObj.c)}${minRow + rIdx + 1}`;
        cells[addr] = cellObj.data;
      });
    });

    this.renderGridValues();
    this.updateStatusMetrics();
  }

  // ==========================================================================
  // 11. MULTI-SHEET TABS ENGINE
  // ==========================================================================
  renderSheetTabs() {
    const container = document.getElementById('sheetsListContainer');
    if (!container) return;
    container.innerHTML = '';

    const sheetIds = Object.keys(this.workbook.sheets);
    sheetIds.forEach((sId) => {
      const sheet = this.workbook.sheets[sId];
      const tab = document.createElement('div');
      tab.className = `sheet-tab ${sId === this.workbook.activeSheetId ? 'active' : ''}`;
      tab.textContent = sheet.name;

      tab.addEventListener('click', () => {
        this.switchSheet(sId);
      });

      // Right-click to rename or delete
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const action = prompt(`خيارات الورقة (${sheet.name}):\n1. اكتب اسماً جديداً للورقة\n2. اكتب 'حذف' لحذفها`);
        if (action === 'حذف' || action === 'delete') {
          if (sheetIds.length > 1) {
            delete this.workbook.sheets[sId];
            this.switchSheet(Object.keys(this.workbook.sheets)[0]);
          } else {
            alert('لا يمكن حذف ورقة العمل الوحيدة في المصنف.');
          }
        } else if (action && action.trim()) {
          sheet.name = action.trim();
          this.renderSheetTabs();
        }
      });

      container.appendChild(tab);
    });

    document.getElementById('btnAddSheet')?.addEventListener('click', () => {
      this.addNewSheet();
    });
  }

  addNewSheet(customName = null) {
    const nextIdx = Object.keys(this.workbook.sheets).length + 1;
    const newId = `sheet_${Date.now()}`;
    const name = customName || `ورقة ${nextIdx}`;

    this.workbook.sheets[newId] = {
      id: newId,
      name: name,
      cells: {},
      colWidths: {},
      rowHeights: {}
    };

    this.switchSheet(newId);
  }

  switchSheet(sheetId) {
    if (!this.workbook.sheets[sheetId]) return;
    this.workbook.activeSheetId = sheetId;
    this.renderSheetTabs();
    this.buildGridDOM();
    this.renderGridValues();
    this.selectCell('A1');
    document.getElementById('infoSheetsCount').textContent = Object.keys(this.workbook.sheets).length;
  }

  // ==========================================================================
  // 12. STATUS BAR METRICS & ZOOM
  // ==========================================================================
  updateStatusMetrics() {
    let sum = 0;
    let count = 0;
    let numCount = 0;
    let min = Infinity;
    let max = -Infinity;

    this.selectedRange.forEach(addr => {
      const val = this.getCellValue(addr);
      if (val !== '' && val != null) {
        count++;
        const num = Number(val);
        if (!isNaN(num)) {
          numCount++;
          sum += num;
          min = Math.min(min, num);
          max = Math.max(max, num);
        }
      }
    });

    const avg = numCount > 0 ? Math.round((sum / numCount) * 100) / 100 : 0;
    const finalMin = min !== Infinity ? min : 0;
    const finalMax = max !== -Infinity ? max : 0;

    document.getElementById('metricAvg').textContent = avg.toLocaleString('ar-DZ');
    document.getElementById('metricCount').textContent = count;
    document.getElementById('metricMin').textContent = finalMin.toLocaleString('ar-DZ');
    document.getElementById('metricMax').textContent = finalMax.toLocaleString('ar-DZ');
    document.getElementById('metricSum').textContent = sum.toLocaleString('ar-DZ');
  }

  setZoom(lvl) {
    this.zoomLevel = Math.max(50, Math.min(200, lvl));
    const slider = document.getElementById('zoomSlider');
    const label = document.getElementById('zoomValueLabel');
    if (slider) slider.value = this.zoomLevel;
    if (label) label.textContent = `${this.zoomLevel}%`;

    const table = document.getElementById('sheetTable');
    if (table) {
      table.style.transform = `scale(${this.zoomLevel / 100})`;
      table.style.transformOrigin = 'top right';
    }
  }

  toggleSheetDirection() {
    const table = document.getElementById('sheetTable');
    const isRtl = document.documentElement.getAttribute('dir') === 'rtl';
    const nextDir = isRtl ? 'ltr' : 'rtl';
    document.documentElement.setAttribute('dir', nextDir);
  }

  // ==========================================================================
  // 13. RIBBON & BACKSTAGE VIEW
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

  setupBackstage() {
    const backstage = document.getElementById('excelBackstage');
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
    document.getElementById('btnNewBlankWorkbook')?.addEventListener('click', () => {
      this.newBlankWorkbook();
      this.closeBackstage();
    });

    document.getElementById('btnExportXlsx')?.addEventListener('click', () => this.exportXlsx());
    document.getElementById('btnExportCsv')?.addEventListener('click', () => this.exportCsv());
    document.getElementById('btnExportPdf')?.addEventListener('click', () => this.printWorkbook());
    document.getElementById('btnExportJson')?.addEventListener('click', () => this.exportJson());
  }

  openBackstage() {
    document.getElementById('excelBackstage')?.classList.add('active');
    document.getElementById('infoLastModified').textContent = new Date().toLocaleString('ar-DZ');
  }

  closeBackstage() {
    document.getElementById('excelBackstage')?.classList.remove('active');
  }

  setupTemplatesGallery() {
    const gallery = document.getElementById('templatesGallery');
    if (!gallery) return;
    gallery.innerHTML = '';

    SPREADSHEET_TEMPLATES.forEach(tmpl => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.innerHTML = `
        <div>
          <h4>${tmpl.nameAr}</h4>
          <p>${tmpl.nameFr || ''}</p>
        </div>
        <span class="template-category-tag">${tmpl.category}</span>
      `;

      card.addEventListener('click', () => {
        this.loadTemplate(tmpl);
        this.closeBackstage();
      });

      gallery.appendChild(card);
    });
  }

  loadDefaultTemplate() {
    if (SPREADSHEET_TEMPLATES.length > 0) {
      this.loadTemplate(SPREADSHEET_TEMPLATES[0]);
    }
  }

  loadTemplate(tmpl) {
    this.workbook.title = tmpl.nameAr;
    document.getElementById('workbookTitleInput').value = tmpl.nameAr;
    document.title = `${tmpl.nameAr} — Excel`;

    const sheet = this.getCurrentSheet();
    sheet.cells = JSON.parse(JSON.stringify(tmpl.data));

    this.renderGridValues();
    this.selectCell('A1');
    this.updateStatusMetrics();
  }

  newBlankWorkbook() {
    this.workbook = {
      title: 'مصنف جديد 1 — Excel',
      activeSheetId: 'sheet1',
      sheets: {
        'sheet1': {
          id: 'sheet1',
          name: 'ورقة 1',
          cells: {},
          colWidths: {},
          rowHeights: {}
        }
      }
    };
    document.getElementById('workbookTitleInput').value = this.workbook.title;
    this.renderSheetTabs();
    this.buildGridDOM();
    this.selectCell('A1');
    this.updateStatusMetrics();
  }

  // ==========================================================================
  // 14. EXPORT & IMPORT (GENUINE XLSX, CSV, JSON, PDF)
  // ==========================================================================
  exportXlsx() {
    const generator = (typeof window !== 'undefined' && window.generateXlsxBlob) ? window.generateXlsxBlob : null;
    if (typeof generator === 'function') {
      const blob = generator(this.workbook, {
        direction: document.documentElement.getAttribute('dir') || 'rtl'
      });
      this.downloadBlob(blob, `${this.sanitizeFilename(this.workbook.title)}.xlsx`);
    } else {
      this.exportCsv();
    }
  }

  exportCsv() {
    const cells = this.getCurrentCells();
    const rows = [];

    for (let r = 0; r < this.rowsCount; r++) {
      const rowVals = [];
      let hasData = false;
      for (let c = 0; c < this.colsCount; c++) {
        const addr = `${colToLetter(c)}${r + 1}`;
        const val = this.getCellValue(addr);
        if (val !== '' && val != null) hasData = true;
        const escaped = `"${String(val != null ? val : '').replace(/"/g, '""')}"`;
        rowVals.push(escaped);
      }
      if (hasData || r < 15) {
        rows.push(rowVals.join(','));
      }
    }

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, `${this.sanitizeFilename(this.workbook.title)}.csv`);
  }

  exportJson() {
    const jsonStr = JSON.stringify(this.workbook, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    this.downloadBlob(blob, `${this.sanitizeFilename(this.workbook.title)}.json`);
  }

  printWorkbook() {
    window.print();
  }

  importFile(file) {
    const reader = new FileReader();
    if (file.name.endsWith('.json')) {
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.sheets) {
            this.workbook = data;
            this.renderSheetTabs();
            this.buildGridDOM();
            this.renderGridValues();
            this.updateStatusMetrics();
          }
        } catch (err) {
          alert('تعذر قراءة ملف JSON');
        }
      };
      reader.readAsText(file);
    } else if (file.name.endsWith('.csv')) {
      reader.onload = (e) => {
        this.parseCsvContent(e.target.result);
      };
      reader.readAsText(file);
    } else {
      alert('يتم دعم استيراد ملفات CSV و JSON تلقائياً.');
    }
  }

  parseCsvContent(text) {
    const lines = text.split(/\r?\n/);
    const sheet = this.getCurrentSheet();
    sheet.cells = {};

    lines.forEach((line, rIdx) => {
      if (rIdx >= this.rowsCount) return;
      const parts = line.split(',');
      parts.forEach((val, cIdx) => {
        if (cIdx >= this.colsCount) return;
        const cleanVal = val.replace(/^["']|["']$/g, '').trim();
        if (cleanVal !== '') {
          const addr = `${colToLetter(cIdx)}${rIdx + 1}`;
          sheet.cells[addr] = { val: isNaN(cleanVal) ? cleanVal : Number(cleanVal) };
        }
      });
    });

    this.renderGridValues();
    this.updateStatusMetrics();
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  }

  sanitizeFilename(str) {
    return str.replace(/[\\/:*?"<>|]/g, '_').trim();
  }

  // ==========================================================================
  // 15. ALGERIAN SOVEREIGN GRAPHICS & SEALS
  // ==========================================================================
  insertAlgerianHeader() {
    this.setCellValue('A1', 'الجمهورية الجزائرية الديمقراطية الشعبية', { bold: true, fontSize: '13pt', color: '#047857', align: 'center' });
    this.setCellValue('A2', 'وزارة [اسم الهيئة الحكومية] — المديرية العامة', { color: '#64748b', align: 'center' });
    this.renderGridValues();
  }

  insertOfficialSeal() {
    this.setCellValue(this.activeCell, '★ الجمهورية الجزائرية — ختم رسمي ★', { bold: true, color: '#047857', border: 'thick', bg: '#f0fdf4' });
    this.renderGridValues();
  }

  // ==========================================================================
  // 16. CHART VISUALIZATION ENGINE (CANVAS)
  // ==========================================================================
  openChartModal(type = 'bar') {
    const modal = document.getElementById('modalChart');
    if (!modal) return;
    modal.classList.add('active');
    const select = document.getElementById('chartTypeSelect');
    if (select) select.value = type;
    this.renderChart(type);
  }

  renderChart(type = 'bar') {
    const canvas = document.getElementById('chartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Extract label-value pairs from selected range
    const labels = [];
    const values = [];

    this.selectedRange.forEach(addr => {
      const val = this.getCellValue(addr);
      if (val !== '' && val != null) {
        const num = Number(val);
        if (!isNaN(num)) {
          values.push(num);
          labels.push(addr);
        }
      }
    });

    if (values.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Cairo, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('يرجى تحديد خلايا تحتوي على أرقام لإنشاء المخطط البياني', canvas.width / 2, canvas.height / 2);
      return;
    }

    const padding = 50;
    const w = canvas.width - padding * 2;
    const h = canvas.height - padding * 2;
    const maxVal = Math.max(...values, 1);

    if (type === 'bar') {
      const barWidth = Math.max(15, (w / values.length) - 10);
      values.forEach((v, i) => {
        const barHeight = (v / maxVal) * (h - 20);
        const x = padding + i * (barWidth + 10);
        const y = canvas.height - padding - barHeight;

        // Gradient bar
        const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
        grad.addColorStop(0, '#107c41');
        grad.addColorStop(1, '#059669');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barHeight);

        // Value text
        ctx.fillStyle = '#1e293b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v.toLocaleString('ar-DZ'), x + barWidth / 2, y - 6);

        // Label text
        ctx.fillText(labels[i], x + barWidth / 2, canvas.height - padding + 16);
      });
    } else if (type === 'line') {
      ctx.beginPath();
      ctx.strokeStyle = '#107c41';
      ctx.lineWidth = 3;

      const step = w / (values.length - 1 || 1);
      values.forEach((v, i) => {
        const x = padding + i * step;
        const y = canvas.height - padding - (v / maxVal) * (h - 20);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Points
      values.forEach((v, i) => {
        const x = padding + i * step;
        const y = canvas.height - padding - (v / maxVal) * (h - 20);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#059669';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#1e293b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v.toLocaleString('ar-DZ'), x, y - 10);
        ctx.fillText(labels[i], x, canvas.height - padding + 16);
      });
    } else if (type === 'pie') {
      const total = values.reduce((a, b) => a + b, 0);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = Math.min(w, h) / 2.5;
      const colors = ['#107c41', '#059669', '#d97706', '#2563eb', '#9333ea', '#e11d48'];

      let currentAngle = -0.5 * Math.PI;
      values.forEach((v, i) => {
        const sliceAngle = (v / total) * 2 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        currentAngle += sliceAngle;
      });
    }
  }

  // ==========================================================================
  // 17. FUNCTION HELPER MODAL & FIND/REPLACE
  // ==========================================================================
  openFunctionsModal() {
    const modal = document.getElementById('modalFunctions');
    if (!modal) return;
    modal.classList.add('active');

    const list = document.getElementById('functionsList');
    if (!list) return;
    list.innerHTML = '';

    const functions = [
      { name: 'SUM', desc: 'حساب مجموع نطاق من الخلايا', syntax: '=SUM(number1, [number2], ...)' },
      { name: 'AVERAGE', desc: 'حساب المتوسط الحسابي للقيم المحددة', syntax: '=AVERAGE(number1, [number2], ...)' },
      { name: 'COUNT', desc: 'حساب عدد الخلايا التي تحتوي على أرقام', syntax: '=COUNT(value1, [value2], ...)' },
      { name: 'MIN', desc: 'إرجاع القيمة الصغرى من بين القيم', syntax: '=MIN(number1, [number2], ...)' },
      { name: 'MAX', desc: 'إرجاع القيمة الكبرى من بين القيم', syntax: '=MAX(number1, [number2], ...)' },
      { name: 'IF', desc: 'إرجاع قيمة معينة عند تحقق شرط منطقي', syntax: '=IF(condition, value_if_true, value_if_false)' },
      { name: 'ROUND', desc: 'تقريب رقم إلى عدد محدد من المنازل العشرية', syntax: '=ROUND(number, num_digits)' },
      { name: 'TAFQIT_AR', desc: 'التفقيط المالي بالدينار الجزائري والسنتيم', syntax: '=TAFQIT_AR(amount)' },
      { name: 'TAFQIT_FR', desc: 'Tafqit financier en dinars algériens et centimes', syntax: '=TAFQIT_FR(amount)' },
      { name: 'TVA_DZ', desc: 'حساب الرسم على القيمة المضافة وفق القانون الجزائري (19% أو 9%)', syntax: '=TVA_DZ(ht, rate)' },
      { name: 'TTC_DZ', desc: 'حساب المبلغ الإجمالي المتضمن كافة الرسوم (HT + TVA)', syntax: '=TTC_DZ(ht, rate)' },
      { name: 'TIMBRE_DZ', desc: 'حساب قسيمة الطابع الجبائي وفق قانون المالية الجزائري', syntax: '=TIMBRE_DZ(amount)' },
      { name: 'IRG_DZ', desc: 'الضريبة على الدخل الإجمالي وفق الجدول الضريبي الجزائري 2024/2026', syntax: '=IRG_DZ(taxable)' },
      { name: 'CNAS_DZ', desc: 'حساب اقتطاع اشتراك الضمان الاجتماعي (9%) من الراتب الخام', syntax: '=CNAS_DZ(brut)' },
      { name: 'SALAIRE_NET_DZ', desc: 'حساب صافي الراتب الجزائري القابل للدفع مباشرة', syntax: '=SALAIRE_NET_DZ(brut, prime)' }
    ];

    functions.forEach(fn => {
      const item = document.createElement('div');
      item.style.padding = '10px 14px';
      item.style.borderBottom = '1px solid #f1f5f9';
      item.style.cursor = 'pointer';
      item.innerHTML = `
        <div style="font-weight: bold; color: #107c41; font-size: 13px;">${fn.name}</div>
        <div style="font-size: 11.5px; color: #334155; margin: 2px 0;">${fn.desc}</div>
        <div style="font-family: monospace; font-size: 11px; color: #64748b;">${fn.syntax}</div>
      `;

      item.addEventListener('click', () => {
        this.insertFormulaText(`=${fn.name}(`);
        modal.classList.remove('active');
      });

      list.appendChild(item);
    });
  }

  openFindReplaceModal() {
    document.getElementById('modalFindReplace')?.classList.add('active');
    document.getElementById('findTextInput')?.focus();
  }

  findNext() {
    const query = document.getElementById('findTextInput')?.value.trim();
    if (!query) return;

    const cells = this.getCurrentCells();
    for (const [addr, cell] of Object.entries(cells)) {
      if (cell && cell.val != null && String(cell.val).includes(query)) {
        this.selectCell(addr);
        const td = document.querySelector(`.grid-cell[data-addr="${addr}"]`);
        td?.scrollIntoView({ block: 'center', inline: 'center' });
        return;
      }
    }
    alert('لم يتم العثور على نتائج مطابقة.');
  }

  replaceAll() {
    const findStr = document.getElementById('findTextInput')?.value;
    const replaceStr = document.getElementById('replaceTextInput')?.value || '';
    if (!findStr) return;

    const cells = this.getCurrentCells();
    let count = 0;

    for (const [addr, cell] of Object.entries(cells)) {
      if (cell && cell.val != null && String(cell.val).includes(findStr)) {
        cell.val = String(cell.val).replaceAll(findStr, replaceStr);
        count++;
      }
    }

    this.renderGridValues();
    alert(`تم استبدال ${count} عنصر بنجاح.`);
  }
}

// Auto-start application
if (typeof window !== 'undefined') {
  window.DZCalcApp = DZCalcApp;
  const initApp = () => {
    if (!window.dzCalcApp) {
      window.dzCalcApp = new DZCalcApp();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
