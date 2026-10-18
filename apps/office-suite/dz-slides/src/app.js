/**
 * DZ-Slides (DZ-Impress / عارض الجزائر) — Presentation Studio Logic
 * 100% Offline-First, Zero-Dependency, Native Desktop Slideshow & Deck Designer
 */

import { SLIDE_TEMPLATES } from './templates.js';

const I18N = {
  ar: {
    appTitle: 'عارض الجزائر — استوديو العروض التقديمية',
    untitledDeck: 'عرض تقديمي بدون عنوان',
    file: 'ملف',
    edit: 'تعديل',
    insert: 'إدراج',
    slides: 'شرائح',
    help: 'مساعدة',
    newDeck: 'عرض جديد',
    openDeck: 'فتح عرض...',
    saveDeck: 'حفظ (Ctrl+S)',
    exportPdf: 'طباعة / تصدير PDF',
    newSlide: 'شريحة جديدة',
    duplicateSlide: 'تكرار الشريحة',
    deleteSlide: 'حذف الشريحة',
    startSlideshow: 'عرض الشرائح (F5)',
    addText: 'إضافة نص',
    addCard: 'بطاقة إحصائية',
    addImage: 'إدراج صورة',
    changeBg: 'لون الخلفية',
    templates: 'النماذج الجامعية والمؤسساتية',
    slideOf: 'شريحة {current} من {total}',
    laserPointer: 'مؤشر ليزر',
    exitSlideshow: 'إنهاء العرض (Esc)',
    aboutTitle: 'عن عارض الجزائر (DZ-Slides)',
    aboutDesc: 'استوديو عروض تقديمية مكتبي حر ومفتوح المصدر 100% جزائري، بديل متقدم لمايكروسوفت باوربوينت مع قوالب مذكرات التخرج ومشاريع الشركات الناشئة.',
    close: 'إغلاق'
  },
  fr: {
    appTitle: 'DZ-Impress — Studio de Présentations',
    untitledDeck: 'Présentation sans titre',
    file: 'Fichier',
    edit: 'Édition',
    insert: 'Insertion',
    slides: 'Diapositives',
    help: 'Aide',
    newDeck: 'Nouvelle présentation',
    openDeck: 'Ouvrir une présentation...',
    saveDeck: 'Enregistrer (Ctrl+S)',
    exportPdf: 'Imprimer / Exporter PDF',
    newSlide: 'Nouvelle diapositive',
    duplicateSlide: 'Dupliquer la diapo',
    deleteSlide: 'Supprimer la diapo',
    startSlideshow: 'Diaporama plein écran (F5)',
    addText: 'Ajouter du texte',
    addCard: 'Carte infographique',
    addImage: 'Insérer une image',
    changeBg: 'Arrière-plan',
    templates: 'Modèles de soutenance & pitch',
    slideOf: 'Diapo {current} sur {total}',
    laserPointer: 'Pointeur laser',
    exitSlideshow: 'Quitter (Échap)',
    aboutTitle: 'À propos de DZ-Impress',
    aboutDesc: 'Studio de présentation 100% open source souverain, alternative légère et complète à Microsoft PowerPoint avec modèles académiques algériens.',
    close: 'Fermer'
  },
  en: {
    appTitle: 'DZ-Impress — Sovereign Open-Source Presentation Studio',
    untitledDeck: 'Untitled Presentation',
    file: 'File',
    edit: 'Edit',
    insert: 'Insert',
    slides: 'Slides',
    help: 'Help',
    newDeck: 'New Presentation',
    openDeck: 'Open Presentation...',
    saveDeck: 'Save (Ctrl+S)',
    exportPdf: 'Print / Export PDF',
    newSlide: 'New Slide',
    duplicateSlide: 'Duplicate Slide',
    deleteSlide: 'Delete Slide',
    startSlideshow: 'Start Slideshow (F5)',
    addText: 'Add Text Box',
    addCard: 'Infographic Card',
    addImage: 'Insert Image',
    changeBg: 'Background',
    templates: 'Templates',
    slideOf: 'Slide {current} of {total}',
    laserPointer: 'Laser Pointer',
    exitSlideshow: 'Exit (Esc)',
    aboutTitle: 'About DZ-Impress',
    aboutDesc: '100% offline-first, sovereign open-source presentation studio and Microsoft PowerPoint / Google Slides alternative.',
    close: 'Close'
  }
};

export class DZSlidesApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_slides_lang') || 'ar';
    this.deckTitle = I18N[this.currentLang].untitledDeck;
    this.slides = [];
    this.activeSlideIdx = 0;
    this.selectedElement = null;
    this.isSlideshow = false;
    this.laserActive = false;
    this.slideshowSeconds = 0;
    this.slideshowTimerInterval = null;

    this.init();
  }

  init() {
    this.bindEvents();
    this.applyLanguage(this.currentLang);
    this.loadTemplate(SLIDE_TEMPLATES[0]); // default: Soutenance PFE
  }

  bindEvents() {
    // Top menu actions
    document.getElementById('btnNewDeck')?.addEventListener('click', () => this.newDeck());
    document.getElementById('btnSaveDeck')?.addEventListener('click', () => this.saveDeck());
    document.getElementById('btnExportPdf')?.addEventListener('click', () => window.print());

    const fileInput = document.getElementById('deckFileInput');
    document.getElementById('btnOpenDeckFile')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.openDeckFile(e.target.files[0]);
      }
      fileInput.value = '';
    });

    // Slide controls
    document.getElementById('btnNewSlide')?.addEventListener('click', () => this.addNewSlide());
    document.getElementById('btnDuplicateSlide')?.addEventListener('click', () => this.duplicateCurrentSlide());
    document.getElementById('btnDeleteSlide')?.addEventListener('click', () => this.deleteCurrentSlide());

    // Element Inserts
    document.getElementById('btnAddText')?.addEventListener('click', () => this.addTextElement());
    document.getElementById('btnAddCard')?.addEventListener('click', () => this.addCardElement());

    const imgInput = document.getElementById('slideImageInput');
    document.getElementById('btnAddImage')?.addEventListener('click', () => imgInput?.click());
    imgInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (loadEvt) => {
          this.addImageElement(loadEvt.target.result);
        };
        reader.readAsDataURL(e.target.files[0]);
      }
      imgInput.value = '';
    });

    // Background color
    document.getElementById('slideBgColor')?.addEventListener('input', (e) => {
      if (this.slides[this.activeSlideIdx]) {
        this.slides[this.activeSlideIdx].bg = e.target.value;
        this.renderActiveSlide();
        this.renderThumbnails();
      }
    });

    // Slideshow start
    document.getElementById('btnStartSlideshow')?.addEventListener('click', () => this.startSlideshow());

    // Slideshow navigation controls
    document.getElementById('ssPrev')?.addEventListener('click', () => this.prevSlide());
    document.getElementById('ssNext')?.addEventListener('click', () => this.nextSlide());
    document.getElementById('ssExit')?.addEventListener('click', () => this.exitSlideshow());
    document.getElementById('ssLaser')?.addEventListener('click', () => this.toggleLaserPointer());

    // Title edit
    document.getElementById('deckTitleInput')?.addEventListener('input', (e) => {
      this.deckTitle = e.target.value.trim() || I18N[this.currentLang].untitledDeck;
      document.title = `${this.deckTitle} — DZ-Impress`;
    });

    // Language switcher
    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => this.setLanguage(btn.getAttribute('data-lang')));
    });

    // Templates modal
    document.getElementById('btnOpenTemplates')?.addEventListener('click', () => {
      document.getElementById('modalTemplates')?.classList.add('active');
    });

    // About modal
    document.getElementById('btnOpenAbout')?.addEventListener('click', () => {
      document.getElementById('modalAbout')?.classList.add('active');
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (this.isSlideshow) {
        if (e.key === 'ArrowRight' || e.key === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          this.nextSlide();
        } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
          e.preventDefault();
          this.prevSlide();
        } else if (e.key === 'Escape') {
          this.exitSlideshow();
        }
      } else {
        if (e.key === 'F5') {
          e.preventDefault();
          this.startSlideshow();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          this.saveDeck();
        }
      }
    });

    // Laser pointer mouse follower
    const laserEl = document.getElementById('laserPointerEl');
    window.addEventListener('mousemove', (e) => {
      if (this.isSlideshow && this.laserActive && laserEl) {
        laserEl.style.left = `${e.clientX}px`;
        laserEl.style.top = `${e.clientY}px`;
      }
    });

    this.populateTemplates();
  }

  loadTemplate(tpl) {
    this.slides = JSON.parse(JSON.stringify(tpl.slides));
    this.activeSlideIdx = 0;
    this.deckTitle = this.currentLang === 'fr' ? tpl.nameFr : (this.currentLang === 'en' ? tpl.nameEn : tpl.nameAr);
    const titleInput = document.getElementById('deckTitleInput');
    if (titleInput) titleInput.value = this.deckTitle;
    this.renderThumbnails();
    this.renderActiveSlide();
  }

  renderThumbnails() {
    const list = document.getElementById('slidesThumbnailsList');
    if (!list) return;
    list.innerHTML = '';

    this.slides.forEach((slide, idx) => {
      const thumb = document.createElement('div');
      thumb.className = `slide-thumb ${idx === this.activeSlideIdx ? 'active' : ''}`;
      thumb.innerHTML = `
        <div class="thumb-badge">${idx + 1}</div>
        <div class="thumb-canvas-mini" style="background: ${slide.bg || '#ffffff'};">
          <div class="mini-title" style="color: ${slide.textColor || '#000'}">${slide.title || 'شريحة ' + (idx + 1)}</div>
        </div>
      `;
      thumb.addEventListener('click', () => {
        this.activeSlideIdx = idx;
        this.renderThumbnails();
        this.renderActiveSlide();
      });
      list.appendChild(thumb);
    });

    this.updateStatus();
  }

  renderActiveSlide() {
    const canvas = document.getElementById('slideCanvas');
    if (!canvas) return;
    const slide = this.slides[this.activeSlideIdx];
    if (!slide) return;

    canvas.style.background = slide.bg || '#ffffff';
    canvas.innerHTML = '';

    slide.elements.forEach((el, elIdx) => {
      const box = document.createElement('div');
      box.className = 'slide-element';
      box.style.left = `${el.x}px`;
      box.style.top = `${el.y}px`;
      box.style.width = `${el.w}px`;
      box.style.height = `${el.h}px`;
      box.innerHTML = el.content;
      box.contentEditable = 'true';
      box.spellcheck = false;

      // Update content on input
      box.addEventListener('input', () => {
        el.content = box.innerHTML;
      });

      // Simple dragging
      this.makeElementDraggable(box, el);

      canvas.appendChild(box);
    });
  }

  makeElementDraggable(domEl, dataEl) {
    let startX = 0, startY = 0, initLeft = 0, initTop = 0;
    domEl.addEventListener('mousedown', (e) => {
      if (domEl.isContentEditable && document.activeElement === domEl) return;
      startX = e.clientX;
      startY = e.clientY;
      initLeft = dataEl.x;
      initTop = dataEl.y;

      const onMouseMove = (moveEvt) => {
        const dx = moveEvt.clientX - startX;
        const dy = moveEvt.clientY - startY;
        dataEl.x = Math.max(0, initLeft + dx);
        dataEl.y = Math.max(0, initTop + dy);
        domEl.style.left = `${dataEl.x}px`;
        domEl.style.top = `${dataEl.y}px`;
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  addNewSlide() {
    const newSlide = {
      id: 's_' + Date.now(),
      title: 'شريحة جديدة',
      bg: '#ffffff',
      textColor: '#0f172a',
      elements: [
        { type: 'text', x: 60, y: 50, w: 840, h: 50, content: '<h2 style="color: #1e3a8a; border-bottom: 3px solid #059669; padding-bottom: 6px; margin: 0;">عنوان الشريحة الجديد</h2>' },
        { type: 'text', x: 60, y: 130, w: 840, h: 250, content: '<p style="font-size: 16pt; line-height: 2; color: #334155;">اكتب محتوى الشريحة أو العناصر الإيضاحية هنا...</p>' }
      ]
    };
    this.slides.push(newSlide);
    this.activeSlideIdx = this.slides.length - 1;
    this.renderThumbnails();
    this.renderActiveSlide();
  }

  duplicateCurrentSlide() {
    if (!this.slides[this.activeSlideIdx]) return;
    const clone = JSON.parse(JSON.stringify(this.slides[this.activeSlideIdx]));
    clone.id = 's_' + Date.now();
    this.slides.splice(this.activeSlideIdx + 1, 0, clone);
    this.activeSlideIdx++;
    this.renderThumbnails();
    this.renderActiveSlide();
  }

  deleteCurrentSlide() {
    if (this.slides.length <= 1) {
      alert('لا يمكن حذف الشريحة الأخيرة في العرض التقديمي.');
      return;
    }
    if (confirm('هل تريد حذف هذه الشريحة؟')) {
      this.slides.splice(this.activeSlideIdx, 1);
      this.activeSlideIdx = Math.max(0, this.activeSlideIdx - 1);
      this.renderThumbnails();
      this.renderActiveSlide();
    }
  }

  addTextElement() {
    if (!this.slides[this.activeSlideIdx]) return;
    const newEl = {
      type: 'text',
      x: 100,
      y: 150,
      w: 400,
      h: 80,
      content: '<p style="font-size: 16pt; color: #0f172a; margin: 0;">نص جديد (انقر للتعديل)</p>'
    };
    this.slides[this.activeSlideIdx].elements.push(newEl);
    this.renderActiveSlide();
  }

  addCardElement() {
    if (!this.slides[this.activeSlideIdx]) return;
    const newEl = {
      type: 'card',
      x: 100,
      y: 150,
      w: 360,
      h: 220,
      content: `
        <div style="background: #f8fafc; border: 2px solid #cbd5e1; border-radius: 12px; padding: 20px; box-sizing: border-box; height: 100%;">
          <h3 style="color: #047857; margin-top: 0; font-size: 16pt;">مؤشر رقمي / إحصائية</h3>
          <p style="font-size: 13pt; color: #475569; line-height: 1.8;">وصف توضيحي للمشروع أو النتائج المسجلة بالتفصيل.</p>
        </div>
      `
    };
    this.slides[this.activeSlideIdx].elements.push(newEl);
    this.renderActiveSlide();
  }

  addImageElement(dataUrl) {
    if (!this.slides[this.activeSlideIdx]) return;
    const newEl = {
      type: 'image',
      x: 150,
      y: 120,
      w: 400,
      h: 280,
      content: `<img src="${dataUrl}" style="max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">`
    };
    this.slides[this.activeSlideIdx].elements.push(newEl);
    this.renderActiveSlide();
  }

  startSlideshow() {
    this.isSlideshow = true;
    this.slideshowSeconds = 0;
    const container = document.getElementById('slideshowOverlay');
    if (container) {
      container.classList.add('active');
      this.renderSlideshowView();
    }

    if (this.slideshowTimerInterval) clearInterval(this.slideshowTimerInterval);
    this.slideshowTimerInterval = setInterval(() => {
      this.slideshowSeconds++;
      const m = Math.floor(this.slideshowSeconds / 60);
      const s = this.slideshowSeconds % 60;
      const timerBadge = document.getElementById('ssTimer');
      if (timerBadge) {
        timerBadge.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
    }, 1000);
  }

  renderSlideshowView() {
    const screen = document.getElementById('slideshowScreen');
    if (!screen) return;
    const slide = this.slides[this.activeSlideIdx];
    if (!slide) return;

    screen.style.background = slide.bg || '#ffffff';
    screen.innerHTML = '';

    slide.elements.forEach(el => {
      const box = document.createElement('div');
      box.className = 'ss-slide-element';
      box.style.left = `${el.x}px`;
      box.style.top = `${el.y}px`;
      box.style.width = `${el.w}px`;
      box.style.height = `${el.h}px`;
      box.innerHTML = el.content;
      screen.appendChild(box);
    });

    const counter = document.getElementById('ssCounter');
    if (counter) {
      counter.textContent = `${this.activeSlideIdx + 1} / ${this.slides.length}`;
    }
  }

  nextSlide() {
    if (this.activeSlideIdx < this.slides.length - 1) {
      this.activeSlideIdx++;
      if (this.isSlideshow) {
        this.renderSlideshowView();
      } else {
        this.renderThumbnails();
        this.renderActiveSlide();
      }
    }
  }

  prevSlide() {
    if (this.activeSlideIdx > 0) {
      this.activeSlideIdx--;
      if (this.isSlideshow) {
        this.renderSlideshowView();
      } else {
        this.renderThumbnails();
        this.renderActiveSlide();
      }
    }
  }

  exitSlideshow() {
    this.isSlideshow = false;
    this.laserActive = false;
    const laserEl = document.getElementById('laserPointerEl');
    if (laserEl) laserEl.style.display = 'none';

    if (this.slideshowTimerInterval) clearInterval(this.slideshowTimerInterval);
    document.getElementById('slideshowOverlay')?.classList.remove('active');
    this.renderThumbnails();
    this.renderActiveSlide();
  }

  toggleLaserPointer() {
    this.laserActive = !this.laserActive;
    const laserEl = document.getElementById('laserPointerEl');
    if (laserEl) {
      laserEl.style.display = this.laserActive ? 'block' : 'none';
    }
    document.getElementById('ssLaser')?.classList.toggle('active', this.laserActive);
  }

  updateStatus() {
    const t = I18N[this.currentLang];
    const statusText = t.slideOf
      .replace('{current}', this.activeSlideIdx + 1)
      .replace('{total}', this.slides.length);
    document.getElementById('statusSlideCounter').textContent = statusText;
  }

  newDeck() {
    if (confirm('هل تريد بالتأكيد فتح عرض تقديمي جديد؟')) {
      this.slides = [
        {
          id: 's1',
          title: 'شريحة العنوان',
          bg: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)',
          textColor: '#ffffff',
          elements: [
            { type: 'text', x: 80, y: 150, w: 800, h: 80, content: '<h1 style="color: #ffffff; font-size: 32pt; text-align: center; margin: 0;">عنوان العرض التقديمي</h1>' },
            { type: 'text', x: 80, y: 240, w: 800, h: 40, content: '<p style="color: #94a3b8; font-size: 16pt; text-align: center; margin: 0;">العنوان الفرعي أو ملخص المشروع</p>' }
          ]
        }
      ];
      this.activeSlideIdx = 0;
      this.deckTitle = I18N[this.currentLang].untitledDeck;
      const titleInput = document.getElementById('deckTitleInput');
      if (titleInput) titleInput.value = this.deckTitle;
      this.renderThumbnails();
      this.renderActiveSlide();
    }
  }

  saveDeck() {
    const data = {
      title: this.deckTitle,
      slides: this.slides,
      updatedAt: new Date().toISOString(),
      generator: 'DZ-Slides Pro 1.0.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.downloadFile(blob, `${this.sanitizeFilename(this.deckTitle)}.dzslide`);
  }

  openDeckFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.slides && Array.isArray(data.slides)) {
          this.slides = data.slides;
          if (data.title) {
            this.deckTitle = data.title;
            const titleInput = document.getElementById('deckTitleInput');
            if (titleInput) titleInput.value = this.deckTitle;
          }
          this.activeSlideIdx = 0;
          this.renderThumbnails();
          this.renderActiveSlide();
        }
      } catch (err) {
        alert('تعذر فتح ملف العرض: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  populateTemplates() {
    const list = document.getElementById('templatesList');
    if (!list) return;
    list.innerHTML = '';
    SLIDE_TEMPLATES.forEach(tpl => {
      const card = document.createElement('div');
      card.className = 'template-card';
      const name = this.currentLang === 'fr' ? tpl.nameFr : (this.currentLang === 'en' ? tpl.nameEn : tpl.nameAr);
      card.innerHTML = `
        <div class="template-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        </div>
        <div class="template-info">
          <h4>${name}</h4>
          <span class="template-badge">${tpl.slides.length} شرائح</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this.loadTemplate(tpl);
        document.getElementById('modalTemplates')?.classList.remove('active');
      });
      list.appendChild(card);
    });
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
    localStorage.setItem('dz_slides_lang', lang);
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

    this.updateStatus();
  }
}

// Global App Instance
window.dzSlidesApp = new DZSlidesApp();

window.addEventListener('DOMContentLoaded', () => {
  // Modal closers
  document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    });
  });
});
