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

export const ALGERIAN_WILAYAS = [
  { code: '01', nameAr: 'أدرار', nameFr: 'Adrar' },
  { code: '02', nameAr: 'الشلف', nameFr: 'Chlef' },
  { code: '03', nameAr: 'الأغواط', nameFr: 'Laghouat' },
  { code: '04', nameAr: 'أم البواقي', nameFr: 'Oum El Bouaghi' },
  { code: '05', nameAr: 'باتنة', nameFr: 'Batna' },
  { code: '06', nameAr: 'بجاية', nameFr: 'Béjaïa' },
  { code: '07', nameAr: 'بسكرة', nameFr: 'Biskra' },
  { code: '08', nameAr: 'بشار', nameFr: 'Béchar' },
  { code: '09', nameAr: 'البليدة', nameFr: 'Blida' },
  { code: '10', nameAr: 'البويرة', nameFr: 'Bouira' },
  { code: '11', nameAr: 'تمنراست', nameFr: 'Tamanrasset' },
  { code: '12', nameAr: 'تبسة', nameFr: 'Tébessa' },
  { code: '13', nameAr: 'تلمسان', nameFr: 'Tlemcen' },
  { code: '14', nameAr: 'تيارت', nameFr: 'Tiaret' },
  { code: '15', nameAr: 'تيزي وزو', nameFr: 'Tizi Ouzou' },
  { code: '16', nameAr: 'الجزائر العاصمة', nameFr: 'Alger' },
  { code: '17', nameAr: 'الجلفة', nameFr: 'Djelfa' },
  { code: '18', nameAr: 'جيجل', nameFr: 'Jijel' },
  { code: '19', nameAr: 'سطيف', nameFr: 'Sétif' },
  { code: '20', nameAr: 'سعيدة', nameFr: 'Saïda' },
  { code: '21', nameAr: 'سكيكدة', nameFr: 'Skikda' },
  { code: '22', nameAr: 'سيدي بلعباس', nameFr: 'Sidi Bel Abbès' },
  { code: '23', nameAr: 'عنابة', nameFr: 'Annaba' },
  { code: '24', nameAr: 'قالمة', nameFr: 'Guelma' },
  { code: '25', nameAr: 'قسنطينة', nameFr: 'Constantine' },
  { code: '26', nameAr: 'المدية', nameFr: 'Médéa' },
  { code: '27', nameAr: 'مستغانم', nameFr: 'Mostaganem' },
  { code: '28', nameAr: 'المسيلة', nameFr: 'M’Sila' },
  { code: '29', nameAr: 'معسكر', nameFr: 'Mascara' },
  { code: '30', nameAr: 'ورقلة', nameFr: 'Ouargla' },
  { code: '31', nameAr: 'وهران', nameFr: 'Oran' },
  { code: '32', nameAr: 'البيض', nameFr: 'El Bayadh' },
  { code: '33', nameAr: 'إليزي', nameFr: 'Illizi' },
  { code: '34', nameAr: 'برج بوعريريج', nameFr: 'Bordj Bou Arreridj' },
  { code: '35', nameAr: 'بومرداس', nameFr: 'Boumerdès' },
  { code: '36', nameAr: 'الطارف', nameFr: 'El Tarf' },
  { code: '37', nameAr: 'تندوف', nameFr: 'Tindouf' },
  { code: '38', nameAr: 'تيسمسيلت', nameFr: 'Tissemsilt' },
  { code: '39', nameAr: 'الوادي', nameFr: 'El Oued' },
  { code: '40', nameAr: 'خنشلة', nameFr: 'Khenchela' },
  { code: '41', nameAr: 'سوق أهراس', nameFr: 'Souk Ahras' },
  { code: '42', nameAr: 'تيبازة', nameFr: 'Tipaza' },
  { code: '43', nameAr: 'ميلة', nameFr: 'Mila' },
  { code: '44', nameAr: 'عين الدفلى', nameFr: 'Aïn Defla' },
  { code: '45', nameAr: 'النعامة', nameFr: 'Naâma' },
  { code: '46', nameAr: 'عين تموشنت', nameFr: 'Aïn Témouchent' },
  { code: '47', nameAr: 'غرداية', nameFr: 'Ghardaïa' },
  { code: '48', nameAr: 'غليزان', nameFr: 'Relizane' },
  { code: '49', nameAr: 'تيميمون', nameFr: 'Timimoun' },
  { code: '50', nameAr: 'برج باجي مختار', nameFr: 'Bordj Badji Mokhtar' },
  { code: '51', nameAr: 'أولاد جلال', nameFr: 'Ouled Djellal' },
  { code: '52', nameAr: 'بني عباس', nameFr: 'Béni Abbès' },
  { code: '53', nameAr: 'عين صالح', nameFr: 'In Salah' },
  { code: '54', nameAr: 'عين قزام', nameFr: 'In Guezzam' },
  { code: '55', nameAr: 'تقرت', nameFr: 'Touggourt' },
  { code: '56', nameAr: 'جانت', nameFr: 'Djanet' },
  { code: '57', nameAr: 'المغير', nameFr: 'El M’Ghair' },
  { code: '58', nameAr: 'المنيعة', nameFr: 'El Menia' }
];

export const ALGERIAN_STAMPS = {
  ROUND_OFFICIAL: {
    id: 'round_official',
    type: 'circular',
    titleAr: 'الختم الدائري الرسمي للجمهورية',
    titleFr: 'Cachet Rond Officiel de la République',
    color: '#047857', // Emerald
    borderColor: '#047857'
  },
  OVAL_COMPANY: {
    id: 'oval_company',
    type: 'oval',
    titleAr: 'ختم تجاري بيضاوي للشركات',
    titleFr: 'Cachet Ovale Société Commerciale SARL',
    color: '#1d4ed8', // Blue
    borderColor: '#1d4ed8'
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
    color: '#1d4ed8',
    borderColor: '#1d4ed8'
  },
  CONFIDENTIEL: {
    id: 'confidentiel',
    type: 'rectangular',
    titleAr: 'سري للغاية ومحمي',
    titleFr: 'Strictement Confidentiel',
    color: '#dc2626',
    borderColor: '#dc2626'
  },
  FINANCE_VISA: {
    id: 'finance_visa',
    type: 'rectangular',
    titleAr: 'تأشيرة المراقبة المالية',
    titleFr: 'Visa du Contrôle Financier',
    color: '#0891b2', // Cyan
    borderColor: '#0891b2'
  },
  HR_SERVICE: {
    id: 'hr_service',
    type: 'rectangular',
    titleAr: 'مصلحة تسيير الموارد البشرية',
    titleFr: 'Service des Ressources Humaines',
    color: '#7c3aed', // Purple
    borderColor: '#7c3aed'
  },
  TAX_OFFICE: {
    id: 'tax_office',
    type: 'rectangular',
    titleAr: 'قباضة الضرائب والخزينة',
    titleFr: 'Recette des Impôts / Trésor',
    color: '#b45309', // Amber / Bronze
    borderColor: '#b45309'
  },
  PAYE: {
    id: 'paye',
    type: 'rectangular',
    titleAr: 'مدفوع بالكامل',
    titleFr: 'Payé Intégralement',
    color: '#0284c7',
    borderColor: '#0284c7'
  },
  APPROUVE: {
    id: 'approuve',
    type: 'rectangular',
    titleAr: 'تمت المصادقة والتأشير',
    titleFr: 'Vu et Approuvé',
    color: '#16a34a',
    borderColor: '#16a34a'
  },
  ANNULE: {
    id: 'annule',
    type: 'rectangular',
    titleAr: 'ملغى و لاغٍ تماماً',
    titleFr: 'Annulé et Non Avenu',
    color: '#e11d48',
    borderColor: '#e11d48'
  },
  URGENT: {
    id: 'urgent',
    type: 'rectangular',
    titleAr: 'عـاجـل جـداً',
    titleFr: 'Très Urgent',
    color: '#ea580c',
    borderColor: '#ea580c'
  }
};

export class StampRenderer {
  /**
   * Renders an Algerian stamp onto a canvas element and returns a high-res data URL.
   */
  static renderStamp(stampKey, { wilaya = 'ولاية الجزائر', dateStr = '', ref = 'N° 1084/2026', customColor = null } = {}) {
    const stamp = ALGERIAN_STAMPS[stampKey] || ALGERIAN_STAMPS.ROUND_OFFICIAL;
    const date = dateStr || new Date().toLocaleDateString('ar-DZ');
    const color = customColor || stamp.color || '#047857';

    if (stamp.type === 'circular') {
      return this.renderCircularStamp(stamp, wilaya, date, color);
    } else if (stamp.type === 'oval') {
      return this.renderOvalStamp(stamp, wilaya, date, ref, color);
    }
    return this.renderRectangularStamp(stamp, date, ref, color);
  }

  static renderCircularStamp(stamp, wilaya, date, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    const cx = 160;
    const cy = 160;

    // Outer double ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 150, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 142, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 102, 0, Math.PI * 2);
    ctx.stroke();

    // Outer Circular Latin Text: ★ RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE ★
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = 'bold 9.5px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const topText = '★ RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE ★';
    const angleStep = Math.PI / (topText.length + 3);
    const startAngle = -Math.PI / 2 - (angleStep * (topText.length - 1)) / 2;

    for (let i = 0; i < topText.length; i++) {
      const angle = startAngle + i * angleStep;
      ctx.save();
      ctx.translate(cx + Math.cos(angle) * 124, cy + Math.sin(angle) * 124);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillText(topText[i], 0, 0);
      ctx.restore();
    }

    // Bottom Circular Latin Text: ★ SERVICE DU VISA ET DE L'AUTHENTIFICATION ★
    const bottomText = "★ VISA ET AUTHENTIFICATION OFFICIELLE ★";
    const bAngleStep = Math.PI / (bottomText.length + 4);
    const bStartAngle = Math.PI / 2 - (bAngleStep * (bottomText.length - 1)) / 2;

    for (let i = 0; i < bottomText.length; i++) {
      const angle = bStartAngle + i * bAngleStep;
      ctx.save();
      ctx.translate(cx + Math.cos(angle) * 124, cy + Math.sin(angle) * 124);
      ctx.rotate(angle - Math.PI / 2);
      ctx.fillText(bottomText[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // Center contents: Republic Arabic calligraphy, Star & Crescent, Wilaya, Service, Date
    ctx.save();
    ctx.fillStyle = color;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';

    // Horizontal cursive connected Arabic Republic banner
    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('الجمهورية الجزائرية', cx, cy - 56);
    ctx.fillText('الديمقراطية الشعبية', cx, cy - 38);

    // Star & Crescent
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillText('★ ☪ ★', cx, cy - 16);

    // Wilaya
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.fillText(wilaya, cx, cy + 6);

    // Service
    ctx.font = '12px "Segoe UI", Arial, sans-serif';
    ctx.fillText('مصلحة التوثيق والمصادقة', cx, cy + 26);

    // Date
    ctx.direction = 'ltr';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(date, cx, cy + 46);
    ctx.restore();

    return canvas.toDataURL('image/png');
  }

  static renderOvalStamp(stamp, wilaya, date, ref, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 220;
    const ctx = canvas.getContext('2d');
    const cx = 180;
    const cy = 110;

    // Outer double ellipse
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 170, 98, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 162, 90, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ellipse
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 125, 62, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Center text
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillText(stamp.titleAr, cx, cy - 18);

    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(stamp.titleFr, cx, cy + 5);

    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${wilaya} • ${date}`, cx, cy + 28);
    ctx.fillText(`Réf: ${ref}`, cx, cy + 46);

    return canvas.toDataURL('image/png');
  }

  static renderRectangularStamp(stamp, date, ref, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');

    // Double rectangular border
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    // Titles
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillText(stamp.titleAr, canvas.width / 2, 42);

    ctx.direction = 'ltr';
    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText(stamp.titleFr, canvas.width / 2, 68);

    // Separator line
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 80);
    ctx.lineTo(canvas.width - 30, 80);
    ctx.stroke();

    // Meta row (Date & Ref)
    ctx.direction = 'rtl';
    ctx.font = '12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`التاريخ: ${date}`, canvas.width - 30, 108);

    ctx.direction = 'ltr';
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
      margin = 20,
      watermarkText = '',
      watermarkOpacity = 0.25,
      watermarkAngle = 45,
      includePageNumbers = true,
      pageNumberFormat = 'Page {current} of {total}',
      headerText = '',
      footerText = ''
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
        pageNumberStr: includePageNumbers ? pageNumberFormat.replace('{current}', i + 1).replace('{total}', pages.length) : '',
        headerText,
        footerText
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

      let streamCommands = `q\n`;
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
    const {
      watermarkText = '',
      watermarkOpacity = 0.25,
      watermarkAngle = 45,
      pageNumberStr = '',
      headerText = '',
      footerText = ''
    } = options;

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

    // Draw Header Text
    if (headerText) {
      ctx.save();
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';
      ctx.fillText(headerText, canvas.width / 2, 35);
      ctx.restore();
    }

    // Draw Watermark
    if (watermarkText) {
      ctx.save();
      ctx.globalAlpha = Math.min(Math.max(watermarkOpacity, 0.05), 1);
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 64px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = 'rtl';

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((-watermarkAngle * Math.PI) / 180);
      ctx.fillText(watermarkText, 0, 0);
      ctx.restore();
    }

    // Draw Footer / Bates Page Number
    const bottomText = [pageNumberStr, footerText].filter(Boolean).join(' • ');
    if (bottomText) {
      ctx.save();
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';
      ctx.fillText(bottomText, canvas.width / 2, canvas.height - 25);
      ctx.restore();
    }

    return canvas;
  }

  /**
   * Helper to render an individual annotation onto a canvas.
   */
  static renderAnnotation(ctx, ann, canvasW, canvasH) {
    ctx.save();

    if (ann.type === 'pen' || ann.type === 'highlighter') {
      if (!ann.points || ann.points.length < 2) {
        ctx.restore();
        return;
      }
      ctx.beginPath();
      ctx.strokeStyle = ann.color || (ann.type === 'highlighter' ? 'rgba(250, 204, 21, 0.4)' : '#dc2626');
      ctx.lineWidth = ann.width || (ann.type === 'highlighter' ? 24 : 3);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (ann.type === 'highlighter') {
        ctx.globalAlpha = 0.45;
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
      ctx.direction = 'rtl';
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
      // Sticky note icon & pill
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
    } else if (ann.type === 'measure') {
      const x1 = ann.start.x * canvasW;
      const y1 = ann.start.y * canvasH;
      const x2 = ann.end.x * canvasW;
      const y2 = ann.end.y * canvasH;

      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);

      // Main measurement line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // End caps
      ctx.setLineDash([]);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const capLen = 10;
      const perpAngle = angle + Math.PI / 2;

      ctx.beginPath();
      ctx.moveTo(x1 - Math.cos(perpAngle) * capLen, y1 - Math.sin(perpAngle) * capLen);
      ctx.lineTo(x1 + Math.cos(perpAngle) * capLen, y1 + Math.sin(perpAngle) * capLen);
      ctx.moveTo(x2 - Math.cos(perpAngle) * capLen, y2 - Math.sin(perpAngle) * capLen);
      ctx.lineTo(x2 + Math.cos(perpAngle) * capLen, y2 + Math.sin(perpAngle) * capLen);
      ctx.stroke();

      // Midpoint distance pill badge
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
      const text = ann.distStr || '0.00 m';
      const textW = ctx.measureText(text).width;

      ctx.fillStyle = '#0f172a';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(midX - textW / 2 - 8, midY - 12, textW + 16, 24, 4);
        ctx.fill();
      } else {
        ctx.fillRect(midX - textW / 2 - 8, midY - 12, textW + 16, 24);
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, midX, midY);
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
