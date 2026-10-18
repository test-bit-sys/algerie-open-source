/**
 * DZ-Whiteboard Pro — Vector & Document Export Engine
 * ----------------------------------------------------
 * High-resolution PNG, Vector SVG, Multi-Page Printable PDF,
 * and Portable JSON (.dzboard) save & load pipeline.
 * 100% Client-side, zero external libraries.
 */

export class ExportEngine {
  /**
   * Export the active page as high-resolution PNG image
   */
  static exportPNG(engine, filename = 'whiteboard.png') {
    const page = engine.activePage;
    const elements = page.elements;

    // Calculate content bounding box
    let minX = 0, minY = 0, maxX = 1920, maxY = 1080;
    if (elements.length > 0) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      elements.forEach((el) => {
        const b = engine.getElementBounds(el);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      });
      const pad = 60;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    }

    const width = Math.max(800, Math.ceil(maxX - minX));
    const height = Math.max(600, Math.ceil(maxY - minY));

    // HiDPI 2x scale for print-quality sharpness
    const scale = 2;
    const offscreen = document.createElement('canvas');
    offscreen.width = width * scale;
    offscreen.height = height * scale;
    const ctx = offscreen.getContext('2d');

    ctx.scale(scale, scale);

    // Render background
    const bg = page.background || 'white';
    let baseColor = '#ffffff';
    if (bg === 'chalkboard') baseColor = '#1b4332';
    else if (bg === 'blackboard') baseColor = '#0f172a';
    if (page.customBgColor) baseColor = page.customBgColor;

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, width, height);

    // Translate to content origin
    ctx.translate(-minX, -minY);

    // Draw all elements
    elements.forEach((el) => engine.drawElement(ctx, el));

    // Download blob
    offscreen.toBlob((blob) => {
      ExportEngine.triggerDownload(blob, filename.endsWith('.png') ? filename : filename + '.png');
    }, 'image/png');
  }

  /**
   * Export the active page as pure Scalable Vector Graphics (SVG)
   */
  static exportSVG(engine, filename = 'whiteboard.svg') {
    const page = engine.activePage;
    const elements = page.elements;

    let minX = 0, minY = 0, maxX = 1920, maxY = 1080;
    if (elements.length > 0) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      elements.forEach((el) => {
        const b = engine.getElementBounds(el);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      });
      const pad = 50;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    }

    const width = Math.max(800, Math.ceil(maxX - minX));
    const height = Math.max(600, Math.ceil(maxY - minY));

    const bg = page.background || 'white';
    let baseColor = '#ffffff';
    if (bg === 'chalkboard') baseColor = '#1b4332';
    else if (bg === 'blackboard') baseColor = '#0f172a';
    if (page.customBgColor) baseColor = page.customBgColor;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">\n`;
    svgContent += `  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${baseColor}" />\n`;

    elements.forEach((el) => {
      if (el.type === 'pen') {
        if (!el.points || el.points.length === 0) return;
        const pts = el.points;
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
          d += ` L ${pts[i].x} ${pts[i].y}`;
        }
        const op = el.isHighlighter ? 0.35 : 1.0;
        svgContent += `  <path d="${d}" stroke="${el.color}" stroke-width="${el.width || 3}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${op}" />\n`;
      } else if (el.type === 'shape') {
        const stroke = el.strokeColor || '#000000';
        const fill = el.fillColor || 'none';
        const sw = el.strokeWidth || 3;
        const dash = el.strokeStyle === 'dashed' ? ' stroke-dasharray="8,6"' : (el.strokeStyle === 'dotted' ? ' stroke-dasharray="3,5"' : '');

        if (el.shapeType === 'rect') {
          svgContent += `  <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${dash} />\n`;
        } else if (el.shapeType === 'rounded-rect') {
          svgContent += `  <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="12" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${dash} />\n`;
        } else if (el.shapeType === 'circle') {
          const cx = el.x + el.width / 2;
          const cy = el.y + el.height / 2;
          const rx = Math.abs(el.width / 2);
          const ry = Math.abs(el.height / 2);
          svgContent += `  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${dash} />\n`;
        } else if (el.shapeType === 'triangle') {
          const p1 = `${el.x + el.width / 2},${el.y}`;
          const p2 = `${el.x + el.width},${el.y + el.height}`;
          const p3 = `${el.x},${el.y + el.height}`;
          svgContent += `  <polygon points="${p1} ${p2} ${p3}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${dash} />\n`;
        }
      } else if (el.type === 'line') {
        svgContent += `  <line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${el.strokeColor || '#000000'}" stroke-width="${el.strokeWidth || 3}" stroke-linecap="round" />\n`;
      } else if (el.type === 'text') {
        const lines = (el.text || '').split('\n');
        const fs = el.fontSize || 20;
        lines.forEach((line, idx) => {
          svgContent += `  <text x="${el.x}" y="${el.y + (idx + 1) * fs}" font-size="${fs}" fill="${el.color || '#000000'}" font-family="system-ui, sans-serif">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>\n`;
        });
      }
    });

    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    ExportEngine.triggerDownload(blob, filename.endsWith('.svg') ? filename : filename + '.svg');
  }

  /**
   * Export all document pages into a multi-page printable PDF / HTML lecture handout
   */
  static exportMultiPagePDF(engine, documentTitle = 'DZ-Whiteboard-Lesson') {
    const pages = engine.pages;
    const pageSnapshots = [];

    // Render snapshot for each page
    pages.forEach((page, index) => {
      const elements = page.elements;
      let minX = 0, minY = 0, maxX = 1920, maxY = 1080;
      if (elements.length > 0) {
        minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
        elements.forEach((el) => {
          const b = engine.getElementBounds(el);
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.width);
          maxY = Math.max(maxY, b.y + b.height);
        });
        const pad = 60;
        minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      }

      const width = Math.max(1280, Math.ceil(maxX - minX));
      const height = Math.max(720, Math.ceil(maxY - minY));

      const offscreen = document.createElement('canvas');
      offscreen.width = width * 1.5;
      offscreen.height = height * 1.5;
      const ctx = offscreen.getContext('2d');
      ctx.scale(1.5, 1.5);

      const bg = page.background || 'white';
      let baseColor = '#ffffff';
      if (bg === 'chalkboard') baseColor = '#1b4332';
      else if (bg === 'blackboard') baseColor = '#0f172a';
      if (page.customBgColor) baseColor = page.customBgColor;

      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, width, height);

      ctx.translate(-minX, -minY);
      elements.forEach((el) => engine.drawElement(ctx, el));

      pageSnapshots.push({
        title: page.name || `صفحة ${index + 1}`,
        imgUrl: offscreen.toDataURL('image/png')
      });
    });

    // Build print-friendly HTML presentation
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('يرجى السماح بالنوافذ المنبثقة لإنشاء ملف PDF.');
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${documentTitle} — DZ-Whiteboard</title>
  <style>
    @page { size: A4 landscape; margin: 1cm; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 0; background: #fff; color: #1e293b; }
    .page-sheet { page-break-after: always; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 95vh; padding: 10px; box-sizing: border-box; }
    .page-sheet:last-child { page-break-after: avoid; }
    .page-header { width: 100%; display: flex; justify-content: space-between; border-bottom: 2px solid #0284c7; padding-bottom: 6px; margin-bottom: 12px; font-weight: 700; font-size: 14px; }
    .page-img { max-width: 100%; max-height: 85vh; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 6px; }
    .no-print { position: fixed; top: 12px; left: 12px; z-index: 100; background: #0284c7; color: #fff; padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer; font-weight: 700; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()">طباعة / حفظ بتنسيق PDF</button>
  ${pageSnapshots.map((p, i) => `
    <div class="page-sheet">
      <div class="page-header">
        <span>${p.title}</span>
        <span>DZ-Whiteboard Pro | الصفحة ${i + 1} من ${pageSnapshots.length}</span>
      </div>
      <img class="page-img" src="${p.imgUrl}" alt="${p.title}" />
    </div>
  `).join('')}
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 500);
    });
  </script>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
  }

  /**
   * Save complete project to a portable .dzboard JSON file
   */
  static saveProjectJSON(engine, filename = 'project.dzboard') {
    const payload = {
      app: 'DZ-Whiteboard Pro',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      activePageIndex: engine.activePageIndex,
      pages: engine.pages
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    ExportEngine.triggerDownload(blob, filename.endsWith('.dzboard') ? filename : filename + '.dzboard');
  }

  /**
   * Load project from JSON content
   */
  static loadProjectJSON(engine, jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.pages || !Array.isArray(data.pages)) {
        throw new Error('ملف الأرشيف غير صالح أو تالف.');
      }

      engine.pages = data.pages;
      engine.activePageIndex = Math.max(0, Math.min(engine.pages.length - 1, data.activePageIndex || 0));
      engine.selectedElementIds.clear();
      engine.fitToContent();
      return true;
    } catch (err) {
      alert(`فشل فتح ملف السبورة: ${err.message}`);
      return false;
    }
  }

  static triggerDownload(blob, filename) {
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
