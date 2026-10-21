/**
 * DZ-Word — Standalone Zero-Dependency DOCX Engine
 * Generates genuine, fully compliant Office Open XML (.docx) files
 * compatible with Microsoft Word, LibreOffice, Google Docs, and Word Mobile.
 * 100% offline, zero external dependencies.
 */

(function () {
  'use strict';

  // CRC-32 Lookup Table for standard ZIP files
  const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Lightweight in-memory PKZIP archive writer (Method 0: Store)
 * Office Open XML packages (.docx) accept Method 0 flawlessly.
 */
class MiniZip {
  constructor() {
    this.files = [];
  }

  addFile(name, content) {
    let bytes;
    if (typeof content === 'string') {
      bytes = new TextEncoder().encode(content);
    } else if (content instanceof Uint8Array) {
      bytes = content;
    } else if (content instanceof ArrayBuffer) {
      bytes = new Uint8Array(content);
    } else {
      bytes = new Uint8Array(0);
    }
    this.files.push({
      name,
      bytes,
      crc: crc32(bytes),
      size: bytes.length
    });
  }

  buildBlob(mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const parts = [];
    const cdEntries = [];
    let offset = 0;

    const date = new Date();
    const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;

    for (const f of this.files) {
      const nameBytes = new TextEncoder().encode(f.name);
      
      // Local file header (30 bytes + name)
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const v = new DataView(localHeader.buffer);
      v.setUint32(0, 0x04034b50, true); // signature
      v.setUint16(4, 20, true);         // version needed
      v.setUint16(6, 0x0800, true);     // flags (UTF-8 filename)
      v.setUint16(8, 0, true);          // compression method: 0 (Store)
      v.setUint16(10, dosTime, true);
      v.setUint16(12, dosDate, true);
      v.setUint32(14, f.crc, true);
      v.setUint32(18, f.size, true);    // compressed size
      v.setUint32(22, f.size, true);    // uncompressed size
      v.setUint16(26, nameBytes.length, true);
      v.setUint16(28, 0, true);         // extra field length
      localHeader.set(nameBytes, 30);

      parts.push(localHeader);
      parts.push(f.bytes);

      // Central directory header
      const cdHeader = new Uint8Array(46 + nameBytes.length);
      const cdv = new DataView(cdHeader.buffer);
      cdv.setUint32(0, 0x02014b50, true); // signature
      cdv.setUint16(4, 20, true);          // version made by
      cdv.setUint16(6, 20, true);          // version needed
      cdv.setUint16(8, 0x0800, true);      // flags
      cdv.setUint16(10, 0, true);          // method 0
      cdv.setUint16(12, dosTime, true);
      cdv.setUint16(14, dosDate, true);
      cdv.setUint32(16, f.crc, true);
      cdv.setUint32(20, f.size, true);
      cdv.setUint32(24, f.size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);          // extra len
      cdv.setUint16(32, 0, true);          // comment len
      cdv.setUint16(34, 0, true);          // disk start
      cdv.setUint16(36, 0, true);          // internal attrs
      cdv.setUint32(38, 0, true);          // external attrs
      cdv.setUint32(42, offset, true);     // relative offset of local header
      cdHeader.set(nameBytes, 46);

      cdEntries.push(cdHeader);
      offset += localHeader.length + f.bytes.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const entry of cdEntries) {
      parts.push(entry);
      cdSize += entry.length;
    }

    // End of central directory record (22 bytes)
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.files.length, true);
    ev.setUint16(10, this.files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    ev.setUint16(20, 0, true);

    parts.push(eocd);

    return new Blob(parts, { type: mimeType });
  }
}

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rgbToHex(rgbStr) {
  if (!rgbStr) return '000000';
  if (rgbStr.startsWith('#')) return rgbStr.substring(1);
  const m = rgbStr.match(/\d+/g);
  if (m && m.length >= 3) {
    const r = parseInt(m[0], 10).toString(16).padStart(2, '0');
    const g = parseInt(m[1], 10).toString(16).padStart(2, '0');
    const b = parseInt(m[2], 10).toString(16).padStart(2, '0');
    return `${r}${g}${b}`;
  }
  return '000000';
}

function htmlToWordXml(htmlContent, isRTL = true) {
  if (typeof DOMParser === 'undefined') return '<w:p><w:r><w:t></w:t></w:r></w:p>';
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${htmlContent}</div>`, 'text/html');
  const root = doc.body.firstElementChild || doc.body;

  let bodyXml = '';

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text) return '';
      return `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    // Headings
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      const level = tag.substring(1);
      const headingSizes = { '1': 40, '2': 32, '3': 28, '4': 24, '5': 22, '6': 20 };
      const sz = headingSizes[level] || 28;
      const bidiXml = isRTL ? '<w:bidi/>' : '';
      const jcXml = isRTL ? '<w:jc w:val="right"/>' : '<w:jc w:val="left"/>';
      let runXml = '';
      node.childNodes.forEach(child => {
        runXml += processInline(child, { bold: true, size: sz });
      });
      return `<w:p><w:pPr>${bidiXml}${jcXml}<w:spacing w:before="240" w:after="120"/><w:pStyle w:val="Heading${level}"/></w:pPr>${runXml}</w:p>`;
    }

    // Paragraphs and Divs
    if (tag === 'p' || tag === 'div') {
      const align = node.style.textAlign || (isRTL ? 'right' : 'left');
      let jcVal = 'both';
      if (align === 'center') jcVal = 'center';
      else if (align === 'left') jcVal = 'left';
      else if (align === 'right') jcVal = 'right';

      const bidiXml = isRTL ? '<w:bidi/>' : '';
      let runXml = '';
      node.childNodes.forEach(child => {
        runXml += processInline(child, {});
      });

      if (!runXml.trim()) {
        runXml = '<w:r><w:t></w:t></w:r>';
      }

      return `<w:p><w:pPr>${bidiXml}<w:jc w:val="${jcVal}"/><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>${runXml}</w:p>`;
    }

    // Blockquote
    if (tag === 'blockquote') {
      let runXml = '';
      node.childNodes.forEach(child => {
        runXml += processInline(child, { italic: true });
      });
      return `<w:p><w:pPr><w:ind w:left="720" w:right="720"/><w:spacing w:before="120" w:after="120"/></w:pPr>${runXml}</w:p>`;
    }

    // Lists (UL / OL)
    if (tag === 'ul' || tag === 'ol') {
      let listXml = '';
      let itemIdx = 1;
      node.childNodes.forEach(li => {
        if (li.nodeType === Node.ELEMENT_NODE && li.tagName.toLowerCase() === 'li') {
          let liRuns = '';
          li.childNodes.forEach(child => {
            liRuns += processInline(child, {});
          });
          const bulletMark = tag === 'ol' ? `${itemIdx++}. ` : '• ';
          listXml += `<w:p><w:pPr><w:ind w:left="480"/><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${bulletMark}</w:t></w:r>${liRuns}</w:p>`;
        }
      });
      return listXml;
    }

    // Tables
    if (tag === 'table') {
      let tableXml = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/></w:tblBorders></w:tblPr>';
      const rows = node.querySelectorAll('tr');
      rows.forEach(tr => {
        tableXml += '<w:tr>';
        const cells = tr.querySelectorAll('th, td');
        cells.forEach(td => {
          let cellRuns = '';
          td.childNodes.forEach(child => {
            cellRuns += processInline(child, {});
          });
          if (!cellRuns.trim()) cellRuns = '<w:r><w:t></w:t></w:r>';
          tableXml += `<w:tc><w:tcPr><w:tcMar><w:top w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr>${isRTL ? '<w:bidi/>' : ''}</w:pPr>${cellRuns}</w:p></w:tc>`;
        });
        tableXml += '</w:tr>';
      });
      tableXml += '</w:tbl>';
      return tableXml;
    }

    // Horizontal Rule
    if (tag === 'hr') {
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr></w:pPr></w:p>';
    }

    let out = '';
    node.childNodes.forEach(child => {
      out += processNode(child);
    });
    return out;
  }

  function processInline(node, formatting = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text) return '';
      let rPr = '';
      if (formatting.bold) rPr += '<w:b/><w:bCs/>';
      if (formatting.italic) rPr += '<w:i/><w:iCs/>';
      if (formatting.underline) rPr += '<w:u w:val="single"/>';
      if (formatting.strike) rPr += '<w:strike/>';
      if (formatting.size) rPr += `<w:sz w:val="${formatting.size}"/><w:szCs w:val="${formatting.size}"/>`;
      if (formatting.color) {
        const hex = formatting.color.replace('#', '');
        rPr += `<w:color w:val="${hex}"/>`;
      }
      if (formatting.highlight) {
        rPr += `<w:highlight w:val="${formatting.highlight}"/>`;
      }
      const rPrXml = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
      return `<w:r>${rPrXml}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const newFmt = { ...formatting };

    if (tag === 'b' || tag === 'strong') newFmt.bold = true;
    if (tag === 'i' || tag === 'em') newFmt.italic = true;
    if (tag === 'u') newFmt.underline = true;
    if (tag === 's' || tag === 'strike') newFmt.strike = true;
    if (tag === 'mark') newFmt.highlight = 'yellow';

    if (node.style.fontWeight === 'bold' || parseInt(node.style.fontWeight, 10) >= 600) newFmt.bold = true;
    if (node.style.fontStyle === 'italic') newFmt.italic = true;
    if (node.style.textDecoration?.includes('underline')) newFmt.underline = true;
    if (node.style.textDecoration?.includes('line-through')) newFmt.strike = true;

    if (node.style.color) {
      newFmt.color = rgbToHex(node.style.color);
    }
    if (node.style.backgroundColor) {
      newFmt.highlight = 'yellow';
    }

    if (tag === 'br') {
      return '<w:r><w:br/></w:r>';
    }

    let out = '';
    node.childNodes.forEach(child => {
      out += processInline(child, newFmt);
    });
    return out;
  }

  root.childNodes.forEach(child => {
    bodyXml += processNode(child);
  });

  return bodyXml || '<w:p><w:r><w:t></w:t></w:r></w:p>';
}

/**
 * Builds a complete, valid Microsoft Word DOCX package
 */
function generateDocxBlob(htmlContent, options = {}) {
  const isRTL = options.direction === 'rtl';
  const docTitle = options.title || 'Document';
  const pageXml = htmlToWordXml(htmlContent, isRTL);

  const zip = new MiniZip();

  // 1. [Content_Types].xml
  zip.addFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);

  // 2. _rels/.rels
  zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);

  // 3. word/_rels/document.xml.rels
  zip.addFile('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  // 4. word/styles.xml
  zip.addFile('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Amiri"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
        <w:lang w:val="fr-DZ" w:bidi="ar-DZ"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/><w:color w:val="185ABD"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="2B579A"/></w:rPr>
  </w:style>
</w:styles>`);

  // 5. docProps/core.xml
  const nowIso = new Date().toISOString();
  zip.addFile('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(docTitle)}</dc:title>
  <dc:creator>DZ-Word Sovereign Studio</dc:creator>
  <cp:lastModifiedBy>DZ-Word</cp:lastModifiedBy>
  <cp:revision>1</cp:revision>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`);

  // 6. docProps/app.xml
  zip.addFile('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>DZ-Word (Microsoft Word Compatible)</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <Company>DZ Open Source Initiative</Company>
</Properties>`);

  // 7. word/document.xml
  const orientation = options.orientation === 'landscape' ? 'landscape' : 'portrait';
  const widthDxa = orientation === 'landscape' ? '16838' : '11906';
  const heightDxa = orientation === 'landscape' ? '11906' : '16838';

  const sectPrXml = `<w:sectPr>
    <w:pgSz w:w="${widthDxa}" w:h="${heightDxa}" w:orient="${orientation}"/>
    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    <w:cols w:space="720"/>
    <w:docGrid w:linePitch="360"/>
  </w:sectPr>`;

  zip.addFile('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    ${pageXml}
    ${sectPrXml}
  </w:body>
</w:document>`);

  return zip.buildBlob();
}

  if (typeof globalThis !== 'undefined') {
    globalThis.generateDocxBlob = generateDocxBlob;
  }
  if (typeof window !== 'undefined') {
    window.generateDocxBlob = generateDocxBlob;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateDocxBlob };
  }
})();

