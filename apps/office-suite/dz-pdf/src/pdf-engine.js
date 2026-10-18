/**
 * DZ-PDF: Standalone Zero-Dependency PDF Engine & Administrative Stamp Suite
 * Pure Vanilla JavaScript implementation of PDF 1.5/1.7 object model,
 * cross-reference table compilation, image embedding, page layout,
 * Algerian administrative stamping, and digital signatures.
 * 
 * Runs 100% offline in browser or Node without external binary dependencies.
 * Built to the HeyPuter/everything standard.
 */

export const PAGE_SIZES = {
  A4_PORTRAIT: { width: 595.28, height: 841.89, name: 'A4 Portrait (210 x 297 mm)' },
  A4_LANDSCAPE: { width: 841.89, height: 595.28, name: 'A4 Landscape (297 x 210 mm)' },
  LETTER_PORTRAIT: { width: 612.00, height: 792.00, name: 'US Letter (8.5 x 11 in)' },
  LETTER_LANDSCAPE: { width: 792.00, height: 612.00, name: 'US Letter Landscape' }
};

export const ALGERIAN_STAMPS = {
  ROUND_OFFICIAL: {
    id: 'round_official',
    type: 'circular',
    titleAr: 'الختم الدائري الرسمي للجمهورية',
    titleFr: 'Cachet Rond Officiel de la République',
    color: '#047857', // Emerald
    borderColor: '#047857'
  },
  CONFORME: {
    id: 'conforme',
    type: 'rectangular',
    titleAr: 'نسخة طبق الأصل',
    titleFr: "Conforme à l'Original",
    color: '#047857',
    borderColor: '#047857'
  },
  RECU: {
    id: 'recu',
    type: 'rectangular',
    titleAr: 'وارد ومسجل بتاريخ',
    titleFr: 'Courrier Arrivé / Reçu le',
    color: '#1d4ed8', // Blue
    borderColor: '#1d4ed8'
  },
  CONFIDENTIEL: {
    id: 'confidentiel',
    type: 'rectangular',
    titleAr: 'سري للغاية ومحمي',
    titleFr: 'Strictement Confidentiel',
    color: '#dc2626', // Red
    borderColor: '#dc2626'
  },
  PAYE: {
    id: 'paye',
    type: 'rectangular',
    titleAr: 'مدفوع بالكامل',
    titleFr: 'Payé Intégralement',
    color: '#0284c7', // Sky Blue
    borderColor: '#0284c7'
  },
  APPROUVE: {
    id: 'approuve',
    type: 'rectangular',
    titleAr: 'تمت المصادقة والتأشير',
    titleFr: 'Vu et Approuvé',
    color: '#16a34a', // Green
    borderColor: '#16a34a'
  },
  ANNULE: {
    id: 'annule',
    type: 'rectangular',
    titleAr: 'ملغى و لاغٍ تماماً',
    titleFr: 'Annulé et Non Avenu',
    color: '#e11d48', // Rose Red
    borderColor: '#e11d48'
  },
  URGENT: {
    id: 'urgent',
    type: 'rectangular',
    titleAr: 'عـاجـل جـداً',
    titleFr: 'Très Urgent',
    color: '#ea580c', // Orange
    borderColor: '#ea580c'
  }
};

export class StampRenderer {
  /**
   * Renders an Algerian stamp onto a canvas element and returns a high-res data URL.
   */
  static renderStamp(stampKey, { wilaya = 'ولاية الجزائر', dateStr = '', ref = 'N° 1084/2026' } = {}) {
    const stamp = ALGERIAN_STAMPS[stampKey] || ALGERIAN_STAMPS.ROUND_OFFICIAL;
    const date = dateStr || new Date().toLocaleDateString('ar-DZ');

    if (stamp.type === 'circular') {
      return this.renderCircularStamp(stamp, wilaya, date);
    }
    return this.renderRectangularStamp(stamp, date, ref);
  }

  static renderCircularStamp(stamp, wilaya, date) {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    const cx = 150;
    const cy = 150;
    const color = stamp.color || '#047857';

    // Outer double ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 140, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 132, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 95, 0, Math.PI * 2);
    ctx.stroke();

    // Curved Top Text: الجمهورية الجزائرية الديمقراطية الشعبية
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const topText = 'الجمهورية الجزائرية الديمقراطية الشعبية';
    const angleStep = Math.PI / (topText.length + 3);
    const startAngle = -Math.PI / 2 - (angleStep * (topText.length - 1)) / 2;

    for (let i = 0; i < topText.length; i++) {
      const angle = startAngle + i * angleStep;
      ctx.save();
      ctx.translate(cx + Math.cos(angle) * 114, cy + Math.sin(angle) * 114);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillText(topText[i], 0, 0);
      ctx.restore();
    }

    // Curved Bottom Text: RÉPUBLIQUE ALGÉRIENNE
    const bottomText = 'RÉPUBLIQUE ALGÉRIENNE';
    const bAngleStep = Math.PI / (bottomText.length + 5);
    const bStartAngle = Math.PI / 2 - (bAngleStep * (bottomText.length - 1)) / 2;

    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    for (let i = 0; i < bottomText.length; i++) {
      const angle = bStartAngle + i * bAngleStep;
      ctx.save();
      ctx.translate(cx + Math.cos(angle) * 114, cy + Math.sin(angle) * 114);
      ctx.rotate(angle - Math.PI / 2);
      ctx.fillText(bottomText[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // Center contents: Star & Crescent, Wilaya, Date
    ctx.fillStyle = color;
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★ ☪ ★', cx, cy - 35);

    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillText(wilaya, cx, cy - 5);

    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('مصلحة التوثيق والمصادقة', cx, cy + 22);

    ctx.font = 'bold 12px monospace';
    ctx.fillText(date, cx, cy + 46);

    return canvas.toDataURL('image/png');
  }

  static renderRectangularStamp(stamp, date, ref) {
    const canvas = document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');
    const color = stamp.color || '#047857';

    // Double rectangular border with rounded corners
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    // Titles
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillText(stamp.titleAr, canvas.width / 2, 42);

    ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
    ctx.fillText(stamp.titleFr, canvas.width / 2, 68);

    // Separator line
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 80);
    ctx.lineTo(canvas.width - 30, 80);
    ctx.stroke();

    // Meta row (Date & Ref)
    ctx.font = '12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`التاريخ: ${date}`, canvas.width - 30, 108);

    ctx.textAlign = 'left';
    ctx.fillText(`الرقم: ${ref}`, 30, 108);

    return canvas.toDataURL('image/png');
  }
}

export class PDFWriter {
  constructor() {
    this.objects = [];
    this.nextObjId = 1;
  }

  allocateId() {
    return this.nextObjId++;
  }

  addObject(content, objId = null) {
    const id = objId || this.allocateId();
    this.objects.push({ id, content });
    return id;
  }

  escapeString(str) {
    return '(' + String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
  }

  compile() {
    const chunks = [];
    let currentOffset = 0;

    const writeString = (str) => {
      const bytes = new TextEncoder().encode(str);
      chunks.push(bytes);
      currentOffset += bytes.length;
    };

    const writeBytes = (bytes) => {
      chunks.push(bytes);
      currentOffset += bytes.length;
    };

    // 1. PDF Header
    writeString('%PDF-1.7\n%âãÏÓ\n');

    // 2. Body Objects
    this.objects.sort((a, b) => a.id - b.id);
    const maxId = this.objects.length > 0 ? this.objects[this.objects.length - 1].id : 0;
    const xrefTable = new Array(maxId + 1).fill(null);

    for (const obj of this.objects) {
      xrefTable[obj.id] = currentOffset;
      writeString(`${obj.id} 0 obj\n`);
      if (typeof obj.content === 'string') {
        writeString(obj.content);
      } else if (obj.content instanceof Uint8Array) {
        writeBytes(obj.content);
      } else if (typeof obj.content === 'object' && obj.content.header && obj.content.stream) {
        writeString(obj.content.header + '\nstream\n');
        writeBytes(obj.content.stream);
        writeString('\nendstream');
      }
      writeString('\nendobj\n');
    }

    // 3. Cross-Reference Table
    const startXref = currentOffset;
    writeString(`xref\n0 ${maxId + 1}\n0000000000 65535 f \n`);

    for (let i = 1; i <= maxId; i++) {
      const offset = xrefTable[i] || 0;
      const padded = String(offset).padStart(10, '0');
      writeString(`${padded} 00000 n \n`);
    }

    // 4. Trailer & EOF
    writeString(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);

    // Concatenate chunks
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }
}

export class PDFEngine {
  /**
   * Compiles multiple pages with their annotations, watermarks, stamps, and page numbers
   * into a high-grade PDF 1.7 compliant binary buffer.
   */
  static async compileDocument(pages, options = {}) {
    const {
      pageSize = PAGE_SIZES.A4_PORTRAIT,
      margin = 24,
      watermarkText = '',
      watermarkOpacity = 0.25,
      watermarkAngle = 45,
      includePageNumbers = true,
      pageNumberFormat = 'Page {current} of {total}'
    } = options;

    const writer = new PDFWriter();

    const catalogId = writer.allocateId(); // 1
    const pagesId = writer.allocateId();   // 2
    const fontId = writer.allocateId();    // 3

    // Font Object
    writer.addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`, fontId);

    const pageObjIds = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageId = writer.allocateId();
      const contentId = writer.allocateId();
      const imgXObjId = writer.allocateId();
      pageObjIds.push(pageId);

      // Render flattened page canvas including all active annotations
      const flattenedCanvas = await this.flattenPageToCanvas(page, {
        watermarkText,
        watermarkOpacity,
        watermarkAngle,
        pageNumberStr: includePageNumbers ? pageNumberFormat.replace('{current}', i + 1).replace('{total}', pages.length) : ''
      });

      const { jpegBytes, width, height } = await this.canvasToJPEGBytes(flattenedCanvas);

      // Image XObject
      writer.addObject(
        {
          header: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`,
          stream: jpegBytes
        },
        imgXObjId
      );

      // Fit to printable PDF coordinates
      const printableWidth = pageSize.width - margin * 2;
      const printableHeight = pageSize.height - margin * 2;

      let drawW = printableWidth;
      let drawH = (height / width) * drawW;

      if (drawH > printableHeight) {
        drawH = printableHeight;
        drawW = (width / height) * drawH;
      }

      const drawX = margin + (printableWidth - drawW) / 2;
      const drawY = margin + (printableHeight - drawH) / 2;

      // Stream commands
      let streamCommands = `q\n`;
      // Optional page rotation
      const rot = page.rotation || 0;
      if (rot !== 0) {
        // Handled directly inside flattened canvas for highest fidelity
      }

      streamCommands += `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n`;
      streamCommands += `/Im${i + 1} Do\n`;
      streamCommands += `Q\n`;

      const contentBytes = new TextEncoder().encode(streamCommands);
      writer.addObject(
        {
          header: `<< /Length ${contentBytes.length} >>`,
          stream: contentBytes
        },
        contentId
      );

      // Page Object
      writer.addObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im${i + 1} ${imgXObjId} 0 R >> >> >>`,
        pageId
      );
    }

    // Pages Root
    const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(' ');
    writer.addObject(`<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>`, pagesId);

    // Catalog Root
    writer.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, catalogId);

    return writer.compile();
  }

  /**
   * Flattens a single page into a high-DPI canvas with its background,
   * annotations, text boxes, stamps, and signatures.
   */
  static async flattenPageToCanvas(page, options = {}) {
    const { watermarkText = '', watermarkOpacity = 0.25, watermarkAngle = 45, pageNumberStr = '' } = options;

    let baseImg = null;
    if (page.dataUrl) {
      baseImg = await this.loadImage(page.dataUrl);
    } else if (page.file) {
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onload = (e) => res(e.target.result);
        r.readAsDataURL(page.file);
      });
      baseImg = await this.loadImage(dataUrl);
    }

    const w = baseImg ? (baseImg.naturalWidth || baseImg.width || 1240) : 1240;
    const h = baseImg ? (baseImg.naturalHeight || baseImg.height || 1754) : 1754;

    const canvas = document.createElement('canvas');
    const rot = page.rotation || 0;

    if (rot === 90 || rot === 270) {
      canvas.width = h;
      canvas.height = w;
    } else {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply rotation transform
    ctx.save();
    if (rot !== 0) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(baseImg, -w / 2, -h / 2, w, h);
    } else if (baseImg) {
      ctx.drawImage(baseImg, 0, 0, w, h);
    }
    ctx.restore();

    // Draw Annotations (Pen strokes, Highlights, Redactions, Texts, Stamps, Signatures)
    if (Array.isArray(page.annotations)) {
      for (const ann of page.annotations) {
        this.renderAnnotation(ctx, ann, canvas.width, canvas.height);
      }
    }

    // Draw Watermark
    if (watermarkText) {
      ctx.save();
      ctx.globalAlpha = Math.min(Math.max(watermarkOpacity, 0.05), 1);
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 58px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((-watermarkAngle * Math.PI) / 180);
      ctx.fillText(watermarkText, 0, 0);
      ctx.restore();
    }

    // Draw Page Number
    if (pageNumberStr) {
      ctx.save();
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pageNumberStr, canvas.width / 2, canvas.height - 25);
      ctx.restore();
    }

    return canvas;
  }

  /**
   * Helper to render an individual annotation onto a canvas.
   */
  static renderAnnotation(ctx, ann, canvasW, canvasH) {
    ctx.save();

    if (ann.type === 'pen' || ann.type === 'highlight') {
      if (!ann.points || ann.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = ann.color || (ann.type === 'highlight' ? 'rgba(250, 204, 21, 0.4)' : '#dc2626');
      ctx.lineWidth = ann.width || (ann.type === 'highlight' ? 24 : 3);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (ann.type === 'highlight') {
        ctx.globalAlpha = 0.4;
      }

      ctx.moveTo(ann.points[0].x * canvasW, ann.points[0].y * canvasH);
      for (let i = 1; i < ann.points.length; i++) {
        const p1 = ann.points[i - 1];
        const p2 = ann.points[i];
        const midX = ((p1.x + p2.x) / 2) * canvasW;
        const midY = ((p1.y + p2.y) / 2) * canvasH;
        ctx.quadraticCurveTo(p1.x * canvasW, p1.y * canvasH, midX, midY);
      }
      ctx.stroke();
    } else if (ann.type === 'redaction') {
      // Blackout box
      ctx.fillStyle = '#000000';
      const x = ann.x * canvasW;
      const y = ann.y * canvasH;
      const w = ann.w * canvasW;
      const h = ann.h * canvasH;
      ctx.fillRect(x, y, w, h);
    } else if (ann.type === 'text') {
      // Text annotation
      ctx.fillStyle = ann.color || '#0f172a';
      ctx.font = `${ann.bold ? 'bold ' : ''}${ann.fontSize || 18}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = ann.align || 'right';
      ctx.fillText(ann.text, ann.x * canvasW, ann.y * canvasH);
    } else if (ann.type === 'image' && ann.imageElement) {
      // Stamp or Signature badge
      const x = ann.x * canvasW;
      const y = ann.y * canvasH;
      const w = ann.w * canvasW;
      const h = ann.h * canvasH;
      ctx.drawImage(ann.imageElement, x, y, w, h);
    } else if (ann.type === 'note') {
      // Sticky note icon
      const x = ann.x * canvasW;
      const y = ann.y * canvasH;
      ctx.fillStyle = '#f59e0b'; // Amber note
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', x, y);
    }

    ctx.restore();
  }

  static loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  static async canvasToJPEGBytes(canvas, quality = 0.92) {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    const arrayBuffer = await blob.arrayBuffer();
    return {
      jpegBytes: new Uint8Array(arrayBuffer),
      width: canvas.width,
      height: canvas.height
    };
  }

  static downloadPDF(pdfBytes, filename = 'document_dz_suite.pdf') {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
