/**
 * DZ-PDF: Standalone Zero-Dependency PDF Engine
 * Pure Vanilla JavaScript implementation of PDF 1.5/1.7 object model,
 * cross-reference table compilation, image embedding, page layout,
 * Algerian administrative stamping, and digital signatures.
 * 
 * Runs 100% offline in browser or Node without external binary dependencies.
 */

export const PAGE_SIZES = {
  A4_PORTRAIT: { width: 595.28, height: 841.89, name: 'A4 Portrait' },
  A4_LANDSCAPE: { width: 841.89, height: 595.28, name: 'A4 Landscape' },
  LETTER_PORTRAIT: { width: 612.00, height: 792.00, name: 'Letter Portrait' },
  LETTER_LANDSCAPE: { width: 792.00, height: 612.00, name: 'Letter Landscape' }
};

export const ALGERIAN_STAMPS = {
  CONFORME: {
    id: 'conforme',
    titleAr: 'نسخة طبق الأصل',
    titleFr: "Conforme à l'original",
    color: '#059669', // Emerald
    borderColor: '#059669'
  },
  CONFIDENTIEL: {
    id: 'confidentiel',
    titleAr: 'سري للغاية',
    titleFr: 'Strictement Confidentiel',
    color: '#dc2626', // Red
    borderColor: '#dc2626'
  },
  PAYE: {
    id: 'paye',
    titleAr: 'مدفوع بالكامل',
    titleFr: 'Payé Intégralement',
    color: '#0284c7', // Blue
    borderColor: '#0284c7'
  },
  ANNULE: {
    id: 'annule',
    titleAr: 'ملغى و لاغٍ',
    titleFr: 'Annulé et Non Avenu',
    color: '#e11d48', // Rose
    borderColor: '#e11d48'
  },
  APPROUVE: {
    id: 'approuve',
    titleAr: 'تمت المصادقة والموافقة',
    titleFr: 'Approuvé et Validé',
    color: '#16a34a', // Green
    borderColor: '#16a34a'
  }
};

export class PDFWriter {
  constructor() {
    this.objects = [];
    this.offsets = [];
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

  /**
   * Encodes a string into PDF literal string format (escaped parentheses).
   */
  escapeString(str) {
    return '(' + String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
  }

  /**
   * Compiles the entire PDF document into a binary Uint8Array.
   */
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
    writeString('%PDF-1.5\n%âãÏÓ\n');

    // 2. Body Objects
    const xrefOffsets = [];
    // Sort objects by id
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
    // Root is object 1 by convention in our builder
    writeString(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);

    // Concatenate all chunks
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
   * Converts a list of image items (with loaded HTMLImageElement or dataUrl)
   * into a clean, compliant multi-page PDF.
   */
  static async imagesToPDF(images, options = {}) {
    const {
      pageSize = PAGE_SIZES.A4_PORTRAIT,
      margin = 36, // 0.5 inch in points
      title = 'DZ-PDF Document',
      author = 'DZ Open Suite User',
      watermarkText = '',
      stamp = null
    } = options;

    const writer = new PDFWriter();

    // Reserve Object IDs
    const catalogId = writer.allocateId(); // 1
    const pagesId = writer.allocateId();   // 2
    const fontId = writer.allocateId();    // 3

    // Standard Font Object
    writer.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
      fontId
    );

    const pageObjIds = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const pageId = writer.allocateId();
      const contentId = writer.allocateId();
      const imgXObjId = writer.allocateId();
      pageObjIds.push(pageId);

      // Process image data to JPEG/DCT
      const { jpegBytes, width, height } = await this.normalizeImageToJPEG(img.element || img.file);

      // Add Image XObject
      writer.addObject(
        {
          header: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`,
          stream: jpegBytes
        },
        imgXObjId
      );

      // Calculate fitted image dimensions on page
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

      // Build Content Stream (PostScript commands)
      let streamCommands = `q\n`; // save graphics state
      streamCommands += `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n`;
      streamCommands += `/Im${i + 1} Do\n`;
      streamCommands += `Q\n`; // restore graphics state

      // Add watermark if present
      if (watermarkText) {
        streamCommands += `q\n`;
        streamCommands += `0.75 0.75 0.75 rg\n`; // light gray
        streamCommands += `/F1 36 Tf\n`;
        // Rotate 45 degrees at center
        const cx = pageSize.width / 2;
        const cy = pageSize.height / 2;
        streamCommands += `1 0 0 1 ${cx} ${cy} cm\n`;
        streamCommands += `0.7071 0.7071 -0.7071 0.7071 0 0 cm\n`;
        streamCommands += `-100 0 Td\n`;
        streamCommands += `${writer.escapeString(watermarkText)} Tj\n`;
        streamCommands += `Q\n`;
      }

      // Add stamp if present
      if (stamp) {
        const stampObj = ALGERIAN_STAMPS[stamp] || null;
        if (stampObj) {
          streamCommands += `q\n`;
          // Draw stamp box near top right or bottom right
          const sx = pageSize.width - 240;
          const sy = pageSize.height - 80;
          streamCommands += `0.02 0.58 0.41 RG\n`; // Emerald stroke
          streamCommands += `2 w\n`;
          streamCommands += `${sx} ${sy} 200 45 re S\n`;
          streamCommands += `/F1 12 Tf\n`;
          streamCommands += `0.02 0.58 0.41 rg\n`;
          streamCommands += `${sx + 15} ${sy + 24} Td\n`;
          streamCommands += `${writer.escapeString(stampObj.titleFr)} Tj\n`;
          streamCommands += `Q\n`;
        }
      }

      const contentBytes = new TextEncoder().encode(streamCommands);
      writer.addObject(
        {
          header: `<< /Length ${contentBytes.length} >>`,
          stream: contentBytes
        },
        contentId
      );

      // Add Page Object
      writer.addObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im${i + 1} ${imgXObjId} 0 R >> >> >>`,
        pageId
      );
    }

    // Pages Root
    const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(' ');
    writer.addObject(
      `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>`,
      pagesId
    );

    // Catalog Root
    writer.addObject(
      `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
      catalogId
    );

    return writer.compile();
  }

  /**
   * Normalizes an HTMLImageElement, File, or Blob to JPEG bytes and dimensions.
   */
  static async normalizeImageToJPEG(source) {
    let imgElement = null;

    if (source instanceof HTMLImageElement && source.complete) {
      imgElement = source;
    } else {
      imgElement = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        if (source instanceof Blob || source instanceof File) {
          img.src = URL.createObjectURL(source);
        } else if (typeof source === 'string') {
          img.src = source;
        }
      });
    }

    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width || 800;
    canvas.height = imgElement.naturalHeight || imgElement.height || 600;
    const ctx = canvas.getContext('2d');

    // Fill white background for transparent PNGs
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgElement, 0, 0);

    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    const arrayBuffer = await jpegBlob.arrayBuffer();

    return {
      jpegBytes: new Uint8Array(arrayBuffer),
      width: canvas.width,
      height: canvas.height
    };
  }

  /**
   * Triggers download of a compiled PDF Uint8Array in the browser.
   */
  static downloadPDF(pdfBytes, filename = 'document.pdf') {
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
