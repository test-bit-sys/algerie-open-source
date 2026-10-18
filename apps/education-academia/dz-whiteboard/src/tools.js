/**
 * DZ-Whiteboard Pro — Tools Controller & Interaction Handlers
 * -----------------------------------------------------------
 * Implements interactions for Pen, Highlighter, Eraser, Shapes,
 * Connectors, Text, Sticky Notes, Laser Pointer, and Selection.
 */

export class ToolsManager {
  constructor(engine, options = {}) {
    this.engine = engine;
    this.activeTool = 'pen'; // 'select', 'pen', 'highlighter', 'eraser', 'shape', 'line', 'text', 'sticky', 'laser', 'hand'
    this.activeShapeType = 'rect'; // 'rect', 'rounded-rect', 'circle', 'triangle', 'diamond', 'star'
    this.activeLineType = 'line'; // 'line', 'arrow', 'double-arrow'
    this.activeStickyTheme = 'yellow';

    // Tool Style Properties
    this.strokeColor = '#0f172a';
    this.fillColor = 'transparent';
    this.strokeWidth = 3;
    this.strokeStyle = 'solid'; // 'solid', 'dashed', 'dotted'
    this.fontSize = 20;

    // Interaction State
    this.isMouseDown = false;
    this.startPoint = null;
    this.currentDraftElement = null;
    this.draggedElement = null;
    this.dragOffset = { x: 0, y: 0 };
    this.isPanning = false;
    this.lastPanMouse = { x: 0, y: 0 };

    // Laser pointer animation loop
    this.laserAnimationId = null;

    // History and UI hooks
    this.onElementCreated = options.onElementCreated || (() => {});
    this.onSelectionChanged = options.onSelectionChanged || (() => {});
    this.onTextEditRequest = options.onTextEditRequest || (() => {});

    this.bindEvents();
  }

  bindEvents() {
    const canvas = this.engine.canvas;

    canvas.addEventListener('mousedown', (e) => this.handlePointerDown(e));
    window.addEventListener('mousemove', (e) => this.handlePointerMove(e));
    window.addEventListener('mouseup', (e) => this.handlePointerUp(e));

    // Touch support for interactive screens and tablets
    canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => this.handleTouchEnd(e));

    // Wheel zoom & pan
    canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

    // Double click to edit text / sticky
    canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
  }

  setTool(toolName, subType = null) {
    this.activeTool = toolName;
    if (subType) {
      if (toolName === 'shape') this.activeShapeType = subType;
      if (toolName === 'line') this.activeLineType = subType;
    }

    if (this.activeTool === 'laser') {
      this.startLaserAnimation();
    } else {
      this.stopLaserAnimation();
    }

    // Update cursor
    this.updateCursor();
  }

  updateCursor() {
    const canvas = this.engine.canvas;
    if (this.activeTool === 'hand') {
      canvas.style.cursor = 'grab';
    } else if (this.activeTool === 'select') {
      canvas.style.cursor = 'default';
    } else if (this.activeTool === 'laser') {
      canvas.style.cursor = 'crosshair';
    } else if (this.activeTool === 'text') {
      canvas.style.cursor = 'text';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  }

  // --- Pointer Down ---

  handlePointerDown(e) {
    // If Space is pressed, treat as Pan
    if (e.spaceKey || e.button === 1 || this.activeTool === 'hand') {
      this.isPanning = true;
      this.lastPanMouse = { x: e.clientX, y: e.clientY };
      this.engine.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return; // Left click only

    this.isMouseDown = true;
    const world = this.engine.screenToWorld(e.clientX, e.clientY);
    this.startPoint = world;

    if (this.activeTool === 'select') {
      const hit = this.engine.hitTest(world.x, world.y);
      if (hit) {
        if (!e.shiftKey) {
          this.engine.selectedElementIds.clear();
        }
        this.engine.selectedElementIds.add(hit.id);
        this.draggedElement = hit;
        const b = this.engine.getElementBounds(hit);
        this.dragOffset = { x: world.x - b.x, y: world.y - b.y };
      } else {
        if (!e.shiftKey) {
          this.engine.selectedElementIds.clear();
        }
      }
      this.onSelectionChanged(Array.from(this.engine.selectedElementIds));
      this.engine.render();
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      const isHighlighter = this.activeTool === 'highlighter';
      this.currentDraftElement = {
        id: 'pen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'pen',
        isHighlighter,
        color: isHighlighter ? this.strokeColor : this.strokeColor,
        width: isHighlighter ? Math.max(16, this.strokeWidth * 4) : this.strokeWidth,
        points: [{ x: world.x, y: world.y }]
      };
      this.engine.activePage.elements.push(this.currentDraftElement);
      this.engine.render();
      return;
    }

    if (this.activeTool === 'eraser') {
      this.eraseAt(world.x, world.y);
      return;
    }

    if (this.activeTool === 'shape') {
      this.currentDraftElement = {
        id: 'shape_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'shape',
        shapeType: this.activeShapeType,
        x: world.x,
        y: world.y,
        width: 1,
        height: 1,
        strokeColor: this.strokeColor,
        fillColor: this.fillColor,
        strokeWidth: this.strokeWidth,
        strokeStyle: this.strokeStyle
      };
      this.engine.activePage.elements.push(this.currentDraftElement);
      return;
    }

    if (this.activeTool === 'line') {
      this.currentDraftElement = {
        id: 'line_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'line',
        lineType: this.activeLineType,
        x1: world.x,
        y1: world.y,
        x2: world.x,
        y2: world.y,
        strokeColor: this.strokeColor,
        strokeWidth: this.strokeWidth,
        strokeStyle: this.strokeStyle
      };
      this.engine.activePage.elements.push(this.currentDraftElement);
      return;
    }

    if (this.activeTool === 'text') {
      this.onTextEditRequest({
        x: world.x,
        y: world.y,
        screenPos: { x: e.clientX, y: e.clientY },
        existingElement: null
      });
      return;
    }

    if (this.activeTool === 'sticky') {
      const sticky = {
        id: 'sticky_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'sticky',
        x: world.x - 90,
        y: world.y - 80,
        width: 180,
        height: 160,
        text: 'انقر نقراً مزدوجاً لتحرير الملاحظة...',
        colorTheme: this.activeStickyTheme
      };
      this.engine.activePage.elements.push(sticky);
      this.engine.selectedElementIds.clear();
      this.engine.selectedElementIds.add(sticky.id);
      this.engine.render();
      this.onElementCreated(sticky);
      this.setTool('select');
      return;
    }

    if (this.activeTool === 'laser') {
      this.engine.addLaserPoint(world.x, world.y);
      this.engine.render();
      return;
    }
  }

  // --- Pointer Move ---

  handlePointerMove(e) {
    if (this.isPanning) {
      const dx = e.clientX - this.lastPanMouse.x;
      const dy = e.clientY - this.lastPanMouse.y;
      this.lastPanMouse = { x: e.clientX, y: e.clientY };
      this.engine.panX += dx;
      this.engine.panY += dy;
      this.engine.render();
      return;
    }

    const world = this.engine.screenToWorld(e.clientX, e.clientY);

    if (this.activeTool === 'laser') {
      this.engine.addLaserPoint(world.x, world.y);
      return;
    }

    if (!this.isMouseDown) return;

    if (this.activeTool === 'select' && this.draggedElement) {
      const el = this.draggedElement;
      const b = this.engine.getElementBounds(el);
      const targetX = world.x - this.dragOffset.x;
      const targetY = world.y - this.dragOffset.y;
      const deltaX = targetX - b.x;
      const deltaY = targetY - b.y;

      if (el.type === 'pen') {
        el.points.forEach((p) => {
          p.x += deltaX;
          p.y += deltaY;
        });
      } else if (el.type === 'line') {
        el.x1 += deltaX; el.y1 += deltaY;
        el.x2 += deltaX; el.y2 += deltaY;
      } else {
        el.x += deltaX;
        el.y += deltaY;
      }

      this.engine.render();
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      if (this.currentDraftElement) {
        this.currentDraftElement.points.push({ x: world.x, y: world.y });
        this.engine.render();
      }
      return;
    }

    if (this.activeTool === 'eraser') {
      this.eraseAt(world.x, world.y);
      return;
    }

    if (this.activeTool === 'shape' && this.currentDraftElement) {
      let w = world.x - this.startPoint.x;
      let h = world.y - this.startPoint.y;

      if (e.shiftKey) {
        // Square / Perfect Circle aspect ratio lock
        const s = Math.max(Math.abs(w), Math.abs(h));
        w = w < 0 ? -s : s;
        h = h < 0 ? -s : s;
      }

      this.currentDraftElement.x = w >= 0 ? this.startPoint.x : this.startPoint.x + w;
      this.currentDraftElement.y = h >= 0 ? this.startPoint.y : this.startPoint.y + h;
      this.currentDraftElement.width = Math.abs(w);
      this.currentDraftElement.height = Math.abs(h);

      this.engine.render();
      return;
    }

    if (this.activeTool === 'line' && this.currentDraftElement) {
      let x2 = world.x;
      let y2 = world.y;

      if (e.shiftKey) {
        // Snap to 0°, 45°, 90°
        const dx = x2 - this.startPoint.x;
        const dy = y2 - this.startPoint.y;
        const dist = Math.hypot(dx, dy);
        let angle = Math.atan2(dy, dx);
        const snap = Math.PI / 4;
        angle = Math.round(angle / snap) * snap;
        x2 = this.startPoint.x + dist * Math.cos(angle);
        y2 = this.startPoint.y + dist * Math.sin(angle);
      }

      this.currentDraftElement.x2 = x2;
      this.currentDraftElement.y2 = y2;
      this.engine.render();
      return;
    }
  }

  // --- Pointer Up ---

  handlePointerUp() {
    if (this.isPanning) {
      this.isPanning = false;
      this.updateCursor();
    }

    if (!this.isMouseDown) return;
    this.isMouseDown = false;

    if (this.currentDraftElement) {
      // Validate element has meaningful size
      const el = this.currentDraftElement;
      let keep = true;
      if (el.type === 'shape' && (el.width < 4 || el.height < 4)) keep = false;
      if (el.type === 'line' && Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 4) keep = false;

      if (!keep) {
        const idx = this.engine.activePage.elements.indexOf(el);
        if (idx !== -1) this.engine.activePage.elements.splice(idx, 1);
      } else {
        this.onElementCreated(el);
      }

      this.currentDraftElement = null;
      this.engine.render();
    }

    this.draggedElement = null;
  }

  // --- Eraser Logic ---

  eraseAt(worldX, worldY) {
    const hit = this.engine.hitTest(worldX, worldY);
    if (hit) {
      const elements = this.engine.activePage.elements;
      const idx = elements.indexOf(hit);
      if (idx !== -1) {
        elements.splice(idx, 1);
        this.engine.selectedElementIds.delete(hit.id);
        this.engine.render();
        this.engine.onDirty();
      }
    }
  }

  // --- Double Click (Inline text editing) ---

  handleDoubleClick(e) {
    const world = this.engine.screenToWorld(e.clientX, e.clientY);
    const hit = this.engine.hitTest(world.x, world.y);
    if (hit && (hit.type === 'text' || hit.type === 'sticky')) {
      this.onTextEditRequest({
        x: hit.x,
        y: hit.y,
        screenPos: { x: e.clientX, y: e.clientY },
        existingElement: hit
      });
    }
  }

  // --- Wheel Zoom & Pan ---

  handleWheel(e) {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom centered on mouse
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.engine.setZoom(this.engine.zoom * zoomFactor, e.clientX, e.clientY);
    } else {
      // Smooth Pan
      this.engine.panX -= e.deltaX;
      this.engine.panY -= e.deltaY;
      this.engine.render();
    }
  }

  // --- Touch Support ---

  handleTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.handlePointerDown({
        clientX: t.clientX,
        clientY: t.clientY,
        button: 0,
        preventDefault: () => e.preventDefault()
      });
    } else if (e.touches.length === 2) {
      // Two-finger Pan
      this.isPanning = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.lastPanMouse = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      };
    }
  }

  handleTouchMove(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.handlePointerMove({
        clientX: t.clientX,
        clientY: t.clientY,
        shiftKey: false
      });
    } else if (e.touches.length === 2 && this.isPanning) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const mid = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      };
      this.engine.panX += mid.x - this.lastPanMouse.x;
      this.engine.panY += mid.y - this.lastPanMouse.y;
      this.lastPanMouse = mid;
      this.engine.render();
    }
  }

  handleTouchEnd() {
    this.handlePointerUp();
  }

  // --- Laser Pointer continuous redraw loop ---

  startLaserAnimation() {
    if (this.laserAnimationId) return;
    const loop = () => {
      if (this.activeTool === 'laser' || this.engine.laserPoints.length > 0) {
        this.engine.render();
        this.laserAnimationId = requestAnimationFrame(loop);
      } else {
        this.laserAnimationId = null;
      }
    };
    this.laserAnimationId = requestAnimationFrame(loop);
  }

  stopLaserAnimation() {
    if (this.laserAnimationId) {
      cancelAnimationFrame(this.laserAnimationId);
      this.laserAnimationId = null;
    }
    this.engine.laserPoints = [];
    this.engine.render();
  }
}
