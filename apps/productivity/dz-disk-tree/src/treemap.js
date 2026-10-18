/**
 * DZ-DiskTree — Squarified Treemap Visualization Engine
 * Implements the Bruls, Huizing, van Wijk (2000) squarified layout algorithm
 * High-performance HTML5 Canvas renderer with interactive hover, zoom, and breadcrumbs.
 * 100% Offline, Zero External Dependencies.
 */

export class SquarifiedTreemap {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = Object.assign({
      padding: 2,
      fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 12,
      minLabelWidth: 50,
      minLabelHeight: 20,
      showAllocated: false,
      showLabels: true,
      onNodeClick: null,
      onNodeHover: null
    }, options);

    this.rootNode = null;
    this.currentNode = null;
    this.renderedRects = [];
    this.hoveredRect = null;
    this.breadcrumbTrail = [];

    this.initEvents();
  }

  // Color categories matching modern enterprise palette
  static CATEGORY_COLORS = {
    video: { bg: '#8b5cf6', border: '#7c3aed', text: '#ffffff', label: 'Video' },
    audio: { bg: '#ec4899', border: '#db2777', text: '#ffffff', label: 'Audio' },
    image: { bg: '#10b981', border: '#059669', text: '#ffffff', label: 'Images' },
    archive: { bg: '#f59e0b', border: '#d97706', text: '#ffffff', label: 'Archives' },
    document: { bg: '#3b82f6', border: '#2563eb', text: '#ffffff', label: 'Documents' },
    code: { bg: '#06b6d4', border: '#0891b2', text: '#ffffff', label: 'Source Code' },
    executable: { bg: '#ef4444', border: '#dc2626', text: '#ffffff', label: 'Applications' },
    system: { bg: '#64748b', border: '#475569', text: '#ffffff', label: 'System Files' },
    database: { bg: '#14b8a6', border: '#0d9488', text: '#ffffff', label: 'Databases' },
    directory: { bg: '#334155', border: '#1e293b', text: '#f8fafc', label: 'Folder' },
    freespace: { bg: '#1e293b', border: '#0f172a', text: '#94a3b8', label: 'Free Space' },
    other: { bg: '#6b7280', border: '#4b5563', text: '#ffffff', label: 'Other' }
  };

  static EXTENSION_MAP = {
    // Video
    mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video', flv: 'video', webm: 'video', m4v: 'video',
    // Audio
    mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', wma: 'audio', m4a: 'audio',
    // Images
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', tiff: 'image', psd: 'image',
    // Archives
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive', iso: 'archive',
    // Documents
    pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document', ppt: 'document', pptx: 'document', txt: 'document', md: 'document', rtf: 'document',
    // Code
    js: 'code', ts: 'code', html: 'code', css: 'code', py: 'code', c: 'code', cpp: 'code', cs: 'code', java: 'code', go: 'code', rs: 'code', php: 'code', json: 'code',
    // Executables
    exe: 'executable', msi: 'executable', dll: 'executable', sys: 'executable', bat: 'executable', cmd: 'executable', sh: 'executable',
    // Database
    sqlite: 'database', db: 'database', sql: 'database', mdb: 'database', accdb: 'database'
  };

  static getCategoryForExtension(ext) {
    if (!ext) return 'other';
    const clean = ext.toLowerCase().replace(/^\./, '');
    return SquarifiedTreemap.EXTENSION_MAP[clean] || 'other';
  }

  static getColorForNode(node) {
    if (node.isFreeSpace) return SquarifiedTreemap.CATEGORY_COLORS.freespace;
    if (node.isDirectory) return SquarifiedTreemap.CATEGORY_COLORS.directory;
    const cat = SquarifiedTreemap.getCategoryForExtension(node.extension);
    return SquarifiedTreemap.CATEGORY_COLORS[cat] || SquarifiedTreemap.CATEGORY_COLORS.other;
  }

  setData(rootNode) {
    this.rootNode = rootNode;
    this.currentNode = rootNode;
    this.breadcrumbTrail = [rootNode];
    this.render();
  }

  zoomToNode(node) {
    if (!node || !node.isDirectory) return;
    this.currentNode = node;
    const idx = this.breadcrumbTrail.indexOf(node);
    if (idx !== -1) {
      this.breadcrumbTrail = this.breadcrumbTrail.slice(0, idx + 1);
    } else {
      this.breadcrumbTrail.push(node);
    }
    this.render();
    if (this.options.onNodeClick) {
      this.options.onNodeClick(node);
    }
  }

  zoomOut() {
    if (this.breadcrumbTrail.length > 1) {
      this.breadcrumbTrail.pop();
      this.currentNode = this.breadcrumbTrail[this.breadcrumbTrail.length - 1];
      this.render();
      if (this.options.onNodeClick) {
        this.options.onNodeClick(this.currentNode);
      }
    }
  }

  resetZoom() {
    if (this.rootNode) {
      this.currentNode = this.rootNode;
      this.breadcrumbTrail = [this.rootNode];
      this.render();
      if (this.options.onNodeClick) {
        this.options.onNodeClick(this.currentNode);
      }
    }
  }

  initEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      let hit = null;
      // Search from deepest rendered rect backward
      for (let i = this.renderedRects.length - 1; i >= 0; i--) {
        const r = this.renderedRects[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          hit = r;
          break;
        }
      }

      if (hit !== this.hoveredRect) {
        this.hoveredRect = hit;
        this.render();
        if (this.options.onNodeHover) {
          this.options.onNodeHover(hit ? hit.node : null, e);
        }
      }
    });

    canvas.addEventListener('mouseleave', (e) => {
      if (this.hoveredRect) {
        this.hoveredRect = null;
        this.render();
        if (this.options.onNodeHover) {
          this.options.onNodeHover(null, e);
        }
      }
    });

    canvas.addEventListener('click', (e) => {
      if (this.hoveredRect && this.hoveredRect.node) {
        const node = this.hoveredRect.node;
        if (node.isDirectory && node !== this.currentNode) {
          this.zoomToNode(node);
        } else if (this.options.onNodeClick) {
          this.options.onNodeClick(node);
        }
      }
    });
  }

  render() {
    if (!this.canvas) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    this.renderedRects = [];

    if (!this.currentNode || !this.currentNode.children || this.currentNode.children.length === 0) {
      // Empty or single item
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = `14px ${this.options.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data to display in treemap', width / 2, height / 2);
      return;
    }

    const valueKey = this.options.showAllocated ? 'allocatedSize' : 'size';
    const items = [...this.currentNode.children]
      .filter(item => (item[valueKey] || 0) > 0)
      .sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));

    const totalValue = items.reduce((sum, item) => sum + (item[valueKey] || 0), 0);
    if (totalValue <= 0) return;

    // Run squarified layout
    this.squarify(items, { x: 0, y: 0, w: width, h: height }, totalValue, valueKey);

    // Draw rectangles
    for (const r of this.renderedRects) {
      this.drawRect(r);
    }

    // Highlight hovered rect
    if (this.hoveredRect) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.strokeRect(this.hoveredRect.x + 1, this.hoveredRect.y + 1, this.hoveredRect.w - 2, this.hoveredRect.h - 2);
    }
  }

  squarify(children, rect, totalValue, valueKey) {
    if (!children.length || rect.w <= 0 || rect.h <= 0) return;

    // Convert values into relative pixel areas
    const totalArea = rect.w * rect.h;
    const normalized = children.map(c => ({
      node: c,
      area: ((c[valueKey] || 0) / totalValue) * totalArea
    }));

    let remainingRect = { ...rect };
    let row = [];

    for (let i = 0; i < normalized.length; i++) {
      const item = normalized[i];
      const testRow = [...row, item];

      if (row.length === 0 || this.worstAspectRatio(testRow, remainingRect) <= this.worstAspectRatio(row, remainingRect)) {
        row.push(item);
      } else {
        remainingRect = this.layoutRow(row, remainingRect);
        row = [item];
      }
    }

    if (row.length > 0) {
      this.layoutRow(row, remainingRect);
    }
  }

  worstAspectRatio(row, rect) {
    const rowArea = row.reduce((sum, item) => sum + item.area, 0);
    if (rowArea === 0) return Infinity;

    const isHorizontal = rect.w >= rect.h;
    const side = isHorizontal ? rect.h : rect.w;
    if (side === 0) return Infinity;

    const rowWidth = rowArea / side;
    let maxAspect = 0;

    for (const item of row) {
      const itemHeight = item.area / rowWidth;
      const aspect = Math.max(rowWidth / itemHeight, itemHeight / rowWidth);
      if (aspect > maxAspect) {
        maxAspect = aspect;
      }
    }
    return maxAspect;
  }

  layoutRow(row, rect) {
    const rowArea = row.reduce((sum, item) => sum + item.area, 0);
    if (rowArea === 0) return rect;

    const isHorizontal = rect.w >= rect.h;
    const side = isHorizontal ? rect.h : rect.w;
    const rowLength = rowArea / side;

    let offset = 0;
    for (const item of row) {
      const itemSpan = item.area / rowLength;
      let rx, ry, rw, rh;

      if (isHorizontal) {
        rx = rect.x;
        ry = rect.y + offset;
        rw = rowLength;
        rh = itemSpan;
      } else {
        rx = rect.x + offset;
        ry = rect.y;
        rw = itemSpan;
        rh = rowLength;
      }

      this.renderedRects.push({
        x: Math.round(rx),
        y: Math.round(ry),
        w: Math.max(1, Math.round(rw)),
        h: Math.max(1, Math.round(rh)),
        node: item.node
      });

      offset += itemSpan;
    }

    if (isHorizontal) {
      return {
        x: rect.x + rowLength,
        y: rect.y,
        w: Math.max(0, rect.w - rowLength),
        h: rect.h
      };
    } else {
      return {
        x: rect.x,
        y: rect.y + rowLength,
        w: rect.w,
        h: Math.max(0, rect.h - rowLength)
      };
    }
  }

  drawRect(r) {
    const ctx = this.ctx;
    const node = r.node;
    const style = SquarifiedTreemap.getColorForNode(node);

    // Fill background
    ctx.fillStyle = style.bg;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Subtle 1px border
    ctx.strokeStyle = style.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    // Draw label if there is sufficient space
    if (this.options.showLabels && r.w >= this.options.minLabelWidth && r.h >= this.options.minLabelHeight) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx.clip();

      ctx.fillStyle = style.text;
      ctx.font = `600 ${this.options.fontSize}px ${this.options.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const displayName = node.name || 'item';
      ctx.fillText(displayName, r.x + 6, r.y + 5);

      if (r.h >= 36) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.font = `400 ${Math.max(10, this.options.fontSize - 2)}px ${this.options.fontFamily}`;
        const valStr = SquarifiedTreemap.formatBytes(this.options.showAllocated ? node.allocatedSize : node.size);
        ctx.fillText(valStr, r.x + 6, r.y + 20);
      }

      ctx.restore();
    }
  }

  static formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
