/**
 * DZ-Word (DZ-Writer / كاتب الجزائر) — Application Logic
 * 100% Offline, Zero-Dependency, Native Bi-directional Document Processor
 */

import { TEMPLATES } from './templates.js';

// Localization Dictionaries
const I18N = {
  ar: {
    appTitle: 'كاتب الجزائر — معالج النصوص والمستندات',
    untitledDoc: 'مستند بدون عنوان',
    file: 'ملف',
    edit: 'تعديل',
    insert: 'إدراج',
    format: 'تنسيق',
    tools: 'أدوات',
    help: 'مساعدة',
    newDoc: 'مستند جديد',
    openDoc: 'فتح مستند...',
    saveDoc: 'حفظ المستند (Ctrl+S)',
    exportMenu: 'تصدير المستند',
    exportHtml: 'تصدير كـ HTML',
    exportMd: 'تصدير كـ Markdown',
    exportTxt: 'تصدير كنص عادي (TXT)',
    printPdf: 'طباعة / حفظ كـ PDF',
    undo: 'تراجع (Ctrl+Z)',
    redo: 'إعادة (Ctrl+Y)',
    cut: 'قص',
    copy: 'نسخ',
    paste: 'لصق',
    selectAll: 'تحديد الكل',
    findReplace: 'بحث واستبدال (Ctrl+F)',
    insertTable: 'إدراج جدول',
    insertImage: 'إدراج صورة',
    insertAlgeriaHeader: 'ترويسة الجمهورية الجزائرية',
    insertHr: 'خط فاصل أفقي',
    insertPageBreak: 'فاصل صفحات',
    templates: 'النماذج الإدارية والوطنية',
    bold: 'عريض',
    italic: 'مائل',
    underline: 'تسطير',
    strikethrough: 'يتوسطه خط',
    alignLeft: 'محاذاة لليسار',
    alignCenter: 'محاذاة للوسط',
    alignRight: 'محاذاة لليمين',
    alignJustify: 'ضبط النص',
    dirRtl: 'اتجاه من اليمين لليسار (عربي)',
    dirLtr: 'اتجاه من اليسار لليمين (لاتيني)',
    bullets: 'قائمة نقطية',
    numbers: 'قائمة رقمية',
    words: 'كلمات',
    chars: 'حروف',
    pages: 'صفحات',
    readingTime: 'وقت القراءة التقريبي',
    zoom: 'التكبير',
    searchTitle: 'البحث والاستبدال',
    searchPlaceholder: 'كلمة البحث...',
    replacePlaceholder: 'الاستبدال بـ...',
    findNext: 'التالي',
    replace: 'استبدال',
    replaceAll: 'استبدال الكل',
    close: 'إغلاق',
    templatesTitle: 'النماذج الإدارية والرسمية الجاهزة',
    applyTemplate: 'استخدام النموذج',
    aboutTitle: 'عن برنامج كاتب الجزائر (DZ-Word)',
    aboutDesc: 'معالج نصوص مكتبي حر ومفتوح المصدر 100% جزائري، بديل قوي لمايكروسوفت وورد وغوغل دوكس، مع دعم متكامل للغتين العربية والفرنسية والنماذج الإدارية الوطنية.',
    rows: 'الصفوف:',
    cols: 'الأعمدة:'
  },
  fr: {
    appTitle: 'DZ-Writer — Traitement de Texte & Documents',
    untitledDoc: 'Document sans titre',
    file: 'Fichier',
    edit: 'Édition',
    insert: 'Insertion',
    format: 'Format',
    tools: 'Outils',
    help: 'Aide',
    newDoc: 'Nouveau document',
    openDoc: 'Ouvrir un document...',
    saveDoc: 'Enregistrer (Ctrl+S)',
    exportMenu: 'Exporter le document',
    exportHtml: 'Exporter en HTML',
    exportMd: 'Exporter en Markdown',
    exportTxt: 'Exporter en Texte brut (TXT)',
    printPdf: 'Imprimer / Sauvegarder en PDF',
    undo: 'Annuler (Ctrl+Z)',
    redo: 'Rétablir (Ctrl+Y)',
    cut: 'Couper',
    copy: 'Copier',
    paste: 'Coller',
    selectAll: 'Sélectionner tout',
    findReplace: 'Rechercher et remplacer (Ctrl+F)',
    insertTable: 'Insérer un tableau',
    insertImage: 'Insérer une image',
    insertAlgeriaHeader: 'En-tête officiel République Algérienne',
    insertHr: 'Ligne de séparation',
    insertPageBreak: 'Saut de page',
    templates: 'Modèles administratifs algériens',
    bold: 'Gras',
    italic: 'Italique',
    underline: 'Souligné',
    strikethrough: 'Barré',
    alignLeft: 'Aligner à gauche',
    alignCenter: 'Centrer',
    alignRight: 'Aligner à droite',
    alignJustify: 'Justifier',
    dirRtl: 'Direction Droite à Gauche (Arabe)',
    dirLtr: 'Direction Gauche à Droite (Latin)',
    bullets: 'Puces',
    numbers: 'Numérotation',
    words: 'mots',
    chars: 'caractères',
    pages: 'pages',
    readingTime: 'Temps de lecture estimé',
    zoom: 'Zoom',
    searchTitle: 'Rechercher et remplacer',
    searchPlaceholder: 'Rechercher...',
    replacePlaceholder: 'Remplacer par...',
    findNext: 'Suivant',
    replace: 'Remplacer',
    replaceAll: 'Remplacer tout',
    close: 'Fermer',
    templatesTitle: 'Modèles administratifs et professionnels',
    applyTemplate: 'Appliquer le modèle',
    aboutTitle: 'À propos de DZ-Writer',
    aboutDesc: 'Traitement de texte de bureau 100% open source et souverain, alternative légère et complète à Microsoft Word et Google Docs.',
    rows: 'Lignes :',
    cols: 'Colonnes :'
  },
  en: {
    appTitle: 'DZ-Writer — Open-Source Word Processor',
    untitledDoc: 'Untitled Document',
    file: 'File',
    edit: 'Edit',
    insert: 'Insert',
    format: 'Format',
    tools: 'Tools',
    help: 'Help',
    newDoc: 'New Document',
    openDoc: 'Open Document...',
    saveDoc: 'Save Document (Ctrl+S)',
    exportMenu: 'Export Document',
    exportHtml: 'Export as HTML',
    exportMd: 'Export as Markdown',
    exportTxt: 'Export as Plain Text (TXT)',
    printPdf: 'Print / Save as PDF',
    undo: 'Undo (Ctrl+Z)',
    redo: 'Redo (Ctrl+Y)',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    findReplace: 'Find and Replace (Ctrl+F)',
    insertTable: 'Insert Table',
    insertImage: 'Insert Image',
    insertAlgeriaHeader: 'Algerian Republic Official Header',
    insertHr: 'Horizontal Divider',
    insertPageBreak: 'Page Break',
    templates: 'Official Administrative Templates',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strikethrough: 'Strikethrough',
    alignLeft: 'Align Left',
    alignCenter: 'Align Center',
    alignRight: 'Align Right',
    alignJustify: 'Justify',
    dirRtl: 'RTL (Arabic)',
    dirLtr: 'LTR (Latin)',
    bullets: 'Bullet List',
    numbers: 'Numbered List',
    words: 'words',
    chars: 'characters',
    pages: 'pages',
    readingTime: 'Estimated Reading Time',
    zoom: 'Zoom',
    searchTitle: 'Find and Replace',
    searchPlaceholder: 'Find what...',
    replacePlaceholder: 'Replace with...',
    findNext: 'Find Next',
    replace: 'Replace',
    replaceAll: 'Replace All',
    close: 'Close',
    templatesTitle: 'Pre-built Administrative Templates',
    applyTemplate: 'Use Template',
    aboutTitle: 'About DZ-Writer',
    aboutDesc: '100% offline-first, sovereign open-source word processor and Microsoft Word / Google Docs alternative with native bi-directional Arabic-French support.',
    rows: 'Rows:',
    cols: 'Columns:'
  }
};

class DZWordApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_word_lang') || 'ar';
    this.zoomLevel = 100;
    this.docTitle = I18N[this.currentLang].untitledDoc;
    this.editor = null;
    this.init();
  }

  init() {
    this.editor = document.getElementById('documentEditor');
    this.bindEvents();
    this.applyLanguage(this.currentLang);
    this.loadInitialContent();
    this.updateStats();
  }

  bindEvents() {
    // Editor input listener for live stats & auto-pagination
    this.editor.addEventListener('input', () => {
      this.updateStats();
    });

    // Formatting Toolbar controls
    document.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cmd = btn.getAttribute('data-cmd');
        const val = btn.getAttribute('data-val') || null;
        this.executeFormat(cmd, val);
      });
    });

    // Font Family & Size Selects
    const fontSelect = document.getElementById('fontFamilySelect');
    if (fontSelect) {
      fontSelect.addEventListener('change', (e) => {
        this.executeFormat('fontName', e.target.value);
      });
    }

    const fontSizeSelect = document.getElementById('fontSizeSelect');
    if (fontSizeSelect) {
      fontSizeSelect.addEventListener('change', (e) => {
        this.executeFormat('fontSize', e.target.value);
      });
    }

    // Text Color & Background Color Pickers
    const textColor = document.getElementById('textColorPicker');
    if (textColor) {
      textColor.addEventListener('input', (e) => {
        this.executeFormat('foreColor', e.target.value);
      });
    }

    const hiliteColor = document.getElementById('hiliteColorPicker');
    if (hiliteColor) {
      hiliteColor.addEventListener('input', (e) => {
        this.executeFormat('hiliteColor', e.target.value);
      });
    }

    // Direction Switchers
    const btnDirRtl = document.getElementById('btnDirRtl');
    if (btnDirRtl) {
      btnDirRtl.addEventListener('click', () => this.setDocumentDirection('rtl'));
    }
    const btnDirLtr = document.getElementById('btnDirLtr');
    if (btnDirLtr) {
      btnDirLtr.addEventListener('click', () => this.setDocumentDirection('ltr'));
    }

    // Zoom Slider
    const zoomSlider = document.getElementById('zoomSlider');
    const zoomVal = document.getElementById('zoomValue');
    if (zoomSlider && zoomVal) {
      zoomSlider.addEventListener('input', (e) => {
        this.zoomLevel = parseInt(e.target.value, 10);
        zoomVal.textContent = `${this.zoomLevel}%`;
        const wrapper = document.querySelector('.page-container');
        if (wrapper) {
          wrapper.style.transform = `scale(${this.zoomLevel / 100})`;
          wrapper.style.transformOrigin = 'top center';
        }
      });
    }

    // Title editing
    const titleInput = document.getElementById('docTitleInput');
    if (titleInput) {
      titleInput.addEventListener('input', (e) => {
        this.docTitle = e.target.value.trim() || I18N[this.currentLang].untitledDoc;
        document.title = `${this.docTitle} — DZ-Writer`;
      });
    }

    // Image Upload
    const imgInput = document.getElementById('imageFileInput');
    if (imgInput) {
      imgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (loadEvt) => {
            this.insertImage(loadEvt.target.result);
          };
          reader.readAsDataURL(file);
        }
        imgInput.value = '';
      });
    }

    // Drag and drop images directly on editor
    this.editor.addEventListener('dragover', (e) => e.preventDefault());
    this.editor.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (loadEvt) => {
            this.insertImage(loadEvt.target.result);
          };
          reader.readAsDataURL(file);
        }
      }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault();
            this.saveDocument();
            break;
          case 'p':
            e.preventDefault();
            this.printDocument();
            break;
          case 'f':
            e.preventDefault();
            this.openFindReplace();
            break;
        }
      }
    });

    // Language buttons
    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.getAttribute('data-lang');
        this.setLanguage(lang);
      });
    });

    // Template Cards Picker
    this.populateTemplates();
  }

  executeFormat(cmd, val = null) {
    this.editor.focus();
    document.execCommand(cmd, false, val);
    this.updateStats();
  }

  setDocumentDirection(dir) {
    this.editor.setAttribute('dir', dir);
    this.editor.style.textAlign = dir === 'rtl' ? 'right' : 'left';
    document.getElementById('btnDirRtl')?.classList.toggle('active', dir === 'rtl');
    document.getElementById('btnDirLtr')?.classList.toggle('active', dir === 'ltr');
  }

  insertImage(src) {
    this.editor.focus();
    const imgHtml = `
      <div style="text-align: center; margin: 15px 0;">
        <img src="${src}" style="max-width: 90%; max-height: 400px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #cbd5e1;">
      </div>
    `;
    document.execCommand('insertHTML', false, imgHtml);
    this.updateStats();
  }

  insertTable(rows = 3, cols = 3) {
    this.editor.focus();
    let tableHtml = `<table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 11pt;">`;
    // Header row
    tableHtml += `<thead><tr style="background-color: #f1f5f9;">`;
    for (let c = 0; c < cols; c++) {
      tableHtml += `<th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: bold; text-align: inherit;">عنوان ${c + 1}</th>`;
    }
    tableHtml += `</tr></thead><tbody>`;
    // Body rows
    for (let r = 0; r < rows; r++) {
      tableHtml += `<tr>`;
      for (let c = 0; c < cols; c++) {
        tableHtml += `<td style="border: 1px solid #cbd5e1; padding: 8px 10px;">بيانات (${r + 1}, ${c + 1})</td>`;
      }
      tableHtml += `</tr>`;
    }
    tableHtml += `</tbody></table><p><br></p>`;
    document.execCommand('insertHTML', false, tableHtml);
    this.updateStats();
  }

  insertAlgerianHeader() {
    this.editor.focus();
    const headerHtml = `
      <div style="text-align: center; border-bottom: 2px solid #047857; padding-bottom: 15px; margin-bottom: 25px;">
        <h3 style="margin: 0; color: #047857; font-size: 16pt; font-family: 'Amiri', 'Cairo', serif;">الجمهورية الجزائرية الديمقراطية الشعبية</h3>
        <p style="margin: 4px 0; color: #475569; font-size: 11pt; font-family: sans-serif;">République Algérienne Démocratique et Populaire</p>
        <p style="margin: 4px 0; font-weight: bold; color: #1e3a8a; font-size: 12pt;">وزارة [اسم الوزارة أو الهيئة الحكومية]</p>
        <p style="margin: 2px 0; font-size: 10pt; color: #64748b;">مديرية [المديرية العامة] — ولاية [الولاية]</p>
      </div>
      <p><br></p>
    `;
    document.execCommand('insertHTML', false, headerHtml);
    this.updateStats();
  }

  updateStats() {
    const text = this.editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const charsNoSpaces = text.replace(/\s+/g, '').length;
    
    // Page count estimate (roughly 350-400 words per single-spaced A4 page)
    const pages = Math.max(1, Math.ceil(words / 350));
    const readMin = Math.max(1, Math.ceil(words / 200));

    const t = I18N[this.currentLang];
    document.getElementById('statWords').textContent = `${words} ${t.words}`;
    document.getElementById('statChars').textContent = `${chars} ${t.chars}`;
    document.getElementById('statPages').textContent = `${pages} ${t.pages}`;
    document.getElementById('statReadingTime').textContent = `~${readMin} دقيقة قراءة`;
  }

  newDocument() {
    if (confirm('هل تريد بالتأكيد فتح مستند جديد فارغ؟ سيتم مسح التغييرات غير المحفوظة.')) {
      this.editor.innerHTML = '<p><br></p>';
      this.docTitle = I18N[this.currentLang].untitledDoc;
      const titleInput = document.getElementById('docTitleInput');
      if (titleInput) titleInput.value = this.docTitle;
      this.setDocumentDirection(this.currentLang === 'ar' ? 'rtl' : 'ltr');
      this.updateStats();
    }
  }

  saveDocument() {
    const docData = {
      title: this.docTitle,
      contentHtml: this.editor.innerHTML,
      direction: this.editor.getAttribute('dir') || 'rtl',
      updatedAt: new Date().toISOString(),
      generator: 'DZ-Word Pro 1.0.0'
    };
    const blob = new Blob([JSON.stringify(docData, null, 2)], { type: 'application/json' });
    this.downloadFile(blob, `${this.sanitizeFilename(this.docTitle)}.dzdoc`);
  }

  openDocumentFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.contentHtml) {
          this.editor.innerHTML = data.contentHtml;
          if (data.title) {
            this.docTitle = data.title;
            const titleInput = document.getElementById('docTitleInput');
            if (titleInput) titleInput.value = this.docTitle;
          }
          if (data.direction) {
            this.setDocumentDirection(data.direction);
          }
          this.updateStats();
          return;
        }
      } catch (err) {
        // Fallback: parse as HTML or text
        this.editor.innerHTML = e.target.result;
        this.updateStats();
      }
    };
    reader.readAsText(file);
  }

  exportHtml() {
    const fullHtml = `
<!DOCTYPE html>
<html lang="${this.currentLang}" dir="${this.editor.getAttribute('dir') || 'rtl'}">
<head>
  <meta charset="UTF-8">
  <title>${this.docTitle}</title>
  <style>
    body { font-family: 'Amiri', 'Cairo', 'Segoe UI', system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.8; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; }
    th { background: #f8fafc; }
    img { max-width: 100%; border-radius: 6px; }
  </style>
</head>
<body>
  ${this.editor.innerHTML}
</body>
</html>
    `;
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    this.downloadFile(blob, `${this.sanitizeFilename(this.docTitle)}.html`);
  }

  exportMarkdown() {
    // Basic HTML to Markdown conversion
    let text = this.editor.innerHTML;
    text = text.replace(/<h1>(.*?)<\/h1>/gi, '# $1\n\n');
    text = text.replace(/<h2>(.*?)<\/h2>/gi, '## $1\n\n');
    text = text.replace(/<h3>(.*?)<\/h3>/gi, '### $1\n\n');
    text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**');
    text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
    text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*');
    text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*');
    text = text.replace(/<p>(.*?)<\/p>/gi, '$1\n\n');
    text = text.replace(/<br\s*[\/]?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    this.downloadFile(blob, `${this.sanitizeFilename(this.docTitle)}.md`);
  }

  exportTxt() {
    const text = this.editor.innerText || '';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    this.downloadFile(blob, `${this.sanitizeFilename(this.docTitle)}.txt`);
  }

  printDocument() {
    window.print();
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

  loadInitialContent() {
    // Default document: official Algerian work certificate template
    const defaultTpl = TEMPLATES[0];
    if (defaultTpl) {
      this.editor.innerHTML = defaultTpl.content;
      this.docTitle = defaultTpl.nameAr;
      const titleInput = document.getElementById('docTitleInput');
      if (titleInput) titleInput.value = this.docTitle;
      this.setDocumentDirection('rtl');
    }
  }

  populateTemplates() {
    const container = document.getElementById('templatesList');
    if (!container) return;
    container.innerHTML = '';
    TEMPLATES.forEach(tpl => {
      const card = document.createElement('div');
      card.className = 'template-card';
      const name = this.currentLang === 'fr' ? tpl.nameFr : (this.currentLang === 'en' ? tpl.nameEn : tpl.nameAr);
      card.innerHTML = `
        <div class="template-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </div>
        <div class="template-info">
          <h4>${name}</h4>
          <span class="template-badge">${tpl.category}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this.applyTemplate(tpl);
        document.getElementById('modalTemplates')?.classList.remove('active');
      });
      container.appendChild(card);
    });
  }

  applyTemplate(tpl) {
    this.editor.innerHTML = tpl.content;
    const name = this.currentLang === 'fr' ? tpl.nameFr : (this.currentLang === 'en' ? tpl.nameEn : tpl.nameAr);
    this.docTitle = name;
    const titleInput = document.getElementById('docTitleInput');
    if (titleInput) titleInput.value = this.docTitle;
    this.setDocumentDirection(tpl.direction || 'rtl');
    this.updateStats();
  }

  openFindReplace() {
    document.getElementById('modalFindReplace')?.classList.add('active');
    document.getElementById('findInput')?.focus();
  }

  performFindNext() {
    const query = document.getElementById('findInput')?.value || '';
    if (!query) return;
    if (window.find) {
      window.find(query, false, false, true, false, false, false);
    }
  }

  performReplace() {
    const query = document.getElementById('findInput')?.value || '';
    const replaceWith = document.getElementById('replaceInput')?.value || '';
    if (!query) return;
    const sel = window.getSelection();
    if (sel && sel.toString() === query) {
      document.execCommand('insertText', false, replaceWith);
    }
    this.performFindNext();
  }

  performReplaceAll() {
    const query = document.getElementById('findInput')?.value || '';
    const replaceWith = document.getElementById('replaceInput')?.value || '';
    if (!query) return;
    const content = this.editor.innerHTML;
    // Replace safe regex
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    this.editor.innerHTML = content.replace(regex, replaceWith);
    this.updateStats();
  }

  setLanguage(lang) {
    if (!I18N[lang]) return;
    this.currentLang = lang;
    localStorage.setItem('dz_word_lang', lang);
    this.applyLanguage(lang);
    this.populateTemplates();
  }

  applyLanguage(lang) {
    const t = I18N[lang];
    const isAr = lang === 'ar';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', isAr ? 'rtl' : 'ltr');

    // Update i18n keys
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (t[key]) el.setAttribute('title', t[key]);
    });

    // Active lang badge
    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    this.updateStats();
  }
}

// Global App Instance
window.dzWordApp = new DZWordApp();

// Wire top-level menu modals & commands
window.addEventListener('DOMContentLoaded', () => {
  // Modal closers
  document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    });
  });

  // Table Modal Insert
  document.getElementById('btnConfirmInsertTable')?.addEventListener('click', () => {
    const rows = parseInt(document.getElementById('tableRowsInput').value, 10) || 3;
    const cols = parseInt(document.getElementById('tableColsInput').value, 10) || 3;
    window.dzWordApp.insertTable(rows, cols);
    document.getElementById('modalTable')?.classList.remove('active');
  });

  // Open modals
  document.getElementById('btnOpenTemplates')?.addEventListener('click', () => {
    document.getElementById('modalTemplates')?.classList.add('active');
  });
  document.getElementById('btnInsertTableModal')?.addEventListener('click', () => {
    document.getElementById('modalTable')?.classList.add('active');
  });
  document.getElementById('btnOpenAbout')?.addEventListener('click', () => {
    document.getElementById('modalAbout')?.classList.add('active');
  });
  document.getElementById('btnOpenFindReplace')?.addEventListener('click', () => {
    window.dzWordApp.openFindReplace();
  });

  // Find & Replace actions
  document.getElementById('btnFindNext')?.addEventListener('click', () => window.dzWordApp.performFindNext());
  document.getElementById('btnReplace')?.addEventListener('click', () => window.dzWordApp.performReplace());
  document.getElementById('btnReplaceAll')?.addEventListener('click', () => window.dzWordApp.performReplaceAll());

  // File operations
  document.getElementById('btnNewDoc')?.addEventListener('click', () => window.dzWordApp.newDocument());
  document.getElementById('btnSaveDoc')?.addEventListener('click', () => window.dzWordApp.saveDocument());
  document.getElementById('btnPrintPdf')?.addEventListener('click', () => window.dzWordApp.printDocument());
  document.getElementById('btnExportHtml')?.addEventListener('click', () => window.dzWordApp.exportHtml());
  document.getElementById('btnExportMd')?.addEventListener('click', () => window.dzWordApp.exportMarkdown());
  document.getElementById('btnExportTxt')?.addEventListener('click', () => window.dzWordApp.exportTxt());

  // Open file input
  const docFileInput = document.getElementById('docFileInput');
  document.getElementById('btnOpenDocFile')?.addEventListener('click', () => docFileInput?.click());
  docFileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      window.dzWordApp.openDocumentFile(e.target.files[0]);
    }
    docFileInput.value = '';
  });

  // Official Algerian Header Insertion
  document.getElementById('btnInsertAlgeriaHeader')?.addEventListener('click', () => {
    window.dzWordApp.insertAlgerianHeader();
  });
});
