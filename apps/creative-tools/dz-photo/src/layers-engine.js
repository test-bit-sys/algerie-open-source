/**
 * DZ-Photo — Multi-Layer Canvas Engine
 * Pure HTML5 Canvas 2D Layer Management following Photoshop/PhotoCraft standards.
 */

export class Layer {
  constructor(id, name, width, height) {
    this.id = id;
    this.name = name;
    this.visible = true;
    this.opacity = 1.0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  resize(newWidth, newHeight) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(this.canvas, 0, 0);

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.ctx.drawImage(tempCanvas, 0, 0);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export class LayersEngine {
  constructor(width = 800, height = 600, onUpdateCallback = null) {
    this.width = width;
    this.height = height;
    this.layers = [];
    this.activeLayerIndex = 0;
    this.onUpdate = onUpdateCallback;
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 15;

    // Create background layer
    this.addLayer('الخلفية (Background)', true);
  }

  addLayer(name = null, fillWhite = false) {
    const id = 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const layerName = name || `طبقة ${this.layers.length + 1}`;
    const layer = new Layer(id, layerName, this.width, this.height);

    if (fillWhite) {
      layer.ctx.fillStyle = '#ffffff';
      layer.ctx.fillRect(0, 0, this.width, this.height);
    }

    this.layers.push(layer);
    this.activeLayerIndex = this.layers.length - 1;
    this.recordHistory();
    this.notifyUpdate();
    return layer;
  }

  deleteActiveLayer() {
    if (this.layers.length <= 1) {
      return false; // Cannot delete last remaining layer
    }
    this.layers.splice(this.activeLayerIndex, 1);
    this.activeLayerIndex = Math.max(0, this.activeLayerIndex - 1);
    this.recordHistory();
    this.notifyUpdate();
    return true;
  }

  duplicateActiveLayer() {
    const current = this.getActiveLayer();
    if (!current) return null;
    const clone = new Layer('layer_' + Date.now(), `${current.name} (نسخة)`, this.width, this.height);
    clone.ctx.drawImage(current.canvas, 0, 0);
    clone.visible = current.visible;
    clone.opacity = current.opacity;

    this.layers.splice(this.activeLayerIndex + 1, 0, clone);
    this.activeLayerIndex++;
    this.recordHistory();
    this.notifyUpdate();
    return clone;
  }

  moveActiveLayerUp() {
    if (this.activeLayerIndex < this.layers.length - 1) {
      const temp = this.layers[this.activeLayerIndex];
      this.layers[this.activeLayerIndex] = this.layers[this.activeLayerIndex + 1];
      this.layers[this.activeLayerIndex + 1] = temp;
      this.activeLayerIndex++;
      this.notifyUpdate();
    }
  }

  moveActiveLayerDown() {
    if (this.activeLayerIndex > 0) {
      const temp = this.layers[this.activeLayerIndex];
      this.layers[this.activeLayerIndex] = this.layers[this.activeLayerIndex - 1];
      this.layers[this.activeLayerIndex - 1] = temp;
      this.activeLayerIndex--;
      this.notifyUpdate();
    }
  }

  getActiveLayer() {
    return this.layers[this.activeLayerIndex] || null;
  }

  getActiveCtx() {
    const l = this.getActiveLayer();
    return l ? l.ctx : null;
  }

  resizeCanvas(newW, newH) {
    this.width = newW;
    this.height = newH;
    this.layers.forEach(layer => layer.resize(newW, newH));
    this.recordHistory();
    this.notifyUpdate();
  }

  renderComposite(targetCtx) {
    targetCtx.clearRect(0, 0, this.width, this.height);
    
    // Draw checkerboard transparent background
    this.drawCheckerboard(targetCtx, this.width, this.height);

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (layer.visible && layer.opacity > 0) {
        targetCtx.globalAlpha = layer.opacity;
        targetCtx.drawImage(layer.canvas, 0, 0);
      }
    }
    targetCtx.globalAlpha = 1.0;
  }

  drawCheckerboard(ctx, w, h) {
    const size = 16;
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#f1f5f9' : '#e2e8f0';
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  recordHistory() {
    // Snapshot layer states
    const snapshot = this.layers.map(l => {
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = this.width;
      snapCanvas.height = this.height;
      snapCanvas.getContext('2d').drawImage(l.canvas, 0, 0);
      return {
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        canvas: snapCanvas
      };
    });

    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restoreSnapshot(this.history[this.historyIndex]);
      this.notifyUpdate();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restoreSnapshot(this.history[this.historyIndex]);
      this.notifyUpdate();
    }
  }

  restoreSnapshot(snapshot) {
    this.layers = snapshot.map(item => {
      const l = new Layer(item.id, item.name, this.width, this.height);
      l.visible = item.visible;
      l.opacity = item.opacity;
      l.ctx.drawImage(item.canvas, 0, 0);
      return l;
    });
    this.activeLayerIndex = Math.min(this.activeLayerIndex, this.layers.length - 1);
  }

  notifyUpdate() {
    if (this.onUpdate) this.onUpdate();
  }
}
