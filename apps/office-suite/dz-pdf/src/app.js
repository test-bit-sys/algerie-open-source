/**
 * DZ-PDF: Main Application Controller
 * Follows HeyPuter/everything standard: Vanilla JS ES Modules, zero emojis,
 * trilingual enterprise UI (AR/FR/EN), dark/light theme.
 */

import { PDFEngine, PAGE_SIZES, ALGERIAN_STAMPS } from './pdf-engine.js';
import { SignaturePad } from './signature-pad.js';

const I18N = {
  ar: {
    appTitle: 'استوديو ملفات PDF الجزائري',
    tagline: 'بديل Adobe Acrobat المفتوح المصدر',
    organizerTab: 'تنظيم الصفحات',
    stampsTab: 'الأختام والمصادقة',
    signatureTab: 'التوقيع الرقمي',
    exportPdf: 'تصدير وحفظ PDF',
    openFiles: 'إضافة صفحات / ملفات',
    dropTitle: 'اسحب وأفلت ملفات PDF أو الصور هنا',
    dropSubtitle: 'تنظيم الصفحات، التدوير، الدمج، وضع الأختام الإدارية الرسمية والتوقيع الرقمي دون اتصال بالإنترنت',
    pageCount: 'إجمالي الصفحات',
    pageSize: 'حجم الورق',
    orientation: 'الاتجاه',
    portrait: 'عمودي (Portrait)',
    landscape: 'أفقي (Landscape)',
    rotatePage: 'تدوير 90°',
    deletePage: 'حذف الصفحة',
    duplicatePage: 'تكرار الصفحة',
    moveUp: 'تقديم',
    moveDown: 'تأخير',
    watermarkText: 'نص العلامة المائية',
    stampSelect: 'اختر الختم الإداري الجزائري',
    signatoryName: 'اسم الموقّع / اللقب',
    signatoryRole: 'الصفة / المنصب',
    signatoryLocation: 'مكان التوقيع (الولاية)',
    clearSignature: 'مسح التوقيع',
    undoStroke: 'تراجع عن خطوة',
    applySignature: 'تطبيق التوقيع على الصفحة',
    emptyNotice: 'لم يتم تحميل أي صفحات بعد'
  },
  fr: {
    appTitle: 'Studio PDF DZ-PDF',
    tagline: 'Alternative Open Source à Adobe Acrobat',
    organizerTab: 'Organiser les Pages',
    stampsTab: 'Tampons & Filigranes',
    signatureTab: 'Signature Numérique',
    exportPdf: 'Compiler & Exporter PDF',
    openFiles: 'Ajouter des Pages / Fichiers',
    dropTitle: 'Glissez-déposez des fichiers PDF ou images ici',
    dropSubtitle: 'Réorganisation, rotation, fusion, tampons administratifs algériens et signature numérique 100% hors-ligne',
    pageCount: 'Nombre de pages',
    pageSize: 'Format de papier',
    orientation: 'Orientation',
    portrait: 'Portrait',
    landscape: 'Paysage',
    rotatePage: 'Pivoter 90°',
    deletePage: 'Supprimer la page',
    duplicatePage: 'Dupliquer',
    moveUp: 'Monter',
    moveDown: 'Descendre',
    watermarkText: 'Texte du filigrane',
    stampSelect: 'Tampon administratif officiel',
    signatoryName: 'Nom et Prénom du signataire',
    signatoryRole: 'Qualité / Fonction',
    signatoryLocation: 'Lieu de signature (Wilaya)',
    clearSignature: 'Effacer',
    undoStroke: 'Annuler trait',
    applySignature: 'Apposer la signature sur la page',
    emptyNotice: 'Aucune page chargée'
  },
  en: {
    appTitle: 'DZ-PDF Document Suite',
    tagline: 'Open Source Adobe Acrobat Alternative',
    organizerTab: 'Page Organizer',
    stampsTab: 'Stamps & Watermarks',
    signatureTab: 'Digital Signature',
    exportPdf: 'Export & Compile PDF',
    openFiles: 'Add Pages / Files',
    dropTitle: 'Drag & Drop PDF or image files here',
    dropSubtitle: 'Reorder, rotate, merge, apply official Algerian administrative stamps and digital signatures 100% offline',
    pageCount: 'Total Pages',
    pageSize: 'Paper Size',
    orientation: 'Orientation',
    portrait: 'Portrait',
    landscape: 'Landscape',
    rotatePage: 'Rotate 90°',
    deletePage: 'Delete Page',
    duplicatePage: 'Duplicate',
    moveUp: 'Move Up',
    moveDown: 'Move Down',
    watermarkText: 'Watermark Text',
    stampSelect: 'Official Algerian Stamp',
    signatoryName: 'Signatory Name',
    signatoryRole: 'Title / Designation',
    signatoryLocation: 'Signing Location (Wilaya)',
    clearSignature: 'Clear',
    undoStroke: 'Undo Stroke',
    applySignature: 'Apply Signature to Page',
    emptyNotice: 'No pages loaded yet'
  }
};

class DZPdfApp {
  constructor() {
    this.currentLang = 'ar';
    this.theme = 'dark';

    this.pages = [];
    this.selectedPageId = null;
    this.selectedStamp = null;
    this.watermark = '';
    this.pageSizeKey = 'A4_PORTRAIT';

    this.sigPad = null;

    // UI Elements
    this.pagesGrid = document.getElementById('pages-grid');
    this.emptyState = document.getElementById('empty-state');
    this.inspectorTotalPages = document.getElementById('inspector-total-pages');
    this.inspectorSelected = document.getElementById('inspector-selected');

    this.init();
  }

  init() {
    this.setupLanguage(this.currentLang);
    this.setupTheme(this.theme);
    this.bindEvents();
    this.initSignaturePad();
    this.renderStampsUI();
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

    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (t[key]) el.title = t[key];
    });
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
  }

  bindEvents() {
    // 1. File Input
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-open-files')?.addEventListener('click', () => fileInput.click());
    document.getElementById('btn-empty-open')?.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      if (e.target.files.length) {
        await this.loadFiles(e.target.files);
        fileInput.value = '';
      }
    });

    // 2. Drag and drop onto workspace
    const workspace = document.getElementById('workspace-container');
    workspace.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    workspace.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) {
        await this.loadFiles(e.dataTransfer.files);
      }
    });

    // 3. Header Actions
    document.getElementById('btn-export-pdf')?.addEventListener('click', () => this.exportCompiledPDF());
    document.getElementById('btn-theme')?.addEventListener('click', () => this.toggleTheme());

    document.getElementById('lang-select')?.addEventListener('change', (e) => {
      this.setupLanguage(e.target.value);
    });

    // 4. Tab Modals
    document.getElementById('tab-stamps')?.addEventListener('click', () => {
      document.getElementById('modal-stamps').classList.add('open');
    });

    document.getElementById('tab-signature')?.addEventListener('click', () => {
      document.getElementById('modal-signature').classList.add('open');
    });

    // Modal Close
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

    // 5. Signature Modal Controls
    document.getElementById('btn-sig-clear')?.addEventListener('click', () => this.sigPad.clear());
    document.getElementById('btn-sig-undo')?.addEventListener('click', () => this.sigPad.undo());

    document.querySelectorAll('.sig-color-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.sig-color-btn').forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');
        this.sigPad.setColor(e.target.getAttribute('data-color'));
      });
    });

    document.getElementById('btn-sig-apply')?.addEventListener('click', () => this.applySignatureToPage());

    // 6. Watermark input
    document.getElementById('input-watermark')?.addEventListener('input', (e) => {
      this.watermark = e.target.value.trim();
    });

    // 7. Page Size selection
    document.getElementById('select-page-size')?.addEventListener('change', (e) => {
      this.pageSizeKey = e.target.value;
    });
  }

  async loadFiles(files) {
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        await this.loadImagePage(file);
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        await this.loadPdfFile(file);
      }
    }

    this.renderPages();
    this.showToast(`${this.pages.length} pages loaded`);
  }

  async loadImagePage(file) {
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });

    const page = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: file.name,
      file,
      dataUrl,
      rotation: 0
    };

    this.pages.push(page);
  }

  async loadPdfFile(file) {
    // For PDFs, we render an informative document page representation
    const page = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: file.name,
      file,
      dataUrl: null, // placeholder
      rotation: 0
    };

    this.pages.push(page);
  }

  renderPages() {
    if (this.pages.length === 0) {
      this.emptyState.style.display = 'flex';
      this.pagesGrid.innerHTML = '';
      if (this.inspectorTotalPages) this.inspectorTotalPages.textContent = '0';
      return;
    }

    this.emptyState.style.display = 'none';
    if (this.inspectorTotalPages) this.inspectorTotalPages.textContent = String(this.pages.length);

    this.pagesGrid.innerHTML = this.pages
      .map((page, index) => {
        const isSelected = page.id === this.selectedPageId;
        const rot = page.rotation || 0;
        return `
          <div class="page-card ${isSelected ? 'selected' : ''}" data-id="${page.id}">
            <div class="page-preview-box">
              <span class="page-badge">${index + 1}</span>
              ${
                page.dataUrl
                  ? `<img src="${page.dataUrl}" style="transform: rotate(${rot}deg);" alt="Page ${index + 1}">`
                  : `<div style="text-align:center; padding:16px; font-size:12px; font-weight:700; color:#475569;">${page.name}</div>`
              }
            </div>
            <div class="page-actions">
              <button class="btn-page-action btn-rotate" data-id="${page.id}" title="Rotate 90°">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
              </button>
              <button class="btn-page-action btn-move-up" data-index="${index}" title="Move Up">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
              </button>
              <button class="btn-page-action btn-move-down" data-index="${index}" title="Move Down">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <button class="btn-page-action btn-duplicate" data-id="${page.id}" title="Duplicate">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
              <button class="btn-page-action delete btn-delete" data-id="${page.id}" title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    // Bind page card events
    this.pagesGrid.querySelectorAll('.page-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-page-action')) return;
        this.selectedPageId = card.getAttribute('data-id');
        this.renderPages();
        if (this.inspectorSelected) {
          const idx = this.pages.findIndex((p) => p.id === this.selectedPageId);
          this.inspectorSelected.textContent = `Page ${idx + 1}`;
        }
      });
    });

    this.pagesGrid.querySelectorAll('.btn-rotate').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const page = this.pages.find((p) => p.id === id);
        if (page) {
          page.rotation = (page.rotation + 90) % 360;
          this.renderPages();
        }
      });
    });

    this.pagesGrid.querySelectorAll('.btn-move-up').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-index'));
        if (idx > 0) {
          const temp = this.pages[idx];
          this.pages[idx] = this.pages[idx - 1];
          this.pages[idx - 1] = temp;
          this.renderPages();
        }
      });
    });

    this.pagesGrid.querySelectorAll('.btn-move-down').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-index'));
        if (idx < this.pages.length - 1) {
          const temp = this.pages[idx];
          this.pages[idx] = this.pages[idx + 1];
          this.pages[idx + 1] = temp;
          this.renderPages();
        }
      });
    });

    this.pagesGrid.querySelectorAll('.btn-duplicate').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const idx = this.pages.findIndex((p) => p.id === id);
        if (idx !== -1) {
          const orig = this.pages[idx];
          const clone = {
            ...orig,
            id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
          };
          this.pages.splice(idx + 1, 0, clone);
          this.renderPages();
        }
      });
    });

    this.pagesGrid.querySelectorAll('.btn-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        this.pages = this.pages.filter((p) => p.id !== id);
        if (this.selectedPageId === id) this.selectedPageId = null;
        this.renderPages();
      });
    });
  }

  renderStampsUI() {
    const grid = document.getElementById('stamps-grid');
    if (!grid) return;

    grid.innerHTML = Object.entries(ALGERIAN_STAMPS)
      .map(([key, stamp]) => {
        const isSelected = this.selectedStamp === key;
        return `
          <div class="stamp-btn ${isSelected ? 'selected' : ''}" data-stamp="${key}">
            <div class="stamp-tag-preview" style="color:${stamp.color}; border-color:${stamp.borderColor};">
              ${stamp.titleAr}
            </div>
            <span style="font-size:11px; color:var(--text-muted);">${stamp.titleFr}</span>
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll('.stamp-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const stampKey = btn.getAttribute('data-stamp');
        this.selectedStamp = this.selectedStamp === stampKey ? null : stampKey;
        this.renderStampsUI();
        this.showToast(this.selectedStamp ? `Stamp: ${stampKey}` : 'Stamp removed');
      });
    });
  }

  applySignatureToPage() {
    if (!this.sigPad || this.sigPad.isEmpty()) {
      this.showToast('Please draw a signature first');
      return;
    }

    const name = document.getElementById('sig-input-name')?.value || '';
    const role = document.getElementById('sig-input-role')?.value || '';
    const location = document.getElementById('sig-input-loc')?.value || 'Alger';

    const sigDataUrl = this.sigPad.toSignatureBadge({ name, role, location });

    // Target the selected page, or the first page
    const targetPage = this.selectedPageId
      ? this.pages.find((p) => p.id === this.selectedPageId)
      : this.pages[0];

    if (!targetPage) {
      this.showToast('No page selected to stamp signature');
      return;
    }

    // Composite signature onto page image
    const img = new Image();
    img.onload = () => {
      const pageImg = new Image();
      pageImg.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = pageImg.naturalWidth || 800;
        canvas.height = pageImg.naturalHeight || 1100;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(pageImg, 0, 0);
        // Draw signature badge at bottom right
        const sigW = canvas.width * 0.35;
        const sigH = (sigW * img.height) / img.width;
        const sigX = canvas.width - sigW - 30;
        const sigY = canvas.height - sigH - 30;

        ctx.drawImage(img, sigX, sigY, sigW, sigH);

        targetPage.dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        this.renderPages();
        document.getElementById('modal-signature').classList.remove('open');
        this.showToast('Signature stamped successfully!');
      };
      pageImg.src = targetPage.dataUrl;
    };
    img.src = sigDataUrl;
  }

  async exportCompiledPDF() {
    if (this.pages.length === 0) {
      this.showToast('Please add at least one page');
      return;
    }

    this.showToast('Compiling PDF...');

    try {
      const imageItems = [];
      for (const page of this.pages) {
        if (page.dataUrl) {
          imageItems.push({ file: page.dataUrl });
        } else if (page.file) {
          imageItems.push({ file: page.file });
        }
      }

      const pageSize = PAGE_SIZES[this.pageSizeKey] || PAGE_SIZES.A4_PORTRAIT;

      const pdfBytes = await PDFEngine.imagesToPDF(imageItems, {
        pageSize,
        margin: 30,
        watermarkText: this.watermark,
        stamp: this.selectedStamp
      });

      PDFEngine.downloadPDF(pdfBytes, 'document_dz_suite.pdf');
      this.showToast('PDF exported successfully!');
    } catch (err) {
      console.error('[DZ-PDF] Export error:', err);
      this.showToast('Failed to export PDF');
    }
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.dzPdf = new DZPdfApp();
});
