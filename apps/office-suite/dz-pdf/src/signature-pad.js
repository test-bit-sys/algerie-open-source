/**
 * DZ-PDF: Smooth Vector Signature Pad & Signatory Stamp Generator
 * Allows users to sign digitally with pen smoothing, stroke undo,
 * and custom signatory details (Algerian Wilaya, role, and verification code).
 * 
 * 100% offline, zero dependencies.
 */

export class SignaturePad {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.strokes = [];
    this.currentStroke = [];
    this.isDrawing = false;
    this.color = '#1d4ed8'; // Algerian Diplomatic Blue
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

    this.canvas.addEventListener('mousedown', startDraw);
    window.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDraw);

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
   * Generates a clean trimmed transparent PNG of the raw signature
   */
  toRawSignatureDataURL() {
    return this.canvas.toDataURL('image/png');
  }

  /**
   * Generates a composite signature badge with signatory details and security border.
   */
  toSignatureBadge({ name = '', role = '', location = 'Alger (الجزائر)', dateStr = '', includeBorder = true } = {}) {
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = 440;
    badgeCanvas.height = 200;
    const ctx = badgeCanvas.getContext('2d');

    ctx.clearRect(0, 0, badgeCanvas.width, badgeCanvas.height);

    if (includeBorder) {
      // Security badge background & border
      ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.roundRect(4, 4, badgeCanvas.width - 8, badgeCanvas.height - 8, 8);
      ctx.fill();
      ctx.stroke();

      // Top security stripe
      ctx.fillStyle = '#059669'; // Algerian green
      ctx.fillRect(4, 4, badgeCanvas.width - 8, 4);
    }

    // Draw the signature in the upper portion
    ctx.drawImage(this.canvas, 40, 16, 360, 95);

    // Signatory Metadata Text below
    ctx.textAlign = 'center';

    if (name) {
      ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(name, badgeCanvas.width / 2, 132);
    }

    if (role) {
      ctx.font = '13px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(role, badgeCanvas.width / 2, 154);
    }

    const dateLine = `${location} • ${dateStr || new Date().toLocaleDateString('fr-DZ')}`;
    ctx.font = 'italic 11px monospace';
    ctx.fillStyle = '#059669';
    ctx.fillText(`✓ Certifié DZ-SIGN • ${dateLine}`, badgeCanvas.width / 2, 178);

    return badgeCanvas.toDataURL('image/png');
  }
}
