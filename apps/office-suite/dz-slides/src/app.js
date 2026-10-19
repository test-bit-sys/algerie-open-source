/**
 * DZ-Slides (DZ-Impress Pro / عارض الجزائر) — Core Presentation Studio Engine
 * 100% Offline-First, Zero External Dependencies, HeyPuter/Everything Standard
 * Professional 16:9 Deck Designer & Native Slideshow Experience
 */

import { SLIDE_TEMPLATES } from './templates.js';
import { SHAPES_DEFINITIONS } from './shapes.js';
import { ExportEngine } from './export-engine.js';

const I18N = {
  ar: {
    appTitle: 'عارض الجزائر — استوديو العروض التقديمية السيادي',
    untitledDeck: 'عرض تقديمي بدون عنوان',
    file: 'ملف',
    edit: 'تعديل',
    insert: 'إدراج',
    slides: 'شرائح',
    help: 'مساعدة',
    newDeck: 'عرض جديد',
    openDeck: 'فتح مشروع (.dzslide)...',
    saveDeck: 'حفظ المشروع (Ctrl+S)',
    exportHub: 'مركز التصدير (PNG, HTML, PDF)...',
    export: 'تصدير',
    duplicateSlide: 'مضاعفة الشريحة الحالية',
    deleteSlide: 'حذف الشريحة',
    newSlide: 'شريحة جديدة',
    addText: 'نص',
    shapes: 'أشكال وإنفوجرافيك',
    insertShapes: 'أشكال وإنفوجرافيك...',
    addCard: 'بطاقة',
    addImage: 'صورة',
    changeBg: 'لون الخلفية',
    templates: 'النماذج الجامعية والمؤسساتية',
    shapesGallery: 'معرض الأشكال والإنفوجرافيك الجزائري',
    exportHubTitle: 'مركز التصدير والمشاركة المكتبي',
    exportPngTitle: 'شريحة PNG فائقة الدقة',
    exportPngDesc: 'تصدير الشريحة الحالية بدقة 1920×1080 Full HD بجودة نقية جاهزة للنشر والطباعة.',
    exportHtmlTitle: 'ملف HTML مستقل (Portable)',
    exportHtmlDesc: 'توليد ملف HTML مستقل ذاتي التشغيل يحتوي العرض بالكامل، يعمل 100% بدون إنترنت على أي جهاز.',
    exportProjectTitle: 'مشروع عارض الجزائر (.dzslide)',
    exportProjectDesc: 'حفظ المشروع بالكامل بصيغة JSON المعيارية لإعادة فتحه والتعديل عليه مستقبلاً.',
    exportPdfTitle: 'طباعة / تصدير PDF مباشر',
    exportPdfDesc: 'طباعة العرض أو حفظه كملف PDF مع ترقيم وانتقال صفحات تلقائي أفقي 16:9.',
    startSlideshow: 'عرض الشرائح (F5)',
    slideOf: 'شريحة {current} من {total}',
    laserPointer: 'مؤشر ليزر',
    penTool: 'قلم العرض',
    exitSlideshow: 'خروج',
    aboutTitle: 'عن عارض الجزائر (DZ-Impress Pro)',
    aboutDesc: 'استوديو عروض تقديمية مكتبي حر ومفتوح المصدر 100% جزائري، بديل متقدم لمايكروسوفت باوربوينت مع قوالب مذكرات التخرج ومشاريع الشركات الناشئة، مع مؤشر ليزر وقلم عرض وتصدير عالي الدقة.',
    close: 'إغلاق',
    deleteSlideConfirm: 'هل تريد بالتأكيد حذف هذه الشريحة؟',
    cannotDeleteOnlySlide: 'لا يمكن حذف الشريحة الأخيرة في العرض التقديمي.',
    newDeckConfirm: 'هل تريد بالتأكيد فتح عرض تقديمي جديد؟ سيتم مسح التغييرات غير المحفوظة.'
  },
  fr: {
    appTitle: 'DZ-Impress Pro — Studio de Présentations Souverain',
    untitledDeck: 'Présentation sans titre',
    file: 'Fichier',
    edit: 'Édition',
    insert: 'Insertion',
    slides: 'Diapositives',
    help: 'Aide',
    newDeck: 'Nouvelle présentation',
    openDeck: 'Ouvrir un projet (.dzslide)...',
    saveDeck: 'Enregistrer le projet (Ctrl+S)',
    exportHub: 'Centre d\'exportation (PNG, HTML, PDF)...',
    export: 'Exporter',
    duplicateSlide: 'Dupliquer la diapositive',
    deleteSlide: 'Supprimer la diapositive',
    newSlide: 'Nouvelle diapositive',
    addText: 'Texte',
    shapes: 'Formes & Infographies',
    insertShapes: 'Formes & Infographies...',
    addCard: 'Carte KPI',
    addImage: 'Image',
    changeBg: 'Arrière-plan',
    templates: 'Modèles académiques & d\'entreprise',
    shapesGallery: 'Galerie des Formes et Infographies',
    exportHubTitle: 'Centre d\'Exportation et de Partage',
    exportPngTitle: 'Diapo PNG Haute Définition',
    exportPngDesc: 'Exporter la diapositive actuelle en Full HD 1920×1080.',
    exportHtmlTitle: 'Fichier HTML Autonome (Portable)',
    exportHtmlDesc: 'Générer une présentation HTML autonome 100% hors-ligne utilisable sur tout appareil.',
    exportProjectTitle: 'Projet DZ-Impress (.dzslide)',
    exportProjectDesc: 'Sauvegarder la présentation au format JSON natif pour édition future.',
    exportPdfTitle: 'Imprimer / Exporter PDF Direct',
    exportPdfDesc: 'Imprimer ou enregistrer en PDF avec pagination paysage 16:9.',
    startSlideshow: 'Diaporama plein écran (F5)',
    slideOf: 'Diapo {current} sur {total}',
    laserPointer: 'Pointeur laser',
    penTool: 'Stylet d\'annotation',
    exitSlideshow: 'Quitter',
    aboutTitle: 'À propos de DZ-Impress Pro',
    aboutDesc: 'Studio de présentation souverain 100% hors-ligne, alternative algérienne complète à PowerPoint avec modèles académiques et outils de présentation avancés.',
    close: 'Fermer',
    deleteSlideConfirm: 'Voulez-vous vraiment supprimer cette diapositive ?',
    cannotDeleteOnlySlide: 'Impossible de supprimer la seule diapositive restante.',
    newDeckConfirm: 'Voulez-vous créer une nouvelle présentation ? Les modifications non enregistrées seront perdues.'
  },
  en: {
    appTitle: 'DZ-Impress Pro — Sovereign Open-Source Presentation Studio',
    untitledDeck: 'Untitled Presentation',
    file: 'File',
    edit: 'Edit',
    insert: 'Insert',
    slides: 'Slides',
    help: 'Help',
    newDeck: 'New Presentation',
    openDeck: 'Open Project (.dzslide)...',
    saveDeck: 'Save Project (Ctrl+S)',
    exportHub: 'Export Hub (PNG, HTML, PDF)...',
    export: 'Export',
    duplicateSlide: 'Duplicate Current Slide',
    deleteSlide: 'Delete Slide',
    newSlide: 'New Slide',
    addText: 'Text',
    shapes: 'Shapes & Infographics',
    insertShapes: 'Shapes & Infographics...',
    addCard: 'KPI Card',
    addImage: 'Image',
    changeBg: 'Background',
    templates: 'Academic & Pitch Templates',
    shapesGallery: 'Shapes & Infographics Gallery',
    exportHubTitle: 'Desktop Export & Share Hub',
    exportPngTitle: 'Full HD PNG Slide',
    exportPngDesc: 'Export current slide as high-resolution 1920×1080 Full HD image.',
    exportHtmlTitle: 'Standalone Portable HTML',
    exportHtmlDesc: 'Generate a self-contained portable HTML slideshow that runs 100% offline on any browser.',
    exportProjectTitle: 'DZ-Impress Project (.dzslide)',
    exportProjectDesc: 'Save deck in native standard JSON format for future editing.',
    exportPdfTitle: 'Print / Direct PDF Export',
    exportPdfDesc: 'Print or save as PDF with automatic landscape 16:9 pagination.',
    startSlideshow: 'Start Slideshow (F5)',
    slideOf: 'Slide {current} of {total}',
    laserPointer: 'Laser Pointer',
    penTool: 'Presenter Pen',
    exitSlideshow: 'Exit',
    aboutTitle: 'About DZ-Impress Pro',
    aboutDesc: '100% offline-first sovereign presentation studio, lightweight desktop PowerPoint alternative featuring Algerian thesis & startup pitch templates.',
    close: 'Close',
    deleteSlideConfirm: 'Are you sure you want to delete this slide?',
    cannotDeleteOnlySlide: 'Cannot delete the only remaining slide in the presentation.',
    newDeckConfirm: 'Create a new presentation? Unsaved changes will be lost.'
  }
};

export class DZSlidesApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_slides_lang') || 'ar';
    this.deckTitle = I18N[this.currentLang].untitledDeck;
    this.slides = [];
    this.activeSlideIdx = 0;
    this.selectedElement = null;
    this.selectedElementIdx = -1;

    // Presentation Mode state
    this.isSlideshow = false;
    this.laserActive = false;
    this.penActive = false;
    this.isBlackout = false;
    this.slideshowSeconds = 0;
    this.slideshowTimerInterval = null;

    // Live Annotator Canvas
    this.isDrawing = false;
    this.lastDrawX = 0;
    this.lastDrawY = 0;
    this.penColor = '#ef4444'; // Red default for presenter
    this.penWidth = 3;

    this.init();
  }

  init() {
    this.bindEvents();
    this.applyLanguage(this.currentLang);
    this.loadTemplate(SLIDE_TEMPLATES[0]); // Default: Algerian University Thesis Defense
    this.populateShapes();
  }

  bindEvents() {
    // 1. File Menu & Deck Title
    document.getElementById('btnNewDeck')?.addEventListener('click', () => this.newDeck());
    document.getElementById('btnSaveDeck')?.addEventListener('click', () => this.saveDeck());

    const fileInput = document.getElementById('deckFileInput');
    document.getElementById('btnOpenDeckFile')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.openDeckFile(e.target.files[0]);
      }
      fileInput.value = '';
    });

    document.getElementById('deckTitleInput')?.addEventListener('input', (e) => {
      this.deckTitle = e.target.value.trim() || I18N[this.currentLang].untitledDeck;
      document.title = `${this.deckTitle} — DZ-Impress Pro`;
    });

    // 2. Export Hub
    const openExportHub = () => {
      document.getElementById('modalExport')?.classList.add('active');
    };
    document.getElementById('btnOpenExportHub')?.addEventListener('click', openExportHub);
    document.getElementById('menuBtnExportHub')?.addEventListener('click', openExportHub);

    document.getElementById('exportActionPng')?.addEventListener('click', () => {
      document.getElementById('modalExport')?.classList.remove('active');
      this.exportCurrentSlidePng();
    });
    document.getElementById('exportActionHtml')?.addEventListener('click', () => {
      document.getElementById('modalExport')?.classList.remove('active');
      this.exportPortableHtml();
    });
    document.getElementById('exportActionDzslide')?.addEventListener('click', () => {
      document.getElementById('modalExport')?.classList.remove('active');
      this.saveDeck();
    });
    document.getElementById('exportActionPdf')?.addEventListener('click', () => {
      document.getElementById('modalExport')?.classList.remove('active');
      window.print();
    });

    // 3. Slides Manipulation
    document.getElementById('btnNewSlide')?.addEventListener('click', () => this.addNewSlide());
    document.getElementById('btnDuplicateSlide')?.addEventListener('click', () => this.duplicateCurrentSlide());
    document.getElementById('btnDuplicateSlideMenu')?.addEventListener('click', () => this.duplicateCurrentSlide());
    document.getElementById('btnDeleteSlide')?.addEventListener('click', () => this.deleteCurrentSlide());
    document.getElementById('btnDeleteSlideMenu')?.addEventListener('click', () => this.deleteCurrentSlide());

    // 4. Elements Inserts
    const addText = () => this.addTextElement();
    document.getElementById('btnAddText')?.addEventListener('click', addText);
    document.getElementById('menuAddText')?.addEventListener('click', addText);

    const openShapes = () => document.getElementById('modalShapes')?.classList.add('active');
    document.getElementById('btnOpenShapesModal')?.addEventListener('click', openShapes);
    document.getElementById('menuAddShapes')?.addEventListener('click', openShapes);

    const addCard = () => this.addCardElement();
    document.getElementById('btnAddCard')?.addEventListener('click', addCard);
    document.getElementById('menuAddCard')?.addEventListener('click', addCard);

    const imgInput = document.getElementById('slideImageInput');
    const triggerImage = () => imgInput?.click();
    document.getElementById('btnAddImage')?.addEventListener('click', triggerImage);
    document.getElementById('menuAddImage')?.addEventListener('click', triggerImage);
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

    // 5. Selected Element Layering & Actions
    document.getElementById('btnLayerUp')?.addEventListener('click', () => this.bringSelectedForward());
    document.getElementById('btnLayerDown')?.addEventListener('click', () => this.sendSelectedBackward());
    document.getElementById('btnDuplicateEl')?.addEventListener('click', () => this.duplicateSelectedElement());
    document.getElementById('btnDeleteEl')?.addEventListener('click', () => this.deleteSelectedElement());

    // 6. Slide Background Color
    document.getElementById('slideBgColor')?.addEventListener('input', (e) => {
      if (this.slides[this.activeSlideIdx]) {
        this.slides[this.activeSlideIdx].bg = e.target.value;
        this.renderActiveSlide();
        this.renderThumbnails();
      }
    });

    // 7. Modals
    document.getElementById('btnOpenTemplates')?.addEventListener('click', () => {
      document.getElementById('modalTemplates')?.classList.add('active');
    });
    document.getElementById('btnOpenAbout')?.addEventListener('click', () => {
      document.getElementById('modalAbout')?.classList.add('active');
    });

    // 8. Slideshow Controls
    document.getElementById('btnStartSlideshow')?.addEventListener('click', () => this.startSlideshow());
    document.getElementById('ssPrev')?.addEventListener('click', () => this.prevSlide());
    document.getElementById('ssNext')?.addEventListener('click', () => this.nextSlide());
    document.getElementById('ssExit')?.addEventListener('click', () => this.exitSlideshow());
    document.getElementById('ssLaser')?.addEventListener('click', () => this.toggleLaserPointer());
    document.getElementById('ssPen')?.addEventListener('click', () => this.togglePenTool());
    document.getElementById('ssClearDraw')?.addEventListener('click', () => this.clearPenDrawings());
    document.getElementById('ssBlackout')?.addEventListener('click', () => this.toggleBlackout());

    // 9. Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (this.isSlideshow) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
          e.preventDefault();
          this.nextSlide();
        } else if (e.key === 'ArrowLeft' || e.key === 'Backspace' || e.key === 'PageUp') {
          e.preventDefault();
          this.prevSlide();
        } else if (e.key === 'Escape') {
          this.exitSlideshow();
        } else if (e.key.toLowerCase() === 'l') {
          this.toggleLaserPointer();
        } else if (e.key.toLowerCase() === 'p') {
          this.togglePenTool();
        } else if (e.key.toLowerCase() === 'b') {
          this.toggleBlackout();
        } else if (e.key.toLowerCase() === 'c') {
          this.clearPenDrawings();
        }
      } else {
        if (e.key === 'F5') {
          e.preventDefault();
          this.startSlideshow();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          this.saveDeck();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
          if (this.selectedElement) {
            e.preventDefault();
            this.duplicateSelectedElement();
          }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (this.selectedElement && document.activeElement !== this.selectedDomEl && !this.selectedDomEl?.contains(document.activeElement)) {
            e.preventDefault();
            this.deleteSelectedElement();
          }
        }
      }
    });

    // 10. Laser Pointer & Presentation Canvas Drawing
    const laserEl = document.getElementById('laserPointerEl');
    window.addEventListener('mousemove', (e) => {
      if (this.isSlideshow && this.laserActive && laserEl) {
        laserEl.style.left = `${e.clientX}px`;
        laserEl.style.top = `${e.clientY}px`;
      }
    });

    this.setupDrawingCanvas();

    // 11. Deselect on Canvas Background Click
    const viewport = document.getElementById('canvasViewport');
    viewport?.addEventListener('click', (e) => {
      if (e.target === viewport || e.target.id === 'slideCanvas' || e.target.classList.contains('slide-stage-wrapper')) {
        this.deselectElement();
      }
    });

    // 12. Language Switcher Buttons
    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => this.setLanguage(btn.getAttribute('data-lang')));
    });

    // 13. Populate Templates List
    this.populateTemplates();
  }

  // --- Slide Stage & Element Rendering ---

  loadTemplate(tpl) {
    this.slides = JSON.parse(JSON.stringify(tpl.slides));
    this.activeSlideIdx = 0;
    this.deselectElement();

    const title = this.currentLang === 'fr' ? tpl.nameFr : (this.currentLang === 'en' ? tpl.nameEn : tpl.nameAr);
    this.deckTitle = title;
    const titleInput = document.getElementById('deckTitleInput');
    if (titleInput) titleInput.value = this.deckTitle;
    document.title = `${this.deckTitle} — DZ-Impress Pro`;

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
          <div class="mini-title" style="color: ${slide.textColor || '#ffffff'};">${slide.title || 'شريحة ' + (idx + 1)}</div>
        </div>
      `;
      thumb.addEventListener('click', () => {
        this.activeSlideIdx = idx;
        this.deselectElement();
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

    const bgInput = document.getElementById('slideBgColor');
    if (bgInput && slide.bg && !slide.bg.startsWith('linear-gradient')) {
      bgInput.value = slide.bg;
    }

    slide.elements.forEach((el, idx) => {
      const box = document.createElement('div');
      box.className = 'slide-element';
      box.id = `el_${idx}`;
      box.style.left = `${el.x}px`;
      box.style.top = `${el.y}px`;
      box.style.width = `${el.w}px`;
      box.style.height = `${el.h}px`;
      box.innerHTML = el.content;

      // Allow text typing if element is text
      if (el.type === 'text' || el.content.includes('<p') || el.content.includes('<h1') || el.content.includes('<h2')) {
        box.contentEditable = 'true';
        box.spellcheck = false;
        box.addEventListener('input', () => {
          el.content = box.innerHTML;
        });
      }

      // 8 Resize Handles
      const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      handles.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `resize-handle handle-${pos}`;
        handle.setAttribute('data-handle', pos);
        box.appendChild(handle);
      });

      // Selection & Dragging
      this.attachElementInteractions(box, el, idx);

      canvas.appendChild(box);

      if (this.selectedElement === el) {
        box.classList.add('selected');
        this.selectedDomEl = box;
      }
    });

    this.updateElementToolbarState();
  }

  attachElementInteractions(domEl, dataEl, idx) {
    // Selection on click
    domEl.addEventListener('mousedown', (e) => {
      // If clicking a resize handle, start resizing
      const handle = e.target.closest('.resize-handle');
      if (handle) {
        e.stopPropagation();
        this.startElementResize(e, domEl, dataEl, handle.getAttribute('data-handle'));
        return;
      }

      this.selectElement(domEl, dataEl, idx);

      // Dragging logic (only drag if not actively typing inside editable text)
      if (document.activeElement === domEl && e.target !== domEl) {
        // user clicked text to edit
        return;
      }

      e.stopPropagation();
      this.startElementDrag(e, domEl, dataEl);
    });
  }

  selectElement(domEl, dataEl, idx) {
    if (this.selectedDomEl) {
      this.selectedDomEl.classList.remove('selected');
    }
    this.selectedElement = dataEl;
    this.selectedDomEl = domEl;
    this.selectedElementIdx = idx;
    domEl.classList.add('selected');
    this.updateElementToolbarState();
  }

  deselectElement() {
    if (this.selectedDomEl) {
      this.selectedDomEl.classList.remove('selected');
    }
    this.selectedElement = null;
    this.selectedDomEl = null;
    this.selectedElementIdx = -1;
    this.updateElementToolbarState();
  }

  updateElementToolbarState() {
    const actionGroup = document.getElementById('elementActionGroup');
    if (!actionGroup) return;
    if (this.selectedElement) {
      actionGroup.style.opacity = '1';
      actionGroup.style.pointerEvents = 'auto';
    } else {
      actionGroup.style.opacity = '0.4';
      actionGroup.style.pointerEvents = 'none';
    }
  }

  startElementDrag(e, domEl, dataEl) {
    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = dataEl.x;
    const initTop = dataEl.y;

    const onMouseMove = (moveEvt) => {
      const dx = moveEvt.clientX - startX;
      const dy = moveEvt.clientY - startY;
      dataEl.x = Math.max(0, Math.min(960 - dataEl.w, Math.round(initLeft + dx)));
      dataEl.y = Math.max(0, Math.min(540 - dataEl.h, Math.round(initTop + dy)));
      domEl.style.left = `${dataEl.x}px`;
      domEl.style.top = `${dataEl.y}px`;
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  startElementResize(e, domEl, dataEl, handleType) {
    const startX = e.clientX;
    const startY = e.clientY;
    const initX = dataEl.x;
    const initY = dataEl.y;
    const initW = dataEl.w;
    const initH = dataEl.h;

    const onMouseMove = (moveEvt) => {
      const dx = moveEvt.clientX - startX;
      const dy = moveEvt.clientY - startY;

      let newX = initX;
      let newY = initY;
      let newW = initW;
      let newH = initH;

      if (handleType.includes('e')) {
        newW = Math.max(40, initW + dx);
      }
      if (handleType.includes('s')) {
        newH = Math.max(20, initH + dy);
      }
      if (handleType.includes('w')) {
        const potentialW = initW - dx;
        if (potentialW >= 40) {
          newW = potentialW;
          newX = initX + dx;
        }
      }
      if (handleType.includes('n')) {
        const potentialH = initH - dy;
        if (potentialH >= 20) {
          newH = potentialH;
          newY = initY + dy;
        }
      }

      dataEl.x = Math.round(newX);
      dataEl.y = Math.round(newY);
      dataEl.w = Math.round(newW);
      dataEl.h = Math.round(newH);

      domEl.style.left = `${dataEl.x}px`;
      domEl.style.top = `${dataEl.y}px`;
      domEl.style.width = `${dataEl.w}px`;
      domEl.style.height = `${dataEl.h}px`;
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // --- Element Actions (Layer, Duplicate, Delete) ---

  bringSelectedForward() {
    const slide = this.slides[this.activeSlideIdx];
    if (!slide || !this.selectedElement) return;
    const idx = slide.elements.indexOf(this.selectedElement);
    if (idx >= 0 && idx < slide.elements.length - 1) {
      const temp = slide.elements[idx];
      slide.elements[idx] = slide.elements[idx + 1];
      slide.elements[idx + 1] = temp;
      this.renderActiveSlide();
    }
  }

  sendSelectedBackward() {
    const slide = this.slides[this.activeSlideIdx];
    if (!slide || !this.selectedElement) return;
    const idx = slide.elements.indexOf(this.selectedElement);
    if (idx > 0) {
      const temp = slide.elements[idx];
      slide.elements[idx] = slide.elements[idx - 1];
      slide.elements[idx - 1] = temp;
      this.renderActiveSlide();
    }
  }

  duplicateSelectedElement() {
    const slide = this.slides[this.activeSlideIdx];
    if (!slide || !this.selectedElement) return;
    const clone = JSON.parse(JSON.stringify(this.selectedElement));
    clone.id = 'el_' + Date.now();
    clone.x = Math.min(960 - clone.w, clone.x + 24);
    clone.y = Math.min(540 - clone.h, clone.y + 24);
    slide.elements.push(clone);
    this.selectedElement = clone;
    this.renderActiveSlide();
  }

  deleteSelectedElement() {
    const slide = this.slides[this.activeSlideIdx];
    if (!slide || !this.selectedElement) return;
    const idx = slide.elements.indexOf(this.selectedElement);
    if (idx >= 0) {
      slide.elements.splice(idx, 1);
      this.deselectElement();
      this.renderActiveSlide();
    }
  }

  // --- Adding New Elements ---

  addTextElement() {
    const slide = this.slides[this.activeSlideIdx];
    if (!slide) return;
    const newEl = {
      id: 'el_' + Date.now(),
      type: 'text',
      x: 120,
      y: 160,
      w: 480,
      h: 90,
      content: '<p style="font-size: 18pt; color: #f8fafc; margin: 0; line-height: 1.5;">أدخل نص العرض التوضيحي هنا...</p>'
    };
    slide.elements.push(newEl);
    this.selectedElement = newEl;
    this.renderActiveSlide();
  }

  addCardElement() {
    const slide = this.slides[this.activeSlideIdx];
    if (!slide) return;
    const newEl = {
      id: 'el_' + Date.now(),
      type: 'card',
      x: 280,
      y: 140,
      w: 400,
      h: 220,
      content: `
        <div style="background: rgba(15,23,42,0.85); border: 2px solid #38bdf8; border-radius: 12px; padding: 20px; box-sizing: border-box; height: 100%; box-shadow: 0 10px 20px rgba(0,0,0,0.3);">
          <h3 style="color: #38bdf8; margin: 0 0 10px 0; font-size: 16pt;">مؤشر رقمي / إحصائية وطنية</h3>
          <p style="font-size: 12pt; color: #94a3b8; line-height: 1.8; margin: 0;">تفاصيل المؤشر والنتائج المسجلة خلال المشروع بالتفصيل.</p>
        </div>
      `
    };
    slide.elements.push(newEl);
    this.selectedElement = newEl;
    this.renderActiveSlide();
  }

  addImageElement(dataUrl) {
    const slide = this.slides[this.activeSlideIdx];
    if (!slide) return;
    const newEl = {
      id: 'el_' + Date.now(),
      type: 'image',
      x: 240,
      y: 120,
      w: 480,
      h: 300,
      content: `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 8px 20px rgba(0,0,0,0.3);">`
    };
    slide.elements.push(newEl);
    this.selectedElement = newEl;
    this.renderActiveSlide();
  }

  insertShape(shapeDef) {
    const slide = this.slides[this.activeSlideIdx];
    if (!slide) return;
    const newEl = {
      id: 'el_' + Date.now(),
      type: 'shape',
      x: 280,
      y: 160,
      w: 400,
      h: 220,
      content: shapeDef.generateHTML()
    };
    slide.elements.push(newEl);
    this.selectedElement = newEl;
    this.renderActiveSlide();
  }

  populateShapes() {
    const list = document.getElementById('shapesList');
    if (!list) return;
    list.innerHTML = '';

    SHAPES_DEFINITIONS.forEach(shape => {
      const card = document.createElement('div');
      card.className = 'shape-item-card';
      const name = this.currentLang === 'fr' ? shape.nameFr : (this.currentLang === 'en' ? shape.nameEn : shape.nameAr);
      card.innerHTML = `
        <div class="shape-item-preview">
          ${shape.generateHTML()}
        </div>
        <span class="shape-item-title">${name}</span>
      `;
      card.addEventListener('click', () => {
        this.insertShape(shape);
        document.getElementById('modalShapes')?.classList.remove('active');
      });
      list.appendChild(card);
    });
  }

  // --- Slides Management ---

  addNewSlide() {
    const newSlide = {
      id: 's_' + Date.now(),
      title: 'شريحة جديدة',
      bg: '#0f172a',
      textColor: '#ffffff',
      elements: [
        {
          id: 'el_1',
          type: 'text',
          x: 60,
          y: 50,
          w: 840,
          h: 60,
          content: '<h2 style="color: #38bdf8; border-bottom: 2px solid #334155; padding-bottom: 8px; margin: 0; font-size: 22pt;">عنوان الشريحة الجديد</h2>'
        },
        {
          id: 'el_2',
          type: 'text',
          x: 60,
          y: 140,
          w: 840,
          h: 280,
          content: '<p style="font-size: 15pt; line-height: 2; color: #cbd5e1; margin: 0;">• النقطة الأولى: شرح الفكرة أو المعطيات بدقة.<br>• النقطة الثانية: تحليل النتائج والمقارنات الميدانية.<br>• النقطة الثالثة: التوصيات والآفاق المستقبلية.</p>'
        }
      ]
    };
    this.slides.push(newSlide);
    this.activeSlideIdx = this.slides.length - 1;
    this.deselectElement();
    this.renderThumbnails();
    this.renderActiveSlide();
  }

  duplicateCurrentSlide() {
    if (!this.slides[this.activeSlideIdx]) return;
    const clone = JSON.parse(JSON.stringify(this.slides[this.activeSlideIdx]));
    clone.id = 's_' + Date.now();
    this.slides.splice(this.activeSlideIdx + 1, 0, clone);
    this.activeSlideIdx++;
    this.deselectElement();
    this.renderThumbnails();
    this.renderActiveSlide();
  }

  deleteCurrentSlide() {
    const t = I18N[this.currentLang];
    if (this.slides.length <= 1) {
      alert(t.cannotDeleteOnlySlide);
      return;
    }
    if (confirm(t.deleteSlideConfirm)) {
      this.slides.splice(this.activeSlideIdx, 1);
      this.activeSlideIdx = Math.max(0, this.activeSlideIdx - 1);
      this.deselectElement();
      this.renderThumbnails();
      this.renderActiveSlide();
    }
  }

  // --- Fullscreen Slideshow Mode ---

  startSlideshow() {
    this.isSlideshow = true;
    this.slideshowSeconds = 0;
    this.isBlackout = false;
    const container = document.getElementById('slideshowOverlay');
    if (container) {
      container.classList.add('active');
      this.renderSlideshowView();
      this.resizeDrawingCanvas();
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
    const container = document.getElementById('ssElementsContainer') || screen;
    if (!screen) return;
    const slide = this.slides[this.activeSlideIdx];
    if (!slide) return;

    screen.style.background = this.isBlackout ? '#000000' : (slide.bg || '#ffffff');
    container.innerHTML = '';

    if (!this.isBlackout) {
      slide.elements.forEach(el => {
        const box = document.createElement('div');
        box.className = 'ss-slide-element';
        box.style.left = `${el.x}px`;
        box.style.top = `${el.y}px`;
        box.style.width = `${el.w}px`;
        box.style.height = `${el.h}px`;
        box.innerHTML = el.content;
        container.appendChild(box);
      });
    }

    const counter = document.getElementById('ssCounter');
    if (counter) {
      counter.textContent = `${this.activeSlideIdx + 1} / ${this.slides.length}`;
    }
  }

  nextSlide() {
    if (this.activeSlideIdx < this.slides.length - 1) {
      this.activeSlideIdx++;
      if (this.isSlideshow) {
        this.clearPenDrawings();
        this.renderSlideshowView();
      } else {
        this.deselectElement();
        this.renderThumbnails();
        this.renderActiveSlide();
      }
    }
  }

  prevSlide() {
    if (this.activeSlideIdx > 0) {
      this.activeSlideIdx--;
      if (this.isSlideshow) {
        this.clearPenDrawings();
        this.renderSlideshowView();
      } else {
        this.deselectElement();
        this.renderThumbnails();
        this.renderActiveSlide();
      }
    }
  }

  exitSlideshow() {
    this.isSlideshow = false;
    this.laserActive = false;
    this.penActive = false;
    this.isBlackout = false;

    const laserEl = document.getElementById('laserPointerEl');
    if (laserEl) laserEl.style.display = 'none';

    const drawCanvas = document.getElementById('slideshowDrawCanvas');
    if (drawCanvas) drawCanvas.classList.remove('active');

    document.getElementById('ssLaser')?.classList.remove('active');
    document.getElementById('ssPen')?.classList.remove('active');

    if (this.slideshowTimerInterval) clearInterval(this.slideshowTimerInterval);
    document.getElementById('slideshowOverlay')?.classList.remove('active');

    this.renderThumbnails();
    this.renderActiveSlide();
  }

  toggleLaserPointer() {
    this.laserActive = !this.laserActive;
    if (this.laserActive) {
      this.penActive = false;
      document.getElementById('ssPen')?.classList.remove('active');
      document.getElementById('slideshowDrawCanvas')?.classList.remove('active');
    }
    const laserEl = document.getElementById('laserPointerEl');
    if (laserEl) {
      laserEl.style.display = this.laserActive ? 'block' : 'none';
    }
    document.getElementById('ssLaser')?.classList.toggle('active', this.laserActive);
  }

  togglePenTool() {
    this.penActive = !this.penActive;
    if (this.penActive) {
      this.laserActive = false;
      document.getElementById('ssLaser')?.classList.remove('active');
      const laserEl = document.getElementById('laserPointerEl');
      if (laserEl) laserEl.style.display = 'none';
    }
    const canvas = document.getElementById('slideshowDrawCanvas');
    canvas?.classList.toggle('active', this.penActive);
    document.getElementById('ssPen')?.classList.toggle('active', this.penActive);
  }

  toggleBlackout() {
    this.isBlackout = !this.isBlackout;
    document.getElementById('ssBlackout')?.classList.toggle('active', this.isBlackout);
    this.renderSlideshowView();
  }

  setupDrawingCanvas() {
    const canvas = document.getElementById('slideshowDrawCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const startDraw = (e) => {
      if (!this.penActive) return;
      this.isDrawing = true;
      const rect = canvas.getBoundingClientRect();
      this.lastDrawX = e.clientX - rect.left;
      this.lastDrawY = e.clientY - rect.top;
    };

    const draw = (e) => {
      if (!this.isDrawing || !this.penActive) return;
      const rect = canvas.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;

      ctx.beginPath();
      ctx.moveTo(this.lastDrawX, this.lastDrawY);
      ctx.lineTo(curX, curY);
      ctx.strokeStyle = this.penColor;
      ctx.lineWidth = this.penWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      this.lastDrawX = curX;
      this.lastDrawY = curY;
    };

    const stopDraw = () => {
      this.isDrawing = false;
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);
  }

  resizeDrawingCanvas() {
    const screen = document.getElementById('slideshowScreen');
    const canvas = document.getElementById('slideshowDrawCanvas');
    if (screen && canvas) {
      canvas.width = screen.clientWidth;
      canvas.height = screen.clientHeight;
    }
  }

  clearPenDrawings() {
    const canvas = document.getElementById('slideshowDrawCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // --- Export Hub Integration ---

  exportCurrentSlidePng() {
    const currentSlide = this.slides[this.activeSlideIdx];
    if (!currentSlide) return;
    ExportEngine.exportSlideAsPng(currentSlide, this.activeSlideIdx + 1, this.deckTitle);
  }

  exportPortableHtml() {
    const blob = ExportEngine.generatePortableHtml(this.deckTitle, this.slides);
    const filename = `${this.sanitizeFilename(this.deckTitle)}_standalone.html`;
    this.downloadFile(blob, filename);
  }

  saveDeck() {
    const blob = ExportEngine.exportDzSlide(this.deckTitle, this.slides);
    const filename = `${this.sanitizeFilename(this.deckTitle)}.dzslide`;
    this.downloadFile(blob, filename);
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
          this.deselectElement();
          this.renderThumbnails();
          this.renderActiveSlide();
        }
      } catch (err) {
        alert('تعذر قراءة ملف العرض: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  newDeck() {
    const t = I18N[this.currentLang];
    if (confirm(t.newDeckConfirm)) {
      this.loadTemplate(SLIDE_TEMPLATES[SLIDE_TEMPLATES.length - 1]); // Blank canvas or basic
    }
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
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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

  updateStatus() {
    const t = I18N[this.currentLang];
    const statusText = t.slideOf
      .replace('{current}', this.activeSlideIdx + 1)
      .replace('{total}', this.slides.length);
    const counterEl = document.getElementById('statusSlideCounter');
    if (counterEl) counterEl.textContent = statusText;
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
    return (name || 'presentation').replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_');
  }

  setLanguage(lang) {
    if (!I18N[lang]) return;
    this.currentLang = lang;
    localStorage.setItem('dz_slides_lang', lang);
    this.applyLanguage(lang);
    this.populateTemplates();
    this.populateShapes();
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

// Global App Initialization
window.dzSlidesApp = new DZSlidesApp();

window.addEventListener('DOMContentLoaded', () => {
  // Modal Backdrop & Close Buttons
  document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    });
  });
});
