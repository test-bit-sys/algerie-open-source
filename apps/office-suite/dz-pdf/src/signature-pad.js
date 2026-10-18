/**
 * DZ-PDF: Smooth Vector Signature Pad & Signatory Stamp Generator
 * Allows users to sign digitally with pen smoothing, stroke undo,
 * and custom signatory details (Algerian place & date).
 */

export class SignaturePad {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.strokes = [];
    this.currentStroke = [];
    this.isDrawing = false;
    this.color = '#1d4ed8'; // Classic blue ink
    this.strokeWidth = 2.5;

    this.init();
  }

  init() {
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.strokeWidth;

    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      this.isDrawing = true;
      const pos = getPos(e);
      this.currentStroke = [pos];
      this.redraw();
    };

    const draw = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);
      this.currentStroke.push(pos);
      this.redraw();
    };

    const stopDraw = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      this.isDrawing = false;
      if (this.currentStroke.length > 0) {
        this.strokes.push([...this.currentStroke]);
        this.currentStroke = [];
      }
      this.redraw();
    };

    // Mouse events
    this.canvas.addEventListener('mousedown', startDraw);
    window.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDraw);

    // Touch events for mobile/tablet signing
    this.canvas.addEventListener('touchstart', startDraw, { passive: false });
    window.addEventListener('touchmove', draw, { passive: false });
    window.addEventListener('touchend', stopDraw, { passive: false });
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.strokeWidth;

    const allStrokes = [...this.strokes];
    if (this.currentStroke.length > 0) {
      allStrokes.push(this.currentStroke);
    }

    for (const stroke of allStrokes) {
      if (stroke.length < 2) continue;
      this.ctx.beginPath();
      this.ctx.moveTo(stroke[0].x, stroke[0].y);

      for (let i = 1; i < stroke.length; i++) {
        // Midpoint quadratic curve for stroke smoothing
        const p1 = stroke[i - 1];
        const p2 = stroke[i];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        this.ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
      }
      this.ctx.stroke();
    }
  }

  setColor(color) {
    this.color = color;
    this.redraw();
  }

  setStrokeWidth(width) {
    this.strokeWidth = Number(width) || 2.5;
    this.redraw();
  }

  clear() {
    this.strokes = [];
    this.currentStroke = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  undo() {
    if (this.strokes.length > 0) {
      this.strokes.pop();
      this.redraw();
    }
  }

  isEmpty() {
    return this.strokes.length === 0 && this.currentStroke.length === 0;
  }

  /**
   * Generates a composite signature badge with signatory details.
   */
  toSignatureBadge({ name = '', role = '', location = 'Alger', dateStr = '' } = {}) {
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = 400;
    badgeCanvas.height = 180;
    const ctx = badgeCanvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, badgeCanvas.width, badgeCanvas.height);

    // Draw the drawn signature centered in top half
    ctx.drawImage(this.canvas, 50, 10, 300, 100);

    // Signatory Metadata Text below
    if (name || role || dateStr) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1e293b';

      if (name) {
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(name, 200, 130);
      }

      if (role) {
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText(role, 200, 148);
      }

      const dateLine = `${location}, le ${dateStr || new Date().toLocaleDateString('fr-DZ')}`;
      ctx.font = 'italic 11px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(dateLine, 200, 166);
    }

    return badgeCanvas.toDataURL('image/png');
  }
}
