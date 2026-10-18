/**
 * DZ-Photo (PhotoCraft Studio / مصمم الصور وتعديلها) — Application Logic
 * 100% Offline-First, Zero-Dependency, Native Desktop Photo & Graphic Design Studio
 */

import { LayersEngine } from './layers-engine.js';
import {
  applyGrayscale,
  applyInvert,
  applySepia,
  applyBrightnessContrast,
  applyAlgerianSunset,
  applyMediterraneanBlue,
  flipHorizontal,
  flipVertical
} from './filters.js';

const I18N = {
  ar: {
    appTitle: 'مصمم الصور الجزائري — DZ-Photo Studio',
    file: 'ملف',
    edit: 'تعديل',
    image: 'صورة',
    layer: 'طبقة',
    filters: 'مرشحات وتأثيرات',
    help: 'مساعدة',
    newProject: 'مشروع جديد...',
    openImage: 'فتح صورة أو مشروع...',
    saveProject: 'حفظ المشروع (.dzphoto)',
    exportPng: 'تصدير صورة PNG عالية الدقة',
    exportJpg: 'تصدير صورة JPEG مضغوطة',
    exportWebp: 'تصدير صورة WEBP للويب',
    undo: 'تراجع (Ctrl+Z)',
    redo: 'إعادة (Ctrl+Y)',
    toolBrush: 'فرشاة الرسم (B)',
    toolEraser: 'ممحاة (E)',
    toolRect: 'مستطيل (U)',
    toolCircle: 'دائرة / بيضاوي (O)',
    toolLine: 'خط مستقيم (L)',
    toolText: 'إدراج نص (T)',
    toolBucket: 'دلو التعبئة (G)',
    toolPicker: 'قطارة الألوان (I)',
    layersTitle: 'الطبقات (Layers)',
    addLayer: 'طبقة جديدة',
    duplicateLayer: 'تكرار الطبقة',
    deleteLayer: 'حذف الطبقة',
    opacity: 'الشفافية:',
    dimensions: 'الأبعاد القياسية:',
    filterGrayscale: 'أبيض وأسود (Grayscale)',
    filterInvert: 'عكس الألوان (Negative)',
    filterSepia: 'سيبيا كلاسيكي (Sepia)',
    filterSunset: 'غروب الصحراء الجزائرية (Warm Sunset)',
    filterBlue: 'زرقة البحر الأبيض المتوسط (Cool Blue)',
    flipH: 'انعكاس أفقي (Flip Horizontal)',
    flipV: 'انعكاس عمودي (Flip Vertical)',
    aboutTitle: 'عن مصمم الصور (DZ-Photo)',
    aboutDesc: 'استوديو تصميم ورسم وتعديل صور مكتبي حر ومفتوح المصدر 100% جزائري، بديل خفيف ومتكامل لأدوبي فوتوشوب وكانفا وفوتوبيا مع طبقات ومرشحات وأبعاد مخصصة للمحتوى الوطني.',
    close: 'إغلاق'
  },
  fr: {
    appTitle: 'DZ-Photo — Studio de Retouche & Graphisme',
    file: 'Fichier',
    edit: 'Édition',
    image: 'Image',
    layer: 'Calque',
    filters: 'Filtres',
    help: 'Aide',
    newProject: 'Nouveau projet...',
    openImage: 'Ouvrir une image...',
    saveProject: 'Enregistrer le projet (.dzphoto)',
    exportPng: 'Exporter en PNG',
    exportJpg: 'Exporter en JPEG',
    exportWebp: 'Exporter en WEBP',
    undo: 'Annuler (Ctrl+Z)',
    redo: 'Rétablir (Ctrl+Y)',
    toolBrush: 'Pinceau (B)',
    toolEraser: 'Gomme (E)',
    toolRect: 'Rectangle (U)',
    toolCircle: 'Cercle / Ovale (O)',
    toolLine: 'Ligne droite (L)',
    toolText: 'Texte (T)',
    toolBucket: 'Pot de peinture (G)',
    toolPicker: 'Pipette (I)',
    layersTitle: 'Calques (Layers)',
    addLayer: 'Nouveau calque',
    duplicateLayer: 'Dupliquer le calque',
    deleteLayer: 'Supprimer le calque',
    opacity: 'Opacité :',
    dimensions: 'Dimensions prédéfinies :',
    filterGrayscale: 'Niveaux de gris',
    filterInvert: 'Négatif / Inverser',
    filterSepia: 'Sépia vintage',
    filterSunset: 'Coucher de soleil saharien',
    filterBlue: 'Bleu Méditerranée',
    flipH: 'Retournement horizontal',
    flipV: 'Retournement vertical',
    aboutTitle: 'À propos de DZ-Photo',
    aboutDesc: 'Studio graphique et de retouche photo 100% open source souverain, alternative légère et complète à Adobe Photoshop et Canva.',
    close: 'Fermer'
  },
  en: {
    appTitle: 'DZ-Photo — Sovereign Graphic & Photo Studio',
    file: 'File',
    edit: 'Edit',
    image: 'Image',
    layer: 'Layer',
    filters: 'Filters',
    help: 'Help',
    newProject: 'New Project...',
    openImage: 'Open Image...',
    saveProject: 'Save Project (.dzphoto)',
    exportPng: 'Export as PNG',
    exportJpg: 'Export as JPEG',
    exportWebp: 'Export as WEBP',
    undo: 'Undo (Ctrl+Z)',
    redo: 'Redo (Ctrl+Y)',
    toolBrush: 'Brush Tool (B)',
    toolEraser: 'Eraser (E)',
    toolRect: 'Rectangle (U)',
    toolCircle: 'Circle / Ellipse (O)',
    toolLine: 'Line (L)',
    toolText: 'Text (T)',
    toolBucket: 'Paint Bucket (G)',
    toolPicker: 'Eyedropper (I)',
    layersTitle: 'Layers',
    addLayer: 'New Layer',
    duplicateLayer: 'Duplicate Layer',
    deleteLayer: 'Delete Layer',
    opacity: 'Opacity:',
    dimensions: 'Preset Dimensions:',
    filterGrayscale: 'Grayscale',
    filterInvert: 'Invert Colors',
    filterSepia: 'Vintage Sepia',
    filterSunset: 'Sahara Warm Sunset',
    filterBlue: 'Mediterranean Blue',
    flipH: 'Flip Horizontal',
    flipV: 'Flip Vertical',
    aboutTitle: 'About DZ-Photo',
    aboutDesc: '100% offline-first sovereign photo & graphic design studio, Photoshop & Canva alternative with layers, filters, and Algerian social media presets.',
    close: 'Close'
  }
};

export class DZPhotoApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_photo_lang') || 'ar';
    this.currentTool = 'brush';
    this.brushColor = '#059669';
    this.brushSize = 10;
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;

    this.mainCanvas = null;
    this.mainCtx = null;
    this.layersEngine = null;

    this.init();
  }

  init() {
    this.mainCanvas = document.getElementById('compositeCanvas');
    this.mainCtx = this.mainCanvas.getContext('2d');

    this.layersEngine = new LayersEngine(900, 600, () => {
      this.render();
      this.renderLayersList();
    });

    this.mainCanvas.width = 900;
    this.mainCanvas.height = 600;

    this.bindEvents();
    this.applyLanguage(this.currentLang);
    this.render();
    this.renderLayersList();
  }

  bindEvents() {
    // Canvas Mouse Events
    this.mainCanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.mainCanvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());

    // Tools Buttons
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.getAttribute('data-tool');
      });
    });

    // Brush Settings
    const colorPicker = document.getElementById('brushColorPicker');
    if (colorPicker) {
      colorPicker.addEventListener('input', (e) => {
        this.brushColor = e.target.value;
      });
    }

    const sizeSlider = document.getElementById('brushSizeSlider');
    const sizeVal = document.getElementById('brushSizeValue');
    if (sizeSlider && sizeVal) {
      sizeSlider.addEventListener('input', (e) => {
        this.brushSize = parseInt(e.target.value, 10);
        sizeVal.textContent = `${this.brushSize}px`;
      });
    }

    // Layers Controls
    document.getElementById('btnAddLayer')?.addEventListener('click', () => this.layersEngine.addLayer());
    document.getElementById('btnDuplicateLayer')?.addEventListener('click', () => this.layersEngine.duplicateActiveLayer());
    document.getElementById('btnDeleteLayer')?.addEventListener('click', () => {
      if (!this.layersEngine.deleteActiveLayer()) {
        alert('لا يمكن حذف الطبقة الوحيدة في المشروع.');
      }
    });
    document.getElementById('btnMoveLayerUp')?.addEventListener('click', () => this.layersEngine.moveActiveLayerUp());
    document.getElementById('btnMoveLayerDown')?.addEventListener('click', () => this.layersEngine.moveActiveLayerDown());

    // Active Layer Opacity Slider
    const opacitySlider = document.getElementById('layerOpacitySlider');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', (e) => {
        const active = this.layersEngine.getActiveLayer();
        if (active) {
          active.opacity = parseFloat(e.target.value);
          this.render();
        }
      });
    }

    // Filter Buttons
    document.getElementById('btnFilterGrayscale')?.addEventListener('click', () => this.applyFilter('grayscale'));
    document.getElementById('btnFilterInvert')?.addEventListener('click', () => this.applyFilter('invert'));
    document.getElementById('btnFilterSepia')?.addEventListener('click', () => this.applyFilter('sepia'));
    document.getElementById('btnFilterSunset')?.addEventListener('click', () => this.applyFilter('sunset'));
    document.getElementById('btnFilterBlue')?.addEventListener('click', () => this.applyFilter('blue'));
    document.getElementById('btnFlipH')?.addEventListener('click', () => this.applyFilter('flipH'));
    document.getElementById('btnFlipV')?.addEventListener('click', () => this.applyFilter('flipV'));

    // File Operations
    document.getElementById('btnNewProject')?.addEventListener('click', () => {
      document.getElementById('modalNewProject')?.classList.add('active');
    });

    document.getElementById('btnConfirmNewProject')?.addEventListener('click', () => {
      const w = parseInt(document.getElementById('newProjWidth').value, 10) || 800;
      const h = parseInt(document.getElementById('newProjHeight').value, 10) || 600;
      this.createNewProject(w, h);
      document.getElementById('modalNewProject')?.classList.remove('active');
    });

    // Preset dimensions dropdown
    document.getElementById('presetDimensionsSelect')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) {
        const [w, h] = val.split('x').map(Number);
        document.getElementById('newProjWidth').value = w;
        document.getElementById('newProjHeight').value = h;
      }
    });

    // Open file
    const fileInput = document.getElementById('imageFileInput');
    document.getElementById('btnOpenImageFile')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.openImageFile(e.target.files[0]);
      }
      fileInput.value = '';
    });

    // Drag and drop onto main canvas
    const wrapper = document.getElementById('canvasArea');
    if (wrapper) {
      wrapper.addEventListener('dragover', (e) => e.preventDefault());
      wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.openImageFile(e.dataTransfer.files[0]);
        }
      });
    }

    // Export buttons
    document.getElementById('btnExportPng')?.addEventListener('click', () => this.exportImage('png'));
    document.getElementById('btnExportJpg')?.addEventListener('click', () => this.exportImage('jpeg'));
    document.getElementById('btnExportWebp')?.addEventListener('click', () => this.exportImage('webp'));
    document.getElementById('btnSaveProject')?.addEventListener('click', () => this.saveProject());

    // Undo / Redo
    document.getElementById('btnUndo')?.addEventListener('click', () => this.layersEngine.undo());
    document.getElementById('btnRedo')?.addEventListener('click', () => this.layersEngine.redo());

    // About modal
    document.getElementById('btnOpenAbout')?.addEventListener('click', () => {
      document.getElementById('modalAbout')?.classList.add('active');
    });

    // Language switcher
    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => this.setLanguage(btn.getAttribute('data-lang')));
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) this.layersEngine.redo();
          else this.layersEngine.undo();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          this.layersEngine.redo();
        } else if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          this.saveProject();
        }
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'b': this.setTool('brush'); break;
          case 'e': this.setTool('eraser'); break;
          case 'u': this.setTool('rect'); break;
          case 'o': this.setTool('circle'); break;
          case 'l': this.setTool('line'); break;
          case 't': this.setTool('text'); break;
          case 'g': this.setTool('bucket'); break;
          case 'i': this.setTool('picker'); break;
        }
      }
    });

    // Modal closers
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
      });
    });
  }

  setTool(tool) {
    this.currentTool = tool;
    document.querySelectorAll('[data-tool]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tool') === tool);
    });
  }

  getCanvasCoords(e) {
    const rect = this.mainCanvas.getBoundingClientRect();
    const scaleX = this.mainCanvas.width / rect.width;
    const scaleY = this.mainCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  onMouseDown(e) {
    const coords = this.getCanvasCoords(e);
    this.startX = coords.x;
    this.startY = coords.y;
    this.isDrawing = true;

    const ctx = this.layersEngine.getActiveCtx();
    if (!ctx) return;

    if (this.currentTool === 'brush') {
      ctx.beginPath();
      ctx.moveTo(this.startX, this.startY);
      ctx.strokeStyle = this.brushColor;
      ctx.lineWidth = this.brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    } else if (this.currentTool === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(this.startX, this.startY);
      ctx.lineWidth = this.brushSize;
      ctx.lineCap = 'round';
    } else if (this.currentTool === 'bucket') {
      ctx.fillStyle = this.brushColor;
      ctx.fillRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
      this.layersEngine.recordHistory();
      this.render();
      this.isDrawing = false;
    } else if (this.currentTool === 'picker') {
      const p = this.mainCtx.getImageData(this.startX, this.startY, 1, 1).data;
      const hex = `#${((1 << 24) + (p[0] << 16) + (p[1] << 8) + p[2]).toString(16).slice(1)}`;
      this.brushColor = hex;
      const cp = document.getElementById('brushColorPicker');
      if (cp) cp.value = hex;
      this.isDrawing = false;
    } else if (this.currentTool === 'text') {
      const text = prompt('اكتب النص المراد إدراجه على التصميم:', 'نص تصميم');
      if (text) {
        ctx.fillStyle = this.brushColor;
        ctx.font = `bold ${Math.max(16, this.brushSize * 2)}px 'Cairo', 'Inter', sans-serif`;
        ctx.fillText(text, this.startX, this.startY);
        this.layersEngine.recordHistory();
        this.render();
      }
      this.isDrawing = false;
    }
  }

  onMouseMove(e) {
    if (!this.isDrawing) return;
    const coords = this.getCanvasCoords(e);
    const ctx = this.layersEngine.getActiveCtx();
    if (!ctx) return;

    if (this.currentTool === 'brush') {
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
      this.render();
    } else if (this.currentTool === 'eraser') {
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
      this.render();
    }
  }

  onMouseUp() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    const ctx = this.layersEngine.getActiveCtx();
    if (!ctx) return;

    if (this.currentTool === 'eraser') {
      ctx.restore();
    }

    this.layersEngine.recordHistory();
    this.render();
  }

  render() {
    this.layersEngine.renderComposite(this.mainCtx);
  }

  renderLayersList() {
    const list = document.getElementById('layersList');
    if (!list) return;
    list.innerHTML = '';

    // Render layers in reverse order so top layer is at the top of the UI
    for (let i = this.layersEngine.layers.length - 1; i >= 0; i--) {
      const layer = this.layersEngine.layers[i];
      const item = document.createElement('div');
      item.className = `layer-item ${i === this.layersEngine.activeLayerIndex ? 'active' : ''}`;
      item.innerHTML = `
        <button class="layer-vis-btn" title="تبديل الرؤية">
          ${layer.visible ? 
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' : 
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
          }
        </button>
        <span class="layer-name">${layer.name}</span>
      `;

      item.querySelector('.layer-vis-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        this.render();
        this.renderLayersList();
      });

      item.addEventListener('click', () => {
        this.layersEngine.activeLayerIndex = i;
        const opacitySlider = document.getElementById('layerOpacitySlider');
        if (opacitySlider) opacitySlider.value = layer.opacity;
        this.renderLayersList();
      });

      list.appendChild(item);
    }
  }

  applyFilter(type) {
    const layer = this.layersEngine.getActiveLayer();
    if (!layer) return;

    switch (type) {
      case 'grayscale':
        applyGrayscale(layer.ctx, layer.canvas.width, layer.canvas.height);
        break;
      case 'invert':
        applyInvert(layer.ctx, layer.canvas.width, layer.canvas.height);
        break;
      case 'sepia':
        applySepia(layer.ctx, layer.canvas.width, layer.canvas.height);
        break;
      case 'sunset':
        applyAlgerianSunset(layer.ctx, layer.canvas.width, layer.canvas.height);
        break;
      case 'blue':
        applyMediterraneanBlue(layer.ctx, layer.canvas.width, layer.canvas.height);
        break;
      case 'flipH':
        flipHorizontal(layer.canvas, layer.ctx);
        break;
      case 'flipV':
        flipVertical(layer.canvas, layer.ctx);
        break;
    }

    this.layersEngine.recordHistory();
    this.render();
  }

  createNewProject(w, h) {
    this.mainCanvas.width = w;
    this.mainCanvas.height = h;
    this.layersEngine = new LayersEngine(w, h, () => {
      this.render();
      this.renderLayersList();
    });
    this.render();
    this.renderLayersList();
  }

  openImageFile(file) {
    if (file.name.endsWith('.dzphoto')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.width && data.height) {
            this.createNewProject(data.width, data.height);
            // Load layers
            if (data.layers && Array.isArray(data.layers)) {
              this.layersEngine.layers = [];
              data.layers.forEach((lData) => {
                const img = new Image();
                img.onload = () => {
                  const l = this.layersEngine.addLayer(lData.name, false);
                  l.visible = lData.visible;
                  l.opacity = lData.opacity;
                  l.ctx.drawImage(img, 0, 0);
                  this.render();
                };
                img.src = lData.dataUrl;
              });
            }
          }
        } catch (err) {
          alert('تعذر فتح مشروع DZ-Photo: ' + err.message);
        }
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          this.createNewProject(img.width, img.height);
          const active = this.layersEngine.getActiveLayer();
          if (active) {
            active.clear();
            active.ctx.drawImage(img, 0, 0);
            active.name = file.name;
          }
          this.render();
          this.renderLayersList();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  exportImage(format = 'png') {
    const mime = format === 'jpeg' ? 'image/jpeg' : (format === 'webp' ? 'image/webp' : 'image/png');
    const ext = format === 'jpeg' ? 'jpg' : format;
    const url = this.mainCanvas.toDataURL(mime, 0.95);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dz-photo-export.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  saveProject() {
    const projectData = {
      generator: 'DZ-Photo Pro 1.0.0',
      width: this.mainCanvas.width,
      height: this.mainCanvas.height,
      layers: this.layersEngine.layers.map(l => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        dataUrl: l.canvas.toDataURL('image/png')
      }))
    };
    const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `design-project.dzphoto`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  setLanguage(lang) {
    if (!I18N[lang]) return;
    this.currentLang = lang;
    localStorage.setItem('dz_photo_lang', lang);
    this.applyLanguage(lang);
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
  }
}

// Global App Instance
window.dzPhotoApp = new DZPhotoApp();
