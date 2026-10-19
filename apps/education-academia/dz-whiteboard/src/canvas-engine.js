/**
 * DZ-Whiteboard Pro — High-Performance 2D Vector Canvas Engine
 * -------------------------------------------------------------
 * 60fps infinite canvas with zoom, pan, Retina HiDPI support,
 * classroom background patterns, vector elements, and laser trail.
 * 100% Vanilla JS, zero dependencies.
 */

export class CanvasEngine {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');

    // Viewport transform
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.minZoom = 0.15;
    this.maxZoom = 5.0;

    // Laser pointer active trail
    this.laserPoints = [];
    this.laserColor = '#ef4444'; // Bright laser red
    this.laserGlow = 'rgba(239, 68, 68, 0.4)';

    // Interactive Classroom Geometric Tools (Ruler & Protractor)
    this.ruler = {
      active: false,
      x: 320,
      y: 280,
      length: 440,
      width: 65,
      angle: 0, // Radians
      isDragging: false,
      isRotating: false,
      dragOffset: { x: 0, y: 0 }
    };

    this.protractor = {
      active: false,
      x: 480,
      y: 320,
      radius: 170,
      angle: 0,
      isDragging: false,
      isRotating: false,
      dragOffset: { x: 0, y: 0 }
    };

    // Grid snapping toggle
    this.gridSnap = false;
    this.gridSnapSize = 20;

    // Multi-page document structure
    this.pages = [
      this.createBlankPage('الصفحة 1 (الدرس الرئيسي)')
    ];
    this.activePageIndex = 0;

    // Selection
    this.selectedElementIds = new Set();
    this.isDraggingSelection = false;

    // Listeners for change callbacks
    this.onDirty = options.onDirty || (() => {});

    // Resize handling
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  createBlankPage(name = 'صفحة جديدة', bg = 'white') {
    return {
      id: 'page_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name,
      background: bg, // 'white', 'grid', 'lines', 'dots', 'chalkboard', 'blackboard'
      customBgColor: null,
      elements: []
    };
  }

  get activePage() {
    return this.pages[this.activePageIndex] || this.pages[0];
  }

  resize() {
    const parent = this.canvas.parentElement || document.body;
    const width = parent.clientWidth || window.innerWidth;
    const height = parent.clientHeight || window.innerHeight;

    this.dpr = window.devicePixelRatio || 1;
    this.canvas.dir = 'ltr';
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    this.render();
  }

  // --- Coordinate Transformations ---

  screenToWorld(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    return {
      x: (x - this.panX) / this.zoom,
      y: (y - this.panY) / this.zoom
    };
  }

  worldToScreen(worldX, worldY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: worldX * this.zoom + this.panX + rect.left,
      y: worldY * this.zoom + this.panY + rect.top
    };
  }

  setZoom(newZoom, centerX = null, centerY = null) {
    const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    if (clamped === this.zoom) return;

    const rect = this.canvas.getBoundingClientRect();
    const cx = centerX != null ? centerX - rect.left : rect.width / 2;
    const cy = centerY != null ? centerY - rect.top : rect.height / 2;

    const wx = (cx - this.panX) / this.zoom;
    const wy = (cy - this.panY) / this.zoom;

    this.zoom = clamped;
    this.panX = cx - wx * this.zoom;
    this.panY = cy - wy * this.zoom;

    this.render();
    this.onDirty();
  }

  zoomIn() {
    this.setZoom(this.zoom * 1.25);
  }

  zoomOut() {
    this.setZoom(this.zoom / 1.25);
  }

  resetZoom() {
    const rect = this.canvas.getBoundingClientRect();
    this.zoom = 1.0;
    this.panX = rect.width / 2 - 400;
    this.panY = rect.height / 2 - 300;
    this.render();
    this.onDirty();
  }

  fitToContent() {
    const elements = this.activePage.elements;
    if (elements.length === 0) {
      this.resetZoom();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach((el) => {
      const b = this.getElementBounds(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    });

    const contentWidth = Math.max(100, maxX - minX);
    const contentHeight = Math.max(100, maxY - minY);
    const rect = this.canvas.getBoundingClientRect();

    const padding = 80;
    const scaleX = (rect.width - padding * 2) / contentWidth;
    const scaleY = (rect.height - padding * 2) / contentHeight;
    const targetZoom = Math.max(this.minZoom, Math.min(1.5, Math.min(scaleX, scaleY)));

    this.zoom = targetZoom;
    this.panX = (rect.width - contentWidth * targetZoom) / 2 - minX * targetZoom;
    this.panY = (rect.height - contentHeight * targetZoom) / 2 - minY * targetZoom;

    this.render();
    this.onDirty();
  }

  // --- Element Bounding Boxes ---

  getElementBounds(el) {
    if (el.type === 'pen') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      el.points.forEach((p) => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      const pad = (el.width || 2) / 2;
      return {
        x: minX - pad,
        y: minY - pad,
        width: Math.max(4, maxX - minX + pad * 2),
        height: Math.max(4, maxY - minY + pad * 2)
      };
    }

    if (el.type === 'line') {
      const minX = Math.min(el.x1, el.x2);
      const minY = Math.min(el.y1, el.y2);
      const maxX = Math.max(el.x1, el.x2);
      const maxY = Math.max(el.y1, el.y2);
      const pad = Math.max(8, el.strokeWidth || 2);
      return {
        x: minX - pad,
        y: minY - pad,
        width: Math.max(10, maxX - minX + pad * 2),
        height: Math.max(10, maxY - minY + pad * 2)
      };
    }

    if (el.type === 'shape' || el.type === 'sticky' || el.type === 'image') {
      return {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height
      };
    }

    if (el.type === 'text') {
      const fontSize = el.fontSize || 20;
      const lines = (el.text || '').split('\n');
      const estWidth = lines.reduce((max, line) => Math.max(max, line.length * (fontSize * 0.58)), 60);
      const estHeight = lines.length * (fontSize * 1.3);
      return {
        x: el.x,
        y: el.y,
        width: Math.max(60, estWidth),
        height: Math.max(fontSize * 1.3, estHeight)
      };
    }

    return { x: el.x || 0, y: el.y || 0, width: 40, height: 40 };
  }

  // --- Hit Testing ---

  hitTest(worldX, worldY) {
    const elements = this.activePage.elements;
    // Iterate in reverse (top-most elements first)
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (this.isPointInsideElement(el, worldX, worldY)) {
        return el;
      }
    }
    return null;
  }

  isPointInsideElement(el, px, py) {
    const b = this.getElementBounds(el);

    if (el.type === 'shape' || el.type === 'sticky' || el.type === 'text' || el.type === 'image') {
      return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
    }

    if (el.type === 'line') {
      // Distance from point to line segment
      const dist = this.pointToSegmentDistance(px, py, el.x1, el.y1, el.x2, el.y2);
      return dist <= Math.max(10, (el.strokeWidth || 2) * 2);
    }

    if (el.type === 'pen') {
      // First quick bounding box check
      if (px < b.x - 10 || px > b.x + b.width + 10 || py < b.y - 10 || py > b.y + b.height + 10) {
        return false;
      }
      const threshold = Math.max(8, (el.width || 3) * 1.5);
      for (let i = 0; i < el.points.length - 1; i++) {
        const p1 = el.points[i];
        const p2 = el.points[i + 1];
        if (this.pointToSegmentDistance(px, py, p1.x, p1.y, p2.x, p2.y) <= threshold) {
          return true;
        }
      }
      return false;
    }

    return false;
  }

  pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  snapCoord(val) {
    if (!this.gridSnap) return val;
    const size = this.gridSnapSize || 20;
    return Math.round(val / size) * size;
  }

  snapPoint(x, y) {
    if (!this.gridSnap) return { x, y };
    return {
      x: this.snapCoord(x),
      y: this.snapCoord(y)
    };
  }

  // --- Rendering Pipeline ---

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 1. Draw Classroom Background
    this.drawBackground(ctx, this.canvas.style.width, this.canvas.style.height);

    // 2. Apply World Transform
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // 3. Render Elements of Active Page
    const elements = this.activePage.elements;
    elements.forEach((el) => this.drawElement(ctx, el));

    // 4. Render Active Selection Box & Handles
    if (this.selectedElementIds.size > 0) {
      this.drawSelectionOverlay(ctx);
    }

    // 5. Render Laser Pointer Trail
    this.drawLaserTrail(ctx);

    // 6. Render Geometric Teaching Tools (Ruler & Protractor)
    if (this.ruler && this.ruler.active) {
      this.drawRuler(ctx);
    }
    if (this.protractor && this.protractor.active) {
      this.drawProtractor(ctx);
    }

    ctx.restore();
    ctx.restore();
  }

  drawBackground(ctx, cssWidth, cssHeight) {
    const bg = this.activePage.background || 'white';
    const width = parseFloat(cssWidth) || window.innerWidth;
    const height = parseFloat(cssHeight) || window.innerHeight;

    let baseColor = '#ffffff';
    let patternColor = '#e2e8f0';

    if (bg === 'chalkboard') {
      baseColor = '#1b4332'; // Classic green classroom chalkboard
      patternColor = 'rgba(255, 255, 255, 0.08)';
    } else if (bg === 'blackboard') {
      baseColor = '#0f172a'; // Modern slate dark blackboard
      patternColor = 'rgba(255, 255, 255, 0.07)';
    } else if (bg === 'white') {
      baseColor = '#ffffff';
      patternColor = '#e2e8f0';
    }

    if (this.activePage.customBgColor) {
      baseColor = this.activePage.customBgColor;
    }

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, width, height);

    if (bg === 'grid' || bg === 'chalkboard' || bg === 'blackboard') {
      // Grid Pattern
      const gridSize = 32 * this.zoom;
      const offsetX = this.panX % gridSize;
      const offsetY = this.panY % gridSize;

      ctx.save();
      ctx.strokeStyle = patternColor;
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let x = offsetX; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = offsetY; y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
      ctx.restore();
    } else if (bg === 'lines') {
      // Ruled school notebook lines
      const lineStep = 28 * this.zoom;
      const offsetY = this.panY % lineStep;

      ctx.save();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = offsetY; y < height; y += lineStep) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Red notebook margin line on right for Arabic or left for LTR
      const marginX = this.panX + 80 * this.zoom;
      if (marginX >= 0 && marginX <= width) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(marginX, 0);
        ctx.lineTo(marginX, height);
        ctx.stroke();
      }
      ctx.restore();
    } else if (bg === 'dots') {
      // Dotted grid
      const dotStep = 24 * this.zoom;
      const offsetX = this.panX % dotStep;
      const offsetY = this.panY % dotStep;

      ctx.save();
      ctx.fillStyle = '#94a3b8';
      for (let x = offsetX; x < width; x += dotStep) {
        for (let y = offsetY; y < height; y += dotStep) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  drawElement(ctx, el) {
    ctx.save();

    if (el.type === 'pen') {
      this.drawPenStroke(ctx, el);
    } else if (el.type === 'shape') {
      this.drawShape(ctx, el);
    } else if (el.type === 'line') {
      this.drawLine(ctx, el);
    } else if (el.type === 'text') {
      this.drawText(ctx, el);
    } else if (el.type === 'sticky') {
      this.drawStickyNote(ctx, el);
    } else if (el.type === 'image') {
      this.drawImageElement(ctx, el);
    }

    ctx.restore();
  }

  drawPenStroke(ctx, el) {
    if (!el.points || el.points.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (el.isHighlighter) {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = el.width || 20;
      ctx.strokeStyle = el.color || '#facc15';
    } else {
      ctx.globalAlpha = 1.0;
      ctx.lineWidth = el.width || 3;
      ctx.strokeStyle = el.color || '#000000';
    }

    if (el.points.length === 1) {
      const p = el.points[0];
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Spline curve smoothing
    ctx.beginPath();
    ctx.moveTo(el.points[0].x, el.points[0].y);

    for (let i = 1; i < el.points.length - 1; i++) {
      const xc = (el.points[i].x + el.points[i + 1].x) / 2;
      const yc = (el.points[i].y + el.points[i + 1].y) / 2;
      ctx.quadraticCurveTo(el.points[i].x, el.points[i].y, xc, yc);
    }

    const last = el.points[el.points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();

    ctx.restore();
  }

  drawShape(ctx, el) {
    ctx.save();
    ctx.lineWidth = el.strokeWidth || 3;
    ctx.strokeStyle = el.strokeColor || '#000000';
    ctx.fillStyle = el.fillColor || 'transparent';

    if (el.strokeStyle === 'dashed') {
      ctx.setLineDash([8, 6]);
    } else if (el.strokeStyle === 'dotted') {
      ctx.setLineDash([3, 5]);
    }

    const x = el.x;
    const y = el.y;
    const w = el.width;
    const h = el.height;

    ctx.beginPath();

    if (el.shapeType === 'rect') {
      ctx.rect(x, y, w, h);
    } else if (el.shapeType === 'rounded-rect') {
      const r = Math.min(16, Math.min(Math.abs(w), Math.abs(h)) / 4);
      ctx.roundRect(x, y, w, h, r);
    } else if (el.shapeType === 'circle') {
      const rx = Math.abs(w / 2);
      const ry = Math.abs(h / 2);
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else if (el.shapeType === 'triangle') {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    } else if (el.shapeType === 'diamond') {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
    } else if (el.shapeType === 'star') {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const outerR = Math.min(Math.abs(w), Math.abs(h)) / 2;
      const innerR = outerR * 0.42;
      const spikes = 5;
      let rot = (Math.PI / 2) * 3;
      const step = Math.PI / spikes;

      ctx.moveTo(cx, cy - outerR);
      for (let i = 0; i < spikes; i++) {
        let px = cx + Math.cos(rot) * outerR;
        let py = cy + Math.sin(rot) * outerR;
        ctx.lineTo(px, py);
        rot += step;

        px = cx + Math.cos(rot) * innerR;
        py = cy + Math.sin(rot) * innerR;
        ctx.lineTo(px, py);
        rot += step;
      }
      ctx.closePath();
    } else if (el.shapeType === 'speech-bubble') {
      const r = 12;
      const tailW = 20;
      const tailH = 18;
      const bubbleH = Math.max(20, h - tailH);
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + bubbleH - r);
      ctx.quadraticCurveTo(x + w, y + bubbleH, x + w - r, y + bubbleH);
      ctx.lineTo(x + 40 + tailW, y + bubbleH);
      ctx.lineTo(x + 25, y + h); // tail tip
      ctx.lineTo(x + 40, y + bubbleH);
      ctx.lineTo(x + r, y + bubbleH);
      ctx.quadraticCurveTo(x, y + bubbleH, x, y + bubbleH - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    } else if (el.shapeType === 'cloud') {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = Math.abs(w / 2);
      const ry = Math.abs(h / 2);
      ctx.moveTo(cx - rx * 0.7, cy + ry * 0.4);
      ctx.bezierCurveTo(cx - rx, cy + ry * 0.3, cx - rx, cy - ry * 0.4, cx - rx * 0.5, cy - ry * 0.5);
      ctx.bezierCurveTo(cx - rx * 0.5, cy - ry, cx + rx * 0.2, cy - ry, cx + rx * 0.4, cy - ry * 0.5);
      ctx.bezierCurveTo(cx + rx, cy - ry * 0.5, cx + rx, cy + ry * 0.2, cx + rx * 0.6, cy + ry * 0.5);
      ctx.bezierCurveTo(cx + rx * 0.4, cy + ry, cx - rx * 0.4, cy + ry, cx - rx * 0.7, cy + ry * 0.4);
      ctx.closePath();
    } else if (el.shapeType === 'hexagon') {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = Math.abs(w / 2);
      const ry = Math.abs(h / 2);
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + rx * Math.cos(a);
        const py = cy + ry * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }

    if (el.fillColor && el.fillColor !== 'transparent') {
      ctx.fill();
    }
    ctx.stroke();

    ctx.restore();
  }

  drawLine(ctx, el) {
    ctx.save();
    ctx.lineWidth = el.strokeWidth || 3;
    ctx.strokeStyle = el.strokeColor || '#000000';
    ctx.fillStyle = el.strokeColor || '#000000';
    ctx.lineCap = 'round';

    if (el.strokeStyle === 'dashed') {
      ctx.setLineDash([8, 6]);
    } else if (el.strokeStyle === 'dotted') {
      ctx.setLineDash([3, 5]);
    }

    if (el.lineType === 'elbow') {
      const midX = (el.x1 + el.x2) / 2;
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(midX, el.y1);
      ctx.lineTo(midX, el.y2);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();

      // Arrow head at destination
      const arrowLen = Math.max(12, (el.strokeWidth || 3) * 3);
      const angle = el.x2 >= midX ? 0 : Math.PI;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(el.x2, el.y2);
      ctx.lineTo(
        el.x2 - arrowLen * Math.cos(angle - Math.PI / 6),
        el.y2 - arrowLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        el.x2 - arrowLen * Math.cos(angle + Math.PI / 6),
        el.y2 - arrowLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(el.x1, el.y1);
    ctx.lineTo(el.x2, el.y2);
    ctx.stroke();

    // Arrow heads
    const arrowLen = Math.max(12, (el.strokeWidth || 3) * 3);
    const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);

    if (el.lineType === 'arrow' || el.lineType === 'double-arrow') {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(el.x2, el.y2);
      ctx.lineTo(
        el.x2 - arrowLen * Math.cos(angle - Math.PI / 6),
        el.y2 - arrowLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        el.x2 - arrowLen * Math.cos(angle + Math.PI / 6),
        el.y2 - arrowLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }

    if (el.lineType === 'double-arrow') {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(
        el.x1 + arrowLen * Math.cos(angle - Math.PI / 6),
        el.y1 + arrowLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        el.x1 + arrowLen * Math.cos(angle + Math.PI / 6),
        el.y1 + arrowLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  drawText(ctx, el) {
    ctx.save();
    const fontSize = el.fontSize || 20;
    const fontFamily = el.fontFamily || 'system-ui, -apple-system, sans-serif';
    const weight = el.isBold ? 'bold ' : '';
    const style = el.isItalic ? 'italic ' : '';

    ctx.font = `${style}${weight}${fontSize}px ${fontFamily}`;
    ctx.fillStyle = el.color || '#000000';
    ctx.textBaseline = 'top';
    ctx.direction = 'ltr';
    ctx.textAlign = el.align || 'left';

    const lines = (el.text || '').split('\n');
    const lineHeight = fontSize * 1.35;

    lines.forEach((line, idx) => {
      ctx.fillText(line, el.x, el.y + idx * lineHeight);
    });

    ctx.restore();
  }

  drawStickyNote(ctx, el) {
    ctx.save();

    const themeColors = {
      yellow: { bg: '#fef08a', text: '#713f12', border: '#fde047', shadow: 'rgba(0,0,0,0.1)' },
      green: { bg: '#bbf7d0', text: '#14532d', border: '#86efac', shadow: 'rgba(0,0,0,0.1)' },
      cyan: { bg: '#a5f3fc', text: '#164e63', border: '#67e8f9', shadow: 'rgba(0,0,0,0.1)' },
      pink: { bg: '#fbcfe8', text: '#831843', border: '#f472b6', shadow: 'rgba(0,0,0,0.1)' },
      orange: { bg: '#fed7aa', text: '#7c2d12', border: '#fdba74', shadow: 'rgba(0,0,0,0.1)' },
      purple: { bg: '#e9d5ff', text: '#581c87', border: '#d8b4fe', shadow: 'rgba(0,0,0,0.1)' }
    };

    const theme = themeColors[el.colorTheme || 'yellow'] || themeColors.yellow;

    // Drop shadow
    ctx.shadowColor = theme.shadow;
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    // Note Body
    ctx.fillStyle = theme.bg;
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.width, el.height, 6);
    ctx.fill();
    ctx.stroke();

    // Turn off shadow for text
    ctx.shadowColor = 'transparent';

    // Note Pin / Tape Strip at top
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.roundRect(el.x + el.width / 2 - 20, el.y + 3, 40, 8, 2);
    ctx.fill();

    // Text content inside sticky note
    const fontSize = 14;
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = theme.text;
    ctx.textBaseline = 'top';
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';

    const padding = 12;
    const maxWidth = el.width - padding * 2;
    const lines = (el.text || '').split('\n');
    let curY = el.y + padding + 6;

    lines.forEach((line) => {
      // Simple word wrapping
      const words = line.split(' ');
      let curLine = '';
      words.forEach((w) => {
        const testLine = curLine ? curLine + ' ' + w : w;
        if (ctx.measureText(testLine).width > maxWidth) {
          ctx.fillText(curLine, el.x + padding, curY);
          curY += fontSize * 1.35;
          curLine = w;
        } else {
          curLine = testLine;
        }
      });
      if (curLine) {
        ctx.fillText(curLine, el.x + padding, curY);
        curY += fontSize * 1.35;
      }
    });

    ctx.restore();
  }

  drawImageElement(ctx, el) {
    if (!el.imgObj) {
      if (el.src) {
        el.imgObj = new Image();
        el.imgObj.src = el.src;
        el.imgObj.onload = () => this.render();
      }
      return;
    }
    if (el.imgObj.complete && el.imgObj.naturalWidth > 0) {
      ctx.save();
      ctx.drawImage(el.imgObj, el.x, el.y, el.width, el.height);
      ctx.restore();
    }
  }

  // --- Selection Overlay & Bounding Box ---

  drawSelectionOverlay(ctx) {
    const selectedElements = this.activePage.elements.filter((el) => this.selectedElementIds.has(el.id));
    if (selectedElements.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedElements.forEach((el) => {
      const b = this.getElementBounds(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    });

    const pad = 6;
    const boxX = minX - pad;
    const boxY = minY - pad;
    const boxW = maxX - minX + pad * 2;
    const boxH = maxY - minY + pad * 2;

    ctx.save();
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Corner resize handles
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5 / this.zoom;

    const handleSize = 8 / this.zoom;
    const corners = [
      { x: boxX, y: boxY },
      { x: boxX + boxW, y: boxY },
      { x: boxX + boxW, y: boxY + boxH },
      { x: boxX, y: boxY + boxH }
    ];

    corners.forEach((c) => {
      ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
    });

    ctx.restore();
  }

  // --- Laser Pointer Trail ---

  addLaserPoint(worldX, worldY) {
    this.laserPoints.push({
      x: worldX,
      y: worldY,
      time: performance.now()
    });
  }

  drawLaserTrail(ctx) {
    const now = performance.now();
    const maxAge = 1100; // ms trail persistence

    // Filter points
    this.laserPoints = this.laserPoints.filter((p) => now - p.time <= maxAge);
    if (this.laserPoints.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < this.laserPoints.length - 1; i++) {
      const p1 = this.laserPoints[i];
      const p2 = this.laserPoints[i + 1];
      const age = now - p2.time;
      const progress = 1 - (age / maxAge);

      ctx.strokeStyle = this.laserColor;
      ctx.globalAlpha = Math.max(0, Math.min(1, progress * 0.9));
      ctx.lineWidth = Math.max(2, (8 / this.zoom) * progress);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Glowing dot at tip
    const tip = this.laserPoints[this.laserPoints.length - 1];
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4 / this.zoom, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = this.laserColor;
    ctx.lineWidth = 2 / this.zoom;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 8 / this.zoom, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  // --- Minimap Snapshot ---

  renderMinimap(minimapCanvas) {
    if (!minimapCanvas) return;
    const mctx = minimapCanvas.getContext('2d');
    const mw = minimapCanvas.width;
    const mh = minimapCanvas.height;

    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = this.activePage.background === 'chalkboard' ? '#1b4332' : (this.activePage.background === 'blackboard' ? '#0f172a' : '#f8fafc');
    mctx.fillRect(0, 0, mw, mh);

    const elements = this.activePage.elements;
    if (elements.length === 0) return;

    // Calculate content bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach((el) => {
      const b = this.getElementBounds(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    });

    const pad = 200;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const cw = maxX - minX;
    const ch = maxY - minY;

    const scale = Math.min(mw / cw, mh / ch);

    mctx.save();
    mctx.translate((mw - cw * scale) / 2, (mh - ch * scale) / 2);
    mctx.scale(scale, scale);
    mctx.translate(-minX, -minY);

    // Draw miniature elements
    elements.forEach((el) => {
      const b = this.getElementBounds(el);
      mctx.fillStyle = el.color || el.strokeColor || '#94a3b8';
      mctx.fillRect(b.x, b.y, b.width, b.height);
    });

    // Draw current viewport indicator
    const vMin = this.screenToWorld(0, 0);
    const vMax = this.screenToWorld(this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    mctx.strokeStyle = '#0284c7';
    mctx.lineWidth = 2 / scale;
    mctx.strokeRect(vMin.x, vMin.y, vMax.x - vMin.x, vMax.y - vMin.y);

    mctx.restore();
  }

  // --- Classroom Geometric Tools (Ruler & Protractor) ---

  drawRuler(ctx) {
    if (!this.ruler || !this.ruler.active) return;
    const r = this.ruler;

    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle);

    const halfL = r.length / 2;
    const halfW = r.width / 2;

    // Body: clear glass acrylic with drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;

    ctx.fillStyle = 'rgba(240, 249, 255, 0.9)';
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-halfL, -halfW, r.length, r.width, 8);
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = 'transparent';

    // Centimeter & Millimeter markings along top edge (-halfW)
    const cmPixels = 20; // 20px per cm
    const totalCm = Math.floor(r.length / cmPixels) - 1;
    const startX = -halfL + 20;

    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#0f172a';
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let cm = 0; cm <= totalCm; cm++) {
      const cx = startX + cm * cmPixels;
      if (cx > halfL - 15) break;

      // Major CM tick
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, -halfW);
      ctx.lineTo(cx, -halfW + 16);
      ctx.stroke();

      // Number label
      ctx.fillText(cm.toString(), cx, -halfW + 18);

      // Minor mm ticks
      ctx.lineWidth = 0.8;
      for (let mm = 1; mm < 10; mm++) {
        const mx = cx + mm * (cmPixels / 10);
        if (mx > halfL - 15) break;
        const tickH = mm === 5 ? 10 : 5;
        ctx.beginPath();
        ctx.moveTo(mx, -halfW);
        ctx.lineTo(mx, -halfW + tickH);
        ctx.stroke();
      }
    }

    // Ruler center label
    ctx.fillStyle = '#0284c7';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DZ-RULER • مسطرة قياس سنتيمترية', 0, 6);

    // Rotation Handle (Right circle)
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(halfL - 20, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText('↻', halfL - 20, 1);

    // Close button (Left circle)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(-halfL + 20, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText('×', -halfL + 20, -1);

    ctx.restore();
  }

  drawProtractor(ctx) {
    if (!this.protractor || !this.protractor.active) return;
    const p = this.protractor;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    const rad = p.radius;

    // Body: clear glass semi-circle
    ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;

    ctx.fillStyle = 'rgba(240, 249, 255, 0.9)';
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.65)';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.arc(0, 0, rad, Math.PI, 0, false); // top half
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner cutout arc
    ctx.beginPath();
    ctx.arc(0, 0, rad * 0.38, Math.PI, 0, false);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = 'transparent';

    // Degree markings from 0° to 180°
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#0f172a';
    ctx.font = '600 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let deg = 0; deg <= 180; deg++) {
      const angle = (Math.PI / 180) * (180 - deg);
      let tickLen = 4;
      if (deg % 10 === 0) tickLen = 14;
      else if (deg % 5 === 0) tickLen = 8;

      const x1 = Math.cos(angle) * (rad - tickLen);
      const y1 = -Math.sin(angle) * (rad - tickLen);
      const x2 = Math.cos(angle) * rad;
      const y2 = -Math.sin(angle) * rad;

      ctx.lineWidth = deg % 10 === 0 ? 1.5 : 0.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Degree number labels every 10 degrees
      if (deg % 10 === 0 && deg > 0 && deg < 180) {
        const lx = Math.cos(angle) * (rad - 22);
        const ly = -Math.sin(angle) * (rad - 22);
        ctx.fillText(deg.toString(), lx, ly);
      }
    }

    // Origin crosshair
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-15, 0); ctx.lineTo(15, 0);
    ctx.moveTo(0, -15); ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    // Center Protractor Label
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillText('منقلة الزوايا 180°', 0, -rad * 0.18);

    // Rotation Handle at top vertex (angle = 90°)
    const topX = 0;
    const topY = -rad + 18;
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(topX, topY, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px system-ui';
    ctx.fillText('↻', topX, topY + 1);

    // Close button (bottom left)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(-rad + 20, -12, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px system-ui';
    ctx.fillText('×', -rad + 20, -13);

    ctx.restore();
  }

  rulerHitTest(worldX, worldY) {
    if (!this.ruler || !this.ruler.active) return null;
    const r = this.ruler;
    const dx = worldX - r.x;
    const dy = worldY - r.y;
    const cos = Math.cos(-r.angle);
    const sin = Math.sin(-r.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;

    const halfL = r.length / 2;
    const halfW = r.width / 2;

    // Check close button (-halfL + 20, 0)
    if (Math.hypot(lx - (-halfL + 20), ly) <= 16) {
      return 'close';
    }
    // Check rotate handle (halfL - 20, 0)
    if (Math.hypot(lx - (halfL - 20), ly) <= 18) {
      return 'rotate';
    }
    // Check ruler body
    if (lx >= -halfL && lx <= halfL && ly >= -halfW && ly <= halfW) {
      return 'drag';
    }
    return null;
  }

  protractorHitTest(worldX, worldY) {
    if (!this.protractor || !this.protractor.active) return null;
    const p = this.protractor;
    const dx = worldX - p.x;
    const dy = worldY - p.y;
    const cos = Math.cos(-p.angle);
    const sin = Math.sin(-p.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;

    const rad = p.radius;

    // Check close button (-rad + 20, -12)
    if (Math.hypot(lx - (-rad + 20), ly - (-12)) <= 16) {
      return 'close';
    }
    // Check rotate handle (0, -rad + 18)
    if (Math.hypot(lx, ly - (-rad + 18)) <= 18) {
      return 'rotate';
    }
    // Check semi-circle body (ly <= 10 and dist <= rad)
    const dist = Math.hypot(lx, ly);
    if (ly <= 10 && dist <= rad) {
      return 'drag';
    }
    return null;
  }
}
